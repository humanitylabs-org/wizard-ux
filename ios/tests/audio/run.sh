#!/bin/bash
# Compile ios/native/App/App/WizardAudioPolicy.swift (Foundation only) with the checks and run them. Any Mac with the
# Command Line Tools (no Xcode or simulator), or any machine with a Swift toolchain (e.g. the swift Docker image).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../../native/App/App"
out="$(mktemp -d "${TMPDIR:-/tmp}/wizard-audio.XXXX")"; trap 'rm -rf "$out"' EXIT
if command -v xcrun >/dev/null 2>&1; then swiftc=(xcrun swiftc); else swiftc=(swiftc); fi
"${swiftc[@]}" -swift-version 5 -module-cache-path "$out/mc" "$app/WizardAudioPolicy.swift" "$here/main.swift" -o "$out/checks"
"$out/checks"
# The player and its bridge need AVFoundation, MediaPlayer, UIKit and WebKit (Apple only); here they are syntax-checked.
"${swiftc[@]}" -parse "$app/WizardAudioPlayer.swift" "$app/WizardViewController.swift"
echo "player syntax ok"
