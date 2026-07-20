// M-A A5(T4) — A35 configHealth 교체 회귀. subject_kind 로 orphanAgents/orphanSkills 분리 + 전수 고아 오탐 0.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stateStats } from "../src/server/adapters/statestats.js";

const fm = (o: Record<string, string>) => "---\n" + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n---\n본문";
async function fixture(agents: Record<string, string>, skills: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "hui-a35-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  for (const [n, b] of Object.entries(agents)) await writeFile(join(root, ".claude", "agents", n + ".md"), b);
  for (const [n, b] of Object.entries(skills)) {
    await mkdir(join(root, ".claude", "skills", n), { recursive: true });
    await writeFile(join(root, ".claude", "skills", n, "SKILL.md"), b);
  }
  return root;
}

describe("A35 회귀 — 하위호환 + 고아 오탐 해소", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("기존 필드 유지(하위호환) + coverageConfidence", async () => {
    root = await fixture({ a: fm({ name: "a", skills: "[s1]" }) }, { s1: fm({ name: "s1", description: "s" }) });
    const { configHealth } = await stateStats(root);
    expect(configHealth).toHaveProperty("agents");
    expect(configHealth).toHaveProperty("orphanAgents");
    expect(configHealth).toHaveProperty("orphanSkills");
    expect(configHealth.coverageConfidence).toBe("heuristic");
    expect(Array.isArray(configHealth.orphanAgents)).toBe(true);
  });

  it("현 버그 해소 — 스킬 선언한 에이전트는 고아 아님(전수 오탐 0)", async () => {
    root = await fixture(
      { a: fm({ name: "a", skills: "[s1]" }), b: fm({ name: "b", skills: "[s1]" }) },
      { s1: fm({ name: "s1", description: "s" }) },
    );
    const { configHealth } = await stateStats(root);
    expect(configHealth.orphanAgents).toEqual([]);        // 선언했으니 고아 아님(이전엔 skills:[] 하드코딩으로 전부 고아)
    expect(configHealth.orphanSkills).toEqual([]);        // s1 은 a·b 가 선언
  });

  it("미선언 에이전트 = link_unknown(별도 필드)·orphan 아님", async () => {
    root = await fixture({ legacy: fm({ name: "legacy", description: "x" }) }, {});
    const { configHealth } = await stateStats(root);
    expect(configHealth.orphanAgents).toEqual([]);        // 미선언은 orphan 아님
    expect(configHealth.linkUnknownAgents).toContain("legacy");
  });

  it("orphan 스킬 정확 탐지(subject_kind=skill)", async () => {
    root = await fixture({ a: fm({ name: "a", skills: "[s1]" }) },
      { s1: fm({ name: "s1", description: "s" }), lonely: fm({ name: "lonely", description: "s" }) });
    const { configHealth } = await stateStats(root);
    expect(configHealth.orphanSkills).toContain("lonely");
    expect(configHealth.orphanSkills).not.toContain("s1");
  });
});
