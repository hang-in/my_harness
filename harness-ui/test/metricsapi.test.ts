import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server/index.js";

// F6 metrics 라우트(M9 S10/S11) — 실제 레포 root 기준. 빈/손상 무관하게 200 + 안전 shape.
describe("GET /api/metrics/{overview,agents,skills}", () => {
  const app = buildServer();

  it("overview 200 + per-value confidence shape", async () => {
    const r = await app.inject({ url: "/api/metrics/overview" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.schemaVersion).toBe("1");
    expect(typeof b.runCount).toBe("number");
    // per-value confidence(응답 단일 confidence 금지): 각 지표가 자기 confidence 동반
    for (const k of ["successRate", "failureRate", "avgDurationMs", "reworkRate", "reviewConvergence", "totalTokens"]) {
      expect(["measured", "estimated", "unattributed"]).toContain(b[k].confidence);
      expect(b[k]).toHaveProperty("value");
    }
    expect(b).not.toHaveProperty("confidence"); // 최상위 단일 confidence 없음
    expect(b.coverage).toHaveProperty("truncatedReason");
    expect(b.coverage).toHaveProperty("scannedRuns");
  });

  it("agents 200 + array + coverage", async () => {
    const r = await app.inject({ url: "/api/metrics/agents" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.schemaVersion).toBe("1");
    expect(Array.isArray(b.agents)).toBe(true);
    expect(Array.isArray(b.unusedInWindow)).toBe(true);
    expect(b.coverage).toBeTruthy();
  });

  it("skills 200 + array + coverage", async () => {
    const r = await app.inject({ url: "/api/metrics/skills" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(Array.isArray(b.skills)).toBe(true);
    expect(Array.isArray(b.unusedInWindow)).toBe(true);
  });

  it("잘못된 window(clamp/폴백) — 400 아님(200 안전 폴백)", async () => {
    expect((await app.inject({ url: "/api/metrics/overview?limit=abc" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/metrics/overview?limit=999999" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/metrics/overview?from=notdate" })).statusCode).toBe(200);
  });
});
