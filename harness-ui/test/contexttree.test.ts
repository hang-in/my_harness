// M15 F10 멀티런타임 트리 리더(HR1~HR7) — 런타임 라벨·심링크 거부·node_modules 대량 dir 바운드·신규 생성 경로안전.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextTree, ensureCreatePath, type ContextNode } from "../src/server/adapters/context.js";

let root: string, symlinkOk = true;

async function trySymlink(target: string, path: string, type: "file" | "dir"): Promise<boolean> {
  try { await symlink(target, path, type); return true; } catch { return false; }
}
function paths(nodes: ContextNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.path);
    if (n.type === "dir") out.push(...paths(n.children));
  }
  return out;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-ctx-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  await mkdir(join(root, ".claude", "skills", "alpha"), { recursive: true });
  await mkdir(join(root, ".codex", "agents"), { recursive: true });
  await mkdir(join(root, ".agents", "skills", "beta"), { recursive: true });
  await writeFile(join(root, "CLAUDE.md"), "# claude ctx\n");
  await writeFile(join(root, "AGENTS.md"), "# agents ctx\n");
  await writeFile(join(root, "GEMINI.md"), "# gemini ctx\n");
  await writeFile(join(root, ".claude", "agents", "a1.md"), "---\nname: a1\ndescription: d\n---\n");
  await writeFile(join(root, ".claude", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: d\n---\n");
  await writeFile(join(root, ".codex", "agents", "cx.toml"), 'name = "cx"\n');
  await writeFile(join(root, ".agents", "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: d\n---\n");
  // 시크릿·설정(거부 대상)
  await writeFile(join(root, ".claude", "settings.json"), "{}"); // .claude 직속 — 서브루트 아님(미노출)
  await writeFile(join(root, ".claude", "skills", "alpha", "id_rsa"), "PRIV"); // HR4 시크릿
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("A129 — 멀티런타임 수집·runtime 라벨", () => {
  it("top files 라벨 + 4 서브루트 present + 각 노드 runtime", async () => {
    const t = await contextTree(root);
    expect(t.topFiles.map((f) => [f.name, f.runtime, f.present])).toEqual([
      ["CLAUDE.md", "claude", true], ["AGENTS.md", "codex/agy", true], ["GEMINI.md", "agy", true],
    ]);
    const byPath = Object.fromEntries(t.roots.map((r) => [r.path, r]));
    expect(byPath[".claude/agents"]!.runtime).toBe("claude");
    expect(byPath[".codex/agents"]!.runtime).toBe("codex");
    expect(byPath[".agents/skills"]!.runtime).toBe("codex/agy");
    const all = t.roots.flatMap((r) => paths(r.children));
    expect(all).toContain(".claude/agents/a1.md");
    expect(all).toContain(".codex/agents/cx.toml");
    expect(all).toContain(".agents/skills/beta/SKILL.md");
  });
  it("HR2/HR4: .claude 직속 settings.json 미노출·스킬 dir 내 시크릿(id_rsa) 미노출", async () => {
    const all = (await contextTree(root)).roots.flatMap((r) => paths(r.children));
    expect(all.some((p) => p.includes("settings.json"))).toBe(false);
    expect(all.some((p) => p.includes("id_rsa"))).toBe(false);
  });
});

describe("HR7 보강(sec LOW-1) — count 에 디렉토리 노드 포함(broad empty-dir 상한 실효)", () => {
  it("count === 트리의 모든 dir+file 노드 합(파일만 카운트하지 않음)", async () => {
    await mkdir(join(root, ".claude", "skills", "alpha", "references"), { recursive: true }); // 빈 dir 노드
    await mkdir(join(root, ".agents", "skills", "beta", "sub"), { recursive: true });          // 빈 dir 노드
    const t = await contextTree(root);
    const totalNodes = t.roots.reduce((n, r) => n + paths(r.children).length, 0); // dir+file 전부
    expect(t.count).toBe(totalNodes);
    expect(totalNodes).toBeGreaterThan(0);
  });
});

describe("HR3 — 심링크/외부 리다이렉트 거부", () => {
  it("서브루트 하위 심링크 파일 미노출·직속 컨텍스트 파일 심링크→present:false", async () => {
    symlinkOk = await trySymlink("/etc/passwd", join(root, ".claude", "agents", "evil.md"), "file");
    if (!symlinkOk) return;
    const outside = await mkdtemp(join(tmpdir(), "hui-ctx-out-"));
    await writeFile(join(outside, "secret.md"), "SECRET");
    await symlink(join(outside, "secret.md"), join(root, "CLAUDE.md.link"), "file");
    // CLAUDE.md 를 외부로 심링크 교체
    await rm(join(root, "CLAUDE.md"));
    await symlink(join(outside, "secret.md"), join(root, "CLAUDE.md"), "file");
    const t = await contextTree(root);
    const all = t.roots.flatMap((r) => paths(r.children));
    expect(all.some((p) => p.includes("evil.md"))).toBe(false);       // 심링크 서브루트 파일 미노출
    expect(t.topFiles.find((f) => f.name === "CLAUDE.md")!.present).toBe(false); // 심링크 직속파일 거부
    await rm(outside, { recursive: true, force: true });
  });
});

describe("HR7 — node_modules 대량 dir 바운드·미순회", () => {
  it("스킬 dir 내 node_modules 는 트리에서 제외(대량 순회 안 함)", async () => {
    const nm = join(root, ".claude", "skills", "alpha", "node_modules", "pkg");
    await mkdir(nm, { recursive: true });
    for (let i = 0; i < 50; i++) await writeFile(join(nm, `f${i}.js`), "x");
    const all = (await contextTree(root)).roots.flatMap((r) => paths(r.children));
    expect(all.some((p) => p.includes("node_modules"))).toBe(false);
  });
});

describe("A126/HB5 — ensureCreatePath 신규 생성 경로안전", () => {
  it("신규 agent/skill leaf 미존재 → ok·경로 반환", async () => {
    const a = await ensureCreatePath(root, "agent", "newagent");
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.sourcePath).toBe(".claude/agents/newagent.md");
    const s = await ensureCreatePath(root, "skill", "newskill");
    if (s.ok) expect(s.sourcePath).toBe(".claude/skills/newskill/SKILL.md");
  });
  it("이름 충돌(기존 leaf 존재) → 409 name-collision", async () => {
    const a = await ensureCreatePath(root, "agent", "a1"); // .claude/agents/a1.md 존재
    expect(a).toMatchObject({ ok: false, code: 409, error: "name-collision" });
    const s = await ensureCreatePath(root, "skill", "alpha"); // .claude/skills/alpha/SKILL.md 존재
    expect(s).toMatchObject({ ok: false, code: 409, error: "name-collision" });
  });
  it("경로탈출 이름(../·메타) → 400 invalid-name", async () => {
    for (const n of ["../x", "a/b", ".hidden", "a b"]) {
      expect((await ensureCreatePath(root, "agent", n)).ok).toBe(false);
    }
  });
  it("부모(.claude/agents)가 심링크 → 400 parent-unsafe", async () => {
    await rm(join(root, ".claude", "agents"), { recursive: true, force: true });
    const outside = await mkdtemp(join(tmpdir(), "hui-ctx-out2-"));
    const ok = await trySymlink(outside, join(root, ".claude", "agents"), "dir");
    if (!ok) { await rm(outside, { recursive: true, force: true }); return; }
    const r = await ensureCreatePath(root, "agent", "newagent");
    expect(r).toMatchObject({ ok: false, error: "parent-unsafe" });
    await rm(outside, { recursive: true, force: true });
  });
});
