# Codex 주 런타임 유지보수 하네스 구성

## 목적

`my_harness` 팩토리 자체의 변경을 Codex가 조율하고, Claude Code와 agy가 외부 독립 리뷰하는 재사용 가능한 유지보수 흐름으로 구성한다.

## 범위

- Codex custom agents: 구현, 런타임 정합성 감사, 회귀 검증
- Claude Code 호환 agent 정의
- Codex 우선 오케스트레이터 스킬
- Claude Code·agy 외부 리뷰 게이트
- `AGENTS.md`·`CLAUDE.md` 진입점과 변경 이력

## 설계 결정

- 주 런타임은 Codex로 고정한다.
- 같은 엔진의 자기검증을 피하기 위해 외부 리뷰어에서 Codex를 제외한다.
- 내부 에이전트는 `_workspace/` 파일로 결과를 전달한다.
- 표준 변경은 내부 QA 후 외부 리뷰 1회, 중대 변경은 단계별 승인과 리뷰를 적용한다.
- 개인 Claude 설정은 계속 ignore하고 공유할 `agents/`와 `skills/`만 추적한다.

## 검증

구조, frontmatter, TOML 필수 필드, 듀얼 런타임 역할 정합성, 정책 감사, 회귀 테스트, `git diff --check`를 확인한다. 새 Codex 프로세스에서 오케스트레이터 스킬 로딩도 확인했다.

외부 리뷰 결과와 판정은 `_workspace/reviews/`에 보존한다. 이번 구성에서는 Claude Code가 기존 PR 커밋을 검토해 신규 하네스 범위의 판정 자료로 사용하지 않았고, agy는 제한 시간 안에 결과를 반환하지 못했다. 따라서 외부 리뷰 게이트는 저하 상태이며 내부 구조·실행 검증만 완료된 상태로 기록한다.

## 다음 단계 참조

다음 세션은 `.agents/skills/harness-factory-orchestrator/SKILL.md`와 `_workspace/reviews/`의 최신 판정 원장을 먼저 읽는다. 커밋이나 PR 반영 전 현재 브랜치의 기존 PR 범위와 분리 여부를 사용자에게 확인한다.
