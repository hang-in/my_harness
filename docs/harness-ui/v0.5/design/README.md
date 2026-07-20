# Harness UI v0.5 Design

## 목적

Harness UI v0.5는 하네스 팩토리의 구성, 빌드, 실행 상태를 브라우저에서 확인하는 로컬 관리 UI다.

목표:
- 하네스 구성 상태 표시
- Claude Code / Codex 런타임별 에이전트와 스킬 표시
- 하네스 빌드 입력값 선택
- 빌드 진행 상태 표시
- 에이전트 실행 이벤트 표시
- Claude Code / Codex / Gemini 계열 운영 상태 표시
- `/usage`, `/status`처럼 사용자가 자주 확인하는 상태 명령을 대시보드로 제공
- `_workspace` 기반 산출물, 리뷰, 오류 상태 표시
- Claude Code / Codex drift 감지

비목표:
- Claude Code 또는 Codex 내부 런타임 메모리를 직접 조회하지 않는다.
- 원격 SaaS 서비스로 만들지 않는다.
- 하네스 실행 프로토콜 없이 추정 기반으로 live 상태를 꾸미지 않는다.
- 대화형 CLI slash command를 TTY 없이 그대로 실행할 수 있다고 가정하지 않는다.

## 핵심 판단

Claude Code와 Codex 모두 내부 에이전트 live state를 완전한 공식 API로 노출한다고 가정하면 안 된다.

따라서 Harness UI는 런타임 내부를 직접 감시하지 않고, 하네스 오케스트레이터가 남기는 파일 기반 상태를 읽는다.

표준 상태 위치:

```text
_workspace/
  runs/
    {run_id}/
      manifest.json
      status.json
      events.jsonl
      agents/
        {agent_name}.json
      artifacts/
      reviews/
```

이 방식이면 Claude Code와 Codex 모두 같은 UI에서 다룰 수 있다.

상태 파일의 최종 저자는 LLM 에이전트가 아니라 UI 서버의 run supervisor다.
에이전트는 로그와 산출물을 남길 수 있지만, `status.json`의 최종 `state`, child process exit code, cancel, stale 판정은 서버가 기록한다.

## 현재 레포 기준 상태

확인된 상태:
- `CLAUDE.md` 존재
- `AGENTS.md` 존재
- `.claude/agents/` 존재
- `.claude/skills/` 존재
- `.agents/skills/` 존재
- `_workspace/` 존재
- `.codex/agents/` 없음
- `harness-ui/` 없음
- 루트 `package.json` 없음

의미:
- Claude Code 쪽 하네스 인벤토리 표시는 바로 설계 가능하다.
- Codex 에이전트 상태 표시는 `.codex/agents/*.toml` 생성/동기화가 선행되어야 한다.
- 실행 UI는 새 `harness-ui/` 앱을 추가해야 한다.

## 대상 사용자

- 하네스 팩토리 운영자
- Claude Code / Codex 듀얼 런타임을 관리하는 개발자
- 에이전트 팀 구조, 스킬 연결, 실행 결과를 검증해야 하는 사용자

## 정보 구조

1. Overview
   - 런타임 설치 상태
   - 하네스 구성 완성도
   - Claude/Codex drift 요약
   - 최근 run 상태

2. Build
   - 도메인 입력
   - 실행 모드 선택
   - 런타임 선택
   - 권한 모드 선택
   - 모델 선택
   - 리소스 제한 설정
   - 생성 대상 선택

3. Agents
   - 에이전트 목록
   - 역할
   - 연결 스킬
   - 런타임별 정의 파일
   - 최근 실행 상태

4. Skills
   - 스킬 목록
   - description
   - 트리거 조건
   - references
   - Claude/Codex 설치 경로

5. Runs
   - 실행 목록
   - 진행률
   - 단계별 이벤트
   - 에이전트별 상태
   - 산출물 링크
   - 오류와 재시도 기록

6. Drift
   - `CLAUDE.md` vs `AGENTS.md`
   - `.claude/agents/*.md` vs `.codex/agents/*.toml`
   - `.claude/skills/*` vs `.agents/skills/*`
   - 누락, 변경, stale 상태

7. Ops
   - Claude Code 운영 상태
   - Codex 운영 상태
   - Gemini/agy 운영 상태
   - 사용량/쿼터/인증 상태
   - 모델과 CLI 버전
   - 최근 헬스체크 결과
   - 상태 명령 실행 이력

8. Settings
   - 프로젝트 루트
   - 런타임 CLI 경로
   - 기본 모델
   - 기본 sandbox 정책
   - 상태 저장 경로

## 런타임 모델

### Claude Code

읽는 파일:

```text
CLAUDE.md
.claude/agents/*.md
.claude/skills/*/SKILL.md
_workspace/runs/**
```

표시 가능:
- 에이전트 정의
- 스킬 정의
- 오케스트레이터 지침
- 파일 기반 실행 상태
- 리뷰 산출물

제약:
- Claude Code 내부의 live agent spawn 상태는 직접 조회 대상이 아니다.
- 오케스트레이터가 `_workspace/runs`에 상태를 기록해야 UI에서 정확히 표시된다.

### Codex

읽는 파일:

```text
AGENTS.md
.codex/agents/*.toml
.agents/skills/*/SKILL.md
_workspace/runs/**
```

표시 가능:
- Codex 에이전트 정의
- Codex 스킬 정의
- `codex exec --json` 기반 실행 이벤트
- 파일 기반 실행 상태

제약:
- 현재 레포에는 `.codex/agents/`가 없다.
- Claude 에이전트 정의를 Codex toml로 변환하는 동기화 기능이 필요하다.

## 상태 스키마

### `manifest.json`

```json
{
  "runId": "2026-07-07T10-00-00-myharness-a8f31c",
  "projectRoot": "/Users/junghojang/Developments/myProject/myHarness",
  "runtime": "codex",
  "mode": "build",
  "createdAt": "2026-07-07T10:00:00+09:00",
  "requestedBy": "local-user",
  "goal": "Build harness for project",
  "agents": ["planner", "builder", "reviewer"]
}
```

### `status.json`

```json
{
  "runId": "2026-07-07T10-00-00-myharness-a8f31c",
  "state": "running",
  "phase": "Phase 5",
  "progress": 62,
  "updatedAt": "2026-07-07T10:12:30+09:00",
  "heartbeatAt": "2026-07-07T10:12:30+09:00",
  "serverPid": 12345,
  "serverStartTime": "2026-07-07T10:00:00+09:00",
  "childPid": 12388,
  "childStartTime": "2026-07-07T10:00:02+09:00",
  "childProcessGroupId": 12388,
  "exitCode": null,
  "summary": "Generating orchestration adapter",
  "error": null
}
```

`state` 값:
- `queued`
- `running`
- `blocked`
- `failed`
- `completed`
- `cancelled`
- `stale`

Run supervisor 규칙:
- 서버가 child process를 spawn하고 `childPid`를 기록한다.
- 서버가 process exit을 감시하고 exit code 기준으로 `completed` 또는 `failed`를 기록한다.
- cancel 요청은 `childPid`의 process tree에 `SIGTERM`을 보내고, 제한 시간 후 `SIGKILL`을 보낸다.
- 서버 재시작 시 `_workspace/runs/*/status.json`을 스캔해 `running` 상태를 reconcile한다.
- reconcile 판단은 `heartbeatAt` staleness를 1차 기준으로 한다.
- `serverPid`가 살아 있어도 `serverStartTime`이 기록과 다르면 PID reuse로 보고 기존 서버는 죽은 것으로 간주한다.
- `serverPid`와 `serverStartTime`이 모두 일치하고 heartbeat가 stale이 아니면 아직 live owner가 있는 run으로 보고 reconcile하지 않는다.
- heartbeat가 stale이면 `childProcessGroupId` 생존 여부를 확인한다.
- stale reconcile은 `childPid` 하나가 아니라 `childProcessGroupId` 기준으로 process group 생존 여부를 확인한다.
- `kill(-childProcessGroupId, 0)` 또는 OS별 동등 검사로 그룹 내 생존 프로세스를 확인한다.
- leader가 살아 있으면 leader PID start time과 process group id를 대조한다. 둘 중 하나라도 기록과 다르면 PID reuse로 간주하고 kill하지 않는다.
- leader가 죽었지만 `kill(-childProcessGroupId, 0)`가 성공하면 leaderless group이 아직 살아 있는 상태다.
- leaderless group은 live member의 `environ`에서 `HARNESS_RUN_ID`가 현재 run과 일치할 때만 기존 run의 잔여 group으로 간주한다.
- `HARNESS_RUN_ID`를 읽을 수 없거나 일치하는 member가 없으면 kill하지 않고 `stale` 또는 `failed`로만 표시한다.
- 일치가 확인된 경우에만 `-childProcessGroupId`에 `SIGTERM`을 보내고, 제한 시간 후 `SIGKILL`을 보낸 뒤 `stale` 또는 `failed`로 표시한다.
- group이 비어 있으면 kill하지 않고 `stale` 또는 `failed`로만 표시한다.
- LLM이 직접 `completed`를 선언해도 child process exit 확인 전에는 최종 상태로 보지 않는다.

### `events.jsonl`

한 줄에 이벤트 하나를 기록한다.

```json
{"seq":1,"ts":"2026-07-07T10:01:00+09:00","level":"info","agent":"planner","phase":"Phase 1","event":"started","message":"Domain analysis started"}
{"seq":2,"ts":"2026-07-07T10:03:00+09:00","level":"info","agent":"planner","phase":"Phase 1","event":"completed","message":"Domain analysis completed"}
```

쓰기 규칙:
- `seq`는 run별 단조 증가 정수다.
- 동시 append 경합을 피하기 위해 이벤트 append는 서버 단일 writer를 통한다.
- 에이전트별 raw log는 별도 파일에 쓰고, 서버가 읽어 정규화 이벤트만 append한다.
- `status.json`, `manifest.json`, `agents/*.json`은 temp file 작성 후 rename으로 원자 교체한다.
- `events.jsonl`은 append-only 파일이므로 stream append 모드로 한 줄씩 추가한다. 이벤트 추가 때 전체 파일을 재작성하지 않는다.
- `events.jsonl`은 무한 증가할 수 있으므로 API는 cursor와 limit을 강제한다.

### `agents/{agent_name}.json`

```json
{
  "name": "planner",
  "runtime": "codex",
  "state": "running",
  "phase": "Phase 2",
  "task": "Design team architecture",
  "startedAt": "2026-07-07T10:01:00+09:00",
  "updatedAt": "2026-07-07T10:05:00+09:00",
  "inputFiles": ["_workspace/runs/run-1/manifest.json"],
  "outputFiles": ["_workspace/runs/run-1/artifacts/team-design.md"],
  "error": null
}
```

## 앱 구조

권장 경로:

```text
harness-ui/
  package.json
  src/
    web/
      main.tsx
      App.tsx
      routes/
      components/
      styles/
    server/
      index.ts
      api/
      adapters/
        claude.ts
        codex.ts
        workspace.ts
        drift.ts
      schemas/
```

권장 기술:
- React
- Vite
- TypeScript
- Fastify
- Zod
- chokidar

선택 기술:
- `@tanstack/react-query`
- `lucide-react`
- `xterm` 또는 단순 log viewer

## API 설계

### Runtime

```text
GET /api/runtimes
```

반환:

```json
{
  "claude": {
    "installed": true,
    "version": "2.1.201",
    "path": "/Users/junghojang/.local/bin/claude"
  },
  "codex": {
    "installed": true,
    "version": "0.142.5",
    "path": "/Users/junghojang/.nvm/versions/node/v22.11.0/bin/codex"
  }
}
```

### Ops

```text
GET /api/ops/status
GET /api/ops/commands
POST /api/ops/commands/:commandId/run
GET /api/ops/snapshots
GET /api/ops/snapshots/:snapshotId
```

`/api/ops/status`는 각 런타임의 현재 운영 상태를 정규화해서 반환한다.

```json
{
  "updatedAt": "2026-07-07T10:30:00+09:00",
  "runtimes": {
    "claude": {
      "installed": true,
      "authenticated": "unknown",
      "version": "2.1.201",
      "health": "ok",
      "usage": {
        "available": false,
        "reason": "interactive slash command not available from non-TTY"
      }
    },
    "codex": {
      "installed": true,
      "authenticated": "unknown",
      "version": "0.142.5",
      "health": "ok",
      "usage": {
        "available": false,
        "reason": "no stable non-interactive usage command configured"
      }
    },
    "agy": {
      "installed": true,
      "authenticated": "unknown",
      "version": "unknown",
      "health": "ok",
      "usage": {
        "available": false,
        "reason": "usage probe not configured"
      }
    }
  }
}
```

`/api/ops/commands`는 UI가 제공할 수 있는 상태 명령 목록을 반환한다.

```json
{
  "commands": [
    {
      "id": "claude-version",
      "runtime": "claude",
      "label": "Claude Version",
      "kind": "safe-read",
      "command": "claude --version",
      "interactive": false,
      "enabled": true
    },
    {
      "id": "claude-status",
      "runtime": "claude",
      "label": "Claude /status",
      "kind": "interactive-reference",
      "command": "/status",
      "interactive": true,
      "enabled": false,
      "reason": "Slash command requires active Claude Code session"
    },
    {
      "id": "claude-usage",
      "runtime": "claude",
      "label": "Claude /usage",
      "kind": "interactive-reference",
      "command": "/usage",
      "interactive": true,
      "enabled": false,
      "reason": "Slash command requires active Claude Code session"
    },
    {
      "id": "codex-version",
      "runtime": "codex",
      "label": "Codex Version",
      "kind": "safe-read",
      "command": "codex --version",
      "interactive": false,
      "enabled": true
    },
    {
      "id": "agy-health",
      "runtime": "agy",
      "label": "Gemini/agy Health",
      "kind": "safe-read",
      "command": "agy --version",
      "interactive": false,
      "enabled": true
    }
  ]
}
```

원칙:
- 비대화형으로 안정 실행 가능한 명령만 서버가 직접 실행한다.
- 서버는 hardcoded `OpsCommand` registry의 `command`와 `args`만 실행한다.
- `POST /api/ops/commands/:commandId/run`은 client-provided command, args, env, cwd를 받지 않는다.
- 클라이언트가 보낼 수 있는 값은 `commandId`와 선택적 `snapshotId`뿐이다.
- Claude Code의 `/usage`, `/status`처럼 active TTY session 안에서 동작하는 slash command는 직접 실행 버튼이 아니라 참조 카드로 표시한다.
- 해당 명령의 결과를 가져오려면 사용자가 CLI에서 내보낸 snapshot 파일을 읽는 방식을 제공한다.
- CLI별 출력 형식은 정규화해 저장하고, raw output은 `_workspace/ops/snapshots`에 보존한다.

상태 snapshot 위치:

```text
_workspace/
  ops/
    snapshots/
      {snapshot_id}/
        manifest.json
        claude-status.txt
        claude-usage.txt
        codex-status.txt
        codex-usage.txt
        agy-status.txt
        normalized.json
```

### Harness

```text
GET /api/harness
```

반환:

```json
{
  "projectRoot": "/Users/junghojang/Developments/myProject/myHarness",
  "claude": {
    "entrypoint": "CLAUDE.md",
    "agents": 4,
    "skills": 6
  },
  "codex": {
    "entrypoint": "AGENTS.md",
    "agents": 0,
    "skills": 1
  },
  "workspace": {
    "exists": true,
    "runs": 0
  }
}
```

### Agents

```text
GET /api/agents
GET /api/agents/:name
```

필드:
- `name`
- `runtime`
- `sourcePath`
- `role`
- `tools`
- `skills`
- `status`
- `drift`

### Skills

```text
GET /api/skills
GET /api/skills/:name
```

필드:
- `name`
- `runtimePaths`
- `description`
- `references`
- `linkedAgents`
- `drift`

### Runs

```text
GET /api/runs
GET /api/runs/:runId
GET /api/runs/:runId/events?after=:seq&limit=:limit
GET /api/runs/:runId/stream
GET /api/runs/:runId/agents
GET /api/runs/:runId/artifacts
GET /api/runs/:runId/artifacts/:artifactPath
POST /api/runs
POST /api/runs/:runId/cancel
```

`POST /api/runs` request body:

```json
{
  "runtime": "codex",
  "mode": "build",
  "domain": "local harness build UI",
  "permissionMode": "read-only",
  "model": "default",
  "targets": ["agents", "skills", "orchestrator"],
  "dryRun": true
}
```

검증:
- Zod로 request body를 검증한다.
- `runtime`은 `claude | codex`만 허용한다.
- `permissionMode`는 allowlist만 허용한다.
- `domain`은 최대 길이를 제한한다.
- `targets`는 allowlist만 허용한다.
- `runId`, `agent`, `skill`은 `^[A-Za-z0-9._-]+$`만 허용하고 `.`/`..`는 거부한다.
- nested artifact route는 wildcard path를 `/`로 split하고 각 segment에 `^[A-Za-z0-9._-]+$`를 적용한다.
- 모든 파일 read는 `realpath` 후 `projectRoot` 또는 `_workspace` 허용 루트 하위인지 검사한다.

Stream 인증:
- 브라우저 `EventSource`는 custom header를 보낼 수 없으므로 v0.5 기본 live update는 cursor polling이다.
- SSE가 필요하면 `EventSource` 대신 `fetch` streaming으로 구현해 `Authorization` header를 유지한다.
- query string token으로 stream을 인증하지 않는다.

### Drift

```text
GET /api/drift
POST /api/drift/sync-plan
```

`sync-plan`은 파일을 즉시 수정하지 않고 변경 계획만 반환한다.

## 빌드 실행 흐름

1. UI에서 도메인과 옵션 입력
2. 서버가 `_workspace/runs/{run_id}` 생성
3. `manifest.json` 기록
4. `status.json`을 `queued`로 기록
5. run supervisor가 런타임 child process를 argv array로 실행
6. supervisor가 `childPid`, heartbeat, exit code를 기록
7. 각 단계 산출물과 raw log를 supervisor가 정규화해 `events.jsonl`과 agent state에 반영
8. UI는 cursor polling 또는 SSE로 변경 사항 표시
9. child process 종료 시 supervisor가 `status.json`을 `completed` 또는 `failed`로 변경

동시성 규칙:
- 한 run의 `status.json` 최종 writer는 supervisor 하나다.
- 한 run의 `events.jsonl` 최종 writer도 supervisor 하나다.
- 병렬 에이전트는 자기 raw log와 artifact만 쓴다.
- supervisor가 raw log를 tail/parse해 UI 이벤트로 승격한다.

## 운영 상태 대시보드

Ops 화면은 사용자가 Claude Code, Codex, Gemini/agy를 운영하면서 자주 확인하는 상태를 한 화면에 모은다.

### 표시 항목

공통:
- 설치 여부
- CLI 경로
- CLI 버전
- 인증 상태
- 기본 모델
- 최근 실행 성공/실패
- 최근 오류
- 마지막 헬스체크 시각
- usage/status snapshot 존재 여부

인증 상태는 v0.5에서 authoritative 판정으로 보지 않는다.
표시 값은 `unknown`, `credential-file-present`, `smoke-test-ok`, `smoke-test-failed` 중 하나다.
비용이 들거나 모델 호출이 필요한 인증 확인은 사용자가 명시 실행한 smoke test에서만 수행한다.

Claude Code:
- `claude --version`
- `command -v claude`
- `/status` 참조 카드
- `/usage` 참조 카드
- active session에서 export한 usage/status snapshot

Codex:
- `codex --version`
- `command -v codex`
- `codex exec` smoke test 결과
- `--json` 실행 가능 여부
- usage/status에 대응하는 CLI 기능이 확인되면 command registry에 추가

Gemini/agy:
- `agy --version`
- `command -v agy`
- smoke test 가능 여부
- configured model
- `--add-dir`, `--sandbox`, `--print-timeout` 지원 여부

### 명령 레지스트리

상태 명령은 코드에 흩뿌리지 않고 registry로 관리한다.

```ts
type OpsCommand = {
  id: string;
  runtime: "claude" | "codex" | "agy" | "gemini";
  label: string;
  command: string;
  args?: string[];
  kind: "safe-read" | "smoke-test" | "interactive-reference" | "snapshot-import";
  interactive: boolean;
  enabled: boolean;
  timeoutMs: number;
  parser?: string;
};
```

`OpsCommand`는 서버 코드에만 존재한다.
API request body의 `args`, `command`, `env`, `cwd` 필드는 모두 거부한다.

직접 실행 허용:
- `command -v <tool>`
- `<tool> --version`
- 제한된 smoke test
- read-only 설정 확인

직접 실행 금지:
- active session 안의 slash command
- 권한 상승 프롬프트를 띄우는 명령
- 장시간 모델 호출
- 비용이 발생할 수 있는 명령
- 프로젝트 파일을 수정할 수 있는 명령

### Snapshot Import

대화형 상태 명령은 UI가 직접 실행하지 않고 사용자가 결과를 파일로 남기게 한다.

예:

```text
_workspace/ops/snapshots/manual-2026-07-07/
  claude-status.txt
  claude-usage.txt
```

UI는 raw text를 보존하고 가능한 필드만 정규화한다.

정규화 필드:
- `account`
- `plan`
- `model`
- `session`
- `quota`
- `resetAt`
- `warnings`
- `rawAvailable`

파싱 실패 시:
- raw text 링크 제공
- `normalized.status = "unparsed"`로 표시
- 실행 실패로 간주하지 않음

### 보안 원칙

- Ops API는 allowlist command만 실행한다.
- shell string을 직접 조합하지 않고 command + args 배열로 실행한다.
- 기본 timeout은 5초다.
- stdout/stderr는 최대 크기를 제한한다.
- raw output에는 token, email, org id가 포함될 수 있으므로 UI에서 기본 collapsed 처리한다.
- snapshot 파일은 gitignore 대상이어야 한다.

## Codex 실행 전략

독립 실행이 필요한 작업:

```text
codex exec --json --ignore-user-config --sandbox read-only -o _workspace/runs/{run_id}/agents/{agent}.out.md "<prompt>" < /dev/null
```

쓰기 작업이 필요한 경우:

```text
codex exec --json --ignore-user-config --sandbox workspace-write -o _workspace/runs/{run_id}/agents/{agent}.out.md "<prompt>" < /dev/null
```

UI 서버는 stdout 전체를 브라우저로 직접 흘리지 않는다.
필요한 이벤트만 `events.jsonl`로 정규화한다.

위 shell 예시는 사람이 읽는 형태다. 실제 서버 구현은 shell string을 만들지 않는다.

서버 실행 계약:

```ts
const safePrompt = `Task:\n${prompt}`;

execFile("codex", [
  "exec",
  "--json",
  ...(model === "default" ? [] : ["-m", model]),
  "--ignore-user-config",
  "--sandbox",
  sandboxMode,
  "-o",
  outputPath,
  "--",
  safePrompt
], {
  cwd: projectRoot,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
  env: {
    ...process.env,
    HARNESS_RUN_ID: runId,
    HARNESS_RUN_DIR: runDir
  }
});
```

`prompt`, `safePrompt`, `run_id`, `agent`, `outputPath`를 shell 문자열에 보간하지 않는다.
`outputPath`는 검증된 `runId`와 `agent`에서 서버가 생성한다.
Codex positional prompt 앞에는 `--`를 넣어 dash로 시작하는 입력이 옵션으로 해석되지 않게 한다.
사용자 입력은 `Task:\n` prefix를 붙인 `safePrompt`로만 전달해 단일 단어 CLI command와 충돌하지 않게 한다.
spawn된 child는 새 process group leader로 분리하고, `subprocess.pid`를 `childProcessGroupId`로 기록한다.
Codex 오케스트레이터에도 `HARNESS_RUN_ID`와 `HARNESS_RUN_DIR`를 환경 변수로 주입해 상태 기록 위치를 고정한다.

## Claude Code 실행 전략

Claude Code는 하네스 오케스트레이터가 Agent/SendMessage 방식으로 팀을 구성한다.

UI는 Claude Code 내부 메시지를 직접 읽지 않는다.
오케스트레이터 스킬이 단계별 상태를 `_workspace/runs/{run_id}`에 기록한다.

서버에서 Claude run을 시작할 때도 shell string을 만들지 않는다.

```ts
const safePrompt = `Task:\n${prompt}`;

execFile("claude", [
  "-p",
  ...(model === "default" ? [] : ["--model", model]),
  "--permission-mode",
  permissionMode,
  "--allowedTools",
  allowedTools,
  "--",
  safePrompt
], {
  cwd: projectRoot,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
  env: {
    ...process.env,
    HARNESS_RUN_ID: runId,
    HARNESS_RUN_DIR: runDir
  }
});
```

Claude 오케스트레이터 프롬프트에는 `HARNESS_RUN_ID`와 `HARNESS_RUN_DIR`를 명시해 상태 기록 위치를 고정한다.
Claude CLI 계약: `claude --help` 기준 `-p`/`--print`는 non-interactive output을 켜는 boolean flag이며 prompt 값을 소비하지 않는다.
따라서 `-p`는 유지하고, 모든 옵션 뒤에 `--`, 그 뒤에 positional `safePrompt`를 둔다.
Claude positional prompt 앞에도 `--`를 넣어 dash로 시작하는 입력이 옵션으로 해석되지 않게 한다.
사용자 입력은 `Task:\n` prefix를 붙인 `safePrompt`로만 전달해 `login`, `logout`, `update`, `mcp` 같은 command 이름과 충돌하지 않게 한다.
spawn된 Claude child도 새 process group leader로 분리하고, `subprocess.pid`를 `childProcessGroupId`로 기록한다.

필요한 보강:
- 오케스트레이터 템플릿에 상태 기록 규약 추가
- 에이전트 작업 시작/완료 시 agent state 갱신
- 오류 발생 시 `status.json.error`와 `events.jsonl` 동시 기록

## Drift 감지 규칙

검사 항목:
- `CLAUDE.md`와 `AGENTS.md` 변경 이력 불일치
- `.claude/agents/{name}.md`만 있고 `.codex/agents/{name}.toml` 없음
- `.codex/agents/{name}.toml`만 있고 `.claude/agents/{name}.md` 없음
- `.claude/skills/{name}/SKILL.md`만 있고 `.agents/skills/{name}/SKILL.md` 없음
- 두 런타임 스킬 description 불일치
- 참조 파일 누락

드리프트 상태:
- `ok`
- `missing-runtime-peer`
- `content-mismatch`
- `stale`
- `unsupported`

## UI 디자인 원칙

- 첫 화면은 대시보드다. 랜딩 페이지를 만들지 않는다.
- 카드 남용 금지. 반복 항목과 상태 패널에만 카드 사용.
- 작업 도구 버튼은 icon button 중심으로 구성한다.
- 상태는 색상만으로 표현하지 않고 label도 함께 표시한다.
- 긴 로그는 접힌 영역과 필터를 제공한다.
- 데스크톱 우선, 모바일은 읽기 전용에 가깝게 단순화한다.

주요 화면:
- 좌측 사이드바: Overview, Build, Agents, Skills, Runs, Drift, Ops, Settings
- 상단 바: 프로젝트 루트, 런타임 상태, refresh
- 본문: 선택 화면별 데이터 테이블과 상세 패널

## 보안 경계

기본 원칙:
- 로컬 바인딩만 허용한다.
- 기본 host는 `127.0.0.1`이다.
- 서버 시작 시 random session token을 생성한다.
- token을 정적 HTML에 주입하지 않는다.
- 서버는 터미널 stdout에 1회용 접속 URL `http://127.0.0.1:{port}/?token=...`을 출력한다.
- UI는 최초 접속 시 query token을 session storage에 저장하고 URL에서 즉시 제거한다.
- HTML entrypoint는 `Referrer-Policy: no-referrer`를 설정한다.
- 외부 subresource를 로드하지 않는다. 필요한 asset은 로컬 번들에 포함한다.
- 모든 API는 read/write 여부와 무관하게 session token을 요구한다.
- 모든 API는 read/write 여부와 무관하게 `Host`를 검증한다.
- 모든 state-mutating API는 추가로 `Origin`을 검증한다.
- session token은 `Authorization: Bearer <token>` 또는 `X-Harness-Token`으로만 전달한다.
- CORS는 기본 비활성화하고, 허용 origin은 현재 UI origin 하나만 둔다.
- DNS rebinding 방지를 위해 `Host`는 `127.0.0.1:{port}` 또는 `localhost:{port}` allowlist만 허용한다.
- 프로젝트 루트 밖 파일 읽기는 차단한다.
- route param과 path segment를 allowlist 검증한다.
- shell을 통하지 않고 `execFile`/argv array만 사용한다.
- stdout/stderr와 raw log 응답 크기를 제한한다.
- 파일 수정 API는 v0.5에서 기본 비활성화한다.
- 실행 API는 명시 승인 옵션이 켜진 경우만 활성화한다.

Dev/prod serving:
- production은 Fastify 하나가 built UI와 `/api/*`를 같은 origin에서 제공한다.
- development은 Vite dev server가 `/api`를 Fastify로 proxy한다.
- 브라우저 기준 origin은 Vite origin 하나로 유지한다.
- Fastify는 proxy origin을 명시 allowlist하고, 임의 origin CORS는 열지 않는다.

공통 path 검증:

```ts
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
```

규칙:
- 빈 segment 거부
- `.` 거부
- `..` 거부
- URL-decoding 후 재검증
- `realpath`가 허용 루트 밖이면 거부

Artifact 보존:
- `_workspace/runs`는 작업 중 상태 저장소다.
- 장기 보존이 필요한 감사 결과와 최종 설계 산출물은 `docs/`로 승격한다.
- `_workspace/ops/snapshots`와 `_workspace/runs`는 민감 정보 포함 가능성이 있어 gitignore 대상으로 둔다.
- UI는 `_workspace` 산출물이 임시/로컬 상태임을 표시한다.

Artifact와 snapshot 반환:
- agent 산출물, raw log, snapshot은 모두 untrusted content로 취급한다.
- 브라우저가 실행 가능한 HTML/SVG/JS로 해석하지 못하게 기본 `Content-Type`은 `text/plain; charset=utf-8` 또는 `application/octet-stream`이다.
- `X-Content-Type-Options: nosniff`를 항상 설정한다.
- inline preview는 escape된 text viewer에서만 표시한다.
- 원본 다운로드는 `Content-Disposition: attachment`를 사용한다.
- HTML preview iframe을 제공하지 않는다. 향후 필요하면 별도 opaque origin sandbox를 둔다.

위험 작업:
- `POST /api/runs`
- `POST /api/runs/:runId/cancel`
- `POST /api/ops/commands/:commandId/run`
- 향후 `POST /api/drift/apply`

위험 작업은 UI에서 실행 전 dry-run 내용을 표시한다.

## 실행 방식

구현 후 실행:

```bash
cd /Users/junghojang/Developments/myProject/myHarness/harness-ui
npm install
npm run dev
```

기본 URL:

```text
http://127.0.0.1:5173
```

권장 `package.json` scripts:

```json
{
  "scripts": {
    "dev": "concurrently \"npm:dev:web\" \"npm:dev:server\"",
    "dev:web": "vite --host 127.0.0.1 --port 5173",
    "dev:server": "tsx src/server/index.ts",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

## v0.5 구현 순서

1. `harness-ui` 앱 스캐폴딩
2. runtime detection API
3. harness inventory API
4. agents / skills 목록 API
5. workspace runs 스키마와 reader 구현
6. Overview 화면
7. Agents 화면
8. Skills 화면
9. Runs 화면
10. Ops 화면
11. Drift 화면
12. Build 화면 dry-run
13. Codex agent toml 동기화 계획 생성

## 수용 기준

v0.5 완료 조건:
- `npm run dev`로 UI와 API가 함께 실행된다.
- Overview에서 Claude Code와 Codex 설치 상태가 보인다.
- 현재 하네스의 Claude agents count, Claude skills count, Codex skills count가 보인다.
- `.codex/agents` 누락이 drift로 표시된다.
- `_workspace/runs`가 없거나 비어 있어도 UI가 깨지지 않는다.
- run fixture를 넣으면 Runs 화면에서 이벤트와 agent status가 보인다.
- Ops 화면에서 Claude Code, Codex, agy 설치/버전/헬스체크 상태가 보인다.
- `/usage`, `/status` 같은 대화형 slash command는 직접 실행 불가 이유와 snapshot import 경로가 보인다.
- 파일 수정 없이 dry-run 데이터 표시가 가능하다.
- cross-origin POST가 token, Origin, Host 검증에서 거부된다.
- token 없는 GET과 Host allowlist를 벗어난 GET이 거부된다.
- UI token은 HTML에 주입되지 않고 1회용 접속 URL로 bootstrap된다.
- token bootstrap URL은 `Referrer-Policy: no-referrer`와 local-only assets로 referer 누출을 막는다.
- dev server는 `/api` proxy로 same-origin UX를 제공하고 production은 Fastify 단일 origin으로 동작한다.
- path traversal payload가 모든 파일 API에서 거부된다.
- HTML/SVG/JS artifact가 `nosniff`와 attachment/text 반환으로 실행되지 않는다.
- shell metacharacter가 포함된 domain 입력이 host shell에서 실행되지 않는다.
- Claude/Codex prompt는 `Task:\n` prefix가 붙어 CLI command 이름과 충돌하지 않는다.
- dash로 시작하는 Codex prompt가 `--` 뒤 positional argument로만 전달된다.
- 실제 `codex exec` smoke run 하나가 schema-valid `status.json`, `events.jsonl`, agent state를 만든다.
- Codex run에도 `HARNESS_RUN_ID`와 `HARNESS_RUN_DIR`가 전달된다.
- cancel 요청이 child process tree를 종료하고 상태를 `cancelled`로 만든다.
- 서버 재시작 후 고아 `running` run은 살아 있는 `childProcessGroupId`를 정리한 뒤 `stale` 또는 `failed`로 표시된다.
- 서버 재시작 후 process group leader가 죽었더라도 `HARNESS_RUN_ID`가 일치하는 같은 group의 잔여 프로세스가 정리된다.
- leaderless group에서 `HARNESS_RUN_ID`를 확인할 수 없으면 supervisor가 kill하지 않는다.
- `serverPid`가 재사용되어도 `serverStartTime` 불일치로 heartbeat-stale run reconcile이 실행된다.
- leader가 살아 있고 PID start time 또는 process group id가 기록과 다르면 supervisor가 무관한 process를 kill하지 않는다.
- runtime child process가 `detached: true`로 별도 process group에 생성된다.
- live update는 header 인증 가능한 polling 또는 fetch streaming으로 동작하며 query token SSE를 쓰지 않는다.
- `events.jsonl` append가 전체 파일 재작성 없이 동작한다.
- Ops command 실행 API가 client-provided args/env/cwd/command를 거부한다.
- nested artifact path가 segment 단위 검증과 `realpath` 경계 검사 뒤에만 제공된다.

## 남은 결정

- v0.5에서 실제 빌드 실행까지 포함할지, dry-run까지만 둘지 결정 필요.
- Codex `.codex/agents/*.toml` 자동 생성 적용 시점을 결정해야 한다.
- Claude Code 상태 기록 규약을 기존 오케스트레이터 템플릿에 넣을지, 별도 adapter skill로 둘지 결정해야 한다.
- 운영 상태 snapshot의 수동 export 포맷을 CLI별로 고정할지, 자유 텍스트 import로 둘지 결정해야 한다.
