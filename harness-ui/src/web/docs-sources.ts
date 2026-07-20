// F9 M14 Docs 소스 설정 — 순수 로직(React·fetch 무의존·TDD 대상).
// 서버 error 코드 → 한국어 인라인 매핑 + 소스 편집기 행 조작(추가/삭제/재정렬/검증) + Docs 다중소스 빈/무효 판정.
// 경계면 계약: docssources.ts DocsSourceError(전건) + endpoint invalid-source/bad-input. 상한은 서버(MAX_DOCS_*)와 정합.

// 서버 상한 미러(입력 maxLength·추가 버튼 비활성용). 실검증은 서버 권위(strict Zod) — 여기 값은 UX 가드일 뿐.
export const MAX_DOCS_SOURCES = 16;
export const MAX_DOCS_PATH_LEN = 512;
export const MAX_DOCS_LABEL_LEN = 80;

// 서버 확정 error 코드 집합(docssources.ts DocsSourceError + endpoint) 전건. 그 외 코드는 폴백(조용한 드롭 금지).
export const DOCS_SOURCE_ERRORS: Record<string, string> = {
  "bad-input": "경로 형식이 올바르지 않습니다 · projectRoot 하위 상대경로만 허용(절대경로·~·..·UNC·드라이브상대·미정규화 유니코드·제어문자 불가).",
  "root-source": "하위 디렉토리 없이 프로젝트 루트 전체를 노출할 수 없습니다 · 최소 한 단계 하위 경로를 지정하세요(예: docs).",
  "denied": "민감 디렉토리(.git·.ssh·node_modules·.env 등)는 소스로 지정할 수 없습니다.",
  "not-found": "경로가 존재하지 않습니다 · projectRoot 하위 디렉토리인지 확인하세요.",
  "not-a-directory": "경로가 디렉토리가 아닙니다 · 파일이 아닌 폴더를 지정하세요.",
  "symlink-in-path": "경로에 심볼릭 링크(또는 재분석 지점)가 포함되어 있습니다 · 경계 우회 방지를 위해 거부합니다.",
  "escape": "경로가 프로젝트 경계를 벗어납니다 · 거부합니다.",
  "invalid-source": "등록되지 않았거나 더 이상 유효하지 않은 소스입니다.",
};

// error 코드 → 한국어 인라인 메시지(A5). 미지 코드 → 상태코드·코드 포함 폴백(조용한 드롭 아님).
export function docsSourceErrorText(code: string, status?: number): string {
  const known = DOCS_SOURCE_ERRORS[code];
  if (known) return known;
  return `소스 설정 실패${status ? ` (${status})` : ""}${code ? ` · ${code}` : ""}.`;
}

// ── 소스 편집기 행 모델(A119 추가/삭제/재정렬) — 불변 조작(React setState 안전) ──
export type SourceRow = { label: string; path: string };

export function canAddSource(rows: SourceRow[]): boolean {
  return rows.length < MAX_DOCS_SOURCES;
}
export function addSourceRow(rows: SourceRow[]): SourceRow[] {
  if (!canAddSource(rows)) return rows; // 상한 초과 시 무변경(서버 max16 정합)
  return [...rows, { label: "", path: "" }];
}
export function removeSourceRow(rows: SourceRow[], i: number): SourceRow[] {
  return rows.filter((_, idx) => idx !== i);
}
export function updateSourceRow(rows: SourceRow[], i: number, patch: Partial<SourceRow>): SourceRow[] {
  return rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
}
// 재정렬 — i 를 dir(-1 위 / +1 아래)로 스왑. 경계 밖이면 무변경.
export function moveSourceRow(rows: SourceRow[], i: number, dir: -1 | 1): SourceRow[] {
  const j = i + dir;
  if (i < 0 || i >= rows.length || j < 0 || j >= rows.length) return rows;
  const a = rows[i], b = rows[j];
  if (!a || !b) return rows; // 경계 재확인(noUncheckedIndexedAccess)
  const next = rows.slice();
  next[i] = b; next[j] = a;
  return next;
}

// ── 로컬(클라) 행 유효성 — 저장/검증 버튼 활성 판정용(서버 재검증 전 명백한 무효 차단) ──
export type RowIssue = null | "empty-label" | "empty-path" | "label-too-long" | "path-too-long";
export function rowIssue(row: SourceRow): RowIssue {
  if (row.label.trim().length === 0) return "empty-label";
  if (row.path.trim().length === 0) return "empty-path";
  if (row.label.length > MAX_DOCS_LABEL_LEN) return "label-too-long";
  if (row.path.length > MAX_DOCS_PATH_LEN) return "path-too-long";
  return null;
}
export const ROW_ISSUE_TEXT: Record<Exclude<RowIssue, null>, string> = {
  "empty-label": "라벨을 입력하세요.",
  "empty-path": "경로를 입력하세요.",
  "label-too-long": `라벨은 ${MAX_DOCS_LABEL_LEN}자 이내여야 합니다.`,
  "path-too-long": `경로는 ${MAX_DOCS_PATH_LEN}자 이내여야 합니다.`,
};
export function rowIssueText(issue: RowIssue): string | null {
  return issue ? ROW_ISSUE_TEXT[issue] : null;
}
// 전 행 로컬 유효(빈 배열 = 전 소스 삭제 = 유효). dryRun/저장 요청 전 게이트.
export function rowsLocallyValid(rows: SourceRow[]): boolean {
  return rows.every((r) => rowIssue(r) === null);
}
// 서버 전송용 페이로드(trim·로컬유효 전제). 빈 배열 허용(전 소스 삭제).
export function toPayloadSources(rows: SourceRow[]): SourceRow[] {
  return rows.map((r) => ({ label: r.label.trim(), path: r.path.trim() }));
}

// ── dryRun 프리뷰 결과 매핑(A119 per-소스 인라인 유효성) ──
export type DryRunSource = { id: string; label: string; path: string; valid: boolean; error: string | null };
// 경로 → error 코드(유효면 null). 서버는 중복 경로를 병합하므로 경로 키가 안정적.
export function dryRunErrorByPath(sources: DryRunSource[]): Record<string, string | null> {
  const m: Record<string, string | null> = {};
  for (const s of sources) m[s.path] = s.valid ? null : (s.error ?? "invalid-source");
  return m;
}
export function allSourcesValid(sources: DryRunSource[]): boolean {
  return sources.every((s) => s.valid);
}

// ── Docs 화면 다중소스 상태 판정(A120 빈/무효 CTA·데드엔드 방지) ──
export type SourceInfo = { id: string; label: string; path: string; valid: boolean; enabled: boolean };
export type SourcesPayload = { enabled: boolean; sources: SourceInfo[] };

// disabled(메뉴 off) · no-sources(0개) · all-invalid(전 무효) · ready(≥1 유효).
export type DocsSourcesState = "disabled" | "no-sources" | "all-invalid" | "ready";
export function docsSourcesState(p: SourcesPayload): DocsSourcesState {
  if (!p.enabled) return "disabled";
  if (p.sources.length === 0) return "no-sources";
  if (p.sources.every((s) => !s.valid)) return "all-invalid";
  return "ready";
}

// 드롭다운 기본 선택 — preferred(딥링크)가 유효하면 유지, 아니면 첫 유효 소스, 없으면 null.
export function pickDefaultSource(p: SourcesPayload, preferred: string | null): string | null {
  if (preferred && p.sources.some((s) => s.id === preferred && s.valid)) return preferred;
  const firstValid = p.sources.find((s) => s.valid);
  return firstValid ? firstValid.id : null;
}

// ── ?source= 딥링크(docs-view ?path= 와 결합) — 소스+파일 URL 반영·새로고침/공유 복원 ──
export function focusSourceFromHash(hash: string): string | null {
  const q = hash.split("?")[1];
  if (!q) return null;
  const s = new URLSearchParams(q).get("source");
  return s && s.length > 0 ? s : null;
}
export function docsSourceDeepLink(source: string | null, rel: string | null): string {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (rel) params.set("path", rel);
  const q = params.toString();
  return q ? `#/docs?${q}` : "#/docs";
}
