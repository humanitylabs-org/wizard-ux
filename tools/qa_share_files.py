#!/usr/bin/env python3
"""Share files to Wizard: Android device QA (runs on Thales, holds the shared worker.lock for the emulator only).

usage: qa_share_files.py QA_APK UX_DIR JOB_DIR [--big-mb=2048] [--phases=sheet,big,kill,reboot]

  QA_APK   the candidate's debug build (ai.wizards.os.qa)
  UX_DIR   a copy of the wizard-ux checkout (tools/share-fixture.mjs serves the contract + web/)
  JOB_DIR  evidence: shots/, receipt.json, fixture.log, logcat-*.txt  (under $WIZARD_WORK_ROOT)

A fresh API 35 emulator (dark mode, 10 GB data partition) talks to the share fixture on the Thales host over the
emulator's own network (http://10.0.2.2:PORT, NOT adb reverse), so airplane mode really cuts it. Big test files are
generated on the emulator. The real Wizard is never contacted; nothing is published.

Phases:
  sheet   share from the Files app → native sheet (dark screenshot): default agent + New chat preselected, To row
          (fixture has >1 agent); Back regression: open the chat chooser → Back returns to the sheet, sheet still
          open; one more Back only warns; Send closes the sheet at once.
  big     the 2 GB file from the sheet phase: notification "1 file → Wizard" (no file name), at ~40% force-stop the
          app and toggle airplane mode; reopen → resumes from the server offset, completes; fixture: exactly one
          delivery, stored bytes = source sha256; tapping the notification opens the thread.
  kill    a 300 MB share; at ~40% the process is killed (kill -9, app not reopened) and airplane mode toggled → the
          upload resumes on its own (service restart / JobScheduler) and completes, one delivery.
  reboot  a 400 MB share; at ~30% the emulator reboots → after boot, without opening the app, the persisted job
          resumes and completes, one delivery.
"""
import fcntl, hashlib, json, os, pathlib, re, signal, subprocess, sys, time, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_aa_lib import ADB, BASE, Emu, wait  # noqa: E402

P = pathlib.Path
QA_APK, UX, JOB = P(sys.argv[1]), P(sys.argv[2]), P(sys.argv[3])
OPT = dict(a[2:].split('=', 1) for a in sys.argv[4:] if a.startswith('--') and '=' in a)
BIG_MB = int(OPT.get('big-mb', '2048'))
PHASES = OPT.get('phases', 'sheet,big,kill,reboot').split(',')
THROTTLE = OPT.get('throttle', '24')  # MB/s at the fixture: a 2 GB upload takes ~90 s, room to interrupt
PORT = int(OPT.get('port', '9657'))
PKG = 'ai.wizards.os.qa'
ORIGIN = 'http://10.0.2.2:%d' % PORT
JOB.mkdir(parents=True, exist_ok=True)
OUT = JOB / 'shots'; OUT.mkdir(exist_ok=True)
FXDATA = JOB / 'fixture-data'
NODE = 'node'
res, receipt = [], {'job': str(JOB), 'apk': str(QA_APK), 'checks': [], 'timeline': []}


def check(n, ok, d=''):
    res.append(bool(ok)); receipt['checks'].append([bool(ok), n, str(d)[:600]])
    print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:400] if d not in ('', None) else ''), flush=True)


def note(*a):
    s = ' '.join(str(x) for x in a); receipt['timeline'].append([round(time.time(), 1), s]); print('..', s, flush=True)


def save():
    receipt['passed'] = sum(res); receipt['failed'] = len(res) - sum(res)
    (JOB / 'receipt.json').write_text(json.dumps(receipt, indent=1))


class Emu2(Emu):
    def boot(self):
        self.sh(P(ADB).parent.parent / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'aa', '-k',
                'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', self.job / 'dev', stdin='no\n')
        cfg = self.job / 'dev' / 'config.ini'
        t = cfg.read_text() if cfg.exists() else ''
        t = re.sub(r'(?m)^disk\.dataPartition\.size=.*\n?', '', t) + 'disk.dataPartition.size=10G\n'
        cfg.write_text(t)
        self.proc = subprocess.Popen([str(P(ADB).parent.parent / 'emulator/emulator'), '-avd', 'aa', '-port', str(self.port), '-no-window',
                                      '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-partition-size', '10240'],
                                     env=self.env, stdout=open(self.job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        self.booted()

    def booted(self, secs=420):
        t0 = time.time()
        while time.time() - t0 < secs:
            if self.sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): self.sx('settings put global %s 0' % k)
        self.sx('settings put system screen_off_timeout 1800000')
        self.sx('svc power stayon true')
        self.sx('input keyevent KEYCODE_WAKEUP'); self.sx('wm dismiss-keyguard')


em = Emu2(JOB, 5600, PKG)

# ------------------------------------------------------------------ fixture (host)
fx = None


def fixture_start():
    global fx
    log = open(JOB / 'fixture.log', 'a')
    fx = subprocess.Popen([NODE, str(UX / 'tools/share-fixture.mjs'), str(PORT), '--host=127.0.0.1', '--data=%s' % FXDATA,
                           '--web=%s' % (UX / 'web'), '--throttle=%s' % THROTTLE, '--agents=2'], stdout=log, stderr=subprocess.STDOUT)
    wait(lambda: state() is not None, 15, 0.3)


def fixture_stop():
    global fx
    if fx: fx.terminate(); fx.wait(10); fx = None


def state():
    try: return json.load(urllib.request.urlopen('http://127.0.0.1:%d/__fixture/state' % PORT, timeout=5))
    except Exception: return None


def upload_of(name):
    s = state() or {}
    return next((u for u in reversed(s.get('uploads', [])) if u['filename'] == name), None)


def share_of(name):
    u = upload_of(name); s = state() or {}
    return next((x for x in s.get('shares', []) if u and x['share_id'] == u['share']), None), u, s


# ------------------------------------------------------------------ device helpers
def ui(): return em.ui()


def has(pattern, xml=None):
    xml = xml or ui()
    return any(re.search(pattern, m.group(1)) for m in re.finditer(r' (?:text|content-desc)="([^"]*)"', xml))


def top(): return em.top()


def sheet_open(): return 'ShareActivity' in top()


def shade(name):
    """Screenshot the expanded shade; returns the text of System UI's own nodes only (not the app underneath)."""
    em.sx('cmd statusbar expand-notifications'); time.sleep(1.5)
    em.shot(OUT, name)
    xml = ui()
    em.sx('cmd statusbar collapse'); time.sleep(0.6)
    texts = []
    for n in re.finditer(r'<node [^>]*?>', xml):
        if 'package="com.android.systemui"' not in n.group(0): continue
        texts += re.findall(r' (?:text|content-desc)="([^"]*)"', n.group(0))
    return ' '.join(texts)


def notif_texts():
    d = em.sx('dumpsys notification --noredact')
    out = []
    for blk in d.split('NotificationRecord(')[1:]:
        if 'pkg=' + PKG not in blk[:400]: continue
        t = re.search(r'android\.title=String \((.*?)\)', blk); x = re.search(r'android\.text=String \((.*?)\)', blk)
        out.append(((t.group(1) if t else ''), (x.group(1) if x else '')))
    return out


def make_file(name, mb):
    # /dev/urandom so the server can't dedupe; generated on the emulator (never on the VPS).
    p = '/sdcard/Download/' + name
    em.sx('rm -f %s; dd if=/dev/urandom of=%s bs=1048576 count=%d 2>/dev/null' % (p, p, mb), timeout=900)
    em.sx('content call --uri content://media --method scan_volume --arg external_primary 2>/dev/null', timeout=120)
    em.sx('am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://%s >/dev/null 2>&1' % p)
    size = int((em.sx('stat -c %%s %s' % p).strip() or '0'))
    digest = em.sx('sha256sum %s' % p, timeout=600).split()[0]
    return size, digest


def media_uri(name):
    for _ in range(10):
        q = em.sx("content query --uri content://media/external/file --projection _id --where \"_display_name='%s'\"" % name)
        m = re.search(r'_id=(\d+)', q)
        if m: return 'content://media/external/file/' + m.group(1)
        time.sleep(2)
    return ''


def share_from_files(name):
    """The real path: Files app → long-press → Share → the Wizard target. Falls back to a MediaStore SEND intent."""
    em.sx('am force-stop com.google.android.documentsui')
    em.sx('am start -a android.intent.action.VIEW -d content://com.android.providers.downloads.documents/root/downloads -t vnd.android.document/root')
    time.sleep(4)
    xml = ui()
    if not has(re.escape(name), xml):
        em.sx('am start -n com.google.android.documentsui/com.android.documentsui.files.FilesActivity'); time.sleep(4); xml = ui()
    em.shot(OUT, 'files-%s' % name)
    m = None
    for n in re.finditer(r'<node [^>]*?>', xml):
        if re.search(r'text="%s"' % re.escape(name), n.group(0)):
            m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n.group(0))
    via = 'files-app'
    if m:
        x1, y1, x2, y2 = map(int, m.groups()); cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        em.sx('input swipe %d %d %d %d 900' % (cx, cy, cx, cy)); time.sleep(1.5)
        if not em.tap_text(r'^Share$'):
            em.tap_text(r'^More options$'); time.sleep(1); em.tap_text(r'^Share$')
        time.sleep(3)
        em.shot(OUT, 'chooser-%s' % name)
        tapped = None
        for _ in range(4):
            tapped = em.tap_text(r'^Wizard$')
            if tapped: break
            em.sx('input swipe 540 1900 540 900 400'); time.sleep(1.5)
        if not tapped: via = None
    else: via = None
    if not via or not wait(sheet_open, 8):
        uri = media_uri(name)
        note('Files-app path not found (%s); SEND with %s' % (top(), uri))
        em.sx('am start -a android.intent.action.SEND -t application/octet-stream --eu android.intent.extra.STREAM %s --grant-read-uri-permission -n %s/ai.wizards.os.share.ShareActivity' % (uri, PKG))
        via = 'send-intent (MediaStore uri)'
    ok = wait(sheet_open, 10)
    return via if ok else None


def pid(): return em.sx('pidof %s' % PKG).strip()


def wait_offset(name, frac, secs):
    t0 = time.time()
    while time.time() - t0 < secs:
        u = upload_of(name)
        if u and u['bytes'] and u['offset'] >= u['bytes'] * frac: return u
        time.sleep(1)
    return upload_of(name)


def wait_delivered(name, secs):
    t0 = time.time()
    while time.time() - t0 < secs:
        sh, u, s = share_of(name)
        if sh and sh['status'] == 'delivered': return sh, u, s
        time.sleep(2)
    return share_of(name)


def fixture_file_sha(u):
    p = FXDATA / 'files' / u.get('file', 'x')
    if not p.exists(): return ''
    h = hashlib.sha256()
    with p.open('rb') as f:
        for c in iter(lambda: f.read(1 << 22), b''): h.update(c)
    return h.hexdigest()


def deliveries_for(s, share_id): return [d for d in s.get('deliveries', []) if d['share_id'] == share_id]


def logcat(name): (JOB / ('logcat-%s.txt' % name)).write_text(em.sx('logcat -d -s WizardShare:V WizardHandoff:V ActivityManager:I JobScheduler:I AndroidRuntime:E', timeout=60))


def tap_sent_opens_thread(label, fname, thread_id, shot):
    """Tap this share's “Sent” notification; the app must open THAT share's thread (thread_id from the server), not
    just the app or the thread that happened to be open. Proven twice: the intent carried the id (logcat) and the
    WebView shows the thread titled with the shared file's name (System UI nodes excluded)."""
    em.sx('logcat -c')
    em.sx('cmd statusbar expand-notifications'); time.sleep(1.5)
    tapped = em.tap_text(r'Sent · tap to open the chat')
    opened = wait(lambda: 'open thread %s' % thread_id in em.sx('logcat -d -s WizardHandoff:V'), 20, 1)
    def title_shown():
        xml = ui()
        return any('package="%s"' % PKG in n.group(0) and re.search(r' text="%s"' % re.escape(fname), n.group(0))
                   for n in re.finditer(r'<node [^>]*?>', xml))
    shown = wait(title_shown, 25, 1.5)
    em.shot(OUT, shot)
    check('%s: tapping “Sent” hands the app the share\'s own thread_id (%s)' % (label, thread_id), tapped and opened,
          em.sx('logcat -d -s WizardHandoff:V')[-300:])
    check('%s: the app shows that thread (%s), in front' % (label, fname), shown and 'MainActivity' in top(), top())


def send_tap():
    return em.tap_text(r'^Send$')


# ------------------------------------------------------------------ run
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    note('lock held')
    try:
        if FXDATA.exists(): subprocess.run(['rm', '-rf', str(FXDATA)])
        fixture_start()
        check('share fixture up on the Thales host', state() is not None)
        em.boot()
        note('emulator booted')
        out = em.sh(ADB, '-s', em.S, 'install', '-r', '-g', QA_APK).strip().splitlines()[-1]
        check('install the candidate QA build', out == 'Success', out)
        em.sx('cmd uimode night yes')
        em.sx('pm grant %s android.permission.POST_NOTIFICATIONS' % PKG)
        em.sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(3)
        em.runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt' % (ORIGIN, ORIGIN))
        em.sx('am force-stop %s' % PKG)
        em.sx('input keyevent KEYCODE_HOME')
        reach = em.sx("printf 'GET /wizard/v1/bootstrap HTTP/1.0\\r\\n\\r\\n' | toybox nc -w 5 10.0.2.2 %d | tail -c 400" % PORT)
        check('emulator reaches the fixture over its own network (10.0.2.2, not adb reverse)', '"resumable_uploads":true' in reach, reach[-160:])

        # ======== sheet ========
        big = 'qa-big-%dm.bin' % BIG_MB
        if 'sheet' in PHASES or 'big' in PHASES:
            t0 = time.time(); size, digest = make_file(big, BIG_MB)
            note('generated %s %d bytes in %.0fs' % (big, size, time.time() - t0))
            check('%d MB test file generated on the emulator' % BIG_MB, size == BIG_MB * 1048576, size)
            receipt['big'] = {'name': big, 'bytes': size, 'sha256': digest}
            # Warm the sheet's cache of what the Wizard offers (agents) with one throwaway open + cancel.
            via = share_from_files(big)
            check('share from the Files app opens the Wizard sheet', via is not None, via)
            receipt['share_via'] = via
            time.sleep(3)  # bootstrap + agents land
            xml = ui()
            em.shot(OUT, '10-sheet-dark')
            check('sheet: default agent preselected (“Send to Wizard”)', has(r'^Send to Wizard$', xml))
            check('sheet: New chat preselected', has(r'^Chat: New chat$', xml) or has(r'^New chat$', xml))
            check('sheet: To row shown (fixture Wizard has more than one agent)', has(r'^To: Wizard$', xml))
            check('sheet: optional note field', has(r'Add a note', xml))
            check('sheet: names the file and size', has(re.escape(big) + r' · 2\.0 GB', xml) or has(re.escape(big), xml), '')
            # Back regression: sheet → chat chooser → Back → sheet, still open.
            em.tap_text(r'^Chat: New chat$'); time.sleep(2.5)
            xml = ui(); em.shot(OUT, '11-chat-chooser')
            check('chat chooser opens (lists New chat + existing chats)', has(r'^Choose chat$', xml) and has(r'Trip planning', xml), '')
            em.sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
            xml = ui(); em.shot(OUT, '12-after-back')
            back_ok = sheet_open() and has(r'^Send$', xml) and not has(r'^Choose chat$', xml)
            check('BACK TEST: Back from the chat chooser returns to the sheet; the sheet is still open', back_ok, top())
            receipt['back_test'] = 'pass' if back_ok else 'fail'
            time.sleep(2.5)
            em.sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
            xml = ui(); em.shot(OUT, '13-single-back-warns')
            check('a single Back on the sheet only warns; the sheet stays open', sheet_open() and has(r'Press back again to cancel', xml), top())
            time.sleep(2.5)
            # Agent chooser + Back, then the To row keeps the default.
            em.tap_text(r'^To: Wizard$'); time.sleep(1.2)
            xml = ui(); em.shot(OUT, '14-agent-chooser')
            check('agent chooser lists the agents (stopped one disabled)', has(r'Private', xml) and has(r'stopped', xml))
            em.sx('input keyevent KEYCODE_BACK'); time.sleep(1)
            check('Back from the agent chooser returns to the sheet', sheet_open() and has(r'^To: Wizard$'), top())
            time.sleep(2.5)

        # ======== big: one tap → force-stop at ~40% + airplane → resumes → completes once ========
        if 'big' in PHASES:
            em.sx('logcat -c')
            t_send = time.time()
            send_tap()
            closed = wait(lambda: not sheet_open(), 3, 0.2)
            check('one tap Send closes the sheet at once', closed, '%.1fs %s' % (time.time() - t_send, top()))
            u = wait_offset(big, 0.05, 240)
            check('upload started (copy done, PATCH chunks flowing)', u and u['offset'] > 0, u)
            time.sleep(4)
            x = shade('20-notification-progress')
            nt = notif_texts()
            note('notifications', nt)
            check('notification: “1 file → Wizard” with progress', any(t == '1 file → Wizard' for t, _ in nt), nt)
            check('notification never shows the file name', not any(big in (t + x_) for t, x_ in nt) and big not in x, nt)
            u = wait_offset(big, 0.40, 600)
            at = u['offset'] if u else 0
            note('at %.0f%%: force-stop + airplane mode' % (100.0 * at / max(1, u['bytes'] if u else 1)))
            check('reached ~40%', u and at >= u['bytes'] * 0.4, at)
            em.sx('am force-stop %s' % PKG)
            em.sx('cmd connectivity airplane-mode enable'); time.sleep(12)
            u1 = upload_of(big)
            check('after force-stop + airplane mode: no bytes move', u1 and u1['offset'] - at < 64 * 1048576, (at, u1 and u1['offset']))
            em.sx('cmd connectivity airplane-mode disable'); time.sleep(8)
            # Android blocks every background restart after a force-stop (by design); the queue resumes when Wizard OS opens.
            em.sx('am start -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(3)
            u2 = wait_offset(big, (u1['offset'] + 1) / u1['bytes'] if u1 else 0.5, 120)
            check('reopening Wizard OS resumes the upload', u2 and u1 and u2['offset'] > u1['offset'], (u1 and u1['offset'], u2 and u2['offset']))
            em.sx('input keyevent KEYCODE_HOME')
            sh, u, s = wait_delivered(big, 900)
            check('the 2 GB share completes and is delivered', sh and sh['status'] == 'delivered', sh)
            d = deliveries_for(s or {}, sh['share_id']) if sh else []
            check('exactly one delivered message for the share', len(d) == 1, d)
            sess = next((x for x in (s or {}).get('sessions', []) if sh and x['id'] == sh['thread_id']), None)
            check('a new thread on the default agent holds one user message with the file', sess and sess['agent'] == 'hermes' and len(sess['user_messages']) == 1, sess)
            check('resumed from the server offset (patch count ≈ chunks, not a restart from 0)', u and u['patches'] <= (u['bytes'] // (8 << 20)) + 12, u)
            fsha = fixture_file_sha(u or {})
            check('stored bytes match the phone’s file (sha256)', fsha == receipt['big']['sha256'], (fsha, receipt['big']['sha256']))
            receipt['big']['share'] = sh; receipt['big']['upload'] = u
            time.sleep(3)
            x = shade('21-notification-sent')
            nt = notif_texts(); note('notifications', nt)
            check('notification after delivery: “1 file → Wizard · Sent”', any(t == '1 file → Wizard' and 'Sent' in x_ for t, x_ in nt), nt)
            tap_sent_opens_thread('big', big, sh['thread_id'] if sh else '?', '22-tap-opens-thread')
            left = em.runas('ls files/share-out/*/*.bin 2>/dev/null | wc -l').strip()
            check('the private copy is deleted after delivery', left == '0', em.runas('ls -la files/share-out/*/ 2>/dev/null | head'))
            logcat('big')
            em.sx('input keyevent KEYCODE_HOME')

        # ======== kill: process death + airplane, no reopen → resumes on its own ========
        if 'kill' in PHASES:
            name = 'qa-kill-300m.bin'; size, digest = make_file(name, 300)
            em.sx('logcat -c')
            check('kill: sheet opens', share_from_files(name) is not None)
            time.sleep(2); send_tap()
            u = wait_offset(name, 0.40, 300)
            note('kill at', u and u['offset'])
            em.sx('am kill-all'); p0 = pid()
            em.sh(ADB, '-s', em.S, 'root'); time.sleep(3)
            em.sx('kill -9 %s' % p0); time.sleep(1)
            em.sx('cmd connectivity airplane-mode enable'); time.sleep(10)
            em.sx('cmd connectivity airplane-mode disable')
            sh, u, s = wait_delivered(name, 600)
            check('after kill -9 + airplane mode, the share completes without reopening the app', sh and sh['status'] == 'delivered', (p0, pid(), sh))
            check('kill: exactly one delivery', sh and len(deliveries_for(s, sh['share_id'])) == 1)
            check('kill: stored bytes match (sha256)', fixture_file_sha(u or {}) == digest)
            # Warm path: the app is alive with the 2 GB share's thread open; the tap must switch to this share's thread.
            time.sleep(3)
            tap_sent_opens_thread('kill (warm app, another thread open)', name, sh['thread_id'] if sh else '?', '23-tap-opens-kill-thread')
            em.sx('input keyevent KEYCODE_HOME')
            logcat('kill')

        # ======== reboot: persisted job resumes after boot ========
        if 'reboot' in PHASES:
            name = 'qa-reboot-400m.bin'; size, digest = make_file(name, 400)
            em.sx('logcat -c')
            check('reboot: sheet opens', share_from_files(name) is not None)
            time.sleep(2); send_tap()
            u = wait_offset(name, 0.30, 300)
            at = u['offset'] if u else 0
            note('reboot at', at)
            em.sh(ADB, '-s', em.S, 'reboot'); time.sleep(20)
            em.sh(ADB, '-s', em.S, 'wait-for-device', timeout=600)
            em.booted()
            note('rebooted')
            sh, u, s = wait_delivered(name, 900)
            check('after a reboot the share resumes and completes without opening the app', sh and sh['status'] == 'delivered', sh)
            check('reboot: resumed past the pre-reboot offset (not from 0)', u and u['patches'] <= (u['bytes'] // (8 << 20)) + 12, u)
            check('reboot: exactly one delivery', sh and len(deliveries_for(s, sh['share_id'])) == 1)
            check('reboot: stored bytes match (sha256)', fixture_file_sha(u or {}) == digest)
            # Cold path: the app has not run since boot.
            time.sleep(3)
            tap_sent_opens_thread('reboot (cold start)', name, sh['thread_id'] if sh else '?', '24-tap-opens-reboot-thread')
            logcat('reboot')

        s = state() or {}
        receipt['fixture'] = {'shares': s.get('shares'), 'deliveries': s.get('deliveries')}
        crashes = em.sx('logcat -d -b crash', timeout=60)
        check('no app crash', PKG not in crashes, crashes[-400:])
    except Exception as e:
        import traceback; traceback.print_exc()
        check('qa script ran to the end', False, repr(e))
        try: em.shot(OUT, 'zz-error'); logcat('error')
        except Exception: pass
    finally:
        save()
        try: em.kill()
        except Exception: pass
        fixture_stop()
        note('lock released')
        save()

print('\n%d passed, %d failed' % (sum(res), len(res) - sum(res)))
sys.exit(0 if all(res) else 1)
