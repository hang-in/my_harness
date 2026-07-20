// 셸 — 좌측 사이드바 10화면 내비(§IA: 랜딩 없음, 첫 화면=Overview 대시보드·F8 Eval 추가). hash 라우팅(외부 router 무의존).
import { useState, useEffect, useRef } from "react";
import { Overview, Build, Agents, Skills, Context, Runs, Docs, Drift, Ops, Eval, Settings } from "./screens.js";
import { probeConnection } from "./api.js";
import { useApi } from "./ui.js";
import { Icon } from "./icons.js";
import type { DocsSourcesList } from "./api.js";
import { nextConn, showsReconnecting, backoffMs, READY_POLL_MS, type ConnPhase } from "./connection.js";

const SCREENS = [
  { id: "overview", label: "Overview", C: Overview },
  { id: "build", label: "Harness", C: Build },   // 하네스 빌드 허브(목록 + 정의 빌더) — id 는 딥링크 보존
  { id: "agents", label: "Agents", C: Agents },
  { id: "skills", label: "Skills", C: Skills },
  { id: "context", label: "Context", C: Context },
  { id: "runs", label: "History", C: Runs },   // 구성 변경 이력(추가/수정/삭제) — id 는 딥링크 보존
  { id: "docs", label: "Docs", C: Docs },
  { id: "drift", label: "Drift", C: Drift },
  { id: "ops", label: "Ops", C: Ops },
  { id: "eval", label: "Eval", C: Eval },
  { id: "settings", label: "Settings", C: Settings },
] as const;

// RF6: 사이드바 그룹화(실행/정의/문서/점검/설정) — 평면 나열보다 역할군을 시각화.
const GROUPS: { label: string; ids: string[] }[] = [
  { label: "개요", ids: ["overview"] },
  { label: "구성·빌드", ids: ["build", "agents", "skills", "context", "runs"] },
  { label: "문서", ids: ["docs"] },
  { label: "점검", ids: ["drift", "ops", "eval"] },
  { label: "설정", ids: ["settings"] },
];

// 테마 토글 — data-theme(prefers-color-scheme 양방향 override) + localStorage 지속.
type Theme = "light" | "dark";
function initTheme(): Theme {
  try {
    const saved = localStorage.getItem("harness-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* private mode */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// A94 전역 재연결 — healthz 백오프 폴링 상태머신(offline→health-up→ready·401→reauth).
// 개별 통신 에러 토스트 폭주를 전역 오버레이가 흡수(W-C4). ready 는 저빈도, 그 외는 백오프 재시도.
function useConnection(): ConnPhase {
  const [phase, setPhase] = useState<ConnPhase>("ready");
  const phaseRef = useRef<ConnPhase>("ready");
  phaseRef.current = phase;
  useEffect(() => {
    let live = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const probe = await probeConnection();
      if (!live) return;
      const next = nextConn(phaseRef.current, probe);
      setPhase(next);
      if (next === "reauth") return;                 // 재인증 동선으로 전환 → 폴링 중단(리로드가 재시작)
      const delay = next === "ready" ? (attempt = 0, READY_POLL_MS) : backoffMs(attempt++);
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  return phase;
}

// 전역 오버레이 — 재연결 대기(offline/health-up) 또는 재인증(reauth·A84). ready 는 렌더 안 함.
function ConnectionOverlay({ phase }: { phase: ConnPhase }) {
  if (phase === "reauth") {
    return (
      <div className="conn-overlay" role="alertdialog" aria-modal="true" aria-labelledby="conn-title">
        <div className="conn-box">
          <p id="conn-title" className="conn-title">🔒 인증이 만료되었습니다</p>
          <p className="muted">서버는 정상이나 세션 토큰이 만료됐습니다. 런처가 발급한 링크로 다시 접속하세요.</p>
          <button className="primary" onClick={() => location.reload()}>다시 불러오기</button>
        </div>
      </div>
    );
  }
  if (!showsReconnecting(phase)) return null;
  return (
    <div className="conn-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="conn-box">
        <p className="conn-title"><span className="conn-spin" aria-hidden="true">↻</span> 재연결 대기 (Reconnecting…)</p>
        <p className="muted">
          {phase === "offline"
            ? "서버와의 연결이 끊겼습니다 · 재시작·종료·네트워크 확인 중입니다. 자동으로 복귀합니다."
            : "서버는 응답하나 세션을 재확립하는 중입니다 · 잠시만 기다려 주세요."}
        </p>
      </div>
    </div>
  );
}

export function App() {
  // hash 에서 화면 id 만 추출(딥링크 쿼리 `#/runs?run=<id>` 지원 — `?` 이후는 화면별 소비).
  const idOf = () => location.hash.replace(/^#\/?/, "").split("?")[0] || "overview";
  const [cur, setCur] = useState<string>(idOf);
  const [theme, setTheme] = useState<Theme>(initTheme);
  const [q, setQ] = useState("");   // 사이드바 검색(nav 라벨 필터)
  const phase = useConnection();
  // A118: docsMenuEnabled=false → 사이드바 Docs 비활성+이유 툴팁. 로드 전엔 활성 가정(플리커 방지). 실패해도 기본 활성.
  const docsSources = useApi<DocsSourcesList>("/api/docs/sources");
  const docsEnabled = docsSources.data?.enabled ?? true;
  // 사이드바 카운트(시안: Agents·Skills·Drift). 경량 조회 — 셸 1회.
  const stats = useApi<{ configHealth: { agents: number; skills: number } }>("/api/overview/state-stats");
  const drift = useApi<{ findings: unknown[] }>("/api/drift");
  const tail: Record<string, React.ReactNode> = {
    agents: stats.data?.configHealth.agents,
    skills: stats.data?.configHealth.skills,
    drift: drift.data?.findings.length,
  };
  useEffect(() => {
    const on = () => setCur(idOf());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // 딥링크 보존 — 구 #/factory 는 #/build(FactoryPanel)로 흡수. 리다이렉트.
  useEffect(() => { if (cur === "factory") location.hash = "#/build"; }, [cur]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("harness-theme", theme); } catch { /* private mode */ }
  }, [theme]);
  // 구 #/factory 는 build 로 정규화 — effect 리다이렉트 전에도 Overview 플래시 없이 build 렌더.
  const activeId = cur === "factory" ? "build" : cur;
  const active = SCREENS.find((s) => s.id === activeId) ?? SCREENS[0];
  const Body = active.C;
  const byId = (id: string) => SCREENS.find((s) => s.id === id)!;
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span className="brand-name">My Harness Web<span className="ver">v0.6 · local</span></span>
        </div>
        <div className="navsearch">
          <Icon name="search" className="navsearch-ico" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" aria-label="화면 검색" spellCheck={false} />
          <kbd>⌘K</kbd>
        </div>
        {GROUPS.map((g) => {
          const ids = g.ids.filter((id) => !q || byId(id).label.toLowerCase().includes(q.toLowerCase()));
          if (ids.length === 0) return null;   // 검색 필터로 빈 그룹 숨김
          return (
            <div key={g.label} className="navgroup">
              <div className="glabel">{g.label}</div>
              {ids.map((id) => {
                const s = byId(id);
                // A81/A118: Docs 메뉴 off → 비활성 링크(이유 툴팁·클릭 무효). 빈 disabled 금지 = 사유 명시.
                if (s.id === "docs" && !docsEnabled) return (
                  <span key={s.id} className="navlink disabled" aria-disabled="true"
                    title="Docs 메뉴가 꺼져 있습니다 · Settings → Docs 소스에서 켜세요">
                    <Icon name={s.id} /><span>{s.label}</span>
                  </span>
                );
                return (
                  <a key={s.id} href={`#/${s.id}`} className={s.id === active.id ? "navlink on" : "navlink"}>
                    <Icon name={s.id} /><span>{s.label}</span>
                    {tail[s.id] != null && <span className="tail">{tail[s.id]}</span>}
                  </a>
                );
              })}
            </div>
          );
        })}
      </nav>
      <main className="main">
        <header className="topbar">
          <nav className="crumbs" aria-label="위치">
            <span>My Harness Web</span><span className="sep">/</span><span className="cur">{active.label}</span>
          </nav>
          <div className="spacer" />
          <span className="statuspill"><span className="dot" />{phase === "ready" ? "연결됨" : "재연결 중"}<span className="host">· {location.host || "localhost:5174"}</span></span>
          <button className="iconbtn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="테마 전환" aria-label="라이트/다크 테마 전환">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </header>
        <div className="body"><Body /></div>
      </main>
      {/* A94: 전역 재연결/재인증 오버레이 — 통신에러 흡수(개별 토스트 폭주 금지·W-C4) */}
      <ConnectionOverlay phase={phase} />
    </div>
  );
}
