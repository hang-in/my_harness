---
name: external-review-loop
description: "my_harness의 표준·중대 변경을 Codex 러너와 다른 Claude Code·agy에 읽기 전용 리뷰 요청하고, Codex가 실파일 대조로 전건 판정한 뒤 확인분만 수정·재검증하는 외부 리뷰 게이트. '외부 리뷰', 'Claude/agy 리뷰', '리뷰 게이트', '이슈 검증 후 수정' 요청 시 반드시 사용."
---

# External Review Loop

정본은 `.agents/skills/external-review-loop/SKILL.md`다. `skills/myharness/references/external-review-loop.md`의 방법론을 따르며, 이 프로젝트에서는 Codex가 러너이고 Claude Code와 agy만 외부 독립 리뷰어로 사용한다.
