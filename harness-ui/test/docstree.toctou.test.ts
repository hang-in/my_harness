// M14 F9 R2(codex HIGH) — docsTree 트리 walk 의 in-request TOCTOU(검증↔readdir 레이스) 폐쇄 실증.
// 위협: walk() 가 dir 검증(lstat·realpath) 후 readdir(dir) 하는 사이 그 dir 이 out-root 심링크/junction
//   으로 스왑되면 외부 디렉토리 엔트리를 읽는다. 파일 열람(openSafeFile)은 pre/post dev·ino 바인딩으로
//   닫지만 트리 walk 엔 없었다 → 이제 walk 도 pre/post lstat(dev·ino)+realpath 재검증으로 폐기.
// 레이스는 결정적 재현이 어려우므로 lstat/readdir 모킹으로 "검증 후 readdir 직전 스왑"을 시뮬한다.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({
  raceDir: null as string | null, // 레이스 시뮬 대상(절대경로)
  mode: "none" as "none" | "devino" | "symlink",
  swapped: false,                 // readdir(raceDir) 호출 시 true 로 전환(검증 후 스왑 시뮬)
}));

// node:fs/promises 부분 모킹 — lstat/readdir 만 후킹(realpath 등 실 FS). raceDir 에 한해:
//   - readdir(raceDir): out-root 스왑된 dir 을 읽은 것처럼 조작 엔트리 반환 + swapped=true 전환.
//   - lstat(raceDir): swapped 이전(pre) 정상, 이후(post) 스왑 시뮬(devino=다른 ino / symlink=심링크化).
//   → 검증(pre lstat) 정상 통과 → readdir 이 외부 엔트리 반환 + 스왑 발생 → post lstat 이 스왑 탐지.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fakeDirent = (name: string, kind: "file" | "dir") => ({
    name,
    isSymbolicLink: () => false,
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
  });
  return {
    ...actual,
    default: actual,
    lstat: async (p: unknown, ...rest: unknown[]) => {
      // @ts-expect-error passthrough
      const st = await actual.lstat(p, ...rest);
      if (ctl.raceDir && String(p) === ctl.raceDir && ctl.mode !== "none" && ctl.swapped) {
        const fake = Object.create(Object.getPrototypeOf(st));
        Object.assign(fake, st);
        if (ctl.mode === "devino") {
          fake.ino = (st.ino ?? 0) + 987654; // pre 와 다른 ino(=dir 교체)
          fake.isSymbolicLink = () => false;
          fake.isDirectory = () => true;
        } else { // symlink 화
          fake.isSymbolicLink = () => true;
          fake.isDirectory = () => false;
        }
        return fake;
      }
      return st;
    },
    readdir: async (p: unknown, ...rest: unknown[]) => {
      if (ctl.raceDir && String(p) === ctl.raceDir && ctl.mode !== "none") {
        ctl.swapped = true; // 검증 후 readdir 시점에 스왑 발생
        return [fakeDirent("SECRET.md", "file"), fakeDirent("evil", "dir")] as never;
      }
      // @ts-expect-error passthrough
      return actual.readdir(p, ...rest);
    },
  };
});

const { docsTree } = await import("../src/server/adapters/docs.js");

let root: string, docs: string;
function collect(nodes: any[]): string[] {
  const out: string[] = [];
  const rec = (ns: any[]) => { for (const n of ns) { out.push(n.path); if (n.type === "dir") rec(n.children); } };
  rec(nodes);
  return out;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-toctou-"));
  docs = join(root, "docs");
  await mkdir(join(docs, "normal"), { recursive: true });
  await writeFile(join(docs, "top.md"), "# top");
  await writeFile(join(docs, "normal", "in.md"), "# in");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(() => { ctl.raceDir = null; ctl.mode = "none"; ctl.swapped = false; });

describe("R2 codex HIGH — walk 검증↔readdir 레이스 폐쇄(pre/post dev·ino + realpath)", () => {
  it("레이스 없음(회귀): 정상 트리 결과 불변", async () => {
    const t = await docsTree(root);
    const paths = collect(t.tree);
    expect(paths).toContain("top.md");
    expect(paths).toContain("normal");
    expect(paths).toContain("normal/in.md");
    expect(paths.some((p) => p.includes("SECRET"))).toBe(false);
  });

  it("[HIGH-1] 자식 dir devino 스왑 → 노드 통째 제외(빈 노드로도 미잔존)·주입 엔트리 제외", async () => {
    ctl.raceDir = join(docs, "normal");
    ctl.mode = "devino";
    const t = await docsTree(root);
    const paths = collect(t.tree);
    // 스왑된 normal 의 out-root 엔트리(SECRET.md/evil)는 결과에 없어야(fail-closed)
    expect(paths.some((p) => p.includes("SECRET"))).toBe(false);
    expect(paths.some((p) => p.includes("evil"))).toBe(false);
    // 게이트 계약(HIGH-1): 레이스 감지된 노드 자체를 제외 — 빈 children 노드로도 남기지 않는다.
    expect(paths).not.toContain("normal");
    expect(t.tree.find((n: any) => n.path === "normal")).toBeUndefined();
    // 형제(정상)는 유지
    expect(paths).toContain("top.md");
  });

  it("[HIGH-1] 자식 dir 이 심링크로 스왑(post lstat isSymbolicLink) → 노드 제외", async () => {
    ctl.raceDir = join(docs, "normal");
    ctl.mode = "symlink";
    const t = await docsTree(root);
    const paths = collect(t.tree);
    expect(paths.some((p) => p.includes("SECRET"))).toBe(false);
    expect(paths.some((p) => p.includes("evil"))).toBe(false);
    expect(paths).not.toContain("normal"); // 제외(빈 노드로도 미잔존)
    expect(paths).toContain("top.md");
  });

  it("base(루트) devino 스왑 → 전체 트리 폐기(외부 엔트리 미방출)", async () => {
    ctl.raceDir = docs;
    ctl.mode = "devino";
    const t = await docsTree(root);
    expect(t.tree).toEqual([]);
    expect(collect(t.tree).some((p) => p.includes("SECRET"))).toBe(false);
  });
});
