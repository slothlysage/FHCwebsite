#!/usr/bin/env bash
# Ralph loop driver for FHCwebsite.
#
#   ./loop.sh --once        one iteration
#   ./loop.sh --max 40      up to 40 iterations
#
# Watch the first few by hand. An agent loop compounds mistakes as happily as
# it compounds progress.

set -uo pipefail

MAX=1
case "${1:-}" in
  --once) MAX=1 ;;
  --max)  MAX="${2:?--max needs a number}" ;;
  "")     MAX=1 ;;
  *)      echo "usage: $0 [--once | --max N]" >&2; exit 2 ;;
esac

mkdir -p .loop-logs

for i in $(seq 1 "$MAX"); do
  echo "=============================================="
  echo " iteration $i / $MAX  —  $(date -Is)"
  echo "=============================================="

  BEFORE=$(git rev-parse HEAD 2>/dev/null || echo none)

  cat PROMPT.md | claude -p \
    --dangerously-skip-permissions \
    2>&1 | tee ".loop-logs/iter-$(printf '%03d' "$i").log"

  AFTER=$(git rev-parse HEAD 2>/dev/null || echo none)

  if [ "$BEFORE" = "$AFTER" ]; then
    echo ">> No commit produced this iteration."
    STALL=$((${STALL:-0} + 1))
    if [ "$STALL" -ge 2 ]; then
      echo ">> Two consecutive no-op iterations. Stopping — read the logs."
      exit 1
    fi
  else
    STALL=0
    echo ">> $(git log -1 --oneline)"
  fi

  if grep -q "^## Blocked — needs human" fix_plan.md && \
     grep -A3 "^## Blocked — needs human" fix_plan.md | grep -q "^- \[ \]"; then
    echo ">> Blocker recorded in fix_plan.md. Stopping for human input."
    exit 0
  fi

  sleep 2
done

echo "Loop finished after $MAX iteration(s)."
