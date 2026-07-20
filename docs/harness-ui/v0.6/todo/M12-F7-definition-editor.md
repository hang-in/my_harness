# M12 — F7 정의 편집기 작업계획서 (체크리스트)

> ✅ **완료(2026-07-10).** 구현·게이트·QA·보안감사·외부감사 전부 통과. 전 체크박스 완료.
> - **게이트:** typecheck PASS · `npm run test` **567 pass / 1 skip** · build PASS · `test:def-differential` 15/15 · v0.5 회귀 0.
> - **첫 mutating·최대 공격면(DW1~DW11):** 스코프 게이트 definitionEditEnabled(기본 off·fail-closed)·이름→정규 sourcePath 서버 재조회(409 ambiguous·codex-only)·pathId 바인딩·`writeDefSafe` hardened(TOCTOU 부모 체인 pre/post 재검증·`.claude` 밖 write 물리 차단)·strict YAML(yaml@2.7.1·앵커/멀티도큐/중복키/`!!tag` 거부)·완전 스키마 passthrough·name 불변·canonical 재직렬화(LF·NFC 정규화·**write≤read cap 불변식**→은폐 차단)·낙관적 동시성(baseHash 409·정의별 뮤텍스)·opaque 백업·rollback 계약·편집≠실행·evalProposal fail-closed(crypto=M13).
> - **AS6 정직 격하:** claude CLI frontmatter 격리 파서 진입점 부재(2.1.205) 확인 → A75를 "편집기 idempotence + 앱 리더(harness.ts) 파싱 등가"로 격하(외부 CLI 등가 주장 없음·residual risk 문서화).
> - **QA·보안감사·외부감사(codex+agy) R1~R3 → 최종 HIGH 0(양 엔진):** TOCTOU write·scan-cap·CRLF·크기상한 은폐·temp 누수 순차 해소. 원장: `_workspace/reviews/m12-code-r*`.


> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F7.1~F7.8 · DW1~DW11 · A72~A80 · UX A81/A85/A86/A93 · §위협 스위트 F7-편집 · §가정 AS6/AS7.
> 담당 분리: server-builder=`harness-ui/src/server/**` · web-builder=`harness-ui/src/web/**`. 구현·커밋은 각 builder 몫. 본 문서는 기획·분해·정합성 점검만.

---

## 개요

- **마일스톤:** M12 = F7 에이전트/스킬 정의 편집기. 설계서 §마일스톤 고정 순서상 **F8(M13) 직전 마지막 방어집약 마일스톤**.
- **리스크 등급: 중대.** 근거: **v0.5/v0.6 읽기전용 불변식 I8을 깨는 첫 mutating(파일 쓰기) 기능** = 로컬 dev-tool **최대 공격면**. `.claude` 정의 파일은 "파일이 곧 실행 정의"라 손상/폴리글롯 정의가 실행 오염으로 직결.
- **I8 유일 예외 경계:** F7(`.claude` 정의 편집)만 예외. `docs/**`·임의 시스템 파일·F4/F5/F6는 **여전히 읽기전용**. 편집 대상 = `.claude/agents/*.md` + `.claude/skills/**/SKILL.md` **만**(넘지 않음). Codex 듀얼(`.codex/*.toml`·`.agents/skills`)·신규 생성·삭제·리네임 = **v0.7 비목표**(F7.7). `mutationEnabled:false`는 불변.
- **권장 게이트: 중대 강도.** codex+agy 외부 리뷰 + 보안 감사(security-auditor DW1~DW11 코드 대조) + qa-verifier F7-편집 거부 스위트 전건 실행. **[V8·MED] differential 게이트 CI(`npm run test:def-differential`) 3-OS 매트릭스의 *성격*은 AS6 선검증 결과에 따라 확정된다** — CLI 리더 진입점 실재 시엔 "실 런타임 리더 등가" full 게이트, **부재(스모크 실패) 시엔 "편집기 파서 라운드트립 idempotence 게이트"로 격하**(§A-10·§선검증 #1). 즉 이 스텝은 무조건 "중대 full CLI 등가"가 아니라 **AS6 결과로 강도가 정해지는 조건부 게이트**. 나머지 방어층(경로탈출·심링크write·strict YAML·게이트 off·백업 무결성)은 AS6와 무관하게 중대 강도 유지.
- **DoD(설계서 §마일스톤 M12):** A72~A80 전건 + F7-편집 스위트(쓰기 경로탈출/심링크write/무결성/stale-write/게이트off 전건 거부) + **I8 예외 경계 회귀**(F4~F6 여전히 읽기전용 assert).

---

## 선행/선검증 (착수 전 반드시 — 가정 위에 구현 금지)

- [x] **[최우선·AS6] differential 게이트 리더 진입점 스모크.** claude CLI가 "에이전트/스킬 frontmatter를 격리 파싱해 그 결과를 관측 가능한 형태(JSON/구조화 출력)로 방출"하는 **실제 진입점이 존재하는지** 스모크로 확인. 확인 방법: `claude --help`/서브커맨드 조사, frontmatter만 파싱해 stdout으로 내보내는 명령 존재 여부, `--version` 핀 고정 가능 여부.
  - **존재 시:** A75 F7.8 게이트를 설계대로 유지(편집기 재직렬화본 → 실 런타임 리더 파싱 → 정규화 JSON zero-divergence 비교).
  - **부재 시(예상 위험):** A75를 **"우리 파서 라운드트립 안정성 게이트"로 정직히 격하** — 편집기 파서(추출→strict YAML→Zod→canonical 재직렬화) 자체의 idempotent 라운드트립(재직렬화본을 다시 파싱해도 동일 정규화 JSON)만 증명. **오케스트레이터에 명시 보고**(tautological 위험 — A≡B가 "같은 파서를 두 번 돌린 것"이면 게이트가 아무것도 증명 못 함). → 아래 §정합성/열린 질문 #1.
- [x] **[M11 의존] F3.7 공유 config 인프라 실재 확인.** 현재 코드에 `loadConfig`·`<state_home>/config.json`·`projectsHome`·`definitionEditEnabled`·per-leaf passthrough 원자 RMW가 **전무**(Grep 확인됨 — 브랜치 `feat/harness-ui-v0.5`). M12 DW1/DW8(게이트 노브)은 F3.7 config 위에 얹음.
  - M11(F3) 선완료로 `loadConfig`(버전드 봉투·필드별 독립 복구·root passthrough)·원자 RMW·뮤텍스가 존재해야 함. **부재 시 M12 착수 전 오케스트레이터에 순서 확인** — M11 미완이면 config 인프라를 M12에서 공동 구축해야 하며 공수·리스크 증가.
  - `definitionEditEnabled`는 M12가 config 스키마에 **additive**로 추가(F3.7 공유 필드). projectRoot/projectsHome/evals **clobber 금지**.
- [x] **[신규 의존] strict YAML 라이브러리 부재 확인됨.** `harness-ui/package.json`에 `yaml`/`js-yaml` 없음. 현행 `harness.ts:parseFrontmatter`(30~47행)는 **정규식 기반 간이 파서** — 앵커/alias·멀티도큐·중복키·`!!tag`를 **거부하지 못함**. DW5 strict YAML은 **신규 의존 추가** 필요(예: `yaml` uniqueKeys/strict). server-builder 착수 전 의존 추가 승인 확인.
- [x] **[AS7] 위협모델 전제 확인.** F7은 로컬 단일사용자·편집자=실행자 전제(권한 상향은 명시적 2단계). 다중 사용자 시나리오는 v0.6 비대상 — 계획에 재검토 트리거만 명시.
- [x] **[DW11/M13 결속] evalProposal 필드는 이번엔 설계·스키마만.** F8 crypto(nonce 상태머신·envelope HMAC·config-hash·A106 재평가)는 M13 의존. M12에서는 PUT body에 `evalProposal?` 필드를 **파싱만** 하고, **존재 시 fail-closed 거부**(일반 편집으로 무음 통과 금지 — 아래 작업 참조). → §정합성/열린 질문 #2.

---

## 작업 체크리스트

### A. 서버 — definition GET/PUT/rollback (server-builder · `src/server/**`)

**A-1. 이름→정규경로 서버 재조회 + 정체성 바인딩 (DW2 · A72)**
- [x] `GET /api/agents/:name/definition` · `GET /api/skills/:name/definition` 추가.
- [x] **에이전트 = (b) `readAgents` 재사용** — `readAgents`는 `sourcePath` 필드 반환(harness.ts:59)이므로 `:name`(논리 frontmatter name)으로 돌려 **디스크에서 정규 sourcePath 재조회**. 클라이언트 경로/파일명 페이로드 **금지**.
- [x] **⚠️ [V7·MED] 스킬 = (c) dedupe 전 원본 스캔 신규 구현(순수 재사용 아님).** `readSkills`(harness.ts:72-97)는 **`sourcePath` 필드가 없고(`runtimePaths: string[]`만 노출) + canonical name 기준으로 `.claude`/`.agents` 교차 dedupe(82~89행)** → 그대로 재사용하면 (1) 정규경로를 못 얻고 (2) dedupe가 모호성을 은폐한다. **∴ 편집 대상 해소는 `readSkills`가 아니라 `.claude/skills/*/SKILL.md`를 dedupe 없이 원본 스캔하는 전용 조회를 신규 구현** — frontmatter name → 매칭된 `.claude/skills/{dir}/SKILL.md` 목록을 그대로(병합 없이) 수집해 정규경로·매칭 수를 산출.
- [x] **중복 name → `409 ambiguous-definition`(비결정 해소 금지·필수 테스트):** 동일 frontmatter name을 가진 `.claude` SKILL.md가 **2개 이상**(예 서로 다른 두 `.claude/skills/{dir}/SKILL.md`)이면 dedupe 전 원본 매칭 수 ≥ 2로 판정해 **409**. **`readSkills` dedupe 리스트로 판정 시 이 두 개가 하나로 병합돼 모호성을 놓치므로 금지.** → 거부 스위트에 "동일 name 2개 SKILL.md → 409 ambiguous" 케이스 필수(TDD Red).
- [x] 스킬 정규 sourcePath = **`.claude/skills/{dir}/SKILL.md`** 고정. `.agents` 전용 스킬(=`.claude`에 없음) → **`409 codex-only-v0.7`**.
- [x] 미존재 → `404`.
- [x] 응답: `{ name, sourcePath, pathId(=sha256(정규 sourcePath)), content, baseHash(=sha256 내용), mtimeMs, editable }`. `editable`은 `definitionEditEnabled` 판독값 반영.

**A-2. 쓰기 경로탈출 방어 (DW3 · A73)**
- [x] 해소된 sourcePath를 **projectRoot realpath 앵커(선계산)** 기준 검증. `runs.ts:safeRunDir`(14~29행) 패턴을 **앵커 파라미터화**해 재사용(하드코딩 앵커 금지 — harness-ui-impl §공용 경화 리더).
- [x] **projectRoot 하위 상대 세그먼트(`.claude/…`)만** lstat 심링크/reparse 무조건 거부(I6 통일 — 절대 상위부는 containment, 정상환경 오거부 없음). `paths.ts:isSafeSegment`(18)·`isWithinRoot`(24) 재사용.
- [x] 부모 디렉토리 realpath 확인 + leaf 위치·확장자 화이트리스트(agents=`.claude/agents/*.md`·skills=`.claude/skills/*/SKILL.md`) + `.claude` 밖 거부.
- [x] `MAX_DEF_BYTES`(예 256KB) 크기상한 초과 거부. 모든 실패 fail-closed **400**.

**A-3. 원자 쓰기 (DW4 · A74)**
- [x] `atomic.ts:writeAtomic`(7행) **재사용**(temp `wx`=O_EXCL·0600→fsync→rename→dir fsync). 신규 쓰기 루틴 발명 금지.
- [x] rename이 목적지 심링크를 따라가지 않고 엔트리 교체(write-through-symlink 불가)임을 회귀로 확인. 부모 dir 스왑은 DW3 realpath 앵커로 방어.

**A-4. 무결성 + 정규화 (DW5 · A75)**
- [x] **고정 추출:** frontmatter = 첫 `---`~다음 `---` 쌍(런타임 동일). 현행 `harness.ts` 정규식(32행 `/^---\r?\n([\s\S]*?)\r?\n---/`)이 이미 non-greedy 첫-쌍 추출 — 편집기도 **동일 고정 추출** 사용(differential 등가 전제). **본문(닫는 `---` 이후) `---`는 무해** — blanket 거부 철회(R4-#2).
- [x] **strict YAML 파싱**(신규 의존): 앵커/alias·멀티도큐먼트·중복 키·`!!tag` **거부**. 현행 간이 파서는 이 방어 없음 → 신규.
- [x] **완전 frontmatter Zod 스키마**(설계 F7.4 코드블록): `name`(min1 max120)·`description`(min1 max2000) 필수 strict + role/tools/skills/model(agent)·triggers/references(skill) 옵션 + **`.passthrough()` 미지필드 보존**. name 불변(`===` 요청 `:name`, 리네임 금지).
- [x] 통과분을 **canonical normalized YAML로 재직렬화**(passthrough 필드 포함·유실 0). 본문 비어있지 않음 확인.
- [x] 실패(필수 누락/YAML 위반/name 변경) → **400**. 거부는 필수 누락·폴리글롯·리네임뿐(옵션필드·본문`---`·passthrough는 ACCEPT).

**A-5. 낙관적 동시성 (DW6 · A76)**
- [x] PUT은 `{ content, baseHash, pathId, evalProposal? }` 수신(Zod). 서버가 **현재 디스크 내용 해시 재계산** → `baseHash` 불일치 시 **`409 stale-write`**.
- [x] `pathId` 재해소: name 재조회한 sourcePath의 pathId와 불일치 → **`409`**(GET↔PUT 다른 정의 타격 차단). mtime은 보조.

**A-6. 되돌리기·백업 (DW7/DW7b · A77)**
- [x] 백업 파일명 = **opaque `sha256(정규 sourcePath)` hex**(논리 name 보간 **절대 금지** — traversal 차단). 위치 `<state_home>/edit-backups/{hash}.bak`(직전 1개). `paths.ts:stateHome`(5) 재사용.
- [x] 백업 dir per-세그먼트 심링크/reparse 거부·기존 `.bak` 심링크면 거부·`O_EXCL` temp→`writeAtomic` 원자 교체(백업 심링크 write-through 불가).
- [x] `POST …/rollback` body `{ expectedCurrentHash, backupHash }`: 현재 디스크 해시==expectedCurrentHash(불일치 `409 stale-rollback`) + 백업 해시==backupHash(손상/변조 백업 거부) + 복원 대상 경로 **DW3 재실행** + 백업 내용 **DW5 무결성 재검증**(손상본 복원 차단) → 통과 시 `writeAtomic` 원자 복원.
- [x] 저장 응답에 `prevHash` 반환.

**A-7. 게이트 노브 + 매 요청 판독 (DW1/DW8 · A78)**
- [x] `definitionEditEnabled`(기본 off·fail-closed) = F3.7 공유 config 필드(**신규 config 필드 — F3.7 공유**). PUT/rollback 진입 시 config에서 **strict boolean 자체 판독** — 부재/손상(JSON파싱실패)/비-boolean/판독불가 → **false(fail-closed)** → **`403 edit-disabled`**.
- [x] `POST /api/settings/definition-edit` body `{ enabled: boolean }`(Zod `z.boolean()` strict, 그 외 400): **F3.7 원자 RMW**(뮤텍스·`projectRoot`·`projectsHome`·`evals` 등 타 필드 보존 — clobber 금지).
- [x] **필드 독립:** projectRoot 손상/부팅검증 실패가 `definitionEditEnabled`를 초기화하지 않음. 재시작 지속(명시 저장된 true만). `mutationEnabled` 전면 API는 불변 비활성.
- [x] PUT/rollback(mutating)은 `security.ts` onRequest 게이트 자동 적용(Host allowlist 73행·**Origin 검증** 75행·session-token 77행). 쿼리토큰 금지(I5). **신규 라우트가 `/api/` 프리픽스 하위임을 확인**(게이트 통과 조건).

**A-8. 편집/실행 분리 (DW9 · A79)**
- [x] 저장은 정의 파일 기록만 — 실행 트리거 **안 함**(F2/New Run 경유). 저장 응답에 Codex 피어 drift 경고 플래그 포함.

**A-9. evalProposal 필드 (DW11 · 이번엔 설계·스키마·fail-closed만 · M13 의존)**
- [x] PUT body Zod에 `evalProposal?: { nonce: string, envelope: ... }` 필드 **정의만**. **부재 = 일반 편집**(DW1~DW7 경로, M12에서 완전 동작).
- [x] **존재 = F8 제안 적용 경로** → M12에서는 crypto 미구현이므로 **fail-closed 거부**(예 `409 proposal-not-available` / `501` 유형). **일반 편집으로 무음 통과 절대 금지**(통합-2 F8→F7 crypto 우회 갭 차단 — envelope 없는/미검증 제안 적용 불가). 실집행(nonce 소비·envelope HMAC·config-hash·A106 재평가·payload 일치)은 **M13 F8 결속**. → §열린 질문 #2.

**A-10. 정의 파서 게이트 CI (F7.8 · A75 · [V8·MED] AS6 결과로 성격 확정)**
- [x] `test/fixtures/definitions/` 코퍼스: (i) 정상(옵션필드 다수·본문 `---`·유니코드) (ii) 폴리글롯/멀티도큐/앵커/중복키(reject 기대) (iii) 경계(본문 `---`·코드펜스·CRLF). 각 케이스 accept/reject 라벨.
- [x] `npm run test:def-differential` 스크립트(package.json에 신규 — 현재 없음) + 3-OS 매트릭스. **리더 부재 CI는 skip 아닌 fail**(게이트 자체는 필수).
- [x] **[V8] 게이트 성격은 AS6 선검증(§선검증 #1)이 확정 — 두 분기:**
  - [x] **(분기 A) CLI 리더 진입점 실재 시:** 리더 버전 핀(`--version` 기록) + 비교 (A) 편집기 파서 vs (B) 실 런타임 리더 파싱 결과를 정규화 JSON(키 정렬·스칼라 타입 고정·frontmatter 필드만)으로 직렬화 → accept 코퍼스 전건 A≡B·reject 코퍼스는 편집기 400. 1건 divergence면 게이트 fail. **이 분기에서만 "런타임 리더 등가" 성격.**
  - [x] **(분기 B·예상 위험) CLI 리더 진입점 부재 시:** A75/DoD/게이트 명칭을 **"편집기 파서 라운드트립 idempotence 게이트"로 정직 격하** — 재직렬화본을 다시 파싱해도 동일 canonical JSON임만 증명(accept 코퍼스 idempotent·reject 코퍼스 400). **"CLI reader equivalence"·"UI≡CLI 등가" 표현 제거**(A≡B가 같은 파서 2회 실행이면 tautological — 아무것도 증명 못 함). 이 격하는 **residual risk로 명시**(편집기≠런타임 리더 divergence 가능성은 미해소 잔여 위험으로 문서화·오케스트레이터 보고) 후 진행. **권장 게이트를 무조건 "중대 full CLI 등가"로 표기하지 않는다.**

**A-11. fail-closed 총괄 (DW10) + I8 경계 회귀**
- [x] DW1~DW9 중 하나라도 실패 = 400/403/409, **디스크 무변경(현재본 유지)** 회귀 테스트.
- [x] **I8 예외 경계 회귀:** F4/F5/F6 엔드포인트가 **여전히 읽기전용**(쓰기 경로 없음) assert. 편집 대상이 `.claude/agents/*.md`·`.claude/skills/**/SKILL.md` 밖으로 새지 않음 assert(docs/** write 불가).

### B. 웹 — Agents/Skills 편집기 (web-builder · `src/web/**`)

**B-1. 편집기 진입 (A80 · A81)**
- [x] `screens.tsx` Agents(103행)·Skills(128행) 상세 Card에 **"정의 편집" 버튼** 추가(기존 `split`/`Card` 패턴 따르기·외과적 변경).
- [x] `definitionEditEnabled` off → 버튼 `disabled` + **툴팁 "정의 편집 비활성 — Settings에서 켜기"** + Settings 딥링크(A81 — 빈 비활성 금지). codex-only 스킬도 disabled+이유 툴팁.

**B-2. 조회→편집→diff→검증→저장 (A80 · A86)**
- [x] 클릭 → `GET …/definition` → textarea(원문·`MAX_DEF_BYTES`) 또는 구조 폼.
- [x] 저장 전 **diff 미리보기**(로드본↔편집본). "저장" → `PUT`(content·baseHash·pathId).
- [x] **위험작업 확인 다이얼로그**(A85 — 비가역 파일 변경 명시) → 성공 토스트·`prevHash`·**"실행하려면 New Run/Ask Agent로"**(편집≠실행)·Codex drift 경고. "되돌리기" = `POST …/rollback`.
- [x] **미저장 변경 이탈 경고**(navigate-away guard · A86).

**B-3. 오류 인라인 + 409 편집분 보존 (A80 · A93 · A86)**
- [x] `400`(무결성)·`403`(비활성) 인라인 표시.
- [x] **`409 stale-write` → 자동 재로드 금지**(A93·UX-R1-#1): 사용자 편집 textarea **보존**한 채 "디스크가 변경됨" 배너 + (a) 디스크본↔편집본 **병합 뷰**(최소 나란히 비교) or (b) 편집분 로컬 백업/클립보드 복사 후 수동 병합. **"덮어쓰기 전 편집분 보존" 보장**(데이터 유실 방지).

**B-4. 공통 UI 회귀 (A83·A92 — [V6·MED])**
- [x] **A83 패널별 독립 로딩·부분실패 격리:** 편집기의 정의 로드·diff 미리보기·저장 결과·rollback이 각각 독립 로딩/에러로 처리되고, 한 영역(예 diff 렌더 실패) 실패가 편집 textarea·저장 동선을 무너뜨리지 않는다.
- [x] **A92 접근성(WCAG AA):** 편집 진입 버튼·textarea·diff 뷰·확인 다이얼로그·409 병합 뷰·인라인 에러가 **키보드 조작 가능**·포커스 링 가시·다이얼로그 포커스 트랩·ESC·색 대비 AA·에러/비활성/drift 상태를 **색상 단독 의존 없이** 텍스트 병기. 비활성 버튼 이유 툴팁은 스크린리더 접근 가능(A81 연계).

---

## 수용기준 → 테스트 매핑

| A# | 통과(positive) | 거부(negative) — F7-편집 스위트 |
|----|----------------|-------------------------------|
| A72 | 정상 name → 원문+baseHash+pathId(sha256)+mtime+sourcePath 반환·이름→정규경로 서버 재조회 | 중복 name→**409 ambiguous**·`.agents`전용 스킬→**409 codex-only-v0.7**·미존재→**404** |
| A73 | `.claude/agents/*.md`·`.claude/skills/*/SKILL.md` 정상 경로 write 통과 | `.claude` 밖·`../` 경로탈출·심링크 대상 write·화이트리스트 밖 확장자/위치·`MAX_DEF_BYTES` 초과 → **400** |
| A74 | writeAtomic 원자 교체(부분쓰기/손상 0) | rename write-through-symlink 불가(목적지 심링크 미추종) |
| A75 | 옵션필드(role/tools/skills/triggers/references)·본문 `---`(수평선/코드펜스)·미지필드(passthrough) 보존·CRLF·유니코드 **ACCEPT** | 필수(name/description) 누락·YAML 파싱실패·name 리네임·폴리글롯/멀티도큐/앵커/중복키/`!!tag` → **400**·**직렬화본 리더 divergence → 게이트 fail**(선검증 #1 결과 반영) |
| A76 | 정상 baseHash+pathId 일치 시 저장 성공 | stale baseHash → **409 stale-write**·pathId 재해소 불일치 → **409** |
| A77 | 정상 rollback(expectedCurrentHash·backupHash 일치) 원자 복원 | 백업 traversal(논리name 보간)·백업 심링크·stale 롤백→**409 stale-rollback**·손상/변조 백업(backupHash 불일치·DW5 재검증 실패) 거부 |
| A78 | 게이트 on + Host/Origin/token 정상 시 PUT/rollback 허용·재시작 지속 | 게이트 off PUT/rollback → **403 edit-disabled**·손상/비-boolean/판독불가 config→false→**403**·Origin 위조→**403**·config 필드 clobber 방지(RMW) |
| A79 | 저장이 정의 파일만 기록·drift 경고 노출 | 저장이 실행 트리거하지 않음(side-effect run 0) |
| A80 | 조회→편집→diff→검증→저장·rollback UI 동작·성공 토스트 | 400/409/403 인라인 표시·게이트 off 시 편집 비활성(뷰어만) |
| A81 | (UX) 비활성 컨트롤 이유 툴팁+Settings 딥링크 | 빈 비활성(이유 없는 disabled) 금지 |
| A85 | (UX) F7 저장 확인 다이얼로그(비가역 명시)→성공 토스트 | — |
| A86/A93 | (UX) diff 미리보기·이탈 경고·**409 시 편집분 보존 병합 뷰** | 409 자동 재로드(편집분 유실) 금지 |
| A83 | **[V6] 편집기 패널별 독립 로딩·부분실패 격리(로드/diff/저장/rollback)** | 한 패널 실패가 편집 textarea·저장 동선 붕괴 금지 |
| A92 | **[V6] 키보드 조작·포커스 트랩·ESC·색비의존·WCAG AA(진입/textarea/diff/다이얼로그/409 병합)** | 색상 단독 상태표시·키보드 미접근 금지 |
| (통합-2) | evalProposal 부재 = 일반 편집 정상 동작 | **envelope 없는/미검증 제안 적용 불가**(M12: evalProposal 존재 시 fail-closed 거부·무음 일반편집 통과 금지) |
| (DoD) | — | **I8 경계 회귀**: F4~F6 여전히 읽기전용 assert·docs/** write 불가 |

> **ACCEPT(오차단 금지) 명시:** 본문 `---`(수평선·코드펜스) · 옵션필드(role/tools/skills/triggers/references) · 미지필드(passthrough 보존) · `/var`·`/tmp` 등 절대 상위 심링크 통과하는 정상 projectRoot 하위 경로. 이들을 거부하면 회귀.

---

## 정합성 / 열린 질문

1. **[최우선·AS6 tautological 위험] differential 게이트 리더 진입점 실재 여부.** 설계 F7.8은 "claude CLI 정의 로드 경로를 핀 고정 버전으로 실행"을 전제하나, **claude CLI가 frontmatter를 격리 파싱해 결과를 관측 가능한 형태로 방출하는 진입점이 실제로 있는지 미확인**. 없으면 (A)편집기 파서와 (B)"리더"가 결국 같은 코드가 되어 **A≡B가 자명 성립 → 게이트가 아무것도 증명 못 함(tautological)**. 선검증 스모크 필수. 부재 시 A75를 "편집기 파서 라운드트립 idempotence 게이트"로 **정직 격하**하고 UI≡CLI 등가 주장은 철회(오케스트레이터 판정 요청). — 설계서 정본과 어긋나는 게 아니라 정본의 미검증 전제를 선검증하는 것.

2. **[DW11 · M13 F8 결속 순서]** M12는 F7 PUT `evalProposal` 필드를 **설계·스키마·fail-closed 거부**까지만 구현(crypto 미구현). 실집행(durable nonce 상태머신·envelope HMAC·evals-config 해시·A106 rollup 재평가·payload 일치)은 **M13 F8에 전적으로 의존**. 따라서 M12 완료 시점에 "제안 적용" 경로는 **동작하지 않고 거부만** 함. 이 상태가 통합-2(F8→F7 우회) 갭을 닫는지 = **envelope 없이는 제안 적용 불가**를 M12가 보장(부재=일반편집, 존재=거부)하면 충족. M13에서 evalProposal 경로를 활성화할 때 이 fail-closed 지점을 실집행으로 교체하는 것이 순서. → 오케스트레이터가 M13 계획 시 이 결속 확인.

3. **[M11 config 인프라 의존]** `loadConfig`·`config.json`·`projectsHome`·`definitionEditEnabled`·per-leaf passthrough 원자 RMW가 **현 코드에 전무**(브랜치 `feat/harness-ui-v0.5`). M12 DW1/DW8은 F3.7(M11) 산출 위에 얹음. **M11 선완료 확인 필수** — 미완이면 M12에서 공동 구축(공수·리스크 증가). `definitionEditEnabled`는 config 스키마 additive 추가(projectRoot/projectsHome/evals clobber 금지).

4. **[신규 의존]** strict YAML 라이브러리 부재(`package.json` 확인). 현행 `harness.ts:parseFrontmatter`(간이 정규식)는 폴리글롯 거부 불가 → DW5는 신규 의존(`yaml` 등 strict/uniqueKeys) 추가 필요. server-builder 착수 전 승인.

5. **[dedupe ↔ ambiguous 상호작용]** `harness.ts:readSkills`(84~88행)가 name 기준으로 `.claude`/`.agents` 교차 dedupe하여 **모호성을 감출 수 있음**. A72 "중복 name→409 ambiguous"는 dedupe **전** 원본 매칭 수로 판정해야 정확(dedupe된 리스트로 판정하면 실제 `.claude` 내 동일 name 2개를 놓칠 위험). server-builder에 명시 전달.

6. **[문구 stale — 착수 무영향]** 설계서 도입부/PRD/page-requirements의 "A47-A71" 헤더 및 "읽기전용" 문구가 F7 쓰기를 반영 못 한 stale 존재(milestone-spec 스킬 §정합성 점검 기지). 정본 본문(§F7·A72~A80)은 정합 — 핵심 계약(I8 F7 예외·게이트 기본 off·`.claude` 화이트리스트) 이상 없음. 착수엔 무영향, 문구 갱신만 오케스트레이터에 정정 제안.

---

## 발신 대상 (계획서 확정 후)

- **server-builder:** A(서버) 전 항목 — DW1~DW11 방어층·GET/PUT/rollback·differential 게이트 CI. 선검증 #1(AS6)·#3(M11 config)·#4(YAML 의존) 결과 확인 후 착수.
- **web-builder:** B(웹) 전 항목 — Agents/Skills 편집기·diff·409 편집분 보존(A93). 서버 계약(응답 필드·에러코드) 확정 후 배선.
- **qa-verifier:** F7-편집 거부 스위트 전건 + A72~A80 통과/거부 매핑 + I8 경계 회귀 + ACCEPT 오차단 없음.
- **security-auditor:** DW1~DW11 코드 대조(fail-closed 확인)·백업 opaque 파일명·경로탈출·심링크 write·게이트 off 403·통합-2 우회 차단(evalProposal fail-closed).

---

## 소스레벨 검토 반영 (2026-07-09)

> server-builder 소스 재대조(파일:라인). DW1~DW11 (a)/(b)/(c) 확정 + 신규 발견 결함(readSkills sourcePath 부재) + AS6·DW11 판정 격상.

### DW1~DW11 실재 재확정 (코드 대조)
- **DW1/DW8 게이트 노브 = (c) 신규.** `definitionEditEnabled` = `grep = 0 매치` → M11 config 위 additive. **M11 미완이면 M12 착수 blocked**(공동구축 시 공수·리스크 증가). `security.ts` onRequest 게이트(Host 73·Origin mutating 75·session-token 77)는 `/api/` 프리픽스 라우트에 **자동 적용** = (a) 재사용(신규 배선 불요·라우트가 `/api/` 하위임만 확인).
- **DW2 이름→정규경로 = (b) 확장(주의).** `readAgents`는 `sourcePath` 필드 반환(harness.ts:59) = 재사용 가능. **그러나 `readSkills`는 `sourcePath` 필드 없음** — `SkillInfo`(harness.ts:50)는 `runtimePaths: string[]`만 노출. → 스킬 편집대상 정규경로는 **runtimePaths에서 `.claude/skills/{dir}` 필터 후 `/SKILL.md` 재구성**해야 함(순수 재사용 아님·신규 파생 로직). **아래 신규 결함 참조.**
- **DW3 쓰기 경로탈출 = (b) 확장.** `runs.ts:safeRunDir` 패턴 앵커 파라미터화 재사용 + `isSafeSegment`(paths.ts:18)·`isWithinRoot`(paths.ts:24). `.claude` 하위 세그먼트만 심링크/reparse 거부.
- **DW4 원자 쓰기 = (a) 재사용.** `writeAtomic`(atomic.ts:7·temp `wx`=O_EXCL·0600→fsync→rename→dir fsync). rename write-through-symlink 불가 회귀 필요.
- **DW5 무결성/정규화 = (c) 신규(부분).** 고정 추출 정규식(harness.ts:32 `/^---\r?\n([\s\S]*?)\r?\n---/`)은 non-greedy 첫-쌍 = 재사용. **strict YAML 파싱은 신규 의존** — `harness.ts:parseFrontmatter`(30-47)는 정규식 간이파서로 앵커/alias·멀티도큐·중복키·`!!tag` **거부 불가**. `grep yaml|js-yaml package.json = 0` → strict YAML 라이브러리 신규 추가(승인 필요).
- **DW6 낙관적 동시성 = (c) 신규.** baseHash/pathId 재계산·409 stale-write 로직 부재.
- **DW7 백업/롤백 = (c) 신규.** `edit-backups` 부재. `stateHome`(paths.ts:5)·`writeAtomic` 재사용하되 opaque `sha256(sourcePath)` 파일명·백업 심링크 거부는 신규.
- **DW9 편집/실행 분리 = (a) 원칙.** 저장이 run 트리거 안 함.
- **DW10 fail-closed·DW11 evalProposal = (c) 신규.** DW11 crypto 실집행은 **M13 의존**(아래 판정 격상).

### 신규 발견 결함 (계획서 미반영 — server-builder 전달)
- **[DW2 readSkills sourcePath 부재]** 계획서 A-1은 "readAgents/readSkills 재사용으로 정규 sourcePath 재조회"라 적었으나 **`readSkills`(harness.ts:72-97)는 sourcePath를 반환하지 않음**(`runtimePaths: string[]`만). 편집 대상 해소는 `runtimePaths`에서 `.claude/skills/{dir}` 항을 골라 `/SKILL.md` 재구성 = **신규 파생 로직**. 순수 (a) 재사용 아님으로 공수 반영.
- **[DW2 dedupe가 ambiguous 은폐]** `readSkills` dedupe(harness.ts:82 `canonical = fm.name ?? dir` → 84-89 `seen.has`)는 **동일 name 두 dir을 하나로 병합** → A72 "중복 name → 409 ambiguous" 판정을 **dedupe 前 원본 매칭 수**로 해야 정확(dedupe 리스트로 판정 시 `.claude` 내 동일 name 2개를 놓침). server-builder는 `readSkills` 재사용이 아니라 **원본 매칭 카운트 전용 조회**를 별도 구현.

### AS6 differential 게이트 — 최우선 선검증 + 정직 격하 (판정 격상)
- **[착수 前 최우선]** claude CLI가 frontmatter를 **격리 파싱해 관측 가능한 구조화 출력(JSON)으로 방출하는 진입점**이 실재하는지 스모크 선검증. `--help`·서브커맨드·`--version` 핀 조사.
  - **부재(예상 위험) 시:** A75 F7.8을 **"편집기 파서 라운드트립 idempotence 게이트"로 정직 격하** — 재직렬화본을 다시 파싱해도 동일 canonical JSON임만 증명. **UI≡CLI 등가 주장 철회**(A≡B가 같은 파서 2회면 tautological·아무것도 증명 못 함). 오케스트레이터에 명시 보고.
  - **`test:def-differential` = package.json 신규 스크립트**(현 scripts = dev/build/typecheck/test만·확인). 리더 부재 CI는 skip 아닌 fail이되, 게이트 정의는 선검증 결과로 확정.

### DW11 evalProposal — M12 스코프 확정 (판정 격상)
- M12는 **PUT body `evalProposal?` 필드 파싱 + 존재 시 fail-closed 거부**(`409 proposal-not-available`류)까지만. **crypto 실집행(nonce 소비·envelope HMAC·evals-config 해시·A106 재평가·payload 일치) = M13 전적 의존.** **부재=일반편집(DW1~DW7 완전동작)·존재=거부**로 통합-2(F8→F7 우회) 갭 차단. **무음 일반편집 통과 절대 금지.**

### 거부/ACCEPT 스위트 보강 (F7-편집 23건 지향)
- 기존 A72~A80 negative 매핑 유지. **추가 명시:** (신규-1) 동일 name 두 `.claude` dir → **409 ambiguous**(dedupe 은폐 회귀·위 결함). (신규-2) evalProposal 존재 PUT(crypto 미구현) → **fail-closed 거부**(무음 일반편집 금지). **ACCEPT(오차단 금지):** 본문 `---`(수평선·코드펜스)·옵션필드(role/tools/skills/triggers/references)·미지필드(passthrough 보존)·CRLF·유니코드.

### 잔여 판정 필요 (오케스트레이터/사용자)
1. **AS6 리더 진입점 스모크 결과** → A75 게이트 정의 확정(분기 A 실 CLI 등가 vs 분기 B 편집기 idempotence·후자는 residual risk 명시).
2. **strict YAML 라이브러리 신규 의존 승인**(DW5).
3. **M11 config 인프라 선완료 확인** — 미완이면 M12 착수 순서·공수 재조정.
4. **DW11 M13 결속 순서** — M13에서 fail-closed 지점을 실집행으로 교체하는 순서 확인.

---

## 외부 리뷰 반영 (2026-07-09 — v0.6-todo-audit · codex+agy)

> 원장: `_workspace/reviews/v0.6-todo-audit_verdicts.json`. 전건 확인 판정(기각 0). 아래는 M12 해당 verdict 반영 결과.

| verdict | 등급 | 요지 | 반영 위치 | 잔여 |
|---------|------|------|-----------|------|
| V7 | MED | A-1 상단을 **"스킬은 dedupe 전 원본 스캔 신규 구현"으로 정정**(readSkills는 `sourcePath` 없음·`runtimePaths`만·dedupe가 모호성 은폐·harness.ts:72) + 동일 name 2개 SKILL.md → 409 ambiguous 테스트 필수 | A-1 (에이전트=재사용·스킬=신규 분리) | — |
| V8 | MED | AS6 스모크 실패 시 A75 명칭/DoD를 "편집기 라운드트립 idempotence"로 격하·**"CLI reader equivalence" 표현 제거**·residual risk 명시. 권장 게이트가 무조건 "중대 full"로 보이지 않게 | 개요(조건부 게이트) · A-10 분기 A/B | AS6 스모크 결과(잔여 §1) |
| V6 | MED | 편집기 웹 파트 A83(패널 독립로딩·부분실패 격리)·A92(키보드·포커스·색비의존·WCAG AA) 회귀 부재 → 추가 | B-4 신규 + 매핑표 A83/A92 | — |
