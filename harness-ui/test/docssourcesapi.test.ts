// M14 F9 A116/A117/A118 — 소스 인지 API + docsTree base 파라미터화 + DS7 TOCTOU 재검증 + I8 회귀.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, mkdir, writeFile, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApi } from "../src/server/api/index.js";
import { sourceId } from "../src/server/lib/docssources.js";
import { updateConfig, configPath } from "../src/server/lib/config.js";

let root: string, stateDir: string, app: FastifyInstance, symlinkOk = true;
const origState = process.env.HARNESS_STATE_HOME;

async function setSources(sources: { label: string; path: string }[], docsMenuEnabled = true): Promise<void> {
  await updateConfig({ docsSources: sources, docsMenuEnabled });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-f9api-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-f9state-"));
  process.env.HARNESS_STATE_HOME = stateDir;
  await mkdir(join(root, "docs", "sub"), { recursive: true });
  await mkdir(join(root, "documentation"), { recursive: true });
  await writeFile(join(root, "docs", "readme.md"), "# docs readme\n");
  await writeFile(join(root, "docs", "sub", "deep.md"), "# deep\n");
  await writeFile(join(root, "documentation", "guide.md"), "# guide\n");
  await writeFile(join(root, "documentation", ".env"), "SECRET=1"); // denylist(열람 거부 확인)
  // A117 F5 DV 재적용용: XSS 원문·바이너리(널바이트) 소스 하위 파일
  await writeFile(join(root, "documentation", "xss.md"),
    '# x\n\n<script>alert(1)</script>\n[js](javascript:alert(2))\n<img src="https://evil.example/a.png">\n');
  await writeFile(join(root, "documentation", "bin.md"), Buffer.from([0x68, 0x69, 0x00, 0xff, 0xfe]));
  await mkdir(join(root, ".git"), { recursive: true });
  app = Fastify({ logger: false });
  registerApi(app, root);
});
afterAll(async () => {
  await app.close();
  if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});
beforeEach(async () => { await rm(configPath(), { force: true }); }); // 각 테스트 신선 config

describe("A116 — 하위호환(무 source·config 미읽음)", () => {
  it("GET /api/docs (무인자) → 기본 docs 트리 200(레거시)", async () => {
    const r = await app.inject({ url: "/api/docs" });
    expect(r.statusCode).toBe(200);
    expect(r.json().root).toBe("docs");
    expect(JSON.stringify(r.json().tree)).toContain("readme.md");
  });
  it("GET /api/docs/readme.md (무 source) → 200 열람(레거시)", async () => {
    const r = await app.inject({ url: "/api/docs/readme.md" });
    expect(r.statusCode).toBe(200);
    expect(r.json().content).toContain("# docs readme");
  });
});

describe("A116 — GET /api/docs/sources 목록", () => {
  it("기본(무 config) → [{Docs,docs}] valid·enabled true", async () => {
    const r = await app.inject({ url: "/api/docs/sources" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.enabled).toBe(true);
    expect(b.sources).toHaveLength(1);
    expect(b.sources[0]).toMatchObject({ label: "Docs", path: "docs", valid: true, enabled: true });
    expect(b.sources[0].id).toBe(sourceId("docs"));
  });
  it("다중 소스 등록 후 valid 플래그(정상=true·denylist=false)", async () => {
    await setSources([{ label: "Docs", path: "docs" }, { label: "Doc2", path: "documentation" }, { label: "Bad", path: ".git" }]);
    const b = (await app.inject({ url: "/api/docs/sources" })).json();
    const byPath = Object.fromEntries(b.sources.map((s: any) => [s.path, s]));
    expect(byPath["docs"].valid).toBe(true);
    expect(byPath["documentation"].valid).toBe(true);
    expect(byPath[".git"].valid).toBe(false); // DS5
  });
});

describe("A116 — GET /api/docs?source= 소스별 트리", () => {
  it("등록 소스 트리(documentation) → guide.md 노출·docs 파일 없음", async () => {
    await setSources([{ label: "Doc2", path: "documentation" }]);
    const id = sourceId("documentation");
    const b = (await app.inject({ url: `/api/docs?source=${id}` })).json();
    expect(b.root).toBe("documentation");
    expect(b.enabled).toBe(true); // L1 동형 shape: 유효 분기도 enabled 부여
    expect(b).toHaveProperty("count");
    expect(b).toHaveProperty("truncated");
    const s = JSON.stringify(b.tree);
    expect(s).toContain("guide.md");
    expect(s).not.toContain("readme.md"); // docs 소스 파일 미노출(소스 격리)
    expect(s).not.toContain(".env");       // denylist 파일 미노출
  });
  it("미등록 source id → 400 invalid-source", async () => {
    await setSources([{ label: "Docs", path: "docs" }]);
    const r = await app.inject({ url: "/api/docs?source=deadbeefdeadbeef" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("invalid-source");
  });
  it("docsMenuEnabled=false → {enabled:false} 비활성 응답", async () => {
    await setSources([{ label: "Docs", path: "docs" }], false);
    const id = sourceId("docs");
    const b = (await app.inject({ url: `/api/docs?source=${id}` })).json();
    expect(b.enabled).toBe(false);
    expect(b.tree).toEqual([]);
  });
  it("즉시 반영(재시작 불요): config 변경 후 다음 요청에서 새 소스 반영(R1)", async () => {
    await setSources([{ label: "Docs", path: "docs" }]);
    let b = (await app.inject({ url: "/api/docs/sources" })).json();
    expect(b.sources.map((s: any) => s.path)).toEqual(["docs"]);
    await setSources([{ label: "Docs", path: "docs" }, { label: "Doc2", path: "documentation" }]);
    b = (await app.inject({ url: "/api/docs/sources" })).json(); // 같은 app·재시작 없음
    expect(b.sources.map((s: any) => s.path)).toEqual(["docs", "documentation"]);
  });
});

describe("A117 — GET /api/docs/*?source= 소스별 파일 열람(DS7=F5 DV 재적용)", () => {
  it("소스 하위 정상 파일 → 200", async () => {
    await setSources([{ label: "Doc2", path: "documentation" }]);
    const id = sourceId("documentation");
    const r = await app.inject({ url: `/api/docs/guide.md?source=${id}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().content).toContain("# guide");
  });
  it("소스 하위 denylist(.env) → 400", async () => {
    await setSources([{ label: "Doc2", path: "documentation" }]);
    const id = sourceId("documentation");
    const r = await app.inject({ url: `/api/docs/.env?source=${id}` });
    expect(r.statusCode).toBe(400);
  });
  it("소스 하위 traversal(../) → 400(소스 밖 서빙 불가)", async () => {
    await setSources([{ label: "Doc2", path: "documentation" }]);
    const id = sourceId("documentation");
    const r = await app.inject({ url: `/api/docs/..%2Fdocs%2Freadme.md?source=${id}` });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain("docs readme");
  });
  it("미등록 source id 파일 열람 → 400 invalid-source", async () => {
    await setSources([{ label: "Docs", path: "docs" }]);
    const r = await app.inject({ url: "/api/docs/x.md?source=deadbeefdeadbeef" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("invalid-source");
  });
  it("다중 세그먼트 소스(docs/sub) 하위 파일 열람 → 200", async () => {
    await setSources([{ label: "Sub", path: "docs/sub" }]);
    const id = sourceId("docs/sub");
    const r = await app.inject({ url: `/api/docs/deep.md?source=${id}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().content).toContain("# deep");
  });
  it("M2 — XSS md ?source= 열람: 원문 서빙(서버 비실행)·엄격 CSP·nosniff(DV7)", async () => {
    await setSources([{ label: "Doc2", path: "documentation" }]);
    const id = sourceId("documentation");
    const r = await app.inject({ url: `/api/docs/xss.md?source=${id}` });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.content).toContain("<script>alert(1)</script>"); // 원문(sanitize 는 클라)
    expect(b.content).toContain("javascript:");
    expect(r.headers["content-security-policy"]).toContain("script-src 'none'");
    expect(r.headers["content-security-policy"]).toContain("img-src 'self'"); // 원격 img 차단 백스톱
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("M2 — 바이너리(널바이트) ?source= 열람: binary:true·content null·다운로드 attachment(DV6/DV7)", async () => {
    await setSources([{ label: "Doc2", path: "documentation" }]);
    const id = sourceId("documentation");
    const prev = await app.inject({ url: `/api/docs/bin.md?source=${id}` });
    expect(prev.statusCode).toBe(200);
    expect(prev.json().binary).toBe(true);
    expect(prev.json().content).toBeNull();
    const dl = await app.inject({ url: `/api/docs/bin.md?source=${id}&download=1` });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("attachment");
  });
  it("LOW 토글 정합 — docsMenuEnabled=false → 파일 열람도 비활성(404 docs-menu-disabled)", async () => {
    await setSources([{ label: "Doc2", path: "documentation" }], false);
    const id = sourceId("documentation");
    const r = await app.inject({ url: `/api/docs/guide.md?source=${id}` });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe("docs-menu-disabled");
  });
});

describe("A114/A115 — POST /api/settings/docs-sources 검증·병합·상한", () => {
  it("정상 저장 → written·config 반영", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { docsSources: [{ label: "Docs", path: "docs" }, { label: "Doc2", path: "documentation" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().written).toBe(true);
    expect(r.json().docsSources).toHaveLength(2);
  });
  it("무효 경로(절대·denylist) → 400 invalid-source·config 미기록(DS8)", async () => {
    await setSources([{ label: "Docs", path: "docs" }]);
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { docsSources: [{ label: "Bad", path: "/etc" }] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("invalid-source");
    // config 미기록: 기존 docs 소스 유지
    const b = (await app.inject({ url: "/api/docs/sources" })).json();
    expect(b.sources.map((s: any) => s.path)).toEqual(["docs"]);
  });
  it("dryRun → 200·written:false·per-소스 valid 플래그(A119)·디스크 미변경", async () => {
    await setSources([{ label: "Docs", path: "docs" }]);
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { dryRun: true, docsSources: [{ label: "Ok", path: "documentation" }, { label: "Bad", path: "../x" }] },
    });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.written).toBe(false);
    expect(b.sources.find((s: any) => s.path === "documentation").valid).toBe(true);
    expect(b.sources.find((s: any) => s.path === "../x").valid).toBe(false);
    // 디스크 미변경: 여전히 docs
    const cur = (await app.inject({ url: "/api/docs/sources" })).json();
    expect(cur.sources.map((s: any) => s.path)).toEqual(["docs"]);
  });
  it("DS6 개수 초과(17) → 400 bad-input(Zod strict)", async () => {
    const many = Array.from({ length: 17 }, (_, i) => ({ label: `L${i}`, path: `docs${i}` }));
    const r = await app.inject({ method: "POST", url: "/api/settings/docs-sources", payload: { docsSources: many } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("bad-input");
  });
  it("DS6 라벨 길이 초과(>80) → 400 bad-input", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { docsSources: [{ label: "x".repeat(81), path: "docs" }] },
    });
    expect(r.statusCode).toBe(400);
  });
  it("DS6 미지 필드 → 400(strict)", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { docsSources: [{ label: "L", path: "docs" }], evil: 1 },
    });
    expect(r.statusCode).toBe(400);
  });
  it("DS6 중복 경로 병합(첫 등장 유지)", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { docsSources: [{ label: "A", path: "docs" }, { label: "B", path: "docs" }, { label: "C", path: "documentation" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().docsSources).toEqual([{ label: "A", path: "docs" }, { label: "C", path: "documentation" }]);
  });
  it("LOW — lexical-equivalent 경로(docs·./docs·docs//) → 1개 병합·저장 path=canonical docs·동일 sourceId(A115)", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { docsSources: [{ label: "A", path: "docs" }, { label: "B", path: "./docs" }, { label: "C", path: "docs//" }] },
    });
    expect(r.statusCode).toBe(200);
    // 3개가 canonical `docs` 로 흡수 → 1개·저장 path 정규화·첫 라벨 유지
    expect(r.json().docsSources).toEqual([{ label: "A", path: "docs" }]);
    // sourceId 안정: 저장본·목록 모두 sourceId("docs")
    const list = (await app.inject({ url: "/api/docs/sources" })).json();
    expect(list.sources).toHaveLength(1);
    expect(list.sources[0].path).toBe("docs");
    expect(list.sources[0].id).toBe(sourceId("docs"));
    // 정규화된 소스로 트리 조회 가능(하위호환 소스와 동일 id)
    const tree = (await app.inject({ url: `/api/docs?source=${sourceId("docs")}` })).json();
    expect(tree.root).toBe("docs");
    expect(JSON.stringify(tree.tree)).toContain("readme.md");
  });
});

describe("DS7 — 열람 시점 TOCTOU 재검증(등록 후 심링크 스왑)", () => {
  it("등록 후 base 를 out-root 심링크로 스왑 → 트리 리스팅 탈출 차단(빈 트리)·파일 400", async () => {
    if (!symlinkOk) return;
    // 정상 디렉토리 등록·서빙 확인
    const swapDir = join(root, "swapme");
    await mkdir(swapDir, { recursive: true });
    await writeFile(join(swapDir, "in.md"), "# inside\n");
    await setSources([{ label: "Swap", path: "swapme" }]);
    const id = sourceId("swapme");
    expect((await app.inject({ url: `/api/docs?source=${id}` })).json().tree.length).toBeGreaterThan(0);
    // 스왑: swapme → 외부 디렉토리(system-wide 리스팅 시도)
    const outside = await mkdtemp(join(tmpdir(), "hui-f9swap-"));
    await writeFile(join(outside, "SECRET.md"), "LEAK");
    await rm(swapDir, { recursive: true, force: true });
    let swapped = true;
    try { await symlink(outside, swapDir, "dir"); } catch { swapped = false; }
    if (swapped) {
      const tree = (await app.inject({ url: `/api/docs?source=${id}` })).json();
      expect(tree.tree).toEqual([]);                               // 리스팅 탈출 차단(docsTree 진입부 방어)
      const file = await app.inject({ url: `/api/docs/SECRET.md?source=${id}` });
      expect(file.statusCode).toBe(400);                           // 파일 열람 탈출 차단(DS7)
      expect(file.body).not.toContain("LEAK");
    }
    await rm(outside, { recursive: true, force: true });
    await rm(swapDir, { recursive: true, force: true });
  });
});

describe("I8 — 읽기전용 경계 회귀", () => {
  it("열람/트리 라우트는 config 만 쓰고 projectRoot 파일 무변경", async () => {
    const before = (await readdir(root)).sort();
    await setSources([{ label: "Docs", path: "docs" }, { label: "Doc2", path: "documentation" }]);
    await app.inject({ url: "/api/docs/sources" });
    await app.inject({ url: `/api/docs?source=${sourceId("docs")}` });
    await app.inject({ url: `/api/docs/readme.md?source=${sourceId("docs")}` });
    const after = (await readdir(root)).sort();
    expect(after).toEqual(before); // projectRoot 트리 무변경(쓰기 0)
  });
  it("소스 등록이 projectRoot 밖 경로 노출로 새지 않음(절대경로 거부 재확인)", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/settings/docs-sources",
      payload: { docsSources: [{ label: "Esc", path: "/etc" }] },
    });
    expect(r.statusCode).toBe(400);
  });
});
