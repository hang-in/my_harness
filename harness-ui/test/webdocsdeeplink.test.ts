import { describe, it, expect } from "vitest";
import { focusDocFromHash, docsDeepLink, filterDocTree } from "../src/web/docs-view.js";
import type { DocsNode } from "../src/web/api.js";

// U6 Docs ?path= 딥링크(Runs ?run= 패턴 재사용) + 트리 필터 순수 로직. TDD 대상.

describe("focusDocFromHash — ?path= 파싱(딥링크 복원)", () => {
  it("#/docs?path=design%2Fspec.md → design/spec.md(디코딩)", () => {
    expect(focusDocFromHash("#/docs?path=design%2Fspec.md")).toBe("design/spec.md");
  });
  it("path 없음 → null", () => {
    expect(focusDocFromHash("#/docs")).toBeNull();
    expect(focusDocFromHash("#/runs?run=x")).toBeNull();
    expect(focusDocFromHash("")).toBeNull();
  });
  it("빈 path 값 → null", () => { expect(focusDocFromHash("#/docs?path=")).toBeNull(); });
});

describe("docsDeepLink — 선택 파일 → URL(round-trip)", () => {
  it("경로 인코딩(round-trip with focusDocFromHash)", () => {
    const link = docsDeepLink("a b/c.md");
    expect(focusDocFromHash(link)).toBe("a b/c.md");
  });
  it("null → 파라미터 없는 #/docs", () => { expect(docsDeepLink(null)).toBe("#/docs"); });
});

describe("filterDocTree — 부분일치·대소문자 무시·조상 유지", () => {
  const tree: DocsNode[] = [
    { type: "dir", name: "design", path: "design", children: [
      { type: "file", name: "spec.md", path: "design/spec.md", ext: "md" },
      { type: "file", name: "notes.txt", path: "design/notes.txt", ext: "txt" },
    ] },
    { type: "file", name: "README.md", path: "README.md", ext: "md" },
  ];
  it("빈 쿼리 → 원본 그대로", () => {
    expect(filterDocTree(tree, "")).toBe(tree);
    expect(filterDocTree(tree, "   ")).toBe(tree);
  });
  it("파일명 매칭 → 해당 파일 + 조상 디렉토리 유지", () => {
    const out = filterDocTree(tree, "spec");
    expect(out).toEqual([
      { type: "dir", name: "design", path: "design", children: [
        { type: "file", name: "spec.md", path: "design/spec.md", ext: "md" },
      ] },
    ]);
  });
  it("대소문자 무시(readme → README.md)", () => {
    const out = filterDocTree(tree, "readme");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "file", name: "README.md" });
  });
  it("디렉토리명 매칭 → 하위 전체 유지", () => {
    const out = filterDocTree(tree, "design");
    expect(out).toHaveLength(1);
    expect((out[0] as Extract<DocsNode, { type: "dir" }>).children).toHaveLength(2);
  });
  it("매칭 없음 → 빈 배열", () => {
    expect(filterDocTree(tree, "zzz")).toEqual([]);
  });
});
