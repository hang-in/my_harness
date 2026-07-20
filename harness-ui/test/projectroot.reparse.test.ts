// M11 F3-root R1(codex HIGH) — D3 Windows reparse fail-closed.
// 위협: junction/mount·in-root reparse 는 lstat.isSymbolicLink()=false(디렉토리로 위장)이지만
// realpath 는 다른 경로로 해석된다. 구(舊) D3 는 readlink 성공 여부로만 판정 → readlink 비노출
// reparse(junction) 나 in-root reparse 가 통과. 신(新) D3 는 하위 세그먼트별 realpath ≠ lexical
// 비교로 fail-closed(readlink 의존 제거). Linux 에선 symlink 을 만들되 lstat.isSymbolicLink 를
// false 로 모킹해 junction(비-심링크 reparse)을 재현한다(AS4/V16 · docstree.pathesc 패턴 재사용).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({ juncPath: null as string | null }));

// node:fs/promises 부분 모킹 — lstat 만 후킹(realpath 등은 실 파일시스템 그대로 → junction 이
// 대상으로 해석되게). juncPath 는 심링크지만 junction 처럼 "비-심링크 디렉토리"로 위장.
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
    // junction/mount 은 readlink 미노출(EINVAL) — 구 D3 의 readlink 감지를 무력화하는 정확한 갭.
    readlink: async (p: unknown, ...rest: unknown[]) => {
      if (ctl.juncPath && String(p) === ctl.juncPath) {
        const e = new Error("EINVAL: invalid argument, readlink") as NodeJS.ErrnoException;
        e.code = "EINVAL";
        throw e;
      }
      // @ts-expect-error passthrough
      return actual.readlink(p, ...rest);
    },
  };
});

const { validateProjectRoot } = await import("../src/server/lib/projectroot.js");

describe("validateProjectRoot D3 reparse fail-closed (F3-root R1)", () => {
  let ph: string;

  beforeEach(async () => {
    ph = await realpath(await mkdtemp(join(tmpdir(), "hui-rep-")));
    ctl.juncPath = null;
  });
  afterEach(async () => {
    ctl.juncPath = null;
    await rm(ph, { recursive: true, force: true });
  });

  it("D3(b): 하위 세그먼트 realpath ≠ lexical(junction analog · lstat=비심링크 dir) → reparse-point", async () => {
    // in-root 대상(realpath 는 root 안에 머묾) — D2 containment 로는 못 막는 in-root reparse.
    const target = join(ph, "real");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "CLAUDE.md"), "# marker\n"); // 위장 대상에 마커까지 있어도 거부돼야
    const junc = join(ph, "junc");
    try { await symlink(target, junc, "dir"); }
    catch { return; } // 심링크 불가 환경 skip
    ctl.juncPath = junc; // lstat.isSymbolicLink()=false 로 위장 → readlink 아닌 realpath 비교가 판정

    const v = await validateProjectRoot(junc, ph);
    expect(v).toMatchObject({ ok: false, error: "reparse-point" });
  });

  it("D3(b'): 정규 하위 dir(realpath == lexical · 모킹 없음) → reparse 오거부 아님(통과)", async () => {
    // 회귀 가드: 정규 디렉토리는 reparse-point 로 오거부되지 않아야(오거부 0).
    const app = join(ph, "app");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "CLAUDE.md"), "# marker\n");
    const v = await validateProjectRoot(app, ph);
    expect(v.ok).toBe(true);
  });
});
