// HMAC 세션키 수명주기 (설계 §4-A). 서버 기동 시 CSPRNG 키 생성·<state_home>/keys 저장(0600)·로드.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { open, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stateHome } from "./paths.js";

let cachedKey: Buffer | null = null;

async function keyPath(): Promise<string> {
  const dir = join(stateHome(), "keys");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return join(dir, "session.key");
}

// 32바이트 hex 키만 유효로 인정(절단/약키 거부 — fail-closed).
function parseKey(hex: string): Buffer | null {
  const s = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(s)) return null; // 정확히 32바이트 hex
  return Buffer.from(s, "hex");
}

// 존재하면 로드, 없으면 CSPRNG 생성·0600 저장(O_EXCL로 경합 방지).
export async function getSessionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const p = await keyPath();
  try {
    const k = parseKey(await readFile(p, "utf8"));
    if (k) { cachedKey = k; return k; }
    throw new Error("invalid key file"); // 손상/약키 → 재생성 시도
  } catch { /* 없음/손상 → 생성 */ }
  const key = randomBytes(32); // 256-bit
  try {
    const fh = await open(p, "wx", 0o600); // wx = O_EXCL(이미 있으면 실패 → 재로드)
    try { await fh.writeFile(key.toString("hex"), "utf8"); } finally { await fh.close(); }
    cachedKey = key;
    return key;
  } catch {
    const k = parseKey(await readFile(p, "utf8").catch(() => "")); // 경합: 남이 만든 것 로드·재검증
    if (!k) throw new Error("session key unavailable/invalid");     // fail-closed
    cachedKey = k;
    return k;
  }
}

export async function sign(data: string): Promise<string> {
  const key = await getSessionKey();
  return createHmac("sha256", key).update(data).digest("hex");
}

export async function verify(data: string, sig: string): Promise<boolean> {
  const expected = await sign(data);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// 테스트용 리셋.
export function _resetKeyCache(): void { cachedKey = null; }
