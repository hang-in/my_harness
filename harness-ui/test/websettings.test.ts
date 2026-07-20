import { describe, it, expect } from "vitest";
import {
  projectRootErrorText, PROJECT_ROOT_ERRORS,
  requiresOrphanChoice, canSave,
} from "../src/web/settings.js";

// F3 M11 웹 — 서버 error 코드 한국어 매핑(A5·조용한 드롭 금지)·A99 활성 run 2선택 판정.

describe("projectRootErrorText — 서버 error 코드 한국어 매핑(W-A5·A101)", () => {
  it("전 error 코드 집합이 매핑됨(bad-input·symlink·reparse-point·denied-system-path·no-harness-marker·outside-projects-home·escape·boundary-not-provisioned)", () => {
    const codes = ["bad-input", "symlink", "reparse-point", "denied-system-path",
      "no-harness-marker", "outside-projects-home", "escape", "boundary-not-provisioned"];
    for (const c of codes) {
      expect(PROJECT_ROOT_ERRORS[c]).toBeDefined();
      expect(projectRootErrorText(c)).toBe(PROJECT_ROOT_ERRORS[c]);
      expect(projectRootErrorText(c).length).toBeGreaterThan(0);
    }
  });
  it("boundary-not-provisioned → HARNESS_PROJECTS_HOME 안내 포함", () => {
    expect(projectRootErrorText("boundary-not-provisioned")).toContain("HARNESS_PROJECTS_HOME");
  });
  it("outside-projects-home → 경계(projectsHome) 언급", () => {
    expect(projectRootErrorText("outside-projects-home")).toContain("경계");
  });
  it("미지 코드 → 상태코드·코드 포함 폴백(조용한 드롭 아님)", () => {
    const msg = projectRootErrorText("boom", 500);
    expect(msg).toContain("500");
    expect(msg).toContain("boom");
  });
});

describe("requiresOrphanChoice / canSave — A99 활성 run 고아 통제", () => {
  it("activeRunsWarning===0 → 2선택 미요구·바로 저장 가능(과경고 금지·W-B2)", () => {
    expect(requiresOrphanChoice(0)).toBe(false);
    expect(canSave(0, null)).toBe(true);
  });
  it("activeRunsWarning>0 → 2선택 요구·선택 전 저장 불가", () => {
    expect(requiresOrphanChoice(3)).toBe(true);
    expect(canSave(3, null)).toBe(false);
  });
  it("activeRunsWarning>0 + 선택 완료 → 저장 가능(cancel-first / headless-continue)", () => {
    expect(canSave(3, "cancel-first")).toBe(true);
    expect(canSave(3, "headless-continue")).toBe(true);
  });
});
