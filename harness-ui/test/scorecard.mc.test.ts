// M-C U1/U2/U6 — 스냅샷 축적(append-on-state-change·lockfile·복구·꼬리내성) + 추세 판정.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat, utimes } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { computeHarnessScorecard } from "../src/server/adapters/scorecard.js";
import { writeHarnessScorecardSnapshot, readHarnessTrend } from "../src/server/adapters/scorecard-snapshot.js";
import { buildServer } from "../src/server/index.js";

const fm = (o: Record<string, string>) => "---\n" + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n---\n본문";
async function fx(agents: Record<string, string>, skills: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "hui-mc-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  for (const [n, b] of Object.entries(agents)) await writeFile(join(root, ".claude", "agents", n + ".md"), b);
  for (const [n, b] of Object.entries(skills)) {
    await mkdir(join(root, ".claude", "skills", n), { recursive: true });
    await writeFile(join(root, ".claude", "skills", n, "SKILL.md"), b);
  }
  return root;
}
const evals = (root: string) => join(root, "_workspace", "evals");
async function summaryLines(root: string) {
  const t = await readFile(join(evals(root), "harness_summary.jsonl"), "utf8").catch(() => "");
  return t.split("\n").filter(Boolean);
}

describe("U1 append-on-state-change", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("동일 state 2회 → 1줄(skip)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    expect(await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z")).toMatchObject({ written: true });
    expect(await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:01:00Z")).toMatchObject({ written: false });
    expect((await summaryLines(root)).length).toBe(1);
  });

  it("정의 변경 → 2줄·scorecard.json 최상위 state_key 일치", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    let sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z");
    await writeFile(join(root, ".claude", "agents", "b.md"), fm({ name: "b", skills: "[]" })); // orphan 추가
    sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    expect(await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:02:00Z")).toMatchObject({ written: true });
    expect((await summaryLines(root)).length).toBe(2);
    const json = JSON.parse(await readFile(join(evals(root), "harness_scorecard.json"), "utf8"));
    expect(json.state_key).toBe(sc.state_key);
  });

  it("waiver 추가(active set 변화) → append", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[ghost]" }) }, {});
    let sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z");
    const id = sc.findings.find((f) => f.type === "dead_link")!.id;
    await writeFile(join(evals(root), "waivers.json"), JSON.stringify([{ finding_id: id, reason: "wip" }]));
    sc = await computeHarnessScorecard(root, { now: "2026-07-11" });  // dead_link now waived → active set 변화
    expect(await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:03:00Z")).toMatchObject({ written: true });
    expect((await summaryLines(root)).length).toBe(2);
  });

  it("부분실패 복구: summary 최신인데 scorecard.json 없으면 재기록", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z");
    await rm(join(evals(root), "harness_scorecard.json"), { force: true }); // 크래시 시뮬(json 소실)
    const r = await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:01:00Z");
    expect(r.written).toBe(true);                                   // 복구 재기록
    expect((await summaryLines(root)).length).toBe(1);              // summary는 중복 안 함
    expect(await stat(join(evals(root), "harness_scorecard.json"))).toBeTruthy();
  });

  it("꼬리 손상 줄 뒤 append — 개행 보장(병합 안 됨)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    await mkdir(evals(root), { recursive: true });
    await writeFile(join(evals(root), "harness_summary.jsonl"), '{"state_key":"broke');  // 개행 없는 손상 꼬리
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z");
    const lines = await summaryLines(root);
    // 마지막 줄은 온전한 JSON(손상 꼬리와 병합 안 됨)
    expect(() => JSON.parse(lines[lines.length - 1]!)).not.toThrow();
  });

  it("temp 고아 없음(release 후 lock/tmp 정리)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z");
    const files = await readdir(evals(root));
    expect(files.some((f) => f.includes(".lock"))).toBe(false);    // lock·tmp 잔존 0
  });
});

describe("U2 readHarnessTrend", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  async function snap(root: string, at: string) {
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    await writeHarnessScorecardSnapshot(sc, root, at);
  }

  it("스냅샷 <2 = insufficient", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    await snap(root, "2026-07-11T00:00:00Z");
    const t = await readHarnessTrend(root);
    expect(t.verdict).toBe("insufficient");
  });

  it("penalized 증가 = regressed·new findings", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    await snap(root, "2026-07-11T00:00:00Z");
    await writeFile(join(root, ".claude", "agents", "b.md"), fm({ name: "b", skills: "[]" })); // orphan(감점) 추가
    await snap(root, "2026-07-11T00:02:00Z");
    const t = await readHarnessTrend(root);
    expect(t.verdict).toBe("regressed");
    expect(t.delta).toBeGreaterThan(0);
    expect(t.findingDelta).toBe("available");
    expect(t.newFindings).toContain("orphan:claude:agent:b");
  });

  it("penalized 감소 = improved", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }), b: fm({ name: "b", skills: "[]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    await snap(root, "2026-07-11T00:00:00Z");
    await rm(join(root, ".claude", "agents", "b.md"), { force: true });  // orphan 제거
    await snap(root, "2026-07-11T00:02:00Z");
    const t = await readHarnessTrend(root);
    expect(t.verdict).toBe("improved");
    expect(t.resolvedFindings).toContain("orphan:claude:agent:b");
  });

  it("truncated 줄 → findingDelta approximate·new/resolved null(ghost 차단)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    // 수기 summary 2줄(둘째 truncated:true·penalized 다름)
    await mkdir(evals(root), { recursive: true });
    const base = { config_hash: "x".repeat(32), scope: "built", counts: {}, active_ids: [], debt: 0 };
    await writeFile(join(evals(root), "harness_summary.jsonl"),
      JSON.stringify({ ...base, generated_at: "t1", state_key: "k1", penalized: 1, truncated: false }) + "\n" +
      JSON.stringify({ ...base, generated_at: "t2", state_key: "k2", penalized: 2, truncated: true }) + "\n");
    const t = await readHarnessTrend(root);
    expect(t.verdict).toBe("regressed");           // counts 기반(절단 무관)
    expect(t.findingDelta).toBe("approximate");
    expect(t.newFindings).toBeNull();
  });
});

describe("U1 동시성 — 2회 병렬 writeSnapshot → 중복 0", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  it("Promise.all 2회 → summary 1줄(lock 상호배제)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    await Promise.all([
      writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z"),
      writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z"),
    ]);
    expect((await summaryLines(root)).length).toBe(1);   // 상호배제 — 중복 append 없음
  });
  it("TTL 초과 stale lock → 회수 후 획득 / TTL 이내 lock → 미획득(경합)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    await mkdir(evals(root), { recursive: true });
    const lock = join(evals(root), ".harness-scorecard.lock");
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    // ① TTL 이내(방금) lock → 경합·미기록
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: Date.now() }));
    expect((await writeHarnessScorecardSnapshot(sc, root, "t")).skipped).toBe("contention");
    // ② mtime 을 5분 전으로(TTL 2분 초과) → stale 회수·기록
    const old = Date.now() / 1000 - 300;
    await utimes(lock, old, old);
    expect((await writeHarnessScorecardSnapshot(sc, root, "t2")).written).toBe(true);
  });
});

describe("U3 POST snapshot — 격리 root", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  it("무본문 200(written)·초과필드 400·동시 2요청 중 하나 429", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    const app = buildServer({ projectRoot: root });
    const url = "/api/eval/harness-scorecard/snapshot";
    expect((await app.inject({ method: "POST", url, payload: { x: 1 } })).statusCode).toBe(400);
    // 동시 2요청 — in-flight gate로 하나는 429
    const [a, b] = await Promise.all([app.inject({ method: "POST", url }), app.inject({ method: "POST", url })]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 429]);
  });
});
