#!/bin/bash
# Run the Agents MVP suite (qa-agents.cjs) against the in-memory contract fixture (tools/agents-fixture.mjs).
# Runs on a browser QA host; the caller holds any shared heavy-worker lock.
# usage: PW=<path to playwright> [NODE=node] tools/agents-qa.sh <stage-dir> <out-dir> [port]
set -u
ST="$1"; OUT="$2"; PORT="${3:-9741}"
NODE=${NODE:-node}
: "${PW:?set PW to a playwright module path}"; export PW
mkdir -p "$OUT"
cd "$ST" || exit 2
echo "START $(date -u +%FT%TZ) host=$(hostname) sha=${QA_SHA:-} tree=${QA_TREE:-}" | tee "$OUT/run.txt"
"$NODE" tools/agents-fixture.mjs "$PORT" web --main=fixture > "$OUT/fixture.log" 2>&1 &
FX=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/wizard-os-home/" && break; sleep 0.25; done
QA_OUT="$OUT" "$NODE" qa-agents.cjs "http://127.0.0.1:$PORT/wizard-os-home/" 2>&1 | tee -a "$OUT/run.txt"
RC=${PIPESTATUS[0]}
kill $FX 2>/dev/null; wait $FX 2>/dev/null
echo "DONE rc=$RC $(date -u +%FT%TZ)" | tee -a "$OUT/run.txt"
exit $RC
