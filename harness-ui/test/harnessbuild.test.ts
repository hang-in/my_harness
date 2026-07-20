// C: 하네스 전체 자동 빌드 — draftHarness(mock exec·실 LLM 미호출) + argv 규율 + route.
import { describe, it, expect } from "vitest";
import { draftHarness, buildHarnessArgv, type ExecFn } from "../src/server/lib/builddraft.js";
import { buildServer } from "../src/server/index.js";

const okJson = JSON.stringify({
  orchestrator: { name: "demo-orchestrator", content: "---\nname: demo-orchestrator\ndescription: d\norchestrates: [a1]\n---\n본문" },
  agents: [{ name: "a1", content: "---\nname: a1\ndescription: d\nskills: [s1]\n---\n본문" }],
  skills: [{ name: "s1", content: "---\nname: s1\ndescription: d\n---\n본문" }],
});
const mkExec = (out: string, ok = true, path: string | null = "/bin/claude"): ExecFn =>
  async () => ({ ok, stdout: out, stderr: "", path });

describe("draftHarness", () => {
  it("정상 JSON → 검증된 세트", async () => {
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec(okJson));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.draft.orchestrator.name).toBe("demo-orchestrator"); expect(r.draft.agents[0]!.name).toBe("a1"); }
  });
  it("마크다운 fence 관용", async () => {
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec("```json\n" + okJson + "\n```"));
    expect(r.ok).toBe(true);
  });
  it("깨진 JSON → invalid-json", async () => {
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec("{not json"));
    expect(r).toEqual({ ok: false, error: "invalid-json" });
  });
  it("스키마 위반(orchestrator 누락) → invalid-shape", async () => {
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec(JSON.stringify({ agents: [], skills: [] })));
    expect(r).toEqual({ ok: false, error: "invalid-shape" });
  });
  it("잘못된 name(공백/특수문자) → invalid-shape(초안서 차단·C audit)", async () => {
    const bad = JSON.stringify({ orchestrator: { name: "bad name!", content: "x" }, agents: [], skills: [] });
    expect(await draftHarness({ domain: "d", runtime: "claude" }, mkExec(bad))).toEqual({ ok: false, error: "invalid-shape" });
  });
  it("초안 내 중복 name → invalid-shape(409 중단 방지)", async () => {
    const dup = JSON.stringify({ orchestrator: { name: "x", content: "c" }, agents: [{ name: "x", content: "c" }], skills: [] });
    expect(await draftHarness({ domain: "d", runtime: "claude" }, mkExec(dup))).toEqual({ ok: false, error: "invalid-shape" });
  });
  it("fence 앞 산문 있어도 블록 추출(비앵커)", async () => {
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec("Here is your JSON:\n```json\n" + okJson + "\n```\nThanks"));
    expect(r.ok).toBe(true);
  });
  it("첫 fence가 비JSON(```text)이어도 뒤 ```json 추출(C R2)", async () => {
    const out = "설명:\n```text\n초안 설명\n```\n```json\n" + okJson + "\n```";
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec(out));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.orchestrator.name).toBe("demo-orchestrator");
  });
  it("content 안 markdown 코드펜스(```) 있어도 절단 없이 파싱(C R3 nested-fence)", async () => {
    const nested = JSON.stringify({
      orchestrator: { name: "demo-orchestrator", content: "---\nname: o\n---\n실행:\n```bash\nnpm test\n```\n끝" },
      agents: [{ name: "a1", content: "본문\n```python\nprint(1)\n```" }],
      skills: [{ name: "s1", content: "s" }],
    });
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec("생성된 초안:\n```json\n" + nested + "\n```\n완료"));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.draft.orchestrator.name).toBe("demo-orchestrator"); expect(r.draft.agents[0]!.content).toContain("```python"); }
  });
  it("산문 접두에 중괄호/예시JSON 있어도 실제 초안 채택(C R4 prefix-brace)", async () => {
    const out = '각 항목은 {name, content} 구조입니다. 예: {"x":1}\n\n```json\n' + okJson + "\n```";
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec(out));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.orchestrator.name).toBe("demo-orchestrator");
  });
  it("산문 접두 미완결 중괄호(짝 없는 `{`) 있어도 뒤 초안 채택(C R5 조기종료 방지)", async () => {
    const out = "설정은 `{` 문자로 엽니다. 출력:\n```json\n" + okJson + "\n```";
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec(out));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.orchestrator.name).toBe("demo-orchestrator");
  });
  it("runtime-not-found(path null)", async () => {
    const r = await draftHarness({ domain: "d", runtime: "claude" }, mkExec("", true, null));
    expect(r).toEqual({ ok: false, error: "runtime-not-found" });
  });
  it("argv 규율 — 무도구·plan·safe-mode·shell 없음", () => {
    const { cmd, args } = buildHarnessArgv({ domain: "d", runtime: "claude" });
    expect(cmd).toBe("claude");
    expect(args).toContain("--tools"); expect(args).toContain("plan"); expect(args).toContain("--safe-mode");
    expect(args[args.length - 2]).toBe("--"); // prompt 는 positional(주입 무해)
  });
});

describe("POST /api/context/build/harness-draft (mock exec — 실 LLM 미호출)", () => {
  it("유효 요청 → 200 draft(applied:false) 또는 403(edit 게이트) — 실 claude spawn 없음", async () => {
    const app = buildServer({ projectRoot: process.cwd(), buildExec: mkExec(okJson) });
    const r = await app.inject({ method: "POST", url: "/api/context/build/harness-draft", payload: { domain: "d" } });
    expect([200, 403]).toContain(r.statusCode);
    if (r.statusCode === 200) { const b = r.json(); expect(b.applied).toBe(false); expect(b.draft.orchestrator.name).toBe("demo-orchestrator"); }
  });
  it("초과 필드 body → 400(strict) 또는 403(게이트 우선)", async () => {
    const app = buildServer({ projectRoot: process.cwd(), buildExec: mkExec(okJson) });
    const r = await app.inject({ method: "POST", url: "/api/context/build/harness-draft", payload: { domain: "d", x: 1 } });
    expect([400, 403]).toContain(r.statusCode);
  });
});
