import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns, SCAN_DEADLINE_MS } from "../src/server/adapters/runs.js";

// 제어 플래그: lstat 호출 카운트(H1) + birthtime 강제 0으로 mtime 경로 강제(H2).
let lstatCount = 0;
let forceMtime = false;

// node:fs/promises 모킹 — lstat 만 래핑, 나머지는 실제 위임(readdir/realpath/open/mkdir/writeFile/…).
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      lstatCount++;
      const st = await actual.lstat(...args);
      if (forceMtime) (st as { birthtimeMs: number }).birthtimeMs = 0; // birthtime 미지원(fallback) 모사
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
async function addRun(id: string, opts: { manifest?: unknown } = {}): Promise<void> {
  const dir = join(root, "_workspace", "runs", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "status.json"), JSON.stringify(mkStatus(id)));
  if (opts.manifest !== undefined) await writeFile(join(dir, "manifest.json"), JSON.stringify(opts.manifest));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-rqfix-"));
  lstatCount = 0;
  forceMtime = false;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

// H1 [DoS] Step2 열거 루프 데드라인 — 대량 dir stat 우회 차단.
describe("H1 Step2 열거 루프 데드라인 준수", () => {
  it("첫 열거 iteration 전 데드라인 초과 → dir lstat 미수행·deadline_exceeded", async () => {
    for (const id of ["e1", "e2", "e3", "e4", "e5"]) await addRun(id, { manifest: mkManifest(id) });
    lstatCount = 0; // setup 이후 리셋(addRun 은 lstat 미사용이지만 방어적)
    let n = 0;
    // start 1회 + 첫 iteration 검사에서 즉시 데드라인 초과.
    vi.spyOn(Date, "now").mockImplementation(() => (n += SCAN_DEADLINE_MS + 1000));
    const res = await queryRuns(root, Q());
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("deadline_exceeded");
    // Step2 가 데드라인을 준수하면 dir 별 lstat 을 한 건도 수행하지 않음(구버전은 전 dir lstat).
    expect(lstatCount).toBe(0);
    expect(res.scanned).toBe(0);
    expect(res.items).toEqual([]);
  });
});

// H2 [논리버그] mtime coarse to-필터 조기탈락 → Step5 createdAt 정밀판정으로 미룸.
describe("H2 mtime 경로 to-필터 조기탈락 보류", () => {
  it("createdAt 는 [from,to] 내이나 mtime 이 to 밖인 run 을 결과에 포함", async () => {
    forceMtime = true; // birthtime 미지원 경로 강제
    await addRun("mrun", { manifest: mkManifest("mrun", { createdAt: "2026-01-01T00:00:00.000Z" }) });
    // dir mtime = 현재(2026-07) → to(2026-01-02) 밖. createdAt(2026-01-01) 은 [from,to] 내.
    const res = await queryRuns(root, Q({ from: "2025-12-31T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" }));
    expect(res.recordedAtSource).toBe("mtime");
    expect(res.items.map((r) => r.runId)).toContain("mrun"); // Step5 createdAt 정밀판정으로 구제
  });
});
