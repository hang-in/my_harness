// F10(M15) 멀티런타임 컨텍스트 리더 + 신규 정의 생성 경로안전.
//   읽기 트리(HR1~HR7): docsTree(M14) walk 의 pre/post dev·ino 바인딩·null-sentinel 노드제외·realpath
//   containment 규율을 멀티런타임 서브루트에 이식(신규 스캐너 발명 금지·동일 규율). 심링크/junction·대량 dir·
//   화이트리스트 밖 dot·시크릿 전부 fail-closed.
//   신규 생성(HB5·신규 구축): F7 safeDefPath/writeDefSafe 는 leaf 실재 전제 → 신규 leaf 용 별도 경로안전.
import { readdir, realpath, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isSafeDocsSegment, isWithinRoot, ARGV_TOKEN } from "../lib/paths.js";
import {
  deniedContextPath, classifyContextPath, CONTEXT_TOP_FILES, CONTEXT_SUBROOTS,
  MAX_CONTEXT_NODES, type Runtime,
} from "../lib/contextpaths.js";

const MAX_DEPTH = 12; // 재귀 깊이 backstop(docsTree 동형)

export type ContextNode =
  | { type: "dir"; name: string; path: string; runtime: Runtime; children: ContextNode[] }
  | { type: "file"; name: string; path: string; runtime: Runtime; ext: string };

export interface ContextTree {
  projectRoot: string;
  topFiles: { name: string; path: string; runtime: Runtime; present: boolean }[];
  roots: { path: string; runtime: Runtime; present: boolean; children: ContextNode[] }[];
  count: number;
  truncated: boolean;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

// projectRoot 직속 컨텍스트 파일(CLAUDE/AGENTS/GEMINI.md) 실재·안전 검증(HR3 직속 파일도 leaf lstat+심링크
//   거부+realpath containment). 심링크(→외부)·비정규·부재 = false(미표시).
async function isSafeTopFile(realRoot: string, projectRoot: string, name: string): Promise<boolean> {
  const abs = join(projectRoot, name);
  const l = await lstat(abs).catch(() => null);
  if (!l || l.isSymbolicLink() || !l.isFile()) return false;
  const real = await realpath(abs).catch(() => null);
  return !!real && isWithinRoot(realRoot, real);
}

// 서브루트 앵커 안전 검증(projectRoot→base 전 세그먼트 심링크/reparse 거부·realpath containment).
async function safeSubroot(
  realRoot: string, projectRoot: string, segs: readonly string[],
): Promise<{ ok: true; base: string; realBase: string } | { ok: false }> {
  let acc = projectRoot;
  for (const s of segs) {
    acc = join(acc, s);
    const l = await lstat(acc).catch(() => null);
    if (!l || l.isSymbolicLink() || !l.isDirectory()) return { ok: false }; // 심링크/부재/비-dir → fail-closed
  }
  const realBase = await realpath(acc).catch(() => null);
  if (!realBase || !isWithinRoot(realRoot, realBase)) return { ok: false };
  return { ok: true, base: acc, realBase };
}

// docsTree walk 이식: pre lstat(dev/ino)→realpath containment→readdir→post lstat 재검증→realpath 재확인.
//   반환 null = 레이스/스왑/containment 위반 노드 제외(빈 노드로도 안 남김). childRel = projectRoot 상대 전체
//   경로(deniedContextPath 가 첫 세그먼트 dot-dir 을 인지·중첩 dot/node_modules/시크릿 거부).
async function walkContext(
  dir: string, rel: string, depth: number, runtime: Runtime, realBase: string,
  state: { count: number; truncated: boolean },
): Promise<ContextNode[] | null> {
  if (depth > MAX_DEPTH) return [];
  const pre = await lstat(dir).catch(() => null);
  if (!pre || pre.isSymbolicLink() || !pre.isDirectory()) return null;
  const realDir = await realpath(dir).catch(() => null);
  if (!realDir || !isWithinRoot(realBase, realDir)) return null;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }
  const post = await lstat(dir).catch(() => null);
  if (!post || post.isSymbolicLink() || !post.isDirectory() || post.dev !== pre.dev || post.ino !== pre.ino) return null;
  const realDirPost = await realpath(dir).catch(() => null);
  if (!realDirPost || !isWithinRoot(realBase, realDirPost)) return null;
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const nodes: ContextNode[] = [];
  for (const e of entries) {
    if (state.count >= MAX_CONTEXT_NODES) { state.truncated = true; break; }
    if (e.isSymbolicLink()) continue;                 // 심링크 무조건 skip
    if (!isSafeDocsSegment(e.name)) continue;          // traversal/제어문자 이름 미노출(트리↔열람 정합)
    const childRel = `${rel}/${e.name}`;
    if (deniedContextPath(childRel)) continue;         // node_modules 류·중첩 dot·시크릿 skip(HR4·HR7)
    if (e.isDirectory()) {
      const childDir = join(dir, e.name);
      const realChild = await realpath(childDir).catch(() => null);
      if (!realChild || !isWithinRoot(realBase, realChild)) continue; // junction/reparse out-root 제외
      const children = await walkContext(childDir, childRel, depth + 1, runtime, realBase, state);
      if (children === null) continue;                 // 레이스/스왑 감지 → 노드 통째 제외
      state.count += 1;                                 // 디렉토리 노드도 예산 소모(broad empty-dir 상한 우회 차단·HR7)
      nodes.push({ type: "dir", name: e.name, path: childRel, runtime, children });
    } else if (e.isFile()) {
      state.count += 1;
      nodes.push({ type: "file", name: e.name, path: childRel, runtime, ext: extOf(e.name) });
    }
  }
  return nodes;
}

// 멀티런타임 화이트리스트 트리(HR1~HR7). 각 노드 runtime 라벨. 단일 MAX_CONTEXT_NODES 예산 공유.
export async function contextTree(projectRoot: string): Promise<ContextTree> {
  const state = { count: 0, truncated: false };
  const empty: ContextTree = { projectRoot, topFiles: [], roots: [], count: 0, truncated: false };
  const realRoot = await realpath(projectRoot).catch(() => null);
  if (!realRoot) return empty;

  const topFiles: ContextTree["topFiles"] = [];
  for (const f of CONTEXT_TOP_FILES) {
    const present = await isSafeTopFile(realRoot, projectRoot, f.name);
    topFiles.push({ name: f.name, path: f.name, runtime: f.runtime, present });
  }

  const roots: ContextTree["roots"] = [];
  for (const sr of CONTEXT_SUBROOTS) {
    const baseRel = sr.segs.join("/");
    const info = await safeSubroot(realRoot, projectRoot, sr.segs);
    if (!info.ok) { roots.push({ path: baseRel, runtime: sr.runtime, present: false, children: [] }); continue; }
    const children = state.count >= MAX_CONTEXT_NODES
      ? []
      : (await walkContext(info.base, baseRel, 0, sr.runtime, info.realBase, state)) ?? [];
    roots.push({ path: baseRel, runtime: sr.runtime, present: true, children });
  }
  return { projectRoot, topFiles, roots, count: state.count, truncated: state.truncated };
}

// runtime 라벨 = classifyContextPath 결과(파일 열람·편집 게이트 UI 판정용 재사용).
export function runtimeOf(rel: string): Runtime | null {
  const c = classifyContextPath(rel.split("/"));
  return c ? c.runtime : null;
}

export type CreatePathResult =
  | { ok: true; sourcePath: string; abs: string }
  | { ok: false; code: number; error: string };

// HB5 신규 생성 경로안전(신규 구축 — F7 은 leaf 실재 전제라 미지원). `.claude/agents·skills` 스코프만(구성 강제).
//   부모 체인: 존재 시 비-심링크 dir 요구·부재 시 안전 mkdir(0700)·매 단계 realpath containment. leaf 실재 시
//   409 name-collision. writeDefSafe 가 이후 부모 체인을 재검증(TOCTOU) 하므로 여기선 생성/실재만 보장.
export async function ensureCreatePath(
  projectRoot: string, kind: "agent" | "skill", name: string,
): Promise<CreatePathResult> {
  // ARGV_TOKEN(첫 글자 영숫자·dot-prefix 금지) — isSafeSegment 보다 엄격. dot-prefix 이름은 deniedContextPath
  //   가 트리에서 숨겨(생성됐으나 보이지 않는 파일) 은폐 유발 → 원천 거부(write ⊆ 읽기 가시성 불변식).
  if (!ARGV_TOKEN.test(name) || name.length > 120) return { ok: false, code: 400, error: "invalid-name" };
  const realRoot = await realpath(projectRoot).catch(() => null);
  if (!realRoot) return { ok: false, code: 400, error: "path-unsafe" };
  const parentSegs = kind === "agent" ? [".claude", "agents"] : [".claude", "skills", name];
  let acc = realRoot;
  for (const s of parentSegs) {
    acc = join(acc, s);
    const l = await lstat(acc).catch(() => null);
    if (l) {
      if (l.isSymbolicLink() || !l.isDirectory()) return { ok: false, code: 400, error: "parent-unsafe" };
    } else {
      try { await mkdir(acc, { mode: 0o700 }); }
      catch { return { ok: false, code: 400, error: "mkdir-failed" }; }
    }
    const real = await realpath(acc).catch(() => null);
    if (!real || !isWithinRoot(realRoot, real)) return { ok: false, code: 400, error: "escape" };
  }
  const sourcePath = kind === "agent" ? `.claude/agents/${name}.md` : `.claude/skills/${name}/SKILL.md`;
  const leafAbs = join(realRoot, ...sourcePath.split("/"));
  const leaf = await lstat(leafAbs).catch(() => null);
  if (leaf) return { ok: false, code: 409, error: "name-collision" }; // leaf 실재 = 이름 충돌
  return { ok: true, sourcePath, abs: leafAbs };
}
