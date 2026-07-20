// F3 M11 Settings projectRoot 편집 — 순수 로직(React·fetch 무의존·테스트 대상).
// 서버 400/409 error 코드 → 한국어 인라인 매핑(W-A5·A101·조용한 드롭 금지).
// A99 활성 run 고아 통제 2선택 판정. dryRun 프리뷰→확인→저장은 컴포넌트 상태머신에서 배선.

// 서버 확정 error 코드 집합(D8·boundary-not-provisioned). 그 외 코드는 폴백 메시지.
export const PROJECT_ROOT_ERRORS: Record<string, string> = {
  "bad-input": "경로 형식이 올바르지 않습니다 · 절대경로만 허용(~ 확장·상대경로·..·UNC·드라이브상대·미정규화 유니코드 불가).",
  "symlink": "경로에 심볼릭 링크가 포함되어 있습니다 · 경계 우회 방지를 위해 거부합니다.",
  "reparse-point": "경로에 재분석 지점(junction·마운트)이 포함되어 있습니다 · 거부합니다.",
  "denied-system-path": "시스템·민감 디렉토리(예: /etc·~/.ssh)는 프로젝트 루트로 지정할 수 없습니다.",
  "no-harness-marker": "하네스 마커(.claude/·CLAUDE.md·AGENTS.md)가 없는 디렉토리입니다.",
  "outside-projects-home": "허용된 프로젝트 경계(projectsHome) 밖의 경로입니다.",
  "escape": "경로가 프로젝트 경계를 벗어납니다 · 거부합니다.",
  "boundary-not-provisioned": "프로젝트 경계가 설정되지 않았습니다 · HARNESS_PROJECTS_HOME 환경변수 설정 후 재시작이 필요합니다.",
};

// 서버 error 코드 → 한국어 인라인 메시지(A5). 미지 코드 → 상태코드 포함 폴백(조용한 드롭 금지).
export function projectRootErrorText(code: string, status?: number): string {
  const known = PROJECT_ROOT_ERRORS[code];
  if (known) return known;
  return `프로젝트 루트 변경 실패${status ? ` (${status})` : ""}${code ? ` · ${code}` : ""}.`;
}

// A99 활성 run 고아 통제 2선택.
//  - cancel-first:      활성 run 취소 후 재시작(cancel 경로) — 통제 유지.
//  - headless-continue: 헤드리스 계속 승인 — 통제 상실·API 토큰 소진 명시 인지 후 쓰기.
export type OrphanChoice = "cancel-first" | "headless-continue";

// activeRunsWarning>0 일 때만 A99 2선택을 요구(과경고 금지·W-B2).
export function requiresOrphanChoice(activeRunsWarning: number): boolean {
  return activeRunsWarning > 0;
}

// 저장 진행 가능 여부 — 프리뷰가 확립되고, 경고가 있으면 2선택 중 하나가 선택됐을 때만.
export function canSave(activeRunsWarning: number, choice: OrphanChoice | null): boolean {
  if (!requiresOrphanChoice(activeRunsWarning)) return true;
  return choice !== null;
}
