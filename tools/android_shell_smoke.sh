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
adb logcat -c
adb shell input keyevent KEYCODE_BACK; sleep 3
if ! adb shell pidof "$PKG" >/dev/null && adb logcat -d | grep -q "Killing .*$PKG.*in dying proc"; then
  # A fresh emulator's Play services can die and take every app using its font provider with it. That is the
  # system, not Back: say so, relaunch once and repeat the check (still strict).
  echo "NOTE system killed $PKG (dependency in a dying process) during the Back check; repeating once" | tee -a "$OUT/result.txt"
  adb shell am start -W -n "$ACT" >/dev/null 2>&1; wait_for cold2 "Can.t reach your Wizard" 40
  adb shell input keyevent KEYCODE_BACK; sleep 3
fi
adb shell pidof "$PKG" >/dev/null && pass "alive after Back" || bad "alive after Back"

# ---- Optional background recording (device.recording over wizardDevicePort), against the disposable HTTPS fixture
# Wizard (tools/android_shell_fixture.py) at https://10.0.2.2:8443. Needs FIXTURE_OUT (its log dir) and QA_MIC (an AAC
# file the debug recorder streams in place of the emulator's absent microphone).
if [ -n "${FIXTURE_OUT:-}" ] && [ -n "${QA_MIC:-}" ]; then
  FX="$FIXTURE_OUT/fixture.log"
  ev() { python3 - "$FX" "$@" <<'PY'
import json, sys
want, key = sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None
for line in reversed(open(sys.argv[1]).read().splitlines()):
    try: e = json.loads(line)
    except ValueError: continue
    if e.get('ev') == want:
        v = e
        for k in (key or '').split('.'):
            if k: v = v.get(k) if isinstance(v, dict) else None
        print(json.dumps(v) if not isinstance(v, str) else v); break
PY
}
  wait_ev() { for _ in $(seq 1 "$2"); do [ -n "$(ev "$1")" ] && return 0; sleep 1; done; return 1; }
  size() { adb shell run-as "$PKG" stat -c %s "files/takes/$1.aac" 2>/dev/null | tr -d '\r'; }
  adb push "$QA_MIC" /data/local/tmp/qa_mic.aac >/dev/null
  adb shell run-as "$PKG" mkdir -p files
  adb shell run-as "$PKG" cp /data/local/tmp/qa_mic.aac files/qa_mic.aac
  adb shell pm grant "$PKG" android.permission.RECORD_AUDIO
  adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null
  echo record > "$FIXTURE_OUT/mode"

  adb shell am start -W -a android.intent.action.VIEW -d "wizard://connect?origin=https%3A%2F%2F10.0.2.2%3A8443" "$PKG" >/dev/null 2>&1
  wait_for fxconnect "https://10.0.2.2:8443" 15 && tap_text fxconnect "Connect"
  wait_ev caps 60 && pass "rec: the Wizard discovers device.recording" || bad "rec: the Wizard discovers device.recording"
  ev caps caps.capabilities > "$OUT/rec-caps.json"
  grep -q '"device.recording.start"' "$OUT/rec-caps.json" && grep -q '"device.recording.ack"' "$OUT/rec-caps.json" \
    && pass "rec: capability lists its exact methods" || bad "rec: capability lists its exact methods"
  wait_ev started 40
  ID=$(ev started id); echo "take: $ID" >> "$OUT/result.txt"
  [ -n "$ID" ] && [ "$ID" != "null" ] && pass "rec: start returns a take" || bad "rec: start returns a take ($(ev started error))"
  sleep 3
  adb shell dumpsys activity services "$PKG" > "$OUT/rec-services.txt"
  grep -q "RecorderService" "$OUT/rec-services.txt" && grep -q "isForeground=true" "$OUT/rec-services.txt" \
    && pass "rec: microphone foreground service running" || bad "rec: microphone foreground service running"
  adb shell dumpsys notification --noredact > "$OUT/rec-notifications.txt" 2>/dev/null
  grep -q "Recording for your Wizard" "$OUT/rec-notifications.txt" && pass "rec: ongoing notification shown" || bad "rec: ongoing notification shown"

  # Screen off (locked): the take keeps growing.
  s0=$(size "$ID"); adb shell input keyevent KEYCODE_SLEEP; sleep 12; s1=$(size "$ID")
  echo "screen-off bytes: $s0 -> $s1" >> "$OUT/result.txt"
  [ -n "$s1" ] && [ "${s1:-0}" -gt "$(( ${s0:-0} + 20000 ))" ] && pass "rec: keeps recording with the screen off" || bad "rec: keeps recording with the screen off"
  adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard; sleep 2

  # Another app in front: still recording.
  adb shell input keyevent KEYCODE_HOME; sleep 2
  adb shell am start -W -a android.settings.SETTINGS >/dev/null 2>&1; sleep 10; s2=$(size "$ID")
  echo "backgrounded bytes: $s1 -> $s2" >> "$OUT/result.txt"
  [ "${s2:-0}" -gt "$(( ${s1:-0} + 20000 ))" ] && adb shell pidof "$PKG" >/dev/null && pass "rec: keeps recording in the background" || bad "rec: keeps recording in the background"

  # Force-stop mid-take: the take stays on disk and is recovered on the next start.
  adb shell am force-stop "$PKG"; sleep 2
  s3=$(size "$ID"); echo "after force-stop bytes: $s3" >> "$OUT/result.txt"
  [ "${s3:-0}" -ge "${s2:-1}" ] && pass "rec: take survives force-stop on disk" || bad "rec: take survives force-stop on disk"
  echo recover > "$FIXTURE_OUT/mode"
  adb shell am start -W -n "$ACT" >/dev/null 2>&1
  wait_ev ack 90 && pass "rec: recovered take read and acknowledged" || bad "rec: recovered take read and acknowledged"
  ev pending p > "$OUT/rec-pending.json"
  python3 - "$OUT/rec-pending.json" "$ID" "$s3" <<'PY' && pass "rec: recovered take is the killed one, marked interrupted, complete" || bad "rec: recovered take is the killed one, marked interrupted, complete"
import json, sys
p = json.load(open(sys.argv[1])); t = [x for x in p if x.get('id') == sys.argv[2]]
assert t and t[0]['state'] == 'interrupted' and t[0]['bytes'] >= int(sys.argv[3] or 1), p
PY
  [ "$(ev read size)" = "$(ev read bytes)" ] && [ "$(ev ack a.released)" = "true" ] && pass "rec: every byte read before release" || bad "rec: every byte read before release"
  sleep 1
  [ -z "$(adb shell run-as "$PKG" ls files/takes 2>/dev/null | tr -d '\r')" ] && pass "rec: native copy released only after ack" || bad "rec: native copy released only after ack"
  [ "$(ev unknownTake r)" = "unknown take" ] && [ "$(ev unknownMethod r)" = "unknown method" ] && pass "rec: unknown take and method refused" || bad "rec: unknown take and method refused"
  wait_ev elsewhere 20; [ "$(ev elsewhere r)" = "noreply" ] && pass "rec: same-origin page outside the shell gets no answer" || bad "rec: same-origin page outside the shell gets no answer ($(ev elsewhere r))"
  # ---- Optional floating orb (device.orb). The app allows "Display over other apps" via appops, as the owner would.
  orblog() { adb logcat -d -s ShellOrb:I 2>/dev/null; }
  orbwin() { adb shell dumpsys window windows 2>/dev/null | grep -c "WizardShellOrb" | tr -d '\r'; }
  wait_log() { for _ in $(seq 1 "$2"); do orblog | grep -q "$1" && return 0; sleep 1; done; return 1; }
  orb_xy() { # centre of the orb from its last "shown at"/"moved to" log line (64 dp square)
    local d; d=$(adb shell wm density | grep -o '[0-9]*' | tail -1)
    orblog | grep -oE "(shown at|moved to) -?[0-9]+,-?[0-9]+" | tail -1 | grep -oE -- "-?[0-9]+,-?[0-9]+" \
      | awk -F, -v d="$d" '{s=int(64*d/160+0.5); print $1+int(s/2), $2+int(s/2)}'
  }
  adb shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow
  echo up > "$FIXTURE_OUT/orb"; echo orb > "$FIXTURE_OUT/mode"
  # Cold start: the recovery page above navigated to /elsewhere/, and singleTask would just resume it.
  adb shell am force-stop "$PKG"; adb logcat -c
  adb shell am start -W -n "$ACT" >/dev/null 2>&1
  wait_ev orb 40; [ "$(ev orb r.on)" = "true" ] && pass "orb: the Wizard turns the orb on (device.orb.enable)" || bad "orb: the Wizard turns the orb on ($(ev orb r))"
  sleep 2; [ "$(orbwin)" = "0" ] && pass "orb: hidden while the Wizard app is in front" || bad "orb: hidden while the Wizard app is in front"
  adb shell input keyevent KEYCODE_HOME; sleep 1
  adb shell am start -W -a android.settings.SETTINGS >/dev/null 2>&1
  wait_log "page from Wizard" 20 && pass "orb: page from the Wizard (virtual origin, native fetch)" || bad "orb: page from the Wizard"
  sleep 1; adb shell dumpsys window windows > "$OUT/orb-windows.txt"
  [ "$(orbwin)" -ge 1 ] && adb shell dumpsys activity activities | grep -q "ResumedActivity.*com.android.settings" \
    && pass "orb: floats over another app (Settings in front)" || bad "orb: floats over another app"
  adb exec-out screencap -p > "$OUT/orb-over-settings.png" 2>/dev/null
  grep -q '"get": "/wizard-os-home/assist/everywhere.html"' "$FX" && grep -q '"get": "/wizard-os-home/orb.js"' "$FX" \
    && pass "orb: page files fetched from the selected Wizard" || bad "orb: page files fetched from the selected Wizard"

  # Tap talks (a device.recording take marked send); tap again sends.
  read -r OX OY <<< "$(orb_xy)"; echo "orb centre: $OX,$OY" >> "$OUT/result.txt"
  adb shell dumpsys input > "$OUT/orb-input.txt" 2>/dev/null
  adb shell input tap "$OX" "$OY"; sleep 4
  adb exec-out screencap -p > "$OUT/orb-after-tap.png" 2>/dev/null
  OT=$(adb shell run-as "$PKG" ls files/takes 2>/dev/null | tr -d '\r' | grep -m1 '\.aac$' | sed 's/\.aac$//')
  [ -n "$OT" ] && adb shell dumpsys activity services "$PKG" | grep -q "RecorderService" && pass "orb: tap starts a recording over another app" || bad "orb: tap starts a recording over another app"
  sleep 3; adb shell input tap "$OX" "$OY"; sleep 3
  adb shell run-as "$PKG" cat "files/takes/$OT.json" > "$OUT/orb-take.json" 2>/dev/null
  grep -q '"send":true' "$OUT/orb-take.json" && grep -q '"state":"stopped"' "$OUT/orb-take.json" \
    && pass "orb: second tap stops it for the Wizard to send" || bad "orb: second tap stops it for the Wizard to send"

  # Drag moves it and it rests on an edge.
  read -r OX OY <<< "$(orb_xy)"
  adb shell input swipe "$OX" "$OY" 300 900 600; sleep 2
  orblog | grep -q "orb moved to" && pass "orb: drag moves it" || bad "orb: drag moves it"

  # Offline: the Wizard's orb files fail (503) or answer too slowly (> 1.5 s) → the bundled copy, never blank.
  for how in down slow; do
    echo "$how" > "$FIXTURE_OUT/orb"
    orblog > "$OUT/orb-before-$how.log"; adb logcat -d > "$OUT/logcat-before-$how.txt"
    adb shell am force-stop "$PKG"; adb logcat -c
    adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 4
    adb shell input keyevent KEYCODE_HOME; sleep 1; adb shell am start -W -a android.settings.SETTINGS >/dev/null 2>&1
    want=$([ "$how" = down ] && echo "static resource unavailable" || echo "timeout")
    wait_log "page from bundle" 25 && orblog | grep -q "$want; showing the bundled copy" && [ "$(orbwin)" -ge 1 ] \
      && pass "orb: falls back to the bundled page when the Wizard is $how" || bad "orb: falls back to the bundled page when the Wizard is $how"
    orblog > "$OUT/orb-$how.log"
  done
  echo up > "$FIXTURE_OUT/orb"

  # Hold hides it, and it stays off.
  read -r OX OY <<< "$(orb_xy)"; echo "orb centre before hold: $OX,$OY" >> "$OUT/result.txt"
  adb shell input swipe "$OX" "$OY" "$OX" "$OY" 1500; sleep 2
  orblog | grep -q "orb off: hold" && [ "$(orbwin)" = "0" ] && pass "orb: hold hides it" || bad "orb: hold hides it"
  adb shell input keyevent KEYCODE_HOME; sleep 2
  [ "$(orbwin)" = "0" ] && pass "orb: stays hidden after hold" || bad "orb: stays hidden after hold"
  adb exec-out screencap -p > "$OUT/orb-hidden.png" 2>/dev/null
  cp "$FX" "$OUT/fixture.log" 2>/dev/null
fi

adb logcat -d > "$OUT/logcat.txt"
adb logcat -b crash -d > "$OUT/crash.txt"
if grep -q "$PKG" "$OUT/crash.txt" || grep -A3 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then bad "no crash"; else pass "no crash"; fi
if grep -q "ANR in $PKG" "$OUT/logcat.txt"; then bad "no ANR"; else pass "no ANR"; fi
adb exec-out screencap -p > "$OUT/final.png" 2>/dev/null
exit $fail
