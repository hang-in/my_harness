// M11 F3.7 config R5(codex HIGH) — strict RMW open 실패 시 기존 config 덮음 봉쇄.
// 위협: readConfigRaw(strict=true) 가 모든 open 실패를 catch 해 항상 {} 반환 → 기존 config.json 이
//   EACCES/EPERM/ELOOP(심링크 O_NOFOLLOW)/ENOTDIR 등으로 못 읽히는 비정상 상태면 strict read 가
//   fail-fast 안 하고 projectRoot 만 있는 신선 config 로 RMW→atomic write 해 기존 파일을 교체
//   (definitionEditEnabled/evals/미래 필드 보존 계약 붕괴).
// 수정: open catch 에서 ENOENT(부재)만 신선 {}, strict 서 그 외는 throw(교체 중단). 비-strict 조회는
//   안전 기본값(쓰기 아님) 유지. config read 는 numeric flags(O_RDONLY|O_NOFOLLOW) — 격리 카운트.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({ failCode: null as string | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    open: (async (path: unknown, flags?: unknown, ...rest: unknown[]) => {
      // config read 만 numeric flags. 주입된 코드로 실패시켜 open 오류 경로를 재현(atomic 쓰기는 string flags).
      if (ctl.failCode && typeof flags === "number" && String(path).endsWith("config.json")) {
        const e = new Error(`mock-${ctl.failCode}`) as NodeJS.ErrnoException;
        e.code = ctl.failCode;
        throw e;
      }
      // @ts-expect-error passthrough
      return actual.open(path, flags, ...rest);
    }) as typeof actual.open,
  };
});

const { updateConfig, configPath, loadConfigFromDisk } = await import("../src/server/lib/config.js");

describe("config strict RMW open 실패 봉쇄(기존 config 미교체 · F3.7 R5)", () => {
  let stateDir: string;
  const origState = process.env.HARNESS_STATE_HOME;
  const origHome = process.env.HARNESS_PROJECTS_HOME;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "hui-cfg-r5-"));
    process.env.HARNESS_STATE_HOME = stateDir;
    delete process.env.HARNESS_PROJECTS_HOME;
    ctl.failCode = null;
  });
  afterEach(async () => {
    ctl.failCode = null;
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    if (origHome === undefined) delete process.env.HARNESS_PROJECTS_HOME; else process.env.HARNESS_PROJECTS_HOME = origHome;
    await rm(stateDir, { recursive: true, force: true });
  });

  it("R5(a): 판독불가(EACCES) 기존 config → strict updateConfig throw·디스크 원문 무변경", async () => {
    const existing = JSON.stringify({
      schemaVersion: "1", projectsHome: "/ph", definitionEditEnabled: true,
      evals: { threshold: 0.9 }, futureField: "keep",
    });
    await writeFile(configPath(), existing, "utf8");
    ctl.failCode = "EACCES";
    await expect(updateConfig({ projectRoot: "/ph/app" })).rejects.toThrow();
    ctl.failCode = null;
    // 기존 판독불가 config 를 {} 기반 신선분으로 덮지 않았음 — 원문 그대로.
    expect(await readFile(configPath(), "utf8")).toBe(existing);
  });

  it("R5(a'): EPERM 도 strict throw(판독불가 전반 봉쇄)", async () => {
    const existing = JSON.stringify({ schemaVersion: "1", definitionEditEnabled: true });
    await writeFile(configPath(), existing, "utf8");
    ctl.failCode = "EPERM";
    await expect(updateConfig({ projectRoot: "/ph/app" })).rejects.toThrow();
    ctl.failCode = null;
    expect(await readFile(configPath(), "utf8")).toBe(existing);
  });

  // O_NOFOLLOW/ELOOP 심링크 거부는 POSIX 전용 semantics — Windows 는 동작 상이(win32 skip).
  (process.platform === "win32" ? it.skip : it)("R5(b): 심링크 config(O_NOFOLLOW→ELOOP) → strict updateConfig throw·타겟 원문 무변경", async () => {
    // config.json 을 심링크로 만들면 O_NOFOLLOW open 이 ELOOP 로 실패(실 fs 동작·mock 불필요).
    const target = join(stateDir, "real-config.json");
    const orig = JSON.stringify({ schemaVersion: "1", definitionEditEnabled: true, evals: { threshold: 0.7 } });
    await writeFile(target, orig, "utf8");
    await symlink(target, configPath());
    await expect(updateConfig({ projectRoot: "/ph/app" })).rejects.toThrow();
    // 심링크 타겟 원문 보존 — 판독거부된 기존 config 를 덮지 않음.
    expect(await readFile(target, "utf8")).toBe(orig);
  });

  it("R5(c): 부재(ENOENT) config → 신선 {} 로 정상 write(throw 아님)", async () => {
    const after = await updateConfig({ projectRoot: "/ph/app" });
    expect(after.projectRoot).toBe("/ph/app");
    const disk = await loadConfigFromDisk();
    expect(disk.projectRoot).toBe("/ph/app");
  });

  it("R5(e): 조회(non-strict) open 실패(EACCES) → 안전 기본값(throw 아님·쓰기 아님)", async () => {
    await writeFile(configPath(), JSON.stringify({ schemaVersion: "1", projectRoot: "/x", definitionEditEnabled: true }), "utf8");
    ctl.failCode = "EACCES";
    const c = await loadConfigFromDisk();
    ctl.failCode = null;
    expect(c.projectRoot).toBeNull();          // 판독불가 → 안전 기본값
    expect(c.definitionEditEnabled).toBe(false); // fail-closed
  });
});
