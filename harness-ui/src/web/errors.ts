// U1 읽기 에러 한국어 매핑 — 순수 로직(React·fetch 무의존·TDD 대상).
// apiGet 실패(상태코드) → 사용자용 한국어(원시 "500 /api/..." 노출 금지). 네트워크 실패는 A94 전역
// 오버레이가 별도 처리하므로 여기 인라인 문구는 개별 GET 실패 안내(재시도 동선)에 국한.

// apiGet 이 던지는 구조 보존 에러 — 상태코드 매핑용(status 0 = 네트워크/미상).
export class ApiGetError extends Error {
  constructor(public readonly status: number, public readonly path: string) {
    super(`${status} ${path}`);
    this.name = "ApiGetError";
  }
}

// 상태코드 → 한국어. 401=세션 만료(A84 재로그인 동선)·403·404·5xx·기타 4xx.
export function statusErrorText(status: number): string {
  if (status === 401) return "세션이 만료되었습니다 — 런처가 발급한 링크로 다시 접속하세요.";
  if (status === 403) return "권한이 없습니다 — 이 작업이 허용되지 않았습니다.";
  if (status === 404) return "대상을 찾을 수 없습니다 — 이미 삭제되었거나 경로가 변경되었을 수 있습니다.";
  if (status === 429) return "요청이 너무 많습니다 — 잠시 후 다시 시도하세요.";
  if (status >= 500) return "서버 오류가 발생했습니다 — 잠시 후 다시 시도하세요.";
  if (status >= 400) return "요청이 유효하지 않습니다 — 입력값을 확인하세요.";
  return "알 수 없는 오류가 발생했습니다.";
}

// 임의 throw 값 → 한국어. ApiGetError 는 상태코드 매핑, 그 외(fetch reject·TypeError)는 네트워크 오류.
// 네트워크 오류는 전역 재연결 오버레이가 흡수 → 인라인은 간결한 재시도 안내만.
export function readErrorText(e: unknown): string {
  if (e instanceof ApiGetError) return statusErrorText(e.status);
  return "네트워크 오류 — 연결을 확인하고 다시 시도하세요.";
}
