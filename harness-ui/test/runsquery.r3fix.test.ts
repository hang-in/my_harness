import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns } from "../src/server/adapters/runs.js";

// ── M7 F4 R3 서버 HIGH 5건 회귀 스위트 ──────────────────────────────────────────
// 제어 플래그(모듈 스코프 — vi.mock 팩토리 호이스팅과 공유).
// fsTimes: run 이름별 birthtime/mtime 을 결정적으로 주입(FS birthtime 지원 여부 무관).
let fsTimes = new Map<string, { birthtimeMs?: number; mtimeMs?: number }>();
let openedPaths: string[] = [];   // safeOpen/readJsonCapped 의 open 대상 경로 기록(read 수행 관측)
let failOpendir = false;          // true 면 opendir 이 순회 중 throw 하는 fake Dir 반환
let dirCloseCount = 0;            // fake Dir.close 호출 카운트(agy#3 finally close 관측)

vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const st = await actual.lstat(...args);
      const t = fsTimes.get(basename(String(args[0])));
      if (t) {
        if (t.birthtimeMs !== undefined) (st as { birthtimeMs: number }).birthtimeMs = t.birthtimeMs;
        if (t.mtimeMs !== undefined) (st as { mtimeMs: number }).mtimeMs = t.mtimeMs;
      }
      return st;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      openedPaths.push(String(args[0]));
      return actual.open(...args);
    },
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      if (failOpendir) {
        // opendir 자체는 성공하되 순회(next)에서 throw — 예외 경로서 finally close 보장 검증.
        return {
          [Symbol.asyncIterator]() {
            return { next: async () => { throw new Error("boom-during-iteration"); } };
          },
          close: async () => { dirCloseCount++; },
        } as unknown as Awaited<ReturnType<typeof actual.opendir>>;
      }
      return actual.opendir(...args);
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
// 지연 없이 생성 — birthtime/mtime 은 fsTimes 주입으로 결정화(레이스/FS 의존 제거).
async function addRun(id: string, opts: { manifest?: unknown } = {}): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "status.json"), JSON.stringify(mkStatus(id)));
  if (opts.manifest !== undefined) await writeFile(join(dir, "manifest.json"), JSON.stringify(opts.manifest));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-r3-"));
  fsTimes = new Map();
  openedPaths = [];
  failOpendir = false;
  dirCloseCount = 0;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

// codex#1 [per-entry isMtime] — 혼재 window서 birthtime 후보=recordedAt·mtime 후보=createdAt 기준.
describe("R3-1 per-entry isMtime window 판정(전역 recordedAtSource 오염 제거)", () => {
  const NOW = Date.parse("2026-07-09T12:00:00.000Z"); // b1 의 birthtime(=recordedAt)
  beforeEach(async () => {
    // b1: birthtime 지원(>0) → recordedAt=birthtime(2026-07). createdAt 은 과거(2026-03).
    fsTimes.set("b1", { birthtimeMs: NOW });
    await addRun("b1", { manifest: mkManifest("b1", { createdAt: "2026-03-15T00:00:00.000Z" }) });
    // m1: birthtime 미지원(0) → mtime 경로. createdAt 도 과거(2026-03). mtime 은 임의(now).
    fsTimes.set("m1", { birthtimeMs: 0, mtimeMs: NOW });
    await addRun("m1", { manifest: mkManifest("m1", { createdAt: "2026-03-15T00:00:00.000Z" }) });
  });

  it("과거 window(2026-03): mtime 후보만 createdAt 로 in — birthtime 후보는 recordedAt(2026-07)로 out", async () => {
    const res = await queryRuns(root, Q({ from: "2026-03-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" }));
    expect(res.recordedAtSource).toBe("mtime");      // 전역 요약은 mtime(하나라도 fallback)
    expect(res.items.map((r) => r.runId)).toEqual(["m1"]); // b1 은 recordedAt 기준 → 과거 window 밖(전역 오염이면 오포함)
    expect(res.total).toBe(1);
  });

  it("현재 window(2026-07~): birthtime 후보만 recordedAt 로 in — mtime 후보는 createdAt(2026-03)로 out", async () => {
    const res = await queryRuns(root, Q({ from: "2026-07-01T00:00:00.000Z", to: "2030-01-01T00:00:00.000Z" }));
    expect(res.recordedAtSource).toBe("mtime");
    // b1 recordedAt(2026-07) in / m1 createdAt(2026-03) out. 전역 mtime 판정이면 b1 도 createdAt 로 오탈락.
    expect(res.items.map((r) => r.runId)).toEqual(["b1"]);
    expect(res.total).toBe(1);
  });
});

// codex#2 [조기중단 제거·정확한 total] — in-window 100건·limit 10 → total===100(11 아님).
describe("R3-2 조기중단 제거 → 정확한 total(offset+limit+1 아님)", () => {
  beforeEach(async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const batch: Promise<unknown>[] = [];
    for (let i = 0; i < 100; i++) {
      const id = "run-" + String(i).padStart(3, "0");
      fsTimes.set(id, { birthtimeMs: base + i * 1000 }); // 결정적 distinct birthtime asc
      const dir = join(root, "_workspace", "runs", id);
      batch.push((async () => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "status.json"), JSON.stringify(mkStatus(id)));
        await writeFile(join(dir, "manifest.json"), JSON.stringify(mkManifest(id)));
      })());
    }
    await Promise.all(batch);
  });

  it("window 100건·limit 10 → total=100·items 10·hasMore true(조기중단이면 total=11 이 됨)", async () => {
    const res = await queryRuns(root, Q({
      from: "2025-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z", limit: "10", offset: "0",
    }));
    expect(res.total).toBe(100);          // 정확한 total — offset+limit+1(=11) 조기중단 아님
    expect(res.items).toHaveLength(10);
    expect(res.hasMore).toBe(true);
    expect(res.truncated).toBe(false);    // 100 < MAX_RUNS_SCAN → 캡/데드라인 미도달
    // desc 최신 우선: run-099 부터
    expect(res.items[0]!.runId).toBe("run-099");
  });

  it("깊은 offset slice 정확 — offset 95·limit 10 → 마지막 5건(run-004..run-000)", async () => {
    const res = await queryRuns(root, Q({
      from: "2025-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z", limit: "10", offset: "95",
    }));
    expect(res.total).toBe(100);
    expect(res.items).toHaveLength(5);
    expect(res.hasMore).toBe(false);
    expect(res.items.map((r) => r.runId)).toEqual(["run-004", "run-003", "run-002", "run-001", "run-000"]);
  });
});

// agy#1 [from break — birthtime 경로] — from 하한 밑 birthtime 후보는 read 도달 전 break.
describe("R3-3 birthtime from-break — 하한 밑 run 은 read 미수행(open 카운트 spy)", () => {
  it("from 밑 run 의 status/manifest 는 open 되지 않음(스캔 중단)", async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const ids = ["r0", "r1", "r2", "r3", "r4", "r5"]; // birthtime asc(r0 최古 … r5 최新)
    for (let i = 0; i < ids.length; i++) {
      fsTimes.set(ids[i]!, { birthtimeMs: base + i * 1000 }); // 전부 birthtime(>0) → from-break 조건
      await addRun(ids[i]!, { manifest: mkManifest(ids[i]!) });
    }
    // from = r2 와 r3 birthtime 사이 → in-window = r3,r4,r5. desc 순회서 r2 도달 시 break.
    const from = new Date(base + 2 * 1000 + 500).toISOString();
    openedPaths = [];
    const res = await queryRuns(root, Q({ from }));
    expect(res.items.map((r) => r.runId)).toEqual(["r5", "r4", "r3"]);
    expect(res.total).toBe(3);
    // r3,r4,r5 는 read(open) 됨.
    for (const id of ["r3", "r4", "r5"]) {
      expect(openedPaths.some((p) => p.includes(join("runs", id, "status.json")))).toBe(true);
    }
    // r0,r1,r2 는 break 로 read 미수행 — open 대상에 없음(불필요 read 절약·가짜 limit_reached 방지).
    for (const id of ["r0", "r1", "r2"]) {
      expect(openedPaths.some((p) => p.includes(join("runs", id, "status.json")))).toBe(false);
    }
    expect(res.scanned).toBe(3); // in-window 3건만 스캔
  });

  it("mtime 후보 혼재 시 break 는 금지하되(정확성) birthtime 하한 밑은 read 없이 skip(R4-2)", async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    // b0(birthtime, 최古)·b1(birthtime)·mX(mtime fallback). mtime 후보 존재 → 루프 break 금지(정확성).
    fsTimes.set("b0", { birthtimeMs: base });
    fsTimes.set("b1", { birthtimeMs: base + 2000 });
    fsTimes.set("mX", { birthtimeMs: 0, mtimeMs: base + 1000 });
    await addRun("b0", { manifest: mkManifest("b0", { createdAt: "2026-06-01T00:00:00.000Z" }) });
    await addRun("b1", { manifest: mkManifest("b1", { createdAt: "2026-06-01T00:00:00.000Z" }) });
    await addRun("mX", { manifest: mkManifest("mX", { createdAt: "2026-06-01T00:00:00.000Z" }) });
    const from = new Date(base + 1500).toISOString(); // b0 는 하한 밑(birthtime)
    openedPaths = [];
    const res = await queryRuns(root, Q({ from }));
    expect(res.recordedAtSource).toBe("mtime");
    // R4-2: b0 는 birthtime 하한 밑(eff=recordedAt<from 확정) → break 는 안 하지만 read 없이 continue-skip.
    expect(openedPaths.some((p) => p.includes(join("runs", "b0", "status.json")))).toBe(false);
    // b1(birthtime 하한 위)·mX(mtime, eff=createdAt) 는 read 됨 — 정확성 유지.
    expect(openedPaths.some((p) => p.includes(join("runs", "b1", "status.json")))).toBe(true);
    expect(openedPaths.some((p) => p.includes(join("runs", "mX", "status.json")))).toBe(true);
    expect(res.items.map((r) => r.runId)).toContain("mX"); // createdAt(2026-06) in-window(break 안 해서 도달)
  });
});

// agy#2 [tie-break 방향 일치] — 동일 timestamp 다건서 최신 runId 우선·페이징/방향 일관.
describe("R3-4 동일 timestamp tie-break = runId 방향 일관(최신 우선)", () => {
  beforeEach(async () => {
    const same = Date.parse("2026-05-05T00:00:00.000Z");
    for (const id of ["r-a", "r-b", "r-c"]) {
      fsTimes.set(id, { birthtimeMs: same }); // 동일 birthtime → tie-break=runId
      await addRun(id, { manifest: mkManifest(id) });
    }
  });

  it("desc: runId 내림차순(r-c,r-b,r-a) — 페이징 절단서 최신 runId 유지", async () => {
    const p1 = await queryRuns(root, Q({ order: "desc", limit: "2", offset: "0" }));
    expect(p1.items.map((r) => r.runId)).toEqual(["r-c", "r-b"]);
    expect(p1.total).toBe(3);
    const p2 = await queryRuns(root, Q({ order: "desc", limit: "2", offset: "2" }));
    expect(p2.items.map((r) => r.runId)).toEqual(["r-a"]);
  });

  it("asc: runId 오름차순(r-a,r-b,r-c) — 방향 일관", async () => {
    const res = await queryRuns(root, Q({ order: "asc" }));
    expect(res.items.map((r) => r.runId)).toEqual(["r-a", "r-b", "r-c"]);
  });
});

// agy#3 [opendir finally close] — 순회 예외 시에도 dir 핸들 확정 close.
describe("R3-5 opendir 순회 예외 시 finally close 호출", () => {
  it("순회 중 throw → catch 로 부분결과·finally 에서 dir close 1회", async () => {
    await addRun("x", { manifest: mkManifest("x") }); // 실제 dir 있으나 fake opendir 이 순회 throw
    failOpendir = true;
    const res = await queryRuns(root, Q());
    expect(dirCloseCount).toBe(1);   // 예외 경로서도 핸들 누수 없이 close
    expect(res.items).toEqual([]);   // 열거 실패 → 부분(빈) 결과·throw 전파 아님
    expect(res.schemaVersion).toBe("1");
  });
});
