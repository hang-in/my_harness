import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { validateProjectRoot, revalidateForPersist } from "../src/server/lib/projectroot.js";

// F3-root 거부/ACCEPT 스위트 (A68·A69·D1~D8).
describe("validateProjectRoot D1~D8 (F3-root)", () => {
  let ph: string;            // projectsHome(실 dir)
  let appDir: string;        // ph/x/projects/app (마커 존재·정상)

  beforeEach(async () => {
    ph = await mkdtemp(join(tmpdir(), "hui-ph-"));
    appDir = join(ph, "x", "projects", "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "CLAUDE.md"), "# marker\n"); // 하네스 마커(D5)
  });
  afterEach(async () => { await rm(ph, { recursive: true, force: true }); });

  it("ACCEPT: projectsHome 하위 마커 dir → ok·effectiveRoot=realpath", async () => {
    const v = await validateProjectRoot(appDir, ph);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.effectiveRoot).toBe(await realpath(appDir));
  });

  it("ACCEPT: projectsHome 조상이 심링크(/var·/tmp realpath 변경 analog) → 통과(D2 realpath)", async () => {
    // ph 를 가리키는 심링크를 projectsHome 으로 사용 — 절대 상위 realpath 변경 허용(오거부 0).
    const linkParent = await mkdtemp(join(tmpdir(), "hui-lnk-"));
    const phLink = join(linkParent, "home");
    try {
      await symlink(ph, phLink, "dir");
    } catch { await rm(linkParent, { recursive: true, force: true }); return; } // 심링크 불가 환경 skip
    const v = await validateProjectRoot(join(phLink, "x", "projects", "app"), phLink);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.effectiveRoot).toBe(await realpath(appDir));
    await rm(linkParent, { recursive: true, force: true });
  });

  it("D1: 상대경로 → bad-input", async () => {
    expect((await validateProjectRoot("relative/path", ph))).toMatchObject({ ok: false, error: "bad-input" });
  });
  it("D1: `..` 포함 → bad-input", async () => {
    expect((await validateProjectRoot(join(ph, "x", "..", "..", "etc"), ph))).toMatchObject({ ok: false, error: "bad-input" });
  });
  it("D1: tilde(~/proj) → bad-input", async () => {
    expect((await validateProjectRoot("~/proj", ph))).toMatchObject({ ok: false, error: "bad-input" });
  });
  it("D1: UNC(\\\\host\\share) → bad-input", async () => {
    expect((await validateProjectRoot("\\\\host\\share", ph))).toMatchObject({ ok: false, error: "bad-input" });
  });
  it("D1: 드라이브상대(C:foo) → bad-input", async () => {
    expect((await validateProjectRoot("C:foo", ph))).toMatchObject({ ok: false, error: "bad-input" });
  });
  it("D1: 미정규화 유니코드(NFD) → bad-input", async () => {
    const nfd = join(ph, "é"); // NFD "é" — NFC 아님
    expect((await validateProjectRoot(nfd, ph))).toMatchObject({ ok: false, error: "bad-input" });
  });

  it("D3: projectsHome 하위 상대 세그먼트가 심링크 → symlink", async () => {
    const linkTarget = await mkdtemp(join(tmpdir(), "hui-tgt-"));
    await writeFile(join(linkTarget, "CLAUDE.md"), "# marker\n");
    const linkPath = join(ph, "sub");
    try { await symlink(linkTarget, linkPath, "dir"); }
    catch { await rm(linkTarget, { recursive: true, force: true }); return; }
    const v = await validateProjectRoot(linkPath, ph);
    expect(v).toMatchObject({ ok: false, error: "symlink" });
    await rm(linkTarget, { recursive: true, force: true });
  });

  it("D4: 시스템 경로(/etc) → denied-system-path", async () => {
    const v = await validateProjectRoot("/etc", ph);
    // 거부 보장이 핵심 — 정확 코드는 env·플랫폼에 따라 상이(POSIX: denied-system-path|outside-projects-home / Windows: /etc 비유효 → bad-input).
    expect(v).toMatchObject({ ok: false });
    expect(["denied-system-path", "outside-projects-home", "bad-input"]).toContain((v as { error?: string }).error);
  });

  it("D4: 홈 직속 dotdir(~/.secretX) → denied-system-path", async () => {
    const origHome = process.env.HOME;
    const fakeHome = await mkdtemp(join(tmpdir(), "hui-home-"));
    const dot = join(fakeHome, ".secretX");
    await mkdir(dot, { recursive: true });
    await writeFile(join(dot, "CLAUDE.md"), "# fake\n");
    process.env.HOME = fakeHome;
    try {
      // homedir() 캐시 여부 확인 — 캐시면 skip(오탐 방지)
      if (homedir() !== fakeHome) return;
      const v = await validateProjectRoot(dot, ph);
      // 거부 보장이 핵심 — env별 denied-system-path|outside-projects-home.
      expect(v).toMatchObject({ ok: false });
      expect(["denied-system-path", "outside-projects-home"]).toContain((v as { error?: string }).error);
    } finally {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("D5: 마커 없는 projectsHome 하위 dir → no-harness-marker", async () => {
    const bare = join(ph, "bare");
    await mkdir(bare, { recursive: true });
    const v = await validateProjectRoot(bare, ph);
    expect(v).toMatchObject({ ok: false, error: "no-harness-marker" });
  });

  it("D2: projectsHome 밖(위조 마커 포함) → outside-projects-home(마커는 경계 아님)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-out-"));
    await writeFile(join(outside, "CLAUDE.md"), "# forged marker\n"); // 위조 마커
    const v = await validateProjectRoot(outside, ph);
    expect(v).toMatchObject({ ok: false, error: "outside-projects-home" });
    await rm(outside, { recursive: true, force: true });
  });

  it("미프로비저닝(빈 projectsHome) → outside-projects-home(경계 없음)", async () => {
    expect((await validateProjectRoot(appDir, ""))).toMatchObject({ ok: false, error: "outside-projects-home" });
  });

  it("D7: revalidateForPersist — effectiveRoot 불일치 시 escape", async () => {
    const v = await validateProjectRoot(appDir, ph);
    expect(v.ok).toBe(true);
    // 검증 후 기대 root 가 다르면(스왑 analog) escape
    const swapped = await revalidateForPersist(appDir, ph, "/some/other/root");
    expect(swapped).toMatchObject({ ok: false, error: "escape" });
    // 동일 root 면 통과
    if (v.ok) {
      const same = await revalidateForPersist(appDir, ph, v.effectiveRoot);
      expect(same.ok).toBe(true);
    }
  });

  // Windows reparse(junction/mount) — AS4. non-win32 은 junction 생성 불가라 skip(3-OS CI 게이트).
  (process.platform === "win32" ? it : it.skip)("D3: Windows junction 하위 세그먼트 → reparse-point", async () => {
    const jTarget = await mkdtemp(join(tmpdir(), "hui-jt-"));
    const jPath = join(ph, "jun");
    await symlink(jTarget, jPath, "junction"); // win32 junction
    const v = await validateProjectRoot(jPath, ph);
    // 거부 보장이 핵심 — reparse-point(D3 readlink) | symlink(junction을 심링크로 감지) | outside-projects-home(D2 최후방어) 모두 닫힘.
    expect(v.ok).toBe(false);
    if (!v.ok) expect(["reparse-point", "symlink", "outside-projects-home"]).toContain(v.error);
    await rm(jTarget, { recursive: true, force: true });
  });
});
