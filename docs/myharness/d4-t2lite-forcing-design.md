# 설계서 — D4 T2-lite + 강제장치(check-artifacts) 문서체계 완성

> ## ✅ 외부감사 반영 — **최소안으로 축소 (아래 본문에 우선)**
> 외부감사(codex+agy, 강수렴): 진단("구조 아니라 강제장치 부재")은 **타당 확인**. 단 **T2-lite 구조는 여전히 과설계** — 버그는 구조 없이 강제만으로 고쳐진다. 확정 축소:
>
> 1. **[핵심] 강제를 LLM이 아니라 런타임으로.** check-artifacts를 프롬프트/체크리스트에 두면 오케스트레이터가 **게이트 호출 자체를 스킵**하고 "확인했다" 할루시 → 무력화("강제의 강제" 문제). → **git `pre-commit` hook**(생성 하네스가 타겟에 설치)에 등록하여 결과서 없으면 **커밋을 물리적 차단**, 또는 external-review-loop 게이트 스크립트에 하드코딩. 프롬프트 규칙 아님.
> 2. **[구조 축소] todo/·STATUS를 docs/에서 제거.** todo(체크박스 live)=git 커밋 노이즈(체크 하나에 diff), STATUS 수동=working_history와 이중상태(자동 rollup은 regex 파편화로 유지불가). → **docs/의 durable 정본 = `working_history/` 하나.** todo·STATUS는 필요 시 `_workspace/`(휘발) 또는 read-only 보조뷰(강제·정본 아님). design.md도 큰 작업만 선택.
> 3. **[최소안] 버그는 기존 T1 강제만으로 해결.** T2-lite 복잡구조 불필요 — "T1 결과서 1장을 `docs/{project}/working_history/`에 쓰고 검증"이면 산출물 방치 버그가 고쳐짐. 설계를 **"T1 결과서 + 런타임 강제"**로 축소.
> 4. **[누탐 방지] check-artifacts = grep 검사.** `ls` 존재만이면 빈파일/엉뚱파일 false-pass → **`## 다음 단계 참조` 블록 grep을 FAIL 조건**으로(내용 검증).
> 5. **[격상] T2/문서무게 = 명시 플래그.** LLM 재량이면 편한 T1으로 다운그레이드 → `/myharness --tier2`·명시 지시일 때만 격상.
> 6. **[캡] SKILL 500 포화** — 추가 금지, 기존 문구 **교체 + reference 이동**만. SKILL엔 "단계 마감 시 check-artifacts" 포인터 1줄(가능하면 기존 체크리스트 항목 교체).
> 7. **[운영] actionable FAIL** — 커밋 차단 시 에러 끝줄에 "결과서 템플릿 경로 참조 복구" 힌트(에이전트 무한루프 방지).
> 8. **[정합] Tμ와 로직 일치** — Tμ(current.md digest)도 check-artifacts가 일관 처리(누락 없게).
>
> **축소 결론:** T2-lite 구조(todo/STATUS/design 강제)는 **기각** → docs/ = working_history 정본 하나, 강제 = **git pre-commit hook + grep 검증 check-artifacts**, 격상 = 명시 플래그. 아래 §3~7의 todo/STATUS 강제 부분은 이 반영에 따라 *선택·휘발*로 격하.
>
> ---
> 상태: **설계 제안(미구현·최소안 확정)**. 자체검토 → 외부감사 통과 전 하네스 정본 미수정.
> 대상: `skills/myharness/references/orchestrator-template.md`(문서 체계 §), `templates/`(신규 골격), `skills/myharness/scripts/`(신규 `check-artifacts.sh`), `SKILL.md` 5-1·체크리스트.
> 배경: 실사용에서 영속 산출물(design/plan/result)이 `docs/`에 안 가고 gitignored `_workspace`에 방치(→ cleanup/재실행 시 소멸·감사 이력 0). 사용자 T2 아이디어 외부감사(codex+agy 강수렴) 판정 = *문제의식 타당, 버전폴더/링크체인/general 강제는 기각, T2-lite로 축소 + 강제장치가 진짜 픽스*.

## 0-1. L2 mock A/B 실증 (가드레일 검증 — 결정적, LLM 노이즈 0)
프로토타입(`scripts/check-artifacts.sh` + git pre-commit hook)으로 산출물 방치 버그를 A/B 재현·차단 검증. **6/6 PASS:**
| 케이스 | 결과 |
|--------|------|
| **A(강제 없음)**: 결과서 누락 run | **커밋 성공 = 버그 재현** |
| **B(hook)**: 결과서 누락 run | **커밋 차단 = 버그 예방** |
| B: 유효 결과서 | 커밋 성공 |
| B: 스텁/빈 결과서 | **여전히 차단**(`## 다음 단계 참조` grep + 최소 크기 → false-pass/게이밍 차단) |
| T0 티어 | 문서 없이 PASS(slim 무마찰) |
- 결정적 pass/fail(LLM 실행 없이 hook 결정성 활용). anti-Goodhart: "존재"는 강제·게이밍 차단하되 "유용성"은 미보증(설계 한계 명시).
- 스크립트: `skills/myharness/scripts/check-artifacts.sh`(끝줄 `ARTIFACTS: ok|missing:<사유>`, 항상 exit 0). hook은 이 끝줄 파싱해 커밋 차단.

## 0-2. 외부감사 2R (codex+agy, 러너=claude 제외) — 결함 발견·수정·재실증
초기 배선을 외부 독립 리뷰 2라운드로 적대 검증. **양 라운드 모두 실결함 발견(감사 정상 작동)** → 전건 실코드 대조 판정 후 수정 → 결정적 A/B 재실증.

**Round 1 (확인):** ① stale-latest·`zzz.md` 알파벳 우회(멀티커밋서 이전 결과서로 통과) ② hook 경로 `$(dirname $0)`+팩토리경로 의존(자기완결 붕괴)·unquoted heredoc ③ `grep '/(_|template)'` 전체경로 매칭 → 조상 디렉토리(`_workspace`/`/x/_dev/`)에 걸려 **전 커밋 차단** ④ env 기본값 오작동 ⑤ 기존 hook `[ ! -e ]` 무음 스킵 ⑥ Tμ 대문자·heading regex·T2 주석.
**Round 2 (확인·잔존/신규):** R2-a hook 스테이징 필터가 **또** 전체경로(프로젝트명 template/_ → 전차단) · R2-b **한글 파일명 quotepath 래핑 → `.md$` 매칭실패 → 한글 우선 하네스서 전 커밋 차단(critical)** · R2-c 외부 hook append 가 `exit 0`/`exec` 뒤 dead code · codex#2 subdir-noop 우회. **기각:** agy#3(xargs guard redundant — GNU xargs 빈입력 cwd-ls 반증).

**수정 요지:** check-artifacts에 `--file` 모드(스테이징 결과서 직접 검증) + basename 필터 + mtime + heading 앵커. hook 2층 강제(`git diff --cached` 신규 결과서 스테이징 요구 + 그 파일 내용검증), `git -c core.quotepath=false`, awk basename 필터, 외부 hook **wrapper**(우리검사 우선 후 위임), 리터럴 baked.
**보너스 자체발견:** installer `BODY="$(cat <<'HOOK'…)"` 캡처가 macOS **bash 3.2**서 중첩 heredoc+멀티라인+`set -u` 조합에 `unbound` 오류 → **heredoc 파일 직접 emit**(변수 캡처 제거)로 회피.

**재실증 — L2 mock A/B v3 16/16 PASS:** 누락 차단·유효 통과·스텁 차단·**한글명 정상·template/`_` 프로젝트 정상·subdir-noop 차단·stale-latest 차단·외부hook wrapper(위임 보존)·멱등·slim(T0/Tμ) 무마찰**. 모두 결정적(LLM 노이즈 0).

**Round 3 (수렴 확인 — 재작성분 감사, 확인 5건+):** ① **TOCTOU** — hook 이 워킹트리(`$root/$p`) 검증 → stub 스테이지 후 워킹트리만 valid 편집으로 우회(codex#1·agy#2) · ② **injection** — `{PROJECT}` 리터럴이 `"${:-{PROJECT}}"` 안 → 프로젝트명 `$()`·따옴표로 명령 실행/구문붕괴(agy 가 `injected.txt` PoC 실생성·codex#3) · ③ **wrapper 비실행 외부hook** — `[ -x ]&&…||exit $?` → dormant 비실행 hook 있으면 exit1 전커밋차단(codex#4·agy#1) · ④ **MYH_TIER=t0 env 우회** — env 로 강제 하향(codex#2) · ⑤ mv `.local` 충돌(codex#5) · template 대소문자·amend·diff-filter C(low).
**수정:** check-artifacts `--file -`(stdin) — hook 이 `git show :path`로 **스테이지 blob** 검증(TOCTOU 폐쇄). tier **baked-only**(env 하향 금지). `{PROJECT}` single-quote 리터럴+팩토리 슬러그 제약(injection). wrapper 비실행 시 `exit 0` 폴백. mv 충돌 가드. `tolower(template)`+`--diff-filter=d`.
**재실증 — L2 mock A/B v4 16/16 PASS:** TOCTOU(stage stub+worktree valid→차단)·injection(명령 미실행·bash -n ok)·MYH_TIER=t0 우회 불가·비실행 외부hook 통과·실행 외부hook 위임 보존·Template 대소문자·mv `.local` 보존·`--file -` stdin.
**Round 4 (재작성분 감사 — 확인 5건, 성격 전환=엣지/적대/방어심화):** ① MYH_PROJECT env retarget — 다른 프로젝트 지목해 그쪽 스테이지 결과서로 gate 만족(codex#1, tier와 동류) · ② symlink 결과서 — blob 이 링크 타겟 문자열이라 위조 통과(codex#2) · ③ wrapper repo경로 injection — `$bak` 무탈출 baked(agy#1) · ④ mktemp 폴백 `/tmp/…$$` symlink 공격(agy#2) · ⑤ `.local` 충돌 단일검사(agy#4). **기각:** awk escape(agy#3 — 슬러그 제약이 backslash 제거).
**수정:** project·tier **baked-only**(env override 전면 제거). symlink `git ls-files -s` mode 120000 거부. wrapper `printf %q`(경로 injection). mktemp 실패 시 안전종료(폴백 제거). `.local` while 유일경로.
**재실증 — L2 mock A/B v5 18/18 PASS:** +symlink 거부·MYH_PROJECT retarget 차단(위 R3 케이스 전부 유지).

**수렴 판정:** R1(정상입력 파손: underscore·template) → R2(정상입력 파손: 한글 quotepath) → R3(우회: TOCTOU·injection·tier) → **R4(엣지/적대: env retarget·symlink·악성 repo경로·mktemp·PID충돌)**. 결함 성격이 "정상 사용 파손"→"의도적 우회"→"공격자 통제 입력 방어심화"로 이동. **정상+대부분 적대 케이스는 R1–R4로 견고.** R5 는 이론적 레이스·이색 git config 등 실사용 무관 tail 로 수렴 예상 — 비용 대비 실익 낮음(중단 권장, 요청 시 진행).
> 각 라운드 수정은 정확히 그 라운드 지적건을 커버하는 결정적 A/B(LLM 노이즈 0)로 검증. 산출물 방치 버그(에이전트/사용자가 결과서 저장 누락→커밋 차단)라는 본래 목표는 R1–R4 전 구간 실증됨.

## 1. 근본원인 (재확인)
D4 문서체계는 설계됐으나 **강제장치(forcing function)가 없다.** 외부리뷰엔 `check-review-tools.sh`+게이트가 있어 신뢰되는데, 문서기록엔 검증 스크립트도, 하드 체크리스트 게이트도, 기본값도(T0=_workspace만) 없다 → LLM이 과업 몰입 중 스킵. **구조가 아니라 강제가 문제.**

## 2. 설계 원칙
1. **두 축 분리:** 구조(T2-lite) ≠ 강제(check-artifacts). 버그의 실해법은 강제(구조만 늘리면 재발).
2. **버전은 git, 경로 아님:** `docs/v{버전}/` 금지(git 이중버전·drift). git tag/release가 버전 담당.
3. **살아있음 vs 불변 구분:** STATUS·design·todo=덮어쓰기(현재), working_history=append(불변 원장).
4. **규모 스케일(slim 유지):** general 강제 금지. T2-lite는 큰 작업만.
5. **연속성 정본 = 최신 결과서 §다음단계참조**(링크체인·복붙 첨부 금지 — link rot·할루시).

## 3. 문서 구조 (T2-lite)
```
docs/{project}/
├── STATUS.md            # 살아있는 보드(덮어씀): 완료/진행중/다음/리스크. 상태 가시성.
├── design.md            # 상위 구조·전체 계획(살아있는 1장). §변경이력 append로 고도화. git이 버전.
├── todo/Pn_*.md         # 단계별 체크리스트(작업 UI, 정본 아님, 덮어씀). result 링크만(복붙 금지).
└── working_history/     # 결과서(불변 append, 감사·RAG 정본). §다음단계참조=연속성 진입점.
_workspace/  (gitignore) # 휘발: 리뷰 raw·status json·마커.
```
- **STATUS.md 이중상태 주의:** 수동 정본이 되면 result와 이중. 규칙 = "**최신 result에서 갱신**"(정본은 result, STATUS는 파생 보드). 가능하면 결과서 frontmatter/파일명에서 **자동 rollup** 생성.
- **버전:** 릴리스 시 `git tag vX.Y.Z` + (선택) `docs/{project}/releases/vX.md` 요약 1장. 경로에 버전축 없음.

## 4. 티어 (동적 격상 — general 금지)
| 티어 | 조건 | 산출물 |
|------|------|--------|
| T0 | trivial(1파일·단순질문) | `_workspace`만 |
| Tμ | 마이크로(1~2파일) | `docs/{project}/current.md` 1행 digest + commit 본문 |
| T1 | 표준 단발 | 결과서 1장(working_history) |
| **T2-lite** | **다단계/e2e·병렬·실패후재시작·장기감사·명시적 영속화 요청** | STATUS + design + todo/ + working_history/ |
- T2-lite 트리거는 **명시 조건만**. 오케스트레이터가 Phase 2에서 판정(리스크등급과 별개 축 — 문서 무게).

## 5. 강제장치 — `check-artifacts.sh {project}` (신규 번들)
`check-review-tools.sh`와 동형(번들·실행·끝줄 상태). 단계 마감 게이트에서 호출.
```
용도: 영속 클래스 산출물이 docs/에 기록됐는지 검증. 휘발(reviews/status)은 무시.
입력: 프로젝트 docs 경로 + 현 티어.
로직:
  - 티어 T0/Tμ → PASS(문서 불요).
  - T1 → docs/{project}/working_history/ 에 최신 결과서 1개 이상 존재? 없으면 FAIL.
  - T2-lite → STATUS.md·design.md 존재 + working_history 결과서 존재? 없으면 FAIL.
  - 결과서에 `## 다음 단계 참조` 블록 존재? 없으면 WARN(연속성 진입점).
출력 끝줄: ARTIFACTS: ok | missing:<목록>   (항상 exit 0, 상태는 끝줄로만 — 파이프라인 중단 방지)
```
- **게이트 배선:** external-review-loop Step 7 "기록→게이트→승인→커밋" 의 *기록* 직후 `check-artifacts.sh` → `missing:`이면 커밋 **차단**(결과서 쓸 때까지). = 안 지킬 수 없음.
- 외부 도구 무관(codex/agy 없어도 작동 — 순수 파일 검증).

## 6. 오케스트레이터 단계 루프 (배선)
```
단계 시작: working_history 최신 결과서 §다음단계참조 읽기(RAG) → todo/Pn 체크리스트 열기
작업 중:   완료마다 todo 체크(덮어씀). raw는 _workspace.
단계 마감: ① 결과서 write(working_history, append) ② check-artifacts.sh(missing이면 FAIL)
           ③ 게이트(외부리뷰/내부QA) ④ 승인 ⑤ 커밋 ⑥ STATUS.md 갱신(latest result 기준)
```

## 7. 반영 범위 (채택 시)
1. `scripts/check-artifacts.sh` 신규 + 생성 하네스에 번들(external-review 스킬처럼).
2. `templates/` — `status-skeleton.md`·`design-skeleton.md`·`todo-skeleton.md` 신규(working-history-skeleton은 유지, "교훈→개선" 섹션 명시 보강).
3. `orchestrator-template.md` 문서 체계 § — T2-lite 구조·티어 트리거·단계 마감 게이트에 check-artifacts 배선.
4. `SKILL.md` 5-1 + Phase 마감 체크리스트 — "결과서 docs/ 기록 + check-artifacts PASS" 하드 게이트 추가. **단 SKILL 500줄 캡 준수**(초과 시 references로).
5. `factory-map.md` — T2 상태 `📐 보류` → `T2-lite ✅ active`(축소형), full T2(버전폴더·병렬merge)는 계속 보류.

## 8. 자체검토 — 선반영 약점
1. **STATUS 이중상태 리스크** — 수동 STATUS가 result와 어긋날 수 있음 → "latest result에서 갱신" 규칙 + 장기적으로 자동 rollup(결과서 frontmatter 파싱). 수동은 T2-lite 보조로만.
2. **check-artifacts 우회** — 오케스트레이터가 게이트를 안 부르면 무의미 → SKILL 체크리스트 + Step 7 순서에 못박고, 자율 마커(`_workspace/.autonomous`)여도 이 검증은 유지(인간 승인만 생략).
3. **SKILL 500줄 캡** — 배선 추가분이 캡 압박 → 상세는 orchestrator-template/templates로, SKILL엔 포인터만.
4. **티어 판정 주관성** — T2-lite 트리거가 모호하면 남용/누락 → 명시 조건 리스트로 좁힘(§4).
5. **비코드 업무** — check-artifacts는 파일 존재만 보므로 비코드도 작동(설계·리서치 결과서도 대상).

## 9. 결정 기준
**채택(AND):** 강제장치가 실제 누락을 잡음(FAIL 재현) + slim 미저해(T0/Tμ 무영향) + git 이중버전 없음 + SKILL 캡 유지 + 외부감사 수렴.
**기각(OR):** check-artifacts 우회가 구조적으로 못 막힘 / T2-lite가 slim 과부담 / 자동 rollup 없이 수동 STATUS가 이중상태 상시화.

## 10. 오픈 퀘스천 (외부감사)
1. check-artifacts를 게이트에 넣어도 오케스트레이터가 게이트 자체를 스킵하면? 강제의 강제(메타)를 어디까지.
2. STATUS 자동 rollup(결과서 파싱 생성) vs 수동 — MVP는 어디까지.
3. T2-lite 트리거 판정을 스크립트/휴리스틱으로 자동화 가능한가, 오케스트레이터 재량인가.
4. working-history "덮어쓰기 금지" vs todo "덮어쓰기" 혼재를 사용자가 헷갈리지 않게 하는 최소 장치.
