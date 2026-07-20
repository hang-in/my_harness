// 공용 UI 프리미티브 — 로딩/에러/빈상태·데이터훅·테이블·배지. React 가 텍스트 escape(XSS 방어).
import { useEffect, useState, useCallback } from "react";
import { apiGet } from "./api.js";
import { readErrorText } from "./errors.js"; // U1: GET 실패 → 한국어(원시 영문 노출 금지)
import { confidenceMeta, formatMetricValue, type Confidence, type MetricValue, type MetricFmt } from "./metrics.js";

// GET 데이터 훅 — 로딩/에러/재조회. path 변경 시 재요청.
export function useApi<T>(path: string | null): { data: T | null; err: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setData(null); setLoading(true); setErr(null); // path 변경 시 이전 data 클리어(stale 렌더 방지, agy R2)
    apiGet<T>(path)
      .then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch((e) => { if (live) { setErr(readErrorText(e)); setLoading(false); } }); // U1: 상태코드→한국어
    return () => { live = false; };
  }, [path, n]);
  return { data, err, loading, reload };
}

// A82/A83/A84: 로딩/에러(한국어+재시도)/빈 3-state. 에러는 개별 GET 실패 인라인(연결 끊김은 A94 전역 오버레이).
export function Async<T>({ state, children }: { state: ReturnType<typeof useApi<T>>; children: (d: T) => React.ReactNode }) {
  if (state.loading && !state.data) return <div className="muted">불러오는 중…</div>;
  if (state.err) return (
    <div className="error" role="alert">
      ⚠ {state.err} <button type="button" className="link" onClick={state.reload}>다시 시도</button>
    </div>
  );
  if (!state.data) return <div className="muted">데이터 없음</div>;
  return <>{children(state.data)}</>;
}

export function Badge({ kind, children }: { kind: "ok" | "warn" | "err" | "muted"; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card"><h3>{title}</h3>{children}</section>;
}

// ── F6 W1 confidence 배지(A62·A90·A92) — 아이콘+텍스트(색 단독 금지)·툴팁 산정식. 기존 Badge 와 별개(의미 다름). ──
// tabIndex=0·role=note·aria-label: 키보드 포커스로 산정식 접근(A92). measured 는 아이콘 형태로 estimated/unattributed 와 구분.
export function ConfBadge({ confidence }: { confidence: Confidence }) {
  const m = confidenceMeta(confidence);
  return (
    <span className={`conf-badge conf-${confidence}`} tabIndex={0} role="note"
      aria-label={`신뢰도 ${m.label}: ${m.formula}`} title={m.formula}>
      <span className="conf-icon" aria-hidden="true">{m.icon}</span>{m.label}
    </span>
  );
}

// ── F6 W1/W7 MetricValue 렌더 헬퍼 — 값 + confidence 배지 동반. value null → "미측정/미귀속"(0 위장 금지). ──
export function MetricCell({ mv, fmt }: { mv: MetricValue | null | undefined; fmt?: MetricFmt }) {
  const f = formatMetricValue(mv, fmt);
  const conf: Confidence = mv?.confidence ?? "unattributed";
  return (
    <span className="metric-cell">
      <span className={f.missing ? "metric-missing muted" : "metric-num"}>{f.text}</span>
      <ConfBadge confidence={conf} />
    </span>
  );
}

// 안전 테이블 — 셀은 문자열/노드. innerHTML 미사용.
export function Table({ cols, rows }: { cols: string[]; rows: (React.ReactNode)[][] }) {
  if (rows.length === 0) return <div className="muted">항목 없음</div>;
  return (
    <div className="tablewrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
