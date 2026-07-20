// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitRun, RunSubmitError, ApiGetError } from "../src/web/api.js";
import { readErrorText, statusErrorText } from "../src/web/errors.js";
import { runSubmitErrorText } from "../src/web/agent-run.js";

// MED(Build 401) — 제출 401 이 "네트워크 오류"로 오표시되던 회귀 수정.
// 401 은 구조 보존(ApiGetError) 으로 승격 → readErrorText 가 세션 만료·재로그인 동선(A84)으로 매핑.
// 400/409 는 기존대로 RunSubmitError → runSubmitErrorText 유지.

const KEY = "harness-session";
const mkRes = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("submitRun 에러 승격 — 401 재인증 vs 400/409 인라인", () => {
  it("401 → ApiGetError(401) 승격(평문 Error 아님)·세션 폐기", () => {
    sessionStorage.setItem(KEY, "stale-sess");
    vi.stubGlobal("fetch", vi.fn(async () => mkRes(401, {})));
    return submitRun({ any: true }).then(
      () => { throw new Error("반드시 throw 해야 함"); },
      (e) => {
        expect(e).toBeInstanceOf(ApiGetError);
        expect((e as ApiGetError).status).toBe(401);
        expect(sessionStorage.getItem(KEY)).toBeNull(); // stale 세션 폐기
      },
    );
  });

  it("401 → readErrorText 가 재인증(세션 만료·재접속) 문구로 매핑(네트워크 아님)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mkRes(401, {})));
    try {
      await submitRun({ any: true });
      throw new Error("unreachable");
    } catch (e) {
      const msg = readErrorText(e);
      expect(msg).toBe(statusErrorText(401));
      expect(msg).toContain("세션");
      expect(msg).toContain("링크");
      expect(msg).not.toContain("네트워크"); // ★ 회귀: 401 이 네트워크 오류로 오표시되지 않음
    }
  });

  it("400 unauthorized-tool → RunSubmitError 보존(runSubmitErrorText 유지)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mkRes(400, { error: "unauthorized-tool", detail: ["Bash"] })));
    try {
      await submitRun({ any: true });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(RunSubmitError);
      const re = e as RunSubmitError;
      expect(re.status).toBe(400);
      expect(runSubmitErrorText(re.status, re.code, re.detail)).toContain("선언되지 않은 도구");
    }
  });

  it("409 agent-definition-changed → RunSubmitError 보존", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mkRes(409, { error: "agent-definition-changed" })));
    try {
      await submitRun({ any: true });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(RunSubmitError);
      expect((e as RunSubmitError).status).toBe(409);
    }
  });
});
