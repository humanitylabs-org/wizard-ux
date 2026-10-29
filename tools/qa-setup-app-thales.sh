#!/bin/bash
# Browser-only QA on the configured worker: no Android/VM worker lock.
# Usage: WIZARD_BUILD_HOST=worker WIZARD_WORK_ROOT=/worker/work tools/qa-setup-app-thales.sh [label]
set -euo pipefail
: "${WIZARD_WORK_ROOT:?Set WIZARD_WORK_ROOT to the remote worker work volume}"
if [ "${1:-}" = "--remote" ]; then
  cd "$(dirname "$0")/.."
  export TMPDIR="$WIZARD_WORK_ROOT/tmp/phone-setup"
  mkdir -p "$TMPDIR" out/shots
  DEPS=${QA_DEPS:-$WIZARD_WORK_ROOT/QA/phone-setup/deps}
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
: "${WIZARD_BUILD_HOST:?Set WIZARD_BUILD_HOST to the remote SSH worker}"
LABEL=${1:-run}
[[ "$LABEL" =~ ^[a-zA-Z0-9_-]+$ ]] || { printf 'Invalid snapshot label\n' >&2; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHA=$(git -C "$ROOT" rev-parse HEAD)
SNAP="$WIZARD_WORK_ROOT/QA/phone-setup/ux-${SHA:0:12}-$LABEL"
printf -v QSNAP '%q' "$SNAP"
printf -v QWORK '%q' "$WIZARD_WORK_ROOT"
ssh "$WIZARD_BUILD_HOST" "mkdir -p $QSNAP"
rsync -a --delete --protect-args --exclude .git --exclude android/.gradle --exclude android/app/build --exclude node_modules --exclude out "$ROOT/" "$WIZARD_BUILD_HOST:$SNAP/"
ssh "$WIZARD_BUILD_HOST" "WIZARD_WORK_ROOT=$QWORK bash $QSNAP/tools/qa-setup-app-thales.sh --remote"
printf 'snapshot: %s:%s\n' "$WIZARD_BUILD_HOST" "$SNAP"
