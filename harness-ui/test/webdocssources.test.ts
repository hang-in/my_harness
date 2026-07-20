// F9 M14 웹 — Docs 소스 설정 순수 로직: error 코드 한국어 매핑·소스 편집기 행 조작·dryRun 매핑·다중소스 상태 판정·딥링크.
import { describe, it, expect } from "vitest";
import { docsTreePath, docPreviewPath } from "../src/web/api.js";
import {
  MAX_DOCS_SOURCES,
  DOCS_SOURCE_ERRORS, docsSourceErrorText,
  addSourceRow, removeSourceRow, updateSourceRow, moveSourceRow, canAddSource,
  rowIssue, rowIssueText, rowsLocallyValid, toPayloadSources,
  dryRunErrorByPath, allSourcesValid,
  docsSourcesState, pickDefaultSource,
  focusSourceFromHash, docsSourceDeepLink,
  type SourceRow, type DryRunSource, type SourcesPayload,
} from "../src/web/docs-sources.js";

describe("api 경로 빌더 — ?source= 쿼리 shape(서버 계약 경계면)", () => {
  it("docsTreePath — source null → 레거시 무인자·id → ?source= 인코딩", () => {
    expect(docsTreePath(null)).toBe("/api/docs");
    expect(docsTreePath("sha16")).toBe("/api/docs?source=sha16");
    expect(docsTreePath("a b")).toBe("/api/docs?source=a%20b");
  });
  it("docPreviewPath — 세그먼트 인코딩 + ?source= 결합(서버 rel.split('/')·source 계약)", () => {
    expect(docPreviewPath("design/spec.md", null)).toBe("/api/docs/design/spec.md");
    expect(docPreviewPath("설계 문서/명세.md", "sha16")).toBe(
      "/api/docs/%EC%84%A4%EA%B3%84%20%EB%AC%B8%EC%84%9C/%EB%AA%85%EC%84%B8.md?source=sha16",
    );
  });
});

describe("docsSourceErrorText — 서버 error 코드 한국어 매핑(A5·조용한 드롭 금지)", () => {
  it("서버 DocsSourceError 전건 + endpoint invalid-source 가 매핑됨", () => {
    const codes = ["bad-input", "root-source", "denied", "not-found",
      "not-a-directory", "symlink-in-path", "escape", "invalid-source"];
    for (const c of codes) {
      expect(DOCS_SOURCE_ERRORS[c]).toBeDefined();
      expect(docsSourceErrorText(c)).toBe(DOCS_SOURCE_ERRORS[c]);
      expect(docsSourceErrorText(c).length).toBeGreaterThan(0);
    }
  });
  it("root-source → 루트 전체 노출 거부 안내(하위 경로 강제)", () => {
    expect(docsSourceErrorText("root-source")).toContain("하위");
  });
  it("미지 코드 → 상태코드·코드 포함 폴백(조용한 드롭 아님)", () => {
    const msg = docsSourceErrorText("boom", 500);
    expect(msg).toContain("500");
    expect(msg).toContain("boom");
  });
});

describe("소스 편집기 행 조작 — 불변(A119 추가/삭제/재정렬)", () => {
  const rows: SourceRow[] = [{ label: "Docs", path: "docs" }, { label: "Notes", path: "notes" }];
  it("addSourceRow 는 빈 행을 추가하고 원본 불변", () => {
    const next = addSourceRow(rows);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ label: "", path: "" });
    expect(rows).toHaveLength(2); // 원본 불변
  });
  it("canAddSource / addSourceRow 는 MAX_DOCS_SOURCES 상한에서 무변경", () => {
    const full: SourceRow[] = Array.from({ length: MAX_DOCS_SOURCES }, (_, i) => ({ label: `L${i}`, path: `p${i}` }));
    expect(canAddSource(full)).toBe(false);
    expect(addSourceRow(full)).toHaveLength(MAX_DOCS_SOURCES);
  });
  it("removeSourceRow 는 해당 인덱스만 제거", () => {
    expect(removeSourceRow(rows, 0)).toEqual([{ label: "Notes", path: "notes" }]);
  });
  it("updateSourceRow 는 해당 행만 patch 병합", () => {
    expect(updateSourceRow(rows, 1, { path: "docs/sub" })).toEqual([
      { label: "Docs", path: "docs" }, { label: "Notes", path: "docs/sub" },
    ]);
  });
  it("moveSourceRow 는 인접 스왑·경계 밖은 무변경", () => {
    expect(moveSourceRow(rows, 0, 1)).toEqual([{ label: "Notes", path: "notes" }, { label: "Docs", path: "docs" }]);
    expect(moveSourceRow(rows, 0, -1)).toBe(rows); // 위로 불가 → 동일 참조(무변경)
    expect(moveSourceRow(rows, 1, 1)).toBe(rows);  // 아래로 불가
  });
});

describe("로컬 행 유효성 — 저장/검증 게이트(서버 재검증 전 명백한 무효 차단)", () => {
  it("빈 라벨/경로 → issue, 정상 → null", () => {
    expect(rowIssue({ label: "", path: "docs" })).toBe("empty-label");
    expect(rowIssue({ label: "L", path: "  " })).toBe("empty-path");
    expect(rowIssue({ label: "L", path: "docs" })).toBeNull();
    expect(rowIssueText("empty-label")).toBeTruthy();
    expect(rowIssueText(null)).toBeNull();
  });
  it("길이 초과 → issue", () => {
    expect(rowIssue({ label: "x".repeat(81), path: "docs" })).toBe("label-too-long");
    expect(rowIssue({ label: "L", path: "x".repeat(513) })).toBe("path-too-long");
  });
  it("rowsLocallyValid — 빈 배열(전 소스 삭제)은 유효", () => {
    expect(rowsLocallyValid([])).toBe(true);
    expect(rowsLocallyValid([{ label: "L", path: "docs" }])).toBe(true);
    expect(rowsLocallyValid([{ label: "", path: "docs" }])).toBe(false);
  });
  it("toPayloadSources — trim 적용·빈 배열 허용", () => {
    expect(toPayloadSources([{ label: " L ", path: " docs " }])).toEqual([{ label: "L", path: "docs" }]);
    expect(toPayloadSources([])).toEqual([]);
  });
});

describe("dryRun 프리뷰 매핑 — per-소스 인라인 유효성(A119)", () => {
  const sources: DryRunSource[] = [
    { id: "a", label: "Docs", path: "docs", valid: true, error: null },
    { id: "b", label: "Bad", path: "../etc", valid: false, error: "bad-input" },
  ];
  it("dryRunErrorByPath — 경로 키로 error 코드(유효=null)", () => {
    expect(dryRunErrorByPath(sources)).toEqual({ "docs": null, "../etc": "bad-input" });
  });
  it("allSourcesValid — 하나라도 무효면 false·빈 배열은 true", () => {
    const valid: DryRunSource = { id: "a", label: "Docs", path: "docs", valid: true, error: null };
    expect(allSourcesValid(sources)).toBe(false);
    expect(allSourcesValid([valid])).toBe(true);
    expect(allSourcesValid([])).toBe(true);
  });
});

describe("Docs 다중소스 상태 판정 — A120 데드엔드 방지 CTA", () => {
  const src = (over: Partial<SourcesPayload["sources"][number]>): SourcesPayload["sources"][number] =>
    ({ id: "x", label: "L", path: "p", valid: true, enabled: true, ...over });
  it("메뉴 off → disabled", () => {
    expect(docsSourcesState({ enabled: false, sources: [src({})] })).toBe("disabled");
  });
  it("소스 0개 → no-sources", () => {
    expect(docsSourcesState({ enabled: true, sources: [] })).toBe("no-sources");
  });
  it("전 소스 무효 → all-invalid", () => {
    expect(docsSourcesState({ enabled: true, sources: [src({ valid: false })] })).toBe("all-invalid");
  });
  it("≥1 유효 → ready", () => {
    expect(docsSourcesState({ enabled: true, sources: [src({ valid: false }), src({ id: "y", valid: true })] })).toBe("ready");
  });
});

describe("pickDefaultSource — 딥링크 우선·첫 유효 폴백·무효는 비선택", () => {
  const p: SourcesPayload = { enabled: true, sources: [
    { id: "bad", label: "B", path: "b", valid: false, enabled: true },
    { id: "ok1", label: "O1", path: "o1", valid: true, enabled: true },
    { id: "ok2", label: "O2", path: "o2", valid: true, enabled: true },
  ] };
  it("preferred 가 유효하면 유지", () => {
    expect(pickDefaultSource(p, "ok2")).toBe("ok2");
  });
  it("preferred 가 무효/부재면 첫 유효 소스", () => {
    expect(pickDefaultSource(p, "bad")).toBe("ok1");
    expect(pickDefaultSource(p, null)).toBe("ok1");
    expect(pickDefaultSource(p, "nope")).toBe("ok1");
  });
  it("유효 소스 전무 → null", () => {
    expect(pickDefaultSource({ enabled: true, sources: [{ id: "bad", label: "B", path: "b", valid: false, enabled: true }] }, null)).toBeNull();
  });
});

describe("?source= 딥링크 — 소스+파일 URL 왕복", () => {
  it("focusSourceFromHash — hash 의 source 추출", () => {
    expect(focusSourceFromHash("#/docs?source=abc123&path=a%2Fb.md")).toBe("abc123");
    expect(focusSourceFromHash("#/docs")).toBeNull();
    expect(focusSourceFromHash("#/docs?path=x")).toBeNull();
  });
  it("docsSourceDeepLink — source·rel 결합(둘 다 없으면 #/docs)", () => {
    expect(docsSourceDeepLink("abc", "a/b.md")).toBe("#/docs?source=abc&path=a%2Fb.md");
    expect(docsSourceDeepLink("abc", null)).toBe("#/docs?source=abc");
    expect(docsSourceDeepLink(null, null)).toBe("#/docs");
  });
  it("딥링크 → focus 왕복(source 복원)", () => {
    const link = docsSourceDeepLink("sha16", "design/spec.md");
    expect(focusSourceFromHash(link)).toBe("sha16");
  });
});
