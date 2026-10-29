#!/bin/bash
# Run on the configured macOS worker, inside the shared heavyweight/browser lock.
set -euo pipefail
: "${WIZARD_WORK_ROOT:?Set WIZARD_WORK_ROOT to the worker work volume}"
root="$WIZARD_WORK_ROOT/WizardApps/shared-services/capture"
# Install playwright in the checkout, or set QA_PLAYWRIGHT; CHROMIUM is an optional browser override.
export CAPTURE_EVIDENCE="$root/evidence"
export SOURCE_SHA=${1:?Pass exact source commit SHA}
export SOURCE_TREE=${2:?Pass exact source git tree SHA}
mkdir -p "$CAPTURE_EVIDENCE" "$WIZARD_WORK_ROOT/AndroidBuilds"
cd "$root/source"
if [[ "$(uname -s)" != Darwin ]]; then printf 'Run on the configured macOS worker\n' >&2; exit 2; fi
hostname
printf 'sourceSHA=%s\nsourceTree=%s\n' "$SOURCE_SHA" "$SOURCE_TREE"
# lockf releases on command exit; never bypass another active browser/build worker.
/usr/bin/lockf -k -t 5400 "$WIZARD_WORK_ROOT/AndroidBuilds/worker.lock" /bin/bash -c '
  set -euo pipefail
  hostname; date -u
  shasum -a 256 web/core/app-capture.js qa-app-capture/run.cjs qa-app-capture/native-mocks.cjs qa-app-capture/run-thales.sh qa-app-capture/README.md > "$CAPTURE_EVIDENCE/source-manifest.sha256"
  node qa-app-capture/run.cjs
' 2>&1 | tee "$CAPTURE_EVIDENCE/run.log"
