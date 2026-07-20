# 작업계획서 — 구성 중심 자기평가 (`harness_scorecard`)

> 상위: `harness-scorecard-prd.md`(R5 수렴)·`harness-scorecard-design.md`(설계). 실행 하네스: harness-ui-dev(server-builder·qa-verifier·security-auditor) + repo-maintainer/stabilizer(정본 변경 게이트). TDD 교리 준수. working_history 결과서 의무.

## 리스크 등급 = 중대
근거: (a) A35 UI(`state-stats`) + 자기평가 공용 SSOT 교체 = 소비처 회귀 위험. (b) 팩토리 정본(`loop-self-eval`·Phase 7·Phase 3 규약) 변경 = **모든 생성 하네스 전파**. → 단계마다 외부리뷰 + stabilizer 게이트 + 승인 사다리.

## 마일스톤

### M-A. 코드: 공용 SSOT lib + A35 교체 (harness-ui·표준~중대)
착수 가능(PRD §9). 소비처 회귀 방지가 핵심.

| 작업 | 산출 | 테스트(선행 — TDD) | 담당 |
|------|------|------|------|
| A1 파서 배열 계약 | `parseFrontmatterList {present,items,syntax}` + AgentInfo.skillsDeclared + **buildCodexAgent TOML skills(다중행)** + **orchestratesByRuntimePath**(readSkills·런타임별 보존) | T1(블록/인라인/부재/빈배열/scalar/BOM/**TOML 단일·다중행**) | server-builder |
| A2 config_hash | `computeConfigHash(inputs)` 결정적(내용·정렬·mtime무관) | T2 | server-builder |
| A3 분류 lib | `scorecard.ts`: `computeHarnessScorecard(root)` + 분류(orphan/link_unknown/**dead_link=디스크부재만**/**coverage_gap=미배정만·중복없음**/unknown_scope) raw 불변 + subject_kind + waiver 적용 | T3(각 분류·중복 아님·레거시 존재시 orphan 유지·orchestrates edge) | server-builder |
| A4 스냅샷 | `writeHarnessScorecardSnapshot()` generated_at·summary append·envelope | T5(waiver edge단위) | server-builder |
| A5 A35 교체 | `statestats.ts` configHealth → lib 호출·subject_kind로 orphanAgents/Skills 분리·link_unknown 별도·하위호환 | T4(회귀·고아오탐0) | server-builder |
| A6 portable CLI | `scripts/harness-scorecard.mjs`(esbuild 번들·단일소스·무의존·stdout JSON) | T7(CLI 출력) | server-builder |
| A7 e2e | `GET /api/overview/state-stats` 실응답·fail-open | T6·T7 | qa-verifier |

**게이트 M-A:** vitest 전건 green → 내부 QA(경계면: state-stats 응답↔UI 소비) → 보안(경로탈출·OOM캡 유지·symlink) → 외부리뷰 1회(표준) 또는 단계마다(중대분 A5).

### M-B. 정본: Phase 7 배선 + 계약 규약 (팩토리·중대)
**stabilizer 게이트 필수.**

| 작업 | 산출 | 담당 |
|------|------|------|
| B1 Phase 3 규약 | `skills:`/`orchestrates:` frontmatter 필수화 문서화(SKILL.md·agent-design-patterns) | skill-maintainer |
| B2 loop-self-eval 재편 | `harness_scorecard` 주축·`loop_scorecard`→`loop_ref` 강등 | skill-maintainer |
| B3 Phase 7-4/0/7-5 배선 | 트리거 2 cadence·`computeHarnessScorecard` 호출·자동적용 금지 불변 | skill-maintainer |
| B4 마이그레이션 가이드 | 기존 하네스 backfill(present 없을 때 link_unknown) 문서 | skill-maintainer |

**게이트 M-B:** stabilizer → 정책감사(`run-policy-audit.sh` PASS) + 외부리뷰(external-review-loop) + 회귀 드라이런(SKILL≤500·링크 무결성).

### M-C. 차단분(설계서 확정 후·비착수)
계층B LLM 프롬프트 본문·view 강등 UI 배지·portable factory 감사 세부. M-A/M-B 안정 후 별도 착수.

## 실행 순서 & cadence
1. M-A(코드) TDD → 게이트 → 커밋(승인 관문).
2. M-B(정본) → stabilizer 게이트 → 커밋(승인 관문).
3. 각 단계 working_history 결과서(`## 다음 단계 참조` 의무) + `check-artifacts.sh` 통과.
4. 외부감사: M-A 코드 + M-B 정본 각각 codex+agy no-high까지.

## 검증 기준(완료 정의)
- vitest 전건 green(신규 T1~T7 포함)·기존 테스트 회귀 0.
- `GET /api/overview/state-stats`: 이 레포 하네스에서 **전 에이전트 고아 오탐 0**(현 버그 해소 실증).
- 정본 정책감사 PASS·외부감사 no-high(코드·정본 각).
- 자동 적용 경로 부재(제안+승인만) 확인.

## 위험 & 완화
| 위험 | 완화 |
|------|------|
| A5 교체가 UI 소비 회귀 | 응답 additive·기존 필드 보존·T4 회귀·qa 경계면 비교 |
| 파서 배열 오탐(들여쓰기·BOM) | T1 엣지 다수·기존 parseFrontmatter 하위호환 유지 |
| 정본 전파 부작용 | stabilizer 3층 게이트·회귀 드라이런 |
| 마이그레이션 전 link_unknown 대량 | 감점 아님(migration-debt)·"측정 준비" 표기 |

## 다음 단계 참조
- **미해결:** M-C 차단분(계층B 프롬프트·UI 배지)은 M-A/M-B 후. 마이그레이션 backfill 실작업 범위(로컬 `.claude` gitignore vs 정본 템플릿) 구현 시 확정.
- **핵심 결정:** M-A(코드·harness-ui) 먼저 → M-B(정본·stabilizer 게이트). 중대 등급 = 단계마다 외부리뷰. 완료정의 = 고아 오탐 0 실증 + 정본 no-high.
- **다음:** 설계서+계획서 외부감사(codex+agy) 2+ → 수렴 시 M-A TDD 착수.
