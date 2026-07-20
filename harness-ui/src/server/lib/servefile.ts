// 공용 경화 파일 서버 (F5 뷰어 — 통합감사 #3 앵커 파라미터화).
// artifact 서빙(api/index.ts) 방어 로직을 base(앵커) 파라미터화 재사용:
//   per-seg isSafeSegment · denylist · 선계산 realpath 이중앵커 · 전 세그먼트 lstat 심링크 무조건 거부(in-root 포함)
//   · leaf O_NOFOLLOW open · fstat 정규파일 · containment 재확인 · dev/ino 바인딩.
// realpath 경계검사는 lstat/O_NOFOLLOW 와 **별개의 최후방어**(Windows reparse 미탐 대비 AS4/V16) — 절대 제거 금지.
import { constants } from "node:fs";
import { open, realpath, lstat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { FastifyReply } from "fastify";
import { join } from "node:path";
import { isSafeSegment, isWithinRoot } from "./paths.js";

export const VIEW_MAX = 1 * 1024 * 1024;      // 미리보기 절단 상한(1MB — VIEW_MAX)
export const DOWNLOAD_MAX = 8 * 1024 * 1024;  // 다운로드 하드 상한(8MB — ARTIFACT_MAX)

// 렌더 허용 MIME 화이트리스트(md/txt/json/log). 그 외(SVG/HTML/JS 등) = 비렌더·attachment 다운로드만.
export const RENDERABLE_EXT = new Set(["md", "markdown", "txt", "text", "json", "log"]);
// F10(M15): 컨텍스트 뷰어는 TOML(.codex/agents/*.toml) 텍스트 렌더 포함(A122·실행 안 함·text/plain).
export const CONTEXT_RENDERABLE_EXT = new Set([...RENDERABLE_EXT, "toml"]);

export type SafeFile =
  | { ok: false; code: number; error: string }
  | { ok: true; fh: FileHandle; st: Stats; leafName: string };

export interface OpenOpts {
  denyPath: (rel: string) => boolean;
  ancestors?: string[]; // base 앞의 사용자제어 조상 dir(예 artifacts=[.../runId]) — 심링크 walk 대상.
  isSafeSeg?: (seg: string) => boolean; // 세그먼트 검증기(기본 isSafeSegment·docs 는 isSafeDocsSegment).
}

// base 앵커 하위의 사용자 세그먼트만 신뢰경계 밖으로 해석. 실패는 전부 fail-closed(DV9).
export async function openSafeFile(
  projectRoot: string,
  base: string,
  segs: string[],
  opts: OpenOpts,
): Promise<SafeFile> {
  const rel = segs.join("/");
  const segOk = opts.isSafeSeg ?? isSafeSegment;
  // DV2 per-세그먼트 · DV5 denylist(해석 전 rel 문자열).
  if (segs.length === 0 || !segs.every(segOk) || opts.denyPath(rel)) {
    return { ok: false, code: 400, error: "invalid-path" };
  }
  const target = join(base, ...segs);
  if (!isWithinRoot(base, target)) return { ok: false, code: 400, error: "out-of-bounds" };
  // DV3 앵커를 walk 이전 **선계산**(base swap 창 축소). realBase 가 project 내여야.
  const realRoot = await realpath(projectRoot);
  const realBase = await realpath(base).catch(() => null);
  if (!realBase || !isWithinRoot(realRoot, realBase)) return { ok: false, code: 400, error: "bad-base" };
  // DV4 전 세그먼트 lstat 심링크 무조건 거부(in-root든 out-root든). ancestors→base→중간 세그먼트.
  // pre-walk: 각 세그먼트 dev/ino 포착 → open 후 post-walk 재검증으로 walk↔open TOCTOU 창(case5) 폐쇄.
  const walk = [...(opts.ancestors ?? []), base, ...segs.slice(0, -1).map((_, i) => join(base, ...segs.slice(0, i + 1)))];
  const pre: { path: string; dev: number; ino: number }[] = [];
  for (const seg of walk) {
    const l = await lstat(seg).catch(() => null);
    if (!l || l.isSymbolicLink()) return { ok: false, code: 400, error: "symlink-in-path" };
    pre.push({ path: seg, dev: l.dev, ino: l.ino });
  }
  // leaf O_NOFOLLOW open(check-reopen TOCTOU 제거) → fstat 정규 → realpath 이중앵커 → dev/ino 바인딩.
  let fh: FileHandle;
  try { fh = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { return { ok: false, code: 404, error: "not-found" }; }
  try {
    const st = await fh.stat();
    if (!st.isFile()) { await fh.close().catch(() => {}); return { ok: false, code: 404, error: "not-file" }; }
    const real = await realpath(target); // 최후방어: 내부 심링크→타경로 차단(lstat 미탐 백스톱)
    if (!isWithinRoot(realBase, real)) { await fh.close().catch(() => {}); return { ok: false, code: 400, error: "escape" }; }
    const l = await lstat(target).catch(() => null); // open↔check 사이 부모 swap 탐지(dev/ino)
    if (!l || l.ino !== st.ino || l.dev !== st.dev) { await fh.close().catch(() => {}); return { ok: false, code: 409, error: "path-changed" }; }
    // DV4b case5(중간 세그먼트 스왑 TOCTOU): open 이후 walk 전 세그먼트를 재-lstat.
    //   walk↔open 사이 중간 dir 이 심링크(in/out-root)로 스왑되면 realpath containment·leaf dev/ino 를
    //   통과할 수 있으므로, 심링크化 또는 pre/post dev·ino 변동을 무조건 거부한다(I6 통일·fail-closed).
    for (const p of pre) {
      const pl = await lstat(p.path).catch(() => null);
      if (!pl || pl.isSymbolicLink() || pl.dev !== p.dev || pl.ino !== p.ino) {
        await fh.close().catch(() => {}); return { ok: false, code: 409, error: "path-changed" };
      }
    }
    return { ok: true, fh, st, leafName: segs[segs.length - 1]! };
  } catch {
    await fh.close().catch(() => {});
    return { ok: false, code: 404, error: "not-found" };
  }
}

// docs/artifact 파일 응답 공통 헤더 — 엄격 CSP(script 실행·외부리소스·프레임 차단) + nosniff.
export function applyFileHeaders(reply: FastifyReply): void {
  reply.header(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'none'; frame-ancestors 'none'",
  );
  reply.header("X-Content-Type-Options", "nosniff");
}

function safeName(name: string): string { return name.replace(/[^A-Za-z0-9._-]/g, "_"); }
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}
function mimeFor(ext: string): string {
  switch (ext) {
    case "md": case "markdown": return "text/markdown";
    case "json": return "application/json";
    default: return "text/plain";
  }
}
// 널바이트(UTF-16/바이너리) + 비-UTF8 감지(DV7). 절단 파일도 fatal decode 하되 stream:true 로 검사 —
// 끝의 미완 멀티바이트(경계서 잘린 정상 문자, 예 한글)는 내부 버퍼링돼 오탐하지 않고(false-positive 방지),
// 널바이트 없는 큰 비-UTF8 바이너리의 invalid 바이트는 fatal throw 로 감지(fail-closed).
// 고정 N바이트 절삭은 멀티바이트 중간을 잘라 새 미완 시퀀스를 만들 수 있어 stream 옵션을 사용.
function isBinary(buf: Buffer, truncated: boolean): boolean {
  if (buf.includes(0)) return true;
  try { new TextDecoder("utf-8", { fatal: true }).decode(buf, { stream: truncated }); }
  catch { return true; }
  return false;
}

// DV6 다운로드: fstat.size 를 스트림 시작 前 검사 → 초과 시 즉시 413(중간 중단 금지·A98 손상방지).
export async function sendDownload(reply: FastifyReply, r: Extract<SafeFile, { ok: true }>, downloadMax: number) {
  if (r.st.size > downloadMax) {
    reply.code(413);
    return { error: "too-large", size: r.st.size, max: downloadMax };
  }
  const n = Math.min(r.st.size, downloadMax);
  const buf = Buffer.alloc(n);
  await r.fh.read(buf, 0, n, 0);
  applyFileHeaders(reply);
  reply.header("Content-Type", "text/plain; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="${safeName(r.leafName)}"`);
  return reply.send(buf);
}

// DV6/DV7/DV8 미리보기: MIME 화이트리스트·바이너리 감지·VIEW_MAX 절단. 원문 텍스트만(sanitize는 클라).
export async function sendPreview(
  reply: FastifyReply, r: Extract<SafeFile, { ok: true }>, relPath: string, viewMax: number,
  renderableExt: Set<string> = RENDERABLE_EXT,
) {
  applyFileHeaders(reply);
  const ext = extOf(r.leafName);
  const mime = mimeFor(ext);
  const renderable = renderableExt.has(ext);
  const fullSize = r.st.size;
  const base = { path: relPath, name: r.leafName, mime, size: fullSize };
  // 비-화이트리스트 MIME(SVG/HTML/JS 등) = 비렌더·다운로드만(content 미반환).
  if (!renderable) {
    return { ...base, renderable: false, binary: false, truncated: false, content: null as string | null };
  }
  const n = Math.min(fullSize, viewMax);
  const truncated = fullSize > n;
  const buf = Buffer.alloc(n);
  await r.fh.read(buf, 0, n, 0);
  if (isBinary(buf, truncated)) {
    return { ...base, renderable: true, binary: true, truncated, content: null as string | null };
  }
  return { ...base, renderable: true, binary: false, truncated, content: buf.toString("utf8") };
}
