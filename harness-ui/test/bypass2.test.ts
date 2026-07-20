import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server/index.js";
import { makeSecurity } from "../src/server/security.js";
describe("auth-bypass 추가 벡터 실증", () => {
  const sec = makeSecurity(5174); const app = buildServer({ security: sec }); const H = "127.0.0.1:5174";
  const cases: Array<[string,string]> = [
    ["GET","//api/harness"], ["GET","/%2f/api/harness"], ["GET","/api/%2e%2e/settings"],
    ["GET","\\api\\harness"], ["OPTIONS","/api/harness"], ["HEAD","/api/harness"],
    ["GET","/api/harness/"], ["GET","/api/harness%00"], ["GET","/./api/harness"],
  ];
  for (const [method,url] of cases) {
    it(`${method} ${url} no-token → API 데이터 미노출`, async () => {
      const r = await app.inject({ method: method as any, url, headers: { host: H } });
      console.log(method, url, "→", r.statusCode);
      // 단일 오리진 정적 서빙 도입 후: 미매칭 GET 은 공개 SPA 셸(text/html)로 fallback(200).
      // 불변식 = unauth 는 인증 API JSON 데이터를 못 받는다. 200 은 셸(HTML)뿐 — API 라우트 도달 = 우회.
      if (r.statusCode === 200) {
        expect(String(r.headers["content-type"] ?? "")).toContain("text/html");
        expect(r.body).toContain('id="app"');
      }
    });
  }
});
