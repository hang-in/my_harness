import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgv, RunRequest, launchRun } from "../src/server/exec-run.js";
import { ingest } from "../src/server/supervisor/supervisor.js";

let stateDir: string;
beforeAll(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-x-")); process.env.HARNESS_STATE_HOME = stateDir; });
afterAll(async () => { await rm(stateDir, { recursive: true, force: true }); delete process.env.HARNESS_STATE_HOME; });

const req = (o: Partial<RunRequest> = {}): RunRequest => RunRequest.parse({ runtime: "codex", mode: "build", domain: "x", ...o });

describe("argv 계약 (A15·A16)", () => {
  it("codex: --json·--sandbox·-o·`--` 앞옵션 뒤 positional Task:\\n", () => {
    const { cmd, args } = buildArgv(req({ runtime: "codex" }), "/run");
    expect(cmd).toBe("codex");
    const dd = args.indexOf("--");
    expect(dd).toBeGreaterThan(0);
    expect(args[dd + 1]).toBe("Task:\nx");        // A16: `--` 뒤 positional, Task: prefix
    expect(args).toContain("--json");
    expect(args.slice(0, dd)).toContain("--sandbox");
  });
  it("claude: --allowedTools 배열(콤마문자열·--tools 아님)", () => {
    const { cmd, args } = buildArgv(req({ runtime: "claude", allowedTools: ["Read", "Grep"] }), "/run");
    expect(cmd).toBe("claude");
    expect(args).toContain("--allowedTools");
    expect(args).not.toContain("--tools");
    const i = args.indexOf("--allowedTools");
    expect(args[i + 1]).toBe("Read"); expect(args[i + 2]).toBe("Grep"); // 배열(별 인자)
    expect(args).not.toContain("Read,Grep");                            // 콤마문자열 아님
  });
  it("A15: shell metachar domain 이 argv 단일 요소로(shell 미실행)", () => {
    const { args } = buildArgv(req({ domain: "a; rm -rf / && echo $(whoami)" }), "/run");
    const dd = args.indexOf("--");
    expect(args[dd + 1]).toBe("Task:\na; rm -rf / && echo $(whoami)"); // 통째로 1개 인자(분해 안 됨)
    expect(args.length).toBe(dd + 2); // prompt 뒤 추가 인자 없음
  });
  it("dash-domain 도 `--` 뒤라 옵션 해석 안 됨", () => {
    const { args } = buildArgv(req({ domain: "--dangerous-flag" }), "/run");
    const dd = args.indexOf("--");
    expect(args[dd + 1]).toBe("Task:\n--dangerous-flag");
  });
  it("잘못된 요청 Zod 거부(runtime·targets allowlist)", () => {
    expect(RunRequest.safeParse({ runtime: "bash", mode: "m", domain: "d" }).success).toBe(false);
    expect(RunRequest.safeParse({ runtime: "codex", mode: "m", domain: "d", targets: ["evil"] }).success).toBe(false);
  });
});

describe("launch (A9b dry-run·실행)", () => {
  it("A9b: dry-run 은 파일 미기록·preview 반환", async () => {
    const root = await mkdtemp(join(tmpdir(), "hui-dry-"));
    const r = await launchRun(root, req({ dryRun: true, domain: "build ui" }));
    expect(r.dryRun).toBe(true);
    if (r.dryRun) { expect(r.preview.cmd).toBe("codex"); }
    // runDir 파일 없음(순수 미리보기)
    await expect(stat(join(r.runDir, "manifest.json"))).rejects.toBeTruthy();
    await rm(root, { recursive: true, force: true });
  });
  // 관리 루프 자동 finalize 는 POSIX 프로세스그룹/시그널 semantics 의존 — Windows 감독 경로는 별도(win32 skip).
  (process.platform === "win32" ? it.skip : it)("A6: superviseRun 관리 루프 — 수동 ingest 없이 exit 시 자동 finalize(completed)", async () => {
    const root = await mkdtemp(join(tmpdir(), "hui-run5-"));
    const { superviseRun, writeManifest, writeStatus, SUPERVISOR_VERSION } = await import("../src/server/supervisor/supervisor.js");
    const runDir = join(root, "_workspace", "runs", "run-x");
    await writeManifest(runDir, { schemaVersion: "1", runId: "run-x", projectRoot: root, runtime: "codex", mode: "build", createdAt: "2026-07-09T10:00:00+09:00", requestedBy: "t", goal: "g", agents: [], agent: null, targets: [], permissionMode: "read-only", model: "default", supervisorVersion: SUPERVISOR_VERSION });
    await writeStatus(runDir, { schemaVersion: "1", runId: "run-x", state: "queued", phase: "", progress: 0, updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00", serverPid: 1, serverStartTime: "", childPid: null, childStartTime: null, childProcessGroupId: null, exitCode: null, exitSignal: null, cancelRequestedAt: null, stateReason: null, summary: "", error: null });
    // 실 codex 대신 node 로 JSONL 방출 후 종료. superviseRun 이 exit 감지→최종 ingest→terminal status.
    await superviseRun(runDir, process.execPath, ["-e", `process.stdout.write(JSON.stringify({ts:new Date().toISOString(),level:"info",event:"agent_completed",agent:"builder",phase:"P1",state:"completed",progress:100})+"\\n")`]);
    let st: { state: string } = { state: "" };
    for (let i = 0; i < 60; i++) { // 수동 ingest 없이 자동 finalize 대기
      await new Promise((r) => setTimeout(r, 100));
      st = JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
      if (["completed", "failed"].includes(st.state)) break;
    }
    expect(st.state).toBe("completed"); // 관리 루프가 자동 승격·종료 처리(A6)
    void ingest;
    await rm(root, { recursive: true, force: true });
  }, 15000);
});
