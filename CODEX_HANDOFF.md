# Codex Session Handoff

작성일: 2026-06-27  
다음 세션 시작 위치: `D:\folkProject\my_harness`

## 새 세션에서 가장 먼저 할 일

```powershell
Get-Content -Raw .\CODEX_HANDOFF.md
git status -sb
git log -2 --oneline
gh pr view 3 --repo cookyman74/my_harness
```

`CODEX_HANDOFF.md`는 세션 인계용 로컬 파일이다. 현재 PR에는 포함하지 않았다.

## 현재 목표와 진행 결과

`cookyman74/my_harness`를 분석한 뒤 다음 6개 개선을 전량 구현했다.

1. `harness-update.sh`의 사용자 수정 기준선 보존
2. 연속 업데이트 회귀 테스트
3. LF 강제와 Windows 설치 지원
4. `CLAUDE.md`·`CONTRIBUTING.md` drift 제거
5. 정책 감사 확장
6. Linux/Windows CI 추가

Draft PR:

- URL: https://github.com/cookyman74/my_harness/pull/3
- 제목: `Windows 설치와 하네스 업데이트 안전성 보완 제안`
- base: `cookyman74/my_harness:main`
- head: `hang-in/my_harness:codex/harden-update-windows-ci`
- 브랜치: `codex/harden-update-windows-ci`
- 상태: Draft, MERGEABLE

커밋:

```text
15b7d53 fix: harden harness updates and Windows support
6ce7aa3 fix: validate Windows reviewers and Codex agents
```

## PR에 포함된 핵심 변경

- 보류된 `USER-MODIFIED` 파일의 기존 manifest 기준선을 유지
- 복사/manifest 쓰기 실패를 exit 1로 전달
- `tests/test-harness-update.sh` 추가
- `.gitattributes`로 `*.sh` LF 강제
- Windows용 `install.ps1` 추가
- Git Bash를 우선 사용해 Windows용 `claude`·`agy` 탐지
- Linux/Windows GitHub Actions 추가
- `CLAUDE.md`를 현재 정본 `skills/myharness/` 구조에 맞게 정리
- 정책 감사에 README 3종 버전, runtime 포인터, 문서 명령 경로, LF 정책 검사 추가
- Codex custom agent의 필수 필드인 `name`, `description`, `developer_instructions` 문서화 및 감사

PR 본문은 한국어이며, 문제를 단정하기보다 재현 내용과 제안 이유를 설명하고 범위 조정 의사를 밝히는 공손한 형식으로 작성했다. 실제 설치 스모크에서 추가 발견한 내용도 본문 끝에 기록했다.

## 실제 설치 상태

팩토리 스킬은 현재 junction으로 설치되어 있다.

```text
C:\Users\사자\.codex\skills\myharness
  -> D:\folkProject\my_harness\skills\myharness

D:\folkProject\my_harness\.agents\skills\myharness
  -> D:\folkProject\my_harness\skills\myharness
```

도구 버전:

```text
codex-cli 0.142.3
Claude Code 2.1.195
agy 1.0.9
```

Codex 주 런타임 기준 탐지 결과:

```text
AVAILABLE: codex claude agy
RUNNER: codex
REVIEWERS: claude agy
```

재확인 명령:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' `
  .\skills\myharness\scripts\check-review-tools.sh codex
```

## 실제 사용 스모크 결과

별도 테스트 프로젝트:

```text
D:\folkProject\myharness-smoke
```

수행한 검증:

- 새 `codex exec` 세션에서 전역 `$myharness` 로드 성공
- `$myharness`로 최소형 PowerShell 리뷰 하네스 생성
- 생성된 `powershell-review-orchestrator` 스킬 재로딩 성공
- 주 실행 런타임 `Codex` 확인
- 외부 리뷰어 `claude`, `agy` 확인
- custom agents `powershell-reviewer`, `review-verifier` 로드 확인
- `tests\Test-Harness.ps1` PASS

생성 명령은 10분 제한에 도달했지만 파일 생성은 대부분 완료돼 있었다. 생성된 `Install-CodexHarness.ps1`로 `.codex/agents/`와 `.agents/skills/` 설치를 완료했다.

첫 재로딩에서는 생성된 `.codex/agents/*.toml`에 `name`이 없어 Codex가 agent를 무시했다. 생성물에 `name`을 추가하고 팩토리의 `SKILL.md`, `runtime-adapters.md`, 정책 감사를 함께 수정했다. 이후 재로딩에서는 두 custom agent가 경고 없이 정상 인식됐다.

이번 스모크에서는 비용 제한을 위해 Claude/agy 외부 리뷰를 실제 실행하지 않았으며, 설치 탐지와 오케스트레이터 배선까지만 검증했다.

## 완료된 로컬 검증

```text
bash skills/myharness/scripts/run-policy-audit.sh
  PASS (fail 0, warn 0)

bash tests/test-harness-update.sh
  PASS

install.ps1 PowerShell parser
  PASS

Windows junction 설치
  PASS

GitHub Actions YAML parse
  PASS

git diff --check
  PASS
```

## 현재 작업 트리 주의사항

Windows 설치가 tracked Git symlink placeholder를 junction으로 교체했기 때문에 다음 항목이 Git에서 삭제처럼 보인다.

```text
D .agents/skills/myharness
```

실제 파일이 삭제된 것은 아니다. 현재 경로는 정상 junction이며 `SKILL.md`에 접근할 수 있다. 이 항목을 PR에 stage하거나 커밋하지 말 것.

또한 이 인계 문서가 untracked 상태로 보일 것이다.

```text
?? CODEX_HANDOFF.md
```

전체 작업 트리에 `git add -A`를 사용하지 말고, 필요한 파일만 명시적으로 stage한다.

## 다음 권장 작업

1. 새 Codex 세션에서 `$myharness`가 스킬 목록에 나타나는지 확인
2. PR #3의 새 댓글과 리뷰 요청 확인
3. GitHub Actions 실행이 생성되는지 확인
   - 현재 PR 조회에서는 `statusCheckRollup`이 비어 있었다
   - 원본 저장소 Actions 정책 또는 fork PR 승인 대기 가능성 확인 필요
4. 필요하면 작은 샘플 `.ps1`을 대상으로 실제 Claude/agy 외부 리뷰까지 1회 실행
5. maintainer 피드백이 오면 범위를 분리하거나 축소

## 새 세션용 권장 프롬프트

```text
CODEX_HANDOFF.md를 먼저 읽고 현재 브랜치와 PR #3 상태를 확인해줘.
tracked symlink가 junction으로 바뀌어 보이는 `.agents/skills/myharness`는
stage하지 말고, PR 리뷰와 CI 상태부터 점검해줘.
```
