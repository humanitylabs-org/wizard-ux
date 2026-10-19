#!/bin/bash
# Run one suite against baseline and candidate, sequentially to avoid Chrome contention.
# Usage: tools/qa-ab.sh <suite.cjs> [extra args]
# Self-contained suites can use QA_BASE_WEB_DIR / QA_CANDIDATE_WEB_DIR instead of qa-origins.
cd "$(dirname "$0")/.." || exit 2
S=$1; shift
OUT=${QA_AB_OUT:-${TMPDIR:-/tmp}/qa-ab}
mkdir -p "$OUT/base" "$OUT/desk"
runner=()
if command -v timeout >/dev/null; then runner=(timeout 280)
elif command -v gtimeout >/dev/null; then runner=(gtimeout 280)
fi
status=0
for k in base desk; do
  port=9382; web=${QA_BASE_WEB_DIR:-${QA_WEB_DIR:-}}
  if [ "$k" = desk ]; then port=9381; web=${QA_CANDIDATE_WEB_DIR:-${QA_WEB_DIR:-}}; fi
  QA_WEB_DIR="$web" QA_OUT="$OUT/$k" "${runner[@]}" node "$S" "http://127.0.0.1:$port/wizard-os-home/" "$@" > "$OUT/$S.$k.txt" 2>&1 || status=1
  printf '== %s: %s pass, %s fail\n' "$k" "$(grep -c '^PASS' "$OUT/$S.$k.txt")" "$(grep -c '^FAIL' "$OUT/$S.$k.txt")"
  grep -E '^FAIL|Error|rror:' "$OUT/$S.$k.txt" || true
done
exit "$status"
