# M9 — F6 관측성 계층 B (읽기전용 집계) 작업계획서

> ✅ **완료(2026-07-09).** 구현·게이트·QA·배선·외부감사 전부 통과. 전 체크박스 완료.
> - **게이트:** typecheck PASS · `npm run test` **296/296 PASS**(34 파일) · build PASS · M7 회귀 0 · 읽기전용(supervisor/API 쓰기 0).
> - **과대표시 금지(핵심):** per-value confidence(응답 단일 confidence 없음)·measured=전 기여분 usage 있을 때만(부분→unattributed 강등·value null·0 위장 금지)·claude team/skill=상한 estimated·UI 아이콘+텍스트 배지(색비의존). AS1 usage 픽스처 회귀(measured↔unattributed) DoD 통과.
> - **공용 리더 추출:** `enumerateRunsBounded`/`streamRunEvents`(앵커 `sub` 파라미터·기본 `_workspace/runs`·M13 재사용)·M7 본문 무수정→거부 스위트 회귀 0. `readCappedLines` drain 데드라인+64MB 백스톱(M7/M9 공유 DoS 봉쇄).
> - **외부감사(codex+agy) R1~R3 → 최종 HIGH 0(양 엔진):** R1 measured 부분커버리지 과대표시·scan/streamRunEvents 데드라인 부재, R2 readCappedLines drain 데드라인 우회 순차 해소. rollup.json 캐싱은 대규모 시 이월(AS3). 원장: `_workspace/reviews/m9-code-r*`.

> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F6.1~F6.5 · 수용기준 A60~A63 · UX A90 · §가정 AS1/AS2/AS3.
> 상세 지표표·페이지 구성 단일 출처: `docs/harness-ui/v0.5/design/design-observability.md §2·§3·§7b`.
> 구현 금지 — 본 문서는 체크리스트. 코드/테스트는 server-builder·web-builder·qa-verifier가 수행.

## 개요

- **스코프:** F6 = 실행 파생 통계(토큰·비용·실패패턴·리뷰수렴·활용도)의 **읽기전용 on-read 집계**. 계층 A(A35-A38)는 v0.5 M4 출하 완료 → 본 마일스톤은 **계층 B**만.
- **신규 페이지 0(A63).** metrics는 기존 Overview / Agents / Skills 화면 **내부 편입**.
- **리스크 등급: 표준**(읽기전용·비-mutating·경로탈출 신규면 없음 — 공용 경화 리더 상속). **단 등급을 결정하는 실질 위험은 "과대표시(over-reporting)"** = 추정/미귀속 값을 정확값(measured)처럼 노출하는 것. 이 위험은 보안이 아니라 **신뢰성/정직성** 축이며 A61/A62/A90의 비협상 라벨 규칙으로 통제.
- **권장 게이트:** 표준. `cd harness-ui && npm run typecheck && npm run test && npm run build` + **AS1 CLI 픽스처 회귀 스위트**(measured↔unattributed) 필수 통과 + qa-verifier 리뷰. security-auditor는 공용 경화 리더 앵커 파라미터화(통합감사-#3)만 확인(신규 경로탈출면 없음).
- **건드릴 파일 후보:**
  - 서버(server-builder, `src/server/**`): `adapters/metrics.ts`(**신규**), `adapters/runs.ts`(공용 경화 리더 앵커 파라미터화·FS-time 정렬·상위 N 열거 확장 — F4/M7 산출 재사용), `api/index.ts`(라우트 3종 추가), 필요 시 `schemas.ts`(집계 결과 타입은 서버 로컬 타입으로 충분·published 스키마 변경 지양).
  - 웹(web-builder, `src/web/**`): `screens.tsx`(Overview 효과성 카드 + Agents/Skills usage 섹션), `ui.tsx`(confidence 배지 컴포넌트 신규 — 아이콘+텍스트), `api.ts`/`web/api.ts`(metrics 페치 훅).
  - 픽스처(qa/server 공용): `test/fixtures/cli-usage/*`(**신규** — usage 有/無 CLI 출력 샘플).

## 선행/선검증

### 선행 의존 (착수 전 확인 — 오케스트레이터 판정 대상)
- [x] **P0 — F4(M7) 산출물 실태 + 공용화 책임 [결정 반영·확정].** A60은 "F4 스캔 재사용·F4 공용 경화 바운드-리더 상속"을 명문화. 현재 코드(`adapters/runs.ts`) 실태(2026-07-09 대조):
  - `safeRunDir`(L14-29)에 realpath 앵커(L20-22)·leaf lstat 심링크 거부(L23-24)·containment 재확인(L26)은 있으나 **앵커가 `runsDir(root)`=`_workspace/runs` 하드코딩(L16-17)**(파라미터 아님).
  - `safeOpen`(L33-42)·`readJsonSafe`(L43-49)는 파일명 allowlist·O_NOFOLLOW·fstat 정규파일 — 재사용 가능.
  - `listRuns`(L51-67)는 **전 디렉토리 열거** — FS-time(birthtime/mtime) desc 정렬·상위 `MAX_RUNS_SCAN` 캡 **미구현**.
  - `readEvents`(L89-121) FileHandle 스트리밍(`readLines`·MAX_LINE 256KB·전체 read 금지)은 재사용 가능(양호).
  - → **결정(봉합 아님):** M7은 앵커 파라미터화를 **하지 않고** 기존 `safeRunDir`를 `_workspace/runs`로 그대로 사용. FS-time 정렬·상위 N 열거는 M7 `queryRuns`가 신규 산출(F6이 그 열거 패턴 준용). **앵커 파라미터화(공용 리더 추출)는 M9 S1이 책임**(2번째 앵커 등장 지점) — M13(F8)이 재사용. **하드코딩 앵커 2벌 금지**(통합감사-#3). M9가 M7 열거 로직(FS-time 정렬·상위 N)을 흡수·공용화하되 M7 거부 스위트 회귀 0 보장.
- [x] **P1 — events.agent/skill/usage 소비 경로 확인.** `schemas.ts` L64-69에서 `agent`/`skill`/`usage`(nullable) 선반영 실재 확인 완료. F6은 **events의 per-event `agent`/`skill`로 귀속**(manifest 단수 `agent`는 F2/M10 델타 → **M9는 M10에 의존하지 않음**). agent별/skill별 롤업은 events 필드 기준으로 명시.

### AS1 선검증 — CLI 실 usage 방출 (필수·회귀 스위트)
> 설계 §가정 AS1 상태 = **부분(스키마 선반영·실 방출 미검증)**. `measured`는 usage 증거 실존 시에만 부여. 부재 시 `unattributed` 강등(승격 절대 금지).

- [x] **AS1-a — 고정 CLI 출력 픽스처 2종 확보:** (1) usage **있는** 샘플(claude `result.usage` stream-json/`--json` · codex `TokenCount`), (2) usage **없는** 샘플. `test/fixtures/cli-usage/`에 events.jsonl 형태로 고정.
- [x] **AS1-b — measured↔unattributed 회귀 테스트:** usage 有 픽스처 → run 총량 `measured`, usage 無 픽스처 → 동일 지표 `unattributed`로 **강등**(measured 미승격·0 위장 없음)을 assert. 이 스위트는 **DoD 필수**(설계 §마일스톤 "AS1 스모크·estimated 라벨 회귀").
- [x] **AS1-c — 실 CLI 방출 스모크(가능 시):** 실제 CLI 1회 실행 산출 events에 usage 필드가 실존하는지 관측. 관측 불가/불일치 시 A61을 정직히 "픽스처 기반 강등 회귀"로 한정하고 실 방출 미검증을 열린 질문에 기록(가정 위 구현 금지).

## 작업 체크리스트

### 서버 (server-builder · `src/server/**`)

**A. 공용 경화 바운드 on-read 리더 (M9가 추출·공용화 — 2번째 앵커 등장 지점)**
> **[오케스트레이터 교차조정 결정]** M7(F4)은 기존 `safeRunDir`(runs.ts:14-29)/`safeOpen`(L33-42)을 앵커=`_workspace/runs`로 **그대로 사용**(파라미터화 안 함). F6이 **동일 앵커를 두 번째로 사용**하는 지점 → **M9가 `runs.ts`에서 `safeRunDir`/`safeOpen`을 앵커 파라미터로 추출·공용화**하고, M13(F8, `evals-rollup` 앵커)이 그 공용 리더를 재사용한다. **2벌 구현 금지**(통합감사-#3: 앵커는 파라미터·하드코딩 금지).

- [x] S1 — **[V3 확정·이 지점이 "공용 JSON/바운드 리더" 추출 책임]** `runs.ts`에서 `safeRunDir`/`safeOpen`(+ M7 신규 `readJsonCapped`)을 **앵커 파라미터로 추출**(anchor를 인자로 받는 공용 리더로 리팩토링; M7이 사용 중인 `_workspace/runs` 호출부는 anchor 인자 명시로 이관 — 기존 계약·거부 동작 회귀 0). 통합감사-#3 준수: 선계산 realpath 앵커·`isWithinRoot(anchor, real)`·per-세그먼트 `isSafeSegment`·전 하위 세그먼트 심링크/reparse 거부·leaf `O_NOFOLLOW`+`fstat` 정규파일·`MAX_JSON_BYTES`·open 후 containment 재확인. **[V3·리더 2종 구분]** 이 공용 리더는 **JSON/바운드 on-read 리더**(status/manifest/events 파싱용·`fstat.size` 캡·`readJsonCapped`)이며, **M8의 파일서빙 리더("safe file viewer" — 임의 산출물 스트리밍/뷰어)와는 다른 리더다**. 두 리더를 하나로 합치지 말 것(관심사·크기정책·응답형태 상이). **M13(F8) 선행 의존은 이 공용 JSON/바운드 리더를 가리킨다**(별도 앵커 `<state_home>/evals-rollup`로 재사용). **회귀 게이트: M7 `queryRuns`·`listRuns`·`getRun`·`readEvents`(L69-121)의 기존 거부 스위트(F4 R-1~R-8) 전건 유지.**
- [x] S2 — **이름 열거 → `fs.stat` birthtime/mtime desc 정렬 → 상위 `MAX_RUNS_SCAN`개**만 내용 read(R3-#1·R4-#1: runId 형식 무의존·**결정적 최신 N**·무작위 부분집합 아님). 스캔 바운드/페이지네이션은 F4.3 준용. **[V13 반영·truncated 두 원인 분리]** 집계 스캔도 M7과 동일하게 절단 원인을 **`truncatedReason: "limit_reached" | "deadline_exceeded" | null`로 분리**해 커버리지 메타(S8)에 노출 — 스캔 캡 도달과 `SCAN_DEADLINE_MS` 초과를 혼동하지 말 것. 데드라인 초과 부분집계는 **커버리지 신뢰도 하락으로 정직 반영**(0 위장 금지). `MAX_RUNS_SCAN`은 M7과 동일 상수(V13 현실화·예 1000)를 공유.
- [x] S3 — 손상 run **quarantine**(파싱 실패 skip·집계에서 제외·집계 신뢰도에 반영, 조용한 0 위장 금지).

**B. metrics 집계 어댑터 (`adapters/metrics.ts` — 신규)**
- [x] S4 — `overview()` 집계: 성공/실패율·평균 소요·재작업률·리뷰수렴(계층 B 지표표 §2 계약). run 총량 토큰은 events.usage 실파싱 시 `measured`, 부재 시 `unattributed`.
- [x] S5 — `agents()` 롤업: events.agent별 토큰·호출·성공. **claude team agent = 상한 `estimated`**(분해 미보장 → measured 절대 불가·AS2). codex agent별 usage 실존 시에만 measured, 부재 시 unattributed.
- [x] S6 — `skills()` 롤업: events.skill별 호출·점유 = **상한 `estimated`**(토큰 경계 없음 → measured 불가). **미사용/고아 목록**(정적 정의 존재 ∧ 관측 window 내 0회).
- [x] S7 — **per-value confidence(핵심):** 응답의 **각 metric 값**이 자기 `confidence:"measured"|"estimated"|"unattributed"`를 개별 동반. **응답 단일 confidence 금지**(한 응답에 measured/estimated/unattributed 공존 가능).
- [x] S8 — **커버리지 메타 동반(A90):** 각 집계에 관측 window(스캔한 run 수·기간)·신뢰도(measured 비율 등)·**`truncated`/`truncatedReason`([V13])**을 노출 → UI가 "선택 window 내 관측 없음 + 커버리지 + 절단 원인(상한 도달 vs 시간 초과)"을 정직 표기할 수 있게.
- [x] S9 — **읽기전용 불변:** supervisor·API 어떤 쓰기도 없음(I4/I8 무영향). rollup.json 쓰기 미도입(이월).

**C. API 라우트 (`api/index.ts`)**
- [x] S10 — `GET /api/metrics/overview` · `GET /api/metrics/agents` · `GET /api/metrics/skills` 3종 등록. 각 엔드포인트 스캔 바운드·페이지네이션(F4.3 준용·동일 OOM 방어). 입력(있으면) Zod·clamp.
- [x] S11 — 빈/손상/디렉토리 없음 → 안전 빈 응답(A5be 준용·에러 아님).

### 웹 (web-builder · `src/web/**`)

- [x] W1 — **confidence 배지 컴포넌트 신규(A62·A90):** measured/estimated/unattributed = **아이콘 + 텍스트**(색만으로 구분 금지)·`measured`와 시각 구분·**툴팁에 산정식**. 기존 `Badge`(ok/warn/err/muted)와 별개(재사용 불가 — 의미 다름).
- [x] W2 — **Overview 효과성 카드(A63·A91):** 성공률·재작업률·미사용 에이전트/스킬·리뷰수렴. `/insights`를 Overview로 흡수. **progressive disclosure**(계층 A 요약 → 계층 B 상세 접기·과밀 방지·A91).
- [x] W3 — **Agents 상세 usage 섹션(A63):** 토큰·호출·연결·선언≠관측 gap. per-value confidence 배지 부착.
- [x] W4 — **Skills 상세 usage 섹션(A63):** 호출·점유(estimated)·미사용 목록.
- [x] W5 — **anti-Goodhart(A63):** 행동유도형 지표(미사용/고아/방치) 위주·순위/점수 최소화·측정→제안(자동 강제 금지).
- [x] W6 — **관측 window UX(A90·UX-R2-#3):** "dead/미사용" 단정 **금지**. 바운드 최근-N에서 0회면 **"선택 window(관측 기간·run 수) 내 관측 없음" + 커버리지·신뢰도 명시**. 진짜 "dead"는 전 생애 증거(정적 정의 존재 ∧ 전기간 무관측)일 때만.
- [x] W7 — **정확값 위장 금지(A62):** estimated/unattributed를 measured처럼 렌더 금지·0 위장 금지·툴팁 산정식 노출.
- [x] W8 — 3-state(빈/로딩/에러·A46) 및 기존 화면 패턴(테이블+상세 패널) 준수(A91).
- [x] W9 — **[A83/A92 회귀 · V6 반영]** **A83(패널별 독립로딩·부분실패 격리):** Overview 효과성 카드·Agents usage 섹션·Skills usage 섹션·confidence 배지 영역이 **각 metrics 엔드포인트별 독립 로딩/에러**를 가져 한 집계(예 `/api/metrics/skills`) 실패가 Overview 전체를 무너뜨리지 않도록 격리(부분 렌더 + 해당 패널만 에러). **A92(접근성 WCAG AA):** confidence 배지(measured/estimated/unattributed)·커버리지 표기·usage 테이블이 **키보드 조작 가능**·**포커스 링 가시**·**색 대비 AA**·**색만으로 구분 금지**(배지는 이미 아이콘+텍스트 규칙 W1과 정합 — 색 단독 금지 재확인). qa-verifier/web-builder 공통 회귀.

## 수용기준 → 테스트 매핑

| A/AS | 통과(positive) | 거부/강등(negative) |
|------|----------------|---------------------|
| **A60** | `GET /api/metrics/{overview,agents,skills}` 정상 집계 반환; 바운드 on-read(상위 N만 내용 read)·전수 무제한 스캔 없음; supervisor/API 쓰기 0(읽기전용 assert) | 심링크로 재앵커된 `_workspace/runs`·하위 세그먼트 심링크/reparse → 거부(통합감사-#3·A50 상속); 앵커 하드코딩 2벌 검출 시 실패 |
| **A61** | usage **有** 픽스처 → run 총량 `measured`; codex agent usage 실존 → measured | usage **無** 픽스처 → 동일 지표 `unattributed` **강등**(measured 미승격); claude team agent → measured **거부**(상한 estimated·AS2); skill → measured 거부(상한 estimated); **응답 단일 confidence 반환 시 실패**(per-value 필수) |
| **A62** | estimated/unattributed 배지 + 산정식 툴팁 렌더; measured와 시각 구분(아이콘+텍스트) | 추정/미귀속을 measured처럼 표시 → 실패; 0 위장(누락을 0으로) → 실패 |
| **A63** | Overview 효과성 카드·Agents/Skills usage 섹션 렌더; **F6 신규 페이지 0**(라우트 추가 없음 assert); 미사용/고아 강조 | anti-Goodhart 위반(순위/점수 강제·자동 강제) 검출 시 실패 |
| **A90** | measured/estimated/unattributed 아이콘+텍스트 배지·툴팁 산정식·window/커버리지 표기 | 0회를 "dead/미사용"으로 단정 → 실패; 색만으로 구분(아이콘/텍스트 없음) → 실패 |
| **AS1(회귀)** | 픽스처 usage 有→measured / 無→unattributed 회귀 스위트 통과(DoD 필수) | 실 CLI 방출 미검증을 measured 근거로 삼음 → 실패(가정 위 구현 금지) |
| **마이그레이션** | 구 events(agent/skill/usage=null)·구 run → null 파싱·거부 아님·집계에서 안전 제외 | 구 데이터로 파서 throw/500 → 실패 |
| **A83**(회귀·V6) | Overview/Agents/Skills 패널별 독립 로딩·부분실패 격리(한 metrics 엔드포인트 실패가 전체 붕괴 아님) | 단일 집계 실패로 Overview 전체 blank → 실패 |
| **A92**(회귀·V6) | confidence 배지·커버리지·usage 테이블 키보드 조작·포커스 가시·대비 AA·색+아이콘/텍스트 병기 | 색만으로 confidence 구분·키보드 도달 불가 → 실패 |

> qa-verifier: A60/A61/A62/A63/A90 + AS1 회귀 전건. security-auditor: A60 앵커 파라미터화·통합감사-#3 심링크/reparse 거부 상속만(신규 경로탈출면 없음 확인).

## 정합성 / 열린 질문

1. **A60 "F4 재사용" vs 현재 코드 실태(선행 P0) — [결정 반영·확정].** `runs.ts` 현재 앵커 하드코딩·전수 열거 확인. **결정:** M7은 기존 `safeRunDir`를 `_workspace/runs`로 그대로 사용(파라미터화 안 함), **M9 S1이 앵커 파라미터화(공용 리더 추출)를 담당**(2번째 앵커 등장 지점)하고 M13(F8)이 재사용. 즉 M9는 "M7이 산출한 FS-time 정렬·상위 N 열거를 흡수 + 앵커 파라미터화 추출"의 혼합 — 순수 재사용 아님(공수 반영). 단일 공용 리더·2벌 금지. (판정 완료·봉합 아님.)
2. **rollup.json 증분 이월(AS3·F6.3).** v0.6 MVP = 바운드 on-read(supervisor 무변경·읽기전용). `_workspace/metrics/rollup.json` 증분(supervisor 저자)은 **규모 폭증 시 이월** — 본 마일스톤 **비스코프**. 채택 시 쓰기는 supervisor(I4 정합·API는 read 유지). 계획에 미포함이 정본과 정합.
3. **on-read 성능(AS3·미검증 가정).** 로컬 단일사용자·run 수 바운드에서 상위 N on-read가 충분하다는 가정. `MAX_RUNS_SCAN` 값 설계서 미확정 → server-builder가 F4.3 바운드와 일치시켜 결정하되 상한 문서화. 실사용 관측으로 검증(폭증 시 #2로 이월). → **열린 질문: `MAX_RUNS_SCAN` 확정값**.
4. **manifest 단수 `agent` 부재(M10 델타).** F6 agent 귀속은 **events.agent** 기준(manifest.agent 아님) → M9는 M10에 무의존. 이는 정본 F6.3(events 소비)과 정합. 혼동 방지 위해 명시.
5. **AS1 실 방출 미검증.** events usage 실 CLI 방출 일관성은 미검증 가정 — 픽스처 회귀로 로직은 검증하되, 실 방출 부재 시 measured가 실환경에서 나오지 않을 수 있음(강등 정상 동작). 이는 결함이 아니라 설계된 정직 강등. 실 스모크 결과를 오케스트레이터에 보고.

## 소스레벨 검토 반영 (2026-07-09)

**검증 완료(파일:라인 실재 확인):**
- `safeRunDir`(runs.ts:14-29) 앵커 하드코딩(`runsDir(root)` L16-17)·`safeOpen`(L33-42)·`readJsonSafe`(L43-49)·`listRuns` 전수 열거(L51-67)·`readEvents` 스트리밍(L89-121) 실태 확인 — P0 라인 인용 정확.
- `schemas.ts` events `agent`/`skill`/`usage`(nullable) 선반영(L64-69) 실재 확인 — P1 정확. `Usage`(L31-36)는 `inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens` partial.
- `adapters/metrics.ts` **부재** 확인 → 신규. metrics 라우트 **부재**(api/index.ts) 확인 → S10 신규 3종.
- manifest 단수 `agent` 부재 확인 → F6 귀속은 events.agent 기준(M10 무의존) 정합.

**보강한 것:**
- **S1을 "M9가 앵커 파라미터화 추출·공용화하는 지점"으로 명확화**(오케스트레이터 교차조정 결정). M7=기존 그대로 사용·M9=`runs.ts`에서 `safeRunDir`/`safeOpen` 앵커 파라미터 추출·M13=재사용. 2벌 구현 금지 명시.
- P0·정합성 #1을 "판정 완료·확정"으로 갱신(M9가 추출 책임·M7 거부 스위트 회귀 0 게이트).
- M9 추출 시 M7 F4 거부 스위트(R-1~R-8) 회귀 0 게이트를 S1에 명시(공용화가 기존 방어를 깨지 않도록).

**오케스트레이터 판정 필요 잔여:**
- 정합성 #2 rollup.json 증분 이월(비스코프 확인) · #3 `MAX_RUNS_SCAN` 확정값(F4.3과 일치·**V13 현실화로 5000→1000 검토·M7과 동일 상수 공유**) · #5 AS1 실 CLI 방출 미검증(픽스처 회귀로 한정·실 스모크 보고).

## 외부 리뷰 반영 (2026-07-09 — v0.6-todo-audit · codex+agy)

> 원장: `_workspace/reviews/v0.6-todo-audit_verdicts.json`. 전건 확인 판정 중 M9 해당분 반영.

| verdict | 요지 | 반영 위치 | 잔여 |
|---------|------|-----------|------|
| **V3**[HIGH] 일부 | 공용 리더 추출 책임 불일치 — **M9가 `runs.ts`에서 추출·파라미터화하는 지점**임을 확정. JSON/바운드 리더 vs M8 파일서빙 리더 혼재 | S1에 **"이 지점이 공용 JSON/바운드 리더 추출 책임"** 명시·**M8 safe file viewer는 다른 리더**로 구분·**M13 선행 의존이 이 공용 JSON/바운드 리더를 가리킴** 명시 | M13 계획서의 선행 표기 정합(M13 담당) |
| **V13**[HIGH] | truncated 두 원인(캡 vs 데드라인) 혼동 | S2/S8에 **`truncatedReason: limit_reached\|deadline_exceeded\|null`** 분리를 metrics 스캔·커버리지 메타에 동일 적용·데드라인 초과 = 신뢰도 하락 정직 반영 | `MAX_RUNS_SCAN` 확정값(M7과 공유) |
| **V6**[MED] | A83/A92 테스트매핑 전무 | **W9 신규**(Overview/Agents/Skills 패널별 독립로딩·부분실패 격리 + WCAG AA)·수용기준표 **A83/A92 행 추가** | 없음 |
