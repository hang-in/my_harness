// 서명 소유권 레지스트리 (설계 §4-A). <state_home>/registry/{runId}.owner.json, HMAC 서명.
// kill 전 3중 검증(서명·identity·exe/cwd)의 '서명' 축. _workspace 밖에 저장(스푸핑 차단).
import { mkdir, readFile, rm, open } from "node:fs/promises";
import { join } from "node:path";
import { stateHome } from "../lib/paths.js";
import { sign, verify } from "../lib/hmac.js";
import { isSafeSegment } from "../lib/paths.js";

export type OwnerRecord = {
  runId: string;
  pid: number;
  groupId: number | string | null; // POSIX pgid | Windows pid-marker
  startTime: string;               // 불투명 문자열(정확일치 비교)
  exe: string;
  cwd: string;
  nonce: string;
};

async function regDir(): Promise<string> {
  const d = join(stateHome(), "registry");
  await mkdir(d, { recursive: true, mode: 0o700 });
  return d;
}
function regPath(dir: string, runId: string): string { return join(dir, `${runId}.owner.json`); }

// 정규 직렬화(서명 안정성 — 키 순서 고정).
function canon(rec: OwnerRecord): string {
  return JSON.stringify([rec.runId, rec.pid, rec.groupId, rec.startTime, rec.exe, rec.cwd, rec.nonce]);
}

// owner 기록 — 기본 O_EXCL 생성(중복 start 무음 교체 차단, §4-A). replace=true 는 명시 교체(reconcile 후).
export async function writeOwner(rec: OwnerRecord, replace = false): Promise<void> {
  if (!isSafeSegment(rec.runId)) throw new Error("invalid runId");
  const dir = await regDir();
  const sig = await sign(canon(rec));
  const body = JSON.stringify({ rec, sig }, null, 2) + "\n";
  const p = regPath(dir, rec.runId);
  const fh = await open(p, replace ? "w" : "wx", 0o600); // wx=O_EXCL
  try { await fh.writeFile(body, "utf8"); await fh.sync().catch(() => {}); }
  finally { await fh.close(); }
}

// 서명 검증 통과 시에만 레코드 반환. 서명 무효/파손 → null(오kill 방지).
export async function readOwner(runId: string): Promise<OwnerRecord | null> {
  if (!isSafeSegment(runId)) return null;
  const dir = await regDir();
  try {
    const raw = JSON.parse(await readFile(regPath(dir, runId), "utf8")) as { rec: OwnerRecord; sig: string };
    if (!raw?.rec || typeof raw.sig !== "string") return null;
    return (await verify(canon(raw.rec), raw.sig)) ? raw.rec : null;
  } catch { return null; }
}

export async function removeOwner(runId: string): Promise<void> {
  if (!isSafeSegment(runId)) return;
  const dir = await regDir();
  await rm(regPath(dir, runId), { force: true });
}
