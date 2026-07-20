# Harness UI v0.5.1 설계 개정안 (외부감사 반영 초안)

> 원 설계 `README.md`(v0.5)의 외부감사(codex+agy, 2026-07-08) MUST-FIX 6건 반영 델타.
> 감사 결과서: `../working_history/A1_설계감사_20260708_224531.md`.
> 상태: **초안 · 미검증** — 구현 착수 전 재감사 필요. 확정 시 원 README에 병합 or v0.5.1 승격.
> 이 문서는 원 설계를 대체하지 않고 **변경 지점만** 기술한다(그 외는 README 유효).

---

## R1. Run Supervisor = 상태 스키마 최종 저자 (닭-달걀 해소)

**문제:** UI가 읽는 `_workspace/runs/**` 스키마를 현 오케스트레이터가 안 씀. 수용기준은 실 스모크가 그 파일 생성 요구 → 순환 의존.

**개정:** LLM 협조와 **무관하게** supervisor가 스키마를 직접 기록한다.
- supervisor가 run 시작 시 `manifest.json`·`status.json(queued)`를 쓴다(LLM 실행 전).
- child spawn·heartbeat·exit code·cancel·stale = supervisor가 기록(LLM 아님).
- LLM/오케스트레이터는 **raw log와 artifact만** 남긴다. supervisor가 tail·정규화해 `events.jsonl`로 승격.
- 따라서 "실 codex 스모크가 schema-valid 파일 생성" 수용기준은 **supervisor 경유로 자동 충족** — 오케스트레이터 개조가 선행조건 아님.
- 오케스트레이터 상태기록 규약(README §Claude/Codex 실행 전략 "필요한 보강")은 **v0.6 이관** — v0.5.1은 supervisor 단독으로 성립.

**UI 테스트:** mock runner(고정 스키마 파일 방출 스크립트)로 UI/reconcile를 LLM·비용 없이 검증. 실 CLI 스모크는 opt-in.

## R2. 크로스플랫폼 프로세스 관리 = OS 어댑터

**문제:** reconcile가 POSIX 전용(`kill(-pgid,0)`·음수PID 시그널·process group·타 프로세스 `environ` 읽기·portable birth-time 없음). Windows 수용 불가, macOS/Linux도 환경 조회 상이.

**개정 — 어댑터 인터페이스:**
```ts
interface ProcessSupervisorAdapter {
  spawnRun(argv: string[], opts: SpawnOpts): ProcessHandle;   // detached/job, 로그파일 stdio
  identity(pid: number): ProcessIdentity | null;              // {pid, startTime, groupId, exe, cwd}
  groupAlive(groupId: GroupId): boolean;                      // POSIX: kill(-pgid,0) / Windows: Job 조회
  terminateGroup(groupId: GroupId, graceMs: number): void;    // POSIX: SIGTERM→SIGKILL / Windows: TerminateJobObject
}
```
- **POSIX 어댑터(macOS/Linux):** process group(`detached`, `subprocess.pid`=pgid). identity = pid start time + pgid + exe/cwd(가능한 것). group 생존 = `kill(-pgid,0)`.
- **Windows 어댑터:** POSIX 로직 **재사용 금지**. Job Object로 프로세스 트리 소유·종료(`TerminateJobObject`). 음수PID·시그널·pgid 미사용.
- **child environ 읽기 제거(req):** 소유권 증명을 타 프로세스 environ(`HARNESS_RUN_ID`)에 의존하지 않는다 — Linux `/proc`만 되고 macOS/Windows 불가. 대신 **spawn 시 supervisor 소유 레지스트리** 기록:
  ```
  _workspace/runs/{run_id}/owner.json
  { "pid", "groupId", "startTime", "exe", "cwd", "nonce", "adapter": "posix|windows" }
  ```
  reconcile는 이 레지스트리 + `identity(pid)` 대조로 판정(environ 불요).
- **Windows 지원 결정(미확정 · 제품):** (A) Job Object 어댑터 구현 or (B) v0.5.1은 macOS/Linux만, Windows는 감지·표시만(실행 미지원 명시). 수용기준을 선택에 맞춤.

## R3. detached child stdio = 로그 파일 (pipe 금지)

**문제:** `stdio:["ignore","pipe","pipe"]`+`detached` → supervisor 사망 시 pipe read-end 닫힘 → child EPIPE/SIGPIPE 사망. orphan reconcile 전제(child가 supervisor보다 오래 삶) 자체 붕괴.

**개정:** child stdout/stderr를 **파일로 직접** 리다이렉트.
```ts
const out = fs.openSync(`${runDir}/agents/${agent}.out.log`, "a");
const err = fs.openSync(`${runDir}/agents/${agent}.err.log`, "a");
execFile(cmd, argv, { cwd: projectRoot, detached: true, stdio: ["ignore", out, err], env });
```
- supervisor는 파일을 **tail·정규화**해 `events.jsonl` 승격(README §동시성 규칙과 정합 — 이제 실제로 pipe 안 씀).
- child는 supervisor와 파일 디스크립터 공유 안 함 → supervisor 죽어도 생존.

## R4. 범위/수용 정합 (supervisor를 순서에 삽입)

**문제:** 구현순서 dry-run(step13)까지인데 수용기준은 실행·cancel·process-tree kill·재시작 reconcile 요구.

**개정 — 구현 순서 재배치:**
```
1  harness-ui 스캐폴딩
2  runtime detection API
3  harness inventory API
4  agents/skills API
5  workspace runs 스키마 + reader
6  ★ Run Supervisor(POSIX 어댑터): spawn(로그파일 stdio)·owner.json·heartbeat·exit·cancel(group 종료)
7  ★ mock runner + reconcile(재시작·stale·leaderless·PID reuse) 회귀 테스트
8  Overview / Agents / Skills / Runs / Ops / Drift 화면
9  Build 화면 dry-run
10 ★ 실 codex/claude 스모크(opt-in) — schema-valid status/events/agent 생성
11 (선택) Windows 어댑터 or 미지원 명시
12 Codex .codex/agents/*.toml 동기화 계획
```
- 수용기준의 실행·reconcile 항목은 6·7·10 이후에만 검증 가능 — 순서가 이를 만든다.
- 실행까지 v0.5.1에 안 넣으면(dry-run만) → 실행·cancel·reconcile 수용항목을 **v0.6로 강등**하고 명시.

## R5. 접속 토큰 = 0600 파일 (stdout 유출 제거)

**문제:** 접속 URL `?token=`를 터미널 출력 → scrollback/히스토리/세션녹화 유출. 동일 호스트 타 유저 접근. 재사용·무효화 미정의.

**개정:**
- CSPRNG **≥128bit** session token. 터미널에 **토큰 미출력**.
- 토큰을 `_workspace/.ui-session-token`(mode **0600**)에 기록. 접속 도우미(`npm run open` or CLI)가 파일에서 읽어 브라우저 bootstrap.
- (또는) 1회용 bootstrap 토큰 → 최초 요청서 별도 session token 교환 후 **bootstrap 즉시 무효화**.
- 쿼리스트링 토큰 서버 로깅 금지. 종료 시 토큰 파일 삭제.
- (원 README의 Host/Origin/CORS/nosniff 등은 유지.)

## R6. 파일 서빙 TOCTOU + 심링크

**문제:** `realpath` 검사 후 open 사이 갭 — writable `_workspace`서 심링크 교체로 루트 탈출. 내부 심링크가 밖 지목 가능.

**개정:**
- **open-then-verify:** `fs.open`으로 fd 확보 → `fstat`로 정규파일 확인 → fd로 스트리밍(경로 재해석 없음). 스트리밍 직전 `realpath` 재검.
- 서빙 대상 **심링크 거부**(`lstat`로 각 세그먼트 검사, `S_ISLNK`면 거부).
- 가능하면 불변 스냅샷 디렉토리서 서빙(사용자가 read 중 경로 스왑 불가).
- (원 README의 SAFE_SEGMENT·realpath 루트검사·`..` 거부는 유지 — 이 개정은 그 위에 fd 앵커링 추가.)

---

## SHOULD 반영(요약 — 상세는 구현 시)
- `events.jsonl`: 재시작 시 tail 파손라인 안전 절단 + max seq 복구 + per-run lock + `fsync(file)+fsync(dir)`. 원자교체 temp는 **대상과 동일 디렉토리**.
- 스키마 버전화: 모든 상태파일 `schemaVersion`. `status.json`에 `cancelRequestedAt`·`exitSignal`·`stateReason`·terminal 타임스탬프. `manifest.json`에 `targets`·`permissionMode`·`model`·`supervisorVersion` 추가. agent state enum 분리 정의.
- 페이지네이션: `after` = exclusive, `limit` clamp, 응답 `{items,nextAfter,hasMore,runState,schemaVersion}`, 파손/절단 이벤트파일 동작 정의.
- dev-proxy: Host 허용값을 모드별 명시(`127.0.0.1:{port}`·`localhost:{port}`·`::1` 결정). proxy 헤더는 명시 신뢰 시만.
- artifact: 바이트 한도·스트리밍 한도·제어문자 escape·다운로드 파일명 sanitize·미지 타입 inline 렌더 금지.
- CLI: `--allowedTools`는 **variadic** — 콤마 1문자열 아닌 **배열**로 전달(`["Read","Grep",...]`). `--tools`는 존재하지 않으니 쓰지 말 것.
- drift: `DriftFinding` 스키마(id·severity·runtime·paths·evidence·suggestedAction).

## 미반영/보류 (의도)
- 오케스트레이터 상태기록 규약 주입 → v0.6(R1로 v0.5.1은 불요).
- SSE: v0.5.1 기본 cursor polling 유지(EventSource 쿼리토큰 금지 — 원 README 유효).
- HTML preview iframe 미제공 유지.

## 다음 단계 참조
- 이 개정안 → codex+agy 재감사 → 확인분 반영 → 원 `README.md` 병합 or v0.5.1 태그.
- **미확정 제품 결정 2건:** (1) Windows = Job Object 구현 vs 미지원 명시 (2) v0.5.1에 실행 포함 vs dry-run만(실행은 v0.6). 이 둘이 수용기준·순서를 좌우.
- 구현 착수는 재감사 통과 후.
