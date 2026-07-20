// U2 라이브 tail — 순수 로직(React·fetch 무의존·TDD 대상).
// running run 의 events 를 nextAfter 커서로 증분 폴링하며 append(중복 없음)·terminal 도달 시 중지.
// 서버 계약(readEvents): { items:[{seq,event,message?}], nextAfter, hasMore, runState, schemaVersion }.

// run 상태 분류(서버 status.state 미러). 표시용 RUN_STATES 와 정합:
//   live(진행 중·tail 대상): running·queued·blocked · terminal(중지): completed·failed·cancelled·stale.
const LIVE_STATES = new Set(["running", "queued", "blocked"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "stale"]);

// 진행 중(확정 live) 여부 — null/미지 상태는 live 아님(하지만 아래 tailDecision 은 계속 폴링).
export function isLiveRunState(state: string | null | undefined): boolean {
  return typeof state === "string" && LIVE_STATES.has(state);
}

// 종료 상태(폴링 중지 판정) — completed/failed 등 도달 시 tail 종료.
export function isTerminalRunState(state: string | null | undefined): boolean {
  return typeof state === "string" && TERMINAL_STATES.has(state);
}

// 폴링 중지 여부 — 명시적 terminal 에서만 중지. null/undefined/unknown 은 "아직 미확정 = 살아있을 수
// 있음"으로 보고 중지하지 않는다(HIGH#1 dead-tail 방지: 막 생성된 run 은 status.json 지연으로
// 첫 응답 runState 가 null 일 수 있는데, 이를 비-live 로 오판해 폴링을 즉시 끊으면 영영 tail 을 못 한다).
export function shouldStopTail(state: string | null | undefined): boolean {
  return isTerminalRunState(state);
}

// 최초 응답 이후 tail 개시(확정 live) 여부 — 표시/전이 판정 보조. 폴링 지속 결정은 tailDecision 사용.
export function shouldTail(state: string | null | undefined): boolean {
  return isLiveRunState(state);
}

// 비-live(null/undefined/unknown) 상태 연속 상한 — 좀비 방지. 상태가 계속 미확정이면 무한 폴링 대신
// 상한 도달 후 중지+안내. 로컬 단일사용자 합리 상한: 20회 × TAIL_INTERVAL(2.5s) ≈ 50s.
export const MAX_NONLIVE_TAIL_POLLS = 20;

// 폴링 지속 결정(HIGH#1 핵심) — 중지는 오직 (a) 명시적 terminal, 또는 (b) 비-live 가 상한만큼 연속될 때.
// live·미확정(null/unknown)은 계속 폴링. nonLiveStreak = 현재 폴링 포함 연속 비-live 응답 수(live 면 0 리셋).
export type TailDecision = "stop-terminal" | "stop-nonlive-cap" | "continue";
export function tailDecision(state: string | null | undefined, nonLiveStreak: number): TailDecision {
  if (isTerminalRunState(state)) return "stop-terminal";
  if (!isLiveRunState(state) && nonLiveStreak >= MAX_NONLIVE_TAIL_POLLS) return "stop-nonlive-cap";
  return "continue";
}

// 다음 커서 — 응답 nextAfter·수집 items 의 최대 seq·현재 커서 중 최대(역행·정체 방지).
// 서버 nextAfter = 페이지 마지막 seq(빈 페이지면 요청 after 그대로) → 항상 단조 증가 보장.
export function nextEventCursor(
  currentAfter: number,
  resp: { items: Array<{ seq: number }>; nextAfter: number },
): number {
  const maxItemSeq = resp.items.reduce((m, x) => (x.seq > m ? x.seq : m), currentAfter);
  return Math.max(currentAfter, resp.nextAfter, maxItemSeq);
}

// 증분 append-only 병합(HIGH#2) — 커서가 단조 증가하고 서버 events 가 seq 순서라 새 items 는 항상
// 기존 마지막 seq 이후분이다. 마지막 seq 이하는 재전송·겹침으로 보고 드롭(O(k) dedup) 후 뒤에 append.
// 전체 배열 재정렬(구 O(N log N)) 제거 → 대량 events 에서 O(k) append. 변화 없으면 참조 동일 반환.
export function mergeEventItems<T extends { seq: number }>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const last = prev[prev.length - 1];
  const lastSeq = last ? last.seq : Number.NEGATIVE_INFINITY;
  const add = incoming.filter((x) => x.seq > lastSeq);
  if (add.length === 0) return prev;
  return prev.concat(add);
}

// tail 폴링 주기(ms) — 2~3s(과밀·부하 회피). backlog(hasMore) 는 즉시 drain 하되 아래 상한으로 폭주 방지.
export const TAIL_INTERVAL_MS = 2500;

// 연속 0ms drain 상한 — 대형 backlog 에서 타이트 루프 폭주 방지. 상한 초과 시 최소 지연으로 전환.
export const MAX_CONSECUTIVE_DRAINS = 50;
// 상한 초과 후 최소 drain 지연(ms) — 0 대신 소량 지연으로 이벤트 루프에 숨통.
export const DRAIN_MIN_INTERVAL_MS = 50;

// 다음 폴링 지연 — backlog 없으면 주기 대기. backlog(hasMore) 면 즉시(0) drain 하되, 연속 drain 이
// 상한(MAX_CONSECUTIVE_DRAINS)을 넘으면 최소 지연(DRAIN_MIN_INTERVAL_MS)으로 폭주를 막는다.
// drainStreak = 현재까지 연속 hasMore drain 횟수(hasMore=false 시 0 리셋). 기본 0(무인자 호출 호환).
export function nextTailDelayMs(hasMore: boolean, drainStreak = 0): number {
  if (!hasMore) return TAIL_INTERVAL_MS;
  return drainStreak < MAX_CONSECUTIVE_DRAINS ? 0 : DRAIN_MIN_INTERVAL_MS;
}
