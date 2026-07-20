// 단일 오리진 정적 서빙 — 빌드된 SPA 셸(dist/)을 `/`·`/assets/*` 에서 서빙(사용자요청 A).
//   범위: **로컬 단일 사용자(127.0.0.1)** 전용. 원격/다중기기(0.0.0.0·IP)는 비목표(v0.7·별도 보안 설계).
//
// 보안 불변식:
//   - 경로안전(중대): dist 밖 접근 0. 기존 경화 리더 `openSafeFile`(lib/servefile) 재사용 —
//     per-seg isSafeSegment · denylist · realpath 이중앵커 · 전 세그먼트 lstat 심링크 거부 ·
//     leaf O_NOFOLLOW · fstat 정규파일 · dev/ino 바인딩. projectRoot=base=dist 로 dist 에 confine.
//   - 정적은 비인증(SPA 셸·JS·CSS 는 토큰 없이 로드돼야 이후 /api/auth/exchange 가능). 토큰 게이트는 /api/ 한정.
//     단 Host 게이트는 정적에도 적용(security.ts onRequest — DNS rebinding 심층방어).
//   - 앱 셸 CSP: index.html 에는 **앱이 동작하는 CSP**(script-src 'self'). doc-preview 의 script-src 'none'
//     (lib/servefile applyFileHeaders)은 문서 미리보기 전용 — 앱 셸에 적용 금지(적용 시 앱 JS 로드 불가).
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { openSafeFile } from "./lib/servefile.js";
import { deniedPath } from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/server → harness-ui/dist (tsx 실행 기준 __dirname=src/server). vite build 산출물.
export const DIST_ROOT = resolve(__dirname, "..", "..", "dist");

// 정적 파일 크기 상한(우리 빌드 산출물 — 넉넉히). 초과 시 미서빙(fail-closed).
export const STATIC_MAX = 32 * 1024 * 1024;

// 앱 셸 CSP — SPA 가 동작하는 최소 권한(self 스크립트/스타일·data 이미지·self connect). doc-preview 와 별개.
export const APP_SHELL_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

// MIME 정확 지정(nosniff 유지 — 정확 타입 필수). 미지 확장자 = octet-stream(안전 폴백).
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
};
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}
export function mimeFor(name: string): string {
  return MIME[extOf(name)] ?? "application/octet-stream";
}

// dist 에서 segs 파일을 경화 리더로 읽어 응답. 성공 시 true(응답 전송 완료), 미존재/차단 시 false.
async function tryServe(reply: FastifyReply, distRoot: string, segs: string[]): Promise<boolean> {
  // projectRoot=base=dist → openSafeFile 이 dist 에 confine(realBase⊆realRoot·rel==""). denylist=dotfile/.git 등.
  const r = await openSafeFile(distRoot, distRoot, segs, { denyPath: deniedPath });
  if (!r.ok) return false;
  try {
    if (r.st.size > STATIC_MAX) return false; // 상한 초과(우리 산출물 아님) → 미서빙
    const buf = Buffer.alloc(r.st.size);
    if (r.st.size > 0) await r.fh.read(buf, 0, r.st.size, 0);
    const leaf = segs[segs.length - 1]!;
    if (extOf(leaf) === "html") reply.header("Content-Security-Policy", APP_SHELL_CSP); // 앱 셸만
    reply.header("Content-Type", mimeFor(leaf)); // nosniff 는 security onSend 훅이 전역 부여
    reply.header("Cache-Control", "no-cache");
    reply.send(buf);
    return true;
  } finally {
    await r.fh.close().catch(() => {});
  }
}

// SPA 정적 서빙을 notFoundHandler 로 배선(API 미매칭 GET → 정적·index.html fallback).
//   onRequest(security) 훅이 먼저 실행돼 정적에도 Host 게이트 적용 → 여기 도달 = Host 통과분.
export function registerStatic(app: FastifyInstance, distRoot: string = DIST_ROOT): void {
  app.setNotFoundHandler(async (req, reply) => {
    let pathname: string;
    try {
      pathname = new URL(req.url, "http://localhost").pathname; // authority-form·path-form 정규화
    } catch {
      return reply.code(400).send({ error: "bad-target" });
    }
    // /api/ 미매칭(라우트 없음)은 정적이 아님 → 404 JSON. (인증 실패는 onRequest 에서 이미 401/403.)
    if (pathname.startsWith("/api/")) return reply.code(404).send({ error: "not-found" });
    // 정적은 GET/HEAD 만. 그 외 메서드 → 404(정적 자원에 쓰기 없음).
    if (req.method !== "GET" && req.method !== "HEAD") return reply.code(404).send({ error: "not-found" });

    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const segs = rel.split("/").filter((s) => s.length > 0);
    // segs 는 openSafeFile 이 per-seg isSafeSegment 로 검증(`.`/`..`/`%`/메타 거부) → traversal fail-closed.
    if (segs.length > 0 && (await tryServe(reply, distRoot, segs))) return reply;

    // SPA fallback: 해시 라우팅이라 deep-path 도 index.html. 단 /assets/ 미존재 = 진짜 404(index.html 오배달 금지).
    if (pathname.startsWith("/assets/")) return reply.code(404).send({ error: "not-found" });
    if (await tryServe(reply, distRoot, ["index.html"])) return reply;
    return reply.code(404).send({ error: "not-found" });
  });
}
