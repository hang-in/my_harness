# Harness UI v0.6 — 페이지별 기능요구사항 & 역할 경계 명세 (관측 심화 재편)

> 목적: **11개 페이지**(v0.5 8화면 + Docs 뷰어 + **F8 Eval** = as-built 10 → **F10 Context** 추가 11)의 **역할 경계**를 못박아 "어디서 실행하고 어디서 관찰하나"의 혼란을 제거한다. (F9는 신규 페이지 0 — Docs·Settings 확장.)
> 재편(확정): v0.6 = **관측·통제 패널 심화**. **대화형 채팅(구 F1) 폐기 → v0.7 이월**(설계서 §F1-폐기결정). 대화는 터미널이 우월. Web은 **CLI가 못 하는 교차-run 관측**(Runs 조회/필터/검색·문서/artifact 뷰어·관측성 계층 B)에 집중.
> 근거: `../design/design-v0.6.md`(A47-A130·UI 배선 F4.5/F5.4/F6.5/F2.4/F3.6/F7.5/F8/F9.5/F10.6), 정본 `../../v0.5/design/design-v0.5-final.md`(8화면 IA·A1-A46), 코드 `harness-ui/src/web/screens.tsx`(as-built 10화면 — Docs·Eval 포함).

## 0. 핵심 멘탈모델 (한 문장)
> **Build·Agents = "새 run 시작"(문맥 0에서 실행 제출, 최초 1회). 나머지 7개 페이지는 실행하지 않는다(조회·관찰·평가·설정). 대화형 후속은 없다 — 이어서 대화하려면 터미널을 쓴다.**

실행 진입점은 **2군데뿐**(Build·Agents)이고 둘 다 **fire-and-observe 배치 제출**이다. 관찰·검색·열람·통계·설정은 전부 읽기(F3만 config 쓰기).

## 1. 실행 2경로 — 누가/언제/어디서/무엇을 (혼란 제거의 핵심)
| 진입점(명칭 제안) | 페이지 | 언제 쓰나 | 입력 | 결과 | 대화형? |
|------|--------|-----------|------|------|---------|
| **New Run**(현 "Build") | Build | 새 작업을 **문맥 0**에서 처음 시작 | RunRequest 폼(runtime·mode·domain·perm·dry-run) | 새 run 생성 → **Runs 딥링크** | ❌ 배치 1회 제출 |
| **Ask Agent**(F2) | Agents | **특정 에이전트 1명**에게 위임 | 정의(role·skills)에서 프리필된 RunRequest(편집가능) | 새 run 생성(`manifest.agent` 기록) → **Runs 딥링크** | ❌ 배치 1회 제출 |

**경계 못박기:**
- Build·Agents 모두 **대화형이 아니다.** 한 번 제출 = 한 run(fire-and-observe, 정본 §3). "한 마디 더"·"이어서" = **터미널(Claude Code/Codex)에서.** Web에 후속 채팅 입력창 **없음**(구 F1 폐기).
- 2경로 **모두 결과는 Runs에 착지**한다 → "실행은 Build/Agents에서 시작, 관찰·검색·이력은 Runs·Overview"만 기억하면 된다.
- **구 F1(Runs follow-up 입력창)은 존재하지 않는다.** Runs는 순수 관찰·조회·뷰어.
- **정의 편집(F7)은 실행이 아니다.** Agents/Skills에서 정의 파일(`.claude`)을 고칠 수 있으나, 저장 = 파일 기록일 뿐 실행 트리거 안 함. 고친 에이전트를 돌리려면 다시 **Ask Agent/New Run**(편집·실행·관찰 3분리).

---

## 2. 페이지별 명세 (11화면 · v0.5 8 + Docs 뷰어 + F8 Eval = as-built 10 → F10 Context 11)

### 2.1 Overview — **관측성 계층 B 홈 + 문서 뷰어 진입(F6·F5)**
- **목적:** 하네스 **한눈 현황판**(계층 A) + **효과성 집계**(계층 B) + 결과서 열람 진입.
- **v0.5 기능:** 런타임(A2)·인벤토리 count(A3)·구성 건강도(A35)·D4 규율(A36)·업데이트 상태(A37)·진화 이력(A38) = 계층 A(measured).
- **v0.6 추가:**
  - **효과성 집계 카드(F6·A60·A63):** run 성공/실패율·평균소요·재작업률·**"선택 window 내 관측 없음" 에이전트/스킬(+커버리지·기간·run 수 — "dead" 단정 금지·A90/UX-R2-#3)**·리뷰 수렴. 각 카드 measured/estimated 배지(A62). `design-observability.md §3.5`의 `/insights`를 Overview로 흡수(신규 페이지 0).
  - **결과서 열람 진입(F5·A59):** D4 규율/진화 이력 카드에서 `docs/*/working_history` 결과서 클릭 → **문서 뷰어**(Overview가 이미 그 경로를 스캔 — 자연스러운 진입).
- **하지 않는 것(경계):** 실행 안 함·편집 안 함(순수 조회). **추정을 정확값으로 표시 안 함**(estimated 배지 필수). 실시간 밀리초 텔레메트리 없음(계층 C 비목표).
- **관계:** 진입 랜딩. 고아/미사용 발견 → Agents·Skills 드릴다운.

### 2.2 Build → **명칭 제안: "New Run"**
- **목적:** **새 실행을 문맥 0에서 시작**하는 최초 제출 폼(dry-run 미리보기 or 실행).
- **v0.5 기능:** RunRequest 폼·미리보기(A9a·A9b·A42).
- **v0.6 변경:** 없음(기능 델타 없음). **UX 명확화만**: 제출 성공 시 생성 runId를 **Runs 딥링크 배너**로 안내. 폼 상단 헬퍼: "새 실행 시작 전용 · 이어서 대화는 터미널에서".
- **하지 않는 것(경계):** **대화형 아님.** stdin·후속입력·챗봇 없음. 에이전트 프리필 없음(그건 Agents).
- **관계:** 제출 → **Runs 딥링크**.

### 2.3 Agents — **1on1 프리필 New Run(F2)**
- **목적:** 에이전트 정의(role·skills) **조회** + **1on1 요청 시작(F2)** + **usage 관측(F6)**.
- **v0.5 기능:** 목록·상세(role·skills·sourcePath)·최근 실행상태 join(A3·A43).
- **v0.6 추가:**
  - **"이 에이전트에게 요청 (New Run)" 액션(A64·A67):** `GET /api/agents/:name/run-template`로 정의 프리필 → **편집가능 폼** → `POST /api/runs`(단일 경로 재사용). **allowedTools = 에이전트가 선언한 도구 체크박스로만**(자유입력 없음·U⊆D 구조 보장)·D 밖 요청은 400 반려·**조용한 드롭 없음**(A65·A100)·**제출 시점 정의 재조회·D 재도출(정의 삭제/변경 시 `409 agent-definition-changed`+새로고침·천장우회 차단·R4-#1)**.
  - **usage 섹션(F6·A63):** 이 에이전트의 토큰·호출·연결 스킬·선언≠관측 gap(measured/estimated 라벨).
  - **정의 편집(F7·A72-A80):** "정의 편집" 버튼 → `GET/PUT /api/agents/:name/definition`(원문 편집·`.claude/agents/*.md`만·무결성 검증·원자쓰기·낙관적 동시성·rollback). 스코프 게이트 `definitionEditEnabled` off면 **비활성(뷰어만)**.
- **하지 않는 것(경계):** **대화형 아님**(최초 1회 제출). **편집은 정의 파일(`.claude`)만·실행 아님**(저장≠실행 — 실행은 New Run/Ask Agent 경유·DW9). Codex 정의(`.codex/*.toml`) 편집 안 함(v0.7)·docs 편집 불가(F5 읽기전용)·신규 생성/삭제 안 함(v0.7).
- **관계:** "요청" 제출 → **Runs 딥링크**. usage 상세 → 참여 run 드릴다운. 편집 저장 시 Codex 피어 stale 경고 → Drift.

### 2.4 Skills — **usage 관측 추가(F6)**
- **목적:** 스킬 정의(description·트리거·references) **조회** + **usage 관측(F6)**.
- **v0.5 기능:** 목록·상세·트리거 발췌(A4·A43).
- **v0.6 추가:**
  - **usage 섹션(F6·A63):** 호출 횟수·점유 토큰(**estimated** — 토큰 경계 없음, A61)·**"선택 window 관측 없음"(커버리지 표기·"미사용" 단정 금지·A90)**·연결 에이전트.
  - **정의 편집(F7·A72-A80):** "정의 편집" 버튼 → `GET/PUT /api/skills/:name/definition`(`.claude/skills/**/SKILL.md`만·무결성 검증·원자쓰기·낙관적 동시성·rollback). `definitionEditEnabled` off면 **비활성(뷰어만)**.
- **하지 않는 것:** 실행 안 함. 스킬 직접 호출 진입점 아님. **편집은 SKILL.md만·실행 아님**(저장≠실행). references·`.agents/skills` 미편집(v0.7)·신규 생성/삭제 안 함(v0.7). **skill 토큰을 measured로 표시 금지**(estimated 배지).
- **관계:** 스킬↔에이전트 연결은 Agents 상세와 교차 참조. 편집 저장 시 Codex 피어 stale 경고 → Drift.

### 2.5 Runs — **이력 고급 조회·필터·검색 + artifact 뷰어(F4·F5)**
- **목적:** 실행 **관찰**(목록·상세·이벤트·agent status) + **교차-run 조회/필터/검색(F4)** + **artifact 열람(F5)**.
- **v0.5 기능:** 목록·상세·이벤트 polling·agent status·artifact 서빙·cancel(A5·A6·A18·A23·A27·A28).
- **v0.6 추가:**
  - **필터바·검색·정렬·페이지(F4·A47-A52):** state·runtime·mode·기간·에이전트 필터 + 텍스트 검색(리터럴·ReDoS 없음) + 정렬 + 페이지네이션. 서버가 **이름 열거→`fs.stat` 시간(birthtime/mtime) 정렬→상위 N 내용 바운드 read→전역 정렬**(runId 형식 무의존·결정적 최신·읽기전용). **conversationId 필터 없음**(F1 폐기로 필드 부재 — 감사 R1-#8).
  - **artifact 뷰어(F5·A59):** run 산출물(last-message·결과물) 열람(마크다운/코드/텍스트 렌더·다운로드). 경로탈출 방어(A54-A57).
- **하지 않는 것(경계):** **실행 시작 안 함**(그건 Build/Agents). **후속 대화 입력창 없음**(구 F1 폐기 — 이어서는 터미널). 파일 수정 안 함(순수 조회·I8).
- **관계:** Build·Agents **2경로 착지**. 대량 run은 필터/검색으로 좁힘. artifact·docs 열람은 공유 뷰어.

### 2.6 Drift
- **목적:** Claude↔Codex 런타임 정의 **불일치 탐지** + 동기화 **계획 미리보기(무변경)**.
- **v0.5 기능:** drift findings(A4·A4b)·sync-plan 미리보기(A29·A44).
- **v0.6 변경:** 없음.
- **하지 않는 것:** 파일 수정 안 함(계획만)·실행 안 함.

### 2.7 Ops
- **목적:** 런타임 **운영 상태**(설치·버전·헬스·인증·usage 가능여부) 조회.
- **v0.5 기능:** 런타임 상태 카드(A7·A8·A8b).
- **v0.6 변경:** 없음.
- **하지 않는 것:** 실행 안 함·`/usage`·`/status` 직접 실행 불가(사유+snapshot 경로만, A8).

### 2.8 Settings — **projectRoot 편집(F3)**
- **목적:** 서버 설정 **조회** + **projectRoot 편집(F3)**.
- **v0.5 기능:** projectRoot·mutationEnabled 조회 전용(A39).
- **v0.6 추가:** **projectRoot 편집 폼(A68-A71·A101):** 경로 입력 → 검증(정규화·realpath·**projectsHome 하위 세그먼트만 심링크/reparse 거부**(절대 상위는 containment·R2-#6)·시스템경로차단·**단일 projectsHome containment 경계**·마커=심층방어·TOCTOU) → **`dryRun` 프리뷰(디스크 미변경·검증+활성 run 경고)→확인(A99 취소/승인)→실제 쓰기**(취소 시 config 무변경·UX-R4-#2) → `<state_home>/config.json` 지속(필드 보존 RMW) → **재시작 후 반영**. **경계는 프로비저닝(설치/env)·편집 폼 확장 불가·미프로비저닝 시 편집 비활성**.
- **v0.6 추가(F7 연계):** **`definitionEditEnabled` 스코프 토글**(기본 off) — on 시 Agents/Skills 정의 편집 활성(F7·A78). 파일수정 전면 API(`mutationEnabled`)와 **별개 축**(F7만 여는 좁은 노브).
- **하지 않는 것(경계):** **즉시 적용 아님**(재시작 필요 — 라이브 재바인딩 v0.7 비목표). 파일수정 전면 API(mutationEnabled) 여전히 비활성. 임의 시스템 경로 지정 불가(D4·projectsHome containment 차단).
- **v0.6 추가(F9·A113-A119):** **Docs 소스 편집기** — 소스 다중 등록(라벨+경로·기본 `docs`)·추가/삭제/재정렬·`dryRun` 검증(존재·containment·denylist·DS6)·인라인 에러 + **`docsMenuEnabled` 토글**(off→Docs 메뉴 숨김/비활성). config additive(`docsSources`/`docsMenuEnabled`·per-leaf 복구·F3.7 RMW·프로젝트 파일 무변경).
- **관계:** 변경 후 재시작 → 전 페이지가 새 projectRoot 기준으로 재로드. Docs 소스 변경은 재시작 없이 반영(config 읽기전용 소비).

### 2.9 Eval — **평가 대시보드·자기개선 제안·지표관리(F8·9번째 화면·A102-A112)**
- **목적:** 하네스 self-eval(`loop_scorecard`)을 UI로 — (A) 평가 결과 확인 (B) 자기개선 제안 (C) 평가지표 관리.
- **v0.6 신규(3부):**
  - **Part A 결과 확인(GET 읽기전용·side-effect 0·A102-A104):** **전 `GET /api/evals*`는 상태변경 0**(ingest=서버 백그라운드 잡·자동·요청 무관·수동 재구축만 `POST /api/evals/rebuild`·통합감사 R3). **추세=신뢰 `<state_home>/evals-rollup`(체인 검증)에서만 소싱**(`_workspace/summary.jsonl`=표시 소스 아님·"미검증"). **ingest=서버 재도출-후-서명(판정 원장 `verdicts.json`서 집계 직접 재계산·`_workspace` precomputed 신뢰 안 함·자기일관 위조 aggregate 격리·R7)→이후 과거 scorecard 무결성=rollup digest(현재키 재검증 안 함→회전 무브릭·R5)**·`_workspace` 파일=표시용(digest 불일치=상세 "변조"·게이트 브릭 없음)·graceful(500 아님). **`alignment_score`="정합도(품질 아님)·자기채점=약증거→사람 승인 backstop"**·null=미측정(A103).
  - **Part B 자기개선 제안(제안+승인·A105-A108):** 악화 트리거→**근거 제안 카드(DV8 XSS 차단·provenance)**→**CTA "편집기에서 검토·저장"(승인=반영 아님·전환 前 "아직 적용되지 않음"·F7 저장 완료 전 "미적용" 유지→유실 방지·UX-R1-#3)**→**서명 envelope(config 결속·가변 rollup-head 미결속)+durable nonce가 F7 열기만→F7이 payload==승인·config 해시 일치+A106 현재 rollup 재평가·근거→diff→별도 저장(불일치 409 stale·대기 중 append돼도 게이트 만족 시 도달)**. **게이트=rollup 엔트리만(체인+head)·gate-time `_workspace` 재읽기 없음(변조 게이트 영향 0·R6)**·단계<3 비활성. **무결성 상태=영향+복구 명시(UX-R1-#2):** "상세 파일 불일치—추세·게이트는 검증 rollup 사용(안전)"·"rollup 훼손—제안 차단". *(state_home 조율 rollback=게임오버·out-of-scope.)*
  - **Part C 지표관리(mutating·A109-A111):** 채택 단계(**쓰기 1-3만·4 display-only 잠금·비활성 사유만 표시**)·per-metric·임계·정규화. 저장=F3.7 **per-leaf 독립 복구(형제 보존)+effective=max(값,floor)**·fail-closed. **UX(UX-R1-#4): 입력 옆 최소 30/10/3 상시 표시·floor 미만 저장 전 인라인 거부(silent clamp 금지)·old→new/effective diff·적용값 피드백**·**확인 대상=단계 3 전환 + 지표/정규화 변경(Stage 4는 확인 아니라 잠금)**.
- **하지 않는 것(경계·중요):** **자동 개선 아님 — 제안만**(자동 적용 절대 금지·**Stage 4 쓰기 없음·display-only**·사람 승인 F7 별도 저장·Goodhart 방지). **`alignment_score`를 품질/정밀도로 표시 안 함.** scorecard 텍스트를 **지시로 흡수 안 함**(데이터일 뿐). 생성물 품질평가(`artifact_benchmark`)는 **v0.7**(혼합 안 함). scorecard **생성** 안 함(스크립트 소관)·**GET은 side-effect 0**(ingest=서명 rollup append는 서버 백그라운드 잡·GET 부작용 아님·R3). **no-auto-apply 경계에 `tools`·`skills` 포함**(위험 tool 자동주입 차단).
- **관계:** 제안 승인 → **F7 편집기**(에이전트/스킬 반영). 지표관리 저장 → 공유 config(F3.7·Settings 토글과 동일 파일). 사이드바 **"점검" 그룹**(Overview·Drift·Ops·Eval·RF5).

### 2.10b Context — **하네스 컨텍스트 관리 + 에이전트/스킬 빌더(F10·11번째 화면·A121-A130)**
- **목적:** 하네스 구성 컨텍스트를 한 곳에서 — (**멀티런타임 읽기**) Claude(`.claude/agents·skills`·CLAUDE.md)+Codex(`.codex/agents` TOML·`.agents/skills`)+Antigravity/agy(`.agents/skills`·GEMINI.md)+**AGENTS.md(codex/agy 공유)** 트리·뷰어·런타임 배지(CLAUDE.md=claude·GEMINI.md=agy·AGENTS.md=codex/agy) / (편집·**Claude만**) 에이전트·스킬 정의 = F7 재사용·Codex/agy=읽기전용 뷰(409) / (빌드) 폼 AI 초안→승인→신규 생성. 산출물(Docs)과 분리 — **고정 기능·특정 프로젝트 즉시 사용**. **v0.6 범위=에이전트·스킬+CLAUDE/AGENTS/GEMINI.md만**(plugins·hooks·rules 서브디렉토리·`.claude-plugin`=v0.7 비목표).
- **읽기(A121·A122·A129·멀티런타임):** 멀티런타임 화이트리스트(HR1: CLAUDE/AGENTS/GEMINI.md·`.claude/agents·skills`·`.codex/agents`·`.agents/skills`)·**`.claude`·`.codex`·`.agents` 3 dot-dir만 정밀 허용**(HR2·`.env`/`.git`/`.ssh`/`.gemini`·홈 전역·`.codex/config` 거부)·전 세그먼트 심링크/reparse 거부(HR3)·secret denylist(HR4)·md/TOML 텍스트 렌더=F5 DV8(HR5)·**트리 `MAX_CONTEXT_NODES` 상한+`node_modules`/`venv`/`__pycache__`/`dist` 대량 dir 차단·초과 시 `truncated:true`(HR7·OOM 방어)**·런타임 배지.
- **편집(A123·A130·Claude만):** F7 GET/PUT/rollback 재사용(DW1~DW11·`definitionEditEnabled` 게이트)·`.claude/agents·skills`만. **CLAUDE/AGENTS/GEMINI.md·Codex(`.codex`·`.agents/skills`)·agy=읽기전용**(편집 → `409 <runtime>-edit-v0.7`)·하네스 포인터 등록은 **스니펫 복사 안내**.
- **빌드(A124~A126):** 폼(도메인·역할)→초안(디스크 미기록·bounded·**초안=데이터**·주입 방지·HB1~HB4)→diff→**사람 승인→F7 저장(canonicalize+무결성+원자+낙관 동시성·자동 적용 0)**→신규 생성(leaf 미존재·부모 심링크 거부·이름충돌 409·스코프 밖 400·**신규 구축**·HB5·HB6). **게이트 HB7(`definitionEditEnabled` off면 비활성)·HB8(초안·저장 in-flight 동시 1개·429·쿨다운·비용폭주/DoS 차단).** HB 번호는 설계 §F10.4 표 기준(HB1~HB8).
- **하지 않는 것(경계):** 풀 팩토리 오케스트레이션(팀 spawn·자동 다파일 생성)=v0.7·CLAUDE.md/AGENTS.md 자동 쓰기 0·초안 자동 적용 0·**빌드=실행 아님**(초안 생성이 파일쓰기/실행 트리거 안 함). **쓰기 스코프=`.claude/agents·skills`+신규 생성만(I8 경계)**.
- **UX:** "미적용 초안" 세션 유지(A107 준용·유실 방지)·빈/로딩/에러 3-state·접근성(A128). 사이드바 **"정의" 그룹**(Skills·Context·RF5 확장).

---

## 2.10 화면별 UX 상태 명세 (빈/로딩/에러/비활성/피드백 — design A81-A101·A112 배선)
> 모든 화면은 아래 4상태를 **방치 금지**로 정의한다(A46 3-state를 v0.6 신기능에 확장). 색만으로 상태 전달 금지·아이콘+텍스트(A92).

| 화면 | 빈 상태(A82) | 로딩(A83) | 에러/재인증(A84) | 비활성 안내(A81)·피드백(A85) |
|------|-------------|-----------|------------------|------------------------------|
| **전역(App shell)** | — | 초기 부트 스플래시 | **연결끊김 → 전역 재연결 상태머신 오버레이 `offline→health-up→auth-bootstrap→ready`**(토큰 재확립까지 유지·**401 감지 시 오버레이 해제→재인증**·"재연결 중" 영구갇힘 금지·A94) | **런타임(claude/codex) 미설치 배너 + 관련 실행 진입 비활성(A97)**·401→재로그인(A84) |
| Overview | 미프로비저닝→"projectsHome 설정 안내"·계층 B 데이터 0→"실행 이력 없음(New Run)" | 카드별 스켈레톤(카드 독립·한 카드 실패가 전체 안 깸) | 카드별 에러+재시도·401→재로그인 동선 | estimated/dead 배지(A90)·progressive disclosure(A91) |
| New Run(Build) | 폼 항상 표시(빈 아님) | 제출 중 버튼 로딩 | dry-run 실패 인라인·검증 에러 필드별 | **workspace-write 확인 다이얼로그→성공 토스트+Runs 배너**(A85·A87)·**런타임 미설치 시 제출 비활성+툴팁(Ops 링크·A97)** |
| Agents | 에이전트 0→"인벤토리 없음·하네스 확인" | 목록 스켈레톤 | 로드 에러+재시도 | **편집 비활성 시 "Settings에서 켜기" 툴팁(A81)**·요청 제출 확인+배너(A85·A87)·**도구=선언 체크박스만·D 밖 400·조용한 드롭 없음(A100)** |
| Skills | 스킬 0→"스킬 없음" | 목록 스켈레톤 | 로드 에러+재시도 | 편집 비활성 툴팁(A81)·estimated 배지(A90) |
| Runs | **run 0→"New Run으로 시작"(딥링크)**·**필터 0건→"조건 없음+필터 초기화"**·**절단→"최근 5000개 상한·더 오래된 이력 생략 + 기간 좁혀 재검색"**("이력 없음" 오해 금지·A95) | 목록 스켈레톤·상세 패널 독립 로드 | 이벤트 폴링 에러 격리·401 재인증·재시도 | 필터 칩·결과 카운트·정렬·URL 반영·절단 경고(A95)·**기간 프리셋(24h/7d/전체·"기록 시각(FS)" 단일 도메인)으로 오래된 이력 도달·경계 누락 0(A96·R3-#1)**·createdAt 상세 병기·artifact 뷰어(A89) |
| Drift | **drift 0→"불일치 없음(정상)"**(빈=성공 명시·에러 아님) | 스켈레톤 | 로드 에러+재시도 | sync-plan 무변경 배지 |
| Ops | 런타임 미설치→"claude/codex 미설치·설치 안내" | 카드 스켈레톤 | 헬스 조회 에러 격리 | usage 미지원 사유 툴팁(A81) |
| Settings | **projectsHome 미프로비저닝→정확한 프로비저닝 액션(명령·재시작·감지 경로 후보·A97)** | 저장 중 로딩 | 검증 에러 코드→한국어 인라인 | **`dryRun` 프리뷰→확인→쓰기(취소 시 config 무변경·A101)**·projectRoot 변경·게이트 토글 확인+재시작 안내(A85)·**활성 run 경고 + "취소 후 재시작 / 헤드리스 계속 승인" 선택(A99)** |
| 뷰어(공유) | 파일 0→"문서 없음" | 파일 로드 스피너 | 열람 거부(경로/바이너리) 사유 메시지(A89)·**다운로드 413→"파일 너무 큼·로컬에서 열기"+로컬 절대경로(A98)** | 트리·브레드크럼·크기초과 "미리보기 잘림·다운로드"·마크다운↔raw 토글(A89) |
| F7 편집기 | — | 저장 중 로딩 | **409→편집분 보존+병합 뷰(자동 재로드·유실 금지·A93)**·400 무결성 인라인·403 게이트(A86) | **diff 미리보기·미저장 이탈 경고·저장 토스트**(A85·A86) |
| Eval(F8) | **미실행→"평가 루프 아직 실행 안 됨"(고장 아님)+실행/문서 CTA·`eval-unavailable`→원인(jq 부재)+설치·재시도·데이터 부족→"N회 더 필요"**(A104·UX-R1-#1) | 추세 카드 스켈레톤(카드 독립) | 열람 거부·**ingest=서버 재도출-후-서명(precomputed 거부·자기일관 위조 격리·R7)·과거=rollup digest(회전 무브릭·R5)·추세는 신뢰 rollup(`_workspace`=미검증·digest 불일치=상세 "변조" 툴팁 "로컬 변경·원장 무결·게이트 영향 없음"·A102)**·401·재시도 | **무결성 상태=영향+복구(UX-R1-#2·UX-R2·UX-R3): "상세 파일 불일치—게이트 안전"·"rollup 훼손—제안 차단 + 진단(실패 엔트리/seq/head)·복구 CTA "원장 재구축·재검증"(독립 서명 receipt keyId·키링 재검증 통과분서 재생성·미검증 `_workspace` 재신뢰 금지·독립 소스 전무 시 재구축 불가+명시 리셋만)"·격리 건수/원인**·**alignment≠품질+null(A103)**·**제안 CTA="편집기에서 검토·저장"·"미적용" 유지(승인≠반영·유실 방지·A107)**·**게이트=rollup만(gate-time `_workspace` 재읽기 없음·R6·A106)**·**임계 최소 30/10/3 상시 표시·floor 미만 인라인 거부·effective diff(UX-R1-#4·A110)**·**확인=단계 3 전환+지표/정규화 변경·Stage 4=잠금 사유만(A85·A108·A111)** |
| Context(F10) | 컨텍스트 0→"CLAUDE.md·에이전트·스킬 없음·하네스 확인"·빌드 폼 항상 표시(빈 아님) | 트리·뷰어 스켈레톤(독립 로드) | 열람 거부(화이트리스트 밖/dotfile/홈 전역) 사유·**바이너리(png 등)→"미리보기 불가·다운로드"(F5 A89 준용·400 오인 금지)**·**트리 절단(`MAX_CONTEXT_NODES` 초과·`node_modules`류 차단)→"일부 생략" 배지(HR7)**·빌드 초안 실패(exec 타임아웃/429 `build-in-progress`)→재시도 안내·401 재인증 | **런타임 배지·필터(claude/codex/agy·A129)**·**편집·빌드 비활성 시 "Settings에서 `definitionEditEnabled` 켜기" 툴팁(A81)**·**Codex/agy/GEMINI.md=읽기전용 배지("편집 v0.7"·409·A130)**·**"미적용 초안" 유지(클라이언트 세션·유실 방지·A107)**·**CLAUDE/AGENTS/GEMINI.md=읽기전용(포인터는 "스니펫 복사")**·diff 승인 확인+저장 토스트(A85·A86)·**빌드 동시 1개(HB8)** |

---

## 3. 명칭·UX 리팩토링 제안 (채택 확정 — 근거 포함)
> **RF 코드는 3문서 공통.** F1 폐기로 대화형 관련 RF는 제거·재번호. **UX 축(design A81-A92)에서 RF1-RF6 전부 채택 확정** — 라벨·동선·계약 무변경·A-번호 불변. RF3=A87(착지 배너)·RF4=A88(필터바)·RF5=A87/A91(사이드바 그룹)·RF6=A89(뷰어 명칭)로 수용기준 배선.

| # | 제안 | 근거 | 영향 |
|---|------|------|------|
| RF1 | **Build → 표시 라벨 "New Run"**(내부 페이지 id·A-번호는 유지) | "Build"는 "하네스 빌드"와 혼동·실제론 "새 실행 제출". "New Run"이 2경로 멘탈모델(New/Ask)에 직결 | 라벨·헬퍼만, 계약 무변경 |
| RF2 | **Agents 버튼 = "이 에이전트에게 요청 (New Run)"** | Ask Agent가 Build과 같은 "새 run 시작"임을 명시 | 라벨 |
| RF3 | **2경로 공통 착지 배너**: Build/Agents 제출 성공 시 "→ Runs에서 관찰" 딥링크 | 실행 시작(Build/Agents)과 관찰(Runs) 분리를 동선으로 학습 | 배너 컴포넌트 |
| RF4 | **Runs 필터바 라벨 = "이력 검색·필터"** + 헬퍼("상태·런타임·기간·에이전트·문구로 교차 조회") | F4가 CLI 대비 차별화 지점임을 UI로 드러냄 | 라벨·필터바 |
| RF5 | **사이드바 그룹핑(채택·A87/A91):** **실행**(New Run·Agents) / **관찰**(Overview·Runs) / **정의**(Skills) / **점검**(Drift·Ops·**Eval**) / **설정**(Settings) | 9개 평면 나열보다 역할군이 경계를 시각화·실행 진입점 발견성 | 내비 구조 |
| RF6 | **뷰어 진입 명칭 일관화:** Overview "결과서 열람"·Runs "산출물 열람" 모두 동일 뷰어 컴포넌트 | 문서/artifact 열람이 한 곳(공유 뷰어)임을 학습 | 라벨 |

---

## 4. design-v0.6.md 정합 점검
- **일치 확인:** design F4.5(Runs 필터바)·F5.4(뷰어 Runs/Overview 진입)·F6.5(Overview/Agents/Skills 편입)·F2.4(Agents 프리필폼)·F3.6(Settings 편집폼)·**F7.5(Agents/Skills 정의 편집기·A72-A80)**는 본 명세와 어긋나지 않음. 2경로·A-번호 매핑 동일. 편집(F7)≠실행(2경로) 경계 일치.
- **명칭 리팩토링(RF1-RF6) 채택 확정(UX 축).** design·정본의 "Build" 라벨을 "New Run(내부 id: Build)"로 갱신(A-번호 불변). 기능 계약·수용기준 무변경. design A87(RF3/RF5)·A88(RF4)·A89(RF6)로 배선.
- **폐기 반영:** 구 명세의 "실행 3경로·Follow-up·대화형 Runs"는 **삭제**(F1 폐기). 실행은 2경로, Runs는 관찰·조회·뷰어.

## 다음 단계 참조
- **외부감사 R1 반영:** #8 Runs(2.5)의 **conversationId 필터 약속 제거**(F1 폐기로 필드 부재 — 구현 불가). Runs 필터 = state·runtime·mode·기간·에이전트·텍스트만. design-v0.6 A47-A80·위협 스위트(58+)와 재정합 확인.
- **F7 추가 반영:** Agents(2.3)·Skills(2.4)에 **정의 편집(F7·A72-A80)** 추가·Settings(2.8)에 `definitionEditEnabled` 토글. **편집≠실행 경계**(§1·§0) 명시 — 편집은 정의 파일(`.claude`)만·docs 편집 불가·Codex 듀얼/생성/삭제 v0.7.
- **외부감사 R2 반영:** #6 Settings(2.8) 심링크 거부를 **projectsHome 하위 세그먼트로 한정**(절대 상위는 containment). F7 백업 opaque·strict YAML·pathId·롤백 계약·게이트 fail-closed는 design DW/A72-A80에 반영.
- **외부감사 R3 반영:** #1 Runs(2.5) 열거를 이름 열거→정렬→상위 N read(무작위 절단 정정). #4 Settings(2.8) D2 realpath 절대상위 변경 허용. F7 differential 게이트·공유 config RMW는 design에 반영.
- **외부감사 R4 반영:** #1 Runs(2.5) 정렬키를 **`fs.stat` birthtime/mtime**로(runId 형식 무의존·UUID/`run-10`도 정확). #2 F7 편집기 **본문 `---`(수평선·코드펜스) ACCEPT**(R3 과교정 철회). #3 F7 편집기 **옵션필드(role/tools 등)·미지필드 보존**(필수만 검증). #4 config **필드별 파싱**·#5 F7 differential 게이트 **실행가능 명세(F7.8)**는 design DW5/F3.7/F7.8/A50-A51/A71/A75/A78에 반영. design 위협 스위트 58+와 재정합.
- **UX 축 반영:** §2.9 화면별 UX 상태 명세(전역+화면)·RF1-RF6 채택 확정. design **A81-A101(UX 수용기준 21개·UX-R4로 A100/A101 편입)**와 정합. 기능계약(A47-A80) 무변경.
- **UX-R1(agy) 반영:** 전역 재연결(A94)·Runs 절단 고지(A95)·F7 409 편집분 보존(A93).
- **UX-R2(codex+agy) 반영:** 전역 **재연결 상태머신+401 갭(A94 강화)**·전역 **런타임 미설치 배너(A97)**·New Run **제출 비활성(A97)**·Settings **첫 실행 프로비저닝(A97)·활성 run 취소/헤드리스 선택(A99)**·뷰어 **413 로컬 경로(A98)**·Runs **기간 파티셔닝 도달(A96)**·Overview/Skills **"dead"→"window 관측 없음+커버리지"(A90 강화)**. 다수가 앞선 보안수정의 UX 부작용 정정.
- **UX-R3(codex·agy 수렴) 반영:** Runs **기간(from/to) 시각 도메인을 "기록 시각(FS)" 단일 도메인으로 통일**(A96·R3-#1)·manifest `createdAt` 상세 병기.
- **UX-R4(agy·codex no-high) 반영:** Agents **도구=선언 체크박스만+D 밖 400·조용한 드롭 금지(A100)**·Settings **`dryRun` 프리뷰→확인→쓰기(취소 시 config 무변경·A101)**. 보안 불변식(U⊆D) 무변경·표현·순서만 정정. **UX 수렴 완료.**
- **F8 추가(신규·9번째 화면 Eval):** §2.9 Eval 화면(Part A 결과·B 제안·C 지표관리)·§2.10 매트릭스 Eval 행·RF5 "점검" 그룹에 Eval. **자동 개선 아님·제안만·alignment≠품질·artifact_benchmark=v0.7** 경계 명시. design A102-A112·M13과 정합.
- **F8 보안감사 R1(codex+agy·6건) 반영:** Stage 4 쓰기 없음·게이트 실데이터·malformed 격리·제안 카드 XSS·no-auto-apply에 tools/skills·config 필드 보존.
- **F8 보안감사 R2(codex+agy·5건) 반영:** HMAC 서명·서명 rollup 게이트·수학 교차검증·envelope+nonce·per-leaf+floor.
- **F8 보안감사 R3(5건·암호 프로토콜) 반영:** 서버 서명·체인 rollup+head·추세 rollup 소싱·durable nonce·envelope 결속.
- **F8 보안감사 R4(4건·2 실모순+2 정직 스코핑) 반영:** 키회전 vs 체인 모순·head 정확일치 제거·정직 스코핑(state_home rollback=게임오버 out-of-scope·F8.8).
- **F8 보안감사 R5(1건) 반영:** scorecard 읽기 경로 회전 브릭 해소(ingest 시점만 현재키 HMAC·이후 무결성=rollup digest·과거 window 브릭 0).
- **F8 보안감사 R6(codex 1건) 반영:** 게이트/표시 완전 분리(gate-time `_workspace` digest 요구 제거·게이트는 rollup 엔트리만·`_workspace` 변조 게이트 영향 0).
- **F8 보안감사 R7(codex 1건 심층) 반영:** 서버 서명 tautological oracle 정정 — 재도출-후-서명(원장 재계산·precomputed 거부)·교리 정직 backstop(서명=무결성≠진실성·사람 승인 최종 방어). **F8 보안 완전 수렴(R1~R7)**.
- **F8 UX 감사 R1(codex+agy 동일·4건·보안 불변·UX 레이어) 반영:** §2.9 Eval Part B/C·§2.10 매트릭스 — #1 **빈 상태 데드엔드**(미실행="아직 실행 안 됨"+실행/문서 CTA·`eval-unavailable`=원인+복구)·#2 **무결성 상태 영향+복구**(상세 불일치=게이트 안전·rollup 훼손=제안 차단·"변조" 툴팁)·#3 **승인/적용 분리**(CTA="편집기에서 검토·저장"·"미적용" 유지·유실 방지)·#4 **임계 floor 상시 표시+인라인 거부·A112 "단계4 확인" 모순 정정**(확인=단계3+지표/정규화·Stage 4=잠금). design A104/A107/A110-A112와 정합.
- **F8 UX 감사 R2(codex 1건) 반영:** rollup 무결성 훼손 데드엔드 해소(진단 + 복구 CTA·비악의 훼손만·조율 rollback은 게임오버 유지).
- **F8 UX 감사 R3(agy no-high·codex 1건) 반영:** §2.10·A112 — **재구축 검증 소스 명세**: (a) ingest 시 **독립 서명 receipt(`<state_home>/evals-receipts`·keyId) 별도 저장**·(b) **키링 전 이력 키 보존(재구축 재검증 전용·정상운영은 chain+head·구키 불요·모순 없음)**·(c) 재구축=**독립 receipt 통과분만**·(d) **독립 소스 전무 시 재구축 불가+명시 리셋만(미검증 `_workspace` 재신뢰 금지)**. design F8.1/F8.8/A112/AS8와 정합.
- **F8 최종확인 R4(agy no-high·codex 1건·stale 문구) 반영:** design F8.1 키링 문구 모순 제거 — 단일 키 규율(정상운영=체인+head-HMAC·재구축=키링+독립 receipt)·키 보존 불변식(회전 시 구키 폐기 안 함·원자 회전). **F8 완전 수렴(보안 R1~R7·UX R1~R3·문구 정합).**
- **v0.6 최종 통합감사 R1(codex+agy·교차기능 4건) 반영:** 화면 경계 무변경·design 내부 정정 — #1 공유 config 전 필드 보존 RMW·#2 `manifest.agent` additive 델타(Agents 요청→Runs 에이전트 필터 흐름 정합)·#3 Runs/Eval 공용 경화 리더(심링크 run dir 차단)·#4 F8 제안→F7 `evalProposal`+DW11 결속(제안 우회 저장 0).
- **v0.6 통합감사 R2(codex+agy·R1이 부른 새 이슈 4건) 반영:** design 내부 정정(화면 경계 무변경) — #1 config `evals` 재귀 per-leaf(한 잎 손상이 형제 clobber 0)·#2 **envelope config-hash=Part C `evals`만·운영 플래그 제외**(`definitionEditEnabled` 토글이 대기 제안 무효화 0·데드락 해소)·#3 **일반 편집=상시 허용·우회 아님**(envelope는 "승인된 제안" 주장에만·Eval Part B "검토·저장" CTA와 정합)·#4 공용 리더 앵커 파라미터화(F8=`<state_home>/evals-rollup` 읽기 가능). design F3.7/F8.3/A107/DW11/A50-A60-A102와 정합.
- **v0.6 통합감사 R3(agy no-high·codex 1건) 반영:** Eval(§2.9) — **ingest(쓰기)와 GET(읽기) 분리 명확화**: ingest=서버 백그라운드 잡(자동)·**전 `GET /api/evals*` side-effect 0**·수동 재구축(UX-R2 CTA)=인증 mutating `POST /api/evals/rebuild`. "Part A 읽기전용"은 GET 뷰 한정. design F8.1/F8.2/A102와 정합.
- **v0.6 통합감사 R4(agy no-high·codex 2건·R2/R3 파생) 반영:** Agents(2.3)·Eval(§2.9) — **#1 F2 제출 시점 D 재도출**(template↔제출 사이 정의 삭제/변경 시 `409 agent-definition-changed`·U⊆D 천장우회 차단)·**#2 F8 nonce 발급=`POST …/prepare`(GET 아님)·`issued→applying→consumed` 상태머신·멱등 재시도(크래시 유실 0·중복적용 0)**. design F2.3/A66/F8.3/DW11/A107과 정합. **v0.6 통합 수렴.**
- **미해결:**
  1. **DESIGN.md(Linear) 정합 상세** — 사이드바 5그룹(RF5)·배지 kind·스켈레톤 컴포넌트가 Linear 토큰과 맞는지 UX 감사에서 시각 검증(A91/A92).
  2. **URL 쿼리 반영 범위(A88)** — F4 필터를 URL에 반영(공유·새로고침 보존)하되 민감정보 미노출 확인.
  3. **뷰어 마크다운 렌더 안전(A89)** — 렌더↔raw 토글이 DV8(sanitizer/CSP)와 정합(raw 토글도 escaped).
- **핵심 결정 & 이유:**
  - **대화형 후속 폐기** → 실행 진입점 **2개(New/Ask)**로 단순화. "이어서는 터미널" 명시.
  - **Runs = 관찰·조회·뷰어의 집**·대량은 F4 필터·산출물은 F5 뷰어.
  - **관측성(F6)은 신규 페이지 0**·estimated 배지 비협상.
  - **UX = 방치 금지 원칙** — 빈/로딩/에러/비활성 4상태를 화면별로 명세(A81-A92)·색만 전달 금지·모든 disabled에 이유.
  - 기능 계약·수용기준은 설계서가 정본 — 이 문서는 역할 경계·명칭·동선·**UX 상태** 정리.
- **다음 단계:** RF1-RF6 채택 확정 → design A81-A92 배선 → **UX 외부감사 2회+** → M7(Runs 필터)·M8(뷰어)·M9(관측성)·M10(Agents 프리필)·M11(Settings)·M12(F7 편집기) 구현 시 §2.9 UX 상태·헬퍼·경계 함께 배선.
</content>
