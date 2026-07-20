import { describe, it, expect } from "vitest";
import {
  isLiveRunState, isTerminalRunState, shouldTail, shouldStopTail,
  nextEventCursor, mergeEventItems, nextTailDelayMs, TAIL_INTERVAL_MS,
  tailDecision, MAX_NONLIVE_TAIL_POLLS, MAX_CONSECUTIVE_DRAINS, DRAIN_MIN_INTERVAL_MS,
} from "../src/web/run-tail.js";

// U2 라이브 tail 순수 로직 — 커서/append/중지 판정(상태머신·shape). TDD 대상.

describe("run 상태 분류 — live vs terminal", () => {
  it("live 상태: running/queued/blocked", () => {
    for (const s of ["running", "queued", "blocked"]) {
      expect(isLiveRunState(s)).toBe(true);
      expect(isTerminalRunState(s)).toBe(false);
      expect(shouldTail(s)).toBe(true);
      expect(shouldStopTail(s)).toBe(false);
    }
  });
  it("terminal 상태: completed/failed/cancelled/stale → 중지", () => {
    for (const s of ["completed", "failed", "cancelled", "stale"]) {
      expect(isTerminalRunState(s)).toBe(true);
      expect(isLiveRunState(s)).toBe(false);
      expect(shouldStopTail(s)).toBe(true);
      expect(shouldTail(s)).toBe(false);
    }
  });
  it("null/미지 상태 → live 아님·terminal 아님(폴링 개시 안 함·중지도 안 함)", () => {
    for (const s of [null, undefined, "weird"]) {
      expect(isLiveRunState(s)).toBe(false);
      expect(isTerminalRunState(s)).toBe(false);
      expect(shouldStopTail(s)).toBe(false);
      expect(shouldTail(s)).toBe(false);
    }
  });
});

describe("nextEventCursor — 단조 증가(역행·정체 방지)", () => {
  it("응답 items 최대 seq / nextAfter / 현재 커서 중 최대", () => {
    expect(nextEventCursor(-1, { items: [{ seq: 0 }, { seq: 1 }, { seq: 2 }], nextAfter: 2 })).toBe(2);
  });
  it("빈 페이지 → 현재 커서 유지(nextAfter=after)", () => {
    expect(nextEventCursor(5, { items: [], nextAfter: 5 })).toBe(5);
  });
  it("nextAfter 가 뒤처져도 items 최대 seq 로 전진", () => {
    expect(nextEventCursor(3, { items: [{ seq: 7 }], nextAfter: 3 })).toBe(7);
  });
  it("이전 커서보다 작은 응답 → 역행하지 않음", () => {
    expect(nextEventCursor(10, { items: [{ seq: 2 }], nextAfter: 2 })).toBe(10);
  });
});

describe("mergeEventItems — append·seq dedup·정렬", () => {
  it("이어붙이기(중복 없음)", () => {
    const prev = [{ seq: 0, event: "a" }, { seq: 1, event: "b" }];
    const inc = [{ seq: 2, event: "c" }];
    expect(mergeEventItems(prev, inc)).toEqual([
      { seq: 0, event: "a" }, { seq: 1, event: "b" }, { seq: 2, event: "c" },
    ]);
  });
  it("seq 중복은 제거(재전송·겹침 방어)", () => {
    const prev = [{ seq: 0, event: "a" }, { seq: 1, event: "b" }];
    const inc = [{ seq: 1, event: "b-dup" }, { seq: 2, event: "c" }];
    const out = mergeEventItems(prev, inc);
    expect(out.map((x) => x.seq)).toEqual([0, 1, 2]);
    expect(out.find((x) => x.seq === 1)!.event).toBe("b"); // 기존 유지
  });
  it("빈 incoming → 동일 참조 반환(불필요 리렌더 방지)", () => {
    const prev = [{ seq: 0, event: "a" }];
    expect(mergeEventItems(prev, [])).toBe(prev);
  });
  it("추가분 없음(전부 중복) → 동일 참조 반환", () => {
    const prev = [{ seq: 0, event: "a" }];
    expect(mergeEventItems(prev, [{ seq: 0, event: "a" }])).toBe(prev);
  });
  it("append-only(seq 순서 incoming) — 뒤에 그대로 이어붙임", () => {
    const out = mergeEventItems([{ seq: 5, event: "e" }], [{ seq: 6, event: "f" }, { seq: 9, event: "i" }]);
    expect(out.map((x) => x.seq)).toEqual([5, 6, 9]);
  });
  it("HIGH#2: 마지막 seq 이하 incoming 은 재전송·겹침으로 드롭(전체 재정렬 안 함)", () => {
    // append-only — 커서 단조·서버 seq 순서 전제. lastSeq(5) 이하(2)는 스킵, 초과(9)만 append.
    const out = mergeEventItems([{ seq: 5, event: "e" }], [{ seq: 2, event: "old" }, { seq: 9, event: "i" }]);
    expect(out.map((x) => x.seq)).toEqual([5, 9]);
  });
  it("HIGH#2: 대량 누적에도 전체 재정렬(sort) 미발생 — 참조/순서 O(k) append", () => {
    const prev = Array.from({ length: 5000 }, (_, i) => ({ seq: i, event: "e" }));
    const inc = [{ seq: 5000, event: "n" }];
    const out = mergeEventItems(prev, inc);
    expect(out.length).toBe(5001);
    expect(out[5000]?.seq).toBe(5000);      // 뒤에 append
    expect(out.slice(0, 5000)).toEqual(prev); // 기존분 순서·값 그대로(재정렬 없음)
  });
});

describe("nextTailDelayMs — backlog 는 (상한 내)즉시, 아니면 주기", () => {
  it("hasMore=true → 0ms(backlog 즉시 drain·무인자 호환)", () => {
    expect(nextTailDelayMs(true)).toBe(0);
    expect(nextTailDelayMs(true, 0)).toBe(0);
  });
  it("hasMore=false → 주기(2~3s)·drainStreak 무관", () => {
    expect(nextTailDelayMs(false)).toBe(TAIL_INTERVAL_MS);
    expect(nextTailDelayMs(false, 999)).toBe(TAIL_INTERVAL_MS);
    expect(TAIL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
    expect(TAIL_INTERVAL_MS).toBeLessThanOrEqual(3000);
  });
  it("HIGH#2: 연속 drain 상한 미만 → 0ms 즉시 drain", () => {
    expect(nextTailDelayMs(true, MAX_CONSECUTIVE_DRAINS - 1)).toBe(0);
  });
  it("HIGH#2: 연속 drain 상한 도달/초과 → 최소 지연으로 전환(타이트 루프 폭주 방지)", () => {
    expect(nextTailDelayMs(true, MAX_CONSECUTIVE_DRAINS)).toBe(DRAIN_MIN_INTERVAL_MS);
    expect(nextTailDelayMs(true, MAX_CONSECUTIVE_DRAINS + 100)).toBe(DRAIN_MIN_INTERVAL_MS);
    expect(DRAIN_MIN_INTERVAL_MS).toBeGreaterThan(0); // 0ms 아님(이벤트 루프 숨통)
  });
});

describe("tailDecision — HIGH#1 dead-tail: null/미확정은 계속 폴링·terminal 만 중지", () => {
  it("live 상태(streak 무관) → continue", () => {
    for (const s of ["running", "queued", "blocked"]) {
      expect(tailDecision(s, 0)).toBe("continue");
      expect(tailDecision(s, MAX_NONLIVE_TAIL_POLLS + 5)).toBe("continue");
    }
  });
  it("첫 응답 runState=null → 폴링 계속(중지 안 함)", () => {
    expect(tailDecision(null, 1)).toBe("continue");
    expect(tailDecision(undefined, 1)).toBe("continue");
    expect(tailDecision("weird", 1)).toBe("continue");
  });
  it("terminal 도달 → 즉시 중지(streak·null 이력 무관)", () => {
    for (const s of ["completed", "failed", "cancelled", "stale"]) {
      expect(tailDecision(s, 0)).toBe("stop-terminal");
      expect(tailDecision(s, MAX_NONLIVE_TAIL_POLLS + 5)).toBe("stop-terminal");
    }
  });
  it("null/미확정 상태가 상한만큼 연속 지속 → 좀비 방지 중지", () => {
    expect(tailDecision(null, MAX_NONLIVE_TAIL_POLLS - 1)).toBe("continue"); // 상한 직전 = 계속
    expect(tailDecision(null, MAX_NONLIVE_TAIL_POLLS)).toBe("stop-nonlive-cap");
    expect(tailDecision(null, MAX_NONLIVE_TAIL_POLLS + 3)).toBe("stop-nonlive-cap");
    expect(MAX_NONLIVE_TAIL_POLLS).toBeGreaterThan(0);
  });
  it("null→running 전이(streak 리셋) → continue(상한 재발 안 함)", () => {
    // 호출부가 live 응답 시 streak=0 으로 리셋하므로 상한이 재적용되지 않음.
    expect(tailDecision("running", 0)).toBe("continue");
  });
});
