import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server/index.js";
import { makeSecurity } from "../src/server/security.js";
import { configPath, loadConfigFromDisk } from "../src/server/lib/config.js";

const PORT = 5177;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function consistentCard(loop: string, stage: string, run: string, c: number, r: number) {
  const denom = c + r, alignment = denom > 0 ? c / denom : null;
  return JSON.stringify({
    schema_version: "1", loop, stage_id: stage, run_id: run, rounds: 3, termination_reason: "converged",
    verdict_counts: { confirmed: c, partial: 0, deferred: 0, rejected: r, duplicate: 0 },
    alignment_score: alignment, rounds_normalized: 0.6, missed_defect_rate: null,
    overturned_rejection_rate: null, computed_by: "scripts/build-scorecard.sh", warnings: [],
  });
}

describe("F8 API — Part A/B/C (M13·축소안)", () => {
  let projRoot: string, stateDir: string;
  const origState = process.env.HARNESS_STATE_HOME;

  beforeEach(async () => {
    projRoot = await mkdtemp(join(tmpdir(), "hui-evapi-"));
    stateDir = await mkdtemp(join(tmpdir(), "hui-evst-"));
    process.env.HARNESS_STATE_HOME = stateDir;
    const dir = join(projRoot, "_workspace", "evals", "external-review", "s1", "r-01");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "scorecard.json"), consistentCard("external-review", "s1", "r-01", 6, 3), "utf8");
  });
  afterEach(async () => {
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    await rm(projRoot, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  function app() { return buildServer({ projectRoot: projRoot }); }

  it("GET /api/evals → loop 목록·정직 라벨", async () => {
    const r = await app().inject({ url: "/api/evals" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.loops[0].loop).toBe("external-review");
    expect(b.labels.alignmentScore).toContain("정합도");
    expect(b.note).toContain("다음 버전"); // 이월 고지(평이 문구)
  });

  it("GET /api/evals/:loop → 추세(scorecards-inprocess)", async () => {
    const b = (await app().inject({ url: "/api/evals/external-review" })).json();
    expect(b.found).toBe(true);
    expect(b.series).toHaveLength(1);
    expect(b.trendSource).toBe("scorecards-inprocess");
  });

  it("GET /api/evals/:loop/:stage/:run → scorecard 상세", async () => {
    const b = (await app().inject({ url: "/api/evals/external-review/s1/r-01" })).json();
    expect(b.status).toBe("ok");
    expect(b.verified).toBe(true);
    expect(b.scorecard.verdict_counts.confirmed).toBe(6);
  });

  it("GET /api/evals/config → 기본(단계1·floor·stage4 잠금)", async () => {
    const b = (await app().inject({ url: "/api/evals/config" })).json();
    expect(b.adoptionStage).toBe(1);
    expect(b.stage4Locked).toBe(true);
    expect(b.proposalsEnabled).toBe(false);
    expect(b.thresholds.minAdjudicatedClaims.effective).toBe(30);
  });

  it("GET /api/evals/:loop/proposal → 단계1 이므로 비활성", async () => {
    const b = (await app().inject({ url: "/api/evals/external-review/proposal" })).json();
    expect(b.enabled).toBe(false);
    expect(b.disabledReason).toBe("adoption-stage-below-3");
    expect(b.autoApply).toBe(false);
  });

  it("POST /api/evals/config: adoptionStage 3 수용·RMW", async () => {
    const r = await app().inject({ method: "POST", url: "/api/evals/config", payload: { adoptionStage: 3, thresholds: { minAdjudicatedClaims: 40 } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().config.adoptionStage).toBe(3);
    const disk = await loadConfigFromDisk();
    expect((disk.evals as Record<string, unknown>).adoptionStage).toBe(3);
  });

  it("POST /api/evals/config: adoptionStage 4 → 400(쓰기 불가·display-only)", async () => {
    const r = await app().inject({ method: "POST", url: "/api/evals/config", payload: { adoptionStage: 4 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("bad-input");
  });

  it("POST /api/evals/config: floor 미만 임계 → 400(silent-clamp 아님)", async () => {
    const r = await app().inject({ method: "POST", url: "/api/evals/config", payload: { thresholds: { minAdjudicatedClaims: 29 } } });
    expect(r.statusCode).toBe(400);
  });

  it("★ GET side-effect 0: 전 GET 후 config.json·evals 디렉토리 무변경(ingest/append 없음)", async () => {
    // config.json 선기록(내용 스냅샷)
    await writeFile(configPath(), JSON.stringify({ schemaVersion: "1", evals: { adoptionStage: 2 } }), "utf8");
    const cfgBefore = await readFile(configPath(), "utf8");
    const evalDir = join(projRoot, "_workspace", "evals", "external-review", "s1", "r-01");
    const filesBefore = (await readdir(evalDir)).sort();

    const a = app();
    await a.inject({ url: "/api/evals" });
    await a.inject({ url: "/api/evals/external-review" });
    await a.inject({ url: "/api/evals/external-review/s1/r-01" });
    await a.inject({ url: "/api/evals/external-review/proposal" });
    await a.inject({ url: "/api/evals/config" });

    expect(await readFile(configPath(), "utf8")).toBe(cfgBefore);        // config 무변경
    expect((await readdir(evalDir)).sort()).toEqual(filesBefore);         // evals 디렉토리 무변경(append 없음)
    // <state_home> 에 rollup/receipt/nonce 등 신규 파일 미생성(축소안: 원장 미구현)
    const stateFiles = await readdir(stateDir).catch(() => []);
    expect(stateFiles.some((f) => /rollup|receipt|nonce|keyring|evals-hmac/.test(f))).toBe(false);
  });
});

describe("F8 config POST — security 게이트(mutating)", () => {
  let projRoot: string, stateDir: string;
  const origState = process.env.HARNESS_STATE_HOME;
  beforeEach(async () => {
    projRoot = await mkdtemp(join(tmpdir(), "hui-evsec-"));
    stateDir = await mkdtemp(join(tmpdir(), "hui-evsecst-"));
    process.env.HARNESS_STATE_HOME = stateDir;
  });
  afterEach(async () => {
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    await rm(projRoot, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("cross-origin POST config → 403·정상 Origin+token → 200", async () => {
    const sec = makeSecurity(PORT);
    const gated = buildServer({ security: sec, projectRoot: projRoot });
    const bad = await gated.inject({
      method: "POST", url: "/api/evals/config",
      headers: { host: HOST, origin: "http://evil.com", authorization: `Bearer ${sec.session}` },
      payload: { adoptionStage: 2 },
    });
    expect(bad.statusCode).toBe(403);
    const ok = await gated.inject({
      method: "POST", url: "/api/evals/config",
      headers: { host: HOST, origin: ORIGIN, authorization: `Bearer ${sec.session}` },
      payload: { adoptionStage: 2 },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("GET config 는 Origin 게이트 무관(읽기)·token 만으로 200", async () => {
    const sec = makeSecurity(PORT);
    const gated = buildServer({ security: sec, projectRoot: projRoot });
    // GET 은 Origin 불요(mutating 아님)·token 은 전 /api 공통. Origin 없이 token 만으로 통과.
    const r = await gated.inject({ url: "/api/evals/config", headers: { host: HOST, authorization: `Bearer ${sec.session}` } });
    expect(r.statusCode).toBe(200);
  });
});
