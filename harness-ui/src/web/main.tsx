// 엔트리 — session 부트스트랩(fragment 토큰 교환) 후 React 마운트. 인증 실패 시 안내.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapSession } from "./api.js";
import { App } from "./App.js";
import "./styles.css";

async function boot() {
  const el = document.getElementById("app")!;
  const session = await bootstrapSession();
  if (!session) {
    el.textContent = "인증 필요 — 런처가 발급한 1회용 링크로 접속하세요.";
    return;
  }
  createRoot(el).render(<StrictMode><App /></StrictMode>);
}
boot();
