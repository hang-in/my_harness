// 상태 스키마 정본 (설계 §5). schema-valid = 아래 Zod `.parse()` 통과.
import { z } from "zod";
import { SAFE_SEGMENT } from "./lib/paths.js";

export const RunState = z.enum([
  "queued", "running", "blocked", "failed", "completed", "cancelled", "stale",
]);
export type RunState = z.infer<typeof RunState>;

export const Runtime = z.enum(["claude", "codex"]);
export type Runtime = z.infer<typeof Runtime>;

const iso = z.string().datetime({ offset: true });

export const Manifest = z.object({
  schemaVersion: z.literal("1"),
  runId: z.string(),
  projectRoot: z.string(),
  runtime: Runtime,
  mode: z.string(),
  createdAt: iso,
  requestedBy: z.string(),
  goal: z.string(),
  agents: z.array(z.string()),
  // M7 S1: additive optional 단수 `agent`(단일 대상 귀속 태그). read/파싱 측만 —
  // writer(supervisor)는 M10. 구 manifest(agent 없음)→null 파싱(거부 아님). SAFE_SEGMENT 위반은 parse 실패.
  agent: z.string().regex(SAFE_SEGMENT).nullable().default(null),
  targets: z.array(z.string()),
  permissionMode: z.string(),
  model: z.string(),
  supervisorVersion: z.string(),
});
export type Manifest = z.infer<typeof Manifest>;

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
}).partial();

export const Status = z.object({
  schemaVersion: z.literal("1"),
  runId: z.string(),
  state: RunState,
  phase: z.string(),
  progress: z.number().min(0).max(100),
  updatedAt: iso,
  heartbeatAt: iso,
  serverPid: z.number().int(),
  serverStartTime: z.string(),
  childPid: z.number().int().nullable(),
  childStartTime: z.string().nullable(),
  childProcessGroupId: z.union([z.number().int(), z.string()]).nullable(),
  exitCode: z.number().int().nullable(),
  exitSignal: z.string().nullable(),
  cancelRequestedAt: iso.nullable(),
  stateReason: z.string().nullable(),
  summary: z.string(),
  error: z.string().nullable(),
});
export type Status = z.infer<typeof Status>;

export const Event = z.object({
  seq: z.number().int().nonnegative(),
  ts: iso,
  level: z.enum(["info", "warn", "error", "debug"]),
  agent: z.string().nullable(),
  skill: z.string().nullable(),
  phase: z.string(),
  event: z.string(),
  message: z.string(),
  usage: Usage.nullable(),
});
export type Event = z.infer<typeof Event>;

export const AgentState = z.object({
  schemaVersion: z.literal("1"),
  name: z.string(),
  runtime: Runtime,
  state: RunState,
  phase: z.string(),
  task: z.string(),
  startedAt: iso,
  updatedAt: iso,
  inputFiles: z.array(z.string()),
  outputFiles: z.array(z.string()),
  error: z.string().nullable(),
});
export type AgentState = z.infer<typeof AgentState>;

export const DriftFinding = z.object({
  id: z.string(),
  severity: z.enum(["ok", "missing-runtime-peer", "content-mismatch", "stale", "unsupported"]),
  runtime: Runtime,
  paths: z.array(z.string()),
  evidence: z.string(),
  suggestedAction: z.string(),
});
export type DriftFinding = z.infer<typeof DriftFinding>;

// --- M7 F4: GET /api/runs 고급 조회 쿼리 (설계 §F4.3) ---------------------
// offset/limit는 clamp(400 아님) — enum/datetime/SAFE_SEGMENT 위반만 400.
// [정본 정정] 설계서 §F4.3 line66은 `z.max(100)`(거부)로 적혀 clamp 요구(A48·R-4)와 충돌 →
// 아래처럼 z.preprocess로 경계 clamp 후 int 검증(server-builder 보고).
function coerceInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  }
  return null; // 비수치(limit=abc 등) → fallback default
}
function clampInt(n: number | null, min: number, max: number, fallback: number): number {
  if (n === null) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export const RunsQuery = z.object({
  state: RunState.optional(),
  runtime: Runtime.optional(),
  mode: z.string().max(40).optional(),
  agent: z.string().regex(SAFE_SEGMENT).max(120).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["recordedAt", "updatedAt", "state"]).default("recordedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  // 범위 밖 → clamp(400 아님): limit 99999→100·0→1·-5→1·abc→50 / offset -5→0·초과→100000·abc→0
  limit: z.preprocess((v) => clampInt(coerceInt(v), 1, 100, 50), z.number().int().min(1).max(100)),
  offset: z.preprocess((v) => clampInt(coerceInt(v), 0, 100000, 0), z.number().int().min(0).max(100000)),
});
export type RunsQuery = z.infer<typeof RunsQuery>;

// schema-valid 헬퍼: parse 성공 여부 + 사유.
export function isSchemaValid<T>(schema: z.ZodType<T>, data: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const r = schema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ") };
}
