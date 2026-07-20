// F8 Part C(M13) — evals 지표관리 config. F3.7 공유 config(config.ts)의 `evals` 서브객체에 얹는다.
//   per-leaf 독립 복구(한 잎 손상이 형제 clobber 금지) + 필수 floor(effective=max(값,floor)) + 원자 RMW.
//
// 교리(비협상·A103/A106/A108):
//   - 쓰기(POST/EvalsConfigBody): adoptionStage ∈ {1,2,3} 만 수용. 4 = 쓰기 불가·API 400.
//   - 읽기(resolveEvalsConfig): 1~4 수용. 4 = display-only 잠금(proposalsEnabled=false·stage4Locked). 손상/부재 → 1(fail-closed).
//     ★ agy#3(MED): read 를 {1,2,3} 으로만 파싱하면 디스크 4 저장분이 파싱 실패→Stage1 다운그레이드 →
//       "4=잠금" 진입/유지 불가. read/write 검증 분리(read=1~4, write=1~3).
//   - 임계 floor: minAdjudicatedClaims≥30 · rollingN≥10 · declineStreak≥3. 낮출 수 없음(effective=max·silent-clamp 아님).
//   - proposalsEnabled = adoptionStage>=3(단계<3 이면 제안 비활성).
//
// ★ 축소안(v0.6): 암호 원장/서명/nonce 미구현(v0.7 이월). config 저장 = 평문 config.json RMW(뮤텍스·타 필드 보존).
import { z } from "zod";
import { loadConfigFromDisk, updateConfigEvals } from "./config.js";

// 필수 floor(A110/A111·비협상). effective threshold 는 저장값이 손상/미달이어도 이 밑으로 못 내려간다.
export const MIN_ADJUDICATED_FLOOR = 30;
export const ROLLING_N_FLOOR = 10;
export const DECLINE_STREAK_FLOOR = 3;

export interface MetricSetting { enabled: boolean; weight: number; }
export interface ThresholdLeaf { value: number; floor: number; effective: number; }
export interface EvalsConfigResolved {
  schemaVersion: "1";
  adoptionStage: 1 | 2 | 3 | 4;       // read 는 4 수용(4=display-only 잠금). write 는 1~3 만(EvalsConfigBody).
  stage4Locked: true;                 // A108: 단계4 = display-only 잠금(쓰기 경로 없음)
  proposalsEnabled: boolean;          // A106/B-1: 단계==3 일 때만 제안 발화(4=잠금 → false)
  metrics: Record<string, MetricSetting>;
  thresholds: {
    minAdjudicatedClaims: ThresholdLeaf;
    rollingN: ThresholdLeaf;
    declineStreak: ThresholdLeaf;
    thetaByRisk: Record<string, number>;
  };
  normalization: Record<string, unknown>;
}

const MetricSchema = z.object({ enabled: z.boolean(), weight: z.number().min(0).max(1) }).strict();
// write(POST) 검증: 1~3 만. 4 → union 실패 → 400(display-only 는 쓰기 경로 없음).
const AdoptionStage = z.union([z.literal(1), z.literal(2), z.literal(3)]);
// read(resolve) 검증: 1~4. 4 = display-only 잠금(유지). 손상/부재만 Stage1 로 fail-closed.
const AdoptionStageRead = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

// POST body(신뢰경계·Zod). adoptionStage:4 → union 실패 → 400. floor 미만 임계 → .min 실패 → 400(silent-clamp 아님).
export const EvalsConfigBody = z.object({
  adoptionStage: AdoptionStage,
  metrics: z.record(MetricSchema),
  thresholds: z.object({
    minAdjudicatedClaims: z.number().int().min(MIN_ADJUDICATED_FLOOR),
    rollingN: z.number().int().min(ROLLING_N_FLOOR),
    declineStreak: z.number().int().min(DECLINE_STREAK_FLOOR),
    thetaByRisk: z.record(z.number()),
  }).partial().strict(),
  normalization: z.record(z.unknown()),
}).partial().strict();
export type EvalsConfigPatch = z.infer<typeof EvalsConfigBody>;

function asObj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// 임계 잎 per-leaf 복구: 저장값이 유효 정수면 그대로(형제 무영향), 아니면 floor. effective=max(값,floor).
function thresholdLeaf(rawThresholds: Record<string, unknown> | null, key: string, floor: number): ThresholdLeaf {
  const p = z.number().safeParse(rawThresholds?.[key]);
  const value = p.success && Number.isFinite(p.data) ? p.data : floor; // 손상/부재 잎만 floor(형제 보존)
  return { value, floor, effective: Math.max(value, floor) };          // effective 는 floor 밑 불가(변조 방어)
}

// evals 서브객체 → 해석된 config. 부재/손상 → 안전 기본(단계1·자동잠금·보수적 floor 임계). 전 잎 독립 복구.
export function resolveEvalsConfig(rawEvals: unknown): EvalsConfigResolved {
  const raw = asObj(rawEvals);
  const stageP = AdoptionStageRead.safeParse(raw?.adoptionStage);
  const adoptionStage = stageP.success ? stageP.data : 1; // 1~4 수용·부재/손상 → 1(fail-closed 자동잠금)

  const rawThresholds = asObj(raw?.thresholds);
  const thetaP = z.record(z.number()).safeParse(raw?.thresholds && rawThresholds?.thetaByRisk);
  const metrics: Record<string, MetricSetting> = {};
  const rawMetrics = asObj(raw?.metrics);
  if (rawMetrics) {
    for (const [k, v] of Object.entries(rawMetrics)) {
      const p = MetricSchema.safeParse(v);
      if (p.success) metrics[k] = p.data; // per-leaf: 손상 metric 만 탈락·유효 형제 보존
    }
  }
  return {
    schemaVersion: "1",
    adoptionStage,
    stage4Locked: true,
    proposalsEnabled: adoptionStage === 3, // 3 만 활성. 4 = display-only 잠금 → false(A108).
    metrics,
    thresholds: {
      minAdjudicatedClaims: thresholdLeaf(rawThresholds, "minAdjudicatedClaims", MIN_ADJUDICATED_FLOOR),
      rollingN: thresholdLeaf(rawThresholds, "rollingN", ROLLING_N_FLOOR),
      declineStreak: thresholdLeaf(rawThresholds, "declineStreak", DECLINE_STREAK_FLOOR),
      thetaByRisk: thetaP.success ? thetaP.data : {},
    },
    normalization: asObj(raw?.normalization) ?? {},
  };
}

export async function loadEvalsConfig(): Promise<EvalsConfigResolved> {
  try { return resolveEvalsConfig((await loadConfigFromDisk()).evals); }
  catch { return resolveEvalsConfig(null); } // unsupported-schema 등 → 안전 기본(단계1·자동잠금)
}

// POST 저장: evals 서브객체 전용 원자 RMW(뮤텍스·타 필드/미지 evals 잎 보존). Zod 로 검증된 patch 만 적용.
//   adoptionStage:4·floor 미만은 EvalsConfigBody 에서 이미 400 으로 걸러져 여기 도달 안 함(이중 방어로 clamp 없이 저장).
export async function updateEvalsConfig(patch: EvalsConfigPatch): Promise<EvalsConfigResolved> {
  const next = await updateConfigEvals((cur) => {
    const base: Record<string, unknown> = { ...(asObj(cur) ?? {}) }; // 미지 evals 잎 passthrough 보존
    if (patch.adoptionStage !== undefined) base.adoptionStage = patch.adoptionStage;
    if (patch.metrics !== undefined) base.metrics = patch.metrics;
    if (patch.normalization !== undefined) base.normalization = patch.normalization;
    if (patch.thresholds !== undefined) {
      const curTh = asObj(base.thresholds) ?? {};
      base.thresholds = { ...curTh, ...patch.thresholds }; // 부분 임계 갱신 시 형제 임계 보존
    }
    return base;
  });
  return resolveEvalsConfig(next.evals);
}
