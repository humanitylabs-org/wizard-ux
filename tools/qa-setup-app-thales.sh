#!/bin/bash
# Browser-only QA on Thales: no Android/VM worker lock.
# Usage: tools/qa-setup-app-thales.sh [label]
set -euo pipefail
if [ "${1:-}" = "--remote" ]; then
  export PATH=/opt/homebrew/bin:$PATH
  cd "$(dirname "$0")/.."
  export TMPDIR=/Volumes/ThalesMedia/tmp/phone-setup
  mkdir -p "$TMPDIR" out/shots
  DEPS=${QA_DEPS:-/Volumes/ThalesMedia/QA/phone-setup/deps}
  mkdir -p "$DEPS"
  if [ ! -d "$DEPS/node_modules/jsqr" ] || [ "$(node -p "try { require('$DEPS/node_modules/playwright/package.json').version } catch { '' }")" != "1.64.1" ]; then
    npm install --prefix "$DEPS" --no-audit --no-fund playwright@1.64.1 jsqr@1.4.0
  fi
  export QA_PLAYWRIGHT="$DEPS/node_modules/playwright" QA_JSQR="$DEPS/node_modules/jsqr"
  export QA_SHOTS="$PWD/out/shots" QA_RECEIPT="$PWD/out/qa-setup-app.json"
  PORT=${QA_PORT:-19473}
  node tools/fake-setup-api.cjs "$PORT" web >out/fake.log 2>&1 & FP=$!
  trap 'kill "$FP" 2>/dev/null || true; wait "$FP" 2>/dev/null || true' EXIT
  for i in {1..40}; do
    if curl -fsS "http://127.0.0.1:$PORT/__fake/state" >/dev/null; then break; fi
    sleep .1
  done
  node qa-setup-app.cjs "http://127.0.0.1:$PORT/wizard-os-home/" >out/qa-setup-app.log 2>&1
  exit
fi
LABEL=${1:-run}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHA=$(git -C "$ROOT" rev-parse HEAD)
SNAP="/Volumes/ThalesMedia/QA/phone-setup/ux-${SHA:0:12}-$LABEL"
ssh thales "mkdir -p '$SNAP'"
rsync -a --delete --exclude .git --exclude android/.gradle --exclude android/app/build --exclude node_modules --exclude out "$ROOT/" "thales:$SNAP/"
ssh thales "bash '$SNAP/tools/qa-setup-app-thales.sh' --remote"
printf 'snapshot: thales:%s\n' "$SNAP"
