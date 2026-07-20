// M8 F5 R2(codex) MED — 절단 비-UTF8 오판(binary:false → replacement 문자 표시, DV7 위배).
// 미리보기가 VIEW_MAX 절단 파일에 대해 fatal UTF-8 decode 를 생략하면 널바이트 없는 큰 바이너리가
// binary:false 로 내려간다. 수정: 절단 파일도 fatal decode 하되 마지막 0~3바이트(멀티바이트 경계)만
// 보수적 제외 → 경계서 잘린 정상 멀티바이트(한글)는 오탐 없이(false-positive 방지), 진짜 비-UTF8 은 감지.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApi } from "../src/server/api/index.js";
import { VIEW_MAX } from "../src/server/lib/servefile.js";

let root: string, app: FastifyInstance;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-bin-"));
  const docs = join(root, "docs");
  await mkdir(docs, { recursive: true });
  // (a) 널바이트 없는 invalid UTF-8(0xFF 는 UTF-8 에서 절대 유효치 않음) + VIEW_MAX 초과(절단)
  await writeFile(join(docs, "binff.md"), Buffer.alloc(VIEW_MAX + 4096, 0xff));
  // (b) 정상 한글(3바이트) 반복 → 읽기 VIEW_MAX 가 멀티바이트 경계 중간을 자르게(1048576 % 3 !== 0)
  //     절단됨에도 binary 오탐 없어야(false-positive 방지).
  const cnt = Math.ceil(VIEW_MAX / 3) + 2; // 총 바이트 > VIEW_MAX 보장
  await writeFile(join(docs, "korean.md"), Buffer.from("가".repeat(cnt), "utf8"));
  app = Fastify({ logger: false });
  registerApi(app, root);
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

describe("R2 MED — 절단 비-UTF8 감지", () => {
  it("널바이트 없는 invalid UTF-8 + 절단 → binary:true·content null", async () => {
    const r = await app.inject({ url: "/api/docs/binff.md" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.truncated).toBe(true);
    expect(b.binary).toBe(true);
    expect(b.content).toBeNull();
  });

  it("경계서 잘린 정상 한글(멀티바이트) 절단 → binary:false·정상 미리보기(false-positive 방지)", async () => {
    const r = await app.inject({ url: "/api/docs/korean.md" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.truncated).toBe(true);
    expect(b.binary).toBe(false);
    expect(b.content).toContain("가");
  });
});
