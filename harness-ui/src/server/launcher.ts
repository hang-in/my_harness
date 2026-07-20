// 런처 (설계 §5c·M6). 첫 실행 자동 bootstrap: node/npm 확인·동의 npm ci --ignore-scripts·lock 해시·
// §4-A 멱등(state_home)·fragment 토큰(URL/로그 미노출)·OS별 브라우저. plugin-install-time 자동은 불가(첫 실행 원커맨드).
import { createHash } from "node:crypto";
import { constants as FS } from "node:fs";
import { readFile, stat, mkdir, open as fsopen } from "node:fs/promises";
import { join } from "node:path";
import { resolveBin } from "./lib/exec.js";
import { stateHome } from "./lib/paths.js";

export type RuntimeTools = { node: string; npm: string } | null;

// node=process.execPath(PATH hijack 회피), npm=절대경로 해소(Windows npm.cmd). 없으면 null(graceful A32).
export async function resolveTools(): Promise<RuntimeTools> {
  const node = process.execPath;
  const npm = await resolveBin("npm");
  if (!npm) return null;
  return { node, npm };
}

// lock 해시 대조(변조 fail-closed A33). **baseline 없으면 fail-closed**(미검증 설치 금지).
export async function verifyLockfile(appDir: string, expectedHex?: string): Promise<{ ok: boolean; reason: string }> {
  if (!expectedHex) return { ok: false, reason: "no-baseline(fail-closed)" }; // 기준 없음 → 설치 금지
  try {
    const buf = await readFile(join(appDir, "package-lock.json"));
    const h = createHash("sha256").update(buf).digest("hex");
    return h === expectedHex ? { ok: true, reason: "hash-match" } : { ok: false, reason: "hash-mismatch(fail-closed)" };
  } catch { return { ok: false, reason: "no-lockfile" }; }
}

// 기본 설치 인자 — lifecycle RCE 차단(A33). scripts 필요 시 별도 2차 동의로 --ignore-scripts 제거.
export function installArgs(runScripts = false): string[] {
  return runScripts ? ["ci"] : ["ci", "--ignore-scripts"];
}

// OS별 브라우저 오픈 argv(execFile+argv). Windows start=cmd 빌트인 → cmd /d /s /c.
export function openArgs(url: string): { cmd: string; args: string[] } {
  // URL 은 127.0.0.1 로컬만 + fragment(#) 토큰. 호출측이 new URL 검증.
  switch (process.platform) {
    case "darwin": return { cmd: "open", args: [url] };
    case "win32": return { cmd: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] };
    default: return { cmd: "xdg-open", args: [url] };
  }
}

// fragment URL — 토큰은 `#` 뒤(HTTP 요청/서버로그 미전송). new URL 로 127.0.0.1 만 허용(A34).
export function bootstrapUrl(port: number, bootstrap: string): string {
  const u = new URL(`http://127.0.0.1:${port}/`);
  if (!/^127\.0\.0\.1$/.test(u.hostname)) throw new Error("non-local");
  return `${u.origin}/#${encodeURIComponent(bootstrap)}`;
}

// node_modules 존재?
export async function depsInstalled(appDir: string): Promise<boolean> {
  try { await stat(join(appDir, "node_modules")); return true; } catch { return false; }
}

// 서버 liveness — 비인증 /healthz 프로브(멱등 판정 A31). fetch 실패=미실행.
export async function serverAlive(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// bootstrap 토큰 파일(<state_home>/.bootstrap, 0600) — 서버가 기동/rotate 시 기록, 런처가 읽어 fragment 전달.
export function bootstrapPath(): string { return join(stateHome(), ".bootstrap"); }
export async function writeBootstrap(token: string): Promise<void> {
  await mkdir(stateHome(), { recursive: true, mode: 0o700 });
  // O_NOFOLLOW+O_TRUNC: 기존 symlink 따라가 토큰 리다이렉트 방지. chmod 로 0600 강제(기존 파일 권한 보정).
  const flags = FS.O_WRONLY | FS.O_CREAT | FS.O_TRUNC | (FS.O_NOFOLLOW ?? 0);
  const fh = await fsopen(bootstrapPath(), flags, 0o600);
  try { await fh.chmod(0o600); await fh.writeFile(token, "utf8"); } finally { await fh.close(); } // chmod 먼저(기존 0644 파일에 토큰 쓰기 전 권한 제한)
}
export async function readBootstrap(): Promise<string | null> {
  try { return (await readFile(bootstrapPath(), "utf8")).trim() || null; } catch { return null; }
}

export type LaunchOutcome =
  | { status: "no-node"; message: string }
  | { status: "needs-consent"; message: string }         // 의존성 설치 동의 필요(silent 금지 A33)
  | { status: "lockfile-untrusted"; reason: string }      // 해시 불일치/기준없음(fail-closed)
  | { status: "opened-existing"; url: string }            // 이미 실행 중 → 새 토큰으로 재오픈(A31)
  | { status: "install-and-open"; url: string; install: { cmd: string; args: string[] } }  // 첫 실행: 설치 후 오픈 계획
  | { status: "open"; url: string };                      // 의존성 있음 → 기동/오픈

// 첫 실행 bootstrap 오케스트레이션. consent 없이는 설치 안 함(A33). 순서: 멱등→node확인→의존성/동의/해시→오픈.
// (실 npm/브라우저 spawn 은 호출측이 install/open argv 로 execFile — 여기선 결정·게이트만. 순수·테스트 가능.)
export async function planLaunch(
  appDir: string, port: number,
  opts: { consent: boolean; runScripts?: boolean; expectedLockHash?: string },
): Promise<LaunchOutcome> {
  // A31 멱등: 서버 살아있으면 새 bootstrap(파일)로 재오픈.
  if (await serverAlive(port)) {
    const b = await readBootstrap();
    return { status: "opened-existing", url: b ? bootstrapUrl(port, b) : `http://127.0.0.1:${port}/` };
  }
  // A32: node/npm 없으면 graceful.
  const tools = await resolveTools();
  if (!tools) return { status: "no-node", message: "node/npm 미검출 — 설치 후 재시도" };

  const b = (await readBootstrap()) ?? "";
  const url = b ? bootstrapUrl(port, b) : `http://127.0.0.1:${port}/`;

  if (await depsInstalled(appDir)) return { status: "open", url }; // 의존성 있음 → 기동/오픈

  // 첫 설치: 동의 필수(A33) + 해시 fail-closed.
  if (!opts.consent) return { status: "needs-consent", message: "의존성 설치(npm ci --ignore-scripts) 동의 필요" };
  const v = await verifyLockfile(appDir, opts.expectedLockHash);
  if (!v.ok) return { status: "lockfile-untrusted", reason: v.reason };
  return { status: "install-and-open", url, install: { cmd: tools.npm, args: installArgs(opts.runScripts) } };
}
