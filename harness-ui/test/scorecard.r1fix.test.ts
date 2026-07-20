// M-A 외부감사 impl R1 회귀 잠금 — 상호배타·orchestrates scalar·unknown_scope·dual-runtime·empty·references·결정성.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeHarnessScorecard } from "../src/server/adapters/scorecard.js";

const fm = (o: Record<string, string>) => "---\n" + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n---\n본문";
async function fx(agents: Record<string, string>, skills: Record<string, string>, opts?: { agentsDir?: string; skillsBase?: string }) {
  const root = await mkdtemp(join(tmpdir(), "hui-r1-"));
  const adir = join(root, opts?.agentsDir ?? ".claude/agents");
  await mkdir(adir, { recursive: true });
  for (const [n, b] of Object.entries(agents)) await writeFile(join(adir, n + (opts?.agentsDir?.includes("codex") ? ".toml" : ".md")), b);
  for (const [n, b] of Object.entries(skills)) {
    const sd = join(root, opts?.skillsBase ?? ".claude/skills", n);
    await mkdir(sd, { recursive: true });
    await writeFile(join(sd, "SKILL.md"), b);
  }
  return root;
}

describe("impl R1 회귀", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("M2: link_unknown 에이전트는 coverage_gap 안 붙음(상호배타)", async () => {
    root = await fx(
      { legacy: fm({ name: "legacy", description: "미선언" }) },
      { orch: fm({ name: "orch", description: "o", orchestrates: "[other]" }) },
    );
    const sc = await computeHarnessScorecard(root);
    expect(sc.findings.some((f) => f.subject === "legacy" && f.type === "link_unknown")).toBe(true);
    expect(sc.findings.some((f) => f.subject === "legacy" && f.type === "coverage_gap")).toBe(false);
  });

  it("M3: orchestrates scalar = incomplete_def(오케스트레이터로 오인 안 함)", async () => {
    root = await fx(
      { a: fm({ name: "a", skills: "[s1]" }) },
      { s1: fm({ name: "s1", description: "s" }), bad: fm({ name: "bad", description: "o", orchestrates: "notarray" }) },
    );
    const sc = await computeHarnessScorecard(root);
    expect(sc.findings.some((f) => f.subject === "bad" && f.type === "incomplete_def")).toBe(true);
    // orchestrator 부재로 간주 → a 에 coverage_gap 안 생김(scalar 를 배정으로 오인 안 함)
    expect(sc.findings.some((f) => f.subject === "a" && f.type === "coverage_gap")).toBe(false);
  });

  it("빈 하네스 = findings 0·counts 0", async () => {
    root = await fx({}, {});
    const sc = await computeHarnessScorecard(root);
    expect(sc.findings).toEqual([]);
    expect(sc.counts.agents).toBe(0);
  });

  it("M1: 타 스킬 references 가 참조하는 스킬 = orphan 아닌 link_unknown", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[hub]" }) }, { hub: fm({ name: "hub", description: "h" }) });
    // hub 스킬에 references/shared.md 두고, shared 라는 미선언 스킬을 별도 생성
    await mkdir(join(root, ".claude/skills/hub/references"), { recursive: true });
    await writeFile(join(root, ".claude/skills/hub/references/shared.md"), "# ref");
    await mkdir(join(root, ".claude/skills/shared"), { recursive: true });
    await writeFile(join(root, ".claude/skills/shared/SKILL.md"), fm({ name: "shared", description: "s" }));
    const sc = await computeHarnessScorecard(root);
    const f = sc.findings.find((x) => x.subject === "shared")!;
    expect(f.type).toBe("link_unknown");   // orphan 아님(references 참조 증거)
    expect(f.provenance).toBe("skill_refs");
  });

  it("결정성: 동일 구성 두 번 계산 → findings id 순서·config_hash 동일", async () => {
    root = await fx(
      { z: fm({ name: "z", skills: "[]" }), a: fm({ name: "a", skills: "[]" }) },
      { lonely: fm({ name: "lonely", description: "s" }) },
    );
    const s1 = await computeHarnessScorecard(root);
    const s2 = await computeHarnessScorecard(root);
    expect(s1.findings.map((f) => f.id)).toEqual(s2.findings.map((f) => f.id));
    expect(s1.config_hash).toBe(s2.config_hash);
    // 정렬됨(id 오름차순)
    const ids = s1.findings.map((f) => f.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it("H1: 거대 waivers.json 도 bounded read(크래시 없이 무시)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[ghost]" }) }, {});
    await mkdir(join(root, "_workspace/evals"), { recursive: true });
    await writeFile(join(root, "_workspace/evals/waivers.json"), "x".repeat(400000)); // 손상+초과
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    expect(sc.findings.find((f) => f.type === "dead_link")!.waived).toBe(false); // 무효 파싱 → 억제 없음
  });

  it("R2: 비 ISO expires_at = 무효(은폐 안 함)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[ghost]" }) }, {});
    let sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    const id = sc.findings.find((f) => f.type === "dead_link")!.id;
    await mkdir(join(root, "_workspace/evals"), { recursive: true });
    await writeFile(join(root, "_workspace/evals/waivers.json"),
      JSON.stringify([{ finding_id: id, reason: "x", expires_at: "zzzz" }]));
    sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    expect(sc.findings.find((f) => f.type === "dead_link")!.waived).toBe(false); // 비ISO → skip
  });

  it("R2 agy: skills 중복 선언 → dead_link 1건(dedup)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[ghost, ghost]" }) }, {});
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    expect(sc.findings.filter((f) => f.type === "dead_link" && f.subject === "a").length).toBe(1);
    expect(sc.counts.dead_link).toBe(1);
  });

  it("M-B R2: 오케스트레이터 추정 스킬이 orchestrates 미선언 → link_unknown(마이그레이션 미탐 방지)", async () => {
    root = await fx({ a: fm({ name: "a", skills: "[myorch]" }) },
      { myorch: fm({ name: "myorch", description: "팀을 조율하는 오케스트레이터" }) });
    const sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    const f = sc.findings.find((x) => x.subject === "myorch" && x.provenance === "orchestrates")!;
    expect(f.type).toBe("link_unknown");
  });
});
