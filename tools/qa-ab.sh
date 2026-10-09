#!/bin/bash
# Run a QA suite against the baseline (live daily web dir) and this worktree, side by side.
# Usage: tools/qa-ab.sh <suite.cjs> [extra args]
cd "$(dirname "$0")/.."
S=$1; shift
mkdir -p /tmp/qa-base /tmp/qa-desk
QA_OUT=/tmp/qa-base timeout 280 node "$S" http://127.0.0.1:9382/wizard-os-home/ "$@" > "/tmp/$S.base.txt" 2>&1 &
QA_OUT=/tmp/qa-desk timeout 280 node "$S" http://127.0.0.1:9381/wizard-os-home/ "$@" > "/tmp/$S.desk.txt" 2>&1
wait
for k in base desk; do echo "== $k: $(grep -c '^PASS' /tmp/$S.$k.txt) pass, $(grep -c '^FAIL' /tmp/$S.$k.txt) fail"; grep -E '^FAIL|Error|rror:' "/tmp/$S.$k.txt" | head -12; done
