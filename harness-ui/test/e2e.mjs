// e2e — v0.6 종단(실 HTTP 부팅). 서버 A=실 하네스 레포(인벤토리/drift/state-stats), 서버 B=격리 픽스처
//   projectRoot(F4 runs·F2 U⊆D·F7 gate-on 편집·F8 evals). 픽스처는 tmp 로 조립·종료 시 정리.
// 실행: HARNESS_STATE_HOME=<tmp> npx tsx test/e2e.mjs  (또는 npm run e2e)
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, projectRoot } from "../src/server/index.ts";
import { makeSecurity } from "../src/server/security.ts";

let fail = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} — ${m}`); if (!c) fail++; };

// ── 격리 픽스처 projectRoot(서버 B) 조립 ──────────────────────────────────────
const PH = await mkdtemp(join(tmpdir(), "hui-e2e-ph-"));   // projectsHome(경계)
const FROOT = join(PH, "app");                              // 픽스처 projectRoot(경계 하위·마커 .claude)
process.env.HARNESS_PROJECTS_HOME = PH;                     // F3 경계 프로비저닝(env SSOT)

async function mkFixtures() {
  // .claude 마커 + 편집 대상 정의(F2 U⊆D·F7)
  await mkdir(join(FROOT, ".claude", "agents"), { recursive: true });
  await writeFile(join(FROOT, ".claude", "agents", "fixture-worker.md"),
    "---\nname: fixture-worker\ndescription: fixture agent for e2e boundary tests\ntools: Read, Grep\n---\n# fixture-worker\n\nbody line\n");
  // _workspace/runs 픽스처(F4) — 3건(completed/failed/running)
  const iso = (n) => new Date(Date.UTC(2026, 6, 1, 0, n, 0)).toISOString();
  const mkStatus = (id, state, at) => ({
    schemaVersion: "1", runId: id, state, phase: "", progress: state === "completed" ? 100 : 0,
    updatedAt: at, heartbeatAt: at, serverPid: 1, serverStartTime: "", childPid: null, childStartTime: null,
    childProcessGroupId: null, exitCode: state === "completed" ? 0 : null, exitSignal: null,
    cancelRequestedAt: null, stateReason: null, summary: "", error: null,
  });
  const mkManifest = (id, rt, mode, goal, at) => ({
    schemaVersion: "1", runId: id, projectRoot: FROOT, runtime: rt, mode, createdAt: at,
    requestedBy: "local-user", goal, agents: [], agent: null, targets: [], permissionMode: "read-only",
    model: "default", supervisorVersion: "e2e",
  });
  const runs = [
    ["run-aaa", "codex", "audit", "alpha inventory scan", "completed", iso(1)],
    ["run-bbb", "claude", "build", "beta build task", "failed", iso(2)],
    ["run-ccc", "codex", "audit", "gamma live run", "running", iso(3)],
  ];
  for (const [id, rt, mode, goal, state, at] of runs) {
    const d = join(FROOT, "_workspace", "runs", id);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "manifest.json"), JSON.stringify(mkManifest(id, rt, mode, goal, at)));
    await writeFile(join(d, "status.json"), JSON.stringify(mkStatus(id, state, at)));
  }
  // _workspace/evals 픽스처(F8) — loopA/stage1/run1 scorecard(verified: 재도출 일치)
  const sc = join(FROOT, "_workspace", "evals", "loopA", "stage1", "run1");
  await mkdir(sc, { recursive: true });
  // alignment = (confirmed + 0.5*partial)/(confirmed+partial+rejected) = (8+1)/12 = 0.75
  await writeFile(join(sc, "scorecard.json"), JSON.stringify({
    schema_version: "1", loop: "loopA", stage_id: "stage1", run_id: "run1",
    verdict_counts: { confirmed: 8, partial: 2, deferred: 0, rejected: 2, duplicate: 0 },
    alignment_score: 0.75, termination_reason: "converged", quality_label: "good",
  }));
}
await mkFixtures();

// ── 서버 부팅(A=실 레포, B=픽스처) ───────────────────────────────────────────
const PORT_A = 5199, PORT_B = 5200;
const secA = makeSecurity(PORT_A), secB = makeSecurity(PORT_B);
const appA = buildServer({ security: secA });
const appB = buildServer({ security: secB, projectRoot: FROOT });
await appA.listen({ port: PORT_A, host: "127.0.0.1" });
await appB.listen({ port: PORT_B, host: "127.0.0.1" });
console.log(`e2e projectRoot(A)=${projectRoot}\ne2e projectRoot(B)=${FROOT}`);

// 포트별 fetch 헬퍼(Host/Origin 게이트 충족).
function mkClient(port) {
  const ORIGIN = `http://127.0.0.1:${port}`;
  const HOST = `127.0.0.1:${port}`;
  const j = async (path, opt = {}) => {
    const r = await fetch(`${ORIGIN}${path}`, { ...opt, headers: { host: HOST, ...(opt.headers ?? {}) } });
    const body = await r.json().catch(() => null);
    return { code: r.status, body, headers: r.headers };
  };
  return { ORIGIN, HOST, j };
}
const A = mkClient(PORT_A);
const B = mkClient(PORT_B);

async function exchange(client, sec) {
  const ex = await client.j("/api/auth/exchange", {
    method: "POST", headers: { origin: client.ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ bootstrap: sec.bootstrap }),
  });
  return ex.body?.session;
}

try {
  // ═══ 서버 A — v0.5 회귀 + 실 레포 기반 v0.6 읽기 ═══════════════════════════
  ok((await A.j("/api/harness")).code === 401, "게이트: 토큰 없는 /api/harness → 401");
  ok((await A.j("/healthz")).code === 200, "liveness: /healthz 비인증 200");

  const SA = await exchange(A, secA);
  ok(typeof SA === "string", "auth(A): bootstrap→session 교환 200");
  const authA = { authorization: `Bearer ${SA}` };
  const againA = await A.j("/api/auth/exchange", { method: "POST", headers: { origin: A.ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ bootstrap: secA.bootstrap }) });
  ok(againA.code === 401, "auth(A): 동일 bootstrap 재사용 → 401(single-use)");

  // 인벤토리/agents/drift/state-stats/runtimes/ops (v0.5 회귀)
  const inv = await A.j("/api/harness", { headers: authA });
  ok(inv.code === 200, "inventory: /api/harness 200");
  const nAgents = (inv.body?.claude?.agents ?? 0) + (inv.body?.codex?.agents ?? 0);
  const nSkills = (inv.body?.claude?.skills ?? 0) + (inv.body?.codex?.skills ?? 0);
  ok(nAgents >= 4, `inventory: 에이전트 ${nAgents}개(≥4)`);
  ok(nSkills >= 3, `inventory: 스킬 ${nSkills}개(≥3)`);
  ok(inv.body?.claude?.entrypoint === "CLAUDE.md", "inventory: CLAUDE.md 진입점 검출");
  const ag = await A.j("/api/agents", { headers: authA });
  ok(ag.code === 200 && (ag.body?.agents ?? []).some((a) => a.name === "qa-verifier"), "agents: qa-verifier 에이전트 검출");
  const dr = await A.j("/api/drift", { headers: authA });
  ok(dr.code === 200 && Array.isArray(dr.body?.findings), `drift: /api/drift 200(findings ${dr.body?.findings?.length ?? "?"})`);
  const ss = await A.j("/api/overview/state-stats", { headers: authA });
  ok(ss.code === 200 && ss.body?.configHealth && ss.body?.evolution, "state-stats: configHealth+evolution 존재");
  const rt = await A.j("/api/runtimes", { headers: authA });
  ok(rt.code === 200 && typeof rt.body === "object", "runtimes: /api/runtimes 200");
  const ops = await A.j("/api/ops/status", { headers: authA });
  ok(ops.code === 200 && ops.body?.runtimes, "ops: /api/ops/status 200");

  // dry-run + flag injection + cross-origin(v0.5 회귀)
  const dryC = await A.j("/api/runs", { method: "POST", headers: { ...authA, origin: A.ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ runtime: "codex", mode: "audit", domain: "list files", dryRun: true }) });
  ok(dryC.code === 200 && dryC.body?.dryRun === true && dryC.body?.preview?.args?.[0] === "exec", "dry-run codex: preview.args");
  const inj = await A.j("/api/runs", { method: "POST", headers: { ...authA, origin: A.ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ runtime: "claude", mode: "audit", domain: "x", model: "--evil", dryRun: true }) });
  ok(inj.code === 400, "dry-run: model=--evil(flag injection) → 400");
  const xo = await A.j("/api/runs", { method: "POST", headers: { ...authA, origin: "http://evil.com", "content-type": "application/json" }, body: JSON.stringify({ runtime: "codex", mode: "audit", domain: "x", dryRun: true }) });
  ok(xo.code === 403, "origin: cross-origin POST → 403");

  // ── F5 docs 뷰어(실 레포 docs/) ──
  const docs = await A.j("/api/docs", { headers: authA });
  ok(docs.code === 200 && docs.body?.root === "docs" && Array.isArray(docs.body?.tree), "F5: /api/docs 트리 200(root=docs)");
  // 트리에서 첫 md 파일 하나 찾아 미리보기 + CSP 헤더
  const firstFile = (function find(nodes) { for (const n of nodes ?? []) { if (n.type === "file" && (n.ext === "md" || n.ext === "txt")) return n.path; if (n.type === "dir") { const r = find(n.children); if (r) return r; } } return null; })(docs.body?.tree);
  if (firstFile) {
    const enc = firstFile.split("/").map(encodeURIComponent).join("/");
    const prev = await A.j(`/api/docs/${enc}`, { headers: authA });
    ok(prev.code === 200 && "content" in (prev.body ?? {}) && "renderable" in (prev.body ?? {}), `F5: 문서 미리보기 200 shape(${firstFile.slice(0, 32)})`);
    ok((prev.headers.get("content-security-policy") ?? "").includes("script-src 'none'"), "F5: 미리보기 CSP script-src 'none'");
    ok(prev.headers.get("x-content-type-options") === "nosniff", "F5: 미리보기 nosniff");
    const dl = await fetch(`${A.ORIGIN}/api/docs/${enc}?download=1`, { headers: { host: A.HOST, ...authA } });
    ok(dl.status === 200 && (dl.headers.get("content-disposition") ?? "").includes("attachment"), "F5: ?download=1 attachment");
  } else { ok(false, "F5: 실 레포 docs/ 에 미리보기 대상 파일 없음(픽스처 확인)"); }
  // 거부: ../ 경로탈출(인코딩 세그먼트) → 400 · .env dot-prefix → 400
  // 라우터 정규화 회피 위해 슬래시까지 인코딩(단일 세그먼트로 핸들러 도달) → openSafeFile isSafeDocsSegment 400.
  const esc = await A.j("/api/docs/..%2Fetc%2Fpasswd", { headers: authA });
  ok(esc.code === 400, "F5 거부: ../etc/passwd(핸들러 도달·인코딩 슬래시) → 400 invalid-path");
  // 라우터 정규화 경로(%2e%2e/) 는 /api/etc/passwd 로 붕괴 → 404(traversal 미도달·안전)
  const escNorm = await A.j("/api/docs/%2e%2e/etc/passwd", { headers: authA });
  ok(escNorm.code === 404, "F5 거부: ../etc/passwd(라우터 정규화) → 404(traversal 차단)");
  const dotenv = await A.j("/api/docs/.env", { headers: authA });
  ok(dotenv.code === 400, "F5 거부: .env(denylist) → 400");

  // ── F6 metrics(실 레포·빈 안전) ──
  for (const kind of ["overview", "agents", "skills"]) {
    const m = await A.j(`/api/metrics/${kind}`, { headers: authA });
    ok(m.code === 200 && m.body?.schemaVersion === "1" && m.body?.coverage && "truncatedReason" in m.body.coverage, `F6: /api/metrics/${kind} 200 + coverage`);
  }
  const mo = await A.j("/api/metrics/overview", { headers: authA });
  ok(mo.body?.successRate && "confidence" in mo.body.successRate && mo.body?.totalTokens && "confidence" in mo.body.totalTokens, "F6: overview per-value confidence(successRate·totalTokens)");
  // limit clamp(음수/과대 → 안전 폴백·400 아님)
  ok((await A.j("/api/metrics/overview?limit=99999", { headers: authA })).code === 200, "F6: limit 과대 → clamp(200)");

  // ── F2 run-template(실 에이전트 qa-verifier) ──
  const tmplName = (ag.body.agents.find((a) => a.name === "qa-verifier") ? "qa-verifier" : ag.body.agents[0].name);
  const tmpl = await A.j(`/api/agents/${encodeURIComponent(tmplName)}/run-template`, { headers: authA });
  ok(tmpl.code === 200 && tmpl.body?.agent === tmplName && Array.isArray(tmpl.body?.suggestedAllowedTools) && tmpl.body?.permissionMode === "read-only" && typeof tmpl.body?.fingerprint === "string", "F2: run-template 프리필 shape(suggestedAllowedTools·permissionMode·fingerprint)");
  ok((await A.j("/api/agents/__nope__/run-template", { headers: authA })).code === 404, "F2: 미존재 run-template → 404");
  ok((await A.j("/api/agents/..%2f..%2fetc/run-template", { headers: authA })).code === 400, "F2: 경로주입 run-template → 400");

  // ── F3 settings(실 레포) + 미프로비저닝 409 ──
  const set = await A.j("/api/settings", { headers: authA });
  ok(set.code === 200 && "projectRoot" in set.body && "projectsHome" in set.body && "projectsHomeProvisioned" in set.body && set.body?.mutationEnabled === false && "definitionEditEnabled" in set.body, "F3: /api/settings shape(projectRoot·projectsHome·provisioned·mutationEnabled:false)");
  // 미프로비저닝 409(env 일시 제거)
  const savedPH = process.env.HARNESS_PROJECTS_HOME;
  delete process.env.HARNESS_PROJECTS_HOME;
  const np = await A.j("/api/settings/project-root", { method: "POST", headers: { ...authA, origin: A.ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ path: FROOT, dryRun: true }) });
  ok(np.code === 409 && np.body?.error === "boundary-not-provisioned", "F3: 미프로비저닝 project-root → 409 boundary-not-provisioned");
  process.env.HARNESS_PROJECTS_HOME = savedPH;

  // ── F7 GET definition + gate off PUT 403(실 레포·쓰기 없음) ──
  const defName = tmplName;
  const gdef = await A.j(`/api/agents/${encodeURIComponent(defName)}/definition`, { headers: authA });
  if (gdef.code === 200) {
    ok("content" in gdef.body && typeof gdef.body?.baseHash === "string" && typeof gdef.body?.pathId === "string" && gdef.body?.editable === false, "F7: GET definition shape(content·baseHash·pathId·editable:false)");
    const put403 = await A.j(`/api/agents/${encodeURIComponent(defName)}/definition`, { method: "PUT", headers: { ...authA, origin: A.ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ content: gdef.body.content, baseHash: gdef.body.baseHash, pathId: gdef.body.pathId }) });
    ok(put403.code === 403 && put403.body?.error === "edit-disabled", "F7: 게이트 off PUT → 403 edit-disabled(쓰기 없음)");
  } else {
    ok([404, 409].includes(gdef.code), `F7: GET definition(${defName}) 비200(${gdef.code}) — ambiguous/codex 허용`);
  }

  // ── F8 evals config reject(실 레포) ──
  ok((await A.j("/api/evals/config", { headers: authA })).code === 200, "F8: GET /api/evals/config 200");
  const stage4 = await A.j("/api/evals/config", { method: "POST", headers: { ...authA, origin: A.ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ adoptionStage: 4 }) });
  ok(stage4.code === 400 && stage4.body?.error === "bad-input", "F8: adoptionStage:4 → 400 bad-input(쓰기 경로 없음)");
  const floorBad = await A.j("/api/evals/config", { method: "POST", headers: { ...authA, origin: A.ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ thresholds: { minAdjudicatedClaims: 5 } }) });
  ok(floorBad.code === 400 && floorBad.body?.error === "bad-input", "F8: floor 미만 임계 → 400 bad-input(silent-clamp 아님)");

  // ═══ 서버 B — 격리 픽스처(F4 데이터·F2 U⊆D·F7 gate-on·F8 trend) ═══════════
  const SB = await exchange(B, secB);
  ok(typeof SB === "string", "auth(B): bootstrap→session 교환 200");
  const authB = { authorization: `Bearer ${SB}` };
  const mutB = { ...authB, origin: B.ORIGIN, "content-type": "application/json" };

  // ── F4 runs 필터/검색/정렬/페이지 + 하위호환 + 거부 ──
  const bare = await B.j("/api/runs", { headers: authB });
  ok(bare.code === 200 && Array.isArray(bare.body?.runs) && bare.body.runs.length === 3 && !("items" in bare.body), "F4: 무인자 → {runs} 하위호환(3건·items 없음)");
  const q1 = await B.j("/api/runs?state=completed", { headers: authB });
  ok(q1.code === 200 && Array.isArray(q1.body?.items) && ["total", "offset", "limit", "hasMore", "scanned", "truncated", "truncatedReason", "recordedAtSource", "schemaVersion"].every((k) => k in q1.body), "F4: 인자 → QueryRunsResult 전 shape 키");
  ok(q1.body.items.every((r) => r.state === "completed") && q1.body.total === 1, "F4: state=completed 필터(1건)");
  const item0 = q1.body.items[0] ?? {};
  ok(["runId", "runtime", "mode", "state", "recordedAt", "goal", "agent"].every((k) => k in item0), "F4: item shape(runId·runtime·mode·state·recordedAt·goal·agent) ↔ 웹 소비 정합");
  const qA = await B.j("/api/runs?q=alpha", { headers: authB });
  ok(qA.code === 200 && qA.body.total === 1 && qA.body.items[0]?.goal?.includes("alpha"), "F4: q=alpha 부분일치(1건)");
  // ReDoS: q=(a+)+ 리터럴 취급(정규식 폭발 없음·즉시 응답)
  const t0 = Date.now();
  const redos = await B.j("/api/runs?q=" + encodeURIComponent("(a+)+"), { headers: authB });
  ok(redos.code === 200 && (Date.now() - t0) < 1500, `F4 거부: q=(a+)+ 리터럴(ReDoS 없음·${Date.now() - t0}ms)`);
  ok((await B.j("/api/runs?state=bogus", { headers: authB })).code === 400, "F4 거부: state=bogus(enum) → 400");
  ok((await B.j("/api/runs?sort=nope", { headers: authB })).code === 400, "F4 거부: sort=nope(enum) → 400");
  const clamp = await B.j("/api/runs?limit=99999", { headers: authB });
  ok(clamp.code === 200 && clamp.body.limit === 100, "F4: limit=99999 → clamp 100(400 아님)");
  const clamp0 = await B.j("/api/runs?limit=0", { headers: authB });
  ok(clamp0.code === 200 && clamp0.body.limit === 1, "F4: limit=0 → clamp 1");
  // 페이지네이션: limit=2 → hasMore true, offset 이동
  const pg = await B.j("/api/runs?limit=2", { headers: authB });
  ok(pg.code === 200 && pg.body.items.length === 2 && pg.body.hasMore === true && pg.body.total === 3, "F4: limit=2 페이지1(hasMore·total=3)");
  const pg2 = await B.j("/api/runs?limit=2&offset=2", { headers: authB });
  ok(pg2.code === 200 && pg2.body.items.length === 1 && pg2.body.hasMore === false, "F4: offset=2 페이지2(마지막·hasMore=false)");

  // ── F2 run-template → POST /api/runs U⊆D 배선 ──
  const tmplB = await B.j("/api/agents/fixture-worker/run-template", { headers: authB });
  ok(tmplB.code === 200 && JSON.stringify(tmplB.body.suggestedAllowedTools) === JSON.stringify(["Read", "Grep"]), "F2: 픽스처 run-template D=[Read,Grep]");
  const fp = tmplB.body.fingerprint;
  // U⊆D 위반(Bash ∉ D) → 400 unauthorized-tool + detail
  const uViol = await B.j("/api/runs", { method: "POST", headers: mutB, body: JSON.stringify({ runtime: "codex", mode: "audit", domain: "x", agent: "fixture-worker", allowedTools: ["Bash"], dryRun: true }) });
  ok(uViol.code === 400 && uViol.body?.error === "unauthorized-tool" && (uViol.body?.detail ?? []).includes("Bash"), "F2: D 밖 도구(Bash) POST → 400 unauthorized-tool(detail 노출)");
  // U⊆D 정상(Read ∈ D·지문 echo 일치) → 200 dry-run
  const uOk = await B.j("/api/runs", { method: "POST", headers: mutB, body: JSON.stringify({ runtime: "codex", mode: "audit", domain: "x", agent: "fixture-worker", agentFingerprint: fp, allowedTools: ["Read"], dryRun: true }) });
  ok(uOk.code === 200 && uOk.body?.dryRun === true, "F2: D 내 부분집합(Read)+지문 일치 POST → 200 dry-run");
  // stale 폼(지문 불일치) → 409
  const uStale = await B.j("/api/runs", { method: "POST", headers: mutB, body: JSON.stringify({ runtime: "codex", mode: "audit", domain: "x", agent: "fixture-worker", agentFingerprint: "deadbeef", allowedTools: ["Read"], dryRun: true }) });
  ok(uStale.code === 409 && uStale.body?.error === "agent-definition-changed", "F2: 지문 불일치(stale 폼) POST → 409 agent-definition-changed");

  // ── F3 project-root(프로비저닝·dryRun·경로탈출) ──
  const prDry = await B.j("/api/settings/project-root", { method: "POST", headers: mutB, body: JSON.stringify({ path: FROOT, dryRun: true }) });
  ok(prDry.code === 200 && prDry.body?.written === false && prDry.body?.requiresRestart === true && typeof prDry.body?.activeRunsWarning === "number", "F3: dryRun 프리뷰(written:false·requiresRestart·activeRunsWarning)");
  const prEsc = await B.j("/api/settings/project-root", { method: "POST", headers: mutB, body: JSON.stringify({ path: "/etc/passwd", dryRun: true }) });
  ok(prEsc.code === 400, "F3 거부: /etc/passwd(시스템경로) → 400");
  const prOut = await B.j("/api/settings/project-root", { method: "POST", headers: mutB, body: JSON.stringify({ path: "/tmp", dryRun: true }) });
  ok(prOut.code === 400, "F3 거부: 경계 밖(/tmp) → 400");

  // ── F7 gate-on: 편집기 낙관적 동시성·evalProposal fail-closed·저장·rollback ──
  const en = await B.j("/api/settings/definition-edit", { method: "POST", headers: mutB, body: JSON.stringify({ enabled: true }) });
  ok(en.code === 200 && en.body?.definitionEditEnabled === true, "F7: 게이트 켜기 → 200");
  const gd = await B.j("/api/agents/fixture-worker/definition", { headers: authB });
  ok(gd.code === 200 && gd.body?.editable === true, "F7: gate-on GET definition(editable:true)");
  const { content, baseHash, pathId } = gd.body;
  // evalProposal 존재 → 409 proposal-not-available(F8→F7 우회 차단·DW11)
  const prop = await B.j("/api/agents/fixture-worker/definition", { method: "PUT", headers: mutB, body: JSON.stringify({ content, baseHash, pathId, evalProposal: { nonce: "x", envelope: {} } }) });
  ok(prop.code === 409 && prop.body?.error === "proposal-not-available", "F7: evalProposal 동반 PUT → 409 proposal-not-available(fail-closed)");
  // pathId 불일치 → 409 path-id-mismatch
  const pim = await B.j("/api/agents/fixture-worker/definition", { method: "PUT", headers: mutB, body: JSON.stringify({ content, baseHash, pathId: "0".repeat(64) }) });
  ok(pim.code === 409 && pim.body?.error === "path-id-mismatch", "F7: pathId 불일치 PUT → 409 path-id-mismatch");
  // stale baseHash → 409 stale-write + currentHash
  const stale = await B.j("/api/agents/fixture-worker/definition", { method: "PUT", headers: mutB, body: JSON.stringify({ content, baseHash: "0".repeat(64), pathId }) });
  ok(stale.code === 409 && stale.body?.error === "stale-write" && typeof stale.body?.currentHash === "string", "F7: stale baseHash PUT → 409 stale-write(+currentHash)");
  // 정상 저장(픽스처 파일 쓰기·백업) → 200
  const edited = content + "\n<!-- e2e edit -->\n";
  const save = await B.j("/api/agents/fixture-worker/definition", { method: "PUT", headers: mutB, body: JSON.stringify({ content: edited, baseHash, pathId }) });
  ok(save.code === 200 && save.body?.ok === true && typeof save.body?.newHash === "string" && save.body?.codexDriftWarning === true, "F7: 정상 저장 → 200(newHash·codexDriftWarning)");
  // 되돌리기(rollback: expectedCurrentHash=newHash·backupHash=prevHash) → 200
  const rb = await B.j("/api/agents/fixture-worker/definition/rollback", { method: "POST", headers: mutB, body: JSON.stringify({ expectedCurrentHash: save.body.newHash, backupHash: save.body.prevHash }) });
  ok(rb.code === 200 && rb.body?.ok === true, "F7: rollback(직전 백업 복원) → 200");

  // ── F8 evals 읽기(trend·detail·config) — 픽스처 scorecard ──
  const idx = await B.j("/api/evals", { headers: authB });
  ok(idx.code === 200 && idx.body?.evalsAvailable === true && (idx.body?.loops ?? []).some((l) => l.loop === "loopA"), "F8: /api/evals 인덱스(evalsAvailable·loopA)");
  const loopA = idx.body.loops.find((l) => l.loop === "loopA");
  ok(loopA?.latest?.alignmentScore === 0.75 && loopA?.latest?.verified === true, "F8: loopA 최신 alignment=0.75·verified(재도출 일치)");
  const trend = await B.j("/api/evals/loopA", { headers: authB });
  ok(trend.code === 200 && trend.body?.found === true && trend.body?.series?.length === 1 && trend.body?.counts?.valid === 1 && trend.body?.trendSource === "scorecards-inprocess", "F8: /api/evals/loopA 추세(series·counts.valid·trendSource)");
  const detail = await B.j("/api/evals/loopA/stage1/run1", { headers: authB });
  ok(detail.code === 200 && detail.body?.status === "ok" && detail.body?.verified === true && detail.body?.scorecard, "F8: scorecard 상세 status=ok·verified");
  const proposal = await B.j("/api/evals/loopA/proposal", { headers: authB });
  ok(proposal.code === 200 && proposal.body?.autoApply === false && (proposal.body?.enabled === false || proposal.body?.disabledReason), "F8: 제안 autoApply:false·단계<3 비활성(자동적용 절대 없음)");
  // config 정상 저장(stage 1~3·floor 이상) → 200
  const cfgOk = await B.j("/api/evals/config", { method: "POST", headers: mutB, body: JSON.stringify({ adoptionStage: 2, thresholds: { minAdjudicatedClaims: 30, rollingN: 10, declineStreak: 3 } }) });
  ok(cfgOk.code === 200 && cfgOk.body?.config?.adoptionStage === 2, "F8: config 정상 저장(stage 2·floor 이상) → 200");

  // Part A/B 읽기 side-effect 0(재조회 후 config·runs 불변 — trend 는 GET 반복 동일)
  const trend2 = await B.j("/api/evals/loopA", { headers: authB });
  ok(trend2.body?.series?.length === 1 && trend2.body?.found === true, "F8: Part A GET 반복 side-effect 0(추세 불변)");

  // 인증 게이트 전 라우트 적용(B 비인증 GET → 401)
  ok((await B.j("/api/evals")).code === 401, "게이트(B): 비인증 /api/evals → 401");
  ok((await B.j("/api/metrics/overview")).code === 401, "게이트(B): 비인증 /api/metrics/overview → 401");
  // cross-origin mutating 거부(B)
  const xoB = await B.j("/api/evals/config", { method: "POST", headers: { ...authB, origin: "http://evil.com", "content-type": "application/json" }, body: JSON.stringify({ adoptionStage: 1 }) });
  ok(xoB.code === 403, "origin(B): cross-origin POST /api/evals/config → 403");

} finally {
  await appA.close();
  await appB.close();
  await rm(PH, { recursive: true, force: true }).catch(() => {});
}
console.log(`\ne2e: ${fail === 0 ? "ALL PASS" : fail + " FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
