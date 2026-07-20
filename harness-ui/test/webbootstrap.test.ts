// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapSession } from "../src/web/api.js";
import { focusRunFromHash } from "../src/web/agent-run.js";

// M10 F2 회귀(codex R1 LOW·딥링크 hash 충돌):
// bootstrapSession 이 router hash(`#/...`)를 bootstrap 토큰으로 오소비하지 않음 → 새 탭/리로드서 run focus 보존.
// 런처 fragment 토큰은 `#<hex>`(`#/` 아님)만 교환. 기존 딥링크 왕복(focusRunFromHash) 회귀 유지.

const KEY = "harness-session";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("bootstrapSession — router hash vs bootstrap 토큰 구분", () => {
  it("(a) router 딥링크 `#/runs?run=X` 를 토큰으로 소비하지 않음(fetch 미호출·hash 보존)", async () => {
    sessionStorage.setItem(KEY, "cached-sess");
    window.history.replaceState(null, "", "/#/runs?run=build-2026-1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const s = await bootstrapSession();

    expect(fetchMock).not.toHaveBeenCalled();       // router hash → 교환 시도 없음
    expect(location.hash).toBe("#/runs?run=build-2026-1"); // hash 보존(strip 안 함)
    expect(s).toBe("cached-sess");                   // 캐시 세션 사용
  });

  it("(b) 새 탭/리로드 시뮬레이션 — bootstrap 후에도 run focus 보존", async () => {
    sessionStorage.setItem(KEY, "cached-sess");
    window.history.replaceState(null, "", "/#/runs?run=build-2026.07.09_a");
    vi.stubGlobal("fetch", vi.fn());

    await bootstrapSession();

    // 라우터 hash 가 살아 있으므로 Runs 화면이 focus 를 복원할 수 있음
    expect(focusRunFromHash(location.hash)).toBe("build-2026.07.09_a");
  });

  it("런처 fragment 토큰 `#<hex>` 는 교환·strip(기존 동작 유지)", async () => {
    const token = "a".repeat(64); // randomBytes(32).toString('hex')
    window.history.replaceState(null, "", `/#${token}`);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ session: "new-sess" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const s = await bootstrapSession();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).bootstrap).toBe(token); // 토큰만 교환
    expect(location.hash).toBe("");                               // 토큰 strip(주소창 노출 방지)
    expect(s).toBe("new-sess");
    expect(sessionStorage.getItem(KEY)).toBe("new-sess");
  });

  it("hash 없음 → 캐시 세션 사용(fetch 미호출)", async () => {
    sessionStorage.setItem(KEY, "cached2");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const s = await bootstrapSession();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(s).toBe("cached2");
  });
});
