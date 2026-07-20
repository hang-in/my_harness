# My Harness Web

이 하네스(Claude Code + Codex 에이전트 팀)를 **관찰·통제**하는 로컬 웹 패널. 인벤토리·실행·이력·문서·드리프트·평가를 한 화면에서 본다.

> 로컬 단일 사용자(127.0.0.1) 전용 개발 도구. 원격·다중 사용자는 비목표.

## 실행

```bash
cd harness-ui
npm install          # 최초 1회
npm start            # 프로덕션: 빌드 → 단일서버(127.0.0.1:5174) → 브라우저 자동 오픈(1회용 토큰)
```

- **`npm start`** — 원커맨드. `vite build` 후 `src/server/start.ts`가 단일 오리진(정적+API 한 포트)으로 서빙하고 fragment(#) 토큰이 담긴 링크로 브라우저를 연다. 토큰은 stdout에 안 찍힘(로그 미노출).
- **`npm run dev`** — 개발(HMR). vite(웹) `127.0.0.1:5273` + API `127.0.0.1:5274`. 코드 수정 시.
- **`npm test`** — vitest. **`npm run e2e`** — 현 레포 기준 종단 테스트.

접속은 **런처가 연 1회용 링크**로만(토큰 단일사용→세션 교환). 세션 만료 시 재접속.

## 화면 (좌측 그룹 사이드바)

| 그룹 | 화면 | 역할 |
|------|------|------|
| **개요** | Overview | 런타임·인벤토리·구성 건강도·D4 규율·진화 이력 |
| **실행** | **New Run** | 새 실행 시작(런타임·작업·권한·dry-run 제출 → run 생성). *에이전트 빌드 아님* |
| | **History** | 실행된 run 이력 조회·필터·검색·관찰(읽기 전용) |
| **정의** | Agents / Skills / Context | 에이전트·스킬·멀티런타임 컨텍스트 정의 조회·편집 |
| **문서** | Docs | `docs/**`·run artifacts 뷰어(읽기 전용·경로탈출 방어) |
| **점검** | Drift / Ops / Eval | 런타임 drift·운영 상태·평가(scorecard·자기개선 제안) |
| **설정** | Settings | projectRoot·정의 편집 토글·Docs 소스 등 |

흐름: **New Run → run 생성 → History에서 관찰**(fire-and-observe).

## 디자인

- **My Harness Web** · Mintlify식(라이트 우선 + 다크 토글·우상단). 민트그린 accent·헤어라인·여백.
- 그룹 사이드바 + 톱바(브레드크럼·연결상태·테마). Agents/Skills = 마스터-디테일(선택 리스트 + 상세·인라인 편집). Docs/Context 트리 패널은 마우스 리사이즈.

## 보안·범위

- 로컬 127.0.0.1 · fragment 토큰 부트스트랩 → 세션 교환 · Host/Origin 게이트.
- **읽기 우선.** mutating은 F7(에이전트/스킬 **정의 편집**)·F3(projectRoot)·F8(평가 지표 config)뿐 — 화이트리스트·원자 쓰기·낙관적 동시성·게이트(기본 off).
- **한계:** History·통계는 **이 UI(supervisor)로 실행한 run만** 반영. 터미널 CLI 실행은 파일상태에 안 남아 안 보임 → **v0.7(F-CLI 세션 로그 관측)**에서 해소 예정.

## 문서 지도

| 버전 | 상태 | 위치 |
|------|------|------|
| **v0.5** | 정본 CERTIFIED · 코어(supervisor·OS어댑터·보안·런처) 구현 | `v0.5/design/design-v0.5-final.md` · `v0.5/working_history/` |
| **v0.6** | 정본 수렴(외부감사 4축) · 구현(F2 프리필·F3 projectRoot·F4 이력·F5 뷰어·F6 관측성·F7 편집기·F8 평가·F9 Docs소스·F10 Context) | `v0.6/design/design-v0.6.md` · `v0.6/prd/` · `v0.6/todo/` |
| **v0.7** | 기획(PRD·설계) | `v0.7/prd/v0.7-prd.md` · `v0.7/design/design-v0.7.md` — **F-CLI 세션 로그 관측**(CLI 실행 가시화·프라이버시 옵트인) |

- v0.5 원안(frozen): `v0.5/design/README.md`. UI 디자인 시스템 근거: `v0.5/design/DESIGN.md`.
- 수용기준 A1-A46(v0.5)·A47-A112(v0.6)·A113-A122(v0.7) 누적. 위협모델 DV/D/DW/CL 계열.

## 상태 요약

v0.5 코어 + v0.6 전 기능 **구현·라이브**(`npm start`). v0.7 **기획 단계**(구현 전). 디자인 Mintlify 개편 완료.
