// M7 F4 R8(agy) 서버 HIGH 2건 회귀 — runs.ts 공유 read 레이어 OOM 방어.
//   agy#1: getRun/currentRunState/readRunAgents 잔여 readJsonSafe(무바운드 readFile) → readJsonCapped(크기상한).
//   agy#2: readEvents readLines() 무한 누적 → 고정 청크 커스텀 리더(과대 라인 drain).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRun, readEvents, readRunAgents, MAX_JSON_BYTES } from "../src/server/adapters/runs.js";

let root: string;
const status = (id: string) => ({
  schemaVersion: "1", runId: id, state: "completed", phase: "done", progress: 100,
  updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00",
  serverPid: 1, serverStartTime: "x", childPid: null, childStartTime: null,
  childProcessGroupId: null, exitCode: 0, exitSignal: null, cancelRequestedAt: null,
  stateReason: null, summary: "ok", error: null,
});
const ev = (seq: number) =>
  `{"seq":${seq},"ts":"2026-07-09T10:00:00+09:00","level":"info","agent":null,"skill":null,"phase":"p","event":"e","message":"m","usage":null}`;

// FileHandle 프로토타입 공유 → 전체 readFile 호출 여부를 전역 spy 로 관측(OOM 근원).
async function fileHandleProto() {
  const probe = await mkdtemp(join(tmpdir(), "hui-probe-"));
  const f = join(probe, "x");
  await writeFile(f, "x");
  const h = await open(f, "r");
  const proto = Object.getPrototypeOf(h);
  await h.close();
  await rm(probe, { recursive: true, force: true });
  return proto;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-oom-"));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("agy#1 readJsonSafe 잔여 경로 → readJsonCapped(OOM)", () => {
  it("getRun: 초과 status/manifest 는 전체 readFile 미호출·null+error fallback", async () => {
    const dir = join(root, "_workspace", "runs", "getrun-big");
    await mkdir(dir, { recursive: true });
    const big = "x".repeat(MAX_JSON_BYTES + 4096);
    await writeFile(join(dir, "status.json"), JSON.stringify({ pad: big }));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ pad: big }));

    const proto = await fileHandleProto();
    const readFileSpy = vi.spyOn(proto, "readFile");
    try {
      const r = await getRun(root, "getrun-big");
      expect(r).not.toBeNull();
      expect(r!.status).toBeNull();
      expect(r!.manifest).toBeNull();
      expect(r!.statusError).toBeTypeOf("string");   // 오류 대신 안전 error 문자열(계약 유지)
      expect(r!.manifestError).toBeTypeOf("string");
      expect(readFileSpy).not.toHaveBeenCalled();     // 전체 readFile 미호출(크기상한서 skip)
    } finally { readFileSpy.mockRestore(); }
  });

  it("readRunAgents: 초과 agent json skip·전체 readFile 미호출", async () => {
    const dir = join(root, "_workspace", "runs", "agents-big");
    const adir = join(dir, "agents");
    await mkdir(adir, { recursive: true });
    const big = "x".repeat(MAX_JSON_BYTES + 4096);
    await writeFile(join(adir, "a.json"), JSON.stringify({ pad: big }));

    const proto = await fileHandleProto();
    const readFileSpy = vi.spyOn(proto, "readFile");
    try {
      const r = await readRunAgents(root, "agents-big");
      expect(r.agents).toEqual([]);                   // 초과 = quarantine(오류 아님)
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally { readFileSpy.mockRestore(); }
  });

  it("currentRunState(readEvents 경유): 초과 status → runState null·이벤트는 정상 파싱", async () => {
    const dir = join(root, "_workspace", "runs", "cur-big");
    await mkdir(dir, { recursive: true });
    const big = "x".repeat(MAX_JSON_BYTES + 4096);
    await writeFile(join(dir, "status.json"), JSON.stringify({ pad: big }));
    await writeFile(join(dir, "events.jsonl"), ev(1) + "\n" + ev(2) + "\n");

    const proto = await fileHandleProto();
    const readFileSpy = vi.spyOn(proto, "readFile");
    try {
      const r = await readEvents(root, "cur-big", -1, 10);
      expect(r.runState).toBeNull();                  // 초과 status → 오류 대신 null
      expect(r.items.map((e) => e.seq)).toEqual([1, 2]);
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally { readFileSpy.mockRestore(); }
  });
});

describe("agy#2 readEvents 과대 라인 drain(OOM)", () => {
  it("개행 없는 과대 블록(>MAX_LINE) skip·이후 정상 라인 파싱 지속", async () => {
    const dir = join(root, "_workspace", "runs", "ev-oversize");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify(status("ev-oversize")));
    // 첫 라인: 개행 없이 512KB(>256KB MAX_LINE) 블록 → OOM 없이 skip. 이후 정상 라인.
    const oversize = "z".repeat(512 * 1024);
    await writeFile(join(dir, "events.jsonl"), oversize + "\n" + ev(1) + "\n" + ev(2) + "\n");
    const r = await readEvents(root, "ev-oversize", -1, 10);
    expect(r.items.map((e) => e.seq)).toEqual([1, 2]); // 과대 라인 뒤 정상 라인 정확 반환
    expect(r.runState).toBe("completed");
  });

  it("과대 라인이 청크 경계 다수를 가로질러도 후속 정상 라인 무손실", async () => {
    const dir = join(root, "_workspace", "runs", "ev-mid");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify(status("ev-mid")));
    const oversize = "y".repeat(1024 * 1024); // 1MB(청크 다수)
    await writeFile(join(dir, "events.jsonl"),
      ev(1) + "\n" + oversize + "\n" + ev(2) + "\n" + ev(3) + "\n");
    const r = await readEvents(root, "ev-mid", -1, 10);
    expect(r.items.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("페이지네이션(after/limit) 계약 불변", async () => {
    const dir = join(root, "_workspace", "runs", "ev-page");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify(status("ev-page")));
    await writeFile(join(dir, "events.jsonl"),
      [ev(0), ev(1), ev(2), ev(3), ev(4)].join("\n") + "\n");
    const p1 = await readEvents(root, "ev-page", -1, 2);
    expect(p1.items.map((e) => e.seq)).toEqual([0, 1]);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextAfter).toBe(1);
    const p2 = await readEvents(root, "ev-page", p1.nextAfter, 2);
    expect(p2.items.map((e) => e.seq)).toEqual([2, 3]);
    expect(p2.hasMore).toBe(true);
  });

  it("멀티바이트 UTF-8(청크 경계 분할) 손실 없이 파싱", async () => {
    const dir = join(root, "_workspace", "runs", "ev-utf8");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify(status("ev-utf8")));
    const msg = "한글메시지".repeat(20000); // 청크(64KB) 경계에 멀티바이트 걸치도록
    const line = JSON.stringify({
      seq: 7, ts: "2026-07-09T10:00:00+09:00", level: "info", agent: null,
      skill: null, phase: "p", event: "e", message: msg, usage: null,
    });
    // 위 라인은 MAX_LINE(256KB)보다 작아야 kept — 한글 char 길이 기준
    await writeFile(join(dir, "events.jsonl"), line + "\n");
    const r = await readEvents(root, "ev-utf8", -1, 10);
    expect(r.items.length).toBe(1);
    expect(r.items[0]!.message).toBe(msg);
  });
});
