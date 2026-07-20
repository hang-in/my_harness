// U3 메트릭 window 컨트롤 — 순수 로직(React·fetch 무의존·TDD 대상).
// 서버 MetricsQuery(api/index.ts) 계약: ?from=&to=(ISO datetime, offset 포함)&limit=(int 1..MAX).
// 프리셋(24h/7d/전체) + 선택 limit → 쿼리스트링. coverage 의 windowNewest/Oldest 는 이 window 로 재산정 → 정합.

export type WindowPreset = "24h" | "7d" | "all";

export interface MetricsWindow {
  preset: WindowPreset;
  limit: number | null; // null = 서버 기본(전체 스캔 상한). 지정 시 집계 편입 run 상한.
}

export const DEFAULT_WINDOW: MetricsWindow = { preset: "all", limit: null };

export const PRESET_LABEL: Record<WindowPreset, string> = {
  "24h": "최근 24시간",
  "7d": "최근 7일",
  all: "전체",
};

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

// 프리셋 → from(ISO)/to(now 까지 열림). all → from 없음(전체). nowMs 주입(결정적 테스트).
export function windowRange(preset: WindowPreset, nowMs: number): { fromMs: number | null; toMs: number | null } {
  switch (preset) {
    case "24h": return { fromMs: nowMs - DAY_MS, toMs: null };
    case "7d": return { fromMs: nowMs - 7 * DAY_MS, toMs: null };
    case "all": return { fromMs: null, toMs: null };
  }
}

// window → 쿼리스트링(from/to = ISO·서버 Zod datetime{offset:true} 통과분·limit = 정수).
// 값 없으면 생략 → 무인자 전체 집계 폴백과 정합. 접두 "?" 없음(호출측이 붙임).
// nowMs 는 명시 인자 강제(MED 순수성) — Date.now() 기본값 은닉 금지. 호출부가 useMemo 에서 캡처한 값 주입.
export function buildMetricsQuery(w: MetricsWindow, nowMs: number): string {
  const { fromMs, toMs } = windowRange(w.preset, nowMs);
  const p = new URLSearchParams();
  if (fromMs !== null) p.set("from", new Date(fromMs).toISOString());
  if (toMs !== null) p.set("to", new Date(toMs).toISOString());
  if (w.limit !== null && Number.isFinite(w.limit) && w.limit > 0) p.set("limit", String(Math.trunc(w.limit)));
  return p.toString();
}

// metrics 경로 조립 — base + (쿼리 있으면 "?" 첨부). useApi(path) 소비.
// nowMs 명시 인자 강제(MED) — 호출부(screens.tsx)가 useMemo(deps:[win]) 안에서 Date.now() 를 캡처해 주입.
export function metricsPath(base: string, w: MetricsWindow, nowMs: number): string {
  const qs = buildMetricsQuery(w, nowMs);
  return qs ? `${base}?${qs}` : base;
}

// limit 입력 파싱(빈/비정수/≤0 → null = 미지정). silent clamp 없이 무효는 미지정 취급.
export function parseLimitInput(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
