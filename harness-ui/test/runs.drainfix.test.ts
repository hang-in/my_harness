// M9 F6 외부감사 R2(agy) 서버 HIGH 1건 회귀 — readCappedLines 과대 라인 drain DoS 우회.
//   결함: MAX_LINE 초과 무개행 과대 라인 drain 중 yield 가 전혀 없어 호출자(streamRunEvents/readEvents)의
//        데드라인/라인캡 검사가 실행 안 됨 → 수백MB 무개행 단일 블록이면 내부 for(;;) 가 통제 불능 블로킹(DoS).
//   수정: readCappedLines(h, deadlineAt) — drain 루프서 매 청크 후 데드라인·MAX_DRAIN_BYTES 검사 →
//        초과 시 LineReaderAbort throw. streamRunEvents 는 reason 으로, readEvents 는 안전 fallback 으로 반영.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamRunEvents, readEvents, MAX_DRAIN_BYTES } from "../src/server/adapters/runs.js";

let root: string;
// (b) 종료 여유: pre-drop 누적(≈MAX_LINE)+drain 64KB 청크 오버슈트 정도만 상한 초과 허용(무한 아님 증명).
const READ_LEEWAY = 4 * 1024 * 1024;
const status = (id: string) => ({
  schemaVersion: "1", runId: id, state: "completed", phase: "done", progress: 100,
  updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00",
  serverPid: 1, serverStartTime: "x", childPid: null, childStartTime: null,
  childProcessGroupId: null, exitCode: 0, exitSignal: null, cancelRequestedAt: null,
  stateReason: null, summary: "ok", error: null,
});
const ev = (seq: number) =>
  `{"seq":${seq},"ts":"2026-07-09T10:00:00+09:00","level":"info","agent":null,"skill":null,"phase":"p","event":"e","message":"m","usage":null}`;

// FileHandle 프로토타입 확보 → read 를 spy 로 대체(수백MB 무개행 스트림을 디스크 없이 모킹).
async function fileHandleProto() {
  const probe = await mkdtemp(join(tmpdir(), "hui-drain-probe-"));
  const f = join(probe, "x");
  await writeFile(f, "x");
  const h = await open(f, "r");
  const proto = Object.getPrototypeOf(h);
  await h.close();
  await rm(probe, { recursive: true, force: true });
  return proto;
}

beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "hui-drain-")); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("R2 HIGH — 과대 무개행 라인 drain 데드라인/바이트캡(DoS 우회 차단)", () => {
  it("(a) 무한 무개행 스트림 + 임박 deadlineAt → drain 이 데드라인서 조기 종료(무한 아님)·deadline_exceeded", async () => {
    // events.jsonl 존재만 필요(safeOpen 통과). 실제 read 는 spy 가 개행 없는 대량 청크를 무한 공급.
    const dir = join(root, "_workspace", "runs", "drain-deadline");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), "seed");

    const proto = await fileHandleProto();
    let reads = 0;
    const readSpy = vi.spyOn(proto, "read").mockImplementation(async (...args: unknown[]) => {
      const buffer = args[0] as Buffer;
      reads++;
      buffer.fill(0x7a); // 'z' — 개행 전무(무한 과대 라인 시뮬레이션)
      return { bytesRead: buffer.length, buffer };
    });
    try {
      const t0 = Date.now();
      // deadlineAt 과거 → drain 진입 즉시(첫 drain 청크) abort. 무한 루프면 이 await 가 반환되지 않음.
      const res = await streamRunEvents(dir, () => {}, { deadlineAt: Date.now() - 1 });
      expect(res.truncated).toBe(true);
      expect(res.reason).toBe("deadline_exceeded");
      expect(Date.now() - t0).toBeLessThan(2000);          // 통제 불능 블로킹 아님
      // MAX_LINE 진입(≈5청크) + 첫 drain 청크에서 abort → read 호출이 유한(무한 아님)·소량.
      expect(reads).toBeLessThan(64);
    } finally { readSpy.mockRestore(); }
  });

  it("(b) 무개행 스트림 + deadlineAt 미주입 → MAX_DRAIN_BYTES 초과 시 강제 종료·limit_reached", async () => {
    const dir = join(root, "_workspace", "runs", "drain-bytes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), "seed");

    const proto = await fileHandleProto();
    let drained = 0;
    const readSpy = vi.spyOn(proto, "read").mockImplementation(async (...args: unknown[]) => {
      const buffer = args[0] as Buffer;
      drained += buffer.length;
      buffer.fill(0x7a); // 'z' — 개행 전무
      return { bytesRead: buffer.length, buffer };
    });
    try {
      // deadlineAt 없음 → 오직 MAX_DRAIN_BYTES 백스톱이 종료를 보장해야 함(무한 아님).
      const res = await streamRunEvents(dir, () => {}, {});
      expect(res.truncated).toBe(true);
      expect(res.reason).toBe("limit_reached");
      // MAX_DRAIN_BYTES 근처에서 종료(약간의 청크 여유). 무한이면 이 상한을 크게 초과.
      expect(drained).toBeGreaterThan(MAX_DRAIN_BYTES);
      expect(drained).toBeLessThan(MAX_DRAIN_BYTES + READ_LEEWAY);
    } finally { readSpy.mockRestore(); }
  });

  it("(c-i) readEvents: 무한 무개행 스트림도 요청 데드라인 백스톱으로 종료(무한 블로킹 아님)", async () => {
    const dir = join(root, "_workspace", "runs", "drain-readevents");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify(status("drain-readevents")));
    await writeFile(join(dir, "events.jsonl"), "seed");

    const proto = await fileHandleProto();
    const readSpy = vi.spyOn(proto, "read").mockImplementation(async (...args: unknown[]) => {
      const buffer = args[0] as Buffer;
      buffer.fill(0x7a);
      return { bytesRead: buffer.length, buffer };
    });
    try {
      const t0 = Date.now();
      // readEvents 는 응답 shape 불변(truncated 필드 없음) — abort 를 안전 fallback 으로 흡수, 수집분 반환.
      const r = await readEvents(root, "drain-readevents", -1, 10);
      expect(r.items).toEqual([]);                 // 과대 라인만 있음 → 유효 event 0
      expect(r.schemaVersion).toBe("1");           // 응답 shape 불변
      expect(Date.now() - t0).toBeLessThan(5000);  // MAX_DRAIN_BYTES 백스톱으로 종료(무한 아님)
    } finally { readSpy.mockRestore(); }
  });

  it("(c-ii) 회귀: 개행 없는 과대 블록 뒤 정상 라인 무손실(drain 조기종료가 정상 파싱 훼손 안 함)", async () => {
    const dir = join(root, "_workspace", "runs", "drain-regress");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify(status("drain-regress")));
    // 512KB(>256KB MAX_LINE) 무개행 블록 → drain(디스크 실경로, 백스톱 미도달) → 이후 정상 라인.
    const oversize = "z".repeat(512 * 1024);
    await writeFile(join(dir, "events.jsonl"), oversize + "\n" + ev(1) + "\n" + ev(2) + "\n");
    const r = await readEvents(root, "drain-regress", -1, 10);
    expect(r.items.map((e) => e.seq)).toEqual([1, 2]); // 과대 라인 skip 후 정상 라인 정확 반환
    expect(r.runState).toBe("completed");
  });

  it("(c-iii) 회귀: 정상 이벤트 전건은 streamRunEvents 가 truncated 없이 전부 방출", async () => {
    const dir = join(root, "_workspace", "runs", "drain-ok");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), ev(0) + "\n" + ev(1) + "\n" + ev(2) + "\n");
    let calls = 0;
    const res = await streamRunEvents(dir, () => { calls++; }, { deadlineAt: Date.now() + 5000 });
    expect(calls).toBe(3);
    expect(res.truncated).toBe(false);
    expect(res.reason).toBeNull();
  });
});
