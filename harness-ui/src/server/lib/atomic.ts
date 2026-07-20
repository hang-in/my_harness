// 원자 상태쓰기 (설계 §3): 동일 디렉토리 temp → fsync(file) → rename → fsync(dir).
import { open, rename, mkdir, rm } from "node:fs/promises";
import { dirname, join, basename } from "node:path";

let counter = 0;

export async function writeAtomic(path: string, data: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp.${process.pid}.${counter++}`);
  const fh = await open(tmp, "wx", 0o600); // wx=O_EXCL(temp 충돌 방지)
  try {
    await fh.writeFile(data, "utf8");
    await fh.sync(); // fsync(file)
  } catch (e) {
    await fh.close().catch(() => {});
    await rm(tmp, { force: true }); // 실패 시 temp 정리(누적 방지)
    throw e;
  } finally {
    await fh.close().catch(() => {});
  }
  await rename(tmp, path);
  // fsync(dir) — 디렉토리 엔트리 내구성(POSIX). Windows/일부 FS는 EISDIR/EPERM → 무시.
  try {
    const dh = await open(dir, "r");
    try { await dh.sync(); } finally { await dh.close(); }
  } catch { /* dir fsync 미지원 — best-effort */ }
}

export async function writeJsonAtomic(path: string, obj: unknown): Promise<void> {
  await writeAtomic(path, JSON.stringify(obj, null, 2) + "\n");
}
