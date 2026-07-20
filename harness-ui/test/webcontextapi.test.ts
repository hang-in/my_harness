// @vitest-environment jsdom
// F10 M15 웹 — context/build API 클라이언트 계약 소비 고정(URL·method·body shape·error 구조 보존·토큰 첨부).
//   경계면 교차: api.ts 훅 shape ↔ 서버 Zod 응답·에러코드 정확 일치·조용한 드롭 0(구조 보존 승격).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CONTEXT_TREE_PATH, contextFilePath, downloadContextFile,
  checkContextEdit, ContextEditError,
  postBuildDraft, postBuildCreate, BuildError,
} from "../src/web/api.js";
import { ApiGetError } from "../src/web/errors.js";

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

describe("경로 빌더 — 서버 계약(GET tree·file·download)", () => {
  it("tree 경로 고정", () => {
    expect(CONTEXT_TREE_PATH).toBe("/api/context/tree");
  });
  it("file 경로 — rel 전체를 단일 ?path= 값으로 인코딩(서버 req.query.path.split('/') 재검증)", () => {
    expect(contextFilePath("CLAUDE.md")).toBe("/api/context/file?path=CLAUDE.md");
    expect(contextFilePath(".claude/agents/a1.md")).toBe("/api/context/file?path=.claude%2Fagents%2Fa1.md");
    expect(contextFilePath(".codex/agents/한 글.toml")).toBe("/api/context/file?path=.codex%2Fagents%2F%ED%95%9C%20%EA%B8%80.toml");
  });
});

describe("downloadContextFile — &download=1·토큰·413 승격", () => {
  it("URL·토큰 첨부(blob 저장 경로)", async () => {
    sessionStorage.setItem(KEY, "sess");
    // jsdom: URL.createObjectURL·a.click 스텁
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); // jsdom 네비게이션 억제
    const blob = new Blob(["x"]);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, blob: async () => blob } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    await downloadContextFile(".claude/agents/a1.md", "a1.md");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/context/file?path=.claude%2Fagents%2Fa1.md&download=1");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sess");
  });
  it("413 → DownloadTooLargeError(size·max 보존)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(413, { size: 99, max: 8 })));
    await expect(downloadContextFile("x", "x")).rejects.toMatchObject({ name: "DownloadTooLargeError", size: 99, max: 8 });
  });
});

describe("checkContextEdit — PUT /api/context/edit(아무것도 안 씀·읽기전용 신호)", () => {
  it("body {path}·PUT·토큰·409 <runtime>-edit-v0.7 구조 보존", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async () => errJson(409, { error: "codex-edit-v0.7", runtime: "codex" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkContextEdit(".codex/agents/cx.toml")).rejects.toMatchObject({ status: 409, code: "codex-edit-v0.7" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/context/edit");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ path: ".codex/agents/cx.toml" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sess");
  });
  it("409 codex/agy·GEMINI·CLAUDE·edit-via-f7 전 신호 코드 보존(ContextEditError)", async () => {
    for (const code of ["codex/agy-edit-v0.7", "agy-edit-v0.7", "context-file-readonly", "edit-via-f7"]) {
      vi.stubGlobal("fetch", vi.fn(async () => errJson(409, { error: code })));
      const e = await checkContextEdit("x").catch((x) => x);
      expect(e).toBeInstanceOf(ContextEditError);
      expect(e.code).toBe(code);
    }
  });
  it("401 → 세션 폐기 + ApiGetError(A84)", async () => {
    sessionStorage.setItem(KEY, "sess");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as unknown as Response)));
    await expect(checkContextEdit("x")).rejects.toBeInstanceOf(ApiGetError);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe("postBuildDraft — POST /api/context/build/draft(디스크 미기록·applied:false)", () => {
  it("body {kind,domain,role}·성공 shape {ok,kind,draft,applied:false} 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const res = { ok: true, kind: "agent", draft: "---\nname: x\n---\n#\n", applied: false };
    const fetchMock = vi.fn(async () => okJson(res));
    vi.stubGlobal("fetch", fetchMock);
    const r = await postBuildDraft({ kind: "agent", domain: "d", role: "r" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/context/build/draft");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ kind: "agent", domain: "d", role: "r" });
    expect(r).toEqual(res);
    expect(r.applied).toBe(false);
  });
  it("403 edit-disabled·429 build-in-progress·429 build-cooldown·502 draft-failed → BuildError 구조 보존", async () => {
    for (const [status, code] of [[403, "edit-disabled"], [429, "build-in-progress"], [429, "build-cooldown"], [502, "draft-failed"]] as [number, string][]) {
      vi.stubGlobal("fetch", vi.fn(async () => errJson(status, { error: code })));
      const e = await postBuildDraft({ kind: "agent", domain: "d", role: "r" }).catch((x) => x);
      expect(e).toBeInstanceOf(BuildError);
      expect(e).toMatchObject({ status, code });
    }
  });
  it("400 bad-input + detail(Zod issues) → detail 보존(조용한 드롭 금지)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errJson(400, { error: "bad-input", detail: [{ path: ["domain"] }] })));
    const e = await postBuildDraft({ kind: "agent", domain: "x".repeat(9999), role: "r" }).catch((x) => x);
    expect(e).toBeInstanceOf(BuildError);
    expect(e.detail).toEqual([{ path: ["domain"] }]);
  });
});

describe("postBuildCreate — POST /api/context/build/create(신규 생성·디스크 기록)", () => {
  it("body {kind,name,content}·성공 shape {ok,created,sourcePath,pathId,newHash} 소비", async () => {
    sessionStorage.setItem(KEY, "sess");
    const res = { ok: true, created: true, sourcePath: ".claude/agents/fresh.md", pathId: "p".repeat(64), newHash: "h".repeat(64) };
    const fetchMock = vi.fn(async () => okJson(res));
    vi.stubGlobal("fetch", fetchMock);
    const r = await postBuildCreate({ kind: "agent", name: "fresh", content: "---\nname: fresh\n---\n#\n" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/context/build/create");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ kind: "agent", name: "fresh", content: "---\nname: fresh\n---\n#\n" });
    expect(r).toEqual(res);
  });
  it("409 name-collision·403 edit-disabled·400 integrity·400 invalid-name → BuildError 구조 보존", async () => {
    for (const [status, code] of [[409, "name-collision"], [403, "edit-disabled"], [400, "integrity"], [400, "invalid-name"]] as [number, string][]) {
      vi.stubGlobal("fetch", vi.fn(async () => errJson(status, { error: code })));
      const e = await postBuildCreate({ kind: "agent", name: "x", content: "c" }).catch((x) => x);
      expect(e).toBeInstanceOf(BuildError);
      expect(e).toMatchObject({ status, code });
    }
  });
});
