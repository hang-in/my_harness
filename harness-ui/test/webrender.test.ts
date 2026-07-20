// @vitest-environment jsdom
// M8 F5 DV8(치명) — 마크다운 렌더 안전 파이프라인 거부 스위트(§위협 스위트 13~18).
// renderMarkdown = markdown-it({html:false}) → DOMPurify(allowlist·scheme 화이트리스트·외부리소스 차단).
// DOMPurify 는 window 필요 → jsdom 환경. 산출 HTML 문자열에 실행 벡터가 무력화됐음을 assert.
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/web/render.js";

// 안전성의 핵심은 "실행 위치"에 위험 벡터가 없음 — DOM 으로 파싱해 활성 요소/속성 부재를 검증.
// (html:false 로 raw HTML 은 inert 텍스트로 escape 되므로 문자열 부분일치가 아닌 DOM 구조로 판정.)
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}
const SAFE_HREF = /^(?:https?:|mailto:|#|\/|\.)/i; // 활성 href 는 http/https/mailto/상대만 허용
function hasEventHandlerAttr(doc: Document): boolean {
  for (const el of Array.from(doc.querySelectorAll("*")))
    for (const a of Array.from(el.attributes))
      if (/^on/i.test(a.name)) return true;
  return false;
}

describe("DV8 거부 스위트 — XSS 벡터 무력화(case 13~18)", () => {
  it("case 13: <script> in md → script 요소 비생성(inert 텍스트로 escape)", () => {
    const doc = parse(renderMarkdown("# x\n\n<script>alert(1)</script>\n"));
    expect(doc.querySelectorAll("script").length).toBe(0);
    // 원문은 텍스트로만 존재(비실행)
    expect(doc.body.querySelector("h1")).not.toBeNull();
  });
  it("case 14: onerror= 이벤트핸들러 → 활성 이벤트핸들러 속성 0", () => {
    const doc = parse(renderMarkdown('<img src="x" onerror="alert(2)">\n'));
    expect(hasEventHandlerAttr(doc)).toBe(false);
    expect(doc.querySelectorAll("img").length).toBe(0);
  });
  it("case 15: javascript: URL → 활성 href scheme 없음(링크 미생성/href 제거)", () => {
    const doc = parse(renderMarkdown("[js](javascript:alert(3))\n"));
    for (const a of Array.from(doc.querySelectorAll("a[href]")))
      expect(SAFE_HREF.test(a.getAttribute("href") ?? "")).toBe(true);
  });
  it("case 16: data: URL → 활성 href/img 없음·이벤트핸들러 없음", () => {
    const doc = parse(renderMarkdown("[d](data:text/html;base64,PHNjcmlwdD4=)\n![i](data:image/svg+xml,<svg/onload=alert(1)>)\n"));
    for (const a of Array.from(doc.querySelectorAll("a[href]")))
      expect(SAFE_HREF.test(a.getAttribute("href") ?? "")).toBe(true);
    expect(doc.querySelectorAll("img,svg").length).toBe(0);
    expect(hasEventHandlerAttr(doc)).toBe(false);
  });
  it("case 17: 원격 <img src=원격> → img 요소 0(외부리소스 불가)", () => {
    const doc = parse(renderMarkdown('![remote](https://evil.example/a.png)\n<img src="https://evil.example/b.png">\n'));
    expect(doc.querySelectorAll("img").length).toBe(0);
  });
  it("case 18: SVG 내 스크립트 → svg/script 요소 0", () => {
    const doc = parse(renderMarkdown('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n'));
    expect(doc.querySelectorAll("svg").length).toBe(0);
    expect(doc.querySelectorAll("script").length).toBe(0);
  });
  it("vbscript:/file: 등 기타 scheme 링크 → 활성 href 없음", () => {
    const doc = parse(renderMarkdown("[v](vbscript:msgbox(1))\n[f](file:///etc/passwd)\n"));
    for (const a of Array.from(doc.querySelectorAll("a[href]")))
      expect(SAFE_HREF.test(a.getAttribute("href") ?? "")).toBe(true);
  });
  it("raw HTML 앵커/이벤트핸들러 조합 → 활성 앵커/핸들러 없음(html:false escape)", () => {
    const doc = parse(renderMarkdown('<a href="javascript:alert(1)" onclick="alert(2)">x</a>\n'));
    expect(hasEventHandlerAttr(doc)).toBe(false);
    for (const a of Array.from(doc.querySelectorAll("a[href]")))
      expect(SAFE_HREF.test(a.getAttribute("href") ?? "")).toBe(true);
  });
});

describe("DV8 positive — 정상 마크다운 렌더(case 20)", () => {
  it("제목·http 링크·코드펜스·수평선 렌더", () => {
    const html = renderMarkdown("# Title\n\n[link](https://example.com)\n\n---\n\n```js\ncode\n```\n");
    expect(html).toContain("<h1>");
    expect(html).toContain("Title");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<hr>");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });
  it("http 링크에 rel=noopener 강제·target 없음(탭내빙 방지)", () => {
    const html = renderMarkdown("[l](https://example.com)\n");
    expect(html).toContain("rel=");
    expect(html.toLowerCase()).not.toContain("target=");
  });
  it("mailto 링크 통과", () => {
    const html = renderMarkdown("[m](mailto:a@b.com)\n");
    expect(html).toContain("mailto:a@b.com");
  });
  it("테이블·강조·인용 렌더", () => {
    const html = renderMarkdown("**bold** *em*\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<table>");
  });
  it("빈/공백 입력 → 크래시 없이 빈 문자열류", () => {
    expect(typeof renderMarkdown("")).toBe("string");
    expect(typeof renderMarkdown("   ")).toBe("string");
  });
});
