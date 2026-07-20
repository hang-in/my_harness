// F3.2~F3.3 경계 검증 방어층 D1~D8 (M11 · A68/A69 · F3-root 스위트). 신규 모듈.
// 신뢰경계 = 단일 projectsHome containment(마커는 심층방어일 뿐 경계 아님·AS5 확정).
// realpath containment(isWithinRoot·paths.ts 재사용)가 실경계 — lstat 미탐(Windows reparse·AS4) 최후방어.
import { homedir } from "node:os";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { isWithinRoot } from "./paths.js";

// D8 error 코드 집합(fail-closed 400 매핑). 협상 대상 아님.
export type ProjectRootError =
  | "bad-input"
  | "symlink"
  | "reparse-point"
  | "denied-system-path"
  | "no-harness-marker"
  | "outside-projects-home"
  | "escape";

export type ValidateResult =
  | { ok: true; effectiveRoot: string }
  | { ok: false; error: ProjectRootError };

const HARNESS_MARKERS = [".claude", "CLAUDE.md", "AGENTS.md"] as const;

// D1 정규화·거부. 절대경로만·`~`/`..`/UNC/드라이브상대 거부·미정규화(NFC) 유니코드 거부.
function d1Normalize(input: string): { ok: true } | { ok: false } {
  if (typeof input !== "string" || input.length === 0) return { ok: false };
  if (input.startsWith("~")) return { ok: false };                 // tilde 확장 거부
  if (input.normalize("NFC") !== input) return { ok: false };      // 미정규화 유니코드(homoglyph 원문) 거부
  if (/^[/\\]{2}/.test(input)) return { ok: false };               // UNC(\\host\share·//host/share) 거부 — Node 는 /↔\ 호환(R2 HIGH#2)
  if (/^[A-Za-z]:(?![\\/])/.test(input)) return { ok: false };     // 드라이브상대(C:foo) 거부(C:\foo 는 아님)
  for (const seg of input.split(/[/\\]/)) {                        // `..` 세그먼트 거부(/,\ 양쪽)
    if (seg === "..") return { ok: false };
  }
  if (!isAbsolute(input)) return { ok: false };                    // 상대경로 거부(절대만)
  return { ok: true };
}

// D4 시스템/민감 denylist. 절대 상위(예: /var·/tmp)는 허용(ACCEPT) — 특정 시스템 dir·홈 dotdir 만 차단.
function d4Denied(real: string): boolean {
  if (real === "/") return true;                                   // 루트 자체
  const posix = ["/etc", "/usr", "/bin", "/sbin", "/sys", "/proc", "/dev", "/boot", "/lib", "/lib64", "/root"];
  for (const d of posix) if (isWithinRoot(d, real)) return true;
  const home = homedir();
  if (real !== home && isWithinRoot(home, real)) {                 // 홈 직속 dotdir(~/.ssh·~/.aws 등)
    const first = relative(home, real).split(sep)[0];
    if (first && first.startsWith(".")) return true;
  }
  const win = [process.env.SystemRoot, process.env.windir, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  for (const d of win) if (isWithinRoot(d, real)) return true;
  return false;
}

// 렉시컬 경로 동일성(하위 세그먼트 realpath 비교용). win32+darwin 은 대소문자 무시·경로구분자 정규화
//   (R2 HIGH#3: darwin=APFS/HFS+ case-insensitive·case-preserving → realpath 디스크 대소문자 ≠ 입력
//    대소문자여도 오거부 0). linux(대소문자 구분)만 정확 비교. 테스트를 위해 export(순수 함수).
export function samePath(a: string, b: string): boolean {
  if (process.platform === "win32" || process.platform === "darwin") {
    return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
  }
  return a === b;
}

// D3 스코프(below/prefix) 판정 — samePath() 와 **동일한** 플랫폼 인지 대소문자 규칙으로 통일.
//   (R4 HIGH: 종전엔 relative()(대소문자 구분) 문자열 검사로 하위 여부를 판정 → macOS/Windows 처럼
//    대소문자 무시 FS 에서 case-variant 입력(예 /Users/x/projects vs /users/x/projects)이 relative
//    상 하위가 아니라 판단돼 D3 스캔을 통째로 스킵 → 이후 D2 canonical containment 가 in-root
//    심링크/reparse 를 marker 와 함께 통과. 스코프 prefix 판정과 최종 realpath 비교가 서로 다른
//    대소문자 규칙을 쓴 것이 갭의 근원.) win32+darwin 은 세그먼트별 대소문자 무시, linux 는 정확.
//   세그먼트 경계를 존중해(부분 문자열 오탐 금지) input 이 anchor 의 **진하위**면 실제 입력 대소문자의
//   tail 세그먼트 배열을 반환(정상 대소문자여도 오거부 0), 진하위가 아니면 null(= D2 containment 위임).
//   순수 함수 — 테스트 위해 export.
export function subSegmentsUnder(anchor: string, input: string): string[] | null {
  const ci = process.platform === "win32" || process.platform === "darwin";
  const norm = (s: string) => (ci ? s.toLowerCase() : s);      // samePath 와 동일 규칙(구분자는 split 이 정규화)
  const split = (p: string) => p.split(/[/\\]/).filter((s) => s.length > 0 && s !== "."); // relative 정규화 정합
  const aSegs = split(anchor);
  const iSegs = split(input);
  if (iSegs.length <= aSegs.length) return null;               // 진하위만(동일/상위 = D2 위임)
  for (let k = 0; k < aSegs.length; k++) {
    const a = aSegs[k] ?? "";
    const i = iSegs[k] ?? "";
    if (norm(a) !== norm(i)) return null;                       // 세그먼트 경계 case-normalized prefix 매칭
  }
  return iSegs.slice(aSegs.length);                            // anchor 하위 tail(실제 입력 대소문자)
}

// D3 심링크/reparse 거부 — projectsHome 하위 상대 세그먼트에만. 절대 상위는 D2 containment 로 보장.
//   앵커 = realpath(projectsHome)(이미 해소된 절대 상위 기준 · 조상 심링크/mount 변경은 수용·오거부 0).
//   (R2 HIGH#4: O(N²) realpath 제거) 루프 내부는 세그먼트별 lstat.isSymbolicLink() 심링크 체크만
//   (O(N) lstat). 루프 종료 후 최종 input 에 realpath 를 **1회**만 호출해 렉시컬 누적경로
//   (join(realHome, rel))와 samePath 비교 → 단 1회 realpath 로 전 하위 세그먼트의 reparse/junction/
//   mount/in-root redirect 이탈을 fail-closed 검증. readlink 의존 없음(realpath 상이로 판정).
async function d3ScanSubSegments(projectsHome: string, input: string): Promise<ValidateResult | null> {
  // 앵커를 realpath(projectsHome)로 잡아 절대 상위(조상 심링크·/var→/private/var·/tmp)의 realpath
  // 변경을 수용(D2 containment 위임). 이후 렉시컬 누적은 하위 세그먼트에만 국한된다.
  let realHome: string;
  try { realHome = await realpath(projectsHome); } catch { return null; } // 실패 시 D2(realHome)로 위임
  // D3 하위 스코프를 lexical projectsHome OR realHome 양쪽 기준으로 판정(R3 HIGH · canonical-path 입력).
  //   projectsHome 이 심링크/alias(/var/projects)이고 입력이 canonical(realHome=/private/var/projects
  //   prefix)로 들어오면 하위가 아니라 D3 를 통째 스킵했었다 → in-root reparse/junction/mount 가 marker
  //   만 있으면 D2(out-root만 차단)를 통과. 두 앵커 중 어느 하위든 스캔.
  //   (R4 HIGH) below/prefix 판정을 samePath 와 동일한 플랫폼 인지 대소문자 규칙(subSegmentsUnder)으로
  //   통일 — case-variant 입력도 D3 스캔 수행(스코프 판정 ↔ 최종 realpath 비교 대소문자 규칙 일치).
  //   canonical 입력(realHome 하위)을 우선, 정상 /var alias 입력(projectsHome 하위)은 폴백 — 원 realSub
  //   우선 로직 보존. tail 세그먼트를 realHome 절대 상위에 누적해 canonical·alias 양쪽서 하위를 스캔.
  const segsReal = subSegmentsUnder(realHome, input);
  const segsLex = subSegmentsUnder(projectsHome, input);
  const segs = segsReal ?? segsLex;
  if (!segs) return null;                                          // 어느 앵커 하위도 아님 = D2 containment 위임
  // 루프: 하위 세그먼트별 lstat 심링크 체크만(realpath 없음 — O(N)).
  let acc = realHome;                                              // 렉시컬 누적(realHome 앵커)
  for (const seg of segs) {
    if (seg === "." || seg === "..") return { ok: false, error: "bad-input" };
    acc = join(acc, seg);
    let l;
    try { l = await lstat(acc); } catch { return { ok: false, error: "bad-input" }; } // 세그먼트 부재
    if (l.isSymbolicLink()) return { ok: false, error: "symlink" };
  }
  // 루프 종료 후 최종 input 에 realpath 1회 — 렉시컬 누적(acc)과 상이면 하위 세그먼트에
  //   reparse/junction/mount/in-root redirect 존재(비-심링크 리다이렉트) → fail-closed 거부.
  let realInput;
  try { realInput = await realpath(input); } catch { return { ok: false, error: "bad-input" }; }
  if (!samePath(realInput, acc)) return { ok: false, error: "reparse-point" };
  return null;
}

async function hasHarnessMarker(dir: string): Promise<boolean> {
  for (const m of HARNESS_MARKERS) {
    try { await stat(join(dir, m)); return true; } catch { /* 없음 */ }
  }
  return false;
}

// 전체 검증 파이프라인. 순서: D1 → D4(denylist·containment 前) → D3(reparse·containment 前) →
//   D2/D6(realpath containment·최후방어) → D5(마커·심층방어). 성공 시 effectiveRoot = realpath(input).
export async function validateProjectRoot(input: string, projectsHome: string): Promise<ValidateResult> {
  if (typeof projectsHome !== "string" || projectsHome.length === 0) return { ok: false, error: "outside-projects-home" };

  if (!d1Normalize(input).ok) return { ok: false, error: "bad-input" };

  let realInput: string;
  try { realInput = await realpath(input); } catch { return { ok: false, error: "bad-input" }; }

  // D4 (containment 前 — /etc·~/.ssh 는 outside 로 삼키지 않고 denied-system-path 로 명시).
  if (d4Denied(realInput)) return { ok: false, error: "denied-system-path" };

  // D3 (containment 前 — 하위 세그먼트 junction/symlink 를 out-root 여부와 무관하게 명시 거부).
  const d3 = await d3ScanSubSegments(projectsHome, input);
  if (d3) return d3;

  // D2/D6 canonical containment(최후방어). 절대 상위 realpath 변경(/var→/private/var·/tmp) 허용(ACCEPT).
  let realHome: string;
  try { realHome = await realpath(projectsHome); } catch { return { ok: false, error: "outside-projects-home" }; }
  if (!isWithinRoot(realHome, realInput)) return { ok: false, error: "outside-projects-home" };

  // D5 하네스 마커(심층방어·경계 아님). 단독 경로탈출 차단 불가 — D2 가 실경계.
  if (!(await hasHarnessMarker(realInput))) return { ok: false, error: "no-harness-marker" };

  return { ok: true, effectiveRoot: realInput };
}

// D7 TOCTOU 스왑 재확인 — 지속(쓰기) 직전 재검증. 검증 시점 effectiveRoot 와 불일치 시 거부(escape).
//   내부적으로 validateProjectRoot 재실행(realpath 재조회) 후 effectiveRoot 동일성 확인.
export async function revalidateForPersist(
  input: string, projectsHome: string, expectedRoot: string,
): Promise<ValidateResult> {
  const v = await validateProjectRoot(input, projectsHome);
  if (!v.ok) return v;
  if (v.effectiveRoot !== expectedRoot) return { ok: false, error: "escape" }; // 검증 후 스왑
  return v;
}
