// M10 F2 에이전트 프리필 New Run — 서버 (S1~S4). run-template·U⊆D 재도출·400/409·manifest.agent writer.
// projectRoot 는 모듈 상수라 registerApi 를 임시 root 로 직접 등록해 격리(정의 변경/삭제 TOCTOU 테스트 위해 fresh 인스턴스).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApi } from "../src/server/api/index.js";
import { deriveTools, agentFingerprint, findAgent, readAgents } from "../src/server/adapters/harness.js";
import { Manifest } from "../src/server/schemas.js";

let root: string;
let app: FastifyInstance;

async function writeAgent(name: string, fm: string): Promise<void> {
  await writeFile(join(root, ".claude", "agents", `${name}.md`), `---\n${fm}\n---\n\n# ${name}\n`);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-prefill-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  await writeAgent("builder", [
    "name: builder",
    "description: 빌더 에이전트",
    "tools: Read, Grep, Glob, Bash",
    "targets: agents, skills",
    "domainTemplate: 이 에이전트에게 요청할 작업을 기술하세요",
    "model: opus",
  ].join("\n"));
  await writeAgent("reader", ["name: reader", "description: 읽기 전용", "tools: Read Grep"].join("\n"));
  await writeAgent("notools", ["name: notools", "description: 도구 미선언"].join("\n"));
  app = Fastify({ logger: false });
  registerApi(app, root);
  await app.ready();
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

describe("deriveTools — frontmatter tools → argv-token D (S3·A64)", () => {
  it("콤마/공백 나열 분해·dedupe", () => {
    expect(deriveTools("Read, Grep, Glob, Bash")).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(deriveTools("Read Grep  Read")).toEqual(["Read", "Grep"]); // dedupe
  });
  it("leading-dash·YAML 리스트 잔재·괄호 스펙 등 비-token 드롭(flag injection 방어)", () => {
    expect(deriveTools("- Read - Grep")).toEqual(["Read", "Grep"]);   // YAML 대시 드롭
    expect(deriveTools("--dangerous Read")).toEqual(["Read"]);        // leading-dash 드롭
    expect(deriveTools("Bash(git:*) Read")).toEqual(["Read"]);        // 괄호/콜론 token 드롭
    expect(deriveTools("")).toEqual([]);
    expect(deriveTools(undefined)).toEqual([]);
  });
  it("max40 clamp", () => {
    const many = Array.from({ length: 60 }, (_, i) => `T${i}`).join(",");
    expect(deriveTools(many).length).toBe(40);
  });
});

describe("GET /api/agents/:name/run-template (A64)", () => {
  it("정상 에이전트 → 프리필 초안(정의 재도출·read-only·D=suggestedAllowedTools)", async () => {
    const r = await app.inject({ url: "/api/agents/builder/run-template" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.agent).toBe("builder");
    expect(b.runtime).toBe("claude");
    expect(b.domainTemplate).toContain("작업을 기술");
    expect(b.targets).toEqual(["agents", "skills"]);
    expect(b.suggestedAllowedTools).toEqual(["Read", "Grep", "Glob", "Bash"]); // = D
    expect(b.permissionMode).toBe("read-only"); // 항상 보수적
    expect(typeof b.fingerprint).toBe("string");
  });
  it("도구 미선언 에이전트 → suggestedAllowedTools=[]", async () => {
    const b = (await app.inject({ url: "/api/agents/notools/run-template" })).json();
    expect(b.suggestedAllowedTools).toEqual([]);
    expect(b.permissionMode).toBe("read-only");
  });
  it("거부: name=../foo (경로주입) → 400 (isSafeSegment)", async () => {
    const r = await app.inject({ url: "/api/agents/..%2Ffoo/run-template" });
    expect(r.statusCode).toBe(400); // fail-closed(라우트 미매칭 시 404 도 거부지만 계약은 400)
  });
  it("거부: name=a b (공백/메타) → 400", async () => {
    const r = await app.inject({ url: "/api/agents/a%20b/run-template" });
    expect(r.statusCode).toBe(400);
  });
  it("미존재 에이전트 → 404", async () => {
    expect((await app.inject({ url: "/api/agents/ghost/run-template" })).statusCode).toBe(404);
  });
});

describe("POST /api/runs — U⊆D 재도출·천장 (A65·A66)", () => {
  const base = { runtime: "claude", mode: "build", domain: "작업", dryRun: true };

  it("A65: U ⊆ D(축소) → 정상(dry-run preview)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { ...base, agent: "builder", allowedTools: ["Read", "Grep"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().dryRun).toBe(true);
  });
  it("U = D 전체 → 정상", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { ...base, agent: "builder", allowedTools: ["Read", "Grep", "Glob", "Bash"] } });
    expect(r.statusCode).toBe(200);
  });
  it("거부: D 밖 도구 주장(직접 API 상향) → 400 unauthorized-tool(명시 반려·detail 노출)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { ...base, agent: "builder", allowedTools: ["Read", "Write"] } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("unauthorized-tool");
    expect(r.json().detail).toContain("Write"); // 조용한 드롭 아님
  });
  it("거부: reader 의 D=[Read,Grep] 밖 Bash 요청 → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { ...base, agent: "reader", allowedTools: ["Bash"] } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("unauthorized-tool");
  });
  it("계약불변: agent 미지정 일반 New Run = D 상한 없음(v0.5) → 임의 allowedTools 통과", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { ...base, allowedTools: ["Read", "Write", "Bash"] } });
    expect(r.statusCode).toBe(200); // D 상한 무관·noFlag/max40 만 검증
  });
  it("A66: agent 지정 성공 → manifest.agent 기록(dryRun=false)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { runtime: "claude", mode: "tag", domain: "x", dryRun: false, agent: "builder", allowedTools: ["Read"] } });
    expect(r.statusCode).toBe(200);
    const { runDir } = r.json();
    const m = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
    expect(Manifest.parse(m).agent).toBe("builder"); // writer 배선·스키마 통과
  });
});

describe("POST /api/runs — 409 agent-definition-changed (TOCTOU·R4-#1)", () => {
  it("거부: 지문 불일치(정의 변경) → 409", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { runtime: "claude", mode: "build", domain: "x", dryRun: true, agent: "builder", allowedTools: ["Read"], agentFingerprint: "deadbeefdeadbeef" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("agent-definition-changed");
  });
  it("거부: template↔제출 사이 정의 삭제 후 allowedTools 제출 → 409(천장우회 차단)", async () => {
    const r2 = await mkdtemp(join(tmpdir(), "hui-del-"));
    await mkdir(join(r2, ".claude", "agents"), { recursive: true });
    await writeFile(join(r2, ".claude", "agents", "temp.md"), "---\nname: temp\ntools: Read, Grep\n---\n");
    const a2 = Fastify({ logger: false }); registerApi(a2, r2); await a2.ready();
    const tmpl = (await a2.inject({ url: "/api/agents/temp/run-template" })).json();
    await rm(join(r2, ".claude", "agents", "temp.md")); // 제출 전 삭제
    const r = await a2.inject({ method: "POST", url: "/api/runs", payload: { runtime: "claude", mode: "build", domain: "x", dryRun: true, agent: "temp", allowedTools: ["Read"], agentFingerprint: tmpl.fingerprint } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("agent-definition-changed");
    await a2.close(); await rm(r2, { recursive: true, force: true });
  });
  it("거부: 정의 D 축소 후 옛 U 제출 → 새 D 기준 U⊄D → 400(지문 없을 때)", async () => {
    const r2 = await mkdtemp(join(tmpdir(), "hui-shrink-"));
    await mkdir(join(r2, ".claude", "agents"), { recursive: true });
    await writeFile(join(r2, ".claude", "agents", "s.md"), "---\nname: s\ntools: Read, Grep, Bash\n---\n");
    const a2 = Fastify({ logger: false }); registerApi(a2, r2); await a2.ready();
    await writeFile(join(r2, ".claude", "agents", "s.md"), "---\nname: s\ntools: Read\n---\n"); // D 축소
    const r = await a2.inject({ method: "POST", url: "/api/runs", payload: { runtime: "claude", mode: "build", domain: "x", dryRun: true, agent: "s", allowedTools: ["Bash"] } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("unauthorized-tool");
    await a2.close(); await rm(r2, { recursive: true, force: true });
  });
  it("삭제된 에이전트 태그(빈 U·지문 없음) = 형식검증만·무해 허용(태그만)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { runtime: "claude", mode: "build", domain: "x", dryRun: true, agent: "ghost" } });
    expect(r.statusCode).toBe(200); // 경로 조립 아님·귀속 태그
  });
});

describe("마이그레이션·재도출 일관성", () => {
  it("구 manifest(agent 키 없음) → null 파싱(거부 아님·A47)", () => {
    const old = { schemaVersion: "1", runId: "r", projectRoot: "/x", runtime: "codex", mode: "m", createdAt: "2026-07-09T00:00:00Z", requestedBy: "t", goal: "g", agents: [], targets: [], permissionMode: "read-only", model: "default", supervisorVersion: "0.5.0" };
    expect(Manifest.parse(old).agent).toBeNull();
  });
  it("run-template 지문 = 제출 재도출 지문(단일 재도출 함수)", async () => {
    const info = await findAgent(root, "builder");
    const tmpl = (await app.inject({ url: "/api/agents/builder/run-template" })).json();
    expect(tmpl.fingerprint).toBe(agentFingerprint(info!));
  });
  it("readAgents 가 실 레포 agents 의 tools 추출(회귀)", async () => {
    const agents = await readAgents(root);
    expect(agents.find((a) => a.name === "builder")!.tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
  });
});
