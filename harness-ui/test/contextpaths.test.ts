// M15 F10 읽기 화이트리스트 순수 규칙 — classifyContextPath(HR1/HR2)·deniedContextPath(HR2/HR4/HR7).
//   전역 DENY/deniedDocsPath 미수정 회귀 + dot-prefix 함정(3 dot-dir만 정밀 허용) 검증.
import { describe, it, expect } from "vitest";
import { classifyContextPath, deniedContextPath } from "../src/server/lib/contextpaths.js";
import { deniedDocsPath, deniedPath } from "../src/server/security.js";

const segs = (p: string) => p.split("/");

describe("A121/HR1·HR2 — classifyContextPath 화이트리스트 + runtime 라벨", () => {
  it("ACCEPT: projectRoot 직속 컨텍스트 파일 라벨(CLAUDE=claude·AGENTS=codex/agy·GEMINI=agy)", () => {
    expect(classifyContextPath(segs("CLAUDE.md"))?.runtime).toBe("claude");
    expect(classifyContextPath(segs("AGENTS.md"))?.runtime).toBe("codex/agy");
    expect(classifyContextPath(segs("GEMINI.md"))?.runtime).toBe("agy");
  });
  it("ACCEPT: 정밀 서브루트 + 런타임 라벨(.agents/skills=codex/agy 공유)", () => {
    expect(classifyContextPath(segs(".claude/agents/x.md"))?.runtime).toBe("claude");
    expect(classifyContextPath(segs(".claude/skills/y/SKILL.md"))?.runtime).toBe("claude");
    expect(classifyContextPath(segs(".codex/agents/z.toml"))?.runtime).toBe("codex");
    expect(classifyContextPath(segs(".agents/skills/w/SKILL.md"))?.runtime).toBe("codex/agy");
  });
  it("REJECT: 서브루트 dir 자체(leaf 부재)·비허용 둘째 세그먼트·홈 전역·탈출", () => {
    for (const p of [
      ".claude", ".claude/agents", ".codex/agents", // leaf 부재
      ".claude/settings.json", ".claude/tmp/x", ".codex/config", ".codex/skills/a", // 비허용 서브
      ".agents/agents/a.md",  // .agents 는 skills 만
      ".git/config", ".env", ".ssh/id_rsa", ".gemini/x", // 화이트리스트 밖 dot
      "docs/readme.md", "package.json", // 비-컨텍스트
    ]) {
      expect(classifyContextPath(segs(p)), `must reject: ${p}`).toBeNull();
    }
  });
});

describe("A121/HR2·HR4·HR7 — deniedContextPath denylist(독립·전역 미수정)", () => {
  it("ACCEPT(비차단): 3 dot-dir 첫 세그먼트 + 컨텍스트 파일", () => {
    for (const p of [".claude/agents/x.md", ".codex/agents/z.toml", ".agents/skills/w/SKILL.md",
      "CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
      expect(deniedContextPath(p), `must accept: ${p}`).toBe(false);
    }
  });
  it("REJECT: 화이트리스트 밖 dot(첫 세그먼트/중첩)·시크릿·node_modules 류(HR7)", () => {
    for (const p of [
      ".env", ".git/config", ".ssh/id_rsa", ".gemini/x",           // 첫 세그먼트 dot
      ".claude/skills/s/.hidden/x", ".claude/agents/.secret",       // 중첩 dot
      ".claude/agents/foo.key", ".claude/skills/s/id_rsa",          // 시크릿(HR4)
      ".claude/skills/s/node_modules/p.js", ".agents/skills/w/venv/x", // HR7 대량 dir
      ".claude/skills/s/.venv/x", ".claude/skills/s/__pycache__/c", ".claude/skills/s/dist/b",
    ]) {
      expect(deniedContextPath(p), `must deny: ${p}`).toBe(true);
    }
  });
});

describe("전역 방어 미수정 회귀(R1 agy MED) — deniedDocsPath/deniedPath 불변", () => {
  it("deniedDocsPath 는 여전히 모든 dot-prefix 거부(.claude 포함)", () => {
    expect(deniedDocsPath(".claude/agents/x.md")).toBe(true); // F5 뷰어는 .claude 안 엶(불변)
    expect(deniedDocsPath(".env")).toBe(true);
    expect(deniedDocsPath("docs/readme.md")).toBe(false);
  });
  it("deniedPath(artifact) 는 여전히 dot·node_modules·토큰 거부", () => {
    expect(deniedPath(".claude/x")).toBe(true);
    expect(deniedPath("a/node_modules/b")).toBe(true);
  });
});
