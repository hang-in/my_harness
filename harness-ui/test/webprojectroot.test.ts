// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { postProjectRoot, ProjectRootError, cancelActiveRuns, probeConnection } from "../src/web/api.js";

// F3 M11 웹 — 서버 확정 계약 소비 고정(body shape·error 코드 구조 보존·cancel 경로 재사용·healthz 프로브).
// shape 회귀 방지: 클라가 임의 shape 가정 금지 — server-builder Zod 응답과 정확히 일치.

const KEY = "harness-session";

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("postProjectRoot — POST /api/settings/project-root 계약(A71·A101)", () => {
  it("dryRun:true → body {path,dryRun:true}·프리뷰(written:false) 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, effectiveRoot: "/ph/app", activeRunsWarning: 0, requiresRestart: true, written: false }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const r = await postProjectRoot("/ph/app", true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/settings/project-root");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ path: "/ph/app", dryRun: true });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sess"); // 토큰 첨부
    expect("ok" in r && r.written).toBe(false);
  });

  it("dryRun:false → 저장 응답(accepted·appliedAt) 소비", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ accepted: true, requiresRestart: true, effectiveRoot: "/ph/app", appliedAt: "2026-07-10T00:00:00Z", activeRunsWarning: 0 }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const r = await postProjectRoot("/ph/app", false);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).dryRun).toBe(false);
    expect("accepted" in r && r.accepted).toBe(true);
  });

  it("400 → ProjectRootError(error 코드 구조 보존·조용한 드롭 아님)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: "outside-projects-home" }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(postProjectRoot("/etc", true)).rejects.toMatchObject({ status: 400, code: "outside-projects-home" });
    await expect(postProjectRoot("/etc", true)).rejects.toBeInstanceOf(ProjectRootError);
  });

  it("409 boundary-not-provisioned → ProjectRootError 승격", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 409, json: async () => ({ error: "boundary-not-provisioned" }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(postProjectRoot("/x", true)).rejects.toMatchObject({ status: 409, code: "boundary-not-provisioned" });
  });
});

describe("cancelActiveRuns — A99 (a) cancel 경로 재사용(POST /api/runs/:id/cancel)", () => {
  it("running run 조회 후 각각 취소", async () => {
    sessionStorage.setItem(KEY, "sess");
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("/api/runs?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ runId: "r1", state: "running" }, { runId: "r2", state: "running" }] }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await cancelActiveRuns();
    expect(out).toEqual({ attempted: 2, cancelled: 2 });
    expect(calls).toContain("POST /api/runs/r1/cancel");
    expect(calls).toContain("POST /api/runs/r2/cancel");
  });

  it("개별 취소 실패 격리 — attempted 유지·cancelled 만 감소(A83)", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/runs?")) return { ok: true, status: 200, json: async () => ({ items: [{ runId: "r1", state: "running" }] }) } as unknown as Response;
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response; // cancel 실패
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await cancelActiveRuns();
    expect(out).toEqual({ attempted: 1, cancelled: 0 });
  });
});

describe("probeConnection — A94 healthz + 인증 GET 프로브", () => {
  it("healthz 실패 → { healthOk:false }(offline)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Failed to fetch"); }));
    expect(await probeConnection()).toEqual({ healthOk: false });
  });

  it("healthz up + 세션 없음 → { healthOk:true, authOk:false, status:401 }(재인증 동선)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeConnection()).toEqual({ healthOk: true, authOk: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 세션 없으면 인증 GET 스킵
  });

  it("healthz up + 인증 GET 200 → { healthOk:true, authOk:true }(ready)", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/healthz") return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({ projectRoot: "/x" }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeConnection()).toEqual({ healthOk: true, authOk: true });
  });

  it("healthz up + 인증 GET 401 → { healthOk:true, authOk:false, status:401 }(reauth)", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/healthz") return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
      return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeConnection()).toEqual({ healthOk: true, authOk: false, status: 401 });
  });
});
