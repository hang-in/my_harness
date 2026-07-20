# M2 작업계획서 — Supervisor 코어

> 근거 §3·§4-A·§5. DoD: **A6be, A24, A25**. 게이트: mock runner 검증 + 3-OS CI + 외부감사.

## 선행
- [ ] `ProcessSupervisorAdapter` 인터페이스 정의(spawnRun·identity·groupAlive·terminateGroup) — 구현은 M3, IF만
- [ ] `<state_home>/registry`·`keys` 디렉토리(0700/ACL) 생성 로직
- [ ] **HMAC 세션키 수명주기**: 기동 시 CSPRNG 생성·`<state_home>/keys`(0600/ACL) 저장·로드(레지스트리 서명용)
- [ ] **3-OS CI 워크플로 존재 확인**(M1 산출) — M2 게이트 전제

## 작업
- [ ] run 시작: supervisor가 `manifest.json`+`status.json(queued)` 기록(LLM 전)
- [ ] **spawn**: `execFile`+argv, `detached: true`, stdio=`["ignore", 로그파일fd, 로그파일fd]`(pipe 금지), spawn 후 supervisor fd 복사본 **close**
- [ ] **서명 owner 레지스트리**(§4-A): `{pid,groupId|jobName,startTime,exe,cwd,nonce}` + HMAC 서명, `O_EXCL` 생성, 세션키 0600/ACL
- [ ] heartbeat: `status.heartbeatAt` 주기 갱신
- [ ] **구조화 로그 tail**: `codex --json`/`claude stream-json` 파싱 → `events.jsonl` 승격
- [ ] **status.json 동적 갱신**: 파싱한 로그에서 state·phase·progress·summary·usage 갱신(원자쓰기). run별 최종 저자=supervisor
- [ ] **agents/{name}.json 작성·갱신**: 에이전트 시작/완료/오류 이벤트에서 AgentState 기록(schema-valid)
- [ ] **레지스트리 손상 rollback**(§8): 서명 무효/파손 감지 → 해당 run `stale` 처리 후 레지스트리 재생성(오kill 없이)
- [ ] **영속 커서**: 로그별 `{path,dev,inode,offset,lastLineHash}` 기록·재개, 부분라인 안전절단, inode 변화=rotation
- [ ] **events 멱등**: 결정적 id dedup, `seq` = 메모리+per-run lock 단조증가, 재시작 시 tail로 max 복구
- [ ] **원자 상태쓰기**: 동일 디렉토리 temp→`fsync(file)`→`rename`→`fsync(dir)`. events는 append+주기 fsync
- [ ] exit 감시: exit code/signal 기록 → `completed`/`failed`
- [ ] **mock runner**: raw 구조화 JSONL + artifact만 방출(스키마 직접 방출 금지)

## 수용기준 (DoD)
- [ ] **A6be** mock runner → **supervisor가** schema-valid manifest/status/events/agents 생성(supervisor가 저자임을 assert)
- [ ] **A24** events.jsonl append가 전체 재작성 없이
- [ ] **A25** supervisor 재시작 시 커서로 이벤트 누락/중복 없이 재개

## 테스트/fixture
- [ ] fixture: 고정 구조화 JSONL·손상 tail·부분라인·rotation
- [ ] crash 주입 테스트(재시작 max seq 복구·dedup·원자쓰기 무손상)
- [ ] 레지스트리 서명 검증·`O_EXCL` 충돌

## 게이트
- [ ] 결과서 + `check-artifacts` PASS · 외부감사 PASS · 3-OS CI GREEN · typecheck

## 다음 단계 참조
- M3 착수 조건: 어댑터 IF 확정·레지스트리 서명·구조화 로그 커서 안정. reconcile(M3)이 레지스트리+identity에 의존하므로 서명 스키마 고정 필수. mock runner는 M3 reconcile 회귀에 재사용.
