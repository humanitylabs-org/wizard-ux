#!/bin/bash
# Compile ios/native/App/App/WizardOrigin.swift (Foundation only) with the checks and run them. Any Mac with the
# Command Line Tools; no Xcode or simulator needed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d "${TMPDIR:-/tmp}/wizard-origin.XXXX")"; trap 'rm -rf "$out"' EXIT
xcrun swiftc -swift-version 5 -module-cache-path "$out/mc" "$here/../../native/App/App/WizardOrigin.swift" "$here/main.swift" -o "$out/checks"
"$out/checks"
