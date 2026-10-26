#!/usr/bin/env bash
# On-device smoke for Wizard Shell (android/shell): first launch shows Connect, a bad address is refused,
# a wizard://connect link prefills the address, Connect to an unreachable Wizard shows the can't-reach screen,
# and the app never crashes. Usage: android_shell_smoke.sh <apk> <out-dir>
set -u
APK="$1"; OUT="$2"; PKG=ai.wizards.shell.test; ACT="$PKG/ai.wizards.shell.ShellActivity"
mkdir -p "$OUT"; : > "$OUT/result.txt"
fail=0
pass() { echo "PASS $1" | tee -a "$OUT/result.txt"; }
bad()  { echo "FAIL $1" | tee -a "$OUT/result.txt"; fail=1; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb exec-out cat /sdcard/ui.xml > "$OUT/ui-$1.xml"; }
has()  { grep -q "$2" "$OUT/ui-$1.xml"; }
# Centre of the first node whose text matches, from a uiautomator dump.
tap_text() {
  local b; b=$(python3 - "$OUT/ui-$1.xml" "$2" <<'PY'
import re, sys
xml, want = open(sys.argv[1]).read(), sys.argv[2]
for m in re.finditer(r'<node [^>]*>', xml):
    n = m.group(0)
    if (want.startswith('class=') and f'{want}"' in n.replace('class="','class=',0) and want[6:] in n) or f'text="{want}"' in n:
        x1, y1, x2, y2 = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups())
        print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
  [ -n "$b" ] && adb shell input tap $b
}
wait_for() { # <name> <text> <seconds>
  for _ in $(seq 1 "$3"); do dump "$1"; has "$1" "$2" && return 0; sleep 1; done; return 1
}

adb install -r "$APK" >/dev/null && pass "installs" || bad "installs"
adb logcat -c
adb shell am start -W -n "$ACT" > "$OUT/start.txt" 2>&1
grep -q "Status: ok" "$OUT/start.txt" && pass "launches" || bad "launches"
wait_for first "Connect to your Wizard" 20 && pass "first launch shows Connect" || bad "first launch shows Connect"

# A bad address is refused with a message and nothing is saved.
tap_text first "class=android.widget.EditText"
adb shell input text "http://not-https.example"
dump typed; tap_text typed "Connect"
wait_for refused "Use the full https address" 10 && pass "refuses a non-https address" || bad "refuses a non-https address"

# A Setup link prefills the address; Connect to an unreachable Wizard shows the can't-reach screen.
adb shell am start -W -a android.intent.action.VIEW -d "wizard://connect?origin=https%3A%2F%2Fwizard.invalid" "$PKG" >/dev/null 2>&1
wait_for linked "https://wizard.invalid" 15 && pass "wizard://connect prefills the address" || bad "wizard://connect prefills the address"
tap_text linked "Connect"
wait_for offline "Can.t reach your Wizard" 40 && pass "unreachable Wizard shows the can't-reach screen" || bad "unreachable Wizard shows the can't-reach screen"
has offline "Change Wizard" && pass "can't-reach offers Change Wizard" || bad "can't-reach offers Change Wizard"

# The choice is remembered: a cold start goes straight to the Wizard (here: can't-reach), not Connect.
adb shell am force-stop "$PKG"; adb shell am start -W -n "$ACT" >/dev/null 2>&1
wait_for cold "Can.t reach your Wizard" 40 && pass "remembers the Wizard across restarts" || bad "remembers the Wizard across restarts"

# Back on the can't-reach screen retries instead of crashing or closing into a blank state.
adb shell input keyevent KEYCODE_BACK; sleep 3
adb shell pidof "$PKG" >/dev/null && pass "alive after Back" || bad "alive after Back"

adb logcat -d > "$OUT/logcat.txt"
adb logcat -b crash -d > "$OUT/crash.txt"
if grep -q "$PKG" "$OUT/crash.txt" || grep -A3 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then bad "no crash"; else pass "no crash"; fi
adb exec-out screencap -p > "$OUT/final.png" 2>/dev/null
exit $fail
