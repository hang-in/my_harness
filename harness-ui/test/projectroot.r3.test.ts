// M11 F3-root R3(codex HIGH) — D3 canonical-path 입력서 스킵 봉쇄.
// 위협: projectsHome 이 심링크/alias(/var/projects)이고 입력이 canonical(realHome=/private/var/projects
// prefix)로 들어오면 종전 D3 는 relative(lexicalHome, input) 이 하위가 아니라 판단해 D3 를 통째 스킵했다.
// 이후 D2 는 realHome 앵커라 out-root 만 차단 → 하위 in-root reparse(junction analog)가 marker 만
// 있으면 통과. 신 D3 는 lexical projectsHome OR realHome 양쪽 기준으로 하위 스코프를 판정, 어느 앵커
// 하위든 realHome 앵커로 세그먼트 lstat + 최종 realpath(input)≠lexical 비교(reparse-point fail-closed).
// junction 은 lstat.isSymbolicLink()=false(디렉토리 위장)로 재현(reparse.test 패턴 재사용).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({ juncPath: null as string | null }));

// node:fs/promises 부분 모킹 — lstat 만 후킹(realpath 등 실 파일시스템). juncPath 는 심링크지만
// junction 처럼 "비-심링크 디렉토리"로 위장 → readlink 아닌 realpath 비교가 판정.
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
  };
});

const { validateProjectRoot } = await import("../src/server/lib/projectroot.js");

describe("validateProjectRoot D3 canonical-path 입력 스캔 (F3-root R3)", () => {
  let realHome: string;   // canonical projectsHome 실 위치(=realpath)
  let aliasParent: string;
  let alias: string;      // realHome 을 가리키는 심링크(/var/projects analog)

  beforeEach(async () => {
    // realHome 을 canonical 로 확보(tmpdir 이 심링크인 플랫폼서도 안정).
    realHome = await realpath(await mkdtemp(join(tmpdir(), "hui-r3h-")));
    aliasParent = await realpath(await mkdtemp(join(tmpdir(), "hui-r3a-")));
    alias = join(aliasParent, "projects"); // /var/projects analog
    ctl.juncPath = null;
  });
  afterEach(async () => {
    ctl.juncPath = null;
    await rm(realHome, { recursive: true, force: true });
    await rm(aliasParent, { recursive: true, force: true });
  });

  it("R3: projectsHome=alias·입력=canonical(realHome prefix)·하위 in-root reparse → reparse-point", async () => {
    try { await symlink(realHome, alias, "dir"); }
    catch { return; } // 심링크 불가 환경 skip
    // realHome/real(위장 대상·마커까지 존재) + realHome/junc(대상=real·junction analog).
    const target = join(realHome, "real");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "CLAUDE.md"), "# marker\n");
    const junc = join(realHome, "junc");
    try { await symlink(target, junc, "dir"); }
    catch { return; }
    ctl.juncPath = junc; // lstat.isSymbolicLink()=false 위장

    // 입력은 canonical(realHome prefix)·projectsHome 은 alias(심링크) → 종전 D3 스킵 갭.
    const v = await validateProjectRoot(junc, alias);
    expect(v).toMatchObject({ ok: false, error: "reparse-point" });
  });

  it("R3 ACCEPT(오거부 0): projectsHome=alias·입력=canonical 정규 하위 dir → ok", async () => {
    try { await symlink(realHome, alias, "dir"); }
    catch { return; }
    const app = join(realHome, "app");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "CLAUDE.md"), "# marker\n");
    // canonical 입력(realHome prefix)이지만 정규 dir → reparse 오거부 아님.
    const v = await validateProjectRoot(app, alias);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.effectiveRoot).toBe(app);
  });

  it("R3 회귀: projectsHome=alias·입력=alias prefix(lexical) 정규 하위 dir → ok(오거부 0)", async () => {
    try { await symlink(realHome, alias, "dir"); }
    catch { return; }
    const app = join(realHome, "app2");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "CLAUDE.md"), "# marker\n");
    // lexical alias prefix 입력(정상 /var alias 경로) → 계속 ACCEPT.
    const v = await validateProjectRoot(join(alias, "app2"), alias);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.effectiveRoot).toBe(app);
  });
});
