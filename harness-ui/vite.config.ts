import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "src/web",
  server: {
    host: "127.0.0.1",
    port: 5273,
    // dev 전용: Host(changeOrigin) + Origin 을 server 포트(5274)로 재작성.
    // 프로덕션은 server 가 정적자원까지 단일 오리진 서빙 → 이 재작성 불필요(dev 프록시 포트분리 보정만).
    // 키를 `^/api/`(regex, 슬래시 포함)로 좁힘 — 소스 모듈 `/api.ts` 가 `/api` prefix 에 오매칭돼
    // 프록시로 새는 것 방지(dev 전용). 실제 엔드포인트는 전부 `/api/…` 형태.
    proxy: {
      "^/api/": {
        target: "http://127.0.0.1:5274",
        changeOrigin: true,
        headers: { origin: "http://127.0.0.1:5274" },
      },
    },
  },
  build: { outDir: "../../dist", emptyOutDir: true },
});
