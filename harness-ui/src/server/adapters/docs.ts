// F5 docs 트리 리더 (DV1 화이트루트 = docs/ 재귀). 읽기전용.
// 심링크(파일·디렉토리) 무조건 skip(외부 노출 방지) + denylist + 개수/깊이 상한(OOM·루프 방어).
// R2 HIGH: 각 하위 dir 재귀 前 realpath containment(isWithinRoot)로 white-root(docs) 재검증 —
//   Windows junction/reparse 는 lstat.isSymbolicLink() 가 미탐하므로 realpath 를 최후방어로 병용(AS4/V16).
import { readdir, realpath, lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { deniedDocsPath } from "../security.js";
import { isSafeDocsSegment, isWithinRoot } from "../lib/paths.js";

const MAX_TREE = 2000; // 트리 노출 파일 상한(OOM·과대 트리 방어)
const MAX_DEPTH = 12;  // 재귀 깊이 backstop

export type DocsNode =
  | { type: "dir"; name: string; path: string; children: DocsNode[] }
  | { type: "file"; name: string; path: string; ext: string };

// root = 소스 상대경로 라벨(기본 "docs"·하위호환). F9 소스별 트리는 base/rootLabel 파라미터로 구동.
export interface DocsTree { root: string; tree: DocsNode[]; count: number; truncated: boolean }

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

// F9(M14): base 파라미터화(하드코딩 `docs` 제거·기본값으로 하위호환 보존).
// ⚠ [R2 agy HIGH·DS7] docsTree 는 openSafeFile 과 **별개 walk 루프** — base 파라미터화 시 등록 후
//   심링크로 스왑된 base(예 /etc)가 projectRoot 밖 전체를 리스팅하는 경로탈출이 열린다. 파일 열람(openSafeFile)은
//   리스팅 표면을 못 덮으므로, **진입부에서** (i) projectRoot→base 전 세그먼트 심링크/reparse 거부
//   (ii) realBase=realpath(base) 계산 (iii) isWithinRoot(realpath(projectRoot), realBase) 검증을 명시 수행한다.
export async function docsTree(
  projectRoot: string,
  base: string = join(projectRoot, "docs"),
  rootLabel = "docs",
): Promise<DocsTree> {
  const state = { count: 0, truncated: false };
  const empty: DocsTree = { root: rootLabel, tree: [], count: 0, truncated: false };
  // (iii-준비) projectRoot realpath. 해석 불가면 빈 트리(fail-closed).
  const realRootOrNull = await realpath(projectRoot).catch(() => null);
  if (!realRootOrNull) return empty;
  // (i) 렉시컬 containment + projectRoot→base 전 세그먼트 심링크 거부(base 자체 스왑 방어).
  if (!isWithinRoot(projectRoot, base)) return empty;
  const relSegs = relative(projectRoot, base).split(sep).filter((s) => s.length > 0 && s !== ".");
  let acc = projectRoot;
  for (const seg of relSegs) {
    acc = join(acc, seg);
    const l = await lstat(acc).catch(() => null);
    if (!l || l.isSymbolicLink()) return empty; // 심링크/부재 base 경로 → fail-closed
  }
  // (ii)(iii) 앵커 선계산 + realpath containment(junction/reparse out-root backstop).
  const realBaseOrNull = await realpath(base).catch(() => null);
  if (!realBaseOrNull || !isWithinRoot(realRootOrNull, realBaseOrNull)) return empty;
  const realBase = realBaseOrNull; // 클로저 캡처용 non-null 앵커

  // 반환 계약: null = 이 디렉토리 노드를 **결과에서 제외**(레이스/스왑/containment 위반·fail-closed).
  //   빈 배열 [] = 유효하지만 비어있는(또는 depth 백스톱) 정상 디렉토리 → 부모가 빈 노드로 유지.
  //   → [R3 codex HIGH-1] 레이스 감지 노드는 빈 노드로도 남기지 않는다(부모가 null 이면 push skip).
  async function walk(dir: string, rel: string, depth: number): Promise<DocsNode[] | null> {
    if (depth > MAX_DEPTH) return []; // 깊이 백스톱 — in-root dir(부모가 containment 검증) 은 빈 노드로 유지
    // [R2 codex HIGH·in-request TOCTOU] 검증↔readdir 레이스 폐쇄 — openSafeFile 규율을 트리 walk 에 이식.
    //   pre lstat(정규 dir·심링크 아님·dev/ino 캡처) → realpath containment → readdir →
    //   post lstat(dev/ino 재확인·심링크화 거부) → realpath containment 재확인. 어느 하나라도 어긋나면
    //   그 노드를 **제외**(null·fail-closed) — 검증 후 dir 이 out-root 심링크/junction 으로 스왑돼도 그 사이
    //   readdir 이 읽은 외부 엔트리를 결과로 방출하지 않는다(Node 공개 API 는 fd-readdir 미지원 → pre/post 바인딩).
    const pre = await lstat(dir).catch(() => null);
    if (!pre || pre.isSymbolicLink() || !pre.isDirectory()) return null;
    const realDir = await realpath(dir).catch(() => null);
    if (!realDir || !isWithinRoot(realBase, realDir)) return null;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }
    // post-readdir 재검증: 검증↔readdir 사이 dir 스왑(심링크化/다른 dev·ino/out-root) → 노드 제외(null).
    const post = await lstat(dir).catch(() => null);
    if (!post || post.isSymbolicLink() || !post.isDirectory() || post.dev !== pre.dev || post.ino !== pre.ino) return null;
    const realDirPost = await realpath(dir).catch(() => null);
    if (!realDirPost || !isWithinRoot(realBase, realDirPost)) return null;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const nodes: DocsNode[] = [];
    for (const e of entries) {
      if (state.count >= MAX_TREE) { state.truncated = true; break; }
      if (e.isSymbolicLink()) continue; // 심링크 무조건 skip(Linux)
      if (!isSafeDocsSegment(e.name)) continue; // 트리↔열람 정합: 열람 불가(traversal/제어문자) 이름은 미노출
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (deniedDocsPath(childRel)) continue; // 민감파일/dot-prefix skip
      if (e.isDirectory()) {
        const childDir = join(dir, e.name);
        // 재귀 前 realpath containment 재검증: junction/reparse(lstat 미탐)로 docs 밖을 가리키면 제외(HIGH).
        const realChild = await realpath(childDir).catch(() => null);
        if (!realChild || !isWithinRoot(realBase, realChild)) continue; // out-root → 나열·재귀 금지
        const children = await walk(childDir, childRel, depth + 1);
        if (children === null) continue; // 레이스/스왑 감지 → 노드 통째 제외(빈 노드로도 남기지 않음)
        nodes.push({ type: "dir", name: e.name, path: childRel, children });
      } else if (e.isFile()) {
        state.count += 1;
        nodes.push({ type: "file", name: e.name, path: childRel, ext: extOf(e.name) });
      }
    }
    return nodes;
  }

  const tree = await walk(base, "", 0);
  return { root: rootLabel, tree: tree ?? [], count: state.count, truncated: state.truncated }; // base 레이스 → 빈 트리
}
