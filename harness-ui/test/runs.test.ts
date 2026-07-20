import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRuns, getRun, readEvents } from "../src/server/adapters/runs.js";

let root: string;
const status = (id: string) => ({
  schemaVersion: "1", runId: id, state: "completed", phase: "done", progress: 100,
  updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00",
  serverPid: 1, serverStartTime: "x", childPid: null, childStartTime: null,
  childProcessGroupId: null, exitCode: 0, exitSignal: null, cancelRequestedAt: null,
  stateReason: null, summary: "ok", error: null,
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-"));
  const wh = join(root, "_workspace", "runs", "run-1");
  await mkdir(wh, { recursive: true });
  await writeFile(join(wh, "status.json"), JSON.stringify(status("run-1")));
  await writeFile(join(wh, "events.jsonl"),
    `{"seq":1,"ts":"2026-07-09T10:00:00+09:00","level":"info","agent":null,"skill":null,"phase":"p","event":"started","message":"m","usage":null}\n` +
    `garbage-line\n` +
    `{"seq":2,"ts":"2026-07-09T10:01:00+09:00","level":"info","agent":"a","skill":null,"phase":"p","event":"done","message":"m","usage":null}\n`);
  // 파손 run
  const bad = join(root, "_workspace", "runs", "run-bad");
  await mkdir(bad, { recursive: true });
  await writeFile(join(bad, "status.json"), "{not json");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("runs reader", () => {
  it("empty project → {runs:[]} (A5be)", async () => {
    const empty = await mkdtemp(join(tmpdir(), "hui-empty-"));
    expect((await listRuns(empty)).runs).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
  it("lists valid + flags invalid run", async () => {
    const { runs } = await listRuns(root);
    const byId = Object.fromEntries(runs.map((r) => [r.runId, r]));
    expect(byId["run-1"]!.valid).toBe(true);
    expect(byId["run-bad"]!.valid).toBe(false);
  });
  it("getRun returns manifest/status split", async () => {
    const r = await getRun(root, "run-1");
    expect(r?.status?.state).toBe("completed");
  });
  it("path traversal runId rejected", async () => {
    expect(await getRun(root, "../etc")).toBeNull();
  });
  it("events skip corrupt line, cursor after exclusive", async () => {
    const r = await readEvents(root, "run-1", 0, 10);
    expect(r.items.map((e) => e.seq)).toEqual([1, 2]);
    expect(r.hasMore).toBe(false);
    expect(r.schemaVersion).toBe("1");
    expect(r.runState).toBe("completed"); // 응답 shape에 runState 포함(§5b)
    const after1 = await readEvents(root, "run-1", 1, 10);
    expect(after1.items.map((e) => e.seq)).toEqual([2]);
  });
  it("seq 0 fetchable with default after=-1 (off-by-one fix)", async () => {
    const wh = join(root, "_workspace", "runs", "run-zero");
    await mkdir(wh, { recursive: true });
    await writeFile(join(wh, "events.jsonl"),
      `{"seq":0,"ts":"2026-07-09T10:00:00+09:00","level":"info","agent":null,"skill":null,"phase":"p","event":"start","message":"m","usage":null}\n`);
    const r = await readEvents(root, "run-zero", -1, 10);
    expect(r.items.map((e) => e.seq)).toEqual([0]);
  });
  it("symlink run dir rejected (no escape)", async () => {
    const { symlink } = await import("node:fs/promises");
    const target = await mkdtemp(join(tmpdir(), "hui-evil-"));
    await writeFile(join(target, "status.json"), JSON.stringify(status("evil")));
    const link = join(root, "_workspace", "runs", "linkrun");
    try { await symlink(target, link, "dir"); } catch { return; } // symlink 불가 환경 skip
    expect(await getRun(root, "linkrun")).toBeNull();
    await rm(target, { recursive: true, force: true });
  });
});
