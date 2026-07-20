# Harness UI v0.5 — 배선도(wiring) + UX 재검토

> 근거: `design-v0.5-final.md`(정본)·README(IA/API). 목적: 화면↔API↔어댑터↔상태파일 연결 누락/오연결 + UX 문제 점검. 외부감사 대상.

## 1. 배선 매트릭스 (화면 → API → 소스)
| 화면 | 소비 API | 어댑터/소스 | 상태 |
|------|----------|-------------|------|
| Overview | `/api/runtimes`·`/api/harness`·`/api/drift`(요약)·`/api/runs`(recent)·**`/api/overview/state-stats`**(A35-38) | claude/codex/workspace/drift 어댑터·정적 파일 | ✅ |
| Build | `POST /api/runs`(dryRun) · `/api/runtimes`(옵션 채움) | supervisor(dry-run 계획) | ✅ |
| Agents | `/api/agents`·`/api/agents/:name`(skills 필드) | claude/codex 에이전트 파서 | ✅ |
| Skills | `/api/skills`·`/api/skills/:name` | SKILL.md 파서 | ✅ |
| Runs | `/api/runs`·`/:id`·`/:id/events`·`/:id/agents`·`/:id/artifacts[/:path]`·`POST /:id/cancel` | supervisor·events.jsonl·artifacts | ✅ |
| Drift | `/api/drift`·`POST /api/drift/sync-plan` | drift 어댑터(무변경 계획) | ✅ |
| Ops | `/api/ops/status`·`/commands`·`POST /commands/:id/run`·`/snapshots[/:id]` | OpsCommand registry·snapshot 파일 | ⚠️ import 경로(하단 U2) |
| Settings | **API 미정의** | — | ❌ **누락(W1)** |

## 2. 배선 결함 (누락/오연결)
- **W1 [누락] Settings API 없음** — IA에 Settings(프로젝트루트·CLI경로·기본모델·sandbox·상태저장경로) 있으나 `GET /api/settings` 미정의. 표시할 소스 없음. → `GET /api/settings`(read-only, 파일수정 API는 v0.5 비활성이므로 조회만) 추가 필요. 값 출처: `/api/runtimes`(CLI경로)·`<state_home>`·설정파일.
- **W2 [오연결 위험] `/api/runs/:id/stream`** — API 목록에 SSE stream 있으나 §Stream 인증·A23은 "기본 cursor polling·쿼리토큰 SSE 금지". stream 엔드포인트를 남기면 화면이 잘못 SSE(쿼리토큰) 배선 유혹. → v0.5는 polling/fetch-stream만, `/stream`은 fetch-streaming(header 인증) 명시 or 제거.
- **W3 [누락 소스] Ops snapshot import 쓰기 경로 없음** — `GET /snapshots`는 읽기. 사용자가 `/usage`·`/status`를 어떻게 `_workspace/ops/snapshots`에 넣나? 업로드 API 없음(설계상 사용자 파일 드롭). → 배선상 UI는 "드롭 위치 안내 + 재스캔" 액션 필요(U2).
- **W4 [정정 — 내 헐루시] `/api/overview/state-stats` 미정의** — 외부감사(codex·agy) 지적: 이 엔드포인트를 todo/리뷰에 썼으나 **설계 §API에 정의 안 함**. A35-A38 API 계약 부재. → 정본 A40으로 **`GET /api/overview/state-stats`(typed Zod collector) 정의**(수정 완료).
- **W6 [누락 — 감사 발견] 화면-필드 배선 불일치:** Build "리소스 제한 설정"↔`POST /api/runs` 필드 없음(A42) · Runs "재시도 기록"↔retry API/필드 없음(A43) · Skills "트리거 조건"↔`triggers` 필드 없음(A43) · Agents "최근 실행 상태"↔run-state join 필요(정적 파서만 아님)(A43).
- **W7 [누락 — 감사 발견] bootstrap 교환 엔드포인트 없음** — A12/A34 fragment→session 교환·무효화 API 미정의 → A41.
- **W8 [누락 — 감사 발견] drift sync-plan 응답 스키마 없음** — 계획 렌더용 `{file,operation,reason,previewDiff,manualSteps,risk}` → A44. artifact list/preview/download 스키마·UX → A45.
- **W5 [확인] Agent 상세 skills 필드** — `/api/agents/:name`에 `skills` 있음(README). 단 v0.5는 선언 스킬(정적), 관측 스킬은 v0.6(observability). 화면이 v0.6 필드 기대하면 오연결 → v0.5 agent 상세=선언만 명시.

## 3. UX 재검토 (사용자경험)
### 흐름별
- **첫 실행(빈 상태):** runs·_workspace 없음 → Overview가 깨지지 않고(A5) **빈 상태 카드 + "Build로 시작" 유도** 필요. 현 설계 empty-state 문구 미정 → U1.
- **run 생명주기:** queued→running→(cancel)→completed/failed. Runs에 상태 label+색·진행률·**cancel 확인(위험작업 dry-run 선표시)**. 장기 run heartbeat stale 표시.
- **Build:** 위험작업(`POST /api/runs`)이라 **dry-run 결과 선표시 후 실행 승인**(설계 §위험작업 준수). 옵션(runtime·permission·model·targets) allowlist 드롭다운.
- **Drift:** sync-plan은 **계획만(무변경)** — UI가 "적용 아님·수동" 명확히(오해로 apply 기대 방지). apply는 v0.5 비활성.
- **Ops:** `/usage`·`/status` = 비활성 참조카드 + **사유 툴팁**("active TTY 필요") + snapshot import 안내. 사용자가 왜 못 누르는지 명확.
- **런처 첫 실행:** fragment 토큰 URL 자동 오픈 → 재실행 시 새 토큰. UX: "이미 실행 중" 표시.

### UX 결함
- **U1 [빈 상태]** 모든 목록(runs/agents/skills/drift)의 empty-state·로딩·에러 상태 미설계 → 3-state(빈/로딩/에러) 표준 필요.
- **U2 [Ops import 경로]** snapshot 드롭 위치·형식·재스캔 버튼·파싱 실패(unparsed) 표시 UX 미흡 → 명시 안내 카드.
- **U3 [위험작업 확인]** `POST /api/runs`·cancel·ops run = dry-run/확인 다이얼로그 UX 표준(설계 §위험작업 dry-run 선표시와 배선).
- **U4 [접근성]** 색+label 병행(설계 원칙) — 상태 배지 색만 금지, 스크린리더 label. WCAG 대비(DESIGN.md near-black·lavender 대비 확인).
- **U5 [토큰 UX]** 최초 접속 fragment URL·재접속·토큰 만료 시 재발급 흐름 안내(사용자가 "왜 접속 안 되나" 혼란 방지).
- **U6 [모바일]** 데스크톱 우선, 모바일 읽기전용 단순화(설계 원칙) — 위험작업 버튼 모바일 숨김.
- **U7 [감사 발견] cancel race** — cancel이 완료 후 도착·stale reconcile과 경합 → **멱등**(terminal state disable·"cancel requested"·409/terminal 처리).
- **U8 [감사 발견] action 에러/retry** — 목록 3-state 외 **action 실패**(cancel·run·ops) 토스트+retry. GET만 자동 retry, POST 위험작업은 확인.
- **U9 [감사 발견] queue/cap·polling** — 동시 run cap·큐 full UI(서버 max-concurrency 계약)·polling interval/backoff·paused-tab.
- **U10 [감사 발견] 키보드 nav** — table/dialog/tab/command 버튼 focus 순서·Enter/Space·Esc close·visible focus.
- **U3 정정:** dry-run 확인은 **run 실행·(향후)drift apply**에만 — 모든 Ops 명령 아님(Ops는 safe-read allowlist만 실행). (감사 정정)

## 4. 반영 제안 (요약)
- 설계 §API: **`GET /api/settings`(read-only) 추가**(W1). `/api/runs/:id/stream`을 fetch-streaming(header)로 명시 or 제거(W2).
- 화면: 3-state(빈/로딩/에러) 표준(U1)·위험작업 확인 다이얼로그(U3)·Ops import 안내(U2/W3)·토큰 흐름 안내(U5)·접근성 label+대비(U4)·모바일 읽기전용(U6).
- 수용 매트릭스 추가 후보: A39(Settings 조회)·A40(빈/로딩/에러 3-state)·A41(위험작업 dry-run 확인 UX)·A42(접근성 색+label·대비).

## 다음 단계 참조
- 이 재검토 → 외부감사(codex+agy) → 확인분을 정본(§API·수용 매트릭스·UI 원칙) + todo M4에 반영.
- 핵심: Settings API 누락(W1)·stream 오연결(W2)이 배선 blocking 후보. UX는 empty/error state·위험작업 확인·접근성이 실사용 품질 좌우.
