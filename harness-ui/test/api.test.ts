import { describe, it, expect } from "vitest";
import { buildServer, projectRoot } from "../src/server/index.js";

describe("api (M1) — 실제 하네스 레포 기준", () => {
  const app = buildServer();

  it("A1: server builds + /api/health", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
  });

  it("A3api: /api/harness returns agents/skills counts", async () => {
    const r = await app.inject({ method: "GET", url: "/api/harness" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.projectRoot).toBe(projectRoot);
    // `.claude/` 는 gitignored — clean checkout(CI)엔 부재. 존재할 때(로컬 dev)만 카운트≥1 검증.
    if (b.claude.agents === 0 && b.claude.skills === 0) return;
    // 이 레포 = myHarness 팩토리: claude 에이전트≥1, 스킬≥1
    expect(b.claude.agents).toBeGreaterThanOrEqual(1);
    expect(b.claude.skills).toBeGreaterThanOrEqual(1);
  });

  it("A5be: /api/runs safe when empty/absent", async () => {
    const r = await app.inject({ method: "GET", url: "/api/runs" });
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json().runs)).toBe(true);
  });

  it("agents/skills lists + invalid name 400", async () => {
    expect((await app.inject({ url: "/api/agents" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/skills" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/agents/..%2fetc" })).statusCode).toBeGreaterThanOrEqual(400);
  });

  // T-S5 [라우트 분기] — 무인자=listRuns {runs} 계약 불변 · 인자=queryRuns {items,...} · 검증 실패 400
  it("T-S5: 무인자 GET /api/runs → {runs} 계약 불변(A47 하위호환)", async () => {
    const r = await app.inject({ url: "/api/runs" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(Array.isArray(b.runs)).toBe(true);
    expect(b.items).toBeUndefined(); // 무인자 = 신규 shape 아님
  });
  it("T-S5: 인자 GET /api/runs?limit=5 → {items,total,...} 신규 shape", async () => {
    const r = await app.inject({ url: "/api/runs?limit=5&sort=recordedAt&order=desc" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(Array.isArray(b.items)).toBe(true);
    expect(typeof b.total).toBe("number");
    expect(b.limit).toBe(5);
    expect(b.schemaVersion).toBe("1");
    expect(b.truncatedReason === null || typeof b.truncatedReason === "string").toBe(true);
    expect(b.runs).toBeUndefined();
  });
  it("T-S5: RunsQuery 검증 실패 → 400", async () => {
    expect((await app.inject({ url: "/api/runs?state=bogus" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/runs?sort=xxx" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/runs?from=notdate" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/runs?agent=..%2Fx" })).statusCode).toBe(400);
  });
  it("T-S5: clamp 파라미터는 400 아님(200)", async () => {
    const r = await app.inject({ url: "/api/runs?limit=99999&offset=-5" });
    expect(r.statusCode).toBe(200);
    expect(r.json().limit).toBe(100);
    expect(r.json().offset).toBe(0);
  });
});
