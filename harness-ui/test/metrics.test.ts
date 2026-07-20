import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { overview, agents, skills } from "../src/server/adapters/metrics.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures", "cli-usage");

const mkStatus = (id: string, over: Record<string, unknown> = {}) => ({
  schemaVersion: "1", runId: id, state: "completed", phase: "done", progress: 100,
  updatedAt: "2026-07-09T10:01:00+09:00", heartbeatAt: "2026-07-09T10:01:00+09:00",
  serverPid: 1, serverStartTime: "x", childPid: null, childStartTime: null,
  childProcessGroupId: null, exitCode: 0, exitSignal: null, cancelRequestedAt: null,
  stateReason: null, summary: "ok", error: null, ...over,
});
const mkManifest = (id: string, over: Record<string, unknown> = {}) => ({
  schemaVersion: "1", runId: id, projectRoot: "/x", runtime: "codex", mode: "build",
  createdAt: "2026-07-09T10:00:00+09:00", requestedBy: "alice", goal: "do stuff",
  agents: [], agent: null, targets: [], permissionMode: "read-only", model: "default", supervisorVersion: "1", ...over,
});

let root: string;
async function addRun(id: string, opts: {
  status?: unknown | null; manifest?: unknown | null; events?: string | null; delay?: number;
} = {}): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  if (opts.status !== null) await writeFile(join(dir, "status.json"), typeof opts.status === "string" ? opts.status : JSON.stringify(opts.status ?? mkStatus(id)));
  if (opts.manifest !== undefined && opts.manifest !== null) await writeFile(join(dir, "manifest.json"), typeof opts.manifest === "string" ? opts.manifest : JSON.stringify(opts.manifest));
  if (opts.events) await writeFile(join(dir, "events.jsonl"), opts.events);
  await new Promise((r) => setTimeout(r, opts.delay ?? 6));
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-metrics-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("AS1 회귀 — usage 有→measured / 無→unattributed (DoD 필수)", () => {
  it("usage 有 픽스처 → run 총량 measured(합산 실측)", async () => {
    const events = await readFile(join(FIX, "with-usage.events.jsonl"), "utf8");
    await addRun("r-usage", { manifest: mkManifest("r-usage", { runtime: "codex" }), events });
    const ov = await overview(root);
    expect(ov.totalTokens.confidence).toBe("measured");
    // 1200+800+5000 + 3400+2600 + 900+300 + 100 = 14300
    expect(ov.totalTokens.value).toBe(14300);
    expect(ov.coverage.usageRuns).toBe(1);
    expect(ov.coverage.measuredRatio).toBe(1);
  });

  it("usage 無 픽스처 → 동일 지표 unattributed 강등(measured 미승격·0 위장 없음)", async () => {
    const events = await readFile(join(FIX, "no-usage.events.jsonl"), "utf8");
    await addRun("r-nousage", { manifest: mkManifest("r-nousage", { runtime: "codex" }), events });
    const ov = await overview(root);
    expect(ov.totalTokens.confidence).toBe("unattributed"); // 승격 절대 금지
    expect(ov.totalTokens.value).toBeNull();                 // 0 위장 없음(null)
    expect(ov.coverage.usageRuns).toBe(0);
    expect(ov.coverage.measuredRatio).toBe(0);
  });
});

describe("per-value confidence — measured/estimated/unattributed 공존(단일 confidence 금지)", () => {
  it("codex agent+usage=measured · claude 팀 agent=estimated · skill=estimated", async () => {
    const withUsage = await readFile(join(FIX, "with-usage.events.jsonl"), "utf8");
    // codex run: builder/reviewer usage → measured
    await addRun("r-codex", { manifest: mkManifest("r-codex", { runtime: "codex" }), events: withUsage });
    // claude run: 동일 agent 가 claude 기여 → estimated(상한)
    await addRun("r-claude", { manifest: mkManifest("r-claude", { runtime: "claude" }), events: withUsage });

    const ag = await agents(root);
    const builder = ag.agents.find((a) => a.agent === "builder")!;
    expect(builder).toBeTruthy();
    // builder 가 claude run 에도 등장 → 상한 estimated(measured 거부·AS2)
    expect(builder.tokens.confidence).toBe("estimated");
    expect(builder.tokens.value).toBeGreaterThan(0);
    expect(builder.invocations).toBeGreaterThan(0);

    const sk = await skills(root);
    const erl = sk.skills.find((s) => s.skill === "external-review-loop")!;
    expect(erl).toBeTruthy();
    expect(erl.tokens.confidence).toBe("estimated"); // skill 은 measured 절대 불가
    expect(erl.invocations).toBe(2);
  });

  it("codex 단독 agent(claude 기여 없음)+usage → measured", async () => {
    const withUsage = await readFile(join(FIX, "with-usage.events.jsonl"), "utf8");
    await addRun("r-codex-only", { manifest: mkManifest("r-codex-only", { runtime: "codex" }), events: withUsage });
    const ag = await agents(root);
    const reviewer = ag.agents.find((a) => a.agent === "reviewer")!;
    expect(reviewer.tokens.confidence).toBe("measured");
    expect(reviewer.tokens.value).toBe(1200); // 900+300
  });

  it("skill usage 부재 → unattributed(measured/estimated 아님·0 위장 없음)", async () => {
    const noUsage = await readFile(join(FIX, "no-usage.events.jsonl"), "utf8");
    await addRun("r-nou", { manifest: mkManifest("r-nou", { runtime: "codex" }), events: noUsage });
    const sk = await skills(root);
    const erl = sk.skills.find((s) => s.skill === "external-review-loop")!;
    expect(erl.tokens.confidence).toBe("unattributed");
    expect(erl.tokens.value).toBeNull();
    expect(erl.invocations).toBe(1); // 호출 카운트는 measured(관측)
  });
});

describe("overview 효과성 지표", () => {
  it("성공/실패율 measured · 평균소요 measured · rework/review estimated", async () => {
    await addRun("ok1", { manifest: mkManifest("ok1"), status: mkStatus("ok1", { state: "completed" }) });
    await addRun("f1", { manifest: mkManifest("f1"), status: mkStatus("f1", { state: "failed" }),
      events: `{"seq":0,"ts":"2026-07-09T10:00:00+09:00","level":"info","agent":null,"skill":null,"phase":"p","event":"retry_attempt","message":"retry","usage":null}\n` });
    const ov = await overview(root);
    expect(ov.runCount).toBe(2);
    expect(ov.succeeded).toBe(1);
    expect(ov.failed).toBe(1);
    expect(ov.successRate.confidence).toBe("measured");
    expect(ov.successRate.value).toBe(0.5);
    expect(ov.failureRate.value).toBe(0.5);
    expect(ov.avgDurationMs.confidence).toBe("measured");
    expect(ov.avgDurationMs.value).toBe(60000); // 10:00:00 → 10:01:00
    expect(ov.reworkRate.confidence).toBe("estimated");
    expect(ov.reworkRate.value).toBe(0.5); // 1/2 runs had rework event
    expect(ov.reviewConvergence.confidence).toBe("estimated");
  });
});

describe("마이그레이션 — 구 events/구 run 안전 처리(throw/500 금지)", () => {
  it("구 events(agent/skill/usage=null) → null 파싱·집계 제외·throw 아님", async () => {
    const legacy = `{"seq":0,"ts":"2026-07-09T10:00:00+09:00","level":"info","agent":null,"skill":null,"phase":"p","event":"x","message":"m","usage":null}\n`;
    await addRun("legacy", { manifest: mkManifest("legacy"), events: legacy });
    const ov = await overview(root);
    expect(ov.runCount).toBe(1);
    expect(ov.totalTokens.confidence).toBe("unattributed"); // usage 전무
    const ag = await agents(root);
    expect(ag.agents).toEqual([]); // agent=null → 귀속 없음
  });
  it("손상 status → quarantine(집계 제외·조용한 0 위장 아님·에러 아님)", async () => {
    await addRun("good", { manifest: mkManifest("good") });
    await addRun("bad", { status: "{not json", manifest: mkManifest("bad") });
    const ov = await overview(root);
    expect(ov.runCount).toBe(1);           // bad 는 aggregatedRuns 에서 제외
    expect(ov.coverage.scannedRuns).toBe(2); // 스캔은 2건(정직)
    expect(ov.coverage.aggregatedRuns).toBe(1);
  });
});

describe("커버리지 메타 + 안전 빈 응답", () => {
  it("빈/디렉토리없음 → 안전 빈 응답(에러 아님·A5be)", async () => {
    const empty = await mkdtemp(join(tmpdir(), "hui-empty-"));
    const ov = await overview(empty);
    expect(ov.runCount).toBe(0);
    expect(ov.totalTokens.confidence).toBe("unattributed");
    expect(ov.coverage.aggregatedRuns).toBe(0);
    expect(ov.coverage.truncated).toBe(false);
    expect((await agents(empty)).agents).toEqual([]);
    expect((await skills(empty)).skills).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
  it("커버리지 window/truncatedReason 노출", async () => {
    await addRun("w1", { manifest: mkManifest("w1") });
    const ov = await overview(root);
    expect(typeof ov.coverage.windowNewestMs).toBe("number");
    expect(typeof ov.coverage.windowOldestMs).toBe("number");
    expect(ov.coverage.truncatedReason === null || typeof ov.coverage.truncatedReason === "string").toBe(true);
    expect(ov.coverage.recordedAtSource === "birthtime" || ov.coverage.recordedAtSource === "mtime").toBe(true);
  });
});

describe("보안 — 심링크 run 디렉토리 거부(공용 경화 리더 상속)", () => {
  it("symlink run dir → 집계 제외(경로탈출 거부)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-outside-"));
    await writeFile(join(outside, "status.json"), JSON.stringify(mkStatus("evil")));
    const runsBase = join(root, "_workspace", "runs");
    await mkdir(runsBase, { recursive: true });
    await symlink(outside, join(runsBase, "evil"), "dir").catch(() => {});
    await addRun("legit", { manifest: mkManifest("legit") });
    const ov = await overview(root);
    // symlink run 은 safeRunDir 에서 거부 → legit 만 집계
    expect(ov.runCount).toBe(1);
    await rm(outside, { recursive: true, force: true });
  });
});
