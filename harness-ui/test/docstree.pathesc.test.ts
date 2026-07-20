// M8 F5 R2(codex) HIGH — docs 트리 walk 경로탈출(Windows junction/reparse out-root).
// 위협: lstat/isSymbolicLink 이 junction 을 미탐(디렉토리로 보고)하지만 realpath 는 out-root 로
// 해석하는 상황. 트리 walk 가 각 하위 dir 재귀 前 realpath containment(isWithinRoot)로 재검증하지
// 않으면 docs 밖 트리를 나열·재귀한다. Linux symlink 은 isSymbolicLink 로 이미 걸리므로,
// junction 을 재현하기 위해 lstat/readdir dirent 의 isSymbolicLink 를 false 로 모킹한다(AS4/V16).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({ juncPath: null as string | null, juncName: "junc" }));

// node:fs/promises 부분 모킹 — lstat/readdir 만 후킹(realpath 등은 실 파일시스템 그대로 → junction
// 이 out-root 로 해석되게). juncPath 는 심링크지만 junction 처럼 "비-심링크 디렉토리"로 위장한다.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    lstat: async (p: unknown, ...rest: unknown[]) => {
      // @ts-expect-error passthrough
      const st = await actual.lstat(p, ...rest);
      if (ctl.juncPath && String(p) === ctl.juncPath) {
        (st as unknown as { isSymbolicLink: () => boolean }).isSymbolicLink = () => false;
        (st as unknown as { isDirectory: () => boolean }).isDirectory = () => true;
      }
      return st;
    },
    readdir: async (p: unknown, ...rest: unknown[]) => {
      // @ts-expect-error passthrough
      const ents = await actual.readdir(p, ...rest);
      for (const e of ents as unknown[]) {
        if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === ctl.juncName) {
          const d = e as unknown as { isSymbolicLink: () => boolean; isDirectory: () => boolean; isFile: () => boolean };
          d.isSymbolicLink = () => false;
          d.isDirectory = () => true;
          d.isFile = () => false;
        }
      }
      return ents;
    },
  };
});

const { docsTree } = await import("../src/server/adapters/docs.js");

let root: string, docs: string, outside: string, symlinkOk = true;

function collect(nodes: any[]): string[] {
  const out: string[] = [];
  const rec = (ns: any[]) => { for (const n of ns) { out.push(n.path); if (n.type === "dir") rec(n.children); } };
  rec(nodes);
  return out;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-treeesc-"));
  docs = join(root, "docs");
  outside = join(root, "outside"); // docs 밖(white-root 밖)
  await mkdir(join(docs, "normal"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(docs, "top.md"), "# top");
  await writeFile(join(docs, "normal", "in.md"), "# in");
  await writeFile(join(outside, "secret.md"), "SECRET OUT-OF-ROOT");
  try { await symlink(outside, join(docs, "junc"), "dir"); } catch { symlinkOk = false; }
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(() => { ctl.juncPath = null; });

describe("R2 HIGH — docs 트리 walk realpath containment(out-root junction 제외)", () => {
  it("정상 하위 dir/파일은 나열(false positive 없음)", async () => {
    const t = await docsTree(root);
    const paths = collect(t.tree);
    expect(paths).toContain("top.md");
    expect(paths).toContain("normal");
    expect(paths).toContain("normal/in.md");
  });

  it("out-root junction(비-심링크로 위장) → 트리에서 제외·재귀 안 함(secret 미노출)", async () => {
    if (!symlinkOk) return;
    ctl.juncPath = join(docs, "junc"); // junction 시뮬레이션(lstat/dirent 비-심링크)
    const t = await docsTree(root);
    const paths = collect(t.tree);
    // realpath(junc)=outside 가 docs 밖 → 나열/재귀 금지
    expect(paths).not.toContain("junc");
    expect(paths.some((p) => p.includes("secret"))).toBe(false);
    // 정상 트리는 유지
    expect(paths).toContain("normal/in.md");
  });

  it("in-root Linux 심링크 dir 은 isSymbolicLink 로 이미 제외(회귀)", async () => {
    if (!symlinkOk) return;
    // junc 를 모킹하지 않으면 실제 심링크 → e.isSymbolicLink()=true 로 skip
    const t = await docsTree(root);
    const paths = collect(t.tree);
    expect(paths).not.toContain("junc");
  });
});
