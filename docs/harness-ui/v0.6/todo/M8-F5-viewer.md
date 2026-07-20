# M8 — F5 문서/artifact 뷰어 작업계획서 (체크리스트)

> ✅ **완료(2026-07-09).** 구현·게이트·QA·배선·외부감사 전부 통과. 전 체크박스 완료.
> - **게이트:** typecheck PASS · `npm run test` **247/247 PASS**(29 파일) · build PASS · v0.5 회귀 0.
> - **경로탈출·XSS 중대 방어:** DV1~DV9 — `openSafeFile` 공용 경화 리더(화이트루트·per-seg·realpath 이중앵커·전 세그먼트 lstat 심링크 무조건거부·O_NOFOLLOW·dev/ino·**post-walk 재검증 TOCTOU 폐쇄**)·docs 트리 realpath containment(junction 방어)·`deniedDocsPath`(secret 거부·정상문서 ACCEPT)·`isSafeDocsSegment`(유니코드 파일명·트리↔열람 정합)·413 스트림 前·바이너리 stream decode. **DV8 XSS:** 클라 markdown-it(html:false)+DOMPurify+scheme 화이트리스트+외부리소스 차단+CSP+nosniff — XSS 거부 스위트 DOM 파싱 기반 전건 무력화.
> - **QA·배선:** 경계면 0·dead link 0·거부 스위트 전건 fail-closed·XSS 무력화·runtime deps(markdown-it/dompurify) advisory 0.
> - **외부감사(codex+agy) R1~R3 → 최종 HIGH 0(양 엔진):** R1 중간 세그먼트 TOCTOU·docs 유니코드 파일명, R2 트리 junction containment·바이너리 오판 순차 해소. 원장: `_workspace/reviews/m8-code-r*`.


> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F5.1~F5.4 · DV1~DV9 · A53~A59 · A89 · A98 · §위협 스위트 F5-뷰어.
> 이 문서는 **계획(체크리스트)**. 구현·커밋은 server-builder / web-builder 몫. 코드 예시는 판정 근거로만 파일:라인 인용.

## 개요

- **마일스톤:** M8 (설계서 §마일스톤 M7→M13 순서 고정, F5).
- **기능:** F5 문서/artifact 뷰어 — `docs/**`와 run artifacts를 화면에서 브라우징·열람. **읽기전용**(I8 유지, F5는 영구 읽기전용 비목표에도 명시).
- **리스크 등급: 중대.** 근거 = 경로탈출(임의 파일 read)·XSS(DV8 치명) 두 축. 게이트 강도 = 중대: server-builder/web-builder TDD(Red→Green) + qa-verifier 거부 스위트 전건 + security-auditor 방어층 DV1~DV9 fail-closed 코드 대조 + 외부 리뷰(경로안전·XSS 계약 테스트). `_workspace/.autonomous` 무관하게 중대 게이트 강제.
- **건드릴 파일 후보:**
  - 서버: `src/server/api/index.ts`(docs 라우트 신규·artifact 재사용), `src/server/adapters/statestats.ts`(listMd/notSymlinkDir/readCapped 확장 또는 신규 `docs.ts` 어댑터로 분리 판단), `src/server/security.ts`(DENY 확장·CSP 헤더), `src/server/lib/paths.ts`(기존 재사용, 무변경 우선). 공용 경화 리더는 앵커 파라미터화(통합감사 #3).
  - 웹: `src/web/screens.tsx`(뷰어 컴포넌트·RunDetail 진입 확장·Overview 결과서 진입), `src/web/api.ts`(docs fetch·413/바이너리 처리), `src/web/ui.tsx`(필요 시 badge/state 프리미티브 재사용).
  - 의존성: `package.json`(DV8 마크다운 렌더러+sanitizer 신규 — 아래 §신규 의존성).
  - 테스트: `test/docsapi.test.ts`(신규·경로/스위트), `test/security.test.ts`(deniedPath 확장 케이스), 웹 컴포넌트 테스트.

## 선행/선검증 (착수 전 — 가정 위 구현 금지)

- [x] **AS4(Windows 심링크/junction) 선검증 [V16·HIGH 격상]** — DV4는 `lstat().isSymbolicLink()` + `O_NOFOLLOW` 의존. **Windows reparse point(junction·마운트·OneDrive·AppExecLink)는 `isSymbolicLink()=false`로 미탐 + `O_NOFOLLOW` 효과 불일치 → lstat/O_NOFOLLOW 단독 우회 가능**(agy#5·설계서 AS4 "알려진 한계·강화"). **∴ realpath 조상 walk + `isWithinRoot(realBase, real)`(api/index.ts:95-96 패턴)를 lstat/O_NOFOLLOW와 별개의 "최후방어(last-line defense)"로 절대 유지** — lstat이 미탐해도 realpath 경계검사가 out-root 대상을 닫는다(D2/D6 앵커). **필수 CI 게이트(skip 불가):** 3-OS CI에 **Windows junction/symlink 공격 픽스처**(junction→out-root·reparse→out-root)를 넣어 docs 뷰어 거부가 실제로 닫히는지 못박는다. lstat 단독 비의존을 테스트로 증명.
- [x] **DV4 규율 동일성 확인 (완료·근거 확보):** "전 세그먼트 lstat 심링크 무조건 거부(in-root든 out-root든)"는 기존 artifact 서빙과 **동일 규율**임을 코드로 확인 — `api/index.ts:80-99`가 정확히 (a) base부터 leaf 부모까지 walk lstat 심링크 거부(:81-85), (b) leaf `O_NOFOLLOW` open(:88), (c) fstat 정규파일(:92), (d) realpath 이중 앵커 재확인(:95-96), (e) dev/ino 바인딩(:98-99)을 이미 수행. **docs 라우트는 base만 `join(projectRoot,"docs")`로 바꿔 이 패턴을 앵커 파라미터화 재사용**(신규 방어 발명 아님). realpath 경계검사만으로 중간 세그먼트 허용 금지(감사 R1-#2/I6/A54).
- [x] **DV8 sanitizer/CSP 착수 게이트 선행 — ⚠️ [V4·HIGH 승격] 웹 렌더 구현 前 필수 통과 게이트(미충족 시 렌더 경로 착수 금지):** 마크다운 렌더러·sanitizer가 현재 의존성에 **전무**(package.json `dependencies` = react/react-dom/fastify/zod + @types만, `grep markdown-it|dompurify|sanitize` = 0). DV8이 열린질문인 채로 웹을 착수하면 `dangerouslySetInnerHTML` 정책이 흔들려 XSS 방어가 무너진다(codex#4·agy#6). **∴ 아래 3건을 웹 구현 착수 前 필수 체크로 못박고, 전건 통과 전엔 "렌더" 경로 착수 금지:**
  - [x] **(게이트-1) 후보 A(클라 DOMPurify) vs B(서버 SSR sanitize-html) 택1 결정 확정** — §열린 질문 1. 미결 상태로 착수 불가. (로컬 단일사용자·읽기전용 → 결합 최소 후보 A 권장, 오케스트레이터 최종 판정.) 결정에 따라 신규 런타임 의존성 2종(`markdown-it`(`html:false`) + DOMPurify 또는 sanitize-html) 추가 — 공급망 감사 대상.
  - [x] **(게이트-2) 파일응답 CSP 범위 확정** — 현 `onSend`(security.ts:81-85)는 nosniff·no-referrer만·CSP **부재**. 파일응답에 `default-src 'none'; script-src 'none'; img-src 'self'` 등 신규. **범위 = 파일응답(직접 내비게이션) 헤더 CSP + SPA 내 렌더는 sanitizer 주방어**(§열린 질문 2)로 확정 후 착수(어디에 CSP를 붙이는지 모호한 채 착수 금지).
  - [x] **(게이트-3) sanitizer URL scheme 화이트리스트 테스트 선작성** — `javascript:`·`data:` scheme 거부 + `http`/`https`/`mailto` 통과를 검증하는 테스트(거부 스위트 케이스 15·16)를 **웹 렌더 구현 前 Red 상태로 선작성**. sanitizer 파이프라인이 이 테스트를 Green으로 만드는 방식으로만 구현.
  - **미결이면:** raw-escaped 경로(무의존)만 선구현 가능하나, 마크다운 **렌더** 경로는 위 3게이트 전건 통과 전 착수 금지.
- [x] **docs/ 재귀 범위 denylist 확정(DV5·감사 열린질문 §639-4):** `docs/` 전체 재귀 노출 시 우발적 민감파일 노출 검토 → DV5 확장자 규칙·DV7 바이너리·DV6 크기상한으로 방어. 하위 디렉토리 추가 제한 필요 여부 오케스트레이터 판정.
- [x] **[V12·LOW] `/events` 소비 shape 회귀 — F5 RunDetail 변경 前 선행 버그픽스(기존 버그):** 서버 `readEvents`(runs.ts:113-116)는 `{items, nextAfter, hasMore, runState}`를 반환하나 웹 `RunDetail`(screens.tsx:175)은 `{events: Array<...>}`로 소비 → `ev.data.events`가 항상 `undefined`라 **현재 런상세 이벤트 목록이 이미 깨진 채 방치**. B-3에서 RunDetail을 공유 뷰어로 승격하기 **전에** 이 shape 불일치를 먼저 잡는다. **서버 SSOT = `items`**(변경 없음·페이지네이션 계약 유지). 정정 방향 = 웹 소비를 `items`(+`nextAfter`/`hasMore`)로 교정(web-builder 파일권 `src/web/**` — server-builder는 계약 shape을 `{items,...}`로 확정·통지만). 회귀 테스트: `/events` 응답 shape assert(server) + RunDetail 이벤트 렌더 assert(web).

## 작업 체크리스트

### A. 서버 — docs API + 뷰어 방어층 (server-builder, `src/server/**`)

#### A-1. 공용 경화 리더 앵커 파라미터화 (통합감사 #3 재사용)
- [x] `api/index.ts:67-107` artifact 서빙의 walk-lstat / O_NOFOLLOW / fstat / realpath 이중앵커 / dev·ino 바인딩 로직을 **앵커(base) 파라미터화한 공용 함수**로 추출(예 `serveSafeFile(projectRoot, base, segs, {viewMax, artifactMax})`). 하드코딩 base 금지. 기존 artifact 라우트도 이 공용 함수 소비로 전환(동작 불변 — 외과적, dev-rules §3).
- [x] 추출은 동작 회귀 없음을 기존 `test/m4api.test.ts` artifact 스위트로 보증(리팩토링 안전망).

#### A-2. DV1 열람 루트 화이트리스트 (신규)
- [x] `GET /api/docs` — `docs/` 트리(디렉토리·파일 목록). base = `join(projectRoot,"docs")`. `statestats.ts:11-21` `notSymlinkDir`/`listMd`(심링크 디렉토리 거부·MAX_DOCS cap) 재사용·확장(md 외 txt/json/log 포함 확장 판단). **`docs/`·`_workspace/runs/{runId}/artifacts/` 두 루트 외 요청 = 400.** projectRoot 밖 원천 불가.
- [x] `GET /api/docs/*` — docs 하위 파일 열람. A-1 공용 함수를 base=docs로 호출.
- [x] run artifacts(`/api/runs/:runId/artifacts`·`/*`)는 기존 유지(A27/A28/A45) — 뷰어가 이 엔드포인트 소비.

#### A-3. DV2·DV3·DV4 경로안전 (재사용)
- [x] DV2 per-세그먼트 `isSafeSegment`(paths.ts:18) — 빈/`.`/`..`/메타 거부. `rel.split("/")` 전 세그먼트 검사(api/index.ts:70-71 패턴).
- [x] DV3 realpath 앵커 선계산 — walk 이전 `realpath(base)` + `isWithinRoot(realRoot, realBase)`(api/index.ts:77-79).
- [x] DV4 전 세그먼트 lstat 심링크 무조건 거부 + leaf O_NOFOLLOW + fstat 정규파일 + realpath 재확인 + dev/ino 바인딩(api/index.ts:81-99). **realpath 경계검사로 대체 금지.**

#### A-4. DV5 denylist 확장 (security.ts 확장 + docs용 denylist 분리)
- [x] `deniedPath`(security.ts:90-94) 재사용. dot-prefix 세그먼트(`.env`·`.git`·`.ssh`·`.aws`)와 node_modules는 기존 `DENY`(security.ts:89)가 이미 커버 — **재확인만**.
- [x] **신규 추가(확장자·비-dot 파일명 기반):** `*.key`·`*.pem`·`*.p12`·`*.pfx`·`id_rsa*`. 기존 정규식은 dot-prefix만 잡으므로 `foo.key`·`id_rsa`(비-dot)는 미커버 → deniedPath에 확장자/파일명 규칙 추가.
- [x] **[V5·MED 본작업] `registry` 부분일치 오거부 정정 — docs용 denylist 분리·세그먼트 앵커화:** 현 `deniedPath`(security.ts:92)는 `/registry/i`를 **부분일치(anchor 없음)**로 거부 → artifact엔 무해하나 **docs 뷰어에 그대로 재사용하면 `docs/registry-*.md`·본문에 "registry"/"session" 포함된 정상 문서를 오거부**(codex#5). `session\.key`도 산문에서 오탐 가능. **∴ docs 라우트는 (a) 별도 docs 전용 denylist를 두거나 (b) `registry` 패턴을 세그먼트 앵커(`(^|\/)registry(\/|$)`)로 좁혀 파일명/세그먼트 단위로만 매칭**. **ACCEPT 계약(오거부 금지):** 파일명·본문에 "registry"/"session"이 포함된 정상 docs 문서(`registry-notes.md` 등)는 200으로 통과해야 함. 이 ACCEPT 케이스를 A55/A57 매핑(아래 통과표·거부표)에 회귀로 못박는다.
- [x] denylist는 **해석 전(rel 문자열)** 적용(DV5).

#### A-5. DV6 크기상한 (fstat 스트림 前 — 재사용+확장)
- [x] 다운로드: `fstat.size > ARTIFACT_MAX`(8MB) → **스트림 시작 前 `413` 즉시 반환**(api/index.ts:91-93 이미 구현). **중간 스트림 중단 금지**(A98·R2-#5 — 부분파일 손상 방지). 413 body에 크기·상한 명시.
- [x] 미리보기: **`VIEW_MAX`(예 1MB) 신규 도입** — 초과 시 미리보기 거부·절단 표시(현재 statestats `MAX_DOC_BYTES`=256KB는 내부 스캔용, 뷰어 VIEW_MAX와 별개). 응답에 `truncated`·`fullSize` 메타 포함(UI 배너용).

#### A-6. DV7 바이너리 거부 (신규)
- [x] readCapped(statestats.ts:23-36) 확장 또는 신규 — **널바이트/비-UTF8 감지** → 미리보기 거부, attachment 다운로드만 허용(하드상한 적용). 응답에 `binary: true` 메타.

#### A-7. DV8 렌더 안전 헤더 + MIME 화이트리스트 (치명·신규)
- [x] **CSP 헤더** — docs/artifact 파일 응답에 `default-src 'none'; img-src 'self'; style-src 'self'; script-src 'none'; frame-ancestors 'none'` 추가. 현재 onSend(security.ts:81-85)는 nosniff·no-referrer만 → CSP 신규. **적용 지점 결정(§열린 질문): API 파일응답 헤더 vs SPA 문서 CSP** — 직접 내비게이션 방어는 파일응답 헤더, SPA 내 렌더 방어는 sanitizer.
- [x] **MIME 화이트리스트로 렌더 결정** — md/txt/json/log = sanitized 미리보기 허용, 그 외(SVG/HTML/JS 포함) = `Content-Disposition: attachment` 다운로드만·비렌더(A14 준용). nosniff 유지(security.ts:82).
- [x] 서버가 raw 텍스트를 반환하되 클라 sanitizer가 렌더(설계 §F5.3 — SSR 또는 클라 신뢰 컴포넌트 동일 정책). 반환 형태(JSON `{content,mime,truncated,binary}` vs raw+헤더) 결정.

#### A-8. DV9 fail-closed
- [x] DV1~DV8 중 하나라도 실패 = 400/403/413, 열람 안 함. 모든 거부 경로가 fail-closed로 닫히는지 코드 추적(security-auditor 대상).

### B. 웹 — 뷰어 컴포넌트 + UX (web-builder, `src/web/**`)

#### B-1. 신규 의존성 (DV8)
- [x] 마크다운 렌더러 + sanitizer 추가(§신규 의존성 후보 참조). `package.json` dependencies에 추가. **`html:false` 파싱 + sanitizer allowlist + URL scheme 화이트리스트(http/https/mailto) + 외부리소스 차단** 파이프라인 구성.
- [x] `dangerouslySetInnerHTML` 도입 시(sanitize된 HTML 렌더용) — screens.tsx:2 "innerHTML 미사용" 주석 정정 + **sanitizer 통과분만** 주입·CSP 백스톱. 미도입(escaped-only) 경로도 병행 가능.

#### B-2. 공유 뷰어 컴포넌트 (A59·A89)
- [x] **파일 트리 + 브레드크럼**(A89) — `GET /api/docs` 트리 소비. 읽기전용.
- [x] escaped text 기본 렌더 + **마크다운 렌더 ↔ raw 토글**(A89·DV8 — raw도 React escape·비실행).
- [x] 다운로드 버튼(artifact fetch → blob, api.ts:53-57 fetchArtifact 패턴 확장).
- [x] 빈/로딩/에러 3-state(A46·A81 횡단).

#### B-3. 진입점 배선 (A59·F5.4)
- [x] **Runs 상세**(screens.tsx:173-199 RunDetail) — 기존 `art` `<pre>` 렌더(:194)를 공유 뷰어 컴포넌트로 승격(A45 확장). fetchArtifact → 뷰어.
- [x] **Overview** — D4 규율/진화 이력 카드(A36/A38·screens.tsx:52)에서 결과서(`docs/*/working_history`) 클릭 → 뷰어 진입.

#### B-4. UX 상태 (A89·A98)
- [x] 미리보기 크기초과 → "미리보기 잘림(N까지)·전체 다운로드" 배너(VIEW_MAX·truncated 메타).
- [x] **다운로드 413 포착 → "파일이 너무 큼 · 로컬에서 열기" + 로컬 절대경로 표시**(A98 — OS 직접 열기 안내). api.ts에 413 상태 처리 추가(현재 apiGet은 401만 특수처리·:33).
- [x] 바이너리(binary 메타) → "미리보기 불가(바이너리)·다운로드".

#### B-5. 공통 UI 회귀 (A83·A92 — [V6·MED])
- [x] **A83 패널별 독립 로딩·부분실패 격리:** 뷰어 화면의 파일 트리·미리보기·다운로드 상태가 **각각 독립 로딩/에러**로 처리되고, 한 패널(예 미리보기 413/바이너리)의 실패가 다른 패널(트리·브레드크럼)을 무너뜨리지 않는다. 3-state(A46·A81)를 패널 단위로.
- [x] **A92 접근성(WCAG AA):** 트리·브레드크럼·렌더↔raw 토글·다운로드 버튼이 **키보드 조작 가능**·포커스 링 가시·색 대비 AA·상태(잘림/바이너리/에러)를 **색상 단독 의존 없이** 텍스트/아이콘 병기.

## 수용기준 → 테스트 매핑

### 통과(positive)
| A | 통과 검증 |
|---|-----------|
| A53 | `GET /api/docs` 트리 반환(docs 루트만)·`GET /api/docs/*` 정상 md/txt/json/log 열람 200 |
| A54 | 정상 docs 하위 파일(심링크·`..` 없음) 열람 성공·leaf 정규파일 |
| A55 | 정상 파일명(민감 아님) 통과 · **[V5 ACCEPT] 파일명/본문에 "registry"/"session" 포함 정상 docs(`registry-*.md` 등) → 200(부분일치 오거부 금지·세그먼트 앵커 denylist)** |
| A56 | VIEW_MAX 이하 미리보기 정상·ARTIFACT_MAX 이하 다운로드 정상·`truncated=false` |
| A58 | md 렌더 시 정상 마크다운(제목/링크 http)·CSP·nosniff 헤더 존재·MIME 화이트리스트 md/txt/json 미리보기 |
| A59 | docs 트리 렌더·마크다운/코드 렌더·Runs artifact 진입·Overview 결과서 진입·읽기전용·3-state |
| A89 | 트리/브레드크럼 표시·렌더↔raw 토글 동작 |
| A98 | 413 시 로컬 경로 안내 배너 |
| A83 | **[V6] 패널별 독립 로딩·부분실패 격리 — 미리보기/트리/다운로드 각 3-state·한 패널 실패가 타 패널 미붕괴** |
| A92 | **[V6] 키보드 조작·포커스 가시·색비의존·WCAG AA — 트리/토글/다운로드/상태배너** |
| — | **하위호환:** 기존 artifact 라우트(A27/A28/A45) 회귀 없음(공용 함수 추출 후) |

### 거부(negative) — §위협 스위트 F5-뷰어 전건 (각 케이스 = 개별 테스트, fail-closed)
| # | 공격 벡터 | 기대 | 방어층 | A |
|---|-----------|------|--------|---|
| 1 | `../../etc/passwd` | 400 | DV2/DV4 | A54·A57 |
| 2 | `/etc/passwd`(절대경로) | 400 | DV1/DV2 | A53·A57 |
| 3 | 심링크 → `/etc`(out-root) | 400 symlink-in-path | DV4 | A54·A57 |
| 4 | **in-root 심링크**(projectRoot 내부 대상) | 400(무조건 거부·realpath 경계로 허용 금지) | DV4 | A54·A57 |
| 5 | 중간 세그먼트 스왑(walk 후 부모 교체) | 400/409(dev·ino 바인딩) | DV4 | A54·A57 |
| 6 | `docs/../.git/config` | 400 | DV2/DV5 | A55·A57 |
| 7 | `.env` | 400(dot-prefix DENY) | DV5 | A55·A57 |
| 8 | `~/.ssh/id_rsa` · 비-dot `id_rsa`·`foo.key`·`foo.pem` | 400(확장자·파일명 규칙 신규) | DV5 | A55·A57 |
| 9 | 화이트리스트 밖(`harness-ui/src/..`·node_modules·`.git`) | 400 | DV1/DV5 | A53·A57 |
| 10 | 바이너리 파일 미리보기 요청 | 미리보기 거부 → attachment만 | DV7 | A56·A57 |
| 11 | 초과크기 **미리보기**(VIEW_MAX 초과) | 절단·미리보기 거부 표시 | DV6 | A56·A57 |
| 12 | 초과크기 **다운로드**(ARTIFACT_MAX 초과) | **스트림 前 413**(중간중단 금지) | DV6 | A56·A57·A98 |
| 13 | XSS `<script>` in md | 렌더 시 escape·비실행 | DV8 | A57·A58 |
| 14 | XSS `onerror=` 이벤트핸들러 | sanitizer 제거 | DV8 | A57·A58 |
| 15 | XSS `javascript:` URL | scheme 화이트리스트 거부 | DV8 | A57·A58 |
| 16 | XSS `data:` URL | scheme 거부 | DV8 | A57·A58 |
| 17 | 원격 `<img src=원격>` | 외부리소스 차단(CSP img-src 'self') | DV8 | A57·A58 |
| 18 | SVG 내 스크립트 / SVG 파일 | 비렌더·attachment만 | DV8 | A57·A58 |

> 거부 스위트는 server-builder TDD Red 단계 + qa-verifier 실행 + security-auditor 코드 대조(파일:라인) 삼중 검증. 케이스 4·13~17이 이 마일스톤의 핵심 신규 리스크.

## 정합성/열린 질문

### DV1~DV9 실재 판정 (코드 대조 결과)
| DV | 상태 | 근거 |
|----|------|------|
| DV1 화이트리스트 | (c) 신규(docs 라우트) | `/api/docs*` 부재. 트리 프리미티브(listMd/notSymlinkDir)만 statestats.ts:11-21 재사용 |
| DV2 per-seg | (a) 있음 | paths.ts:18 `isSafeSegment`, api/index.ts:71 사용 패턴 |
| DV3 realpath 앵커 | (a) 있음 | api/index.ts:77-79 |
| DV4 심링크 무조건거부+O_NOFOLLOW | (a) 있음(패턴 재사용) | api/index.ts:81-99 — **기존 artifact와 완전 동일 규율(확인 완료)**, base만 파라미터화 |
| DV5 denylist | (b) 확장 | security.ts:89-93 dot-prefix·node_modules 커버, **확장자(`*.key` 등)·비-dot(`id_rsa`) 신규 추가 필요** |
| DV6 크기상한 | (a) 다운로드 있음 / (b) 미리보기 확장 | 다운로드 413 api/index.ts:91-93 존재, **VIEW_MAX 미리보기 절단 신규** |
| DV7 바이너리거부 | (c) 신규 | readCapped(statestats.ts:23-36)는 utf8 무조건 변환, 널바이트/비-UTF8 감지 없음 |
| DV8 XSS 렌더안전 | (c) 신규(치명) | 렌더러·sanitizer 의존성 전무(package.json), CSP 헤더 부재(security.ts:81-85 nosniff만), 웹은 현재 escaped `<pre>`만(screens.tsx:194) |
| DV9 fail-closed | (a) 원칙 | 400/403/413 반환 패턴 존재 |

### 신규 의존성 후보 (DV8 — 오케스트레이터 승인 필요)
- **후보 A(권장):** `markdown-it`(`html:false` — raw HTML 무시) + `DOMPurify`(클라이언트 sanitize, `dangerouslySetInnerHTML` 주입 전). scheme 화이트리스트는 markdown-it `validateLink` + DOMPurify `ALLOWED_URI_REGEXP`.
- **후보 B:** `sanitize-html`(서버측 SSR sanitize) + markdown-it. 클라에 `dangerouslySetInnerHTML` 노출 최소화하나 서버 렌더 결합 증가.
- 공통: 외부리소스 차단은 CSP(`img-src 'self'`) + sanitizer 속성 allowlist 이중. 번들/의존성 감사(신규 dep 공급망) 필요.
- **열린 질문 1(sanitizer 선택):** 후보 A/B 중 택1 — 서버 SSR sanitize vs 클라 sanitize. 로컬 단일사용자·읽기전용 특성상 클라 sanitize(후보 A)가 결합 최소. 오케스트레이터 판정.

### 열린 질문
- **열린 질문 2(CSP 적용 지점):** 설계 CSP(`script-src 'none'`)는 doc **콘텐츠 응답** 대상. 그러나 콘텐츠는 SPA 내부에서 렌더되므로 파일응답 헤더 CSP는 **직접 내비게이션**(`/api/docs/*` 직접 접근)만 방어. SPA 내 렌더의 실질 방어는 sanitizer. Vite/React SPA 문서에 `script-src 'none'` 적용은 앱 자체 스크립트를 깨므로 불가. → **파일응답에만 엄격 CSP, SPA 내 렌더는 sanitizer가 주 방어**로 정리(설계 의도와 정합 확인 요청).
- **열린 질문 3(docs 재귀 범위·DV5):** 설계 §639-4 — `docs/` 전체 재귀 노출 시 우발적 민감파일 검토. DV5 denylist·DV7·DV6로 방어하되 하위 디렉토리 추가 화이트리스트 제한(예 `working_history`·`design`·PRD 등 지정 서브트리만) 필요 여부 판정. 현 계획은 재귀 전체 + denylist 방어 전제.

### 설계 정합성 점검 (발견 불일치 — 봉합 안 함, 보고)
- **정합:** F5 핵심 계약(읽기전용·docs+runs 두 루트 화이트리스트·전 세그먼트 심링크 무조건 거부·DV8 XSS·413 손상방지)은 설계서 §F5·A53~A59·§위협 스위트·§마일스톤 M8 DoD 전부 일관.
- **경미 stale(M8 무영향, 참고):** milestone-spec 스킬이 지적한 UX 수용기준 "A81-A99" vs 정본 "A81~A101" 표기 혼재 — M8은 A89·A98만 걸림(정본 라인 538·547 존재 확인), 영향 없음. PRD·page-requirements 헤더 "A47-A71" stale·"읽기전용" 문구는 F5엔 오히려 정합(F5는 실제 읽기전용). **M8 착수 차단 불일치 없음.**

---

## 소스레벨 검토 반영 (2026-07-09)

> server-builder 소스 재대조(파일:라인). DV1~DV9 (a)재사용/(b)확장/(c)신규 확정 + 신규 발견 결함 + 잔여 판정.

### DV1~DV9 실재 재확정 (코드 대조 완료)
- **DV1 화이트리스트 = (c) 신규.** `/api/docs*` 라우트 부재(api/index.ts 전량 확인 — runs/agents/skills/overview/settings/ops만). 트리 프리미티브 `notSymlinkDir`(statestats.ts:11-13)·`listMd`(:14-21)만 재사용.
- **DV2 per-seg = (a) 있음.** `isSafeSegment`(paths.ts:18-21) + `segs.every(isSafeSegment)`(api/index.ts:71).
- **DV3 realpath 앵커 = (a) 있음.** api/index.ts:77-79(realRoot·realBase 선계산·`isWithinRoot`).
- **DV4 심링크 무조건거부+O_NOFOLLOW = (a) 있음, 패턴 재사용.** walk-lstat(80-85)·O_NOFOLLOW open(88)·fstat 정규(91-92)·realpath 재확인(95-96)·dev/ino(98-99). **base만 `join(projectRoot,"docs")`로 파라미터화**하면 동일 규율 획득 — 신규 방어 발명 아님.
- **DV5 denylist = (b) 확장.** `deniedPath`는 security.ts **90-94**(계획서 "90-93"은 라인 드리프트 — 정정). DENY(89)=dot-prefix+node_modules+.git. **신규 필요:** `*.key`·`*.pem`·`*.p12`·`*.pfx`·비-dot `id_rsa`(현 정규식 미커버).
- **DV6 = (a)다운로드 / (b)미리보기 확장.** 다운로드 413 스트림 前 fstat(api/index.ts:91-93·A98 손상방지 이미 충족). 미리보기 `VIEW_MAX` 절단은 신규(현 `MAX_DOC_BYTES`=262144는 내부 스캔용·statestats.ts:8).
- **DV7 바이너리거부 = (c) 신규.** `readCapped`(statestats.ts:23-36)는 `buf.toString("utf8")` 무조건 변환(:33) — 널바이트/비-UTF8 감지 없음.
- **DV8 XSS = (c) 신규(치명).** 렌더러·sanitizer 의존성 0(package.json)·CSP 부재(onSend security.ts:81-85 = nosniff+no-referrer만)·웹은 escaped `<pre>`만. → **오케스트레이터 승인 필수(선행 §DV8: 신규 dep 2종 + CSP 헤더 신설).**
- **DV9 fail-closed = (a) 원칙.** 400/404/409/413 반환 패턴 실재(api/index.ts:71,84,89,92,93,96,99).

### 신규 발견 결함 (계획서 미반영 — server-builder 전달)
- **[DV5 over-block 위험]** `deniedPath`(security.ts:92)는 `/registry/i` **부분일치**(anchor 없음). artifact엔 무해하나 **docs 뷰어 재사용 시 `docs/registry-*.md`류 정상 문서를 오거부**. `session\.key`도 산문 오탐 가능. → docs 라우트는 **별도 denylist**(경계 앵커·확장자 기반)로 분리하거나 `registry` 패턴을 세그먼트 앵커(`(^|\/)registry(\/|$)`)로 좁힐 것. **ACCEPT 케이스(오거부 금지): "registry"·"session"이 파일명에 포함된 정상 docs 문서.** 거부 스위트에 이 ACCEPT 케이스 추가.
- **[공용 함수 추출 회귀 안전망 확인]** A-1 리팩토링 회귀는 `test/m4api.test.ts`(실재 확인) artifact 스위트로 보증 — 계획서 명시대로 유효.

### 거부/ACCEPT 스위트 보강 (§위협 스위트 F5 negative — 개별 테스트)
- 기존 18케이스 표 유지. **추가 ACCEPT(오차단 금지):** (19) 파일명에 "registry"/"session" 포함 정상 docs → 200(위 over-block 결함 회귀). (20) 본문 마크다운 `---` 수평선·코드펜스 → 렌더 정상.
- 케이스 4(**in-root 심링크**)·5(중간 세그먼트 스왑 dev/ino)·13~17(XSS 5종)이 이 마일스톤 핵심 신규 리스크 — TDD Red 먼저.

### 잔여 판정 필요 (오케스트레이터/사용자)
1. **DV8 신규 의존성 2종 + CSP 헤더 승인** (선행 §DV8) — **미승인 시 렌더 경로 착수 금지.**
2. **서버 sanitize(후보 B) vs 클라 sanitize(후보 A) 택1** (§열린 질문 1).
3. **CSP 적용 지점** — 파일응답 엄격 CSP + SPA 렌더는 sanitizer 주방어 정리(§열린 질문 2)가 설계 의도와 정합인지 확인.
4. **docs 재귀 범위** — 전체 재귀 + denylist vs 서브트리 화이트리스트(`working_history`·`design` 등) (§열린 질문 3).

---

## 외부 리뷰 반영 (2026-07-09 — v0.6-todo-audit · codex+agy)

> 원장: `_workspace/reviews/v0.6-todo-audit_verdicts.json`. 전건 확인 판정(기각 0). 아래는 M8 해당 verdict 반영 결과.

| verdict | 등급 | 요지 | 반영 위치 | 잔여 |
|---------|------|------|-----------|------|
| V4 | HIGH | DV8 sanitizer/CSP를 **웹 렌더 착수 게이트 선행**으로 승격 — 후보A/B 결정·파일응답 CSP 범위·sanitizer URL scheme 테스트를 렌더 구현 前 필수 체크(게이트-1/2/3) | §선행 DV8 착수 게이트(게이트-1~3) | 후보 A/B 택1·CSP 범위 오케스트레이터 승인(잔여 §1~3) |
| V5 | MED | `deniedPath /registry/i` 부분일치(security.ts:92) 오거부를 DV5 **본 체크리스트**로 정정 — docs용 denylist 분리/세그먼트 앵커화 + ACCEPT(`registry-*.md` 통과) 테스트를 A55/A57 매핑에 | A-4 DV5 본작업 + A55 통과표 ACCEPT | — |
| V12 | LOW | `/events` 소비 shape 회귀(server `{items,...}` ↔ web `{events:[]}`·기존 버그)를 F5 RunDetail 변경 前 선행 버그픽스로 | §선행 `/events` 버그픽스 | 웹 소비 교정은 web-builder 파일권(`src/web/**`) |
| V16 | HIGH | Windows reparse(`isSymbolicLink()=false`)·O_NOFOLLOW 이식성 → realpath+isWithinRoot 최후방어 절대 유지·3-OS CI Windows junction/symlink 공격 픽스처 필수(skip 불가) | §선행 AS4(HIGH 격상) | — |
| V6 | MED | 뷰어 웹 파트 A83(패널 독립로딩·부분실패 격리)·A92(키보드·포커스·색비의존·WCAG AA) 회귀 부재 → 추가 | B-5 신규 + 통과표 A83/A92 | — |
