import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server/index.js";
import { makeSecurity, deniedPath } from "../src/server/security.js";

const PORT = 5174;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function server() {
  const sec = makeSecurity(PORT);
  const app = buildServer({ security: sec });
  return { app, sec };
}

describe("보안 미들웨어 (§5b)", () => {
  it("A11: token 없는 GET 거부(401)", async () => {
    const { app } = server();
    const r = await app.inject({ method: "GET", url: "/api/harness", headers: { host: HOST } });
    expect(r.statusCode).toBe(401);
  });
  it("A11: Host allowlist 벗어나면 403", async () => {
    const { app, sec } = server();
    const r = await app.inject({ method: "GET", url: "/api/harness", headers: { host: "evil.com", authorization: `Bearer ${sec.session}` } });
    expect(r.statusCode).toBe(403);
  });
  it("A12: bootstrap→session 교환 후 접근, **동일 bootstrap 재사용 불가**(rotate)", async () => {
    const { app, sec } = server();
    const b1 = sec.bootstrap; // 최초 bootstrap 포착(교환 후 rotate 되므로)
    const ex = await app.inject({ method: "POST", url: "/api/auth/exchange", headers: { host: HOST, origin: ORIGIN }, payload: { bootstrap: b1 } });
    expect(ex.statusCode).toBe(200);
    const session = ex.json().session;
    const ok = await app.inject({ method: "GET", url: "/api/harness", headers: { host: HOST, authorization: `Bearer ${session}` } });
    expect(ok.statusCode).toBe(200);
    // 최초 bootstrap(b1) 재사용 → 401(single-use·rotate 후 무효)
    const again = await app.inject({ method: "POST", url: "/api/auth/exchange", headers: { host: HOST, origin: ORIGIN }, payload: { bootstrap: b1 } });
    expect(again.statusCode).toBe(401);
  });
  it("A10: state-mutating cross-origin POST 거부(Origin)", async () => {
    const { app, sec } = server();
    const r = await app.inject({ method: "POST", url: "/api/drift/sync-plan", headers: { host: HOST, origin: "http://evil.com", authorization: `Bearer ${sec.session}` } });
    expect(r.statusCode).toBe(403);
  });
  it("denylist: dotfile·토큰·레지스트리 경로 차단", () => {
    expect(deniedPath(".ui-session-token")).toBe(true);
    expect(deniedPath("a/.secret")).toBe(true);
    expect(deniedPath("registry/x.owner.json")).toBe(true);
    expect(deniedPath("normal/file.md")).toBe(false);
  });
});
