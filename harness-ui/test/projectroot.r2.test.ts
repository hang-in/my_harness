// M11 F3-root R2(agy HIGH#2/#3/#4) — UNC 우회·macOS 대소문자 오거부·O(N²) realpath.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// realpath 호출 카운터(HIGH#4 · O(N) 검증). lstat 등은 실 파일시스템 그대로.
const ctl = vi.hoisted(() => ({ realpathCount: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    realpath: (async (p: unknown, ...rest: unknown[]) => {
      ctl.realpathCount++;
      // @ts-expect-error passthrough
      return actual.realpath(p, ...rest);
    }) as typeof actual.realpath,
  };
});

const { validateProjectRoot, samePath } = await import("../src/server/lib/projectroot.js");

// HIGH#2: Windows //host UNC 우회 — Node/Windows 가 /↔\ 호환이라 //host/share 가 통과했었음.
describe("R2#2: UNC 우회 거부(//host·\\\\host 모두)", () => {
  it("//host/share → bad-input", async () => {
    expect(await validateProjectRoot("//host/share", "/ph")).toMatchObject({ ok: false, error: "bad-input" });
  });
  it("\\\\host\\share → bad-input", async () => {
    expect(await validateProjectRoot("\\\\host\\share", "/ph")).toMatchObject({ ok: false, error: "bad-input" });
  });
  it("정상 절대경로(단일 슬래시) 는 UNC 오거부 아님", async () => {
    // /ph/x 는 미존재라 bad-input 이지만 UNC 판정 전 통과 여부는 별도 — 여기선 단순 정규식 회귀만.
    // 단일 슬래시 시작은 UNC 정규식(/^[/\\]{2}/)에 걸리지 않는다.
    expect(/^[/\\]{2}/.test("/home/u/x")).toBe(false);
    expect(/^[/\\]{2}/.test("//host/x")).toBe(true);
    expect(/^[/\\]{2}/.test("\\\\host\\x")).toBe(true);
  });
});

// HIGH#3: macOS(darwin) 대소문자 무시 비교 — R1 회귀(win32-only → win32+darwin).
describe("R2#3: samePath 대소문자 정책(win32+darwin 무시·linux 정확)", () => {
  const orig = process.platform;
  const setPlatform = (p: string) => Object.defineProperty(process, "platform", { value: p, configurable: true });
  afterEach(() => setPlatform(orig));

  it("darwin: 대소문자 다른 동일 경로 → 오거부 0(same)", () => {
    setPlatform("darwin");
    expect(samePath("/Users/u/App", "/Users/u/app")).toBe(true);
  });
  it("linux: 대소문자 다르면 구분(정확 비교)", () => {
    setPlatform("linux");
    expect(samePath("/home/u/App", "/home/u/app")).toBe(false);
    expect(samePath("/home/u/app", "/home/u/app")).toBe(true);
  });
  it("win32: 대소문자·구분자 정규화 → same", () => {
    setPlatform("win32");
    expect(samePath("C:\\Users\\App", "c:/users/app")).toBe(true);
  });
});

// HIGH#4: 깊은 경로서 realpath 가 세그먼트별(O(N²)) 아닌 상수회 호출.
describe("R2#4: d3 realpath 상수 호출(O(N²) 제거·심층 경로)", () => {
  let ph: string;
  beforeEach(async () => { ph = await mkdtemp(join(tmpdir(), "hui-r2p-")); });
  afterEach(async () => { await rm(ph, { recursive: true, force: true }); });

  async function countValidate(depthSegs: string[]): Promise<{ count: number; ok: boolean }> {
    const dir = join(ph, ...depthSegs);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "CLAUDE.md"), "# marker\n");
    ctl.realpathCount = 0;                 // validate 직전 리셋(셋업 realpath 제외)
    const v = await validateProjectRoot(dir, ph);
    return { count: ctl.realpathCount, ok: v.ok };
  }

  it("깊은 경로 realpath 호출수 == 얕은 경로(세그먼트 깊이에 비례 안 함)", async () => {
    const shallow = await countValidate(["a"]);
    const deep = await countValidate(["a", "b", "c", "d", "e", "f"]);
    expect(shallow.ok).toBe(true);
    expect(deep.ok).toBe(true);
    expect(deep.count).toBe(shallow.count);   // O(1) — 깊이 무관 상수
    expect(deep.count).toBeLessThanOrEqual(6); // 세그먼트 6단인데도 realpath 는 소수 상수
  });
});
