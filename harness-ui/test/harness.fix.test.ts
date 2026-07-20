// M10(F2) 외부감사 R1(agy) 서버 HIGH 2 + MED 1 회귀 잠금.
// #1 codex .toml 배열 문법 정제(tools 항상 빈 배열 버그) / #2 readAgents OOM·개수 상한 / #3 fingerprint POSIX 결정성.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveTools, readAgents, findAgent, agentFingerprint } from "../src/server/adapters/harness.js";

describe("agy#1 — codex .toml 배열 문법 정제 → tools 정확 산출(빈 배열 아님)", () => {
  it("deriveTools: 대괄호/따옴표 배열 → 순수 토큰(argv 필터 후)", () => {
    // 미정제 시 `["Read` / `"Bash(git:*)"]` 오염 토큰이 전부 드롭돼 빈 배열이 됐음.
    expect(deriveTools('["Read","Bash(git:*)"]')).toEqual(["Read"]); // Bash(...)는 argv 필터가 드롭
    expect(deriveTools('["Read", "Grep", "Glob"]')).toEqual(["Read", "Grep", "Glob"]);
    expect(deriveTools("['Read','Bash']")).toEqual(["Read", "Bash"]); // 홑따옴표
  });
  it("claude YAML 콤마 나열은 회귀 없이 유지", () => {
    expect(deriveTools("Read, Grep, Glob, Bash")).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(deriveTools("- Read - Grep")).toEqual(["Read", "Grep"]);
  });

  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "hui-toml-"));
    await mkdir(join(root, ".codex", "agents"), { recursive: true });
    await writeFile(join(root, ".codex", "agents", "cx.toml"),
      'name = "cx"\ntools = ["Read","Bash(git:*)","Grep"]\ntargets = ["agents","skills"]\n');
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it("readAgents: codex 에이전트 tools/targets 정확 산출(빈 배열 아님)", async () => {
    const cx = (await readAgents(root)).find((a) => a.name === "cx")!;
    expect(cx.runtime).toBe("codex");
    expect(cx.tools).toEqual(["Read", "Grep"]); // Bash(git:*)는 argv 필터 드롭·나머지 유지
    expect(cx.tools.length).toBeGreaterThan(0); // 핵심: 항상 빈 배열 아님
    expect(cx.targets).toEqual(["agents", "skills"]);
  });
});

describe("agy#2 — readAgents OOM·개수 상한 방어", () => {
  it("초과 크기 정의 파일은 결과에서 skip(전체 read 미수행)", async () => {
    const root = await mkdtemp(join(tmpdir(), "hui-big-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "small.md"), "---\nname: small\ntools: Read\n---\n");
    // 256KB 초과(약 300KB) — 정상 파싱 가능한 frontmatter 지만 크기캡으로 skip 되어야 함.
    const huge = "---\nname: huge\ntools: Read\n---\n" + "x".repeat(300 * 1024);
    await writeFile(join(root, ".claude", "agents", "huge.md"), huge);
    const agents = await readAgents(root);
    expect(agents.find((a) => a.name === "small")).toBeDefined();
    expect(agents.find((a) => a.name === "huge")).toBeUndefined(); // 초과 → skip
    await rm(root, { recursive: true, force: true });
  });

  it("파일 개수 상한(MAX_AGENT_FILES=500) 초과 시 바운드", async () => {
    const root = await mkdtemp(join(tmpdir(), "hui-many-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await Promise.all(Array.from({ length: 520 }, (_, i) =>
      writeFile(join(root, ".claude", "agents", `a${i}.md`), `---\nname: a${i}\ntools: Read\n---\n`)));
    const agents = await readAgents(root);
    expect(agents.length).toBeLessThanOrEqual(500); // 스캔 개수 상한
    await rm(root, { recursive: true, force: true });
  });

  it("findAgent fast-path: 거대 형제 파일이 있어도 단건 조회 정상(전건 read 폭발 없음)", async () => {
    const root = await mkdtemp(join(tmpdir(), "hui-fp-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "target.md"), "---\nname: target\ntools: Read, Grep\n---\n");
    // 형제 초과 파일 — 전건 스캔이면 read(skip이나) 대상. fast-path는 target.md 만 read.
    await writeFile(join(root, ".claude", "agents", "beast.md"), "---\nname: beast\n---\n" + "y".repeat(300 * 1024));
    const info = await findAgent(root, "target");
    expect(info?.name).toBe("target");
    expect(info?.tools).toEqual(["Read", "Grep"]);
    await rm(root, { recursive: true, force: true });
  });

  it("findAgent: fm.name≠파일명 이면 전건 스캔 폴백으로 정확 매칭", async () => {
    const root = await mkdtemp(join(tmpdir(), "hui-fb-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "file1.md"), "---\nname: realname\ntools: Read\n---\n");
    expect((await findAgent(root, "realname"))?.name).toBe("realname"); // 폴백 경로
    expect(await findAgent(root, "file1")).toBeUndefined(); // 파일명은 name 아님
    await rm(root, { recursive: true, force: true });
  });
});

describe("agy#3 — fingerprint POSIX 경로 결정성", () => {
  it("sourcePath 는 POSIX 구분자(/) 리터럴 — OS 무관 결정적", async () => {
    const root = await mkdtemp(join(tmpdir(), "hui-fpx-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await mkdir(join(root, ".codex", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "cl.md"), "---\nname: cl\ntools: Read\n---\n");
    await writeFile(join(root, ".codex", "agents", "cx.toml"), 'name = "cx"\ntools = ["Read"]\n');
    const agents = await readAgents(root);
    const cl = agents.find((a) => a.name === "cl")!;
    const cx = agents.find((a) => a.name === "cx")!;
    expect(cl.sourcePath).toBe(".claude/agents/cl.md"); // 백슬래시 없음
    expect(cx.sourcePath).toBe(".codex/agents/cx.toml");
    expect(cl.sourcePath.includes("\\")).toBe(false);
    // 지문은 정규화 경로 입력으로 안정(동일 정의 재도출 시 동일 해시).
    expect(agentFingerprint(cl)).toBe(agentFingerprint((await readAgents(root)).find((a) => a.name === "cl")!));
    await rm(root, { recursive: true, force: true });
  });
});
