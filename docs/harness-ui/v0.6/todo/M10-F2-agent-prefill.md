# M10 — F2 에이전트 프리필 New Run · 작업계획서(체크리스트)

> ✅ **완료(2026-07-10).** 구현·게이트·QA·배선·외부감사 전부 통과. 전 체크박스 완료.
> - **게이트:** typecheck PASS · `npm run test` **338/338 PASS**(38 파일) · build PASS · v0.5 회귀 0.
> - **U⊆D 신뢰경계:** 서버가 `agent` 지정 시 디스크 정의서 tools 재도출(클라 주장 무시)·U⊆D·D 밖 도구 400 unauthorized-tool(조용한 드롭 없음)·제출 시점 D 재도출+fingerprint(409 agent-definition-changed)·UI D 체크박스 구조적 U⊆D. permissionMode 천장 미도입=수용된 한계(A85 확인). manifest.agent writer 배선.
> - **QA·배선:** 경계면 0·dead link 0·거부 스위트 전건·Runs 딥링크·A87.
> - **외부감사(codex+agy) R1~R2 → 최종 HIGH 0(양 엔진):** R1 codex `.toml` tools 미추출·readAgents OOM·fingerprint OS 비결정·딥링크 hash 충돌 순차 해소. 원장: `_workspace/reviews/m10-code-r*`.
> - **테스트 인프라 하드닝(부수):** vitest `fileParallelism:false`+testTimeout 30s — 실서브프로세스 e2e(execrun/supervisor/reconcile/registry)의 CPU 경합 flaky 종결(코드 회귀 아님·전 마일스톤 게이트 결정성 확보). 고아 agy 리뷰어 프로세스 정리.


> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F2.1~F2.4 · 수용기준 A64~A67 · UX A87·A100 · §위협 스위트 F2-에이전트 · 통합감사 R4-#1(제출 시점 D 재도출)·통합감사-#2(Manifest agent 스키마 정정).
> 이 문서는 spec-planner 산출 **계획서**다. 구현·커밋 금지. server-builder / web-builder / qa-verifier / security-auditor 배정 힌트 포함.

---

## 개요

- **마일스톤:** M10 / **기능:** F2 에이전트 프리필 New Run(대화 아님·축소 유지).
- **리스크 등급: 표준.** 근거 — 새 실행 계약 0(기존 `POST /api/runs` 단일경로 재사용), 기본 read-only. 단 **U⊆D 재도출·400/409·경로주입은 보안 관련**이라 표준이되 해당 거부케이스는 security-auditor 필수 검토.
- **권장 게이트:** 표준 게이트. 추가로 §위협 스위트 F2-에이전트 6+ 거부케이스는 병합 전 통과 필수(경로주입·D 밖 tool 400·정의 삭제 후 409). 계약 확장분(RunRequest+Manifest additive·하위호환)은 외부 리뷰 대상.
- **성격:** 서버 = 스키마 델타 + 신규 GET 엔드포인트 + POST 확장(재도출/천장). 웹 = Agents 상세 프리필 폼·D 체크박스 UI·딥링크.
- **DoD(설계 §마일스톤):** A64~A67 + F2-에이전트 스위트 통과 + UX 횡단(A81~A101 중 A87·A100) + 새 실행계약 0(회귀).

---

## 선행/선검증

- [x] **AS 선검증 — F2에 직접 걸린 미검증 가정 없음.** F2는 실 CLI usage(AS1)·differential 리더(AS6)와 무관. 단 아래 코드 실재 갭을 착수 전 확정할 것(가정 위 구현 금지):
- [x] **[코드 갭·필수] `AgentInfo`에 `tools`(=상한 D 원천)가 없다.** 현 `AgentInfo`(`adapters/harness.ts:49`)는 `{name,runtime,sourcePath,role,skills}`만·`readAgents`(L52-70)는 `role=fm.description`·`skills:[]`만 채움 — frontmatter `tools`/`targets`/`domainTemplate`/`permissionMode` 미추출(코드 대조 확정). **D 재도출 소스가 실재하지 않음** → run-template·U⊆D의 전제. 신규 추출 함수(또는 `readAgents` 확장)를 M10 작업으로 계획(재사용 아님·신규 구축).
- [x] **[코드 갭] `parseFrontmatter`(harness.ts:30-47)는 `Record<string,string>`(스칼라만·들여쓴 연속행은 공백 join) 반환.** `tools`가 콤마/공백 나열 문자열이면 **배열 분해 로직 신규** 필요(예: `/[,\s]+/` split → 각 원소 `noFlag`·`max40` clamp·`isSafeSegment` 필터, A64/A65). codex agent(.toml, L63-68)는 `name`만 정규식 추출 — codex `tools` 추출 경로 별도 확인 필요(현 미추출).
- [x] **[코드 갭] `/api/agents/:name`은 `okName`(api/index.ts:25 = 길이 1~200만·공백/경로문자 허용).** run-template은 **`isSafeSegment` 상향** 필요(현 `okName` 재사용 불가 — 별도 가드). `isSafeSegment`는 `.`/`..`/공백/메타 이미 거부 확인됨(`lib/paths.ts:18-21`).
- [x] **[코드 갭] `RunRequest`(exec-run.ts:9-19)에 `agent` 필드 없음.** additive optional 추가 필요. 기존 `noFlag`(L8 `/^[A-Za-z0-9][A-Za-z0-9_.-]*$/`)·`allowedTools`(L16, `.regex(noFlag).max(60)` 배열·`.max(40)`) 재사용.
- [x] **[코드 갭] `exec-run.ts:manifest()`(L43-49)가 `agents:[]`(L47) 하드코딩·단수 `agent` 미기록.** manifest writer에 agent 태그 배선 필요. **스키마 필드 자체(read 측)는 M7 S1이 선반영**(`Manifest`에 additive optional `agent`) → M10은 **writer만 배선**(read/write 분리·M7 정합성 #2 상호 참조).
- [x] **선검증 산출:** 위 갭이 확정되면 server-builder에 "재도출 소스=신규 구축" 명시 통지(공수 반영).

---

## 작업 체크리스트

### 서버 (server-builder · `src/server/**`)

**S1. Manifest writer 배선 — 단수 `agent` 기록(통합감사-#2·A66) · [read/write 분리]**
> **[오케스트레이터 교차조정 결정]** `schemas.ts` `Manifest`에 additive optional 단수 `agent`(nullable·`.default(null)`) **필드 추가(read/파싱 하위호환)는 M7 S1**이 선반영한다(구 manifest→null 마이그레이션 테스트 포함). **M10은 그 필드에 대한 writer(supervisor 기록) 배선만** — 스키마 정의를 재추가하지 않는다(2벌 금지·M7 정합성 #2 상호 참조). M7 미착수 상태로 M10을 먼저 진행하면 스키마 필드 부재 → 오케스트레이터에 순서 조정 보고.
- [x] M7이 추가한 `Manifest.agent`(regex `/^[A-Za-z0-9._-]+$/`·nullable·default null)를 **전제로** 사용(M10에서 재정의 금지). 미존재 시 착수 전 보고.
- [x] `exec-run.ts:manifest()`(L43-49, 현재 `agents:[]` 하드코딩 L47)가 `agent`(요청값 or null) 기록. `agents:[]`(팀 명부)와 **의미 구분**(단일 대상 귀속 태그).
- [x] supervisor `writeManifest` 경로가 새 필드 통과하는지 확인(스키마가 저자·I4).
- [x] **마이그레이션:** 구 manifest(agent 키 없음) 파싱 → `null`(거부 아님) — read 측 검증은 M7 T-S1, M10은 writer 산출물이 새 스키마 통과하는지 확인.

**S2. run-template 엔드포인트 신규(A64)**
- [x] `GET /api/agents/:name/run-template` 등록(`api/index.ts`).
- [x] `:name` = **`isSafeSegment` 가드**(경로주입 `..`·공백/메타 거부). 실패 → `400`. 미존재 에이전트 → `404`.
- [x] 정의에서 프리필 초안 재도출(클라 주장 무시): `{ agent, runtime, domainTemplate, targets, suggestedAllowedTools, permissionMode:"read-only" }`.
- [x] `suggestedAllowedTools` = 정의 frontmatter `tools` → **`noFlag`·max40 clamp**. `permissionMode`는 **항상 보수적 "read-only"**(상향은 사용자 명시).
- [x] **read-only·side-effect 0**(순수 조회).

**S3. D 추출(상한 원천) — 신규(선검증 갭)**
- [x] `readAgents`/`AgentInfo` 확장 또는 전용 `deriveAgentTools(root,name)`: frontmatter `tools` → 배열 분해·`isSafeSegment`/`noFlag` 필터 → 집합 `D`.
- [x] run-template·POST 양쪽이 **동일 재도출 함수** 사용(단일 출처 — 템플릿과 제출의 D 산출이 일치해야 비교 가능).

**S4. POST /api/runs 확장 — 재도출·천장·기록(A65·A66)**
- [x] `RunRequest`에 `agent: z.string().regex(noFlag).nullable().default(null)` additive.
- [x] **`agent` 지정 시 제출 시점에 정의 재조회·D 재도출**(템플릿 시점 D 신뢰 금지·통합감사 R4-#1).
- [x] **U⊆D 강제(제출 D 기준):** 요청 `allowedTools`(U)가 D 부분집합인지 검사. D 내 축소만 허용.
- [x] **D 밖 도구 → `400 unauthorized-tool`(명시 반려·조용한 드롭 금지·A65/A100).**
- [x] **정의 부재 or pathId/해시 변경 → `409 agent-definition-changed`(TOCTOU·천장우회 차단·R4-#1).** 규칙: `allowedTools` 비어있지 않으면 D 재도출 **필수**; agent 지정+정의 재조회 실패 → 409.
- [x] 결과 배열에 서버 Zod `noFlag`·max40 **재검증**(exec-run.ts).
- [x] **`agent` **미지정** 일반 New Run = D 상한 없음 = 기존 v0.5 계약 그대로**(무인자 하위호환 회귀 테스트).
- [x] 통과 시 `manifest.agent` 기록(S1).
- [x] `manifest.agent` 태그 자체는 **형식검증만**(귀속용·경로 조립 아님).

> **409 판정 메커니즘 결정 필요:** "pathId/해시 변경" 탐지에 (a) 최소안=정의 부재만 409 + U⊆D 재검사로 상향 차단, (b) 완전안=run-template 응답에 정의 지문(mtime/해시) echo → 제출 시 재비교. U⊆D 재도출이 이미 상향을 막으므로 (a)로도 보안은 성립하나 설계 문구는 "변경 시 409"를 요구 → 아래 열린 질문 참조.

### 웹 (web-builder · `src/web/**`)

**W1. Agents 상세 진입점(A67·RF2)**
- [x] `screens.tsx` `Agents` 상세 카드에 "이 에이전트에게 요청 (New Run)" 버튼(라벨 RF1/RF2 정합).
- [x] 클릭 → `GET /api/agents/:name/run-template` 로드 → Build **동형 프리필 폼**(런타임·mode·domain·permission·targets 편집 가능).

**W2. allowedTools = D 체크박스 UI(A100·U⊆D 구조 보장)**
- [x] `suggestedAllowedTools`(=D 선언 도구) **체크박스로만** 렌더 — **자유 입력 없음**(구조적으로 U⊆D 보장).
- [x] 헬퍼 텍스트 "이 에이전트가 선언한 도구만 선택 가능".
- [x] 사용자는 D 내에서 **뺄 수만** 있고 D 밖은 추가 불가(UI에 애초에 없음).
- [x] 서버 `400 unauthorized-tool`/`409 agent-definition-changed` → 인라인 에러(한국어 매핑·A100 오도상태 제거).

**W3. 딥링크·착지 배너(A87·A67)**
- [x] 제출 성공 → 생성 `runId`로 **Runs 딥링크** + "→ Runs에서 관찰" 착지 배너(RF3).
- [x] **대화형 아님**(최초 1회 제출·follow-up 요소 없음).
- [x] 사이드바 "실행" 그룹 발견성(RF5) — 기존 IA 내 정합(신규 화면 아님).

**W4. UX 횡단(A81~A101 해당분)**
- [x] 빈/로딩/에러 상태(run-template 404/400 포함)·permissionMode 상향 시 위험 표기.

**W5. A83/A92 회귀([V6 반영])**
- [x] **A83(패널별 독립로딩·부분실패 격리):** Agents 상세 진입점·프리필 폼·D 체크박스 영역·착지 배너가 **각기 독립 로딩/에러 상태**를 가져 run-template 로드 실패나 제출 에러가 Agents 화면 전체를 무너뜨리지 않도록 격리(폼 영역만 에러·상세 카드 유지).
- [x] **A92(접근성 WCAG AA):** 프리필 폼 입력·D 체크박스·permissionMode 상향 위험 표기·인라인 에러(400/409 한국어 매핑)가 **키보드 조작 가능**·**포커스 링 가시**·**색 대비 AA**·**색만으로 상태/위험 구분 금지**(위험 표기·에러를 아이콘/텍스트 병기·체크박스 라벨 프로그램적 연결). qa-verifier/web-builder 공통 회귀.

---

## 수용기준 → 테스트 매핑

### 통과(positive)
| A | 검증(통과 조건) | 담당 |
|---|----------------|------|
| A64 | `GET /api/agents/:name/run-template` 정상 에이전트 → `{agent,runtime,domainTemplate,targets,suggestedAllowedTools,permissionMode:"read-only"}` 반환·`suggestedAllowedTools` noFlag/max40 clamp | server·qa |
| A65 | 요청 U = D 부분집합(축소) → 정상 실행·서버 Zod 재검증 통과 | server·qa |
| A66 | `agent` 지정 제출 → 제출 시점 D 재도출·U⊆D 통과·`manifest.agent` 기록. 구 manifest(agent 없음)→null 파싱 | server·qa |
| A67 | Agents "New Run" → 프리필 편집폼 → 제출 → Runs 딥링크·대화형 아님 | web·qa |
| A47(회귀) | `manifest.agent` optional·구 run은 null·무인자 `GET /api/runs` 하위호환 | qa |
| A100 | UI가 D 선언 도구 체크박스로만 구성(자유입력 부재) → U⊆D 구조 보장 | web·qa |
| A87 | 제출 성공 착지 배너 + runId 딥링크 | web·qa |
| (계약불변) | `agent` 미지정 일반 New Run = v0.5 계약(D 상한 없음) | qa |
| A83(회귀·V6) | Agents 진입점·프리필 폼·D 체크박스·배너 패널별 독립로딩·부분실패 격리(run-template 실패가 화면 전체 붕괴 아님) | web·qa |
| A92(회귀·V6) | 프리필 폼·체크박스·위험표기·인라인 에러 키보드 조작·포커스 가시·대비 AA·색+아이콘/텍스트 병기 | web·qa |

### 거부(negative · §위협 스위트 F2-에이전트 — security-auditor 필수)
| 케이스 | 기대 | 근거 |
|--------|------|------|
| `name=../foo` (경로주입) | run-template `400`(isSafeSegment 거부) | F2-에이전트·A64 |
| `name=a b` (공백/메타) | run-template `400` | F2-에이전트·A64 |
| 미존재 에이전트 | run-template `404` | A64 |
| D 밖 allowedTools 주장(직접 API·상향 시도) | `400 unauthorized-tool`(명시 반려·조용한 드롭 없음) | A65·A100·감사 R1-#9 |
| template↔제출 사이 정의 **삭제** 후 allowedTools 제출 | `409 agent-definition-changed`(천장우회 차단) | A66·통합감사 R4-#1 |
| template↔제출 사이 정의 **변경**(D 축소) 후 옛 U 제출 | 새 D 기준 U⊄D → `400`(또는 지문 불일치 시 `409`) | A66·R4-#1 |
| 삭제된 에이전트 태그(`manifest.agent`) | 형식검증만·무해(경로 조립 아님) | F2-에이전트 |
| ACCEPT: `agent` 미지정 New Run에 임의 allowedTools | v0.5대로 noFlag/max40만 검증(D 상한 무관) | 계약 유지 |

---

## 정합성/열린 질문

1. **[수용된 한계·외부감사 판정 대상] permissionMode 천장 미도입.** **[오케스트레이터 교차조정 결정]** v0.6에서 **U⊆D는 `tools`에만** 적용한다. `permissionMode`는 **run-template 기본 read-only + A85 사용자 명시 확인으로만 상향**하며, **서버측 D 유래(에이전트 정의 `permissionMode`) 상한은 v0.6에서 도입하지 않는다.** 즉 tools는 정의가 천장이나 permissionMode는 서버 천장 없음(사용자 명시 상향 허용). 현 `RunRequest.permissionMode`(exec-run.ts:13, enum `["read-only","workspace-write"]`·default read-only)의 자유 선택은 v0.5 계약과 일치. **이 비대칭(tools=천장 / perm=사용자 명시)은 "수용된 한계"로 명시하되 봉합하지 않는다** — **외부감사 판정 대상**으로 표기(향후 에이전트 정의 `permissionMode`를 상한으로 강제할지, A85 확인 게이트가 충분한 통제인지 외부 리뷰가 판정). server-builder는 D 유래 perm 상한을 임의로 추가하지 말 것(스코프 밖).

2. **[정합·read/write 분리 확정] 통합감사-#2 스키마 모순 해소.** 현 `schemas.ts:Manifest`(L14-28)는 `agents:z.array(string)`(L23)만 있고 단수 `agent` 없음(코드 대조 확정). `harness-ui-impl` 스킬 및 설계 F2.1이 지시한 **additive optional 단수 `agent`**로 모순 해소. **[오케스트레이터 결정] 이 스키마 필드 추가(read/파싱)는 M7 S1이 담당**, **M10 S1은 writer(supervisor 기록) 배선만** — read/write 분리(M7 정합성 #2 ↔ 본 항목 상호 참조). 두 마일스톤이 동일 필드를 재정의하지 않도록 M10은 M7 산출을 전제. 순서: M7 먼저(또는 동시착수 시 스키마 델타는 M7 소유). 설계 정본과 코드 델타 방향 일치 — 봉합 아님, 계획된 델타.

3. **[결정 필요] 409 "정의 변경" 탐지 메커니즘(위 S4 각주).** 설계 문구 "pathId/해시 변경 시 409"를 최소안(부재만 409+U⊆D 재검사)으로 충족할지, 완전안(정의 지문 echo/재비교)까지 구현할지. 보안 불변식(천장우회 차단)은 최소안으로도 성립(제출 D로 U 재검사) — 완전안은 stale 폼 UX 신호. 오케스트레이터 결정 권장(공수 차이).

4. **[정합·경미] `/api/agents/:name`(기존)은 `okName`(공백 허용) 유지, run-template만 `isSafeSegment` 상향.** 두 엔드포인트 가드 강도가 다름 — 의도적(기존은 메모리 필터·FS 접근 아님, run-template은 재도출 진입점). 회귀 방지 위해 기존 엔드포인트 미변경 명시.

5. **[정합] PRD·page-requirements 헤더 stale(A47-A71 / "읽기전용" 문구).** F2는 정본(설계서) 기준으로 계획 — 보조문서 문구 갱신 누락은 M10 착수에 영향 없음(핵심 계약 정합). 필요 시 별도 문구 정정 제안.

---

## 팀 통지 요약
- **server-builder:** S1(Manifest agent **writer만** — 스키마 필드는 M7 S1 소유)·S2~S4(D 추출 신규·run-template·POST 재도출/U⊆D/400/409·manifest.agent 기록). 선검증 갭(`AgentInfo`/`readAgents` tools 미추출·`parseFrontmatter` 스칼라만) 신규 구축 반영.
- **web-builder:** W1~W4(Agents 프리필 폼·D 체크박스 UI·딥링크/배너). 자유입력 금지(A100).
- **qa-verifier:** A64~A67 + A47/A87/A100 통과, 하위호환·마이그레이션(구 manifest→null)·일반 New Run 계약불변.
- **security-auditor:** F2-에이전트 거부 스위트(경로주입 400·D 밖 tool 400 unauthorized-tool·정의 삭제/변경 409 agent-definition-changed·천장우회 차단). **permissionMode 천장 미도입(수용된 한계) 외부감사 판정**(정합성 #1).

## 소스레벨 검토 반영 (2026-07-09)

**검증 완료(파일:라인 실재 확인):**
- `AgentInfo`(harness.ts:49) = `{name,runtime,sourcePath,role,skills}`·`readAgents`(L52-70)는 `tools`/`targets`/`domainTemplate`/`permissionMode` 미추출 확인 → **D 재도출 소스 실재하지 않음**(신규 구축, 재사용 아님) — 선검증 갭 정확.
- `parseFrontmatter`(harness.ts:30-47) `Record<string,string>` 스칼라 반환 확인 → `tools` 배열 분해 신규 필요.
- `/api/agents/:name`(api/index.ts:28-32) `okName`(L25, 길이만) 확인 → run-template은 `isSafeSegment`(paths.ts:18-21) 상향 필요.
- `RunRequest`(exec-run.ts:9-19) `agent` 필드 부재·`noFlag`(L8)·`allowedTools`(L16) 재사용 가능 확인.
- `manifest()`(exec-run.ts:43-49) `agents:[]`(L47) 하드코딩·단수 `agent` 미기록 확인.
- `RunRequest.permissionMode`(L13) enum default read-only·자유 선택 확인 → perm 천장 미도입 정합.
- `POST /api/runs`(api/index.ts:130-134) `RunRequest.safeParse` 단일경로 확인 → 새 실행계약 0(agent additive만).

**보강한 것:**
- 오케스트레이터 교차조정 결정 2건 반영: (1) **Manifest.agent read/write 분리** — 스키마 필드 추가는 M7 S1, M10 S1은 writer 배선만(2벌 금지·상호 참조), (2) **permissionMode 천장 미도입 = "수용된 한계"** 명시 + **외부감사 판정 대상** 표기(봉합 금지·server-builder 임의 perm 상한 추가 금지).
- 코드 갭 항목에 확정 파일:라인·codex(.toml) tools 추출 경로 별도 확인 항목 추가.

**오케스트레이터 판정 필요 잔여:**
- 정합성 #1 permissionMode 천장 미도입(수용 한계·외부감사 판정) · #3 409 "정의 변경" 탐지 메커니즘 최소안(부재만 409+U⊆D 재검사) vs 완전안(지문 echo/재비교) 공수 결정.
- M7↔M10 착수 순서: 스키마 `Manifest.agent` 필드는 M7 소유 → M10이 먼저 착수 시 필드 부재 리스크(동시착수 시 스키마 델타 M7 owner 확정 권장).

## 외부 리뷰 반영 (2026-07-09 — v0.6-todo-audit · codex+agy)

> 원장: `_workspace/reviews/v0.6-todo-audit_verdicts.json`. 전건 확인 판정 중 M10 해당분 반영.

| verdict | 요지 | 반영 위치 | 잔여 |
|---------|------|-----------|------|
| **V6**[MED] | A83(패널별 독립로딩·부분실패 격리)·A92(키보드·포커스·색비의존·WCAG AA) 테스트매핑 전무 | Agents 프리필 폼 웹 파트 **W5 신규**·수용기준표 **A83/A92 행 추가**(회귀) | 없음 |
| (permissionMode 천장) | 정합성 #1 — tools=천장 / perm=사용자 명시의 비대칭 | **이미 "수용된 한계 + 외부감사 판정 대상"으로 반영됨(정합성 #1·팀 통지) — 유지** | 외부감사 판정(향후 perm 상한 강제 여부) |
