import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, resolveBootProjectRoot } from "../src/server/index.js";
import { makeSecurity } from "../src/server/security.js";
import { loadConfigFromDisk } from "../src/server/lib/config.js";

const PORT = 5174;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// M11 F3 — POST /api/settings/project-root · GET /api/settings 확장 · 부팅 precedence.
describe("POST /api/settings/project-root (A68~A71·A99·A101)", () => {
  let ph: string;            // projectsHome
  let appDir: string;        // ph/app (마커 존재)
  let stateDir: string;      // <state_home>(config.json 위치)
  let projRoot: string;      // 서버 projectRoot(activeRuns 스캔용·빈)
  const origHome = process.env.HARNESS_PROJECTS_HOME;
  const origState = process.env.HARNESS_STATE_HOME;

  beforeEach(async () => {
    ph = await mkdtemp(join(tmpdir(), "hui-sph-"));
    appDir = join(ph, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "CLAUDE.md"), "# marker\n");
    stateDir = await mkdtemp(join(tmpdir(), "hui-sstate-"));
    projRoot = await mkdtemp(join(tmpdir(), "hui-sproj-"));
    process.env.HARNESS_STATE_HOME = stateDir;
    process.env.HARNESS_PROJECTS_HOME = ph;
  });
  afterEach(async () => {
    if (origHome === undefined) delete process.env.HARNESS_PROJECTS_HOME; else process.env.HARNESS_PROJECTS_HOME = origHome;
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    await rm(ph, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
    await rm(projRoot, { recursive: true, force: true });
  });

  function app() { return buildServer({ projectRoot: projRoot }); }

  it("미프로비저닝 → 409 boundary-not-provisioned", async () => {
    delete process.env.HARNESS_PROJECTS_HOME;
    const r = await app().inject({ method: "POST", url: "/api/settings/project-root", payload: { path: appDir } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("boundary-not-provisioned");
  });

  it("dryRun 프리뷰: 검증만·디스크 미변경(A101)", async () => {
    const r = await app().inject({ method: "POST", url: "/api/settings/project-root", payload: { path: appDir, dryRun: true } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.ok).toBe(true);
    expect(b.written).toBe(false);
    expect(b.requiresRestart).toBe(true);
    expect(typeof b.activeRunsWarning).toBe("number");
    expect(b.effectiveRoot).toBe(await realpath(appDir));
    // 디스크 무변경 — config.projectRoot 여전히 null
    expect((await loadConfigFromDisk()).projectRoot).toBeNull();
  });

  it("dryRun:false 쓰기: config RMW(projectRoot 만)·definitionEditEnabled 보존(A71)", async () => {
    // 기존 config 에 definitionEditEnabled:true 선기록 → 보존 확인
    await writeFile(join(stateDir, "config.json"), JSON.stringify({ schemaVersion: "1", definitionEditEnabled: true }), "utf8");
    const r = await app().inject({ method: "POST", url: "/api/settings/project-root", payload: { path: appDir, dryRun: false } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.accepted).toBe(true);
    expect(b.requiresRestart).toBe(true);
    expect(b.effectiveRoot).toBe(await realpath(appDir));
    expect(typeof b.appliedAt).toBe("string");
    const disk = await loadConfigFromDisk();
    expect(disk.projectRoot).toBe(await realpath(appDir));
    expect(disk.definitionEditEnabled).toBe(true); // 보존
  });

  it("dryRun 기본값(미지정) = false 로 취급하지 않고 명시 처리 — path 만 있으면 쓰기", async () => {
    const r = await app().inject({ method: "POST", url: "/api/settings/project-root", payload: { path: appDir } });
    expect(r.statusCode).toBe(200);
    expect(r.json().accepted).toBe(true); // dryRun default false → 쓰기
  });

  it("불량 입력(상대경로) → 400 bad-input", async () => {
    const r = await app().inject({ method: "POST", url: "/api/settings/project-root", payload: { path: "relative/x" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("bad-input");
  });

  it("projectsHome 밖 → 400 outside-projects-home", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-so-"));
    await writeFile(join(outside, "CLAUDE.md"), "# forged\n");
    const r = await app().inject({ method: "POST", url: "/api/settings/project-root", payload: { path: outside } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("outside-projects-home");
    await rm(outside, { recursive: true, force: true });
  });

  it("body 미지 필드 → 400(strict Zod)", async () => {
    const r = await app().inject({ method: "POST", url: "/api/settings/project-root", payload: { path: appDir, evil: 1 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("bad-input");
  });

  it("GET /api/settings 확장: projectsHome·provisioned·mutationEnabled false", async () => {
    const r = await app().inject({ url: "/api/settings" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.projectRoot).toBe(projRoot);
    expect(b.projectsHome).toBe(ph);
    expect(b.projectsHomeProvisioned).toBe(true);
    expect(b.mutationEnabled).toBe(false);
    expect(b.definitionEditEnabled).toBe(false);
  });

  it("GET /api/settings: 미프로비저닝 → provisioned false", async () => {
    delete process.env.HARNESS_PROJECTS_HOME;
    const b = (await app().inject({ url: "/api/settings" })).json();
    expect(b.projectsHomeProvisioned).toBe(false);
  });

  it("mutating POST 는 security 게이트 대상(cross-origin 403)", async () => {
    const sec = makeSecurity(PORT);
    const gated = buildServer({ security: sec, projectRoot: projRoot });
    const r = await gated.inject({
      method: "POST", url: "/api/settings/project-root",
      headers: { host: HOST, origin: "http://evil.com", authorization: `Bearer ${sec.session}` },
      payload: { path: appDir, dryRun: true },
    });
    expect(r.statusCode).toBe(403);
    // 정상 Origin+token → 통과(200)
    const ok = await gated.inject({
      method: "POST", url: "/api/settings/project-root",
      headers: { host: HOST, origin: ORIGIN, authorization: `Bearer ${sec.session}` },
      payload: { path: appDir, dryRun: true },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("부팅 precedence·필드별 재검증 (A70·S-D)", () => {
  let ph: string, appA: string, appB: string, hardcoded: string;
  beforeEach(async () => {
    ph = await mkdtemp(join(tmpdir(), "hui-bph-"));
    appA = join(ph, "a"); appB = join(ph, "b");
    await mkdir(appA, { recursive: true }); await mkdir(appB, { recursive: true });
    await writeFile(join(appA, "CLAUDE.md"), "#\n"); await writeFile(join(appB, "CLAUDE.md"), "#\n");
    hardcoded = await mkdtemp(join(tmpdir(), "hui-bhc-"));
  });
  afterEach(async () => {
    await rm(ph, { recursive: true, force: true });
    await rm(hardcoded, { recursive: true, force: true });
  });

  it("env-safe 가 config 를 이김(긴급 복구)", async () => {
    const b = await resolveBootProjectRoot({ env: appA, configProjectRoot: appB, projectsHome: ph, hardcoded });
    expect(b.source).toBe("env");
    expect(b.root).toBe(await realpath(appA));
  });

  it("unsafe env → 그 값만 폐기·config 폴백(env 무조건 신뢰 금지)", async () => {
    const b = await resolveBootProjectRoot({ env: "relative/bad", configProjectRoot: appB, projectsHome: ph, hardcoded });
    expect(b.source).toBe("config");
    expect(b.root).toBe(await realpath(appB));
    expect(b.rejected.some((x) => x.source === "env")).toBe(true);
  });

  it("env·config 모두 unsafe → 하드코딩 기본 폴백", async () => {
    const b = await resolveBootProjectRoot({ env: "..", configProjectRoot: "~/x", projectsHome: ph, hardcoded });
    expect(b.source).toBe("default");
    expect(b.root).toBe(await realpath(hardcoded));
  });

  it("env config unsafe(projectsHome 밖) → 하드코딩 폴백", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-bo-"));
    const b = await resolveBootProjectRoot({ env: outside, configProjectRoot: null, projectsHome: ph, hardcoded });
    expect(b.source).toBe("default");
    await rm(outside, { recursive: true, force: true });
  });

  it("미프로비저닝(projectsHome null) → env/config 미신뢰·하드코딩 폴백", async () => {
    const b = await resolveBootProjectRoot({ env: appA, configProjectRoot: appB, projectsHome: null, hardcoded });
    expect(b.source).toBe("default");
    expect(b.rejected.every((x) => x.reason === "boundary-not-provisioned")).toBe(true);
  });
});
