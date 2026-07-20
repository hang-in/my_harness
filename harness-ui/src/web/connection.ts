// A94 전역 재연결 — 순수 상태머신(React·fetch 무의존·테스트 대상).
// 상태: offline → health-up → ready. health-up인데 401 → reauth(재연결에 갇히지 않고 A84 재인증 동선).
// 프로브(healthz + 인증 GET) 결과를 phase 로 환원 + 백오프 계산. 컴포넌트는 이 로직을 폴링에 배선.

// 재연결 상태머신 phase.
//  - ready:      healthz up + 인증 확립 → 오버레이 없음(정상).
//  - offline:    healthz 실패(재시작·종료·네트워크 끊김) → "재연결 대기" 오버레이.
//  - health-up:  healthz up 이나 아직 인증 미확립(bootstrap 재확립 중·일시적 비401 실패) → 오버레이 유지(W-C2).
//  - reauth:     healthz up 인데 401 → 오버레이 해제·A84 재인증 동선(런처 재접속)으로 전환(W-C3).
export type ConnPhase = "ready" | "offline" | "health-up" | "reauth";

// 프로브 1회 결과. healthz 먼저(비인증) → up 이면 경량 인증 GET 으로 토큰/bootstrap 확립 확인.
export type Probe =
  | { healthOk: false }                                   // healthz 실패 → offline
  | { healthOk: true; authOk: true }                      // health + 인증 → ready
  | { healthOk: true; authOk: false; status: number };    // health up 이나 인증 실패(401=reauth·그 외=health-up)

// 프로브 결과 → 다음 phase. prev 는 현재 미사용(순수·결정적)이나 확장 여지로 유지.
export function nextConn(_prev: ConnPhase, probe: Probe): ConnPhase {
  if (!probe.healthOk) return "offline";
  if (probe.authOk) return "ready";
  // health up 이나 인증 실패:
  if (probe.status === 401) return "reauth"; // 만료된 토큰 → 재인증(네트워크 실패 오인 금지·W-C3)
  return "health-up";                        // 일시적 비401 → 계속 대기(bootstrap 재확립·W-C2)
}

// 오버레이(재연결 대기) 노출 여부 — offline·health-up 에서만. reauth 는 오버레이 아닌 재인증 UI.
export function showsReconnecting(phase: ConnPhase): boolean {
  return phase === "offline" || phase === "health-up";
}

// 지수 백오프(ms) — attempt 0,1,2… → 0.5s,1s,2s… 상한 30s. 폭주 방지·상한 명확.
export function backoffMs(attempt: number): number {
  const a = attempt < 0 ? 0 : attempt;
  return Math.min(30_000, 500 * 2 ** Math.min(a, 20));
}

// ready 유지 시 서버 종료 조기 감지용 저빈도 폴링 주기(ms).
export const READY_POLL_MS = 10_000;
