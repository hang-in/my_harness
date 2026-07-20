import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { overview, agents } from "../src/server/adapters/metrics.js";
import { streamRunEvents, SCAN_DEADLINE_MS, MAX_EVENT_LINES_PER_RUN } from "../src/server/adapters/runs.js";
import type { Event } from "../src/server/schemas.js";

// M9 F6 외부감사 R1 — 서버 HIGH 2건 회귀 스위트.
//   HIGH#1(codex·과대표시): 집계값(totalTokens·agents[].tokens)은 모든 기여분에 usage 가 있을 때만 measured.
//                            부분 커버리지 → unattributed·value null 강등(부분성은 coverage.measuredRatio 노출).
//   HIGH#2(agy·DoS): scan()·streamRunEvents 데드라인/라인캡 → 대량/파손 이벤트에서 무한루프 없이 정직한 부분 집계.

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
const ev = (o: Partial<Event> & { seq: number }): string => JSON.stringify({
  ts: "2026-07-09T10:00:00+09:00", level: "info", agent: null, skill: null,
  phase: "p", event: "x", message: "m", usage: null, ...o,
});

let root: string;
async function addRun(id: string, opts: { status?: unknown; manifest?: unknown; events?: string } = {}): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "status.json"), typeof opts.status === "string" ? opts.status : JSON.stringify(opts.status ?? mkStatus(id)));
  if (opts.manifest !== undefined) await writeFile(join(dir, "manifest.json"), typeof opts.manifest === "string" ? opts.manifest : JSON.stringify(opts.manifest));
  else await writeFile(join(dir, "manifest.json"), JSON.stringify(mkManifest(id)));
  if (opts.events !== undefined) await writeFile(join(dir, "events.jsonl"), opts.events);
  await new Promise((r) => setTimeout(r, 6));
}

const USAGE_RUN = [
  ev({ seq: 0, event: "run_started" }),
  ev({ seq: 1, agent: "builder", usage: { inputTokens: 1000, outputTokens: 500 } }),
  ev({ seq: 2, agent: "builder", usage: { outputTokens: 300 } }),
].join("\n");
const NO_USAGE_RUN = [
  ev({ seq: 0, event: "run_started" }),
  ev({ seq: 1, agent: "builder", usage: null }),
].join("\n");

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-r1-")); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("HIGH#1 과대표시 — 부분 usage 커버리지 → measured 오표시 금지(강등)", () => {
  it("run3 중 2개만 usage → totalTokens unattributed·value null·measuredRatio 2/3(measured 아님)", async () => {
    await addRun("u1", { events: USAGE_RUN });
    await addRun("u2", { events: USAGE_RUN });
    await addRun("n1", { events: NO_USAGE_RUN }); // usage 없는 run
    const ov = await overview(root);
    expect(ov.coverage.aggregatedRuns).toBe(3);
    expect(ov.coverage.usageRuns).toBe(2);
    expect(ov.coverage.measuredRatio).toBeCloseTo(2 / 3, 10); // 부분성 정직 노출
    // 부분 커버리지 → measured 승격 금지. 부분합을 정확값처럼 노출하지 않음.
    expect(ov.totalTokens.confidence).toBe("unattributed");
    expect(ov.totalTokens.value).toBeNull();
  });

  it("전 집계 run 에 usage 존재 → totalTokens measured(합산 실측)·measuredRatio 1", async () => {
    await addRun("u1", { events: USAGE_RUN });
    await addRun("u2", { events: USAGE_RUN });
    const ov = await overview(root);
    expect(ov.coverage.usageRuns).toBe(2);
    expect(ov.coverage.measuredRatio).toBe(1);
    expect(ov.totalTokens.confidence).toBe("measured");
    expect(ov.totalTokens.value).toBe((1000 + 500 + 300) * 2); // 3600
  });

  it("usage 전무 → totalTokens unattributed·value null·measuredRatio 0", async () => {
    await addRun("n1", { events: NO_USAGE_RUN });
    const ov = await overview(root);
    expect(ov.coverage.usageRuns).toBe(0);
    expect(ov.coverage.measuredRatio).toBe(0);
    expect(ov.totalTokens.confidence).toBe("unattributed");
    expect(ov.totalTokens.value).toBeNull();
  });

  it("agents[].tokens: codex 부분 usage(event 일부만) → unattributed 강등 · 전부 usage → measured", async () => {
    const events = [
      ev({ seq: 0, event: "run_started" }),
      ev({ seq: 1, agent: "partial", usage: { inputTokens: 100 } }), // usage 有
      ev({ seq: 2, agent: "partial", usage: null }),                  // usage 無 → 부분 커버리지
      ev({ seq: 3, agent: "full", usage: { inputTokens: 50 } }),
      ev({ seq: 4, agent: "full", usage: { outputTokens: 70 } }),     // full 은 전부 usage
    ].join("\n");
    await addRun("codex1", { manifest: mkManifest("codex1", { runtime: "codex" }), events });
    const ag = await agents(root);
    const partial = ag.agents.find((a) => a.agent === "partial")!;
    const full = ag.agents.find((a) => a.agent === "full")!;
    // partial: invocations 2 중 usageInvocations 1 → 부분합 measured 오표시 금지
    expect(partial.invocations).toBe(2);
    expect(partial.tokens.confidence).toBe("unattributed");
    expect(partial.tokens.value).toBeNull();
    // full: 모든 기여 event 에 usage → measured
    expect(full.tokens.confidence).toBe("measured");
    expect(full.tokens.value).toBe(120);
  });
});

describe("HIGH#2 DoS — streamRunEvents 데드라인·라인캡 바운드", () => {
  it("deadlineAt 과거 → 즉시 중단(onEvent 미호출)·reason deadline_exceeded", async () => {
    const dir = join(root, "_workspace", "runs", "d1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), USAGE_RUN);
    let calls = 0;
    const res = await streamRunEvents(dir, () => { calls++; }, { deadlineAt: Date.now() - 1 });
    expect(res.truncated).toBe(true);
    expect(res.reason).toBe("deadline_exceeded");
    expect(calls).toBe(0);
  });

  it("파손 라인 폭주(유효 event 0·라인캡 초과) → 무한루프 아님·바운드 종료·reason limit_reached", async () => {
    const dir = join(root, "_workspace", "runs", "flood");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), "x\n".repeat(500)); // 전부 비-JSON(파손) 라인
    let calls = 0;
    const res = await streamRunEvents(dir, () => { calls++; }, { maxLines: 100 });
    expect(calls).toBe(0);            // 유효 event 0
    expect(res.truncated).toBe(true); // count 미증가에도 무한루프 없이 종료
    expect(res.reason).toBe("limit_reached");
  });

  it("정상 이벤트는 라인캡 여유 내에서 전부 방출(오탐 절단 없음)", async () => {
    const dir = join(root, "_workspace", "runs", "ok");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), USAGE_RUN);
    let calls = 0;
    const res = await streamRunEvents(dir, () => { calls++; }, {});
    expect(calls).toBe(3);        // 유효 event 3건(run_started + builder 2건) 전부 방출
    expect(res.truncated).toBe(false);
    expect(res.reason).toBeNull();
  });
});

describe("HIGH#2 DoS — scan 데드라인/라인캡이 커버리지에 정직 반영", () => {
  it("이벤트 라인 폭주(> MAX_EVENT_LINES_PER_RUN) → coverage truncated·limit_reached(부분 집계)", async () => {
    // 파손 라인 라인캡 초과 → streamRunEvents limit_reached → scan 이 커버리지로 정직 노출.
    await addRun("bigflood", { events: "x\n".repeat(MAX_EVENT_LINES_PER_RUN + 5) });
    const ov = await overview(root);
    expect(ov.coverage.truncated).toBe(true);
    // 정직 truncation 이 핵심 — 느린 러너(Windows CI)는 라인캡 전 scan 데드라인 선도달 가능. 둘 다 정직 부분집계.
    expect(["limit_reached", "deadline_exceeded"]).toContain(ov.coverage.truncatedReason);
    expect(ov.runCount).toBe(1); // status 유효 → 집계 편입(부분)
  });

  it("빠른 시계(데드라인 초과) → coverage truncated·deadline_exceeded(안전 부분 집계·크래시 아님)", async () => {
    for (let i = 0; i < 6; i++) await addRun(`run-${i}`);
    // Date.now 를 호출마다 데드라인 폭 이상 전진 → 데드라인 방어가 즉시 발동.
    const real = Date.now.bind(Date);
    const base = real();
    let n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => base + (n++) * (SCAN_DEADLINE_MS + 1000));
    const ov = await overview(root);
    expect(ov.coverage.truncated).toBe(true);
    expect(ov.coverage.truncatedReason).toBe("deadline_exceeded"); // 정직한 부분 집계
  });
});
