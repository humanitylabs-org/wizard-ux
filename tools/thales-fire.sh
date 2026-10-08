#!/bin/bash
# Run on Thales: fire a Wizard OS assistant handoff intent exactly as the side-key app would.
# usage: thales-fire.sh LISTEN|SAY [base64-text] [package]
export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools
export ANDROID_SERIAL=emulator-5554
A=$1; PKG=${3:-ai.wizards.os.qa}
if [ -n "${2:-}" ] && [ "$2" != "-" ]; then
  T=$(printf %s "$2" | base64 -D)
  case "$T" in *"'"*) echo "text must not contain single quotes" >&2; exit 2;; esac
  adb shell "am start -a ai.wizards.os.action.$A --es android.intent.extra.TEXT '$T' -n $PKG/ai.wizards.os.MainActivity" 2>&1
else
  adb shell "am start -a ai.wizards.os.action.$A -n $PKG/ai.wizards.os.MainActivity" 2>&1
fi
