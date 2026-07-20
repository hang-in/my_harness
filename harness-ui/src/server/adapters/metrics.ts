// M9 F6 관측성 계층 B — 읽기전용 on-read 집계(과대표시 금지).
// 정본: docs/harness-ui/v0.6/todo/M9-F6-observability.md · design-observability.md §2·§3·§7b.
//
// 핵심 정직 규칙(비협상):
//   - run 총량 토큰 = events.usage 실존 시에만 `measured`. 부재 시 `unattributed`(measured 승격 금지·0 위장 금지).
//   - claude 팀 서브에이전트 토큰 = 상한 `estimated`(분해 미보장·AS2). codex agent usage 실존 시에만 measured.
//   - skill 토큰 = 상한 `estimated`(토큰 경계 없음 — measured 절대 불가). usage 부재 시 unattributed.
//   - per-value confidence: 각 지표 값이 자기 confidence 를 개별 동반(응답 단일 confidence 금지).
// 읽기전용(I4/I8): supervisor·rollup 쓰기 0. 공용 경화 바운드 리더(enumerateRunsBounded) 재사용.
import { enumerateRunsBounded, streamRunEvents, readJsonCapped, SCAN_DEADLINE_MS, type BoundedRunEnum } from "./runs.js";
import { Status, Manifest, isSchemaValid, type Event } from "../schemas.js";
import { readAgents, readSkills } from "./harness.js";

export type Confidence = "measured" | "estimated" | "unattributed";
// 개별 지표 값 + 자기 신뢰도(per-value). unattributed/데이터 부재는 value=null(0 위장 금지).
export interface MetricValue { value: number | null; confidence: Confidence; }

export interface Coverage {
  scannedRuns: number;        // enumerateRunsBounded 가 해석한 run 수(상위 N)
  aggregatedRuns: number;     // status 유효로 실제 집계에 편입된 run 수
  usageRuns: number;          // usage 증거가 하나라도 있는 run 수
  measuredRatio: number | null; // usageRuns / aggregatedRuns(신뢰도 — null=집계 run 0)
  windowNewestMs: number | null; // 관측 window 최신 recordedAt(ms)
  windowOldestMs: number | null; // 관측 window 최고(最古) recordedAt(ms)
  truncated: boolean;
  truncatedReason: "limit_reached" | "deadline_exceeded" | "scan_error" | null; // V13: 캡 vs 데드라인 분리
  recordedAtSource: "birthtime" | "mtime";
}

export interface MetricsOptions { fromMs?: number | null; toMs?: number | null; limit?: number | null; }

// rework/review 는 이벤트명 리터럴 부분일치 휴리스틱(고정 taxonomy 부재 → estimated 프록시).
//   단순 교대(alternation)·앵커 없음 → ReDoS 불가. new RegExp(사용자입력) 아님(고정 리터럴).
const REWORK_RE = /(retry|rework|revis|redo|reject)/i;
const REVIEW_RE = /review/i;

function isoMs(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// events.usage 델타 합(present=정의된 수치 필드가 하나라도 있음). 빈 usage({})·null = 증거 아님.
function usageDelta(u: Event["usage"]): { total: number; present: boolean } {
  if (!u) return { total: 0, present: false };
  let total = 0, present = false;
  for (const k of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"] as const) {
    const v = u[k];
    if (typeof v === "number") { total += v; present = true; }
  }
  return { total, present };
}

// --- 단일 스캔(3 엔드포인트 공유 집계) ------------------------------------------
// R1 HIGH(codex·과대표시): usageInvocations = 이 버킷에 기여한 event 중 usage 증거가 있는 수.
//   invocations(총 기여 event) 와 함께 추적 → 부분 커버리지(일부 event 만 usage)를 measured 로 오표시하지 않고 강등 판정.
interface Bucket { invocations: number; usageInvocations: number; tokens: number; hasUsage: boolean; }
interface RunAgg {
  state: string | null;
  runtime: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  recordedAtMs: number;
  runTokens: number;
  runHasUsage: boolean;
  reworkHit: boolean;
  reviewCount: number;
  agents: Map<string, Bucket>;
  skills: Map<string, Bucket>;
}
interface ScanResult {
  enum: BoundedRunEnum;
  runs: RunAgg[];
  windowNewestMs: number | null;
  windowOldestMs: number | null;
  deadlineHit: boolean;  // R1 HIGH: scan 순회/이벤트 스트리밍 데드라인 초과
  limitHit: boolean;     // R1 HIGH: 이벤트 라인/유효 event 상한 도달
}

function newBucket(): Bucket { return { invocations: 0, usageInvocations: 0, tokens: 0, hasUsage: false }; }

async function scan(root: string, opts: MetricsOptions): Promise<ScanResult> {
  // R1 HIGH(agy·DoS): 스캔 진입 즉시 데드라인 고정 — selected 순회·이벤트 스트리밍이 데드라인을 우회 못 하게.
  const start = Date.now();
  const deadlineAt = start + SCAN_DEADLINE_MS;
  const en = await enumerateRunsBounded(root);
  const fromMs = opts.fromMs ?? null;
  const toMs = opts.toMs ?? null;
  const cap = opts.limit != null && opts.limit > 0 ? opts.limit : en.items.length;

  let selected = en.items.filter((r) =>
    (fromMs === null || r.recordedAtMs >= fromMs) && (toMs === null || r.recordedAtMs <= toMs));
  selected = selected.slice(0, cap);

  const runs: RunAgg[] = [];
  let windowNewestMs: number | null = null;
  let windowOldestMs: number | null = null;
  let deadlineHit = false;
  let limitHit = false;

  for (const ref of selected) {
    if (Date.now() > deadlineAt) { deadlineHit = true; break; } // 순회 데드라인 — 즉시 중단(부분 집계)
    const sr = await readJsonCapped(ref.dir, "status.json");
    const statusV = sr.ok ? isSchemaValid(Status, sr.value) : { ok: false as const };
    if (!("ok" in statusV) || !statusV.ok) continue; // 손상 quarantine(집계 제외·조용한 0 위장 아님 — coverage 반영)
    const status = statusV.value;
    const mr = await readJsonCapped(ref.dir, "manifest.json");
    const manV = mr.ok ? isSchemaValid(Manifest, mr.value) : null;
    const man = manV && manV.ok ? manV.value : null;

    const agg: RunAgg = {
      state: status.state,
      runtime: man ? man.runtime : null,
      createdAtMs: man ? isoMs(man.createdAt) : null,
      updatedAtMs: isoMs(status.updatedAt),
      recordedAtMs: ref.recordedAtMs,
      runTokens: 0, runHasUsage: false, reworkHit: false, reviewCount: 0,
      agents: new Map(), skills: new Map(),
    };

    const sres = await streamRunEvents(ref.dir, (e: Event) => {
      const u = usageDelta(e.usage);
      if (u.present) { agg.runTokens += u.total; agg.runHasUsage = true; }
      if (typeof e.event === "string") {
        if (REWORK_RE.test(e.event)) agg.reworkHit = true;
        if (REVIEW_RE.test(e.event)) agg.reviewCount += 1;
      }
      if (e.agent) {
        const b = agg.agents.get(e.agent) ?? newBucket();
        b.invocations += 1;
        if (u.present) { b.tokens += u.total; b.hasUsage = true; b.usageInvocations += 1; }
        agg.agents.set(e.agent, b);
      }
      if (e.skill) {
        const b = agg.skills.get(e.skill) ?? newBucket();
        b.invocations += 1;
        if (u.present) { b.tokens += u.total; b.hasUsage = true; b.usageInvocations += 1; }
        agg.skills.set(e.skill, b);
      }
    }, { deadlineAt }); // R1 HIGH: 공유 데드라인 주입 — 대량/파손 이벤트에서 즉시 중단
    if (sres.reason === "deadline_exceeded") deadlineHit = true;
    else if (sres.reason === "limit_reached") limitHit = true;

    if (windowNewestMs === null || ref.recordedAtMs > windowNewestMs) windowNewestMs = ref.recordedAtMs;
    if (windowOldestMs === null || ref.recordedAtMs < windowOldestMs) windowOldestMs = ref.recordedAtMs;
    runs.push(agg);
  }
  return { enum: en, runs, windowNewestMs, windowOldestMs, deadlineHit, limitHit };
}

function coverageOf(s: ScanResult): Coverage {
  const aggregatedRuns = s.runs.length;
  const usageRuns = s.runs.filter((r) => r.runHasUsage).length;
  // R1 HIGH(V13): 절단 원인 병합(deadline > limit > scan_error). scan 자체 데드라인/라인캡과 enum 열거 절단을 함께 반영.
  const truncatedReason: Coverage["truncatedReason"] =
    (s.deadlineHit || s.enum.truncatedReason === "deadline_exceeded") ? "deadline_exceeded"
      : (s.limitHit || s.enum.truncatedReason === "limit_reached") ? "limit_reached"
        : s.enum.truncatedReason === "scan_error" ? "scan_error"
          : null;
  return {
    scannedRuns: s.enum.scanned,
    aggregatedRuns,
    usageRuns,
    measuredRatio: aggregatedRuns > 0 ? usageRuns / aggregatedRuns : null,
    windowNewestMs: s.windowNewestMs,
    windowOldestMs: s.windowOldestMs,
    truncated: truncatedReason !== null,
    truncatedReason,
    recordedAtSource: s.enum.recordedAtSource,
  };
}

// --- overview() ------------------------------------------------------------------
export interface OverviewMetrics {
  schemaVersion: "1";
  coverage: Coverage;
  runCount: number;
  succeeded: number;
  failed: number;
  other: number;
  successRate: MetricValue;        // measured(status.state 직접 관측)
  failureRate: MetricValue;        // measured
  avgDurationMs: MetricValue;      // measured(createdAt→updatedAt)
  reworkRate: MetricValue;         // estimated(이벤트명 프록시 휴리스틱)
  reviewConvergence: MetricValue;  // estimated(run 당 review 이벤트 평균)
  totalTokens: MetricValue;        // measured(전 집계 run 에 usage) | unattributed(부분/부재)
  unusedAgents: number;
  unusedSkills: number;
}

export async function overview(root: string, opts: MetricsOptions = {}): Promise<OverviewMetrics> {
  const s = await scan(root, opts);
  const runs = s.runs;
  const n = runs.length;
  const succeeded = runs.filter((r) => r.state === "completed").length;
  const failed = runs.filter((r) => r.state === "failed").length;
  const other = n - succeeded - failed;

  const durations = runs
    .map((r) => (r.createdAtMs !== null && r.updatedAtMs !== null ? r.updatedAtMs - r.createdAtMs : null))
    .filter((d): d is number => d !== null && d >= 0);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const reworkRuns = runs.filter((r) => r.reworkHit).length;
  const reviewTotal = runs.reduce((a, r) => a + r.reviewCount, 0);

  const usageRuns = runs.filter((r) => r.runHasUsage).length;
  const totalTokens = runs.reduce((a, r) => a + r.runTokens, 0);

  return {
    schemaVersion: "1",
    coverage: coverageOf(s),
    runCount: n,
    succeeded, failed, other,
    successRate: { value: n ? succeeded / n : null, confidence: "measured" },
    failureRate: { value: n ? failed / n : null, confidence: "measured" },
    avgDurationMs: { value: avgDuration, confidence: "measured" },
    reworkRate: { value: n ? reworkRuns / n : null, confidence: "estimated" },
    reviewConvergence: { value: n ? reviewTotal / n : null, confidence: "estimated" },
    // AS1 비협상 + R1 HIGH(과대표시 금지): 집계 대상 **모든** run 에 usage 증거가 있을 때만 measured.
    //   일부만 있으면(부분 커버리지) 부분합을 정확값처럼 노출 금지 → unattributed·value=null 로 강등(부분성은 coverage.measuredRatio 노출).
    totalTokens: n > 0 && usageRuns === n
      ? { value: totalTokens, confidence: "measured" }
      : { value: null, confidence: "unattributed" },
    unusedAgents: (await unusedAgentNames(root, runs)).length,
    unusedSkills: (await unusedSkillNames(root, runs)).length,
  };
}

// --- agents() --------------------------------------------------------------------
export interface AgentMetric {
  agent: string;
  runs: number;          // 이 agent 가 관측된 distinct run 수
  invocations: number;   // 이벤트 수(measured 카운트)
  completed: number;     // 참여 run 중 completed(status 기반)
  failed: number;
  tokens: MetricValue;   // measured(codex+usage) | estimated(claude) | unattributed(usage 부재)
}
export interface AgentsMetrics { schemaVersion: "1"; coverage: Coverage; agents: AgentMetric[]; unusedInWindow: string[]; }

export async function agents(root: string, opts: MetricsOptions = {}): Promise<AgentsMetrics> {
  const s = await scan(root, opts);
  interface Roll { invocations: number; usageInvocations: number; tokens: number; hasClaude: boolean; runs: number; completed: number; failed: number; }
  const roll = new Map<string, Roll>();
  for (const r of s.runs) {
    const isClaude = r.runtime === "claude";
    for (const [name, b] of r.agents) {
      const g = roll.get(name) ?? { invocations: 0, usageInvocations: 0, tokens: 0, hasClaude: false, runs: 0, completed: 0, failed: 0 };
      g.invocations += b.invocations;
      g.usageInvocations += b.usageInvocations;
      g.tokens += b.tokens;
      g.hasClaude = g.hasClaude || isClaude;
      g.runs += 1;
      if (r.state === "completed") g.completed += 1;
      else if (r.state === "failed") g.failed += 1;
      roll.set(name, g);
    }
  }
  const out: AgentMetric[] = [...roll.entries()].map(([agent, g]) => ({
    agent,
    runs: g.runs,
    invocations: g.invocations,
    completed: g.completed,
    failed: g.failed,
    // usage 전무 → unattributed. claude 기여 있으면 상한 estimated(분해 미보장·AS2). codex 전용은
    // R1 HIGH(과대표시 금지): **모든** 기여 event 에 usage 가 있을 때만 measured. 일부만 있으면(부분 커버리지)
    //   부분합을 measured 로 오표시 금지 → unattributed·value=null 강등(부분성은 coverage.measuredRatio 로 노출).
    tokens: g.usageInvocations === 0
      ? { value: null, confidence: "unattributed" as const }
      : g.hasClaude
        ? { value: g.tokens, confidence: "estimated" as const }
        : g.usageInvocations === g.invocations
          ? { value: g.tokens, confidence: "measured" as const }
          : { value: null, confidence: "unattributed" as const },
  })).sort((a, b) => b.invocations - a.invocations || (a.agent < b.agent ? -1 : 1));

  return { schemaVersion: "1", coverage: coverageOf(s), agents: out, unusedInWindow: await unusedAgentNames(root, s.runs) };
}

// --- skills() --------------------------------------------------------------------
export interface SkillMetric {
  skill: string;
  runs: number;
  invocations: number;   // measured 카운트
  tokens: MetricValue;   // estimated(usage 실존·상한 점유) | unattributed(부재) — measured 절대 불가
}
export interface SkillsMetrics { schemaVersion: "1"; coverage: Coverage; skills: SkillMetric[]; unusedInWindow: string[]; }

export async function skills(root: string, opts: MetricsOptions = {}): Promise<SkillsMetrics> {
  const s = await scan(root, opts);
  interface Roll { invocations: number; tokens: number; hasUsage: boolean; runs: number; }
  const roll = new Map<string, Roll>();
  for (const r of s.runs) {
    for (const [name, b] of r.skills) {
      const g = roll.get(name) ?? { invocations: 0, tokens: 0, hasUsage: false, runs: 0 };
      g.invocations += b.invocations;
      g.tokens += b.tokens;
      g.hasUsage = g.hasUsage || b.hasUsage;
      g.runs += 1;
      roll.set(name, g);
    }
  }
  const out: SkillMetric[] = [...roll.entries()].map(([skill, g]) => ({
    skill,
    runs: g.runs,
    invocations: g.invocations,
    // skill 토큰은 measured 불가(§7). usage 실존 시 상한 estimated, 부재 시 unattributed.
    tokens: g.hasUsage ? { value: g.tokens, confidence: "estimated" as const } : { value: null, confidence: "unattributed" as const },
  })).sort((a, b) => b.invocations - a.invocations || (a.skill < b.skill ? -1 : 1));

  return { schemaVersion: "1", coverage: coverageOf(s), skills: out, unusedInWindow: await unusedSkillNames(root, s.runs) };
}

// --- 미사용/고아(정적 정의 존재 ∧ window 내 0회 관측) ------------------------------
// window-bounded(W6): "선택 window 내 관측 없음". 진짜 전-생애 dead 단정은 UI/후속 몫.
async function unusedAgentNames(root: string, runs: RunAgg[]): Promise<string[]> {
  const observed = new Set<string>();
  for (const r of runs) for (const k of r.agents.keys()) observed.add(k);
  const defined = await readAgents(root).catch(() => []);
  const names = new Set(defined.map((a) => a.name));
  return [...names].filter((n) => !observed.has(n)).sort();
}
async function unusedSkillNames(root: string, runs: RunAgg[]): Promise<string[]> {
  const observed = new Set<string>();
  for (const r of runs) for (const k of r.skills.keys()) observed.add(k);
  const defined = await readSkills(root).catch(() => []);
  const names = new Set(defined.map((s) => s.name));
  return [...names].filter((n) => !observed.has(n)).sort();
}
