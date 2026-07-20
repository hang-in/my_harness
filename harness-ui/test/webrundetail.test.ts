import { describe, it, expect } from "vitest";
import { runEventRows } from "../src/web/screens.js";

// M7 회귀: RunDetail 이 /api/runs/:runId/events 서버 계약(readEvents)을 올바로 소비하는지 고정.
// 서버 반환 shape = { items: Array<{seq, event, message, ...}>, nextAfter, hasMore, runState, schemaVersion }.
// 과거 버그: 클라가 { events: [{seq, type, message}] } 로 가정 → e.events undefined 로 상세 패널 크래시, x.type 미표시.
describe("W/M7 RunDetail events — 서버 계약 { items, event } shape 소비(shape 회귀 방지)", () => {
  const sample = {
    items: [
      { seq: 0, ts: "2026-07-09T00:00:00Z", level: "info", agent: null, skill: null, phase: "init", event: "run.started", message: "시작", usage: null },
      { seq: 1, ts: "2026-07-09T00:00:01Z", level: "info", agent: "builder", skill: null, phase: "work", event: "agent.spawned", message: "빌더 기동", usage: null },
    ],
    nextAfter: 1,
    hasMore: false,
    runState: "running",
    schemaVersion: "1",
  };

  it("items 배열을 소비하고 event 필드를 표시 행으로 매핑(구 events/type 아님)", () => {
    const rows = runEventRows(sample);
    expect(rows).toEqual([
      { seq: 0, event: "run.started", message: "시작" },
      { seq: 1, event: "agent.spawned", message: "빌더 기동" },
    ]);
  });

  it("빈 items → 빈 행(크래시 없이)", () => {
    expect(runEventRows({ items: [] })).toEqual([]);
  });

  it("message 누락 → 빈 문자열 fallback", () => {
    const rows = runEventRows({ items: [{ seq: 5, event: "note" }] });
    expect(rows[0]).toEqual({ seq: 5, event: "note", message: "" });
  });

  it("최근 30건만 표시(꼬리 슬라이스)", () => {
    const many = { items: Array.from({ length: 40 }, (_, i) => ({ seq: i, event: `e${i}`, message: "" })) };
    const rows = runEventRows(many);
    expect(rows.length).toBe(30);
    expect(rows[0]!.seq).toBe(10);
    expect(rows[29]!.seq).toBe(39);
  });
});
