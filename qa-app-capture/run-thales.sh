#!/bin/bash
# Run only on Thales, inside the shared heavyweight/browser worker lock.
set -euo pipefail
root=/Volumes/ThalesMedia/WizardApps/shared-services/capture
export PATH=/opt/homebrew/bin:$PATH
export PLAYWRIGHT_MODULE=${PLAYWRIGHT_MODULE:-/Users/thales/Projects/wisdom-app-migration-20261012/qa-node/node_modules/playwright}
export CHROMIUM=${CHROMIUM:-/Users/thales/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell}
export CAPTURE_EVIDENCE=$root/evidence
export SOURCE_SHA=${1:?Pass exact source commit SHA}
export SOURCE_TREE=${2:?Pass exact source git tree SHA}
mkdir -p "$CAPTURE_EVIDENCE"
cd "$root/source"
if [[ "$(hostname)" != thales.local ]]; then printf 'Refusing non-Thales browser run\n' >&2; exit 2; fi
hostname
printf 'sourceSHA=%s\nsourceTree=%s\n' "$SOURCE_SHA" "$SOURCE_TREE"
# lockf releases on command exit; never bypass another active browser/build worker.
/usr/bin/lockf -k -t 5400 /Volumes/ThalesMedia/AndroidBuilds/worker.lock /bin/bash -c '
  set -euo pipefail
  hostname; date -u
  shasum -a 256 web/core/app-capture.js qa-app-capture/run.cjs qa-app-capture/native-mocks.cjs qa-app-capture/run-thales.sh qa-app-capture/README.md > "$CAPTURE_EVIDENCE/source-manifest.sha256"
  node qa-app-capture/run.cjs
' 2>&1 | tee "$CAPTURE_EVIDENCE/run.log"
