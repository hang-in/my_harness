import { describe, it, expect } from "vitest";
import { toggleSelected, runSubmitErrorText, focusRunFromHash, runsDeepLink } from "../src/web/agent-run.js";

// M10 F2 웹 — D 체크박스 토글(U⊆D 구조 보장)·서버 거부 한국어 매핑(A100)·딥링크(A87) 순수 로직 고정.

describe("toggleSelected — D 체크박스 토글(U⊆D 구조 보장)", () => {
  const D = ["Read", "Grep", "Glob", "Bash"];
  it("D 안 도구 켜기 → D 순서 보존", () => {
    expect(toggleSelected([], "Grep", true, D)).toEqual(["Grep"]);
    expect(toggleSelected(["Bash"], "Read", true, D)).toEqual(["Read", "Bash"]); // D 순서
  });
  it("끄기 → 제거", () => {
    expect(toggleSelected(["Read", "Grep"], "Read", false, D)).toEqual(["Grep"]);
  });
  it("D 밖 tool 토글 시도 → 무시(구조적 U⊆D)·기존값 정화", () => {
    expect(toggleSelected(["Read"], "Write", true, D)).toEqual(["Read"]); // Write 는 D 밖 → 추가 불가
    expect(toggleSelected(["Read", "Write"], "Grep", true, D)).toEqual(["Read", "Grep"]); // 기존 Write 정화
  });
  it("반환은 항상 U⊆D", () => {
    const out = toggleSelected(["Read", "Evil"], "Bash", true, D);
    expect(out.every((t) => D.includes(t))).toBe(true);
  });
});

describe("runSubmitErrorText — 서버 거부 한국어 매핑(A100·조용한 드롭 금지)", () => {
  it("400 unauthorized-tool → detail(선언되지 않은 도구) 노출", () => {
    const msg = runSubmitErrorText(400, "unauthorized-tool", ["Write", "Bash"]);
    expect(msg).toContain("선언되지 않은 도구");
    expect(msg).toContain("Write, Bash"); // 조용한 드롭 아님
  });
  it("409 agent-definition-changed → 정의 변경·폼 새로고침 안내", () => {
    const msg = runSubmitErrorText(409, "agent-definition-changed");
    expect(msg).toContain("정의가 변경");
    expect(msg).toContain("새로고침");
  });
  it("기타 상태 → 상태코드 포함 폴백", () => {
    expect(runSubmitErrorText(500, "boom")).toContain("500");
  });
});

describe("focusRunFromHash / runsDeepLink — 딥링크(A87)", () => {
  it("hash 의 ?run= 파싱", () => {
    expect(focusRunFromHash("#/runs?run=build-2026-1")).toBe("build-2026-1");
    expect(focusRunFromHash("#/runs")).toBeNull();
    expect(focusRunFromHash("#/runs?other=x")).toBeNull();
  });
  it("딥링크 왕복(encode ↔ parse)", () => {
    const id = "build-2026.07.09_a";
    const link = runsDeepLink(id);
    expect(link.startsWith("#/runs?run=")).toBe(true);
    expect(focusRunFromHash(link)).toBe(id);
  });
});
