// F9(M14) Docs 소스 경로 검증 (DS1~DS6). 신규 모듈.
// 각 소스 path 는 projectRoot **하위 상대경로**만(절대/`~`/`..`/UNC/드라이브/루트 자체 거부·NFC)·
//   per-seg isSafeDocsSegment·deniedDocsPath(민감 dir)·전 세그먼트 심링크/reparse 거부·realpath containment.
// F5 프리미티브 재사용: isSafeDocsSegment/isWithinRoot(paths.ts)·deniedDocsPath(security.ts) — 재발명 금지.
// 경로안전 불변식(I6): realpath containment 는 lstat/O_NOFOLLOW 와 별개 최후방어(Windows reparse 미탐 대비) — 유지.
import { lstat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { isSafeDocsSegment, isWithinRoot } from "./paths.js";
import { deniedDocsPath } from "../security.js";

export const MAX_DOCS_SOURCES = 16;   // DS6 소스 개수 상한(OOM·과대 목록 방어)
export const MAX_DOCS_PATH_LEN = 512; // DS6 path 문자 상한
export const MAX_DOCS_LABEL_LEN = 80; // DS6 label 문자 상한

export type DocsSourceError =
  | "bad-input"        // DS1 lexical(절대/`~`/UNC/드라이브/NFC/`..`) · DS2 unsafe 세그먼트
  | "root-source"      // DS1 `.`/`""`/`./`(≥1 하위 세그먼트 없음 = 루트 전체 노출) 거부
  | "denied"           // DS5 deniedDocsPath(.git/.ssh/node_modules/.env 등)
  | "not-found"        // base(또는 중간 세그먼트) 부재 — 서빙 불가
  | "not-a-directory"  // base 가 디렉토리 아님
  | "symlink-in-path"  // DS4 전 세그먼트 심링크/reparse
  | "escape";          // DS3 realpath containment 실패(junction/reparse out-root)

export type SourceValidation =
  | { ok: true; base: string; realBase: string; segs: string[] }
  | { ok: false; error: DocsSourceError };

// 소스 id = path sha256 opaque(재정렬·라벨 변경에 안정·딥링크용·열린질문1 권장안). 노출 최소 16 hex.
export function sourceId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

// DS1/DS2 렉시컬 검증(순수·FS 접근 없음). 성공 시 정규화된 세그먼트 배열 반환.
export function lexicalValidate(path: string): { ok: true; segs: string[] } | { ok: false; error: DocsSourceError } {
  if (typeof path !== "string" || path.length === 0) return { ok: false, error: "root-source" };
  if (path.length > MAX_DOCS_PATH_LEN) return { ok: false, error: "bad-input" };
  if (path.normalize("NFC") !== path) return { ok: false, error: "bad-input" }; // 미정규화 유니코드(homoglyph) 거부
  if (path.startsWith("~")) return { ok: false, error: "bad-input" };           // tilde 확장 거부
  if (/^[/\\]{2}/.test(path)) return { ok: false, error: "bad-input" };          // UNC(\\host·//host)
  if (/^[A-Za-z]:/.test(path)) return { ok: false, error: "bad-input" };         // 드라이브(C:foo·C:\foo)
  if (isAbsolute(path)) return { ok: false, error: "bad-input" };                // 절대경로 거부(상대만)
  const segs = path.split(/[/\\]/).filter((s) => s.length > 0 && s !== ".");     // `./`·중복 구분자 정리
  if (segs.length === 0) return { ok: false, error: "root-source" };             // `.`/`""`/`./` = 루트 전체 노출 거부
  for (const seg of segs) {
    if (seg === "..") return { ok: false, error: "bad-input" };                  // traversal
    if (!isSafeDocsSegment(seg)) return { ok: false, error: "bad-input" };       // 제어문자/null 등
  }
  return { ok: true, segs };
}

// 전체 검증(DS1~DS5·FS 포함). write 시점(400 게이트)·serve 시점(DS7 TOCTOU 재검증)·sources 목록 valid 플래그 공용.
export async function validateDocsSourcePath(path: string, projectRoot: string): Promise<SourceValidation> {
  const lex = lexicalValidate(path);
  if (!lex.ok) return lex;
  const { segs } = lex;
  const rel = segs.join("/");
  if (deniedDocsPath(rel)) return { ok: false, error: "denied" };                // DS5
  const base = join(projectRoot, ...segs);
  if (!isWithinRoot(projectRoot, base)) return { ok: false, error: "escape" };   // 렉시컬 containment
  // DS4 전 세그먼트(projectRoot→base) 심링크/reparse 무조건 거부. 각 세그먼트 lstat(심링크 미추종).
  let acc = projectRoot;
  let lastL: Awaited<ReturnType<typeof lstat>> | null = null;
  for (const seg of segs) {
    acc = join(acc, seg);
    const l = await lstat(acc).catch(() => null);
    if (!l) return { ok: false, error: "not-found" };
    if (l.isSymbolicLink()) return { ok: false, error: "symlink-in-path" };
    lastL = l;
  }
  if (!lastL || !lastL.isDirectory()) return { ok: false, error: "not-a-directory" };
  // DS3 realpath containment 최후방어(lstat 미탐 junction/reparse out-root).
  const realRoot = await realpath(projectRoot).catch(() => null);
  const realBase = await realpath(base).catch(() => null);
  if (!realRoot || !realBase || !isWithinRoot(realRoot, realBase)) return { ok: false, error: "escape" };
  return { ok: true, base, realBase, segs };
}
