#!/bin/bash
# Thales: run the Agents MVP suite against the in-memory contract fixture. Caller holds the shared heavy-worker lock.
# usage: tools/thales-agents-qa.sh <stage-dir> <out-dir> [port]
set -u
ST="$1"; OUT="$2"; PORT="${3:-9741}"
NODE=/opt/homebrew/bin/node
export PW=${PW:-/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright}
mkdir -p "$OUT"
cd "$ST" || exit 2
echo "LOCK_ACQUIRED $(date -u +%FT%TZ) host=$(hostname) sha=${QA_SHA:-} tree=${QA_TREE:-}" | tee "$OUT/run.txt"
"$NODE" tools/agents-fixture.mjs "$PORT" web --main=fixture > "$OUT/fixture.log" 2>&1 &
FX=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/wizard-os-home/" && break; sleep 0.25; done
QA_OUT="$OUT" "$NODE" qa-agents.cjs "http://127.0.0.1:$PORT/wizard-os-home/" 2>&1 | tee -a "$OUT/run.txt"
RC=${PIPESTATUS[0]}
kill $FX 2>/dev/null; wait $FX 2>/dev/null
echo "DONE rc=$RC $(date -u +%FT%TZ)" | tee -a "$OUT/run.txt"
exit $RC
