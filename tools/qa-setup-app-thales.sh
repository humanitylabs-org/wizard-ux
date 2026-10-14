#!/bin/bash
# Run qa-setup-app.cjs on Thales under the shared worker lock against a frozen snapshot of this worktree.
# Usage (control host, repo root): tools/qa-setup-app-thales.sh <label>
#   remote side: tools/qa-setup-app-thales.sh --remote <sha> <dirty> <label>   (inside the snapshot)
set -euo pipefail
if [ "${1:-}" = "--remote" ]; then
  SHA=$2 DIRTY=$3 LABEL=$4
  export PATH=/opt/homebrew/bin:$PATH
  cd "$(dirname "$0")/.."
  DEPS=$HOME/workspace/wos-setup-app/deps
  [ -d "$DEPS/node_modules/jsqr" ] || (mkdir -p "$DEPS" && cd "$DEPS" && npm init -y >/dev/null && npm i --no-audit --no-fund jsqr@1.4.0 >/dev/null)
  export PW=$HOME/workspace/wizard-mobile-link-candidate/node_modules/playwright
  rm -rf out; mkdir -p out/shots
  echo "host=$(hostname) sha=$SHA dirty=$DIRTY label=$LABEL node=$(node -v) playwright=$(node -p "require('$PW/package.json').version") jsqr=$(node -p "require('$DEPS/node_modules/jsqr/package.json').version") snapshot=$PWD started=$(date -u +%FT%TZ)" > out/receipt.txt
  set +e
  lockf -k /Volumes/ThalesMedia/AndroidBuilds/worker.lock bash -c '
    node tools/fake-setup-api.cjs 9473 web > out/fake.log 2>&1 & FP=$!
    sleep 1
    QA_SHOTS=out/shots QA_RECEIPT=out/qa-setup-app.json QA_JSQR='"$DEPS"'/node_modules/jsqr \
      node -r ./qa-thales-loader.cjs qa-setup-app.cjs http://127.0.0.1:9473/wizard-os-home/ > out/qa-setup-app.log 2>&1
    RC=$?; kill $FP; exit $RC'
  RC=$?
  echo "lock=/Volumes/ThalesMedia/AndroidBuilds/worker.lock (lockf -k) exit=$RC finished=$(date -u +%FT%TZ)" >> out/receipt.txt
  tail -2 out/qa-setup-app.log
  exit 0
fi
LABEL=${1:-run}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHA=$(git -C "$ROOT" rev-parse HEAD)
DIRTY=$(git -C "$ROOT" status --porcelain | wc -l | tr -d ' ')
SNAP="workspace/wos-setup-app/snap-${SHA:0:12}-$LABEL"
ssh thales "mkdir -p ~/$SNAP"
rsync -a --delete --exclude .git --exclude android --exclude out "$ROOT/" "thales:$SNAP/"
ssh thales "bash ~/$SNAP/tools/qa-setup-app-thales.sh --remote $SHA $DIRTY $LABEL"
echo "snapshot: thales:~/$SNAP"
