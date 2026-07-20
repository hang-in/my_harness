// M-A A1(T1) — parseFrontmatterList 배열 계약. present/syntax(link_unknown vs orphan 갈림) + YAML 블록/인라인 + TOML 다중행 + scalar 거부.
import { describe, it, expect } from "vitest";
import { parseFrontmatterList } from "../src/server/adapters/harness.js";

describe("parseFrontmatterList — YAML frontmatter", () => {
  const wrap = (body: string) => `---\n${body}\n---\n본문`;
  it("인라인 배열", () => {
    const r = parseFrontmatterList(wrap("name: a\nskills: [foo, bar]"), "skills");
    expect(r).toEqual({ present: true, items: ["foo", "bar"], syntax: "array" });
  });
  it("블록 리스트", () => {
    const r = parseFrontmatterList(wrap("name: a\nskills:\n  - foo\n  - bar"), "skills");
    expect(r).toEqual({ present: true, items: ["foo", "bar"], syntax: "array" });
  });
  it("빈 배열 = empty(명시 orphan 의도)", () => {
    const r = parseFrontmatterList(wrap("name: a\nskills: []"), "skills");
    expect(r).toEqual({ present: true, items: [], syntax: "empty" });
  });
  it("키 부재 = missing(link_unknown)", () => {
    const r = parseFrontmatterList(wrap("name: a\ndescription: x"), "skills");
    expect(r.present).toBe(false);
    expect(r.syntax).toBe("missing");
  });
  it("scalar = invalid_scalar(items 안 채움·scalar 금지)", () => {
    const r = parseFrontmatterList(wrap("name: a\nskills: foo"), "skills");
    expect(r).toEqual({ present: true, items: [], syntax: "invalid_scalar" });
  });
  it("BOM·따옴표 안전", () => {
    const r = parseFrontmatterList("﻿" + wrap('skills: ["foo", "bar"]'), "skills");
    expect(r.items).toEqual(["foo", "bar"]);
  });
  it("name canonical(basename·확장자 제거)", () => {
    const r = parseFrontmatterList(wrap("skills: [a/b/foo.md, bar.md]"), "skills");
    expect(r.items).toEqual(["foo", "bar"]);
  });
});

describe("parseFrontmatterList — TOML(codex·frontmatter 구분자 없음)", () => {
  it("단일행 배열", () => {
    const r = parseFrontmatterList('name = "cx"\nskills = ["foo", "bar"]\n', "skills");
    expect(r).toEqual({ present: true, items: ["foo", "bar"], syntax: "array" });
  });
  it("다중행 배열(R2 agy)", () => {
    const r = parseFrontmatterList('name = "cx"\nskills = [\n  "foo",\n  "bar",\n]\n', "skills");
    expect(r).toEqual({ present: true, items: ["foo", "bar"], syntax: "array" });
  });
  it("키 부재 = missing", () => {
    const r = parseFrontmatterList('name = "cx"\ntools = ["Read"]\n', "skills");
    expect(r.present).toBe(false);
  });
});
