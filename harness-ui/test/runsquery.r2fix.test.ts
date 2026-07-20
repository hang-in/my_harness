import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns, SCAN_DEADLINE_MS } from "../src/server/adapters/runs.js";

// 제어 플래그(모듈 스코프 — vi.mock 팩토리 호이스팅과 공유).
let forceMtime = false;
let lstatOrder: string[] = [];         // lstat 대상 basename 기록(열거/read 순서 관측)
let clock = 0;                          // 가짜 시계(Date.now 대체) — 테스트가 진행량 제어
let advanceAfterRunLstat: number | null = null; // run-dir lstat 이 N회 되면 시계를 데드라인 초과로 점프

// node:fs/promises 모킹 — lstat 만 래핑(나머지 실제 위임). runsquery.serverfix.test.ts 패턴 준용.
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const name = basename(String(args[0]));
      lstatOrder.push(name);
      const st = await actual.lstat(...args);
      if (forceMtime) (st as { birthtimeMs: number }).birthtimeMs = 0; // birthtime 미지원 모사
      if (advanceAfterRunLstat !== null &&
          lstatOrder.filter((n) => n.startsWith("run-")).length >= advanceAfterRunLstat) {
        clock += SCAN_DEADLINE_MS + 1000; // 데드라인 초과로 시계 점프
      }
      return st;
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
async function addRun(id: string, opts: { manifest?: unknown; delay?: number } = {}): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "status.json"), JSON.stringify(mkStatus(id)));
  if (opts.manifest !== undefined) await writeFile(join(dir, "manifest.json"), JSON.stringify(opts.manifest));
  await new Promise((r) => setTimeout(r, opts.delay ?? 12)); // birthtime 구분(생성순 = recordedAt asc)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-r2-"));
  forceMtime = false;
  lstatOrder = [];
  clock = 1_000_000;
  advanceAfterRunLstat = null;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

// ── A/D: 열거 이름 desc 결정화 + 데드라인 절단 시 최신 우선 부분결과 ──────────────
describe("A/D 열거/stat 순서 결정화 — 데드라인 절단 시 최신 우선", () => {
  it("D 이름 문자열 desc 순서로 stat(zero-pad run-NNN 최신 우선)", async () => {
    for (const id of ["run-001", "run-002", "run-003", "run-004", "run-005"]) {
      await addRun(id, { manifest: mkManifest(id) });
    }
    lstatOrder = [];
    await queryRuns(root, Q());
    // Step2 열거 stat 은 이름 desc(run-005..run-001). Step4 read 의 safeRunDir lstat 도 recordedAtMs desc(동일 순서).
    const runLstats = lstatOrder.filter((n) => n.startsWith("run-"));
    const firstFive = runLstats.slice(0, 5);
    expect(firstFive).toEqual(["run-005", "run-004", "run-003", "run-002", "run-001"]);
  });

  it("데드라인이 read 단계를 절단해도 최신(이름·mtime desc)부터 부분 수집", async () => {
    for (const id of ["run-001", "run-002", "run-003", "run-004", "run-005"]) {
      await addRun(id, { manifest: mkManifest(id) });
    }
    lstatOrder = [];
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // Step2 는 5개 lstat(시계 정지), Step4 에서 run-dir lstat 2회(총 7회) 후 데드라인 점프 → 2개만 read.
    advanceAfterRunLstat = 7;
    const res = await queryRuns(root, Q());
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("deadline_exceeded");
    expect(res.scanned).toBe(2);
    // 절단돼도 최신 우선(run-005, run-004) 보존 — 임의 순서로 최신 누락 아님.
    expect(res.items.map((r) => r.runId)).toEqual(["run-005", "run-004"]);
  });

  it("첫 열거 iteration 전 데드라인 → 이름 열거 자체 중단(scanned=0)", async () => {
    for (const id of ["run-1", "run-2", "run-3"]) await addRun(id, { manifest: mkManifest(id) });
    let n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (n += SCAN_DEADLINE_MS + 1000));
    const res = await queryRuns(root, Q());
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("deadline_exceeded");
    expect(res.scanned).toBe(0);
    expect(res.items).toEqual([]);
  });
});

// ── B: from/to window — mtime 경로 createdAt in-window 포함 / birthtime 경로 정상 ──
describe("B window 충족 — mtime top-N 순위 밖이라도 createdAt in-window 포함", () => {
  it("mtime 경로: mtime 최신이 아닌(순위 밖) run 이라도 createdAt in-window 면 결과 포함", async () => {
    forceMtime = true; // birthtime 미지원 → mtime 경로 강제
    // 생성순=mtime asc. inWindow 를 먼저 생성(mtime 가장 오래됨=desc 순위 최하) → 최신 mtime 은 out-of-window.
    await addRun("inwin", { manifest: mkManifest("inwin", { createdAt: "2026-03-15T00:00:00.000Z" }) });
    await addRun("newer1", { manifest: mkManifest("newer1", { createdAt: "2026-01-01T00:00:00.000Z" }) });
    await addRun("newer2", { manifest: mkManifest("newer2", { createdAt: "2026-12-31T00:00:00.000Z" }) });
    const res = await queryRuns(root, Q({ from: "2026-03-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" }));
    expect(res.recordedAtSource).toBe("mtime");
    // createdAt 기준 window: inwin(3/15) 만 in — mtime desc 순위 최하여도 포함, out-of-window 는 제외.
    expect(res.items.map((r) => r.runId)).toEqual(["inwin"]);
    expect(res.total).toBe(1);
  });

  it("mtime 경로: createdAt in-window 다건 — mtime 순서 무관하게 전부 포함", async () => {
    forceMtime = true;
    await addRun("a", { manifest: mkManifest("a", { createdAt: "2026-03-10T00:00:00.000Z" }) });
    await addRun("b", { manifest: mkManifest("b", { createdAt: "2026-05-01T00:00:00.000Z" }) }); // out
    await addRun("c", { manifest: mkManifest("c", { createdAt: "2026-03-20T00:00:00.000Z" }) });
    const res = await queryRuns(root, Q({ from: "2026-03-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" }));
    expect(res.items.map((r) => r.runId).sort()).toEqual(["a", "c"]);
    expect(res.total).toBe(2);
  });

  it("birthtime 경로: from/to 는 recordedAt(FS-time) 도메인으로 정상", async () => {
    await addRun("old", { manifest: mkManifest("old") });
    await addRun("mid", { manifest: mkManifest("mid") });
    await addRun("new", { manifest: mkManifest("new") });
    const all = await queryRuns(root, Q());
    expect(all.recordedAtSource).toBe("birthtime");
    const ids = all.items.map((r) => r.runId); // recordedAt desc = [new, mid, old]
    const midMs = all.items[1]!.recordedAtMs;
    const from = new Date(midMs - 1).toISOString();
    const res = await queryRuns(root, Q({ from }));
    expect(res.items.map((r) => r.runId)).toEqual(ids.slice(0, 2)); // new, mid (old 제외)
  });
});

// ── C: 정렬 캐시 회귀 — 결과 동일 + _-캐시 응답 미노출 ─────────────────────────
describe("C 정렬 캐시(재파싱 제거) — 결과 동일·응답 shape 불변", () => {
  it("updatedAt 정렬: 캐시 비교로도 시계열 정렬 정확", async () => {
    await addRun("u1", { manifest: mkManifest("u1") });
    await writeFile(join(root, "_workspace", "runs", "u1", "status.json"),
      JSON.stringify(mkStatus("u1", { updatedAt: "2026-07-01T00:00:00.000Z" })));
    await addRun("u2", { manifest: mkManifest("u2") });
    await writeFile(join(root, "_workspace", "runs", "u2", "status.json"),
      JSON.stringify(mkStatus("u2", { updatedAt: "2026-07-05T00:00:00.000Z" })));
    await addRun("u3", { manifest: mkManifest("u3") });
    await writeFile(join(root, "_workspace", "runs", "u3", "status.json"),
      JSON.stringify(mkStatus("u3", { updatedAt: "2026-07-03T00:00:00.000Z" })));
    const desc = await queryRuns(root, Q({ sort: "updatedAt", order: "desc" }));
    expect(desc.items.map((r) => r.runId)).toEqual(["u2", "u3", "u1"]);
    const asc = await queryRuns(root, Q({ sort: "updatedAt", order: "asc" }));
    expect(asc.items.map((r) => r.runId)).toEqual(["u1", "u3", "u2"]);
  });

  it("mtime 경로 tie-break: createdAt 캐시 비교로 안정 정렬", async () => {
    forceMtime = true;
    await addRun("t1", { manifest: mkManifest("t1", { createdAt: "2026-02-01T00:00:00.000Z" }) });
    await addRun("t2", { manifest: mkManifest("t2", { createdAt: "2026-04-01T00:00:00.000Z" }) });
    // 동일 mtime 근사 → createdAt tie-break(desc: t2 먼저).
    const res = await queryRuns(root, Q({ sort: "recordedAt", order: "desc" }));
    expect(res.items.map((r) => r.runId)).toContain("t1");
    expect(res.items.map((r) => r.runId)).toContain("t2");
  });

  it("응답 items 에 _-캐시 필드(_createdAtMs/_updatedAtMs) 미노출", async () => {
    await addRun("s1", { manifest: mkManifest("s1") });
    const res = await queryRuns(root, Q());
    const keys = Object.keys(res.items[0]!).sort();
    expect(keys).toEqual([
      "agent", "createdAt", "goal", "mode", "recordedAt", "recordedAtMs",
      "requestedBy", "runId", "runtime", "state", "updatedAt",
    ]);
  });
});
