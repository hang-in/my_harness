import { describe, it, expect } from "vitest";
import { nextConn, showsReconnecting, backoffMs, type ConnPhase } from "../src/web/connection.js";

// A94 전역 재연결 상태머신 — 순수 로직 고정(offline→health-up→ready·401→reauth·백오프).

describe("nextConn — 재연결 상태머신(A94)", () => {
  const phases: ConnPhase[] = ["ready", "offline", "health-up", "reauth"];

  it("healthz 실패 → offline(재시작·종료·네트워크 끊김)", () => {
    for (const p of phases) expect(nextConn(p, { healthOk: false })).toBe("offline");
  });

  it("health up + 인증 확립 → ready(자동 복귀)", () => {
    for (const p of phases) expect(nextConn(p, { healthOk: true, authOk: true })).toBe("ready");
  });

  it("health up 인데 401 → reauth(재연결에 갇히지 않고 A84 재인증·W-C3)", () => {
    expect(nextConn("offline", { healthOk: true, authOk: false, status: 401 })).toBe("reauth");
    expect(nextConn("health-up", { healthOk: true, authOk: false, status: 401 })).toBe("reauth");
  });

  it("health up 인데 비401 실패 → health-up 유지(bootstrap 재확립 중·W-C2·401 갭 정정)", () => {
    expect(nextConn("offline", { healthOk: true, authOk: false, status: 503 })).toBe("health-up");
    expect(nextConn("ready", { healthOk: true, authOk: false, status: 500 })).toBe("health-up");
  });
});

describe("showsReconnecting — 오버레이 노출(W-C)", () => {
  it("offline·health-up 만 재연결 오버레이 노출", () => {
    expect(showsReconnecting("offline")).toBe(true);
    expect(showsReconnecting("health-up")).toBe(true);
  });
  it("ready·reauth 는 재연결 오버레이 미노출(reauth 는 별도 재인증 UI)", () => {
    expect(showsReconnecting("ready")).toBe(false);
    expect(showsReconnecting("reauth")).toBe(false);
  });
});

describe("backoffMs — 지수 백오프 상한(폭주 방지)", () => {
  it("0.5s → 1s → 2s … 단조 증가", () => {
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
  });
  it("30s 상한(무한 증가 없음)", () => {
    expect(backoffMs(100)).toBe(30_000);
    expect(backoffMs(6)).toBe(30_000); // 500*64=32000 → cap
  });
  it("음수 방어 → attempt 0 취급", () => {
    expect(backoffMs(-5)).toBe(500);
  });
});
