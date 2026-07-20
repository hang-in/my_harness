import { describe, it, expect } from "vitest";
import { Status, Manifest, RunsQuery, isSchemaValid } from "../src/server/schemas.js";

const baseManifest = {
  schemaVersion: "1", runId: "r1", projectRoot: "/x", runtime: "codex", mode: "build",
  createdAt: "2026-07-09T10:00:00+09:00", requestedBy: "u", goal: "g", agents: [],
  targets: [], permissionMode: "read-only", model: "default", supervisorVersion: "1",
} as const;

const validStatus = {
  schemaVersion: "1", runId: "r1", state: "running", phase: "Phase 1", progress: 42,
  updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00",
  serverPid: 1, serverStartTime: "x", childPid: 2, childStartTime: "y",
  childProcessGroupId: 2, exitCode: null, exitSignal: null, cancelRequestedAt: null,
  stateReason: null, summary: "", error: null,
};

describe("schemas / schema-valid", () => {
  it("valid Status parses", () => {
    expect(isSchemaValid(Status, validStatus).ok).toBe(true);
  });
  it("invalid state rejected", () => {
    const r = isSchemaValid(Status, { ...validStatus, state: "bogus" });
    expect(r.ok).toBe(false);
  });
  it("progress out of range rejected", () => {
    expect(isSchemaValid(Status, { ...validStatus, progress: 200 }).ok).toBe(false);
  });
  it("Windows childProcessGroupId string accepted", () => {
    expect(isSchemaValid(Status, { ...validStatus, childProcessGroupId: "pid:2" }).ok).toBe(true);
  });
});

// T-S1 [스키마 마이그레이션] — Manifest.agent additive optional(read 측·A47/A66 회귀)
describe("T-S1 Manifest.agent 마이그레이션", () => {
  it("(a) agent 필드 있는 신 manifest 통과", () => {
    const r = Manifest.safeParse({ ...baseManifest, agent: "builder" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.agent).toBe("builder");
  });
  it("(b) agent 없는 구 manifest 통과 + agent === null(default·거부 아님)", () => {
    const r = Manifest.safeParse(baseManifest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.agent).toBeNull();
  });
  it("(c) agent SAFE_SEGMENT 위반(../x) → parse 실패", () => {
    expect(Manifest.safeParse({ ...baseManifest, agent: "../x" }).success).toBe(false);
  });
  it("agents(복수) 불변 — 단수 agent와 독립", () => {
    const r = Manifest.safeParse({ ...baseManifest, agents: ["a", "b"], agent: null });
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.agents).toEqual(["a", "b"]); expect(r.data.agent).toBeNull(); }
  });
});

// T-S2 [RunsQuery Zod — 통과·clamp 경계] (A48 positive)
describe("T-S2 RunsQuery 파싱", () => {
  it("enum·리터럴·ISO·sort·order 정상 파싱", () => {
    const r = RunsQuery.safeParse({
      state: "running", runtime: "codex", mode: "build", agent: "builder",
      from: "2026-07-01T00:00:00+09:00", to: "2026-07-09T00:00:00+09:00",
      q: "foo", sort: "updatedAt", order: "asc", limit: "20", offset: "5",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.state).toBe("running");
      expect(r.data.sort).toBe("updatedAt");
      expect(r.data.limit).toBe(20);
      expect(r.data.offset).toBe(5);
    }
  });
  it("무인자 default: sort=recordedAt·order=desc·limit=50·offset=0", () => {
    const r = RunsQuery.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sort).toBe("recordedAt");
      expect(r.data.order).toBe("desc");
      expect(r.data.limit).toBe(50);
      expect(r.data.offset).toBe(0);
    }
  });
  it("clamp 경계: limit=100·limit=1·offset=0 통과", () => {
    expect(RunsQuery.safeParse({ limit: "100" }).success && RunsQuery.parse({ limit: "100" }).limit).toBe(100);
    expect(RunsQuery.parse({ limit: "1" }).limit).toBe(1);
    expect(RunsQuery.parse({ offset: "0" }).offset).toBe(0);
  });
});
