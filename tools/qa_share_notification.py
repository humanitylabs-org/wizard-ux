#!/usr/bin/env python3
"""Focused synthetic notification QA. Reuse exact APKs; never build/sign/deploy.

Stage this file beside seal.json and a Git-exported source/. Parent alone admits
it through forum's heavy lane. --preflight is read-only and starts no processes.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import time
import traceback

sys.dont_write_bytecode = True
RESERVE = 214748364800
BUDGET = 3221225472  # one disposable AVD + two synthetic PDFs; no Gradle/cache copy


def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def inventory(source):
    return {str(p.relative_to(source)): {'sha256': sha(p), 'mode': p.stat().st_mode & 0o777}
            for p in sorted(source.rglob('*')) if p.is_file() and not p.is_symlink()}


def verify(root, digest):
    if sha(root / 'seal.json') != digest:
        raise ValueError('seal hash mismatch')
    seal = json.loads((root / 'seal.json').read_text())
    if str(root) != seal['root'] or sha(__file__) != seal['runner_sha256']:
        raise ValueError('runner identity mismatch')
    if any(p.is_symlink() for p in (root / 'source').rglob('*')):
        raise ValueError('source links forbidden')
    if inventory(root / 'source') != seal['source_files']:
        raise ValueError('source export drift')
    for name, digest in seal['inherited_files'].items():
        if sha(name) != digest:
            raise ValueError('inherited evidence drift: ' + name)
    accepted = json.loads(Path(seal['old_acceptance']).read_text())
    if accepted['junit'] != {'tests': 384, 'failures': 0, 'errors': 0, 'skipped': 0}:
        raise ValueError('not the accepted 384 JVM pass')
    if sha(seal['apk']) != accepted['apk_sha256'] or sha(seal['sender_apk']) != accepted['sender_apk_sha256']:
        raise ValueError('APK identity mismatch')
    if seal['android_tree'] != seal['inherited_android_tree']:
        raise ValueError('native tree changed: no reuse allowed')
    # Compare every tracked Android input to the original build manifest too.
    old = json.loads(Path(seal['old_job']).read_text())
    native = {n: row['sha256'] for n, row in old['files'].items() if n.startswith('android/')}
    fresh = {n: row['sha256'] for n, row in seal['source_files'].items() if n.startswith('android/')}
    if native != fresh:
        raise ValueError('native member inventory differs from actual build')
    for name, row in old['files'].items():
        if name.startswith('tools/unified-share-sender/') and seal['source_files'].get(name, {}).get('sha256') != row['sha256']:
            raise ValueError('retained sender source differs')
    return seal, accepted


def snapshot_identity(value):
    return {k: v for k, v in value.items() if k != 'text'}


def stable_snapshot(rig, thread, filename, label):
    import qa_unified_share_android as q
    previous = None
    since = None
    samples = []
    def sample():
        nonlocal previous, since
        value = rig.page.ev(q.focused_thread_snapshot_expression(thread, filename))
        samples.append({'at': time.time(), 'snapshot': value})
        (rig.out / (label + '-samples.json')).write_text(json.dumps(samples, indent=2) + '\n')
        key = json.dumps(snapshot_identity(value), sort_keys=True)
        if not value.get('ready') or previous != key:
            since = time.monotonic()
        previous = key
        return value if value.get('ready') and since is not None and time.monotonic() - since >= .8 else None
    return q.wait(sample, 30)


def capture_notification(rig, thread, filename, label):
    """No constructed thread intent or application mutation; tap real notification."""
    import qa_unified_share_android as q
    rig.sx('cmd statusbar expand-notifications')
    xml = q.wait(lambda: (x if 'Sent · tap to open the chat' in (x := rig.ui()) else None), 40)
    (rig.out / (label + '-notification.xml')).write_text(xml)
    assert 'Synthetic comment' not in xml and filename not in xml
    rig.screenshot(label + '-before-tap')
    rig.sx('logcat -c')
    rig.tap_text('Sent · tap to open the chat')
    rig.connect_page()
    rig.notification_thread(thread, filename)
    before = stable_snapshot(rig, thread, filename, label + '-before')
    rig.page.ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    (rig.out / (label + '-target.json')).write_text(json.dumps(rig.page.call('Target.getTargetInfo'), indent=2))
    rig.screenshot(label + '-opened')
    # Capture compositor pixels separately from Android's surface; the parent
    # compares these to both before/after DOM receipts. No visual PASS is minted.
    answer = rig.page.call('Page.captureScreenshot', format='png', fromSurface=True)
    (rig.out / (label + '-webview.png')).write_bytes(base64.b64decode(answer['result']['data']))
    after = stable_snapshot(rig, thread, filename, label + '-after')
    assert snapshot_identity(before) == snapshot_identity(after), 'thread state changed across decisive native screenshot'
    rig.screenshot(label + '-settled')
    (rig.out / (label + '-logcat.txt')).write_text(rig.adb_cmd('logcat', '-d', '-v', 'threadtime'))
    return {'thread_id': thread, 'file': filename, 'snapshot': after,
            'status': 'AUTOMATED_PASS_VISUAL_REVIEW_REQUIRED'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    seal, old = verify(root, args.seal_sha256)
    free = shutil.disk_usage(root).free
    storage = {'free_bytes': free, 'reserve_bytes': RESERVE, 'peak_budget_bytes': BUDGET,
               'required_bytes': RESERVE + BUDGET, 'admissible': free >= RESERVE + BUDGET}
    if args.preflight:
        print(json.dumps({'status': 'SOURCE_AND_REUSE_PREFLIGHT_ONLY', 'storage': storage,
                          'revision': seal['revision'], 'apk_sha256': sha(seal['apk'])}))
        return 0
    if os.uname().nodename != 'forum' or not str(root).startswith('/srv/work/'):
        raise RuntimeError('forum only')
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    held = os.fstat(fd); lease = Path('/srv/work/heavy/production/worker.lock').stat()
    if (held.st_dev, held.st_ino) != (lease.st_dev, lease.st_ino):
        raise RuntimeError('wrong inherited heavy lease')
    if not storage['admissible']:
        raise RuntimeError('storage floor plus task-owned peak not met: ' + json.dumps(storage))
    out = root / 'android-evidence'; out.mkdir(mode=0o700, exist_ok=False)
    os.environ.update(ANDROID_HOME='/srv/work/android-sdk', ANDROID_SDK_ROOT='/srv/work/android-sdk',
                      JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64', WIZARD_WORK_ROOT=str(out),
                      WIZARD_QA_NODE=seal['node'])
    os.environ['PATH'] = os.environ['JAVA_HOME'] + '/bin:' + os.environ['PATH']
    sys.path.insert(0, str(root / 'source/tools'))
    import qa_unified_share_android as q
    report = {'status': 'RUNNING', 'revision': seal['revision'], 'publication': False,
              'synthetic_backend_only': True, 'native_build_reused': True, 'storage': storage,
              'apk_sha256': old['apk_sha256'], 'inherited_junit': old['junit'],
              'inherited_acceptance_sha256': sha(seal['old_acceptance']),
              'inherited_phases': {k: v for k, v in old['phases'].items() if k != 'notification-tap'},
              'external_intents': [], 'deliveries': [], 'notifications': [], 'phases': {}}
    def save():
        (out / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    def interrupted(signum, frame): raise RuntimeError('signal ' + str(signum))
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM): signal.signal(sig, interrupted)
    signal.alarm(1000)  # 200 seconds for owned cleanup before parent's 1200s cap
    rig = q.Rig(root, {}, report, save)
    save()
    try:
        q.Proxy.events = []; q.Proxy.armed = False; q.Proxy.gate.clear(); q.Proxy.blocked.clear()
        rig.fixture_start(); rig.boot()
        # Install both retained artifacts, no compiler, Gradle, aapt or signer.
        rig.adb_cmd('install', '-r', '-g', seal['sender_apk']); rig.verify_sender_debug_access()
        rig.adb_cmd('install', '-r', '-g', seal['apk'])
        installed = rig.sx('pm path ' + q.PKG).strip().removeprefix('package:')
        assert installed.endswith('/base.apk') and '\n' not in installed
        report['installed_apk_sha256'] = rig.sx('sha256sum ' + installed).split()[0]
        assert report['installed_apk_sha256'] == report['apk_sha256']
        rig.sx('run-as ' + q.PKG + ' sh -c "mkdir -p files; printf ' + rig.origin + ' > files/qa_home.txt; printf ' + rig.origin + ' > files/qa_origin.txt"')
        rig.sx('am start -W -n ' + q.PKG + '/ai.wizards.os.MainActivity'); rig.connect_page()
        rig.page.ev("localStorage.setItem('wos.coached','1');localStorage.setItem('wos.toured','1');true")
        for selector in ('#coachStart', '[data-tskip]'):
            if rig.page.ev('!!document.querySelector(' + json.dumps(selector) + ')'): rig.tap(selector)
        # The first delivery is necessary setup: recreate precisely the previously
        # displayed thread, then the second force-stop/reopen notification scenario.
        rig.share('genuine'); rig.pick_private()
        rig.tap('.dv-chat'); rig.tap('[data-dvpick=qa_private_thread]')
        rig.wait_dom("document.querySelector('.dv-chat strong')?.textContent==='Private notes' && !document.querySelector('.dv-picker-wrap')")
        rig.set_comment('Synthetic comment one'); rig.send_once('existing')
        rig.sx('input keyevent KEYCODE_HOME')
        first = rig.verify_delivery('genuine.pdf', 'private', 'Synthetic comment one\n\nA genuine shared note mentioning genuine.pdf', 'qa_private_thread')
        report['notifications'].append(capture_notification(rig, first['thread_id'], 'genuine.pdf', 'existing'))
        q.Proxy.armed = True; q.Proxy.gate.clear(); q.Proxy.blocked.clear()
        rig.share('boilerplate'); rig.pick_private(); rig.set_comment('Synthetic comment two'); rig.send_once('new')
        assert q.Proxy.blocked.wait(60), 'second chunk did not reach interruption barrier'
        rig.sx('am force-stop ' + q.PKG)
        (out / 'persisted-native-queue.txt').write_text(rig.sx('run-as ' + q.PKG + ' sh -c "cat files/share-out/*/item.json"'))
        rig.sx('am start -W -n ' + q.PKG + '/ai.wizards.os.MainActivity'); rig.connect_page()
        rig.sx('input keyevent KEYCODE_HOME'); q.Proxy.gate.set()
        second = rig.verify_delivery('x.pdf', 'private', 'Synthetic comment two')
        report['notifications'].append(capture_notification(rig, second['thread_id'], 'x.pdf', 'new'))
        assert len(rig.state()['deliveries']) == 2 and rig.state()['oldUploads'] == 0
        report['status'] = 'AUTOMATED_PASS_VISUAL_REVIEW_REQUIRED'
    except BaseException:
        report['status'] = 'FAIL'
        (out / 'failure-traceback.txt').write_text(traceback.format_exc())
        rig.diagnostic('failure-notification')
    finally:
        try:
            (out / 'fixture-final.json').write_text(json.dumps(rig.state(), indent=2))
            (out / 'logcat.txt').write_text(rig.adb_cmd('logcat', '-d', '-v', 'threadtime'))
            crash = rig.adb_cmd('logcat', '-d', '-b', 'crash')
            (out / 'crash.txt').write_text(crash)
            if 'FATAL EXCEPTION' in crash: report['status'] = 'FAIL'
        except BaseException:
            report['diagnostics_error'] = traceback.format_exc(); report['status'] = 'FAIL'
        try: rig.close()
        except BaseException:
            report['cleanup_error'] = traceback.format_exc(); report['status'] = 'FAIL'
        (out / 'network-receipts.json').write_text(json.dumps(q.Proxy.events, indent=2))
        if report.get('cleanup_errors') or not report.get('emulator', {}).get('serial_absent'):
            report['status'] = 'FAIL'
        else:
            # Only this new run's disposable AVD, and only after exact serial absence.
            owned = out / 'android_avd_home'
            if owned.is_symlink() or any(p.is_symlink() for p in owned.rglob('*')):
                report['status'] = 'FAIL'; report['avd_cleanup_error'] = 'unexpected link'
            else:
                (out / 'owned-avd-inventory.json').write_text(json.dumps(
                    {str(p.relative_to(owned)): p.stat().st_size for p in owned.rglob('*') if p.is_file()}, indent=2))
                for p in owned.rglob('config.ini'):
                    (out / ('owned-' + p.parent.name + '-config.ini')).write_bytes(p.read_bytes())
                shutil.rmtree(owned)
                report['owned_avd_removed_after_serial_absent'] = not owned.exists()
        try: verify(root, args.seal_sha256)
        except BaseException:
            report['input_drift'] = traceback.format_exc(); report['status'] = 'FAIL'
        report['evidence_hashes'] = {p.name: sha(p) for p in out.iterdir() if p.is_file() and p.name != 'acceptance.json'}
        save()
        signal.alarm(0)
    print(json.dumps(report))
    return 0 if report['status'] == 'AUTOMATED_PASS_VISUAL_REVIEW_REQUIRED' else 1


if __name__ == '__main__': sys.exit(main())
