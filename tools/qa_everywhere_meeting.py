"""Floating orb / side button borrowing a recording meeting's microphone (Thales emulator, called by qa_mizel.py).

Real adb taps on the real floating orb and the real side-button activity; the meeting runs the synthetic QA mic,
voice takes use staged canned audio (debug-only hooks) or the emulator recorder. All HTTP goes to qa_mizel.py's fake
server (files/qa_origin.txt + files/qa_home.txt), never to a real Wizard or Mizel.

Scenarios (James, 18 Oct 2026: "the mic needs to be passed over to the blue orb for speech-to-text and then passed
back", "it could be noted that I did that there and what was said"):
  dictate   meeting recording → orb over a keyboard → voice typing typed into another app → meeting resumed before
            transcription finished → "Voice typing into <app> · <words>" marker saved on the meeting
  ask       meeting recording → orb tap on the home screen → asked Wizard → meeting resumed → "Asked" marker with
            thread link (status sent, deliveryKey = the run's Idempotency-Key)
  cancel    orb Cancel during a loan → meeting resumed, marker cancelled
  manual    meeting paused by the owner first → loan → still paused afterwards (pausedByHandoff false)
  stopped   meeting stopped from its notification during the loan → never restarted; the take is still sent
  side      side button during a meeting → same loan contract
  reverse   meeting start refused while the orb holds the mic
"""
import json
import re
import time


def run(pg, sx, sh, top, check, save, shot, PKG, ST, LOCK, FAKE, mz, open_host, tap_note_action, ADB, S, job):
    G = 'loan'

    def mlog(pat, n=12):
        return sx(f'logcat -d -s WizardMizel:* | grep -E "{pat}" | tail -{n}').strip()

    def elog(pat, n=8):
        return sx(f'logcat -d -s WizardEverywhere:* | grep -E "{pat}" | tail -{n}').strip()

    def wait_for(fn, secs, step=0.5):
        t0 = time.time()
        while time.time() - t0 < secs:
            v = fn()
            if v: return v
            time.sleep(step)
        return fn()

    def bubble():
        for blk in sx('dumpsys window windows').split('Window #')[1:]:
            if 'WizardEverywhere' in blk.split('\n', 1)[0]:
                m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
                if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
        return None

    def controls():
        out = {}
        for blk in sx('dumpsys window windows').split('Window #')[1:]:
            head = blk.split('\n', 1)[0]
            m0 = re.search(r'WizOrbCtl-(\w+)', head)
            if not m0: continue
            m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
            if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: out[m0.group(1)] = tuple(map(int, m.groups()))
        return out

    def tap(b): sx(f'input tap {(b[0] + b[2]) // 2} {(b[1] + b[3]) // 2}')

    def events(mid):
        with LOCK: return [dict(e) for e in ST['orb'].values() if e['meetingId'] == mid]

    def event(mid, pred=lambda e: True):
        ev = events(mid)
        return next((e for e in ev if pred(e)), None)

    def media(line):
        m = re.search(r'media_ms=(\d+)', line or '')
        return int(m.group(1)) if m else None

    def stage(name='qa_next.m4a'):
        sx(f'run-as {PKG} cp /data/local/tmp/qa_loan_voice.m4a files/{name}')

    def back_to_host():
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(2.5)
        assert open_host()

    def start_meeting(mid, secs=6):
        back_to_host()
        r = mz('start', mid)
        assert r and r.get('ok') is not False, r
        pg.pump(secs)

    def stop_meeting(mid):
        back_to_host()
        mz('stop')
        return wait_for(lambda: ST['stops'].get(mid), 40, 1)

    def home():
        sx('input keyevent KEYCODE_HOME'); time.sleep(2.5)

    # QA plumbing: canned speech for the orb; outbox, transcription and meeting markers all go to the fake (files/qa_origin.txt).
    aiff = job / 'loan.aiff'; m4a = job / 'qa_loan_voice.m4a'
    sh('say', '-o', aiff, 'Meet me at the station at five.')
    sh('afconvert', '-f', 'm4af', '-d', 'aac', aiff, m4a)
    sh(ADB, '-s', S, 'push', m4a, '/data/local/tmp/qa_loan_voice.m4a')
    sx('settings put secure show_ime_with_hard_keyboard 1')
    sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow')
    sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService')
    sx('settings put secure accessibility_enabled 1')
    back_to_host()
    pg.ev("window.WizardOSNative.setEverywhere(true)"); time.sleep(2)

    # ------------------------------------------------ dictate: voice typing into another app
    A = 'qa_loan_dictate'
    start_meeting(A)
    opened = None
    for cmd in ['am start -W -a android.intent.action.SENDTO -d sms:5551234',
                'am start -W -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact']:
        sx(cmd); time.sleep(3.5)
        xml = sx('uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml')
        for m in re.finditer(r'<node [^>]*?class="android.widget.EditText"[^>]*?>', xml):
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', m.group(0))
            if b: tap(tuple(map(int, b.groups()))); break
        time.sleep(2.5)
        if 'mInputShown=true' in sx('dumpsys input_method') or 'keyboard open' in elog('keyboard open'):
            opened = cmd; break
        sx('input keyevent KEYCODE_BACK'); sx('input keyevent KEYCODE_BACK'); time.sleep(1)
    check(G, 'dictate: another app has a text field with the keyboard up while the meeting records', opened, top())
    wait_for(lambda: 'placed over keyboard' in elog('placed over keyboard'), 8)
    time.sleep(1.5)
    b = wait_for(bubble, 10)
    stage(); sx('logcat -c')
    with LOCK: ST['tx_delay'] = 6; tx_before = ST['tx']
    t_tap = time.time()
    if b: tap(b)
    lis = wait_for(lambda: elog('listening'), 6)
    check(G, 'dictate: orb tap starts voice typing with the meeting lent (not refused)',
          'voice typing' in lis and 'meeting paused for orb-' in lis and 'refused' not in elog('refused'), lis)
    paused = wait_for(lambda: mlog(f'paused {A} '), 6)
    shot('loan-01-dictating')
    # Resume must not wait for transcription: the fake holds the transcript for 6 s.
    resumed_at = None
    t0 = time.time()
    while time.time() - t0 < 25:
        if mlog(f'resumed {A} '): resumed_at = time.time(); break
        time.sleep(0.4)
    with LOCK: tx_done = [t for t in ST['tx_done'] if t > t_tap]
    check(G, 'dictate: meeting resumed as soon as the take was kept, before transcription returned',
          resumed_at is not None and (not tx_done or resumed_at < tx_done[0]),
          {'resumed_after_tap_s': resumed_at and round(resumed_at - t_tap, 1), 'transcript_after_tap_s': tx_done and round(tx_done[0] - t_tap, 1)})
    resumed = mlog(f'resumed {A} ')
    check(G, 'dictate: meeting media clock frozen during the loan (paused media_ms = resumed media_ms)',
          media(paused) is not None and media(paused) == media(resumed), {'paused': paused, 'resumed': resumed})
    typed = wait_for(lambda: elog('dictation (typed|copied)'), 30)
    time.sleep(1.5)
    ui = sx('uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml')
    shot('loan-02-typed')
    check(G, 'dictate: the words are typed into the other app', 'dictation typed' in typed and 'Meeting loan QA words' in ui, typed)
    with LOCK: runs = list(ST['wruns'])
    check(G, 'dictate: voice typing sends nothing to Wizard', not runs, runs)
    ev = wait_for(lambda: event(A, lambda e: e['status'] == 'local' and 'Meeting loan QA words' in e.get('question', '')), 30)
    check(G, 'dictate: meeting marker saved: "Voice typing into <app> · <words>" (status local, kind dictation)',
          ev and ev['question'].startswith('Voice typing') and ev.get('kind') == 'dictation' and ev['captureId'] == 'native-' + A, ev)
    vA = stop_meeting(A)
    with LOCK: ch = sorted(ST['chunks'].get(A, {}).items())
    spans = [(s, c['start_ms'], c['dur_ms']) for s, c in ch]
    contiguous = [s for s, _, _ in spans] == list(range(len(spans))) and all(abs(b2[1] - a2[1] - a2[2]) <= 1 for a2, b2 in zip(spans, spans[1:]))
    check(G, 'dictate: meeting audio before and after the loan is one contiguous recording (the dictation is not in it)',
          vA and contiguous and ev and any(abs(st + d - ev['atMediaMs']) <= 1 for _, st, d in spans), {'chunks': spans[:12], 'atMediaMs': ev and ev['atMediaMs']})

    # ------------------------------------------------ ask: orb tap on the home screen
    B = 'qa_loan_ask'
    start_meeting(B); home()
    b = wait_for(bubble, 10); stage(); sx('logcat -c')
    with LOCK: ST['tx_delay'] = 0; runs_before = len(ST['wruns'])
    if b: tap(b)
    lis = wait_for(lambda: elog('listening'), 6)
    check(G, 'ask: orb tap during a meeting records an ask with the meeting lent', 'meeting paused for orb-' in lis and 'voice typing' not in lis, lis)
    check(G, 'ask: meeting resumes once the take is kept', bool(wait_for(lambda: mlog(f'resumed {B} '), 15)), mlog(B))
    ev = wait_for(lambda: event(B, lambda e: e['status'] == 'sent'), 40)
    with LOCK: run = ST['wruns'][runs_before] if len(ST['wruns']) > runs_before else None
    check(G, 'ask: marker is "Asked" with the thread link and the run\'s own delivery key',
          ev and run and ev.get('threadId') == run['body'].get('session_id') and ev.get('deliveryKey') == run['key'] and 'Meeting loan QA words' in ev.get('question', ''),
          {'event': ev, 'run': run and {'key': run['key'], 'session': run['body'].get('session_id')}})
    stop_meeting(B)

    # ------------------------------------------------ cancel during the loan
    C = 'qa_loan_cancel'
    start_meeting(C); home()
    b = wait_for(bubble, 10); sx('logcat -c')   # no staged audio: the recorder keeps listening until Cancel
    if b: tap(b)
    time.sleep(1.5)
    cc = controls()
    if 'cancel' in cc: tap(cc['cancel'])
    time.sleep(1.5)
    check(G, 'cancel: Cancel ends the take and the meeting resumes', 'cancelled' in elog('cancelled') and bool(wait_for(lambda: mlog(f'resumed {C} '), 10)),
          {'controls': list(cc), 'log': elog('cancelled|listening')})
    ev = wait_for(lambda: event(C, lambda e: e['status'] == 'cancelled'), 20)
    check(G, 'cancel: marker saved as a cancelled interruption', ev is not None, events(C))
    stop_meeting(C)

    # ------------------------------------------------ meeting paused by the owner first stays paused
    D = 'qa_loan_manual'
    start_meeting(D); mz('pause'); pg.pump(1); home()
    b = wait_for(bubble, 10); stage(); sx('logcat -c')
    if b: tap(b)
    lis = wait_for(lambda: elog('listening'), 6)
    time.sleep(8)
    ev = wait_for(lambda: event(D, lambda e: e['status'] in ('queued', 'sent')), 30)
    check(G, 'manual: a meeting paused before the loan stays paused afterwards',
          'meeting paused for orb-' in lis and not mlog(f'resumed {D} ') and ev and ev.get('pausedByHandoff') is False,
          {'listen': lis, 'event': ev, 'resumed': mlog(f'resumed {D} ')})
    back_to_host(); st = mz('status')
    check(G, 'manual: Mizel still reports the meeting paused', (st.get('status') or {}).get('paused') is True, st)
    mz('stop'); wait_for(lambda: ST['stops'].get(D), 40, 1)

    # ------------------------------------------------ meeting stopped during the loan is never restarted
    E = 'qa_loan_stopped'
    start_meeting(E); home()
    b = wait_for(bubble, 10); sx('logcat -c')
    if b: tap(b)
    time.sleep(2)
    st_tap = tap_note_action('Recording meeting', 'Stop', 'loan-03-stop-during-loan')
    got = wait_for(lambda: ST['stops'].get(E), 40, 1)
    with LOCK: n_at_stop = len(ST['chunks'].get(E, {}))
    b = wait_for(bubble, 6)
    if b and 'listening' in elog('listening'): tap(b)   # send what was said
    time.sleep(6)
    with LOCK: n_after = len(ST['chunks'].get(E, {}))
    check(G, 'stopped: Stop during the loan ends the meeting and the loan never restarts it',
          st_tap and got and not mlog(f'resumed {E} ') and not mlog(f'recording {E} from seq') and n_after == n_at_stop,
          {'stop': got and got['body'], 'chunks_at_stop': n_at_stop, 'after': n_after, 'loan': mlog('returned')})
    ev = wait_for(lambda: event(E, lambda e: e['status'] in ('queued', 'sent')), 40)
    check(G, 'stopped: the orb take itself is kept and sent (no silent loss)', ev is not None, events(E))

    # ------------------------------------------------ side button gets the same contract
    F = 'qa_loan_side'
    start_meeting(F)
    sx(f'run-as {PKG} cp /data/local/tmp/qa_loan_voice.m4a files/qa_side.m4a'); sx('logcat -c')
    sx(f'am start -W -a android.intent.action.ASSIST -n {PKG}/ai.wizards.os.assist.AssistLockActivity --es qa_audio qa_side.m4a --el qa_autosend_ms 2500')
    al = wait_for(lambda: sx('logcat -d -s WizardOSAssist:* | grep -E "meeting paused for|start refused" | tail -3').strip(), 8)
    check(G, 'side: side button during a meeting borrows the mic (not refused)', 'meeting paused for orb-' in al and 'refused' not in al, al)
    check(G, 'side: meeting resumes once the side-button take is kept', bool(wait_for(lambda: mlog(f'resumed {F} '), 20)), mlog(F))
    ev = wait_for(lambda: event(F, lambda e: e['status'] == 'sent'), 40)
    check(G, 'side: marker saved with the thread link', ev and ev.get('threadId') and ev.get('source') == 'side', ev)
    sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
    check(G, 'side: Back leaves Wizard OS open or returns to it (never a crash)', 'ai.wizards.os' not in sx('logcat -b crash -d'), top()[:120])
    stop_meeting(F)

    # ------------------------------------------------ reverse: a meeting cannot start while the orb holds the mic
    home(); b = wait_for(bubble, 10); sx('logcat -c')
    if b: tap(b)
    time.sleep(1.5)
    sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(2); open_host()
    rr = mz('start', 'qa_loan_refused')
    check(G, 'reverse: meeting start refused (mic_busy) while the orb holds the mic', rr.get('ok') is False and rr.get('error') == 'mic_busy', rr)
    home(); cc = controls()
    if 'cancel' in cc: tap(cc['cancel'])
    time.sleep(1.5)

    # Native receipts are kept and every native marker reached the meeting exactly (no parallel store).
    import xml.etree.ElementTree as ET
    prefs = sx(f'run-as {PKG} cat shared_prefs/meeting-handoffs-v1.xml')
    save('loan-receipts.xml', prefs)
    rows = []
    try: rows = [json.loads(n.text or '{}') for n in ET.fromstring(prefs).iter('string')]
    except Exception as e: rows = [{'parse_error': repr(e)}]
    native = [r for r in rows if r.get('source')]
    unacked = [{k: r.get(k) for k in ('id', 'meetingId', 'event', 'rev', 'acked')} for r in native if r.get('acked') != r.get('rev')]
    if unacked:   # the sync may still be posting the last notes: give it its normal retry time, then read again
        time.sleep(20)
        prefs = sx(f'run-as {PKG} cat shared_prefs/meeting-handoffs-v1.xml'); save('loan-receipts.xml', prefs)
        rows = [json.loads(n.text or '{}') for n in ET.fromstring(prefs).iter('string')]
        native = [r for r in rows if r.get('source')]
        unacked = [{k: r.get(k) for k in ('id', 'meetingId', 'event', 'rev', 'acked')} for r in native if r.get('acked') != r.get('rev')]
    check(G, 'every native loan receipt was confirmed by the meeting server at its latest revision (acked = rev)',
          len(native) >= 6 and not unacked, {'native': len(native), 'unacked': unacked})
    with LOCK: save('loan-orb-events.json', ST['orb'])
    pg.ev("window.WizardOSNative.setEverywhere(false)")
    check(G, 'no native crash', 'ai.wizards.os' not in sx('logcat -b crash -d'))
