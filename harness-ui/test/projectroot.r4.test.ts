// M11 F3-root R4(codex HIGH) — D3 스코프 case-variant 스킵 봉쇄.
// 위협: R3 에서 D3 스코프를 lexical/real 이중 앵커로 넓혔으나 "below 여부"를 여전히 relative()
//   (대소문자 구분) 문자열 검사로 판정했다. macOS(APFS·case-insensitive)/Windows 에서 입력이
//   /Users/x/projects/link 인데 projectsHome 이 /users/x/projects(대소문자만 다른 동일 경로)면
//   relative(realHome, input) 이 대소문자 구분이라 하위가 아니라 판단 → D3 를 통째 스킵(하위 lstat·
//   최종 reparse 비교까지) → 이후 D2 canonical realpath containment 가 in-root 심링크/reparse 를
//   marker 와 함께 통과. 신 D3 는 스코프 prefix 판정을 samePath 와 동일한 플랫폼 인지 대소문자
//   규칙(subSegmentsUnder)으로 통일 → case-variant 입력도 하위로 인지하고 스캔·거부.
// Linux 는 case-sensitive 환경이라 case-insensitive FS 를 platform=darwin 모킹 + fs case-fold 모킹으로
//   시뮬레이션한다(caseMap: variant→canonical). lstat/realpath/stat 은 canonical 로 폴드해 실 FS 접근.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({ caseMap: {} as Record<string, string> }));

// node:fs/promises 부분 모킹 — variant-cased 입력을 canonical 로 폴드(case-insensitive FS 시뮬).
//   caseMap 미등록 경로는 그대로 전달(정상 canonical 접근). lstat/stat/realpath 모두 폴드.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fold = (p: unknown) => ctl.caseMap[String(p)] ?? String(p);
  return {
    ...actual,
    default: actual,
    realpath: (async (p: unknown, ...rest: unknown[]) =>
      // @ts-expect-error passthrough
      actual.realpath(fold(p), ...rest)) as typeof actual.realpath,
    lstat: (async (p: unknown, ...rest: unknown[]) =>
      // @ts-expect-error passthrough
      actual.lstat(fold(p), ...rest)) as typeof actual.lstat,
    stat: (async (p: unknown, ...rest: unknown[]) =>
      // @ts-expect-error passthrough
      actual.stat(fold(p), ...rest)) as typeof actual.stat,
  };
});

const { validateProjectRoot, subSegmentsUnder } = await import("../src/server/lib/projectroot.js");

// 실 위치(canonical)의 대소문자를 뒤집어 case-variant home prefix 를 만든다.
function flipCase(s: string): string {
  return s.replace(/[a-zA-Z]/, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
}

// ── 순수 함수: 스코프 prefix 판정 대소문자 규칙(samePath 와 동일 의미론) ──────────────────────
describe("subSegmentsUnder 플랫폼 인지 prefix 판정 (F3-root R4)", () => {
  const orig = process.platform;
  const setPlatform = (p: string) => Object.defineProperty(process, "platform", { value: p, configurable: true });
  afterEach(() => setPlatform(orig));

  it("darwin: case-variant 하위도 진하위로 인지 → tail 세그먼트(실제 입력 대소문자)", () => {
    setPlatform("darwin");
    expect(subSegmentsUnder("/Users/x/projects", "/users/x/PROJECTS/link")).toEqual(["link"]);
  });
  it("win32: 대소문자·구분자 무시 진하위 → tail", () => {
    setPlatform("win32");
    expect(subSegmentsUnder("C:\\Users\\x\\projects", "c:/users/X/projects/app")).toEqual(["app"]);
  });
  it("linux: case-variant 는 진하위 아님(정확 비교) → null", () => {
    setPlatform("linux");
    expect(subSegmentsUnder("/home/u/projects", "/home/u/PROJECTS/link")).toBeNull();
    expect(subSegmentsUnder("/home/u/projects", "/home/u/projects/link")).toEqual(["link"]);
  });
  it("세그먼트 경계 존중(부분 문자열 오탐 금지): /a/b vs /a/bc/x → null", () => {
    setPlatform("linux");
    expect(subSegmentsUnder("/a/b", "/a/bc/x")).toBeNull();
  });
  it("동일/상위는 진하위 아님 → null", () => {
    setPlatform("linux");
    expect(subSegmentsUnder("/a/b", "/a/b")).toBeNull();
    expect(subSegmentsUnder("/a/b/c", "/a/b")).toBeNull();
  });
});

// ── 통합: case-variant home prefix + in-root 심링크/reparse → 거부(darwin 시뮬) ──────────────
describe("validateProjectRoot D3 case-variant 스코프 스캔 (F3-root R4)", () => {
  const orig = process.platform;
  const setPlatform = (p: string) => Object.defineProperty(process, "platform", { value: p, configurable: true });
  let home: string; // canonical projectsHome 실 위치

  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), "hui-r4-")));
    ctl.caseMap = {};
    setPlatform("darwin"); // case-insensitive FS 시뮬
  });
  afterEach(async () => {
    setPlatform(orig);
    ctl.caseMap = {};
    await rm(home, { recursive: true, force: true });
  });

  it("R4: case-variant home prefix + in-root 심링크 입력 → symlink 거부", async () => {
    const target = join(home, "secret");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "CLAUDE.md"), "# marker\n"); // 위장 대상에 마커까지 있어도 거부돼야
    const link = join(home, "link");
    try { await symlink(target, link, "dir"); }
    catch { return; } // 심링크 불가 환경 skip
    // 입력 = home prefix 대소문자만 뒤집은 case-variant. 종전 relative() 판정이면 D3 스킵됐다.
    const variant = flipCase(home) + "/link";
    ctl.caseMap[variant] = link; // case-fold → canonical link (심링크 그대로 → realpath 는 target)

    const v = await validateProjectRoot(variant, home);
    expect(v).toMatchObject({ ok: false, error: "symlink" });
  });

  it("R4 ACCEPT(오거부 0): case-variant home prefix + 정규 하위 dir → ok", async () => {
    const app = join(home, "app");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "CLAUDE.md"), "# marker\n");
    const variant = flipCase(home) + "/app";
    ctl.caseMap[variant] = app; // case-fold → canonical dir(심링크 아님)

    const v = await validateProjectRoot(variant, home);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.effectiveRoot).toBe(app);
  });

  it("R4 회귀: case-exact 정규 하위 dir → ok(오거부 0)", async () => {
    const app = join(home, "app2");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "CLAUDE.md"), "# marker\n");
    const v = await validateProjectRoot(app, home);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.effectiveRoot).toBe(app);
  });
});
