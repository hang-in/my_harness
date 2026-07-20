import { describe, it, expect } from "vitest";
import { ApiGetError, statusErrorText, readErrorText } from "../src/web/errors.js";

// U1 읽기 에러 한국어 매핑 — 상태코드→한국어(원시 영문 "500 /api/..." 노출 금지). TDD 대상.

describe("statusErrorText — 상태코드별 한국어(A84 재로그인 동선 포함)", () => {
  it("401 → 세션 만료·재접속 동선", () => {
    expect(statusErrorText(401)).toContain("세션");
    expect(statusErrorText(401)).toContain("링크");
  });
  it("403 → 권한 없음", () => { expect(statusErrorText(403)).toContain("권한"); });
  it("404 → 찾을 수 없음", () => { expect(statusErrorText(404)).toContain("찾을 수 없"); });
  it("500/502 → 서버 오류", () => {
    expect(statusErrorText(500)).toContain("서버 오류");
    expect(statusErrorText(502)).toContain("서버 오류");
  });
  it("기타 4xx → 요청 유효하지 않음", () => { expect(statusErrorText(422)).toContain("유효"); });
  it("어떤 코드도 원시 상태코드 숫자를 그대로 노출하지 않음", () => {
    for (const s of [401, 403, 404, 500]) expect(statusErrorText(s)).not.toMatch(/\/api\//);
  });
});

describe("readErrorText — throw 값 → 한국어", () => {
  it("ApiGetError(500) → 서버 오류 한국어(원시 '500 /api/...' 아님)", () => {
    const e = new ApiGetError(500, "/api/metrics/overview");
    expect(readErrorText(e)).toBe(statusErrorText(500));
    expect(readErrorText(e)).not.toContain("/api/");
  });
  it("ApiGetError(401) → 세션 만료 문구", () => {
    expect(readErrorText(new ApiGetError(401, "/api/settings"))).toContain("세션");
  });
  it("네트워크/미상(비 ApiGetError) → 네트워크 오류(전역 오버레이 보조)", () => {
    expect(readErrorText(new TypeError("Failed to fetch"))).toContain("네트워크");
    expect(readErrorText("boom")).toContain("네트워크");
  });
});
