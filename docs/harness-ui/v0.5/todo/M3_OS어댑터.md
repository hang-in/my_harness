# M3 작업계획서 — OS 어댑터 (reconcile 3-OS)

> 근거 §4-B·§4-C·§8. DoD: **A18,A19,A20,A21,A21b,A22**. 게이트: kill 오작동 0 + 3-OS CI + 외부감사.

## 작업 — `identity(pid)` (shell, §4-B)
- [ ] Linux: `/proc/<pid>/stat`(f22 starttime)·`/proc/<pid>/exe·cwd`·pgid
- [ ] macOS: `ps -o lstart=`(**불투명 문자열·정확일치, 파싱 금지**)·`ps -o comm=`·`lsof cwd`·`ps -o pgid=`
- [ ] Windows: `Get-CimInstance Win32_Process` CreationDate(불투명 비교)·`ExecutablePath`, `npm.cmd`/`node.exe` 해소
- [ ] 전 호출 execFile+argv. startTime 실패→kill 안 함. PID reuse=pid+startTime 동일성

## 작업 — reconcile (§4-C)
- [ ] **POSIX**: pgid `kill(-pgid,0)` 생존확인 → `SIGTERM`→(유예)→`SIGKILL` → 실패 시 레지스트리 fallback
- [ ] **Windows**: `detached` spawn, cancel·reconcile = 레지스트리+identity(pid+CreationDate) **3중 검증 통과분에만** `taskkill /T /PID`(argv). 생존=`tasklist /FI "PID eq <pid>"`+CreationDate
- [ ] **kill 3중 검증(비협상)**: 서명 유효 ∧ identity 대조 ∧ exe/cwd 일치 → 전부 통과만 kill. 불일치=kill 안 함, stale/failed
- [ ] 서버 재시작 시 `_workspace/runs/*/status.json` running 스캔 → reconcile
- [ ] **레지스트리 손상 rollback**(§8): reconcile 중 서명 무효/파손 → kill 안 함, `stale` 태깅 후 재생성

## 수용기준 (DoD)
- [ ] **A18** cancel → process tree 종료 → `cancelled`
- [ ] **A19** 고아 running = 서명+identity 통과 시만 종료, 불일치 시 kill 안 함
- [ ] **A20** PID reuse(startTime 불일치) → kill 안 함
- [ ] **A21** Windows: 레지스트리+identity 검증 후 `taskkill /T` 트리 종료
- [ ] **A21b** Windows dead-root(손자 잔존) → taskkill 미도달 = stale/failed 표시만(오kill 0). *(완전 정리는 v0.6 Job Object)*
- [ ] **A22** detached child 별도 pgroup(POSIX)/detached(Windows)

## 테스트/fixture
- [ ] 3-OS CI 매트릭스(Linux/macOS/Windows GitHub Actions)
- [ ] fixture: 살아있는 run·죽은 root·PID reuse·서명 불일치·exe/cwd 불일치
- [ ] **kill 오작동 0** 검증(무관 프로세스 종료 없음 — 스푸핑 레지스트리)

## 게이트
- [ ] 결과서 + `check-artifacts` PASS · 외부감사 PASS · 3-OS CI GREEN

## 다음 단계 참조
- M4 착수 조건: supervisor+reconcile 안정(실행 인프라 완비). 화면이 status/events/agents/reconcile 결과를 표시하므로 상태 계약 고정. Windows dead-root 갭(A21b)은 알려진 한계로 문서화 유지.
