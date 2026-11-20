#!/bin/bash
# Compile ios/native/App/App/WizardAudioPolicy.swift (Foundation only) with the checks and run them. Any Mac with the
# Command Line Tools (no Xcode or simulator), or any machine with a Swift toolchain (e.g. the swift Docker image).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d "${TMPDIR:-/tmp}/wizard-audio.XXXX")"; trap 'rm -rf "$out"' EXIT
if command -v xcrun >/dev/null 2>&1; then swiftc=(xcrun swiftc); else swiftc=(swiftc); fi
"${swiftc[@]}" -swift-version 5 -module-cache-path "$out/mc" "$here/../../native/App/App/WizardAudioPolicy.swift" "$here/main.swift" -o "$out/checks"
"$out/checks"
