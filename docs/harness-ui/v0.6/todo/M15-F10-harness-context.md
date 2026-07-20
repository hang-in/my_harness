# M15 — F10 하네스 컨텍스트 관리 페이지 + 에이전트/스킬 빌더 작업계획서 (체크리스트)

> ✅ **완료(2026-07-10·마지막 마일스톤):** 서버(멀티런타임 읽기 HR1~HR7·독립 `deniedContextPath`·트리 walk pre/post TOCTOU·편집=Claude만 HR6·빌드 초안 HB1~HB8·신규생성)·웹(Context 11번째 화면·런타임 배지/필터·F7 편집 재사용·빌더 폼·미적용 초안 세션). 게이트 green(typecheck·build PASS·874 pass/1 skip). 외부감사 **codex+agy R1~R8 → R7·R8 2회 연속 HIGH 0**. 핵심 수정: 빌드 초안 exec 샌드박스 3중 강화(R1 no-tools→R2 HOME/XDG 격리→R5 denylist→**R6 실측 정정 `--tools ""`(deny-all)+`--disallowedTools "*"`+safe-mode**)·R3 walk 노드제외·R4 게이트순서(실패요청 쿨다운 미소비). **한계:** 빌드는 HOME 격리로 `ANTHROPIC_API_KEY` 인증 필요(OAuth/keychain 미접근·v0.6). servefile TOML 렌더는 additive 확장(F5 기본값 보존). 결과서 = `working_history/M15_F10-harness-context_20260710_170158.md`.
>
> 정본: `docs/harness-ui/v0.6/design/design-v0.6.md` §F10.1~F10.6 · HR1~HR7(읽기)·DW1~DW11(편집·F7 재사용)·HB1~HB8(빌드) · A121~A130 · UX A81/A85/A86/A92/A93·A107/A112 준용 · §위협 스위트 F10-컨텍스트/빌드 · §가정 AS-F10a/AS-F10b.
> 담당 분해: server-builder=`harness-ui/src/server/**` · web-builder=`harness-ui/src/web/**`. 검증: qa-verifier(A-번호 통과/거부) · security-auditor(F10 거부 스위트·쓰기스코프 경계·빌드 exec surface).
> 구현 금지 문서 — 이 파일은 계획(체크리스트)일 뿐. 커밋·코드 없음.

---

## 개요

- **마일스톤:** M15 = F10 하네스 컨텍스트 관리 + 에이전트/스킬 빌더. **실사용 피드백 후속 편입·마지막 마일스톤.** M14(F9) 후 착수.
- **기능:** Docs(산출물)와 별개로 **하네스를 구성하는 컨텍스트**를 관리하는 전용 페이지. 세 층 + **멀티런타임 읽기**:
  1. **읽기(뷰·멀티런타임):** Claude(`.claude/agents/**`·`.claude/skills/**`·CLAUDE.md) + **Codex**(`.codex/agents/**` TOML·`.agents/skills/**`) + **Antigravity(agy)**(`.agents/skills/**`·GEMINI.md) + **AGENTS.md=codex/agy 공유**(규칙/컨텍스트·둘 다 사용) 트리 + 뷰어. 런타임 배지·필터. **3 런타임 스킬=동일 SKILL.md 포맷**(단일 리더)·Codex 에이전트=TOML 텍스트 뷰. **컨텍스트 파일 라벨: CLAUDE.md=claude·GEMINI.md=agy·AGENTS.md=codex/agy 공유**.
  2. **편집(F7 재사용·Claude만):** `.claude/agents/*.md`·`.claude/skills/**/SKILL.md`(F7 GET/PUT/rollback·게이트 그대로). **Codex/agy 정의·GEMINI.md=읽기전용 뷰**(편집 시 `409 <runtime>-edit-v0.7`).
  3. **빌드(신규·Claude 스코프):** 도메인/역할 한 문장 폼 → AI 초안 생성 → diff 검토·사람 승인 → F7 안전 쓰기로 저장(자동 적용 금지·F8 Part B 준용).
- **사용자 확정 결정(재론 금지):** ① 빌드 = 폼 기반 AI 초안 → 사람 승인 → 저장(자동 적용 금지·초안 생성이 서버 exec/LLM 호출이면 신규 surface를 위협모델·게이트로 못박음). ② **읽기(뷰)=멀티런타임**: CLAUDE/AGENTS/GEMINI.md(projectRoot 직속)·`.claude/agents·skills`·`.codex/agents`·`.agents/skills`(각 정밀 서브루트만·전체 재귀 아님·`.claude`·`.codex`·`.agents` 3 dot-dir만 허용·`.env`/`.git`/`.ssh`/`.gemini` 거부·projectRoot 밖 원천 거부). **쓰기=`.claude/agents·skills`(F7 스코프)+신규 생성만·Claude만**·CLAUDE/AGENTS/GEMINI.md·Codex/agy **읽기전용**(포인터 등록=스니펫 복사 안내). **읽기 멀티런타임 확장이 쓰기 경계를 안 넓힘**(I8).
- **리스크 등급: 중대.** 근거: (a) **mutating**(신규 정의 생성 = F7보다 넓은 쓰기·기존 F7은 수정만) (b) **빌드 초안 생성 = 신규 exec/LLM 공격면**(server exec·프롬프트 주입·비용) (c) **읽기 화이트리스트가 `.claude/agents·skills` dot-prefix로 확장**(시크릿 인접·`.claude/` 전체 재귀 아님) (d) 계약 변경(신규 API). 설계서 리스크 등급표 정의 "경로탈출·XSS·mutating·crypto·계약변경" 중 다수 해당.
- **권장 게이트: 중대 강도.** 단계마다 게이트 + 승인 사다리·codex+agy 외부 리뷰·security-auditor(HR1~HR7·HB1~HB8·DW 재사용·쓰기스코프 경계 코드 대조)·qa-verifier F10 거부 스위트 전건.
- **DoD:** A121~A130 전건 + F10 위협 스위트(멀티런타임 읽기 탈출/dot-prefix 오허용·Codex/agy·GEMINI.md 편집 409·빌드 exec 주입/DoS·신규 생성 경로탈출·CLAUDE/AGENTS/GEMINI.md 쓰기 차단·no-auto-apply 전건 거부) + I8 경계 회귀(쓰기 `.claude/agents·skills` 밖 불가·docs/** write 불가·**멀티런타임 읽기 확장이 쓰기 스코프 안 넓힘**).

---

## 선행 / 선검증 (착수 전 게이트 — 미충족 시 착수 불가)

### P1. 선행 마일스톤 의존
- [x] **M12(F7 편집기 + DW1~DW11) 완료.** F10 편집층은 **F7 100% 재사용**(신규 방어층 0): `resolveEditableAgent/Skill`·`canonicalizeDefinition`·`safeDefPath`·`writeDefSafe`·`writeBackup`·`withDefLock`(defedit.ts)·GET/PUT/rollback 라우트(api/index.ts:113~205)·`definitionEditEnabled` 게이트. M12 미완이면 blocked.
- [x] **M8(F5 뷰어 + servefile) 완료.** 읽기층 서빙은 `openSafeFile`(servefile.ts·base 파라미터화)·`sendPreview`/`sendDownload`·DV8 CSP 재사용. 뷰어 컴포넌트(screens.tsx `DocPanel`/`DocTree`)도 재사용.
- [x] **M11(F3.7 config) 완료.** 빌드/편집 게이트는 `definitionEditEnabled`(config)에 의존.

### P2. 멀티런타임 읽기 화이트리스트 — 신규 정밀 규칙 (dot-prefix 함정)
- [x] **[최우선·신규] `.claude`·`.codex`·`.agents` 읽기는 F5 `deniedDocsPath` 그대로 쓸 수 없음.** `security.ts:89 DENY = /(^|\/)\.[^/]…/`는 **dot-prefix 세그먼트 전부 차단** → 셋 다 거부. → F10 읽기는 **이 3 dot-dir만 정밀 허용**하고 그 외 dot-prefix(`.env`·`.git`·`.ssh`·`.gemini`·각 dot-dir 직속 설정)는 계속 거부하는 **F10 전용 신규 화이트리스트 리더** 필요(HR1~HR2). **⚠ 기존 전역 `DENY`·`deniedDocsPath`를 수정하지 말 것(F5 뷰어 방어 훼손 금지·R1 agy MED) — 독립 `deniedContextPath` 신설(병렬 구조).** server-builder 착수 전 이 신규 denylist 변형 설계 확정.
- [x] **[멀티런타임·조사확정 2026-07-10] 3 런타임 파일 규약:** Claude=`.claude/agents/*.md`·`.claude/skills/**/SKILL.md`·CLAUDE.md / Codex=`.codex/agents/*.toml`·`.agents/skills/**/SKILL.md`·AGENTS.md / **agy=`.agents/skills/**/SKILL.md`(Codex와 공유·동일 SKILL.md 포맷)·GEMINI.md·AGENTS.md**. **컨텍스트 라벨: CLAUDE.md=claude·GEMINI.md=agy·AGENTS.md=codex/agy 공유.** 스킬은 세 런타임 **동일 SKILL.md 포맷**(단일 리더)·Codex 에이전트만 TOML. **agy 규칙=GEMINI.md/AGENTS.md(디렉토리 기반·frontmatter 없음)이며 이미 화이트리스트에 포함**(agy rules 별도 경로 아님·R5 agy 오인 정정).
- [x] **열람 루트 = 정밀 서브루트만**(각 dot-dir 전체 재귀 아님): `.claude/agents/**`·`.claude/skills/**`·`.codex/agents/**`·`.agents/skills/**` + CLAUDE/AGENTS/GEMINI.md(projectRoot 직속). `.claude/settings.json`·`.codex/config`·`.claude/tmp`·기타 내부 스크래치·**projectRoot 밖(`~/.gemini`·`~/.claude` 전역 설정)** 거부. 설계서 §F10.3 HR1과 정합.
- [x] **편집=Claude 스코프만(HR6):** 읽기는 멀티런타임이나 PUT/rollback·신규생성은 `.claude/agents·skills`만. Codex(`.codex`·`.agents/skills`)·agy·GEMINI.md 편집 요청 → `409 <runtime>-edit-v0.7`(읽기전용 뷰). **읽기 확장이 쓰기 경계 안 넓힘**(I8).

### P3. 빌드 초안 생성 surface — 메커니즘 선검증 (AS-F10a·가정 위에 쌓지 말 것)
- [x] **[최우선·열린 결정] 초안 생성 메커니즘 = 오케스트레이터 판정 필요.** 두 후보:
  - **(a) fire-and-observe run 제출:** 기존 `exec-run.ts`로 bounded run 제출 → `_workspace/runs`에 초안 artifact 산출 → 사용자 열람·승인. **I1(fire-and-observe)·I2(stdio 로그파일)·I3(execFile+argv·noFlag) 그대로 상속**(신규 실행계약 최소).
  - **(b) 직접 bounded CLI exec:** 동기 `claude -p "…"`(읽기전용 tools) 초안 반환. **신규 동기 exec 경로**(I2 stdio·I3 argv 재적용·타임아웃·출력 상한).
  - **어느 쪽이든 HB1~HB8 못박음.** 실 LLM/CLI 호출 진입점·비용·비동기성·타임아웃을 M15 착수 전 스모크 선검증. **미확인 상태 착수 금지**(가정 위 구현 금지).
- [x] **[AS-F10b·M12 AS6 연계] 초안 저장 시 differential 게이트 성격.** 초안도 F7 저장 경로 → M12에서 확정된 게이트(claude CLI 격리 파서 진입점 부재 시 "편집기 파서 라운드트립 idempotence"로 격하됨·residual risk 문서화)를 그대로 상속. 신규 게이트 발명 금지.

### P4. 신규 생성 경로 — F7은 "기존 수정만" (신규 구축 표기)
- [x] **[신규·오표기 주의] `safeDefPath`/`writeDefSafe`는 신규 생성 미지원.** `defedit.ts:127 safeDefPath`는 leaf가 **이미 정규파일이어야** 통과(`!l.isFile() return null`·:145)·`writeDefSafe`는 부모 dir 실재 요구(:207~208 lstat). → **신규 정의 생성(새 `.claude/agents/{name}.md`·새 `.claude/skills/{dir}/SKILL.md`)은 F7 재사용 아님·신규 구축**(부모/leaf 미존재 경로안전·skill dir mkdir 안전·이름 충돌 거부). 계획서·설계서에서 "재사용"으로 오표기 금지(F8 crypto 오표기 전례).

---

## 작업 체크리스트

> **범례:** [S]=server-builder / [W]=web-builder.

### A. 서버 — 멀티런타임 읽기 화이트리스트 (HR1~HR7 · A121·A122·A129·A130) — [S]

**A-1. 읽기 전용 화이트리스트 리더 (HR1~HR4·멀티런타임 · A121·A129)**
- [x] `GET /api/context/tree` — CLAUDE/AGENTS/GEMINI.md·`.claude/agents·skills`·`.codex/agents`·`.agents/skills` 트리(각 노드 **runtime 라벨** claude|codex|agy). **F10 전용 신규 화이트리스트 리더(전역 DENY·deniedDocsPath 미수정·독립 `deniedContextPath`):**
  - [x] HR1: 열람 가능 = CLAUDE.md·AGENTS.md·GEMINI.md(projectRoot 직속)·**`.claude/agents/**`·`.claude/skills/**`·`.codex/agents/**`·`.agents/skills/**`만**(각 dot-dir 전체 재귀 아님·정밀 서브루트). 그 외(`.git`·`.env`·`.ssh`·`.gemini`·`.claude/settings.json`·`.codex/config`·`.claude/tmp`·임의 dotdir·**projectRoot 밖 `~/.gemini` 등**) 거부.
  - [x] HR2: **`.claude`·`.codex`·`.agents` 3 dot-dir만 정밀 허용**(첫 세그먼트 정확 일치·+둘째 세그먼트 ∈{`.claude`:`agents`/`skills`, `.codex`:`agents`, `.agents`:`skills`})·그 외 dot-prefix 거부(`.env`/`.git`/`.ssh`/`.gemini` 유지). **F10 전용 신규 규칙 — 기존 전역 DENY 미수정(독립 `deniedContextPath`·R1 agy MED).**
  - [x] HR3: 위 서브루트 하위 per-세그먼트 검증·realpath 앵커·`isWithinRoot`·전 세그먼트 **심링크/reparse(Windows junction/mount) 거부**(외부·`~/.gemini` 리다이렉트 차단)·leaf O_NOFOLLOW·fstat 정규 → `openSafeFile`(servefile.ts) 재사용. **projectRoot 직속 3파일(CLAUDE/AGENTS/GEMINI.md)도 leaf lstat+O_NOFOLLOW+realpath containment 적용**(직속 파일 심링크→외부 차단·R5 codex LOW).
  - [x] HR4: 위 하위여도 secret denylist(`*.key`·`*.pem`·`id_rsa*`·토큰) 거부(deniedDocsPath 확장자 규칙만 참조·전역 함수 미변경)·화이트리스트 밖 dotfile 거부.
  - [x] **HR7 트리 바운드·대량 dir 차단(R7 agy HIGH):** 트리 열거 `MAX_CONTEXT_NODES` 상한(F4 `MAX_RUNS_SCAN`·F5 `MAX_DOCS`와 동등)·초과 시 `truncated:true`. `deniedContextPath`에 **`node_modules`·`venv`·`.venv`·`__pycache__`·`dist`** 포함 — 스킬 dir(`.claude/skills/{name}`·`.agents/skills/{name}`) 내 패키지/빌드 환경 무제한 순회 OOM/DoS 차단(F5 DV5 `node_modules` 규율 상속). 테스트: 스킬 dir에 `node_modules` 수만 파일 생성 시 트리 truncate·미순회.
- [x] **A129 멀티런타임 자동 수집·라벨:** 3 런타임 스킬=동일 SKILL.md 리더(F5/F7 재사용)·Codex 에이전트=TOML 텍스트 뷰(HR5 렌더 안전·실행 안 함)·트리 노드에 runtime 배지(`.agents/skills`=`codex/agy` 공유·AGENTS.md=codex/agy·GEMINI.md=agy·CLAUDE.md=claude)·런타임 필터. **⚠ `readAgents`/`readSkills`·`harnessInventory`(harness.ts)는 현재 `claude`/`codex` 인벤토리 전용(agy·GEMINI.md 분기 없음·R5 agy) → Codex/agy 트리·CLAUDE/AGENTS/GEMINI.md 트리는 HR1~HR7 전용 신규 리더가 소유**(구현 시 `harnessInventory`에 `agy:{entrypoint:GEMINI.md?…, skills:.agents/skills}` 분기 신설·재사용 과대표기 금지·R1 codex MED).

**A-2. 파일 열람 (HR5 · A122)**
- [x] `GET /api/context/file?path=` — 위 화이트리스트 하위 파일 열람. **HR5 = F5 DV8 렌더 안전 그대로**(sanitizer·CSP·scheme 화이트리스트·외부리소스 차단·크기상한·바이너리 거부) — `sendPreview`/`applyFileHeaders` 재사용.

### B. 서버 — 편집 (F7 재사용·Claude 스코프만·신규 계약 0 · A123·A130) — [S]

**B-1. 편집 = F7 GET/PUT/rollback 재사용 · Claude만 (DW1~DW11 · A123·HR6)**
- [x] `.claude/agents/*.md`·`.claude/skills/**/SKILL.md` 편집 = 기존 `/api/{agents,skills}/:name/definition` GET/PUT/rollback **그대로 재사용**(신규 방어층 0·DW1~DW11·`definitionEditEnabled` 게이트). F10 페이지는 F7 편집기를 배선만.
- [x] **A130 편집=Claude 스코프만(HR6):** Codex(`.codex/agents/*.toml`·`.agents/skills/**`)·agy·GEMINI.md는 **읽기전용 뷰**·PUT/rollback/신규생성 요청 → **`409 <runtime>-edit-v0.7`**(duo drift·TOML 정규화·런타임별 differential 게이트 미비). **읽기 멀티런타임 확장이 쓰기 스코프 안 넓힘**(I8 회귀 assert).
- [x] **[R5 agy MED·duo-drift] 같은 스킬명이 `.claude/skills`와 `.agents/skills` 양쪽 존재 시:** F7 편집은 `.claude/skills`만 대상(정상)이나 **`.agents/skills` 피어가 stale로 남음** → 조용히 진행 금지. **저장 시 A79 duo-drift 경고 노출**("Codex/agy 피어(`.agents/skills/{name}`)가 존재·이 편집은 Claude 정의만 갱신·Drift 발생 가능") + Drift 화면 유도. `resolveEditableSkill`은 `.claude` 우선 반환 유지하되 피어 존재를 응답에 표기.
- [x] **CLAUDE.md·AGENTS.md·GEMINI.md 쓰기 라우트 없음(읽기전용).** 신규 쓰기 엔드포인트 추가 금지. 포인터 등록은 스니펫 복사 안내(A123·web).

### C. 서버 — 빌드 초안 생성 + 신규 생성 (HB1~HB8 · A124·A125·A126) — [S]

**C-1. 초안 생성 신규 surface (HB1~HB4·HB7·HB8 · A124) — 설계 §F10.4 표와 번호 1:1**
- [x] `POST /api/context/build/draft` body `{kind:"agent"|"skill", domain:string, role:string}` → 초안(frontmatter+본문) 반환. **디스크 미기록**(HB4 no-auto-apply).
- [x] HB1 bounded: 폼 입력 길이·문자 상한·Zod·**초안=데이터(프롬프트 주입 방지)**.
- [x] HB2 exec 규율(I3): 초안 생성이 CLI/LLM 호출이면 `execFile`+argv·`noFlag`·문자열 보간 금지·stdio 로그파일 고정(I2·run 모델 시)·출력 상한·타임아웃.
- [x] HB3 읽기전용 입력만: 초안 생성 컨텍스트 = **읽기전용**(기존 인벤토리·정의 트리)만·프로젝트 파일 쓰기 0·임의 파일/시크릿 미주입.
- [x] HB4 no-auto-apply: 초안은 디스크 미기록·표시만·실행/파일쓰기 트리거 안 함(저장은 사람 승인 후 create 경로만).
- [x] HB7 게이트: 초안 생성 엔드포인트(mutating이면) `definitionEditEnabled` + Host/Origin/token(I5).
- [x] **HB8 동시성·rate-limit(R1 agy HIGH·비용폭주/DoS):** 초안=exec/LLM spawn → **in-flight 빌드 동시 1개 제한**(서버 뮤텍스·초과 429 `build-in-progress`) + 요청 쿨다운(rate-limit). 무한/버그 클라이언트의 반복 호출로 exec 무제한 spawn → 비용폭주·리소스 고갈 차단. `create`(저장)도 동일 백프레셔. 테스트: 동시 2요청 시 1개 429·쿨다운 내 반복 요청 거부.
- [x] **[열린 결정·P3]** 메커니즘 (a) run 제출 vs (b) 직접 exec — 오케스트레이터 판정 후 확정. 어느 쪽이든 HB1~HB8.

**C-2. 신규 정의 생성 (HB5·HB6 · A126) — 신규 구축**
- [x] `POST /api/context/build/create` — 신규 정의 생성(**F7은 기존 수정만이므로 신규 구축**):
  - [x] HB5 신규 생성 경로안전: 새 `.claude/agents/{name}.md`·새 `.claude/skills/{dir}/SKILL.md` = **아직 없는 leaf** → 부모 dir 심링크 거부·`.claude/skills/{dir}` mkdir 안전(심링크/escape 거부)·leaf 미존재 확인·이름 충돌(기존 정의 존재) 시 거부(409)·`safeDefPath`/`writeDefSafe`의 leaf-실재 요구를 우회하는 신규 경로안전 헬퍼.
  - [x] HB6 저장=F7 전건 통과: 승인 초안은 `canonicalizeDefinition`(strict YAML·완전 스키마·name 불변)+무결성+원자쓰기(`writeAtomic`)+낙관적 동시성 전건 통과 후에만 기록(F7 DW4/DW5/DW6 재사용)·초안 무결성 위반 400.
  - [x] 스코프 불변(I8·A127): 신규 생성도 `.claude/agents·skills` 스코프 밖 불가·CLAUDE.md/AGENTS.md/GEMINI.md 생성/덮어쓰기 불가·docs/** 쓰기 불가.
  - [x] create(저장)도 HB8 백프레셔 적용(in-flight 1개·429).
- [x] 기존 수정 저장 = F7 PUT 그대로(신규 생성만 create 경로).

**C-3. I8 경계 회귀 (A127·DoD) — [S]**
- [x] mutating 쓰기가 `.claude/agents·skills` **밖으로 새지 않음** assert·CLAUDE.md/AGENTS.md write 차단·docs/** write 차단·빌드 exec가 프로젝트 파일 안 씀(초안 artifact/state만).

### D. 웹 — 컨텍스트 페이지 + 빌더 (11번째 화면·A128) — [W]

**D-1. 읽기·편집·빌드 UI (F10.6 · A128)**
- [x] 11번째 화면 "Context"(또는 기존 화면 확장) `App.tsx` nav 편입(RF5 "정의" 그룹 준용).
- [x] 읽기(멀티런타임): CLAUDE/AGENTS/GEMINI.md·`.claude/agents·skills`·`.codex/agents`·`.agents/skills` 트리 + 뷰어(F5 `DocPanel`/`DocTree` 재사용)·**런타임 배지(claude/codex/agy)·런타임 필터**·신뢰라벨(A129).
- [x] 편집: F7 편집기 진입 = **Claude 정의만**(게이트 off → 비활성/이유 툴팁·A81). **Codex/agy 정의·GEMINI.md = 읽기전용 뷰 배지**(편집 버튼 비활성+"v0.7 예정" 툴팁·409 방어·A130).
- [x] 빌드: 폼(도메인·역할) → "초안 생성" → diff 뷰 → **"아직 적용되지 않음"·"미적용" 유지**(F8 A107/A112 준용·유실 방지) → 사람 승인 → F7 저장.
- [x] **[R1 agy MED] 초안 상태 책임 = 클라이언트.** 서버는 무상태(초안 디스크 미기록·HB4 no-auto-apply) → "미적용 초안" 유실 방지는 **클라이언트 세션(sessionStorage/상태관리)** 이 전적으로 소유. 서버 저장 없음과 UX 유지 요구가 충돌 안 함을 명시(빌드 in-flight 429 시 재시도 안내).
- [x] CLAUDE.md 포인터: "스니펫 복사" 버튼(클립보드·자동 쓰기 없음).
- [x] 빈/로딩/에러 3-state(A82~A84)·no-auto-apply UX·미저장 이탈 경고(A86)·접근성(A92).

---

## 수용기준 → 테스트 매핑

| A# | 통과(positive) | 거부(negative) — F10 스위트 |
|----|----------------|-------------------------------|
| A121 | CLAUDE.md·AGENTS.md·GEMINI.md·`.claude/agents/x.md`·`.claude/skills/y/SKILL.md`·`.codex/agents/z.toml`·`.agents/skills/w/SKILL.md` 트리·열람 200(HR1~HR4) | `.git/config`·`.env`·`~/.ssh/id_rsa`·**`.codex/config`·`.codex` 직속/비허용 서브루트**·`.gemini`·화이트리스트 밖 dotfile·projectRoot 밖(`~/.gemini`)·`../` 탈출·심링크→외부 → 400 *(`.codex/agents`·`.agents/skills`는 허용 — A129와 정합·`.codex/**` 전체 거부 아님)* |
| A122 | 위 화이트리스트 파일 md·**TOML**(`.codex/agents/*.toml`) 텍스트 렌더 200(DV8 sanitize·CSP·크기상한·실행 안 함) | 바이너리·초과크기·XSS(`<script>`·`javascript:`·원격 img)·화이트리스트 하위 `*.key`/토큰·`.claude/` 직속(settings.json)·`.claude/tmp`·`.codex/config` → 400/413/attachment |
| A123 | `.claude/agents·skills` 편집=F7 GET/PUT/rollback 정상(게이트 on) | **CLAUDE.md/AGENTS.md/GEMINI.md PUT 라우트 없음(쓰기 차단)**·게이트 off → 403·F7 DW 거부 스위트 그대로 |
| A124 | 폼(도메인·역할) → 초안 반환(디스크 미기록·bounded·HB1~HB4·HB7) | 초안 생성 입력 주입(shell 메타·과대 입력)·초안이 파일쓰기/실행 트리거 → 차단·게이트 off → 403·**동시 2요청 시 1개 429(HB8)·쿨다운 내 반복 거부·create도 동일** |
| A125 | 초안 → diff → 사람 승인 → F7 저장(canonicalize+무결성+원자+동시성 통과) | **자동 적용 0**(승인 없이 저장 0)·초안 무결성 위반(폴리글롯/필수누락) → 400·no-auto-apply |
| A126 | 신규 `.claude/agents/{name}.md`·`.claude/skills/{dir}/SKILL.md` 생성(경로안전·mkdir 안전) | 이름 충돌(기존 존재)→409·`.claude` 밖 생성·심링크 부모·docs/** 생성 → 400 |
| A127 | (DoD) 쓰기 스코프 = `.claude/agents·skills`+신규 생성만 | **CLAUDE.md/AGENTS.md/GEMINI.md write·docs/** write·`.claude` 밖 write → 차단**·빌드 exec 프로젝트 파일 쓰기 0 |
| A128 | (UI) Context 페이지 읽기 트리(런타임 배지·필터)·F7 편집(Claude)·빌더 폼·diff 승인·스니펫 복사·3-state | 초안 승인 전 "미적용" 유지(유실 방지·A107)·CLAUDE.md 자동 쓰기 버튼 없음·빈 비활성 금지(A81)·Codex/agy=읽기전용 배지 |
| A129 | 멀티런타임 수집·뷰: `.claude/agents·skills`(claude)·`.codex/agents`(codex·TOML 뷰)·`.agents/skills`(codex/agy·SKILL.md)·CLAUDE/AGENTS/GEMINI.md 트리 200·runtime 라벨 | `~/.gemini`·`~/.claude`(홈 전역)·`.gemini`·`.codex/config`·화이트리스트 밖 dot → 400·심링크→홈 거부 |
| A130 | 편집=Claude만(`.claude/agents·skills`+신규생성) | **Codex(`.codex`·`.agents/skills`)·agy·GEMINI.md PUT/rollback/create → `409 <runtime>-edit-v0.7`**·읽기 확장이 쓰기 스코프 안 넓힘(I8 assert) |
| (DoD) | — | **I8 경계 회귀**: 쓰기 `.claude/agents·skills`+신규 밖 0·CLAUDE.md/AGENTS.md read-only·빌드 exec 격리 |

> **ACCEPT(오차단 금지·멀티런타임):** `.claude/agents/**`·`.claude/skills/**` md·**`.codex/agents/**` TOML·`.agents/skills/**` md**(정밀 서브루트만·각 dot-dir 직속·`.claude/tmp`·`.codex/config` 등은 거부)·**CLAUDE.md(claude)·GEMINI.md(agy)·AGENTS.md(codex/agy 공유)** 열람·본문 `---`(F7 ACCEPT 상속)·옵션/미지 frontmatter 필드(passthrough). *(R5 codex — Codex/agy positive 경로도 오차단 금지 회귀 대상.)*

---

## 정합성 / 열린 질문

1. **[최우선·빌드 exec 메커니즘]** 초안 생성 = (a) fire-and-observe run vs (b) 직접 bounded exec — 오케스트레이터 판정. 실 LLM/CLI 진입점·비용·비동기성 선검증(P3). 어느 쪽이든 HB1~HB8·읽기전용 컨텍스트만 입력.
2. **[재사용 vs 신규 정확 구분]** 편집=F7 100% 재사용(신규 0)·읽기 화이트리스트=신규 정밀 규칙(`.claude` dot-prefix 정밀 허용)·신규 정의 생성=신규 구축(F7 safeDefPath/writeDefSafe는 leaf 실재 요구·생성 미지원)·빌드 exec=신규 surface. **"재사용" 표기는 실코드만**(F8 crypto 오표기 전례).
3. **[no-auto-apply 패턴 = F8 Part B 준용]** M13 F8은 축소안으로 crypto envelope/nonce를 v0.7 이월(항상 사람 승인 backstop). F10 빌드 승인도 **동일 축소 패턴**(HMAC crypto 불요·사람 승인 + diff + F7 저장으로 충분·자동 적용 경로 0). crypto 강제는 v0.7 검토.
4. **[differential 게이트 상속]** 신규/편집 저장 모두 M12 확정 게이트 상속(claude 격리 파서 부재 시 idempotence 격하·residual risk). 신규 게이트 발명 금지.
5. **[문구 stale]** PRD/page-requirements 헤더 A-번호 갱신(A47~A130)·F10 화면(11번째) 편입·§정합성 점검(spec-planner 메모)에서 목록화.

---

## 완료 시 산출물 — working_history 작업결과서 (하네스 작업규칙·의무)

> 하네스 문서 체계(myharness SKILL 5-1·orchestrator SKILL §커밋 순서): 영속 산출물(결과서)은 **`docs/`(커밋 원장)**에 남긴다. `_workspace/`(휘발)에 방치하면 cleanup/재실행 시 소멸 → 감사 이력 0. **프롬프트로 못 막으므로 게이트로 강제**.

- [x] **결과서 기록(의무·중대 마일스톤 최소 T1 1장):** M15 게이트 PASS 직후 `docs/harness-ui/v0.6/working_history/M15_F10-harness-context_{YYYYMMDD_HHMMSS}.md` 작성(**덮어쓰기 금지**·기존 M7~M14 결과서와 동일 관례). 골격 = `skills/myharness/references/templates/working-history-skeleton.md`.
  - [x] 필수 내용: ①작업 요약(F10 멀티런타임 읽기·편집·빌드 완료 항목) ②변경 파일(경로+사유) ③검증 결과(테스트 통과/전체·회귀·RED→GREEN·**A121~A130 통과 현황**·게이트 수치) ④미해결/후속(예: Codex/agy 편집·plugins/hooks=v0.7) ⑤**외부 리뷰 반영**(codex+agy 판정 digest·확인/부분/이월/기각+근거·raw는 `_workspace/reviews/` 링크·본문 복붙 금지) ⑥**보안 스위트 결과**(경로탈출·dot-prefix·빌드 exec 주입/DoS·쓰기 경계 전건 거부) ⑦**`## 다음 단계 참조`**(미해결·핵심 결정과 이유·다음 단계=v0.6 완료 or v0.7 후속).
  - [x] ⚠ **`## 다음 단계 참조` heading 문자열 유지**(RAG 연속성 진입점·`check-artifacts.sh` 매칭 대상). `_workspace` 소실돼도 이 결과서만으로 판정·근거·다음 단계 자기완결.
- [x] **게이트(커밋 순서):** 단계마다 리뷰→판정→수정→PASS + 승인 사다리(중대) → `bash .claude/skills/harness-ui-dev/scripts/check-artifacts.sh docs/harness-ui/v0.6 t1`(끝줄 `ARTIFACTS: ok`·missing이면 커밋 차단) → 승인 관문 → 단일 커밋. **pre-commit hook**(리터럴 baked PROJECT=`harness-ui/v0.6`·TIER=`t1`)이 스테이징된 신규 결과서를 물리 검증.

## 발신 대상 (계획서 확정 후)

- **server-builder:** A(읽기 화이트리스트 HR)·B(F7 재사용 편집)·C(빌드 exec HB·신규 생성). 선검증 P2(dot-prefix 정밀 규칙)·P3(exec 메커니즘)·P4(신규 생성 경로안전) 확인 후 착수.
- **web-builder:** D(Context 페이지·빌더 UI·diff 승인·스니펫 복사). 서버 계약 확정 후 배선.
- **qa-verifier:** F10 거부 스위트 전건 + A121~A130 통과/거부 + I8 경계 회귀 + no-auto-apply 회귀.
- **security-auditor:** HR1~HR7(읽기 화이트리스트 dot-prefix 함정)·HB1~HB8(빌드 exec surface·프롬프트 주입·bounded)·쓰기스코프 경계(`.claude/agents·skills`+신규만·CLAUDE.md/AGENTS.md read-only)·신규 생성 경로탈출 코드 대조.
