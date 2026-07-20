# Harness UI v0.5 — 최종 설계서 (정본 · 빌드 기준 · r6 · 런처 R7 재인증 대기)

> **이 문서가 v0.5 정본이다.** 코어(§1-9)는 R5 CERTIFIED. r5 런처 추가 → R6 감사 blocking → **r6 경화 적용**(Windows execFile·토큰 URL·npm --ignore-scripts·닭달걀·pidfile→레지스트리) → **런처 R7 재인증 대기**.
> 이력: r6=R6반영(런처 경화) / r4=R5인증 / r3=R4 / r2=R3(A3). r6에 **상태·통계 확장(A35-A38, 정적 measured)** 추가.
> **재인증 범위(R8 대기):** 런처(§5c·A30-A34) + 상태통계(A35-A38) + **배선·UX 감사 델타(A39-A46: settings·state-stats·bootstrap·필드배선·drift-plan·artifact·UX표준)**. 통과 전 이 델타 미인증(코어 §1-9·A1-A29는 R5 CERTIFIED 유지). 배선/UX 감사 상세·정정: `wiring-ux-review.md`.
> 문서 관계:
> - `README.md` = v0.5 원안. **아래 §0-VOID에 열거된 섹션은 무효**(그 외 IA·API·스키마 골격·UI 원칙은 유효, 단 스키마는 §5 published가 우선).
> - `design-revision-v0.5.1.md` = 폐기(superseded). `design-revision-v0.5.2.md` = 이 정본에 흡수.
> - `design-observability.md` = v0.6(관측성). 단 events `agent/skill/usage` 필드는 v0.5 선반영(§5).
> - `DESIGN.md` = UI 디자인 시스템 정본(Linear, §2).
> 검증: `../working_history/` A1(R1)·A2(R2+Windows)·A3(R3). 상태: **R4 재인증 대기**.

## 0-VOID. README 무효 섹션 (명시 — dev는 이걸 읽지 말 것)
frozen README에서 **다음은 이 정본이 대체**하므로 구현 근거로 쓰지 않는다(포인터 애매성 제거 — A3 blocking#1/#6):
- README §상태 스키마 "Run supervisor 규칙"(227~246) 중 **`HARNESS_RUN_ID`·`environ` 기반 leaderless reconcile 전부** → §4로 대체(서명 레지스트리+identity).
- README §Codex/Claude 실행 전략의 **`HARNESS_RUN_ID` 환경변수 소유증명 용도**(760·799 부근) → 진단용으로만 허용, 소유증명 금지. `HARNESS_RUN_DIR`(기록 위치)는 유효.
- README §보안 경계 **접속 토큰 URL 방식**("1회용 URL `?token=`"·"query token을 session storage"·referrer 완화 포함) → §5b bootstrap 교환으로 대체(쿼리 토큰 금지).
- README **§수용 기준 전체** → **§6 매트릭스가 유일 정본**(README acceptance 리스트는 무효, 참고만).
- README **§남은 결정(996-1001)**(실 빌드 실행 포함 여부·Codex toml 시점·Claude 상태기록 위치·snapshot export 포맷) → 이 정본이 확정(§1 실행 포함·§6·§9). README 미결 문구 무효.
- README `status.json` 예시의 `childProcessGroupId` 등 필드 → **§5 published Zod가 유일 정본**(README 스키마 예시는 골격 참고).

## 0. 성공률 장치
① 수용 매트릭스(§6, 기준↔마일스톤 **1:1**) ② supervisor-first+mock runner(§3) ③ OS 어댑터+3-OS CI(§4·§8) ④ 마일스톤 DoD(§7)+리스크 레지스터(§8). schema-valid는 §5 published Zod로만 정의(구두 금지).

## 1. 범위 (동결)
포함: 인벤토리·런타임 감지·run 실행/관찰(supervisor)·drift·Ops·dry-run 빌드·**런처(§5c)**·**상태·통계 계층 A**(구성건강도·D4규율·업데이트상태·진화이력, 정적 measured — 커버리지 경계는 `design-observability.md §7b`). 실행파생 통계(토큰·비용·실패패턴·리뷰수렴)는 v0.6. Claude+Codex+**Windows 완전 지원**. 제외(v0.6): 관측성 대시보드·오케스트레이터 상태기록 규약 주입. 비목표: README §비목표 유효.

## 2. 아키텍처
- Fastify + React/Vite/TS + Zod + chokidar. 단일 origin(prod)/Vite proxy(dev).
- 상태 정본 `_workspace/runs/{run_id}/`, **최종 저자=supervisor**. 소유권/토큰 레지스트리는 `_workspace` 밖(§4-A·§5).
- **UI 디자인 시스템 정본 = `DESIGN.md`**(Linear 분석: near-black `#010102`·lavender `#5e6ad2` 단일 액센트·조밀·desktop-first). 출처 `VoltAgent/awesome-design-md/design-md/linear.app`(MIT). web 토큰·타이포·컴포넌트 기준.

## 3. Run Supervisor = 스키마 최종 저자
- supervisor가 run 시작 시 `manifest`+`status(queued)` 기록(LLM 전). spawn·heartbeat·exit·cancel·stale = supervisor.
- LLM은 **구조화 JSON 로그 + artifact만**. supervisor가 tail·정규화→`events.jsonl` 승격.
- 구조화 로그(MUST): `codex exec --json` · `claude -p --output-format stream-json`. prose 파싱 금지.
- 영속 커서(MUST): 로그별 `{path,dev,inode,offset,lastLineHash}`→재시작 재개. 승격 멱등(결정적 id dedup). 부분라인 안전절단. inode 변화=rotation.
- `seq` = supervisor 메모리+per-run lock 단조증가, 재시작 시 tail로 max 복구.
- **원자 상태쓰기(MUST, v0.5.2 복원):** 상태파일은 동일 디렉토리 temp → `fsync(file)` → `rename` → `fsync(dir)`. events.jsonl은 append+주기 fsync.
- mock runner(테스트): raw 구조화로그+artifact만 방출(스키마 직접 방출 금지). 테스트는 supervisor가 스키마 생성했는지 assert.
- stdio(MUST): detached child → 로그 **파일**(openSync append), pipe 금지(EPIPE 자살 방지). spawn 후 supervisor fd 복사본 close.

## 4. OS 어댑터
`ProcessSupervisorAdapter`로 OS별 격리. child environ 읽기 전면 제거. **v0.5 identity 구현 = shell 확정**(ps/PowerShell; native addon은 v0.6 최적화 — A3 blocking#4 해소).

### 4-A. 서명 소유권 레지스트리
- 위치: `<state_home>/registry/{run_id}.owner.json`(§9-STATE). `_workspace` 밖. POSIX `0700`/Windows 현재유저 ACL. 생성 `O_EXCL`.
- 레코드 `{pid,groupId|jobName,startTime,exe,cwd,nonce}` + supervisor 세션키 **HMAC 서명**(키=메모리+0600/ACL 키파일).
- **kill 전 3중 검증(비협상):** 서명 유효 ∧ `identity(pid)` 대조 ∧ exe/cwd 일치 → 전부 통과만 kill. 불일치=kill 안 함, stale/failed 표시. **단일 근거 kill 금지.**

### 4-B. `identity(pid)` (shell)
| OS | startTime | exe/cwd | group/job |
|----|-----------|---------|-----------|
| Linux | `/proc/<pid>/stat` f22 | `/proc/<pid>/exe·cwd` | pgid |
| macOS | `ps -o lstart=`(**불투명 문자열 그대로 저장·정확일치 비교** — 로케일/타임존 파싱 금지) | `ps -o comm=`·`lsof cwd` | `ps -o pgid=` |
| Windows | `Win32_Process.CreationDate`(PowerShell, 불투명 문자열 비교) | `ExecutablePath` | pid+CreationDate(§4-C) |
shell 호출 execFile+argv. startTime 실패→kill 안 함. PID reuse=pid+startTime(불투명 문자열 동일성).

### 4-C. reconcile
- POSIX: pgid(`kill(-pgid,0)` 생존확인·`SIGTERM`→`SIGKILL`)→실패 시 레지스트리 fallback.
- **Windows(v0.5=shell 확정, Job Object 미사용):** child는 `detached`로 spawn. cancel·reconcile = **레지스트리+identity(pid+CreationDate) 3중 검증 통과분에만 `taskkill /T /PID <pid>`**(프로세스 트리 종료, argv). 생존확인 = `tasklist /FI "PID eq <pid>"` + CreationDate 대조. **Job Object(TerminateJobObject·named job)는 Win32 API/P-Invoke 필요 → v0.6 native 최적화로 이관**(shell 불가 — R4 반영). taskkill /T 트리 종료로 v0.5 요건 충족(컨테인먼트 정밀도는 v0.6에서 Job Object로 강화).

## 5. 상태 스키마 (published — schema-valid 정의)
**"schema-valid" = 아래 Zod `.parse()` 통과.** README 스키마 예시는 골격 참고, 이 §가 유일 정본. 필드명은 README(`childProcessGroupId`)와 정합 — 값 의미만 OS별.
```ts
import { z } from "zod";
const RunState = z.enum(["queued","running","blocked","failed","completed","cancelled","stale"]);
const Runtime  = z.enum(["claude","codex"]);
const iso = z.string().datetime({ offset: true });   // ISO8601(+offset)

const Manifest = z.object({
  schemaVersion: z.literal("1"), runId: z.string(), projectRoot: z.string(), runtime: Runtime,
  mode: z.string(), createdAt: iso, requestedBy: z.string(), goal: z.string(),
  agents: z.array(z.string()),
  targets: z.array(z.string()), permissionMode: z.string(), model: z.string(), supervisorVersion: z.string(),
});
const Usage = z.object({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(), cacheCreationTokens: z.number().int().nonnegative(),
}).partial();                                          // 러너가 일부 생략 가능
const Status = z.object({
  schemaVersion: z.literal("1"), runId: z.string(), state: RunState, phase: z.string(), progress: z.number().min(0).max(100),
  updatedAt: iso, heartbeatAt: iso, serverPid: z.number().int(), serverStartTime: z.string(),
  childPid: z.number().int().nullable(), childStartTime: z.string().nullable(),
  childProcessGroupId: z.union([z.number().int(), z.string()]).nullable(),   // POSIX=pgid(number) / Windows=pid marker(string)
  exitCode: z.number().int().nullable(), exitSignal: z.string().nullable(),
  cancelRequestedAt: iso.nullable(), stateReason: z.string().nullable(),
  summary: z.string(), error: z.string().nullable(),
});
const Event = z.object({
  seq: z.number().int().nonnegative(), ts: iso, level: z.enum(["info","warn","error","debug"]),
  agent: z.string().nullable(), skill: z.string().nullable(), phase: z.string(),
  event: z.string(), message: z.string(), usage: Usage.nullable(),             // agent/skill/usage = v0.6 관측성 선반영
});
const AgentState = z.object({
  schemaVersion: z.literal("1"), name: z.string(), runtime: Runtime, state: RunState, phase: z.string(), task: z.string(),
  startedAt: iso, updatedAt: iso, inputFiles: z.array(z.string()), outputFiles: z.array(z.string()),
  error: z.string().nullable(),
});
const DriftFinding = z.object({
  id: z.string(),
  severity: z.enum(["ok","missing-runtime-peer","content-mismatch","stale","unsupported"]),
  runtime: Runtime, paths: z.array(z.string()), evidence: z.string(), suggestedAction: z.string(),
});
```
- events.jsonl = 한 줄당 `Event` 하나(NDJSON). manifest/status/agents = 단일 객체 파일.

## 5b. 보안 (README §보안 경계 유효 + 확정)
- **접속 토큰:** CSPRNG ≥128bit. **single-use bootstrap→최초 요청서 session token 교환+bootstrap 즉시 무효화**(퍼미션 비의존). 터미널·로그에 토큰/쿼리스트링 미기록. 토큰파일 시 `<state_home>`·0600/ACL. (README URL 방식 무효 — §0-VOID.)
- **파일 서빙 경계:** artifact/snapshot(untrusted)=심링크 거부(세그먼트 lstat·leaf `O_NOFOLLOW`)·정규파일만·**불변 스냅샷 의무**·`fs.open`→`fstat`→fd 스트리밍. 인벤토리 read(신뢰)=realpath 경계 검증(심링크 타겟 경계 내 허용).
- **denylist(해석 전):** `.ui-session-token`·dotfile·레지스트리·secret 경로 전 file/artifact/snapshot API 차단.
- Host/Origin/CORS README 유효 + dev-proxy Host 허용값 모드별 명시(`127.0.0.1:{port}`·`localhost:{port}`·`::1` 포함). proxy 헤더 명시 신뢰만.
- execFile+argv(shell 금지). `--allowedTools`는 **variadic 배열** 전달(콤마문자열·`--tools` 금지 — 실CLI 확인, v0.5.2 복원). nosniff·attachment·크기제한·파일수정 API 기본 비활성.
- **API 페이지네이션(복원):** `GET …/events?after&limit` — `after` exclusive·`limit` clamp·응답 `{items,nextAfter,hasMore,runState,schemaVersion}`·파손/절단 이벤트파일 동작 정의.

## 5c. 런처 (첫 실행 자동 bootstrap — "설치 자동화") · R6 경화
**목표:** "플러그인 설치 순간 앱 자동설치"는 **불가**(CC/Codex 플러그인은 설치 시 임의코드 실행 안 함 — 보안). 대신 **첫 실행 원커맨드 자동화**.
- **형태:** 런처 스킬(Claude/Codex 동일). 플러그인은 `harness-ui/` **스캐폴딩 템플릿 + package-lock.json 번들**.
- **절차:**
  1. **소스 확보(닭달걀 해소):** 프로젝트에 `harness-ui/` 없으면 → 플러그인 번들 템플릿을 **realpath 프로젝트루트 하위**로 복사(심링크 거부). 있으면 재사용.
  2. **런타임 확인:** `node`(=`process.execPath`)·`npm` **각각** 존재·버전(Windows는 `npm.cmd` 해소). 없으면 **graceful 실패**(안내만·크래시 X). PATH hijack 방지 위해 절대경로 해소.
  3. **의존성(RCE 게이트):** `node_modules` 없으면 → **명시 동의**. 기본 **`npm ci --ignore-scripts`**(lifecycle 임의코드 차단). 설치 전 번들 **package-lock.json 해시를 템플릿 기대값과 대조**(변조 시 fail-closed). postinstall이 프레임워크상 필수면 **"임의코드 실행" 별도 경고 + 2차 동의**. silent 금지.
  4. **멱등·토큰 전달(fragment):** 실행 여부는 raw pidfile 신뢰 금지 → **§4-A 서명 레지스트리 + 로컬 헬스체크**로 확인. 실행 중이면 재spawn 안 함. 브라우저 오픈 시 supervisor에 **새 single-use bootstrap** 요청 → **URL fragment**로 전달(`http://127.0.0.1:<port>/#<bootstrap>`). **fragment는 HTTP 요청/서버로그에 안 실림**(쿼리·경로 아님) → client JS가 로드 시 읽어 session token 교환 후 `history.replaceState`로 즉시 제거. 서버로그·referrer·쿼리 노출 0(§5b·§0-VOID 정합). 정지 상태면 `npm run dev` 기동(고정 cwd=`harness-ui` realpath).
  5. **브라우저 오픈:** URL은 `new URL()`로 `http://127.0.0.1:<numeric-port>/#<bootstrap>`만. 오픈 = macOS `open`·Linux `xdg-open`·**Windows `cmd.exe /d /s /c start "" <url>`**(`/d`=AutoRun 무시·`/s`=따옴표 처리, `start`는 cmd 빌트인 — `execFile("start")` 불가). 단일 argv.
- **보안:** 전 호출 execFile+argv(shell 금지, Windows opener만 `cmd /c` 어댑터로 엄격 argv). npm은 **Ops allowlist 밖**(별도 동의 게이트). cwd=`harness-ui` realpath 고정·최소 env·package root/lock 심링크 거부.

## 6. 수용 매트릭스 (기준 → **단일 마일스톤** → OS)
| # | 기준 | M | OS |
|---|------|---|-----|
| A1 | `npm run dev` UI+API 동시 실행 | M1 | all |
| A3api | inventory API가 agents/skills count 반환 | M1 | all |
| A5be | `_workspace/runs` 없/빈 → reader 안전 | M1 | all |
| A6be | mock runner→supervisor가 schema-valid manifest/status/events/agents 생성 | M2 | all |
| A24 | events.jsonl append 전체 재작성 없이 | M2 | all |
| A25 | supervisor 재시작 커서로 누락/중복 없이 재개 | M2 | all |
| A18 | cancel→process tree 종료→`cancelled` | M3 | all |
| A19 | 고아 running = 서명+identity 통과 시만 종료, 불일치 kill 안 함 | M3 | all |
| A20 | PID reuse(startTime 불일치) kill 안 함 | M3 | all |
| A21 | Windows: 레지스트리+identity(pid+CreationDate) 검증 후 `taskkill /T` 트리 종료 | M3 | win |
| A22 | detached child 별도 프로세스 그룹(POSIX pgroup) / Windows는 detached 프로세스 | M3 | all |
| A21b | Windows dead-root: 등록 root PID 종료·손자 잔존 시 taskkill 트리 미도달 = **알려진 v0.5 갭** → stale/failed 표시만(정리는 v0.6 Job Object). kill 오작동 없음 | M3 | win |
| A2 | Overview에 claude/codex 설치·버전 | M4 | all |
| A3 | 화면에 agents/skills count | M4 | all |
| A4 | `.codex/agents` 누락 drift 표시 | M4 | all |
| A4b | drift full(CLAUDE↔AGENTS·skills desc·refs 누락) 표시 | M4 | all |
| A5 | 빈 runs UI 안 깨짐 | M4 | all |
| A7 | Ops claude/codex/agy 설치·버전·헬스 | M4 | all |
| A8 | `/usage`·`/status` 직접실행 불가 사유+snapshot 경로 표시 | M4 | all |
| A8b | snapshot import: raw 보존·normalized 필드·unparsed 표시·실패 아님 | M4 | all |
| A26 | Ops command API가 client args/env/cwd/command 거부 | M4 | all |
| A27 | nested artifact segment 검증+realpath+심링크 거부 | M4 | all |
| A28 | artifact 정상서빙: 불변 dir 정규파일이 nosniff+attachment/text로 제공 | M4 | all |
| A29 | drift sync-plan이 파일 미변경(계획만) | M4 | all |
| A10 | cross-origin POST가 token/Origin/Host 거부 | M4 | all |
| A11 | token 없는/Host 벗어난 GET 거부 | M4 | all |
| A12 | bootstrap 교환+무효화, HTML 미주입 | M4 | all |
| A13 | path traversal 전 파일 API 거부 | M4 | all |
| A14 | HTML/SVG/JS artifact 비실행 | M4 | all |
| A23 | live update=header 인증 polling/fetch stream(쿼리토큰 SSE 금지) | M4 | all |
| A9a | Build 화면 골격 표시(입력 폼·미리보기 레이아웃) | M4 | all |
| A9b | Build dry-run 데이터 생성·표시(파일수정 없음) | M5 | all |
| A15 | shell metachar domain 입력 host shell 미실행 | M5 | all |
| A16 | prompt `Task:\n` prefix + `--` positional(claude/codex) | M5 | all |
| A6 | 실 run e2e: Runs 화면에 이벤트·agent status | M5 | all |
| A17 | 실 codex/claude 스모크(opt-in)→schema-valid 생성 | M5 | mac/linux |
| A17w | 동 Windows | M5 | win |
| A30 | 런처 첫 실행: 템플릿 스캐폴드→node/npm 확인→**동의 후** `npm ci --ignore-scripts`(lock 해시 대조)→`npm run dev`→브라우저 오픈 | M6 | all |
| A30w | Windows: `npm.cmd` 해소·브라우저 `cmd.exe /d /s /c start "" <url>`로 동작 | M6 | win |
| A31 | 재실행: §4-A 레지스트리+헬스체크로 실행중 판정, 실행중이면 재spawn 없이 **새 single-use 토큰** fragment 발급 후 브라우저(멱등) | M6 | all |
| A32 | node/npm 각각 없으면 graceful 실패(안내만, 크래시 X) | M6 | all |
| A33 | 동의 없이 silent 설치 안 함 + 기본 `--ignore-scripts`(lifecycle RCE 차단), lock 해시 불일치 시 fail-closed | M6 | all |
| A34 | bootstrap 토큰 = URL **fragment**(`#`)로만 전달, HTTP 요청/서버로그/쿼리/referrer 미노출, client가 교환 후 즉시 strip(§5b) | M6 | all |
| A35 | Overview 구성 건강도: 고아 에이전트/스킬·오케스트레이터 유무·CLAUDE.md/AGENTS.md 포인터 정합(measured) + 에이전트↔스킬 커버리지(**heuristic** — 정의 파싱, 라벨) | M4 | all |
| A36 | D4 규율: 결과서 기록 유무·`## 다음 단계 참조` 누락·`_workspace` 방치 영속물. **UI가 TS 네이티브로 파일 검사**(check-artifacts 셸아웃 금지 — 빌드 하네스에 스크립트 없을 수 있음) | M4 | all |
| A37 | 하네스 업데이트 상태: `.harness-manifest.json`에서 USER-MODIFIED 수·보류(measured·정적). **factory-drift는 factory 경로 설정 시만**(빌드 하네스엔 부재 가능 → `unknown`, 실패 아님) | M4 | all |
| A38 | 진화 이력 타임라인: CLAUDE.md **+ AGENTS.md**(듀얼) 변경이력 파싱 표시 | M4 | all |
| A39 | `GET /api/settings`(read-only): 프로젝트루트·CLI경로·기본모델·sandbox·`<state_home>` 조회(v0.5 수정 API 없음) | M4 | all |
| A40 | `GET /api/overview/state-stats`(typed·Zod): A35-A38 데이터 소스 collector 정의(§배선 W4 — 이전 미정의 수정) | M4 | all |
| A41 | bootstrap 교환 엔드포인트: fragment 토큰→session 교환+무효화(A12/A34 배선) | M4 | all |
| A42 | Build 옵션 배선: `POST /api/runs` 페이로드에 **리소스제한·권한·모델·targets** 필드(IA 반영) or IA서 제거 | M4/M5 | all |
| A43 | 화면-필드 배선: Skills `triggers`(SKILL.md description 파생)·Agents 최근 실행상태(`_workspace/runs/*/agents/*.json` join)·Runs 재시도기록(status에 필드 or IA 제거) | M4 | all |
| A44 | Drift sync-plan 응답 스키마: `{file,operation,reason,previewDiff,manualSteps,risk}`(무변경 렌더) | M4 | all |
| A45 | artifact UX: list 스키마·escaped text preview·`Content-Disposition: attachment` 다운로드 버튼·빈 상태 | M4 | all |
| A46 | UX 표준: 빈/로딩/에러 3-state·action 에러 토스트+retry(GET만·POST 위험작업은 확인)·cancel 멱등(terminal/409)·polling interval/backoff·키보드 nav(focus·Enter·Esc)·색+label 접근성·모바일 읽기전용·위험작업(run/drift-apply) dry-run 확인 | M4 | all |

## 7. 마일스톤 & DoD (게이트 — 매트릭스 1:1)
- **M1 기반**(step1-5): 스캐폴딩·runtime detect·inventory·agents/skills·runs reader. **DoD: A1,A3api,A5be** + API 단위테스트.
- **M2 Supervisor 코어**(step6): spawn(로그파일·fd close)·서명 레지스트리·heartbeat·구조화로그 커서·events 멱등·원자쓰기. **DoD: A6be,A24,A25**(mock runner).
- **M3 OS 어댑터**(step7): POSIX pgroup + **Windows detached pid-tree(`taskkill /T`)**·identity(shell)·reconcile **3-OS CI**(Job Object는 v0.6 native). **DoD: A18,A19,A20,A21,A21b,A22.** kill 오작동 0.
- **M4 화면+보안**(step8,11): 6화면·drift(full+sync-plan)·Ops(snapshot import)·artifact 서빙·token bootstrap·denylist·심링크·Host/Origin·Overview 상태통계·**배선 보강(settings·state-stats·bootstrap·필드 배선)·UX 표준**. **DoD: A2,A3,A4,A4b,A5,A7,A8,A8b,A9a,A10,A11,A12,A13,A14,A23,A26,A27,A28,A29,A35,A36,A37,A38,A39,A40,A41,A43,A44,A45,A46.** (A42 폼=M4·실행배선=M5)
- **M5 실행 인증**(step9,10): dry-run·실 스모크(opt-in) 3-OS. **DoD: A6,A9b,A15,A16,A17,A17w.**
- **M6 런처 + (선택)Codex toml**(step12,13): 런처 스킬(템플릿 스캐폴드·node/npm 해소·동의+`npm ci --ignore-scripts`+lock 해시·§4-A 멱등·새 토큰·OS별 브라우저 오픈) + Codex `.codex/agents/*.toml` 동기화 계획. **DoD: A30,A30w,A31,A32,A33,A34.**
각 마일스톤 = codex+agy 게이트 통과 후 진행.

## 8. 리스크 레지스터
| 리스크 | 영향 | 완화 | 검증 |
|--------|------|------|------|
| Windows 프로세스 종료(v0.5 shell) | 높음 | `taskkill /T` 트리 종료 + 레지스트리+identity 3중 검증(Job Object는 Win32 API→v0.6 native) | M3 3-OS CI |
| 오kill(레지스트리 스푸핑) | 높음 | 서명+identity+exe/cwd 3중, `_workspace` 밖 0700/ACL | M3 kill 오작동 테스트 |
| startTime 이식성 | 중 | shell(ps/PowerShell), 실패 시 kill 안 함 | M3 fixture |
| 구조화 로그 스키마 변경 | 중 | `--json`/stream-json만, 어댑터 버전 태그, 커서 멱등 | M2 fixture(고정 JSONL) |
| 토큰 유출 | 중 | bootstrap 교환+무효화·로그 미기록 | M4 보안 테스트 |
| TOCTOU/심링크 | 중 | fd 앵커·심링크 거부·불변 스냅샷 | M4 traversal 스위트 |
| 레지스트리 손상/부분쓰기 | 중 | 원자쓰기(fsync+rename)·서명 무효 시 무시·**rollback: 손상 시 stale 처리 후 재생성** | M2/M3 crash 주입 |
| 런처 npm 설치 공급망(postinstall) | 중 | **명시 동의 게이트**(silent 금지)·`npm ci`(lockfile 결정적)·execFile+argv·설치 로그 표시 | M6 동의 우회 테스트(A33) |

**교차 OS CI(MUST):** GitHub Actions Linux+macOS+Windows 매트릭스로 M2·M3·M5 회귀 + 보안 스위트 실행.
**Fixture 스위트:** `test/fixtures/runs/`(schema-valid·손상·부분라인 events·stale·PID-reuse 시나리오), mock runner 구조화 JSONL 샘플, snapshot import raw 샘플. 각 수용기준↔fixture 매핑.

## 9-STATE. `<state_home>` (확정 — A3 blocking#2)
- macOS: `~/Library/Application Support/harness-ui/`
- Linux: `${XDG_STATE_HOME:-$HOME/.local/state}/harness-ui/`
- Windows: `%LOCALAPPDATA%\harness-ui\`
하위 `registry/`(0700/ACL), `keys/`(세션키 0600/ACL). `_workspace`와 분리(스푸핑·gitignore 유출 차단).

## 9. 잔여 (v0.6 or 구현 세부)
- native identity/Job Object 최적화(v0.5=shell 확정). **v0.5 알려진 갭:** Windows에서 등록 root PID 종료 후 손자 프로세스 잔존 시 `taskkill /T` 미도달(A21b) → v0.6 Job Object로 완전 컨테인먼트. v0.5는 이 경우 stale/failed 표시만(오kill 없음).
- 오케스트레이터 상태기록 규약 주입(v0.6).
- events `agent/skill/usage`는 **스키마 선반영 완료**(§5), 관측성 소비는 v0.6.

## 다음 단계 참조
- 이 r2 → codex+agy **R4 재인증** → 수렴 시 v0.5 확정·M1 착수.
- **핵심 결정:** README 무효 섹션 명시(§0-VOID)·`<state_home>` 확정·published Zod(schema-valid)·shell identity·매트릭스 1:1·positive 행·SHOULD 복원·CI 매트릭스.
- **주의:** dev는 §0-VOID 섹션을 README에서 읽지 말 것. schema-valid=§5 Zod parse. kill=3중검증. 각 마일스톤 게이트 외부감사.
