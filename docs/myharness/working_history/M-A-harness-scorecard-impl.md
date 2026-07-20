# 결과서 — M-A 구성 자기평가 계층A 구현

> 일자: 2026-07-11. 상위: `harness-scorecard-{prd,design,plan}.md`. 하네스: harness-ui-dev(TDD)·외부감사 codex+agy.

## 한 일
구성 중심 자기평가(`harness_scorecard`) 계층A(순수 정적 SSOT)를 harness-ui에 TDD 구현. 기존 A35 버그(`buildClaudeAgent`의 `skills:[]` 하드코딩 → 전 에이전트 고아 오탐) 해소.

**산출:**
- `src/server/adapters/scorecard.ts`(신규): `computeHarnessScorecard(root,{now})`·`computeConfigHash`(결정적)·`writeHarnessScorecardSnapshot`·`canonicalFindingId`·`runHarnessDiagOnce`(계층B 스텁·fail-open).
- `harness.ts`: `parseFrontmatterList{present,items,syntax}`(YAML 블록/인라인·TOML 다중행·scalar 거부·dedup)·`AgentInfo.skillsDeclared/skillsSyntax`·Codex TOML skills 파싱·`SkillInfo.orchestratesByRuntimePath/referencesByRuntimePath`(런타임별 보존)·`readCappedDef` export.
- `statestats.ts`: A35 configHealth → `computeHarnessScorecard` 파생(subject_kind로 orphanAgents/Skills 분리·linkUnknownAgents/deadLinks/coverageGaps 신규·now 주입).
- `scorecard-cli.ts`+`scripts/harness-scorecard.mjs`(esbuild 번들·portable·서버 불요).
- `screens.tsx`: 구성 건강도 카드에 link_unknown/dead_link/coverage_gap 행.
- 테스트 5파일 36건(parser 10·core 13·a35 4·cli 1·r1fix 8).

**분류(상호배타·raw 불변):** orphan(연결 전무·확정)·link_unknown(미선언·감점X)·dead_link(대상 디스크 부재)·coverage_gap(clean 에이전트 미배정)·unknown_scope·incomplete_def(scalar)·oversize.

## 검증
- vitest 930 pass / 1 skip / **2 fail = 사전 존재 projectroot**(env 의존·본 변경 무관·stash 확인). typecheck clean.
- **실 레포 실증:** `scope=factory · orphan 에이전트 0 · link_unknown 6` — 고아 오탐 버그 해소(구 로직이면 6 전부 오탐).
- 외부감사 codex+agy 3R: R1 HIGH 4(bounded reader·결정성·references·coverage_gap 상호배타·orchestrates scalar) → R2 MED(now 미주입 waiver 무력화·ISO 검증·references 런타임·dedup) → **R3 양 엔진 no-high**.

## 다음 단계 참조
- **미해결(차단):**
  - **M-B(정본 배선·중대 blast-radius)** — `loop-self-eval.md` 주축 재편·`SKILL.md` Phase 7-4 트리거(2 cadence)·Phase 3 규약(`skills:`/`orchestrates:` frontmatter 필수화)·기존 하네스 backfill. **stabilizer 게이트(정책감사+외부리뷰+회귀 드라이런) 필수.**
  - **M-C** — 계층B LLM 프롬프트 본문·view 강등 UI 배지 문안.
- **핵심 결정:** SSOT=`computeHarnessScorecard()` in-memory(UI 실시간·JSON은 스냅샷). 마이그레이션 전 하네스는 에이전트 전원 `link_unknown`(고아 아님)이 정상 — B1(Phase 3 규약+backfill) 후 실 연결로 해소. portable=`scripts/harness-scorecard.mjs`(esbuild). advisory(hard-gate 아님).
- **회귀 주의:** `statestats.configHealth` 필드 additive(orphanAgents/Skills 유지·`_unusedSkillNames` 제거). `parseFrontmatterList`의 `[ \t]*`(개행 불식)가 블록리스트 판정 핵심 — `\s*` 회귀 금지.
- **다음:** M-A 커밋 → (사용자 결정) M-B 착수 시 stabilizer 게이트 경유.
