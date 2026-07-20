// <state_home> 경로 어댑터 (설계 §9-STATE) + 안전 경로 검증(SAFE_SEGMENT).
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute, sep } from "node:path";

export function stateHome(): string {
  if (process.env.HARNESS_STATE_HOME) return process.env.HARNESS_STATE_HOME; // 테스트/오버라이드
  const home = homedir();
  switch (process.platform) {
    case "darwin": return join(home, "Library", "Application Support", "harness-ui");
    case "win32": return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "harness-ui");
    default: return join(process.env.XDG_STATE_HOME ?? join(home, ".local", "state"), "harness-ui");
  }
}

export const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

// argv 요소 token allowlist (leading-dash/dot 금지 → flag injection 방어). exec-run(allowedTools·model)·
// harness(에이전트 tools D 도출) 공유 단일 출처. SAFE_SEGMENT 보다 엄격(첫 글자 영숫자 강제).
export const ARGV_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// 경로 세그먼트 allowlist (빈/`.`/`..`/메타 거부). 엄격 ASCII(runId·artifact 등) — 불변.
export function isSafeSegment(seg: string): boolean {
  if (!seg || seg === "." || seg === "..") return false;
  return SAFE_SEGMENT.test(seg);
}

// docs 뷰어 전용 세그먼트 검증(트리↔열람 정합·MED). 유니코드·공백 허용하되 traversal 은 차단.
// isSafeSegment(엄격 ASCII) 는 그대로 두고, 한글·공백 결과서 파일명이 트리에 보이면 반드시 열리게 한다.
// 거부: 빈 문자열·`.`·`..`·path separator(`/`,`\`)·null·제어문자(0x00-0x1F).
export function isSafeDocsSegment(seg: string): boolean {
  if (!seg || seg === "." || seg === "..") return false;
  if (seg.includes("/") || seg.includes("\\")) return false;
  for (let i = 0; i < seg.length; i++) {
    if (seg.charCodeAt(i) <= 0x1f) return false; // null(0x00) 포함 제어문자
  }
  return true;
}

// resolved 경로가 root 하위인지 (경계 검사). realpath는 호출측에서 fd 앵커링과 함께.
export function isWithinRoot(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  const rel = relative(r, t);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  return rel.split(sep)[0] !== ".."; // 첫 세그먼트만 ".." 검사(파일명 "..b" 오거부 방지)
}
