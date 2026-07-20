# M14 — F9 Docs(산출물) 소스 설정 작업계획서 (체크리스트)

> ✅ **완료(2026-07-10):** 서버(config additive per-leaf·`docssources.ts` DS1~DS8·`docsTree` walk pre/post TOCTOU 바인딩·소스인지 API)·웹(Settings 소스편집기·Docs 다중소스·nav 토글) 구현. 게이트 green(typecheck·build PASS·792 pass/1 skip). 외부감사 **codex+agy R1~R5 → R4·R5 2회 연속 HIGH 0**(R1 canonical 병합·R2 walk in-request TOCTOU·R3 walk 노드 완전제외 수정, R3 config-passthrough HIGH는 false-positive 기각). 결과서 = `docs/harness-ui/v0.6/working_history/M14_F9-docs-sources_20260710_145552.md`.
>
> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F9.1~F9.5 · DS1~DS8 · A113~A120 · UX A81/A82/A83/A84 준용 · §위협 스위트 F9-소스 · §가정 AS-F9.
> 담당 분리: server-builder=`harness-ui/src/server/**` · web-builder=`harness-ui/src/web/**`. 구현·커밋은 각 builder 몫. 본 문서는 기획·분해·정합성 점검만.
> 구현 금지 문서 — 이 파일은 계획(체크리스트)일 뿐. 커밋·코드 없음.

---

## 개요

- **마일스톤:** M14 = F9 Docs 소스 설정. **실사용 피드백 후속 편입**(설계서 후속 편입 노트). M7~M13 완료 후 착수(M15보다 먼저 — 읽기전용·위험 작음).
- **기능:** F5 뷰어의 화이트루트를 `docs/` 고정에서 **다중 경로 등록 + 메뉴 on/off 토글**로 확장. 각 소스 = `{label, path}`(기본 `{label:"Docs", path:"docs"}`). **F5는 읽기전용 유지(I8 무영향)** — 소스 설정만 `<state_home>/config.json` 쓰기(프로젝트 파일 미변경·F3와 동일 축).
- **사용자 확정 결정(재론 금지):** Docs 소스 = 다중 경로 등록 + 메뉴 on/off. 각 소스는 라벨+경로(기본 `docs`). 각 경로는 F5 화이트리스트/경로탈출/심링크 방어를 **그대로 통과**해야 함.
- **리스크 등급: 표준.** 근거: 다파일·읽기전용 기능 추가 + config 쓰기(F3 인프라 재사용). 새 실행계약 0·mutating 프로젝트 파일 0. **단 소스 경로 등록·열람이 새 경로탈출 표면을 열므로**, 경로 검증 수용기준(A114/A117)은 **중대 강도 검증**(F5 위협 스위트 소스별 재적용)을 받는다 — 기능 전체는 표준, 경로 검증 스텝만 중대-인접.
- **권장 게이트: 표준 강도 + 외부리뷰 1회(codex+agy).** qa-verifier F9-소스 거부 스위트 전건 + security-auditor 소스 경로 검증(DS1~DS8) 코드 대조.
- **DoD:** A113~A120 전건 + F9-소스 위협 스위트(각 소스 경로 탈출/심링크/절대경로/개수·길이 초과 전건 거부·기본 소스 하위호환) + I8 회귀(F5 여전히 읽기전용·config만 쓰기).

---

## 선행 / 선검증 (착수 전 — 가정 위에 구현 금지)

- [x] **[M8 의존·실재 확인됨] F5 뷰어 프리미티브 재사용 가능.** `harness-ui/src/server/lib/servefile.ts:openSafeFile(projectRoot, base, segs, opts)`는 **이미 `base`(앵커) 파라미터화 완료** — 소스별 base만 바꿔 재사용 가능(신규 방어층 0). `sendPreview`/`sendDownload`·`applyFileHeaders`(CSP)·`deniedDocsPath`(security.ts:104)·`isSafeDocsSegment`(paths.ts:30) 모두 실재.
- [x] **[M11 의존·실재 확인됨] F3.7 공유 config 인프라.** `config.ts`의 `Config_v06`·`loadConfig`(per-leaf 복구·root passthrough)·`updateConfig`(원자 RMW·뮤텍스·타 필드 보존)·`withConfigLock` 실재. `docsSources`·`docsMenuEnabled`는 **additive 필드**로 추가(projectRoot/projectsHome/definitionEditEnabled/evals **clobber 금지**).
- [x] **[신규 발견] `docsTree`는 `docs` 하드코딩 — 파라미터화 신규.** `adapters/docs.ts:25 docsTree(projectRoot)`는 `join(projectRoot,"docs")` 고정(:26). **소스 경로(base) 파라미터를 받도록 신규 파라미터화 필요**(순수 재사용 아님). 트리 walk 방어(realpath containment·심링크 skip·MAX_TREE/MAX_DEPTH)는 그대로 유지.
- [x] **[AS-F9] 소스 경로 = projectRoot 상대 전제.** 사용자가 등록하는 소스는 **projectRoot 하위 상대경로만**(절대경로·`~`·`..`·projectRoot 밖 금지). projectRoot 밖 임의 디렉토리 노출은 영구 비목표(F5 §비목표 "docs 밖 임의 파일 브라우저" 정합).
- [x] **[정합성] 기존 `/api/docs` 하위호환.** 현재 `GET /api/docs`(무인자)·`GET /api/docs/*`(api/index.ts:268-279)는 단일 `docs` 소스. F9는 **기본 소스=`docs`로 하위호환 유지**하며 다중 소스·토글을 additive로 얹음(기존 e2e/docsapi 테스트 회귀 0).

---

## 작업 체크리스트

### A. 서버 — config 델타 + 소스 검증 + 소스 인지 API (server-builder · `src/server/**`)

**A-1. config additive 델타 (F9.2 · A113)**
- [x] `Config_v06`(config.ts:15)에 **additive** `docsSources: {label:string,path:string}[]`·`docsMenuEnabled: boolean` 추가. 기본값 `docsSources=[{label:"Docs",path:"docs"}]`·`docsMenuEnabled=true`.
- [x] `loadConfig`(config.ts:44) **per-leaf 독립 복구:** `docsSources`·`docsMenuEnabled` 각 잎 개별 safeParse — 손상 시 그 필드만 기본값(fail-closed), **형제(projectRoot/definitionEditEnabled/evals/projectsHome)·미지 필드 clobber 금지**. `docsSources` 배열은 **요소별** safeParse(스키마 위반 요소만 드롭·유효 형제 소스 보존).
- [x] 쓰기 = `POST /api/settings/docs-sources`(mutating → security.ts onRequest Host/Origin/token 자동·`/api/` 하위 확인)가 `updateConfig`로 `docsSources`/`docsMenuEnabled`만 갱신(타 필드 보존·RMW·뮤텍스). **[V·신규] `ConfigPatch`(config.ts:138)에 `docsSources`/`docsMenuEnabled` 추가**(현재 projectRoot/definitionEditEnabled/evals만) — server-builder 승인 확인.

**A-2. 소스 경로 검증 (config-write 시점 · DS1~DS6 · A114·A115)**
- [x] 각 `path` 검증(신규 — F3 `validateProjectRoot` 규율 준용하되 projectRoot **하위** 상대):
  - [x] DS1: **projectRoot 하위 상대경로만·루트 자체 금지** — 절대경로·`~`·`..` 세그먼트·UNC·드라이브상대 거부·NFC 정규화. **`.`·`""`(빈)·`./`만 = projectRoot 전체 노출 → 거부**(≥1 하위 디렉토리 세그먼트 강제 — "임의 파일 브라우저 금지" F5 영구 비목표 우회 차단·R7 agy MED).
  - [x] DS2: 경로 각 세그먼트 `isSafeDocsSegment`(paths.ts:30 재사용 — 빈/`.`/`..`/separator/제어문자 거부).
  - [x] DS3: base = `join(projectRoot, path)` → realpath 선계산·`isWithinRoot(realpath(projectRoot), realpath(base))` — projectRoot 밖 거부.
  - [x] DS4: base→leaf 전 세그먼트 심링크/reparse 무조건 거부(F5 DV4·`openSafeFile` 규율).
  - [x] DS5: `deniedDocsPath`(security.ts:104) 재적용 — 소스가 민감 디렉토리(`.git`·`.ssh`·node_modules·`.env`) 가리키면 거부.
  - [x] DS6: 소스 **개수 상한**(`MAX_DOCS_SOURCES` 예 16)·`path` 길이 상한(예 512)·`label` 길이 상한(예 80)·중복 경로 병합. Zod strict — 초과 400.
- [x] DS8 fail-closed: 검증 실패 = **400·config 미기록**(취소 시 무변경). `dryRun` 지원(프리뷰·디스크 미변경·F3 `project-root` dryRun 패턴 준용).
- [x] **부팅 시 손상 소스 스킵(형제 보존):** config 로드 시 무효 소스는 스킵하되 유효 소스는 유지(per-leaf).

**A-3. 소스 인지 열람 API (DS7 · A116·A117)**
- [x] `docsTree`를 **base 파라미터화**(`docsTree(projectRoot, base)`) — 소스별 트리(신규 파라미터화). 기존 방어(MAX_TREE/DEPTH·자식 심링크 skip)는 유지하되 **⚠ [R2 agy HIGH·신규] `docsTree`는 `openSafeFile`과 별개 walk 루프** — 현 `docsTree`는 base가 하드코딩(`docs`)이라 **base 자체의 containment를 검사하지 않고** 자식만 `isWithinRoot(realBase, realDir)` 검사한다. base를 파라미터화하면 **등록 후 심링크로 스왑된 base가 projectRoot 밖(`/etc` 등)을 가리켜 전체 시스템을 리스팅하는 경로탈출**이 열린다. → **`docsTree` 진입부에 반드시: (i) `realBase=realpath(base)` 계산 (ii) `isWithinRoot(realpath(projectRoot), realBase)` 검증(실패=거부) (iii) base까지의 전 세그먼트 심링크/reparse 거부**를 명시적으로 추가(="방어 로직 불변"이라 두면 구멍 잔존·`openSafeFile` 의존은 파일 열람 전용이라 리스팅 표면을 못 덮음).
- [x] `GET /api/docs/sources` — 등록 소스 목록 `{id,label,path,valid,enabled}`(valid=경로 검증 통과 여부·enabled=docsMenuEnabled 반영).
- [x] `GET /api/docs?source=<id>` — 지정 소스 트리(기본 = 첫 유효 소스). `docsMenuEnabled=false`면 빈/비활성 응답.
- [x] `GET /api/docs/*?source=<id>` — 지정 소스 하위 파일 열람. **`openSafeFile(projectRoot, sourceBase, segs, {denyPath:deniedDocsPath, isSafeSeg:isSafeDocsSegment})`로 DS7=F5 DV2~DV9 전건 재적용**(경로탈출·심링크·바이너리·크기상한·XSS·CSP). `sendPreview`/`sendDownload` 재사용.
- [x] **열람 시점 재검증(TOCTOU):** config 저장 경로를 신뢰하지 않고 **매 열람마다 소스 base realpath 재확인·전 세그먼트 심링크 재검사**(등록 후 심링크 스왑 차단). 이미 `openSafeFile`이 realpath 선계산·전 세그먼트 lstat 수행 → base만 소스로.
- [x] 기존 `GET /api/docs`(무 source)·`/api/docs/*`(무 source) 하위호환(기본 소스=`docs`).
- [x] **[R1 agy LOW] 즉시 반영(재시작 불요):** `/api/docs*` 라우트는 **요청마다 `loadConfigFromDisk()` 최신본을 읽어** 소스를 서빙 → Settings 소스 변경 시 재시작 없이 즉시 반영(모듈 상수 캐시 금지). **F3(projectRoot는 모듈 상수 캡처 → 재시작 필요)와 성격 다름을 주석·테스트로 명시**(config 변경 후 다음 요청에서 새 소스 반영 assert). **[R2 agy LOW·허용비용] 트리 렌더 시 다수 병렬 에셋 요청마다 256KB config `open→read→parse` 반복 = 로컬 허용 수준(치명 아님). 후속 최적화 여지(mtime 기반 in-memory 캐시·`fs.watch`)는 v0.7 노트로만 남김(v0.6 최적화 비목표).**

**A-4. I8 경계 회귀 (A117·DoD)**
- [x] F5·F9 열람 경로 = **읽기전용**(쓰기 라우트 없음) assert. 소스 설정 쓰기는 `<state_home>/config.json`만(프로젝트 파일 무변경). 소스 등록이 임의 projectRoot 밖 경로 노출로 새지 않음 assert.

### B. 웹 — Settings 소스 편집기 + Docs 메뉴 토글 (web-builder · `src/web/**`)

**B-1. Settings 소스 편집기 (F9.5 · A119)**
- [x] `Settings` 화면(screens.tsx)에 소스 편집기 카드: 소스 목록(라벨+경로 입력·추가/삭제/재정렬)·`dryRun` 검증(경로 유효성·projectRoot 상대·심링크 거부)·인라인 에러(한국어·error 코드 매핑)·저장(`POST /api/settings/docs-sources`).
- [x] **Docs 메뉴 토글**(docsMenuEnabled) — on/off 스위치·저장 시 재검증.
- [x] 위험작업/저장 피드백(A85 준용·성공 토스트·실패 인라인).

**B-2. Docs 화면 다중 소스 + 토글 (F9.5 · A118·A120)**
- [x] Docs 화면(screens.tsx:1157)에 **소스 선택 드롭다운**(`GET /api/docs/sources`)·소스별 트리(`?source=<id>`)·소스별 파일 열람(`?source=<id>`).
- [x] `docsMenuEnabled=false` → App.tsx 사이드바 Docs 항목 **숨김/비활성 + 이유 툴팁**(A81 준용).
- [x] **빈/로딩/에러 3-state**(A82/A83/A84 준용): 소스 0개·전 소스 무효 → "표시할 산출물 소스 없음 — Settings에서 추가"(딥링크). 소스 트리 0건 → "문서 없음". 로드 에러 → 재시도.
- [x] 접근성(A92 준용): 소스 드롭다운·토글·편집기 키보드 조작·색 비의존.

---

## 수용기준 → 테스트 매핑

| A# | 통과(positive) | 거부(negative) — F9-소스 스위트 |
|----|----------------|-------------------------------|
| A113 | config에 `docsSources`/`docsMenuEnabled` additive·기본값(`[{Docs,docs}]`/true)·per-leaf 복구(손상 소스만 드롭·형제 config 필드 보존) | `docsSources` 손상이 projectRoot/definitionEditEnabled/evals **clobber → 거부**(RMW 전 필드 보존)·배열 요소 위반이 형제 소스 소거 금지 |
| A114 | `docs`·`docs/sub` 등 projectRoot 하위 상대 소스 등록 통과 | 절대경로·`~`·`../탈출`·projectRoot 밖·심링크 base·`.git`/`.ssh`/node_modules·**`.`/`""`(루트 전체 노출)** → **400**·config 미기록 |
| A115 | 소스 개수·경로/라벨 길이 상한 내 정상 등록 | 개수 초과·경로 길이 초과·라벨 길이 초과·중복 경로 → **400/병합** |
| A116 | `GET /api/docs/sources` 목록·`?source=<id>` 트리·기본 소스=`docs` 하위호환(무인자 200) | 미등록 source id → 400/빈·`docsMenuEnabled=false`면 비활성 |
| A117 | 등록 소스 하위 정상 md/txt/json/log 열람 200(DS7=F5 DV 재적용) | 소스 하위 `../`·심링크·바이너리·초과크기·XSS(`<script>`·`javascript:`·원격 img)·denylist 파일 → 400/413/attachment(F5 스위트 소스별 전건) |
| A118 | `docsMenuEnabled` on → Docs 메뉴 노출·off → 숨김/비활성+이유 툴팁 | 빈 비활성(이유 없는 disabled) 금지 |
| A119 | (UI) Settings 소스 편집기 추가/삭제/재정렬·dryRun 검증·저장·인라인 에러 | 무효 경로 저장 전 인라인 거부·저장 실패 시 config 무변경 |
| A120 | (UI) Docs 다중 소스 드롭다운·소스별 트리·빈/로딩/에러 3-state·접근성 | 소스 0/무효를 "문서 없음"으로 방치 금지(CTA 제공) |
| (DoD) | — | **I8 회귀**: F5/F9 열람 읽기전용·소스 설정만 config 쓰기·projectRoot 밖 노출 0 |

> **ACCEPT(오차단 금지):** 기본 소스 `docs`(무 source 하위호환)·projectRoot 하위 정상 상대 경로·한글/공백 파일명(isSafeDocsSegment)·`docs` 외 정상 상대 소스(예 `documentation`).

---

## 정합성 / 열린 질문

1. **[소스 id 안정성]** `GET /api/docs/sources`의 `id`를 무엇으로 부여할지(경로 해시 vs 인덱스). 재정렬·라벨 변경 시 딥링크(`#/docs?source=`) 안정성 검토 — server-builder에 명시(경로 sha256 opaque 권장·인덱스는 재정렬 시 흔들림).
2. **[기본 소스 삭제]** 사용자가 기본 `docs` 소스를 삭제 가능한가 = 예(다중 등록의 자연스러운 결과). 전 소스 삭제 시 빈 상태 CTA로 데드엔드 방지(A120).
3. **[DV5 denylist vs 소스 루트]** 소스 루트 자체가 `docs/` 같은 정상 디렉토리면 통과하나, 소스 루트를 민감 디렉토리(`.git` 등)로 지정 시 DS5가 거부 — config-write 시점 검증에 반영(A114).
4. **[문구 stale — 착수 무영향]** PRD/page-requirements 헤더 A-번호가 F9 편입 전 값(A47~A112) → M14 착수 시 A113~A120 편입 확인(§정합성 점검 = spec-planner 메모).

---

## 완료 시 산출물 — working_history 작업결과서 (하네스 작업규칙·의무)

> 하네스 문서 체계(myharness SKILL 5-1·orchestrator SKILL §커밋 순서): 영속 산출물(결과서)은 **`docs/`(커밋 원장)**에 남긴다. `_workspace/`(휘발)에 방치하면 cleanup/재실행 시 소멸 → 감사 이력 0. **프롬프트로 못 막으므로 게이트로 강제**.

- [x] **결과서 기록(의무·T1 1장):** M14 게이트 PASS 직후 `docs/harness-ui/v0.6/working_history/M14_F9-docs-sources_{YYYYMMDD_HHMMSS}.md` 작성(**덮어쓰기 금지**·기존 M7~M13 결과서와 동일 관례). 골격 = `skills/myharness/references/templates/working-history-skeleton.md`.
  - [x] 필수 내용: ①작업 요약(F9 완료 항목) ②변경 파일(경로+사유) ③검증 결과(테스트 통과/전체·회귀·RED→GREEN·**A113~A120 통과 현황**·게이트 수치) ④미해결/후속 ⑤**외부 리뷰 반영**(codex+agy 판정 digest·확인/부분/이월/기각+근거·raw는 `_workspace/reviews/` 링크·본문 복붙 금지) ⑥**`## 다음 단계 참조`**(미해결·핵심 결정과 이유·다음 단계=M15 착수 조건).
  - [x] ⚠ **`## 다음 단계 참조` heading 문자열 유지**(RAG 연속성 진입점·`check-artifacts.sh` 매칭 대상). `_workspace` 소실돼도 이 결과서만으로 판정·근거·다음 단계 자기완결.
- [x] **게이트(커밋 순서):** 리뷰→판정→수정→PASS → `bash .claude/skills/harness-ui-dev/scripts/check-artifacts.sh docs/harness-ui/v0.6 t1`(끝줄 `ARTIFACTS: ok`·missing이면 커밋 차단) → 승인 관문 → 단일 커밋. **pre-commit hook**(리터럴 baked PROJECT=`harness-ui/v0.6`·TIER=`t1`)이 스테이징된 신규 결과서를 물리 검증.

## 발신 대상 (계획서 확정 후)

- **server-builder:** A(서버) — config 델타·소스 검증(DS1~DS8)·소스 인지 API·`docsTree` 파라미터화. 선검증(ConfigPatch 확장·docsTree 신규 파라미터화) 확인 후 착수.
- **web-builder:** B(웹) — Settings 소스 편집기·Docs 다중 소스·메뉴 토글. 서버 계약(응답 필드·error 코드) 확정 후 배선.
- **qa-verifier:** F9-소스 거부 스위트 전건 + A113~A120 통과/거부 매핑 + 기본 소스 하위호환 회귀 + I8 회귀.
- **security-auditor:** DS1~DS8 코드 대조(소스 경로탈출·심링크·절대경로·denylist·개수/길이 상한·열람 시점 재검증 TOCTOU).
