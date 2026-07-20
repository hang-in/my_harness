---
name: harness-factory-orchestrator
description: "my_harness 팩토리 자체의 정책·스크립트·설치·업데이트·듀얼 런타임 문서를 구현, 감사, 수정, 보완, 재실행하는 Codex 우선 오케스트레이터. '팩토리 고쳐줘', '정책 감사', 'Windows/Linux 설치 수정', 'harness-update 변경', 'Claude/Codex drift 확인', '이전 결과 기반 개선' 요청이면 반드시 사용. 다른 프로젝트용 하네스 신규 생성은 myharness 스킬을 사용."
---

# Harness Factory Orchestrator

정본은 `.agents/skills/harness-factory-orchestrator/SKILL.md`다. 이 파일은 Claude Code용 진입점이며 정본과 역할·정책을 동등하게 유지한다. 주 실행 런타임은 Codex이며 Claude Code에서는 `.claude/agents/*.md` 호환 정의를 사용한다.

워크플로우를 실행할 때 정본을 전부 읽고 따른다. Codex 러너의 외부 독립 리뷰어는 Claude Code와 agy이며 Codex 자체는 제외한다.
