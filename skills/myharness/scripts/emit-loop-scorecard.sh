#!/usr/bin/env bash
# 외부감사 루프 측정 꼬리(재발방지·B) — raw codex/agy 로 돌린 감사도 verdicts.json 만 남기면
# 이 한 명령이 build-scorecard.sh 를 올바른 경로로 호출해 loop_scorecard + summary.jsonl 을 발행한다.
# (측정 꼬리를 건너뛰던 근본원인: raw 감사 후 verdicts→build-scorecard 를 수동 스킵 → #/eval 루프 0.)
#
# 사용: emit-loop-scorecard.sh <verdicts.json> [run_id] [project_root] [loop]
#   verdicts.json: {"loop","stage_id","rounds","diff_lines","risk_level","termination_reason",
#                   "issues":[{"fingerprint","verdict","round","source"}...]}  (build-scorecard.sh 계약)
#   기본 run_id = UTC 타임스탬프, project_root = ., loop = verdicts.loop(없으면 external-review)
# 출력: _workspace/evals/{loop}/{stage_id}/{run_id}/scorecard.json  + {loop}/summary.jsonl append
set -uo pipefail
V="${1:?verdicts.json 경로}"
HERE="$(cd "$(dirname "$0")" && pwd)"
command -v jq >/dev/null || { echo "jq 필요(측정 생략)" >&2; exit 0; }

STAGE="$(jq -r '.stage_id // "stage"' "$V")"
LOOP="${4:-$(jq -r '.loop // "external-review"' "$V")}"
RUN="${2:-$(date -u +%Y%m%d_%H%M%S)}"
ROOT="${3:-.}"
OUT="$ROOT/_workspace/evals/$LOOP/$STAGE/$RUN/scorecard.json"
mkdir -p "$(dirname "$OUT")"
bash "$HERE/build-scorecard.sh" "$V" "$OUT"
echo "loop_scorecard 발행: $OUT (summary → _workspace/evals/$LOOP/summary.jsonl)"
