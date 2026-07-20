// M8 F5 R1(codex) HIGH — openSafeFile 중간 세그먼트 스왑 TOCTOU(case5) 회귀.
// pre-walk 후 open 前 중간 dir 이 심링크로 스왑되면 realpath containment·leaf dev/ino 를 통과할 수
// 있으므로, open 이후 walk 전 세그먼트를 재-lstat 해 심링크化/dev·ino 변동을 무조건 거부(I6 통일).
// 실제 TOCTOU 는 레이스라 pre/post lstat 을 모킹해 재현(counts 로 pre=1회·post=2회 시점 구분).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({
  swapPath: null as string | null,
  mode: "symlink" as "symlink" | "devino",
  counts: new Map<string, number>(),
}));

// node:fs/promises 부분 모킹 — lstat 만 후킹(open/realpath 등은 실 파일시스템 그대로).
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    lstat: async (p: unknown, ...rest: unknown[]) => {
      // @ts-expect-error passthrough
      const st = await actual.lstat(p, ...rest);
      const key = String(p);
      if (ctl.swapPath && key === ctl.swapPath) {
        const n = (ctl.counts.get(key) ?? 0) + 1;
        ctl.counts.set(key, n);
        if (n >= 2) {
          // post-walk 재검증 시점 = walk↔open 사이 스왑 발생을 시뮬레이션.
          if (ctl.mode === "symlink") (st as unknown as { isSymbolicLink: () => boolean }).isSymbolicLink = () => true;
          else (st as unknown as { dev: number }).dev = st.dev + 4242;
        }
      }
      return st;
    },
  };
});

const { openSafeFile } = await import("../src/server/lib/servefile.js");

let root: string, base: string, mid: string;
const opts = { denyPath: () => false };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-toctou-"));
  base = join(root, "docs");
  mid = join(base, "mid");
  await mkdir(mid, { recursive: true });
  await writeFile(join(mid, "leaf.md"), "# leaf");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(() => { ctl.swapPath = null; ctl.counts.clear(); });

describe("case5 — openSafeFile 중간 세그먼트 스왑 TOCTOU(HIGH)", () => {
  it("no-swap: 스왑 없으면 정상 열람(ok:true) — false positive 없음", async () => {
    const r = await openSafeFile(root, base, ["mid", "leaf.md"], opts);
    expect(r.ok).toBe(true);
    if (r.ok) await r.fh.close();
  });

  it("case5(i): 중간 세그먼트 in-root 심링크로 스왑(open 후) → 거부", async () => {
    // in-root 심링크는 realpath containment·leaf dev/ino 를 통과하지만, post-walk 재검증이 거부.
    ctl.swapPath = mid; ctl.mode = "symlink";
    const r = await openSafeFile(root, base, ["mid", "leaf.md"], opts);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBeGreaterThanOrEqual(400); expect(r.error).toBe("path-changed"); }
  });

  it("case5(ii): 중간 세그먼트 out-root 심링크로 스왑 → 거부(위치 무관 심링크化 자체 거부)", async () => {
    ctl.swapPath = mid; ctl.mode = "symlink";
    const r = await openSafeFile(root, base, ["mid", "leaf.md"], opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("path-changed");
  });

  it("case5(iii): 중간 세그먼트 dev/ino 변동(실디렉토리 스왑, 비-심링크) → 거부", async () => {
    ctl.swapPath = mid; ctl.mode = "devino";
    const r = await openSafeFile(root, base, ["mid", "leaf.md"], opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("path-changed");
  });
});
