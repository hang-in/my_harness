# 작업결과서(후속 A): 단일 오리진 정적 서빙 + `npm start` 런처 + Eval 화면 용어 정리

> 상태: **완료·게이트 green·내부 보안감사 HIGH 0(라이브 프로브)·외부감사 R1 codex+agy HIGH 0.** 브랜치 `feat/harness-ui-v0.5`. M-시리즈 마일스톤이 아닌 사용자 후속 요청(로컬 단일사용자 원커맨드 실행 + Eval 화면 잔여 설계용어 제거).

## 1. 작업 요약
- **동기 1(원커맨드 실행):** 일반 로컬 사용자가 매번 수동 토큰 없이 `npm start` 한 번으로 서버 기동 + 브라우저 자동 오픈(fragment 토큰) + 단일 오리진(dist 정적 서빙). WSL 원격 접속(0.0.0.0)은 비목표 — 127.0.0.1 로컬 전용, Host 게이트 불변.
- **동기 2(용어 정리 3차):** Eval 화면에 남아 있던 설계용어("미측정(unavailable)·격리(corrupt)·OOM 방어·축소안(v0.6)·in-process 재계산·verdict_counts 재도출") → 사용자 문구로 교체. 서버 제공 `idx.note`(REDUCED_NOTE)가 근원이었음.

## 2. 변경 파일
**서버 신규:** `src/server/static.ts`(`registerStatic`·경화 리더 `openSafeFile` confine 재사용·`APP_SHELL_CSP` script-src 'self'·notFoundHandler SPA 셸 fallback·`@fastify/static` 미도입) · `src/server/start.ts`(`startServer`·`buildOpenCommand` 127.0.0.1+http 검증+cmd/shell metachar 거부·`openBrowser` execFile argv·stdout 토큰없는 base만·EADDRINUSE 재오픈).
**서버 수정:** `src/server/index.ts`(`buildServer({distRoot?})`+registerStatic·**Fastify `routerOptions.caseSensitive:true` 명시 고정**·게이트-라우터 정규화 불변식 주석) · `src/server/security.ts`(Host 게이트를 static-pass return 앞으로 이동 — 정적/healthz도 allowedHost 요구·토큰/Origin 게이트는 `/api/` 한정 유지) · `src/server/adapters/evals.ts`(REDUCED_NOTE·reason·computedBy 문구 평문화·`trendSource` API 계약값 유지) · `package.json`(`start` 스크립트).
**웹:** `src/web/screens.tsx`(Eval 화면 문구 평문화·"평가 기록"·"계산 방법"·trendSource 렌더 한국어).
**테스트(신규):** `test/staticserve.test.ts`(22건 — MIME·CSP·경로탈출·심링크·Host·SPA fallback·⑦ authority-form/대문자/이중디코딩 API우회 0·mutating POST/DELETE 핸들러 미도달 404·buildOpenCommand metachar 거부).
**테스트(수정):** `test/{bypass,bypass2}.test.ts`(SPA fallback 재정의) · `test/evalsapi.test.ts`(note "다음 버전") · `test/defeditweb.test.ts`(proposal-not-available 안내에서 F8/M13 설계코드 제거·회귀가드).

## 3. 검증 결과
- 게이트: `tsc --noEmit` **PASS** · `npm run build` **PASS**(125 modules) · `vitest run` **896 passed / 1 skipped**(78 files·exit 0).
- 보안 불변식: I2(토큰 stdout 미노출·fragment argv만)·I3(execFile+argv·shell 금지)·I7(127.0.0.1 바인딩)·경로탈출(dist confine·O_NOFOLLOW·심링크 거부·pre/post dev·ino) 전건 유지.

## 4. 외부/내부 감사 반영
- **내부 security-auditor(라이브 HTTP 프로브):** PASS·HIGH 0. mutating POST/DELETE authority-form(`//api/...`)·dotfile·백슬래시·이중인코딩·심링크 전건 fail-closed 실증. SPA fallback 200 응답은 전부 공개 셸(API JSON/시크릿 0), mutating 벡터는 404(핸들러 미도달). LOW 3(회귀방지 권고).
- **외부감사 R1(codex+agy):** 양 엔진 **HIGH 0**. codex MED 2(win32 cmd metachar 심층방어·bypass 회귀테스트 갭).
- **반영(회귀방지·attack-surface 축소):** ① `buildOpenCommand` URL 전체 cmd/shell metachar(`& | < > ^ " % $ ; ` 백틱·공백) 거부 + 테스트. ② mutating/authority-form bypass 명시 회귀테스트(⑦). ③ Fastify `routerOptions.caseSensitive:true` 고정(게이트-라우터 정규화 불변식 회귀가드) + 불변식 주석.

## 5. 다음 단계 참조
- **미해결:** WSL2 실서브프로세스 테스트(supervisor/defedit/execrun/reconcile)는 dev 서버 병행·직렬 CPU 부하에서 30s timeout flake — 격리 실행 시 PASS(비회귀). CI/로컬에서 dev 서버 종료 후 측정 권장.
- **핵심 결정:** 단일 오리진 정적 서빙은 **로컬 단일사용자(127.0.0.1) 전용**. 원격/다중기기(0.0.0.0·IP)는 v0.7 별도 보안 설계 — Host 게이트를 넓히지 말 것(start.ts 주석·security.ts allowedHost 고정). 이유: 0.0.0.0 확장 시 DNS rebinding·비인증 노출면 급증.
- **핵심 결정:** 게이트-라우터 정규화 안전은 Fastify `caseSensitive:true`+단일 %-디코딩에 의존 → `routerOptions`로 명시 고정. lenient/caseSensitive:false 도입 금지(staticserve.test ⑦가 회귀 감지).
- **다음 단계:** 사용자 요청 시 `npm start` 실사용 스모크(브라우저 자동 오픈·EADDRINUSE 재오픈) 확인. Eval 화면 외 잔여 설계용어 사용자 재제보 시 [[design-v0.6-glossary]] 매핑표 기준 재점검.
