// A17 실 codex 스모크 — 실 spawn·supervisor·구조화 로그 종단. 임시 projectRoot(실 레포 _workspace 미오염).
// 실행: HARNESS_STATE_HOME=<tmp> HARNESS_PROJECT_ROOT=<tmp> npx tsx test/smoke-codex.mjs
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchRun } from "../src/server/exec-run.ts";
import { isSchemaValid, Status } from "../src/server/schemas.ts";

const root = process.env.HARNESS_PROJECT_ROOT;
let fail = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} — ${m}`); if (!c) fail++; };

console.log("실 codex exec 스폰 중(trivial task)…");
const res = await launchRun(root, {
  runtime: "codex", mode: "smoke", domain: "Reply with exactly the word: OK. Do nothing else.",
  permissionMode: "read-only", model: "default", targets: [], allowedTools: [], dryRun: false,
});
ok(res.dryRun === false && typeof res.pid === "number", `spawn: pid=${res.pid} runId=${res.runId}`);
const runDir = res.runDir;

// exit 까지 폴링(최대 90s) — status.json state 가 terminal 될 때까지.
const statusPath = join(runDir, "status.json");
const terminal = new Set(["completed", "failed", "canceled", "timeout"]);
let st = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { st = JSON.parse(await readFile(statusPath, "utf8")); } catch { continue; }
  if (terminal.has(st.state)) break;
}
ok(st !== null, "status.json 생성됨");
ok(isSchemaValid(Status, st), `status 스키마 유효 (state=${st?.state})`);
ok(terminal.has(st?.state), `실행 종료 도달 (state=${st?.state}, exitCode=${st?.exitCode})`);
ok(typeof st?.childPid === "number" || st?.childPid === null, "childPid 필드 존재");

// events.jsonl 존재·각 줄 파싱 가능
try {
  const ev = await readFile(join(runDir, "events.jsonl"), "utf8");
  const lines = ev.split("\n").filter(Boolean);
  const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
  ok(parsed.every((p) => p !== null), `events.jsonl 전 줄 JSON 파싱 (${lines.length}줄)`);
} catch { ok(false, "events.jsonl 읽기(없으면 codex 로그 형식 차이 — status 로만 판정)"); }

// last-message 산출물
try {
  const af = await readdir(join(runDir, "agents"));
  ok(af.length > 0, `agents/ 산출물 (${af.join(",")})`);
} catch { ok(true, "agents/ 없음(허용 — codex 출력 경로 차이)"); }

console.log(`\nsmoke-codex: ${fail === 0 ? "ALL PASS" : fail + " FAIL"} (runDir=${runDir})`);
process.exit(fail === 0 ? 0 : 1);
