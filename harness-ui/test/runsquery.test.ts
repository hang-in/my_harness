import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, open, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns, MAX_JSON_BYTES, MAX_RUNS_SCAN } from "../src/server/adapters/runs.js";

// 파싱된 RunsQuery(기본값 채움) — 어댑터 직접 호출용.
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
// 순차 생성(12ms 지연)으로 birthtime 구분 — 생성 순서 = recordedAt 오름차순. delay=0이면 즉시.
async function addRun(
  id: string,
  opts: { status?: unknown | null; manifest?: unknown | null; delay?: number } = {},
): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  if (opts.status !== null) await writeFile(join(dir, "status.json"), typeof opts.status === "string" ? opts.status : JSON.stringify(opts.status ?? mkStatus(id)));
  if (opts.manifest !== undefined && opts.manifest !== null) await writeFile(join(dir, "manifest.json"), typeof opts.manifest === "string" ? opts.manifest : JSON.stringify(opts.manifest));
  await new Promise((r) => setTimeout(r, opts.delay ?? 12));
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-rq-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

// T-S3 [정렬·페이지·전역정렬] (A51 positive)
describe("T-S3 queryRuns 정렬/페이지/전역정렬", () => {
  it("FS시간 desc 최신 우선(사전식 아님)·tie-break=runId", async () => {
    // 생성 순서: run-10 → run-2 → run-1 (사전식 desc = run-2,run-10,run-1). FS desc = 최신부터 = run-1,run-2,run-10.
    await addRun("run-10", { manifest: mkManifest("run-10") });
    await addRun("run-2", { manifest: mkManifest("run-2") });
    await addRun("run-1", { manifest: mkManifest("run-1") });
    const res = await queryRuns(root, Q());
    expect(res.items.map((r) => r.runId)).toEqual(["run-1", "run-2", "run-10"]);
    expect(res.schemaVersion).toBe("1");
    expect(res.total).toBe(3);
    expect(res.recordedAtSource === "birthtime" || res.recordedAtSource === "mtime").toBe(true);
  });
  it("order=asc 는 desc 역순", async () => {
    await addRun("a", { manifest: mkManifest("a") });
    await addRun("b", { manifest: mkManifest("b") });
    await addRun("c", { manifest: mkManifest("c") });
    const asc = await queryRuns(root, Q({ order: "asc" }));
    expect(asc.items.map((r) => r.runId)).toEqual(["a", "b", "c"]);
  });
  it("전역정렬 후 slice — 페이지 버퍼만 재정렬 금지", async () => {
    for (const id of ["u1", "u2", "u3", "u4"]) await addRun(id, { manifest: mkManifest(id) });
    const full = (await queryRuns(root, Q({ limit: "100" }))).items.map((r) => r.runId);
    const p1 = await queryRuns(root, Q({ limit: "2", offset: "0" }));
    const p2 = await queryRuns(root, Q({ limit: "2", offset: "2" }));
    expect([...p1.items, ...p2.items].map((r) => r.runId)).toEqual(full.slice(0, 4));
    expect(p1.total).toBe(4);
    expect(p1.hasMore).toBe(true);
    expect(p2.hasMore).toBe(false);
    expect(p1.offset).toBe(0);
    expect(p1.limit).toBe(2);
  });
  it("경량레코드 shape — 응답 필드 존재", async () => {
    await addRun("r", { manifest: mkManifest("r", { goal: "build the thing", agent: "builder", requestedBy: "bob" }) });
    const { items } = await queryRuns(root, Q());
    expect(items[0]).toMatchObject({
      runId: "r", runtime: "codex", mode: "build", state: "completed",
      goal: "build the thing", agent: "builder", requestedBy: "bob",
    });
    expect(typeof items[0]!.recordedAt).toBe("string");
    expect(items[0]!.createdAt).toBe("2026-07-09T10:00:00+09:00");
  });
});

// T-S4 [필터·q] (A48/A49 positive)
describe("T-S4 queryRuns 필터/검색", () => {
  it("state·runtime·mode·agent eq 필터", async () => {
    await addRun("r1", { status: mkStatus("r1", { state: "failed" }), manifest: mkManifest("r1", { runtime: "claude", mode: "review", agent: "auditor" }) });
    await addRun("r2", { status: mkStatus("r2", { state: "completed" }), manifest: mkManifest("r2", { runtime: "codex", mode: "build", agent: "builder" }) });
    expect((await queryRuns(root, Q({ state: "failed" }))).items.map((r) => r.runId)).toEqual(["r1"]);
    expect((await queryRuns(root, Q({ runtime: "codex" }))).items.map((r) => r.runId)).toEqual(["r2"]);
    expect((await queryRuns(root, Q({ mode: "review" }))).items.map((r) => r.runId)).toEqual(["r1"]);
    expect((await queryRuns(root, Q({ agent: "builder" }))).items.map((r) => r.runId)).toEqual(["r2"]);
  });
  it("q 대소문자 무시 부분일치(goal/mode/agent/requestedBy)", async () => {
    await addRun("r1", { manifest: mkManifest("r1", { goal: "Refactor Parser" }) });
    await addRun("r2", { manifest: mkManifest("r2", { goal: "unrelated", requestedBy: "Zoe" }) });
    expect((await queryRuns(root, Q({ q: "parser" }))).items.map((r) => r.runId)).toEqual(["r1"]);
    expect((await queryRuns(root, Q({ q: "ZOE" }))).items.map((r) => r.runId)).toEqual(["r2"]);
    expect((await queryRuns(root, Q({ q: "nomatch" }))).total).toBe(0);
  });
  it("from/to 범위(recordedAt FS-time 도메인)", async () => {
    await addRun("old", { manifest: mkManifest("old") });
    await addRun("new", { manifest: mkManifest("new") });
    const all = await queryRuns(root, Q());
    const midMs = (all.items[0]!.recordedAtMs + all.items[1]!.recordedAtMs) / 2;
    const from = new Date(midMs).toISOString();
    const res = await queryRuns(root, Q({ from }));
    // from 이후만 → 최신(new)만
    expect(res.items.map((r) => r.runId)).toEqual(["new"]);
  });
});

// R-1 [ReDoS·q 정규식 주입] (A49 negative)
describe("R-1 q 리터럴 취급(ReDoS 방어)", () => {
  it("정규식 메타 q 는 리터럴 부분일치 — 시간폭발 없음", async () => {
    await addRun("lit", { manifest: mkManifest("lit", { goal: "value=(a+)+ here" }) });
    await addRun("plain", { manifest: mkManifest("plain", { goal: "aaaaaaaaaa" }) });
    // (a+)+ 를 정규식으로 컴파일하면 'aaaa...'에서 폭발. 리터럴이면 '(a+)+' 문자열 포함 run만.
    const t0 = Date.now();
    const res = await queryRuns(root, Q({ q: "(a+)+" }));
    expect(Date.now() - t0).toBeLessThan(1000); // 폭발 없음
    expect(res.items.map((r) => r.runId)).toEqual(["lit"]);
    expect((await queryRuns(root, Q({ q: ".*" }))).total).toBe(0); // 리터럴 '.*' 미포함
    expect((await queryRuns(root, Q({ q: "[a-z]+" }))).total).toBe(0);
  });
  it("정적검사: queryRuns 소스에 new RegExp 부재(주석 제외)", async () => {
    const raw = await readFile(fileURLToPath(new URL("../src/server/adapters/runs.ts", import.meta.url)), "utf8");
    // 주석(//… , /* */) 제거 후 실제 코드에서만 검사(설명 주석의 'new RegExp 금지' 오탐 방지).
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code.includes("new RegExp")).toBe(false);
  });
});

// R-2/R-3/R-4 [RunsQuery 검증 — enum 400 / 경로문자 400 / clamp]
describe("R-2 enum 위반 → RunsQuery reject(400 근거)", () => {
  it("state·runtime·sort 임의문자열 reject", () => {
    expect(RunsQuery.safeParse({ state: "bogus" }).success).toBe(false);
    expect(RunsQuery.safeParse({ runtime: "xxx" }).success).toBe(false);
    expect(RunsQuery.safeParse({ sort: "xxx" }).success).toBe(false);
    expect(RunsQuery.safeParse({ order: "sideways" }).success).toBe(false);
  });
});
describe("R-3 경로문자 agent / 잘못된 날짜 → reject(400 근거)", () => {
  it("agent=../x · from=notdate reject", () => {
    expect(RunsQuery.safeParse({ agent: "../x" }).success).toBe(false);
    expect(RunsQuery.safeParse({ from: "notdate" }).success).toBe(false);
    expect(RunsQuery.safeParse({ to: "2026-13-40" }).success).toBe(false);
  });
});
describe("R-4 offset/limit clamp (400 아님)", () => {
  it("limit 99999→100 · offset -5→0 · limit 0→1 · 비수치→default", () => {
    expect(RunsQuery.parse({ limit: "99999" }).limit).toBe(100);
    expect(RunsQuery.parse({ offset: "-5" }).offset).toBe(0);
    expect(RunsQuery.parse({ limit: "0" }).limit).toBe(1);
    expect(RunsQuery.parse({ limit: "-5" }).limit).toBe(1);
    expect(RunsQuery.parse({ limit: "abc" }).limit).toBe(50); // fallback default
    expect(RunsQuery.parse({ offset: "abc" }).offset).toBe(0);
    expect(RunsQuery.safeParse({ limit: "99999" }).success).toBe(true); // 거부 아님
  });
});

// R-5 [OOM·초과크기 manifest skip] (A50 negative)
describe("R-5 초과크기 manifest skip + readFile 미호출", () => {
  it("> MAX_JSON_BYTES manifest → 해당 run manifest null(status로 최소필드)·전체 실패 아님", async () => {
    await addRun("big", { manifest: mkManifest("big", { goal: "x".repeat(MAX_JSON_BYTES + 5000) }) });
    await addRun("ok", { manifest: mkManifest("ok", { goal: "small goal" }) });
    const res = await queryRuns(root, Q());
    const byId = Object.fromEntries(res.items.map((r) => [r.runId, r]));
    expect(byId["big"]).toBeDefined(); // 전체 실패 아님
    expect(byId["big"]!.goal).toBeNull(); // oversize manifest skip → 필드 null
    expect(byId["big"]!.runtime).toBeNull();
    expect(byId["ok"]!.goal).toBe("small goal");
  });
  it("readJsonCapped 는 전체 readFile 미호출·read 길이 ≤ MAX_JSON_BYTES", async () => {
    await addRun("big", { manifest: mkManifest("big", { goal: "y".repeat(MAX_JSON_BYTES + 5000) }) });
    await addRun("ok", { manifest: mkManifest("ok") });
    const sample = await open(join(root, "_workspace", "runs", "ok", "status.json"), "r");
    const proto = Object.getPrototypeOf(sample);
    await sample.close();
    const readFileSpy = vi.spyOn(proto, "readFile");
    const readSpy = vi.spyOn(proto, "read");
    await queryRuns(root, Q());
    expect(readFileSpy).not.toHaveBeenCalled(); // 전체 read 경로 부재 = OOM 실질 방어
    for (const call of readSpy.mock.calls) {
      const len = call[2]; // read(buffer, offset, length, position)
      if (typeof len === "number") expect(len).toBeLessThanOrEqual(MAX_JSON_BYTES);
    }
  });
});

// R-6 [quarantine — malformed status] (A47/A50 negative)
describe("R-6 quarantine(파손 status)·status만으로 최소필드", () => {
  it("파손 status → valid:false 격리(items 제외·scanned 반영)", async () => {
    await addRun("good", { manifest: mkManifest("good") });
    await addRun("corrupt", { status: "{not json", manifest: mkManifest("corrupt") });
    // R4-3: 정확 in-scan total 은 풀스캔 경로 계약 → 필터(runtime) 부여로 풀스캔 라우팅(무필터 저렴경로 total=열거수).
    const res = await queryRuns(root, Q({ runtime: "codex" }));
    expect(res.items.map((r) => r.runId).sort()).toEqual(["good"]); // corrupt 제외(status 파손 quarantine)
    expect(res.total).toBe(1);   // 풀스캔 in-scan 매칭 수(quarantine 반영)
    expect(res.scanned).toBe(2); // 파손도 스캔 카운트(조용한 0 위장 아님)
  });
  it("manifest 없이 status만 → 최소필드(manifest 필드 null)로 포함", async () => {
    await addRun("nomani", { manifest: null });
    const res = await queryRuns(root, Q());
    const rec = res.items.find((r) => r.runId === "nomani")!;
    expect(rec).toBeDefined();
    expect(rec.state).toBe("completed"); // status 유래
    expect(rec.goal).toBeNull(); // manifest 부재
    expect(rec.runtime).toBeNull();
  });
});

// R-7 [심링크 run dir 거부] (A50 negative)
describe("R-7 심링크 run dir 거부(밖 리다이렉트 차단)", () => {
  it("_workspace/runs 밖으로 심링크된 run dir → 제외", async () => {
    await mkdir(join(root, "_workspace", "runs"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "hui-evil-"));
    await writeFile(join(outside, "status.json"), JSON.stringify(mkStatus("evil")));
    await writeFile(join(outside, "manifest.json"), JSON.stringify(mkManifest("evil")));
    const link = join(root, "_workspace", "runs", "linkrun");
    try { await symlink(outside, link, "dir"); } catch { return; } // symlink 불가 skip
    const res = await queryRuns(root, Q());
    expect(res.items.map((r) => r.runId)).not.toContain("linkrun"); // 심링크 거부
    await rm(outside, { recursive: true, force: true });
  });
});

// R-8 [스캔 바운드·truncated 원인 분리] (A51 negative)
describe("R-8 스캔 바운드·truncatedReason 분리", () => {
  it("run dir > MAX_RUNS_SCAN → truncated·limit_reached·scanned=N", async () => {
    await mkdir(join(root, "_workspace", "runs"), { recursive: true });
    const base = join(root, "_workspace", "runs");
    // MAX_RUNS_SCAN+1 개 빈 디렉토리(이름+stat만 열거·상위 N만 read)
    const n = MAX_RUNS_SCAN + 1;
    const batch: Promise<unknown>[] = [];
    for (let i = 0; i < n; i++) batch.push(mkdir(join(base, "r" + String(i).padStart(6, "0"))));
    await Promise.all(batch);
    // R4-3: MAX_RUNS_SCAN read-cap 은 풀스캔 경로 계약 → 필터(state) 부여로 풀스캔 라우팅.
    //   (무필터 저렴경로는 페이지 슬라이스만 read → read-cap 미도달·이게 R4-3 성능회귀 해소의 요지.)
    const res = await queryRuns(root, Q({ state: "running" }));
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("limit_reached");
    expect(res.scanned).toBe(MAX_RUNS_SCAN); // 전건 read 아님(상한서 중단)
  }, 30000);
  it("SCAN_DEADLINE_MS 초과 → truncated·deadline_exceeded(부분결과)", async () => {
    for (const id of ["d1", "d2", "d3", "d4", "d5"]) await addRun(id, { manifest: mkManifest(id) });
    let n = 0;
    // 매 호출 +700ms 진행 — start 이후 몇 iteration 뒤 deadline(2000) 초과.
    vi.spyOn(Date, "now").mockImplementation(() => (n += 700));
    const res = await queryRuns(root, Q());
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("deadline_exceeded");
    expect(res.scanned).toBeLessThan(5); // 부분 스캔
  });
});

// M3 [readJsonCapped bytesRead 절단 — 축소 레이스서 억울한 quarantine 방지]
describe("M3 readJsonCapped bytesRead 절단", () => {
  it("stat.size 가 실제보다 큰(축소 레이스 모사) 상황서 널바이트 없이 정상 파싱", async () => {
    await addRun("m3", { manifest: mkManifest("m3", { goal: "kept" }) });
    const sample = await open(join(root, "_workspace", "runs", "m3", "status.json"), "r");
    const proto = Object.getPrototypeOf(sample);
    await sample.close();
    const origStat = proto.stat;
    // stat↔read 사이 파일 축소 모사: stat.size 를 실제보다 크게 보고 → 버퍼 tail 널바이트.
    vi.spyOn(proto, "stat").mockImplementation(async function (this: unknown) {
      const st = await origStat.call(this);
      (st as { size: number }).size = st.size + 200;
      return st;
    });
    const res = await queryRuns(root, Q());
    const rec = res.items.find((r) => r.runId === "m3");
    expect(rec).toBeDefined();           // bytesRead 절단으로 억울한 quarantine 아님
    expect(rec!.state).toBe("completed");
    expect(rec!.goal).toBe("kept");
  });
});

// R-ACCEPT [정상 통과] (A51 accept)
describe("R-ACCEPT UUID·run-1/run-10 혼재 FS시간 최신 N 정확", () => {
  it("사전식 아님 — 오탐 없음", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    await addRun("run-10", { manifest: mkManifest("run-10") });
    await addRun(uuid, { manifest: mkManifest(uuid) });
    await addRun("run-1", { manifest: mkManifest("run-1") });
    const res = await queryRuns(root, Q({ limit: "2" }));
    // 최신 2 = 마지막 생성 2개(run-1, uuid) — 사전식이면 run-10 이 앞설 것.
    expect(res.items.map((r) => r.runId)).toEqual(["run-1", uuid]);
    expect(res.total).toBe(3);
    expect(res.hasMore).toBe(true);
  });
});
