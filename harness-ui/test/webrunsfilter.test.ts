import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTER, DEFAULT_LIMIT, buildQuery, parseQuery, setField, clearField, clearAll,
  activeChips, hasActiveFilter, toggleOrder, pageTo, truncationNotice, pageRange,
  nextOffset, prevOffset,
  type RunsFilter,
} from "../src/web/runs-filter.js";

describe("W1/W2 buildQuery — 정렬/order/limit/offset 항상 첨부(인자 분기 강제)", () => {
  it("빈 필터도 sort/order/limit/offset 포함 → 무인자 오분기 방지", () => {
    const p = new URLSearchParams(buildQuery(EMPTY_FILTER));
    expect(p.get("sort")).toBe("recordedAt");
    expect(p.get("order")).toBe("desc");
    expect(p.get("limit")).toBe(String(DEFAULT_LIMIT));
    expect(p.get("offset")).toBe("0");
    expect(p.has("state")).toBe(false);
  });
  it("설정된 필터만 첨부(빈 문자열 제외)", () => {
    const f: RunsFilter = { ...EMPTY_FILTER, state: "completed", runtime: "codex", q: "parser", mode: "" };
    const p = new URLSearchParams(buildQuery(f));
    expect(p.get("state")).toBe("completed");
    expect(p.get("runtime")).toBe("codex");
    expect(p.get("q")).toBe("parser");
    expect(p.has("mode")).toBe(false);
  });
  it("특수문자 q 는 인코딩(리터럴 보존 — 서버가 리터럴 취급)", () => {
    const f: RunsFilter = { ...EMPTY_FILTER, q: "(a+)+ & x=1" };
    const round = parseQuery("?" + buildQuery(f));
    expect(round.q).toBe("(a+)+ & x=1");
  });
});

describe("W2 parseQuery — URL 복원(관용·서버 재검증)", () => {
  it("전 필드 왕복", () => {
    const f: RunsFilter = { state: "failed", runtime: "claude", mode: "build", agent: "builder", from: "2026-07-01T00:00:00Z", to: "2026-07-09T00:00:00Z", q: "x", sort: "updatedAt", order: "asc", offset: 20, limit: 10 };
    expect(parseQuery("?" + buildQuery(f))).toEqual(f);
  });
  it("불량 sort/order/limit → default 로 관용 복원", () => {
    const f = parseQuery("?sort=bogus&order=sideways&limit=abc&offset=-5");
    expect(f.sort).toBe("recordedAt");
    expect(f.order).toBe("desc");
    expect(f.limit).toBe(DEFAULT_LIMIT);
    expect(f.offset).toBe(0);
  });
  it("빈 검색 → 빈 필터", () => {
    expect(parseQuery("")).toEqual(EMPTY_FILTER);
  });
  it("[MED] limit/offset 는 서버(RunsQuery)와 동일 상한으로 clamp — pager 오점프 방지", () => {
    // limit: [1,100], 비수치→default 50 / offset: [0,100000], 비수치→0 (schemas.ts:132-133 미러)
    expect(parseQuery("limit=99999").limit).toBe(100); // 상한 초과 → 100(서버 clamp 일치)
    expect(parseQuery("limit=0").limit).toBe(1); // 하한 미만 → 1
    expect(parseQuery("limit=-5").limit).toBe(1);
    expect(parseQuery("limit=abc").limit).toBe(DEFAULT_LIMIT); // 비수치 → default
    expect(parseQuery("limit=37").limit).toBe(37); // 범위 내 보존
    expect(parseQuery("offset=-5").offset).toBe(0); // 음수 → 0
    expect(parseQuery("offset=999999").offset).toBe(100000); // 상한 초과 → 100000
    expect(parseQuery("offset=abc").offset).toBe(0); // 비수치 → 0
    expect(parseQuery("offset=250").offset).toBe(250); // 범위 내 보존
  });
});

describe("W2 [MED] pager offset — 응답 data.offset/data.limit(clamp된) 기준", () => {
  it("next/prev 는 서버 적용 limit 기준으로 이동(클라 filter.limit 아님)", () => {
    // ?limit=99999 여도 서버는 100 반환 → pager 는 data.limit=100 으로 이동(오점프 방지)
    const d = { offset: 100, limit: 100 };
    expect(nextOffset(d)).toBe(200);
    expect(prevOffset(d)).toBe(0);
    // 서버가 다른 페이지 크기(예: 25) 적용 시 그 값 기준
    expect(nextOffset({ offset: 50, limit: 25 })).toBe(75);
    expect(prevOffset({ offset: 50, limit: 25 })).toBe(25);
  });
  it("pageTo 가 prevOffset 음수를 0 으로 클램프", () => {
    expect(pageTo(EMPTY_FILTER, prevOffset({ offset: 20, limit: 50 })).offset).toBe(0);
  });
});

describe("W2 필터 변경/칩 — offset 리셋·개별 제거", () => {
  it("setField 는 offset 0 리셋", () => {
    const f = setField({ ...EMPTY_FILTER, offset: 40 }, "state", "completed");
    expect(f.state).toBe("completed");
    expect(f.offset).toBe(0);
  });
  it("setField 빈 값 → 필드 삭제", () => {
    const f = setField({ ...EMPTY_FILTER, state: "completed" }, "state", "");
    expect(f.state).toBeUndefined();
  });
  it("clearField 개별 제거·offset 리셋", () => {
    const f = clearField({ ...EMPTY_FILTER, state: "completed", q: "x", offset: 40 }, "state");
    expect(f.state).toBeUndefined();
    expect(f.q).toBe("x");
    expect(f.offset).toBe(0);
  });
  it("clearAll 전 필터 제거(정렬 default 유지)", () => {
    expect(clearAll()).toEqual(EMPTY_FILTER);
  });
  it("activeChips·hasActiveFilter — 정렬/페이지 제외", () => {
    const f: RunsFilter = { ...EMPTY_FILTER, state: "completed", q: "parser", offset: 20 };
    expect(activeChips(f).map((c) => c.key)).toEqual(["state", "q"]);
    expect(hasActiveFilter(f)).toBe(true);
    expect(hasActiveFilter(EMPTY_FILTER)).toBe(false);
  });
});

describe("W1 정렬 방향·페이지", () => {
  it("toggleOrder desc↔asc·offset 리셋", () => {
    expect(toggleOrder(EMPTY_FILTER).order).toBe("asc");
    expect(toggleOrder({ ...EMPTY_FILTER, order: "asc" }).order).toBe("desc");
    expect(toggleOrder({ ...EMPTY_FILTER, offset: 40 }).offset).toBe(0);
  });
  it("pageTo 음수 클램프", () => {
    expect(pageTo(EMPTY_FILTER, -10).offset).toBe(0);
    expect(pageTo(EMPTY_FILTER, 50).offset).toBe(50);
  });
});

describe("W3 절단 고지 — 원인별 분리 문구([V13])", () => {
  it("limit_reached·deadline_exceeded 는 서로 다른 문구", () => {
    const a = truncationNotice("limit_reached")!;
    const b = truncationNotice("deadline_exceeded")!;
    expect(a.label).not.toBe(b.label);
    expect(a.tip).not.toBe(b.tip);
    expect(a.label).toContain("상한");
    expect(b.label).toContain("시간 초과");
  });
  it("scan_error → 부분결과 고지(null 아님·전용 문구)", () => {
    const c = truncationNotice("scan_error")!;
    expect(c).not.toBeNull();
    expect(c.label).toContain("오류");
    expect(c.tip).toContain("부분 결과");
  });
  it("세 원인(limit_reached/deadline_exceeded/scan_error)은 서로 다른 label·tip", () => {
    const a = truncationNotice("limit_reached")!;
    const b = truncationNotice("deadline_exceeded")!;
    const c = truncationNotice("scan_error")!;
    const labels = [a.label, b.label, c.label];
    const tips = [a.tip, b.tip, c.tip];
    expect(new Set(labels).size).toBe(3); // 문구 뭉침 방지
    expect(new Set(tips).size).toBe(3);
  });
  it("null → 고지 없음", () => {
    expect(truncationNotice(null)).toBeNull();
  });
});

describe("W2 pageRange — 1기반 표시 범위", () => {
  it("offset/items 로 현재 범위", () => {
    expect(pageRange({ offset: 0, items: new Array(10).fill(0) as never[], total: 25 })).toEqual({ start: 1, end: 10 });
    expect(pageRange({ offset: 20, items: new Array(5).fill(0) as never[], total: 25 })).toEqual({ start: 21, end: 25 });
  });
  it("빈 결과 → null", () => {
    expect(pageRange({ offset: 0, items: [], total: 0 })).toBeNull();
  });
});
