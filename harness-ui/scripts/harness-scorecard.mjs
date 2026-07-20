// src/server/adapters/scorecard.ts
import { constants as constants2 } from "node:fs";
import { createHash } from "node:crypto";
import { open as open2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/server/adapters/harness.ts
import { constants } from "node:fs";
import { readdir, stat, open } from "node:fs/promises";
import { join } from "node:path";

// src/server/lib/paths.ts
var ARGV_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// src/server/adapters/harness.ts
var MAX_DEF_BYTES = 262144;
var MAX_AGENT_FILES = 500;
async function listFiles(dir, ext) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name).slice(0, MAX_AGENT_FILES);
  } catch {
    return [];
  }
}
async function readCappedDef(p) {
  let fh;
  try {
    fh = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size > MAX_DEF_BYTES) return null;
    const buf = Buffer.alloc(st.size);
    await fh.read(buf, 0, st.size, 0);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => {
    });
  }
}
async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).slice(0, MAX_AGENT_FILES);
  } catch {
    return [];
  }
}
function stripQuotes(s) {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' && t[t.length - 1] === '"' || t[0] === "'" && t[t.length - 1] === "'")) {
    return t.slice(1, -1);
  }
  return t;
}
function canonName(s) {
  return s.trim().replace(/^["']|["']$/g, "").split(/[\\/]/).pop().replace(/\.(md|toml)$/i, "").trim();
}
function parseFrontmatterList(textIn, key) {
  const text = textIn.replace(/^﻿/, "");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const region = fm ? fm[1] : text;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const arr = region.match(new RegExp(`^[ \\t]*${esc}[ \\t]*[:=][ \\t]*\\[([\\s\\S]*?)\\]`, "m"));
  if (arr) {
    const items = [...new Set(splitList(arr[1]).map((s) => canonName(s)).filter(Boolean))];
    return { present: true, items, syntax: items.length ? "array" : "empty" };
  }
  const kl = region.match(new RegExp(`^([ \\t]*)${esc}[ \\t]*[:=][ \\t]*(.*)$`, "m"));
  if (!kl) return { present: false, items: [], syntax: "missing" };
  const rest = kl[2].trim();
  if (rest === "") {
    const after = region.slice(kl.index + kl[0].length).split(/\r?\n/);
    const items = [];
    for (const line of after) {
      if (line.trim() === "") continue;
      const dm = line.match(/^\s*-\s*(.+)$/);
      if (dm) items.push(canonName(dm[1]));
      else break;
    }
    const uniq = [...new Set(items.filter(Boolean))];
    return uniq.length ? { present: true, items: uniq, syntax: "array" } : { present: true, items: [], syntax: "empty" };
  }
  return { present: true, items: [], syntax: "invalid_scalar" };
}
function parseFrontmatter(textIn) {
  const text = textIn.replace(/^\uFEFF/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let key = null;
  const buf = [];
  const flush = () => {
    if (key) out[key] = stripQuotes(buf.join(" ").trim());
    key = null;
    buf.length = 0;
  };
  for (const line of m[1].split(/\r?\n/)) {
    const isIndented = /^\s/.test(line);
    const kv = !isIndented ? line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/) : null;
    if (kv) {
      flush();
      key = kv[1];
      buf.push(kv[2]);
    } else if (key && isIndented && line.trim()) {
      buf.push(line.trim());
    }
  }
  flush();
  return out;
}
var MAX_TOOLS = 40;
var MAX_TOOL_LEN = 60;
var TARGET_ENUM = ["agents", "skills", "orchestrator"];
function splitList(raw) {
  return raw.replace(/[[\]"']/g, " ").split(/[,\s]+/);
}
function deriveTools(raw) {
  if (!raw) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const tok of splitList(raw)) {
    const t = tok.trim();
    if (!t || t.length > MAX_TOOL_LEN || !ARGV_TOKEN.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}
function deriveTargets(raw) {
  if (!raw) return [];
  const out = [];
  for (const tok of splitList(raw)) {
    const t = tok.trim();
    if (TARGET_ENUM.includes(t) && !out.includes(t)) out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}
function buildClaudeAgent(f, text) {
  const fm = parseFrontmatter(text);
  const sk = parseFrontmatterList(text, "skills");
  return {
    name: fm.name ?? f.replace(/\.md$/, ""),
    runtime: "claude",
    sourcePath: ".claude/agents/" + f,
    role: fm.description ?? "",
    skills: sk.items,
    skillsDeclared: sk.present,
    skillsSyntax: sk.syntax,
    tools: deriveTools(fm.tools),
    targets: deriveTargets(fm.targets),
    domainTemplate: fm.domainTemplate ?? "",
    permissionMode: fm.permissionMode ?? null
  };
}
function buildCodexAgent(f, text) {
  const nm = text.match(/^\s*name\s*=\s*["'](.+?)["']/m);
  const toolsM = text.match(/^\s*tools\s*=\s*(.+)$/m);
  const targetsM = text.match(/^\s*targets\s*=\s*(.+)$/m);
  const sk = parseFrontmatterList(text, "skills");
  return {
    name: nm?.[1] ?? f.replace(/\.toml$/, ""),
    runtime: "codex",
    sourcePath: ".codex/agents/" + f,
    role: "",
    skills: sk.items,
    skillsDeclared: sk.present,
    skillsSyntax: sk.syntax,
    tools: deriveTools(toolsM?.[1]),
    targets: deriveTargets(targetsM?.[1]),
    domainTemplate: "",
    permissionMode: null
  };
}
async function readAgents(root2) {
  const out = [];
  const cdir = join(root2, ".claude", "agents");
  for (const f of await listFiles(cdir, ".md")) {
    const text = await readCappedDef(join(cdir, f));
    if (text === null) continue;
    out.push(buildClaudeAgent(f, text));
  }
  const xdir = join(root2, ".codex", "agents");
  for (const f of await listFiles(xdir, ".toml")) {
    const text = await readCappedDef(join(xdir, f));
    if (text === null) continue;
    out.push(buildCodexAgent(f, text));
  }
  return out;
}
async function readSkills(root2) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const base of [".claude/skills", ".agents/skills"]) {
    const sdir = join(root2, base);
    for (const dir of await listDirs(sdir)) {
      const skillMd = join(sdir, dir, "SKILL.md");
      const text = await readCappedDef(skillMd);
      if (text === null) continue;
      const fm = parseFrontmatter(text);
      const canonical = fm.name ?? dir;
      const refs = await listFiles(join(sdir, dir, "references"), ".md");
      const rp = base + "/" + dir;
      const orch = parseFrontmatterList(text, "orchestrates");
      if (seen.has(canonical)) {
        const cur = out.find((s) => s.name === canonical);
        if (cur && !cur.runtimePaths.includes(rp)) {
          cur.runtimePaths.push(rp);
          cur.orchestratesByRuntimePath[rp] = { items: orch.items, declared: orch.present, syntax: orch.syntax };
          cur.referencesByRuntimePath[rp] = refs;
        }
        continue;
      }
      seen.add(canonical);
      out.push({
        name: canonical,
        runtimePaths: [rp],
        description: fm.description ?? "",
        references: refs,
        triggers: fm.description ?? "",
        orchestratesByRuntimePath: { [rp]: { items: orch.items, declared: orch.present, syntax: orch.syntax } },
        referencesByRuntimePath: { [rp]: refs }
      });
    }
  }
  return out;
}

// src/server/adapters/scorecard.ts
var OVERSIZE_LINES = 500;
function canonicalFindingId(f) {
  const segs = [f.type, f.runtime, f.subject_kind, f.subject];
  if (f.target != null && f.target !== "") segs.push(f.target);
  return segs.join(":");
}
function computeConfigHash(inputs) {
  const canon = [...inputs].sort((a, b) => a.path.localeCompare(b.path)).map((i) => `${i.path}\0${i.content}`).join("");
  return createHash("sha256").update(canon).digest("hex").slice(0, 32);
}
var MAX_WAIVERS = 2e3;
async function readWaivers(root2, now2) {
  const raw = await readCappedDef(join2(root2, "_workspace", "evals", "waivers.json"));
  if (raw === null) return /* @__PURE__ */ new Map();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return /* @__PURE__ */ new Map();
  }
  if (!Array.isArray(parsed)) return /* @__PURE__ */ new Map();
  const active = /* @__PURE__ */ new Map();
  for (const w of parsed.slice(0, MAX_WAIVERS)) {
    if (!w || typeof w !== "object") continue;
    const fid = w.finding_id;
    const exp = w.expires_at;
    const reason = w.reason;
    if (typeof fid !== "string" || !fid) continue;
    if (exp !== void 0) {
      if (typeof exp !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
      if (now2 && exp < now2) continue;
    }
    active.set(fid, { expires_at: typeof exp === "string" ? exp : void 0, reason: typeof reason === "string" ? reason : void 0 });
  }
  return active;
}
async function countLines(root2, runtimePath) {
  try {
    const fh = await open2(join2(root2, runtimePath, "SKILL.md"), constants2.O_RDONLY | (constants2.O_NOFOLLOW ?? 0));
    try {
      const st = await fh.stat();
      if (!st.isFile()) return 0;
      const buf = Buffer.alloc(Math.min(st.size, 262144));
      await fh.read(buf, 0, buf.length, 0);
      return buf.toString("utf8").split(/\r?\n/).length;
    } finally {
      await fh.close().catch(() => {
      });
    }
  } catch {
    return 0;
  }
}
var skillRuntime = (rp) => rp.startsWith(".agents") ? "codex" : "claude";
async function computeHarnessScorecard(root2, opts = {}) {
  const agents = await readAgents(root2);
  const skills = await readSkills(root2);
  const skillNames = new Set(skills.map((s) => s.name));
  const agentNames = new Set(agents.map((a) => a.name));
  const orchestratedAgents = /* @__PURE__ */ new Set();
  let hasOrchestrator = false;
  const findings = [];
  const push = (f) => findings.push({ ...f, id: canonicalFindingId(f), waived: false });
  const isOrchestratorName = (n, d) => /orchestrat|오케스트/i.test(n + " " + d);
  for (const s of skills) {
    const anyOrchDeclared = Object.values(s.orchestratesByRuntimePath).some((e) => e.declared || e.syntax === "invalid_scalar");
    if (isOrchestratorName(s.name, s.description) && !anyOrchDeclared)
      push({
        type: "link_unknown",
        subject: s.name,
        subject_kind: "skill",
        runtime: skillRuntime(s.runtimePaths[0]),
        severity: "info",
        provenance: "orchestrates",
        confidence: "measured",
        detail: "\uC624\uCF00\uC2A4\uD2B8\uB808\uC774\uD130 \uCD94\uC815\xB7orchestrates \uBBF8\uC120\uC5B8(\uB9C8\uC774\uADF8\uB808\uC774\uC158 \uBD80\uCC44)"
      });
    for (const [rp, ev] of Object.entries(s.orchestratesByRuntimePath)) {
      if (ev.syntax === "invalid_scalar") {
        push({
          type: "incomplete_def",
          subject: s.name,
          subject_kind: "skill",
          runtime: skillRuntime(rp),
          severity: "low",
          provenance: "orchestrates",
          confidence: "measured",
          detail: "orchestrates scalar \u2014 \uBC30\uC5F4\uC774\uC5B4\uC57C \uD568"
        });
        continue;
      }
      if (!ev.declared) continue;
      hasOrchestrator = true;
      for (const ag of ev.items) {
        orchestratedAgents.add(ag);
        if (!agentNames.has(ag))
          push({
            type: "dead_link",
            subject: s.name,
            subject_kind: "skill",
            target: ag,
            runtime: skillRuntime(rp),
            severity: "med",
            provenance: "orchestrates",
            confidence: "measured",
            detail: `\uC624\uCF00\uC2A4\uD2B8\uB808\uC774\uD130 \uBC30\uC815 \uB300\uC0C1 \uC5D0\uC774\uC804\uD2B8 '${ag}' \uD30C\uC77C \uBD80\uC7AC`
          });
      }
    }
  }
  for (const a of agents) {
    let primary;
    if (!a.skillsDeclared) {
      primary = "link_unknown";
      push({
        type: "link_unknown",
        subject: a.name,
        subject_kind: "agent",
        runtime: a.runtime,
        severity: "info",
        provenance: "declared_skills",
        confidence: "measured",
        detail: "skills: \uBBF8\uC120\uC5B8 \u2014 \uB9C8\uC774\uADF8\uB808\uC774\uC158 \uBD80\uCC44(\uAC10\uC810 \uC544\uB2D8)"
      });
    } else if (a.skillsSyntax === "invalid_scalar") {
      primary = "incomplete_def";
      push({
        type: "incomplete_def",
        subject: a.name,
        subject_kind: "agent",
        runtime: a.runtime,
        severity: "low",
        provenance: "declared_skills",
        confidence: "measured",
        detail: "skills scalar \u2014 \uBC30\uC5F4\uC774\uC5B4\uC57C \uD568"
      });
    } else if (a.skills.length === 0) {
      primary = "orphan";
      push({
        type: "orphan",
        subject: a.name,
        subject_kind: "agent",
        runtime: a.runtime,
        severity: "med",
        provenance: "declared_skills",
        confidence: "measured",
        detail: "skills:[] \uBA85\uC2DC \uBB34\uC5F0\uACB0"
      });
    } else {
      primary = "coverage_gap";
      for (const sk of a.skills) {
        if (!skillNames.has(sk))
          push({
            type: "dead_link",
            subject: a.name,
            subject_kind: "agent",
            target: sk,
            runtime: a.runtime,
            severity: "med",
            provenance: "declared_skills",
            confidence: "measured",
            detail: `\uC120\uC5B8 \uC2A4\uD0AC '${sk}' \uBD80\uC7AC`
          });
      }
    }
    if (primary === "coverage_gap" && hasOrchestrator && !orchestratedAgents.has(a.name))
      push({
        type: "coverage_gap",
        subject: a.name,
        subject_kind: "agent",
        runtime: a.runtime,
        severity: "low",
        provenance: "orchestrates",
        confidence: "measured",
        detail: "\uC624\uCF00\uC2A4\uD2B8\uB808\uC774\uD130 \uBBF8\uBC30\uC815"
      });
  }
  const declaredSkills = /* @__PURE__ */ new Set();
  const declaredByRuntime = /* @__PURE__ */ new Map();
  for (const a of agents) {
    if (!a.skillsDeclared) continue;
    for (const sk of a.skills) {
      declaredSkills.add(sk);
      if (!declaredByRuntime.has(sk)) declaredByRuntime.set(sk, /* @__PURE__ */ new Set());
      declaredByRuntime.get(sk).add(a.runtime);
    }
  }
  const refRuntimes = /* @__PURE__ */ new Map();
  for (const s of skills) {
    for (const [rp, refs] of Object.entries(s.referencesByRuntimePath)) {
      const rt = skillRuntime(rp);
      for (const rf of refs) {
        const base = rf.replace(/\.md$/i, "");
        if (skillNames.has(base) && base !== s.name) {
          if (!refRuntimes.has(base)) refRuntimes.set(base, /* @__PURE__ */ new Set());
          refRuntimes.get(base).add(rt);
        }
      }
    }
  }
  for (const s of skills) {
    const sRuntimes = new Set(s.runtimePaths.map(skillRuntime));
    if (!declaredSkills.has(s.name)) {
      const refBy = refRuntimes.get(s.name);
      const overlaps = refBy ? [...refBy].filter((r) => sRuntimes.has(r)) : [];
      if (overlaps.length)
        push({
          type: "link_unknown",
          subject: s.name,
          subject_kind: "skill",
          runtime: overlaps[0],
          severity: "info",
          provenance: "skill_refs",
          confidence: "measured",
          detail: "\uC5D0\uC774\uC804\uD2B8 \uBBF8\uC120\uC5B8\xB7\uD0C0 \uC2A4\uD0AC references \uCC38\uC870\uB9CC"
        });
      else
        push({
          type: "orphan",
          subject: s.name,
          subject_kind: "skill",
          runtime: [...sRuntimes][0] ?? "claude",
          severity: "med",
          provenance: "declared_skills",
          confidence: "measured",
          detail: "\uC5B4\uB5A4 \uC5D0\uC774\uC804\uD2B8\uB3C4 \uBBF8\uC120\uC5B8"
        });
    } else {
      const declRt = declaredByRuntime.get(s.name);
      if (![...declRt].some((r) => sRuntimes.has(r)))
        push({
          type: "unknown_scope",
          subject: s.name,
          subject_kind: "skill",
          runtime: [...sRuntimes][0],
          severity: "info",
          provenance: "declared_skills",
          confidence: "measured",
          detail: "\uC120\uC5B8 \uB7F0\uD0C0\uC784\uACFC \uC2A4\uD0AC \uB7F0\uD0C0\uC784 \uBD88\uC77C\uCE58"
        });
    }
    for (const rp of s.runtimePaths) {
      if (await countLines(root2, rp) > OVERSIZE_LINES)
        push({
          type: "oversize",
          subject: s.name,
          subject_kind: "skill",
          runtime: skillRuntime(rp),
          severity: "low",
          provenance: "skill_refs",
          confidence: "measured",
          detail: `SKILL.md > ${OVERSIZE_LINES}\uC904`
        });
    }
  }
  findings.sort((a, b) => a.id.localeCompare(b.id));
  const active = await readWaivers(root2, opts.now);
  for (const f of findings) {
    const w = active.get(f.id);
    if (w) {
      f.waived = true;
      f.waiver_expires_at = w.expires_at;
      f.waiver_reason = w.reason;
    }
  }
  const inputs = [];
  for (const a of agents) inputs.push({ path: a.sourcePath, content: await safeRead(root2, a.sourcePath) });
  for (const s of skills) for (const rp of s.runtimePaths) inputs.push({ path: rp + "/SKILL.md", content: await safeRead(root2, rp + "/SKILL.md") });
  const counts = tally(findings, agents.length, skills.length);
  const isFactory = await safeExists(join2(root2, "skills", "myharness"));
  const config_hash = computeConfigHash(inputs);
  return {
    schema_version: 1,
    config_hash,
    state_key: computeStateKey(config_hash, findings),
    generated_at: null,
    scope: { root: root2, runtime: isFactory ? "factory" : "built" },
    counts,
    findings,
    factory: isFactory ? { policyAuditApplicable: true } : null,
    built: { portable: true },
    loop_ref: null,
    diag: null,
    stale: false
  };
}
function computeStateKey(configHash, findings) {
  const ids = findings.filter((f) => !f.waived).map((f) => f.id).sort();
  return createHash("sha256").update(configHash + "|" + ids.join("\n")).digest("hex").slice(0, 32);
}
async function safeRead(root2, rel) {
  return await readCappedDef(join2(root2, rel)) ?? "";
}
async function safeExists(p) {
  try {
    const { stat: stat3 } = await import("node:fs/promises");
    await stat3(p);
    return true;
  } catch {
    return false;
  }
}
function tally(findings, agents, skills) {
  const base = {
    orphan: 0,
    link_unknown: 0,
    dead_link: 0,
    unknown_scope: 0,
    coverage_gap: 0,
    oversize: 0,
    incomplete_def: 0
  };
  for (const f of findings) if (!f.waived) base[f.type] += 1;
  return { ...base, agents, skills };
}

// src/server/adapters/scorecard-snapshot.ts
import { open as open3, mkdir, readFile, writeFile, rename, unlink, link, stat as stat2, readdir as readdir2 } from "node:fs/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { join as join3 } from "node:path";
var PENALIZED = ["orphan", "dead_link", "coverage_gap", "incomplete_def", "oversize"];
var DEBT = ["link_unknown", "unknown_scope"];
var MAX_ACTIVE_IDS = 500;
var LOCK_TTL_MS = 2 * 60 * 1e3;
var MAX_SUMMARY_BYTES = 1 << 20;
function deriveSummary(sc, nowIso) {
  const active = sc.findings.filter((f) => !f.waived);
  const penalized = active.filter((f) => PENALIZED.includes(f.type)).length;
  const debt = active.filter((f) => DEBT.includes(f.type)).length;
  const ids = active.map((f) => f.id).sort();
  const truncated = ids.length > MAX_ACTIVE_IDS;
  return {
    generated_at: nowIso,
    config_hash: sc.config_hash,
    state_key: sc.state_key,
    scope: sc.scope.runtime,
    counts: sc.counts,
    penalized,
    debt,
    active_ids: ids.slice(0, MAX_ACTIVE_IDS),
    truncated
  };
}
var HOST = hostname();
var RELEASE_MARGIN_MS = 10 * 1e3;
async function gcTemps(dir) {
  try {
    for (const f of await readdir2(dir)) {
      if (!(f.startsWith(".harness-scorecard.lock.tmp.") || f.startsWith(".harness-scorecard.lock.stale.") || f.startsWith("harness_scorecard.json.tmp."))) continue;
      const p = join3(dir, f);
      try {
        const st = await stat2(p);
        if (Date.now() - st.mtimeMs > LOCK_TTL_MS) await unlink(p).catch(() => {
        });
      } catch {
      }
    }
  } catch {
  }
}
async function tryLock(dir) {
  const lockPath = join3(dir, ".harness-scorecard.lock");
  const tmp = join3(dir, ".harness-scorecard.lock.tmp." + randomUUID());
  const fh = await open3(tmp, "w");
  try {
    await fh.writeFile(JSON.stringify({ pid: process.pid, host: HOST, startedAt: Date.now() }));
    await fh.sync();
  } finally {
    await fh.close();
  }
  const cleanupTmp = async () => {
    await unlink(tmp).catch(() => {
    });
  };
  const acquiredAt = Date.now();
  const release = async () => {
    if (Date.now() - acquiredAt < LOCK_TTL_MS - RELEASE_MARGIN_MS) {
      try {
        const [l, t] = await Promise.all([stat2(lockPath), stat2(tmp)]);
        if (l.ino === t.ino && l.dev === t.dev && Date.now() - acquiredAt < LOCK_TTL_MS - RELEASE_MARGIN_MS)
          await unlink(lockPath).catch(() => {
          });
      } catch {
      }
    }
    await cleanupTmp();
  };
  try {
    await link(tmp, lockPath);
    return release;
  } catch (e) {
    const code = e.code;
    if (code !== "EEXIST") {
      await cleanupTmp();
      throw e;
    }
    if (await isStale(lockPath)) {
      const aside = lockPath + ".stale." + randomUUID();
      try {
        await rename(lockPath, aside);
      } catch {
        await cleanupTmp();
        return null;
      }
      if (!await isStale(aside)) {
        let orphan = false;
        try {
          orphan = (await stat2(aside)).nlink === 1;
        } catch {
          orphan = true;
        }
        if (orphan) await unlink(aside).catch(() => {
        });
        else await rename(aside, lockPath).catch(() => {
        });
        await cleanupTmp();
        return null;
      }
      await unlink(aside).catch(() => {
      });
      try {
        await link(tmp, lockPath);
        return release;
      } catch {
        await cleanupTmp();
        return null;
      }
    }
    await cleanupTmp();
    return null;
  }
}
async function isStale(lockPath) {
  let st;
  try {
    st = await stat2(lockPath);
  } catch {
    return false;
  }
  return Date.now() - st.mtimeMs > LOCK_TTL_MS;
}
async function writeHarnessScorecardSnapshot(sc, root2, nowIso) {
  const dir = join3(root2, "_workspace", "evals");
  await mkdir(dir, { recursive: true });
  await gcTemps(dir);
  const release = await tryLock(dir);
  if (!release) return { written: false, state_key: sc.state_key, skipped: "contention" };
  try {
    const summaryPath = join3(dir, "harness_summary.jsonl");
    const jsonPath = join3(dir, "harness_scorecard.json");
    const lastKey = await lastSummaryStateKey(summaryPath);
    const jsonKey = await jsonStateKey(jsonPath);
    if (lastKey === sc.state_key && jsonKey === sc.state_key) return { written: false, state_key: sc.state_key, skipped: "unchanged" };
    if (lastKey !== sc.state_key) {
      await ensureTrailingNewline(summaryPath);
      await appendLineFsync(summaryPath, JSON.stringify(deriveSummary(sc, nowIso)));
    }
    const stamped = { ...sc, generated_at: nowIso };
    const jtmp = jsonPath + ".tmp." + randomUUID();
    await writeFile(jtmp, JSON.stringify(stamped, null, 2));
    await rename(jtmp, jsonPath);
    return { written: true, state_key: sc.state_key };
  } finally {
    await release();
  }
}
async function ensureTrailingNewline(path) {
  let st;
  try {
    st = await stat2(path);
  } catch {
    return;
  }
  if (st.size === 0) return;
  const fh = await open3(path, "r");
  try {
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, st.size - 1);
    if (buf[0] !== 10) {
      const a = await open3(path, "a");
      try {
        await a.appendFile("\n");
        await a.sync();
      } finally {
        await a.close();
      }
    }
  } finally {
    await fh.close();
  }
}
async function appendLineFsync(path, line) {
  const fh = await open3(path, "a");
  try {
    await fh.appendFile(line + "\n");
    await fh.sync();
  } finally {
    await fh.close();
  }
}
async function jsonStateKey(path) {
  try {
    return JSON.parse(await readFile(path, "utf8")).state_key ?? null;
  } catch {
    return null;
  }
}
async function readSummaryLines(path) {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  if (raw.length > MAX_SUMMARY_BYTES) raw = raw.slice(raw.length - MAX_SUMMARY_BYTES);
  const out = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try {
      const o = JSON.parse(ln);
      if (o && typeof o.state_key === "string") out.push(o);
    } catch {
    }
  }
  return out;
}
async function lastSummaryStateKey(path) {
  const lines = await readSummaryLines(path);
  return lines.length ? lines[lines.length - 1].state_key : null;
}

// src/server/adapters/scorecard-cli.ts
var args = process.argv.slice(2);
var snapshot = args.includes("--snapshot");
var root = args.find((a) => !a.startsWith("--")) || process.cwd();
var now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
computeHarnessScorecard(root, { now }).then(async (sc) => {
  if (snapshot) {
    const r = await writeHarnessScorecardSnapshot(sc, root, (/* @__PURE__ */ new Date()).toISOString());
    process.stdout.write(JSON.stringify(r) + "\n");
  } else {
    process.stdout.write(JSON.stringify(sc, null, 2) + "\n");
  }
}).catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exit(1);
});
