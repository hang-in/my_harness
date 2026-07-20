// M8 F5 문서/artifact 뷰어 서버 — DV1~DV9 방어층 + 거부/ACCEPT 스위트(§위협 스위트 F5).
// projectRoot 는 모듈 상수라 registerApi 를 임시 root 로 직접 등록해 격리 테스트.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApi } from "../src/server/api/index.js";
import { deniedDocsPath } from "../src/server/security.js";
import { DOWNLOAD_MAX, VIEW_MAX } from "../src/server/lib/servefile.js";

let root: string;
let app: FastifyInstance;
let symlinkOk = true;

async function trySymlink(target: string, path: string, type: "file" | "dir"): Promise<boolean> {
  try { await symlink(target, path, type); return true; } catch { return false; }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-docs-"));
  const docs = join(root, "docs");
  await mkdir(join(docs, "design"), { recursive: true });
  await mkdir(join(docs, "sub"), { recursive: true });
  await writeFile(join(docs, "readme.md"), "# Title\n\n[link](https://example.com)\n\n---\n\n```js\ncode\n```\n");
  await writeFile(join(docs, "notes.txt"), "plain text");
  await writeFile(join(docs, "data.json"), '{"a":1}');
  await writeFile(join(docs, "run.log"), "log line");
  await writeFile(join(docs, "design", "spec.md"), "# spec");
  // V5 ACCEPT: 파일명/본문에 registry·session 포함 정상 문서 → 200(부분일치 오거부 금지)
  await writeFile(join(docs, "registry-notes.md"), "# registry\n\nsession stuff, registry index\n");
  await writeFile(join(docs, "session-log.md"), "# session\n");
  // MED(트리↔열람 정합): 한글·공백 파일명 결과서(트리 노출 + 클릭 열람 모두 가능해야)
  await writeFile(join(docs, "한글 결과서.md"), "# 한글 결과서\n\n본문 내용\n");
  await writeFile(join(docs, "design", "설계 노트 v0.6.md"), "# 설계 노트\n");
  // XSS 원문(서버는 원문 서빙, sanitize 는 클라)
  await writeFile(join(docs, "xss.md"), '# x\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n[js](javascript:alert(3))\n<img src="https://evil.example/a.png">\n');
  // 비-화이트리스트 MIME(SVG) → 비렌더
  await writeFile(join(docs, "pic.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await writeFile(join(docs, "page.html"), "<html><script>x</script></html>");
  // 민감파일(denylist 대상)
  await writeFile(join(docs, ".env"), "SECRET=1");
  await writeFile(join(docs, "id_rsa"), "PRIVATE");
  await writeFile(join(docs, "cert.key"), "KEY");
  await writeFile(join(docs, "leaf.pem"), "PEM");
  // 바이너리(널바이트)
  await writeFile(join(docs, "bin.md"), Buffer.from([0x68, 0x69, 0x00, 0xff, 0xfe]));
  // 초과크기(미리보기 VIEW_MAX 초과·다운로드는 상한 이하로 유지)
  await writeFile(join(docs, "big.md"), Buffer.alloc(VIEW_MAX + 1024, 0x61));
  // 초과크기 다운로드(DOWNLOAD_MAX 초과)
  await writeFile(join(docs, "huge.md"), Buffer.alloc(DOWNLOAD_MAX + 1, 0x61));

  // artifacts
  const art = join(root, "_workspace", "runs", "run-1", "artifacts");
  await mkdir(art, { recursive: true });
  await writeFile(join(art, "out.md"), "hello artifact");
  // run events(shape 회귀 V12)
  await writeFile(join(root, "_workspace", "runs", "run-1", "events.jsonl"),
    JSON.stringify({ seq: 0, ts: "2026-07-09T10:00:00+09:00", level: "info", agent: null, skill: null, phase: "run", event: "log", message: "hi", usage: null }) + "\n");

  // 심링크 픽스처(불가 환경 skip)
  symlinkOk = await trySymlink("/etc", join(docs, "evildir"), "dir");
  await trySymlink(join(docs, "readme.md"), join(docs, "inrootlink"), "dir"); // in-root 심링크 dir

  app = Fastify({ logger: false });
  registerApi(app, root);
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

const CSP = "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'none'; frame-ancestors 'none'";

describe("A53 — docs 트리(DV1 화이트루트)", () => {
  it("GET /api/docs → docs 루트 트리 반환", async () => {
    const r = await app.inject({ url: "/api/docs" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.root).toBe("docs");
    const names = JSON.stringify(b.tree);
    expect(names).toContain("readme.md");
    expect(names).toContain("design");
    // 민감파일은 트리에서 제외
    expect(names).not.toContain(".env");
    expect(names).not.toContain("id_rsa");
    expect(names).not.toContain("cert.key");
  });
});

describe("A53/A54/A56/A58 — 정상 열람(positive)", () => {
  it("A54: 정상 md 미리보기 200 + content + renderable", async () => {
    const r = await app.inject({ url: "/api/docs/readme.md" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.renderable).toBe(true);
    expect(b.binary).toBe(false);
    expect(b.truncated).toBe(false);
    expect(b.mime).toBe("text/markdown");
    expect(b.content).toContain("# Title");
  });
  it("A53: txt/json/log 미리보기 200", async () => {
    for (const [f, mime] of [["notes.txt", "text/plain"], ["data.json", "application/json"], ["run.log", "text/plain"]] as const) {
      const r = await app.inject({ url: `/api/docs/${f}` });
      expect(r.statusCode).toBe(200);
      expect(r.json().mime).toBe(mime);
      expect(r.json().renderable).toBe(true);
    }
  });
  it("A53: 하위 디렉토리 파일 열람", async () => {
    const r = await app.inject({ url: "/api/docs/design/spec.md" });
    expect(r.statusCode).toBe(200);
    expect(r.json().content).toContain("# spec");
  });
  it("A58: 미리보기 응답에 엄격 CSP + nosniff 헤더", async () => {
    const r = await app.inject({ url: "/api/docs/readme.md" });
    expect(r.headers["content-security-policy"]).toBe(CSP);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("A56: 다운로드(?download=1) attachment + CSP + nosniff", async () => {
    const r = await app.inject({ url: "/api/docs/readme.md?download=1" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.headers["content-security-policy"]).toBe(CSP);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.body).toContain("# Title");
  });
  it("A55[V5 ACCEPT]: registry-*.md·session·본문 registry 포함 정상문서 → 200(오거부 금지)", async () => {
    const a = await app.inject({ url: "/api/docs/registry-notes.md" });
    expect(a.statusCode).toBe(200);
    expect(a.json().content).toContain("registry index");
    const b = await app.inject({ url: "/api/docs/session-log.md" });
    expect(b.statusCode).toBe(200);
    // deniedDocsPath 단위: registry/session 은 ACCEPT, secret 만 거부
    expect(deniedDocsPath("registry-notes.md")).toBe(false);
    expect(deniedDocsPath("session-log.md")).toBe(false);
  });
  it("MED(i): 한글/공백 파일명 docs 열람 → 200 정상(isSafeDocsSegment)", async () => {
    const r = await app.inject({ url: `/api/docs/${encodeURIComponent("한글 결과서.md")}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().content).toContain("# 한글 결과서");
    expect(r.json().renderable).toBe(true);
    const s = await app.inject({ url: `/api/docs/design/${encodeURIComponent("설계 노트 v0.6.md")}` });
    expect(s.statusCode).toBe(200);
    expect(s.json().content).toContain("# 설계 노트");
  });
  it("MED(iii): 트리 노출 파일이 전부 열람 가능(정합) — 트리에 보이면 열림", async () => {
    const tree = (await app.inject({ url: "/api/docs" })).json();
    const paths: string[] = [];
    const collect = (nodes: any[]) => {
      for (const n of nodes) {
        if (n.type === "file") paths.push(n.path);
        else collect(n.children);
      }
    };
    collect(tree.tree);
    expect(paths).toContain("한글 결과서.md");
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      const url = "/api/docs/" + p.split("/").map(encodeURIComponent).join("/");
      const r = await app.inject({ url });
      // 이름(세그먼트) 사유의 400 이 없어야 정합(내용상 200; 크기초과 미리보기도 200 절단)
      expect(r.statusCode, `tree file must open: ${p}`).toBe(200);
    }
  });
  it("case 20: 마크다운 수평선·코드펜스 원문 보존", async () => {
    const b = (await app.inject({ url: "/api/docs/readme.md" })).json();
    expect(b.content).toContain("---");
    expect(b.content).toContain("```js");
  });
});

describe("거부 스위트(negative) — fail-closed", () => {
  it("case 1: ../../etc/passwd → 400", async () => {
    const r = await app.inject({ url: "/api/docs/..%2F..%2Fetc%2Fpasswd" });
    expect(r.statusCode).toBe(400);
  });
  it("case 2: 절대경로류 /etc/passwd 은 docs 밖 서빙 불가(≥400)", async () => {
    const r = await app.inject({ url: "/api/docs/etc/passwd" });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.body).not.toContain("root:");
  });
  it("case 3: 심링크 → /etc(out-root) 중간 세그먼트 → 400 symlink-in-path", async () => {
    if (!symlinkOk) return;
    const r = await app.inject({ url: "/api/docs/evildir/passwd" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("symlink-in-path");
  });
  it("case 4: in-root 심링크(디렉토리) 무조건 거부 → 400 symlink-in-path", async () => {
    const r = await app.inject({ url: "/api/docs/inrootlink/readme.md" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("symlink-in-path");
  });
  it("case 6: docs/../.git/config(.. 세그먼트) → 400", async () => {
    const r = await app.inject({ url: "/api/docs/..%2F.git%2Fconfig" });
    expect(r.statusCode).toBe(400);
  });
  it("MED(ii): isSafeDocsSegment 는 traversal·null·제어문자 거부, 유니코드/공백 허용", async () => {
    const { isSafeDocsSegment } = await import("../src/server/lib/paths.js");
    // ACCEPT: 유니코드·공백·정상 ASCII
    expect(isSafeDocsSegment("한글 결과서.md")).toBe(true);
    expect(isSafeDocsSegment("readme.md")).toBe(true);
    expect(isSafeDocsSegment("v0.6 설계.md")).toBe(true);
    expect(isSafeDocsSegment("a b")).toBe(true); // 공백(0x20)은 허용
    // REJECT: 빈/`.`/`..`/separator/null/제어문자
    expect(isSafeDocsSegment("")).toBe(false);
    expect(isSafeDocsSegment(".")).toBe(false);
    expect(isSafeDocsSegment("..")).toBe(false);
    expect(isSafeDocsSegment("a/b")).toBe(false);
    expect(isSafeDocsSegment("a\\b")).toBe(false);
    expect(isSafeDocsSegment("a\tb")).toBe(false);
    expect(isSafeDocsSegment("a\nb")).toBe(false);
    // 라우트: null 바이트 세그먼트 열람 → 400(fail-closed)
    const r = await app.inject({ url: "/api/docs/a%00b.md" });
    expect(r.statusCode).toBe(400);
  });
  it("case 7: .env(dot-prefix DENY) → 400", async () => {
    const r = await app.inject({ url: "/api/docs/.env" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("invalid-path");
  });
  it("case 8: 비-dot id_rsa·foo.key·foo.pem → 400", async () => {
    for (const f of ["id_rsa", "cert.key", "leaf.pem"]) {
      const r = await app.inject({ url: `/api/docs/${f}` });
      expect(r.statusCode).toBe(400);
    }
    expect(deniedDocsPath("id_rsa")).toBe(true);
    expect(deniedDocsPath("a/foo.key")).toBe(true);
    expect(deniedDocsPath("foo.pem")).toBe(true);
    expect(deniedDocsPath(".env")).toBe(true);
    expect(deniedDocsPath("a/.ssh/known")).toBe(true);
    expect(deniedDocsPath("node_modules/x")).toBe(true);
  });
  it("case 9: node_modules/.git 세그먼트 → 400", async () => {
    expect((await app.inject({ url: "/api/docs/node_modules/x.md" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/docs/.git/config" })).statusCode).toBe(400);
  });
  it("case 10: 바이너리 미리보기 → binary:true·content null(비렌더)", async () => {
    const r = await app.inject({ url: "/api/docs/bin.md" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.binary).toBe(true);
    expect(b.content).toBeNull();
  });
  it("case 11: VIEW_MAX 초과 미리보기 → truncated:true·절단 content", async () => {
    const r = await app.inject({ url: "/api/docs/big.md" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.truncated).toBe(true);
    expect(b.size).toBeGreaterThan(VIEW_MAX);
    expect(b.content.length).toBeLessThanOrEqual(VIEW_MAX);
  });
  it("case 12: DOWNLOAD_MAX 초과 다운로드 → 스트림 前 413(중간중단 금지)", async () => {
    const r = await app.inject({ url: "/api/docs/huge.md?download=1" });
    expect(r.statusCode).toBe(413);
    const b = r.json();
    expect(b.error).toBe("too-large");
    expect(b.max).toBe(DOWNLOAD_MAX);
    expect(b.size).toBeGreaterThan(DOWNLOAD_MAX);
  });
  it("case 13~17: XSS 원문 서빙(서버 비실행) + CSP 백스톱", async () => {
    const r = await app.inject({ url: "/api/docs/xss.md" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    // 서버는 원문 텍스트만 반환(렌더 안 함) — sanitize 는 클라(web-builder)
    expect(b.content).toContain("<script>alert(1)</script>");
    expect(b.content).toContain("onerror=");
    expect(b.content).toContain("javascript:");
    // CSP: script-src 'none'(13/14/15) + img-src 'self'(17) 백스톱
    expect(r.headers["content-security-policy"]).toContain("script-src 'none'");
    expect(r.headers["content-security-policy"]).toContain("img-src 'self'");
  });
  it("case 18: SVG/HTML = 비-화이트리스트 MIME → renderable:false·content null", async () => {
    for (const f of ["pic.svg", "page.html"]) {
      const r = await app.inject({ url: `/api/docs/${f}` });
      expect(r.statusCode).toBe(200);
      expect(r.json().renderable).toBe(false);
      expect(r.json().content).toBeNull();
    }
  });
});

describe("artifact 라우트 회귀(공용 함수 추출 후 — A27/A28/A45)", () => {
  it("A28: 정상 artifact 다운로드(attachment·text·nosniff·CSP)", async () => {
    const r = await app.inject({ url: "/api/runs/run-1/artifacts/out.md" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("hello artifact");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("A27: artifact traversal 거부", async () => {
    expect((await app.inject({ url: "/api/runs/run-1/artifacts/..%2F..%2Fmanifest.json" })).statusCode).toBe(400);
  });
  it("artifact 목록", async () => {
    const r = await app.inject({ url: "/api/runs/run-1/artifacts" });
    expect(r.json().files).toContain("out.md");
  });
});

describe("V12 — /events 응답 shape(SSOT=items) 회귀", () => {
  it("GET /api/runs/:runId/events → {items,nextAfter,hasMore,runState}", async () => {
    const r = await app.inject({ url: "/api/runs/run-1/events" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(Array.isArray(b.items)).toBe(true);
    expect(b.items.length).toBe(1);
    expect(b.items[0].message).toBe("hi");
    expect(b).toHaveProperty("nextAfter");
    expect(b).toHaveProperty("hasMore");
    // 구버전 웹이 오소비하던 events 키는 서버에 없음(웹 교정 대상 — web-builder)
    expect(b.events).toBeUndefined();
  });
});
