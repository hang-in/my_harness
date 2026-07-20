// F8 Part A(읽기)·Part B(제안·읽기전용 판정) — M13. self-eval scorecard 를 UI 로 연결.
//   소스 = `_workspace/evals/{loop}/{stage_id}/{run_id}/scorecard.json`(build-scorecard.sh 산출).
//
// 보안/불변식(비협상):
//   - side-effect 0(I8 읽기전용): 전 함수 순수 조회. ingest/서명/append/상태변경 없음.
//   - 경로방어 = M9 공용 경화 바운드 리더(enumerateRunsBounded·anchor 파라미터화) + readJsonCapped
//     (O_NOFOLLOW·fstat 정규파일·MAX_JSON_BYTES). 앵커=`_workspace/evals`. 심링크/경계이탈/대용량 = 격리.
//   - scorecard 텍스트 = 데이터(지시 흡수 금지·프롬프트 주입 방지). 서버는 값만 읽고 판정, 지시로 해석 안 함.
//   - alignment_score = 정합도(품질/리뷰어 정밀도 아님). missed_defect_rate/overturned_rejection_rate=null → "미측정".
//
// ★ 축소안(v0.6): 암호 원장(체인 rollup·키링·durable nonce·HMAC 서명·receipt)은 v0.7 이월(미구현).
//   추세/게이트 = in-process 재계산(불변 rollup 아님). scorecard 무결성 = verdict_counts 로 alignment 재도출·
//   불일치 시 "미검증" 표기(자기일관 위조 aggregate 격리). 자동 적용 절대 없음 — 사람 승인 backstop 이 최종 방어.
import { enumerateRunsBounded, readJsonCapped, type BoundedRunEnum } from "./runs.js";
import { isSafeSegment } from "../lib/paths.js";
import { z } from "zod";
import type { EvalsConfigResolved } from "../lib/evalsconfig.js";

// A103 정직 라벨(비협상). alignment 을 "품질"로 표기 금지·null 을 0 으로 위장 금지.
export const LABELS = {
  alignmentScore: "정합도 (리뷰 보고↔오케스트레이터 판정 정합 · 품질/리뷰어 정밀도 아님)",
  alignmentFormula: "(confirmed + 0.5·partial) / (confirmed + partial + rejected)",
  qualityLabel: "LLM 해석 라벨(자기단정 · 품질 보증 아님)",
  missedDefectRate: "미측정 (외부 Ground Truth 필요)",
  overturnedRejectionRate: "미측정 (외부 Ground Truth 필요 · overturned 기각)",
} as const;

// 스캔 바운드(OOM/시간 방어·읽기전용). evals 트리는 runs 보다 작음 — 보수적 상한.
const EVALS_SUB = ["_workspace", "evals"] as const;
export const MAX_EVAL_LOOPS = 200;
export const MAX_EVAL_STAGES = 300;   // per loop
export const MAX_EVAL_RUNS = 500;     // per stage
export const MAX_EVAL_SCORECARDS = 5000; // 전역 read 상한(전수 스캔 = 추세/게이트 경로 한정)
// agy#1(HIGH·OOM/DoS): 인덱스(GET /api/evals)는 전수 딥스캔 금지 — loop 당 최신 scorecard 1건만 read.
//   전역 열거(lstat) 상한: 인덱스 경로가 loop×stage×run 이름 열거만으로도 폭주하지 않게 보수적 캡.
export const MAX_EVAL_INDEX_SCAN = 20000; // 인덱스 전역 열거(safeRunDir 시도) 상한

const numN = z.union([z.number(), z.null()]);
// scorecard 스키마(build-scorecard.sh 산출·loop-self-eval.md §스키마). 핵심 필드는 검증·미지 필드 passthrough.
//   전부 optional(생산자 버전 편차 관용) — 손상/타입위반은 safeParse 실패로 격리(500 금지).
const Scorecard = z.object({
  schema_version: z.string().optional(),
  loop: z.string().optional(),
  stage_id: z.string().optional(),
  run_id: z.string().optional(),
  rounds: numN.optional(),
  termination_reason: z.string().optional(),
  verdict_counts: z.object({
    confirmed: z.number(), partial: z.number(), deferred: z.number(),
    rejected: z.number(), duplicate: z.number(),
  }).partial().optional(),
  alignment_score: numN.optional(),
  rejected_rate: numN.optional(),
  deferred_rate: numN.optional(),
  duplicate_rate: numN.optional(),
  rounds_normalized: numN.optional(),
  regression_catch_rate: numN.optional(),
  missed_defect_rate: numN.optional(),
  overturned_rejection_rate: numN.optional(),
  cost_per_run_tokens: numN.optional(),
  cost_per_confirmed: numN.optional(),
  diff_lines: numN.optional(),
  risk_level: z.string().nullable().optional(),
  quality_label: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  computed_by: z.string().optional(),
}).passthrough();
export type Scorecard = z.infer<typeof Scorecard>;

const ALIGN_EPSILON = 1e-6;

export type ScorecardResult =
  | { kind: "ok"; card: Scorecard; verified: boolean; unverifiedReason: string | null }
  | { kind: "unavailable"; reason: string }   // eval-unavailable(jq 부재 등) — 고장 아님
  | { kind: "corrupt"; reason: string };       // 격리(malformed/oversize/unreadable)

// verdict_counts 로 alignment 재도출 → precomputed 와 대조(자기일관 위조 aggregate 격리·R7 in-process 판).
//   불일치/재계산불가는 "미검증"(verified=false) — 축소안에선 게이트 제외·표시 배지(브릭 아님).
function verifyAlignment(card: Scorecard): { verified: boolean; reason: string | null } {
  const vc = card.verdict_counts;
  if (!vc) return { verified: false, reason: "판정 건수 없음 — 검증 불가(미검증)" };
  const c = vc.confirmed ?? 0, p = vc.partial ?? 0, r = vc.rejected ?? 0;
  const denom = c + p + r;
  const recomputed = denom > 0 ? (c + 0.5 * p) / denom : null;
  const precomputed = card.alignment_score ?? null;
  if (recomputed === null && precomputed === null) return { verified: true, reason: null };
  if (recomputed === null || precomputed === null) {
    return { verified: false, reason: "정합도 재계산값이 기록값과 불일치(미검증)" };
  }
  if (Math.abs(recomputed - precomputed) > ALIGN_EPSILON) {
    return { verified: false, reason: `정합도 값 불일치(위조 의심) — 기록값 ${precomputed} ≠ 재계산 ${recomputed.toFixed(6)}(미검증)` };
  }
  return { verified: true, reason: null };
}

async function readScorecard(dir: string): Promise<ScorecardResult> {
  const r = await readJsonCapped(dir, "scorecard.json"); // O_NOFOLLOW·fstat·MAX_JSON_BYTES(대용량→oversize skip)
  if (!r.ok) {
    return { kind: "corrupt", reason: r.oversize ? "기록 파일 크기상한 초과(손상)" : "기록 파일 판독불가/부재" };
  }
  const obj = r.value;
  // eval-unavailable 상태(jq 부재 등) 그대로 통과 표시 — 고장 아님(A104).
  if (obj !== null && typeof obj === "object" && (obj as Record<string, unknown>).eval_status === "eval-unavailable") {
    const reason = String((obj as Record<string, unknown>).reason ?? "측정 불가(도구 없음)");
    return { kind: "unavailable", reason };
  }
  const p = Scorecard.safeParse(obj);
  if (!p.success) return { kind: "corrupt", reason: "기록 형식 위반(손상)" };
  const v = verifyAlignment(p.data);
  return { kind: "ok", card: p.data, verified: v.verified, unverifiedReason: v.reason };
}

// --- 안전 세그먼트 나열(공용 경화 리더 재사용·앵커 파라미터화) ------------------------
async function enumSafe(root: string, sub: readonly string[], cap: number): Promise<BoundedRunEnum> {
  const en = await enumerateRunsBounded(root, sub);
  if (en.items.length > cap) return { ...en, items: en.items.slice(0, cap), truncated: true, truncatedReason: en.truncatedReason ?? "limit_reached" };
  return en;
}

export interface CollectedRun {
  stageId: string;
  runId: string;
  dir: string;
  recordedAtMs: number;
  result: ScorecardResult;
}

// 한 loop 의 전 stage/run scorecard 수집(재계산·추세·게이트 공유). recordedAtMs asc(과거→최신) 정렬.
async function collectLoop(root: string, loop: string): Promise<{ runs: CollectedRun[]; truncated: boolean }> {
  if (!isSafeSegment(loop)) return { runs: [], truncated: false };
  const runs: CollectedRun[] = [];
  let total = 0;
  let truncated = false;
  const stagesEn = await enumSafe(root, [...EVALS_SUB, loop], MAX_EVAL_STAGES);
  truncated = truncated || stagesEn.truncated;
  for (const stage of stagesEn.items) {
    if (total >= MAX_EVAL_SCORECARDS) { truncated = true; break; }
    const runsEn = await enumSafe(root, [...EVALS_SUB, loop, stage.runId], MAX_EVAL_RUNS);
    truncated = truncated || runsEn.truncated;
    for (const run of runsEn.items) {
      if (total >= MAX_EVAL_SCORECARDS) { truncated = true; break; }
      total++;
      const result = await readScorecard(run.dir);
      runs.push({ stageId: stage.runId, runId: run.runId, dir: run.dir, recordedAtMs: run.recordedAtMs, result });
    }
  }
  runs.sort((a, b) => a.recordedAtMs - b.recordedAtMs || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  return { runs, truncated };
}

// --- Part A: GET /api/evals(loop 목록·최근 요약) ------------------------------------
// agy#1: 인덱스는 loop 당 최신 scorecard 1건만 read(전수 딥스캔 지양). runCount = 내용 read 없는
//   열거 카운트(stage×run dir 수). 세부 상태(unavailable/corrupt 분포)는 전수 스캔 경로(추세 GET
//   /api/evals/:loop · 상세)에서만 노출. — 응답 shape 변화(unavailableCount/corruptCount 제거).
export interface LoopIndexEntry {
  loop: string;
  runCount: number;         // 열거 카운트(run dir 수 · 내용 read 없음)
  latest: {
    stageId: string; runId: string; recordedAtMs: number;
    alignmentScore: number | null; terminationReason: string | null; verified: boolean;
  } | null;
}
export interface EvalsIndex {
  schemaVersion: "1";
  evalsAvailable: boolean;  // evals 디렉토리 부재 → false(고장 아님·A104 빈 상태)
  loops: LoopIndexEntry[];
  labels: typeof LABELS;
  truncated: boolean;
  truncatedReason: BoundedRunEnum["truncatedReason"];
  note: string;             // 축소안 고지(추세/게이트 = in-process·미검증)
}

const REDUCED_NOTE = "이 버전에서는 추세·판정 기준을 화면에서 다시 계산합니다(서명된 기록 원장은 다음 버전 예정). 기록 무결성은 판정 건수로 다시 계산해 검증하며, 최종 확인은 사람 승인입니다.";

// 한 loop 의 최신 run 만 해석(agy#1·인덱스 전용): stage/run 이름 열거로 runCount 산출·전역 newest 1건 특정,
//   그 1건의 scorecard 만 read. 열거는 budget(전역 잔여 스캔) 안에서만. read 는 loop 당 ≤1(OOM/DoS 방어).
async function collectLoopLatest(
  root: string, loop: string, budget: number,
): Promise<{ runCount: number; latest: LoopIndexEntry["latest"]; scanned: number; truncated: boolean }> {
  if (!isSafeSegment(loop)) return { runCount: 0, latest: null, scanned: 0, truncated: false };
  let runCount = 0, scanned = 0, truncated = false;
  let newest: { stageId: string; runId: string; dir: string; recordedAtMs: number } | null = null;
  const stagesEn = await enumSafe(root, [...EVALS_SUB, loop], MAX_EVAL_STAGES);
  scanned += stagesEn.scanned;
  truncated = truncated || stagesEn.truncated;
  for (const stage of stagesEn.items) {
    if (scanned >= budget) { truncated = true; break; }
    const runsEn = await enumSafe(root, [...EVALS_SUB, loop, stage.runId], MAX_EVAL_RUNS);
    scanned += runsEn.scanned;
    truncated = truncated || runsEn.truncated;
    runCount += runsEn.items.length; // 내용 read 없는 열거 카운트
    for (const run of runsEn.items) {
      // 전역 newest = 최대 recordedAtMs(동률 runId desc). collectLoop 정렬(asc·runId asc 의 last)과 동일 선택.
      if (newest === null || run.recordedAtMs > newest.recordedAtMs ||
          (run.recordedAtMs === newest.recordedAtMs && run.runId > newest.runId)) {
        newest = { stageId: stage.runId, runId: run.runId, dir: run.dir, recordedAtMs: run.recordedAtMs };
      }
    }
  }
  let latest: LoopIndexEntry["latest"] = null;
  if (newest) {
    const result = await readScorecard(newest.dir); // loop 당 최대 1 read
    if (result.kind === "ok") {
      latest = {
        stageId: newest.stageId, runId: newest.runId, recordedAtMs: newest.recordedAtMs,
        alignmentScore: result.card.alignment_score ?? null,
        terminationReason: result.card.termination_reason ?? null,
        verified: result.verified,
      };
    }
  }
  return { runCount, latest, scanned, truncated };
}

export async function listEvalLoops(root: string): Promise<EvalsIndex> {
  const loopsEn = await enumSafe(root, EVALS_SUB, MAX_EVAL_LOOPS);
  const loops: LoopIndexEntry[] = [];
  // evals 디렉토리 자체 부재 = scan_error 아님(enumerate 빈)·심링크/외부재앵커만 scan_error.
  const evalsAvailable = loopsEn.truncatedReason !== "scan_error";
  let globalScanned = 0;
  let truncated = loopsEn.truncated;
  for (const l of loopsEn.items) {
    if (globalScanned >= MAX_EVAL_INDEX_SCAN) { truncated = true; break; } // 전역 열거 상한(agy#1)
    const remaining = MAX_EVAL_INDEX_SCAN - globalScanned;
    const one = await collectLoopLatest(root, l.runId, remaining);
    globalScanned += one.scanned;
    truncated = truncated || one.truncated;
    loops.push({ loop: l.runId, runCount: one.runCount, latest: one.latest });
  }
  return {
    schemaVersion: "1",
    evalsAvailable,
    loops,
    labels: LABELS,
    truncated,
    truncatedReason: loopsEn.truncatedReason,
    note: REDUCED_NOTE,
  };
}

// --- Part A: GET /api/evals/:loop(추세) ----------------------------------------------
export interface TrendPoint {
  stageId: string; runId: string; recordedAtMs: number;
  alignmentScore: number | null;
  roundsNormalized: number | null;
  overturnedRejectionRate: number | null;
  verdictCounts: { confirmed: number; partial: number; deferred: number; rejected: number; duplicate: number } | null;
  terminationReason: string | null;
  qualityLabel: string | null;
  verified: boolean;
  unverifiedReason: string | null;
}
export interface LoopTrend {
  schemaVersion: "1";
  loop: string;
  found: boolean;
  series: TrendPoint[];            // 과거→최신(asc)
  counts: { valid: number; unavailable: number; corrupt: number };
  labels: typeof LABELS;
  trendSource: "scorecards-inprocess"; // 축소안: 신뢰 rollup 아님(미검증)
  note: string;
  truncated: boolean;
}

function vcOf(card: Scorecard): TrendPoint["verdictCounts"] {
  const vc = card.verdict_counts;
  if (!vc) return null;
  return {
    confirmed: vc.confirmed ?? 0, partial: vc.partial ?? 0, deferred: vc.deferred ?? 0,
    rejected: vc.rejected ?? 0, duplicate: vc.duplicate ?? 0,
  };
}

export async function loopTrend(root: string, loop: string): Promise<LoopTrend> {
  const empty: LoopTrend = {
    schemaVersion: "1", loop, found: false, series: [],
    counts: { valid: 0, unavailable: 0, corrupt: 0 }, labels: LABELS,
    trendSource: "scorecards-inprocess", note: REDUCED_NOTE, truncated: false,
  };
  if (!isSafeSegment(loop)) return empty;
  const { runs, truncated } = await collectLoop(root, loop);
  if (runs.length === 0) return empty;
  const series: TrendPoint[] = [];
  let valid = 0, unavailable = 0, corrupt = 0;
  for (const cr of runs) {
    if (cr.result.kind === "unavailable") { unavailable++; continue; }
    if (cr.result.kind === "corrupt") { corrupt++; continue; }
    valid++;
    const card = cr.result.card;
    series.push({
      stageId: cr.stageId, runId: cr.runId, recordedAtMs: cr.recordedAtMs,
      alignmentScore: card.alignment_score ?? null,
      roundsNormalized: card.rounds_normalized ?? null,
      overturnedRejectionRate: card.overturned_rejection_rate ?? null,
      verdictCounts: vcOf(card),
      terminationReason: card.termination_reason ?? null,
      qualityLabel: card.quality_label ?? null,
      verified: cr.result.verified,
      unverifiedReason: cr.result.unverifiedReason,
    });
  }
  return {
    schemaVersion: "1", loop, found: true, series,
    counts: { valid, unavailable, corrupt }, labels: LABELS,
    trendSource: "scorecards-inprocess", note: REDUCED_NOTE, truncated,
  };
}

// --- Part A: GET /api/evals/:loop/:stage/:run(scorecard 상세) ------------------------
export interface ScorecardDetail {
  schemaVersion: "1";
  loop: string; stageId: string; runId: string;
  status: "ok" | "unavailable" | "corrupt" | "not-found";
  reason: string | null;
  scorecard: Scorecard | null;
  verified: boolean;
  unverifiedReason: string | null;
  labels: typeof LABELS;
}

export async function scorecardDetail(root: string, loop: string, stage: string, run: string): Promise<ScorecardDetail> {
  const base: Omit<ScorecardDetail, "status" | "reason" | "scorecard" | "verified" | "unverifiedReason"> = {
    schemaVersion: "1", loop, stageId: stage, runId: run, labels: LABELS,
  };
  if (![loop, stage, run].every(isSafeSegment)) {
    return { ...base, status: "not-found", reason: "invalid-segment", scorecard: null, verified: false, unverifiedReason: null };
  }
  // stage 하위 run 을 공용 경화 리더로 안전 해석(직접 join 금지 — 심링크/경계 방어 재사용).
  const runsEn = await enumSafe(root, [...EVALS_SUB, loop, stage], MAX_EVAL_RUNS);
  const match = runsEn.items.find((r) => r.runId === run);
  if (!match) return { ...base, status: "not-found", reason: null, scorecard: null, verified: false, unverifiedReason: null };
  const result = await readScorecard(match.dir);
  if (result.kind === "unavailable") return { ...base, status: "unavailable", reason: result.reason, scorecard: null, verified: false, unverifiedReason: null };
  if (result.kind === "corrupt") return { ...base, status: "corrupt", reason: result.reason, scorecard: null, verified: false, unverifiedReason: null };
  return { ...base, status: "ok", reason: null, scorecard: result.card, verified: result.verified, unverifiedReason: result.unverifiedReason };
}

// --- Part B: 자기개선 제안(읽기전용 판정·자동 적용 절대 금지) --------------------------
export interface ProposalTrigger { kind: string; detail: string; evidence: string[]; }
export interface ProposalGate {
  adjudicated: number; minAdjudicated: number; adjudicatedMet: boolean;
  observations: number; rollingN: number; observationsMet: boolean;
  declineStreak: number; requiredStreak: number; streakMet: boolean;
  fires: boolean;
}
export interface EvalProposal {
  schemaVersion: "1";
  loop: string;
  enabled: boolean;               // adoptionStage>=3
  disabledReason: "adoption-stage-below-3" | "insufficient-data" | "loop-not-found" | null;
  gate: ProposalGate | null;
  triggers: ProposalTrigger[];
  provenance: {
    sourcePaths: string[]; runIds: string[]; computedBy: string;
    sampleSize: number; verificationStatus: string;
  } | null;
  citedScorecards: Array<{ stageId: string; runId: string; alignmentScore: number | null; verified: boolean }>;
  autoApply: false;               // 교리: 자동 적용 절대 금지(정보성 카드)
  applyPath: string;              // 적용은 F7 편집기 수동 동선(제안 자동 적용 없음)
  labels: typeof LABELS;
  note: string;
}

// 게이트 소스(축소안) = 읽은 scorecard 실데이터(config 값 아님·요청당 1회 collectLoop).
//   verified(재도출 일치)한 scorecard 만 집계 — 자기일관 위조 aggregate 제외.
//   agy#2(HIGH): 동일 runId 최신만 dedup + adjudicated·관측·연속하락을 최신 rollingN window 안에서만 집계
//   (전체 이력 누적 금지). 발화 = window 내 adjudicated≥minAdj ∧ 관측≥rollingN ∧ 연속하락≥declineStreak. 29/9/null → 금지.
export async function loopProposal(root: string, loop: string, cfg: EvalsConfigResolved): Promise<EvalProposal> {
  const minAdj = cfg.thresholds.minAdjudicatedClaims.effective;
  const rollingN = cfg.thresholds.rollingN.effective;
  const reqStreak = cfg.thresholds.declineStreak.effective;
  const base: EvalProposal = {
    schemaVersion: "1", loop, enabled: cfg.proposalsEnabled, disabledReason: null,
    gate: null, triggers: [], provenance: null, citedScorecards: [],
    autoApply: false, applyPath: "F7 편집기에서 수동 검토·저장(제안 자동 적용 없음)",
    labels: LABELS,
    note: "제안은 정보성 카드입니다. 적용은 사용자가 F7 편집기로 직접 편집해야 하며 자동 반영은 없습니다(사람 승인 backstop).",
  };
  // B-1: 단계<3 이면 제안 비활성(발화 금지).
  if (!cfg.proposalsEnabled) return { ...base, disabledReason: "adoption-stage-below-3" };
  if (!isSafeSegment(loop)) return { ...base, disabledReason: "loop-not-found" };

  const { runs } = await collectLoop(root, loop);
  const okRuns = runs.filter((r) => r.result.kind === "ok") as Array<CollectedRun & { result: Extract<ScorecardResult, { kind: "ok" }> }>;
  // verified(재도출 일치)만 게이트 데이터로 — 미검증(위조 의심/재도출 불가)은 제외(브릭 아님·표시만).
  const verifiedRuns = okRuns.filter((r) => r.result.verified);
  type VR = typeof verifiedRuns[number];

  // agy#2(HIGH·게이트 우회 차단): (1) 동일 runId 최신만 dedup(부풀림 0), (2) adjudicated·관측·연속하락을
  //   최신 rollingN 개 window 안에서만 집계(전체 이력 누적 금지 — 과거 누적으로 게이트 우회하던 버그 봉쇄).
  const byId = new Map<string, VR>();
  for (const r of verifiedRuns) {
    const prev = byId.get(r.runId);
    if (!prev || r.recordedAtMs > prev.recordedAtMs) byId.set(r.runId, r); // 동일 runId 는 최신(recordedAtMs) 유지
  }
  const dedup = [...byId.values()].sort((a, b) =>
    a.recordedAtMs - b.recordedAtMs || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0)); // asc(과거→최신)
  const windowRuns = dedup.slice(Math.max(0, dedup.length - rollingN)); // 최신 rollingN 개 window

  // adjudicated = Σ(confirmed+partial+deferred+rejected) over window. 유효 관측 = alignment_score 숫자인 window run.
  let adjudicated = 0;
  const alignSeries: Array<{ cr: VR; align: number }> = [];
  for (const r of windowRuns) {
    const vc = r.result.card.verdict_counts;
    if (vc) adjudicated += (vc.confirmed ?? 0) + (vc.partial ?? 0) + (vc.deferred ?? 0) + (vc.rejected ?? 0);
    const a = r.result.card.alignment_score;
    if (typeof a === "number") alignSeries.push({ cr: r, align: a });
  }
  const observations = alignSeries.length;

  // 연속하락(rolling·단일 노이즈 무시): 최신→과거로 연속 strict 하락 카운트(newest < 직전 older).
  const desc = [...alignSeries].reverse(); // newest first
  let declineStreak = 0;
  for (let i = 0; i + 1 < desc.length; i++) {
    if (desc[i]!.align < desc[i + 1]!.align) declineStreak++;
    else break;
  }

  const adjudicatedMet = adjudicated >= minAdj;
  const observationsMet = observations >= rollingN;
  const streakMet = declineStreak >= reqStreak;
  const fires = adjudicatedMet && observationsMet && streakMet;
  const gate: ProposalGate = {
    adjudicated, minAdjudicated: minAdj, adjudicatedMet,
    observations, rollingN, observationsMet,
    declineStreak, requiredStreak: reqStreak, streakMet, fires,
  };

  if (!fires) return { ...base, gate, disabledReason: "insufficient-data" };

  // B-2: 악화 트리거(근거 인용 — 무근거 제안 금지). alignment 연속하락 = 주 트리거.
  const triggers: ProposalTrigger[] = [{
    kind: "alignment-decline",
    detail: `alignment_score ${declineStreak}연속 하락(요구 ${reqStreak}) — rolling window(관측 ${observations}·요구 ${rollingN})`,
    evidence: desc.slice(0, declineStreak + 1).map((d) => `${d.cr.stageId}/${d.cr.runId}: alignment=${d.align}`),
  }];
  // rounds_normalized 상승(보조 트리거): window 내 최신이 직전보다 상승.
  const rn = windowRuns.map((r) => r.result.card.rounds_normalized).filter((v): v is number => typeof v === "number");
  if (rn.length >= 2 && rn[rn.length - 1]! > rn[rn.length - 2]!) {
    triggers.push({
      kind: "rounds-normalized-rise",
      detail: `rounds_normalized 상승(${rn[rn.length - 2]} → ${rn[rn.length - 1]})`,
      evidence: [],
    });
  }
  // overturned_rejection_rate 임계초과(외부 GT 있을 때만 — 대개 null → 미측정·트리거 안 함).
  const theta = cfg.thresholds.thetaByRisk["overturned"] ?? null;
  const latestOverturned = windowRuns[windowRuns.length - 1]?.result.card.overturned_rejection_rate ?? null;
  if (theta !== null && typeof latestOverturned === "number" && latestOverturned > theta) {
    triggers.push({
      kind: "overturned-rejection-exceeded",
      detail: `overturned_rejection_rate ${latestOverturned} > θ ${theta}`,
      evidence: [],
    });
  }

  const cited = desc.slice(0, declineStreak + 1).map((d) => ({
    stageId: d.cr.stageId, runId: d.cr.runId, alignmentScore: d.align, verified: true,
  }));
  return {
    ...base,
    gate,
    triggers,
    provenance: {
      sourcePaths: windowRuns.map((r) => `_workspace/evals/${loop}/${r.stageId}/${r.runId}/scorecard.json`),
      runIds: windowRuns.map((r) => r.runId),
      computedBy: "harness-ui 서버 · 판정 건수 기반 재도출",
      sampleSize: observations,
      verificationStatus: `verified ${dedup.length}/${okRuns.length} · window ${windowRuns.length}/rollingN ${rollingN} (dedup·최신 window 집계 · 재도출 일치분만 · 암호 rollup 미사용 v0.7)`,
    },
    citedScorecards: cited,
  };
}

// --- 채택 단계 졸업 게이트(현 단계→다음) — 에이전트 분석·추천, 사람 정보결정(자동 승격 아님) ------
// 교리: 조건 도달=자격일 뿐 자동 상향 아님. 에이전트가 근거+반대신호까지 제시, 사람이 [상향] 클릭(추인 아님·정보결정).
// 등급: 1→2(저위험·검토만 켬)=autoAdvance 여지 / 2→3(제안 emit)·3→4(자동적용)=사람 결정·3→4 자동 금지.
export interface GateStatus {
  stage: 1 | 2 | 3 | 4;
  nextStage: 2 | 3 | 4 | null;
  logging: { count: number; required: number; met: boolean };       // 누적 로깅(검증 scorecard 수)
  adjudicated: { count: number; required: number; met: boolean };   // 누적 판정 수
  eligible: boolean;                        // 데이터 조건 충족(다음 단계 자격)
  recommendation: "advance" | "hold" | "locked";
  reasons: string[];                        // advance 근거 / hold 미충족
  counterSignals: string[];                 // 반대신호(에코체임버·recall 미측정 — 승격 신중)
  autoAdvanceEligible: boolean;             // 1→2 저위험 + 조건충족일 때만
  note: string;
}
export async function gateStatus(root: string, cfg: EvalsConfigResolved): Promise<GateStatus> {
  const reqLog = cfg.thresholds.rollingN.effective;             // 로깅 관측 최소치(기본 10)
  const reqAdj = cfg.thresholds.minAdjudicatedClaims.effective; // 판정 누적 최소치(기본 30)
  const stage = cfg.adoptionStage;
  const nextStage = (stage < 4 ? (stage + 1) as 2 | 3 | 4 : null);

  // 누적 집계(전 loop·검증분·runId dedup) — 졸업은 누적 데이터 기준.
  const idx = await listEvalLoops(root);
  const seen = new Set<string>();
  let logging = 0, adjudicated = 0;
  const aligns: number[] = []; let gtNull = true;
  for (const l of idx.loops) {
    const { runs } = await collectLoop(root, l.loop);
    for (const r of runs) {
      if (r.result.kind !== "ok" || !r.result.verified) continue;
      const key = l.loop + "/" + r.runId;
      if (seen.has(key)) continue; seen.add(key);
      logging += 1;
      const vc = r.result.card.verdict_counts;
      if (vc) adjudicated += (vc.confirmed ?? 0) + (vc.partial ?? 0) + (vc.deferred ?? 0) + (vc.rejected ?? 0);
      const a = r.result.card.alignment_score; if (typeof a === "number") aligns.push(a);
      if (r.result.card.overturned_rejection_rate != null || r.result.card.missed_defect_rate != null) gtNull = false;
    }
  }
  const logMet = logging >= reqLog, adjMet = adjudicated >= reqAdj;
  const eligible = logMet && adjMet;

  // 반대신호(승격 신중 근거) — 에코체임버·recall 미측정.
  const counterSignals: string[] = [];
  if (aligns.length >= 3 && aligns.every((x) => x >= 0.95))
    counterSignals.push("정합도(alignment)가 거의 만점 — 리뷰어 유휴/에코체임버 가능성. alignment=자기정합도이지 품질 아님, 외부 GT(recall)로 교차검증 권장.");
  if (gtNull)
    counterSignals.push("recall 미측정(overturned/missed = GT 없음·null) — 놓친 결함(miss)은 alignment 로 안 보임. seeded 결함·사후 회귀로 보강 전 상향 신중.");

  const reasons: string[] = [];
  let recommendation: GateStatus["recommendation"];
  if (stage === 4) { recommendation = "locked"; reasons.push("단계 4=잠금(표시 전용) — 상향 없음."); }
  else if (stage === 3) {
    recommendation = "hold";
    reasons.push("3→4(자동 적용)는 데이터로 권고하지 않음 — 승인 사다리·수동 결정 필수(자동 상향 금지).");
  } else {
    recommendation = eligible ? "advance" : "hold";
    if (!logMet) reasons.push(`로깅 ${logging}/${reqLog} 미달`);
    if (!adjMet) reasons.push(`판정 누적 ${adjudicated}/${reqAdj} 미달`);
    if (eligible) reasons.push(`데이터 조건 충족(로깅 ${logging}/${reqLog}·판정 ${adjudicated}/${reqAdj}) — ${nextStage}단계 자격.`);
  }
  const autoAdvanceEligible = stage === 1 && eligible; // 1→2 만 저위험(검토만 켬)

  return {
    stage, nextStage,
    logging: { count: logging, required: reqLog, met: logMet },
    adjudicated: { count: adjudicated, required: reqAdj, met: adjMet },
    eligible, recommendation, reasons, counterSignals, autoAdvanceEligible,
    note: "조건 충족=자격일 뿐 자동 승격 아님. 에이전트 분석·추천 후 사람이 근거 보고 [상향](추인 아님). 승격은 되돌리기 신중(자동 행동 권한 확대).",
  };
}
