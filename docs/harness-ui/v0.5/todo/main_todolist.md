# Harness UI v0.5 — 마스터 작업계획서 (main_todolist)

> 근거: `../design/design-v0.5-final.md`(코어 R5 CERTIFIED · 런처 R7 대기). 각 마일스톤 = 게이트(codex+agy 외부감사) 통과 후 다음.
> 규칙: 체크박스 = 완료 조건. DoD = 해당 수용기준 전부 PASS + 게이트 통과. 상태 갱신은 최신 결과서 기준(§working_history).

## 마일스톤 개요 & 순서
- [x] **M1 기반** — 스캐폴딩·runtime detect·inventory·agents/skills API·runs reader. (A1,A3api,A5be)
- [x] **M2 Supervisor 코어** — spawn(로그파일·fd close)·서명 레지스트리·heartbeat·구조화로그 커서·events 멱등·원자쓰기. (A6be,A24,A25)
- [x] **M3 OS 어댑터** — POSIX pgroup + Windows detached pid-tree(taskkill)·identity(shell)·reconcile 3-OS CI. (A18,A19,A20,A21,A21b,A22)
- [x] **M4 화면+보안** — 6화면(+Build/Settings=8화면 IA)·drift·Ops·artifact·token·보안·**Overview 상태통계(A35-38)**·**배선/UX 보강(A39-A46)**. (A2-A5,A7,A8,A8b,A9a,A10-A14,A23,A26-A29,A35-A46)
- [x] **M5 실행 인증** — dry-run·실 스모크(opt-in, codex 스모크 로컬 PASS) 3-OS. (A6,A9b,A15,A16,A17,A17w)
- [x] **M6 런처 + Codex toml** — 첫 실행 bootstrap(경화)·`.codex/agents` 동기화 계획. (A30,A30w,A31,A32,A33,A34)

## 게이트 규율 (마일스톤 공통)
- [ ] 마일스톤 착수 전 직전 결과서 `## 다음 단계 참조` 읽기(연속성)
- [ ] 코드/수정에 TDD(RED→GREEN)·dev-rules 준수
- [ ] 마일스톤 종료 시: 결과서 `working_history/` 기록 + `check-artifacts` PASS
- [ ] 외부감사(codex+agy, 러너 claude 제외) → 확인분 수정 → 게이트 PASS
- [ ] 3-OS CI(Linux/macOS/Windows) GREEN (M2·M3·M5·M6)

## 교차 관심사 (마일스톤 걸침 — 초기 확립)
- [ ] **schema 모듈**(§5 Zod) 최우선 — manifest/status/events/agents/DriftFinding. schema-valid=`.parse()`. M1 착수 시 배치, M2부터 사용.
- [ ] **`<state_home>` 경로 어댑터**(§9-STATE) — macOS/Linux/Windows. 레지스트리·키·토큰 저장. M2 전 확립.
- [ ] **OS 어댑터 인터페이스**(`ProcessSupervisorAdapter`·identity) — M2 spawn·M3 reconcile 공유.
- [ ] **보안 미들웨어**(token bootstrap·Host/Origin·denylist·path 검증) — M4 집중이나 M1 서버 골격에 훅 배치.
- [ ] **fixture 스위트**(`test/fixtures/`) — schema-valid·손상·부분라인·stale·PID-reuse·snapshot raw. 각 수용기준↔fixture.
- [ ] **3-OS CI 매트릭스 워크플로**(`.github/workflows/ci.yml`, Linux/macOS/Windows) — **M1에서 생성**(M2 게이트가 요구 → M2 전 존재해야). M3/M5/M6 재사용.
- [ ] **HMAC 세션키 수명주기** — 서버 기동 시 CSPRNG 생성·`<state_home>/keys`(0600/ACL) 저장·로드. M2 레지스트리 서명 전제.

## 리스크 대응 (설계 §8 연동 — 계획서 반영)
- [ ] Windows 프로세스 종료(taskkill 트리 + 3중검증) — M3, dead-root 갭(A21b)은 v0.6 명시
- [ ] 오kill 방지(서명+identity+exe/cwd 3중) — M3, kill 오작동 0 테스트
- [ ] 토큰 유출(bootstrap 교환·로그 미기록) — M4/M6
- [ ] 런처 npm 공급망(동의·`--ignore-scripts`·lock 해시) — M6
- [ ] 레지스트리 손상(원자쓰기·rollback) — M2/M3

## 진행 상태 보드 (최신 결과서에서 갱신 — 이중상태 금지)
| 마일스톤 | 상태 | 게이트 | 결과서 |
|----------|------|--------|--------|
| M1 | ✅ 완료 | codex+agy 4R no-high | M1_기반_*.md |
| M2 | ✅ 완료 | codex+agy 6R no-high | M2_supervisor_*.md |
| M3 | ✅ 완료 | codex+agy 3R no-high | M3_os어댑터_*.md |
| M4(백엔드+보안) | ✅ 완료 | codex+agy 5R no-high | M4_화면보안_*.md |
| M4(UI 8화면) | ✅ 완료 | codex(R1·R4)+agy(R3) no-high | M4UI_화면_*.md |
| M5 | ✅ 완료 | codex+agy 5R no-high + 실 codex 스모크 PASS | M5_실행인증_*.md |
| M6 | ✅ 완료 | codex+agy 5R no-high | M6_런처_*.md |
| e2e | ✅ 완료 | 현 하네스 기준 17/17 PASS + A17 실 codex 스모크 PASS | (test/e2e.mjs·smoke-codex.mjs) |

## 다음 단계 참조
- **전 마일스톤 M1-M6 완료 + e2e 통과.** 각 게이트 codex+agy 외부감사 no-high, 77 유닛 + e2e 17 + 실 codex 스모크 PASS.
- 잔여(v0.6): dead-root 갭(A21b)·네이티브 identity addon·관측성 대시보드·실행파생 통계. 3-OS CI(`.github/workflows/ci.yml`)는 GitHub Actions에서 실행(로컬은 macOS만 검증).
- 상세 단계별 계획: `M1_기반.md` ~ `M6_런처.md`, 결과서 `../working_history/`.
