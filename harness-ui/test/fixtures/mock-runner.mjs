// mock runner — 구조화 JSONL 을 stdout 으로만 방출(스키마 직접 방출 금지 — supervisor가 저자).
// supervisor.spawnRun 이 stdout→raw.jsonl 로 리다이렉트. 실 codex/claude --json 대체 테스트용.
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const now = () => new Date().toISOString();
emit({ ts: now(), level: "info", agent: "planner", phase: "Phase 1", event: "agent_started", message: "domain analysis", progress: 10 });
emit({ ts: now(), level: "info", agent: "planner", phase: "Phase 1", event: "agent_completed", message: "done", progress: 30 });
emit({ ts: now(), level: "info", agent: "builder", phase: "Phase 2", event: "agent_started", message: "build", progress: 60, usage: { inputTokens: 100, outputTokens: 50 } });
emit({ ts: now(), level: "info", agent: "builder", phase: "Phase 2", event: "agent_completed", message: "built", progress: 100, state: "completed" });
