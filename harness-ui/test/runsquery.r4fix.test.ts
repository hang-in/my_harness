import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns } from "../src/server/adapters/runs.js";

// ── M7 F4 R4 서버 HIGH 3건 회귀 스위트 ──────────────────────────────────────────
// R4-1 부분결과 은폐(opendir 순회 예외 → scan_error) / R4-2 birthtime 하한 밑 read 낭비 /
// R4-3 무필터 페이지네이션 저렴경로(페이지 슬라이스만 read).
// 제어 플래그(모듈 스코프 — vi.mock 팩토리 호이스팅과 공유).
let fsTimes = new Map<string, { birthtimeMs?: number; mtimeMs?: number }>();
let openedPaths: string[] = [];        // open 대상 경로(read 수행 관측)
let failYieldNames: string[] | null = null; // 설정 시 opendir 이 이 이름들만 yield 후 순회 throw
let dirCloseCount = 0;

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
      if (failYieldNames !== null) {
        const names = failYieldNames;
        // N개 실제 엔트리를 yield 한 뒤 순회 예외 → 부분결과 경로 검증(R4-1).
        return {
          async *[Symbol.asyncIterator]() {
            for (const nm of names) yield { name: nm, isDirectory: () => true } as unknown as Dirent;
            throw new Error("boom-after-partial");
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
async function addRun(id: string, opts: { manifest?: unknown } = {}): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "status.json"), JSON.stringify(mkStatus(id)));
  if (opts.manifest !== undefined) await writeFile(join(dir, "manifest.json"), JSON.stringify(opts.manifest));
}
const openedStatus = (id: string) =>
  openedPaths.some((p) => p.includes(join("runs", id, "status.json")));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-r4-"));
  fsTimes = new Map();
  openedPaths = [];
  failYieldNames = null;
  dirCloseCount = 0;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

// codex#1 [부분결과 은폐] — opendir 순회 예외 시 truncated:true·reason:"scan_error"·부분 total.
describe("R4-1 opendir 순회 예외 → scan_error(부분결과 정직 노출)", () => {
  it("N개 열거 후 throw → total 부분값·truncated:true·reason:scan_error", async () => {
    for (const id of ["r0", "r1", "r2", "r3", "r4"]) await addRun(id, { manifest: mkManifest(id) });
    failYieldNames = ["r0", "r1", "r2"]; // 5건 중 3건만 열거 후 순회 throw
    const res = await queryRuns(root, Q());
    expect(res.total).toBe(3);                         // 열거된 부분값(5 아님)
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("scan_error");    // union 확장 — false·null 위장 아님
    expect(res.items.map((r) => r.runId).sort()).toEqual(["r0", "r1", "r2"]);
    expect(dirCloseCount).toBe(1);                     // 예외 경로서도 dir 핸들 확정 close
  });

  it("필터 있는 풀스캔 경로도 순회 예외 → scan_error 노출", async () => {
    for (const id of ["r0", "r1", "r2", "r3"]) await addRun(id, { manifest: mkManifest(id) });
    failYieldNames = ["r0", "r1"];
    const res = await queryRuns(root, Q({ state: "completed" })); // 풀스캔 경로
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("scan_error");
    expect(res.total).toBe(2); // in-scan 매칭(부분 열거분)
  });
});

// agy#1 [I/O 낭비] — mtime 혼재로 break 못 해도 birthtime 하한 밑은 read 없이 skip.
describe("R4-2 birthtime 하한 밑 엔트리 read 미수행(mtime 혼재)", () => {
  it("break 불가(mtime 혼재)여도 birthtime<from 엔트리는 open/read 미호출", async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    // b0..b2 birthtime(하한 밑), b3..b5 birthtime(하한 위), mX 는 mtime fallback(break 봉쇄).
    fsTimes.set("b0", { birthtimeMs: base });
    fsTimes.set("b1", { birthtimeMs: base + 1000 });
    fsTimes.set("b2", { birthtimeMs: base + 2000 });
    fsTimes.set("b3", { birthtimeMs: base + 6000 });
    fsTimes.set("b4", { birthtimeMs: base + 7000 });
    fsTimes.set("b5", { birthtimeMs: base + 8000 });
    fsTimes.set("mX", { birthtimeMs: 0, mtimeMs: base + 9000 }); // mtime → usedMtime=true → canBreakFrom=false
    for (const id of ["b0", "b1", "b2", "b3", "b4", "b5"]) {
      await addRun(id, { manifest: mkManifest(id, { createdAt: "2026-01-01T00:00:00.000Z" }) });
    }
    await addRun("mX", { manifest: mkManifest("mX", { createdAt: "2026-08-01T00:00:00.000Z" }) }); // createdAt in-window
    const from = new Date(base + 5000).toISOString(); // b0,b1,b2 하한 밑
    openedPaths = [];
    const res = await queryRuns(root, Q({ from }));
    expect(res.recordedAtSource).toBe("mtime");
    // b0,b1,b2: birthtime<from → readJsonCapped 이전 skip(open 미호출).
    for (const id of ["b0", "b1", "b2"]) expect(openedStatus(id)).toBe(false);
    // b3,b4,b5: birthtime 하한 위 → read. mX: mtime(eff=createdAt) → read(정확성).
    for (const id of ["b3", "b4", "b5", "mX"]) expect(openedStatus(id)).toBe(true);
    // 결과: 하한 위 birthtime 3건 + mX(createdAt in-window). b0~b2 는 range 밖.
    expect(res.items.map((r) => r.runId).sort()).toEqual(["b3", "b4", "b5", "mX"]);
  });
});

// agy#2 [성능 회귀] — 무필터 단순 페이지네이션은 페이지 슬라이스만 read(전건 read 아님).
describe("R4-3 무필터 저렴경로 = 페이지 슬라이스만 read", () => {
  const N = 25;
  beforeEach(async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const batch: Promise<unknown>[] = [];
    for (let i = 0; i < N; i++) {
      const id = "run-" + String(i).padStart(3, "0");
      fsTimes.set(id, { birthtimeMs: base + i * 1000 }); // distinct birthtime asc → desc = run-024 먼저
      const dir = join(root, "_workspace", "runs", id);
      batch.push((async () => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "status.json"), JSON.stringify(mkStatus(id)));
        await writeFile(join(dir, "manifest.json"), JSON.stringify(mkManifest(id)));
      })());
    }
    await Promise.all(batch);
  });

  it("(a) 무필터 첫 페이지 → 슬라이스(limit)만 read·total=열거수·나머지 dir 미open", async () => {
    openedPaths = [];
    const res = await queryRuns(root, Q({ limit: "10", offset: "0" }));
    expect(res.total).toBe(N);            // 열거 run dir 수(정확·read 불요)
    expect(res.items).toHaveLength(10);
    expect(res.hasMore).toBe(true);
    expect(res.truncated).toBe(false);
    expect(res.items[0]!.runId).toBe("run-024"); // desc 최신 우선
    // agy#1: +1 여유분 제거 → 정확히 10건(limit)만 status.json open. run-014(idx10)은 다음 페이지 몫.
    const opened = Array.from({ length: N }, (_, i) => "run-" + String(i).padStart(3, "0"))
      .filter((id) => openedStatus(id));
    expect(opened.length).toBeLessThanOrEqual(10);
    for (const id of ["run-024", "run-023", "run-016", "run-015"]) expect(openedStatus(id)).toBe(true);
    for (const id of ["run-014", "run-013", "run-005", "run-000"]) expect(openedStatus(id)).toBe(false);
  });

  it("(b) 필터(state) 있으면 풀스캔 — 정확 in-scan total·깊은 dir 도 read", async () => {
    openedPaths = [];
    const res = await queryRuns(root, Q({ state: "completed", limit: "10", offset: "0" }));
    expect(res.total).toBe(N);   // 전건 매칭(정확 in-scan total)
    expect(res.items).toHaveLength(10);
    // 풀스캔이므로 페이지 밖(깊은) run 도 read 됨.
    expect(openedStatus("run-000")).toBe(true);
    expect(openedStatus("run-013")).toBe(true);
  });

  it("(c) 무필터 깊은 offset 페이지도 슬라이스만 read", async () => {
    openedPaths = [];
    const res = await queryRuns(root, Q({ limit: "5", offset: "15" }));
    expect(res.total).toBe(N);
    expect(res.items).toHaveLength(5);
    expect(res.hasMore).toBe(true); // 15+5=20 < 25
    // agy#1: desc index15..19 = run-009..run-005(5건=limit)만 open. run-004(idx20·구 +1분)는 미open.
    for (const id of ["run-009", "run-005"]) expect(openedStatus(id)).toBe(true);
    for (const id of ["run-024", "run-010", "run-004", "run-003", "run-000"]) expect(openedStatus(id)).toBe(false);
    // 페이지 내용 = run-009..run-005(desc).
    expect(res.items.map((r) => r.runId)).toEqual(["run-009", "run-008", "run-007", "run-006", "run-005"]);
  });

  it("(d) 무필터 order=asc 도 슬라이스만 read·방향 일관", async () => {
    openedPaths = [];
    const res = await queryRuns(root, Q({ order: "asc", limit: "3", offset: "0" }));
    expect(res.total).toBe(N);
    expect(res.items.map((r) => r.runId)).toEqual(["run-000", "run-001", "run-002"]); // asc 최古 우선
    expect(openedStatus("run-024")).toBe(false); // 최신은 asc 페이지 밖 → 미open
  });
});
