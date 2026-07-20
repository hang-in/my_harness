# Harness UI v0.7 — 설계서 (F-CLI 세션 로그 관측 · CLI 실행 가시화)

> 상태: **설계 초안 · 미검증(codex+agy 외부감사 대기).** 정본 = `docs/harness-ui/v0.6/design/design-v0.6.md`(A47-A112·불변식 I1-I8·공용 경화 바운드-리더(앵커 파라미터화·R2-#4)·measured/estimated/unattributed 라벨·DV/DW 위협층)·`docs/harness-ui/v0.5/design/design-v0.5-final.md`(코어 §1-9·A1-A46·로컬 단일사용자·§9-STATE).
> 규칙: 신기능이 불변식을 **깨는 지점을 격리**. 수용기준은 **A113부터** 이어서 부여(측정가능). PRD = `../prd/v0.7-prd.md`.
> 근거(실측·keys만·프라이버시상 내용 미열람): `~/.claude/projects/{enc}/{sessionId}.jsonl`(NDJSON·top-level keys `type`·`sessionId`·`leafUuid`·최대 ~50MB) 존재·디렉토리명 = projectRoot 경로 인코딩(`/`→`-`)·codex `~/.codex/sessions`·`~/.codex/log` 존재(포맷 미확인).

## 0. 불변식 (v0.5/v0.6에서 계승 — 깨면 안 되는 것)
- **I1 fire-and-observe·I2 stdio·I3 execFile·I4 supervisor=저자·I5 보안 게이트(Host/Origin/token·nosniff)·I6 경로 안전(realpath 앵커·심링크 거부·O_NOFOLLOW·`isWithinRoot`)·I7 projectRoot 캡처·I8 읽기전용(F7 스코프 예외뿐)** — 정본 유지.
- **F-CLI는 순수 읽기전용 관측** → I8 예외 아님(파일 무변경·config 옵트인 토글만 `<state_home>` 쓰기).
- **공용 경화 바운드-리더(v0.6·앵커 파라미터화):** `isWithinRoot(anchor, real)`·per-seg `isSafeSegment`·전 하위 세그먼트 심링크/reparse 거부·leaf `O_NOFOLLOW`·`fstat` 정규/크기상한·containment 재확인. **F-CLI가 앵커=`~/.claude/projects/{enc}`(+codex 경로)로 재사용**(v0.6 통합감사 R2-#4 앵커 인자화가 이걸 가능케 함).
- **신뢰 라벨 규율(v0.6):** measured(증거)·estimated·unattributed. **F-CLI는 신규 등급 "CLI 추정(vendor-parsed·best-effort)"** 추가 — measured 아님.

## 0-경계. v0.5 "projectRoot 하위만" 경계의 신중한 확장
v0.5 파일 서빙·인벤토리는 **projectRoot 하위**로 갇혔다(I6·D-계열). F-CLI는 **`~/.claude`(projectRoot 밖·`<state_home>`도 밖)**를 새 read root로 연다 — 이 확장이 이 기능의 유일한 위험이자 존재 이유. 따라서 **명시 옵트인 + 현 projectRoot 스코프 + 경로방어 + 송출 0**을 게이트로 못박고(§CL), 확장 범위를 최소로 격리한다.

---

## F-CLI.1 소스 발견 (현 projectRoot 스코프 · 전역 금지)
- **Claude:** `~/.claude/projects/{enc(projectRoot)}/*.jsonl`. **`enc`는 현 projectRoot 경로를 디렉토리명으로 인코딩**(실측: `/`→`-`)해 **그 한 디렉토리만** 스캔 → **전역 `~/.claude/projects` 열람 금지**(기본). enc 규칙은 assumption(§AS)·매핑 실패 시 "세션 없음"(추측 열람 금지).
- **codex:** `~/.codex/sessions`·`~/.codex/log`(포맷 미확인·assumption) — 미지원 시 graceful degrade(claude 우선·codex "미지원" 표시).
- **스코프 확장(기본 차단):** 타 프로젝트/전역 열람은 **별도 명시 확장 옵트인**(기본 off·§CL2)·v0.7 MVP은 현 projectRoot만.

## F-CLI.2 경화 바운드-리더 (v0.6 공용 프리미티브·앵커=`~/.claude/projects/{enc}`)
v0.6 통합감사-#3 공용 경화 바운드-리더를 **앵커 파라미터**로 재사용:
1. **이름 열거:** 앵커 dir의 `*.jsonl` 이름만 `readdir`.
2. **fs.stat 시간 정렬:** birthtime/mtime desc(최신 세션 우선·runId 형식 무의존 규율 준용).
3. **상위 N만 내용 바운드 read:** 앵커 `isWithinRoot`·per-seg safe·**전 하위 세그먼트 심링크/reparse 거부**·leaf `O_NOFOLLOW`·`fstat` 정규·**라인 cap + 바이트 상한(`MAX_CLI_BYTES`·50MB 트랜스크립트 대비 tail/스트리밍 바운드)**·containment 재확인.
- 앵커가 `~/.claude` 밖(심링크·`..`)을 가리키면 거부. → 대용량·flooding·심링크 리다이렉트 방어.

## F-CLI.3 fail-soft 파싱 (벤더 취약 견딤 · best-effort)
- **버전 관대·라인별 파싱:** NDJSON 한 줄씩·`type` 기반 분기·**미지 type/필드 skip**(벤더 스키마 버전 변동 흡수)·malformed 라인 격리(`quarantined` 카운트·조용한 0 금지).
- **graceful(500 금지):** 파싱 실패가 전체 API/화면을 죽이지 않음 — 부분 결과 + "일부 파싱 불가" 표시. 스키마 전면 미지 시 "이 CLI 로그 포맷 미지원(vendor 변경 가능)".
- **best-effort 라벨:** 모든 F-CLI 파생값은 **"CLI 추정(vendor-parsed·best-effort)"**·measured 아님. `computed_by`류 벤더 필드 신뢰 금지(벤더 소유).

## F-CLI.4 귀속 (best-effort · estimated 규율)
- **에이전트:** 트랜스크립트의 **Task 툴콜 `subagent_type`** → 하네스 에이전트 이름 매핑(존재 시). 불확실/미매칭 = "추정" or "미귀속"(measured 금지).
- **스킬:** **Skill 툴콜** 추출 → 스킬 이름. 없으면 미귀속.
- **정직 라벨:** v0.6 measured/estimated 규율 준용 — CLI 유래는 상한 "추정"·과대표시 금지. 활용도 재도입(백로그) 시 이 등급으로만.

## F-CLI.5 API
```text
GET /api/cli-sessions                 # 현 projectRoot CLI 세션 목록(요약·소스=claude|codex·시간·귀속 추정)
GET /api/cli-sessions/:sessionId       # 세션 상세(이벤트 요약·귀속·메타·원문은 명시 확장)
```
- **옵트인 게이트:** `cliObserveEnabled`(config·§CL1) off면 **API 비활성/빈 응답**(발견·파싱 안 함).
- **스코프:** 현 projectRoot 인코딩 dir만·`:sessionId` = `isSafeSegment`(경로주입 거부).
- **전 `GET /api/cli-sessions*` = side-effect 0**(순수 조회·v0.6 R3 규율·파싱은 요청 처리 내 read-only·쓰기 없음).
- **로컬 게이트:** I5(Host/Origin/token·nosniff) 적용. **UI 밖 송출 0**(외부 fetch·텔레메트리 없음).

## F-CLI.6 프라이버시·보안 위협모델 (신설 CL층 — 중대)
`~/.claude` = 사용자 **전 프로젝트 Claude Code 이력(프롬프트·코드·비밀)**. 새 공격면. 다층 fail-closed:
| 층 | 규칙 | 근거·재사용 |
|----|------|-------------|
| CL1 명시 옵트인 | `cliObserveEnabled`(`<state_home>/config.json`·F3.7 per-leaf·**기본 off·fail-closed**)만 on일 때 발견/파싱. off → API 비활성. 최초 활성 = 고위험 확인(프라이버시 경고: "전 프로젝트 이력 열람") | v0.6 F3.7·A85 |
| CL2 스코프 = 현 projectRoot | 기본 **현 projectRoot 인코딩 dir만**·전역 `~/.claude/projects` 열람 금지·타 프로젝트/전역은 별도 명시 확장(기본 off) | 신규(최소 권한) |
| CL3 경로방어 | **공용 경화 바운드-리더**(앵커=`~/.claude/projects/{enc}`·per-seg·전 하위 세그먼트 심링크/reparse 거부·O_NOFOLLOW·fstat·containment) | v0.6 통합감사-#3 재사용 |
| CL4 읽기전용·송출 0 | read only·쓰기 없음·**UI 밖 송출/텔레메트리 0**·API 로컬 게이트(I5) | I8·I5 |
| CL5 민감정보 최소 표시 | 기본 = **요약/메타**(이벤트 타입·타임스탬프·귀속 추정)·**원문(프롬프트/코드)은 명시 확장 열람**·**secret 패턴 마스킹 best-effort**(키/토큰 정규식)·바이너리/대용량 절단(F5 DV6 준용)·escaped 렌더+DV8(XSS 차단·트랜스크립트도 신뢰 안 함) | F5 DV5-DV8 |
| CL6 fail-soft | 파싱 실패 graceful(500 금지)·malformed 격리·버전 관대 | F-CLI.3 |
| CL7 바운드 | 라인/바이트 cap·이름 열거→시간정렬→상위 N·flooding/OOM 방어 | v0.6 F4 바운드 |
| CL8 신뢰 라벨 | "CLI 추정(vendor·best-effort)" 배지·supervisor measured와 **시각·소스 구분**·과대표시 금지 | v0.6 A61/A62 |

## F-CLI.7 History 통합 (엔티티 구분 · 혼합 금지)
- **별 소스:** CLI 세션은 History에 **"CLI 세션" 소스 배지**로 supervisor run과 **구분 표시**(혼합 금지)·소스 필터(supervisor run / CLI 세션).
- **엔티티 차이 명시:** CLI 세션 ≠ supervisor run — 다른 id(`sessionId` vs `runId`)·구조(벤더 NDJSON vs published schema)·수명·신뢰(CLI 추정 vs measured). 상호 신뢰경계: supervisor run은 §5 published schema(measured)·CLI는 vendor best-effort — **한 목록에 섞되 소스·신뢰 배지로 분리**·정렬은 시간(recordedAt) 공통 축.
- **UI:** Runs(History) 화면에 소스 토글·CLI 세션 행 클릭 → 세션 상세(요약·귀속·원문 명시 확장).

## F-CLI.8 신뢰 라벨 (CLI 추정 = 신규 등급)
- **measured**(supervisor·증거) > **estimated**(v0.6 파생) > **CLI 추정(vendor-parsed·best-effort)** > **unattributed**. F-CLI 값은 상한 "CLI 추정"·배지+툴팁("벤더 포맷 파싱·정확성 미보장·버전 변동 가능")·measured와 시각 구분(과대표시 금지·v0.6 F6.2 비협상 규율 계승).

---

## 수용기준 (A113~ — v0.6 A112 이어서 · 측정가능)
| # | 기준 | M | 층 |
|---|------|---|----|
| A113 | 소스 발견 = **현 projectRoot 인코딩 dir만**(`~/.claude/projects/{enc}`)·전역 `~/.claude/projects` 열람 금지·enc 매핑 실패 시 "세션 없음"(추측 열람 금지)·codex `~/.codex/**`(assumption·미지원 graceful) | M14 | CL2 |
| A114 | 경화 바운드-리더(공용·앵커=`~/.claude/projects/{enc}`): per-seg safe·**전 하위 세그먼트 심링크/reparse 거부**·leaf O_NOFOLLOW·fstat 정규·라인/바이트 cap·containment 재확인·앵커 밖(`..`/심링크) 거부 | M14 | CL3·CL7 |
| A115 | fail-soft 파싱: NDJSON 라인별·미지 type/필드 skip·malformed 격리(`quarantined`)·**graceful(500 금지·부분결과)**·스키마 전면 미지 시 "포맷 미지원" 표시(전체 안 죽음) | M14 | CL6 |
| A116 | best-effort 귀속: Task `subagent_type`→에이전트·Skill 툴콜→스킬·불확실/미매칭="추정"/"미귀속"·**measured 오표시 0**(estimated 규율 준용) | M14 | CL8 |
| A117 | 신뢰 라벨 "CLI 추정(vendor·best-effort)": supervisor measured와 **시각·소스 구분**·툴팁 산정/한계 명시·**과대표시 금지** | M14 | CL8 |
| A118 | History "CLI 세션" **별 소스 구분**(supervisor run과 혼합 금지·소스 배지·필터)·엔티티 차이(id/구조/수명/신뢰) 명시·시간(recordedAt) 공통 정렬 | M14 | — |
| A119 | 옵트인 `cliObserveEnabled`(F3.7 per-leaf·**기본 off·fail-closed**)·off면 API 비활성/빈·발견/파싱 0·최초 활성=프라이버시 고위험 확인·**전역/타 프로젝트는 별도 명시 확장 없이 불가** | M14 | CL1·CL2 |
| A120 | 읽기전용·**UI 밖 송출 0**(외부 fetch/텔레메트리 없음)·민감정보 최소 표시(요약/메타 기본·원문 명시 확장·secret 마스킹 best-effort·대용량 절단·escaped+DV8 XSS 차단) | M14 | CL4·CL5 |
| A121 | codex 로그(assumption): 포맷 미확인 → graceful degrade(claude 우선·codex "미지원/미확인" 표시·거부 아닌 표시) | M14 | CL6 |
| A122 | 전 `GET /api/cli-sessions*` = **side-effect 0**(순수 조회·쓰기 없음)·I5 로컬 게이트(Host/Origin/token·nosniff) | M14 | CL4 |

**신규 수용기준: A113-A122(10개)** — F-CLI. 전체 A47-A122(v0.6 기능 34+UX 21+F8 11+F-CLI 10). 불변식 I1-I8·읽기전용·로컬 단일사용자 준수.

## 위협 스위트 (거부/ACCEPT 케이스 — 감사 검증용)
| 스위트 | 케이스 | 기준 |
|--------|--------|------|
| CLI-프라이버시 | 옵트인 off서 발견/파싱(0)·전역 `~/.claude/projects` 열람(차단)·타 프로젝트 dir 지정(별도 확장 없이 거부)·UI 밖 송출(0) | A119·A113·A120 |
| CLI-경로 | 앵커 밖 `..`·심링크→홈 밖·`:sessionId=../foo`(경로주입)·대용량(라인/바이트 cap)·심링크 트랜스크립트 | A114 |
| CLI-파싱 | 미지 스키마 버전(skip·graceful)·malformed 라인(격리·500 아님)·스키마 전면 미지(포맷 미지원 표시·안 죽음)·트랜스크립트 XSS(`<script>`→DV8) | A115·A120 |
| CLI-라벨/귀속 | CLI 값을 measured로 표시(금지·"CLI 추정")·불확실 귀속을 확정으로(금지·"추정")·CLI 세션을 supervisor run과 혼합(금지·별 소스) | A116·A117·A118 |
| **ACCEPT** | 옵트인 on·현 projectRoot 세션 정상 표시·codex 미지원 graceful 표시·부분 파싱 결과 | A113·A121·A115 |

## 가정 (assumption — 벤더/미확인 격리)
| # | 가정 | 상태 | 미해결 시 영향 | 확인 |
|---|------|------|----------------|------|
| AS-CLI-1 | Claude 트랜스크립트 = NDJSON·`type`/`sessionId`/`leafUuid`·Task/Skill 툴콜 구조로 귀속 가능 | **부분(keys 실측·툴콜 구조 미확정)** | 귀속 정확도↓ → "추정"/"미귀속" 정직 노출(붕괴 아님) | M14 실측 파싱 스모크 |
| AS-CLI-2 | 디렉토리명 = projectRoot 경로 `/`→`-` 인코딩·현 projectRoot→dir 1:1 | **부분(실측 관찰·규칙 미확정)** | 매핑 실패 → "세션 없음"(전역 추측 열람 금지·안전측 실패) | M14 인코딩 확정 |
| AS-CLI-3 | codex 세션 로그(`~/.codex/sessions|log`) 포맷 | **미확인** | codex 미지원 → claude 전용·"미지원" 표시(graceful) | M14 codex 스모크 |
| AS-CLI-4 | 벤더 포맷 버전 안정성 | **불안정 전제(벤더 소유)** | 버전 변동 → fail-soft·best-effort·graceful(비협상) | 상시 fail-soft |
| AS-CLI-5 | secret 마스킹은 best-effort(정규식) — 완전 아님 | 한계 명시 | 일부 비밀 노출 가능 → 최소 표시·원문 명시 확장·로컬 단일사용자 전제 | 마스킹 규칙 리뷰 |

## 마일스톤 (v0.6 M1-M13 이어서 · 게이트=codex+agy)
- **M14 — F-CLI 세션 로그 관측:** 소스 발견(현 projectRoot 스코프)·공용 경화 리더(앵커=`~/.claude/projects/{enc}`)·fail-soft 파싱·best-effort 귀속·옵트인 게이트·History "CLI 세션" 소스·신뢰 라벨. **DoD: A113-A122 + CLI 위협 스위트**(프라이버시/경로/파싱/라벨 거부·ACCEPT) + **실측 스모크**(Claude 트랜스크립트 파싱·codex graceful·AS-CLI-1~3). 읽기전용·회귀 0(I1-I8 불변).

## 리스크·비가역성
| 리스크 | 등급 | 완화 | 검증 |
|--------|------|------|------|
| 프라이버시(전 이력 노출) | **중대** | 옵트인 off 기본·현 projectRoot 스코프·전역 차단·송출 0·민감정보 최소·마스킹 | M14 프라이버시 스위트 |
| 경로탈출(`~/.claude` 새 root) | **중대** | 공용 경화 리더(앵커 인자·심링크/reparse 거부·O_NOFOLLOW·containment) | M14 경로 스위트 |
| 벤더 스키마 취약 | 표준 | fail-soft·버전 관대·격리·graceful·best-effort 라벨 | M14 파싱 스위트 |
| 귀속/라벨 오표시 | 표준 | "CLI 추정"·불확실 미귀속·measured 금지 | M14 라벨 회귀 |
| codex 미확인 | 중 | assumption·graceful degrade | M14 codex 스모크 |

**비가역성 요약:** F-CLI = **완전 읽기전용(비가역 없음)** — 트랜스크립트 파일 무변경·UI 밖 송출 0. 유일 쓰기 = `cliObserveEnabled` 옵트인 토글(`<state_home>` config·가역·F3.7 RMW). I8 읽기전용 원칙 준수(F7 스코프 예외에도 미해당 — F-CLI는 쓰기 아님).

## 다음 단계 참조
- **미해결(assumption):** AS-CLI-1(트랜스크립트 스키마·툴콜 귀속 구조)·AS-CLI-2(디렉토리 인코딩 규칙)·AS-CLI-3(codex 포맷) — **M14 착수 전 실측 스모크로 확정**·미확정분 fail-soft/graceful로 격리. AS-CLI-5(secret 마스킹 best-effort 한계) 정직 표시.
- **핵심 결정 & 이유:**
  - **F-CLI = 읽기전용 관측만** — v0.5/v0.6 불변식(I1-I8) 준수·CLI 쓰기/재개/대화형 아님·유일 쓰기는 옵트인 토글.
  - **프라이버시 게이트 먼저** — `~/.claude`(projectRoot 밖)는 새 공격면 → 명시 옵트인(기본 off)·현 projectRoot 스코프·경로방어·송출 0·민감정보 최소가 1순위.
  - **벤더 포맷 불신** — fail-soft·"CLI 추정" 별 신뢰 등급(measured 아님)·스키마 깨져도 graceful.
  - **엔티티 구분** — CLI 세션 ≠ supervisor run·History 별 소스(혼합 금지)·신뢰경계 명시.
  - **공용 경화 리더 재사용** — v0.6 앵커 파라미터화(R2-#4)가 `~/.claude` 앵커를 안전하게 열게 함.
- **다음 단계:** 이 설계서 A113-A122 + 프라이버시/경로/파싱 위협 스위트 → codex+agy 외부감사 → 수렴 시 M14(F-CLI) 착수(실측 스모크 선행). 백로그(대화형 재검토·활용도 실데이터 재도입·artifact_benchmark·ground-truth·F7 Codex 듀얼)는 F-CLI 위에서 후속 마일스톤 상세설계.
</content>
