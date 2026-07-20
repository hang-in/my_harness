import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveEvalsConfig, loadEvalsConfig, updateEvalsConfig, EvalsConfigBody,
  MIN_ADJUDICATED_FLOOR, ROLLING_N_FLOOR, DECLINE_STREAK_FLOOR,
} from "../src/server/lib/evalsconfig.js";
import { configPath } from "../src/server/lib/config.js";

// F8 Part C(M13·A109/A110/A111) — per-leaf 복구 + floor(effective=max) + 원자 RMW.
describe("evalsconfig: resolve per-leaf + floor (A110)", () => {
  it("부재 → 안전 기본(단계1·자동잠금·floor 임계)", () => {
    const c = resolveEvalsConfig(null);
    expect(c.adoptionStage).toBe(1);
    expect(c.proposalsEnabled).toBe(false);
    expect(c.stage4Locked).toBe(true);
    expect(c.thresholds.minAdjudicatedClaims.effective).toBe(MIN_ADJUDICATED_FLOOR);
    expect(c.thresholds.rollingN.effective).toBe(ROLLING_N_FLOOR);
    expect(c.thresholds.declineStreak.effective).toBe(DECLINE_STREAK_FLOOR);
  });

  it("adoptionStage 3 → proposalsEnabled true", () => {
    expect(resolveEvalsConfig({ adoptionStage: 3 }).proposalsEnabled).toBe(true);
    expect(resolveEvalsConfig({ adoptionStage: 2 }).proposalsEnabled).toBe(false);
  });

  it("adoptionStage 4 → 4 유지(display-only 잠금·Stage1 폴백 아님·agy#3)", () => {
    const c = resolveEvalsConfig({ adoptionStage: 4 });
    expect(c.adoptionStage).toBe(4);            // read 는 4 수용(다운그레이드 금지)
    expect(c.proposalsEnabled).toBe(false);     // 4 = display-only → 제안 비활성
    expect(c.stage4Locked).toBe(true);
  });

  it("adoptionStage 손상(문자열/범위밖) → 1(fail-closed 자동잠금)", () => {
    expect(resolveEvalsConfig({ adoptionStage: "3" }).adoptionStage).toBe(1);
    expect(resolveEvalsConfig({ adoptionStage: 99 }).adoptionStage).toBe(1);
    expect(resolveEvalsConfig({ adoptionStage: 0 }).adoptionStage).toBe(1);
    expect(resolveEvalsConfig({ adoptionStage: 2.5 }).adoptionStage).toBe(1);
  });

  it("effective = max(값, floor) — 저장값이 floor 초과면 그대로", () => {
    const c = resolveEvalsConfig({ thresholds: { minAdjudicatedClaims: 50, rollingN: 20, declineStreak: 5 } });
    expect(c.thresholds.minAdjudicatedClaims.effective).toBe(50);
    expect(c.thresholds.rollingN.effective).toBe(20);
    expect(c.thresholds.declineStreak.effective).toBe(5);
  });

  it("저장값이 floor 미만(변조)이어도 effective 는 floor 밑 불가", () => {
    const c = resolveEvalsConfig({ thresholds: { minAdjudicatedClaims: 5, rollingN: 2, declineStreak: 1 } });
    expect(c.thresholds.minAdjudicatedClaims.value).toBe(5);        // 저장값 정직 노출
    expect(c.thresholds.minAdjudicatedClaims.effective).toBe(30);   // floor 로 상향
    expect(c.thresholds.rollingN.effective).toBe(10);
    expect(c.thresholds.declineStreak.effective).toBe(3);
  });

  it("한 임계 잎 손상이 형제 임계를 리셋 안 함(per-leaf·A110)", () => {
    const c = resolveEvalsConfig({ thresholds: { minAdjudicatedClaims: 50, rollingN: "corrupt" } });
    expect(c.thresholds.minAdjudicatedClaims.value).toBe(50);        // 형제 보존
    expect(c.thresholds.minAdjudicatedClaims.effective).toBe(50);
    expect(c.thresholds.rollingN.effective).toBe(ROLLING_N_FLOOR);   // 손상 잎만 floor
  });

  it("metrics per-leaf: 손상 metric 만 탈락·유효 형제 보존", () => {
    const c = resolveEvalsConfig({
      metrics: { alignment: { enabled: true, weight: 0.5 }, bad: "x", rounds: { enabled: false, weight: 0.2 } },
    });
    expect(c.metrics.alignment).toEqual({ enabled: true, weight: 0.5 });
    expect(c.metrics.rounds).toEqual({ enabled: false, weight: 0.2 });
    expect(c.metrics.bad).toBeUndefined(); // 손상 잎 탈락
  });

  it("metric weight 범위 밖 → 그 metric 탈락(형제 무영향)", () => {
    const c = resolveEvalsConfig({ metrics: { good: { enabled: true, weight: 0.3 }, over: { enabled: true, weight: 5 } } });
    expect(c.metrics.good).toEqual({ enabled: true, weight: 0.3 });
    expect(c.metrics.over).toBeUndefined();
  });
});

describe("evalsconfig: EvalsConfigBody 입력 검증 (A109)", () => {
  it("adoptionStage ∈ {1,2,3} 수용", () => {
    for (const s of [1, 2, 3]) expect(EvalsConfigBody.safeParse({ adoptionStage: s }).success).toBe(true);
  });
  it("adoptionStage:4 → 거부(400 유발)", () => {
    expect(EvalsConfigBody.safeParse({ adoptionStage: 4 }).success).toBe(false);
    expect(EvalsConfigBody.safeParse({ adoptionStage: 0 }).success).toBe(false);
  });
  it("floor 미만 임계 → 거부(silent-clamp 아님)", () => {
    expect(EvalsConfigBody.safeParse({ thresholds: { minAdjudicatedClaims: 29 } }).success).toBe(false);
    expect(EvalsConfigBody.safeParse({ thresholds: { rollingN: 9 } }).success).toBe(false);
    expect(EvalsConfigBody.safeParse({ thresholds: { declineStreak: 2 } }).success).toBe(false);
  });
  it("floor 이상 임계 → 수용", () => {
    expect(EvalsConfigBody.safeParse({ thresholds: { minAdjudicatedClaims: 30, rollingN: 10, declineStreak: 3 } }).success).toBe(true);
  });
  it("미지 필드 → strict 거부", () => {
    expect(EvalsConfigBody.safeParse({ adoptionStage: 1, evil: 1 }).success).toBe(false);
  });
});

describe("evalsconfig: 디스크 RMW (A110·타 필드 보존)", () => {
  let stateDir: string;
  const origState = process.env.HARNESS_STATE_HOME;
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "hui-ec-"));
    process.env.HARNESS_STATE_HOME = stateDir;
  });
  afterEach(async () => {
    if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState;
    await rm(stateDir, { recursive: true, force: true });
  });

  it("부재 → loadEvalsConfig 안전 기본", async () => {
    const c = await loadEvalsConfig();
    expect(c.adoptionStage).toBe(1);
  });

  it("updateEvalsConfig: evals 만 갱신·definitionEditEnabled/projectRoot/passthrough 보존", async () => {
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1", definitionEditEnabled: true, projectRoot: "/ph/app", futureField: "keep",
    }), "utf8");
    const c = await updateEvalsConfig({ adoptionStage: 3, thresholds: { minAdjudicatedClaims: 40 } });
    expect(c.adoptionStage).toBe(3);
    expect(c.thresholds.minAdjudicatedClaims.effective).toBe(40);
    // 타 필드 보존 확인
    const disk = JSON.parse(await readFile(configPath(), "utf8"));
    expect(disk.definitionEditEnabled).toBe(true);
    expect(disk.projectRoot).toBe("/ph/app");
    expect(disk.futureField).toBe("keep");
    expect(disk.evals.adoptionStage).toBe(3);
  });

  it("부분 임계 갱신 시 형제 임계·미지 evals 잎 보존", async () => {
    await writeFile(configPath(), JSON.stringify({
      schemaVersion: "1",
      evals: { adoptionStage: 2, thresholds: { minAdjudicatedClaims: 50, rollingN: 15 }, customLeaf: 42 },
    }), "utf8");
    const c = await updateEvalsConfig({ thresholds: { rollingN: 12 } });
    expect(c.thresholds.rollingN.effective).toBe(12);
    expect(c.thresholds.minAdjudicatedClaims.effective).toBe(50); // 형제 임계 보존
    expect(c.adoptionStage).toBe(2);                              // 형제 필드 보존
    const disk = JSON.parse(await readFile(configPath(), "utf8"));
    expect(disk.evals.customLeaf).toBe(42);                       // 미지 evals 잎 보존
  });

  it("동시 두 evals writer → lost-update 없음(뮤텍스 직렬화)", async () => {
    await writeFile(configPath(), JSON.stringify({ schemaVersion: "1", evals: {} }), "utf8");
    await Promise.all([
      updateEvalsConfig({ adoptionStage: 3 }),
      updateEvalsConfig({ thresholds: { minAdjudicatedClaims: 45 } }),
    ]);
    const c = await loadEvalsConfig();
    expect(c.adoptionStage).toBe(3);
    expect(c.thresholds.minAdjudicatedClaims.effective).toBe(45);
  });
});
