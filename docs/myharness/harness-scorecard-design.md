# 설계서 — 구성 중심 자기평가 (`harness_scorecard`)

> 상태: **설계 확정 · 외부감사 R3 수렴(codex+agy 양 엔진 no-high, R1~R3).** MED 정합 반영 완료. 상위: `docs/myharness/harness-scorecard-prd.md`(R5 수렴). 이 문서는 PRD §8 차단 질문 2건(portable 감사·계층B LLM)을 해소하고 §9 착수분의 구체 타입·알고리즘·API·마이그레이션·테스트를 확정한다.

## 0. 근거 코드 (as-is)
- `harness-ui/src/server/adapters/harness.ts`: `parseFrontmatter()`(현 `Record<string,string>`·배열 미지원)·`readAgents/readSkills`·`buildClaudeAgent`(**`skills: []` 하드코딩** = A35 버그 근원)·`readCappedDef`(O_NOFOLLOW·256KB캡·500파일캡).
- `harness-ui/src/server/adapters/statestats.ts:39-55`: `stateStats().configHealth` — `orphanAgents = a.skills.length===0` → skills 항상 `[]`이라 **전 에이전트 고아 오탐**. `orphanSkills`도 선언 링크 부재 heuristic.
- 소비처: `GET /api/overview/state-stats`(A35 UI). scorecard와 공용 SSOT 대상.

## 1. 공용 SSOT lib (계층A·PRD §3-2)

신규 파일 `harness-ui/src/server/adapters/scorecard.ts`. 순수·결정적·in-memory. `Date.now`/`Math.random` 미사용(결정성·테스트 재현).

```ts
export type Runtime = "claude" | "codex";
export type FindingType =
  | "orphan"        // 연결 증거 전무(확정·감점)
  | "link_unknown"  // 선언 누락(에이전트/edge·migration-debt·감점 아님)
  | "dead_link"     // referenced target missing on disk(선언/배정 대상 파일 부재 = broken pointer만. 미배정은 coverage_gap)
  | "unknown_scope" // 교차 runtime 미이관(감점 아님)
  | "coverage_gap"  // 오케스트레이터 미배정(계층A: orchestrates 기준 / 자연어는 diag)
  | "oversize"      // SKILL > 500줄
  | "incomplete_def";// 필수 섹션 누락/빈 섹션
export type Confidence = "measured" | "heuristic";
export type Provenance = "declared_skills" | "orchestrates" | "skill_refs" | "policy_audit" | "diag_llm";

export interface Finding {
  id: string;                       // canonicalFindingId() 산출(R2 고정 규칙): `${type}:${runtime}:${subject_kind}:${subject}` + (target 있으면 `:${target}`, 없으면 세그먼트 생략). waiver 매칭도 동일 함수 사용(node/edge finding 일관).
  type: FindingType;
  subject: string;                  // agent/skill name (canonical basename)
  subject_kind: "agent" | "skill" | "pointer" | "runtime"; // R1 codex — A35 orphanAgents/orphanSkills 분리 매핑
  target?: string;                  // edge 상대(예: dead_link의 부재 스킬명) — id 유일성·edge별 waiver
  runtime: Runtime;
  severity: "high" | "med" | "low" | "info";
  provenance: Provenance;
  confidence: Confidence;           // 계층A는 measured만. heuristic은 diag(계층B)에서만.
  waived: boolean;                  // waivers.json 적용 결과(R1 — 미만료 waiver면 true). raw type 불변·억제는 이 플래그로.
  detail?: string;
}

export interface HarnessScorecard {
  schema_version: 1;
  config_hash: string;              // computeConfigHash(입력파일 내용) — 결정적
  generated_at: string | null;      // compute=null. writeSnapshot()에서만 스탬프.
  scope: { root: string };
  counts: {
    agents: number; skills: number;
    orphan: number; link_unknown: number; dead_link: number;
    unknown_scope: number; coverage_gap: number;
  };
  findings: Finding[];              // raw 불변(view 강등 별도)
  factory: FactoryBlock | null;     // scope=factory일 때만(policy-audit). built=null.
  built: BuiltBlock;                // 항상(경로 무관 portable 지표)
  loop_ref: LoopRef | null;         // 느슨결합: 최신 loop summary 참조(§3-5)
  diag: DiagBlock | null;           // 계층B(선택·optional). 없으면 null(fail-open).
  stale: boolean;
}

// 계층A + waivers.json 적용 + 기존 diag 캐시 읽기만. LLM 생성 안 함(결정적·fail-open).
export function computeHarnessScorecard(root: string): Promise<HarnessScorecard>;
export function computeConfigHash(inputs: FileContent[]): string;   // sha256(정렬된 {path,content}) — mtime 아님
export function writeHarnessScorecardSnapshot(sc: HarnessScorecard): Promise<void>; // generated_at 스탬프 + JSON + summary append
// 계층B — 오케스트레이터 전용(UI·CLI·compute 자동 호출 금지). LLM 생성·캐시 기록.
export function runHarnessDiagOnce(root: string, configHash: string): Promise<DiagBlock>;
```

**설계 결정:** SSOT = `computeHarnessScorecard()`가 반환하는 객체. UI·CLI·scorecard가 **같은 함수 호출**. JSON은 `writeHarnessScorecardSnapshot()`이 직렬화한 **스냅샷**(읽기 소스 아님·§3-6). **`computeHarnessScorecard`는 계층A + waiver 적용 + 기존 diag 캐시 읽기만**(R1 codex LOW) — LLM 생성은 오케스트레이터 전용 `runHarnessDiagOnce()`로 분리(compute 결정성 유지).

## 2. frontmatter 배열 계약 + 파서 확장 (선행조건·PRD §3-1)

### 2-1. 계약 (Phase 3 규약 개정)
- 에이전트: `skills: [skill-a, skill-b]` 필수(사용 스킬 선언). 빈 배열 `skills: []` = **명시적 무연결**(고아 의도).
- 오케스트레이터 스킬: `orchestrates: [agent-a, agent-b]` 필수(조율 대상 에이전트).
- 배열 문법: YAML 블록(`- x`) 또는 인라인(`[x, y]`) 허용. scalar 금지. name = 파일명 basename 정규화.

### 2-2. 파서 확장 (`harness.ts`)
`parseFrontmatter`는 현 API 유지(하위호환). **신규** `parseFrontmatterList(text, key): {present: boolean; items: string[]; syntax: "missing"|"empty"|"array"|"invalid_scalar"}` 추가:
- `present` = 키 존재 여부(**부재 vs 빈배열 = link_unknown vs orphan 판정의 핵심**).
- `syntax`(R1 codex): `missing`(키 없음)·`empty`(`[]`)·`array`(유효 배열)·`invalid_scalar`(`skills: foo` scalar — PRD "scalar 금지"). `invalid_scalar`는 items 채우지 않고 `incomplete_def` finding 유발(오배열 오탐 차단).
- YAML 블록리스트(`- item`)·인라인(`[a,b]`)·**TOML 다중행 배열**(`skills = [\n "a",\n "b"\n]`) 파싱(R2 agy — 단일행 regex 금지·`[...]` 다중행 캡처). `splitList` 재사용 + 선행 `- ` 제거.
- **claude(YAML)·codex(TOML) 양쪽 계약(R1 H2·H3):**
  - `AgentInfo`에 **`skillsDeclared: boolean`·`skillsSyntax`** 추가. `buildClaudeAgent`: `skills: []` 하드코딩 → `parseFrontmatterList`. `buildCodexAgent`: TOML `skills = [...]`(다중행 포함) 파싱 추가·`skills: []` 고정 제거.
  - `SkillInfo`에 **런타임별** 증거 보존(R2 M3·R3 MED): `readSkills`의 canonical dedup이 `.claude`/`.agents` 동일명을 병합하고 **duplicate branch에서 `references`도 버림** → 단일 배열은 런타임 증거를 섞음. **`orchestratesByRuntimePath`·`referencesByRuntimePath: Record<path,{items,declared}>`** 로 정의 단위 보존(orchestrates·skill_refs 양쪽·edge를 런타임별 생성).

### 2-3. 마이그레이션 (기존 하네스 backfill)
- **이 레포**: `.claude/agents/*.md` 5(harness-ui-dev)+5(repo-maintainer) 등에 `skills:` 추가·오케스트레이터 스킬에 `orchestrates:` 추가. `.claude` gitignore라 로컬만(추적 대상 아님) → 마이그레이션은 **정본 템플릿**(skills/myharness references)과 **가이드 문서**로 전파.
- **미선언 fallback(계약 전 하네스)**: `present===false` → 에이전트 `link_unknown`(감점 아님). `present===true && items===[]` → 명시적 `orphan`.

## 3. 분류 알고리즘 (raw 불변·PRD §3-1·C1)

증거 3원 **병렬 수집**(override 아님):
```
edges_declared   = 에이전트.skills (present일 때만)
edges_orchestrate= 오케스트레이터.orchestrates → 에이전트
edges_refs       = 스킬 references 역참조
```
판정(raw) — **분류 상호배타·중복 오탐 금지(R1 H1)**:
- **에이전트:** `skillsDeclared===false` → `link_unknown`. `true && skills.length===0`(명시 `[]`) → `orphan`. `invalid_scalar` → `incomplete_def`.
- **스킬:** 세 증거 어디에도 없음 → `orphan` **확정 유지**(미선언 에이전트 존재만으론 강등 안 함·C1). 교차 runtime만 존재 → `unknown_scope`.
- **`dead_link` = broken pointer만(R1 H1 — 재정의):** 선언·배정한 **대상이 디스크에 없음**. 예: 에이전트 `skills:[X]`인데 스킬 X 파일 부재, 오케스트레이터 `orchestrates:[A]`인데 에이전트 A 파일 부재. **"미배정"은 dead_link 아님.**
- **`coverage_gap` = 미배정만:** 에이전트가 어떤 오케스트레이터 `orchestrates`에도 없음(계층A). 자연어 배정만 있는 경우는 계층B diag. **dead_link와 겹치지 않음**(coverage_gap = 존재하나 미배정 / dead_link = 배정했으나 부재).

**view 강등(별도·raw 불변):** 동일 runtime에 `link_unknown` 에이전트가 있고 계층B diag가 그 스킬을 언급 → view에서 orphan→"후보" 경고로 가중치 낮춤. raw findings는 그대로.

## 4. A35 교체 + 회귀 (PRD §9②)
`statestats.ts:stateStats().configHealth`를 `computeHarnessScorecard(root)` 호출로 대체:
- `orphanAgents` = `findings.filter(f=>f.type==="orphan"&&f.subject_kind==="agent"&&!f.waived).map(subject)`, `orphanSkills` = 동일 `subject_kind==="skill"`(R1 codex — subject_kind로 분리). `link_unknown`은 별도 필드(기존 오탐과 구분).
- `coverageConfidence` 유지(measured/heuristic 분리 표기).
- **회귀 테스트:** 기존 `state-stats` 응답 형태 하위호환(additive·기존 소비 UI `screens.tsx` orphanAgents/orphanSkills 배열 유지). 고아 오탐(전 에이전트 고아) → 0 확인.

## 5. 차단 질문 해소

### 5-1. Q1 portable 감사 (built 하네스)
`computeHarnessScorecard(root)`는 경로 무관(root 인자·상대경로 스캔)이나, **슬림 하네스엔 harness-ui 서버가 없어 LLM 오케스트레이터가 TS 함수를 직접 못 부른다(R1 H4).** → **portable CLI 진입점 신설:**
- **CLI:** `scripts/harness-scorecard.mjs`(node standalone·무의존·harness-ui 서버 불요). `node scripts/harness-scorecard.mjs [root]` → 계층A JSON을 stdout. scorecard 코어 로직은 harness-ui lib과 **단일 소스**에서 **esbuild 사전 번들**(R2 agy — 런타임 TS import 불가·무의존 단일파일로 빌드해 타겟에 복사). 팩토리가 하네스 생성 시 이 번들을 external-review-loop 스킬처럼 타겟 `scripts/`에 복사(기존 `check-artifacts.sh`·`build-scorecard.sh` 번들 관례).
- **진입점:** 오케스트레이터 Phase 0/7-5가 이 CLI 실행(harness-ui 있으면 API, 없으면 CLI). 기존 `check-artifacts.sh`(D4 결과서 게이트)는 별개(pre-commit hard gate).
- `built.*` = 경로 무관 지표(고아·link_unknown·dead_link·oversize·incomplete_def·parity·pointer). **모든 하네스.**
- `factory.*` = 팩토리 전용(`run-policy-audit.sh` 버전 3중·정본 경로). **`scope.runtime==factory`(이 레포 감지: `skills/myharness` 존재)일 때만** shell-out. built는 `factory:null`.

### 5-2. Q2 계층B LLM 계약
- **호출 주체:** 오케스트레이터만(UI·CLI 자동 호출 금지). 명시 점검 또는 구성변경 cadence 1회.
- **budget ceiling:** config-change당 1회. `harness_diag_{config_hash}.json` 캐시 → 동일 hash면 재호출 안 함.
- **fail 정책 = fail-open:** offline/실패 시 `diag:null`(에러 아님). 계층A만으로 정상 동작. UI 절대 블록 안 함.
- **캐시 무효화:** `config_hash` 불일치 시만 재생성.

### 5-3. Q3 hard-gate 여부
`harness_scorecard` = **advisory**(커밋/배포 차단 아님). 제안+승인만. 유일한 hard gate는 기존 `check-artifacts.sh` pre-commit(결과서 방치 차단·별개 축).

### 5-4. Q4 waiver
`_workspace/evals/waivers.json`: `[{finding_id, reason, expires_at}]`. **적용 계층(R1)**: `computeHarnessScorecard`가 이 파일을 읽어 각 `Finding.waived`를 세팅(미만료 매칭 시 true). raw `type` 불변 — 억제는 `waived` 플래그로만. UI(A35)·CLI가 `waived` 기준 필터/표기. `finding_id`는 edge 단위(§1 — `${type}:${runtime}:${subject_kind}:${subject}:${target}`)라 동일 subject 다중 결함 중 하나만 정확히 억제. 만료 지난 waiver → `waived:false`(재부상). 저비용 만료 스캔 = release/update cadence(§3-3).

## 6. Phase 7 배선 (팩토리 정본 — 중대 blast-radius)
- `loop-self-eval.md`: `harness_scorecard` 축을 주축으로 문서화. `loop_scorecard`는 `loop_ref` 느슨결합으로 강등.
- `SKILL.md` Phase 7-4 진화 트리거: "loop_scorecard 추세 악화" → "`harness_scorecard` 악화(구성변경 cadence) + 얇은 인터셉터(run종료·스냅샷 대조)". **자동 적용 금지 불변.**
- Phase 0/7-5에 `computeHarnessScorecard` 호출 + 스냅샷 기록 단계 명시.
- **정본 변경분은 stabilizer 게이트 통과 필수**(정책감사·외부리뷰·회귀 드라이런).

## 7. 테스트 계획 (TDD)
| # | 대상 | 케이스 |
|---|------|--------|
| T1 | `parseFrontmatterList` | 블록리스트·인라인·부재(missing)·빈배열(empty)·scalar(invalid_scalar)·BOM·따옴표. **TOML `skills=[...]` 파싱**(R1 H2) |
| T2 | `computeConfigHash` | 동일 내용=동일 해시·1바이트 변경=변경·파일 순서 무관(정렬)·mtime 무관 |
| T3 | 분류 | 고아 에이전트·link_unknown(미선언)·**dead_link=대상 디스크 부재만**·coverage_gap=미배정만(**둘 중복 아님**·R1 H1)·orphan 스킬 확정 유지(레거시 에이전트 존재해도)·unknown_scope·orchestrates edge(R1 H3)·**동일명 스킬 `.claude`/`.agents` 이중 정의 시 references/orchestrates 런타임별 보존**(R3 MED — 병합 유실 없음) |
| T4 | A35 회귀 | 하위호환·**subject_kind로 orphanAgents/orphanSkills 분리**·전 에이전트 고아 오탐 0 |
| T5 | 스냅샷·waiver | generated_at 스탬프·summary append·envelope 스키마·**waiver edge 단위 억제**(동일 subject 다중 dead_link 중 하나만·R1) |
| T6 | e2e 통합 | `GET /api/overview/state-stats` 실응답 → 이 레포 구성 반영·고아 오탐 0 |
| T7 | fail-open | diag 없음→null·계층A 정상·UI 비블록. **portable CLI** `node scripts/harness-scorecard.mjs` stdout JSON(R1 H4) |

## 다음 단계 참조
- **미해결:** view 강등의 UI 표기 상세(경고 배지 문안)는 구현 시 확정. 계층B LLM 프롬프트 본문은 별도(설계 범위 밖).
- **핵심 결정:** SSOT=`computeHarnessScorecard()` in-memory·JSON=스냅샷. 파서 배열 계약(present 구분이 link_unknown/orphan 갈림). **portable 감사=`scripts/harness-scorecard.mjs`(esbuild 번들·단일소스)**·factory 전용만 scope 게이트. 계층B=fail-open·캐시. hard-gate 아님(advisory). dead_link=broken pointer만·coverage_gap=미배정만(상호배타).
- **R1~R3 반영:** dead_link=broken pointer만(전문서 정합)·Codex TOML 다중행 skills·orchestrates/**references 런타임별 보존**·portable CLI(esbuild 번들)·subject_kind·waiver edge단위+canonicalFindingId·scalar 거부·runHarnessDiagOnce 분리·envelope type 정본=FindingType.
- **수렴:** R3 codex+agy 양 엔진 no-high(R1~R3). agy "즉시 M-A 구현 이행 무방".
- **다음:** stabilizer 게이트(정본 변경분 M-B) → 구현(M-A 착수·T1~T7 TDD).
