// drift 감지 (설계 §Drift, A4·A4b). Claude↔Codex 정합. sync-plan 은 무변경(계획만).
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DriftFinding } from "../schemas.js";

async function names(dir: string, ext: string): Promise<Set<string>> {
  try {
    const e = await readdir(dir, { withFileTypes: true });
    return new Set(e.filter((x) => x.isFile() && x.name.endsWith(ext)).map((x) => x.name.replace(new RegExp(`${ext}$`), "")));
  } catch { return new Set(); }
}
async function dirNames(dir: string): Promise<Set<string>> {
  try { const e = await readdir(dir, { withFileTypes: true }); return new Set(e.filter((x) => x.isDirectory()).map((x) => x.name)); }
  catch { return new Set(); }
}
async function exists(p: string): Promise<boolean> { try { await stat(p); return true; } catch { return false; } }

export async function detectDrift(root: string): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  const claudeAgents = await names(join(root, ".claude", "agents"), ".md");
  const codexAgents = await names(join(root, ".codex", "agents"), ".toml");
  for (const a of claudeAgents) if (!codexAgents.has(a)) out.push({ id: `agent:${a}`, severity: "missing-runtime-peer", runtime: "codex", paths: [`.claude/agents/${a}.md`], evidence: "Codex toml 없음", suggestedAction: `.codex/agents/${a}.toml 생성` });
  for (const a of codexAgents) if (!claudeAgents.has(a)) out.push({ id: `agent:${a}`, severity: "missing-runtime-peer", runtime: "claude", paths: [`.codex/agents/${a}.toml`], evidence: "Claude md 없음", suggestedAction: `.claude/agents/${a}.md 생성` });

  const cSkills = await dirNames(join(root, ".claude", "skills"));
  const aSkills = await dirNames(join(root, ".agents", "skills"));
  for (const s of cSkills) if (!aSkills.has(s)) out.push({ id: `skill:${s}`, severity: "missing-runtime-peer", runtime: "codex", paths: [`.claude/skills/${s}`], evidence: ".agents 스킬 없음", suggestedAction: `.agents/skills/${s} 동기화` });
  for (const s of aSkills) if (!cSkills.has(s)) out.push({ id: `skill:${s}`, severity: "missing-runtime-peer", runtime: "claude", paths: [`.agents/skills/${s}`], evidence: ".claude 스킬 없음", suggestedAction: `.claude/skills/${s} 동기화` });

  const hasClaude = await exists(join(root, "CLAUDE.md")), hasAgents = await exists(join(root, "AGENTS.md"));
  if (hasClaude !== hasAgents) out.push({ id: "entrypoint", severity: "content-mismatch", runtime: hasClaude ? "codex" : "claude", paths: ["CLAUDE.md", "AGENTS.md"], evidence: "한쪽 진입점만 존재", suggestedAction: "누락 진입점 생성" });
  return out;
}

// sync-plan: 파일 미변경, drift 를 계획 항목으로 렌더(무변경 보장).
export async function syncPlan(root: string) {
  const findings = await detectDrift(root);
  return {
    mutates: false,
    items: findings.map((f) => ({ file: f.paths[0] ?? "", operation: "create-or-sync", reason: f.evidence, previewDiff: null, manualSteps: [f.suggestedAction], risk: f.severity })),
  };
}
