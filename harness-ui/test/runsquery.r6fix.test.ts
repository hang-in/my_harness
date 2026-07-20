import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns, listRuns, MAX_RUNS_SCAN } from "../src/server/adapters/runs.js";

// ── M7 F4 R6(agy) 서버 HIGH 3건 회귀 스위트 ──────────────────────────────────────
// agy#1 저렴경로 +1 여유분 → 페이지 경계 중복 / agy#2 safeRunDir 호출당 root·base realpath 재조회
// / agy#3 무인자 listRuns 무바운드 스캔(OOM).
// 제어 플래그(모듈 스코프 — vi.mock 팩토리 호이스팅과 공유).
let fsTimes = new Map<string, { birthtimeMs?: number; mtimeMs?: number }>();
let openedPaths: string[] = [];   // open 대상 경로(read 수행 관측)
let realpathArgs: string[] = [];  // realpath 호출 인자(호출 횟수 관측 — agy#2)

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
    realpath: (async (...args: Parameters<typeof actual.realpath>) => {
      realpathArgs.push(String(args[0]));
      return (actual.realpath as (...a: unknown[]) => unknown)(...args);
    }) as typeof actual.realpath,
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
// status 는 유효/파손 선택. birthtime 은 fsTimes 주입으로 결정화(레이스 제거).
async function addRun(id: string, opts: { status?: string; manifest?: unknown } = {}): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "status.json"), opts.status ?? JSON.stringify(mkStatus(id)));
  if (opts.manifest !== undefined) await writeFile(join(dir, "manifest.json"), JSON.stringify(opts.manifest));
}
const openedStatus = (id: string) =>
  openedPaths.some((p) => p.includes(join("runs", id, "status.json")));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-r6-"));
  fsTimes = new Map();
  openedPaths = [];
  realpathArgs = [];
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

// agy#1 [저렴경로 페이지 경계 중복] — +1 여유분에 낀 quarantine 이 items 로 편입 → 다음 페이지 첫 항목 중복.
describe("R6-1 저렴경로 +1 여유분 제거 — 경계 quarantine 페이지 중복 없음", () => {
  const T = Date.parse("2026-01-01T00:00:00.000Z");
  beforeEach(async () => {
    // desc(최신 우선) 순서 A,B,C,D 가 되도록 birthtime 주입. B 는 status 파손(quarantine).
    fsTimes.set("A", { birthtimeMs: T + 4000 });
    fsTimes.set("B", { birthtimeMs: T + 3000 });
    fsTimes.set("C", { birthtimeMs: T + 2000 });
    fsTimes.set("D", { birthtimeMs: T + 1000 });
    await addRun("A", { manifest: mkManifest("A") });
    await addRun("B", { status: "{corrupt", manifest: mkManifest("B") }); // 경계 quarantine
    await addRun("C", { manifest: mkManifest("C") });
    await addRun("D", { manifest: mkManifest("D") });
  });

  it("페이지1 마지막 항목이 페이지2 첫 항목으로 중복되지 않음·hasMore 정확", async () => {
    const p1 = await queryRuns(root, Q({ limit: "2", offset: "0" })); // 저렴경로(무필터·sort=recordedAt)
    const p2 = await queryRuns(root, Q({ limit: "2", offset: "2" }));
    // slice(0,2)=[A,B(quarantine skip)] → items=[A]. slice(2,4)=[C,D] → items=[C,D]. C 중복 없음.
    expect(p1.items.map((r) => r.runId)).toEqual(["A"]);
    expect(p2.items.map((r) => r.runId)).toEqual(["C", "D"]);
    // 두 페이지 합집합에 중복 runId 부재(구 +1 버그면 C 가 p1·p2 양쪽 출현).
    const ids = [...p1.items, ...p2.items].map((r) => r.runId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("B"); // quarantine 은 드롭(양 페이지 어디에도 없음)
    // total=열거 run dir 수(read 불요·B 포함)·hasMore 는 total 기준.
    expect(p1.total).toBe(4);
    expect(p1.hasMore).toBe(true);   // 0+2 < 4
    expect(p2.hasMore).toBe(false);  // 2+2 = 4
  });
});

// agy#2 [성능] — root/base realpath 를 스캔 루프 바깥 1회로. safeRunDir 호출당 재조회 제거.
describe("R6-2 safeRunDir 선계산 앵커 주입 — root/base realpath 1회", () => {
  beforeEach(async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    for (const id of ["r0", "r1", "r2", "r3", "r4"]) {
      fsTimes.set(id, { birthtimeMs: base + (id.charCodeAt(1) - 48) * 1000 });
      await addRun(id, { manifest: mkManifest(id) });
    }
  });

  it("run 수와 무관하게 realpath(root)·realpath(base) 각 1회(구: run 당 2회 재조회)", async () => {
    realpathArgs = [];
    const res = await queryRuns(root, Q({ limit: "10", offset: "0" })); // 저렴경로 — 5건 전부 read
    expect(res.items).toHaveLength(5);                                   // 정확성 불변
    const base = join(root, "_workspace", "runs");
    // 선계산 앵커: root/base realpath 각 정확히 1회. leaf(run dir) realpath 는 per-run 유지.
    expect(realpathArgs.filter((a) => a === root)).toHaveLength(1);
    expect(realpathArgs.filter((a) => a === base)).toHaveLength(1);
    // leaf realpath 는 read 한 run 수(5)만큼 — per-run containment 검증 불변.
    const leaf = realpathArgs.filter((a) => a.includes(join("runs", "r")));
    expect(leaf.length).toBe(5);
  });

  it("선계산 앵커 주입 경로도 심링크 run dir 거부(R-7 등가·보안 계약 불변)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-evil6-"));
    await writeFile(join(outside, "status.json"), JSON.stringify(mkStatus("evil")));
    await writeFile(join(outside, "manifest.json"), JSON.stringify(mkManifest("evil")));
    const link = join(root, "_workspace", "runs", "linkrun");
    try { await symlink(outside, link, "dir"); } catch { await rm(outside, { recursive: true, force: true }); return; }
    fsTimes.set("linkrun", { birthtimeMs: Date.parse("2030-01-01T00:00:00.000Z") }); // desc 최상단으로 밀어 슬라이스 포함 보장
    const res = await queryRuns(root, Q({ limit: "10", offset: "0" }));
    expect(res.items.map((r) => r.runId)).not.toContain("linkrun"); // 앵커 주입에도 leaf lstat 심링크 거부
    await rm(outside, { recursive: true, force: true });
  });
});

// agy#3 [무바운드 OOM] — 무인자 listRuns 에 MAX_RUNS_SCAN read 상한 이식. {runs} shape 불변.
describe("R6-3 listRuns 스캔 상한(OOM 방어)·{runs} shape 유지", () => {
  it("run dir > MAX_RUNS_SCAN → 상위 N만 status read·{runs} shape·초과분 미read", async () => {
    await mkdir(join(root, "_workspace", "runs"), { recursive: true });
    const base = join(root, "_workspace", "runs");
    const n = MAX_RUNS_SCAN + 3;
    const batch: Promise<unknown>[] = [];
    for (let i = 0; i < n; i++) batch.push(mkdir(join(base, "r" + String(i).padStart(6, "0"))));
    await Promise.all(batch);
    // 데드라인 흔들림 제거 — 시계 고정(read 상한만 관측).
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    openedPaths = [];
    const out = await listRuns(root);
    expect(Array.isArray(out.runs)).toBe(true);          // A47 shape 불변
    expect(out.runs).toHaveLength(MAX_RUNS_SCAN);          // 상한서 중단(전건 아님)
    // status.json open 시도도 MAX_RUNS_SCAN 로 상한(초과분 미read = OOM 실질 방어).
    const statusOpens = openedPaths.filter((p) => p.endsWith("status.json")).length;
    expect(statusOpens).toBeLessThanOrEqual(MAX_RUNS_SCAN);
    // 각 run 레코드는 {runId,status,valid} 형태(빈 dir → status 부재 → valid:false).
    for (const r of out.runs.slice(0, 3)) {
      expect(typeof r.runId).toBe("string");
      expect(typeof r.valid).toBe("boolean");
      expect("status" in r).toBe(true);
    }
  }, 30000);

  it("정상 소량 — 유효/파손 valid 플래그 정확(기존 계약 회귀)", async () => {
    await addRun("good", { manifest: mkManifest("good") });
    await addRun("bad", { status: "{not json" });
    const { runs } = await listRuns(root);
    const byId = Object.fromEntries(runs.map((r) => [r.runId, r]));
    expect(byId["good"]!.valid).toBe(true);
    expect(byId["bad"]!.valid).toBe(false);
    expect(byId["bad"]!.status).toBeNull();
  });
});
