// 단일 오리진 정적 서빙 + 원커맨드 런처 진입점(사용자요청 A) — TDD·보안 경계.
//   ① GET / · /assets/x.js → 200·정확 MIME·앱 CSP(script-src 'self')·토큰 없이 접근
//   ② 정적 경로탈출(../ · %2f · 심링크) → 차단(dist 밖 0)
//   ③ /api/* 토큰 없으면 401 · mutating Origin 게이트 유지
//   ④ 정적도 bad Host → 403 · localhost·127.0.0.1 허용
//   ⑤ start.ts open argv(shell 없음 · openArgs argv · URL fragment 토큰)
//   ⑥ SPA fallback(미매칭 GET → index.html)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server/index.js";
import { makeSecurity } from "../src/server/security.js";
import { APP_SHELL_CSP } from "../src/server/static.js";
import { buildOpenCommand, openBrowser, baseUrl } from "../src/server/start.js";
import { bootstrapUrl, openArgs } from "../src/server/launcher.js";

const PORT = 5174;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const INDEX_HTML = '<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body><div id="app"></div></body></html>';
const APP_JS = 'console.log("harness-ui app shell");';

describe("단일 오리진 정적 서빙", () => {
  let dist: string;
  let outside: string;
  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), "hui-dist-"));
    outside = await mkdtemp(join(tmpdir(), "hui-outside-"));
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), INDEX_HTML);
    await writeFile(join(dist, "assets", "app.js"), APP_JS);
    await writeFile(join(dist, "assets", "app.css"), "body{color:#000}");
    await writeFile(join(outside, "secret.txt"), "TOP SECRET");
    // dist 안에 dist 밖을 가리키는 심링크(escape 벡터) — 지원 안 되면 skip.
    try { await symlink(join(outside, "secret.txt"), join(dist, "assets", "evil.js"), "file"); } catch { /* skip */ }
    try { await symlink(outside, join(dist, "leakdir"), "dir"); } catch { /* skip */ }
  });
  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  function gated() {
    const sec = makeSecurity(PORT);
    return { app: buildServer({ security: sec, distRoot: dist }), sec };
  }

  it("① GET / → 200·text/html·앱 CSP(script-src 'self')·토큰 없이", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/", headers: { host: HOST } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(r.headers["content-security-policy"]).not.toContain("script-src 'none'"); // doc-preview CSP 아님
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.body).toContain('id="app"');
  });

  it("① GET /assets/app.js → 200·text/javascript·토큰 없이·CSP 없음", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/assets/app.js", headers: { host: HOST } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/javascript");
    expect(r.headers["content-security-policy"]).toBeUndefined(); // 앱 셸 CSP 는 html 만
    expect(r.body).toContain("harness-ui app shell");
  });

  it("① GET /assets/app.css → 200·text/css", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/assets/app.css", headers: { host: HOST } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/css");
  });

  it("② 경로탈출(dist 밖 0): 시크릿 미노출·서빙되면 SPA 셸만(외부 파일 아님)", async () => {
    // URL 파서가 `..` 를 루트로 clamp → dist 하위로 해석(escape 불가). 미존재 경로는 SPA fallback(index.html).
    // 핵심 불변식: **dist 밖 파일(TOP SECRET) 은 절대 서빙 0**. %2f 인코딩 세그먼트는 isSafeSegment 거부.
    const { app } = gated();
    for (const url of ["/../../etc/passwd", "/..%2f..%2fetc%2fpasswd", "/assets/../../secret.txt", "/%2e%2e/secret.txt"]) {
      const r = await app.inject({ method: "GET", url, headers: { host: HOST } });
      expect(r.body).not.toContain("TOP SECRET");        // dist 밖 escape 0
      if (r.statusCode === 200) expect(r.body).toContain('id="app"'); // 서빙되면 SPA 셸 fallback 뿐
    }
  });

  it("② 심링크 leaf escape(/assets/evil.js) → 차단(O_NOFOLLOW·not-200·시크릿 미노출)", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/assets/evil.js", headers: { host: HOST } });
    expect(r.body).not.toContain("TOP SECRET"); // 심링크 따라가 외부 시크릿 서빙 0
    expect(r.statusCode).not.toBe(200);          // /assets/ 는 SPA fallback 안 함 → 순수 차단
  });

  it("② 심링크 dir escape(/leakdir/secret.txt) → 시크릿 미노출", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/leakdir/secret.txt", headers: { host: HOST } });
    expect(r.body).not.toContain("TOP SECRET"); // 중간 세그먼트 심링크 lstat 거부(SPA fallback 가능하나 시크릿 0)
  });

  it("③ /api/* 토큰 없으면 401(정적 서빙이 API 게이트 안 깸)", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/api/harness", headers: { host: HOST } });
    expect(r.statusCode).toBe(401);
  });

  it("③ mutating cross-origin POST → 403(Origin 게이트 유지)", async () => {
    const { app, sec } = gated();
    const r = await app.inject({
      method: "POST", url: "/api/drift/sync-plan",
      headers: { host: HOST, origin: "http://evil.com", authorization: `Bearer ${sec.session}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("④ 정적 bad Host → 403(DNS rebinding 심층방어)", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/", headers: { host: "evil.com" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("bad-host");
  });

  it("④ localhost·127.0.0.1·[::1] Host 허용", async () => {
    const { app } = gated();
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]) {
      const r = await app.inject({ method: "GET", url: "/", headers: { host } });
      expect(r.statusCode).toBe(200);
    }
  });

  it("⑥ SPA fallback: 미매칭 GET(deep-path) → index.html(200)", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/some/deep/route", headers: { host: HOST } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.body).toContain('id="app"');
  });

  it("⑥ /assets/ 미존재 → 404(index.html 오배달 금지)", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "GET", url: "/assets/missing.js", headers: { host: HOST } });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('id="app"');
  });

  it("정적 POST(쓰기) → 404(정적 자원 mutating 없음)", async () => {
    const { app } = gated();
    const r = await app.inject({ method: "POST", url: "/index.html", headers: { host: HOST } });
    expect(r.statusCode).toBe(404);
  });

  // ⑦ SPA fallback 이 게이트-라우터 정규화 갭으로 API 를 우회시키지 않음(외부/내부 감사 수렴 회귀 테스트).
  //   불변식: 어떤 벡터도 (a) 실제 API JSON/시크릿 노출 0, (b) mutating(POST/DELETE) 핸들러 미도달.
  //   200 응답은 전부 공개 HTML 셸(id="app") 이어야 한다.
  it("⑦ authority-form/대문자/이중디코딩 GET → API 데이터 0(200이면 셸만)", async () => {
    const { app } = gated();
    for (const url of ["//api/harness", "//api/settings", "/API/harness", "/api/%2e%2e/settings", "/%2561pi/harness"]) {
      const r = await app.inject({ method: "GET", url, headers: { host: HOST } });
      // API 핸들러 미도달: harness 목록/settings JSON 의 표식이 본문에 없어야 한다.
      expect(r.body).not.toContain('"harnessDir"');
      expect(r.body).not.toContain('"projectRoot"');
      if (r.statusCode === 200) expect(r.body).toContain('id="app"'); // 서빙되면 공개 셸만
    }
  });

  it("⑦ authority-form mutating(POST/DELETE) → API 핸들러 미도달·mutation 0", async () => {
    const { app, sec } = gated();
    // 세션 토큰을 실어도 authority-form 은 API 라우트에 매칭되지 않아 404(핸들러 미도달) — 게이트 우회 후 mutation 불가.
    const vectors: Array<{ method: "POST" | "DELETE"; url: string }> = [
      { method: "POST", url: "//api/settings/project-root" },
      { method: "POST", url: "//api/drift/sync-plan" },
      { method: "POST", url: "//api/auth/exchange" },
      { method: "DELETE", url: "//api/runs/x/cancel" },
    ];
    for (const v of vectors) {
      const r = await app.inject({
        method: v.method, url: v.url,
        headers: { host: HOST, origin: ORIGIN, authorization: `Bearer ${sec.session}` },
      });
      expect(r.statusCode).toBe(404); // 라우트 미매칭 = 핸들러 미도달(성공 200/유효 mutation 아님)
    }
  });
});

describe("⑤ start.ts open argv(shell 없음·argv·fragment 토큰)", () => {
  it("buildOpenCommand: OS별 execFile argv 구성 — shell 문자열 없음", () => {
    const url = "http://127.0.0.1:5174/#deadbeef";
    const { cmd, args } = buildOpenCommand(url);
    expect(args).toEqual(openArgs(url).args); // launcher.openArgs 재사용(발명 금지)
    expect(cmd).not.toContain(" "); // 단일 실행파일(shell 파이프/공백 명령 금지)
    // fragment(#토큰) 이 인자로 그대로 전달(쿼리 아님·서버 미전송)
    expect(args.some((a) => a.includes("#deadbeef"))).toBe(true);
    // shell 메타(;·|·&·$()·백틱) 가 인자 아닌 명령으로 들어가지 않음
    for (const a of [cmd]) expect(/[;|&`$]/.test(a)).toBe(false);
  });

  it("buildOpenCommand: 비-로컬 URL 거부(127.0.0.1 아님)", () => {
    expect(() => buildOpenCommand("http://evil.com/#tok")).toThrow();
    expect(() => buildOpenCommand("https://127.0.0.1:5174/#tok")).toThrow(); // http 만
  });

  it("buildOpenCommand: fragment 에 cmd/shell 메타문자 거부(win32 cmd.exe 심층방어)", () => {
    // new URL 은 fragment 의 &·| 를 통과시키므로 buildOpenCommand 가 직접 거부해야 한다.
    for (const bad of ["#&calc", "#|whoami", "#a>b", "#a<b", "#a^b", '#a"b', "#a$x", "#a;b", "#a`b`"]) {
      expect(() => buildOpenCommand(`http://127.0.0.1:5174/${bad}`)).toThrow();
    }
    // 정상 hex 토큰은 통과(회귀 방지 — 과잉거부 아님)
    expect(() => buildOpenCommand("http://127.0.0.1:5174/#0123abcdef456789")).not.toThrow();
  });

  it("bootstrapUrl: fragment(#) 에 토큰(쿼리/경로 미노출)", () => {
    const url = bootstrapUrl(5174, "sekret-token");
    expect(url.split("#")[1]).toBe(encodeURIComponent("sekret-token"));
    expect(url.split("#")[0]).toBe("http://127.0.0.1:5174/"); // fragment 앞엔 토큰 없음
  });

  it("baseUrl: stdout 용 base 는 토큰 미포함", () => {
    expect(baseUrl(5174)).toBe("http://127.0.0.1:5174/");
    expect(baseUrl(5174)).not.toContain("#");
  });

  it("openBrowser: spawn 은 execFile argv 로만 호출(shell 미사용)·실패해도 throw 안 함", () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const ok = openBrowser("http://127.0.0.1:5174/#tok", (cmd, args) => calls.push({ cmd, args }));
    expect(ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.args.some((a) => a.includes("#tok"))).toBe(true);
    // 비-로컬 URL → spawn 미호출·false(throw 안 함)
    const bad = openBrowser("http://evil.com/#tok", () => calls.push({ cmd: "x", args: [] }));
    expect(bad).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("APP_SHELL_CSP: doc-preview 와 분리(script 'self'·'none' 아님)", () => {
    expect(APP_SHELL_CSP).toContain("script-src 'self'");
    expect(APP_SHELL_CSP).not.toContain("script-src 'none'");
    expect(APP_SHELL_CSP).toContain("frame-ancestors 'none'");
  });
});
