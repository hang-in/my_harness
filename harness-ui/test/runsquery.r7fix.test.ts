import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns, listRuns, MAX_RUNS_SCAN } from "../src/server/adapters/runs.js";

// ── M7 F4 R7 서버 HIGH+MED 회귀 스위트 ──────────────────────────────────────────
// [HIGH·codex] base containment 검증이 열거 이후 → opendir(base) 로 외부 base 열거/stat 발생.
//   수정: opendir 이전에 resolveRunAnchors→isWithinRoot 검증. base 가 root 밖(심링크 탈출)이면
//   외부 디렉토리를 열지 말고 fail-closed(queryRuns scan_error·listRuns {runs:[]}).
// [MED·agy] listRuns 이름 미정렬 절단 → 최신 누락. 수정: read 루프 전 names desc 정렬(best-effort).

// opendir 호출 인자 관측(외부 base 미열거 검증 — HIGH). 통과.
let opendirCalls: string[] = [];
let openedPaths: string[] = [];

vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return {
    ...actual,
    opendir: (async (...args: Parameters<typeof actual.opendir>) => {
      opendirCalls.push(String(args[0]));
      return actual.opendir(...args);
    }) as typeof actual.opendir,
    open: async (...args: Parameters<typeof actual.open>) => {
      openedPaths.push(String(args[0]));
      return actual.open(...args);
    },
  };
});

const Q = (o: Record<string, unknown> = {}) => RunsQuery.parse(o);
const mkStatus = (id: string, over: Record<string, unknown> = {}) => ({
  schemaVersion: "1", runId: id, state: "completed", phase: "done", progress: 100,
  updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00",
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
async function addRunAt(baseDir: string, id: string): Promise<void> {
  const dir = join(baseDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "status.json"), JSON.stringify(mkStatus(id)));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(mkManifest(id)));
}
const baseOf = (r: string) => join(r, "_workspace", "runs");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-r7-"));
  opendirCalls = [];
  openedPaths = [];
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

// ── HIGH: base 심링크 탈출 → opendir(base) 미호출·fail-closed ────────────────────
describe("R7-HIGH base containment 선행 검증 — 외부 base 열거 차단", () => {
  it("(a) base 가 root 밖 심링크 → opendir(base) 미호출·queryRuns scan_error·외부 후보 미반영", async () => {
    // root 밖(별도 tmp) 실디렉토리에 외부 run 2건.
    const outside = await mkdtemp(join(tmpdir(), "hui-r7-out-"));
    await addRunAt(outside, "run-999998");
    await addRunAt(outside, "run-999999");
    await mkdir(join(root, "_workspace"), { recursive: true });
    // _workspace/runs → outside 로 심링크(탈출). 권한 없으면 skip(Windows).
    try { await symlink(outside, baseOf(root), "dir"); }
    catch { await rm(outside, { recursive: true, force: true }); return; }

    opendirCalls = [];
    const res = await queryRuns(root, Q({ limit: "50", offset: "0" }));
    // 외부 base 를 열지 않는다(opendir 인자에 base 경로 부재).
    expect(opendirCalls).not.toContain(baseOf(root));
    // fail-closed: scan_error·외부 후보가 total/hasMore/items 어디에도 미반영.
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("scan_error");
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
    expect(res.hasMore).toBe(false);

    opendirCalls = [];
    const legacy = await listRuns(root);
    expect(opendirCalls).not.toContain(baseOf(root)); // listRuns 도 외부 base 미열거
    expect(legacy).toEqual({ runs: [] });             // fail-closed 레거시 shape

    await rm(outside, { recursive: true, force: true });
  });

  it("(b) base ENOENT(runs 디렉토리 없음) → 빈 정상 결과(truncated:false)", async () => {
    // root 만 존재·runs 디렉토리 없음.
    const res = await queryRuns(root, Q());
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
    expect(res.truncated).toBe(false);
    expect(res.truncatedReason).toBe(null);
    expect(res.hasMore).toBe(false);
    const legacy = await listRuns(root);
    expect(legacy).toEqual({ runs: [] });
  });

  it("(c) 정상 base(root 내포) → 기존대로 동작(회귀)", async () => {
    const base = baseOf(root);
    await addRunAt(base, "run-000001");
    await addRunAt(base, "run-000002");
    const res = await queryRuns(root, Q({ limit: "50", offset: "0" }));
    expect(res.truncated).toBe(false);
    expect(res.total).toBe(2);
    expect(res.items.map((r) => r.runId).sort()).toEqual(["run-000001", "run-000002"]);
    expect(opendirCalls).toContain(base); // 정상 base 는 열거함
    const legacy = await listRuns(root);
    expect(legacy.runs.map((r) => r.runId).sort()).toEqual(["run-000001", "run-000002"]);
    expect(legacy.runs.every((r) => r.valid)).toBe(true);
  });
});

// ── MED: listRuns 이름 desc 정렬 절단(최신 우선) ────────────────────────────────
describe("R7-MED listRuns 대량 dir — 이름 desc 상위 N read(최신 우선)", () => {
  it("run dir > MAX_RUNS_SCAN → 최상위(desc) N read·최하위(오래된)는 미read", async () => {
    const base = baseOf(root);
    await mkdir(base, { recursive: true });
    const n = MAX_RUNS_SCAN + 3; // 1003 — desc 정렬 시 하위 3개(r000000..r000002)는 캡으로 드롭
    const batch: Promise<unknown>[] = [];
    for (let i = 0; i < n; i++) batch.push(mkdir(join(base, "r" + String(i).padStart(6, "0"))));
    await Promise.all(batch);
    // 데드라인 흔들림 제거 — 시계 고정(read 상한만 관측).
    vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    openedPaths = [];
    const out = await listRuns(root);
    expect(out.runs).toHaveLength(MAX_RUNS_SCAN); // 상한서 중단
    const opened = (id: string) => openedPaths.some((p) => p.includes(join("runs", id, "status.json")));
    // 최상위 desc(최신) — 읽힘.
    expect(opened("r001002")).toBe(true);
    expect(opened("r000003")).toBe(true); // desc 상위 1000번째 경계
    // 최하위(오래된) — 캡으로 미read(구 무작위 절단 버그면 랜덤하게 포함될 수 있었음).
    expect(opened("r000000")).toBe(false);
    expect(opened("r000001")).toBe(false);
    expect(opened("r000002")).toBe(false);
    // 반환 runId 도 desc 상위 N(최신 우선) 집합.
    const ids = new Set(out.runs.map((r) => r.runId));
    expect(ids.has("r001002")).toBe(true);
    expect(ids.has("r000000")).toBe(false);
  }, 30000);
});
