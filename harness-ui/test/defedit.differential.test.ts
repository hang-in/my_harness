// M12 A-10 · A75 정의 파서 게이트 (AS6 분기 B — idempotence + 앱 리더 파싱 등가).
//
// AS6 선검증 결과(오케스트레이터 확정): claude CLI 에 에이전트/스킬 frontmatter 를 격리 파싱해 관측 가능한
//   구조화 출력으로 방출하는 진입점이 **부재**(2.1.205). → "실 런타임 리더 등가(UI≡CLI)" full 게이트는
//   구성 불가. 따라서 이 게이트를 다음 2축으로 **정직 격하**한다:
//     (a) idempotence: canonicalize(content) → 재직렬화본을 다시 canonicalize → 동일 canonical(안정 라운드트립).
//     (b) 앱 리더 파싱 등가: 재직렬화본을 앱이 실제 정의를 읽는 harness.ts:parseFrontmatter 로 파싱 → name/
//         description 동일(canonicalizeDefinition 내부 reader-parse 게이트가 강제·여기선 corpus 로 재확인).
//   RESIDUAL RISK(미해소·문서화): 편집기 파서 ≠ 외부 런타임(claude/codex) 파서 발산 가능성은 CLI 진입점
//   부재로 **검증 불가**. 본 게이트는 "편집기 자기일관성 + 앱 자체 리더 파싱"만 증명하며 외부 런타임 등가를
//   주장하지 않는다. 진입점이 생기면 분기 A(런타임 리더 등가)로 격상.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeDefinition } from "../src/server/adapters/defedit.js";
import { parseFrontmatter } from "../src/server/adapters/harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "fixtures", "definitions");

function firstFrontmatterName(content: string): string {
  return parseFrontmatter(content.replace(/^﻿/, "")).name ?? "";
}

describe("A-10/A75 — accept 코퍼스 idempotence + 앱 리더 파싱 등가", () => {
  const files = readdirSync(join(CORPUS, "accept"));
  it("accept 코퍼스가 비어있지 않음(게이트 필수·skip 아님)", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const f of files) {
    it(`accept/${f} → canonicalize ok · idempotent · 리더 파싱 동일`, () => {
      const content = readFileSync(join(CORPUS, "accept", f), "utf8");
      const name = firstFrontmatterName(content);
      // agent·skill 스키마 모두 name/description 필수 + passthrough — 양 kind 로 통과해야 함.
      for (const kind of ["agent", "skill"] as const) {
        const r1 = canonicalizeDefinition(content, kind, name);
        expect(r1.ok, `${f} (${kind}) should accept`).toBe(true);
        if (!r1.ok) continue;
        // (a) idempotence: 재직렬화본을 다시 canonicalize → 동일 canonical
        const r2 = canonicalizeDefinition(r1.canonical, kind, name);
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.canonical, `${f} (${kind}) idempotent`).toBe(r1.canonical);
        // (b) 앱 리더 파싱 등가: harness.ts:parseFrontmatter 로 canonical 파싱 → name 동일
        const readerName = parseFrontmatter(r1.canonical).name;
        expect(readerName, `${f} (${kind}) reader name`).toBe(name);
      }
    });
  }
});

describe("A-10/A75 — reject 코퍼스는 canonicalize 거부(400 매핑)", () => {
  const files = readdirSync(join(CORPUS, "reject"));
  it("reject 코퍼스가 비어있지 않음", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const f of files) {
    it(`reject/${f} → canonicalize !ok`, () => {
      const content = readFileSync(join(CORPUS, "reject", f), "utf8");
      // reject 코퍼스는 name 검사 이전에 실패(polyglot/무결성) → expectedName 무관.
      const r = canonicalizeDefinition(content, "agent", "IGNORED-NAME");
      expect(r.ok, `${f} should reject`).toBe(false);
    });
  }
});
