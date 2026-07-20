import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    environment: "node",
    // 실서브프로세스 spawn(execrun/supervisor/reconcile/registry) e2e가 파일 병렬 시
    // CPU 오버서브스크립션으로 자식 프로세스가 기아→flaky 타임아웃. 파일 직렬화로 결정화.
    // (v0.5 코드 정상 확인: 직렬 시 전건 통과. 회귀 아님·환경성 방어.)
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
