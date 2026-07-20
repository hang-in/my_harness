// F2 에이전트 프리필 New Run — 순수 로직(React·fetch 무의존·테스트 대상).
// D 체크박스 토글(U⊆D 구조 보장)·서버 거부 한국어 매핑(A100·조용한 드롭 금지)·딥링크 focus 파싱(A87).

// run-template 응답(서버 확정 계약·이대로 소비). permissionMode 는 항상 "read-only"(상향은 사용자 명시).
export type RunTemplate = {
  agent: string;
  runtime: "claude" | "codex";
  domainTemplate: string;
  targets: string[];
  suggestedAllowedTools: string[]; // = 상한 D(자유입력 없음)
  permissionMode: "read-only";
  fingerprint: string;
};

// POST /api/runs 성공 응답(exec-run.LaunchResult 미러 — shape 회귀 방지).
export type RunSubmitResult =
  | { dryRun: true; runId: string; runDir: string; preview: { cmd: string; args: string[] } }
  | { dryRun: false; runId: string; runDir: string; pid: number };

// D 체크박스 토글 — allowed(=D) 안의 도구만 켜고/끈다. D 밖 tool 은 무시(구조적으로 U⊆D 보장).
// 반환은 항상 D 순서를 보존(결정적) + U⊆D.
export function toggleSelected(selected: string[], tool: string, on: boolean, allowed: string[]): string[] {
  if (!allowed.includes(tool)) return selected.filter((t) => allowed.includes(t)); // D 밖 무시·정화
  const set = new Set(selected.filter((t) => allowed.includes(t)));
  if (on) set.add(tool); else set.delete(tool);
  return allowed.filter((t) => set.has(t));
}

// 서버 거부(400 unauthorized-tool·409 agent-definition-changed) → 한국어 인라인 메시지.
// A100: 오도상태 제거 — detail(선언되지 않은 도구)을 노출(조용한 드롭 아님).
export function runSubmitErrorText(status: number, code: string, detail?: string[]): string {
  if (status === 400 && code === "unauthorized-tool") {
    const tools = (detail ?? []).join(", ");
    return `선언되지 않은 도구입니다${tools ? `: ${tools}` : ""} · 이 에이전트가 선언한 도구만 선택할 수 있습니다.`;
  }
  if (status === 409 && code === "agent-definition-changed") {
    return "에이전트 정의가 변경되었습니다 · 폼을 새로고침하세요(New Run 다시 열기).";
  }
  if (status === 400 && code === "invalid-request") {
    return "요청이 유효하지 않습니다(입력값 확인).";
  }
  return `제출 실패 (${status}${code ? ` · ${code}` : ""}).`;
}

// 딥링크 focus 파싱(A87) — hash 의 `?run=<id>` → runId. 없으면 null.
// 예: "#/runs?run=build-2026" → "build-2026".
export function focusRunFromHash(hash: string): string | null {
  const q = hash.split("?")[1];
  if (!q) return null;
  const run = new URLSearchParams(q).get("run");
  return run && run.length > 0 ? run : null;
}

// 성공 후 Runs 딥링크 URL(hash 라우팅·runId 세그먼트 인코딩).
export function runsDeepLink(runId: string): string {
  return `#/runs?run=${encodeURIComponent(runId)}`;
}
