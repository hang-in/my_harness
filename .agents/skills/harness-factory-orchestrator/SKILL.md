---
name: harness-factory-orchestrator
description: "my_harness 팩토리 자체의 정책·스크립트·설치·업데이트·듀얼 런타임 문서를 구현, 감사, 수정, 보완, 재실행하는 Codex 우선 오케스트레이터. '팩토리 고쳐줘', '정책 감사', 'Windows/Linux 설치 수정', 'harness-update 변경', 'Claude/Codex drift 확인', '이전 결과 기반 개선' 요청이면 반드시 사용. 다른 프로젝트용 하네스 신규 생성은 myharness 스킬을 사용."
---

# Harness Factory Orchestrator

이 저장소 자체의 변경을 구현하고 내부 검증과 외부 독립 리뷰를 거쳐 판정한다.

## 실행 모드

- 주 런타임: **Codex**
- 패턴: 감독자 + 생성-검증
- Codex: `.codex/agents/*.toml` subagents와 `_workspace/` 파일 전달
- Claude Code 호환: `.claude/agents/*.md` 팀원 정의
- 외부 리뷰: Codex를 제외한 `claude` + `agy`

## 에이전트 구성

| 에이전트 | 권한 | 역할 | 출력 |
|---|---|---|---|
| `factory-maintainer` | workspace-write | 승인 범위 구현 | `_workspace/20_implementation.md` |
| `runtime-parity-auditor` | read-only | 듀얼 런타임 의미 정합성 | `_workspace/30_parity_audit.md` |
| `regression-verifier` | read-only | 정책·회귀·구문 검증 | `_workspace/40_regression_report.md` |

## Phase 0: 컨텍스트 확인

1. `git status -sb`, 현재 브랜치, 열린 PR과 사용자 변경을 확인한다.
2. `CODEX_HANDOFF.md`가 있으면 먼저 읽되 로컬 전용 여부를 존중한다.
3. `_workspace/` 상태로 실행을 분기한다.
   - 없음: 초기 실행
   - 부분 수정 요청: 기존 산출물을 읽고 해당 단계만 재실행
   - 새 입력: 기존 디렉터리를 `_workspace_YYYYMMDD_HHMMSS/`로 보존한 뒤 새로 시작
4. 변경 위험을 분류한다.
   - 경량: 1파일·가역 → 내부 QA
   - 표준: 다파일·기능 → 내부 QA + 끝단 외부 리뷰 1회
   - 중대: 계약·비가역·다도메인 → 단계별 승인과 외부 리뷰

## Phase 1: 계획과 기준선

1. 관련 정본만 점진적으로 읽는다.
2. `_workspace/00_context.md`에 범위, 보호할 변경, 기준선 상태를 기록한다.
3. `_workspace/10_plan.md`에 변경 파일, 성공 기준, 검증 명령을 기록한다.
4. 실행 전 기준선:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' skills/myharness/scripts/run-policy-audit.sh
& 'C:\Program Files\Git\bin\bash.exe' tests/test-harness-update.sh
git diff --check
```

관련 없는 테스트는 생략 사유를 기록한다.

## Phase 2: 구현

`factory-maintainer`가 계획 범위만 수정한다. Codex에서는 해당 custom agent를 사용하고, 독립 subprocess가 필요할 때만 `codex exec --sandbox workspace-write`를 사용한다.

- 행위 변경은 Red→Green→Refactor 순서를 따른다.
- 구조 변경과 행위 변경을 섞지 않는다.
- `.agents/skills/myharness` junction과 `CODEX_HANDOFF.md`를 stage하지 않는다.
- 에이전트는 커밋·push·브랜치 변경을 하지 않는다.

## Phase 3: 내부 생성-검증

가능하면 감사자와 검증자를 병렬 실행하되 동시성 cap은 2다.

1. `runtime-parity-auditor`가 생산자와 소비자를 양쪽 동시에 읽는다.
2. `regression-verifier`가 계획의 명령을 실행하고 exit code와 부작용을 기록한다.
3. 오케스트레이터가 모든 finding을 실파일과 대조해 확인·부분 확인·이월·기각으로 판정한다.
4. 확인된 항목만 구현자에게 되돌리고 최대 2회 반복한다.

## Phase 4: 외부 독립 리뷰

표준·중대 변경에만 `.agents/skills/external-review-loop/SKILL.md`를 사용한다.

1. `scripts/check-review-tools.sh codex`의 `REVIEWERS:`를 확인한다.
2. `claude`는 일반·정합성, `agy`는 성능·안정성 관점으로 읽기 전용 리뷰한다.
3. Codex는 러너이므로 리뷰어에서 제외한다.
4. 오케스트레이터가 리뷰 전건을 실파일과 대조해 최종 판정한다.
5. 수정 후 변경 diff만 재리뷰하고 신규 확인 0건이면 종료한다. 최대 3라운드다.

## Phase 5: 최종 게이트와 승인

```powershell
& 'C:\Program Files\Git\bin\bash.exe' skills/myharness/scripts/run-policy-audit.sh
& 'C:\Program Files\Git\bin\bash.exe' tests/test-harness-update.sh
git diff --check
```

- 변경별 추가 검증을 함께 실행한다.
- PASS 후에도 기본은 사용자 승인 전 커밋하지 않는다.
- `_workspace/.autonomous`는 커밋 승인만 자동화하며 push는 자동화하지 않는다.
- push는 `_workspace/.autonomous-push`가 있을 때만 허용한다.

## 데이터 흐름

```text
요청 → 00_context → 10_plan → factory-maintainer
  → 20_implementation → parity audit + regression verification
  → Codex 판정 → Claude Code + agy 외부 리뷰
  → Codex 판정·수정 → 최종 게이트 → 사용자 승인
```

## 에러 핸들링

- 단일 에이전트 실패: 1회 재시도 후 누락과 잔여 위험을 보고한다.
- 외부 리뷰어 실패: 1회 재시도 후 가능한 단일 리뷰어와 내부 QA로 진행한다.
- 과반 검증 실패 또는 기준선 실패: 구현을 중단하고 사용자에게 범위와 원인을 보고한다.
- 작업 트리 오염: 자동 삭제하지 않고 경로와 복구 방안을 제시한다.

## 테스트 시나리오

### 정상 흐름
`harness-update.sh` 변경 요청 → 기준선 PASS → 구현 → 런타임 정합성·회귀 검증 → Claude Code·agy 리뷰 → 확인분 수정 → 최종 PASS.

### 에러 흐름
Windows 테스트가 junction 상태를 바꿈 → 검증자가 오염 경로를 보고 → 오케스트레이터가 사용자 변경과 구분 → 자동 삭제 없이 복구 승인을 요청.

## 다음 단계 참조

다음 세션은 최신 `_workspace/40_regression_report.md`와 `_workspace/reviews/` 판정 원장을 먼저 읽는다. 영속 결과가 있으면 `docs/my-harness/working_history/`의 최신 파일을 우선한다.
