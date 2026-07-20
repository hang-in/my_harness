// M8 F5 — 뷰어 순수 헬퍼(브레드크럼·렌더 판정·로컬 경로·배너 판정) + docs URL 인코딩 계약.
import { describe, it, expect } from "vitest";
import {
  breadcrumbTrail, isMarkdownName, viewerBanner, localDocPath, localArtifactPath,
} from "../src/web/docs-view.js";
import { encodeDocPath } from "../src/web/api.js";

describe("breadcrumbTrail — 루트 선두·누적 경로", () => {
  it("중첩 경로 → docs 루트 + 각 세그먼트 누적 path", () => {
    expect(breadcrumbTrail("design/spec.md")).toEqual([
      { name: "docs", path: "" },
      { name: "design", path: "design" },
      { name: "spec.md", path: "design/spec.md" },
    ]);
  });
  it("루트 파일 → [docs, file]", () => {
    expect(breadcrumbTrail("readme.md")).toEqual([
      { name: "docs", path: "" },
      { name: "readme.md", path: "readme.md" },
    ]);
  });
  it("빈 경로 → docs 루트만", () => {
    expect(breadcrumbTrail("")).toEqual([{ name: "docs", path: "" }]);
  });
});

describe("isMarkdownName — md/markdown 만 렌더 대상", () => {
  it("md/markdown → true", () => {
    expect(isMarkdownName("a.md")).toBe(true);
    expect(isMarkdownName("A.MARKDOWN")).toBe(true);
  });
  it("txt/json/log/확장자없음 → false(raw 텍스트만)", () => {
    for (const n of ["a.txt", "a.json", "a.log", "README", "a.svg"]) expect(isMarkdownName(n)).toBe(false);
  });
});

describe("viewerBanner — 색 비의존 배너 판정", () => {
  it("비렌더 → not-renderable", () => {
    expect(viewerBanner({ renderable: false, binary: false })).toBe("not-renderable");
  });
  it("바이너리 → binary", () => {
    expect(viewerBanner({ renderable: true, binary: true })).toBe("binary");
  });
  it("정상 → null", () => {
    expect(viewerBanner({ renderable: true, binary: false })).toBeNull();
  });
});

describe("로컬 절대경로(A98) — 다운로드 413 시 '로컬에서 열기' 안내", () => {
  it("docs 경로", () => {
    expect(localDocPath("/home/u/proj", "design/spec.md")).toBe("/home/u/proj/docs/design/spec.md");
  });
  it("artifact 경로", () => {
    expect(localArtifactPath("/home/u/proj", "run-1", "out.log")).toBe("/home/u/proj/_workspace/runs/run-1/artifacts/out.log");
  });
});

describe("encodeDocPath — 세그먼트별 인코딩·구분자 슬래시 보존(서버 rel.split('/') 계약)", () => {
  it("공백·특수문자 세그먼트 인코딩·슬래시 보존", () => {
    expect(encodeDocPath("a b/c.md")).toBe("a%20b/c.md");
    expect(encodeDocPath("design/spec.md")).toBe("design/spec.md");
  });
  it("세그먼트 내 특수문자(#·?)는 인코딩·구분 슬래시는 리터럴 유지", () => {
    expect(encodeDocPath("a#b/c?.md")).toBe("a%23b/c%3F.md");
  });
  // 서버 새 정책(유니코드·공백 허용·traversal 만 차단)과 정합: 인코더는 한글/공백 세그먼트를
  // UTF-8 로 올바로 인코딩해 서버 decodeURIComponent 왕복이 원문을 복원 → 트리에 보이는 파일 열람 가능.
  it("한글·공백 세그먼트 → UTF-8 encodeURIComponent·슬래시 보존", () => {
    expect(encodeDocPath("한글.md")).toBe("%ED%95%9C%EA%B8%80.md");
    expect(encodeDocPath("설계 문서/명세 v1.md")).toBe(
      "%EC%84%A4%EA%B3%84%20%EB%AC%B8%EC%84%9C/%EB%AA%85%EC%84%B8%20v1.md",
    );
  });
  it("인코딩 → decodeURIComponent 왕복이 원문 세그먼트 복원(서버 재검증 계약)", () => {
    for (const rel of ["한글.md", "설계 문서/명세 v1.md", "a b/c.md"]) {
      const roundtrip = encodeDocPath(rel).split("/").map(decodeURIComponent).join("/");
      expect(roundtrip).toBe(rel);
    }
  });
  // traversal(..) 차단은 서버 소관 — 인코더는 세그먼트를 훼손 없이 그대로 인코딩(점은 unreserved).
  it("'..' 세그먼트는 리터럴 유지(차단은 서버 책임·인코더는 무훼손)", () => {
    expect(encodeDocPath("../secret")).toBe("../secret");
  });
});
