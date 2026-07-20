// F6 관측성 계층 B(M9) — 클라 계약 미러 + 렌더 헬퍼(순수 로직·vitest 대상).
// 과대표시 금지(A62/A90) 핵심: value===null 은 데이터 부재/미귀속 → "미측정/미귀속" 표기(0 위장 절대 금지).
// per-value confidence: 각 지표가 자기 measured/estimated/unattributed 를 개별 동반. 응답 단일 confidence 없음.
// 서버 계약(adapters/metrics.ts)과 정확히 일치 — 임의 shape 가정 금지.

export type Confidence = "measured" | "estimated" | "unattributed";

// unattributed/부재는 value=null(0 위장 금지). measured/estimated 도 n=0 이면 value=null 가능.
export interface MetricValue { value: number | null; confidence: Confidence; }

export type TruncatedReason = "limit_reached" | "deadline_exceeded" | "scan_error" | null;

export interface Coverage {
  scannedRuns: number;
  aggregatedRuns: number;
  usageRuns: number;
  measuredRatio: number | null;
  windowNewestMs: number | null;
  windowOldestMs: number | null;
  truncated: boolean;
  truncatedReason: TruncatedReason;
  recordedAtSource: "birthtime" | "mtime";
}

export interface OverviewMetrics {
  schemaVersion: "1";
  coverage: Coverage;
  runCount: number;
  succeeded: number;
  failed: number;
  other: number;
  successRate: MetricValue;
  failureRate: MetricValue;
  avgDurationMs: MetricValue;
  reworkRate: MetricValue;
  reviewConvergence: MetricValue;
  totalTokens: MetricValue;
  unusedAgents: number;
  unusedSkills: number;
}

export interface AgentMetric {
  agent: string; runs: number; invocations: number; completed: number; failed: number; tokens: MetricValue;
}
export interface AgentsMetrics { schemaVersion: "1"; coverage: Coverage; agents: AgentMetric[]; unusedInWindow: string[]; }

export interface SkillMetric { skill: string; runs: number; invocations: number; tokens: MetricValue; }
export interface SkillsMetrics { schemaVersion: "1"; coverage: Coverage; skills: SkillMetric[]; unusedInWindow: string[]; }

// ── W1/W7 confidence 메타(아이콘+텍스트+툴팁 산정식) — 색 단독 금지, 아이콘은 형태로 구분 ──
// 아이콘 형태(●/◐/○)가 색과 독립적으로 measured↔estimated↔unattributed 를 구분(A92 색비의존).
export const CONFIDENCE_META: Record<Confidence, { icon: string; label: string; formula: string }> = {
  measured: {
    icon: "●", label: "측정값",
    formula: "측정값 — 관측 증거(status·usage)로 직접 산출한 정확값.",
  },
  estimated: {
    icon: "◐", label: "추정값",
    formula: "추정값 — 정확 분해 불가로 상한/프록시 휴리스틱(팀 에이전트 토큰·스킬 점유·이벤트명 매칭). 정확값 아님.",
  },
  unattributed: {
    icon: "○", label: "미귀속",
    formula: "미귀속 — usage 증거 부재로 귀속 불가. 0 이 아니라 '측정되지 않음'(0으로 간주 금지).",
  },
};
export function confidenceMeta(c: Confidence): { icon: string; label: string; formula: string } {
  return CONFIDENCE_META[c] ?? CONFIDENCE_META.unattributed;
}

export type MetricFmt = "percent" | "duration" | "int" | "float";

export function formatPercent(ratio: number): string { return (ratio * 100).toFixed(1) + "%"; }

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}초`;
  const m = Math.floor(s / 60), rs = Math.round(s % 60);
  if (m < 60) return `${m}분 ${rs}초`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}시간 ${rm}분`;
}

function formatNumber(v: number, fmt: MetricFmt): string {
  switch (fmt) {
    case "percent": return formatPercent(v);
    case "duration": return formatDurationMs(v);
    case "int": return Math.round(v).toLocaleString();
    case "float": return v.toFixed(2);
  }
}

// W7 핵심: value===null → "미측정"(measured/estimated) 또는 "미귀속"(unattributed). 절대 0 렌더 금지.
export function formatMetricValue(mv: MetricValue | null | undefined, fmt: MetricFmt = "float"): { text: string; missing: boolean } {
  if (!mv || mv.value === null || mv.value === undefined || !Number.isFinite(mv.value)) {
    return { text: mv?.confidence === "unattributed" ? "미귀속" : "미측정", missing: true };
  }
  return { text: formatNumber(mv.value, fmt), missing: false };
}

// ── W6 커버리지/window UX(A90) — "dead/미사용" 단정 금지 ──
export function truncatedReasonText(reason: TruncatedReason): string | null {
  switch (reason) {
    case "limit_reached": return "스캔 상한 도달 — 최근 run 일부만 집계(전체 아님·커버리지 부분).";
    case "deadline_exceeded": return "스캔 시간 초과 — 부분 집계(신뢰도 하락, 0 위장 아님).";
    case "scan_error": return "스캔 오류 발생 — 부분 집계(신뢰도 하락).";
    default: return null;
  }
}

export function coverageSummary(cov: Coverage): string {
  const pct = cov.measuredRatio === null ? "—" : formatPercent(cov.measuredRatio);
  return `관측 window: 스캔 ${cov.scannedRuns} run · 집계 ${cov.aggregatedRuns} run · 측정 비율 ${pct}`;
}

export function coverageWindowText(cov: Coverage): string | null {
  if (cov.windowNewestMs === null || cov.windowOldestMs === null) return null;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  return `${fmt(cov.windowOldestMs)} ~ ${fmt(cov.windowNewestMs)}`;
}

// 0회 관측 대상 정직 문구(W6) — 전-생애 dead 단정이 아니라 "선택 window 내 관측 없음".
export function windowEmptyNotice(kind: "agent" | "skill", cov: Coverage): string {
  const label = kind === "agent" ? "에이전트" : "스킬";
  return `아래 ${label}는 선택 window(스캔 ${cov.scannedRuns} run · 집계 ${cov.aggregatedRuns} run) 내 관측이 없습니다 — 전-생애 "미사용(dead)" 단정 아님.`;
}

// ── W5 anti-Goodhart: 측정 → 행동유도 제안(순위/점수/자동강제 없음) ──
export interface Suggestion { key: string; text: string; }
export function overviewSuggestions(m: OverviewMetrics): Suggestion[] {
  const out: Suggestion[] = [];
  if (m.unusedAgents > 0)
    out.push({ key: "unused-agents", text: `선택 window 내 미관측 에이전트 ${m.unusedAgents}개 — Agents 화면에서 확인(정리 후보이지 확정 아님).` });
  if (m.unusedSkills > 0)
    out.push({ key: "unused-skills", text: `선택 window 내 미관측 스킬 ${m.unusedSkills}개 — Skills 화면에서 확인(정리 후보이지 확정 아님).` });
  const rw = m.reworkRate;
  if (rw.value !== null && rw.value >= 0.3)
    out.push({ key: "rework", text: `재작업률 추정치 ${formatPercent(rw.value)}(estimated·프록시) — 원인 run 점검 권장(자동 조치 아님).` });
  return out;
}
