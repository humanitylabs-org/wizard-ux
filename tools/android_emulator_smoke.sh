#!/usr/bin/env bash
# Android emulator smoke (CI): install the debug APK, launch MainActivity, prove it runs without crashing and that
# a native first screen takes over. CI builds carry no owner origin, so MainActivity hands off to Connect
# ("Connect to your Wizard": scan Setup's QR or paste the address). A build with an origin that does not
# resolve shows the native reach screen instead; both are accepted.
# Usage: tools/android_emulator_smoke.sh <apk> <out-dir>
set -euo pipefail
APK="$1"; OUT="$2"
PKG=ai.wizards.os.qa
mkdir -p "$OUT"
fail() { echo "SMOKE FAIL: $*"; echo "SMOKE FAIL: $*" >> "$OUT/result.txt"; exit 1; }

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb shell input keyevent 82 || true   # wake / dismiss keyguard

echo "== install"
adb install -r -g "$APK" | tee "$OUT/install.txt"
adb shell pm path "$PKG" | grep -q package: || fail "$PKG not installed"

adb logcat -c || true
echo "== launch"
adb shell am start -W -n "$PKG/ai.wizards.os.MainActivity" | tee "$OUT/am-start.txt"
grep -q 'Status: ok' "$OUT/am-start.txt" || fail "am start did not report Status: ok"

# Wait for Connect (no origin) or the reach screen (or a painted page); ReachPolicy gives up at 10s.
state=""
for _ in $(seq 1 45); do
  if adb shell dumpsys activity activities | grep -E 'topResumedActivity' | grep -q "$PKG/ai.wizards.os.ConnectActivity"; then
    state="connect"; break
  fi
  line="$(adb logcat -d -s WizardOSReach:I | grep -E 'WizardOSReach.*(offline|reached)' | tail -1 || true)"
  if [ -n "$line" ]; then state="$line"; break; fi
  sleep 1
done
sleep 3   # let it settle, then check it is still alive

adb logcat -d > "$OUT/logcat.txt" || true
adb logcat -d -b crash > "$OUT/logcat-crash.txt" || true
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 || true
adb exec-out screencap -p > "$OUT/screen.png" || true

echo "== assertions"
if grep -q "Process: ai\.wizards\.os" "$OUT/logcat-crash.txt"; then
  grep -A30 'FATAL EXCEPTION' "$OUT/logcat-crash.txt" | head -60
  fail "crash buffer has a crash from ai.wizards.os"
fi
if grep -A2 'FATAL EXCEPTION' "$OUT/logcat.txt" | grep -q "ai\.wizards\.os"; then
  grep -A30 'FATAL EXCEPTION' "$OUT/logcat.txt" | head -60
  fail "logcat has a FATAL EXCEPTION from ai.wizards.os"
fi
grep -q "ANR in $PKG" "$OUT/logcat.txt" && fail "ANR in $PKG"
adb shell pidof "$PKG" >/dev/null || fail "$PKG process is not running after launch"
adb shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | tee "$OUT/resumed.txt"
[ -n "$state" ] || fail "neither Connect nor a WizardOSReach offline/reached log within 45s"
if [ "$state" = connect ]; then
  grep -q "$PKG/ai.wizards.os.ConnectActivity" "$OUT/resumed.txt" || fail "Connect is not the resumed activity"
  grep -q 'Connect to your Wizard' "$OUT/ui.xml" || fail "Connect screen title is not on screen (see ui.xml)"
  grep -q 'Scan QR code' "$OUT/ui.xml" || fail "Connect screen has no Scan QR code button"
  echo "native Connect screen is showing"
  echo "SMOKE OK: installed, launched, alive, no crash; no origin -> Connect" | tee "$OUT/result.txt"
  exit 0
fi
grep -q "$PKG/ai.wizards.os.MainActivity" "$OUT/resumed.txt" || fail "MainActivity is not the resumed activity"
echo "reach log: $state"
if echo "$state" | grep -q offline; then
  grep -qE "Tailscale is off|Can&apos;t reach your Wizard|Can't reach your Wizard|You&apos;re offline|You're offline" "$OUT/ui.xml" \
    || fail "reach screen logged offline but its title is not on screen (see ui.xml)"
  grep -q 'Try again' "$OUT/ui.xml" || fail "reach screen has no Try again button on screen"
  echo "native reach screen is showing"
fi
echo "SMOKE OK: installed, launched, alive, no crash; $state" | tee "$OUT/result.txt"
