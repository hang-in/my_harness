// F4 Runs 조회 — 필터 상태 ↔ 쿼리스트링 ↔ URL 순수 로직(계약·데이터 shape·TDD 대상).
// XSS 무관(문자열 조작만) · 서버 RunsQuery Zod 가 최종 검증(enum/datetime/SAFE_SEGMENT 400·offset/limit clamp).

// 서버 응답 계약(runs.ts QueryRunsResult) 과 정확히 일치. 클라 임의 shape 금지.
export interface RunRecord {
  runId: string;
  runtime: string | null;
  mode: string | null;
  state: string | null;
  recordedAt: string;
  recordedAtMs: number;
  createdAt: string | null;
  updatedAt: string | null;
  goal: string | null;
  agent: string | null;
  requestedBy: string | null;
}
export interface RunsQueryResult {
  items: RunRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  scanned: number;
  truncated: boolean;
  truncatedReason: "limit_reached" | "deadline_exceeded" | "scan_error" | null;
  recordedAtSource: "birthtime" | "mtime";
  schemaVersion: "1";
}

export type SortKey = "recordedAt" | "updatedAt" | "state";
export type Order = "asc" | "desc";
const SORT_KEYS: readonly SortKey[] = ["recordedAt", "updatedAt", "state"];

export interface RunsFilter {
  state?: string;
  runtime?: string;
  mode?: string;
  agent?: string;
  from?: string;
  to?: string;
  q?: string;
  sort: SortKey;
  order: Order;
  offset: number;
  limit: number;
}

export const DEFAULT_LIMIT = 50;
// 서버 RunsQuery clamp 경계(schemas.ts:132-133)와 정확히 일치 — URL 복원값이 서버 실제 동작과 어긋나지 않게.
export const LIMIT_MIN = 1;
export const LIMIT_MAX = 100;
export const OFFSET_MIN = 0;
export const OFFSET_MAX = 100000;
export const EMPTY_FILTER: RunsFilter = { sort: "recordedAt", order: "desc", offset: 0, limit: DEFAULT_LIMIT };

// 서버 coerceInt/clampInt(schemas.ts:106-118) 미러 — 비수치→fallback default, 범위 밖→경계로 clamp(400 아님).
function coerceInt(v: string | null): number | null {
  if (v === null) return null;
  const s = v.trim();
  return /^-?\d+$/.test(s) ? Number.parseInt(s, 10) : null;
}
function clampInt(n: number | null, min: number, max: number, fallback: number): number {
  if (n === null) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// 칩·초기화 대상 필드(정렬/페이지 컨트롤 제외 — 그들은 별도 UI 컨트롤).
export const CHIP_FIELDS = ["state", "runtime", "mode", "agent", "from", "to", "q"] as const;
export type ChipField = (typeof CHIP_FIELDS)[number];

const CHIP_LABEL: Record<ChipField, string> = {
  state: "상태",
  runtime: "런타임",
  mode: "모드",
  agent: "에이전트",
  from: "기록 시각(파일시스템) 이후",
  to: "기록 시각(파일시스템) 이전",
  q: "검색어",
};

// 필터 상태 → 쿼리스트링. 정렬/order/limit/offset 은 항상 첨부 →
// 서버가 항상 "인자" 분기(queryRuns·신규 shape)로 라우팅(무인자 {runs} 오분기 방지).
export function buildQuery(f: RunsFilter): string {
  const p = new URLSearchParams();
  for (const k of CHIP_FIELDS) {
    const v = f[k];
    if (typeof v === "string" && v.length > 0) p.set(k, v);
  }
  p.set("sort", f.sort);
  p.set("order", f.order);
  p.set("limit", String(f.limit));
  p.set("offset", String(f.offset));
  return p.toString();
}

// location.search → 필터 복원(공유·새로고침 보존). 서버가 재검증하므로 관용적 파싱.
export function parseQuery(search: string): RunsFilter {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const f: RunsFilter = { ...EMPTY_FILTER };
  for (const k of CHIP_FIELDS) {
    const v = p.get(k);
    if (v != null && v.length > 0) f[k] = v;
  }
  const sort = p.get("sort");
  if (sort && (SORT_KEYS as readonly string[]).includes(sort)) f.sort = sort as SortKey;
  const order = p.get("order");
  if (order === "asc" || order === "desc") f.order = order;
  // 서버와 동일 상한으로 clamp — pager offset 오점프 방지(?limit=99999→100, offset=-5→0).
  f.limit = clampInt(coerceInt(p.get("limit")), LIMIT_MIN, LIMIT_MAX, DEFAULT_LIMIT);
  f.offset = clampInt(coerceInt(p.get("offset")), OFFSET_MIN, OFFSET_MAX, 0);
  return f;
}

// 필드 변경(필터 조건) — offset 은 0 으로 리셋(새 조건 = 첫 페이지).
export function setField(f: RunsFilter, key: ChipField, value: string): RunsFilter {
  const next = { ...f, offset: 0 };
  if (value.length > 0) next[key] = value;
  else delete next[key];
  return next;
}

// 개별 칩 제거.
export function clearField(f: RunsFilter, key: ChipField): RunsFilter {
  const next = { ...f, offset: 0 };
  delete next[key];
  return next;
}

// 필터 초기화 — 정렬/페이지 포함 완전 초기화(단 정렬 default 유지).
export function clearAll(): RunsFilter {
  return { ...EMPTY_FILTER };
}

// 활성 필터 칩 목록(개별 제거용).
export function activeChips(f: RunsFilter): Array<{ key: ChipField; label: string; value: string }> {
  const out: Array<{ key: ChipField; label: string; value: string }> = [];
  for (const k of CHIP_FIELDS) {
    const v = f[k];
    if (typeof v === "string" && v.length > 0) out.push({ key: k, label: CHIP_LABEL[k], value: v });
  }
  return out;
}

export function hasActiveFilter(f: RunsFilter): boolean {
  return CHIP_FIELDS.some((k) => typeof f[k] === "string" && (f[k] as string).length > 0);
}

// 정렬 방향 토글.
export function toggleOrder(f: RunsFilter): RunsFilter {
  return { ...f, order: f.order === "desc" ? "asc" : "desc", offset: 0 };
}

// 페이지 이동(offset 만 변경 — 조건 유지).
export function pageTo(f: RunsFilter, offset: number): RunsFilter {
  return { ...f, offset: Math.max(0, offset) };
}

// 다음/이전 페이지 offset — 서버가 실제 적용한 offset/limit(clamp된) 기준(클라 filter.limit 아님 → 오점프 방지).
export function nextOffset(d: Pick<RunsQueryResult, "offset" | "limit">): number {
  return d.offset + d.limit;
}
export function prevOffset(d: Pick<RunsQueryResult, "offset" | "limit">): number {
  return d.offset - d.limit;
}

// 절단 고지 원인별 문구([V13] 세 원인 분리 — 동일 문구로 뭉치지 말 것).
// R4-1: scan_error(디렉토리 순회 예외) 부분결과도 반드시 고지(null 반환으로 누락 금지).
export function truncationNotice(
  reason: RunsQueryResult["truncatedReason"],
): { label: string; tip: string } | null {
  if (reason === "limit_reached")
    return {
      label: "최근 N개 상한 도달",
      tip: "최근 N개 상한 도달 · 더 오래된 이력 생략 · 기간(from/to)을 좁혀 재검색",
    };
  if (reason === "deadline_exceeded")
    return {
      label: "스캔 시간 초과",
      tip: "스캔 시간 초과 · 부분 결과 · 필터를 좁혀 재검색",
    };
  if (reason === "scan_error")
    return {
      label: "스캔 중 오류 발생",
      tip: "스캔 중 오류 발생 · 부분 결과 · 다시 시도하거나 필터를 좁혀보세요",
    };
  return null;
}

// 현재 페이지 표시 범위(1-기반, 사람용). total 0 이면 null.
export function pageRange(r: Pick<RunsQueryResult, "offset" | "items" | "total">): { start: number; end: number } | null {
  if (r.total === 0 || r.items.length === 0) return null;
  return { start: r.offset + 1, end: r.offset + r.items.length };
}
