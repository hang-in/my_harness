# 결과서 — M-C 구성 자기평가 추세 축적 구현

> 일자: 2026-07-11. 상위: `harness-scorecard-mc-design.md`(외부감사 8R 수렴). 하네스: harness-ui-dev(TDD)·외부감사 codex+agy.

## 한 일
② 미구현분(스냅샷 축적·추세·UI) TDD 구현. `writeHarnessScorecardSnapshot` 호출처 0 → 추세 데이터 없던 것 해소.

**산출:**
- `scorecard-snapshot.ts`(신규): lockfile(하드링크 원자성·TTL-only stale·release 안전마진+재검사·reclaim 재확인)·`writeHarnessScorecardSnapshot`(append-on-state-change·물리개행보장+fsync·부분실패 복구·temp+rename)·`readHarnessTrend`(verdict penalized·truncated ghost 차단·scope 혼합차단·꼬리손상 폴백)·derive penalized/debt/active_ids.
- `scorecard.ts`: `state_key`(전수 active id 해시)·`readWaivers`→Map(expiry/reason 보존)·`Finding.waiver_expires_at`.
- `scorecard-cli.ts`: `--snapshot` 모드(위치 무관·root=첫 non-flag).
- `api/index.ts`: `GET /trend`·`POST /snapshot`(무본문 정규화·strict body·HTTP in-flight 429·_workspace만 write).
- `screens.tsx`: HarnessScorecardCard 3부(건강도 subject_kind분리·severity·provenance/detail 펼침·waiver·namespace·loop_ref / 추세 verdict·new/resolved·마지막기록 / 빈상태+스냅샷 버튼).
- `harness-scorecard.md`(정본): 오케스트레이터 Phase 0/7-5 `--snapshot` 호출 배선.

## 검증
- vitest 949 pass / 1 skip / **2 fail=사전 projectroot**(env·무관). typecheck clean·빌드 성공.
- 신규 테스트: mc(append/skip·복구·꼬리내성·동시성·stale 회수·truncated)·cli(--snapshot·실 2프로세스 동시)·api(trend·POST 400/429).
- 외부감사 codex+agy 6R: lockfile ABA·TOCTOU·gcTemps·POST 429·UI 반복 경화 → **codex no-high**. agy 잔여=**분산 FS/멀티노드/3프로세스**(로컬 단일호스트 dev tool 배포모델 밖·주석 명시·failure 무해[append 원자·state_key dedup·json 멱등]) — 오케스트레이터 adjudication 수렴.
- stabilizer: 정책감사 PASS·정본 배선(harness-scorecard.md).

## 다음 단계 참조
- **미해결:** M-D(계층B LLM diag·오케스트레이터 자연어 제안·view 강등 배지). backfill(기존 하네스 `skills:`/`orchestrates:` 실추가·현 link_unknown 부채).
- **핵심 결정:** 축적 = append-on-state-change(state_key)·lockfile 로컬 단일호스트 스코프(하드링크+TTL-only·분산은 외부 코디네이터 필요·명시). 추세=penalized counts·debt 분리. UI 3부. 오케스트레이터가 `--snapshot`으로 축적.
- **다음:** M-C 커밋. 재시작(`npm start`) 후 #/eval에서 추세·스냅샷 버튼 확인.
