// F5 뷰어 순수 헬퍼(브레드크럼·렌더 판정·로컬 경로). UI 상태·shape 로직 → 단위 테스트 대상(TDD).
// posix 경로만(서버 rel 은 항상 "/" 구분). 로컬 절대경로 표시는 A98(다운로드 413 시 "로컬에서 열기") 안내용.
import type { DocsNode } from "./api.js";

// 브레드크럼 — "design/spec.md" → [{name:"docs",path:""},{name:"design",path:"design"},{name:"spec.md",path:"design/spec.md"}].
// 루트("docs") 항상 선두. 각 항목의 path 는 누적(클릭 시 트리 포커스용). 파일/디렉토리 무관.
export function breadcrumbTrail(rel: string, rootLabel = "docs"): Array<{ name: string; path: string }> {
  const trail: Array<{ name: string; path: string }> = [{ name: rootLabel, path: "" }];
  const segs = (rel ?? "").split("/").filter(Boolean);
  let acc = "";
  for (const s of segs) {
    acc = acc ? `${acc}/${s}` : s;
    trail.push({ name: s, path: acc });
  }
  return trail;
}

// 마크다운 렌더 대상 확장자(md/markdown). 그 외(txt/json/log·artifact)는 raw 텍스트로만 표시.
const MD_EXT = new Set(["md", "markdown"]);
export function isMarkdownName(name: string): boolean {
  const i = name.lastIndexOf(".");
  return i > 0 && MD_EXT.has(name.slice(i + 1).toLowerCase());
}

// posix join(로컬 절대경로 표시용) — 빈 세그먼트 제거·"/" 결합. projectRoot 는 서버 settings 그대로.
function joinPosix(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}
// F9(M14): 소스 상대경로(sourcePath) 하위. 기본 "docs"(레거시 하위호환·기존 테스트 정합).
export function localDocPath(projectRoot: string, rel: string, sourcePath = "docs"): string {
  return joinPosix(projectRoot, sourcePath, rel);
}
export function localArtifactPath(projectRoot: string, runId: string, name: string): string {
  return joinPosix(projectRoot, "_workspace", "runs", runId, "artifacts", name);
}

// 미리보기 배너 판정(색 비의존·아이콘+텍스트). 서버 preview 메타 → 배너 종류.
//  binary → "미리보기 불가(바이너리)" · not-renderable → "미리보기 불가(이 형식)" · null → 미리보기 가능.
export type ViewerBanner = "binary" | "not-renderable" | null;
export function viewerBanner(p: { renderable: boolean; binary: boolean }): ViewerBanner {
  if (!p.renderable) return "not-renderable";
  if (p.binary) return "binary";
  return null;
}

// ── U6 ?path= 딥링크(Runs ?run= 패턴 재사용) — 선택 파일 URL 반영·새로고침/공유 복원 ──
// hash 의 `?path=<enc>` → rel 경로. 없으면 null. 예: "#/docs?path=design%2Fspec.md" → "design/spec.md".
export function focusDocFromHash(hash: string): string | null {
  const q = hash.split("?")[1];
  if (!q) return null;
  const path = new URLSearchParams(q).get("path");
  return path && path.length > 0 ? path : null;
}

// 선택 파일 → Docs 딥링크 URL(hash 라우팅·경로 인코딩). null → 파라미터 없는 `#/docs`.
export function docsDeepLink(rel: string | null): string {
  return rel ? `#/docs?path=${encodeURIComponent(rel)}` : "#/docs";
}

// ── U6 트리 필터(간단·부분일치·대소문자 무시) — 매칭 파일 + 그 조상 디렉토리만 유지 ──
// 순수 재귀 필터. query 공백/빈 → 원본 그대로. 매칭 없는 디렉토리는 제거(빈 트리 방지).
export function filterDocTree(nodes: DocsNode[], query: string): DocsNode[] {
  const q = query.trim().toLowerCase();
  if (q === "") return nodes;
  const walk = (list: DocsNode[]): DocsNode[] => {
    const out: DocsNode[] = [];
    for (const n of list) {
      if (n.type === "file") {
        if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) out.push(n);
      } else {
        const kids = walk(n.children);
        // 디렉토리명 자체가 매칭이면 하위 전체 유지, 아니면 매칭 하위만.
        if (n.name.toLowerCase().includes(q)) out.push(n);
        else if (kids.length > 0) out.push({ ...n, children: kids });
      }
    }
    return out;
  };
  return walk(nodes);
}
