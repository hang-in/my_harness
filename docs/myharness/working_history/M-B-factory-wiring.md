# 결과서 — M-B 정본 배선 (구성 자기평가 팩토리 전파)

> 일자: 2026-07-11. 상위: M-A 결과서·`harness-scorecard-{design,plan}.md`. 게이트: stabilizer(중대 blast-radius). 외부감사 codex+agy.

## 한 일
자기평가 재편("루프 효율"→"구성 상태 개선")을 **팩토리 정본에 배선** → 모든 생성 하네스로 전파.

**변경:**
- `references/harness-scorecard.md`(신규·주축 정본): 계층 2·분류·frontmatter 연결 계약(`skills:`/`orchestrates:`)·2 cadence·환류(자동 금지)·저장·portable CLI·loop 강등. (`.agents/skills/myharness`는 symlink → 자동 parity)
- `references/loop-self-eval.md`: 상단에 `loop_ref` 보조 강등 프레이밍.
- `SKILL.md`(500줄 유지·인라인 net-zero): Phase 3 frontmatter 계약·Phase 6-1 구조검증 배열 확인·Phase 7-4 진화 트리거(harness_scorecard 주축·2 cadence·loop_ref 보조)·산출물 체크리스트·reference 인덱스.
- `references/agent-design-patterns.md`: 정의 템플릿 `skills:` 계약.
- `references/orchestrator-template.md`: 템플릿 A/B/C 전부 `orchestrates:` 계약.
- `harness-ui/src/server/adapters/scorecard.ts`: 오케스트레이터 추정 스킬이 `orchestrates` 미선언 시 link_unknown 탐지(마이그레이션 미탐 방지·M-B R2 codex).

## stabilizer 게이트 (3층)
- **① 정책 감사:** `run-policy-audit.sh` PASS(fail 0·warn 0·SKILL 500·링크 dead 0·버전 정합).
- **② 외부 리뷰(codex+agy):** R1 — agy HIGH(템플릿 B/C `orchestrates:` 누락)·MED(구조검증·체크리스트 계약 확인 누락) → 반영. R2 — **양 엔진 no-high**. codex MED(오케스트레이터 미선언 미탐) → scorecard.ts 탐지 추가.
- **③ 회귀 드라이런:** vitest 931 pass / 1 skip / **2 fail = 사전 projectroot**(env·무관). 실 레포 scorecard: orphan 에이전트 0·오케스트레이터 2 link_unknown(정상 탐지)·orphan 스킬 6(미선언). 파괴 없음.

## 다음 단계 참조
- **미해결:**
  - **backfill 실작업** — 이 레포·기존 생성 하네스 에이전트에 `skills:`·오케스트레이터에 `orchestrates:` 실제 추가(현재 전원 link_unknown = 부채). `.claude` gitignore라 이 레포 로컬 backfill은 커밋 대상 아님.
  - **M-C** — 계층B LLM 프롬프트 본문·view 강등 UI 배지 문안.
- **핵심 결정:** 정본 주축 = `harness-scorecard.md`. frontmatter 계약은 **신규 하네스 강제·기존은 link_unknown(비파괴 부채)**. 오케스트레이터 미선언도 link_unknown 탐지(마이그레이션 가시화). 자동 적용 금지 일관.
- **다음:** M-B 커밋. backfill·M-C는 사용자 결정 후속.
