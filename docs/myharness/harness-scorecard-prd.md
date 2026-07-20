# PRD — 구성 중심 자기평가 (`harness_scorecard`)

> 상태: **기획 확정 · 외부감사 R5 수렴(codex+agy 양 엔진 no-high, R1~R5 5라운드).** MED 문구정합 반영 완료. 대상: myharness 팩토리 self-eval 재편. 근거: `skills/myharness/references/loop-self-eval.md`(현 loop 중심)·`self-improvement-loop.md`(artifact_benchmark·설계만)·Harness UI 구성건강도(A35).

## 1. 배경 & 문제

현 자기평가(`loop_scorecard`)는 **external-review 루프의 효율**(alignment·rounds·cost)만 측정한다. 한계:
- **너무 좁다.** "감사를 잘 하나"만 보고, **하네스 구성 자체가 건강한가**(에이전트·스킬·오케스트레이터 상태)는 안 본다.
- **외부감사 의존.** 루프가 돌아야 데이터가 생겨 → 슬림·비코드 하네스엔 자기평가가 아예 없음.
- **개선 방향 오조준.** Phase 7 환류가 "루프 튜닝"에 머물러, 정작 **하네스 구성 개선**(고아 에이전트·커버리지 갭·drift)으로 이어지지 않음.

**북극성(재정의):** 자기평가의 주목표 = **전체 하네스 구성 상태의 지속 개선**. 루프 효율은 그 하위 신호.

## 2. 대상 사용자
- **하네스 유지자**(팩토리 자체 + 빌드된 도메인 하네스 소유자). 자기 하네스가 시간이 지나며 고아·중복·drift·미사용으로 썩는 것을 조기에 감지·개선하려는 사람.

## 3. 핵심 설계 결정 (구현 전 확정 — R1 차단 이슈 해소)

### 3-1. 연결 증거원 (link evidence source) — H1
"고아/커버리지"는 **에이전트↔스킬↔오케스트레이터 연결 그래프**를 전제하나, 현 자산엔 그 그래프가 없다. 확정:
- **증거원(결정적 = 계층A / 자연어 = 계층B) — R4 C4:** 계층A는 **명시 구조 필드만** 파싱(결정적 보장). ① 에이전트 frontmatter `skills:`(선언) ② 오케스트레이터 frontmatter **`orchestrates: [agent…]` 계약 신설**(자연어 본문 배정은 regex/AST로 결정적 추출 불가 → 계층A 금지) ③ 스킬 references 역참조. **자연어 본문 배정·커버리지 서술은 계층B `diag.*`에만.**
- **증거는 병렬 수집·교차 비교(override 아님·raw 불변·R4 C1):** 우선순위는 *분류 신뢰도*용. raw 데이터 계층은 각 증거를 훼손 없이 보존. 교차비교로 불일치 탐지 — **선언/배정 대상이 디스크에 없음 = `dead_link`(broken pointer)**, 존재하나 미배정 = `coverage_gap`(상호배타·설계서 §3 확정).
- **`skills`/`orchestrates` 선언 계약 신설(선행조건):** 현 필수는 `name`·`description`뿐(SKILL 113). **(a)** 에이전트에 `skills:`·오케스트레이터에 `orchestrates:` 필수화(Phase 3 규약·이 PRD 범위) **(b)** 기존 하네스 backfill/migration **(c)** `link_unknown`은 **선언 누락 에이전트/edge 상태에만** 한정(스킬 raw 분류엔 미적용 — 다음 항 참조). 배열 문법: `skills:`/`orchestrates:`는 YAML/TOML **배열**만 허용(scalar 금지)·name은 canonical(파일명 basename 기준 정규화).
- **스킬 고아 강등 = scope 한정·증거 기반(R4 C1 — 과잉교정 철회):** R3의 "전역 강등"은 레거시 에이전트 1개만 있어도 **진짜 orphan 스킬을 전부 은폐**(false-negative). 철회. 대신: **스킬 raw 분류 = 연결 증거 전무 시 `orphan` 확정 유지**(미선언 에이전트 존재만으론 강등 안 함). 강등은 **동일 scope/runtime 내** `link_unknown` 에이전트가 계층B heuristic으로 그 스킬을 **실제 언급할 때만** view 계층에서 적용(가중치·경고). raw 데이터 훼손 금지. 교차 scope 미이관은 별도 `unknown_scope`.
- **분류 산식 분리:** `orphan`(연결 전무·확정)·`link_unknown`(미선언 부채)·`dead_link`(대상 디스크 부재)·`coverage_gap`(존재하나 미배정)·`unknown_scope`(교차 scope 미이관)는 denominator·감점 각각 분리. `link_unknown`/`unknown_scope`는 감점 아닌 migration-debt.
- **기존 A35 재활용 불가(고장).** `buildClaudeAgent`가 `skills: []` 하드코딩 → `orphanAgents = a.skills.length===0`이 **전 에이전트 고아 오탐**(harness.ts:135·147·statestats.ts:47 확인). 연결 파서 신설 = 선행조건(A35 교체·SSOT화·회귀 테스트).

### 3-2. 측정 2계층 = 순수 정적(상시·0비용) / LLM 심층(선택·캐시) 엄격 분리 — H1·M6·R2 H2
UI(A35)는 0비용 정적 파싱으로 상시 렌더해야 하므로, LLM 판정을 UI 경로에 섞으면 점수↔실제 drift·지연 발생. 두 계층을 **물리적으로 분리**:
- **계층A — 순수 정적(결정적):** 파일 존재·frontmatter 필수 키·`skills`/`orchestrates` 선언 edge·SKILL≤500·링크 무결성·drift diff.
  - **SSOT = TS 공용 lib가 반환하는 in-memory typed object(R4 C2 확정).** UI(Node API)·CLI가 **`computeHarnessScorecard(root): HarnessScorecard`를 실시간 호출**해 파일을 그 자리에서 파싱(현 `statestats.ts`처럼) → 항상 최신·0비용. **JSON 파일은 SSOT가 아니라 동일 schema의 스냅샷**(§3-6·`writeHarnessScorecardSnapshot()`). UI는 JSON을 읽지 않는다(수동 편집 후 stale — 현 실시간 파싱보다 퇴행). "결정적 파서"란 이 lib가 파일을 결정적으로 파싱함을 뜻함(별도 파일 파서 아님).
- **계층B — LLM 심층 진단(선택·별도 산출물):** 자연어 판정(오케스트레이터 커버리지·Phase dead-link). **UI를 절대 블록하지 않음** — 구성 hash로 캐시된 별도 JSON, `confidence: heuristic`·`stale_if_hash_changed` 라벨. 스키마에서 LLM 파생 필드는 optional. 명시 호출 시만 갱신.
- **제안 생성 주체 분리:** 파서/LLM 분석기 = **수치 결함**만 emit. **자연어 구성 개선 제안**은 **오케스트레이터(LLM)** 가 저술. 스크립트는 제안 저술 안 함.

### 3-3. 트리거 = 2 cadence (무거운 정적=구성변경 / 얇은 동적=run종료) — H3·R2 H3·M
정적 구성 건강도는 **일반 run 중엔 안 변한다**(파일 미수정). 하지만 트리거를 완전 제거하면 loop 추세로 드러나는 구성결함 환류(G3)가 단절 → **2 cadence 분리**:
- **무거운 정적 재계산:** ① Phase 0 현황 감사 ② Phase 7-5 운영/유지보수(구성 수정 직후) ③ 명시 점검. **일반 run 종료엔 정적 재계산 안 함**(노이즈 방지).
- **얇은 동적 인터셉터(run 종료·저비용):** 기존 `loop_scorecard` 추세만 검사 → 임계 초과 시 발화. **입력 계약(R4 C3 — 재계산 역설 해소):** ① `_workspace/evals/harness_scorecard.json` **스냅샷을 읽고** ② 동일 `computeConfigHash(inputs)` 순수 함수(§3-6·내용 해시)로 현재 입력 해시만 계산해 스냅샷 `config_hash`와 대조(mtime 아님 — 내용 해시라야 스냅샷과 비교 가능). **일치 시** 스냅샷을 최신으로 신뢰 → 구성 개선 제안 발화. **불일치·부재 시** 스냅샷 stale → `computeHarnessScorecard()`(=정적 재계산) 하지 않고 **"정적 감사 요청"만 emit**(무거운 재계산은 §3-3 구성변경 cadence로 넘김). loop 추세만으론 구성결함 vs 프롬프트/도구 구분 불가하므로 스냅샷 대조가 전제.
- **저비용 cadence 스캔:** waiver 만료·baseline 노후·팩토리 update 대비 drift는 파일 미변경에도 변함 → release/update/명시 audit 시점에 별도 경량 스캔.

### 3-4. 적용 범위 분리 = 팩토리 vs 빌드된 하네스 — H2
- `run-policy-audit.sh`는 **팩토리 레포 전용**(SKILL 6-1 명시). 빌드된 도메인 하네스엔 **직접 합산 금지** → `not_applicable` 또는 **경로 무관 portable 감사** 별도 구현.
- scorecard를 `factory_score`(policy-audit 포함)와 `built_harness_score`(portable 지표만)로 **분리**.

### 3-5. loop_scorecard 결합 = 느슨결합 (강제 흡수 아님) — M5
정적(전역·상시) vs 동적(run·국소)은 생명주기가 달라 한 스키마 강제 통합 시 갱신주기 충돌. `harness_scorecard`는 **최근 loop 결과 요약/참조(link)만** 포함. `artifact_benchmark`도 동일(참조).

### 3-6. 저장·영속성·namespace (본문 확정 — R2 H5·LOW)
- **물리 저장(스냅샷·추세 전용·UI 소스 아님):** 계층A 스냅샷 = `_workspace/evals/harness_scorecard.json`(gitignore·최신 덮어쓰기 + `summary.jsonl` 추세 append). 계층B LLM 진단 = `_workspace/evals/harness_diag_{confighash}.json`(캐시). **UI는 in-memory lib 실시간 호출(§3-2)**, 이 파일은 CLI 감사 이력·추세용.
- **최소 JSON envelope(R3 M4·구현 전 확정):** `{schema_version, config_hash, generated_at, scope:{root,runtime}, findings:[{id(stable), type, subject_kind, target?, severity, provenance, confidence, waived}], namespace: factory|built|loop_ref|diag, stale}`. `type`의 전체 열거는 설계서 `FindingType`(orphan·link_unknown·dead_link·coverage_gap·unknown_scope·oversize·incomplete_def)이 정본(여기 나열은 대표 subset). `config_hash`(계층A 입력 파일 해시)로 diag stale 판정·summary 추세 append 안정화.
- **baseline(추세용):** 커밋 추적 원장이 필요하면 `docs/{project}/working_history/`에 스냅샷 1장(선택). `_workspace`는 자기완결·재구성 가능(SSOT는 계층A 파서 출력).
- **SSOT·namespace:** SSOT = `computeHarnessScorecard()`가 반환하는 in-memory typed object(§3-2). UI(A35 API)·scorecard·CLI가 **같은 lib를 호출**(동일 타입). `writeHarnessScorecardSnapshot()`은 그 객체를 JSON으로 직렬화(스냅샷·추세 전용·읽기 소스 아님). 두 API 분리(R4 codex LOW). 필드 namespace `factory.*`(policy-audit 포함)·`built.*`(portable만)·`loop_ref.*`(느슨결합 참조)·`diag.*`(LLM·optional). **cross-aggregate 단일 점수 금지**(축별 표기). UI precedence: 정적>diag(stale 시 diag 숨김).
- **`config_hash`:** lib가 계층A 입력 파일 내용의 결정적 해시를 산출(직렬화 방식 고정). 스냅샷·diag stale 판정·인터셉터 대조(§3-3)의 기준.

## 4. 목표 & 성공지표

**G1. 구성 건강도 측정(구성 변경 시점·전 하네스).**
- S1: 결정적 파서 + 경량 LLM 구조 분석으로 scorecard 산출(외부감사·run 불요). 슬림·비코드 포함.
- S2: 구조 무결성 — 고아/dead(연결 그래프 기반·3-1)·오케스트레이터 커버리지(heuristic·3-2)·정의 완전성(**헤더 유무 + 내용 최소 기준·빈 섹션 감점**·M3).

**G2. 정합·drift 점검.** S3: claude↔codex parity·CLAUDE.md↔실파일·포인터 무결성. policy-audit는 factory_score에만(3-4).

**G3. 환류를 "구성 개선"으로 재조준.** S4: 악화 감지 시 **오케스트레이터가 자연어 구성 개선 제안** 저술(3-2). **자동 적용 금지·제안+승인**. 트리거 시점 3-3.

**G4. 계층 재배치.** S5: `harness_scorecard`(구성)=주축. `loop_scorecard`(루프 효율)·`artifact_benchmark`(산출물)=느슨결합 보조(3-5). 용어·소스 충돌 0.

**G5. 개선 추세 판정.** S6: baseline·delta·new/resolved findings·accepted_risks·waiver(만료 포함)로 "개선/퇴행" 판정(스냅샷 아님·M-codex).

## 5. 범위

**포함:**
- 연결 그래프 파서(A35 고아 로직 교체·SSOT) + `harness_scorecard` 스키마·산출.
- 3차원(구조·정합/drift·효과성[run 있을 때만]) + factory/built 분리(3-4).
- baseline/delta/waiver 추세 판정(G5).
- Phase 7-5·Phase 0 환류 배선(3-3) + 오케스트레이터 제안 저술(3-2).

**비목표(YAGNI):**
- 자동 적용/자동 리팩터(제안+승인만·불변).
- 완전 산출물 품질 벤치(`artifact_benchmark` holdout)=별도 축·v0.7.
- 효과성(실사용 통계) CLI 세션 포착 = v0.7(F-CLI) 의존.
- 오케스트레이터 실행 그래프의 완전 정적 검증(자연어라 불가 — heuristic 한계 수용).

## 6. 우선순위
연결 파서(3-1·A35 교체)=0순위(전제). S1·S2 구조 무결성=1. 3-3 트리거 재배치·3-4 범위분리=1(설계 정합). S3 drift=2. G3 제안 저술=3. G4/G5=병행.

## 7. 위험
| 위험 | 완화 |
|------|------|
| **Goodhart — 억지 링크/키워드 stuffing/빈 섹션** | edge provenance 요구(링크 추가만으론 점수 불상승·배정/run 증거 없으면 confidence만↑). 정의 완전성=내용 기준+빈 섹션 감점. suspicious-link 규칙. 제안+사람 승인·자동 금지. |
| **heuristic 오탐**(커버리지·고아) | confidence 라벨(measured vs heuristic)·"후보" 표기·단정 금지. |
| **과잉 제안/노이즈** | 트리거 시점 구성변경 한정(3-3)·`min_*` 게이트·중대 변경만 발화·waiver. |
| **정적↔실사용 괴리** | 구조=정적/heuristic·효과성=run 있을 때만·라벨 분리. |
| **파서 신설 리스크**(A35 교체가 UI 회귀) | SSOT 파서를 UI(A35)·scorecard 공용 라이브러리로·동일 JSON schema·회귀 테스트. |

## 8. 개방 질문
**확정됨(본문 이관):** ~~Q1 SSOT 형태~~ → in-memory TS 공용 lib(§3-2·§3-6). ~~Q6 findings schema~~ → 최소 envelope(§3-6).

**설계서에서 확정(구현 착수 전 차단):**
1. portable 감사(빌드된 하네스용): 최소 규칙 셋 + **실행 주체·진입점**(예: `check-artifacts.sh` 확장 vs 신규 스킬)·호출 시점(R2 M4).
2. 계층B LLM 분석기 호출 주체·budget ceiling·fail 정책(offline 시 fail-open으로 계층A만)·캐시 무효화(config_hash).

**설계서에서 확정(비차단):**
3. 산식·hard-gate 여부: 구성 점수가 커밋/배포를 막는 gate인가, advisory인가.
4. waiver/suppression 저장 위치·만료·재승인·저비용 만료 스캔 cadence(§3-3).

## 9. 착수 가능 범위 (R3 H5)
PRD 수렴(no-high) ≠ 전면 구현 착수. 차단 질문(§8 차단 2건) 미해결 구간은 설계서에서 확정 후 진입. **수렴 즉시 착수 가능분:** ①`computeHarnessScorecard(root): HarnessScorecard` in-memory 계산 lib(§3-2·자연어 배정 제외·`skills`/`orchestrates` 선언 edge만) + `writeHarnessScorecardSnapshot()` 분리 ②A35 고아 로직 교체+회귀 테스트 ③최소 JSON envelope 스키마(§3-6). **선행:** `skills:`/`orchestrates:` frontmatter 계약(Phase 3 규약)·기존 backfill. portable 감사·계층B LLM은 설계서 확정 후.

## 다음 단계 참조
- **미해결:** 개방 질문 6건(§8) — 설계서에서 확정. 특히 Q1(SSOT 형태)·Q3(portable 감사)는 구현 전 차단.
- **핵심 결정:** 북극성 = 하네스 **구성 상태 개선**(루프 효율 아님). R2 반영 — ①연결 증거원 3종 + `skills` 선언 계약 신설·미선언 fallback=`link_unknown`(전수 고아 오탐 차단) ②측정 2계층 엄격 분리(A 순수정적·상시·SSOT / B LLM심층·선택·캐시·UI 비블록) ③트리거 2 cadence(무거운 정적=구성변경 / 얇은 동적=run종료 loop추세 / 저비용=waiver만료) ④factory/built 범위 분리 ⑤loop 느슨결합 ⑥저장·namespace 본문 확정(`_workspace/evals/`·`factory/built/loop_ref/diag.*`·cross-aggregate 금지).
- **수렴:** R5 codex+agy 양 엔진 no-high(R1~R5). R4까지 HIGH 총 11건(전수 검증·2건 코드 확정) 해소, R5 MED 3건 문구 반영.
- **다음:** 설계서(portable 감사·계층B LLM 계약·`computeHarnessScorecard` 스키마·Phase 배선·`skills`/`orchestrates` 계약 마이그레이션) → stabilizer 게이트 → 구현(§9 착수 가능분부터).
