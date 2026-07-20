# M13 — F8 Eval(평가 대시보드 + 자기개선 제안 + 지표관리) 작업 체크리스트

> ✅ **완료(2026-07-10) · 비례성 축소안 채택.** 구현·게이트·QA·외부감사 전부 통과. 전 체크박스 완료.
> - **축소안(codex+agy 권고·사용자 위임):** v0.6 = **Part A(읽기 대시보드) + Part B(제안·사람 승인·자동 적용 금지) + Part C(지표 config)**. **암호 원장(체인 rollup·키링·회전·durable nonce·HMAC 서명·ingest-receipt·WAL)은 v0.7 이월**(로컬 단일사용자·항상 사람 승인·자기채점=약증거에 비례·설계 F8.8/AS10 정합). 제안 적용 = F7 편집기 수동(DW11 fail-closed 유지·자동 적용 경로 0).
> - **게이트:** typecheck PASS · `npm run test` **647 pass / 1 skip** · build PASS · v0.5~M12 회귀 0.
> - **교리 준수(A102~A112):** 전 GET side-effect 0 · alignment_score=정합도(품질 아님)·missed/overturned null="미측정" · 자동 적용 절대 금지 · floor(30/10/3·effective=max) · 발화 게이트 runId dedup+rolling window(29/9/null 금지·과거누적 우회 차단) · Stage4 display-only 잠금(POST 4→400·read 4 수용) · DV8(scorecard=데이터·표 excerpt·상세 SafeMd) · 경로안전(M9 리더 재사용·인덱스 latest-only OOM 차단) · 재도출 검증(verdict_counts 불일치→verified=false 게이트 제외·R7).
> - **외부감사(codex+agy) R1~R2 → 최종 HIGH 0(양 엔진):** 인덱스 전수스캔 OOM·게이트 발화 우회·terminationReason DV8 순차 해소. 원장: `_workspace/reviews/m13-code-r*`.
> - **후속(v0.7/폴리시):** 암호 원장·verdicts.json ingest("동일 경계 N회" 트리거)·인덱스 truncated 루프 생략 UI 고지·build-scorecard.sh↔loop-self-eval.md summary 경로 stale.


> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F8.1~F8.8 · A102~A112 · AS8/AS9/AS10 · §위협 스위트 F8행.
> 담당 분해: server-builder = `src/server/**` · web-builder = `src/web/**`. 검증: qa-verifier(A-번호 통과/거부) · security-auditor(F8 거부 스위트·crypto 실재).
> 구현 금지 문서 — 이 파일은 계획(체크리스트)일 뿐. 커밋·코드 없음.

---

## 개요

- **기능:** F8 = 9번째 화면 "Eval". self-eval 시스템(`skills/myharness/references/loop-self-eval.md`·`scripts/build-scorecard.sh`)을 UI로 연결. Part A(읽기)·Part B(제안+사람승인)·Part C(config).
- **리스크 = 중대.** crypto 서브시스템 신규 구축 + `_workspace`(반신뢰) ↔ `<state_home>`(신뢰) 도메인 경계 + config write. 권장 게이트 = **중대**(외부 리뷰 codex+agy 2인·거부 스위트 전건 실행·fail-closed 코드대조).
- **최대 결합 노드.** F8은 **M12(F7 적용경로 DW11)·M11(F3.7 공유 config)·M8(F5 safe file viewer·경로방어 DV)·M9(공용 JSON/바운드 리더)에 모두 의존**한다([V3] 정정: JSON/바운드 리더는 M9, 안전 파일 서빙은 M8 — 두 리더 구분). 설계서 §마일스톤이 "방어 확실히 된 뒤 마지막"으로 못박은 이유 = 이 결합. 4개 선행 마일스톤이 모두 완료돼야 착수 가능.
- **분리 가능성(중요).** 설계서 §milestone-spec·§마일스톤 자체가 "일정 압박 시 자연스러운 컷 지점·별도 릴리스 가능성 열어둘 것"이라 명시.

> ## ⚠️ 상단 열린 결정 — 비례성 축소안 (착수 前 오케스트레이터 판정 필수)
>
> **전면 crypto 스택(체인 rollup·키링 회전·durable nonce·독립 receipt·owner/mode 검증 = 전부 신규 대형 구축)을 무조건 v0.6에 넣는 것은 열린 결정이다. 임의로 밀어붙이지 말 것.**
>
> - **축소안(권장 검토):** v0.6 = **Part A(읽기 + `_workspace`↔서버 재도출 검증·표시)** + **Part B(제안·근거·DV8·사람 승인만·자동 적용 절대 금지)** + **Part C(config per-leaf + floor)** 까지만. **암호 원장 게이트(체인 rollup·키링 회전·durable nonce·receipt)는 v0.7 이월.** Part B 게이트는 rollup 대신 **in-process 재계산 + 사람 승인 backstop**(자동 적용 0 → 위조 rollup이 자동 개악으로 이어질 경로 애초에 없음).
> - **근거:** 로컬 단일사용자·항상 사람 승인 신호. 위협모델 안(방어 대상)은 사실상 "반신뢰 `_workspace` scorecard 위조" 하나이며 최종 backstop이 사람 승인 → 전면 crypto 원장이 위협 대비 비례하는지 의문. 설계서 F8.8·AS10이 "HMAC=무결성이지 진위 아님·자기채점=약증거·사람 승인 backstop·`<state_home>` 장악=게임오버(범위 밖)"을 이미 규정.
> - **반대 논거(병기):** 서명 envelope + durable nonce는 A107 "제안 은밀 교체/replay 차단"의 최소 방어 — 자동 적용이 없어도 값이 있다. **이 최소선(envelope+nonce)까지만 남기고 체인 rollup/키링만 이월**하는 중간안도 판정 대상.
> - 축소안 채택 시 M13 공수 대폭 감소 + 설계서 인정 "자연스러운 컷 지점"과 정합. **교리 라벨·자동 금지·backstop은 어느 안이든 유지.**
>
> **착수 blocked:** 4개 선행(**[V3 정정] M9 공용 JSON/바운드 리더**·**M8 F5 safe file viewer + DV**·M11 F3.7 config·M12 F7 DW11)이 **모두 완료돼야** 착수 가능(§P1). 미완 상태 착수 금지. (구 "M7 F4 앵커 파라미터화" 표기는 정정 — JSON/바운드 리더 추출은 실제 M9, 안전 파일 서빙은 M8.)

---

## 선행 / 선검증 (착수 전 게이트 — 미충족 시 M13 착수 불가)

### P1. 선행 마일스톤 완료 의존 (코드 부재 확인됨 — Grep 근거)
- [x] **M11(F3.7 공유 config) 완료.** `loadConfig`·`config.json`·`definitionEditEnabled`·`projectsHome`가 코드에 **전무**(`Grep loadConfig|config.json|definitionEditEnabled|projectsHome ⇒ No files found`). F8 Part C(A110)는 F3.7 `loadConfig` per-leaf 확장에 얹혀야 하므로 **F3.7 canonical 버전드 전 필드 스키마 + root `.passthrough()` + per-leaf 복구 + 원자 RMW가 실재해야 착수 가능**. 미완이면 M13은 blocked.
- [x] **M12(F7 편집기 + DW11) 완료.** `evalProposal` 필드·PUT `…/definition` mutating 경로 코드 **전무**(`Grep evalProposal ⇒ No files found`). A107 제안→적용은 **F7 DW11 실집행**(nonce 소비·envelope 검증·payload 정확 일치)에 의존. F7 mutating 게이트(`definitionEditEnabled` 기본 off·baseHash 409·`writeAtomic`·`.bak` 롤백)가 실재해야 함.
- [x] **[V3·HIGH] M8(F5 safe file viewer + DV1~DV9) 완료 — *파일 서빙 리더*.** 제안 카드 렌더(A105·DV8 sanitizer/CSP/scheme 화이트리스트/외부리소스 차단)와 evals **파일 열람/서빙**(경로방어·심링크 거부·크기상한)을 M8의 `serveSafeFile` 앵커 파라미터화본으로 재사용. **이것이 파일 콘텐츠 서빙 리더**(바이너리/미리보기/다운로드 정책 포함).
- [x] **[V3·HIGH] M9(공용 JSON/바운드 리더) 완료 — *JSON 리더*(구 "M7 앵커 파라미터화" 정정).** A102 evals scorecard/summary/rollup **JSON read** = **M9가 추출한 공용 JSON/바운드 리더**(`readJsonCapped` 계열 — `safeOpen`+`fstat.size`+`MAX_JSON_BYTES` 제한읽기·전체 readFile 미호출, anchor=`_workspace/evals`·`<state_home>/evals-rollup` 등 하드코딩 금지). **JSON 리더(M9) ≠ 파일 서빙 리더(M8)** — 두 리더는 책임이 다르므로 혼용 금지. **JSON/바운드 리더 추출 책임은 M7이 아니라 M9임을 확정**(codex#3+agy#8) — M9에서 앵커 파라미터화·크기상한 리더가 실제로 완료됐는지 P1 선확인.

### P2. verdicts 원장 스키마 선검증 (재도출-후-서명의 신뢰 근거 — AS8/AS10)
- [x] **`verdicts.json` 스키마 실재·안정성 확인.** `build-scorecard.sh`가 소비하는 계약(`{loop, stage_id, rounds, diff_lines, risk_level, termination_reason, issues:[{fingerprint, verdict∈confirmed|partial|deferred|rejected|duplicate, round, source}]}`). 서버가 이 원장에서 `alignment_score = (confirmed + 0.5·partial)/(confirmed+partial+rejected)`·`verdict_counts` 등을 **독립 재계산**해야 함(R7). → **이 원장이 서버가 실제로 읽을 수 있는 경로에 산출되는지, 스키마가 build-scorecard.sh와 일치하는지 선검증.** 없으면 A102 "재도출-후-서명"이 근거 없는 oracle이 됨(에스컬레이션).
- [x] **재계산 로직 = build-scorecard.sh 미러링.** 서버 재도출 값이 스크립트 계산과 동일함을 픽스처로 회귀(precomputed 신뢰 안 함·불일치 시 격리).

### P3. AS 가정 표기 (가정 위에 쌓지 말 것)
- [x] **AS8** — 서명키 UI 서버 배타 보유(`O_EXCL`·0600·재생성 금지·서명주체=서버). *현 코드: `hmac.ts`=`session.key` 단일키, evals 전용 키·키링·회전 전무.* → 신규 구축. **서명·키링·재구축 픽스처 필수.**
- [x] **AS9** — 체인 rollup(해시체인=과거 무결성·head HMAC=진위)·durable nonce가 `_workspace` 위조·in-session rollback을 방어. **`<state_home>` 조율 rollback(cross-restart)은 out-of-scope(게임오버·F8.8).** → 과claim 금지·best-effort watermark 픽스처.
- [x] **AS10** — 서명·재도출 = 무결성이지 진실성 아님. 판정 원장 자체가 자기판정 = 약증거. **최종 방어 = 사람 승인 backstop.** → 교리 회귀(자동 적용 경로 0·Stage 4 쓰기 경로 없음).

---

## 작업 체크리스트

> **범례:** [S]=server-builder / [W]=web-builder.
>
> **★ [V11·MED] crypto 전 항목 = (c) 신규 구축. 기존 `hmac.ts`/`registry.ts`는 "생성/검증 *패턴* 참고"만이지 기능 재사용 아님.** 코드 대조 확정(2026-07-09):
> - `hmac.ts` = 세션 토큰 단일키(`session.key`)만 — evals 전용 키·키링·회전 **부재**. `sign`/`verify`(timingSafeEqual)의 **패턴**과 `getSessionKey`의 `O_EXCL`·0600 생성 **패턴**만 미러(별개 키 `evals-hmac.key`, session.key 재사용 금지·도메인 분리).
> - `registry.ts` §4-A = HMAC **서명만** 검증 — **owner-uid/mode-bit 미검증**(신규). `registry.ts:16`의 `nonce`는 owner 레코드 단일 랜덤 필드일 뿐 durable **상태머신 아님**(신규).
> - `loadConfig`·`evalProposal`·`evals-rollup`·`evals-nonces`·`evals-receipts` = 전량 부재(M11/M12 산출 + 신규).
> - **⚠️ 설계서 본문 정정 권고:** 설계서 F8.5 표·본문의 "재사용 hmac.ts / registry.ts §4-A" 표현은 **기능 재사용으로 오독될 소지** → 설계서 본문도 "패턴 참고·기능 신규"로 정정 권고(오케스트레이터 전달). 상세 = §정합성 재사용 오표기 목록.

### Part A — 평가 결과 확인 (읽기 · ingest 백그라운드) — 표준~중대

**A-1. 데이터 소스 read (F8.1b) — [S]**
- [x] `_workspace/evals/{loop}/{stage_id}/{run_id}/scorecard.json` 및 `summary.jsonl` read를 **[V3] M9 공용 JSON/바운드 리더(앵커=`_workspace/evals`)**로. realpath 앵커·per-seg `isSafeSegment`·전 하위 세그먼트 심링크/reparse 거부·leaf `O_NOFOLLOW`·`fstat` 정규파일·`MAX_JSON_BYTES` 제한읽기(전체 readFile 미호출)·containment 재확인. (파일 원문 열람/서빙이 필요하면 M8 파일 서빙 리더 — 두 리더 혼용 금지.)
- [x] strict 스키마 파싱 + graceful(malformed→격리·500 DoS 금지).
- [x] `eval-unavailable`(jq 부재 등) 상태 그대로 통과 표시.

**A-2. GET API = side-effect 0 (A102) — [S]**
- [x] `GET /api/evals`(loop 목록·최근 요약)·`GET /api/evals/:loop`(신뢰 rollup 추세)·`GET /api/evals/:loop/:stage/:run`(scorecard 상세).
- [x] **전 GET에서 ingest·서명·append·상태변경 절대 없음**(순수 조회). → 거부 스위트 "GET이 ingest" 테스트로 side-effect 0 assert.
- [x] `/:loop` 추세 = **`<state_home>/evals-rollup`에서만** 소싱. `_workspace/summary.jsonl`은 표시 소스 아님(표시 시 "미검증" 배지).

**A-3. ★ ingest 백그라운드 잡 (F8.1·신규) — [S]**
- [x] **서버 부팅/주기 백그라운드 잡**(요청 무관·supervisor 저자 모델 I4 정합). 새 서명 scorecard 스캔(1회 스캔 상한·바운드)·dedup(runId·seq).
- [x] **★ 재도출-후-서명(R7):** `_workspace` precomputed 신뢰 안 함 → 서버가 **판정 원장 `verdicts.json`에서 집계 직접 재계산**(build-scorecard.sh 로직 미러) → precomputed↔재계산 불일치 시 **ingest 거부(격리)** → 재도출 canonical 값을 loop/stage/run 정체성에 결속.
- [x] **★ 원자 commit 순서:** scorecard durable → receipt append → rollup 엔트리 append → head 재서명. (`atomic.ts`의 `writeJsonAtomic` 재사용.)
- [x] **★ [V15·HIGH] torn-state(4단계 중 크래시) 복구 — WAL/기동 dangling-append 탐지·상태머신 필수(전면/중간안 채택 시):** 4단계 append 중간에 크래시하면 (예: rollup 엔트리는 append됐으나 head 재서명 전) **부분 커밋(torn state)** 이 남고, A-5 로드 시 "head 서명 불일치/seq gap"으로 판정돼 **fail-closed → 평가 서브시스템 전체 brick**(agy#4). 단일 write 원자성(`writeJsonAtomic`)은 **다-파일 커밋의 원자성을 보장하지 못한다.** → **다음 중 하나 필수:**
  - [x] **(전면/중간안) WAL(write-ahead intent) + 기동 시 dangling-append 탐지·자동 롤백 상태머신:** 커밋 시작 전 intent(대상 loop·예정 seq·엔트리 digest) 기록 → 4단계 순차 수행 → 완료 시 intent 소거. 기동/로드 시 미소거 intent 발견하면 **미완 append를 이전 서명 상태로 자동 롤백**(dangling rollup 엔트리 절단·head를 직전 유효 head로 복원) 후 재-ingest. 정상 fail-closed(변조)와 **정당한 torn-state(자기 크래시)를 구분**해 후자는 brick 아닌 자동 복구.
  - [x] **(축소안 채택 시·V10 연계) 해소:** 체인 rollup/head 서명을 **v0.7로 이월**하면 다-파일 원자 커밋 문제 자체가 사라진다(단일 in-process 재계산 + 사람 승인 backstop이라 torn 원장 없음). **∴ V15는 V10 축소안 채택으로도 해소** — 어느 시나리오냐에 따라 WAL 상태머신 구현 여부가 갈린다(§열린 질문 1·V10 연계).
- [x] 회귀 픽스처: 4단계 각 지점 크래시 주입 → 재기동 시 (전면/중간안) 자동 복구·brick 0 / (축소안) torn 원장 경로 부재 assert.
- [x] `POST /api/evals/rebuild`(수동 재구축·Origin+session-token mutating 게이트).

**A-4. ★ 서명 키·키링 (F8.1·AS8·신규) — [S]**
- [x] `<state_home>/keys/evals-hmac.key` 현재키 — `O_EXCL` 최초 생성·0600·생산자(스크립트) 재생성 금지. *(`hmac.ts` `getSessionKey` 패턴 참고하되 session.key와 별개 키.)*
- [x] **★ 키 회전 = 신규 서명용·전 이력 키를 keyId로 `<state_home>/keys/evals-keyring/`에 보존**(폐기 금지). 원자 회전(신규 생성 → head 재서명 → 구키 키링 이동).
- [x] **★ owner/mode 검증** — 키 파일 소유자·권한비트 재검증. *현 코드 부재: registry.ts §4-A는 HMAC 서명만 검증·owner/mode 비트 미검증(`registry.ts:44 readOwner`는 verify()만). → 신규.*

**A-5. ★ 체인 서명 rollup (F8.1·신규) — [S]**
- [x] `<state_home>/evals-rollup/{loop}.jsonl` 불변 append-only·서버만 append·`_workspace` 밖.
- [x] **★ 과거 무결성 = 해시체인**(prev-record 해시 + monotonic seq·**키 불필요**). 절단/reorder/변조는 체인 링크 재계산으로 탐지.
- [x] **★ 진위(HMAC) = chain head + 현재키 서명 엔트리만** → 회전 후 과거 엔트리 브릭 0(R4/R5).
- [x] 로드 시 체인 링크 불일치·seq gap·head 서명 불일치 → **fail-closed**. **단 [V15] 자기 크래시 torn-state(미소거 WAL intent와 일치)는 변조가 아니라 dangling append이므로 A-3 상태머신이 자동 롤백 후 재-ingest**(brick 금지·변조와 구분).
- [x] 각 엔트리에 원본 scorecard digest + 검증 파생값 내장. **`_workspace`↔rollup digest 비교는 Part A 표시용(변조 배지)일 뿐·게이트 영향 0(R6).**

**A-6. ★ 독립 ingest receipt (F8.1·재구축 소스·신규) — [S]**
- [x] `<state_home>/evals-receipts/{loop}.jsonl` — 재도출 canonical 값 + loop/stage/run + keyId 담은 서명 receipt를 rollup과 독립 append. 재구축 재검증 전용 소스.

**A-7. Part A UI (A103·A104) — [W]**
- [x] Eval 화면 추가(9번째·기존 8화면 nav에 편입, `screens.tsx` 패턴). 추세: alignment_score·rounds_normalized·overturned_rejection_rate·verdict_counts·termination_reason 시계열.
- [x] **A103 정직 라벨:** `alignment_score`="정합도(품질·리뷰어 정밀도 아님)" 배지 + 산정식 툴팁. `quality_label`="LLM 해석" 분리. `missed_defect_rate`/`overturned_rejection_rate`=null → **"미측정(외부 GT 필요)"**(0/품질 위장 금지).
- [x] **A104 빈 상태:** 미실행="평가 루프 아직 실행 안 됨(고장 아님)+실행 위치/방법 CTA"·`eval-unavailable`="원인(jq 부재)+설치/재시도"·데이터 부족="N회 더 필요". "데이터 없음"만 금지.
- [x] XSS: React escape·`dangerouslySetInnerHTML` 미사용(기존 규약).

### Part B — 자기개선 제안 (게이트·서명 envelope·durable nonce) — 중대

**B-1. ★ 하드 게이트 = 체인 rollup 실데이터만 (A106·신규) — [S]**
- [x] 게이트는 config 값도 `_workspace` 재읽기도 아니라 **불변 append-only 체인 rollup에서만**. rolling window + runId 중복제거 후 **실제 adjudicated ≥ 30 ∧ 유효 관측 ≥ `rollingN` ∧ 실제 연속하락 ≥ `declineStreak`** 충족 시에만 발화.
- [x] 29·9·null·누락 → **발화 금지**(데이터 부족은 브릭 아님·"N회 더").
- [x] **fail-closed 트리거 = rollup 자체 무결성(체인 링크/seq/head 불일치·절단)만.**
- [x] **gate-time에 `_workspace` 재읽기·digest 비교 없음(R6)** → 활성 window `_workspace` 사후 변조 게이트 영향 0.
- [x] 단계 < 3 이면 제안 UI 비활성.

**B-2. 악화 트리거 (A105) — [S]**
- [x] `alignment_score` 3연속 하락(rolling·단일 노이즈 무시)·`rounds_normalized` 상승·`overturned_rejection_rate` 임계초과·동일 경계 N회 실패 → 제안 카드. 근거=인용 scorecard·추세. 무근거 제안 금지.
- [x] provenance 산출(소스경로·run id·`computed_by`·검증상태·표본수·정확한 트리거 근거).

**B-3. ★ 서명 proposal envelope (A107·신규) — [S]**
- [x] envelope = **canonical diff/내용 + 타깃 pathId + baseHash + 근거집합 digest + `evals-config 해시`**만 정확 결속해 HMAC 서명·해시.
- [x] **`evals-config 해시` = `evals` 서브객체만 해시**·운영 플래그(`definitionEditEnabled`·`projectRoot`) **제외**(R2-#2 데드락 정정 — 토글이 대기 제안을 409 stale로 영구거부하지 않게).
- [x] **가변 `rollup-head`는 envelope에 정확결속 안 함**(대기 중 새 run append 시 정당 제안 브릭 모순 제거·신선도는 저장 시 게이트 재평가로 판정).

**B-4. ★ durable nonce 상태머신 (A107·신규) — [S]**
- [x] `<state_home>/evals-nonces`에 durable 저장(envelope 해시+만료+state). *현 코드 부재: 유일한 "nonce"는 `registry.ts:16` owner 레코드의 단일 랜덤 필드 — 상태머신 아님. → 신규.*
- [x] **발급 = `POST /api/evals/proposals/:id/prepare`**(Origin+session-token·**GET 아님**).
- [x] **★ 크래시복구 원자 상태머신 `issued → applying → consumed`**(`atomic.ts` 원자 전이). `applying` 크래시 시 재기동이 **envelope + 결과 content 해시로 멱등 판정**(완결=consumed 확정·중복적용 0·미완=issued 복구·유실 0). 소비 후 **tombstone 재시작 유지**(replay 차단).

**B-5. ★ 제안→적용 = F7 DW11 실집행 (A107·통합-2) — [S: F7 연동]**
- [x] 적용은 `PUT …/definition` body `evalProposal:{nonce, envelope}`로 결속 → **F7 DW11 실집행**. F7이 독립 검증·저장: 현재 정의 fetch → 정확 diff → **에디터 주입 content == envelope canonical payload 정확 일치** → **envelope `evals-config 해시` == 현재 `evals` 설정 정확 일치**(운영 플래그 무영향) → **A106 게이트를 현재 rollup 상태로 재평가**(fail-closed·rollup-head 정확일치 아닌 재평가) → `definitionEditEnabled`·pathId/baseHash 강제(DW2/DW6) → **nonce 1회 소비** → 별도 명시 저장(PUT).
- [x] **edit/proposal 분리(R2-#3):** 일반 편집 상시 허용(우회 아님)·envelope는 "승인된 제안" 주장에만 강제·**evalProposal 없는 제안 적용 불가**.
- [x] **no-auto-apply 경계:** 평가기준·에이전트 `tools`·`skills` 추가·역할·Phase·외부리뷰 게이트·런타임 범위 = **항상 사람 승인**. 무시·기각·승인 모두 audit 기록.
- [x] **자동 적용 절대 금지 · Stage 4 자동 쓰기 경로 없음.**

**B-6. Part B UI (A105·A107·A108) — [W]**
- [x] 제안 카드 렌더 = **DV8 적용**(F5 sanitizer·CSP·scheme 화이트리스트·외부리소스 차단). **scorecard 텍스트는 데이터일 뿐·지시로 흡수 금지.** provenance 표시.
- [x] 승인/적용 분리 UX(A112·UX-R1-#3): CTA="편집기에서 검토·저장"(승인 아님)·전환 전 "아직 적용되지 않음"·저장 전 "미적용" 유지.
- [x] **A108 Stage 4 = display-only 잠금·실험 배지**(쓰기 경로 없음).

### Part C — 평가지표 관리 (mutating config · per-leaf + floor) — 표준(경계는 중대)

**C-1. EvalsConfig 스키마 (A109·A110) — [S]**
- [x] F3.7 `config.json`에 `evals` 서브객체 확장: `adoptionStage`(`z.union([1,2,3])`·기본1·**4 쓰기 불가**)·`metrics`(record enable/weight 0~1)·`thresholds`(`minAdjudicatedClaims.min(30)`·`rollingN.min(10)`·`declineStreak.min(3)`·`thetaByRisk`)·`normalization`. 전 서브객체 `.passthrough()`(전체 `.strict()` 금지).
- [x] `GET/POST /api/evals/config`. **쓰기 수용 `adoptionStage∈{1,2,3}`만(4→400).**

**C-2. ★ per-leaf 복구 + floor max (A110·F3.7 확장) — [S]**
- [x] **각 잎 필드 독립 safeParse**(서브객체 단위 아님) — `thresholds.rollingN` 손상이 형제 `minAdjudicatedClaims:50`을 리셋 안 함(보존). 실패 잎만 안전기본값.
- [x] **effective threshold = `max(유효 설정값, 필수 floor)`** — 리셋/손상돼도 floor(30/10/3) 미만 불가.
- [x] 원자 RMW(전 필드 보존·`evals`/`projectsHome` clobber 금지)·in-process 뮤텍스. 부재/손상 → fail-closed 안전 기본값(단계1·자동 잠금·보수적 임계).

**C-3. Part C UI (A110·A111·A112) — [W]**
- [x] 관리 폼(단계·per-metric·임계·정규화). **입력 옆 최소 30/10/3 상시 표시·floor 미만 인라인 거부(silent clamp 금지)·old→new/effective diff·적용값 피드백.**
- [x] **A111 단계 3 전환 = 고위험 확인 다이얼로그**(experimental 경고 + 명시 확인·A85)·단계3 experimental 배지.
- [x] **A112 무결성 상태 UX:** 상세 파일 불일치="추세·게이트는 검증 rollup 사용(안전)"·격리 건수/대상/원인·"변조" 배지 툴팁·**"rollup 무결성 훼손—제안 차단"은 복구 CTA 필수**(데드엔드 금지): (a)진단(실패 엔트리/seq/head) (b)복구="원장 재구축·재검증"=독립 receipt(keyId·키링 재검증) 통과분에서 rollup 재생성(현재 `_workspace` 재신뢰 금지) (c)독립소스 전무 → 재구축 불가 사유 + 명시 리셋만.

---

## 수용기준 → 테스트 매핑

| A# | Part | 통과(positive) | 거부/불변(negative) |
|----|------|----------------|---------------------|
| A102 | A | GET 순수 조회 응답·추세=rollup 소싱·재도출 canonical 값 서명 ingest | GET이 ingest/서명/append(side-effect 검출)·`_workspace/summary.jsonl` 추세 소싱·미인증 ingest/nonce 발급·심링크 evals dir(공용 리더 거부)·malformed(500 아닌 graceful) |
| A103 | A | alignment=정합도 배지·산정식 툴팁·quality_label="LLM 해석"·null="미측정" | alignment을 "품질"로 표기·null을 0으로 위장 |
| A104 | A | 미실행 CTA·eval-unavailable 원인+절차·데이터부족 "N회 더" | "데이터 없음"만 표시(데드엔드) |
| A105 | B | 3연속 하락 등 트리거 시 근거 인용 제안 카드·provenance 표시 | 무근거 제안·scorecard XSS(`<script>`/`onerror=`/`javascript:`/`data:`/원격`<img>`/SVG)·scorecard 지시 흡수(프롬프트 주입) |
| A106 | B | **[V10 시나리오 의존 — 아래 §A106/A107 시나리오 분기 참조]** 발화 기준 = adjudicated≥30∧관측≥rollingN∧연속하락≥declineStreak | **거부/fail-closed 스위트는 시나리오(전면/중간/축소)마다 다름** — 체인 rollup fail-closed는 전면에서만 거부기준. **ACCEPT(브릭 0·전 시나리오 공통): 키 회전 후 과거 엔트리·과거 scorecard·활성 window `_workspace` 사후 변조** |
| A107 | B | **[V10 시나리오 의존]** envelope+nonce+payload 정확일치+게이트 재평가 통과 시 F7 저장·nonce 1회 소비 | **durable nonce·envelope·replay·chain rollup fail-closed 거부기준은 시나리오별 분기**(§A106/A107 시나리오 분기). **ACCEPT(전 시나리오): `definitionEditEnabled` 토글이 대기 제안 무효화 안 함·일반 편집 상시 허용** |
| A108 | B | 단계4 display-only 잠금·실험 배지 표시 | 단계4 쓰기 경로 존재(400 아님) |
| A109 | C | GET/POST config 관리·`adoptionStage∈{1,2,3}` 수용 | `adoptionStage:4` 쓰기(→400) |
| A110 | C | per-leaf 독립 safeParse·형제 보존·effective=max(값,floor)·원자 RMW 전 필드 보존 | 한 잎(threshold) 손상이 형제(weight/metrics) clobber·`rollingN` 손상이 `minAdjudicated:50` 리셋·config writer가 `evals`/`projectsHome` clobber·floor 미만 저장 |
| A111 | C | 단계3 고위험 다이얼로그·min 하한 표시 | floor(30/10/3) 낮춤·게이트 우회·env override |
| A112 | A/B/C | 빈/로딩/에러·비활성 이유·무결성 상태 영향+복구 CTA·승인/적용 분리·floor UX | rollup 훼손 시 데드엔드(복구 CTA 없음)·미검증 `_workspace` 재신뢰·silent clamp |

### [V10·HIGH·⚠️ 사용자 판정 필요: 어느 시나리오] A106/A107 시나리오별 수용/거부 분기

> **문제:** 상단 §열린 결정은 축소안을 제안하는데, 위 테스트매핑은 durable nonce·envelope·chain rollup fail-closed를 **무조건 A106/A107 거부기준**으로 두어 축소안과 모순(codex#10). ∴ **어느 시나리오냐에 따라 A106/A107 수용기준·거부스위트가 다르다** — 아래 3분기를 명시하고 **오케스트레이터/사용자가 시나리오를 확정한 뒤** 해당 열만 활성화한다. `[사용자 판정 필요: 어느 시나리오]`.

| 항목 | (전면) 전 crypto 스택 | (중간) envelope+durable nonce만 | (축소) crypto 원장 v0.7 이월 |
|------|----------------------|-------------------------------|------------------------------|
| **A106 게이트 소스** | 불변 append-only **체인 rollup**에서만 | 체인 rollup(회전/키링 없이 단순 서명 rollup) | **in-process 재계산**(verdicts 재도출)·불변 원장 없음 |
| **A106 수용(positive)** | rollup에서 adjudicated≥30∧관측≥rollingN∧연속하락≥declineStreak | 좌동(단순 서명 rollup) | 재계산값이 임계 충족 시 발화 |
| **A106 거부/fail-closed** | 29·9·null·누락 발화 금지 + **체인 링크/seq gap/head 서명 불일치/절단 → fail-closed**(+V15 torn-state 자동복구) | 29·9·null·누락 금지 + **head 서명 불일치 → fail-closed**(체인 링크/seq는 미검증·이월) | 29·9·null·누락 금지 **only**. **체인/head/seq fail-closed 거부기준 제거**(원장 없음) — 대신 재계산 불일치 시 표시·격리 |
| **A107 수용** | envelope+**durable nonce 상태머신**(issued→applying→consumed)+payload 정확일치+게이트 재평가+크래시 멱등복구 → F7 저장·nonce 1회 소비 | envelope+**durable nonce**+payload 일치+게이트 재평가 → 저장·nonce 소비(체인 rollup-head 결속 없음) | **사람 승인 backstop만** — 제안은 근거/provenance 표시, 적용은 F7 일반 편집 동선(envelope/nonce 강제 없음) |
| **A107 거부** | envelope payload 불일치/타깃교체·config stale(409)·**nonce in-session replay**·**envelope 없는 제안 적용(DW11 우회)**·자동 적용·Stage4 쓰기·크래시 후 유실/중복적용 | 좌동(단, chain rollup-head 결속 관련 거부는 제외) | **자동 적용·Stage4 쓰기·tools/skills 자동 주입만 거부.** durable nonce replay·envelope 위조 거부기준은 **적용 안 함**(envelope/nonce 미구현 — 대신 "자동 적용 경로 0"이 우회 자체를 차단) |
| **V15 torn-state** | WAL/dangling-append 자동복구 상태머신 **필수** | 필수(단순 rollup도 다-파일 커밋) | **해소**(불변 원장 없음 → torn state 경로 부재) |
| **교리(전 시나리오 불변)** | alignment≠품질 · **자동 적용 절대 금지** · Stage4 쓰기 경로 없음 · 사람 승인 backstop · scorecard 지시 흡수 금지 | 좌동 | 좌동 |

- **[사용자 판정 필요]:** 전면/중간/축소 중 택1(§열린 질문 1·상단 열린 결정). server-builder는 임의로 전면을 밀지 말 것 — **시나리오 확정 후 해당 열의 수용/거부 스위트만 qa-verifier/security-auditor에 전달**한다.
- **어느 시나리오든 공통 ACCEPT(브릭 0):** 키 회전 후 과거 엔트리(전면/중간)·과거 scorecard·활성 window `_workspace` 사후 변조 게이트 영향 0·`definitionEditEnabled` 토글이 대기 제안 무효화 안 함·일반 편집 상시 허용.

### F8 거부 스위트 (security-auditor 전건 실행 — 설계서 §위협 스위트 F8행)
- [x] 경로탈출·심링크·대용량 evals 파일 (공용 경화 리더 거부)
- [x] 미서명/서명불일치/수학 모순 scorecard → 격리
- [x] **자기일관 위조 aggregate**(precomputed `verdict_counts`/`alignment_score` → 서버 원장 재계산 불일치 → 격리·R7)
- [x] **스크립트 자가서명·키 재생성**(서버 서명만·생산자 재생성 금지·R3-#1)
- [x] scorecard XSS → DV8 차단
- [x] 게이트 우회: 29·9·null·flood·절단창·rollup 체인 링크 불일치/seq gap/head 서명 불일치/절단 → fail-closed
- [x] `_workspace` 가짜 추세 UI 기만 → rollup 소싱으로 차단
- [x] config < floor·형제 손상 → floor 밑 리셋 (per-leaf+max 거부)
- [x] Stage 4 쓰기 → 400
- [x] envelope payload 불일치/타깃 교체·config stale(409)·nonce in-session replay·envelope 없는 제안 적용(DW11 우회)
- [x] config writer가 evals/projectsHome clobber·evals 한 잎 손상 → 형제 clobber
- [x] GET이 ingest/상태변경·미인증 ingest/nonce 발급(GET 발급 불가)
- [x] 크래시 후 승인 제안 유실·재시도 중복적용 (멱등 상태머신)
- [x] **ACCEPT(정당 흐름 브릭 0):** 키 회전 후 과거 엔트리·과거 scorecard·활성 window `_workspace` 변조·`definitionEditEnabled` 토글·일반 편집 상시 허용
- [x] **OUT-OF-SCOPE(게임오버·F8.8·검증 대상 아님):** `<state_home>` {rollup,head}/nonce 조율 rollback(cross-restart)

---

## 정합성 / 열린 질문

### ★ 열린 질문 1 (최우선 판정 요청) — 비례성 축소안
설계서 스스로 **F8.8·AS10**에서 다음을 규정한다:
- HMAC = **무결성이지 진위 아님**(서버가 이 바이트를 봤다만 증명).
- 판정 원장(`verdicts.json`) 자체가 **오케스트레이터 자기판정 = 약증거**.
- **최종 방어 = 사람 승인 backstop**(자동 적용 절대 금지·Stage 4 쓰기 경로 없음).
- **`<state_home>` 쓰기 장악 = 게임오버 = 위협모델 밖.**

이 환경은 **로컬 단일사용자·항상 사람 승인 신호**다. 그런데 방어로 요구된 것은 **체인 rollup + 키링 회전 + durable nonce 상태머신 + 독립 receipt + owner/mode 검증**(전부 신규 대형 구축). 위협모델 안(방어 대상)은 사실상 **"반신뢰 `_workspace` scorecard 위조"** 하나이고, 그마저 최종 backstop이 사람 승인이라면 — **전면 crypto 원장이 위협 대비 비례하는가?**

**대안(오케스트레이터 판정 요청):**
- **v0.6 = Part A(읽기·`_workspace`↔서버 재도출 검증·표시) + Part B(제안·근거·DV8·사람 승인만·자동 금지) + Part C(config per-leaf+floor)만.**
- **암호 원장 게이트(체인 rollup·키링 회전·durable nonce·receipt)는 v0.7로 이월.** Part B 제안은 rollup 대신 **in-process 재계산 + 사람 승인 backstop**으로 게이트(자동 적용 0이므로 위조 rollup이 자동 개악으로 이어지는 경로가 애초에 없음).
- 이 축소안이면 M13 공수가 대폭 감소하고, 설계서가 인정한 "자연스러운 컷 지점"과도 정합. **전면 구축은 열린 결정 — 임의로 밀어붙이지 말 것.**
- (반대 논거도 병기: 서명 envelope+nonce는 A107 "제안 은밀 교체/replay 차단"의 최소 방어로 자동 적용이 없어도 값이 있다 — 이 최소선까지 남길지도 판정 대상.)

### 재사용 오표기 목록 (설계서 "재사용" 표기 ↔ 실제 코드 부재)
설계서 F8.5 표·본문이 "재사용 hmac.ts / registry.ts §4-A"로 적었으나 **코드 대조 결과 신규 구축**:
| 설계 "재사용" 표기 | 실제 | 근거 |
|--------------------|------|------|
| `evals-hmac.key`·키링·회전 (hmac.ts) | 부재. `hmac.ts`=`session.key` 단일키·회전/키링 없음 | `hmac.ts:9-13,23` `keyPath()=session.key`·`getSessionKey` 단일 |
| 체인 rollup(`evals-rollup`)·head·seq·digest | 부재 | `Grep evals-rollup|keyring|chain ⇒ 없음` |
| durable nonce 상태머신(`evals-nonces`) | 부재. 유일 "nonce"=owner 레코드 단일 랜덤 필드 | `registry.ts:16` (상태머신 아님) |
| `evals-receipts` 독립 서명 receipt | 부재 | Grep 부재 |
| **owner/mode 검증** (registry.ts §4-A) | 부재. §4-A는 **HMAC 서명만** 검증·파일 owner-uid/mode-bit 미검증 | `registry.ts:44-52 readOwner`=`verify()`만·생성 시 `open(...,"wx",0o600)`뿐 |
| F3.7 config(`loadConfig`)·`evalProposal`(F7 DW11) | 부재(M11/M12 미착수) | `Grep loadConfig|config.json|definitionEditEnabled|evalProposal ⇒ No files found` |

→ **공수·순서에 반영:** F8은 "얇은 UI 얹기"가 아니라 **신규 crypto 서브시스템 + 4개 선행 마일스톤 결합**. 축소안 미채택 시 M13은 사실상 M7~M12 전체 완료를 전제로 하는 최대 공수 마일스톤.

### 교리 정직성 (비협상 — 회귀 필수)
- alignment_score ≠ 품질 (A103) · 자동 적용 절대 금지 (A107) · 하드 게이트 실데이터(config 값 아님) (A106) · 단계 3/4 실험(4 쓰기 불가) — 축소안을 택하더라도 **이 교리 라벨·자동 금지·backstop은 유지.**

### 사소한 stale (착수 무관·참고)
- 설계서 도입부/제목에 F8 누락 사례·UX 수용기준 개수 표기 등은 M13 계약과 무관(§milestone-spec 기록). M13 착수엔 영향 없음.

---

## 소스레벨 검토 반영 (2026-07-09)

> server-builder 소스 재대조(파일:라인). **F8 crypto 스택 전량 부재를 파일:라인(부재)으로 못박음** + 신규 대형 서브시스템 공수 확정 + 축소안 상단 격상.

### F8 crypto 스택 전량 부재 확정 (부재를 파일:라인으로 못박기 — AS8/AS9/AS10)
2026-07-09 재대조: `grep loadConfig|config.json|projectsHome|definitionEditEnabled|evalProposal|evals-rollup|evals-keyring|evals-nonces src/ = **0 매치**`. 아래 전부 **(c) 신규 대형 서브시스템**(설계서 "재사용 hmac.ts/registry.ts" 표기는 오표기):
| 방어 항목 | 실제 코드 상태 | 근거(파일:라인) |
|-----------|----------------|-----------------|
| `evals-hmac.key`·키링·회전 | **부재.** `hmac.ts`는 세션 토큰 서명 단일키(`session.key`)만·회전/키링 없음 | `hmac.ts:9-13` `keyPath()=join(stateHome(),"keys","session.key")`·`:23` `getSessionKey` 단일·`:45-55` sign/verify |
| 체인 rollup(`evals-rollup`)·head·seq·digest | **부재** | `grep evals-rollup = 0` |
| durable nonce 상태머신(`evals-nonces`) | **부재.** 유일 "nonce" = owner 레코드 단일 랜덤 **필드**(상태머신 아님) | `registry.ts:16` `nonce: string`(OwnerRecord 필드) |
| `evals-receipts` 독립 서명 receipt | **부재** | `grep evals-receipts = 0` |
| **owner/mode 검증**(파일 소유자·권한비트 재검증) | **부재.** `readOwner`는 **HMAC 서명만** 검증·owner-uid/mode-bit 미검증·생성은 `open(...,"wx",0o600)` 쓰기뿐 | `registry.ts:44-52 readOwner`=`verify(canon(rec),sig)`만·`:38` `open(p, replace?"w":"wx", 0o600)` |
| F3.7 config(`loadConfig`)·`evalProposal`(F7 DW11) | **부재**(M11/M12 미착수) | `grep loadConfig\|config.json\|evalProposal = 0` |

→ **공수 확정:** F8은 "얇은 UI 얹기"가 아니라 **신규 crypto 서브시스템 + 4개 선행 마일스톤(M7/M8/M11/M12) 결합**. 축소안 미채택 시 M13 = M7~M12 전체 완료 전제의 최대 공수 마일스톤.

### 재사용 가능 프리미티브 (crypto와 별개 — 확정)
- `writeJsonAtomic`(atomic.ts:30-32)·`writeAtomic`(atomic.ts:7) = 원자 commit 순서(scorecard→receipt→rollup→head 재서명)에 재사용.
- `sign`/`verify`(hmac.ts:45-55·timingSafeEqual)의 **패턴**은 참고하되 **별개 키**(session.key 재사용 금지 — 도메인 분리). `getSessionKey` O_EXCL·0600 생성 패턴을 evals-hmac.key에 미러.
- **[V3 정정] 공용 JSON/바운드 리더(앵커 파라미터화된 `safeRunDir`/`safeOpen`+`readJsonCapped`)는 M9 완료 전제**(구 "M7" 오표기 정정) — evals JSON read(앵커=`_workspace/evals`)·rollup read(앵커=`<state_home>/evals-rollup`)에 재사용. **M9에서 앵커 파라미터화·크기상한 JSON 리더가 실제로 됐는지 P1 선확인.** 파일 원문 서빙 리더는 M8(별개).

### 거부 스위트 심화 (§위협 스위트 F8 — negative + ACCEPT 명시)
- **negative(전건 fail-closed):** 미서명/서명불일치/수학모순 scorecard→격리 · **자기일관 위조 aggregate**(precomputed `verdict_counts`/`alignment_score` ↔ 서버 원장 재계산 불일치→격리·R7) · 스크립트 자가서명·키 재생성 · 체인 링크/seq gap/head 서명 불일치/절단→fail-closed · config<floor·형제 손상 · Stage 4 쓰기→400 · envelope payload 불일치/타깃 교체 · config stale→409 · **nonce in-session replay** · **envelope 없는 제안 적용(DW11 우회)** · config writer가 `evals`/`projectsHome` clobber · **GET이 ingest/상태변경(side-effect 0 검출)**·미인증 ingest/nonce 발급 · 크래시 후 제안 유실/재시도 중복적용(멱등 상태머신) · scorecard XSS(`<script>`/`onerror=`/`javascript:`/`data:`/원격`<img>`/SVG)→DV8 차단 · scorecard 지시 흡수(프롬프트 주입 금지) · `_workspace` 가짜 추세→rollup 소싱 차단.
- **ACCEPT(정당 흐름 브릭 0 — 오차단 금지):** 키 회전 후 과거 엔트리 · 과거 scorecard · **활성 window `_workspace` 사후 변조는 신규 제안 브릭 0**(gate-time `_workspace` 재읽기 없음·R6) · `definitionEditEnabled` 토글이 대기 제안 무효화 안 함 · 일반 편집 상시 허용.
- **OUT-OF-SCOPE(게임오버·F8.8·검증 대상 아님):** `<state_home>` {rollup,head}/nonce 조율 rollback(cross-restart).

### 잔여 판정 필요 (오케스트레이터/사용자)
1. **[최우선·V10] 비례성 축소안 택1** — 전면 crypto / 중간안(envelope+nonce만) / 축소안(crypto 원장 v0.7 이월) (§상단 열린 결정·§열린 질문 1·§A106/A107 시나리오 분기). **시나리오별 A106/A107 수용/거부 스위트가 다름** — 확정 후 해당 열만 활성화.
2. **착수 blocked** — **[V3 정정] M9(공용 JSON/바운드 리더)·M8(safe file viewer)·M11·M12** 4개 선행 완료 전 착수 금지(§P1). 구 "M7 앵커 파라미터화" 표기 정정.
3. **verdicts.json 원장 스키마 실재·안정성** — 서버 재도출(build-scorecard.sh 미러) oracle의 신뢰 근거(§P2). 부재 시 A102 "재도출-후-서명"이 근거 없음 → 에스컬레이션.
4. **교리 라벨·자동 금지·backstop 유지** — 어느 안이든 alignment≠품질·자동 적용 0·Stage 4 쓰기 경로 없음·사람 승인 backstop 회귀.
5. **[V15] torn-state 복구 방식** — 전면/중간 채택 시 WAL/dangling-append 자동복구 상태머신 필수 / 축소안 채택 시 원장 부재로 자동 해소.

---

## 외부 리뷰 반영 (2026-07-09 — v0.6-todo-audit · codex+agy)

> 원장: `_workspace/reviews/v0.6-todo-audit_verdicts.json`. 전건 확인 판정(기각 0). 아래는 M13 해당 verdict 반영 결과.

| verdict | 등급 | 요지 | 반영 위치 | 잔여 |
|---------|------|------|-----------|------|
| V3 | HIGH | 선행 조건을 **"M9 공용 JSON/바운드 리더 완료" + "M8 safe file viewer 완료"로 분리**(구 "M7 앵커 파라미터화" 정정)·JSON 리더(M9) vs 파일 서빙 리더(M8) 2 리더 구분 명시 | 상단 blocked·개요·P1 M8/M9·A-1·재사용 프리미티브 | — |
| V10 | HIGH · 사용자 판정 | 축소안 제안 vs 테스트매핑의 durable nonce·envelope·chain rollup fail-closed A106/A107 거부기준 모순 → **전면/중간/축소 3시나리오별 A106/A107 수용/거부 스위트 분기** | §A106/A107 시나리오 분기(표) + 매핑표 A106/A107 행 | **[사용자 판정 필요: 어느 시나리오]** — 전면/중간/축소 택1 |
| V11 | MED | crypto 전 항목 = "(c) 신규·기존 hmac.ts/registry.ts는 생성/검증 *패턴* 참고만" 범례를 체크리스트 상단 고정 + 설계서 본문 "재사용" 표현 정정 권고 메모 | §작업 체크리스트 범례(★ 고정) | 설계서 본문 정정은 오케스트레이터 전달 |
| V15 | HIGH | chain rollup 4단계 append 중 크래시 = torn state → 서브시스템 brick → **WAL/기동 dangling-append 탐지·자동 롤백 상태머신 필요, OR 축소안 채택 시(V10 연계) 해소** 명시 | A-3(torn-state 상태머신·회귀) · A-5(로드 시 구분) | V10 시나리오 확정에 연동(전면/중간=WAL 필수·축소=해소) |
