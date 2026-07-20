# 하네스 구성 자기평가 (`harness_scorecard`) — 주축

자기평가의 **북극성 = 전체 하네스 구성 상태의 지속 개선**(에이전트·스킬·오케스트레이터 건강). 루프 효율(`loop_scorecard`)은 이 아래 보조 신호(`loop_ref`)로 강등. 상세 설계·타입·알고리즘은 harness-ui 구현부 `docs/myharness/harness-scorecard-{prd,design}.md`(외부감사 수렴)와 `harness-ui/src/server/adapters/scorecard.ts` 단일 출처. 이 문서는 **팩토리·생성 하네스가 무엇을·언제·어떻게 측정하고 환류하는지**의 정본이다.

## 무엇을 측정하나 (계층 2)
- **계층A — 순수 정적(상시·0비용·SSOT):** 파일 파싱만으로 구성 건강도. `computeHarnessScorecard(root)`(in-memory·결정적). external-review·run 불요 → **슬림·비코드 포함 전 하네스**. 지표: 고아/dead·미선언·커버리지·SKILL≤500·정합/drift.
- **계층B — LLM 심층(선택·캐시·fail-open):** 자연어 판정(오케스트레이터 커버리지·Phase dead-link). UI/CLI 자동 호출 금지·오케스트레이터만·offline 시 생략(계층A만). **자동 적용 금지.**

## 분류 (상호배타·raw 불변)
| 분류 | 뜻 | 감점 |
|------|-----|:---:|
| `orphan` | 연결 증거 전무(확정) | O |
| `link_unknown` | 선언 누락(마이그레이션 부채·아직 모름) | X |
| `dead_link` | 선언/배정 대상이 디스크에 없음(broken pointer) | O |
| `coverage_gap` | 존재하나 오케스트레이터 미배정 | O(low) |
| `unknown_scope` | 교차 runtime 미이관 | X |
| `incomplete_def` | scalar 등 무효 선언·필수 섹션 누락 | O(low) |

**핵심(오탐/은폐 동시 방지):** "확실히 나쁨(orphan)"과 "아직 모름(link_unknown)"을 분리. 미선언 에이전트는 orphan 아닌 link_unknown(전수 고아 오탐 차단). orphan 스킬은 레거시 미선언 에이전트가 있어도 확정 유지(은폐 금지). raw 훼손 없이 view 강등만.

## frontmatter 연결 계약 (선행조건·Phase 3 규약)
연결 그래프의 결정적 증거원. **명시 구조 필드만** 계층A(자연어 본문 배정은 계층B).
- **에이전트**(`.claude/agents/*.md`·`.codex/agents/*.toml`): `skills: [사용-스킬…]` 필수. 빈 배열 `[]` = 명시적 무연결(orphan 의도). 미선언 = `link_unknown`.
- **오케스트레이터 스킬**(SKILL.md): `orchestrates: [조율-에이전트…]` 필수.
- 문법: YAML 블록(`- x`)/인라인(`[x,y]`)·TOML 다중행 배열. scalar 금지(→ incomplete_def). name = 파일 basename 정규화.

**backfill(기존 하네스):** 계약 전 하네스는 전원 `link_unknown`(정상·감점 아님). 마이그레이션 = 각 에이전트에 `skills:`·오케스트레이터에 `orchestrates:` 추가 → 실 연결로 해소. 미선언 상태를 강제 실패로 보지 않는다(migration-debt 카운트).

## 트리거 = 2 cadence
- **무거운 정적 재계산 + 스냅샷 축적:** Phase 0(현황 감사)·Phase 7-5(구성 수정 직후)·명시 점검. 오케스트레이터가 이 시점에 **`node scripts/harness-scorecard.mjs --snapshot`**(harness-ui 있으면 `POST /api/eval/harness-scorecard/snapshot`) 실행 → `_workspace/evals/harness_summary.jsonl`에 **append-on-state-change**(구성/waiver 변화 시만·중복 skip). 이게 추세(개선/퇴행) 데이터의 유일 축적 경로. **일반 run 종료엔 재계산 안 함**(파일 미변경·노이즈 방지).
- **얇은 동적 인터셉터(run 종료):** `loop_scorecard` 추세만 검사 → 임계 초과 시 **스냅샷 읽고 config_hash 대조**. 일치 시 구성 개선 제안, 불일치/부재 시 "정적 감사 요청"만(무거운 재계산은 구성변경 cadence로).
- **저비용 스캔:** waiver 만료·baseline 노후 = release/update 시점.

## 환류 (구성 개선 · 자동 금지)
악화 감지 시 **오케스트레이터가 자연어 구성 개선 제안** 저술("에이전트 X 미배정→병합?", "스킬 Y 고아→제거?"). 스크립트는 수치 결함만 emit. **자동 적용 금지·제안+사람 승인.** advisory(커밋/배포 hard-gate 아님).

## 저장·실행
- 스냅샷: `_workspace/evals/harness_scorecard.json`(+`harness_summary.jsonl` 추세). **UI 소스 아님**(UI는 lib 실시간 호출·항상 최신). config_hash로 stale 판정.
- portable 실행: `node scripts/harness-scorecard.mjs [root]`(esbuild 번들·서버 불요·슬림 하네스용). 팩토리가 하네스 생성 시 external-review-loop처럼 타겟 `scripts/`에 복사.
- factory 전용(`run-policy-audit.sh`)은 `scope=factory`(`skills/myharness` 존재)일 때만. built 하네스는 portable 지표만.

## loop_scorecard 관계 (강등)
`loop_scorecard`(external-review 루프 효율·alignment/rounds/cost)는 이제 `harness_scorecard`의 **`loop_ref` 느슨결합 보조**. 생명주기 상이(정적 전역 vs 동적 run)로 강제 통합 안 함 — 참조/요약만. 루프 효율 상세·단계적 도입은 `loop-self-eval.md`.
