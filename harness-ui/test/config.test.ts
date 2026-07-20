import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, loadEvals, loadConfigFromDisk, updateConfig, configPath,
  withConfigLock, projectsHomeFromEnv, CONFIG_SCHEMA_VERSION,
} from "../src/server/lib/config.js";

// F3.7 config 서브시스템 — 버전드 봉투·per-leaf 복구·원자 RMW·뮤텍스(A71).
describe("config: loadConfig per-leaf 독립 복구 (A71·S-A1)", () => {
  it("정상 봉투 전 필드 파싱", () => {
    const c = loadConfig({
      schemaVersion: "1", projectsHome: "/home/u/projects", projectRoot: "/home/u/projects/app",
      definitionEditEnabled: true, evals: { threshold: 0.8 },
    });
    expect(c.schemaVersion).toBe("1");
    expect(c.projectsHome).toBe("/home/u/projects");
    expect(c.projectRoot).toBe("/home/u/projects/app");
    expect(c.definitionEditEnabled).toBe(true);
    expect(c.evals).toEqual({ threshold: 0.8 });
  });

  it("부재/빈 → 필드별 fallback(projectRoot=null·definitionEditEnabled=false fail-closed)", () => {
    const c = loadConfig({});
    expect(c.projectsHome).toBeNull();
    expect(c.projectRoot).toBeNull();
    expect(c.definitionEditEnabled).toBe(false);
    expect(c.evals).toBeNull();
    expect(c.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });

  it("한 필드 손상이 타 필드를 소거하지 않음(per-leaf)", () => {
    const c = loadConfig({
      schemaVersion: "1", projectRoot: 12345 /* 손상 */, definitionEditEnabled: true, projectsHome: "/ph",
    });
    expect(c.projectRoot).toBeNull();       // 손상 잎만 null
    expect(c.definitionEditEnabled).toBe(true); // 형제 보존
    expect(c.projectsHome).toBe("/ph");     // 형제 보존
  });

  it("definitionEditEnabled 손상 → false(fail-closed)·타 필드 보존", () => {
    const c = loadConfig({ schemaVersion: "1", definitionEditEnabled: "yes", projectRoot: "/ph/app" });
    expect(c.definitionEditEnabled).toBe(false);
    expect(c.projectRoot).toBe("/ph/app");
  });

  it("root passthrough — 미지/미래 필드 보존", () => {
    const c = loadConfig({ schemaVersion: "1", futureField: { x: 1 }, projectRoot: "/ph/app" });
    expect((c as Record<string, unknown>).futureField).toEqual({ x: 1 });
  });

  it("미지원 schemaVersion → throw(unsupported-config-schema)", () => {
    expect(() => loadConfig({ schemaVersion: "2" })).toThrow(/unsupported-config-schema/);
    expect(() => loadConfig({ schemaVersion: "99", projectRoot: "/x" })).toThrow();
  });

  it("schemaVersion 부재 → throw 아님(fallback 채택)", () => {
    const c = loadConfig({ projectRoot: "/ph/app" });
    expect(c.schemaVersion).toBe("1");
    expect(c.projectRoot).toBe("/ph/app");
  });

  it("evals per-leaf 골격: threshold 한 잎 손상 → 그 잎만 null·형제 보존", () => {
    const e = loadEvals({ threshold: "bad", enabled: true, custom: 42 });
    expect(e).not.toBeNull();
    expect(e!.threshold).toBeNull();  // 손상 잎만 null
    expect(e!.enabled).toBe(true);    // 형제 보존
    expect(e!.custom).toBe(42);       // 미지 필드 보존
  });

  it("evals 통째 clobber 금지: 한 잎 손상이 형제·타 top-level 필드 리셋 안 함(통합감사-#1)", () => {
    const c = loadConfig({
      schemaVersion: "1", definitionEditEnabled: true, projectRoot: "/ph/app",
      evals: { threshold: "corrupt", weight: 5 },
    });
    expect(c.definitionEditEnabled).toBe(true);
    expect(c.projectRoot).toBe("/ph/app");
    expect((c.evals as Record<string, unknown>).weight).toBe(5);
    expect((c.evals as Record<string, unknown>).threshold).toBeNull();
  });
});

describe("config: 디스크 RMW + projectsHome 불변 assert (A71·S-A2·V9)", () => {
  let stateDir: string;
  const origState = process.env.HARNESS_STATE_HOME;
  const origHome = process.env.HARNESS_PROJECTS_HOME;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "hui-cfg-"));
    process.env.HARNESS_STATE_HOME = stateDir;
    delete process.env.HARNESS_PROJECTS_HOME;
  });
  afterEach(async () => {
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    if (origHome === undefined) delete process.env.HARNESS_PROJECTS_HOME; else process.env.HARNESS_PROJECTS_HOME = origHome;
    await rm(stateDir, { recursive: true, force: true });
  });

  it("부재 config → fallback(throw 아님)", async () => {
    const c = await loadConfigFromDisk();
    expect(c.projectRoot).toBeNull();
    expect(c.definitionEditEnabled).toBe(false);
  });

  it("파손 JSON → fallback(throw 아님)", async () => {
    await writeFile(configPath(), "{ not json ", "utf8");
    const c = await loadConfigFromDisk();
    expect(c.projectRoot).toBeNull();
  });

  it("RMW: projectRoot 만 갱신·definitionEditEnabled/projectsHome/evals 보존(A71·통합감사-#1)", async () => {
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1", projectsHome: "/ph", definitionEditEnabled: true,
      evals: { threshold: 0.9 }, futureField: "keep",
    }), "utf8");
    const after = await updateConfig({ projectRoot: "/ph/app" });
    expect(after.projectRoot).toBe("/ph/app");
    expect(after.definitionEditEnabled).toBe(true);       // 보존
    expect(after.projectsHome).toBe("/ph");               // 보존(RMW 대상 아님)
    expect(after.evals).toEqual({ threshold: 0.9 });      // 보존
    expect((after as Record<string, unknown>).futureField).toBe("keep"); // passthrough 보존
    // 디스크 재확인
    const disk = loadConfig(JSON.parse(await readFile(configPath(), "utf8")));
    expect(disk.definitionEditEnabled).toBe(true);
    expect(disk.projectsHome).toBe("/ph");
  });

  it("동시 두 writer → lost-update 없음(뮤텍스 직렬화·S-A3)", async () => {
    await writeFile(configPath(), JSON.stringify({ schemaVersion: "1", definitionEditEnabled: false }), "utf8");
    // projectRoot 와 definitionEditEnabled 를 각각 동시 갱신 → 둘 다 최종 반영(서로 덮지 않음)
    await Promise.all([
      updateConfig({ projectRoot: "/ph/app" }),
      updateConfig({ definitionEditEnabled: true }),
    ]);
    const disk = await loadConfigFromDisk();
    expect(disk.projectRoot).toBe("/ph/app");
    expect(disk.definitionEditEnabled).toBe(true);
  });

  it("withConfigLock 직렬화 — 겹치지 않는 임계구역", async () => {
    const order: string[] = [];
    const a = withConfigLock(async () => { order.push("a-start"); await new Promise((r) => setTimeout(r, 20)); order.push("a-end"); });
    const b = withConfigLock(async () => { order.push("b-start"); order.push("b-end"); });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("projectsHomeFromEnv: env SSOT(미설정=null)", () => {
    expect(projectsHomeFromEnv()).toBeNull();
    process.env.HARNESS_PROJECTS_HOME = "/boundary";
    expect(projectsHomeFromEnv()).toBe("/boundary");
  });

  // R2 HIGH#1: RMW 손상 JSON 덮어쓰기 → 데이터 영구 소실 방어(읽기 관용 / 쓰기 fail-fast 분리).
  it("R2#1: 구문 손상 JSON config → updateConfig throw·디스크 무변경(유효분 덮어쓰기 없음)", async () => {
    const corrupt = '{ "schemaVersion": "1", "evals": { "threshold": 0.9 }, not-json ';
    await writeFile(configPath(), corrupt, "utf8");
    await expect(updateConfig({ projectRoot: "/ph/app" })).rejects.toThrow();
    // 디스크 원문 보존 — RMW 가 {} 로 덮어쓰지 않았음(손상 파일 그대로).
    const onDisk = await readFile(configPath(), "utf8");
    expect(onDisk).toBe(corrupt);
  });

  it("R2#1: 조회 read 는 여전히 관용 — 손상 JSON → fallback(throw 아님)", async () => {
    await writeFile(configPath(), '{ broken ', "utf8");
    const c = await loadConfigFromDisk();     // 읽기 컨텍스트는 관용 유지
    expect(c.projectRoot).toBeNull();
    expect(c.definitionEditEnabled).toBe(false);
  });

  it("R2#1: 유효 JSON·나쁜 필드값 → per-leaf 복구 후 정상 쓰기(throw 아님)", async () => {
    // 구문은 유효하나 projectRoot 타입 위반 + evals.threshold 위반 → per-leaf 복구 후 write 진행.
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1", projectRoot: 12345, evals: { threshold: "bad", weight: 7 }, keep: "x",
    }), "utf8");
    const after = await updateConfig({ definitionEditEnabled: true });
    expect(after.definitionEditEnabled).toBe(true);
    expect(after.projectRoot).toBeNull();                          // 손상 잎 복구
    expect((after.evals as Record<string, unknown>).threshold).toBeNull();
    expect((after.evals as Record<string, unknown>).weight).toBe(7); // 형제 보존
    expect((after as Record<string, unknown>).keep).toBe("x");       // passthrough 보존
    const disk = await loadConfigFromDisk();
    expect(disk.definitionEditEnabled).toBe(true);
  });

  it("R2#1: 부재/빈 config 는 신선 시작 — updateConfig throw 아님(손상 아님)", async () => {
    // 파일 없음 → 신선 write 허용(손상 데이터 덮어쓰기 아님).
    const after = await updateConfig({ projectRoot: "/ph/app" });
    expect(after.projectRoot).toBe("/ph/app");
  });

  // R3 codex HIGH-2(passthrough 불변식) — 명시 lock 테스트. loadConfig 왕복 + 여러 writer(F9 docs-sources·
  //   F3 projectRoot) 저장 후에도 미지/미래 top-level 필드가 소거되지 않음(config.ts:77 `...obj`).
  //   중첩 미지 객체·다수 미지 키까지 커버(디스크 재-read 로 최종 확인).
  it("R3 HIGH-2: 미지 top-level 필드가 loadConfig 왕복 + docs-sources/projectRoot 저장 후에도 보존", async () => {
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1", projectsHome: "/ph", projectRoot: "/ph/app", definitionEditEnabled: true,
      evals: { threshold: 0.9 },
      futureField: { nested: { deep: 42 }, arr: [1, 2, 3] }, // 미지 top-level(중첩)
      anotherUnknown: "keep-me",
    }), "utf8");
    // (a) loadConfig 왕복 보존
    const rt = loadConfig(JSON.parse(await readFile(configPath(), "utf8")));
    expect((rt as Record<string, unknown>).futureField).toEqual({ nested: { deep: 42 }, arr: [1, 2, 3] });
    expect((rt as Record<string, unknown>).anotherUnknown).toBe("keep-me");
    // (b) F9 docs-sources 저장 → 미지 필드·형제 known 필드 동시 보존
    const a1 = await updateConfig({ docsSources: [{ label: "X", path: "documentation" }], docsMenuEnabled: false });
    expect((a1 as Record<string, unknown>).futureField).toEqual({ nested: { deep: 42 }, arr: [1, 2, 3] });
    expect((a1 as Record<string, unknown>).anotherUnknown).toBe("keep-me");
    expect(a1.projectRoot).toBe("/ph/app");            // F3 필드 보존
    expect(a1.definitionEditEnabled).toBe(true);        // F7 필드 보존
    expect(a1.evals).toEqual({ threshold: 0.9 });       // F8 필드 보존
    // (c) F3 projectRoot 저장 → 여전히 미지 필드 보존(공유 config 회귀 0)
    const a2 = await updateConfig({ projectRoot: "/ph/app2" });
    expect((a2 as Record<string, unknown>).futureField).toEqual({ nested: { deep: 42 }, arr: [1, 2, 3] });
    expect((a2 as Record<string, unknown>).anotherUnknown).toBe("keep-me");
    expect(a2.docsSources).toEqual([{ label: "X", path: "documentation" }]); // F9 이전 저장 보존
    // (d) 디스크 최종 재-read 로 영구 보존 확인(영구 소실 없음)
    const disk = JSON.parse(await readFile(configPath(), "utf8"));
    expect(disk.futureField).toEqual({ nested: { deep: 42 }, arr: [1, 2, 3] });
    expect(disk.anotherUnknown).toBe("keep-me");
    expect(disk.projectsHome).toBe("/ph"); // 힌트 전용·불변 보존
  });
});
