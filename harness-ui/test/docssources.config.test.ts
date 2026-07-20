// M14 F9 A113 — config additive(docsSources/docsMenuEnabled) + per-leaf 독립 복구 + RMW 전 필드 보존.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, loadDocsSources, loadConfigFromDisk, updateConfig, configPath, DEFAULT_DOCS_SOURCES,
} from "../src/server/lib/config.js";

describe("A113 — loadConfig docsSources/docsMenuEnabled additive·기본값", () => {
  it("부재 → 기본 [{Docs,docs}]·docsMenuEnabled=true", () => {
    const c = loadConfig({ schemaVersion: "1" });
    expect(c.docsSources).toEqual([{ label: "Docs", path: "docs" }]);
    expect(c.docsMenuEnabled).toBe(true);
  });

  it("정상 값 파싱", () => {
    const c = loadConfig({
      schemaVersion: "1",
      docsSources: [{ label: "A", path: "docs" }, { label: "B", path: "documentation" }],
      docsMenuEnabled: false,
    });
    expect(c.docsSources).toEqual([{ label: "A", path: "docs" }, { label: "B", path: "documentation" }]);
    expect(c.docsMenuEnabled).toBe(false);
  });

  it("DEFAULT_DOCS_SOURCES 는 공유 참조가 아니라 복제(외부 변형 격리)", () => {
    const a = loadDocsSources(undefined);
    a[0]!.label = "MUT";
    expect(DEFAULT_DOCS_SOURCES[0]!.label).toBe("Docs"); // 원본 불변
  });
});

describe("A113 — per-leaf 독립 복구(손상 소스만 드롭·형제 config 필드 보존)", () => {
  it("docsSources 비-배열(손상) → 기본 드롭백·형제 top-level 보존", () => {
    const c = loadConfig({
      schemaVersion: "1", projectRoot: "/ph/app", definitionEditEnabled: true,
      evals: { threshold: 0.9 }, docsSources: "garbage",
    });
    expect(c.docsSources).toEqual([{ label: "Docs", path: "docs" }]); // 손상 잎만 기본
    expect(c.projectRoot).toBe("/ph/app");                            // 형제 보존
    expect(c.definitionEditEnabled).toBe(true);
    expect(c.evals).toEqual({ threshold: 0.9 });
  });

  it("배열 요소 위반이 유효 형제 소스를 소거하지 않음(요소별 safeParse)", () => {
    const c = loadConfig({
      schemaVersion: "1",
      docsSources: [
        { label: "ok1", path: "docs" },
        { label: 123, path: "bad-label" }, // 위반(label 비-string)
        { path: "no-label" },               // 위반(label 부재)
        { label: "ok2", path: "documentation" },
      ],
    });
    expect(c.docsSources).toEqual([{ label: "ok1", path: "docs" }, { label: "ok2", path: "documentation" }]);
  });

  it("전 요소 위반 → 빈 배열(형제 top-level 무영향·drop 결과 빈 배열 허용)", () => {
    const c = loadConfig({ schemaVersion: "1", projectRoot: "/ph/app", docsSources: [{ bad: 1 }] });
    expect(c.docsSources).toEqual([]);
    expect(c.projectRoot).toBe("/ph/app");
  });

  it("docsMenuEnabled 손상 → true(기본)·형제 보존", () => {
    const c = loadConfig({ schemaVersion: "1", docsMenuEnabled: "yes", projectRoot: "/ph/app" });
    expect(c.docsMenuEnabled).toBe(true);
    expect(c.projectRoot).toBe("/ph/app");
  });
});

describe("A113 — RMW 전 필드 보존(clobber 금지)", () => {
  let stateDir: string;
  const origState = process.env.HARNESS_STATE_HOME;
  beforeEach(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-f9cfg-")); process.env.HARNESS_STATE_HOME = stateDir; });
  afterEach(async () => {
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    await rm(stateDir, { recursive: true, force: true });
  });

  it("updateConfig({docsSources}) → docsSources 만 갱신·projectRoot/evals/definitionEditEnabled/passthrough 보존", async () => {
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1", projectsHome: "/ph", projectRoot: "/ph/app", definitionEditEnabled: true,
      evals: { threshold: 0.7 }, futureField: "keep",
    }), "utf8");
    const after = await updateConfig({ docsSources: [{ label: "X", path: "documentation" }], docsMenuEnabled: false });
    expect(after.docsSources).toEqual([{ label: "X", path: "documentation" }]);
    expect(after.docsMenuEnabled).toBe(false);
    expect(after.projectRoot).toBe("/ph/app");           // 보존
    expect(after.definitionEditEnabled).toBe(true);      // 보존
    expect(after.evals).toEqual({ threshold: 0.7 });     // 보존
    expect((after as Record<string, unknown>).futureField).toBe("keep"); // passthrough 보존
    // 디스크 재확인
    const disk = await loadConfigFromDisk();
    expect(disk.docsSources).toEqual([{ label: "X", path: "documentation" }]);
    expect(disk.projectRoot).toBe("/ph/app");
  });

  it("docsSources 손상이 projectRoot/evals 를 소거하지 않음(RMW 전 필드 복구·통합감사-#1)", async () => {
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1", projectRoot: "/ph/app", evals: { threshold: 0.8 }, docsSources: "corrupt",
    }), "utf8");
    const after = await updateConfig({ definitionEditEnabled: true });
    expect(after.projectRoot).toBe("/ph/app");            // 손상 docsSources 가 형제 소거 안 함
    expect(after.evals).toEqual({ threshold: 0.8 });
    expect(after.docsSources).toEqual([{ label: "Docs", path: "docs" }]); // 손상 잎만 기본 복구
  });

  it("patch 의 빈 배열([]) 은 default 로 덮지 않음(전 소스 삭제 정상 상태)", async () => {
    await writeFile(configPath(), JSON.stringify({ schemaVersion: "1" }), "utf8");
    const after = await updateConfig({ docsSources: [] });
    expect(after.docsSources).toEqual([]);
    const disk = JSON.parse(await readFile(configPath(), "utf8"));
    expect(disk.docsSources).toEqual([]);
  });
});
