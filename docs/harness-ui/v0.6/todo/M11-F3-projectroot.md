# M11 — F3 Settings projectRoot 편집 · 작업계획서(체크리스트)

> ✅ **완료(2026-07-10).** 구현·게이트·QA·배선·외부감사 전부 통과. 전 체크박스 완료.
> - **게이트:** typecheck PASS · `npm run test` **441 pass / 1 skip(win32 junction·3-OS CI leg)** · build PASS · v0.5 회귀 0.
> - **경계·config(중대):** D1~D8·env SSOT(HARNESS_PROJECTS_HOME 단일 진실·config.projectsHome 힌트·불변 assert)·config 서브시스템 신규(`lib/config.ts`·per-leaf·원자 RMW·뮤텍스·strict open fail-fast)·`lib/projectroot.ts`(D3 realpath·subSegmentsUnder 플랫폼 대소문자)·dryRun 프리뷰→확인→쓰기(취소 무변경)·부팅 precedence 재검증(필드 독립). F7/F8 공유 config 기반.
> - **QA·배선:** 경계면 0·dead link 0·거부 스위트 전건 fail-closed·ACCEPT(/var·/tmp 조상 심링크) 오거부 0·A94 전역 재연결 오버레이(/healthz)·A97 미프로비저닝·A99 활성 run 통제.
> - **외부감사(codex+agy) R1~R6 → 최종 HIGH 0(양 엔진):** D3 경계(readlink→realpath→O(N²)→canonical→case-variant)·config RMW(손상 throw·lost-update·open fail-fast) 순차 해소. 원장: `_workspace/reviews/m11-code-r*`.
> - **열린 항목(스코프 밖):** projectsHome 프로비저닝 writer=env-only(런처 연계 v0.7)·재시작 트리거=수동 안내·Windows junction CI leg 필요(win32 skip 1건).

> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F3.1~F3.7 · A68~A71 · A85/A94/A97/A99/A101 · §위협 스위트 F3-root.
> 구현 규약: `.claude/skills/harness-ui-impl/SKILL.md` · 보안 대조: `.claude/skills/security-review/SKILL.md` §F3.
> 본 문서는 계획(체크리스트)만. 구현·커밋 금지.

---

## 개요

- **마일스톤:** M11 — F3 projectRoot 편집 (보안 자기완결·독립 배포 가능).
- **리스크 등급: 중대.** 근거: config **쓰기**(첫 config writer)·**신뢰경계(projectsHome containment)** 판정이 코드 경로에 진입·경로탈출 시 임의 디렉토리 read/서빙/CLI cwd 탈취(§F3.2). → 게이트 강도 **강(codex+agy 외부 리뷰 대상: loadConfig·D1~D8·부팅 재검증·POST 계약)**.
- **DoD(설계 §마일스톤):** A68~A71 통과 + F3-root 거부 스위트 전건 거부 + ACCEPT 케이스(`/var`·`/tmp` 절대상위 심링크 통과) 오거부 0.
- **핵심 계약(협상 대상 아님):**
  - 신뢰경계 = **단일 `projectsHome` 조상 containment**. 마커(`.claude`/`CLAUDE.md`/`AGENTS.md`)는 심층방어일 뿐 경계 아님(위조 가능·§F3.2·A69·AS5 확정).
  - config = **가역**(RMW·이전 값 복원). 프로젝트 파일 무변경(I8 유지·config만).
  - 라이브 재바인딩 **비목표** → `requiresRestart:true`, 재시작 반영(§F3.4).
  - 쓰기 순서 = **dryRun 프리뷰 → 확인 → dryRun:false 쓰기**. 취소 시 디스크 무변경(A101).
  - `mutationEnabled`(전면 파일수정 API)는 **불변 비활성** — 조회 배지 유지.

---

## 선행 / 선검증

### 선검증 (착수 전 반드시 해소 — 가정 위에 구현 금지)

- [x] **PV1 — `loadConfig`/config 모듈 미실재 확정(완료).** Grep 결과 `src/server` 전역에 `loadConfig`·`config.json`·`projectsHome`·`definitionEditEnabled` 매치 0 → **F3.7 config 서브시스템은 전량 신규 구축**. "재사용" 표기가 아니라 신규로 공수 반영. (harness-ui-impl §재사용 표기 검증)
- [x] **PV2 — projectsHome 프로비저닝 절차 확정(설계 열린질문 §외부감사 #1).** 설계는 경계를 확정했으나 **프로비저닝 절차는 M11에서 배선**이라 명시(line 636). 착수 전 오케스트레이터에 아래 절차의 단일 출처 확정 요청:
  - 소스 = `HARNESS_PROJECTS_HOME` env **또는** 설치/최초실행이 `<state_home>/config.json`에 기록한 `projectsHome`.
  - **런처 A30 경로 연계** — 최초실행 bootstrap이 projectsHome를 어떻게 안전히 기록하는가(감지된 경로 후보 확인 UX·A97a).
  - 미프로비저닝 시 편집 API `409 boundary-not-provisioned` + Settings 빈 상태 안내(A97a).
  - ⚠️ **미확정 항목:** "설치/최초실행이 projectsHome을 config에 쓰는" writer가 **어디서(런처? 서버 부팅?) 실행되는지** 설계에 절차 없음 → M11 스코프에 이 writer를 포함할지, 아니면 env-only 프로비저닝으로 시작할지 오케스트레이터 판정 필요.
- [x] **PV3 — activeRunsWarning 산출 소스 확정.** `listRuns`(runs.ts:51)가 `status.json` 병합 제공·`supervisor/registry.ts`에 owner 레코드 존재. **"활성 run" 판정 = status.json의 running/live 상태 카운트**로 기존 어댑터 재사용(신규 스캐너 금지). 착수 전 Status 스키마의 running 값·집계 지점 확인.
- [x] **PV4 — cancel(A18) 경로 재사용 확인(완료).** `POST /api/runs/:runId/cancel`(api/index.ts:135) → `cancelRun`(reconcile.ts) 실재. A99 "활성 run 취소 후 재시작"이 이 경로를 재사용.

### 관련 AS 가정

- **AS4(Windows O_NOFOLLOW·lstat junction 미탐, 알려진 한계) [V16·HIGH]:** Windows reparse point(junction·마운트·OneDrive·AppExecLink)는 `isSymbolicLink()=false` + `O_NOFOLLOW` 효과 불일치로 lstat 단독 미탐 가능(agy#5). **∴ D3 reparse 속성(`FILE_ATTRIBUTE_REPARSE_POINT`) 감지 + D2 `realpath`+`isWithinRoot(realpath(projectsHome), realpath(input))` containment를 lstat과 별개의 "최후방어(last-line defense)"로 절대 유지** — lstat이 미탐해도 realpath containment가 projectsHome 밖 대상을 닫는다. **필수 CI 게이트(skip 불가):** 3-OS CI에 **Windows junction/mount/reparse 공격 픽스처**(하위 세그먼트 junction→out-root)를 넣어 D3 거부·D2 containment가 실제로 닫히는지 못박는다. lstat 단독 비의존을 테스트로 증명.
- **AS5(신뢰경계=단일 projectsHome containment) 확정** — 재논의 금지.

---

## 작업 체크리스트

### 서버 (server-builder · `src/server/**`)

#### S-A. 공유 config 서브시스템 신규 구축 (F3.7 · A71) — **F7/F8 세 writer 공유 기반**
- [x] **S-A1** `src/server/lib/config.ts`(신규): `Config_v06` 타입 + `loadConfig(raw): Config_v06`.
  - canonical 버전드 전 필드 스키마 + root `.passthrough()`(미지/미래 필드 보존).
  - **전체객체 strict Zod 금지** — per-leaf 독립 `safeParse`(설계 코드블록 L270~282 그대로).
  - `schemaVersion` 문자열 `"1"` 일관 · `schemaVersion !== undefined && !== "1"` → **throw unsupported-config-schema**.
  - 필드별 fallback: `projectsHome`→null · `projectRoot`→null · `definitionEditEnabled`→false(fail-closed) · `evals`→`loadEvals`(F8용 스텁이라도 per-leaf 재귀 구조 확보).
  - ⚠️ **evals 서브객체:** M11 스코프상 F8은 미착수이나 loadConfig가 **evals를 통째 파싱해 clobber하면 통합감사-#1 재현** → `loadEvals` per-leaf 골격(L285~300)을 M11에서 함께 넣어 형제 보존 계약을 처음부터 확립(F8이 나중에 채움).
- [x] **S-A2** 원자 read-modify-validate-write 헬퍼: `read → loadConfig(전 필드 복구) → 해당 필드만 수정 → 전 필드 재직렬화 → writeJsonAtomic`. `writeJsonAtomic`(atomic.ts) **재사용**(신규 쓰기루틴 금지).
  - [x] **[V9·HIGH] `projectsHome` 불변 런타임 assert(최소 방어선·어느 격리안이든 유지):** RMW 헬퍼가 `loadConfig` 전후 `projectsHome`(신뢰경계 소스)가 **바이트 단위 불변**임을 assert — write 직전 재-read한 디스크 `projectsHome` ≠ loadConfig 시점 값이면 **write 중단·throw**(부분쓰기/미래 writer 실수로 경계 소스가 오염돼 D2 게이트가 무력화되는 것을 런타임에 물리 차단). projectsHome이 **별도 read-only 소스로 분리(권장 기본, 아래 §열린 결정)**된 경우엔 애초에 RMW 대상 밖이므로 이 assert는 이중 방어.
- [x] **S-A3** **in-process 뮤텍스**(ingest `locks` 패턴)로 세 writer 직렬화 → lost-update 차단. M11에선 projectRoot writer만 있으나 뮤텍스는 공유 API로 설계(F7/F8이 물릴 자리).
- [x] **S-A4** config 파일 경로 = `join(stateHome(), "config.json")`(paths.ts `stateHome` 재사용). 부재/손상 → loadConfig fallback로 fail-closed(throw 아님, unsupported-schema만 throw).

#### S-B. 경계 검증 방어층 D1~D8 (A68·A69 · F3-root)
- [x] **S-B1** `src/server/lib/projectroot.ts`(신규) `validateProjectRoot(input, projectsHome): {ok, effectiveRoot|error}`. 순서 고정(§F3.3 흐름):
  - [x] **D1 정규화:** `~` 확장 거부 · 상대경로 거부(절대만) · `..` 세그먼트 거부 · UNC(`\\host\`) 거부 · 드라이브상대(`C:foo`) 거부 · **유니코드 NFC 정규화**(`.normalize("NFC")`).
  - [x] **D2 canonical containment:** input·projectsHome **각각 realpath** → `isWithinRoot(realpath(projectsHome), realpath(input))`(paths.ts `isWithinRoot` 재사용). **절대 상위부 realpath 변경(`/var`→`/private/var`·`/tmp`) 허용 — "realpath≠정규화 거부" 금지(R3-#4·ACCEPT 케이스).**
  - [x] **D3 심링크/reparse 거부 — projectsHome 하위 상대 세그먼트에만:** 절대 상위부는 D2 containment로 보장(lstat 무조건거부 안 함). 하위 세그먼트만 `lstat` 심링크 거부 + **Windows `FILE_ATTRIBUTE_REPARSE_POINT`(junction/mount) 감지·거부**(AS4·lstat 단독 비의존).
  - [x] **D4 denylist:** `/`·`/etc`·`/usr`·`/bin`·`/sbin`·`/sys`·`/proc`·`/dev`·`$HOME` 직속 dotdir(`~/.ssh`·`~/.aws`)·`%SystemRoot%`·`%ProgramFiles%`·`C:\Windows`.
  - [x] **D5 하네스 마커(심층방어):** projectsHome 하위 대상에 `.claude/`·`CLAUDE.md`·`AGENTS.md` 존재 요구(비-하네스 필터). **단독 경로탈출 차단 불가 — 경계 아님**(D2가 실경계).
  - [x] **D6 = D2**(단일 경계 확인·allowedRoots 다중화이트리스트 폐기).
  - [x] **D7 TOCTOU 스왑 재확인:** 검증 시점 realpath와 **지속(쓰기) 직전 realpath 재확인** → 불일치 거부.
  - [x] **D8 fail-closed:** 위 중 하나라도 실패 = `400 { error }`, 지속 안 함(현 root 유지). error 코드 집합: `bad-input`·`symlink`·`reparse-point`·`denied-system-path`·`no-harness-marker`·`outside-projects-home`·`escape`.

#### S-C. POST /api/settings/project-root API (A68·A71·A99·A101)
- [x] **S-C1** 라우트 등록 `POST /api/settings/project-root`. body Zod: `{ path: string, dryRun?: boolean }`(그 외 400). **mutating** → 기존 `security.ts` onRequest 훅이 Host/Origin/token 자동 게이트(추가 배선 불요·확인만).
- [x] **S-C2** 전제 게이트: projectsHome 미프로비저닝 → `409 { error:"boundary-not-provisioned" }`(편집 비활성).
- [x] **S-C3** 공통 검증 실행(양 모드): Zod → D1 → D2 → D6(=D2) → D3 → D4 → D5 → D7.
- [x] **S-C4** **dryRun:true(프리뷰):** 디스크 미변경 → `{ ok:true, effectiveRoot, activeRunsWarning:number, requiresRestart:true, written:false }`(activeRunsWarning=PV3 산출).
- [x] **S-C5** **dryRun:false(쓰기):** D1~D8 **재검증**(D7 재확인 포함) 통과 시 config RMW(S-A2): `projectRoot`만 갱신·`definitionEditEnabled`/`projectsHome`/`evals` 보존 → `{ accepted:true, requiresRestart:true, effectiveRoot, appliedAt, activeRunsWarning }`.
- [x] **S-C6** 응답 코드 매핑: 400(bad-input 계열)·409(boundary-not-provisioned)·성공 200.

#### S-D. 부팅 precedence·필드별 재검증 (A70·A71 · index.ts)
- [x] **S-D1** `index.ts` projectRoot 결정 로직 교체: 소스 우선순위 `HARNESS_PROJECT_ROOT`(env) > config.`projectRoot` > 하드코딩 기본(harness-ui 부모).
- [x] **S-D2** **env·config·API 세 소스 root 전부 D1~D7 재검증(env 예외 없음).** 이기는 소스가 unsafe면 **그 projectRoot 값만 무효화 → 다음 소스로 폴백**(env→config→기본). 하드코딩 기본은 항상 안전.
- [x] **S-D3** **필드 독립 무효화:** projectRoot 손상/부팅검증 실패가 `definitionEditEnabled`·`evals`를 **초기화/폐기하지 않음**(R3-#3b·구 "소스 전체 폐기" 결함 정정). config는 loadConfig로 전 필드 복구 후 projectRoot만 추가 검증.
- [x] **S-D4** `registerApi(app, projectRoot)` 주입은 검증 통과한 effectiveRoot로. 라이브 재바인딩 없음(재시작 모델).

#### S-E. /api/settings 확장 + /healthz 확인 (A94·A97·A101)
- [x] **S-E1** `/api/settings`(statestats.ts:92) 확장: `projectsHome`(프로비저닝 여부·표시), `projectRoot`(effectiveRoot), `mutationEnabled:false`, 프로비저닝 상태 플래그(미프로비저닝→UI 빈상태 A97a). 기존 `settings()` 시그니처 외과적 확장.
- [x] **S-E2** `/healthz`(api/index.ts:143) 실재 확인 완료 — **`/api/` 밖 → session-token 게이트 대상 아님·재시작 중 도달 가능**(A94 전제 충족). 서버측 신규 작업 없음(웹 오버레이가 소비).

### 웹 (web-builder · `src/web/**`)

#### W-A. Settings 편집 폼 (A71·A85·A101 · screens.tsx `Settings`)
- [x] **W-A1** 현 유효값(effectiveRoot) 표시 + 경로 입력 필드 + **"검증" 버튼**. `mutationEnabled` 조회 배지 유지.
- [x] **W-A2** "검증" → `POST project-root {dryRun:true}` → 프리뷰(검증결과·effectiveRoot·activeRunsWarning) 수신. **디스크 미변경.**
- [x] **W-A3** 프리뷰 성공 → **확인 다이얼로그**(영향 명시·비가역 아님·재시작 필요 고지·A85). 확인 시에만 "저장"=`{dryRun:false}` 실제 쓰기.
- [x] **W-A4** **취소 시 어떤 config 쓰기도 안 함**(dryRun만 호출됨·A101). 저장 성공 → 토스트 "저장됨 · 재시작 후 반영".
- [x] **W-A5** 실패 → error 코드 → **한국어 인라인 에러** 매핑(bad-input/symlink/reparse-point/denied-system-path/no-harness-marker/outside-projects-home/escape/boundary-not-provisioned).

#### W-B. 활성 run 고아 경고 (A99)
- [x] **W-B1** 프리뷰 `activeRunsWarning > 0`일 때만 확인 다이얼로그에 **명시적 2선택**:
  - (a) **"활성 run 취소 후 재시작"** → 활성 run들 `POST /api/runs/:id/cancel`(A18) 후 dryRun:false 쓰기.
  - (b) **"헤드리스 계속 승인"** → 통제 상실·API 토큰 소진 명시 인지 후 쓰기.
- [x] **W-B2** `activeRunsWarning === 0`이면 경고 미노출(과경고 금지).

#### W-C. 전역 재연결 오버레이 (A94 · 횡단·재시작 흡수)
- [x] **W-C1** 앱 전역 오버레이 컴포넌트: `GET /healthz` 백오프 폴링. 상태머신 **`offline → health-up → authenticated-bootstrap → ready`**.
- [x] **W-C2** 오버레이는 **health 복구만이 아니라 토큰/bootstrap 재확립(ready)까지 유지**(health-up인데 토큰 만료면 401 폭주 갭 정정).
- [x] **W-C3** 폴링이 **401 감지** 시 "재연결 중"에 갇히지 않고 오버레이 해제 → A84 재인증 동선(런처 링크·bootstrap 재교환)으로 전환(네트워크실패 오인 금지).
- [x] **W-C4** 모든 연결끊김(재시작·종료·네트워크)에 전역 적용 — 개별 "Failed to fetch" 토스트 폭주 억제.

#### W-D. 첫 실행 미프로비저닝 UX (A97a)
- [x] **W-D1** projectsHome 미프로비저닝 → Settings 빈 상태에 **정확한 프로비저닝 액션**: `HARNESS_PROJECTS_HOME` 설정 안내·재시작 명령·감지된 경로 후보 확인(PV2 절차 확정 후). 편집 폼 비활성 + 이유 툴팁(A81 준용·빈 비활성 금지).

#### W-E. 공통 UI 회귀 (A83·A92 — [V6·MED])
- [x] **W-E1 A83 패널별 독립 로딩·부분실패 격리:** Settings의 현재값 표시·검증 프리뷰·activeRunsWarning·오버레이가 각각 독립 로딩/에러로 처리되고 한 영역 실패가 폼 전체를 무너뜨리지 않는다.
- [x] **W-E2 A92 접근성(WCAG AA):** 경로 입력·검증/저장 버튼·확인 다이얼로그·2선택(취소/헤드리스)·인라인 에러가 **키보드 조작 가능**·포커스 링 가시·색 대비 AA·에러/경고 상태를 **색상 단독 의존 없이** 텍스트 병기. 다이얼로그 포커스 트랩·ESC 처리.

---

## 수용기준 → 테스트 매핑

### 통과(positive) + 거부(negative)

| A# | 통과(positive) | 거부(negative) — F3-root 스위트 |
|----|----------------|-------------------------------|
| A68 | `/projectsHome/x/projects/app`(하위 하네스 dir·마커 존재) → 200 accepted. **ACCEPT: `/var/.../projects/x`·`/tmp/.../projects/x` (절대 상위 심링크 realpath 변경) 통과** | 상대경로 · `..` 포함 · `~/proj`(tilde) · `\\host\share`(UNC) · `C:foo`(드라이브상대) · 미정규화 유니코드(homoglyph) → **400 bad-input**. projectsHome 하위 상대 세그먼트가 심링크 → **400 symlink**. Windows junction/mount/reparse 하위 세그먼트 → **400 reparse-point** |
| A69 | 경계 = projectsHome containment 통과분만 수용. env/설치 프로비저닝 경계는 편집 API로 확장 불가(projectRoot만 변경) | **쓰기가능 민감디렉토리에 위조 마커(`.claude`) 생성 후 그 경로 지정 → 거부**(마커는 경계 아님·D2 containment가 막음·outside-projects-home). D4 시스템/민감 경로(`/etc`·`~/.ssh`) → **400 denied-system-path**. 마커 없는 projectsHome 하위 dir → **400 no-harness-marker**. projectsHome 밖 → **400 outside-projects-home/escape**. **미프로비저닝 → 409 boundary-not-provisioned(편집 비활성)** |
| A70 | 세 소스(env/config/기본) 모두 D1~D7 재검증 후 우선순위대로 채택. env-safe가 config를 이김(긴급 복구) | **검증후 스왑(D7 TOCTOU): 검증 통과 후 지속 직전 realpath 변경 → 거부**. **부팅 unsafe-env: `HARNESS_PROJECT_ROOT`가 unsafe → 그 값만 폐기하고 config→기본 폴백**(env 무조건 신뢰 금지). 검증 없이 신뢰하는 소스 0건 |
| A71 | 버전드 봉투 파싱·필드별 독립 복구·원자 RMW(전 필드 보존·뮤텍스). dryRun 프리뷰→확인→dryRun:false 쓰기. 응답 `{accepted,requiresRestart:true,effectiveRoot,appliedAt,activeRunsWarning}`. mutationEnabled 비활성 | **projectRoot 쓰기가 `definitionEditEnabled`/`projectsHome`/`evals` clobber/소거 → 실패해야(보존 assert)**. **projectRoot 손상/부팅실패가 definitionEditEnabled 초기화 → 금지(필드 독립 assert)**. **한 잎(evals.threshold) 손상이 형제·타 필드 리셋 → 금지(per-leaf assert)**. **미지원 schemaVersion → 거부(throw)**. **취소(dryRun만) 시 config 디스크 무변경 assert**. **동시 두 writer → lost-update 없음(뮤텍스 assert)** |

### 횡단 UX 검증
- **A85:** projectRoot 변경 = 확인 다이얼로그(영향 명시) → 성공 토스트 / 실패 인라인.
- **A94:** 재시작 중 통신두절 → 전역 오버레이(상태머신 offline→ready)·401 갭 정정(오버레이 해제→재인증 동선)·개별 에러 폭주 억제.
- **A97a:** 미프로비저닝 → 정확한 프로비저닝 액션·편집 비활성.
- **A99:** activeRunsWarning>0 → 취소/헤드리스승인 2선택.
- **A101:** dryRun 프리뷰→확인→쓰기·취소 시 디스크 무변경.
- **A83 [V6]:** Settings 패널별 독립 로딩·부분실패 격리(한 영역 실패가 폼 전체 미붕괴).
- **A92 [V6]:** 키보드 조작·포커스 가시(다이얼로그 포커스 트랩·ESC)·색비의존·WCAG AA.

### 회귀 (I8 경계 유지)
- [x] F4~F6·F2(읽기전용)·docs(F5) 여전히 파일 무변경 assert. config **외** 프로젝트 파일 쓰기 0.
- [x] `mutationEnabled` 불변 false(전면 파일수정 API 비활성).
- [x] 3-OS CI: D3 reparse/junction 거부(AS4)·D2 realpath ACCEPT(`/var`→`/private/var`) 크로스플랫폼 검증.

### 게이트
`cd harness-ui && npm run typecheck && npm run test && npm run build`. loadConfig·D1~D8·부팅 재검증·POST 계약·per-leaf 보존은 **외부 리뷰(codex+agy) 대상**(중대).

---

## 정합성 / 열린 질문

### 설계 정합 (정본 대비 — 봉합하지 않고 보고)
- **[정합]** 신뢰경계 단일화(projectsHome containment)·마커 비경계·dryRun 순서·필드 독립 무효화·전 필드 보존 RMW — 설계서 §F3.2~F3.7·A68~A71·F3-root 전부 내부 일관.
- **[stale 문구·M11 무영향]** milestone-spec SKILL이 지적한 PRD/page-requirements 헤더 "A47-A71" stale, page-requirements "읽기전용" 문구 — F3는 config 쓰기이므로 page-requirements "읽기전용" 표현이 F3/F7/F8 쓰기를 누락. **문구 갱신 누락일 뿐 계약(config만 쓰기·I8 예외)은 정본과 정합.** 오케스트레이터에 문구 정정만 제안(구현 차단 아님).

### 열린 질문 (오케스트레이터 판정 요청)
1. **projectsHome ↔ API-RMW 파일 동거 위험 ([V9] 권장 기본으로 격상 · 사용자 판정 유지).** 신뢰경계의 소스인 `projectsHome`가 **편집 API가 매 요청 RMW하는 동일 `<state_home>/config.json`에 동거**한다. **→ 이제 열린질문이 아니라 "별도 read-only boundary 파일 또는 env SSOT 분리 + S-A2 불변 assert"를 권장 기본으로 채택**(§소스레벨 검토 반영 §권장 기본 격상). **✅ 사용자 확정(2026-07-09): (a) env SSOT 채택** — `HARNESS_PROJECTS_HOME`를 경계의 단일 진실(SSOT)로, `config.projectsHome`는 read-only 힌트/폴백만(RMW 대상 아님). (b) 별도 파일 폐기. (c) 런타임 불변 assert 병행. (통합감사-#1이 clobber를 막았으나 "경계 소스와 mutable 필드 동거" 구조는 (a) 채택으로 해소.)
2. **재시작 모델의 실제 재시작 주체 불명 (제기).** `requiresRestart:true`이나 **누가·어떻게 서버를 재시작하는가**(런처? 사용자 수동?)가 설계에 절차로 없음. A94 오버레이는 "재시작 중"을 흡수하나 **재시작 트리거 자체**는 스코프 밖으로 보임 → M11이 "수동 재시작 안내"까지만인지, 런처 연계 재시작을 포함하는지 확정 요청.
3. **projectsHome 프로비저닝 writer 위치 (PV2·설계 열린질문).** "설치/최초실행이 config에 projectsHome 기록"의 실행 주체·시점이 M11 스코프인지, env-only로 시작하고 config 기록은 런처(별 마일스톤)로 미루는지 판정 요청.
4. **activeRunsWarning의 "활성" 정의.** status.json running 상태 카운트(PV3)로 재사용 예정이나, 헤드리스 지속 대상 판정에 owner 레지스트리(cross-restart)까지 봐야 하는지 확인 필요.

---

## 소스레벨 검토 반영 (2026-07-09)

> server-builder 소스 재대조(파일:라인). D1~D8 (a)재사용/(b)확장/(c)신규 확정 + config 서브시스템 전량 신규 못박기 + 잔여 판정.

### config 서브시스템 전량 신규 확정 (부재를 파일:라인으로)
- **`grep loadConfig|config.json|projectsHome|definitionEditEnabled src/ = 0 매치**(브랜치 `feat/harness-ui-v0.5`, 2026-07-09 재확인).** → **`lib/config.ts`·`loadConfig`·`Config_v06`·per-leaf safeParse·버전드 봉투·`schemaVersion` throw·원자 RMW·in-process 뮤텍스 = 전량 (c) 신규.** PV1 확정.
- **현 부팅 precedence = `HARNESS_PROJECT_ROOT`(env) → 하드코딩(index.ts:10)** 2단계뿐. config 소스 **없음**. S-D1의 env→config→기본 3단계는 신규 배선. `registerApi(app, projectRoot)`(index.ts:16) 주입점은 재사용.
- **재사용 프리미티브(확정):** `writeJsonAtomic`(atomic.ts:30-32)·`writeAtomic`(atomic.ts:7·temp `wx`=O_EXCL→fsync→rename→dir fsync·0600) = (a) 그대로 재사용. `stateHome`(paths.ts:5-13)·`isWithinRoot`(paths.ts:24-31)·`isSafeSegment`(paths.ts:18-21) = (a) 재사용. **신규 쓰기루틴 발명 금지.**

### D1~D8 실재 재확정
- **D1 정규화 = (c) 신규.** `~`확장/상대/`..`/UNC/드라이브상대 거부·NFC 정규화 로직 부재(`lib/projectroot.ts` 미실재).
- **D2 containment = (a) 재사용.** `isWithinRoot(realpath(projectsHome), realpath(input))`. **realpath≠정규화거부 금지**(`/var`→`/private/var` ACCEPT).
- **D3 심링크/reparse = (b) 확장.** lstat 심링크 거부는 statestats/api 패턴 재사용 가능하나 **Windows `FILE_ATTRIBUTE_REPARSE_POINT` 감지는 신규**(현 코드 어디에도 reparse 속성 검사 없음·AS4).
- **D4 denylist·D5 마커·D6(=D2)·D7 TOCTOU·D8 fail-closed = (c) 신규**(projectroot.ts 신규 모듈).
- **PV4 cancel 재사용 확인:** `POST /api/runs/:runId/cancel`(api/index.ts:135) → `cancelRun(runDir, runId)`(:138) 실재. A99 재사용 유효.
- **PV3 activeRuns:** `listRuns(projectRoot)`(api/index.ts:41) 실재 — status 병합값에서 running 카운트 산출(신규 스캐너 금지).

### 권장 기본 격상 — projectsHome 신뢰경계 격리 ([V9·HIGH · ✅ (a) env SSOT 확정 2026-07-09] · 열린 질문 1 → 확정)
- **구조적 결합 확정:** 신뢰경계 소스 `projectsHome`가 **편집 API가 매 요청 RMW하는 동일 `<state_home>/config.json`에 동거**. loadConfig가 불가침 취급하나 RMW 버그/부분쓰기/미래 writer 실수 시 경계 소스 오염 → 경로탈출 게이트(D2/D6) 자체가 무력화되는 **critical 구조결합**(codex#9+agy#3). "writer가 안 건드림"(주석)만으로 보장하는 것은 불충분.
- **▶ 권장 기본(격상):** **projectsHome을 RMW되는 config.json과 분리** — 아래 (a) 또는 (b)를 **기본 채택**한다(열린질문에서 권장 기본으로 승격). D2 신뢰루트를 mutable 필드와 동거시키지 않는 것이 기본값.
  - (a) **env SSOT 분리 — ✅ 사용자 확정(2026-07-09) · 채택:** `HARNESS_PROJECTS_HOME` env를 경계의 단일 진실(SSOT)로 삼고 `config.projectsHome`는 표시/폴백 read-only 힌트만(RMW 대상 아님). 부팅 시 env 우선 read → 부재 시 config 힌트는 read-only 참고만(경계 판정엔 미사용).
  - (b) ~~별도 read-only boundary 파일 분리~~ **폐기(2026-07-09)** — (a) env SSOT로 대체.
- **(c) 런타임 강제 가드(최소 방어선·병행 필수):** 위 (a)/(b)를 채택하더라도 S-A2 RMW 헬퍼의 `projectsHome 불변 assert`는 **어느 안이든 유지**(이중 방어). (a)/(b) 미채택 시 (c)만으로는 동거 결합이 남으므로 최소선.
- **✅ 결정(2026-07-09 · 사용자):** (a) env SSOT 채택. (b) 별도 파일 폐기. (c) S-A2 런타임 불변 assert는 병행 유지(이중 방어). PV2 프로비저닝은 **env(`HARNESS_PROJECTS_HOME`) 기록 절차**로 정렬(config에 경계 소스를 쓰지 않음).
- 어느 안이든 **A71 거부 테스트에 "RMW가 projectsHome 변경 시도 → 차단(S-A2 assert)" + "projectsHome 소스가 RMW 대상 아님" assert 추가**.

### 거부/ACCEPT 스위트 보강 (F3-root)
- 기존 A68~A71 매핑 유지. **per-leaf 보존 assert 강화:** `evals.threshold` 한 잎 손상 → 형제·`definitionEditEnabled`·`projectRoot` 무영향(S-A1 loadEvals per-leaf 골격 M11 선탑재 근거). **ACCEPT(오거부 금지):** `/var`·`/tmp` 절대 상위 심링크를 realpath 통과하는 정상 projectsHome 하위 경로 → 200.

### 잔여 판정 필요 (오케스트레이터/사용자)
1. **projectsHome 격리안 — [V9] ✅ 확정: (a) env SSOT**(`HARNESS_PROJECTS_HOME` SSOT · `config.projectsHome`는 read-only 힌트·RMW 미대상). (b) 폐기. (c) S-A2 런타임 불변 assert 병행. PV2는 env 기록 절차로 정렬.
2. **PV2 projectsHome 프로비저닝 writer 위치** — M11 스코프(server 부팅? 런처?) vs env-only 시작.
3. **재시작 주체** — requiresRestart:true의 실제 재시작 트리거(수동 안내 vs 런처 연계)가 M11 스코프인지.
4. **activeRunsWarning "활성" 정의** — status.json running 카운트 vs owner 레지스트리 병용.

---

## 외부 리뷰 반영 (2026-07-09 — v0.6-todo-audit · codex+agy)

> 원장: `_workspace/reviews/v0.6-todo-audit_verdicts.json`. 전건 확인 판정(기각 0). 아래는 M11 해당 verdict 반영 결과.

| verdict | 등급 | 요지 | 반영 위치 | 잔여 |
|---------|------|------|-----------|------|
| V9 | HIGH · 사용자 판정 | projectsHome을 RMW config.json에 동거 = D2 신뢰루트 오염 위험 → **별도 read-only boundary 파일 또는 env SSOT 분리를 권장 기본으로 격상**(열린질문→권장 기본) + S-A2 RMW 헬퍼에 projectsHome 불변 assert | S-A2 (불변 assert) · §권장 기본 격상 · 열린 질문 1 | ✅ **확정: (a) env SSOT** (2026-07-09 사용자) · (b) 폐기 · (c) S-A2 assert 병행 |
| V16 | HIGH | Windows reparse(`isSymbolicLink()=false`)·O_NOFOLLOW 이식성 → D3 reparse 감지 + D2 realpath+isWithinRoot 최후방어 절대 유지·3-OS junction 픽스처 필수(skip 불가) | §AS4(HIGH) · 회귀 3-OS CI | — |
| V6 | MED | Settings 웹 파트 A83(패널 독립로딩·부분실패 격리)·A92(키보드·포커스·색비의존·WCAG AA) 회귀 부재 → 추가 | W-E 신규 + 횡단 UX A83/A92 | — |
