// M11 F3.7 config R3(agy HIGH) — RMW lost-update: 이중 read 제거·단일 read 기준 RMW.
// 위협: updateConfig 가 strict read 를 2회(before + TOCTOU 재-read disk) 하되 쓰기 base 로 재-read 가
// 아닌 최초 before 기반 next 를 그대로 덮어써 두 read 사이 외부 변경을 무조건 유실(lost-update).
// 뮤텍스가 in-process 직렬화를 보장하므로 두 번째 read 는 무의미 I/O. 수정: 단일 strict read 기준 RMW.
// 검증: 한 번의 updateConfig 가 config.json 을 정확히 1회만 read-open(이중 read 제거) + 그 단일 read
// 기준 전 필드 보존. config 읽기는 numeric flags(O_RDONLY|O_NOFOLLOW), atomic 쓰기는 string flags("wx"/"r")
// 라 numeric flags open 만 카운트해 격리.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctl = vi.hoisted(() => ({ reads: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    open: (async (path: unknown, flags?: unknown, ...rest: unknown[]) => {
      // config strict/관용 read 만 numeric flags. atomic writeAtomic 은 "wx"/"r"(string) → 미카운트.
      if (typeof flags === "number" && String(path).endsWith("config.json")) ctl.reads++;
      // @ts-expect-error passthrough
      return actual.open(path, flags, ...rest);
    }) as typeof actual.open,
  };
});

const { updateConfig, configPath, loadConfigFromDisk } = await import("../src/server/lib/config.js");

describe("config RMW 단일 read 기준(lost-update 봉쇄 · F3.7 R3)", () => {
  let stateDir: string;
  const origState = process.env.HARNESS_STATE_HOME;
  const origHome = process.env.HARNESS_PROJECTS_HOME;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "hui-cfg-r3-"));
    process.env.HARNESS_STATE_HOME = stateDir;
    delete process.env.HARNESS_PROJECTS_HOME;
    ctl.reads = 0;
  });
  afterEach(async () => {
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    if (origHome === undefined) delete process.env.HARNESS_PROJECTS_HOME; else process.env.HARNESS_PROJECTS_HOME = origHome;
    await rm(stateDir, { recursive: true, force: true });
  });

  it("R3: 한 번의 updateConfig 는 config.json 을 정확히 1회 read(이중 read 제거)", async () => {
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1", projectsHome: "/ph", evals: { threshold: 0.5 }, futureField: "keep",
    }), "utf8");
    ctl.reads = 0;
    const after = await updateConfig({ projectRoot: "/ph/app" });
    expect(ctl.reads).toBe(1); // 단일 strict read — 종전 이중 read(2)면 RED
    // 그 단일 read 기준 patch 적용 + 전 필드 보존.
    expect(after.projectRoot).toBe("/ph/app");
    expect(after.projectsHome).toBe("/ph");
    expect(after.evals).toEqual({ threshold: 0.5 });
    expect((after as Record<string, unknown>).futureField).toBe("keep");
  });

  it("R3: 손상 config 는 단일 strict read 서 throw·디스크 무변경 유지", async () => {
    const corrupt = '{ "schemaVersion": "1", "evals": { "threshold": 0.9 }, not-json ';
    await writeFile(configPath(), corrupt, "utf8");
    await expect(updateConfig({ projectRoot: "/ph/app" })).rejects.toThrow();
  });

  it("R3: 동시 두 writer 여전히 lost-update 0(뮤텍스 직렬화)", async () => {
    await writeFile(configPath(), JSON.stringify({ schemaVersion: "1", definitionEditEnabled: false }), "utf8");
    await Promise.all([
      updateConfig({ projectRoot: "/ph/app" }),
      updateConfig({ definitionEditEnabled: true }),
    ]);
    const disk = await loadConfigFromDisk();
    expect(disk.projectRoot).toBe("/ph/app");
    expect(disk.definitionEditEnabled).toBe(true);
  });
});
