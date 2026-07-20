// F3.7 공유 config 서브시스템 (M11 · F7/F8 세 writer 공유 기반). 전량 신규(PV1 확정).
// 버전드 봉투 Config_v06 + per-leaf 독립 safeParse 복구 + 원자 RMW + in-process 뮤텍스.
// 신뢰경계(projectsHome)는 env SSOT(HARNESS_PROJECTS_HOME) — config.projectsHome 는 read-only 힌트/폴백만
//   (RMW 대상 아님·경계 판정 미사용). writeJsonAtomic(atomic.ts) 재사용(신규 쓰기루틴 금지).
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { stateHome } from "./paths.js";
import { writeJsonAtomic } from "./atomic.js";

export const CONFIG_SCHEMA_VERSION = "1" as const;
const MAX_CONFIG_BYTES = 262144; // config.json 개별 크기 상한(256KB·OOM 방어)

export interface DocsSource { label: string; path: string } // F9(M14): 표시 소스. path=projectRoot 하위 상대.

export interface Config_v06 {
  schemaVersion: "1";
  projectsHome: string | null;       // read-only 힌트/폴백만(경계 SSOT 아님 — env HARNESS_PROJECTS_HOME 가 SSOT).
  projectRoot: string | null;        // 편집 API 가 RMW 하는 유일 mutable 경로 필드.
  definitionEditEnabled: boolean;    // F7 게이트(불변 기본 false·fail-closed).
  evals: Record<string, unknown> | null; // F8 서브객체(M11 은 골격만·형제 보존 계약 확립).
  docsSources: DocsSource[];         // F9(M14·additive): 표시 소스 목록. 기본 [{Docs,docs}]·경로안전은 write/serve 시점 검증.
  docsMenuEnabled: boolean;          // F9(M14·additive): Docs 메뉴 on/off. 기본 true.
  factoryMaintenanceEnabled: boolean; // F11(팩토리 유지관리 게이트·불변 기본 false·fail-closed): HOME 스킬 설치/업데이트/제거 쓰기 허용.
  [k: string]: unknown;              // root passthrough(미지/미래 필드 보존).
}

// F9 기본 소스(무설정 구 config → docs 단일 소스·무인자 하위호환). label=플랜 A-1 확정("Docs").
export const DEFAULT_DOCS_SOURCES: DocsSource[] = [{ label: "Docs", path: "docs" }];
const cloneDefaultDocsSources = (): DocsSource[] => DEFAULT_DOCS_SOURCES.map((s) => ({ ...s }));

// F9 per-leaf 복구: 봉투의 docsSources 잎을 요소별 safeParse. 손상(비-배열/부재/null)=기본 소스 드롭백,
//   배열이면 무효 요소만 제외·유효 형제 소스 보존(빈 배열 가능 = 사용자가 전 소스 삭제한 정상 상태).
//   경로 안전(DS1~DS6)은 여기서 판정하지 않는다 — write/serve 시점 validateDocsSourcePath 소관(valid 플래그로 노출).
const DocsSourceSchema = z.object({ label: z.string(), path: z.string() });
export function loadDocsSources(raw: unknown): DocsSource[] {
  if (raw === undefined || raw === null) return cloneDefaultDocsSources();
  if (!Array.isArray(raw)) return cloneDefaultDocsSources(); // 손상 잎 → 기본(fail-closed·형제 top-level 무영향)
  const out: DocsSource[] = [];
  for (const el of raw) {
    const p = DocsSourceSchema.safeParse(el);
    if (p.success) out.push({ label: p.data.label, path: p.data.path }); // 무효 요소만 드롭
  }
  return out;
}

// evals per-leaf 골격(F8 이 채움). 알려진 잎만 독립 검증 — 한 잎 손상이 형제/미지 필드를 소거하지 않는다.
const EVALS_LEAVES: Record<string, z.ZodTypeAny> = {
  threshold: z.number(),
  enabled: z.boolean(),
};

// evals 서브객체 per-leaf 복구: 통째 파싱해 clobber 금지(통합감사-#1). object 아님 → null(fail-closed 잎).
//   알려진 잎이 타입 위반이면 그 잎만 null 로, 형제·미지 필드는 passthrough 보존.
export function loadEvals(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = { ...(raw as Record<string, unknown>) };
  for (const [k, schema] of Object.entries(EVALS_LEAVES)) {
    if (k in obj && !schema.safeParse(obj[k]).success) obj[k] = null; // 잎 독립 복구(형제 무영향)
  }
  return obj;
}

// 봉투 파싱 + per-leaf 독립 복구. 전체객체 strict Zod 금지(한 필드 손상이 타 필드 소거 방지).
//   schemaVersion 이 존재하고 "1" 이 아니면 throw(미지원 스키마 — 조용한 다운그레이드 금지).
export function loadConfig(raw: unknown): Config_v06 {
  const obj: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const sv = obj.schemaVersion;
  if (sv !== undefined && sv !== CONFIG_SCHEMA_VERSION) throw new Error("unsupported-config-schema");
  const strLeaf = (v: unknown): string | null => {
    const p = z.string().safeParse(v);
    return p.success ? p.data : null;
  };
  return {
    ...obj, // 미지/미래 필드 passthrough 보존
    schemaVersion: CONFIG_SCHEMA_VERSION,
    projectsHome: strLeaf(obj.projectsHome),
    projectRoot: strLeaf(obj.projectRoot),
    definitionEditEnabled: z.boolean().safeParse(obj.definitionEditEnabled).success
      ? (obj.definitionEditEnabled as boolean)
      : false, // fail-closed
    evals: loadEvals(obj.evals),
    docsSources: loadDocsSources(obj.docsSources), // F9 per-leaf(요소별 safeParse·형제 보존)
    docsMenuEnabled: z.boolean().safeParse(obj.docsMenuEnabled).success
      ? (obj.docsMenuEnabled as boolean)
      : true, // 손상/부재 → 기본 true(형제 무영향)
    factoryMaintenanceEnabled: z.boolean().safeParse(obj.factoryMaintenanceEnabled).success
      ? (obj.factoryMaintenanceEnabled as boolean)
      : false, // fail-closed(HOME 쓰기 게이트)
  };
}

export function configPath(): string {
  return join(stateHome(), "config.json");
}

// 신뢰경계 SSOT — env HARNESS_PROJECTS_HOME. 미설정 = 미프로비저닝(편집 비활성). config.projectsHome 미사용.
export function projectsHomeFromEnv(): string | null {
  const v = process.env.HARNESS_PROJECTS_HOME;
  return v && v.length > 0 ? v : null;
}

// 디스크 원문 read(크기상한·O_NOFOLLOW). 두 컨텍스트 분리(R2 HIGH#1·R5 HIGH):
//   - strict=false(부팅/조회): 부재/빈/파손 JSON·판독불가 → {}(loadConfig fallback·throw 아님·읽기 안전 기본값).
//   - strict=true(RMW 쓰기 전 read): 기존 파일이 구문 손상(JSON.parse 실패)·판독불가(EACCES/EPERM/ELOOP/
//     ENOTDIR/EISDIR·심링크 O_NOFOLLOW)·과대 → 조용히 {} 로 대체하지 않고 throw(fail-fast). 판독불가·손상
//     기존 config 를 projectRoot 만 있는 유효 데이터로 덮어쓰는 영구 소실 차단.
//     오직 부재(ENOENT)만 손상이 아니라 정당한 신선 시작이므로 strict 여도 {}(정상 write 허용).
//   unsupported-schema 만 loadConfig 가 throw(파싱 성공 후 판정).
async function readConfigRaw(strict = false): Promise<unknown> {
  let fh;
  try {
    fh = await open(configPath(), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return {}; // 부재=정당한 신선 시작(손상 아님 · strict 여도 write 허용)
    // 그 외 open 실패(EACCES/EPERM/ELOOP/ENOTDIR/EISDIR·심링크 O_NOFOLLOW 등)=기존 config 비정상 상태.
    if (strict) throw err; // RMW: 판독불가 기존 config 를 유효분으로 덮지 않도록 fail-fast(교체 차단)
    return {}; // 관용 조회: 안전 기본값(쓰기 아님)
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) {
      if (strict) throw new Error("config-read-not-a-file"); // RMW: 비정규 파일 덮어쓰기 금지
      return {};
    }
    if (st.size > MAX_CONFIG_BYTES) {
      if (strict) throw new Error("config-read-too-large");  // RMW: 과대 기존 파일 덮어쓰기 금지
      return {};
    }
    const n = Number(st.size);
    if (n === 0) return {}; // 빈 파일 → 신선 시작(손상 아님)
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    const text = buf.toString("utf8", 0, bytesRead);
    try {
      return JSON.parse(text);
    } catch {
      if (strict) throw new Error("config-corrupt-json"); // RMW: 구문 손상 → fail-fast(덮어쓰기 중단)
      return {}; // 관용 read → fallback
    }
  } finally {
    await fh.close().catch(() => {});
  }
}

export async function loadConfigFromDisk(): Promise<Config_v06> {
  return loadConfig(await readConfigRaw(false));
}

// RMW 전용 strict read — 손상(구문/판독불가) 기존 config 를 유효분으로 덮어쓰지 않도록 throw.
//   유효 JSON 의 잘못된 필드값은 loadConfig 의 per-leaf 복구로 계속 처리(throw 아님).
async function loadConfigFromDiskStrict(): Promise<Config_v06> {
  return loadConfig(await readConfigRaw(true));
}

// in-process 뮤텍스(ingest locks 패턴) — 세 writer(F3/F7/F8) 직렬화. lost-update 차단.
let writeChain: Promise<unknown> = Promise.resolve();
export function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn); // 이전 실패와 무관하게 다음 실행(체인 끊김 방지)
  writeChain = run.catch(() => {});
  return run;
}

// RMW 대상 = mutable 필드만. projectsHome 는 patch 타입에서 원천 배제(env SSOT·read-only).
export type ConfigPatch = Partial<
  Pick<Config_v06, "projectRoot" | "definitionEditEnabled" | "evals" | "docsSources" | "docsMenuEnabled" | "factoryMaintenanceEnabled">
>;

// 원자 read-modify-validate-write: 뮤텍스 하 **단일** strict read → loadConfig(전 필드 복구) →
//   해당 필드만 수정 → 전 필드 재직렬화 → writeJsonAtomic. 뮤텍스로 in-process 직렬화.
//   R3 HIGH(agy · lost-update): 종전엔 strict read 를 2회(before + TOCTOU 재-read disk) 했으나 쓰기
//   base 로 재-read 가 아닌 최초 before 기반 next 를 덮어써 두 read 사이 외부 변경을 무조건 유실했다.
//   뮤텍스가 in-process 직렬화를 보장하므로 두 번째 read 는 무의미 I/O 였고 오히려 lost-update 원인.
//   → 단일 read 기준 RMW 로 일관화(read→patch→write). cross-process lost-update(외부 프로세스 동시
//   쓰기)는 out-of-scope — 로컬 단일사용자 전제, in-process 동시성만 뮤텍스로 방어.
//   S-A2 [V9] projectsHome 불변 assert: patch 는 타입상 projectsHome 을 못 바꾸나(ConfigPatch 배제)
//   next.projectsHome ≠ read 시점 값이면 write 중단·throw(경계 소스 오염 물리 차단·이중 방어) 유지.
export async function updateConfig(patch: ConfigPatch): Promise<Config_v06> {
  return withConfigLock(async () => {
    const before = await loadConfigFromDiskStrict(); // 단일 strict read — 손상 config 는 여기서 throw
    const next: Config_v06 = { ...before }; // 전 필드(미지 passthrough 포함) 보존
    if ("projectRoot" in patch) next.projectRoot = patch.projectRoot ?? null;
    if ("definitionEditEnabled" in patch) next.definitionEditEnabled = patch.definitionEditEnabled ?? false;
    if ("evals" in patch) next.evals = patch.evals ?? null;
    // F9: docsSources 는 []([빈] = 전 소스 삭제한 정상 상태)를 default 로 덮지 않음(nullish 만 default).
    if ("docsSources" in patch) next.docsSources = patch.docsSources ?? cloneDefaultDocsSources();
    if ("docsMenuEnabled" in patch) next.docsMenuEnabled = patch.docsMenuEnabled ?? true;
    if ("factoryMaintenanceEnabled" in patch) next.factoryMaintenanceEnabled = patch.factoryMaintenanceEnabled ?? false;
    // S-A2 불변 assert: patch 경로가 projectsHome 을 바꾸지 않았음(타입상 불가하나 이중 방어).
    if (next.projectsHome !== before.projectsHome) throw new Error("projectsHome-mutation-blocked");
    await writeJsonAtomic(configPath(), next); // atomic.ts 재사용
    return next;
  });
}

// F8 Part C(M13): evals 서브객체 전용 원자 RMW. updateConfig 은 정적 patch 라 read-then-write 를 락 밖에서
//   하면 concurrent evals writer 간 lost-update 가 생긴다(evalsconfig 는 미지 evals 잎 보존 병합 필요).
//   → 뮤텍스 내부에서 strict read → mutate(evals) → 전 필드 보존 write 로 원자화(형제·미지 top-level·evals
//   미지 잎 clobber 금지). projectsHome 불변 assert 동일 유지. F3/F7 config writer 와 같은 writeChain 직렬화.
export async function updateConfigEvals(
  mutate: (curEvals: Record<string, unknown> | null) => Record<string, unknown> | null,
): Promise<Config_v06> {
  return withConfigLock(async () => {
    const before = await loadConfigFromDiskStrict(); // 손상 config → throw(유효분 덮어쓰기 차단)
    const next: Config_v06 = { ...before };          // projectRoot/definitionEditEnabled/passthrough 보존
    next.evals = mutate(before.evals);
    if (next.projectsHome !== before.projectsHome) throw new Error("projectsHome-mutation-blocked");
    await writeJsonAtomic(configPath(), next);
    return next;
  });
}
