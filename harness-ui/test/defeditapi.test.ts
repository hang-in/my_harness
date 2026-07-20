// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDefinition, putDefinition, rollbackDefinition, setDefinitionEdit, DefEditError,
} from "../src/web/api.js";

// F7 M12 웹 — 서버 확정 계약 소비 고정(URL·method·body shape·error 구조 보존·토큰 첨부).
// shape 회귀 방지: 클라가 임의 shape 가정 금지 — server-builder Zod 응답과 정확히 일치.

const KEY = "harness-session";

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function okJson(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function errJson(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

describe("getDefinition — GET /api/{seg}/:name/definition(A72)", () => {
  it("agent → URL·토큰·응답 shape 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const doc = { name: "a1", sourcePath: ".claude/agents/a1.md", pathId: "p".repeat(64), content: "x", baseHash: "b".repeat(64), mtimeMs: 1, editable: true };
    const fetchMock = vi.fn(async () => okJson(doc));
    vi.stubGlobal("fetch", fetchMock);

    const r = await getDefinition("agent", "a1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agents/a1/definition");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sess");
    expect(r).toEqual(doc);
  });

  it("skill → seg=skills·name 인코딩", async () => {
    const fetchMock = vi.fn(async () => okJson({ name: "s x", sourcePath: "", pathId: "", content: "", baseHash: "", mtimeMs: 0, editable: false }));
    vi.stubGlobal("fetch", fetchMock);
    await getDefinition("skill", "s x");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/skills/s%20x/definition");
  });

  it("409 ambiguous-definition → DefEditError(구조 보존)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(409, { error: "ambiguous-definition" })));
    await expect(getDefinition("skill", "dup")).rejects.toMatchObject({ status: 409, code: "ambiguous-definition" });
    vi.stubGlobal("fetch", vi.fn(async () => errJson(409, { error: "ambiguous-definition" })));
    await expect(getDefinition("skill", "dup")).rejects.toBeInstanceOf(DefEditError);
  });

  it("404 not-found → DefEditError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(404, { error: "not-found" })));
    await expect(getDefinition("agent", "nope")).rejects.toMatchObject({ status: 404, code: "not-found" });
  });
});

describe("putDefinition — PUT …/definition(A76·A80)", () => {
  it("body {content,baseHash,pathId}·PUT·토큰·성공 응답(codexDriftWarning) 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const res = { ok: true, prevHash: "P".repeat(64), newHash: "N".repeat(64), pathId: "p".repeat(64), sourcePath: ".claude/agents/a.md", codexDriftWarning: true };
    const fetchMock = vi.fn(async () => okJson(res));
    vi.stubGlobal("fetch", fetchMock);

    const r = await putDefinition("agent", "a", { content: "new", baseHash: "b".repeat(64), pathId: "p".repeat(64) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agents/a/definition");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ content: "new", baseHash: "b".repeat(64), pathId: "p".repeat(64) });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(r.codexDriftWarning).toBe(true);
  });

  it("409 stale-write → DefEditError.currentHash 보존(A93 병합 뷰용)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(409, { error: "stale-write", currentHash: "C".repeat(64) })));
    const err = await putDefinition("agent", "a", { content: "x", baseHash: "b".repeat(64), pathId: "p".repeat(64) }).catch((e) => e);
    expect(err).toBeInstanceOf(DefEditError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("stale-write");
    expect(err.currentHash).toBe("C".repeat(64));
  });

  it("400 integrity → DefEditError.detail(세부코드) 보존", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(400, { error: "integrity", detail: "field:name" })));
    const err = await putDefinition("skill", "s", { content: "x", baseHash: "b".repeat(64), pathId: "p".repeat(64) }).catch((e) => e);
    expect(err.code).toBe("integrity");
    expect(err.detail).toBe("field:name");
  });

  it("403 edit-disabled → DefEditError(게이트 off)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(403, { error: "edit-disabled" })));
    await expect(putDefinition("agent", "a", { content: "x", baseHash: "b".repeat(64), pathId: "p".repeat(64) }))
      .rejects.toMatchObject({ status: 403, code: "edit-disabled" });
  });
});

describe("rollbackDefinition — POST …/rollback(A77)", () => {
  it("body {expectedCurrentHash,backupHash}·POST·성공 응답 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const res = { ok: true, prevHash: "P".repeat(64), restoredHash: "R".repeat(64), pathId: "p".repeat(64) };
    const fetchMock = vi.fn(async () => okJson(res));
    vi.stubGlobal("fetch", fetchMock);

    const r = await rollbackDefinition("skill", "s", { expectedCurrentHash: "N".repeat(64), backupHash: "P".repeat(64) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/skills/s/definition/rollback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ expectedCurrentHash: "N".repeat(64), backupHash: "P".repeat(64) });
    expect(r.restoredHash).toBe("R".repeat(64));
  });

  it("409 stale-rollback → DefEditError.currentHash 보존", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(409, { error: "stale-rollback", currentHash: "C".repeat(64) })));
    const err = await rollbackDefinition("agent", "a", { expectedCurrentHash: "x".repeat(64), backupHash: "y".repeat(64) }).catch((e) => e);
    expect(err.code).toBe("stale-rollback");
    expect(err.currentHash).toBe("C".repeat(64));
  });

  it("404 no-backup → DefEditError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(404, { error: "no-backup" })));
    await expect(rollbackDefinition("agent", "a", { expectedCurrentHash: "x".repeat(64), backupHash: "y".repeat(64) }))
      .rejects.toMatchObject({ status: 404, code: "no-backup" });
  });
});

describe("setDefinitionEdit — POST /api/settings/definition-edit(A78)", () => {
  it("body {enabled}·POST·응답 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async () => okJson({ ok: true, definitionEditEnabled: true }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await setDefinitionEdit(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/settings/definition-edit");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: true });
    expect(r.definitionEditEnabled).toBe(true);
  });

  it("400 bad-input → DefEditError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(400, { error: "bad-input" })));
    await expect(setDefinitionEdit(true)).rejects.toMatchObject({ status: 400, code: "bad-input" });
  });
});

describe("401 처리 — 세션 폐기 + 재접속 안내(무한 401 방지)", () => {
  it("getDefinition 401 → 세션 clear·에러 throw", async () => {
    sessionStorage.setItem(KEY, "sess");
    vi.stubGlobal("fetch", vi.fn(async () => errJson(401, {})));
    await expect(getDefinition("agent", "a")).rejects.toThrow("401");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
