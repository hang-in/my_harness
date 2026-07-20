import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeOwner, readOwner, removeOwner, type OwnerRecord } from "../src/server/supervisor/registry.js";
import { _resetKeyCache } from "../src/server/lib/hmac.js";

let stateDir: string;
const rec = (runId: string): OwnerRecord => ({
  runId, pid: 123, groupId: 123, startTime: "t", exe: "/bin/x", cwd: "/c", nonce: "n1",
});

beforeAll(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-reg-")); process.env.HARNESS_STATE_HOME = stateDir; _resetKeyCache(); });
afterAll(async () => { await rm(stateDir, { recursive: true, force: true }); delete process.env.HARNESS_STATE_HOME; _resetKeyCache(); });

describe("서명 owner 레지스트리 (§4-A)", () => {
  it("write→read round-trip (서명 검증)", async () => {
    await writeOwner(rec("run-1"));
    const r = await readOwner("run-1");
    expect(r?.pid).toBe(123);
  });
  it("변조된 레코드 → null(오kill 방지)", async () => {
    await writeOwner(rec("run-2"));
    const p = join(stateDir, "registry", "run-2.owner.json");
    const obj = JSON.parse(await readFile(p, "utf8"));
    obj.rec.pid = 999; // groupId/pid 위조
    await writeFile(p, JSON.stringify(obj));
    expect(await readOwner("run-2")).toBeNull();
  });
  it("없는 run → null · traversal runId → null", async () => {
    expect(await readOwner("nope")).toBeNull();
    expect(await readOwner("../etc")).toBeNull();
  });
  it("remove", async () => {
    await writeOwner(rec("run-3")); await removeOwner("run-3");
    expect(await readOwner("run-3")).toBeNull();
  });
});
