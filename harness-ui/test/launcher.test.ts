import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveTools, verifyLockfile, installArgs, openArgs, bootstrapUrl, depsInstalled, writeBootstrap, readBootstrap, planLaunch } from "../src/server/launcher.js";

let stateDir: string;
beforeAll(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-l-")); process.env.HARNESS_STATE_HOME = stateDir; });
afterAll(async () => { await rm(stateDir, { recursive: true, force: true }); delete process.env.HARNESS_STATE_HOME; });

describe("런처 (A30-A34)", () => {
  it("A32: node/npm 해소(있으면 tools, 없으면 null=graceful)", async () => {
    const t = await resolveTools();
    // 이 환경엔 node·npm 있음
    expect(t).not.toBeNull();
    expect(t!.node).toBe(process.execPath);
  });
  it("A33: 기본 설치 인자 = ci --ignore-scripts(lifecycle RCE 차단)", () => {
    expect(installArgs()).toEqual(["ci", "--ignore-scripts"]);
    expect(installArgs(true)).toEqual(["ci"]); // 2차 동의 시만
  });
  it("A33: lock 해시 대조 — 일치/불일치(fail-closed)", async () => {
    const app = await mkdtemp(join(tmpdir(), "hui-app-"));
    await writeFile(join(app, "package-lock.json"), '{"x":1}');
    const h = createHash("sha256").update('{"x":1}').digest("hex");
    expect((await verifyLockfile(app, h)).ok).toBe(true);
    expect((await verifyLockfile(app, "deadbeef")).ok).toBe(false); // 변조 → fail-closed
    expect((await verifyLockfile(app + "-none")).ok).toBe(false);   // 없음
    await rm(app, { recursive: true, force: true });
  });
  it("A30w: OS별 브라우저 argv(Windows=cmd /d /s /c start)", () => {
    const o = openArgs("http://127.0.0.1:5173/#tok");
    if (process.platform === "win32") { expect(o.cmd).toBe("cmd.exe"); expect(o.args).toContain("start"); }
    else if (process.platform === "darwin") { expect(o.cmd).toBe("open"); }
    else { expect(o.cmd).toBe("xdg-open"); }
  });
  it("A34: bootstrap URL 은 fragment(#) — 쿼리/경로에 토큰 없음", () => {
    const u = bootstrapUrl(5173, "SECRET");
    expect(u).toBe("http://127.0.0.1:5173/#SECRET");
    expect(u.split("#")[0]).not.toContain("SECRET"); // origin/path 에 토큰 없음
    expect(new URL(u).search).toBe("");               // 쿼리 없음
  });
  it("A31: bootstrap 파일 write/read(0600)·멱등 재발급", async () => {
    await writeBootstrap("tok-1");
    expect(await readBootstrap()).toBe("tok-1");
    await writeBootstrap("tok-2"); // rotate
    expect(await readBootstrap()).toBe("tok-2");
  });
  it("A33: verifyLockfile — baseline 없으면 fail-closed", async () => {
    const app = await mkdtemp(join(tmpdir(), "hui-fc-"));
    await writeFile(join(app, "package-lock.json"), "{}");
    expect((await verifyLockfile(app)).ok).toBe(false); // 기준 없음 → 설치 금지
    await rm(app, { recursive: true, force: true });
  });
  it("A30/A33: planLaunch — 동의 없으면 needs-consent(silent 설치 안 함)", async () => {
    const app = await mkdtemp(join(tmpdir(), "hui-pl-"));
    await writeFile(join(app, "package-lock.json"), "{}");
    const port = 59999; // 미사용 포트(serverAlive false)
    const r1 = await planLaunch(app, port, { consent: false });
    expect(r1.status).toBe("needs-consent"); // node_modules 없음 + 미동의 → 설치 안 함
    const r2 = await planLaunch(app, port, { consent: true }); // 동의하나 lock 해시 기준 없음 → fail-closed
    expect(r2.status).toBe("lockfile-untrusted");
    const h = createHash("sha256").update("{}").digest("hex");
    const r3 = await planLaunch(app, port, { consent: true, expectedLockHash: h }); // 동의+해시일치 → 설치계획
    expect(r3.status).toBe("install-and-open");
    if (r3.status === "install-and-open") { expect(r3.install.args).toEqual(["ci", "--ignore-scripts"]); expect(r3.url).toContain("#"); }
    await rm(app, { recursive: true, force: true });
  });
  it("depsInstalled 판정", async () => {
    const app = await mkdtemp(join(tmpdir(), "hui-dep-"));
    expect(await depsInstalled(app)).toBe(false);
    await mkdir(join(app, "node_modules"), { recursive: true });
    expect(await depsInstalled(app)).toBe(true);
    await rm(app, { recursive: true, force: true });
  });
});

import { chmod, stat as fsstat, writeFile as wf } from "node:fs/promises";
describe("writeBootstrap 권한 실증(A34 보강)", () => {
  // POSIX 퍼미션 모델 전용 — Windows 는 ACL 기반이라 mode 비트 무의미(win32 skip).
  (process.platform === "win32" ? it.skip : it)("기존 0644 파일도 write 후 0600(chmod-first)", async () => {
    const { bootstrapPath, writeBootstrap } = await import("../src/server/launcher.js");
    await wf(bootstrapPath(), "old").catch(() => {});
    await chmod(bootstrapPath(), 0o644).catch(() => {});
    await writeBootstrap("newtok");
    const m = (await fsstat(bootstrapPath())).mode & 0o777;
    expect(m & 0o077).toBe(0); // group/other 권한 없음
  });
});
