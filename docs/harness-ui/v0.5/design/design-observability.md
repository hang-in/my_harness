# Harness UI — 관측성 & 효과성 대시보드 기획 (Agents/Skills 심화 + 토큰 통계)

> 요청: 스킬 리스트·에이전트 리스트·에이전트 상세(사용 스킬 포함)·스킬/에이전트별 토큰 통계·하네스 효과성 대시보드.
> 원 설계 `README.md`는 Agents/Skills 목록+상세(정적 인벤토리)만 있음. 이 문서는 **실행 기반 사용/효과 관측**을 추가하는 기획.
> 상태: **기획 초안 · 미검증.** 범위 큼 → **v0.6 Observability**로 분리 권장(v0.5는 supervision 수렴 우선). 원하면 v0.5 확장.
> 실행 기반이므로 v0.5.2 supervisor·구조화 로그·events 스키마에 **의존**(선행조건).

---

## 1. 목표
하네스가 **얼마나 효과적으로 쓰이는지** 보이게 한다: 어떤 에이전트/스킬이 실제로 쓰이나, 토큰을 어디서 태우나, 죽은(안 쓰이는) 에이전트/스킬은 뭔가, 리뷰가 수렴하나.

## 2. 토큰 귀속 실현가능성 (정직 — 과대표시 금지)
CLI 실측 기반. UI는 각 수치에 **신뢰 등급 라벨** 표시(기존 `authenticated: unknown` 정직 패턴과 동일).
| 단위 | 등급 | 근거 |
|------|------|------|
| **run 총량** | `measured` | claude `--output-format json/stream-json` result.usage · codex `--json` TokenCount 이벤트 |
| **agent별(Codex)** | `measured` | 에이전트당 별도 `codex exec` → usage 분리 |
| **agent별(Claude Agent-team)** | `estimated` | 단일 `-p` 세션 내 서브에이전트 → stream-json usage 집계값, 서브에이전트별 분해 미보장. turn 경계·agent 태그로 근사 |
| **skill별** | `estimated` | 스킬 호출은 토큰 경계 없음. = SKILL.md 컨텍스트 로드 비용(측정가능) + 호출 횟수 + run 점유율 휴리스틱. 진짜 출력토큰 귀속 아님 |
- UI 규칙: `estimated`는 배지로 명시, 툴팁에 산정식. `measured`와 시각 구분. 추정을 정확값처럼 표시 금지.

## 3. 페이지 구성

### 3.1 Skills 리스트 (`/skills`)
- 컬럼: 이름 · description · 트리거 · 런타임 경로(Claude/Codex) · **호출 횟수(기간)** · **점유 토큰(estimated)** · 마지막 사용 · drift.
- 필터: 런타임 · 사용/미사용 · drift 상태.
- **미사용 스킬 강조**(dead weight — 로드 컨텍스트만 먹고 안 쓰임).

### 3.2 Skill 상세 (`/skills/:name`)
- description · 트리거 · references · SKILL.md 컨텍스트 토큰(measured) · 본문 미리보기(escape).
- **연결 에이전트**: 이 스킬을 쓰는 에이전트 목록 + 각 호출 횟수.
- **사용 추이**: run별 호출 횟수 · 점유 토큰(estimated) 시계열.
- 최근 호출 이벤트(run 링크).

### 3.3 Agents 리스트 (`/agents`)
- 컬럼: 이름 · 역할 · 런타임 · 도구 · **연결 스킬 수** · **run 참여 수** · **누적 토큰(measured/estimated 라벨)** · 성공률 · 마지막 실행 · drift.
- **미사용 에이전트 강조**(정의됐으나 run에 안 뜸).

### 3.4 Agent 상세 (`/agents/:name`) — 핵심
- 정의: 역할 · priority · 도구 · 런타임별 정의 파일(.md/.toml) · frontmatter.
- **사용 스킬 섹션**(요청의 "스킬을 사용할 수 있는 부분"):
  - **선언된 스킬**: 에이전트 정의(frontmatter/본문)가 참조하는 스킬.
  - **관측된 스킬**: 실행 events에서 이 에이전트가 실제 호출한 스킬 + 횟수(선언≠관측 gap 표시 — 죽은 참조/미선언 사용 감지).
- **토큰 통계**: run별 input/output/cache(measured, codex) 또는 집계 근사(estimated, claude). 추이 차트.
- **실행 이력**: 참여 run 목록 · 상태 · 소요 · 산출물.
- 성공/실패·재시도·리뷰 판정(확인/기각) 요약.

### 3.5 효과성 대시보드 (`/insights`) — 하네스 건강도
하네스가 잘 쓰이는지 상위 지표. 기존 `loop_scorecard`/`build-scorecard` 시각화 + 신규 집계.
- **토큰 효율**: run당 토큰 · 성공 run당 토큰 · 단계별 토큰 분포 · 캐시 적중률.
- **성과**: run 성공/실패율 · 평균 소요 · 재작업률(재시도/수정).
- **리뷰 수렴**(external-review-loop 연계): run당 라운드 수 · overturned-rejection rate · loop-until-dry 달성률.
- **활용도**: 스킬 사용 빈도 분포 · **미사용 스킬/에이전트 목록**(정리 후보) · 에이전트 가동률.
- **추이**: 위 지표 시계열(하네스가 나아지나 나빠지나).
- 각 카드 measured/estimated 라벨.

## 4. 데이터 모델 (v0.5.2 events 스키마 확장 — 선행조건)
관측성은 events가 귀속 정보를 담아야 성립. v0.5.2 `events.jsonl` 라인에 추가:
```json
{"seq":42,"ts":"...","agent":"builder","skill":"external-review-loop","phase":"Phase 5",
 "event":"skill_invoked","usage":{"inputTokens":1200,"outputTokens":800,"cacheReadTokens":5000,"cacheCreationTokens":0}}
```
- `agent`·`skill`(활성 스킬, 없으면 null)·`usage` 델타(있으면). supervisor가 구조화 JSON 로그에서 파생.
- **집계/롤업 레이어**: run이 많으므로 on-read 전수 스캔 금지. `_workspace/metrics/rollup.json`(supervisor가 run 종료 시 증분 갱신) — agent별/skill별 누적 토큰·호출·성공. UI는 롤업 read, 상세는 run drill-down.
- SKILL.md 컨텍스트 토큰 = 토크나이저 없이 근사(문자/토큰 비율) 또는 tokenizer 라이브러리(선택). estimated 라벨.

## 5. API 추가
```text
GET /api/metrics/overview            # 효과성 대시보드 집계
GET /api/metrics/agents              # 에이전트별 롤업(토큰·호출·성공률)
GET /api/metrics/skills              # 스킬별 롤업(호출·점유·미사용)
GET /api/agents/:name/usage          # 에이전트 토큰/실행 추이
GET /api/skills/:name/usage          # 스킬 사용 추이 + 연결 에이전트
```
- 기존 `GET /api/agents/:name`·`/api/skills/:name`에 `declaredSkills`·`observedSkills`·`usageSummary` 필드 추가.
- 모든 수치에 `confidence: "measured"|"estimated"` 동반.

## 6. 기존 하네스 자산과 연결
- **loop_scorecard / build-scorecard.sh**: 이미 루프 효율 로깅 존재 → 효과성 대시보드의 리뷰-수렴 카드 데이터 소스.
- **self-improvement-loop / artifact_benchmark**: 산출물 품질 지표 → 효과성에 편입 가능(향후).
- **check-artifacts(D4)**: 결과서 기록률 = 하네스 규율 지표로 대시보드에 추가 가능.

## 7. 정직한 한계
- skill별 토큰은 **추정**(절대 measured라 표시 안 함). "이 스킬이 N 토큰 썼다"가 아니라 "이 스킬 활성 구간 점유 N(추정)".
- claude Agent-team 서브에이전트별 분해 미보장 → agent별이 estimated일 수 있음(런타임에 따라 라벨 다름).
- 롤업 정확도는 events 귀속 태깅 품질에 의존(supervisor 파싱). 태그 없으면 "unattributed" 버킷.
- 효과성 "지표"는 프록시 — 좋은 수치가 좋은 결과 보장 아님(Goodhart 주의, 기존 loop-self-eval 원칙과 동일).

## 7b. 하네스 상태·통계 — 커버리지 경계 (어디까지 보여줄 것인가)
"어디까지"의 답 = **정적(파일에서 즉시 도출) → v0.5 표시 / 실행 파생(events·usage) → v0.6 / 추정·프록시는 라벨 / 외부 런타임 내부는 미표시(비목표)."** 무한 확장 아님 — 아래가 경계.

### 계층 A — 정적 구성 상태 (v0.5, 파일에서 즉시)
현 Overview에 더해 추가(신규). **feasibility 주의(R7 반영):**
- **구성 건강도:** 에이전트/스킬 수·오케스트레이터 유무·**고아**(연결 0)·CLAUDE.md/AGENTS.md 포인터 정합 = measured. **에이전트↔스킬 커버리지 = heuristic**(정의 파싱 추론 — 구조화 바인딩 소스 없음, 라벨).
- **D4 규율:** 결과서 기록·`## 다음 단계 참조` 누락·`_workspace` 방치물. **UI가 TS 네이티브로 파일 검사**(check-artifacts 스크립트 셸아웃 금지 — 빌드 하네스에 스크립트 부재 가능·비정적).
- **하네스 업데이트 상태:** `.harness-manifest.json`에서 USER-MODIFIED 수·보류 = measured(정적). **factory-drift = factory 경로 설정 시만**(빌드 하네스엔 팩토리 없음 → `unknown`, 실패 아님). 정적 비교하려면 설치 시 baseline manifest 해시 번들.
- **진화 이력:** CLAUDE.md **+ AGENTS.md**(듀얼) 변경이력 파싱 → 타임라인.
- **런타임 drift:** 이미 §Drift(v0.5) — 요약만.

### 계층 B — 실행 파생 통계 (v0.6, events/usage)
- 토큰(run measured / agent codex measured·claude estimated / skill estimated) — §2·§3.
- **모델 라우팅·비용:** opus vs 경량 사용 비율·run당 토큰·**비용 추정**(estimated)·추세.
- **에이전트 실패 패턴:** 실패율·재시도율·에러 유형 분포(반복 실패 에이전트 식별).
- **리뷰 게이트 통계:** run당 라운드·확인/기각 비율·loop-until-dry 달성·overturned-rejection(loop_scorecard 연계).
- **동시성·큐:** 실행 중 run 수·동시성 cap(3/5) 대비 큐 깊이·백프레셔.
- **소요·병목:** run 소요 분포·단계별 시간·heartbeat 지연.
- **승인 모드:** 사용자 승인 vs 자율(`.autonomous`) 비율.

### 계층 C — 미표시 (비목표 · 경계 밖)
- 외부 런타임 내부 메모리·live agent spawn 상태(직접 감시 안 함 — README 비목표).
- 추정을 measured로 표시(금지). 개별 LLM 프롬프트/사고 원문(민감·비대).
- 실시간 밀리초 텔레메트리(로컬 개발도구 과설계 — 파일 폴링 주기로 충분).

### anti-Goodhart (신규 지표 공통)
지표는 프록시 — 좋은 수치 ≠ 좋은 결과. 미사용/고아/방치 같은 **행동 유도형** 지표 위주(개선 액션 직결), 순위·점수형 최소화. loop-self-eval 원칙 준용(측정→제안, 자동 강제 금지).

## 8. 범위·순서 권고
- **계층 A(정적 상태 카드)는 v0.5 M4** — 파일에서 즉시. **계층 B(실행파생 통계·토큰·비용·효과성)만 v0.6.** (R7 정합 — "관측성 v0.6 분리"는 계층 B 한정.)
- **v0.6 Observability(계층 B) 분리 권장.** v0.5는 supervision/reconcile 수렴이 먼저. 계층 B는 그 위에 얹힘.
- v0.6 순서: (1) events 귀속 스키마(agent/skill/usage) 확정 → (2) supervisor 롤업 증분 갱신 → (3) 롤업 API → (4) Skills/Agents 심화 페이지 → (5) 효과성 대시보드 → (6) loop_scorecard 통합.
- 최소 버전(MVP): run/agent 토큰(measured) + 미사용 스킬/에이전트 목록 + 리뷰 수렴 카드. skill 토큰 estimated·효과성 추이는 후속.

## 다음 단계 참조
- 이 기획을 v0.6 스펙으로 승격할지, v0.5.2에 편입할지 **범위 결정** 필요(supervision 수렴 전 편입은 리스크).
- events 귀속 스키마(`agent`·`skill`·`usage`)는 v0.5.2 supervisor 설계에 **선행 반영**해야 후속 관측성이 성립 — v0.5.2 R3 재감사 시 이 필드 포함 여부 함께 검토 권장.
- 토큰 귀속 등급(measured/estimated) 라벨링은 비협상 — 추정을 정확값처럼 표시하면 신뢰 붕괴.
