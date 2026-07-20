// F10(M15) 멀티런타임 컨텍스트 읽기 화이트리스트 — 순수 경로 규칙(HR1~HR4·HR7).
// ⚠ 전역 DENY(security.ts)·deniedDocsPath 를 수정하지 않는다(F5 뷰어 방어 훼손 금지·R1 agy MED) —
//   F10 전용 **독립** 규칙(병렬 구조). dot-prefix 함정: `.claude`·`.codex`·`.agents` 3 dot-dir만 정밀 허용.
//
// 2층 방어(F5 deniedDocsPath + openSafeFile 구조 준용):
//   (1) classifyContextPath = HR1/HR2 화이트리스트(첫/둘째 세그먼트 정밀 매칭·dot-dir 3종·정밀 서브루트).
//   (2) deniedContextPath  = HR2/HR4/HR7 denylist(그 외 dot·시크릿·node_modules 류 대량 dir).
//   둘 다 통과해야 열람 가능(fail-closed). 어느 쪽도 상대 층을 대체하지 않는다.

// 트리 열거 노드 상한(F4 MAX_RUNS_SCAN·F5 MAX_DOCS·docsTree MAX_TREE 와 동등·OOM/DoS 방어).
export const MAX_CONTEXT_NODES = 2000;

// 런타임 라벨. `.agents/skills`·AGENTS.md 는 Codex·agy 공유(라벨 "codex/agy").
export type Runtime = "claude" | "codex" | "agy" | "codex/agy";

// projectRoot 직속 컨텍스트 파일 화이트리스트 + 런타임 라벨.
//   CLAUDE.md=claude · AGENTS.md=codex/agy 공유 · GEMINI.md=agy.
export const CONTEXT_TOP_FILES: ReadonlyArray<{ name: string; runtime: Runtime }> = [
  { name: "CLAUDE.md", runtime: "claude" },
  { name: "AGENTS.md", runtime: "codex/agy" },
  { name: "GEMINI.md", runtime: "agy" },
];

// 정밀 서브루트(각 dot-dir 전체 재귀 아님). 첫/둘째 세그먼트가 정확히 일치해야 통과.
export const CONTEXT_SUBROOTS: ReadonlyArray<{ segs: readonly [string, string]; runtime: Runtime }> = [
  { segs: [".claude", "agents"], runtime: "claude" },
  { segs: [".claude", "skills"], runtime: "claude" },
  { segs: [".codex", "agents"], runtime: "codex" },
  { segs: [".agents", "skills"], runtime: "codex/agy" },
];

// HR7: 스킬 dir 내 패키지/빌드 환경 무제한 순회(OOM/DoS) 차단(F5 DV5 node_modules 규율 상속).
const BLOCK_DIRS = new Set(["node_modules", "venv", ".venv", "__pycache__", "dist"]);
// HR4: 확장자 기반 시크릿(deniedDocsPath 규칙 참조·전역 함수 미변경).
const SECRET_EXT = /\.(key|pem|p12|pfx|crt|cer)$/i;
const SECRET_NAME = /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519|ui-session-token)([._-][^/]*)?(\/|$)/i;
// HR2: 정밀 허용 dot-dir(첫 세그먼트 정확 일치 시에만 dot-prefix 통과).
const ALLOWED_DOTDIRS = new Set([".claude", ".codex", ".agents"]);

// HR2/HR4/HR7 denylist — projectRoot 상대(또는 서브루트 상대) rel 을 받는다.
//   dot-prefix: 첫 세그먼트가 정확히 3 dot-dir 중 하나일 때만 허용·그 외 위치/이름의 dot 거부.
//   node_modules 류·시크릿 확장자/이름 거부. (화이트리스트 구조는 classifyContextPath 가 별도 강제.)
export function deniedContextPath(rel: string): boolean {
  const segs = rel.split("/").filter((s) => s.length > 0);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (BLOCK_DIRS.has(s)) return true;                    // HR7 대량 dir(.venv 포함)
    if (s.startsWith(".")) {
      if (i === 0 && ALLOWED_DOTDIRS.has(s)) continue;     // 첫 세그먼트 3 dot-dir만 허용
      return true;                                          // 그 외 dot(.env/.git/.ssh/.gemini/중첩 dot) 거부
    }
  }
  if (SECRET_EXT.test(rel) || SECRET_NAME.test(rel)) return true; // HR4 시크릿
  return false;
}

export type ContextClass = { runtime: Runtime; baseSegs: string[]; restSegs: string[] };

// HR1/HR2 화이트리스트 구조 검증. 통과 시 { runtime, baseSegs(서브루트 앵커), restSegs(leaf 포함) }.
//   - 단일 세그먼트 = projectRoot 직속 컨텍스트 파일(CLAUDE/AGENTS/GEMINI.md)만.
//   - 다중 세그먼트 = 정밀 서브루트(첫·둘째 정확 일치) + 그 아래 leaf(restSegs 비어있으면 null).
//   구조만 판정(심링크/시크릿/열람 안전은 deniedContextPath·openSafeFile 소관).
export function classifyContextPath(segs: string[]): ContextClass | null {
  const clean = segs.filter((s) => s.length > 0);
  if (clean.length === 0) return null;
  if (clean.length === 1) {
    const top = CONTEXT_TOP_FILES.find((f) => f.name === clean[0]);
    return top ? { runtime: top.runtime, baseSegs: [], restSegs: [clean[0]!] } : null;
  }
  for (const sr of CONTEXT_SUBROOTS) {
    if (clean[0] === sr.segs[0] && clean[1] === sr.segs[1]) {
      const restSegs = clean.slice(2);
      if (restSegs.length === 0) return null; // 서브루트 dir 자체(leaf 부재) — file 열람 불가
      return { runtime: sr.runtime, baseSegs: [sr.segs[0]!, sr.segs[1]!], restSegs };
    }
  }
  return null;
}
