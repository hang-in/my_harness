# Harness UI v0.6 — 설계서 (관측 심화 + 편집기 + 평가 + 컨텍스트 관리: F4 Runs 조회·필터·검색 · F5 문서/artifact 뷰어 · F6 관측성 계층 B · F2 에이전트 프리필 New Run · F3 projectRoot 편집 · F7 정의 편집기 · F8 Eval(평가·자기개선·지표관리) · F9 Docs 소스 설정 · F10 하네스 컨텍스트 관리 + 에이전트/스킬 빌더)

> **후속 편입(2026-07-10·실사용 피드백):** F9(Docs 소스 설정)·F10(하네스 컨텍스트 관리+빌더) 편입. 마일스톤 M14(F9)·M15(F10)·수용기준 A113부터. 사용자 확정 3결정(재론 금지): ① Docs 소스=다중 경로 등록+메뉴 on/off(각 소스 라벨+경로·기본 `docs`·F5 방어 그대로 통과) ② 빌드=폼 기반 AI 초안→사람 승인→F7 저장(자동 적용 금지·F8 Part B 준용) ③ 쓰기=`.claude/agents·skills`(F7 스코프)+신규 생성만·CLAUDE.md/AGENTS.md 읽기전용(포인터 등록=스니펫 복사 안내). 상세=§F9·§F10.
> 상태: **설계 초안 · 미검증(codex+agy 외부감사 직전 강화 라운드).** 정본 = `docs/harness-ui/v0.5/design/design-v0.5-final.md`(코어 §1-9·A1-A46 CERTIFIED).
> 방향(확정): v0.6 = **관측·통제 패널 심화**. 대화형 채팅(구 F1)은 **폐기 → v0.7 이월**(§F1-폐기결정). 대화는 터미널(Claude Code/Codex)이 우월하고, Web 채팅은 보안비용(stdin·resume 미검증)이 크고 차별화가 약하다. v0.6의 차별화 = **CLI가 못 하는 것**(교차-run 조회, 문서/artifact 브라우징, 사용/효과 관측).
> 규칙: 신기능이 v0.5 모델을 **깨는 지점을 격리**. 수용기준은 **A47부터** 이어서 부여(측정가능). 구 초안(F1/F2/F3에 걸쳐있던 A47-A62)은 **본 재번호로 대체**(F1 폐기로 결번 없이 전면 재부여). PRD = `../prd/v0.6-prd.md`, 페이지 경계 = `../prd/page-requirements.md`.
> 코드 근거: `harness-ui/src/server/adapters/runs.ts`(listRuns=status만 read·getRun·readEvents 스트리밍), `adapters/statestats.ts`(계층 A·readCapped O_NOFOLLOW 256KB·docs/*/working_history 스캔), `api/index.ts`(artifact 서빙 방어: 선계산 realpath 앵커·per-seg isSafeSegment·deniedPath·O_NOFOLLOW·fstat·ARTIFACT_MAX 8MB·nosniff·attachment), `security.ts`(DENY 정규식·Host/Origin/token 게이트·onSend nosniff/no-referrer), `lib/paths.ts`(stateHome·SAFE_SEGMENT·isSafeSegment·isWithinRoot), `index.ts`(projectRoot 모듈 상수·registerApi 주입), `exec-run.ts`(RunRequest Zod·noFlag·buildArgv), `web/screens.tsx`(8화면).
> 관측성 선안 흡수: `docs/harness-ui/v0.5/design/design-observability.md`(계층 A/B·토큰 신뢰등급표)를 v0.6 정식 편입 — 계층 A는 v0.5 M4에서 출하 완료(A35-A38), **계층 B가 F6**(§F6). 상세는 그 문서를 단일 출처로 참조.

## 용어 정의 (Glossary — 내부 식별자 ↔ 평이한 뜻)
> 이 문서의 코드형 식별자(F·M·A·I·D·DV·DW·DS·HR·HB·R…)는 **추적·검증용 안정 ID**다(스펙 골격이라 유지). 처음 읽는 사람을 위한 평이한 뜻은 아래 표로 확정한다. **웹 UI에는 이 코드를 노출하지 않고 "사용자 라벨"만 쓴다.**

### 기능·마일스톤·기준
| ID | 뜻 | 사용자 라벨(UI) |
|----|-----|----------------|
| **F-번호**(Feature·기능 단위) | F2 에이전트 프리필 실행·F3 projectRoot 편집·F4 Runs 조회·F5 문서/artifact 뷰어·F6 관측성 계층 B·F7 정의 편집기·F8 Eval·F9 Docs 소스 설정·F10 하네스 컨텍스트 관리+빌더 (F1 대화형=폐기) | F2 "에이전트로 새 실행"·F3 "프로젝트 경로"·F4 "실행 이력"·F5 "문서 뷰어"·F6 "효과성·활용도 지표"·F7 "정의 편집"·F8 "평가"·F9 "문서 소스"·F10 "하네스 구성 관리" |
| **M-번호**(Milestone·구현 순서) | M7~M15 = F4~F10 순차 구현 단위 | (내부·UI 미노출) |
| **A-번호**(Acceptance criteria·수용기준) | 기능이 통과해야 할 검증 항목의 고유 번호(A1~A130). 예: A71=프로젝트 경로 편집 안전·A78=편집 허용 노브·A118/A119=문서 소스 UI·A128=컨텍스트 화면 | (내부·UI 미노출) |
| **S-번호** | PRD의 성공지표(Success metric) | (내부) |
| **R-번호**(Round) | 외부감사 라운드(R1·R2…) | (내부) |

### 관측성 계층
| ID | 뜻 | 사용자 라벨 |
|----|-----|-----------|
| **계층 A**(Layer A) | 정적 구성/건강도 — 인벤토리·구성 건강도·업데이트 상태·진화 이력. v0.5 출하 | "구성 현황" |
| **계층 B**(Layer B) | 실행에서 파생된 통계 — 토큰·성공/실패·효과성·활용도. = F6 | "효과성·활용도 지표(실행 관측 기반)" |

### 보안·위협모델 규칙(코드 도메인 방어 ID)
| ID | 뜻 |
|----|-----|
| **I1~I8**(Invariants·불변식) | 깨면 안 되는 보안 원칙(fire-and-observe·stdio 로그·execFile+argv·경로안전·127.0.0.1·읽기전용 등) |
| **DV1~DV9** | 문서 뷰어(F5) 경로탈출·XSS 방어 규칙 |
| **DW1~DW11** | 정의 편집(F7) 쓰기 안전 규칙 |
| **D1~D8** | 프로젝트 경로(F3) 경로안전 규칙 |
| **DS1~DS8** | 문서 소스(F9) 경로검증 규칙 |
| **HR1~HR7 / HB1~HB8** | 하네스 컨텍스트(F10) 읽기(HR)·빌드(HB) 안전 규칙 |

### 웹 UI 용어 확정 (코드 미노출 — 평이한 라벨만)
`projectRoot`→**"프로젝트 경로"** · `계층 B`→**"효과성·활용도 지표"** · `관측 window`→**"관측 기간"** · `활성 run`→**"실행 중 작업"** · `정의 편집 게이트`→**"정의 편집 허용"** · `Docs 소스`→**"문서(산출물) 소스"** · `heuristic`→**"추정"** · `D4 규율`→**"산출물 관리 규율"**. (본 스펙 본문은 추적성 위해 코드 유지 — UI만 라벨 적용.)

## 0. v0.5 불변식 (깨면 안 되는 것 — 신기능 게이트)
각 기능 설계는 이 목록 대비 "유지/델타"를 명시한다.
- **I1 fire-and-observe:** 실행 = 배치 제출(Build/Agents) → supervisor spawn → Runs 관찰. 대화형 아님(§1·§3).
- **I2 stdio 로그파일 고정:** `stdio:["ignore",out.fd,errfh.fd]`·pipe 금지(EPIPE 자살 방지)·detached·unref(§3 stdio MUST).
- **I3 execFile+argv·shell 금지:** 문자열 보간 금지, `noFlag`로 argv 요소 leading-dash 차단(exec-run.ts, §5b).
- **I4 supervisor=스키마 최종 저자:** LLM은 구조화 로그만, supervisor가 승격·상태 파일 저자(§3).
- **I5 보안 게이트:** bootstrap(fragment·single-use)·Host allowlist·Origin(mutating)·session token·쿼리토큰 금지(A23·§0-VOID). 응답 nosniff·no-referrer(security.ts onSend).
- **I6 경로 안전(통일 원칙 — R2-#6 정합):** realpath 앵커(walk 이전 선계산)·`O_NOFOLLOW`·`isWithinRoot`·`<state_home>`/`_workspace` 분리(§9-STATE)·`deniedPath` denylist. **심링크 무조건 거부는 "신뢰 앵커(realpath) 하위의 사용자 세그먼트"에만 적용**한다. 앵커 자체·그 절대 상위부(예: macOS `/var`→`/private/var`·`/tmp`·홈)는 **realpath containment로 보장**하고 lstat 무조건거부 대상 아님(정상 환경 오거부 방지). → F5 뷰어는 앵커=`docs/`·`artifacts/`(전 사용자 세그먼트가 하위 → 무조건거부, DV4). F3 projectRoot는 앵커=`projectsHome`(절대 상위=containment·**projectsHome 하위 상대 세그먼트만** 심링크 거부, D3). **두 맥락 혼선 없음.**
- **I7 projectRoot 캡처:** 모듈 상수, `registerApi(app, projectRoot)` 주입(index.ts). 127.0.0.1 바인딩.
- **I8 파일 무변경(읽기전용 원칙) — F7 스코프 예외:** F4·F5·F6은 완전 읽기전용, F3은 `<state_home>` config 쓰기(프로젝트 파일 미변경). **단 F7(정의 편집기)만 예외** — `.claude/agents/*.md`·`.claude/skills/**/SKILL.md`에 한해, **스코프 게이트(DW1)+무결성 검증(DW5)+원자쓰기(DW4)+낙관적 동시성(DW6)** 하에서만 쓰기 허용. 전면 파일수정 API(`mutationEnabled`)는 **여전히 비활성**(F7은 그 하위집합 아님·독립 스코프 노브 `definitionEditEnabled`). **F9는 F3와 동일 축**(`<state_home>` config `docsSources`/`docsMenuEnabled` 쓰기만·프로젝트 파일 무변경·F5 뷰어는 읽기전용 유지). **F10 쓰기는 F7 스코프(`.claude/agents·skills`)+신규 생성만으로 유지** — CLAUDE.md·AGENTS.md는 **읽기전용**(자동 쓰기 금지·포인터 등록은 스니펫 복사 안내)·docs/** write 불가. **F10 빌드 초안 생성 exec surface는 읽기전용 컨텍스트만 입력·bounded·no-auto-apply**(디스크 미기록·사람 승인 후에만 F7 경로로 저장) — I8 예외를 넓히지 않는다.

---

## F1(구) — 대화형 채팅 : **폐기 → v0.7 이월 (결정 기록·삭제하지 않음)**

### F1-폐기결정
초기 v0.6 초안은 "follow-up 세션 이어붙이기"(대화형)를 F1로 두었다. **영향평가 결과 폐기**하고 근거를 기록으로 보존한다(완전 삭제 아님 — 감사 추적성).

| 폐기 근거 | 상세 |
|-----------|------|
| **제품 목적 불일치** | 이 앱 = 관측·통제 패널(fire-and-observe). 채팅은 목적 밖. 대화형은 터미널(Claude Code/Codex)이 이미 우월·자연스럽다. |
| **보안비용 큼** | follow-up은 부모 세션 `sessionId` resume 참조 = 신규 공격면(세션 위조·cross-conversation·권한 무음 승계). PTY/stdin 대안은 I2(pipe 금지·EPIPE) 정면 위반. |
| **미검증 의존** | codex `exec resume` 문법·claude `--resume` permission 상속은 **실 CLI 미검증(assumption)** — 구현 리스크 상존. |
| **차별화 약함** | 대화 편의는 CLI 대비 우위 없음. v0.6 차별화는 CLI가 못 하는 **교차-run 관측**(F4-F6). |

- **판정:** v0.6 **비목표**(§5). 재검토 시 v0.7에서 별도 설계(PTY 컨테인먼트·WebSocket 인증·resume 실CLI 스모크 선행). 구 초안의 스키마 델타(conversationId/parentRunId/turnIndex/sessionId)는 **채택 보류** — 단, **F2 귀속용 optional `manifest.agent`(v0.6 additive 델타·F2.1)**·events `usage`(F6·v0.5 §5 선반영)만 v0.6에 유지(대화와 무관·관측에 유용).
- **A-번호 영향:** 구 A47-A52(F1) 결번 없이 F4-F6·F2·F3로 **전면 재부여**(아래).

---

## F4 — Runs 이력 고급 조회·필터·검색 (v0.6 새 주축 · 읽기전용)

### F4.1 문제·접근
CLI로는 "지난 30분간 실패한 codex run만", "에이전트별로", "이 문구 포함한 run" 같은 **교차-run 조회**가 어렵다. Web 패널의 차별화 지점. **완전 읽기전용** — `_workspace/runs/*/{manifest,status}.json`·`events.jsonl` 스캔만, 파일 무변경(I8 유지).
> **conversationId 필터는 v0.6에 없다**(감사 R1-#8): F1(대화형) 폐기로 스키마에 `conversationId` 필드가 없다. F4 쿼리·응답 어디에도 포함하지 않는다(구 초안 잔존 참조 전부 제거).

- **현 코드 갭:** `listRuns`는 각 run의 `status.json`만 read하고 `{runId,status,valid}`만 반환한다(runs.ts). **manifest는 안 읽음** → runtime·mode·createdAt·goal·requestedBy·agent 로 필터·검색하려면 **manifest read 병합 델타** 필요.

### F4.2 API 델타
```text
GET /api/runs?state&runtime&mode&agent&from&to&q&sort&order&offset&limit
```
- 기존 `GET /api/runs`(무인자)는 **하위호환 유지**(인자 없으면 현 동작=전체 목록). 인자 있으면 필터/검색.
- 서버가 각 run의 `status.json` + `manifest.json`을 병합 스캔(getRun의 readJsonSafe 재사용) → 필터·정렬·페이지네이션.

### F4.3 쿼리 Zod 검증 (주입·ReDoS·OOM 방어)
```ts
const RunsQuery = z.object({
  state:   RunState.optional(),                              // enum(§5) — 임의 문자열 거부
  runtime: Runtime.optional(),                               // enum
  mode:    z.string().max(40).optional(),                    // 리터럴 비교(정규식 아님)
  agent:   z.string().regex(SAFE_SEGMENT).max(120).optional(),
  from:    z.string().datetime({ offset: true }).optional(), // recordedAt(FS-time) >= from — 단일 도메인(R3-#1)
  to:      z.string().datetime({ offset: true }).optional(), // recordedAt(FS-time) <= to
  q:       z.string().max(200).optional(),                   // 텍스트 검색어
  sort:    z.enum(["recordedAt","updatedAt","state"]).default("recordedAt"), // recordedAt=FS-time(파티션·정렬 동일 도메인)
  order:   z.enum(["asc","desc"]).default("desc"),
  offset:  z.coerce.number().int().min(0).max(100000).default(0),
  limit:   z.coerce.number().int().min(1).max(100).default(50),
});
```
- **정규식 주입/ReDoS 차단(핵심):** `q`는 **절대 `new RegExp(q)`로 컴파일하지 않는다.** `String.prototype.includes`(대소문자 무시 = 양쪽 `toLowerCase`)의 **리터럴 부분일치**로만 매칭. 대상 필드 = `goal`·`mode`·`agent`·`requestedBy`(스키마 문자열). 사용자가 `.*`·`(a+)+` 등을 넣어도 리터럴 문자열로 취급 → ReDoS 불가.
- **이름 열거 → FS시간 정렬 → 상위 N 내용 read(정렬 정합·runId 형식 무의존 — R3-#1·R4-#1):** `readdir`는 **엔트리 순서 미보장**이고 **`runId: z.string()`은 시간순 접두를 강제 안 함**(CLI/미래가 UUID·`run-1`/`run-10` 생성 가능 → 사전식 정렬 무작위). 정정:
  1. **이름만 열거(전체):** `readdir`로 runId **디렉토리 이름만** 수집(내용 read 아님). 극단 대비 `MAX_RUN_DIRS` 하드 backstop.
  2. **FS시간 정렬(채택 = 택1-(a)):** 각 디렉토리에 **`fs.stat`으로 `birthtimeMs`(미지원 FS는 `mtimeMs` fallback)** 취득 → **내림차순 정렬**(runId 문자열 형식 **무의존**·결정적 최신순). tie-break=runId. **stat 불가/malformed 디렉토리는 quarantine(격리·스캔 제외·`valid:false` 카운트)**. stat = 경량 메타데이터(내용 아님). *(대안 (b) runId ISO 문법 검증+비매칭 격리는 스키마 강제 필요 → 폐기.)*
  3. **상위 `MAX_RUNS_SCAN`개만 내용 바운드 read(공용 경화 리더·앵커 파라미터·통합감사-#3·R2-#4):** 정렬 상위 N에 대해서만 status·manifest·events를 **F4/F6/F8 공용 단일 경화 바운드-리더 프리미티브**로 읽는다 — **(i) 선계산 realpath 앵커·`isWithinRoot(anchor, real)` — `anchor`는 파라미터**(F4/F6=`_workspace/runs`·F8=`<state_home>/evals-rollup`(+receipts)·하드코딩 아님·R2-#4) (ii) per-세그먼트 `isSafeSegment` (iii) 전 하위 세그먼트 심링크/reparse 무조건 거부(lstat·Windows reparse point) (iv) leaf `O_NOFOLLOW` open→`fstat` 정규파일·크기상한(`MAX_JSON_BYTES`) (v) 열기 후 containment 재확인**(runs.ts `safeRunDir`+`safeOpen` 패턴·F5 DV4와 **동일 규율·앵커만 인자**). → **심링크 dir이 read를 앵커 밖으로 리다이렉트하는 벡터 차단**(F5 뷰어와 불일치 정정). 손상/미검증 = `valid:false` skip(A5be). **OOM 방어 = 내용 read 상한(N × MAX_JSON_BYTES).**
  4. **필터·전역 정렬·페이지:** 필터 통과분을 경량 레코드 `{runId,runtime,mode,state,recordedAt(FS-time·정렬/필터 축),createdAt(manifest·표시·괴리 가능),updatedAt,goalExcerpt(≤200자),agent,requestedBy}`로 → 요청 `sort`(recordedAt|updatedAt|state)+`order` **전역 정렬**(tie-break `runId`·결정적) → `offset..offset+limit` slice. **from/to·recordedAt 정렬·파티션 모두 `recordedAt`(FS-time) 단일 도메인**(R3-#1 경계 누락 0).
- **임계 수치(측정가능):** `MAX_RUNS_SCAN`=5000(**내용 read 대상**)·`MAX_JSON_BYTES`=64KB·`SCAN_DEADLINE_MS`=2000(초과 시 부분결과+`truncated:true`)·`MAX_RUN_DIRS`(이름+stat backstop, 예: 100000). 스캔 창 = **FS시간 최신 상위 5000**(runId 형식 무관·무작위 아님 → F6 "최근 N" 정합)·`scanned>MAX_RUNS_SCAN`이면 `truncated:true`. 메모리 상계 = (이름+stat시간 ≤MAX_RUN_DIRS·소량) + (매칭 경량 레코드) + (내용 read 1건 transient).
- **기간 파티셔닝 — 오래된 이력 도달성(A96·UX-R2-#2·R3-#1):** `from`/`to`(A48)는 **`recordedAt`(FS-time) 도메인**(파티션·정렬·필터와 동일 축 → 도메인 불일치 경계 누락 0). 지정 시 정렬 후 **[from,to]에 `recordedAt`가 겹치는 구간을 상한까지 스캔**(최신 5000 아니라 **기간 window 상위 N**) → 상한 밖 오래된 run도 **기간을 좁히면 도달**(데드엔드 해소). `truncated`는 window 기준. 무기간 = 최신 N. **정직 주석:** manifest `createdAt`은 표시용·복사/복원 run은 `recordedAt`과 괴리 가능(상세에 병기).

### F4.4 응답
```ts
{
  items: Array<{ runId, runtime, mode, state, recordedAt /*FS-time·필터/정렬 축*/, createdAt /*manifest·표시·괴리 가능*/, updatedAt, goal, agent, requestedBy }>,
  total: number,        // 필터 통과 총수(스캔 범위 내)
  offset, limit, hasMore: boolean,
  scanned: number,      // 실제 스캔한 run 수(MAX_RUNS_SCAN 도달 시 truncated 힌트)
  truncated: boolean,   // scanned == MAX_RUNS_SCAN
  schemaVersion: "1",
}
```

### F4.5 UI 배선 (Runs 목록)
- 필터바: state·runtime·mode·**기간(from/to = "기록 시각(파일시스템)" 도메인·A96)**·검색어(`q`) 입력 + 정렬 토글(recordedAt/updatedAt/state) + 페이지네이션 + **활성 필터 칩·결과 카운트·"필터 초기화"·URL 쿼리 반영**(A88). manifest `createdAt`은 상세에 병기(괴리 주석).
- **절단 고지(A95·UX-R1-#3):** 응답 `truncated:true`(스캔 상한 `MAX_RUNS_SCAN` 도달) 시 결과 카운트 옆·빈 상태에 **"최근 5000개 상한 도달 · 더 오래된 이력 생략" 경고 라벨+툴팁** → 절단으로 인한 0/부분 결과를 "이력 없음"으로 **오해 금지**(빈 상태 A82와 구분).
- **A46 준용:** 빈/로딩/에러 3-state·GET 재시도·키보드 nav. 읽기전용(mutating 없음 → Origin 게이트 무관).
- 결과 행 클릭 → RunDetail(기존 A5/A6). RunDetail에서 artifact 열람 → **F5 뷰어**.

---

## F5 — 문서/artifact 뷰어 (읽기전용 · **경로탈출 = 중대 위협**)

### F5.1 문제·접근
`docs/**`(설계서·PRD·working_history 결과서)와 run artifacts를 화면에서 브라우징·열람. 기존 artifact 서빙(api/index.ts)이 이미 강한 방어를 갖췄으므로 **재사용·확장**. 신규 위험 = docs/** 열람이 **경로탈출**(`../`·심링크·절대경로)로 `/etc`·`~/.ssh`·`.env`·`.git`을 노출할 수 있음. → 아래 방어를 **전부 수용기준 A-번호**로.

### F5.2 위협모델 (중대 — 다층 fail-closed)
| 방어층 | 규칙 | 근거·재사용 |
|--------|------|-------------|
| DV1 열람 루트 화이트리스트 | 열람 가능 루트 = **`docs/`**(재귀)와 **`_workspace/runs/{runId}/artifacts/`**(재귀) **둘뿐**. 그 외(`.git`·`node_modules`·`harness-ui/src`·`$HOME` 등) 접근 요청 = 400. projectRoot 밖은 원천 불가 | 신규(강력) |
| DV2 per-세그먼트 검증 | 상대경로 각 세그먼트 `isSafeSegment`(빈/`.`/`..`/메타 거부) | paths.ts 재사용 |
| DV3 realpath 앵커(선계산) | 화이트리스트 base를 walk **이전에** `realpath` 선계산·`isWithinRoot(realRoot, realBase)` 확인(base swap 창 축소) | api/index.ts artifact 패턴 재사용 |
| DV4 **전 세그먼트 심링크 무조건 거부** + O_NOFOLLOW | **base→leaf 경로의 모든 세그먼트를 `lstat`으로 검사, 심링크면 in-root든 out-root든 무조건 거부**(v0.5 §5b artifact 불변식 — realpath 경계검사로 대체 금지). 통과 후 leaf를 `O_NOFOLLOW` open → `fstat` 정규파일 확인 → realpath 재확인(isWithinRoot). **중간 세그먼트를 realpath 경계검사만으로 허용하지 않는다(감사 R1-#2: I6/A54 위반 정정)** | v0.5 §5b·runs.ts safeRunDir per-seg lstat 패턴 재사용 |
| DV5 denylist(해석 전) | `deniedPath` 재사용 + **뷰어 확장**: `.env`·`*.key`·`*.pem`·`*.p12`·`*.pfx`·`id_rsa*`·`.git`·`.ssh`·`.aws`·`node_modules`·`.ui-session-token`·레지스트리 경로. 현 DENY(`/(^|\/)\.[^/]…/`)가 이미 dot-prefix 세그먼트 전부 차단하므로 `.env`/`.git`/`.ssh`는 기존 커버, **확장자 기반(`*.key` 등)만 신규 추가** | security.ts DENY 확장 |
| DV6 **크기 상한 = 스트림 前 사전검사(미리보기·다운로드·손상 정정 R1-#3·R2-#5)** | 미리보기 `VIEW_MAX`(예: 1MB) 초과 → 미리보기 거부(절단 표시). **다운로드는 `fstat.size`를 스트림 시작 前 검사해 `ARTIFACT_MAX`(8MB) 초과면 `413 Payload Too Large` 즉시 반환**(중간 스트림 중단 **금지** — 브라우저 "Network Error"·조용한 부분파일 손상 유발). 무제한 응답 없음·크기초과 사유 명시(413 body에 크기·상한) | api/index.ts ARTIFACT_MAX·fstat |
| DV7 **바이너리 거부** | 널바이트/비-UTF8 감지 → 미리보기 거부(attachment 다운로드만·하드상한 적용) | readCapped 확장 |
| DV8 **XSS 차단·렌더 안전(감사 R1-#1 치명)** | 모든 텍스트/마크다운 렌더는 (a) **raw HTML 비활성**(마크다운 `html:false`·HTML 태그 escape), (b) **sanitizer 통과**(허용 태그·속성 allowlist), (c) **URL scheme 화이트리스트**(`http:`·`https:`·`mailto:`만 — `javascript:`·`data:`·`vbscript:` 거부), (d) **외부 리소스 차단**(원격 `<img src>`·폰트·`fetch` 불가), (e) **CSP 헤더**(`default-src 'none'; img-src 'self'; style-src 'self'; script-src 'none'; frame-ancestors 'none'`) + `nosniff`. SVG는 렌더 안 함(attachment만·A14 준용) | 신규(치명·최우선) |
| DV9 fail-closed | 위 중 하나라도 실패 = 400/403, 열람 안 함 | 에이전트 원칙 |

### F5.3 API
```text
GET /api/docs                          # docs/ 트리(디렉토리·파일 목록, 화이트리스트 루트만)
GET /api/docs/*                        # docs/ 하위 파일 열람(DV1-DV9)
# run artifacts는 기존 유지·확장:
GET /api/runs/:runId/artifacts         # 기존(A28) — 목록
GET /api/runs/:runId/artifacts/*       # 기존(A27/A45) — 열람. 뷰어가 이 엔드포인트 소비
```
- `/api/docs` 트리: `statestats`의 `listMd`/`notSymlinkDir`(심링크 디렉토리 거부·MAX_DOCS cap) 재사용·확장. `docs/` 밖 요청 = 400.
- 응답 헤더: `nosniff`(security.ts onSend 기존) + **CSP(DV8: `default-src 'none'; img-src 'self'; style-src 'self'; script-src 'none'; frame-ancestors 'none'`)** + MIME 화이트리스트로 렌더 결정(md/txt/json/log = **sanitized·raw-HTML 비활성·safe-scheme만** 미리보기, 그 외 = `Content-Disposition: attachment` 다운로드만·하드 크기상한). SVG/HTML/JS는 비실행·비렌더(A14 준용 — attachment).
- **렌더 파이프라인(DV8):** 마크다운은 `html:false`로 파싱(raw HTML 무시) → sanitizer(태그·속성 allowlist) → URL scheme 화이트리스트(`http`/`https`/`mailto`) → 외부 리소스 차단(원격 img/폰트 불가). 마크다운 렌더러·sanitizer 라이브러리는 서버측(SSR) 또는 클라 신뢰 컴포넌트에서 동일 정책 적용.

### F5.4 UI 배선
- **진입점 2곳**(page-requirements §2):
  - Run artifacts → **Runs 상세**에서 열람(A45 확장).
  - 프로젝트 docs → **Overview**의 D4 규율/진화 이력 카드(A36/A38)에서 결과서 클릭 → 뷰어(Overview는 이미 `docs/*/working_history`를 스캔 — 자연스러운 진입).
- 뷰어 컴포넌트(공유): **파일 트리 + 브레드크럼**(A89) + escaped text + **마크다운 렌더↔raw 토글**(raw도 escaped·DV8) + 다운로드 버튼. 읽기전용·빈/에러 3-state(A46).
- **UX 상태(A89·A98):** 크기상한 초과 미리보기 → "미리보기 잘림(N까지)·전체 다운로드"·**다운로드 `413` → "파일이 너무 큼 · 로컬에서 열기" + 로컬 절대경로 표시**(OS 직접 열기)·바이너리 → "미리보기 불가(바이너리)·다운로드".

---

## F6 — 관측성 계층 B 정식 편입 (읽기전용 집계 · measured/estimated 라벨)

### F6.1 편입 범위
`design-observability.md`(선안)를 v0.6 정본으로 편입. **계층 A는 v0.5 M4에서 출하 완료**(A35-A38: 구성건강도·D4규율·업데이트상태·진화이력). **계층 B = F6**: 실행 파생 통계(토큰·비용·실패패턴·리뷰수렴·활용도). 상세 표·페이지 구성은 `design-observability.md §2·§3·§7b`를 단일 출처로 참조 — 본 절은 v0.6 **구현 계약·안전경계**만 못박는다.

### F6.2 토큰 귀속 신뢰등급 (과대표시 금지 — 비협상 · 감사 R1-#7 정정)
`design-observability.md §2` 표를 계약으로 승격하되, **measured는 "검증된 소스 증거가 실제 존재할 때만"** 부여한다(등급은 데이터 유무의 함수 — 고정 상수 아님):
| 단위 | 상한 등급 | measured 조건(증거 필수) | 증거 부재 시 fallback |
|------|-----------|--------------------------|------------------------|
| run 총량 | `measured` | 해당 run events/result에 usage 필드가 **실제 파싱됨**(claude result.usage · codex TokenCount) | `unattributed`(measured로 표시 금지) |
| agent별(codex) | `measured` | 에이전트별 `codex exec` usage가 실제 존재 | `estimated` or `unattributed` |
| agent별(claude team) | `estimated`(상한) | — (분해 미보장 → 절대 measured 아님) | `unattributed` |
| skill별 | `estimated`(상한) | — (토큰 경계 없음 → 절대 measured 아님) | `unattributed` |
- **값별(per-value) confidence(핵심):** 응답의 **각 metric 값**이 자기 `confidence:"measured"|"estimated"|"unattributed"`를 **개별** 동반한다(응답 단일 confidence 금지 — 혼합 신뢰도 표현 불가 문제 정정). 예: 한 에이전트의 run총량=measured, skill점유=estimated, 미태깅분=unattributed가 **한 응답에 공존** 가능.
- **소스 부재 fallback:** usage 미방출/미파싱이면 그 값은 measured로 **승격되지 않고** `unattributed` 버킷(누락 은폐 금지·0으로 위장 금지).
- **UI 규칙(A62):** `estimated`/`unattributed`는 배지·툴팁 산정식으로 명시, `measured`와 시각 구분. **추정·미귀속을 정확값처럼 표시 금지.**
- **CLI 픽스처 수용기준화(AS1):** measured 경로는 **고정 CLI 출력 픽스처**(usage 있는 stream-json/`--json` 샘플 + usage 없는 샘플)로 검증 — 있으면 measured, 없으면 unattributed로 강등되는지 회귀 테스트(픽스처 스위트).

### F6.3 데이터 경로 (읽기전용 유지 — 집계 방식 결정)
events `agent`·`skill`·`usage` 필드는 **v0.5 §5에 선반영 완료**(스키마 확인). v0.6은 이를 **소비**만.
- **v0.6 MVP = 바운드 on-read 집계(채택).** F4의 열거 인프라 **재사용** — **이름 열거→FS시간(birthtime/mtime) desc 정렬→상위 `MAX_RUNS_SCAN`개**(R3-#1·R4-#1: runId 형식 무관·**결정적 최신 N**·무작위 부분집합 아님)의 events를 스트리밍(readEvents 패턴)하며 agent/skill별 usage·성공/실패 누적. 전수 무제한 스캔 금지(OOM=내용 read 상한). **supervisor·API 쓰기 없음 → 완전 읽기전용, I4/I8 무영향.** "최근 N run" 지표가 실제 최신 N을 반영.
- **rollup.json 증분(선택·이월):** `design-observability.md §4`의 `_workspace/metrics/rollup.json`(supervisor run 종료 시 증분)은 **규모가 커질 때의 최적화**로 이월. 채택 시 rollup 쓰기는 **supervisor 저자**(I4 정합·API는 여전히 read). v0.6 MVP는 on-read로 충분(로컬 단일사용자·run 수 바운드).

### F6.4 API
```text
GET /api/metrics/overview              # 효과성 집계(성공/실패율·평균소요·재작업률·리뷰수렴)
GET /api/metrics/agents                # agent별 롤업(토큰·호출·성공 + confidence)
GET /api/metrics/skills                # skill별 롤업(호출·점유 estimated + 미사용 목록)
```
- **각 metric 값(per-value)이** `confidence:"measured"|"estimated"|"unattributed"`를 개별 동반(F6.2·A61 — 응답 단일 confidence 아님). 각 엔드포인트 스캔 바운드·페이지네이션(F4.3 바운드 열거 준용 — 동일 OOM 방어).

### F6.5 UI 배선 (기존 페이지 내 편입 — F6 신규 페이지 없음)
- **Overview:** 효과성 집계 카드(성공률·재작업률·미사용 에이전트/스킬·리뷰수렴) 추가 = `design-observability.md §3.5 /insights`를 Overview로 흡수(Overview가 이미 "한눈 현황판"·계층 A 홈).
- **Agents/Skills:** 각 상세에 usage 섹션(토큰·호출·연결·선언≠관측 gap) 추가(`§3.2·§3.4`).
- **anti-Goodhart:** 행동유도형 지표(미사용/고아/방치) 위주, 순위·점수 최소화. 측정→제안, 자동 강제 금지.

---

## F2 — 에이전트 프리필 New Run (대화 아님 · 축소 유지)

### F2.1 접근 — 단일 실행경로 재사용
새 실행 계약 없음. Agents 화면이 **프리필된 RunRequest 초안**을 받아 편집 후 기존 `POST /api/runs`로 제출(최초 1회 = fire-and-observe, I1). 대화형 요소(구 follow-up) 제거. 서버는 클라의 "이 에이전트다" 주장을 신뢰하지 않고 **정의에서 재도출**.

- **Manifest 스키마 델타 명시(통합감사-#2·모순 정정·택(a) 채택):** v0.5 published `Manifest`는 `agents: string[]`만 있어 F2 귀속·F4 필터가 쓰는 단수 `manifest.agent`와 모순("스키마 무변경 + manifest.agent 기존" 주장 상충). 정정 = **published `Manifest`에 optional 단수 `agent` 추가**(additive·하위호환):
```ts
// v0.6 additive delta — nullable/default(null) → 기존 run·파서 하위호환. supervisor가 writer.
const Manifest_v06 = Manifest.extend({ agent: z.string().regex(/^[A-Za-z0-9._-]+$/).nullable().default(null) });
```
  supervisor가 Ask-Agent run에 `agent` 기록(팀 명부 `agents[]`와 구분되는 **단일 대상 귀속 태그**). **마이그레이션 테스트: 구 manifest(agent 없음)→`null` 파싱·거부 아님.** F4/F6은 이 `agent`로 필터/귀속. *(택(b) `agents[]`서 파생은 대상/명부 의미 혼동 → 폐기.)*

### F2.2 API
```text
GET /api/agents/:name/run-template     # 서버가 정의(role·skills·tools)에서 프리필 초안 반환
```
- `:name` = **AGENT_NAME allowlist**(`SAFE_SEGMENT`)·`isSafeSegment`(경로주입 `..`/메타 거부). 미존재 → 404.
- 응답(초안 — 실행 아님):
```ts
{ agent, runtime:"claude"|"codex", domainTemplate, targets:("agents"|"skills"|"orchestrator")[],
  suggestedAllowedTools: string[],   // 정의 frontmatter tools → noFlag·max40 clamp
  permissionMode: "read-only" }      // 항상 보수적 기본(상향은 사용자 명시)
```

### F2.3 위협모델·신뢰경계 (표준 등급)
- **경로주입:** AGENT_NAME allowlist + `isSafeSegment`(I6).
- **allowedTools 신뢰모델 — 재도출 기준 + 축소만 허용(감사 R1-#9 모순 정정·비협상):** 두 원칙(디스크 재도출 vs 폼 편집 수용)의 충돌을 다음으로 **일원화**한다.
  1. **기준 = 디스크 정의.** `POST /api/runs`가 `agent`를 받으면 서버가 **디스크 정의에서 tools 집합을 재도출**(클라 주장 무시)해 **상한(ceiling)** `D`를 만든다.
  2. **사용자 편집 = 축소(narrowing)만 · 조용한 드롭 금지(UX-R4-#1 정정).** 실행 반영값은 `U ⊆ D`. **UI는 `D`가 선언한 도구 체크박스로만 구성**(자유입력 주입 불가) → `U ⊆ D`가 **구조적으로 보장**. 만약 요청 `U`에 `D` 밖 도구가 있으면(직접 API 호출 등) **`400 unauthorized-tool`로 명시 반려**(구 "조용히 드롭"은 사용자가 부여된 줄 알고 런타임서 혼란 실패 → **드롭 대신 거부**). 사용자는 D 내에서 **뺄 수만** 있고 D 밖은 **더할 수 없다**.
  3. 서버 Zod가 결과 배열에 `noFlag`·max40 재검증(exec-run.ts). `agent` 미지정(일반 New Run)이면 D 상한 없음 = 기존 v0.5 계약 유지.
  4. **불변식 유지:** U⊆D는 R1-#9와 동일(보안 무변경) — v0.6은 **표현만 "조용한 드롭 → 체크박스 제약 + 400 거부"로 정정**(오도상태 제거).
- **신뢰경계:** run-template·POST 양쪽 모두 정의를 서버가 디스크에서 **이름으로 재조회**. 클라 주장 role/tools/runtime 무시. → 악성 페이지가 "workspace-write·전 tool"이라 주장해도 **D 밖 도구는 `400 unauthorized-tool` 반려**(D가 상한·조용한 드롭 없음).
- **제출 시점 D 재도출 = 천장우회 차단(TOCTOU·통합감사 R4-#1):** template 조회↔제출 사이 정의 삭제/변경 시 D를 다시 못 얻는데 실행 허용하면 **U⊆D 천장 검증 우회**(구 "정의 비의존 정상 진행"이 tools 천장을 놓침). 정정: **`agent` 지정 제출은 제출 시점에 에이전트 정의를 재조회·D 재도출**(템플릿 시점 D 신뢰 금지)·**U⊆D는 제출 시점 D 기준**·정의 부재 or pathId/해시 변경 시 **`409 agent-definition-changed` + 새로고침 요구**(수용된 U가 없어진 D의 tool을 포함할 위험 차단). `agent` **미지정 일반 New Run**은 D 상한 없음(기존 v0.5 계약)이라 무관. `manifest.agent` 태그 자체는 형식검증만(귀속·경로 조립 아님)이나, **allowedTools가 비어있지 않으면 D 재도출 필수**.

### F2.4 UI 배선
- Agents 상세 "이 에이전트에게 요청 (New Run)" → run-template 로드 → Build 동형 프리필 폼(편집가능). **allowedTools = 에이전트 정의 D가 선언한 도구 체크박스로만**(자유입력 없음 → U⊆D 구조 보장·A100)·헬퍼 "이 에이전트가 선언한 도구만 선택 가능"·조용한 드롭 없음(D 밖은 400). 제출 → Runs 딥링크. **대화형 아님**(최초 1회 제출).

---

## F3 — Settings projectRoot 편집 (보안 자기완결 · 위협모델 강화)

### F3.1 현 상태·델타
- 현재: `projectRoot = resolve(env.HARNESS_PROJECT_ROOT ?? resolve(__dirname,"..","..",".."))`(index.ts, 모듈 상수 I7). Settings = 조회 전용(`mutationEnabled:false`).
- 델타: **화면 편집 → 다층 검증 → `<state_home>/config.json` 원자쓰기 → 재시작 후 반영**(라이브 재바인딩 비목표 — F3.5). 프로젝트 파일 미변경(config만 = I8 유지).

### F3.2 신뢰경계 — **단일 확정(감사 R1-#4/#5 정정)**
임의 projectRoot = 서버가 그 하위를 인벤토리 read·artifact/docs 서빙·CLI cwd로 삼음 → 임의 디렉토리 노출·실행 컨텍스트 탈취.

**신뢰경계 = 단일 `projectsHome` 조상 containment(확정).** 구 초안의 "(a)allowedRoots vs (b)projectsHome 양립안"과 "D5 마커만으로 /etc 차단" 주장은 **폐기**한다:
- **마커는 신뢰경계가 아니다(핵심 정정).** `.claude/`·`CLAUDE.md`·`AGENTS.md`는 **공격자가 쓰기 가능한 디렉토리(`/tmp`·`~/writable`)에 생성 가능** → 마커 단독으로는 경로탈출을 막지 못한다. 마커는 **경계 안(projectsHome 하위)에서 비-하네스 디렉토리를 거르는 심층방어**일 뿐.
- **경계의 신뢰 소스 = 프로비저닝된 `projectsHome`**(불변·API로 변경 불가). 소스 = `HARNESS_PROJECTS_HOME` env **또는** 설치/최초실행 시 `<state_home>/config.json`에 기록된 `projectsHome`(신뢰). **projectRoot 편집 API는 `projectRoot`만 바꾸며 `projectsHome` 경계 자체는 못 바꾼다**(경계 확장 불가 = unbuildable 문제 해소: 사용자는 projectsHome **하위**의 하네스 프로젝트들 사이에서 전환 가능).
- **projectsHome 미설정 시:** projectRoot 편집 **비활성(fail-closed)** — env `HARNESS_PROJECT_ROOT`로 재시작 전환은 여전히 가능(폴백). UI는 "경계 미프로비저닝 — 편집 비활성" 안내.

**다층 fail-closed(전부 통과해야 수용 · AND):**
| 방어층 | 규칙 | 근거 |
|--------|------|------|
| D1 입력 정규화 | `~`(tilde) 확장 거부·상대경로 거부(절대경로만)·`..` 세그먼트 거부·Windows UNC(`\\host\`)·드라이브 상대(`C:foo`) 거부·**유니코드 NFC 정규화**(homoglyph·미정규화 우회 차단) | 신규(강화) |
| D2 canonical containment(R3-#4 정정) | 입력·`projectsHome`를 **각각 `realpath`로 완전 해소**하고 `isWithinRoot(realpath(projectsHome), realpath(input))`만으로 판정. **절대 상위부의 realpath 변경(`/var`→`/private/var`·`/tmp`)은 정상 — 거부하지 않음**(구 "realpath≠정규화경로 거부" 삭제 = 정상환경 오거부 원인). 리다이렉션 탐지는 **D3(projectsHome 하위 상대 세그먼트)로 일임** | I6 통일 원칙 |
| D3 심링크/리다이렉션 거부 — **projectsHome 하위 상대 세그먼트에만(R2-#6 정정)** | **절대 상위부(projectsHome까지)는 realpath containment(D2)로 보장하고 lstat 무조건거부 안 함**(macOS/Linux `/var`→`/private/var`·`/tmp`·홈이 심링크라 정상환경 오거부 방지). **projectsHome **하위** 상대 세그먼트만** `lstat` 심링크 거부. **Windows: 하위 세그먼트의 reparse point(junction·mount·symlink)를 `FILE_ATTRIBUTE_REPARSE_POINT`로 감지·거부**(lstat만으로 junction 미탐 정정). lstat 단독으로 no-redirection 보장 안 함 → D2 realpath containment와 병용 | I6 통일 원칙 |
| D4 시스템/민감 경로 차단(denylist) | `/`·`/etc`·`/usr`·`/bin`·`/sbin`·`/sys`·`/proc`·`/dev`·`$HOME` 직속 dotdir(`~/.ssh`·`~/.aws`)·`%SystemRoot%`·`%ProgramFiles%`·`C:\Windows` 거부 | 신규 |
| D5 하네스 마커(심층방어·경계 아님) | projectsHome **하위**에서 대상에 `.claude/`·`CLAUDE.md`·`AGENTS.md` 존재 요구 → **비-하네스 디렉토리 필터**. **단독으로 경로탈출 차단 불가**(위조 가능) — D2 containment가 실경계 | 신규(정정된 위치) |
| D6 = **D2 projectsHome containment**(확정 단일 경계) | 위 D2와 동일 — 경계는 projectsHome 하위 containment **하나**. allowedRoots 다중 화이트리스트 폐기 | 확정 |
| D7 TOCTOU 스왑 재확인 | 검증 시점 realpath와 **지속 직전 realpath 재확인**(스왑 감지 시 거부)·**부팅 시 env·config·API 세 소스 root 전부 D1-D7 재검증**(아래 F3.3) | 신규(강화) |
| D8 fail-closed | 위 중 하나라도 실패 = 400, 지속 안 함(현 root 유지) | 에이전트 원칙 |

### F3.3 API
```text
POST /api/settings/project-root        # body: { path: string, dryRun?: boolean }  (Origin·token 게이트 필수 — mutating)
```
- **전제:** `projectsHome` 프로비저닝됨(F3.2). 미프로비저닝이면 `409 { error:"boundary-not-provisioned" }`(편집 비활성).
- **순서 정정(경고→확인→쓰기·UX-R4-#2):** 구 흐름은 검증 통과 시 **즉시 config를 쓰고** `activeRunsWarning`을 **사후 반환** → 사용자가 다이얼로그에서 취소해도 디스크는 이미 변경됨(비가역 오동작). 정정 = **`dryRun` 플래그**:
  - **`dryRun:true`(프리뷰):** D1-D8 검증만 수행·**디스크 미변경** → `{ ok, effectiveRoot, activeRunsWarning, requiresRestart:true }` 반환. UI가 이 프리뷰로 활성 run 경고·A99 취소/승인 표시.
  - **`dryRun:false`(실제 쓰기):** 사용자 확인 후 재호출 → D1-D8 재검증 통과 시 **config RMW(F3.7): `projectRoot`만 갱신·`definitionEditEnabled` 등 타 필드 보존**·원자쓰기.
- 흐름(순서 고정·양 모드 공통 검증): Zod(`path`·`dryRun`)→ D1 정규화 → D2 canonical containment(realpath) → D6=D2 projectsHome containment → **D3 projectsHome 하위 상대 세그먼트 심링크/reparse 스캔** → D4 denylist → D5 마커(심층방어) → D7 스왑 재확인 → (`dryRun:false`일 때만) config RMW 쓰기.
- 응답: `{ accepted:true, requiresRestart:true, effectiveRoot, appliedAt, activeRunsWarning:number }`(쓰기) / dryRun `{ ok:true, effectiveRoot, activeRunsWarning, requiresRestart:true, written:false }`. 실패: `400 { error:"bad-input"|"symlink"|"reparse-point"|"denied-system-path"|"no-harness-marker"|"outside-projects-home"|"escape" }` / `409 "boundary-not-provisioned"`.
- **precedence·부팅 검증(index.ts) — env도 D1-D7 적용·필드별 무효화(R1-#5·R3-#3):** 소스 우선순위 `HARNESS_PROJECT_ROOT`(env) > config.`projectRoot` > 하드코딩 기본. **어느 소스가 이기든 그 root에 D1-D7 재검증**(env 예외 없음). **projectRoot가 unsafe면 그 `projectRoot` 값만 무효화하고 다음 소스로 폴백**(env→config→기본) — **config의 다른 필드(`definitionEditEnabled`)는 폐기하지 않고 보존**(구 "소스 전체 폐기"가 F7 게이트를 초기화하던 결함 정정·R3-#3b). 하드코딩 기본(=harness-ui 부모)은 항상 안전. **검증 없이 신뢰하는 소스 없음.**

### F3.4 재바인딩 영향 (왜 재시작인가)
projectRoot는 `registerApi(app, projectRoot)` 주입 모듈 상수(I7). 활성 run들은 `_workspace/runs/{id}/` 절대경로를 owner 레지스트리에 기록 → root 변경 시 관찰 고아·인벤토리/drift/metrics 어댑터 캐시 불일치. **판정: 재시작 반영**(라이브 재바인딩=비가역·경쟁, 비목표). 응답 `requiresRestart:true`·활성 run 경고.
- **활성 run 고아 통제 UX(A99·UX-R2-#7·UX-R4-#2):** 재시작 시 활성 run은 **헤드리스로 계속 실행**(API 토큰 소진·UI 통제 상실) → 경고만으로 부족. **순서 = dryRun 프리뷰(경고·activeRunsWarning) → 사용자 확인 → 실제 쓰기**(F3.3·디스크는 확인 후에만 변경). 확인 다이얼로그 **명시 선택**: (a) **"활성 run 취소 후 재시작"**(cancel A18 경로로 종료 후 dryRun:false 쓰기) 또는 (b) **"헤드리스 계속 승인"**(통제 상실·토큰 소진 명시 인지). 취소 시 **config 무변경**(dryRun만 호출됨). `activeRunsWarning>0`일 때만 노출.

### F3.5 비목표·롤백
- **비목표:** 무재시작 라이브 재바인딩(v0.7). 파일수정 API 활성화(별개 축·v0.6도 `mutationEnabled:false`).
- **롤백(가역):** config.json 삭제 or 이전 경로 재입력. **안전한** env override(`HARNESS_PROJECT_ROOT`, D1-D7 통과분)는 config를 이김 → 긴급 복구 경로(unsafe env는 부팅 검증에서 폴백되므로 복구엔 안전 경로 사용).

### F3.6 UI 배선
- Settings 조회 테이블에 편집 폼: 현 유효값 표시 + 경로 입력 + "검증". **순서(UX-R4-#2): "검증"→`dryRun:true` 프리뷰(디스크 미변경·검증결과+activeRunsWarning)→확인 다이얼로그(A99 취소/승인)→"저장"=`dryRun:false` 실제 쓰기.** 취소 시 config 무변경. 실패 = 인라인 에러(error 코드→한국어). 저장 성공 = "저장됨·재시작 후 반영". mutationEnabled는 조회 전용 배지 유지.
- **재시작 구간 UX(A94·UX-R1-#2):** 수동 재시작 중 서버 통신 두절 → **앱 전역 "서버 연결 끊김 / 재연결 대기(Reconnecting…)" 오버레이**(`/healthz` 백오프 폴링)가 통신에러를 흡수(개별 "Failed to fetch" 폭주·화면 깨짐 방지)·서버 정상화 시 자동 부드러운 복귀. **projectRoot 재시작뿐 아니라 모든 연결끊김에 전역 적용.**

### F3.7 공유 config 스키마·원자 RMW (F3+F7+F8+**F9** 네 writer 공유 — R3-#3·통합감사-#1·R7)
F3(`projectRoot`)·F7(`definitionEditEnabled`)·**F8(`evals`)** + 불변 `projectsHome`가 **단일 `<state_home>/config.json`을 공유**한다. 구 `loadConfig`가 3필드만 하드코딩 추출·반환해 **다른 writer가 `evals`·`projectsHome`를 clobber/소거**하던 결함(통합감사-#1) 정정 — **canonical 버전드 전 필드 스키마 + root `.passthrough()` + per-leaf 보존**:
```ts
// 통합감사-#1·R7: 전 필드(projectsHome·projectRoot·definitionEditEnabled·evals·docsSources·docsMenuEnabled)를 canonical 스키마로·root passthrough로 미지/미래 필드 보존. F9 필드도 per-leaf 독립 복구(손상 시 형제 필드 무영향).
// 전체객체 strict 금지(R4-#4)·per-leaf 독립 복구·타입 일관(schemaVersion 문자열 "1").
function loadConfig(raw: unknown): Config_v06 {
  const env = (typeof raw === "object" && raw) ? raw as Record<string, unknown> : {};
  if (env.schemaVersion !== undefined && env.schemaVersion !== "1") throw new Error("unsupported-config-schema"); // 미지원 버전 거부
  const pick = <T>(v: unknown, schema: z.ZodType<T>, fallback: T) => { const r = schema.safeParse(v); return r.success ? r.data : fallback; };
  return {
    schemaVersion: "1",                                                    // 문자열 "1" 일관(숫자 방출 금지)
    projectsHome: pick(env.projectsHome, z.string(), null),                // 불변 경계(프로비저닝·F3.2)·writer가 건드리지 않음
    projectRoot: pick(env.projectRoot, z.string(), null),                  // 무효/부재→null(부팅 D1-D7 재검증)
    definitionEditEnabled: pick(env.definitionEditEnabled, z.boolean(), false), // 부재/손상→false(fail-closed)
    evals: loadEvals(env.evals),                                           // F8 서브객체도 재귀 per-leaf(통째 파싱 금지·R2-#1)
    ...passthroughUnknown(env),                                            // 미지/미래 필드 보존(root .passthrough())
  };
}
// R2-#1: evals를 통째 safeParse하면 한 잎(threshold) 손상이 evals 서브트리 전체를 기본값 리셋·형제(weight 등) clobber → F8.4 per-leaf 위반.
// evals 내부도 재귀 leaf-wise: 각 잎 개별 safeParse·유효 형제 보존·effective=max(유효,floor).
function loadEvals(raw: unknown): EvalsConfig {
  const e = (typeof raw === "object" && raw) ? raw as Record<string, unknown> : {};
  const th = (typeof e.thresholds === "object" && e.thresholds) ? e.thresholds as Record<string, unknown> : {};
  const leaf = <T>(v: unknown, s: z.ZodType<T>, fb: T) => { const r = s.safeParse(v); return r.success ? r.data : fb; };
  return {
    adoptionStage: leaf(e.adoptionStage, z.union([z.literal(1),z.literal(2),z.literal(3)]), 1),
    metrics: /* 각 metric 엔트리 per-leaf(손상 엔트리만 드롭·형제 보존) */ pickMetricsLeafwise(e.metrics),
    thresholds: {                                                          // 각 잎 개별 복구 — 형제 손상 무영향
      minAdjudicatedClaims: Math.max(leaf(th.minAdjudicatedClaims, z.number().int(), 30), 30), // effective=max(값,floor)
      rollingN:            Math.max(leaf(th.rollingN, z.number().int(), 10), 10),
      declineStreak:       Math.max(leaf(th.declineStreak, z.number().int(), 3), 3),
      thetaByRisk:         leaf(th.thetaByRisk, z.record(z.number().min(0).max(1)), {}),
    },
    normalization: leaf(e.normalization, z.object({}).passthrough(), {}),
  };
}
```
- **원자 read-modify-validate-write(F3·F7·F8·**F9** 공통·전 필드 보존):** 모든 config 쓰기(**네 writer**·F9 `docsSources`/`docsMenuEnabled` 포함)는 **read → `loadConfig`(전 필드 복구) → 해당 필드만 수정 → 전 필드 재직렬화 → `writeJsonAtomic`**. 한 writer가 타 필드(`evals`·`projectsHome`·`docsSources` 등)를 clobber/소거하지 않음(통합감사-#1)·미지필드 보존.
- **동시쓰기 직렬화:** 네 writer 공통 **in-process 뮤텍스**(ingest `locks` 패턴)로 직렬화 → lost-update 차단(R3-#3c).
- **부팅 필드별 검증·복구:** `loadConfig` 후 `projectRoot`만 추가 D1-D7 재검증(실패 시 그 값만 null·폴백)·`definitionEditEnabled` boolean·`evals` per-leaf(F8.4). **한 필드 손상이 타 필드 소거 안 함**(R4-#4)·**미지원 `schemaVersion` 거부**·**타입 일관(문자열 "1")**. 전체객체 strict Zod 금지.
- **택일 근거:** 두 파일 분리 대신 **단일 버전드 봉투 + 필드별 복구 + 원자 RMW + 뮤텍스**(상태 단일 출처·I6 분리·마이그레이션 훅).

---

## F7 — 에이전트/스킬 정의 편집기 (첫 mutating 기능 · **최대 공격면 · 경화가 핵심**)

### F7.1 문제·접근·I8 예외
사용자 요청: "스킬과 에이전트를 직접 수정." 이는 v0.5/v0.6 **읽기전용 불변식 I8을 깨는 첫 쓰기 기능** = 로컬 dev-tool 최대 공격면. **I8 정정:** "파일 무변경"은 **F7 스코프 예외**로 완화 — 읽기전용 원칙은 나머지 전부 유지하되, **정의 편집만** (화이트리스트 위치 + 무결성 검증 + 원자쓰기 + 낙관적 동시성 + 스코프 게이트) 하에서 허용. F5(docs)·F4·F6는 여전히 읽기전용.

- **편집 대상(한정·넘지 않음):** `.claude/agents/*.md` + `.claude/skills/**/SKILL.md` **만**. docs/**·임의 시스템 파일 편집 **불가**(docs는 F5 읽기전용 유지).
- **Codex/agy 듀얼(`.codex/agents/*.toml`·`.agents/skills/**`):** **읽기(뷰)는 F10에서 v0.6 지원**(멀티런타임 자동 수집·§F10 A129), **편집은 여전히 v0.7**(대칭성 < 범위 규율·한쪽만 편집 시 drift·TOML 정규화/런타임별 differential 게이트 미비 → `409 <runtime>-edit-v0.7`). **저장 시 "Codex 피어가 stale일 수 있음 → Drift" 경고**(A79). TOML 편집·`.agents/skills` 대칭 쓰기는 별도 작업.
- **동작(MVP):** 조회→편집(textarea/폼)→diff→검증→저장. **기존 정의 수정만.** 신규 생성·삭제 = v0.7 비목표(F7.7).

### F7.2 API
```text
GET  /api/agents/:name/definition      # 편집용 원문 + baseHash + mtime + sourcePath(표시용)
PUT  /api/agents/:name/definition      # body: { content: string, baseHash: string }  (mutating — 게이트)
POST /api/agents/:name/definition/rollback   # 직전본 복원
GET  /api/skills/:name/definition
PUT  /api/skills/:name/definition
POST /api/skills/:name/definition/rollback
```
- `:name` = **논리적 이름**(frontmatter `name`). **name ≠ 파일명·유일성 미보장**(harness.ts: name=fm.name ?? filename·스킬은 `.claude`/`.agents` 교차 dedupe) → **서버가 `readAgents`/`readSkills`로 이름→정규 `sourcePath` 재조회**(클라 경로 주장 금지). 미존재 404.
- **이름 모호성 차단(R2-#3):** 같은 `name`을 가진 정의가 **2개 이상이면 `409 ambiguous-definition`**(비결정 해소 금지). 스킬 정규 sourcePath = **`.claude/skills/{dir}/SKILL.md`**(Codex `.agents` 전용 스킬은 v0.6 편집 대상 아님 → `409 codex-only-v0.7`).
- **경로 정체성 바인딩:** `baseHash`는 **정규 sourcePath에 바인딩**. `GET …/definition` 응답: `{ name, sourcePath, pathId(=sha256(정규 sourcePath)), content, baseHash(sha256 내용), mtimeMs, editable }`. **PUT은 `pathId` 재전송** → 서버가 name 재해소한 sourcePath의 pathId와 **일치할 때만** 진행(불일치=정의가 그새 이동/모호 → `409`). GET과 PUT이 다른 정의를 타격하는 것 차단.
- **PUT payload + F8 제안 결속(통합감사-#4·F8.3↔F7 강제):** `PUT …/definition` body = `{ content, baseHash, pathId, evalProposal?: { nonce, envelope } }`. **`evalProposal` 부재 = 일반 편집**(기존 DW1-DW7 경로). **`evalProposal` 존재 = F8 제안 적용 경로 → DW11(아래) 강제** — envelope·nonce·config-hash·게이트 재평가·payload 일치 검증이 **F7 저장 시 실집행**(F8.3 요구가 F7 API에 실제 결속). → F8 암호 제안이 일반 편집으로 우회 저장되던 갭 차단.

### F7.3 위협모델 (write 전용 층 DW — 읽기보다 위험)
| 방어층 | 규칙 | 근거·재사용 |
|--------|------|-------------|
| DW1 스코프 게이트 | **F7 전용 노브 `definitionEditEnabled`(기본 off·fail-closed)**만 on일 때 PUT/rollback 허용. off → `403 edit-disabled`. **기존 `mutationEnabled:false`(파일수정 전면 API)와 별개 축** — F7이 전면 개방 아님. workspace-write run과도 무관 | 신규(스코프 격리) |
| DW2 이름→경로 서버 해소 + 정체성 바인딩(R2-#3) | `:name`으로 디스크 재조회해 **정규 `sourcePath`** 도출(클라 경로/파일명 페이로드 없음). **중복 name → `409 ambiguous`**·스킬 정규경로=`.claude`(`.agents` 전용→`409 codex-only-v0.7`)·`baseHash`는 `pathId=sha256(sourcePath)`에 바인딩·PUT은 `pathId` 재전송 일치 필수(GET↔PUT 정의 불일치 차단) | harness.ts readAgents/readSkills |
| DW3 쓰기 경로탈출 방어(읽기보다 강) | 해소된 `sourcePath`를 **projectRoot realpath 앵커(선계산)** 기준으로: **projectRoot 하위 상대 세그먼트(`.claude/…`)만 lstat 심링크/reparse 무조건 거부**(I6 통일 — 절대 상위부는 containment, 정상환경 오거부 없음)·부모 디렉토리 realpath 확인·leaf 위치+확장자 화이트리스트(agents=`.claude/agents/*.md`·skills=`.claude/skills/*/SKILL.md`)·`.claude` 밖 거부·크기상한 `MAX_DEF_BYTES`(예: 256KB) 초과 거부 | F5 DV·runs.ts safeRunDir 재사용 |
| DW4 원자 쓰기 | **`writeAtomic`(atomic.ts) 재사용**: 동일 디렉토리 temp(`wx`=O_EXCL·0600)→fsync(file)→**rename**→fsync(dir). 부분쓰기·손상 0. rename은 목적지 심링크를 **따라가지 않고 엔트리 교체**(write-through-symlink 불가)·부모 dir는 DW3 realpath 앵커로 스왑 방어 | atomic.ts writeAtomic |
| DW5 무결성 + 정규화(파서 differential 정정 R2-#2·R3-#2·**R4-#2 과교정 철회**) | 저장 전: (a) **frontmatter 추출 = 파일 첫 `---`~다음 `---` 쌍으로 고정**(런타임 동일). 이 고정 추출이면 **본문(닫는 `---` 이후) `---`는 무해**(런타임도 첫 쌍에서 멈춤) → **구 "본문 `^---` blanket 거부"는 정상 markdown(수평선·YAML 코드펜스)까지 막아 철회**(R4-#2). (b) **strict YAML 파싱**: 앵커/alias·멀티도큐먼트·중복 키·`!!tag` 거부. (c) Zod(**완전 frontmatter 스키마**: name·description 필수 + role·tools·skills·triggers·references 등 알려진 옵션 + `.passthrough()` 미지필드 보존·R4-#3)·**name 불변**=`:name`. (d) **통과분을 canonical normalized YAML로 재직렬화 기록(passthrough 필드 포함·유실 0)**. 실패=`400`(필수 누락/YAML 위반/name 변경). **추출·등가는 A75 differential 릴리스 게이트로 증명(가정 아님).** | strict YAML + 완전스키마 + 고정추출 + 런타임 differential 게이트 |
| DW6 낙관적 동시성 | `GET`이 준 `baseHash`(sha256)를 `PUT`이 재전송 → 서버가 **현재 디스크 내용 해시 재계산** → 불일치 시 `409 stale-write`(lost-update 차단). mtime은 보조 | 신규 |
| DW7 되돌리기·diff (백업 경로탈출 정정 R2-#1) | **백업 파일명 = 서버생성 opaque = `sha256(정규 sourcePath)` hex**(논리 `{name}` 보간 **금지** — traversal 차단). 위치 `<state_home>/edit-backups/{hash}.bak`(직전 1개·I6 분리). 백업 쓰기도 **디렉토리 per-세그먼트 심링크/reparse 거부·기존 `.bak` 심링크면 거부·`O_EXCL` temp→`writeAtomic` 원자 교체**(백업 심링크 write-through 불가). diff는 클라 로드본↔편집본 미리보기. 저장 응답에 `prevHash` 반환 | atomic.ts·§9-STATE |
| DW7b 롤백 안전 계약(R2-#4) | `POST …/rollback` body `{expectedCurrentHash, backupHash}` 요구 → 서버가 **현재 디스크 해시 == expectedCurrentHash** 검증(불일치 `409 stale-rollback` — 중간편집 덮어쓰기 차단) + **백업 파일 해시 == backupHash** 검증(손상/변조 백업 거부) + **복원 대상 경로 DW3 재실행**(심링크/경계) + **백업 내용 DW5 무결성 재검증**(손상본 복원 차단) → 통과 시 `writeAtomic` 원자 복원 | 신규 |
| DW8 CSRF/게이트 | PUT/POST(mutating) = 기존 `security.ts` onRequest 게이트 자동 적용(Host allowlist·**Origin 검증**·session-token). 쿼리토큰 금지(I5) | security.ts 기존 |
| DW9 편집/실행 분리·주입 인지 | 저장은 **정의 파일 기록만** — 편집기가 실행 트리거 **안 함**. 실행은 별도(F2/New Run) 경유. 편집된 tools가 F2의 상한 `D`를 올릴 수 있으나, **실행은 사용자의 명시적 2단계 행동**(편집 저장 → 이후 실행)이지 무음 상향 아님. 관측/편집/실행 3분리 | F2 신뢰경계 정합 |
| DW11 편집/제안적용 분리·제안 강제(통합감사-#4·R2-#3·F8.3 결속) | **개념 분리(R2-#3):** **일반 편집(F7)은 상시 허용**(사용자가 diff 보고 수동 저장 — 의도된 기능·F8 무관·우회 아님)·**"제안 적용"은 별도 라벨 capability**(envelope+nonce 필수). F8은 편집을 제한하지 않고 **"이것은 승인된 제안이다"라는 주장에만 envelope 강제** — 주장 없는 일반편집은 그냥 편집(단계·min-claims·provenance 게이트는 **제안 주장 경로에만** 적용). PUT body에 **`evalProposal:{nonce,envelope}` 있으면** F8 crypto를 **F7이 실집행**: (1) **nonce = `POST /api/evals/proposals/:id/prepare`(GET 아님)로 발급된 durable nonce·`issued→applying→consumed` 원자 상태머신·멱등 재시도(크래시 후 유실 0·중복적용 0·R4-#2)** (2) **envelope HMAC + `evals-config 해시` 현재값 일치**(운영 플래그 제외·R2-#2) (3) **A106 게이트 현재 rollup 재평가**(fail-closed) (4) **주입 `content` == envelope canonical payload 정확 일치**(R2-#4). 실패 → 거부(`409`/`400`). **부재 = 일반 편집**(DW1-DW7). → **제안 적용 경로는 envelope 없이 불가**(게이트 우회 불가)·일반편집은 F8과 독립 | F8.3·hmac.ts·atomic.ts |
| DW10 fail-closed | 위 중 하나라도 실패 = 400/403/409, 디스크 무변경(현재본 유지) | 에이전트 원칙 |

### F7.4 무결성 검증 세부 (파서 differential 차단 — 파일이 곧 실행 정의)
```ts
// 저장 전 게이트: strict YAML 파싱(앵커/alias·멀티도큐먼트·중복키·`!!tag` 거부) → Zod(완전 스키마·passthrough) → canonical 재직렬화.
// 필수만 strict, 알려진 옵션 타입, 미지필드는 passthrough로 보존(라운드트립 유실 0 · R4-#3).
const AgentDef = z.object({
  name: z.string().min(1).max(120), description: z.string().min(1).max(2000),
  role: z.string().optional(), tools: z.array(z.string()).optional(), skills: z.array(z.string()).optional(),
  model: z.string().optional(),
}).passthrough();
const SkillDef = z.object({
  name: z.string().min(1).max(120), description: z.string().min(1).max(2000),
  triggers: z.string().optional(), references: z.array(z.string()).optional(),
}).passthrough();
// + 본문(frontmatter 이후) 비어있지 않음. + name === 요청 :name(리네임 금지).
```
- **완전 스키마·미지필드 보존(R4-#3):** 구 `.strict()`(name·description만)는 실 정의의 `role`·`tools`·`skills`·`triggers`·`references`를 **전부 저장 거부**하던 결함 → **필수(name·description)만 strict 검증·알려진 옵션 타입·`.passthrough()`로 미지/미래 필드 보존**. canonical 재직렬화는 **passthrough 포함 전체 객체**에 적용(라운드트립 유실 0). 거부는 **필수 누락**뿐.
- **정규화(R2-#2):** strict YAML로 폴리글롯 벡터(앵커·멀티도큐먼트·중복 키·`!!tag`) 거부 + canonical normalized YAML 재직렬화 기록.
- **고정 추출·본문 `---` 무해(R4-#2 과교정 철회):** frontmatter 추출 = **첫 `---`~다음 `---` 쌍 고정**(런타임 동일). 이 고정 추출이면 닫는 `---` 이후 본문의 `---`(수평선·YAML 코드펜스)는 **무해** → 구 "본문 `^---` 저장 거부" **철회**(정상 markdown 오차단). 경계 등가는 아래 게이트가 보증.
- **등가 = 릴리스 게이트(가정 아님·R3-#2c·명세 R4-#5):** canonical 재직렬화만으론 UI≡CLI 등가를 증명 못 함(스칼라 타이핑·추출 차) → **F7.8 differential 게이트**(직렬화본을 실 런타임 리더로 파싱·비교)로 증명. 불일치 시 정규화 스키마 축소.

### F7.5 UI 배선 (Agents·Skills 화면)
- 상세에 **"정의 편집"** 버튼(`definitionEditEnabled` off면 비활성 + 툴팁 "편집 비활성 — Settings에서 켜기"). 클릭 → `GET …/definition` → textarea(원문·`MAX_DEF_BYTES`)/구조 폼.
- 저장 전 **diff 미리보기**(로드본↔편집본) → "저장" → `PUT`(content·baseHash). 실패 인라인: `400`(무결성)·`403`(비활성)·**`409`(동시성 stale) = 편집분 유실 방지(A93·UX-R1-#1): 자동 재로드 금지 → 사용자 편집 textarea를 보존한 채 "디스크가 변경됨" 배너 + 디스크본↔편집본 병합 뷰(최소 나란히 비교) or 편집분 로컬 백업/클립보드 복사 후 수동 병합**.
- 저장 성공 = "저장됨"·`prevHash`·**"실행하려면 New Run/Ask Agent로"**(편집≠실행)·**Codex 듀얼 drift 경고**(A79). "되돌리기" = `POST …/rollback`.

### F7.6 스코프 게이트 노브 명세 (R2-#5 — 구현·테스트 가능하게 확정)
- **상태 저장소:** F3.7 공유 `<state_home>/config.json`의 `definitionEditEnabled:boolean`(단일 버전드 스키마·I6 분리·프로젝트 파일 아님).
- **토글 API:** `POST /api/settings/definition-edit` body `{ enabled: boolean }`(mutating → Host/Origin/token I5). Zod `z.boolean()` strict — 그 외 400. **쓰기 = F3.7 원자 RMW(뮤텍스·`projectRoot` 등 타 필드 보존)**.
- **매 요청 판독(fail-closed):** PUT/rollback 진입 시 config에서 `definitionEditEnabled`를 **strict boolean 파싱**. **부재·손상(JSON 파싱실패)·비-boolean·판독불가 = `false`**(fail-closed) → `403 edit-disabled`.
- **부팅 동작(필드 독립·R3-#3b):** 기동 시 config 로드·strict 검증. **`projectRoot` 부팅검증 실패가 `definitionEditEnabled`를 초기화하지 않음**(필드별 무효화·F3.3). 손상 config → `definitionEditEnabled=false`. 명시 저장된 true만 유지(재시작 지속).
- **`mutationEnabled:false`는 불변**(파일수정 전면 API 비활성 — F7은 독립 스코프). off 상태 = 편집기 뷰어만(GET·읽기).

### F7.7 비목표·비가역성·롤백
- **비목표(v0.7):** 신규 정의 생성·삭제·리네임·Codex 듀얼(`.codex/*.toml`·`.agents/skills`) 편집·docs/** 편집(영구 비목표 — F5 읽기전용).
- **비가역성:** 정의 파일 덮어쓰기 = **비가역(파일 변경)** → DW6 동시성·DW7 `.bak` 롤백·diff 확인으로 완화. `.bak`은 직전 1개(다단계 히스토리 아님 — v0.7 git 연계 검토).

### F7.8 differential 등가 게이트 명세 (실행가능·CI — R4-#5)
A75가 "실 런타임 리더로 비교"를 실행·CI 가능하게 다음을 고정:
- **리더 엔트리·버전 고정:** claude = `claude` CLI의 정의 로드 경로(에이전트/스킬 frontmatter 파싱)를 **핀 고정 버전**으로 실행(`--version` 기록). codex = `codex`의 대응 파싱 경로(v0.7 대상이나 게이트 픽스처는 claude 우선). 리더 엔트리포인트·버전은 **테스트 매트릭스에 명시**(리더 부재 CI는 skip 아닌 **fail** — 게이트 필수).
- **픽스처 코퍼스:** `test/fixtures/definitions/`에 (i) 정상(옵션필드 다수·본문 `---` 포함·유니코드), (ii) 폴리글롯/멀티도큐/앵커/중복키(거부 기대), (iii) 경계 케이스(본문 `---`·코드펜스·CRLF). 각 케이스에 **기대 판정(accept/reject)** 라벨.
- **비교 대상·스키마:** 편집기 **canonical 재직렬화 출력**을 `writeAtomic` 기록본과 동일하게 만든 뒤, **(A) 편집기 파서 추출/파싱 결과**와 **(B) 실 런타임 리더 파싱 결과**를 **정규화 JSON**(키 정렬·스칼라 타입 고정·frontmatter 필드만)으로 각각 직렬화해 비교.
- **zero-divergence 판정:** A ≡ B(정규화 JSON 완전일치)가 **accept 코퍼스 전건 성립**·reject 코퍼스는 편집기가 400. **1건이라도 divergence면 게이트 fail**(정규화 스키마 축소 후 재실행).
- **CI 명령:** `npm run test:def-differential`(M12 파이프라인 필수 스텝·리더 버전 핀·3-OS 매트릭스). A75 DoD에 포함.

---

## F8 — 평가 대시보드 + 자기개선 제안 + 평가지표 관리 (전용 화면 "Eval" · self-eval 시스템을 UI로 연결)

> 사용자 요청: "평가 결과 확인 + 평가로 지속 개선 + 평가지표 관리 전용 페이지." 하네스 self-eval(`skills/myharness/references/loop-self-eval.md`·`self-improvement-loop.md`·`scripts/build-scorecard.sh`·`docs/self-evaluation-system.md`)을 잇는다. **9번째 화면 "Eval".**
> **교리 준수(비협상):** ① `alignment_score` = "리뷰 보고↔오케스트레이터 판정 **정합도**"이지 **품질·리뷰어 정밀도 아님**(오표시 금지). ② 자기채점 = **약증거**(self-check)·통제 벤치·독립 리뷰 대체 못 함. ③ **자동 적용 절대 금지** — 제안+사람 승인만(Goodhart·플래핑 방지). ④ 단계 3·4(자동 환류)는 **실험적**·데이터 충분+holdout 후에만.

### F8.1 데이터 소스 · ingest 소유권 (읽기(GET)와 쓰기(ingest) 분리)
- **ingest 소유권·트리거(통합감사 R3·mutating 분리·택(a) 채택):** 서명 rollup/receipt/키 생성은 **쓰기**다 — GET이 lazy ingest하면 "읽기전용 위반·요청유발 상태변경(GET 부작용)". 정정: **ingest = 서버측 명시적 mutating 작업**으로 분리. **택(a) 서버 부팅/주기 백그라운드 잡**(요청 무관·supervisor 저자 모델 I4 정합): 새 서명 scorecard 스캔 → 검증(서버키 HMAC·수학 교차검증) → **원자 commit 순서(scorecard durable → receipt append → rollup 엔트리 append → head 재서명)**·**바운드(1회 스캔 상한)·dedup(runId·seq)·검증 통과분만**. **모든 `GET /api/evals*`는 side-effect 0**(순수 조회·ingest 안 함). 수동 재-ingest/재구축(UX-R2 "원장 재구축·재검증")은 **인증 mutating 엔드포인트 `POST /api/evals/rebuild`(Origin+session-token 게이트·택(b) 패턴)** — 같은 서버-write 규율(자동 vs 수동 트리거 차이뿐). *(택(b) 단독=매번 수동 트리거 필요 → 자동 백그라운드가 로컬 관측 도구에 자연스러워 (a) 주채택·(b) 재구축 전용.)*

### F8.1b 데이터 소스 (읽기전용 뷰 · 기존 산출물 소비)
- **경로(정본):** `_workspace/evals/{loop}/{stage_id}/{run_id}/scorecard.json` + `_workspace/evals/{loop}/summary.jsonl`(build-scorecard.sh가 flock append). **F8은 소비만** — 스크립트/supervisor가 저자(I4 정합)·API 쓰기 없음(Part C config 제외).
- **scorecard 필드(계약):** `alignment_score`·`rounds_normalized`·`rejected_rate`·`deferred_rate`·`duplicate_rate`·`verdict_counts`·`termination_reason`·`regression_catch_rate`·`cost_per_run_tokens`·`overturned_rejection_rate`(null=미측정)·`missed_defect_rate`(null=미측정)·`quality_label`(LLM 해석)·`warnings`·`computed_by`. 사실 필드는 `build-scorecard.sh`가 `verdicts.json`에서 기계 계산(LLM 자기보고 아님).
- **재도출-후-서명(tautological oracle 정정·R2-#1·R3-#1·R7):** 문자열 `computed_by` 신뢰 폐기·**서명 주체 = UI 서버/supervisor**(키 서버 메모리·스크립트 미제공). 단 **서버가 `_workspace` scorecard를 그대로 서명하면 HMAC은 "서버가 이 바이트를 봤다"만 증명(무결성)이지 진위 아님** — schema·math 자기일관한 위조 scorecard가 서명받아 ingest되던 oracle. 정정: **서버가 집계값을 신뢰 근거에서 독립 재도출** — `_workspace`의 **미리계산된 `alignment_score`·`verdict_counts` 등을 신뢰하지 않고**, 서버가 **판정 원장(external-review-loop `verdicts.json`/adjudication ledger)에서 직접 재계산**(build-scorecard.sh 로직을 서버가 수행)·**loop/stage/run 정체성에 canonical 결속**·**workspace 발 precomputed 값은 재계산과 불일치 시 거부(격리)**. **HMAC 서명은 재도출한 canonical 값에만.** build-scorecard.sh가 에이전트 컨텍스트라 키를 못 보는 것은 유지(자가서명 금지).
  - **키 수명주기·키링(R3-#1·R4-#1·R3-UX 재구축 소스):** `<state_home>/keys/evals-hmac.key`(현재키) — 서버가 **`O_EXCL` 최초 생성**·0600·**생산자 재생성 금지**. **회전 = 신규 서명용**·**전 이력 키를 keyId로 키링 보존**(`<state_home>/keys/evals-keyring/`). **정상운영 검증은 chain+head로 구키 불요(회전 브릭 0·R4-#1)**·**키링은 재구축 재검증 전용**(정상운영 미사용) — 둘 정합(정상=head-HMAC+체인·재구축=키링+독립 receipt). registry.ts §4-A 준용.
  - **독립 ingest receipt(R3-UX — 재구축 검증 소스):** ingest 시 재도출 canonical 값 + `loop/stage/run` + `keyId`를 담은 **서명 receipt를 rollup과 독립으로 별도 append**(`<state_home>/evals-receipts/{loop}.jsonl`). rollup 손상 시 **재구축은 이 독립 receipt를 keyId로 재검증**해 통과분만 반영(현재 미검증 `_workspace` 재신뢰 금지).
- **체인 서명 rollup — 무결성/진위 분리(R2-#2·R3-#2·R4-#1·R4-final 문구 정합):** 게이트 지표는 **불변 append-only rollup**(`<state_home>/evals-rollup/{loop}.jsonl`·**서버만 append**·`_workspace` 밖)에서만. **과거 무결성 = 해시체인**(`prev-record 해시` + `monotonic seq`·tamper-evident·**키 불필요**로 검증) — 절단/reorder/변조는 체인 링크 재계산으로 탐지. **진위(HMAC 서명)는 chain head(+현재키 서명 엔트리)만** 요구 → **키 회전 후에도 과거 엔트리가 브릭되지 않음**(정상운영 검증은 구키 불요). 로드 시 **체인 링크 불일치·seq gap·head 서명 불일치 → fail-closed**.
  - **단일 키 규율(모순 문구 제거·R4-final):** **정상운영 검증 = 해시체인 + head-HMAC(현재키)** → 구키 불요·회전 브릭 0. **재구축 재검증 = `evals-receipts`의 keyId로 보존된 키링에서 해당 키 재검증**(위 독립 receipt). **키 보존 불변식: 회전 시 구키를 폐기하지 않고 키링에 보존**(재구축 전용·정상운영은 미사용)·**원자 회전(신규 키 생성 → head 재서명 → 구키 키링 이동)**. *(구 "전 이력 키링 영속 폐기" 문구 삭제 — R3 키링 보존과 정합.)*
  - **scorecard digest 결속(R3-#3·R6 — 게이트/표시 완전 분리):** ingest 시 각 rollup 엔트리에 **원본 scorecard digest + 검증된 파생값을 내장**(durable commit 후 append). **게이트는 오직 rollup 엔트리(체인/head 검증)만으로 판정** — gate-time에 `_workspace` 파일을 다시 읽거나 digest 비교하지 **않는다**(rollup은 ingest 시 서명검증 통과분·해시체인 보안이라 `_workspace` 사후 변조와 무관). **`_workspace` scorecard ↔ rollup digest 비교는 Part A 표시용(상세 "변조" 배지)일 뿐·게이트 영향 0**(R6: 활성 window `_workspace` 변조가 제안 브릭하던 모순 제거).
- **Part A 추세도 신뢰 소스에서만(R3-#3 — 이중소스 기만 차단):** Part A UI 추세도 **신뢰 `<state_home>/evals-rollup`에서 소싱**. 조작가능 `_workspace/evals/summary.jsonl`은 **표시 소스 아님**(표시 시 "미검증" 배지로 명확 구분) → 공격자가 `_workspace` 조작으로 **가짜 완벽점수 추세를 UI에 표시**해 사용자를 기만하지 못함(게이트 fail-closed여도 표시 기만 차단).
- **eval-unavailable:** 스크립트가 jq 부재 시 `{"eval_status":"eval-unavailable"}` 발행 → UI가 그 상태 표시(빈 아님·"측정 도구 부재").

### F8.2 Part A — 평가 결과 확인 (읽기전용)
- **API:** `GET /api/evals`(loop 목록·최근 요약)·`GET /api/evals/:loop`(**신뢰 rollup 추세·R3-#3**)·`GET /api/evals/:loop/:stage/:run`(scorecard 상세). **전 GET = side-effect 0(순수 조회·ingest/서명/append 안 함·통합감사 R3).** ingest(쓰기)는 F8.1 백그라운드 잡(자동)·`POST /api/evals/rebuild`(수동 재구축·mutating 게이트). "Part A 읽기전용"은 **GET 뷰에 한함**을 명확화.
- **추세 소스 = 신뢰 rollup(R3-#3):** `/:loop` 추세는 **`<state_home>/evals-rollup`(체인 검증·head 일치)에서만** 소싱. `_workspace/evals/summary.jsonl`은 표시 소스 아님(표시 시 "미검증" 배지 명확 구분) → `_workspace` 조작 가짜 추세 UI 기만 차단.
- **scorecard 검증 = ingest-time HMAC + 이후 rollup digest(회전 무브릭 — R1-#3·R2-#1·R2-#3·R3-#1·R5):** 무결성 판정을 **시점별로 분리**해 키 회전이 과거 window를 브릭하던 모순(F8.1 회전 무브릭과의 충돌) 제거.
  - **ingest 시점(최초 rollup 반영) = 서버 재도출-후-서명(R7):** `_workspace/evals` read(F5 경로방어) → strict 스키마 → **서버가 판정 원장(`verdicts.json`)에서 집계값을 직접 재계산**(scorecard의 precomputed `verdict_counts`·`alignment_score` 신뢰 안 함) → **precomputed ↔ 재계산 불일치 시 ingest 거부(격리)** → 재도출 canonical 값을 loop/stage/run 정체성에 결속·**현재키 HMAC 서명 후** rollup에 digest 결속 append(F8.1). 자기일관 위조 aggregate가 서명받던 oracle 차단. *(원장 자체는 자기판정=약증거 — F8.8 backstop.)*
  - **ingest 후(과거 scorecard) 무결성 = rollup digest 매칭(현재키 재검증 안 함):** 과거 scorecard 무결성은 **신뢰 `<state_home>/evals-rollup` 엔트리의 digest 일치**로 판정(rollup은 이미 해시체인 보안). **회전 후에도 과거 엔트리를 현재키로 재검증하지 않으므로 브릭 0.**
  - **`_workspace` scorecard 파일 = 표시용 상세일 뿐:** 파일이 변조/서명불일치라도 **rollup digest 일치하면 유효**(게이트는 rollup 기준). **digest 불일치면 그 상세만 "변조" 배지**, 게이트는 rollup 기준이라 **신규 제안 브릭 없음**. graceful(500 DoS 금지)·게이트(Part B)는 rollup+활성 window 격리 시 fail-closed(R2-#3).
- **추세 표시(F6 신뢰라벨 준용):** alignment_score·rounds_normalized·overturned_rejection_rate·verdict_counts·termination_reason 시계열. **`alignment_score` 정직 라벨(A103):** "정합도(품질 아님)" 배지·툴팁 산정식. `missed_defect_rate`/`overturned_rejection_rate`=null이면 **"미측정(외부 Ground Truth 필요)"**(0 위장 금지). `quality_label`은 "LLM 해석 라벨"로 분리 표기(품질 자기단정 금지).

### F8.3 Part B — 자기개선 제안 (제안+승인만 · 자동 금지)
- **악화 트리거(제안 발화·A105):** `alignment_score` **3연속 하락**(rolling window·단일 실행 노이즈 무시) · `rounds_normalized` 상승추세 · `overturned_rejection_rate` 임계초과 · 동일 경계 N회 실패 → **개선 제안 카드**(근거=인용 scorecard·추세, 무근거 제안 금지).
- **하드 게이트 = rollup 엔트리만으로 판정(R1-#2·R2-#2·R2-#3·R6·비협상):** 게이트는 **config 값도, `_workspace` 재읽기도 아니라 불변 append-only 체인 rollup**(`<state_home>/evals-rollup`·F8.1)에서만 — ingest 시 서명·수학 검증 통과분만 rollup에 들어가고(불량 scorecard는 애초에 미ingest = 누락), **rolling window + runId 중복제거** 후 **실제 adjudicated ≥ 30 ∧ 유효 관측 ≥ `rollingN` ∧ 실제 연속하락 ≥ `declineStreak`** 충족 시에만 발화(29·9·누락 → 발화 금지·데이터 부족은 브릭 아님·"N회 더"). **fail-closed 트리거 = rollup 자체 무결성(체인 링크/seq/head 불일치·절단)만.** **gate-time에 `_workspace` 파일 재읽기·digest 비교 없음(R6)** → 활성 window `_workspace` 사후 변조는 **게이트 영향 0**(표시전용·가용성 브릭·quarantine-skew 제거). 선택적 손상은 pre-ingest면 누락(보수적)·post-ingest면 rollup 불변(무영향). 단계 **< 3이면 제안 UI 비활성**.
- **제안 카드 렌더 안전(R1-#5·R1-#3):** 카드가 렌더하는 scorecard 텍스트(warnings·termination_reason 등)에 **F5 DV8 적용**(sanitizer·CSP·scheme 화이트리스트·외부리소스 차단) → 악성 scorecard XSS 차단. **scorecard 텍스트는 데이터일 뿐 — 지시로 흡수 절대 금지**(프롬프트 주입 방지). 카드는 **provenance 표시**(소스 경로·run id·`computed_by`·검증상태·표본수·정확한 트리거 근거).
- **제안 → 적용 = 서명 envelope + nonce + payload 일치(R1-#1·R1-#4·R2-#4·apply-state 계약):** 제안은 **F7 편집기 경로 + 사람 승인으로만** 반영. **자동 적용 절대 금지 · 제안 ≠ 적용 · Stage 4 자동 쓰기 없음.**
  - **서명 proposal envelope(R2-#4·R3-#5·R4-#2·R2-#2 — 가변 rollup-head 결속 제거·config-hash는 evals만):** 서버가 제안 생성 시 **canonical diff/내용 + 타깃 pathId + baseHash + 근거집합 digest + `evals-config 해시`**만 정확 결속해 **HMAC 서명**·해시. **`evals-config 해시`는 Part C 지표설정(`evals` 서브객체)만 해시·운영 플래그(`definitionEditEnabled`·`projectRoot`)는 제외(R2-#2 데드락 정정):** 승인하려면 `definitionEditEnabled`(기본 false)를 켜야 하는데 전체 config-hash를 결속하면 그 토글이 config-hash를 바꿔 대기 제안을 `409 stale`로 영구 거부하던 데드락 제거 — 지표설정 완화만 stale로 잡고 운영 토글은 제안 무효화 안 함. **가변 `rollup-head`는 envelope에 정확결속 안 함**(대기 중 새 run append 시 정확일치 실패로 정당 제안까지 브릭되던 모순 제거·신선도는 저장 시 게이트 재평가로 판정). 승인은 envelope + **일회용 nonce**를 F7에 전달(디스크 미변경·비-mutating).
  - **durable nonce 수명주기(R3-#4·통합감사 R4-#2):** nonce는 메모리 아님 **`<state_home>/evals-nonces`에 durable 저장**(envelope 해시+만료+state). **(a) 발급 = 인증 mutating 엔드포인트 `POST /api/evals/proposals/:id/prepare`**(Origin+session-token·**GET 아님** — R3가 GET을 side-effect 0으로 만들어 GET 발급이 불가능해진 고아 경로 정정). **(b) 크래시복구 상태머신 `issued → applying → consumed`(원자 전이·atomic.ts):** F7 write **前** 무조건 소비하면 크래시/쓰기실패 시 승인 제안 영구 유실 → 정정 = 소비 시점을 **write 완결에 정합**. `applying`에서 크래시 시 재기동이 **envelope + 결과 content 해시로 멱등 판정** — 이미 완결(디스크 content==envelope payload)이면 `consumed` 확정(중복적용 없음)·미완이면 `issued`로 복구(재시도 가능). 소비 후 **tombstone 재시작 유지**(replay 차단). → 부분실패가 제안을 영구 유실하지 않음.
  - **F7이 독립 검증·저장(staleness 재평가·R3-#5·R4-#2):** 현재 정의 fetch → **정확한 diff 표시** → **에디터 주입 내용 == envelope canonical payload 정확 일치**(악성 payload 은밀 전달 차단) → **envelope `evals-config 해시`(운영 플래그 제외·R2-#2)가 현재 `evals` 설정과 정확 일치 요구(지표설정 완화 stale 차단·`definitionEditEnabled` 토글은 무영향) + A106 게이트를 현재(진행됐을 수 있는) rollup 상태로 재평가(fail-closed)**(rollup-head 정확일치 대신 재평가만 — 새 run append돼도 게이트 만족 시 도달 가능) → `definitionEditEnabled`·`pathId`/`baseHash` 강제(DW2/DW6)·**nonce 1회 소비** → **별도 명시 저장(PUT)**. **payload/diff 불일치·타깃 교체·config 해시 불일치·게이트 재평가 실패·nonce 재사용 = 거부(`409 stale-config`/`stale-evidence`)**.
  - **no-auto-apply 경계(tools·skills 추가·R1-#1):** 평가기준 자체·**에이전트 `tools`·`skills` 추가**·역할 추가삭제·Phase·외부리뷰 게이트·런타임 범위 변경은 **항상 사람 승인**(심어진 scorecard가 위험 tool 자동주입·권한상승하는 벡터 차단). 무시·기각·승인 **모두 기록**(audit·체리피킹 금지).
- **단계 4(자동·A108):** v0.6 **쓰기 불가·display-only 잠금**(설계만·실험 라벨). holdout·명시 옵트인은 v0.7.

### F8.4 Part C — 평가지표 관리 (mutating config · 경화)
- **관리 항목:** 채택 단계(**1-4 표시·쓰기 1-3만·4 display-only 잠금**·R1-#1)·per-metric enable/가중치·임계값(`min_adjudicated_claims`·rolling `N`·decline-streak·리스크등급별 θ)·정규화 파라미터(`diff_lines`·`risk_level` → `rounds_normalized`).
- **저장 = F3.7 버전드 config 확장(A110):** `<state_home>/config.json`에 `evals` 서브객체(단일 파일·필드별 파싱·원자 RMW 전 필드 보존·in-process 뮤텍스·A71 정합). **부재/손상 → 안전 기본값 fail-closed**(단계=1·자동 잠금·보수적 임계). env override 미해당.
```ts
// R1-#6: 전체 .strict() 금지(한 필드 오타가 전체 eval 설정 소거 = R4-#4 위반). .passthrough() + 서브필드 독립 safeParse.
// Stage 4는 쓰기 스키마에서 제거(R1-#1): v0.6 수용 = {1,2,3}만. 4는 display-only·잠금.
const EvalsConfig = z.object({
  adoptionStage: z.union([z.literal(1),z.literal(2),z.literal(3)]).default(1), // 기본 1(로깅만)·4 쓰기 불가
  metrics: z.record(z.object({ enabled: z.boolean(), weight: z.number().min(0).max(1) })).default({}),
  thresholds: z.object({
    minAdjudicatedClaims: z.number().int().min(30).default(30),   // 하한 30(게이트·낮출 수 없음)
    rollingN: z.number().int().min(10).default(10),
    declineStreak: z.number().int().min(3).default(3),
    thetaByRisk: z.record(z.number().min(0).max(1)).default({}),
  }).passthrough().default({}),
  normalization: z.object({ diffLinesRef: z.number().positive().optional(), riskWeights: z.record(z.number()).optional() }).passthrough().default({}),
}).passthrough(); // 미지/미래 필드 보존. loadConfig(F3.7)가 evals 서브필드도 필드별 독립 복구.
```
- **per-leaf 복구 + floor max(R1-#6·R2-#5·R4-#4 정합):** **서브객체 단위가 아니라 각 잎 필드 독립 safeParse** — `thresholds.rollingN` 손상이 `thresholds` **전체를 리셋하지 않고** 형제 잎(`minAdjudicatedClaims:50`)을 **보존**(구 per-subobject 리셋은 사용자 엄격값을 기본 밑으로 떨어뜨림). 실패 잎만 안전기본값. **effective threshold = `max(유효 설정값, 필수 floor)`** — 리셋·손상돼도 **floor(30/10/3) 미만 불가**. F3.7 `loadConfig` per-leaf 확장.
- **Stage 4 쓰기 제거(R1-#1):** `POST /api/evals/config`는 **`adoptionStage∈{1,2,3}`만 수용**(4 요청 → `400`). 단계 4(자동 환류)는 **display-only·잠금**(설계 기록만·실험·v0.6 쓰기 경로 없음).
- **단계 3 전환(A111):** `adoptionStage:3`(제안 활성)은 **고위험 확인 다이얼로그**(experimental 경고+명시 확인·A85). 단계 3=experimental 배지. **min 하한(30/10/3)은 낮출 수 없음**(Zod `.min()`·게이트 우회 금지).

### F8.5 위협모델 (읽기 + config write + 제안-적용 3면 · 기존 방어 재사용)
| 면 | 벡터 | 방어 | 재사용 |
|----|------|------|--------|
| 키·서명 | **스크립트(에이전트 컨텍스트) 키 유출→위조·trust-on-first-write·회전 부재(R3-#1)** | **서명 주체=서버(스크립트에 키 미제공)**·`O_EXCL` 생성·owner/mode 검증·생산자 재생성 금지·key id+회전 overlap | hmac.ts·registry.ts §4-A |
| Part A 읽기·ingest | 경로탈출·심링크·대용량·malformed DoS·**자기일관 위조 aggregate(precomputed 서명 oracle·R7)**·이중소스 기만·키 회전 브릭(R5) | 화이트루트·per-seg·심링크 거부·크기상한·**ingest=서버 재도출-후-서명(원장서 집계 재계산·precomputed 거부·불일치 격리·R7)→rollup digest 결속·이후 과거=rollup digest(현재키 재검증 안 함·회전 무브릭·R5)**·graceful(500 금지)·**추세는 신뢰 rollup에서만·`_workspace`=표시용(digest 불일치=상세 "변조")** | F4·F5·hmac.ts·rollup·verdicts.json |
| Part C write | config clobber·형제 손상→floor 밑 리셋·동시쓰기·임계 낮춤·Stage 4 쓰기 | **per-leaf 독립 safeParse(형제 보존)·effective=max(값,floor)**·원자 RMW·뮤텍스·min 하한·**adoptionStage∈{1,2,3}만(4→400)**·Origin/token | F3.7·I5 |
| Part B 게이트 | XSS·프롬프트 주입·무근거·**flood·절단창·선택적 손상·rollup 절단/rollback/reorder/구 replay(R3-#2)** | **DV8**·scorecard=데이터·**체인 rollup(prev-해시+seq+head) 자체 무결성만으로 fail-closed(체인/seq/head 불일치·절단)·게이트는 gate-time `_workspace` 재읽기·digest 비교 안 함(R6·`_workspace` 변조 게이트 영향 0)**·불량 scorecard는 pre-ingest 누락(보수적)·provenance | F5 DV8·chain rollup |
| Part B 적용 | 자동 적용·payload 은밀 교체·replay·config staleness(제안↔승인 완화·R3-#5)·**운영 플래그 토글 데드락(R2-#2)** | **자동 적용 금지·Stage 4 없음**·서명 envelope(**canonical payload+pathId+baseHash+`evals-config 해시`(운영 플래그 제외)**·가변 rollup-head 미결속·R4-#2)·**durable nonce(tombstone·원자 소비)**·**F7 저장 시 evals-config 해시 일치 + A106 현재 rollup 재평가(불일치 409 stale)**·payload 정확 일치·no-auto-apply(**tools·skills**) | F7·hmac.ts·atomic.ts |

### F8.8 신뢰 도메인 경계 (정직 스코핑 — R4-#3 · 무한 crypto 군비경쟁 금지)
**F8이 방어하는 것 vs 게임오버를 정직하게 구분한다**(과claim 제거):
- **신뢰 도메인 분리:** `<state_home>`(**서버만 기록** — rollup·head·nonce·키) vs `_workspace`(**반신뢰 에이전트 run 기록** — scorecard). scorecard는 **서명 검증 후에만 ingest**.
- **F8 위협모델 안(방어 대상):** **`_workspace` scorecard 위조**(반신뢰 에이전트 산출물) — 서버 서명·수학 교차검증·격리로 방어. 이것이 F8의 목적.
- **F8 위협모델 밖(게임오버·문서화):** `<state_home>`의 `{rollup, head}` 구 스냅샷 조율 replay·구 `issued` nonce 복원은 **HMAC(진위)로 못 막음**(신선도 ≠ 진위). **`<state_home>` 쓰기 권한 = 서버 신뢰 도메인 전체 장악 = 게임오버** → **F8 위협모델 밖**(마이크로초 TOCTOU race·서버 프로세스 장악과 동급으로 문서화). 여기에 crypto를 더 쌓지 않는다.
- **best-effort(과claim 아님):** **in-session monotonic watermark(메모리)**로 **세션 내** rollup/nonce rollback만 best-effort 탐지. **cross-restart rollback은 out-of-scope**(명시) — "rollback 완전 탐지" 주장 제거.
- **게이트/표시 완전 분리(R6):** **게이트 판정은 오직 rollup 엔트리(체인/head 검증)만** — gate-time에 `_workspace` 파일을 읽거나 digest 비교하지 않는다. `_workspace` scorecard는 **표시전용 상세**(digest 불일치 = 그 상세 "변조" 배지·게이트 영향 0). → 활성 window `_workspace` 사후 변조가 제안을 브릭하던 가용성/quarantine-skew 모순 제거.
- **비악의 rollup 훼손 복구 + 재구축 검증 소스(UX-R2·UX-R3·게임오버와 구분):** **조율 rollback = 게임오버(out-of-scope)**이나 **디스크 손상·부분쓰기 등 비악의 rollup 훼손**은 UX 복구 경로 제공(데드엔드 금지·A112): 진단(실패 엔트리/seq/head) → **"원장 재구축·재검증"**.
  - **재구축 검증 소스(미검증 재신뢰 구멍 차단·UX-R3):** 재구축은 **독립 서명 ingest-receipt(`<state_home>/evals-receipts`·F8.1)를 keyId로 키링 재검증**해 통과분만 반영(재도출-후-서명 규율·위조 재유입 0). **현재 `_workspace` 원장을 재신뢰하지 않는다**(rollup 손상+키 회전 후 `_workspace`만 남아도 서명 판별 독립 소스 = receipt+키링).
  - **독립 소스 전무 시(rollup 손상 ∧ receipt 없음):** **재구축 불가 사유 표시 + 명시적 리셋만** — **미검증 `_workspace` 재신뢰 절대 금지**·eval 이력 상실을 사용자가 **명시 승인 후** 초기화. → 복구가 보안 약화 아님.
- **서명=무결성이지 진실성 아님·self-report 약증거·human-approval backstop(R7·교리 정직):** 서버 서명은 "서버가 재도출한 canonical 값"의 **무결성**을 보증하지 그 값이 **참**임을 보증하지 않는다. **재도출-후-서명(F8.1)**은 자기일관 위조 aggregate oracle을 좁히나(precomputed 거부·원장서 재계산), **판정 원장(`verdicts.json`) 자체가 오케스트레이터 자기판정** = `loop-self-eval.md`가 이미 규정한 **`alignment_score`=자기정합도≠품질·자기채점=약증거(self-check)**. 따라서 **F8은 위조·사후변조·cross-run 오염을 막지만 "자기채점을 참으로 만들지는 못함"(구조적 한계)**. 이 약증거의 **최종 방어 = 사람 승인 backstop**(제안≠자동적용·모든 반영은 F7 사람 승인·A107). **독립 ground-truth(`missed_defect_rate`·외부 seeded/사후회귀)는 v0.7**. 여기에 crypto를 더 쌓지 않는다.

### F8.6 비가역성·롤백
- Part A·Part B(제안) = **읽기전용**(비가역 없음). Part B 적용 = F7 경로(비가역·`.bak` 롤백·A93/A77). Part C config = 가역(F3.7 RMW·이전 값 복원).

### F8.7 비목표 (v0.7+)
- **`artifact_benchmark`(생성물 품질·with/without·holdout·runner) = v0.7**(러너 미구현·`loop_scorecard`와 **혼합 금지**). v0.6 F8은 **`loop_scorecard`(루프 효율)만**.
- 단계 4 자동 환류 = **v0.6 쓰기 경로 없음·display-only 잠금**(R1-#1)·실운영·holdout·외부 Ground Truth 수집 파이프라인 = v0.7.

---

## F9 — Docs(산출물) 소스 설정 (읽기전용 확장 · config 축은 F3와 동일)

### F9.1 문제·접근
F5 뷰어는 열람 루트를 **`docs/`(재귀)** 로 하드코딩(`adapters/docs.ts`의 `join(projectRoot,"docs")`). 그러나 임의 프로젝트에서 `docs/`가 산출물이 아닌 다른 용도일 수 있고, 반대로 산출물이 다른 디렉토리에 있을 수 있다. → **표시할 산출물 소스를 설정으로 지정**(사용자 확정 ①). 접근: **F3.7 config RMW 인프라 재사용**(`<state_home>/config.json`·`withConfigLock`·per-leaf 복구) + **F5 경로안전 프리미티브 재사용**(`openSafeFile`·realpath 앵커·per-seg `isSafeSegment`) — 앵커만 소스 base로 파라미터화. **읽기전용 유지**(config만 쓰기·I8 무영향·F3와 동일 축).

### F9.2 config 델타 (additive·하위호환)
`Config_v06`에 additive 2필드:
```
docsSources: { label: string; path: string }[];   // 표시 소스 목록. path=projectRoot 하위 상대경로. 기본 [{label:"docs", path:"docs"}]
docsMenuEnabled: boolean;                          // Docs 메뉴 on/off. 기본 true
```
- **per-leaf 독립 복구(A113):** `loadConfig`가 `docsSources` 파손 시 해당 필드만 기본값 드롭·형제 필드(`projectRoot`·`definitionEditEnabled`·`evals`) 보존. 개별 소스 엔트리도 per-entry safeParse(무효 엔트리만 제외·나머지 유지). RMW는 미지정 필드 보존(F3.7 규율).
- 무설정(구 config)→기본 `docs` 단일 소스로 동작(무인자 하위호환).

### F9.3 API 델타
```
GET /api/docs/sources           # 등록·검증된 소스 목록 [{id,label}] (경로는 노출 최소화)
GET /api/docs?source=<id>       # 해당 소스 트리 (무인자=기본 소스 → 하위호환·A116)
GET /api/docs/*?source=<id>     # 해당 소스 하위 파일 열람 (앵커=소스 base·F5 DV 재적용)
```
- `docsTree`/열람 리더에 **base 파라미터** 추가(하드코딩 `docs` 제거). `source` 미지정 = 기본 소스. 무효 `source` = 400.
- **즉시 반영(재시작 불요·R1 agy LOW):** F3(projectRoot)와 달리 `/api/docs*`는 **요청마다 `loadConfigFromDisk()` 최신본을 읽어 소스를 서빙** → Settings에서 소스 변경 시 재시작 없이 즉시 반영(config는 읽기전용 소비·캐시 미보유 or 변경 감지). *(projectRoot는 모듈 상수 캡처라 재시작 필요 — 성격 차이 명시.)*

### F9.4 위협모델 (표준 — 단 경로검증은 중대-인접 · 각 소스 = 새 열람 루트)
각 소스 등록·열람은 F5 DV1~DV9를 소스 base로 재적용하고, 소스 경로 자체에 신규 방어(DS)를 건다.

| ID | 방어 | 근거 |
|----|------|------|
| DS1 소스 경로 = projectRoot 하위 상대만·**루트 자체 금지** | 절대경로·`~`·`..` 세그먼트·UNC·드라이브문자 거부. projectRoot 밖 원천 불가. **`.`·`""`(빈 문자열)·`./`만 = projectRoot 전체 노출 → 거부**(≥1 하위 디렉토리 세그먼트 강제 — "임의 파일 브라우저 금지" F5 영구 비목표 우회 차단·R7 agy MED) | 신규(F3 D-계열 준용) |
| DS2 per-seg `isSafeSegment` | 소스 경로 각 세그먼트 안전문자만(F5·F3 재사용) | 재사용 |
| DS3 realpath containment | 등록 시점 소스 base realpath ∈ projectRoot 확인·전 세그먼트 심링크/reparse 거부 | 재사용(paths.ts) |
| DS4 `deniedDocsPath` 재적용 | denylist 디렉토리(`.git`·`.ssh`·`node_modules`·`.env`) 소스 등록 거부 | 재사용(security.ts DENY) |
| DS5 개수·길이 상한 | `MAX_DOCS_SOURCES`(예 16)·라벨/경로 길이 상한·중복 병합·Zod strict(초과 400) | 신규 |
| DS6 dryRun 검증 API | 저장 전 소스 경로 검증(존재·containment·denylist)·인라인 에러(A119) | 신규 |
| DS7 **열람 시점 재검증(TOCTOU) — 트리·파일 양쪽** | config 저장 후 소스 base가 심링크로 스왑될 수 있으므로 **매 요청 시 realpath 재확인**(등록 시점 신뢰 금지·F4 통합감사 R4 준용). **⚠ 파일 열람(`openSafeFile`)뿐 아니라 트리 리스팅(`docsTree` walk)도 별개 경로 — `docsTree` 진입부에서 `realBase` 계산 후 `isWithinRoot(realpath(projectRoot), realBase)`+전 세그먼트 심링크 거부를 반드시 수행**(base 자체 containment 미검사 시 스왑된 base가 projectRoot 밖 전체를 리스팅·R2 agy HIGH) | 신규(중대-인접) |
| DS8 열람=F5 DV2~DV9 전건 | 앵커만 소스 base로 교체하고 심링크/바이너리/크기상한/XSS/CSP 전건 유지 | 재사용 |

### F9.5 UI 배선
- **Settings**: Docs 소스 편집기(추가/삭제/재정렬·라벨+경로 입력·dryRun 검증·인라인 에러·A119) + `docsMenuEnabled` 토글(A118).
- **Docs 화면**: 소스 드롭다운(다중)·소스별 트리·빈/로딩/에러 3-state(A81)·소스 0개 또는 전부 무효 시 CTA("Settings에서 소스 추가"·A120). `docsMenuEnabled=false`면 nav에서 숨김/비활성+이유 툴팁.

---

## F10 — 하네스 컨텍스트 관리 페이지 + 에이전트/스킬 빌더 (중대 · 신규 읽기 화이트리스트 + 빌드 exec surface)

### F10.1 문제·접근
Docs(산출물)와 별개로, **하네스를 구성하는 컨텍스트**를 한 페이지에서 **읽고·편집하고·새로 빌드**한다(사용자 확정 ②③ + 멀티런타임 읽기 확장). 고정 기능으로 특정 프로젝트에 바로 사용.

**멀티런타임 읽기(뷰) 범위 — 3 런타임 파일 규약(조사 확정·2026-07-10):** 세 런타임의 스킬은 **동일 `SKILL.md` 포맷**(YAML frontmatter `name`/`description`+md)이라 단일 리더로 커버되고, 규칙/컨텍스트는 frontmatter 없는 md다.
| 런타임 | 에이전트 | 스킬 | 규칙/컨텍스트 | F10 지원 |
|--------|---------|------|--------------|----------|
| **Claude Code** | `.claude/agents/*.md` | `.claude/skills/**/SKILL.md` | `CLAUDE.md` | **읽기+편집**(F7) |
| **Codex** | `.codex/agents/*.toml` | `.agents/skills/**/SKILL.md` | `AGENTS.md` | **읽기(뷰)만**(편집 v0.7) |
| **Antigravity(agy)** | (SDK subagent·파일규약 없음) | `.agents/skills/**/SKILL.md`(Codex와 공유 경로) | `GEMINI.md`/`AGENTS.md` | **읽기(뷰)만** |

- **접근:** 읽기=**멀티런타임 정밀 화이트리스트**(`.claude`·`.codex`·`.agents` 세 dot-dir + CLAUDE/AGENTS/GEMINI.md만 정밀 허용·나머지 dotfile 거부·신규 `deniedContextPath`) + **편집=F7 재사용·Claude만**(Codex/agy 정의는 읽기전용 뷰·편집 시 `409 <runtime>-edit-v0.7`) + **빌드=폼→AI 초안→사람 승인→F7 저장·Claude 스코프**(no-auto-apply·F8 Part B) + **신규 생성=신규 구축**(F7은 기존 leaf 전제라 신규 미지원).
- **런타임 라벨:** 각 아티팩트에 소속 런타임 배지(claude/codex/agy) 표시. `.agents/skills`는 Codex·agy 공유(라벨=`codex/agy`).
- **경계:** 읽기는 **projectRoot 하위만**(사용자 홈 `~/.gemini`·`~/.claude` 등 전역 설정은 원천 불가·경로탈출 방어). 편집·쓰기 스코프는 **여전히 `.claude/agents·skills`+신규 생성만**(멀티런타임 확장이 쓰기 경계를 넓히지 않음·I8 유지).

### F10.2 페이지 구성 (11번째 화면 "Context")
- **읽기(트리+뷰어·멀티런타임):** `CLAUDE.md`·`AGENTS.md`·`GEMINI.md`(projectRoot 직속) + `.claude/agents/**`·`.claude/skills/**`(Claude) + `.codex/agents/**`(Codex TOML) + `.agents/skills/**`(Codex/agy SKILL.md) 트리 열람. 런타임 배지 표시. 렌더는 F5 DV8(sanitizer·CSP·scheme 화이트리스트) 재사용 — TOML·md 모두 텍스트로 안전 렌더(실행 안 함).
- **편집(Claude만):** `.claude/agents`·`.claude/skills` 정의는 F7 GET/PUT/rollback 재사용. **CLAUDE.md·AGENTS.md·GEMINI.md는 읽기전용**(쓰기 라우트 없음)·하네스 포인터 등록은 **스니펫 복사 안내**. **Codex(`.codex`·`.agents/skills`)·agy 정의는 읽기전용 뷰**(편집 시 `409 <runtime>-edit-v0.7` — duo drift·TOML 정규화·런타임별 differential 게이트 미비로 v0.7 이월).
- **빌드:** 폼(도메인·역할 한 문장)→초안 생성(디스크 미기록)→diff 미리보기→사람 승인→F7 저장(신규 생성).

### F10.3 읽기 화이트리스트 위협모델 (중대 — dot-prefix 함정·멀티런타임)
`security.ts`의 `DENY=/(^|\/)\.[^/]/`는 **모든 dotfile/dot-dir을 거부**(F5는 `docs/` 열람이라 무관). F10 읽기는 `.claude`·`.codex`·`.agents`를 열어야 하므로 **이 세 dot-dir만 정밀 허용하는 신규 리더**가 필요 — DENY를 느슨하게 풀면 `.env`·`.git`·`.ssh`·`.gemini`(사용자 홈) 노출, 그대로 두면 세 dir이 막힌다. **⚠ 기존 전역 `DENY`·`deniedDocsPath`를 수정하지 않는다(F5 뷰어 방어 훼손 금지·R1 agy MED)** — F10 전용 **독립 `deniedContextPath`** 신설(병렬 구조). 열람 루트는 **`.claude/agents·skills`·`.codex/agents`·`.agents/skills`+CLAUDE/AGENTS/GEMINI.md만**(각 dot-dir 전체 재귀 아님·정밀 서브루트만 — 스크래치/설정 노출 차단).

| ID | 방어 |
|----|------|
| HR1 열람 루트 = 멀티런타임 화이트리스트 | (projectRoot 직속 파일) `CLAUDE.md`·`AGENTS.md`·`GEMINI.md` + `.claude/agents/**`·`.claude/skills/**`(Claude) + `.codex/agents/**`(Codex) + `.agents/skills/**`(Codex/agy)**만**. 그 외 400 |
| HR2 **dot-dir 3종 정밀 허용** | 첫 세그먼트가 정확히 `.claude`·`.codex`·`.agents`일 때만 dot-prefix 통과(+둘째 세그먼트 ∈ 위 서브루트). `.env`·`.git`·`.ssh`·`.gemini`·`.codex/config`·기타 dotfile/서브 전부 거부(정밀 화이트리스트·denylist 아님) |
| HR3 전 세그먼트 심링크/reparse 거부 | 세 서브루트 하위 심링크가 외부(`~/.ssh`·`~/.gemini`)로 리다이렉트하는 벡터 차단(realpath containment·O_NOFOLLOW). **projectRoot 직속 3파일(CLAUDE/AGENTS/GEMINI.md)도 leaf lstat+O_NOFOLLOW+realpath containment**(직속 파일 심링크→외부 차단·R5 codex LOW) |
| HR4 secret denylist 유지 | 화이트리스트 하위라도 `*.key`·`*.pem`·`id_rsa*`·`.env`류·토큰·크기 이상 거부 |
| HR5 렌더 안전 = F5 DV8 | markdown·TOML **텍스트 렌더**(sanitizer·CSP·scheme 화이트리스트·외부 리소스 차단·바이너리 거부·크기상한·**실행 안 함**) |
| HR7 **트리 바운드·대량 dir 차단(R7 agy HIGH)** | 트리 열거 `MAX_CONTEXT_NODES` 상한(F4 `MAX_RUNS_SCAN`·F5 `MAX_DOCS`와 동등)·초과 시 `truncated:true`. `deniedContextPath`에 **`node_modules`·`venv`·`.venv`·`__pycache__`·`dist`** 포함 — 스킬 dir(`.claude/skills/{name}`) 내 패키지/빌드 환경 무제한 순회로 인한 OOM/DoS 차단(F5 DV5 `node_modules` 차단 규율 상속) |
| HR6 **편집=Claude 스코프만** | 읽기는 멀티런타임이나 **PUT/rollback·신규생성은 `.claude/agents·skills`만**. `.codex`·`.agents/skills`·GEMINI.md 편집 요청 = `409 <runtime>-edit-v0.7`(읽기전용 뷰). projectRoot 밖(`~/.gemini` 등) 읽기도 원천 거부 |

### F10.4 빌드 초안 생성 surface 위협모델 (중대 — 신규 exec/생성 공격면)
빌드 초안은 **읽기전용 컨텍스트만 입력**받아 정의 초안 텍스트를 반환하고, **디스크에 쓰지 않는다**. 저장은 사람 승인 후에만 F7 경로로. (초안 생성 메커니즘 = 서버가 로컬 CLI를 bounded 호출 or 결정적 템플릿 — **M15 P3에서 선검증·가정 위에 구현 금지**.)

| ID | 방어 |
|----|------|
| HB1 bounded 입력 | 도메인/역할 문자열 길이·문자 상한. **초안 = 데이터**(지시로 흡수 금지·프롬프트 주입 방지) |
| HB2 exec 규율(I3) | 초안이 CLI 호출이면 `execFile`+argv·**shell 보간 0**·`noFlag`·타임아웃·출력 상한·stdio 로그파일(I2). **[as-built M15·실측 확정]** claude CLI 도구 완전 비활성 = **`--tools ""`**(설치 `claude --help` 실측: "built-in 도구 전체 비활성"·`--allowedTools`는 사전승인이지 제한 아님·denylist 열거는 불완전) + `--disallowedTools "*"` + `--safe-mode` + **HOME/XDG/cwd 빈 temp 격리**(4층 deny-all·도구 새어도 접근 파일·자격증명 0). **한계:** HOME 격리로 OAuth/keychain 미접근 → **`ANTHROPIC_API_KEY` 인증 필요**(v0.6). 근거: R1~R8 외부감사·`working_history/M15_*` |
| HB3 읽기전용 입력만 | 초안 생성은 프로젝트 파일 **쓰기 0**·읽기 컨텍스트만 참조(빌드가 실행 트리거 아님) |
| HB4 no-auto-apply | 초안은 **자동 저장 절대 금지** — diff 표시 → 사람 승인 → 그때만 F7 저장(F8 Part B) |
| HB5 신규 생성 경로안전(신규 구축) | leaf 미존재 확인·부모 심링크 거부·skill dir `mkdir` escape 거부·이름 충돌 409·`.claude/agents·skills` 스코프 밖 생성 400 |
| HB6 저장 = F7 전건 통과 | 승인 후 저장도 canonicalize(DW5)+무결성+원자쓰기(DW4)+낙관적 동시성(DW6)·초안 무결성 위반 400 |
| HB7 게이트 | `definitionEditEnabled` off면 빌드/저장 비활성(fail-closed)·읽기만 허용 |
| **HB8 동시성·rate-limit(R1 agy HIGH)** | **in-flight 빌드 초안 동시 1개 제한**(서버 뮤텍스·초과 429)·요청 쿨다운(rate-limit)·초안=exec/LLM spawn이므로 무제한 호출 시 비용폭주·리소스고갈(DoS) 차단. `create`(저장)도 동일 백프레셔 | 신규(비용·DoS) |

### F10.5 API 델타
```
GET /api/context/tree                 # 멀티런타임 화이트리스트 트리(HR1)·각 노드 runtime 라벨(claude|codex|agy)·runtime 필터
GET /api/context/file?path=…          # 읽기(HR1~HR7)·md/TOML 텍스트 뷰
# 편집(Claude 스코프만·HR6): 기존 F7 라우트 재사용 (GET/PUT/rollback · .claude/agents·skills)
#   .codex·.agents/skills·GEMINI.md 편집 요청 → 409 <runtime>-edit-v0.7 (읽기전용 뷰)
POST /api/context/build/draft         # 폼→초안 반환(디스크 미기록·HB1~HB4·HB7·HB8)
POST /api/context/build/create        # 승인된 초안→신규 생성(HB5·HB6·F7 저장·.claude만)
# CLAUDE.md·AGENTS.md·GEMINI.md 쓰기 라우트 없음(읽기전용·A123·A130)
```

### F10.6 UI 배선 · 비목표
- **Context 페이지(11번째 화면):** 읽기 트리·F7 편집기·빌더 폼·diff 승인·"미적용 초안" 유지·CLAUDE.md 포인터 스니펫 복사·3-state·접근성(A128).
- **초안 상태 책임(R1 agy MED):** 서버는 **무상태**(초안 디스크 미기록·HB3) → "미적용 초안" 유실 방지는 **전적으로 클라이언트 세션**(sessionStorage/상태관리)이 소유. 서버 재기동·새로고침 간 초안 보존은 클라이언트 책임(A107 "미적용 유지"와 아키텍처 충돌 없음 명시).
- **비목표(v0.7+):** 풀 팩토리 오케스트레이션(에이전트 팀 spawn·자동 다파일 생성)·CLAUDE.md/AGENTS.md 자동 쓰기·초안 자동 적용·**Codex/agy 편집(읽기전용 뷰만)**. v0.6은 **단건 정의 초안+사람 승인**까지.
- **읽기 범위 경계(R5 agy·명시적 비목표로 은폐 갭 해소):** v0.6 F10 읽기 = **에이전트·스킬(`.claude/agents·skills`·`.codex/agents`·`.agents/skills`) + 컨텍스트(CLAUDE/AGENTS/GEMINI.md)만.** **agy 규칙=GEMINI.md/AGENTS.md(디렉토리 기반)이며 이미 포함**(별도 rules 경로 아님). **plugins·hooks·sidecars·`.claude-plugin/`(플러그인 패키징)·MCP 설정·rules 서브디렉토리 = v0.7 비목표**(스코프 규율·이들은 시크릿/설정 인접이라 별도 위협모델 필요). 트리에서 미표시가 아니라 **명시적 비목표**(사용자 혼란 방지).

---

## 수용기준 (A47~ — v0.5 A46 이어서 · 측정가능)
| # | 기준 | M | 기능 |
|---|------|---|------|
| A47 | `GET /api/runs` 필터 확장: status+manifest **병합 스캔**(현 listRuns=status만 → manifest read 델타), 반환 `{runId,runtime,mode,state,recordedAt(FS-time·필터/정렬 축),createdAt(manifest·표시·괴리 가능),updatedAt,goal,agent(optional·Manifest additive 델타·F2.1·구 run은 null),requestedBy}`. 무인자 호출 하위호환 | M7 | F4 |
| A48 | 필터 파라미터 Zod 검증: state/runtime=enum·mode/agent=리터럴·**from/to=ISO(`recordedAt` FS-time 도메인·R3-#1)**·sort∈{recordedAt,updatedAt,state}·order enum·offset/limit clamp. 미허용 값 400 | M7 | F4 |
| A49 | 텍스트 검색 `q` = **리터럴 부분일치**(대소문자 무시), `new RegExp(q)` 미사용 → 정규식 주입·ReDoS 불가(특수문자 쿼리도 리터럴 취급 검증) | M7 | F4 |
| A50 | 열거·바운드·**경화 리더(정렬정합+OOM+심링크·R3-#1·R4-#1·통합감사-#3):** 이름만 readdir → `fs.stat` birthtime/mtime desc 정렬(runId 형식 무관)·malformed/stat불가 quarantine → 상위 `MAX_RUNS_SCAN`=5000만 **공용 경화 바운드-리더**(realpath 앵커·per-seg safe·**전 하위 세그먼트 심링크/reparse 거부**·leaf `O_NOFOLLOW`·`fstat` 정규/`MAX_JSON_BYTES`·containment 재확인·runs.ts safeRunDir/safeOpen·F5 DV4 동일)로 내용 read → 심링크 run dir 리다이렉트 차단·`SCAN_DEADLINE_MS`=2000·손상 skip·`MAX_RUN_DIRS` backstop | M7 | F4 |
| A51 | **전역 정렬 정합: 스캔 창=`recordedAt`(FS-time birthtime/mtime) 최신 상위 N(runId 형식 무관·무작위 아님)** → 매칭 경량 레코드 전체를 sort(**recordedAt**/updatedAt/state)+order로 **전역 정렬**(페이지 버퍼만 재정렬 금지)·tie-break=runId(결정적)·offset/limit slice·응답 `{items,total,offset,limit,hasMore,scanned,truncated,schemaVersion}` | M7 | F4 |
| A52 | Runs 목록 UI 필터바·정렬·페이지·3-state(A46)·읽기전용(파일 무변경) | M7 | F4 |
| A53 | `GET /api/docs` 트리·`GET /api/docs/*` 열람이 **열람 루트 화이트리스트**(DV1: docs·runs artifacts만) 강제, 밖은 400 | M8 | F5 |
| A54 | 뷰어 경로 안전(DV2-DV4): per-seg isSafeSegment·realpath 앵커 선계산·**전 세그먼트 lstat 심링크 무조건 거부(in-root·중간 스왑 포함 — realpath 경계검사로 대체 금지)**·leaf O_NOFOLLOW·fstat 정규파일·isWithinRoot | M8 | F5 |
| A55 | 뷰어 denylist(DV5): `.env`·`*.key`·`*.pem`·`.git`·`.ssh`·`.aws`·node_modules·토큰·레지스트리 차단(deniedPath 재사용+확장자 규칙) | M8 | F5 |
| A56 | 뷰어 크기상한(DV6·R2-#5): 미리보기 `VIEW_MAX` 초과 절단·**다운로드는 스트림 前 `fstat` 검사→`ARTIFACT_MAX` 초과 시 `413` 즉시 반환(중간 중단 금지·부분파일 손상 방지)**·바이너리(널바이트/비-UTF8) 미리보기 거부→attachment(DV7)·UI 413→로컬 경로 안내(A98) | M8 | F5 |
| A57 | 뷰어 위협 스위트 전건 거부(fail-closed): `../`·절대경로·심링크 탈출·**in-root 심링크**·중간 세그먼트 스왑·`.env`·`.git/config`·`~/.ssh/id_rsa`·화이트리스트 밖·바이너리·**초과크기(미리보기+다운로드)**·**XSS(`<script>`·`onerror=`이벤트핸들러·`javascript:`·`data:`·원격 `<img>`·SVG 내 스크립트)** | M8 | F5 |
| A58 | 뷰어 렌더 안전(DV8 치명): **raw HTML 비활성·sanitizer allowlist·URL scheme 화이트리스트(http/https/mailto)·외부 리소스 차단·CSP(`default-src 'none'`…)·nosniff**·MIME 화이트리스트(md/txt/json)·그 외 attachment·SVG/HTML/JS 비실행·비렌더(A14) | M8 | F5 |
| A59 | 뷰어 UI: docs 트리·마크다운/코드 렌더·Runs artifact·Overview 결과서 진입·읽기전용·3-state | M8 | F5 |
| A60 | `GET /api/metrics/{overview,agents,skills}`: 바운드 on-read 집계(F4 스캔 재사용·전수스캔 금지·supervisor/API 쓰기 없음=읽기전용)·**events/metadata read는 F4 공용 경화 바운드-리더 상속(realpath 앵커·전 하위 세그먼트 심링크/reparse 거부·O_NOFOLLOW·containment·A50·통합감사-#3)** | M9 | F6 |
| A61 | 토큰 귀속 신뢰등급: **measured는 usage 증거 실존 시에만**(부재 시 `unattributed` 강등·승격 금지)·agent(claude team)/skill은 상한 estimated(measured 불가)·**값별(per-value) confidence 동반**(응답 단일 confidence 금지)·CLI 픽스처(usage 유/무 샘플)로 measured↔unattributed 회귀 검증 | M9 | F6 |
| A62 | UI에서 estimated/unattributed 배지·산정식 툴팁·measured와 시각 구분, **추정·미귀속을 정확값으로 표시 금지·0 위장 금지** | M9 | F6 |
| A63 | 관측성 UI 기존 페이지 내 편입(F6 신규 페이지 0): Overview 효과성 카드·Agents/Skills usage 섹션·미사용/고아 강조·anti-Goodhart | M9 | F6 |
| A64 | `GET /api/agents/:name/run-template`: 정의에서 domainTemplate·runtime·targets·suggestedAllowedTools·보수적 permissionMode·AGENT_NAME allowlist·미존재 404·경로주입 거부 | M10 | F2 |
| A65 | 실행 반영 allowedTools = **`U ⊆ D`(디스크 재도출 상한 D 내 축소만)** — 상향 불가·서버 Zod noFlag·max40 재검증. **조용한 드롭 금지: D 밖 도구 요청 시 `400 unauthorized-tool` 명시 반려(A100)**·UI는 D 선언 도구 체크박스로만 구성 | M10 | F2 |
| A66 | 에이전트 실행=단일경로 POST /api/runs·**제출 시점 정의 재조회·D 재도출(템플릿 시점 D 신뢰 금지·통합감사 R4-#1)·U⊆D는 제출 D 기준·정의 부재/pathId 변경 시 `409 agent-definition-changed`(천장우회 차단·allowedTools 비어있지 않으면 D 재도출 필수)**·**optional `manifest.agent`(additive 델타·F2.1) 기록**·구 manifest(agent 없음)→null 파싱(마이그레이션 테스트) | M10 | F2 |
| A67 | Agents "이 에이전트에게 요청(New Run)" → 프리필 편집폼 → 제출 → Runs 딥링크·대화형 아님(최초 1회) | M10 | F2 |
| A68 | `POST /api/settings/project-root`: D1 정규화(상대/`..`/`~`/UNC/드라이브/NFC)·**D2 canonical containment(realpath 절대상위 변경 `/var`→`/private/var` 허용·"realpath≠정규화 거부" 삭제·R3-#4)**·**D3 projectsHome 하위 상대 세그먼트만 심링크+reparse(junction/mount) 거부**(절대 상위부는 오거부 없음)·실패 fail-closed 400. ACCEPT: `/var/…/projects/x` | M11 | F3 |
| A69 | **신뢰경계 = 단일 `projectsHome` containment(확정)**·마커(D5)는 심층방어이며 경계 아님(위조 가능)·D4 시스템/민감 차단·경계는 프로비저닝(env/설치)이며 편집 API로 확장 불가·미프로비저닝 시 409 편집 비활성 | M11 | F3 |
| A70 | D7 TOCTOU 스왑 재확인·**부팅 시 env·config·API 세 소스 root 전부 D1-D7 재검증(env 예외 없음)**·unsafe 소스 폐기 후 폴백(env→config→기본)·검증 없이 신뢰하는 소스 없음 | M11 | F3 |
| A71 | 공유 config(F3.7·R3-#3·R4-#4): **버전드 봉투 파싱 후 필드별 독립 검증·복구(전체객체 strict Zod 금지)** + 원자 RMW(전 필드 보존·뮤텍스)·`projectRoot` 쓰기/손상이 `definitionEditEnabled` clobber/소거 안 함·**부팅 필드별 무효화**·**쓰기 순서=`dryRun` 프리뷰→확인→`dryRun:false` 쓰기(취소 시 디스크 무변경·A101)**·재시작 반영·응답 `{accepted,requiresRestart:true,effectiveRoot,appliedAt,activeRunsWarning}`·Settings 편집폼·mutationEnabled 비활성 | M11 | F3 |
| A72 | `GET /api/{agents,skills}/:name/definition`: 원문·`baseHash`·`pathId(sha256 sourcePath)`·mtime·sourcePath 반환·**이름→정규경로 서버 재조회**(DW2)·**중복 name→409 ambiguous**·`.agents` 전용 스킬→409 codex-only-v0.7·미존재 404 | M12 | F7 |
| A73 | 쓰기 경로탈출 방어(DW3): projectRoot realpath 앵커·**projectRoot 하위 상대 세그먼트만 lstat 심링크/reparse 거부**(절대 상위=containment·I6 통일)·부모 dir realpath·위치+확장자 화이트리스트(agents `.claude/agents/*.md`·skills `.claude/skills/*/SKILL.md`)·`.claude` 밖 거부·`MAX_DEF_BYTES` 크기상한·fail-closed 400 | M12 | F7 |
| A74 | 원자 쓰기(DW4): `writeAtomic`(temp O_EXCL+fsync+rename+dir fsync) 재사용·부분쓰기/손상 0·rename write-through-symlink 불가 | M12 | F7 |
| A75 | 무결성+정규화+등가게이트(DW5·R2-#2·R3-#2·R4-#2/#3/#5): strict YAML(앵커/멀티도큐/중복키/`!!tag` 거부)+**완전 frontmatter 스키마(name·description 필수 strict·role/tools/skills/triggers/references 옵션·`.passthrough()` 미지필드 보존·라운드트립 유실 0)**·name 불변·canonical 재직렬화·**본문 `---` 무해(blanket 거부 철회)**·**F7.8 differential 게이트(리더 버전 핀·픽스처 코퍼스·정규화 JSON zero-divergence·`npm run test:def-differential` CI)**로 UI≡CLI 등가 증명·위반/필수누락 400 | M12 | F7 |
| A76 | 낙관적 동시성(DW6): 로드 `baseHash`+`pathId` → PUT 재전송 → **디스크 현재 해시 불일치 `409 stale-write`** + **pathId 재해소 불일치 `409`**(GET↔PUT 다른 정의 타격 차단·R2-#3) | M12 | F7 |
| A77 | 되돌리기(DW7·R2-#1/#4): 백업 파일명=**opaque `sha256(sourcePath)`**(논리 name 보간 금지·traversal 차단)·백업 dir 심링크/reparse 거부·`O_EXCL`·writeAtomic. rollback body `{expectedCurrentHash,backupHash}` 요구·불일치 409·복원 시 DW3/DW5 재실행·원자 복원 | M12 | F7 |
| A78 | 게이트(DW8·R2-#5·R3-#3·R4-#4): PUT/rollback에 Host/Origin/token + **`POST /api/settings/definition-edit`(F3.7 필드별 파싱·원자 RMW·`projectRoot` 보존)**·매 요청 boolean 자체 판독·**부재/손상/비-boolean/판독불가→false(fail-closed)→403**·**projectRoot 손상/부팅실패가 게이트 초기화 안 함(필드 독립)**·재시작 지속·`mutationEnabled` 전면 API 비활성 | M12 | F7 |
| A79 | 편집/실행 분리(DW9): 저장은 정의 파일 기록만·실행 트리거 안 함(F2/New Run 경유)·Codex 듀얼 미편집(v0.7)·저장 시 Codex 피어 drift 경고 | M12 | F7 |
| A80 | Agents/Skills UI 편집기: 조회→편집→diff→검증→저장·400/409/403 인라인·rollback·`definitionEditEnabled` off 시 편집 비활성(뷰어만) | M12 | F7 |

**신규 수용기준: A47-A80(34개)** = 읽기전용 F4-F6·F2·F3(A47-A71, 25) + **F7 편집기(A72-A80, 9)**. 구 초안 A47-A62(F1/F2/F3 혼재)는 본 재번호로 **대체**(F1 폐기·결번 없음).

### UX 수용기준 (A81~ — 기능계약 무변경·UX 레이어 · v0.5 A46 UX표준 확장 · 측정가능)
> 전 화면 공통 UX 규칙을 못박는다(모호한 "잘 되게" 금지). A46(빈/로딩/에러 3-state·색+label·키보드 nav)을 v0.6 신기능에 확장.
| # | 기준 | 기능·화면 |
|---|------|-----------|
| A81 | **게이트 비활성 안내:** `definitionEditEnabled` off → 편집 버튼 `disabled` + **툴팁 "정의 편집 비활성 — Settings에서 켜기"** + Settings 딥링크. follow-up 없음·`mutationEnabled` 비활성·codex-only 스킬 등 **모든 disabled 컨트롤에 이유 툴팁**(빈 비활성 금지) | 횡단(F7·Settings) |
| A82 | **빈 상태(무행동 방치 금지):** 화면별 빈 상태 = 안내문 + 다음 행동 딥링크 — Runs 0→"New Run으로 시작"·Agents 0→인벤토리 안내·Drift 0→"불일치 없음(정상)"·**F4 필터/검색 0건→"조건에 맞는 run 없음 + 필터 초기화"**·Overview 미프로비저닝→안내. 각 빈 상태 문구·CTA 정의 | 횡단(전 화면) |
| A83 | **로딩·부분실패 격리:** 각 패널 로딩 = 스켈레톤/스피너(레이아웃 시프트 없음)·**패널별 독립 로드**(한 패널 에러가 전체 화면 안 깸)·Overview 다중 카드는 카드별 상태 | 횡단 |
| A84 | **에러·재인증 동선:** 에러 = 한국어·행동가능 메시지 + **재시도 버튼(GET)**. **401(세션 만료)→"세션 만료 — 재로그인"** 안내 + 런처/재로드 동선(A34 bootstrap 재교환)·요청 무한재시도 금지. **서버 연결끊김(네트워크·재시작)은 A94 전역 오버레이로 흡수**(개별 에러 토스트 폭주 금지) | 횡단 |
| A85 | **위험작업 확인+피드백:** workspace-write New Run·Ask Agent·F7 저장·projectRoot 변경 = **확인 다이얼로그(영향 명시)** → 성공 **토스트** / 실패 **이유 인라인**(A46 위험작업 확인 준용·비가역 작업 명시) | Build·Agents·F7·F3 |
| A86 | **F7 편집 UX:** 저장 전 **diff 미리보기**·`409 stale-write`→**편집분 보존한 채 병합(A93 — 자동 재로드·유실 금지)**·**미저장 변경 이탈 경고**(navigate away guard)·저장 성공 "실행하려면 New Run/Ask Agent" | F7 |
| A87 | **동선 딥링크(RF3 채택):** New Run·Ask Agent 제출 성공 → **"→ Runs에서 관찰" 착지 배너 + 생성 runId 딥링크**. 실행 진입점 2개(New/Ask) 발견성(사이드바 "실행" 그룹·RF5) | Build·Agents |
| A88 | **F4 필터·검색 UX:** 활성 필터 **칩(개별 제거)**·**결과 카운트**·**"필터 초기화(clear)"**·정렬 방향 표시·**URL 쿼리 반영(공유·새로고침 보존)**·페이지네이션 컨트롤(이전/다음·현재 범위)·**절단 고지(A95: `truncated` 경고 라벨)** | F4 Runs |
| A89 | **F5 뷰어 UX:** 파일 **트리/브레드크럼**·크기상한 초과 → **"미리보기 잘림(N까지)·전체 다운로드"** 배너·바이너리 → **"미리보기 불가(바이너리)·다운로드"**·**마크다운 렌더↔raw 토글** | F5 |
| A90 | **F6 신뢰라벨·관측 window UX(dead 오라벨 정정·UX-R2-#3):** measured/estimated/unattributed = **아이콘+텍스트 배지(색만 아님)**·시각 구분·**툴팁에 산정식**. **"dead/미사용" 단정 금지** — 바운드 최근-N에서 0회면 **"선택 window(관측 기간·run 수) 내 관측 없음"**으로 표기 + **커버리지·신뢰도 명시**. 진짜 "dead"는 **전 생애 증거**(정적 정의 존재 + 전기간 무관측) 있을 때만(A62 정합) | F6 |
| A91 | **일관성·인지부하:** 전 화면 **동일 패턴**(목록 테이블+상세 패널·badge kind 통일)·용어 통일(New Run/Ask Agent·"follow-up/대화형" 미노출)·**Overview progressive disclosure**(계층 A 요약→계층 B 상세 접기·과밀 방지) | 횡단 |
| A92 | **접근성(DESIGN.md Linear 정합):** 키보드 내비(Tab/Enter/Esc)·가시 포커스 링·**상태를 색만으로 전달 금지(아이콘+텍스트 라벨)**·대비 WCAG AA·모바일 읽기전용(A46 준용) | 횡단 |
| A93 | **F7 409 편집분 보존(데이터 유실 방지·UX-R1-#1):** stale-write 409 시 **자동 재로드 금지**. 사용자 편집 textarea를 **보존**한 채 (a) 디스크 변경분↔현재 편집분 **병합 뷰**(최소 나란히 비교) 제공, or (b) 편집분 **로컬 백업/클립보드 복사 후 수동 병합** 액션. **"덮어쓰기 전 편집분 보존" 보장**(A86 강화·S18 정합) | F7 |
| A94 | **전역 재연결 상태머신(데드엔드+401 갭 정정·UX-R1-#2·UX-R2-#1):** 경량 liveness `GET /healthz`(**`/api/` 밖 → session-token 게이트 대상 아님·재시작 중 도달 가능·I5 무영향**) 백오프 폴링. 재연결 = **상태머신 `offline → health-up → authenticated-bootstrap → ready`**. 오버레이는 **health 복구만이 아니라 토큰/bootstrap 재확립(ready)까지 유지**(health-up인데 토큰 만료면 401 폭주하던 갭 정정). **폴링이 401 감지 시 "재연결 중"에 갇히지 않고(네트워크실패 오인 금지) 오버레이 해제 → A84 재인증(런처 링크·bootstrap 재교환) 동선**으로 전환. 모든 연결끊김(재시작·종료·네트워크)에 전역 적용 | 횡단(F3 재시작·인증) |
| A95 | **F4 검색 절단 고지+복구(오해 방지·UX-R1-#3):** API `truncated:true`(스캔 상한 도달)를 UI가 **"최근 5000개 상한 도달 · 더 오래된 이력 생략" 경고 라벨+툴팁**으로 표시(0/부분 결과를 "이력 없음"으로 오해 금지). **경고에 검색 범위 + 복구 행동 안내("기간(from/to)을 좁혀 재검색")**(A82/A88 강화) — 데드엔드 해소는 A96(기간 파티셔닝) | F4 |
| A96 | **F4 오래된 이력 도달성+시각 도메인 통일(데드엔드·도메인 불일치 정정·UX-R2-#2·R3-#1):** `from`/`to`·정렬·파티션·표시를 **`recordedAt`(FS-time birthtime/mtime) 단일 도메인으로 통일**(구 from/to=manifest createdAt ↔ 파티션=FS-time 불일치 → 복사/복원 run 경계 누락 정정). `from`/`to` 지정 시 [from,to] `recordedAt` 겹침 구간을 상한까지 스캔 → 상한 밖 오래된 run **도달 가능·경계 누락 0**. 라벨 "기록 시각(파일시스템)"·manifest `createdAt`은 상세 병기(괴리 주석). UI: 기간 프리셋(24h/7d/전체)·"기간 좁혀 재검색" | F4 |
| A97 | **첫 실행 준비 데드엔드 방지(UX-R2-#4·UX-R2-#6):** (a) **projectsHome 미프로비저닝** 시 Settings 빈 상태에 **정확한 프로비저닝 액션**(런처/설치가 `HARNESS_PROJECTS_HOME` 설정·재시작 명령·**감지된 경로 후보 확인**) — 갓 설치 사용자 차단 금지. (b) **claude/codex 런타임 미설치**를 Ops뿐 아니라 **전역 App shell 배너로 승격 + New Run/Ask Agent 제출 비활성 + 툴팁(Ops 링크)** → 폼 다 채우고 제출서야 실패하는 마찰 제거 | 횡단(첫 실행·Build·Settings) |
| A98 | **F5 대용량 다운로드 413(손상 정정·UX-R2-#5):** `ARTIFACT_MAX`(8MB) 초과 시 **스트림 중간 중단 금지**(브라우저 "Network Error"·조용한 부분파일 손상 유발) → `fstat.size`를 **스트림 시작 前 검사해 `413 Payload Too Large` 즉시 반환**(DV6 강화). UI가 413 포착 → **"파일이 너무 큼 · 로컬에서 열기" + 로컬 절대경로 표시**(OS로 직접 열기 안내) | F5 |
| A99 | **F3 활성 run 고아 통제(토큰소진 정정·UX-R2-#7):** projectRoot 변경+재시작 시 활성 run이 **헤드리스로 계속 실행·API 토큰 소진·UI 통제 상실**(경고만으로 부족) → 확인 다이얼로그에 **명시적 선택: "활성 run 취소 후 재시작"(cancel·A18 경로) 또는 "헤드리스 계속 승인"**(activeRunsWarning>0 배선·A101 dryRun 프리뷰로 표시) | F3 |
| A100 | **F2 도구 조용한 드롭 금지(오도상태 정정·UX-R4-#1):** UI를 **에이전트 정의 D 선언 도구 체크박스로만** 구성(자유입력 없음 → `U⊆D` 구조 보장)·요청 U에 D 밖 도구 있으면 **`400 unauthorized-tool` 명시 반려(조용한 드롭 금지)**·헬퍼 "선언한 도구만 선택 가능". 보안 불변식(U⊆D) 무변경·표현만 정정 | F2 |
| A101 | **F3 config 쓰기 순서(비가역 오동작 정정·UX-R4-#2):** `POST /api/settings/project-root` **`dryRun` 플래그** — `dryRun:true`=디스크 미변경·검증+activeRunsWarning **프리뷰 반환** / 사용자 확인(A99) 후 `dryRun:false`=실제 쓰기. **취소 시 config 디스크 무변경**(구 "즉시 쓰고 사후 경고" 정정) | F3 |

**UX 수용기준: A81-A101(21개)** — 기능계약(A47-A80) 무변경·UX 레이어. RF3(A87)·RF5(A87)·RF4(A88) 채택. **UX-R1(agy): A93·A94·A95.** **UX-R2(codex+agy): A94/A90/A95 강화·A96·A97·A98·A99.** **UX-R3(codex): A96 시각 도메인 통일(recordedAt).** **UX-R4(agy): A100(F2 조용한 드롭 금지·체크박스+400)·A101(F3 dryRun 쓰기 순서).** codex R4 no-high.

### F8 수용기준 (A102~ — Eval 평가 대시보드·자기개선 제안·지표관리 · 측정가능)
| # | 기준 | M | Part |
|---|------|---|------|
| A102 | Part A 소스 안전(R2-#1·R3-#1·R3-#3·R5·R7·통합감사 R3): **전 `GET /api/evals*` = side-effect 0(순수 조회·ingest/서명/append 안 함)·ingest는 서버 백그라운드 잡(자동·요청 무관)/`POST /api/evals/rebuild`(수동·mutating 게이트)로 분리**·**추세는 신뢰 `<state_home>/evals-rollup`(체인 검증)에서만**(`_workspace/summary.jsonl`=표시 소스 아님·"미검증")·**ingest = 서버 재도출-후-서명(판정 원장 `verdicts.json`서 집계 직접 재계산·`_workspace` precomputed 신뢰 안 함·재계산 불일치 격리·자기일관 위조 oracle 차단·R7)**·**이후 과거 scorecard 무결성=rollup digest 매칭(현재키 재검증 안 함→회전 무브릭·R5)**·`_workspace` 파일=표시용(digest 불일치=상세 "변조"·게이트 브릭 없음)·**events/metadata read=F4 공용 경화 바운드-리더(realpath 앵커·전 하위 세그먼트 심링크/reparse 거부·O_NOFOLLOW·containment·A50·통합감사-#3)**·graceful(500 금지) | M13 | A |
| A103 | **`alignment_score` ≠ 품질 정직 라벨:** "정합도(품질·리뷰어 정밀도 아님)" 배지+산정식 툴팁·`quality_label`은 "LLM 해석"으로 분리·`missed_defect_rate`/`overturned_rejection_rate`=null → **"미측정(외부 GT 필요)"**(0/품질 위장 금지·F6 준용) | M13 | A |
| A104 | 빈 상태 데드엔드 방지(UX-R1-#1): **미실행 = "평가 루프가 아직 실행되지 않음"(고장 아님) + 실행 위치/방법·관련 문서 CTA**·**`eval-unavailable` = 원인(예 jq 부재)+설치·재시도 절차**·데이터 부족 = "N회 더 필요"(A82 준용) — "데이터 없음"만 표시 금지 | M13 | A |
| A105 | 악화 트리거 제안: `alignment_score` **3연속 하락**(rolling·단일 노이즈 무시)·`rounds_normalized` 상승·`overturned_rejection_rate` 임계초과·동일 경계 N회 실패 → 근거 scorecard 인용 제안 카드. **카드 렌더 DV8(sanitizer·CSP·XSS 차단·R1-#5)·scorecard=데이터(지시 흡수 금지)·provenance(소스경로·run id·computed_by·검증상태·표본수·트리거) 표시**·무근거 제안 금지 | M13 | B |
| A106 | **하드 게이트 = 체인 rollup 실데이터(비협상·R1-#2·R2-#2·R3-#2·R4-#1):** **불변 append-only rollup**(`<state_home>/evals-rollup`·서버만 append)에서 도출 — **과거 무결성=해시체인(prev-해시+seq·키불요)·진위=head(+현재키 엔트리) HMAC**(회전 후 과거 엔트리 브릭 없음·R4-#1)·엔트리는 scorecard digest 결속·durable commit 후 append. 실제 adjudicated ≥30 ∧ 관측 ≥`rollingN` ∧ 연속하락 ≥`declineStreak` 시 발화(29·9·null → 금지)·**게이트 fail-closed 트리거 = rollup 자체(체인 링크 불일치·seq gap·head 서명 불일치·절단)만**·**게이트는 gate-time에 `_workspace`를 읽거나 digest 비교 안 함(R6)** — rollup 엔트리에 내장된 검증 파생값만 사용(회전 무브릭·R5)·**`_workspace` 사후 변조는 게이트 영향 0(표시전용)**·단계<3 비활성. (state_home 조율 rollback = 게임오버·F8.8 스코핑) | M13 | B |
| A107 | 제안→적용 = **서명 envelope+durable nonce+게이트 재평가(R2-#4·R3-#4·R3-#5·R4-#2·통합감사-#4·R2-#2/#3):** envelope = **canonical payload+pathId+baseHash+근거 digest+`evals-config 해시`(Part C `evals`만·운영 플래그 `definitionEditEnabled`/`projectRoot` 제외→토글 데드락 0·R2-#2)** HMAC 서명(가변 rollup-head 미결속·R4-#2)·**적용은 `PUT …/definition` body `evalProposal:{nonce,envelope}`로 결속→F7 DW11 실집행**(**nonce 발급=`POST …/prepare`(GET 아님)·`issued→applying→consumed` 원자 상태머신·멱등 재시도(크래시 유실 0·중복적용 0·R4-#2)**·envelope 서명·evals-config 해시 일치·A106 재평가·**주입 content==envelope canonical payload 정확 일치**)·**edit/proposal 분리(R2-#3): 일반 편집은 상시 허용(우회 아님)·envelope는 "승인된 제안" 주장에만 강제·evalProposal 없는 제안 적용 불가**·nonce 1회·별도 저장·**자동 적용 금지·Stage 4 쓰기 없음**·payload/타깃/evals-config 불일치/재평가실패/nonce재사용 → 거부(`409 stale`)·no-auto-apply(`tools`·`skills`)·audit·**UX(A112·UX-R1-#3): CTA="편집기에서 검토·저장"·"미적용" 유지** | M13 | B |
| A108 | 단계 4(자동 환류) = **v0.6 쓰기 불가·display-only 잠금**(설계만·실험 배지)·holdout·명시 옵트인은 v0.7 | M13 | B |
| A109 | `GET/POST /api/evals/config`: 채택 단계·per-metric enable/가중치·임계값(minAdjudicated·rollingN·declineStreak·리스크별 θ)·정규화 파라미터 관리. **쓰기 수용 `adoptionStage∈{1,2,3}`만(4→400·R1-#1)** | M13 | C |
| A110 | 저장 = **F3.7 확장(`evals`)·`.passthrough()`+per-leaf 독립 safeParse·`evals` 서브객체도 재귀 leaf-wise(통째 파싱 금지·한 잎(threshold) 손상이 형제(weight/metrics) clobber 안 함·R2-#1)·`rollingN` 손상이 형제 `minAdjudicated:50` 리셋 안 함(R1-#6/R2-#5/R4-#4)·effective threshold=`max(값, floor)`(floor 30/10/3 미만 불가)**·원자 RMW·뮤텍스·fail-closed·mutating 게이트. **UX(A112·UX-R1-#4): 입력 옆 최소 30/10/3 상시 표시·floor 미만 인라인 거부(silent clamp 금지)·old→new/effective diff·적용값 피드백** | M13 | C |
| A111 | 단계 3 전환(제안 활성) = 고위험 확인 다이얼로그(experimental·A85)·**Stage 4 쓰기 제거(display-only 잠금·R1-#1)**·**min 하한(30/10/3) 낮출 수 없음(Zod `.min()`·게이트 우회 금지)**·env override 미해당 | M13 | C |
| A112 | Eval 화면 UX(A81-A101 준용): 빈/로딩/에러(A104)·**비활성 이유**(단계<3 "제안 비활성"·Stage 4 "잠금 사유"·데이터 부족)·**무결성 상태=영향+복구(UX-R1-#2·UX-R2):** "상세 파일 불일치 — 추세·게이트는 검증된 rollup 사용(안전)"·격리 건수/대상/원인·"변조" 배지 툴팁("로컬 파일 변경·신뢰 원장 무결·게이트 영향 없음")·**"rollup 무결성 훼손 — 제안 차단"은 복구 CTA 필수(UX-R2·UX-R3·데드엔드 금지):** (a) **진단**(실패 엔트리/seq/head)·(b) **복구="원장 재구축·재검증" = 독립 서명 ingest-receipt(keyId·키링 재검증) 통과분에서 rollup 재생성**(재도출-후-서명·위조 재유입 0·현재 `_workspace` 재신뢰 금지·UX-R3)·(c) **독립 소스 전무(rollup 손상∧receipt 없음) → 재구축 불가 사유 + 명시 리셋만**(미검증 `_workspace` 재신뢰 금지·이력 상실 사용자 명시 승인)·비악의 훼손만(조율 rollback은 F8.8 게임오버)·**승인/적용 분리(UX-R1-#3):** CTA="편집기에서 검토·저장"(승인 아님)·전환 前 "아직 적용되지 않음"·저장 전 "미적용" 유지·**임계 floor UX(UX-R1-#4):** 입력 옆 최소 30/10/3 상시 표시·floor 미만 저장 전 인라인 거부·old→new/effective diff·적용값 피드백·**확인 대상=단계3 전환 + 지표/정규화 변경(Stage 4는 비활성 사유만)**·alignment≠품질 라벨·읽기(A/B)/쓰기(C) 경계 | M13 | A/B/C |

**F8 수용기준: A102-A112(11개)** — Eval 화면. self-eval 교리(alignment≠품질·자동 금지·하드 게이트·단계 3/4 실험) 비협상. 전체 A47-A112 = 기능 A47-A80(34) + UX A81-A101(21) + F8 A102-A112(11).

### F9·F10 수용기준 (A113~ — 후속 편입 · 측정가능)
| # | 기준 | M | 기능 |
|---|------|---|------|
| A113 | config additive `docsSources:{label,path}[]`·`docsMenuEnabled:boolean`·loadConfig per-leaf 복구(손상 소스만 드롭·형제 config 필드 보존·per-entry safeParse·RMW 전 필드 보존) | M14 | F9 |
| A114 | 소스 경로검증(DS1~DS6): projectRoot 하위 상대만·절대/`~`/`..`/UNC 거부·per-seg isSafeSegment·realpath containment·전 세그먼트 심링크/reparse 거부·deniedDocsPath 재적용·fail-closed 400 | M14 | F9 |
| A115 | 소스 개수(`MAX_DOCS_SOURCES`)·경로/라벨 길이 상한·중복 병합·Zod strict(초과 400) | M14 | F9 |
| A116 | `GET /api/docs/sources`·`?source=<id>` 트리·기본 소스=`docs` 하위호환(무인자 200)·무효 source 400 | M14 | F9 |
| A117 | 소스 하위 열람=F5 DV2~DV9 전건 재적용(openSafeFile 앵커=소스 base·경로탈출/심링크/바이너리/크기상한/XSS/CSP)·**열람 시점 realpath 재검증(DS7·TOCTOU)** | M14 | F9 |
| A118 | docsMenuEnabled 토글: on→메뉴 노출·off→숨김/비활성+이유 툴팁(A81) | M14 | F9 |
| A119 | (UI) Settings 소스 편집기 추가/삭제/재정렬·dryRun 검증(DS6)·인라인 에러 | M14 | F9 |
| A120 | (UI) Docs 다중 소스 드롭다운·소스별 트리·빈/로딩/에러 3-state·소스 0/무효 CTA | M14 | F9 |
| A121 | 읽기 화이트리스트(HR1~HR4·**멀티런타임**): CLAUDE.md·AGENTS.md·GEMINI.md(projectRoot 직속)·**`.claude/agents/**`·`.claude/skills/**`(Claude)·`.codex/agents/**`(Codex)·`.agents/skills/**`(Codex/agy)만**(각 dot-dir 전체 재귀 아님·정밀 서브루트만·`.claude/settings.json`·`.codex/config`·`.claude/tmp` 등 스크래치 차단)·**`.claude`·`.codex`·`.agents` 세 dot-dir만 정밀 허용**·그 외 dotfile(.env/.git/.ssh/.gemini) 거부·**전 세그먼트 심링크/reparse(Windows junction/mount) 거부**·secret denylist·**projectRoot 밖(`~/.gemini` 등) 원천 거부** | M15 | F10 |
| A122 | 파일 열람 HR5=F5 DV8(sanitizer·CSP·scheme 화이트리스트·외부리소스 차단·크기상한·바이너리 거부)·**md·TOML 텍스트 렌더(실행 안 함)** | M15 | F10 |
| A123 | 편집=F7 GET/PUT/rollback 재사용(DW1~DW11·definitionEditEnabled 게이트)·**CLAUDE.md/AGENTS.md/GEMINI.md 쓰기 라우트 없음(읽기전용)**·포인터=스니펫 복사 안내 | M15 | F10 |
| A124 | 빌드 초안(HB1~HB4·HB7·HB8): 폼(도메인·역할)→초안 반환·**디스크 미기록**·bounded 입력·읽기전용 컨텍스트만·execFile+argv(I3)·shell 금지·**초안=데이터(주입 방지)**·게이트·**in-flight 동시 1개+쿨다운(비용폭주/DoS 차단·429)** | M15 | F10 |
| A125 | 초안→diff→사람 승인→F7 저장(canonicalize+무결성+원자+낙관적 동시성)·**자동 적용 0(no-auto-apply)**·초안 무결성 위반 400 | M15 | F10 |
| A126 | 신규 정의 생성(HB5·HB6·**신규 구축**): leaf 미존재 확인·부모 심링크 거부·skill dir mkdir 안전·이름 충돌 409·`.claude/agents·skills` 스코프 밖 생성 400 | M15 | F10 |
| A127 | 쓰기스코프 경계(I8): `.claude/agents·skills`+신규 생성만·CLAUDE.md/AGENTS.md/GEMINI.md/docs/** write 차단·빌드 exec 프로젝트 파일 쓰기 0 | M15 | F10 |
| A128 | (UI) Context 페이지(11번째): 멀티런타임 읽기 트리(**런타임 배지·필터** claude/codex/agy)·F7 편집(Claude만)·Codex/agy=읽기전용 뷰 배지·빌더 폼·diff 승인·"미적용 초안" 유지(A107 준용·유실 방지)·스니펫 복사·3-state·접근성 | M15 | F10 |
| A129 | **멀티런타임 자동 수집·뷰(읽기)**: 3 런타임 스킬=동일 SKILL.md 리더·Codex 에이전트=TOML 텍스트 뷰·트리에 **런타임 배지**(claude/codex/agy·`.agents/skills`=codex/agy 공유)·런타임 필터·**트리 바운드 `MAX_CONTEXT_NODES`(F4/F5 동등)+`deniedContextPath`에 `node_modules`·`venv`·`.venv`·`__pycache__`·`dist` 포함**(스킬 dir 내 패키지 환경 무제한 순회 차단·R7 agy HIGH) | M15 | F10 |
| A130 | **편집=Claude 스코프만(HR6)**: PUT/rollback·신규생성은 `.claude/agents·skills`만·Codex(`.codex`·`.agents/skills`)·agy·GEMINI.md 편집 요청 → **`409 <runtime>-edit-v0.7`**(읽기전용 뷰·duo drift/TOML 정규화 미비로 v0.7)·읽기 확장이 쓰기 스코프 안 넓힘(I8 회귀) | M15 | F10 |

**F9·F10 수용기준: A113-A130(18개)** — F9 소스설정(A113-A120·8) + F10 컨텍스트/빌더(A121-A130·10·멀티런타임 A129·A130 포함). 전체 A47-A130 = 기능 A47-A80(34) + UX A81-A101(21) + F8 A102-A112(11) + **F9 A113-A120(8) + F10 A121-A130(10)** = 84개.

## 위협 스위트 (거부케이스 — 감사 검증용)
| 스위트 | 케이스(전건 거부/차단) | 기준 |
|--------|------------------------|------|
| F4-쿼리·리더 | `q=(a+)+`·`q=.*`(리터럴·ReDoS 없음)·`state=<임의문자열>`(400)·`limit=99999`(clamp)·`MAX_RUNS_SCAN` 초과(truncated)·대량 디렉토리(상위 N read)·초과크기 manifest(skip)·malformed/stat불가 runId(quarantine)·**심링크/reparse run dir(공용 경화 리더 거부·`_workspace` 밖 리다이렉트 차단·통합감사-#3)**. **ACCEPT: UUID·`run-10`도 FS시간 최신 N 정확** | A48·A49·A50·A51 |
| F5-뷰어 | `../../etc/passwd`·`/etc/passwd`(절대)·심링크→`/etc`·**in-root 심링크**·중간 세그먼트 스왑·`docs/../.git/config`·`.env`·`~/.ssh/id_rsa`·화이트리스트 밖(`harness-ui/src/..`)·바이너리·**초과크기(미리보기+다운로드)**·**XSS(`<script>`·`onerror=`·`javascript:`·`data:`·원격 `<img>`·SVG 스크립트)** | A54·A55·A56·A57·A58 |
| F2-에이전트 | `name=../foo`·`name=a b`(경로주입/메타)·**D 밖 allowedTools 주장(400 반려·상향 불가)**·**template↔제출 사이 정의 삭제/변경 후 allowedTools 제출(제출 시점 D 재도출·`409 agent-definition-changed`·천장우회 차단·통합감사 R4-#1)**·삭제된 에이전트 태그(형식검증만·무해) | A64·A65·A66 |
| F3-root | 상대경로·`..`·`~/proj`·`\\host\share`·`C:foo`·미정규화 유니코드·**projectsHome 하위 상대 세그먼트 심링크(탈출)**·**Windows junction/reparse/mount 하위 세그먼트**·**쓰기가능 민감디렉토리 위조 마커**·projectsHome 밖·검증후 스왑·**부팅 unsafe-env(폴백)**·미프로비저닝(409). **ACCEPT(오거부 금지): `/var`·`/tmp` 등 절대 상위 심링크를 통과하는 정상 projectsHome 하위 경로** | A68·A69·A70 |
| F7-편집(mutating) | **REJECT**: 쓰기 경로탈출(`.claude` 밖·`../`)·심링크 대상 write·화이트리스트 밖 확장자/위치·초과크기·**필수(name/description) 누락**·YAML 파싱실패·**name 리네임**·stale baseHash(409)·게이트 off PUT(403)·Origin 위조·백업 traversal(논리name 보간)·백업 심링크·폴리글롯/멀티도큐먼트/앵커/중복키·중복 name(409 ambiguous)·pathId 불일치(409)·stale 롤백·손상/심링크 백업·손상 config→게이트 off·**직렬화본 런타임 리더 divergence(F7.8 게이트)**·config 필드 clobber. **ACCEPT(오차단 금지·R4-#2/#3): 본문 `---`(수평선·코드펜스)·옵션필드(role/tools/skills/triggers/references)·미지필드(passthrough 보존)** | A72·A73·A75·A76·A77·A78 |
| F8-Eval | 경로탈출·심링크·대용량·**미서명/서명불일치·수학 모순 scorecard(격리)**·**자기일관 위조 aggregate(precomputed `verdict_counts`/`alignment_score`→서버 원장 재계산 불일치 격리·R7)**·**스크립트 자가서명·키 재생성(서버 서명만·R3-#1)**·**scorecard XSS(→DV8)**·**게이트 우회: 29·9·null·flood·절단창·rollup 체인 링크 불일치/seq gap/head 서명 불일치/절단(fail-closed·R3-#2)**·**ACCEPT(브릭 0·R4-#1·R5·R6): 키 회전 후 과거 rollup 엔트리·과거 scorecard·활성 window `_workspace` 사후 변조 어느 쪽도 신규 제안 브릭 0(무결성=해시체인/rollup digest·게이트는 rollup만·gate-time `_workspace` 재읽기 없음)**·**_workspace 가짜 추세 UI 기만(rollup 소싱·R3-#3)**·**config<floor·형제 손상→floor 밑(per-leaf+max·R2-#5)**·**Stage 4 쓰기(400)**·**envelope payload 불일치/타깃 교체(가변 rollup-head 미결속·R4-#2)·config stale(409)·nonce in-session replay(durable·R3-#4)**·**envelope 없는 제안 적용(F7 일반 편집 우회 차단·DW11·통합감사-#4)**·**config writer가 evals/projectsHome clobber(canonical 전 필드 RMW 차단·통합감사-#1)**·**evals 한 잎(threshold) 손상→형제(weight/metrics) clobber(재귀 per-leaf 거부·R2-#1)**·**심링크 run dir(공용 경화 리더·앵커 파라미터·통합감사-#3·R2-#4)**·**GET이 ingest/상태변경(side-effect 0·거부·통합감사 R3)**·**미인증 ingest/nonce 발급(mutating 게이트·GET 발급 불가·R4-#2)**·**크래시 후 승인 제안 유실(멱등 상태머신 `issued→applying→consumed`·유실 0)·재시도 중복적용(멱등 판정·중복 0·R4-#2)**·단계<3 제안·alignment 품질 오표시. **ACCEPT(정당 흐름 브릭 0): `definitionEditEnabled` 토글이 대기 제안 무효화 안 함(envelope=evals-config만·R2-#2)·일반 편집 상시 허용(우회 아님·R2-#3)**. **OUT-OF-SCOPE(게임오버·F8.8): `<state_home>` {rollup,head}/nonce 조율 rollback(cross-restart)** | A102·A105·A106·A107·A110·A111 |
| F9-소스 | 소스 경로: 절대경로·`~`·`../탈출`·projectRoot 밖·심링크 base·denylist 디렉토리(`.git`/`.ssh`)·개수/길이 초과·열람 시점 심링크 스왑(DS7). 열람: 소스 하위 `../`·심링크·바이너리·초과크기·XSS(F5 DV 소스별 재적용). **ACCEPT: 기본 `docs` 무인자 하위호환·정상 상대 소스** | A114·A115·A116·A117 |
| F10-컨텍스트/빌드 | 읽기: `.git/config`·`.env`·`~/.ssh/id_rsa`·`~/.gemini/**`(홈)·`.gemini`·`.codex/config`·화이트리스트 밖 dotfile·`../`·**심링크/reparse(junction/mount)→외부**·projectRoot 밖·**스킬 dir 내 `node_modules`/`venv`/`__pycache__` 대량 순회(트리 `MAX_CONTEXT_NODES` 초과·denylist)**. 편집: **Codex(`.codex`·`.agents/skills`)·agy·GEMINI.md PUT → 409 `<runtime>-edit-v0.7`**·CLAUDE.md/AGENTS.md write·docs/** write·`.claude` 밖 생성·신규생성 부모 심링크·이름충돌(409)·스코프 밖(400). 빌드: 초안 입력 shell 메타/과대·초안 자동적용(승인 없이 저장 0)·초안 파일쓰기/실행 트리거·프롬프트 주입·동시 2요청 429. **ACCEPT(읽기): `.claude/agents·skills`·`.codex/agents`(TOML)·`.agents/skills`(SKILL.md) 정상·CLAUDE/AGENTS/GEMINI.md 열람·본문 `---`·passthrough 필드**(단 각 dot-dir 직속 설정·`.claude/tmp`·기타 dot는 거부) | A121·A123·A124·A125·A126·A127·A129·A130 |

**거부케이스 총 125+**(F4:8+·F5:12·F2:6+·F3:12+·F7:23+·**F8:44+**·**F9:10+**·**F10:12+**·통합감사 R1~R4 포함·state_home 장악 out-of-scope·ACCEPT 케이스 별도).

## 가정 (assumption — 근거 미확정 격리)
| # | 가정 | 상태 | 미해결 시 영향 | 확인 |
|---|------|------|----------------|------|
| AS1 | 실 CLI가 events에 `agent`/`skill`/`usage`를 일관 방출 | **부분(스키마 선반영·실 방출 미검증)** | measured 미부여→`unattributed` 강등(승격 금지)·per-value 라벨로 정직 노출 | M9 **CLI 픽스처 수용기준화**(usage 유/무 샘플·A61) |
| AS2 | claude team 서브에이전트별 usage 분해 불가 | 가정(설계 전제) | agent별 상한 estimated(measured 승격 금지) | §F6.2 라벨 |
| AS3 | on-read 집계가 로컬 run 규모에서 성능 충분 | 가정 | 규모 폭증 시 rollup.json 최적화 이월(F6.3)·F4 바운드 열거로 상계 보장 | 실사용 관측 |
| AS4 | Windows `O_NOFOLLOW`·`lstat` junction 미탐 | 알려진 한계(강화) | D3 reparse point 속성 감지 + D2 정규 조상 walk(realpath)로 리다이렉션 차단(lstat 단독 비의존) | 3-OS CI |
| AS5 | ~~D6 허용경계 (a)/(b) 미확정~~ **해소:** 신뢰경계 = 단일 projectsHome containment 확정. **마커는 경계 아님**(위조 가능) | **확정(R1-#4)** | — | §F3.2 |
| AS6 | ~~canonical YAML 등가 가정~~ **릴리스 게이트로 승격(R3-#2c)·명세 확정(R4-#5)** — 등가를 가정하지 않고 **F7.8 differential 게이트로 증명**(리더 버전 핀·픽스처 코퍼스·정규화 JSON zero-divergence·CI 명령) | **게이트화·실행가능(가정 아님)** | divergence 시 정규화 스키마 축소(단순 `key: value`) | M12 F7.8·A75 `npm run test:def-differential` |
| AS7 | F7은 로컬 단일사용자에서 편집자=실행자(권한 상향은 명시적 2단계) | 위협모델 전제 | 다중 사용자면 편집-실행 분리 재검토(v0.6 비대상) | §DW9 |
| AS8 | F8 서명키는 **UI 서버 배타 보유**(스크립트 미제공·`O_EXCL`·0600·재생성 금지)→**서명 주체=서버**. **정상운영 검증=chain+head(구키 불요·회전 브릭 0·R4-#1·R5)**·**키링에 전 이력 키 보존(재구축 재검증 전용·정상운영 미사용·R3-UX)** — 둘 정합(정상=head-HMAC+체인·재구축=키링+독립 receipt) | 아키텍처 전제(R3-#1·R5·R3-UX) | 키 누출·자가서명 시 위조→서버 서명만 신뢰·미서명=ingest 거부·**재구축은 독립 receipt+키링 통과분만**(미검증 `_workspace` 재신뢰 금지·독립 소스 전무 시 명시 리셋만) | M13 서명·키링·재구축 픽스처 |
| AS9 | 체인 rollup(해시체인=과거 무결성·head HMAC=진위)·durable nonce는 **`_workspace` scorecard 위조·in-session rollback**을 방어. **`<state_home>` 조율 rollback(구 {rollup,head}/nonce 스냅샷 replay)은 out-of-scope(게임오버·F8.8)** — HMAC은 진위이지 신선도 아님(과claim 제거·R4-#3) | 아키텍처 전제·**정직 스코핑** | state_home 쓰기=서버 장악=게임오버·cross-restart rollback out-of-scope 명시 | M13 체인·nonce·watermark best-effort 픽스처 |
| AS10 | **서명·재도출은 무결성이지 진실성 아님(R7·교리 정직):** F8은 위조·사후변조·cross-run 오염을 막으나 판정 원장(`verdicts.json`) 자체가 오케스트레이터 자기판정 = 약증거(`loop-self-eval.md`) → **"자기채점을 참으로 만들지 못함"(구조적 한계)** | 교리 전제·**정직 한계** | 최종 방어 = **사람 승인 backstop**(제안≠자동적용·F7 승인·A107)·독립 ground-truth(missed_defect_rate)=v0.7 | §F8.8·A107 |

## 마일스톤 (정본 M1-M6 이어서 · 게이트=codex+agy)
- **M7 — F4 Runs 조회/필터/검색**(새 주축·읽기전용·먼저): manifest 병합 스캔 델타·Zod 쿼리·리터럴 검색·바운드·UI 필터바. **DoD: A47-A52 + F4-쿼리 스위트.** 파일 무변경·회귀 0.
- **M8 — F5 문서/artifact 뷰어**(경로탈출·XSS 중대): DV1-DV9·docs API·뷰어 UI(sanitized 렌더). **DoD: A53-A59 + F5-뷰어 스위트**(경로탈출/in-root 심링크/민감파일/바이너리/초과크기/XSS 전건 거부).
- **M9 — F6 관측성 계층 B**(읽기전용 집계): metrics API·신뢰등급·바운드 on-read·Overview/Agents/Skills 편입. **DoD: A60-A63 + AS1 스모크·estimated 라벨 회귀.**
- **M10 — F2 에이전트 프리필 New Run**(저위험): run-template·프리필폼·단일경로 재사용. **DoD: A64-A67 + F2-에이전트 스위트.** 새 실행계약 0.
- **M11 — F3 projectRoot 편집**(보안 자기완결·독립 배포 가능): D1-D8·config 지속·부팅 precedence·Settings 폼. **DoD: A68-A71 + F3-root 스위트.**
- **M12 — F7 정의 편집기**(첫 mutating·최대 공격면·**방어 확실히 된 뒤 마지막**): DW1-DW10·이름→경로 서버해소·무결성 검증·원자쓰기·낙관적 동시성·롤백·스코프 게이트·Agents/Skills 편집기. **DoD: A72-A80 + F7-편집 스위트**(쓰기 경로탈출/심링크write/무결성/stale-write/게이트off 전건 거부) + I8 예외 경계 회귀(F4-F6 여전히 읽기전용 assert).
- **M13 — F8 Eval(평가 대시보드·제안·지표관리)**: Part A(읽기·**서버 서명 검증·수학 교차검증·추세=rollup 소싱**)·Part B(**해시체인+head HMAC rollup 게이트·서명 envelope(config 결속·head 미결속)+durable nonce+게이트 재평가·자동 금지**)·Part C(config **per-leaf+floor**). **DoD: A102-A112 + F8-Eval 스위트**(스크립트 자가서명/체인 링크·seq·head 불일치/절단/config stale(409)/_workspace 가짜 추세/floor 밑 리셋 거부·**키 회전 후 과거 엔트리 브릭 0·활성 window `_workspace` 사후 변조 게이트 영향 0(R6)**·**대기 중 rollup append돼도 게이트 만족 시 도달 가능**·자동 적용 금지) + **교리 회귀**(alignment≠품질·floor 불가·단계<3 비활성) + **암호 픽스처**(서버 키·회전·체인·durable nonce·**신뢰 도메인 경계 F8.8**·AS8/AS9). 읽기=비가역 없음·적용=F7·config=가역.
- **M14 — F9 Docs 소스 설정**(표준·읽기전용 확장): config additive(docsSources/docsMenuEnabled·per-leaf 복구)·소스 경로검증(DS1~DS8)·소스 인지 `/api/docs*`·Settings 편집기·메뉴 토글. **DoD: A113-A120 + F9-소스 스위트**(경로탈출/심링크/개수·길이 전건 거부·기본 소스 무인자 하위호환·열람 시점 TOCTOU 재검증) + I8 회귀(F5 읽기전용·config만 쓰기).
- **M15 — F10 하네스 컨텍스트 관리 + 빌더**(중대·마지막): **멀티런타임 읽기 화이트리스트**(HR1~HR7·`.claude`·`.codex`·`.agents` 3 dot-dir 정밀+CLAUDE/AGENTS/GEMINI.md·런타임 배지)·편집(F7 재사용·**Claude 스코프만**·Codex/agy=읽기전용 뷰 409)·빌드 초안 surface(HB1~HB8·bounded·no-auto-apply·동시성)·신규 생성(신규 구축)·Context 페이지(11번째). **DoD: A121-A130 + F10 스위트**(멀티런타임 읽기 탈출/dot-prefix 오허용·**전 세그먼트 심링크/reparse 거부**·**트리 `MAX_CONTEXT_NODES`+`node_modules`류 대량 dir 차단**·Codex/agy·GEMINI.md 편집 409·빌드 exec 주입/DoS·신규생성 경로탈출·CLAUDE/AGENTS/GEMINI.md write 차단·no-auto-apply 전건 거부) + I8 경계 회귀(**읽기 확장이 쓰기 스코프 안 넓힘**).

## 리스크·비가역성 (정본 §8 이어서)
| 리스크 | 등급 | 완화 | 검증 |
|--------|------|------|------|
| F5 뷰어 XSS(raw HTML·javascript:·원격 리소스) | **중대** | DV8: raw-HTML 비활성·sanitizer·scheme 화이트리스트·외부리소스 차단·CSP·nosniff·SVG 비렌더 | M8 F5 스위트(XSS 케이스) |
| F5 경로탈출(임의 파일 read) | **중대** | DV1-DV9 다층·화이트리스트(docs/runs 고정)·**전 세그먼트 심링크 무조건 거부**·denylist·바이너리 거부·응답 하드 크기상한 | M8 F5 스위트 |
| F3 경로탈출(임의 root read/실행) | **중대** | **단일 projectsHome containment(마커는 경계 아님)**·D1-D8·reparse/junction 거부·TOCTOU 재확인(D7)·env 부팅검증·재시작모델 | M11 F3 스위트 |
| F4 ReDoS/OOM | 표준 | 리터럴 검색(regex 미컴파일)·스캔 바운드·크기상한 | M7 F4 스위트 |
| F6 과대표시(추정→정확 오인) | 표준 | measured/estimated 비협상 라벨·unattributed 버킷 | M9 A61/A62 |
| F2 allowedTools 무단 확장 | 표준 | suggested≠실행·확인분만·Zod 재검증·서버 재도출 | M10 A65 |
| F3 활성 run 중 root 변경 고아 | 표준 | 재시작모델·activeRunsWarning·라이브 재바인딩 비목표 | M11 A71 |
| **F7 쓰기 경로탈출(임의 파일 write·최대 공격면)** | **중대** | DW1-DW10: 스코프 게이트·이름→경로 서버해소·`.claude` 화이트리스트·projectRoot 하위 세그먼트 심링크 거부·백업 opaque 파일명·원자쓰기·게이트 off 기본 | M12 F7 스위트 |
| **F7 손상/폴리글롯 정의(파서 differential·실행 오염)** | **중대** | DW5: strict YAML(폴리글롯 거부)+정규화+**완전 스키마 passthrough(실필드 보존)**+name불변·**등가는 F7.8 실행가능 differential 게이트(zero-divergence·CI)** | M12 A75 |
| F7 lost-update(동시 편집 덮어씀) | 표준 | DW6 baseHash 낙관적 동시성 409·DW7 `.bak` 롤백·diff | M12 A76 |
| **F8 자기채점 오용(Goodhart·자동 개악·자동 tool 주입)** | **중대** | **자동 적용 금지·Stage 4 쓰기 제거**·**서명 envelope(config 해시 결속·가변 rollup-head 미결속·R4-#2)+durable nonce·F7이 payload==승인·config 해시 일치+A106 현재 rollup 재평가**(은밀 교체/replay/stale 거부)·no-auto-apply에 **tools·skills** | M13 A106·A107·A108 |
| **F8 scorecard 위조·XSS·DoS·flood(반신뢰 `_workspace` 산출물)** | **중대** | **서버 재도출-후-서명(원장서 집계 재계산·precomputed 거부·자기일관 위조 oracle 차단·R7)·키 미제공·O_EXCL·ingest만 HMAC→이후 무결성=해시체인/rollup digest(회전 무브릭·R5)·게이트는 rollup만·gate-time `_workspace` 재읽기 없음(R6)**·수학 교차검증·DV8·추세 rollup 소싱. **원장=자기판정 약증거→사람 승인 backstop(F8.8·R7)·`<state_home>` 조율 rollback=게임오버·out-of-scope(R4-#3)** | M13 A102·A105·A106 |
| F8 alignment을 품질로 오표시(신뢰 왜곡) | 표준 | alignment≠품질 정직 라벨·quality_label 분리·null=미측정(0/품질 위장 금지) | M13 A103 |
| F8 config 게이트 우회·clobber·floor 밑 리셋 | 표준 | Zod `.min(30/10/3)`·**per-leaf 독립 복구(형제 보존)+effective=max(값,floor)·R2-#5**·fail-closed 안전기본값 | M13 A110·A111 |
| **통합-1 공유 config writer 간 clobber(F3/F7/F8/F9 evals·projectsHome·docsSources 소거)** | **중대** | **canonical 버전드 전 필드 스키마+root passthrough+per-leaf 보존 원자 RMW(네 writer 공통·F9 `docsSources`/`docsMenuEnabled` 포함)**·미지원 schemaVersion 거부·타입 일관 | M11/M13/M14 A71·A110·A113 |
| **통합-2 F8→F7 crypto 우회(제안이 일반 편집으로 저장)** | **중대** | **F7 PUT `evalProposal` 필드+DW11 실집행**(nonce 소비·envelope 서명·config 해시·A106 재평가·payload 일치)·envelope 없는 제안 적용 불가 | M12/M13 A107 |
| 통합-3 F4/F6/F8 리더 심링크 리다이렉트 | **중대** | **공용 경화 바운드-리더**(realpath 앵커·전 하위 세그먼트 심링크/reparse 거부·O_NOFOLLOW·containment·F5 DV 동일) | M7/M9/M13 A50·A60·A102 |
| 통합-4 manifest.agent 스키마 모순 | 표준 | **published Manifest additive optional `agent`(nullable·하위호환·supervisor writer·마이그레이션 테스트)** | M10 A47·A66 |
| (폐기)F1 stdin/PTY EPIPE 붕괴 | — | **F1 폐기로 리스크 제거**(v0.7 재검토 시 별도) | §F1-폐기결정 |
| F9 소스 경로탈출(임의 디렉토리 노출) | 표준(경로검증=중대-인접) | DS1~DS8: projectRoot 하위 상대만·realpath containment·전 세그먼트 심링크 거부·denylist·개수/길이 상한·**열람 시점 재검증(TOCTOU·DS7)** | M14 A114·A117 |
| **F10 빌드 초안 exec surface(주입·비용·shell·DoS)** | **중대** | HB1~HB8: bounded 입력·**초안=데이터(프롬프트 주입 방지)**·읽기전용 컨텍스트만·execFile+argv(I3)·shell 금지·no-auto-apply·게이트·**동시 1개+쿨다운(비용폭주/DoS·429·R1 agy)**·메커니즘 M15 P3 선검증 | M15 A124·A125 |
| **F10 읽기 화이트리스트 dot-prefix 오허용(시크릿 노출·멀티런타임)** | **중대** | HR1~HR4: `.claude`·`.codex`·`.agents` **3 dot-dir만** 정밀 허용(정밀 서브루트)·`.env`/`.git`/`.ssh`/`.gemini`/각 dot-dir 직속 설정 거부·secret denylist·전 세그먼트 심링크 거부·**projectRoot 밖(`~/.gemini`) 원천 거부** | M15 A121·A129 |
| F10 멀티런타임 읽기 확장이 쓰기 경계 침식 | 표준(경계 회귀) | HR6: 읽기는 3 런타임이나 **편집·신규생성은 `.claude/agents·skills`만**·Codex/agy/GEMINI.md 편집 409·읽기 확장이 mutating 스코프 안 넓힘(I8 assert) | M15 A130 |
| **F10 신규 생성 경로탈출(`.claude` 밖 write·F7 우회)** | **중대** | HB5·HB6: 신규 생성 전용 경로안전(leaf 미존재·부모 심링크 거부·skill dir mkdir escape 거부·이름충돌 409·스코프 밖 400)·**F7 leaf 실재 전제 우회 차단(신규 구축)** | M15 A126·A127 |

**비가역성 요약:** F4·F5·F6 = **읽기전용(가역·비가역 없음)** — 파일 무변경. F2 = 경량(read-only 기본·실행은 사용자 확인). F3 = 가역(config 삭제/env override 롤백)·단 잘못된 root가 활성 시 노출 → 부팅 재검증(D7·A70) 상시 방어. **F7 = 비가역(정의 파일 덮어쓰기)** — I8 유일 예외 → DW6 낙관적 동시성·DW7 `.bak` 직전본 롤백·diff 확인·스코프 게이트(기본 off)로 완화. 편집≠실행(DW9). **F8 = Part A/B(제안) 읽기전용(비가역 없음)·Part B 적용은 F7 경로(비가역·롤백)·Part C config 가역(F3.7 RMW)** — 자기채점 자동 적용 금지.

## 다음 단계 참조
- **외부감사 R1 반영(9건 HIGH):** #1 F5 XSS(DV8)·#2 F5 심링크 거부(DV4)·#3 F5 크기상한(DV6)·#4 F3 신뢰경계 확정·#5 F3 크로스플랫폼·#6 F4 바운드 열거·#7 F6 measured=증거필수·#8 conversationId 제거·#9 F2 `U∩D`.
- **외부감사 R2 반영(7건 HIGH):** #1 F7 백업 opaque 파일명·#2 F7 strict YAML+정규화·#3 F7 pathId 바인딩·#4 F7 롤백 계약·#5 F7 게이트 명세·#6 F3 심링크 거부 projectsHome 상대 한정·#7 F4 전역 정렬.
- **외부감사 R3 반영(4클러스터):** #1 F4/F6 정렬(무작위 절단 정정)·#2 F7 파서 등가→게이트 승격·#3 F3+F7 config RMW·#4 F3 D2 realpath 허용.
- **외부감사 R4 반영(5건·R3 과교정 1건 포함):** **#1 F4 runId 정렬 가정**(runId 시간접두 미보장 → **`fs.stat` birthtime/mtime 정렬로 형식 무의존**·malformed quarantine·F4.3/A50/A51/F6.3)·**#2 F7 본문 `^---` 과잉거부 철회**(R3-#2 과교정 — 고정 추출로 본문 `---` 무해·정상 markdown ACCEPT·DW5/F7.4/A75)·**#3 F7 `.strict()` 실필드 거부**(완전 frontmatter 스키마+`.passthrough()` 미지필드 보존·필수만 strict·F7.4/A75)·**#4 F3.7 전체객체 Zod vs 필드복구 모순**(버전드 봉투 파싱 후 **필드별 독립 검증·복구**·전체객체 strict 금지·F3.7/A71/A78)·**#5 F7 differential 게이트 실행불가**(리더 버전 핀·픽스처 코퍼스·정규화 JSON zero-divergence·CI 명령 명세 = **F7.8**·A75). → **재감사 대기.**
- **미해결(감사 재확인 대상):**
  1. **projectsHome 프로비저닝 UX**(F3.2) — 최초실행/설치가 `projectsHome`을 어떻게 안전히 기록하는가(런처 A30 경로 연계)·미프로비저닝 시 편집 비활성 안내. 경계 자체는 확정, 프로비저닝 절차만 M11에서 배선.
  2. **F6 집계 방식**(AS3) — v0.6 MVP=바운드 on-read(supervisor 무변경·읽기전용). rollup.json 증분은 규모 폭증 시 이월(supervisor 저자).
  3. **실 CLI usage 방출**(AS1) — events `agent/skill/usage` 실 방출 일관성 미검증 → **CLI 픽스처 수용기준화**(usage 유/무 샘플·A61). 누락은 measured 미승격·`unattributed` 강등.
  4. **뷰어 docs 화이트리스트 재귀 범위**(F5) — `docs/` 전체 재귀 시 우발적 민감파일 노출 가능 → DV5 denylist·DV7 바이너리·DV6 크기상한으로 방어하되 감사에서 하위 디렉토리 추가 제한 검토.
  5. **F7 다단계 히스토리·Codex 듀얼 편집** — `.bak` 직전 1개(v0.6). git 연계 다단계 롤백·Codex(`.codex/*.toml`·`.agents/skills`) 대칭 편집은 v0.7. v0.6은 한쪽(`.claude`) 편집 + 저장 시 drift 경고.
  6. **F7 스코프 게이트 기본값** — `definitionEditEnabled` 기본 off(fail-closed) 확정. 최초 활성 UX(Settings 토글)·경고 문구는 M12 배선.
- **핵심 결정 & 이유:**
  - **F1(대화형) 폐기** — 앱 목적(관측·통제)·터미널 우위·보안비용·미검증 의존. v0.6 차별화 = CLI가 못 하는 교차-run 관측(F4-F6).
  - **F4·F5·F6 = 완전 읽기전용** — fire-and-observe·I8 무영향. 비가역 없음. F4의 **이름 열거→`fs.stat` 시간 정렬→상위 N 내용 read**(runId 형식 무의존)를 F6가 재사용(DRY·OOM=내용 read 상한·최근 N 결정적).
  - **F5 XSS·경로탈출 = 중대** — DV8(sanitizer·CSP·scheme 화이트리스트·외부리소스 차단)로 렌더 안전, DV4(전 세그먼트 심링크 무조건 거부)·DV1 화이트루트로 경로탈출 차단.
  - **F3 신뢰경계 = 단일 projectsHome containment(확정)** — 마커는 위조 가능하므로 경계가 아니라 심층방어. 경계는 프로비저닝된 불변 소스, 편집 API로 확장 불가(buildable·안전 양립). env도 부팅 시 D1-D7 검증.
  - **관측성 과대표시 금지** — measured는 증거 실존 시에만·per-value confidence·부재 시 `unattributed` 강등(신뢰 붕괴 방지).
  - **스키마 델타 = additive optional `manifest.agent` 하나만(통합감사-#2)** — F1 델타(conversationId 등) 폐기·나머지 v0.5 §5 불변. `agent`는 nullable/default(하위호환·supervisor writer·마이그레이션 테스트). events `usage`(F6)는 v0.5 §5 선반영분 소비. ("스키마 무변경" 과claim 정정.)
  - **F7 = 첫 mutating·I8 유일 예외** — 사용자 요청("정의 직접 수정")의 가치는 크나 **로컬 dev-tool 최대 공격면** → `.claude` 화이트리스트·이름→경로 서버해소(pathId)·무결성 게이트(**strict YAML+본문경계+실 런타임 differential 릴리스 게이트**)·원자쓰기(atomic.ts)·opaque 백업·낙관적 동시성·스코프 게이트(기본 off)·편집≠실행 10층(DW1-DW10)으로 경화. **방어 확실히 된 뒤 마지막(M12)** 배포. 생성·삭제·Codex 듀얼·docs 편집은 v0.7/영구 비목표.
- **UX 축(신규):** 보안/정합성 감사(R1-R4) 위에 **UX 수용기준 A81-A101(21개·UX-R4로 A100/A101 편입)** 레이어 — 빈/로딩/에러/재인증·게이트·위험작업·필터/뷰어/신뢰라벨·일관성·접근성 + UX 외부감사 반영. **기능계약(A47-A80) 무변경.** A81-A101은 각 마일스톤(M7-M15) DoD에 **횡단 적용**.
  - **UX-R1(agy):** A93(F7 편집분 보존)·A94(전역 재연결)·A95(F4 절단 고지).
  - **UX-R2(codex+agy):** A94 강화(재연결 **상태머신·401 갭**)·A90 강화(**dead→선택 window 관측 없음+커버리지**)·A95 강화(복구 안내)·**A96(오래된 이력 기간 파티셔닝 도달)**·**A97(첫 실행 projectsHome/런타임 준비)**·**A98(F5 대용량 413·부분파일 손상 방지)**·**A99(F3 활성 run 취소/헤드리스 승인)**. 다수가 앞선 보안수정의 UX 부작용 정정.
  - **UX-R3(codex·agy=수렴):** A96 **시각 도메인 통일** — `from`/`to`·정렬·파티션·표시를 **`recordedAt`(FS-time) 단일 도메인**으로(구 createdAt↔FS-time 불일치 → 복사/복원 run 경계 누락 정정)·라벨 "기록 시각(FS)"·manifest `createdAt` 상세 병기. **택(a) FS-time 단일 도메인 채택.**
  - **UX-R4(agy·codex=no-high):** **A100 F2 도구 조용한 드롭 금지** — D 선언 도구 체크박스 UI(U⊆D 구조 보장)+D 밖 요청 400 명시 반려(오도상태 제거·보안 불변 무변경). **A101 F3 config 쓰기 순서** — `dryRun` 프리뷰(경고·미변경)→확인→실제 쓰기(취소 시 디스크 무변경·비가역 오동작 정정). → **UX 수렴 완료.**
- **RF 채택 확정:** RF1(Build→"New Run" 라벨)·RF2(Agents "Ask Agent")·RF3(착지 배너·A87)·RF4(필터바 "이력 검색·필터"·A88)·RF5(사이드바 그룹핑 실행/관찰/정의/점검/설정·A87/A91)·RF6(뷰어 명칭 일관·A89) **전부 채택**(라벨·동선·계약 무변경·A-번호 불변).
- **F8 추가(신규·Eval 화면):** 평가 대시보드(A·읽기)+자기개선 제안(B·제안+승인·자동 금지)+지표관리(C·config). self-eval 교리 비협상. A102-A112(11개)·M13. F4/F5(읽기)·F3.7(config)·F7(적용) 재사용. artifact_benchmark(품질평가)=v0.7 분리.
- **F8 보안감사 R1(codex+agy·6건 HIGH·반영):** Stage 4 쓰기 제거·게이트 실데이터·scorecard strict/격리/graceful·비-mutating 승인·DV8·EvalsConfig 필드 보존.
- **F8 보안감사 R2(codex+agy·5건 HIGH·반영):** HMAC 서명·서명 rollup 게이트·수학 교차검증·서명 envelope+nonce·per-leaf+floor.
- **F8 보안감사 R3(codex+agy·5건 HIGH·암호 프로토콜·반영):** 서버 서명·체인 rollup+head·이중소스 기만 차단·durable nonce·envelope config/head 결속.
- **F8 보안감사 R4(4건·2 실모순+2 정직 스코핑·반영):** 키 회전 vs 체인 모순 해소(해시체인=무결성·HMAC=head만)·head 정확일치 제거(재평가만)·정직 스코핑(F8.8·state_home 조율 rollback=게임오버·out-of-scope).
- **F8 보안감사 R5(1건·반영):** scorecard 읽기 경로 회전 브릭 해소(ingest 시점만 현재키 HMAC·이후 무결성=rollup digest·과거 window 브릭 0).
- **F8 보안감사 R6(codex 1건·반영):** 게이트/표시 완전 분리(gate-time `_workspace` digest 요구 제거·게이트는 rollup 엔트리만·`_workspace` 변조 게이트 영향 0).
- **F8 보안감사 R7(agy no-high·codex 1건 심층·반영):** **서버 서명 = tautological oracle 정정** — 서버가 `_workspace`를 그대로 서명하면 무결성이지 진위 아님(자기일관 위조 scorecard가 서명받던 문제). (1) **재도출-후-서명**: 서버가 판정 원장(`verdicts.json`)에서 집계 직접 재계산·`_workspace` precomputed 값 거부(불일치 격리)·재도출 canonical 값에만 서명 → oracle 좁힘. (2) **교리 정직 backstop(F8.8·AS10)**: 원장 자체가 자기판정=약증거(`loop-self-eval.md`)이므로 **F8은 "자기채점을 참으로 만들지 못함"(구조적)** → 잔여 약점은 **사람 승인**(제안≠자동적용·F7 승인)이 최종 방어·ground-truth v0.7. 무한 crypto 금지. → **F8 보안 완전 수렴(R1~R7).**
- **F8 UX 감사 R1(codex+agy 동일·4건·보안 불변·UX 레이어만 반영):** #1 **빈 상태 데드엔드**(미실행="아직 실행 안 됨"+실행/문서 CTA·`eval-unavailable`=원인+복구·A104)·#2 **무결성 상태 영향+복구 명시**(상세 파일 불일치=추세/게이트 안전·rollup 훼손=제안 차단·"변조" 툴팁·A112)·#3 **승인/적용 분리**(CTA="편집기에서 검토·저장"·"미적용" 유지·유실 방지·A107/A112)·#4 **임계 floor UI 상시 표시+인라인 거부**·**A112 "단계4 확인" 모순 정정→확인 대상=단계3 전환+지표/정규화 변경·Stage 4=비활성 사유만**(A110-A112).
- **F8 UX 감사 R2(codex 1건·반영):** rollup 무결성 훼손 데드엔드 해소 — 진단 + 복구("원장 재구축·재검증") CTA·비악의 훼손만·조율 rollback은 게임오버 유지.
- **F8 UX 감사 R3(agy no-high·codex 1건·반영):** **재구축 검증 소스 미정의 정정** — R2 복구가 "무엇으로 검증"이 미정이라 rollup 손상+키 회전 시 미검증 `_workspace` 재신뢰 구멍. 정정: (a) **ingest 시 독립 서명 receipt를 rollup과 별도 저장**(`<state_home>/evals-receipts`·keyId)·(b) **키링에 전 이력 키 보존(재구축 재검증 전용·정상운영은 R4대로 chain+head·구키 불요·둘 모순 없음)**·(c) **재구축=독립 receipt 검증 통과분만**·(d) **독립 소스 전무 시 재구축 불가+명시 리셋만(미검증 `_workspace` 재신뢰 절대 금지·이력 상실 명시 승인)**. F8.1/F8.8/A112/AS8·보안 불변. → **F8 UX R1~R3 반영.**
- **v0.6 최종 통합감사(codex+agy·교차기능 4건·전부 반영):** 단일기능 감사가 놓친 cross-feature 결함 — **#1 공유 config clobber**(F3/F7/F8 writer가 `evals`·`projectsHome` 소거 → canonical 전 필드 스키마+passthrough+per-leaf 보존 RMW·F3.7·**F9 writer는 R7에서 네 번째로 편입**)·**#2 `manifest.agent` 스키마 모순**(published Manifest에 additive optional `agent` 추가·마이그레이션 테스트·"무변경" 과claim 정정·F2.1)·**#3 F4/F6/F8 리더 경화 갭**(공용 경화 바운드-리더=realpath 앵커·전 하위 세그먼트 심링크/reparse 거부·O_NOFOLLOW·containment·F4.3·A50/A60/A102)·**#4 F8→F7 crypto 강제 갭**(F7 PUT `evalProposal` 필드+DW11로 envelope·nonce·게이트 재평가 실집행·일반 편집 우회 차단). 보안 불변식 유지·모순 문구 0.
- **v0.6 통합감사 R2(codex+agy·R1이 부른 새 통합 이슈 4건·전부 반영):** **#1 config per-leaf 위반**(`loadConfig`가 `evals`를 통째 파싱 → 한 잎 손상이 서브트리 리셋·형제 clobber → **evals 내부 재귀 leaf-wise 복구·effective=max(값,floor)**·F3.7 `loadEvals`)·**#2 config-hash 데드락**(envelope 전체 config-hash 결속 → `definitionEditEnabled` 토글이 대기 제안을 `409 stale`로 영구 거부 → **envelope=`evals`(Part C)만 해시·운영 플래그 제외**·F8.3/A107/DW11)·**#3 edit/proposal 미분리**(일반 편집=상시 허용·우회 아님·**envelope는 "승인된 제안" 주장에만 강제**·DW11)·**#4 공용 리더 앵커 하드코딩**(`isWithinRoot(_workspace/runs)` 고정 → F8 `<state_home>/evals-rollup` 실패 → **앵커 파라미터화**·방어 규율 동일·A50/A60/A102). 보안 불변식 유지·모순 문구 0.
- **v0.6 통합감사 R3(agy no-high·codex 1건·반영):** **F8 ingest 소유권·트리거 미정의 정정** — Part A "API 읽기전용"인데 서명 rollup/receipt는 쓰기 필요·writer/트리거 미정의(GET lazy-ingest면 읽기전용 위반). **택(a) 채택: ingest=서버 부팅/주기 백그라운드 잡**(요청 무관·검증→원자 commit(scorecard durable→receipt→rollup head 재서명)·바운드·dedup·검증분만)·**전 `GET /api/evals*` side-effect 0**·수동 재구축은 인증 mutating `POST /api/evals/rebuild`(택(b) 패턴). "읽기전용"은 GET 뷰 한정 명확화(F8.1/F8.2/A102).
- **v0.6 통합감사 R4(agy no-high·codex 2건·R2/R3 파생·반영):** **#1 F2 정의 삭제 천장우회**(template↔제출 사이 정의 삭제/변경 → D 재도출 불가한데 실행 허용=U⊆D 우회 → **제출 시점 정의 재조회·D 재도출·pathId/해시 변경 시 `409 agent-definition-changed`**·F2.3/A66)·**#2 F8 nonce 수명주기**(R3가 GET을 side-effect 0으로 만들어 nonce 발급 고아 + write 前 소비 시 크래시 유실 → **발급=`POST …/prepare`(mutating·GET 아님)·`issued→applying→consumed` 원자 상태머신·멱등 재시도(크래시 유실 0·중복적용 0)**·F8.3/DW11/A107). 보안 불변식 유지·모순 문구 0. → **v0.6 통합 수렴.**
- **F8 최종확인 R4(agy no-high·codex 1건·stale 문구 정합):** **F8.1 키링 문구 모순 해소** — R3 "재구축용 키링 보존" ↔ R4-#1 옛 "전 이력 키링 영속 폐기"가 직접 충돌하던 것 정정. **단일 키 규율로 통일:** 정상운영 검증=해시체인+head-HMAC(구키 불요·회전 브릭 0)·재구축 재검증=`evals-receipts` keyId로 보존 키링·**키 보존 불변식(회전 시 구키 폐기 안 함·키링 보존·원자 회전)**. 모순 문구 0. → **F8 완전 수렴(보안 R1~R7·UX R1~R3·문구 정합).**
- **다음 단계:** 보안 R1-R4 + **UX 레이어(A81-A101·수렴)** + **F8(A102-A112·보안 R1~R7·UX R1~R3 수렴)** + **v0.6 통합감사 R1~R4 반영(공유 config canonical+evals per-leaf·manifest.agent 델타·공용 경화 리더 앵커 파라미터·F8→F7 DW11·evals-only config-hash·edit/proposal 분리·ingest mutating 분리·F2 제출 시점 D 재도출·F8 nonce 상태머신)** → 최종 재감사 → M7(F4)→M8(F5)→M9(F6)→M10(F2)→M11(F3)→M12(F7)→**M13(F8·평가·마지막)** 순차 구현(각 마일스톤 DoD = 기능 A + UX A81-A101 횡단). 전체 A47-A112(기능 34+UX 21+F8 11)·거부 100+·state_home 장악·self-scoring 참값화 out-of-scope 문서화.
</content>
</invoke>
