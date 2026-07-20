#!/usr/bin/env bash
# 영속 산출물 기록 검증 — 결과서가 docs/{project}/working_history/ 에 실제로 남았는지 확인한다.
# 버그: 영속물(결과서)이 gitignored _workspace 에 방치되어 cleanup/재실행 시 소멸·감사 이력 0.
# 강제: 단계 마감 게이트(권장: git pre-commit hook)에서 호출 — missing 이면 커밋 차단(런타임 강제).
#   프롬프트/체크리스트 강제는 오케스트레이터가 스킵·할루시할 수 있어 무력(외부감사). hook 이 물리 차단.
# 두 모드:
#   ① <docs_dir> [tier]  — 디렉토리에서 최신 결과서 찾아 검증(오케스트레이터 게이트 best-effort).
#   ② --file <path> [tier] — 단일 파일 검증(pre-commit hook 이 *스테이징된* 결과서를 직접 검증 — stale-latest·
#      subdir-noop·zzz 우회 차단. 커밋마다 신규 결과서 스테이징을 hook 이 git diff --cached 로 요구).
# 티어: T0/Tμ = 문서 불요(PASS). T1 = 결과서 1장 필수. T2 = 보류(설계 미구현 — factory-map.md).
# 출력 끝줄:  ARTIFACTS: ok | missing:<사유>   (항상 exit 0 — 상태는 끝줄로만, 파이프라인 중단 방지)
# 종료코드: 항상 0. hook 은 끝줄 ARTIFACTS: 를 파싱해 차단 여부 결정(set -e 파이프 안전).
set -uo pipefail

# 결과서 1장 내용 검증 — 최소 크기 + `## 다음 단계 참조` heading(번호 접두 허용·끝 앵커로 위조 차단).
# echo: ok | <사유>
validate_file() {
  local f="$1" bytes
  [ -f "$f" ] || { echo "no-file($f)"; return; }
  bytes="$(wc -c < "$f" 2>/dev/null | tr -d ' ')"
  [ "${bytes:-0}" -lt 200 ] && { echo "result-doc-too-small(${bytes}b:$f)"; return; }
  grep -qE '^#{2,}[[:space:]]+([0-9]+[.)][[:space:]]*)?다음 단계 참조[[:space:]]*$' "$f" 2>/dev/null \
    || { echo "no-next-step-block($f)"; return; }
  echo ok
}

# tier 정규화(대소문자 + 그리스 μ U+03BC · 마이크로 µ U+00B5 변형 흡수) → slim(문서 불요)?
tier_is_slim() { case "$(printf '%s' "$1" | tr 'A-Z' 'a-z')" in t0|tμ|tµ|tmu) return 0 ;; *) return 1 ;; esac; }

mode="${1:-}"

# ── 모드 ②: 단일 파일 검증(hook 이 스테이징된 결과서 직접 검증) ──
#   `--file -` : stdin 검증(hook 이 `git show :path` 로 *스테이지 blob* 을 파이프 → 워킹트리 아닌 index 검증,
#   TOCTOU 우회 차단: stub 스테이지 후 워킹트리만 valid 편집으로 통과하는 것 방지).
if [ "$mode" = "--file" ]; then
  f="${2:-}"; tier="${3:-t1}"
  tier_is_slim "$tier" && { echo "ARTIFACTS: ok"; exit 0; }
  [ -z "$f" ] && { echo "ARTIFACTS: missing:no-file-arg"; exit 0; }
  if [ "$f" = "-" ]; then
    # mktemp 없으면 안전 실패(예측가능 /tmp/…$$ 폴백은 symlink 공격 표면 — agy R4). O_EXCL 보장 위해 mktemp 강제.
    tmp="$(mktemp 2>/dev/null)" || { echo "ARTIFACTS: missing:mktemp-unavailable"; exit 0; }
    cat > "$tmp"; r="$(validate_file "$tmp")"; rm -f "$tmp"
  else
    r="$(validate_file "$f")"
  fi
  [ "$r" = ok ] && echo "ARTIFACTS: ok" || echo "ARTIFACTS: missing:$r"
  exit 0
fi

# ── 모드 ①: 디렉토리에서 최신 결과서 검증 ──
docs_dir="$mode"; tier="${2:-t1}"
if [ -z "$docs_dir" ]; then
  echo "usage: check-artifacts.sh <docs_dir>|--file <path> [t0|tmu|t1|t2]" >&2
  echo "ARTIFACTS: missing:no-docs-dir-arg"; exit 0
fi
tier_is_slim "$tier" && { echo "ARTIFACTS: ok"; exit 0; }   # T0/Tμ = slim, 마찰 0

wh="$docs_dir/working_history"
if [ ! -d "$wh" ]; then
  echo "ARTIFACTS: missing:no-working_history-dir($wh)"; exit 0
fi

# 최신 결과서 — basename 필터(경로에 _/template 있어도 오탐 없음) + mtime 최신(알파벳 zzz 우회 차단).
#   find -quit 가드: 빈 매칭 시 xargs 실행 방지. (BSD xargs 는 빈입력 자동스킵이나 GNU 는 cwd 를 ls 하므로
#   크로스플랫폼 위해 유지 — 커밋 시점 정적이라 TOCTOU 무의미.)
if [ -n "$(find "$wh" -maxdepth 1 -type f -name '*.md' ! -name '_*' ! -iname '*template*' -print -quit 2>/dev/null)" ]; then
  latest="$(find "$wh" -maxdepth 1 -type f -name '*.md' ! -name '_*' ! -iname '*template*' -print0 2>/dev/null \
            | xargs -0 ls -t 2>/dev/null | head -1)"   # 초대형 디렉토리(수천 파일)면 batch 분할로 근사 — 실사용 무해
else
  latest=""
fi
if [ -z "$latest" ]; then
  echo "ARTIFACTS: missing:no-result-doc-in($wh)"; exit 0
fi

r="$(validate_file "$latest")"
if [ "$r" != ok ]; then
  echo "ARTIFACTS: missing:$r"; exit 0
fi

# (선택) repo 루트 _workspace 에 영속 클래스(design/plans)가 결과서보다 새로우면 경고(차단 아님).
root="$(git -C "$docs_dir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$(dirname "$(dirname "$docs_dir")")")"
for sub in design plans plan; do
  d="$root/_workspace/$sub"
  [ -d "$d" ] || continue
  newer="$(find "$d" -maxdepth 1 -type f -name '*.md' -newer "$latest" -print -quit 2>/dev/null)"
  [ -n "$newer" ] && echo "WARN: _workspace/$sub 에 결과서보다 새 영속물($newer) — docs/ 승격 검토(휘발 소멸 위험)." >&2
done

echo "ARTIFACTS: ok"
exit 0
