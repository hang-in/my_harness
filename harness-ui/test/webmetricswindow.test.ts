import { describe, it, expect } from "vitest";
import {
  DEFAULT_WINDOW, PRESET_LABEL, windowRange, buildMetricsQuery, metricsPath, parseLimitInput,
  type MetricsWindow,
} from "../src/web/metrics-window.js";

// U3 메트릭 window 순수 로직 — 프리셋→from/to/limit 쿼리(서버 MetricsQuery 계약 미러). TDD 대상.

const NOW = Date.parse("2026-07-10T00:00:00.000Z");

describe("windowRange — 프리셋 → from/to(now 주입·결정적)", () => {
  it("24h → from = now-24h, to = null(now 까지 열림)", () => {
    const r = windowRange("24h", NOW);
    expect(r.fromMs).toBe(NOW - 24 * 3600_000);
    expect(r.toMs).toBeNull();
  });
  it("7d → from = now-7d", () => {
    expect(windowRange("7d", NOW).fromMs).toBe(NOW - 7 * 24 * 3600_000);
  });
  it("all → from/to 모두 null(전체)", () => {
    expect(windowRange("all", NOW)).toEqual({ fromMs: null, toMs: null });
  });
});

describe("buildMetricsQuery — ISO from/to + limit(서버 Zod datetime offset 통과)", () => {
  it("all·limit 없음 → 빈 문자열(무인자 전체 폴백과 정합)", () => {
    expect(buildMetricsQuery({ preset: "all", limit: null }, NOW)).toBe("");
  });
  it("24h → from ISO 만(to 생략)", () => {
    const qs = buildMetricsQuery({ preset: "24h", limit: null }, NOW);
    const p = new URLSearchParams(qs);
    expect(p.get("from")).toBe(new Date(NOW - 24 * 3600_000).toISOString());
    expect(p.has("to")).toBe(false);
    // ISO 는 offset(Z) 포함 — 서버 datetime{offset:true} 통과 형태
    expect(p.get("from")).toMatch(/Z$/);
  });
  it("limit 지정 → limit 정수 첨부", () => {
    const p = new URLSearchParams(buildMetricsQuery({ preset: "all", limit: 50 }, NOW));
    expect(p.get("limit")).toBe("50");
  });
  it("limit ≤0/비유효 → 생략", () => {
    expect(new URLSearchParams(buildMetricsQuery({ preset: "all", limit: 0 }, NOW)).has("limit")).toBe(false);
  });
});

describe("metricsPath — base + 쿼리 조립", () => {
  it("all → base 그대로(쿼리 없음)", () => {
    expect(metricsPath("/api/metrics/overview", DEFAULT_WINDOW, NOW)).toBe("/api/metrics/overview");
  });
  it("24h → base?from=...", () => {
    const path = metricsPath("/api/metrics/agents", { preset: "24h", limit: null }, NOW);
    expect(path.startsWith("/api/metrics/agents?from=")).toBe(true);
  });
  it("동일 window·동일 now → 동일 경로(useMemo 안정성 전제)", () => {
    const w: MetricsWindow = { preset: "7d", limit: 20 };
    expect(metricsPath("/api/metrics/skills", w, NOW)).toBe(metricsPath("/api/metrics/skills", w, NOW));
  });
});

describe("parseLimitInput — 빈/비정수/≤0 → null(silent clamp 없음)", () => {
  it("유효 정수", () => { expect(parseLimitInput("42")).toBe(42); });
  it("빈 문자열 → null(미지정)", () => { expect(parseLimitInput("  ")).toBeNull(); });
  it("비정수 → null", () => { expect(parseLimitInput("1.5")).toBeNull(); expect(parseLimitInput("abc")).toBeNull(); });
  it("0/음수 → null", () => { expect(parseLimitInput("0")).toBeNull(); expect(parseLimitInput("-3")).toBeNull(); });
});

describe("MED 순수성 — nowMs 명시 인자 강제(Date.now() 기본값 은닉 제거)", () => {
  it("동일 (window, nowMs) → 동일 출력(비결정 시간 은닉 없음)", () => {
    const w: MetricsWindow = { preset: "24h", limit: 10 };
    expect(buildMetricsQuery(w, NOW)).toBe(buildMetricsQuery(w, NOW));
    expect(metricsPath("/api/metrics/overview", w, NOW)).toBe(metricsPath("/api/metrics/overview", w, NOW));
  });
  it("다른 nowMs → from 반영(주입값이 실제로 쓰임·내부 Date.now 무시)", () => {
    const later = NOW + 3600_000;
    const a = new URLSearchParams(buildMetricsQuery({ preset: "24h", limit: null }, NOW)).get("from");
    const b = new URLSearchParams(buildMetricsQuery({ preset: "24h", limit: null }, later)).get("from");
    expect(a).not.toBe(b);
    expect(a).toBe(new Date(NOW - 24 * 3600_000).toISOString());
    expect(b).toBe(new Date(later - 24 * 3600_000).toISOString());
  });
});

describe("기본값·라벨", () => {
  it("DEFAULT_WINDOW = 전체·limit null", () => {
    expect(DEFAULT_WINDOW).toEqual({ preset: "all", limit: null });
  });
  it("PRESET_LABEL 한국어", () => {
    expect(PRESET_LABEL["24h"]).toContain("24");
    expect(PRESET_LABEL.all).toBe("전체");
  });
});
