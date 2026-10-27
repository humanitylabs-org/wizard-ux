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
# A fresh emulator's launcher can show "Pixel Launcher isn't responding" over everything (not this app): press Wait.
system_anr() {
  grep -q "isn.t responding" "$OUT/ui-$1.xml" 2>/dev/null && grep -q 'package="android"' "$OUT/ui-$1.xml" || return 1
  echo "NOTE system dialog over the screen ($1): $(grep -o 'text="[^"]*isn.t responding"' "$OUT/ui-$1.xml"); pressing Wait" >> "$OUT/result.txt"
  tap_text "$1" "Wait"; sleep 2; return 0
}
wait_for() { # <name> <text> <seconds>
  for _ in $(seq 1 "$3"); do dump "$1"; has "$1" "$2" && return 0; system_anr "$1"; sleep 1; done; return 1
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
  # Windows that are really on screen. (Settings hides every non-system overlay, so another app is used below.)
  orbwin() { adb shell dumpsys window windows 2>/dev/null | awk '/Window #[0-9]+ Window\{.*WizardShellOrb/{o=1} o&&/isVisible=/{print; o=0}' | grep -c "isVisible=true" | tr -d '\r'; }
  other_app() { # a normal app in front (the Dialer; the launcher if there is none)
    adb shell am start -W -a android.intent.action.DIAL >/dev/null 2>&1 || adb shell input keyevent KEYCODE_HOME
    sleep 2; adb shell dumpsys activity activities | grep -m1 "ResumedActivity" | tee -a "$OUT/result.txt" >/dev/null
  }
  wait_log() { for _ in $(seq 1 "$2"); do orblog | grep -qE "$1" && return 0; sleep 1; done; return 1; }
  orb_xy() { # 64dp orb stays at the right of the real input frame; recording controls extend to its left
    adb shell dumpsys input 2>/dev/null | grep -m1 "WizardShellOrb', id=" | grep -oE "touchableRegion=\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]" \
      | grep -oE "[0-9]+" | paste -sd' ' | awk '{print int($3-($4-$2)/2), int(($2+$4)/2)}'
  }
  control_xy() { # Cancel=1 or Pause/Resume=3: centres of the two web buttons, never the orb's send target
    adb shell dumpsys input 2>/dev/null | grep -m1 "WizardShellOrb', id=" | grep -oE "touchableRegion=\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]" \
      | grep -oE "[0-9]+" | paste -sd' ' | awk -v n="$1" '{print int($1+n*($3-$1-($4-$2))/4), int(($2+$4)/2)}'
  }
  take_bytes() { adb shell run-as "$PKG" stat -c %s "files/takes/$1.aac" 2>/dev/null | tr -d '\r'; }
  # Seconds from "orb shown" to "page from bundle" in the current log: the fallback must be prompt, never blank.
  fallback_s() { orblog | python3 -c '
import re, sys, datetime
t = {}
for l in sys.stdin:
    m = re.match(r"\S+ (\S+) .*ShellOrb: (orb shown|page from bundle)", l)
    if m and m.group(2) not in t: t[m.group(2)] = datetime.datetime.strptime(m.group(1), "%H:%M:%S.%f")
print(round((t["page from bundle"] - t["orb shown"]).total_seconds(), 2) if len(t) == 2 else 99)'; }
  adb shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow
  echo up > "$FIXTURE_OUT/orb"; echo orb > "$FIXTURE_OUT/mode"
  # Cold start: the recovery page above navigated to /elsewhere/, and singleTask would just resume it.
  adb shell am force-stop "$PKG"; adb logcat -c
  adb shell am start -W -n "$ACT" >/dev/null 2>&1
  wait_ev orb 40; [ "$(ev orb r.on)" = "true" ] && pass "orb: the Wizard turns the orb on (device.orb.enable)" || bad "orb: the Wizard turns the orb on ($(ev orb r))"
  sleep 2; [ "$(orbwin)" = "0" ] && pass "orb: hidden while the Wizard app is in front" || bad "orb: hidden while the Wizard app is in front"
  adb shell input keyevent KEYCODE_HOME; sleep 1
  other_app
  # A cold CI renderer can miss the unchanged 1.5 s deadline on its first load (#323). The gate stays strict; a miss
  # is retried with a fresh process (at most 3 attempts) and the attempt count is reported.
  for attempt in 1 2 3; do
    wait_log "page from (Wizard|bundle)" 20; orblog | grep -q "page from Wizard" && break
    orblog > "$OUT/orb-remote-attempt-$attempt.log"
    [ "$attempt" = 3 ] && break
    adb shell am force-stop "$PKG"; adb logcat -c; adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 3
    adb shell input keyevent KEYCODE_HOME; sleep 1; other_app
  done
  echo "orb remote page attempts: $attempt" >> "$OUT/result.txt"
  orblog | grep -q "page from Wizard" && pass "orb: page from the Wizard (virtual origin, native fetch)" || bad "orb: page from the Wizard"
  sleep 1; adb shell dumpsys window windows > "$OUT/orb-windows.txt"
  [ "$(orbwin)" -ge 1 ] && ! adb shell dumpsys activity activities | grep -m1 "ResumedActivity" | grep -q "$PKG" \
    && pass "orb: visible over another app" || bad "orb: visible over another app"
  adb exec-out screencap -p > "$OUT/orb-over-app.png" 2>/dev/null
  grep -q '"get": "/wizard-os-home/assist/everywhere.html"' "$FX" && grep -q '"get": "/wizard-os-home/orb.js"' "$FX" \
    && pass "orb: page files fetched from the selected Wizard" || bad "orb: page files fetched from the selected Wizard"

  # Tap talks (a device.recording take marked send); tap again sends.
  read -r OX OY <<< "$(orb_xy)"; echo "orb centre: $OX,$OY" >> "$OUT/result.txt"
  adb shell dumpsys input > "$OUT/orb-input.txt" 2>/dev/null
  adb shell input tap "$OX" "$OY"; sleep 4
  adb exec-out screencap -p > "$OUT/orb-after-tap.png" 2>/dev/null
  OT=$(orblog | grep 'orb take .* recording' | tail -1 | awk '{print $(NF-1)}')
  [ -n "$OT" ] && adb shell dumpsys activity services "$PKG" | grep -q "RecorderService" && pass "orb: tap starts a recording over another app" || bad "orb: tap starts a recording over another app"
  read -r PX PY <<< "$(control_xy 3)"; adb shell input tap "$PX" "$PY"; sleep 1
  B1=$(take_bytes "$OT"); sleep 2; B2=$(take_bytes "$OT")
  [ -n "$B1" ] && [ "$B1" = "$B2" ] && [ "$(orbwin)" -ge 1 ] \
    && pass "orb: web Pause freezes audio while controls remain visible" || bad "orb: web Pause freezes audio"
  adb exec-out screencap -p > "$OUT/orb-paused.png" 2>/dev/null
  adb shell input tap "$PX" "$PY"; sleep 2; B3=$(take_bytes "$OT")
  [ "${B3:-0}" -gt "${B2:-0}" ] && pass "orb: web Resume continues the same take" || bad "orb: web Resume continues the same take"
  read -r OX OY <<< "$(orb_xy)"; adb shell input swipe "$OX" "$OY" "$OX" "$OY" 1500; sleep 1
  B1=$(take_bytes "$OT"); sleep 2; B2=$(take_bytes "$OT")
  [ -n "$B1" ] && [ "$B1" = "$B2" ] && [ "$(orbwin)" -ge 1 ] \
    && pass "orb: hold pauses, never hides a live take" || bad "orb: hold pauses without hiding"
  adb shell input tap "$PX" "$PY"; sleep 1
  read -r OX OY <<< "$(orb_xy)"; adb shell input tap "$OX" "$OY"; sleep 3
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
    adb shell input keyevent KEYCODE_HOME; sleep 1; other_app
    # Down → a refused resource; slow → the 4 s answer outlives the native fetch window or the 1.5 s page deadline.
    wait_log "page from bundle" 25; secs=$(fallback_s); echo "orb fallback ($how): ${secs}s" >> "$OUT/result.txt"
    orblog | grep -qE "(static resource unavailable|timeout); showing the bundled copy" && ! orblog | grep -q "page from Wizard" \
      && python3 -c "import sys; sys.exit(0 if float('$secs') <= 4.0 else 1)" && [ "$(orbwin)" -ge 1 ] \
      && pass "orb: falls back to the bundled page within 4 s when the Wizard is $how" || bad "orb: falls back to the bundled page when the Wizard is $how"
    orblog > "$OUT/orb-$how.log"
  done
  echo up > "$FIXTURE_OUT/orb"

  # The offline APK page must offer usable controls too. Cancel stops a take, never sends it.
  read -r OX OY <<< "$(orb_xy)"; adb shell input tap "$OX" "$OY"; sleep 3
  CT=$(orblog | grep 'orb take .* recording' | tail -1 | awk '{print $(NF-1)}')
  CB=$(take_bytes "$CT")
  read -r CX CY <<< "$(control_xy 1)"; adb shell input tap "$CX" "$CY"; sleep 2
  adb shell run-as "$PKG" cat "files/takes/$CT.json" > "$OUT/orb-cancelled.json" 2>/dev/null || true
  [ -n "$CT" ] && [ "${CB:-0}" -gt 0 ] && ! adb shell dumpsys activity services "$PKG" | grep -q 'ServiceRecord{.*RecorderService' \
    && ! grep -q '"send":true' "$OUT/orb-cancelled.json" \
    && { [ ! -s "$OUT/orb-cancelled.json" ] || grep -q '"state":"cancelled"' "$OUT/orb-cancelled.json"; } \
    && pass "orb: bundled Cancel stops without sending" || bad "orb: bundled Cancel stops without sending"
  # Idle hold no longer disables the owner's Everywhere setting.
  read -r OX OY <<< "$(orb_xy)"; echo "orb centre before hold: $OX,$OY" >> "$OUT/result.txt"
  adb shell input swipe "$OX" "$OY" "$OX" "$OY" 1500; sleep 2
  ! orblog | grep -q "orb off: hold" && [ "$(orbwin)" -ge 1 ] && pass "orb: idle hold keeps it visible" || bad "orb: idle hold keeps it visible"
  adb shell input keyevent KEYCODE_HOME; sleep 2
  [ "$(orbwin)" -ge 1 ] && pass "orb: stays enabled after hold" || bad "orb: stays enabled after hold"
  adb exec-out screencap -p > "$OUT/orb-after-hold.png" 2>/dev/null

  # ---- Settings → Phone → Wizard Everywhere is the orb's one switch (the real web/core/settings.js + device-orb.js).
  resumed() { adb shell dumpsys activity activities | grep -m1 "ResumedActivity" | tr -d '\r'; }
  # Tap a page element the fixture reported (CSS px centre + devicePixelRatio) at its real screen position.
  web_tap() { # <ui-dump-name> <ev> [filter-key=value]
    dump "$1"; python3 - "$OUT/ui-$1.xml" "$FX" "$2" "${3:-}" <<'PY' > "$OUT/tap-$1.txt"
import json, re, sys
xml, fx, want, flt = open(sys.argv[1]).read(), sys.argv[2], sys.argv[3], sys.argv[4]
wv = re.search(r'class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
for line in reversed(open(fx).read().splitlines()):
    try: e = json.loads(line)
    except ValueError: continue
    if e.get('ev') != want or 'x' not in e: continue
    if flt and str(e.get(flt.split('=')[0])) != flt.split('=', 1)[1]: continue
    x0, y0 = (int(wv.group(1)), int(wv.group(2))) if wv else (0, 0)
    print(int(x0 + e['x'] * e['dpr']), int(y0 + e['y'] * e['dpr'])); break
PY
    read -r TX TY < "$OUT/tap-$1.txt"; echo "tap $2: $TX,$TY" >> "$OUT/result.txt"
    [ -n "${TX:-}" ] && adb shell input tap "$TX" "$TY"
  }
  echo everywhere > "$FIXTURE_OUT/mode"
  adb shell am force-stop "$PKG"; adb logcat -c
  adb shell am start -W -n "$ACT" >/dev/null 2>&1
  wait_ev everywhere 40; ev everywhere > "$OUT/everywhere.json"
  [ "$(ev everywhere ready)" = "true" ] && [ "$(ev everywhere switches)" = "1" ] && [ "$(ev everywhere orbRows)" = "0" ] && [ "$(ev everywhere dead)" = "0" ] \
    && pass "everywhere: Settings shows one Wizard Everywhere switch (no duplicate orb row, no full-app-only rows)" || bad "everywhere: one switch in Settings ($(cat "$OUT/everywhere.json"))"
  [ "$(ev everywhere on)" = "false" ] && pass "everywhere: off after the orb was held away" || bad "everywhere: off after the orb was held away"
  sleep 1; web_tap everywhere everywhere
  for _ in $(seq 1 15); do [ "$(ev everywhere-switch on)" = "true" ] && break; sleep 1; done
  [ "$(ev everywhere-switch on)" = "true" ] && [ "$(ev everywhere-switch checked)" = "true" ] \
    && pass "everywhere: a tap on the switch turns the floating orb on" || bad "everywhere: a tap on the switch turns the floating orb on"
  sleep 1; [ "$(orbwin)" = "0" ] && pass "everywhere: orb hidden while Wizard is in front" || bad "everywhere: orb hidden while Wizard is in front"
  adb shell input keyevent KEYCODE_HOME; sleep 1; other_app; sleep 3
  [ "$(orbwin)" -ge 1 ] && pass "everywhere: turning it on in Settings shows the orb over another app" || bad "everywhere: turning it on in Settings shows the orb over another app"
  adb exec-out screencap -p > "$OUT/everywhere-orb-over-app.png" 2>/dev/null

  # ---- Home-screen apps (window.wizardHomeScreenPort, the real web/core/home-screen-apps.js sheet).
  echo pin > "$FIXTURE_OUT/mode"
  adb shell am force-stop "$PKG"; adb logcat -c
  adb shell am start -W -n "$ACT" >/dev/null 2>&1
  wait_ev untapped 40
  [ "$(ev untapped status)" = "error" ] && pass "pin: a pin request without a tap is refused" || bad "pin: a pin request without a tap is refused ($(ev untapped status))"
  for _ in $(seq 1 20); do [ "$(ev sheet text)" = "Add to home screen" ] && break; sleep 1; done
  [ "$(ev sheet text)" = "Add to home screen" ] && pass "pin: the shell offers Add to home screen (status ready over the port)" || bad "pin: offered ($(ev sheet text))"
  sleep 1; web_tap pinsheet sheet "text=Add to home screen"
  # The launcher asks the owner; accept as he would.
  ok=""
  for _ in $(seq 1 15); do
    dump launcher
    b=$(python3 - "$OUT/ui-launcher.xml" <<'PY'
import re, sys
hits = []
for m in re.finditer(r'<node [^>]*>', open(sys.argv[1]).read()):
    n = m.group(0)
    if 'package="ai.wizards.shell' in n: continue
    t = re.search(r'text="([^"]*)"', n).group(1).lower()
    if t in ('add to home screen', 'add automatically', 'add'):
        x1, y1, x2, y2 = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups())
        hits.append(('clickable="true"' not in n and 'Button' not in n, (x1 + x2) // 2, (y1 + y2) // 2))
if hits: _, x, y = sorted(hits)[0]; print(x, y)  # the dialog's button, not its title
PY
)
    if [ -n "$b" ]; then ok=1; adb shell input tap $b; break; fi; sleep 1
  done
  [ -n "$ok" ] && pass "pin: Android's add-to-home-screen dialog is offered" || bad "pin: Android's add-to-home-screen dialog is offered"
  for _ in $(seq 1 15); do [ "$(ev sheet text)" = "Added to home screen" ] && break; sleep 1; done
  [ "$(ev sheet text)" = "Added to home screen" ] && pass "pin: the sheet confirms once the launcher added it" || bad "pin: the sheet confirms ($(ev sheet text))"
  adb shell dumpsys shortcut > "$OUT/pin-shortcuts.txt" 2>/dev/null
  grep -q "homeapp-" "$OUT/pin-shortcuts.txt" && pass "pin: pinned shortcut created" || bad "pin: pinned shortcut created"
  adb shell run-as "$PKG" cat shared_prefs/home-screen-pins.xml 2>/dev/null | grep -q ':confirmed" value="true"' \
    && pass "pin: launcher confirmation received (PinConfirmed)" || bad "pin: launcher confirmation received"

  # Launch it from the home screen: its own task opens just that app on the selected Wizard.
  adb shell input keyevent KEYCODE_HOME; sleep 2
  launched=""
  for _ in 1 2 3; do dump home; tap_text home "QA App" && { launched=icon; break; }; sleep 2; done
  if [ -z "$launched" ]; then
    # Not on the visible home page: start the shortcut's exact intent (same component and task URI).
    U=$(python3 -c "import hashlib;print('wizard-homeapp://$PKG/homeapp-'+hashlib.sha256(b'https://10.0.2.2:8443\nqa-app').hexdigest()+'?app=qa-app')")
    adb shell am start -W -a android.intent.action.VIEW -d "'$U'" -n "$PKG/ai.wizards.shell.home.AppSessionActivity" >/dev/null 2>&1 && launched=intent
  fi
  echo "pinned app launched by: $launched" >> "$OUT/result.txt"
  wait_ev session 30
  [ "$(ev session app)" = "qa-app" ] && pass "pin: launching it opens that app's session on the selected Wizard" || bad "pin: launching it opens that app ($(ev session))"
  [ "$(ev session devicePort)" = "false" ] && [ "$(ev session homePort)" = "false" ] && pass "pin: the pinned app gets no device or pin port" || bad "pin: the pinned app gets no device or pin port"
  resumed | tee -a "$OUT/result.txt" | grep -q "AppSessionActivity" && pass "pin: runs in its own app task" || bad "pin: runs in its own app task"
  sleep 2; [ "$(orbwin)" -ge 1 ] && pass "pin: the floating orb stays over a pinned app" || bad "pin: the floating orb stays over a pinned app"
  adb exec-out screencap -p > "$OUT/pin-app.png" 2>/dev/null
  adb shell input keyevent KEYCODE_BACK; sleep 2
  resumed | grep -q "AppSessionActivity" && adb shell pidof "$PKG" >/dev/null && pass "pin: Back stays inside the pinned app" || bad "pin: Back stays inside the pinned app"
  n1=$(grep -c '"ev": "session"' "$FX")
  adb shell input keyevent KEYCODE_HOME; sleep 1
  adb shell am start -W -a android.intent.action.VIEW -d "'$(python3 -c "import hashlib;print('wizard-homeapp://$PKG/homeapp-'+hashlib.sha256(b'https://10.0.2.2:8443\nqa-app').hexdigest()+'?app=qa-app')")'" -n "$PKG/ai.wizards.shell.home.AppSessionActivity" >/dev/null 2>&1; sleep 3
  n2=$(grep -c '"ev": "session"' "$FX")
  tasks=$(adb shell dumpsys activity activities | grep -c "A=.*ai.wizards.shell.test.homeapp")
  echo "session loads: $n1 -> $n2; homeapp tasks: $tasks" >> "$OUT/result.txt"
  resumed | grep -q "AppSessionActivity" && [ "$n1" -ge 1 ] && [ "$n2" = "$n1" ] && pass "pin: opening it again resumes the same task (no reload)" || bad "pin: opening it again resumes the same task"
  bogus="wizard-homeapp://$PKG/homeapp-0000?app=qa-app"
  adb shell am start -W -a android.intent.action.VIEW -d "'$bogus'" -n "$PKG/ai.wizards.shell.home.AppSessionActivity" >/dev/null 2>&1; sleep 3
  dump bogus; has bogus "App unavailable" && pass "pin: an edited shortcut opens nothing of the Wizard" || bad "pin: an edited shortcut opens nothing of the Wizard"

  # ---- Saved Wizards: each Wizard that answered is remembered; one tap switches; a long press removes one.
  # A second origin for the same fixture: https://127.0.0.1:8443 (in its certificate) through adb reverse.
  adb reverse tcp:8443 tcp:8443 >/dev/null
  FXA="https://10.0.2.2:8443"; FXB="https://127.0.0.1:8443"
  echo idle > "$FIXTURE_OUT/mode"
  sprefs() { # <name>: the shell's saved origin and list, as "origin|a,b"
    adb shell run-as "$PKG" cat shared_prefs/shell.xml 2>/dev/null > "$OUT/prefs-$1.xml"
    python3 - "$OUT/prefs-$1.xml" <<'PY'
import sys, xml.etree.ElementTree as ET
try: r = ET.parse(sys.argv[1]).getroot()
except Exception: print('|'); sys.exit()
v = {e.get('name'): (e.text or '') for e in r.findall('string')}
print(v.get('origin', '') + '|' + ','.join(x for x in v.get('wizards', '').split('\n') if x))
PY
  }
  wait_prefs() { for _ in $(seq 1 "$2"); do [ "$(sprefs wait)" = "$1" ] && return 0; sleep 1; done; return 1; }
  long_press() { # <dump-name> <text>
    local b; b=$(python3 - "$OUT/ui-$1.xml" "$2" <<'PY'
import re, sys
for m in re.finditer(r'<node [^>]*>', open(sys.argv[1]).read()):
    if f'text="{sys.argv[2]}"' in m.group(0):
        x1, y1, x2, y2 = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', m.group(0)).groups())
        print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
    [ -n "$b" ] && adb shell input swipe $b $b 1200
  }
  adb shell am start -W -a android.intent.action.VIEW -d "wizard://connect?origin=https%3A%2F%2F127.0.0.1%3A8443" "$PKG" >/dev/null 2>&1
  wait_for sw-list "Your Wizards" 15 && has sw-list 'text="10.0.2.2:8443"' && ! has sw-list 'text="wizard"' \
    && pass "switch: Connect lists the Wizard that answered, not the one that never did" || bad "switch: Connect lists saved Wizards"
  has sw-list 'text="Current"' && pass "switch: the current Wizard is marked" || bad "switch: the current Wizard is marked"
  tap_text sw-list "Connect"
  wait_prefs "$FXB|$FXB,$FXA" 40 && pass "switch: a newly connected Wizard is saved at the top" || bad "switch: newly connected Wizard saved ($(sprefs b))"
  adb shell dumpsys shortcut > "$OUT/switch-shortcuts.txt" 2>/dev/null
  grep -q "Switch to 10.0.2.2:8443" "$OUT/switch-shortcuts.txt" && grep -q "change-wizard" "$OUT/switch-shortcuts.txt" \
    && pass "switch: launcher long-press offers the other saved Wizard" || bad "switch: launcher long-press offers the other saved Wizard"

  # One tap on a saved Wizard switches to it (fresh page, connect screen gone).
  adb shell am start -W -a ai.wizards.shell.CHANGE_WIZARD -n "$ACT" >/dev/null 2>&1
  wait_for sw-pick 'text="10.0.2.2:8443"' 15; tap_text sw-pick "10.0.2.2:8443"
  wait_prefs "$FXA|$FXA,$FXB" 20 && pass "switch: one tap switches to a saved Wizard" || bad "switch: one tap switches ($(sprefs a))"
  sleep 5; dump sw-after; ! has sw-after "Connect to your Wizard" && pass "switch: the chosen Wizard opens" || bad "switch: the chosen Wizard opens"

  # Another app can't switch Wizards: a switch without this install's shortcut key only opens Connect.
  adb shell am start -W -a ai.wizards.shell.SWITCH_WIZARD --es origin "$FXB" -n "$ACT" >/dev/null 2>&1; sleep 3
  dump sw-forged; [ "$(sprefs forged)" = "$FXA|$FXA,$FXB" ] && has sw-forged "Connect to your Wizard" \
    && pass "switch: a forged switch intent changes nothing" || bad "switch: a forged switch intent changes nothing"

  # Long press: the current one stays (with a note); another one is removed after a confirmation.
  long_press sw-forged "10.0.2.2:8443"; sleep 2; dump sw-keep
  has sw-keep "the Wizard you.re using" && [ "$(sprefs keep)" = "$FXA|$FXA,$FXB" ] && pass "switch: the current Wizard can't be removed" || bad "switch: the current Wizard can't be removed"
  long_press sw-keep "127.0.0.1:8443"
  wait_for sw-ask "from this list" 10 && tap_text sw-ask "Remove"
  wait_prefs "$FXA|$FXA" 10 && { sleep 1; dump sw-gone; ! has sw-gone 'text="127.0.0.1:8443"'; } \
    && pass "switch: long press removes a saved Wizard" || bad "switch: long press removes a saved Wizard ($(sprefs gone))"

  # No switch while a take is recording for the current Wizard: it must be finished there first.
  adb shell am start -W -a android.intent.action.VIEW -d "wizard://connect?origin=https%3A%2F%2F127.0.0.1%3A8443" "$PKG" >/dev/null 2>&1
  wait_for sw-b2 "Your Wizards" 15; tap_text sw-b2 "Connect"; wait_prefs "$FXB|$FXB,$FXA" 40
  n0=$(grep -c '"ev": "started"' "$FX"); echo record > "$FIXTURE_OUT/mode"
  adb shell am start -W -a ai.wizards.shell.CHANGE_WIZARD -n "$ACT" >/dev/null 2>&1
  wait_for sw-rec 'text="10.0.2.2:8443"' 15; tap_text sw-rec "10.0.2.2:8443"
  for _ in $(seq 1 40); do [ "$(grep -c '"ev": "started"' "$FX")" -gt "$n0" ] && break; sleep 1; done
  sleep 2; adb shell dumpsys activity services "$PKG" | grep -q "RecorderService" && pass "switch: the switched-to Wizard records" || bad "switch: the switched-to Wizard records"
  adb shell am start -W -a ai.wizards.shell.CHANGE_WIZARD -n "$ACT" >/dev/null 2>&1
  wait_for sw-busy 'text="127.0.0.1:8443"' 15; tap_text sw-busy "127.0.0.1:8443"; sleep 2; dump sw-busy2
  has sw-busy2 "A recording is still going" && [ "$(sprefs busy | cut -d'|' -f1)" = "$FXA" ] \
    && pass "switch: refused while a recording is going" || bad "switch: refused while a recording is going ($(sprefs busy))"
  adb shell am force-stop "$PKG"; echo idle > "$FIXTURE_OUT/mode"
  cp "$FX" "$OUT/fixture.log" 2>/dev/null
fi

adb logcat -d > "$OUT/logcat.txt"
adb logcat -b crash -d > "$OUT/crash.txt"
if grep -q "$PKG" "$OUT/crash.txt" || grep -A3 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then bad "no crash"; else pass "no crash"; fi
if grep -q "ANR in $PKG" "$OUT/logcat.txt"; then bad "no ANR"; else pass "no ANR"; fi
adb exec-out screencap -p > "$OUT/final.png" 2>/dev/null
exit $fail
