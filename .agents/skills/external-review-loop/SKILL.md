---
name: external-review-loop
description: "my_harness의 표준·중대 변경을 Codex 러너와 다른 Claude Code·agy에 읽기 전용 리뷰 요청하고, Codex가 실파일 대조로 전건 판정한 뒤 확인분만 수정·재검증하는 외부 리뷰 게이트. '외부 리뷰', 'Claude/agy 리뷰', '리뷰 게이트', '이슈 검증 후 수정' 요청 시 반드시 사용."
---

# External Review Loop

`skills/myharness/references/external-review-loop.md`를 방법론 정본으로 전부 읽고 따른다.

이 프로젝트의 고정 치환:

- 러너: `codex`
- 스킬 scripts: `.agents/skills/external-review-loop/scripts`
- 일반·정합성 리뷰어: `claude`
- 성능·안정성 리뷰어: `agy`
- Codex는 러너이므로 외부 리뷰어에서 제외
- 결과: `_workspace/reviews/`
- 기본 수렴: 신규 확인 0건 1회, 최대 3라운드

리뷰어는 읽기 전용으로 실행하고 최종 판정은 Codex 오케스트레이터가 직접 수행한다. 커밋과 push는 사용자 승인 전 금지한다.
