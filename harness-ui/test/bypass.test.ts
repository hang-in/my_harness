import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server/index.js";
import { makeSecurity } from "../src/server/security.js";
describe("auth-bypass 회귀 (인코딩·authority-form)", () => {
  const sec = makeSecurity(5174); const app = buildServer({ security: sec }); const H = "127.0.0.1:5174";
  const urls = ["/api/harness", "/%61pi/harness", "/API/harness", "/api//harness",
    "http://127.0.0.1:5174/api/harness", "http://evil.com/api/harness", "/%2561pi/harness"];
  for (const url of urls) {
    it(`no-token ${url} → API 데이터 미노출`, async () => {
      const r = await app.inject({ method: "GET", url, headers: { host: H } });
      console.log(url, "→", r.statusCode);
      // 단일 오리진 정적 서빙 도입 후: 미매칭 GET 은 **공개 SPA 셸(text/html)** 로 fallback(200).
      // 불변식은 "unauth 가 인증 API JSON 데이터를 못 받는다" — 200 은 셸(HTML)뿐, API 라우트 도달 = 우회.
      if (r.statusCode === 200) {
        expect(String(r.headers["content-type"] ?? "")).toContain("text/html");
        expect(r.body).toContain('id="app"'); // 공개 SPA 셸(API JSON 아님)
      }
    });
  }
});
