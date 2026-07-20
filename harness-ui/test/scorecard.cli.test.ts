// M-A A6(T7) — portable CLI(무의존 번들) stdout JSON + fail-open(diag 없음→null).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pexec = promisify(execFile);
const CLI = join(process.cwd(), "scripts", "harness-scorecard.mjs");

describe("portable CLI — 번들 실행", () => {
  let root: string;
  beforeAll(async () => {
    // 번들 존재 확인(npm run build:scorecard-cli 산출). 없으면 스킵 안내.
    await access(CLI).catch(() => { throw new Error("scripts/harness-scorecard.mjs 없음 — `npm run build:scorecard-cli` 먼저"); });
  });
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("node CLI [root] → 계층A JSON stdout·diag null(fail-open)", async () => {
    root = await mkdtemp(join(tmpdir(), "hui-cli-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "a.md"), "---\nname: a\nskills: [s1]\n---\n");
    await mkdir(join(root, ".claude", "skills", "s1"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "s1", "SKILL.md"), "---\nname: s1\ndescription: d\n---\n");
    const { stdout } = await pexec("node", [CLI, root]);
    const sc = JSON.parse(stdout);
    expect(sc.schema_version).toBe(1);
    expect(sc.scope.runtime).toBe("built");   // skills/myharness 없음
    expect(sc.diag).toBeNull();               // 계층B 미호출(fail-open)
    expect(sc.config_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(sc.counts.agents).toBe(1);
  });

  it("--snapshot 모드(위치 무관) → 파일 기록·{written} stdout / read 모드는 write 안 함", async () => {
    root = await mkdtemp(join(tmpdir(), "hui-cli-snap-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "a.md"), "---\nname: a\nskills: [s1]\n---\n");
    await mkdir(join(root, ".claude", "skills", "s1"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "s1", "SKILL.md"), "---\nname: s1\ndescription: d\n---\n");
    // read 모드: write 없음
    await pexec("node", [CLI, root]);
    await access(join(root, "_workspace", "evals", "harness_summary.jsonl")).then(() => { throw new Error("read 모드가 write함"); }, () => {});
    // snapshot 모드(--snapshot 뒤·위치 무관)
    const { stdout } = await pexec("node", [CLI, "--snapshot", root]);
    expect(JSON.parse(stdout).written).toBe(true);
    await access(join(root, "_workspace", "evals", "harness_summary.jsonl")); // 기록됨
  });

  it("실 2프로세스 동시 --snapshot → summary 중복 0(lockfile 상호배제)", async () => {
    root = await mkdtemp(join(tmpdir(), "hui-cli-conc-"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "a.md"), "---\nname: a\nskills: [s1]\n---\n");
    await mkdir(join(root, ".claude", "skills", "s1"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "s1", "SKILL.md"), "---\nname: s1\ndescription: d\n---\n");
    // 별도 node 프로세스 2개 동시(같은 root·동일 state) — hardlink 경합
    await Promise.all([pexec("node", [CLI, "--snapshot", root]), pexec("node", [CLI, "--snapshot", root])]);
    const lines = (await readFile(join(root, "_workspace", "evals", "harness_summary.jsonl"), "utf8")).split("\n").filter(Boolean);
    expect(lines.length).toBe(1);   // 동일 state → 1줄(중복 append 0)
  });
});
