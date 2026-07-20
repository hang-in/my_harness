import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunsQuery } from "../src/server/schemas.js";
import { queryRuns } from "../src/server/adapters/runs.js";

// ── M7 F4 R5 서버 HIGH(codex) 회귀 스위트 ──────────────────────────────────────
// [HIGH] opendir(base) 호출 자체 실패가 scan_error 아닌 빈 정상 결과로 은폐.
//   ENOENT(runs 디렉토리 없음)만 빈 정상. EACCES/IO 등 그 외는 truncated:true·reason:scan_error.
// 제어 플래그(모듈 스코프 — vi.mock 팩토리 호이스팅과 공유).
let opendirRejectCode: string | null | undefined = null; // 설정 시 opendir 이 이 code 로 reject
let opendirRejectPlain = false;                           // code 없는 순수 Error reject

vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return {
    ...actual,
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      if (opendirRejectPlain) throw new Error("io-boom-no-code");
      if (opendirRejectCode !== null) {
        const e = new Error("opendir-fail") as NodeJS.ErrnoException;
        e.code = opendirRejectCode;
        throw e;
      }
      return actual.opendir(...args);
    },
  };
});

const Q = (o: Record<string, unknown> = {}) => RunsQuery.parse(o);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-r5-"));
  opendirRejectCode = null;
  opendirRejectPlain = false;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("R5-HIGH opendir(base) 호출 실패 → ENOENT만 빈 정상·그 외 scan_error", () => {
  it("(a) ENOENT → 빈 정상 결과(truncated:false·reason:null·total 0)", async () => {
    opendirRejectCode = "ENOENT";
    const res = await queryRuns(root, Q());
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
    expect(res.truncated).toBe(false);
    expect(res.truncatedReason).toBe(null);
    expect(res.hasMore).toBe(false);
  });

  it("(b) EACCES → truncated:true·reason:scan_error·total 0(빈 정상 위장 아님)", async () => {
    opendirRejectCode = "EACCES";
    const res = await queryRuns(root, Q());
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("scan_error");
  });

  it("(c) 임의 IO 오류(EIO code) → scan_error", async () => {
    opendirRejectCode = "EIO";
    const res = await queryRuns(root, Q({ state: "completed" }));
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("scan_error");
    expect(res.total).toBe(0);
  });

  it("(d) code 없는 순수 Error 도 scan_error(안전 기본값 — ENOENT 아님)", async () => {
    opendirRejectPlain = true;
    const res = await queryRuns(root, Q());
    expect(res.truncated).toBe(true);
    expect(res.truncatedReason).toBe("scan_error");
    expect(res.total).toBe(0);
  });
});
