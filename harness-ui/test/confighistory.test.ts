// 하네스 구성 변경 이력(ledger) — append/read + GET /api/config-changes.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendConfigChange, readConfigChanges } from "../src/server/adapters/confighistory.js";
import { buildServer } from "../src/server/index.js";

describe("config-changes ledger", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("append → read 최신순", async () => {
    root = await mkdtemp(join(tmpdir(), "hui-cc-"));
    await appendConfigChange(root, { at: "2026-07-12T00:00:00Z", action: "create", kind: "agent", name: "a", runtime: "claude", path: ".claude/agents/a.md" });
    await appendConfigChange(root, { at: "2026-07-12T00:01:00Z", action: "edit", kind: "skill", name: "s1", runtime: "claude", path: ".claude/skills/s1/SKILL.md" });
    const { changes, total } = await readConfigChanges(root);
    expect(total).toBe(2);
    expect(changes[0]!.name).toBe("s1");   // 최신순
    expect(changes[0]!.action).toBe("edit");
    expect(changes[1]!.action).toBe("create");
  });

  it("꼬리 손상 줄 discard(fail-open)", async () => {
    root = await mkdtemp(join(tmpdir(), "hui-cc2-"));
    await mkdir(join(root, "_workspace"), { recursive: true });
    await writeFile(join(root, "_workspace", "config-changes.jsonl"),
      JSON.stringify({ at: "2026-07-12T00:00:00Z", action: "create", kind: "agent", name: "ok", runtime: "claude", path: "p" }) + "\n" + '{"at":"broke');
    const { changes } = await readConfigChanges(root);
    expect(changes.length).toBe(1);        // 손상 줄 무시·완전 줄만
    expect(changes[0]!.name).toBe("ok");
  });

  it("GET /api/config-changes: 빈 → {changes:[],total:0}", async () => {
    root = await mkdtemp(join(tmpdir(), "hui-cc3-"));
    const app = buildServer({ projectRoot: root });
    const r = await app.inject({ url: "/api/config-changes" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ changes: [], total: 0 });
  });
});

describe("harnesses 목록", () => {
  it("GET /api/harnesses: 오케스트레이터→에이전트 파생·shape", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "hui-hl-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "w.md"), "---\nname: w\nskills: [s1]\n---\n");
    await mkdir(join(root, ".claude", "skills", "orch"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "orch", "SKILL.md"), "---\nname: orch\ndescription: o\norchestrates: [w, ghost]\n---\n");
    const { buildServer } = await import("../src/server/index.js");
    const app = buildServer({ projectRoot: root });
    const r = await app.inject({ url: "/api/harnesses" });
    expect(r.statusCode).toBe(200);
    const h = r.json().harnesses.find((x: any) => x.name === "orch");
    expect(h.orchestratesDeclared).toBe(true);
    expect(h.agents).toContain("w");
    expect(h.missingAgents).toContain("ghost");
    expect(h.status).toBe("broken"); // ghost 부재
    await rm(root, { recursive: true, force: true });
  });
});
