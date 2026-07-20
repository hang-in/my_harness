# Harness UI v0.5.2 설계 개정안 (재감사 반영 — Windows 완전 지원)

> v0.5.1 개정안의 재감사(codex+agy, 2026-07-08 R2) MUST-FIX 반영. **제품 결정: Windows 실행 완전 지원(Job Object 어댑터).**
> 이전: `design-revision-v0.5.1.md`(supersede). 원 설계: `README.md`. 감사 결과서: `../working_history/`.
> 상태: **초안 · 재감사(R3) 대기.** 변경 지점만 기술.

---

## R2-A. 프로세스 소유권 = 서명된 supervisor-전용 레지스트리 (스푸핑 차단)

**문제(R2 재감사):** `_workspace/runs/{run_id}/owner.json`는 writable → 공격자/오염 agent가 `groupId`를 임의 PID로 위조 → reconcile 시 supervisor가 무관 프로세스 kill(권한 상승).

**개정:**
- 레지스트리를 **supervisor-전용 디렉토리**로 이동 — `_workspace` 밖. POSIX `0700`, Windows ACL(현재 유저 전용):
  ```
  <state_home>/harness-ui/registry/{run_id}.owner.json   # <state_home> = OS별 앱 상태 디렉토리, _workspace 아님
  ```
- 생성은 `O_EXCL`(존재 시 실패 — 재사용/덮어쓰기 공격 차단).
- 레코드에 supervisor 세션 키로 **HMAC 서명**(키는 supervisor 프로세스 메모리 + 0600 키파일, agent 접근 불가). reconcile은 서명 검증 후에만 신뢰.
- **미신뢰 레지스트리 단독 kill 금지(req):** kill 전 ① 서명 유효 ② `identity(pid)` 대조(아래 R2-B) ③ exe/cwd 일치 **모두** 통과해야. 하나라도 불일치 → kill 안 함, `stale`/`failed` 표시만.
- `_workspace/runs/{run_id}`에는 UI 표시용 비신뢰 상태만(kill 판단 근거로 쓰지 않음).

## R2-B. process identity = OS 어댑터 (native/shell, Node 한계 명시)

**문제:** Node 내장 API로 PID의 birth-time/exe/cwd 조회 불가. v0.5.1이 미명세.

**개정 — `identity(pid)` OS별 구현:**
| OS | startTime | exe | cwd | group/job |
|----|-----------|-----|-----|-----------|
| Linux | `/proc/<pid>/stat`(field 22 starttime) | `/proc/<pid>/exe` | `/proc/<pid>/cwd` | pgid(`/proc/<pid>/stat`) |
| macOS | `ps -o lstart= -p <pid>` or `proc_pidinfo`(native) | `ps -o comm=`/`proc_pidpath` | `lsof -a -p <pid> -d cwd`(권한 주의) | pgid(`ps -o pgid=`) |
| Windows | `Process.StartTime`(PowerShell `Get-CimInstance Win32_Process` CreationDate) | `ExecutablePath` | `wmic`/PowerShell | **Job Object**(아래 R2-C) |
- 구현은 shell 호출(ps/PowerShell) 우선, 성능 필요 시 native addon 선택. **shell 호출은 execFile+argv(문자열 조합 금지).**
- PID reuse 판정 = pid + startTime(생성시각) 쌍. startTime 조회 실패 → 소유 미확정 → kill 안 함.

## R2-C. Windows Job Object 수명 ↔ 생존 모순 해소

**문제(R2 재감사, 날카로움):** Job 핸들 닫힘(supervisor 사망)=`KILL_ON_JOB_CLOSE`면 child 종료 → orphan 없음 → reconcile 불가. R3(생존)과 충돌.

**개정 — Windows 실행 모델:**
- child spawn 시 **named Job Object** 생성, `KILL_ON_JOB_CLOSE` **미설정**(supervisor 사망해도 child 생존 — R3 충족).
- 취소(cancel)는 supervisor 생존 중 `TerminateJobObject`로 트리 일괄 종료(깨끗).
- **재시작 reconcile:** supervisor 재시작 시 named job을 이름으로 재-open 시도.
  - 재-open 성공(다른 핸들이 살아 job 유지) → job으로 상태 조회·종료.
  - 재-open 실패(job 소멸, child는 생존 가능) → **owner 레지스트리(R2-A) + `identity(pid)`(R2-B, CreationDate)** 로 fallback → 검증 통과분만 tree-kill(pid 기준, `taskkill /T` argv).
- 즉 Windows reconcile 축 = **job(생존 시) → owner 레지스트리(job 소멸 시)**. POSIX 축 = pgid → owner 레지스트리. 어댑터가 이 둘을 캡슐화.
- child environ 읽기 의존 완전 제거(모든 OS) — 소유 증명은 서명 레지스트리 + identity.

## R1/R3. 상태 기록 = supervisor + 구조화 로그 + 영속 커서 (tail 취약 해소)

**문제(R2 재감사):** 비구조 CLI 출력 tail은 CLI 변경에 취약 + 재시작 offset 미영속 → 누락/중복/seq gap. 크래시 복구가 SHOULD였음 → 코어 승격.

**개정 (MUST):**
- 런타임 로그 소스는 **구조화 JSON** — `codex exec --json`, `claude -p --output-format stream-json`. 비구조 prose 파싱 금지.
- supervisor는 로그별 **영속 커서** 기록: `{path, dev, inode, offset, lastLineHash}`. 재시작 시 커서부터 재개.
- 이벤트 승격 **멱등**: 원본 라인 파생 결정적 id → 중복 append 시 dedup. `seq`는 supervisor 메모리 + per-run lock 하에서만 증가, 재시작 시 `events.jsonl` tail로 max seq 복구.
- 부분 라인(크래시 중 half-write) 안전 절단. rotation/truncation 감지(inode 변화).
- **schema 최종 저자 = supervisor**(LLM 무관). LLM/오케스트레이터는 raw 구조화로그 + artifact만.

## R3. detached stdio = 로그 파일 + fd 수명 (v0.5.1 유지 + 보강)

- child stdout/stderr → `openSync(append)` 로그파일(pipe 금지 — EPIPE 사망 차단). v0.5.1 유지.
- **보강(fd leak):** spawn 성공 후 supervisor는 자기 fd 복사본을 **close**(child가 fd 소유). 다수 run 누적 fd 누수 방지.

## R4. 수용기준 매트릭스 (조건부 → 확정, README 정합)

**문제(R2 재감사):** v0.5.1이 "v0.6 강등 가능"만 말하고 README 수용기준(982-990)을 안 고침 → HARNESS_RUN_ID/leaderless 참조 잔존, R2와 모순.

**개정 — 수용기준 매트릭스(criterion → step → version → OS):**
- README §수용 기준의 **HARNESS_RUN_ID 기반 leaderless/environ 항목 삭제** → **owner 레지스트리 + identity 검증** 기준으로 교체:
  - "재시작 후 고아 running run은 서명 레지스트리+identity 검증 통과 시에만 종료, 불일치 시 kill 없이 stale/failed 표시"
  - "PID reuse(startTime 불일치) 시 kill 안 함"
  - "Windows: job 재-open 또는 레지스트리 fallback으로 트리 종료"
- 각 수용항목에 대상 OS 태그(POSIX/Windows/all) + 구현 step 번호 명시.
- 실행·cancel·reconcile 항목은 아래 순서 step 6/7/10 이후 검증.

## R5. 접속 토큰 = single-use bootstrap 교환 (이식성)

**문제:** `0600`은 Windows Node에서 ACL 아님 → 타 유저 토큰 read.

**개정 (이식성 우선):**
- 1차: **single-use bootstrap token** → 최초 요청서 별도 **session token 교환 후 bootstrap 즉시 무효화**. 파일 퍼미션에 의존 안 함(모든 OS 동일).
- 토큰 파일을 쓸 경우: POSIX `0600`, Windows `icacls`로 현재 유저 전용 ACL(argv 실행). 파일은 supervisor-전용 디렉토리(R2-A)와 동일 위치, `_workspace` 밖.
- CSPRNG ≥128bit. 터미널·로그에 토큰·쿼리스트링 미기록. 종료 시 삭제.

## R6. 파일 서빙 = 경계별 심링크 정책 (blanket-reject 정제)

**문제(R2 재감사 충돌):** 전면 심링크 거부는 정당한 워크스페이스(node_modules 등) 파손 / vs 서빙 보안경계엔 거부 필요.

**개정 — 경계 분리:**
- **artifact/snapshot 서빙(untrusted 보안경계):** 심링크 **거부**. leaf `O_NOFOLLOW`(가능 OS), 각 세그먼트 `lstat`로 심링크 검사. 정규파일만. 서빙은 **불변 스냅샷 디렉토리 의무**(read 중 경로 스왑 불가) — v0.5.1의 "가능하면"을 **필수**로.
- **인벤토리 read(신뢰 프로젝트 파일: agents/skills/README):** `realpath` 후 허용 루트 경계 내인지 검증(심링크 허용하되 타겟이 경계 내). node_modules 등 정당 링크 동작.
- 공통: `fs.open`으로 fd 확보 → `fstat` 정규파일 확인 → **fd로 스트리밍**(경로 재해석 없음). Node openat 부재 한계 문서화.

## SHOULD(재감사 반영 추가)
- **토큰파일·dotfile·secret 경로를 모든 file/artifact/snapshot API에서 denylist**(경로 해석 전). `.ui-session-token`·`.*`·레지스트리 경로 차단.
- **mock runner = raw 구조화로그 + artifact만 방출**(스키마 직접 방출 금지). 테스트는 **supervisor가 manifest/status/events/agents 생성했는지** assert(우회 검증 방지).
- events/status: `schemaVersion`, terminal 타임스탬프, `cancelRequestedAt`, `exitSignal`, `stateReason`. manifest에 `targets`·`permissionMode`·`model`·`supervisorVersion`.
- 페이지네이션 `after` exclusive·`limit` clamp·`{items,nextAfter,hasMore,runState,schemaVersion}`·파손 이벤트파일 동작.
- atomic 상태쓰기: temp 동일 디렉토리 + `fsync(file)+fsync(dir)` + rename.
- `--allowedTools` variadic 배열 전달(콤마 문자열·`--tools` 금지 — 실CLI 확인).
- drift `DriftFinding` 스키마.

## 구현 순서 (Windows 포함 재배치)
```
1 스캐폴딩  2 runtime detection  3 harness inventory  4 agents/skills API  5 runs 스키마+reader
6 ★ Run Supervisor 코어: spawn(로그파일 stdio·fd close)·서명 owner 레지스트리(0700/ACL)·heartbeat·구조화로그 커서·events 멱등승격
7 ★ OS 어댑터: POSIX(pgid·/proc·ps) + Windows(named Job Object·CreationDate·taskkill) + identity()·reconcile 3-OS 회귀 테스트(mock runner)
8 화면들(Overview/Agents/Skills/Runs/Ops/Drift)
9 Build dry-run
10 ★ 실 codex/claude 스모크(opt-in, 3-OS) — schema-valid 생성·cancel·재시작 reconcile
11 토큰 bootstrap 교환·denylist·심링크 경계정책 보안 테스트
12 Codex .codex/agents/*.toml 동기화 계획
```

## 미확정
- native addon vs shell(ps/PowerShell) — identity 성능/의존 트레이드오프(구현 시 결정, 기본 shell).
- `<state_home>` 실제 경로(OS별 앱 상태 디렉토리 표준).

## 다음 단계 참조
- 이 v0.5.2 → codex+agy **재감사(R3)** → 수렴 시 원 README 병합/v0.5.2 승격.
- **핵심 결정:** Windows 완전지원 확정(사용자) → Job Object(KILL_ON_JOB_CLOSE 미설정)+레지스트리 fallback, ACL 토큰, per-OS identity. owner 레지스트리는 서명+`_workspace` 밖+identity 3중 검증 통과분만 kill.
- **주의:** reconcile kill은 절대 단일 근거로 하지 말 것(서명·identity·exe/cwd 3중). raw 로그는 구조화 JSON만 파싱. artifact 서빙은 불변 스냅샷 의무.
