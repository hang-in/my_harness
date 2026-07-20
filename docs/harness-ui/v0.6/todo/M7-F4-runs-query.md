# M7 — F4 Runs 이력 고급 조회·필터·검색 (읽기전용) · 작업계획서

> ✅ **완료(2026-07-09).** 구현·게이트·QA·배선·외부감사 전부 통과. 전 체크박스 완료.
> - **게이트:** `npm run typecheck` PASS · `npm run test` **182/182 PASS**(23 파일·신규 M7 스위트 포함) · `npm run build` PASS · v0.5 회귀 0.
> - **QA·배선:** 경계면 불일치 0 · 배선 dead link 0 · 거부 스위트 R-1~R-8+ACCEPT 전량 실거부.
> - **외부감사(codex+agy·러너 claude 제외) R1~R9 → 최종 HIGH 0(양 엔진):** R1 데드라인 우회·R2 열거/window·R3 windowing 정합·R4 정확 total↔저렴 페이지네이션(경로 분리)·R5 opendir 실패·R6 페이지 중복/미바운드·R7 base 선검증·R8 read 레이어 OOM(readJsonSafe 제거·readEvents 청크 리더) 순차 해소. 원장: `_workspace/reviews/m7-code-r*_*`.
> - RunDetail events shape(v0.5 잔존) 동반 수정.
>
> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F4.1~F4.5 · 수용기준 A47~A52 · UX A88/A95/A96 · §위협 스위트 `F4-쿼리·리더`.
> 코드 대조 완료(2026-07-09). 이 문서는 계획(체크리스트)이며 구현은 server-builder / web-builder가 수행한다.

## 개요

- **스코프:** `GET /api/runs`를 필터/검색/정렬/페이지네이션으로 확장(무인자 하위호환 유지). status만 읽던 `listRuns`에 **manifest 병합 read 델타** 추가. 이름 열거 → `fs.stat` FS-time 정렬 → 상위 N 내용 read → Zod 검증 쿼리로 필터 → 리터럴 `q` 부분일치 → 전역 정렬 → slice. Runs 화면에 필터바·칩·결과카운트·필터초기화·URL 반영·절단 고지.
- **리스크 등급: 표준** (다파일·읽기전용 기능 추가·파일 무변경 I8 유지·mutating 없음 → Origin 게이트 무관). 단 §위협 스위트 `F4-쿼리·리더`의 심링크/reparse 리다이렉트·ReDoS·OOM 거부케이스는 필수 게이트.
- **권장 게이트:** 표준 — 계약/스키마/보안 테스트(Zod 400, 리터럴 q, 심링크 거부, clamp, truncated)는 외부 리뷰 대상. `cd harness-ui && npm run typecheck && npm run test && npm run build` 전건 PASS + v0.5 회귀 0.
- **대상 파일:**
  - 서버(`src/server/**`, server-builder):
    - `src/server/adapters/runs.ts` — 신규 `queryRuns()` 추가, `safeRunDir`(L14-29)·`safeOpen`(L33-42) **그대로 재사용**(앵커=`_workspace/runs` 하드코딩 L16-17 유지 — M7 파라미터화 안 함, 아래 결정 참조). **[V2 반영] `readJsonSafe`(L43-49)는 재사용 대상 아님** — 전체 `readFile`이라 **크기상한(MAX_JSON_BYTES) 없음** → M7의 OOM 방어(R-5)와 충돌. 대신 **`readJsonCapped` 신규**(`safeOpen`으로 FileHandle 취득 → `fstat.size > MAX_JSON_BYTES`면 skip/`valid:false`, 초과 아닐 때만 `size` 바운드 제한읽기 후 parse)를 `queryRuns` 전용으로 추가. **재사용은 `safeRunDir`/`safeOpen`까지만.** `listRuns`(L51-67) 무인자 계약 불변.
    - `src/server/schemas.ts` — `Manifest`(L14-28, 현재 `agents: z.array(z.string())` L23만 있고 단수 `agent` 없음 — 코드 대조 확정)에 additive optional 단수 `agent`(nullable) **읽기 측만** 추가 + `RunsQuery` Zod 신규. **writer(supervisor 기록)는 M10 S1·S4** — read/write 분리(정합성 항목 #2).
    - `src/server/api/index.ts` — 현 `GET /api/runs`(L41 = `async () => listRuns(projectRoot)`, 쿼리 파싱 전무)에 쿼리 분기(무인자→기존, 인자→`queryRuns`).
  - 웹(`src/web/**`, web-builder):
    - `src/web/screens.tsx` — `Runs()` 필터바·정렬 토글·페이지·칩·결과카운트·필터초기화·절단 고지·빈상태 CTA.
    - `src/web/api.ts` — 쿼리스트링 빌더 헬퍼(필요 시). `apiGet` 재사용.
  - 테스트: `test/runs.test.ts`(확장) + 신규 `test/runsquery.test.ts`(권장) + `test/api.test.ts`(라우트 계약).

## 선행/선검증 (걸린 AS 가정)

- [x] **AS3 (on-read 집계 성능)** — F4 바운드 열거가 상계를 보장하는지: `MAX_RUN_DIRS`(이름+stat backstop, 예 100000) / `MAX_RUNS_SCAN`(내용 read — **[V13] 5000은 콜드캐시/Windows서 비현실적 → 예 1000으로 하향 검토·대상 OS 실측 후 확정**) / `SCAN_DEADLINE_MS`=2000 / `MAX_JSON_BYTES`=64KB 상수를 코드 상수로 확정하고, 대량 디렉토리 픽스처로 메모리 상계(이름+stat 소량 + 매칭 경량레코드 + read 1건 transient)를 측정. **[V13] 대상 OS(리눅스/WSL/mac/win) 콜드캐시에서 `MAX_RUNS_SCAN`개 `stat`/`realpath`가 `SCAN_DEADLINE_MS` 내 완주하는지 실측** — 미완주 시 `truncatedReason:"deadline_exceeded"` 정직 반환. **가정 위에 쌓지 말 것: 상수 없이 무제한 스캔 금지.**
- [x] **recordedAt 의미 선검증(중요·정합성 항목 참조)** — `fs.stat(dir).birthtimeMs` 지원 여부를 대상 OS(리눅스/WSL/mac/win)에서 확인, 미지원 시 `mtimeMs` fallback. **디렉토리 mtime은 엔트리 추가/삭제/rename(status.json 원자쓰기=rename 포함) 시 변함** → 정렬 결정성·from/to 의미에 영향. 착수 전 "recordedAt=birthtime 우선, mtime fallback, tie-break=runId" 결정을 확정하고 fallback 시 정렬 비결정 가능성을 문서화.
- [x] **manifest.agent 스키마 결정** — A47은 응답에 `agent(optional·구 run은 null)`를 요구하나, 필드 writer(supervisor)는 F2/M10(A66). **M7 결정 제안:** published `Manifest`에 additive optional `agent`(nullable/default null)를 **읽기 측만** 추가(구 manifest→null 파싱·거부 아님). 오케스트레이터 승인 필요(정합성 항목 참조).

## 작업 체크리스트

### 서버 (server-builder · `src/server/**`)

**의존 순서: S1(스키마) → S2(쿼리 Zod) → S3(queryRuns) → S4(라우트 분기).**

- [x] **S1 [신규·additive·read 측만]** `schemas.ts` `Manifest`(L14-28)에 `agent: z.string().regex(SAFE_SEGMENT).nullable().default(null)` 추가. 기존 `agents: z.array(z.string())`(L23) 불변 — 단수 `agent`(단일 대상 귀속 태그) ≠ 복수 `agents`(팀 명부). **마이그레이션 assert:** 구 manifest(agent 필드 없음)가 parse 성공 + `agent === null`. 거부 아님. **write/read 분리 계약:** M7=읽기 측 additive optional 필드 선반영(구 run→null 파싱). **writer(supervisor가 요청값 or null 기록)는 M10 S1(`exec-run.ts:manifest()` L43-49가 현재 `agents:[]` 하드코딩·`agent` 미기록)·S4가 배선** — M7은 writer 없음. 두 계획서가 이 분리를 상호 참조(M10 정합성 #2 ↔ M7 정합성 #2).
- [x] **S2 [신규]** `schemas.ts`에 `RunsQuery` Zod 추가 — 설계 §F4.3 그대로:
  - `state: RunState.optional()` · `runtime: Runtime.optional()` (enum — 임의문자열 400)
  - `mode: z.string().max(40).optional()` (리터럴 비교) · `agent: z.string().regex(SAFE_SEGMENT).max(120).optional()`
  - `from/to: z.string().datetime({offset:true}).optional()` (recordedAt=FS-time 도메인 — 단일 도메인 R3-#1)
  - `q: z.string().max(200).optional()`
  - `sort: z.enum(["recordedAt","updatedAt","state"]).default("recordedAt")` · `order: z.enum(["asc","desc"]).default("desc")`
  - **`offset`/`limit`는 clamp(400 아님)** — [V1 반영] `z.max(100)`는 `limit=99999`를 **400으로 거부**하므로 A48/§위협 스위트의 **clamp 요구**(R-4)와 충돌. 대신 **`z.preprocess`(또는 `.transform`)로 범위 밖 값을 경계로 clamp한 뒤 int 검증**: `limit = z.preprocess(v => clamp(coerceInt(v), 1, 100, /*fallback*/50), z.number().int().min(1).max(100))` 형태로 `99999→100`·`0→1`·`-5→1`. `offset = z.preprocess(v => clamp(coerceInt(v), 0, 100000, 0), z.number().int().min(0).max(100000))`로 `-5→0`·초과→100000. **비수치(`limit=abc`)는 fallback default**(400 아님·clamp 도메인). enum(`state`/`runtime`/`sort`/`order`)·datetime(`from`/`to`)·SAFE_SEGMENT(`agent`) 위반은 **여전히 400**(clamp 대상 아님·R-2/R-3). **[정합 메모] 설계서 §F4.3 line66 코드블록도 `z.max(100)`(거부)로 적혀 있어 동일 충돌 — 정본을 clamp(preprocess/transform)로 정정 필요**(server-builder가 오케스트레이터에 정본 정정 보고).
  - 검증 실패(enum/datetime/SAFE_SEGMENT) = 400(라우트에서 반환). offset/limit 범위 초과 = clamp(400 아님).
- [x] **S3 [신규 + 재사용]** `runs.ts`에 `queryRuns(root, query)` 추가. **기존 프리미티브 재사용(2벌 구현 금지):** `safeRunDir`(L14-29: realpath 앵커·leaf lstat 심링크 거부·containment 재확인 — F4 앵커=`_workspace/runs` L16-17로 이미 정확·충분) + `safeOpen`(L33-42: 파일명 allowlist·O_NOFOLLOW·fstat 정규파일). **[V2 반영] `readJsonSafe`(L43-49)는 재사용 금지**(전체 readFile·크기상한 없음) → **`readJsonCapped` 신규**(`safeOpen`→`fstat.size` 검사→초과 skip→바운드 제한읽기→parse)를 사용. runId는 단일 세그먼트라 중간 세그먼트 없음 → 기존 `isSafeSegment(runId)` per-seg 검증으로 충분. **앵커 파라미터화는 M7에서 하지 않는다** — 두 번째 앵커가 등장하는 **M9(F6, 동일 앵커 `_workspace/runs`)가 `runs.ts`에서 `safeRunDir`/`safeOpen`을 앵커 파라미터로 추출·공용화**하고 M13(F8, `evals-rollup` 앵커)이 그 공용 리더를 재사용한다(오케스트레이터 교차조정 결정). M7 선제 추출은 YAGNI·외과적 변경 위반(정합성 #5). 단계:
  1. [재사용] `readdir(runsDir)` **이름만 열거** + `isDirectory() && isSafeSegment(name)` 필터(내용 read 아님). `MAX_RUN_DIRS` backstop.
  2. [신규] 각 dir에 `fs.stat` → `recordedAt = birthtimeMs || mtimeMs` 취득 → **내림차순 정렬**(runId 문자열 형식 무의존)·tie-break=runId. **stat 불가/malformed = quarantine**(스캔 제외·`valid:false` 카운트). **[정직 고지·비봉합] birthtime 미지원 FS(일부 리눅스/WSL)에서 mtime fallback 시 비결정성:** status.json 원자쓰기가 `rename`(atomic.ts)으로 완료되며 rename은 **부모(run) 디렉토리 mtime을 갱신**한다 → mtime fallback 경로에서 `recordedAt`은 "생성 시각"이 아니라 "최근 상태갱신 시각"이 되어 정렬 순서·from/to 범위 의미가 흔들린다. birthtime 지원 시 안정. **완화 아님·고지 대상:** 응답에 `recordedAtSource:"birthtime"|"mtime"` 필드를 동반해 UI가 fallback을 정직 표기(정합성 #1·A51 정렬 결정성은 birthtime 전제). **[V14 반영·보조키 병용] mtime fallback 경로에서는 고지만으로 부족** → manifest `createdAt`(있으면)을 **보조 정렬/필터 키로 병용**: (a) 정렬 tie-break을 `runId` 전에 `manifest.createdAt` 우선 적용(생성 시각 근사 복원), (b) `from/to` 범위 판정 시 `recordedAt`(mtime)과 `createdAt` 중 **생성 의미에 더 가까운 `createdAt`을 우선**하되 부재 시 mtime. `createdAt` 부재/malformed 시 mtime 단독(현행). birthtime 지원 경로는 birthtime 단독(보조키 불필요).
  3. [신규] 상위 `MAX_RUNS_SCAN`개만 `safeRunDir`+**`readJsonCapped`(V2 신규·`readJsonSafe` 아님)**로 status·manifest read(내용 read 상한 = N×MAX_JSON_BYTES = OOM 방어). `MAX_JSON_BYTES`(64KB) 초과 manifest는 **`fstat.size` 단계에서 skip**(`valid:false`·`readFile` 미호출). `SCAN_DEADLINE_MS`(2000) 초과 시 부분결과.
  4. [신규] 경량 레코드 `{runId,runtime,mode,state,recordedAt,createdAt,updatedAt,goal,agent,requestedBy}` 구성(createdAt=manifest·표시용·recordedAt과 괴리 가능).
  5. [신규] **필터 적용:** state/runtime(enum eq)·mode/agent(리터럴 eq)·from/to(recordedAt 범위 — FS-time 도메인, ISO 비교).
  6. [신규·핵심 ReDoS 방어] **`q` 리터럴 부분일치:** `String.prototype.includes`(양쪽 `toLowerCase`)로 `goal`·`mode`·`agent`·`requestedBy` 매칭. **`new RegExp(q)` 절대 금지**(특수문자 `.*`·`(a+)+`도 리터럴 취급).
  7. [신규] **전역 정렬:** 필터 통과분 전체를 `sort`(recordedAt|updatedAt|state)+`order` 정렬(페이지 버퍼만 재정렬 금지)·tie-break=runId(결정적) → `offset..offset+limit` slice.
  8. [신규·A96] **기간 파티셔닝:** from/to 지정 시 최신 5000이 아니라 **[from,to]에 recordedAt 겹치는 window 상위 N** 스캔 → 상한 밖 오래된 run도 기간 좁히면 도달. `truncated`는 window 기준. 무기간=최신 N.
  9. [신규] 응답 `{items,total,offset,limit,hasMore,scanned,truncated,truncatedReason,schemaVersion:"1"}`. **[V13 반영·truncated 두 원인 분리]** `truncated`가 (a) 스캔 캡 도달(`scanned >= MAX_RUNS_SCAN`)과 (b) 데드라인 초과(`SCAN_DEADLINE_MS`) 두 원인을 **혼동하면 UX 오인**(‘최근 N 상한’으로만 보임) → `truncatedReason: "limit_reached" | "deadline_exceeded" | null`로 **분리 노출**. 둘 다 발생 시 `deadline_exceeded` 우선(스캔 미완료가 더 강한 신호). UI는 원인별 다른 문구(W3): `limit_reached`="최근 N개 상한 도달 · 기간을 좁혀 재검색", `deadline_exceeded`="스캔 시간 초과 · 부분 결과 · 필터를 좁혀 재검색". **[V13·MAX_RUNS_SCAN 현실화 검토]** 콜드캐시/Windows에서 5000개 `lstat`/`realpath`는 2초 내 불가 가능 → `MAX_RUNS_SCAN`을 **현실값(예 1000)으로 하향 검토**하고 대상 OS(특히 Windows·WSL 콜드캐시) 픽스처로 `SCAN_DEADLINE_MS` 내 완주 여부 실측. 미완주 시 `deadline_exceeded` 정직 반환(가정 위 구현 금지). 확정값은 AS3 선검증에서 측정 후 상수 고정.
- [x] **S4 [신규 분기]** `api/index.ts` `GET /api/runs`(현 L41) 핸들러: **원시 쿼리스트링 존재 여부**(`Object.keys(req.query).length > 0`)로 분기 — **무인자 → 기존 `listRuns`(`{runs}` 계약 불변)**, 인자 → `RunsQuery.safeParse` 실패 시 400, 성공 시 `queryRuns`. (Zod default가 무인자에서 오분기하지 않도록 파싱 前 raw presence로 판단. Fastify는 querystring을 항상 파싱하므로 `req.query`가 `{}`인 경우만 무인자.)

### 서버 테스트 작업 (server-builder · `test/*.test.ts`)

**파일 배치:** 어댑터 단위 = `test/runsquery.test.ts`(신규) · 라우트 계약/분기 = `test/api.test.ts`(확장) · 스키마 마이그레이션 = `test/schemas.test.ts` 또는 `test/runs.test.ts`(확장). 픽스처는 `HARNESS_STATE_HOME` 미사용(projectRoot 하위 `_workspace/runs`) — tmpdir projectRoot에 run dir 조립.

- [x] **T-S1 [스키마 마이그레이션]** `Manifest.parse` — (a) `agent` 필드 있는 신 manifest 통과, (b) `agent` 없는 구 manifest 통과 + `agent === null`(default), (c) `agent: "../x"`(SAFE_SEGMENT 위반) → parse 실패. (A47 마이그레이션·A66 회귀 근거.)
- [x] **T-S2 [RunsQuery Zod — 통과]** state/runtime enum·mode/agent 리터럴·from/to ISO·sort∈{recordedAt,updatedAt,state}·order·offset/limit 정상 파싱값 확인. clamp 경계: `limit=100`·`limit=1`·`offset=0` 통과. (A48 positive.)
- [x] **T-S3 [queryRuns — 정렬·페이지·전역정렬]** 픽스처: birthtime 상이한 run 다수(UUID·`run-1`·`run-10` 혼재) → **FS시간 desc 최신 N 정확**(사전식 아님)·전역 sort+order·tie-break=runId·offset/limit slice·`{items,total,offset,limit,hasMore,scanned,truncated,schemaVersion:"1"}` shape. **페이지 버퍼만 재정렬 금지 assert**(2페이지 요청 시 전역 정렬 후 slice와 일치). (A51 positive.)
- [x] **T-S4 [queryRuns — 필터·q]** state/runtime eq·mode/agent 리터럴 eq·from/to 범위·`q` 대소문자 무시 부분일치(goal/mode/agent/requestedBy). (A48/A49 positive.)
- [x] **T-S5 [라우트 분기]** 무인자 `GET /api/runs` → `{runs}`(listRuns 계약 불변·A47 하위호환)·인자 → `{items,total,...}`. `RunsQuery` 실패 → 400. (A47/A48 계약.)

### F4 거부 스위트 (§위협 스위트 `F4-쿼리·리더` 8건 전량 — 병합 게이트·외부 리뷰 대상)

> 8건 각각을 개별 테스트 케이스로 명시(server-builder 필수, security-auditor 재검증). 형식·리더 방어는 협상 대상 아님(impl §I6·통합감사-#3).

- [x] **R-1 [ReDoS·`q` 정규식 주입]** `q=(a+)+`·`q=.*`·`q=[a-z]+` → **리터럴 취급**(정규식 컴파일 없음·매칭 = 해당 리터럴 문자열 포함 run만·시간 폭발 없음). **정적검사: `queryRuns` 소스에 `new RegExp` 부재 assert**(grep 또는 소스 문자열 검사). (A49 negative.)
- [x] **R-2 [enum 위반 400]** `state=<임의문자열>`·`runtime=xxx`·`sort=xxx` → 400(RunsQuery reject). (A48 negative.)
- [x] **R-3 [경로문자 agent 400]** `agent=../x`(SAFE_SEGMENT 위반)·`from=notdate`(datetime 위반) → 400. (A48 negative.)
- [x] **R-4 [clamp]** `limit=99999` → **100으로 clamp**(400 아님)·`offset=-5` → 0으로 clamp·`limit=0` → 1(min). (A48 negative-경계.)
- [x] **R-5 [OOM·초과크기 manifest skip]** `> MAX_JSON_BYTES`(64KB) manifest → 해당 run `valid:false` skip(전체 실패 아님·N×MAX_JSON_BYTES 상한 assert). **[V2 반영] `readJsonCapped`가 `fstat.size` 초과 판정 후 `readFile`(전체 읽기)을 호출하지 않음을 검증** — 대용량 manifest 픽스처에 대해 read 바이트가 0(또는 size 판정만)임을 spy/mock으로 assert(전체 read 미발생 = OOM 실질 방어). (A50 negative.)
- [x] **R-6 [quarantine — malformed/stat불가]** JSON 파손 status·stat 불가 runId → `valid:false` 격리(스캔 제외·조용한 0 위장 아님·`scanned` 카운트 반영). manifest 없이도 status만으로 경량레코드 최소필드 채움. (A47/A50 negative.)
- [x] **R-7 [심링크/reparse run dir 거부]** run dir가 `_workspace/runs` 밖으로 심링크·`../etc` runId → `safeRunDir`가 null 반환(밖 리다이렉트 차단·통합감사-#3). base(`_workspace/runs`) 자체 심링크 재앵커도 거부(L19-22). (A50 negative — 리더 경화 핵심.)
- [x] **R-8 [스캔 바운드·truncated 원인 분리]** run dir > `MAX_RUNS_SCAN` → 상위 N만 내용 read(전건 read 아님)·`truncated:true`·**`truncatedReason:"limit_reached"`**·대량 디렉토리에서 이름+stat만 열거(메모리 상계). `SCAN_DEADLINE_MS` 초과(느린 stat 픽스처/fake timer) → 부분결과+`truncated:true`+**`truncatedReason:"deadline_exceeded"`**. **[V13] 두 원인이 서로 다른 reason으로 분기됨을 각각 assert**(혼동 금지). (A51 negative.)
- [x] **R-ACCEPT [정상 통과]** UUID·`run-1`/`run-10` 혼재 → FS시간 최신 N 정확(runId 사전식 아님 — 오탐 없음 확인). (A51 accept.)

### 웹 (web-builder · `src/web/**`)

**의존 순서: 서버 S2~S4 응답 계약 확정 후 착수. W1 → W2 → W3.**

- [x] **W1 [신규]** `Runs()` 필터바(A88·A52) — state·runtime·mode·기간(from/to, 라벨 "기록 시각(파일시스템)")·검색어 `q` 입력 + 정렬 토글(recordedAt/updatedAt/state)+order 방향표시 + 페이지네이션(이전/다음·현재범위). 필터 상태 → 쿼리스트링 빌드 → `useApi("/api/runs?"+qs)`(path 변경 시 자동 refetch — `ui.tsx` useApi 재사용).
- [x] **W2 [신규·A88]** **활성 필터 칩(개별 제거)·결과 카운트(total)·"필터 초기화(clear)"·URL 쿼리 반영**(`history.replaceState` + `location.search` — 공유·새로고침 보존). 응답 신규 shape `{items,total,...}` 소비. 행 클릭 → 기존 `RunDetail`(A5/A6) 그대로.
- [x] **W3 [신규·A95/A96/A82]** **절단 고지(원인별 문구·[V13]):** `truncated:true` 시 결과카운트 옆·빈상태에 **`truncatedReason`별 경고 라벨+툴팁**: `limit_reached`="최근 N개 상한 도달 · 더 오래된 이력 생략 · 기간(from/to)을 좁혀 재검색", `deadline_exceeded`="스캔 시간 초과 · 부분 결과 · 필터를 좁혀 재검색". 두 원인을 동일 문구로 뭉뚱그리지 말 것. **빈상태(A82):** 필터/검색 0건 → "조건에 맞는 run 없음 + 필터 초기화" CTA(절단 0건과 구분). **A46 준용:** 빈/로딩/에러 3-state(`Async` 재사용)·GET 재시도·키보드 nav. **XSS:** 전 텍스트 React escape(dangerouslySetInnerHTML 금지 — `screens.tsx` 기존 불변식).
- [x] **W4 [신규·A83/A92 회귀 · V6 반영]** **A83(패널별 독립로딩·부분실패 격리):** Runs 필터바·결과목록·절단고지 등 패널이 **각기 독립 로딩/에러 상태**를 갖고, 한 패널(예 metrics 미도입 영역이나 개별 fetch)의 실패가 전체 화면을 무너뜨리지 않도록 격리. **A92(접근성 WCAG AA):** 필터바·칩·정렬토글·페이지네이션·절단 경고가 **키보드 조작 가능**·**포커스 링 가시**·**색 대비 AA**·**색만으로 상태 구분 금지**(칩 제거·정렬 방향·경고를 아이콘/텍스트 병기). qa-verifier/web-builder 공통 회귀로 검증.

## 수용기준 → 테스트 매핑

| A | 통과(positive) | 거부/경계(negative — §위협 스위트 F4) |
|---|----------------|----------------------------------------|
| **A47** | 무인자 `GET /api/runs` = 기존 `{runs}` 계약 유지(하위호환). 인자 시 status+manifest 병합 → `{runId,runtime,mode,state,recordedAt,createdAt,updatedAt,goal,agent,requestedBy}` 반환. 구 manifest(agent 없음)→`agent:null` 파싱 성공 | manifest 없는/파손 run → `valid:false` skip(전체 실패 아님). manifest 없이도 status만으로 경량레코드 최소필드 채움 |
| **A48** | state/runtime enum·mode/agent 리터럴·from/to ISO·sort∈{recordedAt,updatedAt,state}·order enum·offset/limit clamp 정상 파싱 | `state=<임의문자열>` → **400** · `sort=xxx` → 400 · `from=notdate` → 400 · `agent=../x`(SAFE_SEGMENT 위반) → 400 · `limit=99999` → **clamp 100** · `offset` 음수 → clamp 0 |
| **A49** | `q="foo"` → goal/mode/agent/requestedBy 대소문자 무시 리터럴 부분일치 | `q=(a+)+` · `q=.*` · `q=[a-z]+` → **리터럴 취급**(ReDoS 없음·정규식 컴파일 없음·매칭 결과 = 해당 리터럴 포함 run만). `new RegExp` 미사용 정적검사 |
| **A50** | 정상 run dir status/manifest/events read(safeRunDir+safeOpen 경로) | **심링크/reparse run dir → 공용 경화 리더 거부**(`_workspace` 밖 리다이렉트 차단·통합감사-#3) · 초과크기(>MAX_JSON_BYTES) manifest → skip · malformed/stat불가 runId → **quarantine**(valid:false) · `../etc` runId → null |
| **A51** | 스캔 창=recordedAt(FS-time) 최신 상위 N → 매칭 전체 전역 정렬(sort+order)·tie-break=runId·offset/limit slice → `{items,total,offset,limit,hasMore,scanned,truncated,schemaVersion}`. **ACCEPT: UUID·`run-1`/`run-10` 혼재도 FS시간 최신 N 정확**(runId 사전식 아님) | `MAX_RUNS_SCAN` 초과 → `truncated:true` · 대량 디렉토리 → 상위 N만 read(전건 read 아님) · **페이지 버퍼만 재정렬 금지**(전역 정렬 assert) |
| **A52** | Runs UI 필터바·정렬·페이지·칩·결과카운트·필터초기화·URL 반영·3-state(A46)·절단 고지(A95·원인별 문구) · 빈상태 CTA(A82) | 파일 무변경(읽기전용·mutating 없음 → Origin 게이트 무관) assert · dangerouslySetInnerHTML 부재(XSS) |
| **A83**(회귀·V6) | 패널별 독립 로딩·부분실패 격리(한 패널 실패가 전체 붕괴 아님) | 단일 실패로 전체 화면 blank → 실패 |
| **A92**(회귀·V6) | 키보드 조작·포커스 링 가시·색 대비 AA·색+아이콘/텍스트 병기 | 색만으로 상태 구분·키보드 도달 불가 → 실패 |

**§위협 스위트 F4-쿼리·리더 거부케이스(8+) = 위 A48~A51 negative 열 전부:** `q=(a+)+`·`q=.*`(리터럴)·`state=<임의>`(400)·`limit=99999`(clamp)·`MAX_RUNS_SCAN` 초과(truncated)·대량 디렉토리(상위 N)·초과크기 manifest(skip)·malformed/stat불가 runId(quarantine)·심링크/reparse run dir(거부·밖 리다이렉트 차단). **ACCEPT: UUID·`run-10` FS시간 최신 N 정확.**

## 정합성/열린 질문 (오케스트레이터 판정 요청 — 봉합 금지)

1. **`recordedAt` = birthtime vs mtime 결정성** — 설계 F4.3은 `birthtimeMs`(미지원 FS는 `mtimeMs` fallback). **디렉토리 mtime은 status.json 원자쓰기(rename)로 엔트리 변경 시 갱신됨** → mtime fallback 경로에서 recordedAt이 "기록 시각"이 아니라 "최근 상태갱신 시각"이 되어 정렬·from/to 의미가 흔들린다. birthtime 지원 OS에선 안정. **제안:** birthtime 우선·mtime fallback·tie-break=runId 명시 + fallback 시 비결정 가능성을 UI 라벨/상세 주석으로 정직 고지. 판정 필요.
2. **manifest.agent 스키마 read/write 분리 — [오케스트레이터 결정 반영·확정].** A47 행(M7)은 응답에 `agent(optional)`를 요구하나 writer(supervisor)는 F2/M10. **결정: read/write 분리.** M7=`schemas.ts` `Manifest`에 additive optional 단수 `agent`(nullable·구 manifest→null 마이그레이션 테스트 T-S1) **필드 추가·읽기/파싱 하위호환만**. M10=writer(supervisor가 `exec-run.ts:manifest()` L43-49에 요청값 or null 기록·S1/S4) 배선. 두 계획서가 상호 참조(M10 정합성 #2). M7에 writer 없음이 정본과 정합(봉합 아님).
3. **무인자 vs 인자 응답 shape 이원화** — F4.2는 무인자=기존 `{runs:[{runId,status,valid}]}`, 인자=신규 `{items,total,...}`. UI 필터바는 항상 sort/order/limit default를 붙이므로 사실상 항상 "인자" 분기(신규 shape) 사용. 무인자 하위호환은 외부/레거시 호출자용. **분기 판단은 Zod default 적용 前 raw 쿼리 presence로** 해야 함(default가 무인자를 인자로 오판 방지). 이 이원화가 의도인지 확인 — 아니면 UI 전용 신규 shape 단일화 검토.
4. **goalExcerpt vs goal** — F4.3 경량레코드는 `goalExcerpt(≤200자)`, F4.4 응답·A47은 `goal`. 응답 필드명·절단 여부(전문 vs ≤200자) 확정 필요. **제안:** 응답 필드명 `goal`, 값은 ≤200자 excerpt(목록 경량화)·전문은 RunDetail에서. 판정 필요.
5. **공용 경화 리더 앵커 파라미터화 시점 — [오케스트레이터 결정 반영·확정].** impl 스킬은 F4/F6/F8 공유 앵커-파라미터 리더를 권고하나, M7 F4 앵커는 `_workspace/runs`로 기존 `safeRunDir`(L14-29)가 이미 정확·충분(중간 세그먼트 없음). **결정:** M7은 기존 `safeRunDir`/`safeOpen`을 앵커=`_workspace/runs`로 **그대로 사용**(2벌 구현 금지). **앵커 파라미터화(공용화 추출)는 2번째 앵커가 등장하는 M9에서 `runs.ts`에서 추출**하고 M13(F8, `evals-rollup` 앵커)이 재사용한다. M7 선제 추출은 YAGNI·외과적 변경 위반 → 하지 않음. (이 항목은 판정 완료·봉합 아님.)
6. **참고(스코프 외):** `screens.tsx` `RunDetail`의 events 소비가 `{events:[{seq,type,message}]}` shape로 어댑터 실제 반환 `{items:[...]}`(runs.ts `readEvents` L114-120)와 어긋남(기존 v0.5 잔존). F4 스코프 아니나 발견 보고 — M7에서 건드리지 않음.

## 소스레벨 검토 반영 (2026-07-09)

**검증 완료(파일:라인 실재 확인):**
- `safeRunDir`(runs.ts:14-29)·`safeOpen`(L33-42)·`readJsonSafe`(L43-49) 실재 — 재사용 주장 정확. 앵커는 `runsDir(root)`=`_workspace/runs`로 하드코딩(L16-17), 파라미터 아님 확인.
- `listRuns`(L51-67)는 전 디렉토리 열거·FS-time 정렬/상위 N 캡 미구현 확인 → `queryRuns` 신규 필요 확정.
- `schemas.ts` `Manifest`(L14-28)에 단수 `agent` **부재**·`agents: z.array(z.string())`(L23)만 존재 확인 → S1은 신규 additive(read 측).
- `GET /api/runs`(api/index.ts:41)는 `listRuns(projectRoot)` 직결·쿼리 파싱 전무 확인 → S4 분기 신규.
- `RunState`/`Runtime` enum(schemas.ts:4-9)·`SAFE_SEGMENT`/`isSafeSegment`(paths.ts:15-21) 실재 → RunsQuery에서 재사용 가능.

**보강한 것:**
- 서버 작업을 S1~S4 + **서버 테스트 작업 T-S1~T-S5** + **F4 거부 스위트 R-1~R-8(8건 전량)+R-ACCEPT**로 분해(작업 단위 세분화·테스트 파일 배치 명시).
- 오케스트레이터 교차조정 결정 3건 반영: (1) 공용 경화 리더 앵커 파라미터화 = M9가 추출·M7은 기존 그대로(정합성 #5 확정), (2) Manifest.agent read/write 분리 = M7 read·M10 writer(정합성 #2 확정·상호 참조), (3) recordedAt birthtime/mtime 비결정성 정직 고지 강화(`recordedAtSource` 필드 제안·S3 step2).

**오케스트레이터 판정 필요 잔여:**
- 정합성 #1 recordedAt mtime fallback 비결정성 — `recordedAtSource` 필드 노출 + manifest `createdAt` 보조키 병용(V14)으로 완화하되 정렬 결정성은 birthtime 전제(수용 한계 여부 판정).
- 정합성 #3 무인자/인자 응답 shape 이원화 — UI 전용 신규 shape 단일화 여부.
- 정합성 #4 `goalExcerpt` vs `goal` 필드명·절단(≤200자) 확정.

## 외부 리뷰 반영 (2026-07-09 — v0.6-todo-audit · codex+agy)

> 원장: `_workspace/reviews/v0.6-todo-audit_verdicts.json`. 전건 확인 판정 중 M7 해당분 반영.

| verdict | 요지 | 반영 위치 | 잔여 |
|---------|------|-----------|------|
| **V1**[HIGH] | `limit` `z.max(100)`는 `99999`를 clamp 아닌 **400으로 거부** → A48/위협스위트 clamp 요구(R-4)와 충돌 | S2를 `z.preprocess`/transform **clamp 후 range 검증**으로 정정(enum/datetime/SAFE_SEGMENT는 여전히 400). R-4 clamp 케이스 정합 | **설계서 §F4.3 line66 코드블록도 `z.max(100)`(거부)로 동일 충돌 → 정본 정정 필요**(server-builder 보고) |
| **V2**[HIGH] | `readJsonSafe`(runs.ts:43)는 전체 `readFile`·크기상한 없음 → "그대로 재사용 + MAX_JSON_BYTES skip" 요구와 충돌 | 대상 파일·S3·step3에서 **`readJsonSafe` 재사용 철회**, **`readJsonCapped` 신규**(`safeOpen`+`fstat.size` 검사+제한읽기). 재사용은 `safeRunDir`/`safeOpen`까지만. R-5를 **대용량서 `readFile` 미호출 검증**으로 강화 | 없음 |
| **V13**[HIGH] | 콜드캐시/Windows서 5000개 2초 불가·`truncated` 두 원인(캡 vs 데드라인) 혼동 | 응답에 **`truncatedReason: limit_reached\|deadline_exceeded\|null`** 분리·UI 원인별 문구(W3)·`MAX_RUNS_SCAN` 현실화(예 1000) + 대상 OS 실측(AS3). R-8을 두 원인 개별 assert로 | `MAX_RUNS_SCAN` 확정값·`SCAN_DEADLINE_MS` 실측(AS3에서 측정) |
| **V14**[부분] | mtime fallback 시 정렬/기간 의미 변질 — 고지만으로 부족 | step2에 **manifest `createdAt` 보조 정렬/필터 키 병용**(tie-break 우선·from/to 판정 우선) 추가 | birthtime 미지원 FS의 정렬 결정성은 근본적으로 근사(수용 한계) |
| **V6**[MED] | A83(패널별 독립로딩·부분실패 격리)·A92(키보드·포커스·색비의존·WCAG AA) 테스트매핑 전무 | 웹 **W4 신규**·수용기준표 **A83/A92 행 추가**(회귀) | 없음 |
