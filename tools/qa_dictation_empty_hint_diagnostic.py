#!/usr/bin/env python3
"""Diagnostic only: unchanged product, three original assertions, parent forum queue only.

This does not normalize selections, advertise actions, retry, or turn failing assertions into PASS.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import subprocess
import time
import traceback

import qa_dictation_insertion_native as native
from qa_dictation_case_isolation import fresh_case, stop_processes, audit_editor, editor_contract, save
from qa_queue_lease import validated_queue_fd

METHODS = ('substringDoesNotVerifyInsertion',
           'hintIsNotExistingTextAndSentenceCapitalizationSurvives',
           'noopInputConnectionWorkingPastePreservesSingleInsertion')
PRODUCT = 'c07c16afbcf80ba4d5209a195680f442db9827c0'
ISOLATION = '772c1424df7ac798a60fcba4d4039a1dc1590c1a'
TASKS = [':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug', ':app:assembleDebugAndroidTest']


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def observations(preflight, fixture):
    """Describe facts; missing or contradictory data is not a diagnosis or product acceptance."""
    rows = fixture['observations']
    if fixture['observationsDropped'] or not rows:
        raise AssertionError('missing/truncated fixture observation stream')
    if preflight['editorPackage'] != native.PKG or preflight['fieldId'] != 1:
        raise AssertionError('pre-dispatch real editor identity mismatch')
    if preflight['initialStart'] != rows[0]['actualStart'] or preflight['initialEnd'] != rows[0]['actualEnd']:
        raise AssertionError('pre-dispatch selection contradicts original editor')
    published = [r for r in rows if r['phase'] == 'publish']
    writes = [r for r in rows if r['phase'] in ('paste', 'commit')]
    if not published or len(writes) != 1 or fixture['commits'] + fixture['pastes'] != 1:
        raise AssertionError('missing publication or not exactly one actual editor dispatch')
    snap = preflight['snapshot']
    wizard = [r for r in rows if r['clipClass'] == 'wizard']
    result = {'product_acceptance': False, 'preflight': preflight,
              'actual_write': writes[0]['phase'], 'wizard_clip_seen': bool(wizard),
              'wizard_publications': [r for r in published if r['clipClass'] == 'wizard'],
              'fixture_mode': fixture['mode'], 'final_text': fixture['text'],
              'mechanism': 'unresolved; inspect raw ordered observations'}
    empty_hint = (preflight.get('nodeShowingHint') is True and
                  preflight.get('nodeFocused') is True and preflight.get('nodeEditable') is True and
                  rows[0]['actualText'] == '' and isinstance(snap, dict) and snap.get('text') == '')
    published_empty_unknown = any(r.get('actualText') == '' and r.get('nodeShowingHint') is True
                                  and r.get('nodeStart') == r.get('nodeEnd') == -1 for r in published)
    if (empty_hint and published_empty_unknown and preflight.get('nodeStart') == preflight.get('nodeEnd') == -1
            and snap['start'] == snap['end'] == -1 and snap['valid'] is False
            and not wizard and writes[0]['phase'] == 'commit'):
        result['mechanism'] = ('observed invalid empty-hint snapshot: actual editor caret is known, '
                               'published/service node selection is -1/-1; no Wizard clip observed; IC dispatched')
    elif wizard and not any(32768 in r.get('actions', []) for r in published if r['clipClass'] == 'wizard'):
        result['mechanism'] = 'Wizard clip observed but no observed Wizard-clip node advertised ACTION_PASTE'
    return result


def validate_seal(root):
    seal = json.loads((root / 'empty-hint-seal.json').read_text())
    for name, expected in seal['files'].items():
        target = (root / name).resolve()
        if not target.is_relative_to(root.resolve()) or sha(target) != expected:
            raise AssertionError('diagnostic seal mismatch: ' + name)
    for name, expected in seal['prior_evidence'].items():
        if sha(name) != expected:
            raise AssertionError('prior failed/passed evidence changed: ' + name)
    config = json.loads((root / 'job.json').read_text())
    if config['tasks'] != TASKS or config['revision'] != seal['qa_revision']:
        raise AssertionError('diagnostic build tasks/revision changed')
    return seal


def run(root):
    root = root.resolve()
    lease = validated_queue_fd()
    seal = validate_seal(root)
    if (root/'receipt.json').exists() or (root/'empty-hint-native').exists():
        raise RuntimeError('one-use diagnostic packet already executed')
    # Same inherited lease reaches the build worker and its children. Never a nested submit.
    built = subprocess.run(['/usr/bin/python3', str(root/'worker.py'), '--worker', str(root/'job.json')],
                           cwd=root, pass_fds=(lease,), timeout=1500)
    if built.returncode:
        raise RuntimeError('diagnostic debug build failed; retained receipt, no emulator started')
    receipt = json.loads((root/'receipt.json').read_text())
    if receipt['status'] != 'ok' or receipt['source_revision'] != seal['qa_revision']:
        raise AssertionError('diagnostic build receipt identity mismatch')
    # Frozen production source remains byte-identical; never infer this from a QA branch name.
    for rel, expected in seal['production_files'].items():
        if sha(root/'source'/rel) != expected:
            raise AssertionError('production source changed: ' + rel)
    apk, _ = native.artifact(receipt, native.PKG)
    test_apk, _ = native.artifact(receipt, native.TEST)
    out = root/'empty-hint-native'; out.mkdir(exist_ok=False)
    if shutil.disk_usage(native.BASE).free < 200*1024**3:
        raise RuntimeError('200 GiB reserve required')
    env = dict(os.environ, ANDROID_HOME=str(native.SDK), ANDROID_SDK_ROOT=str(native.SDK),
               ANDROID_AVD_HOME=str(out/'avd'), ANDROID_USER_HOME=str(out/'android-user'),
               JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64')
    env['PATH'] = env['JAVA_HOME']+'/bin:'+env['PATH']
    Path(env['ANDROID_AVD_HOME']).mkdir(); Path(env['ANDROID_USER_HOME']).mkdir()
    def command(argv, *, timeout=180, stdin=None, binary=False, check=True):
        p = subprocess.run([str(a) for a in argv], env=env, input=stdin, capture_output=True,
                           text=not binary, timeout=timeout)
        if check and p.returncode: raise RuntimeError(f'command exit {p.returncode}: {argv}: {p.stderr!r}')
        return p.stdout
    port = 5774
    for number in (port, port+1):
        with socket.socket() as probe: probe.bind(('127.0.0.1', number))
    adb = [native.SDK/'platform-tools/adb', '-s', f'emulator-{port}']
    result = {'status':'failed', 'diagnostic_only':True, 'product_acceptance':False,
              'product_revision':PRODUCT, 'qa_revision':seal['qa_revision'], 'cases':{},
              'stopped_emulator':False, 'handset_proven':False}
    emulator = None
    previous_alarm = signal.signal(signal.SIGALRM, native.expire_native)
    signal.alarm(850)
    original_argv = native.instrumentation_argv
    def diagnostic_argv(adb, methods, lane):
        argv = original_argv(adb, methods, lane)
        return argv[:-1] + ['-e', 'emptyHintDiagnostics', 'true'] + argv[-1:]
    native.instrumentation_argv = diagnostic_argv
    try:
        command([native.SDK/'cmdline-tools/latest/bin/avdmanager','create','avd','--force',
                 '-n','dictation','-k','system-images;android-35;google_apis;x86_64','--device','pixel_7'], stdin='no\n')
        with (out/'emulator.log').open('w') as log:
            emulator = subprocess.Popen([str(native.SDK/'emulator/emulator'),'-avd','dictation','-port',str(port),
                       '-no-window','-no-audio','-no-boot-anim','-no-snapshot','-wipe-data','-accel','on',
                       '-gpu','swiftshader_indirect','-memory','3072','-cores','4'],env=env,stdout=log,stderr=subprocess.STDOUT)
        deadline = time.monotonic()+240
        while time.monotonic() < deadline:
            if emulator.poll() is not None: raise RuntimeError('emulator exited during boot')
            if command(adb+['shell','getprop','sys.boot_completed'],timeout=15,check=False).strip() == '1': break
            time.sleep(2)
        else: raise TimeoutError('emulator boot')
        command(adb+['shell','input','keyevent','82'])
        command(adb+['install','-t',apk]); command(adb+['install','-t',test_apk])
        for name in ('qa_origin.txt','qa_home.txt'):
            command(adb+['shell','run-as',native.PKG,'sh','-c',f'"mkdir -p files; printf http://127.0.0.1:1 > files/{name}"'])
        contract = editor_contract(root/'source', METHODS)
        save(out/'editor-contract.json', contract)
        for index, method in enumerate(METHODS, 1):
            case_out = out/('%02d-'%index+method); case_out.mkdir()
            case: dict = {'method':method, 'status':'diagnostic-incomplete'}
            try:
                fresh_case(native, command, adb, case_out)
                command(adb+['shell','run-as',native.PKG,'rm','-f','files/dictation-preflight.json'])
                case['native_result'] = native.collect_lane(command,adb,'candidate',[method],case_out,env)
                preflight = command(adb+['shell','run-as',native.PKG,'cat','files/dictation-preflight.json'])
                (case_out/'candidate-preflight.json').write_text(preflight)
                audit_editor(case_out, 'candidate', contract[method])
                fixture = json.loads((case_out/'candidate-editor.json').read_text())
                records = native.statuses((case_out/'candidate-instrumentation.txt').read_text())
                if len(records) != 1 or records[0].get('test') != method or records[0]['code'] not in (0,-2):
                    raise AssertionError('incomplete/foreign/skipped diagnostic method')
                case['observation'] = observations(json.loads(preflight), fixture)
                case['status'] = 'diagnostic-captured'  # Original native verdict above remains unchanged.
            except Exception: case['error'] = traceback.format_exc()
            finally:
                try: stop_processes(native, command, adb, case_out, 'after')
                except Exception:
                    case['status']='diagnostic-incomplete'; case['cleanup_error']=traceback.format_exc()
                result['cases'][method] = case; save(case_out/'diagnostic-receipt.json',case)
        if set(result['cases']) != set(METHODS) or any(c['status'] != 'diagnostic-captured' for c in result['cases'].values()):
            raise AssertionError('one or more diagnostics incomplete; no root-cause conclusion')
        result['unit'] = native.unit_census(root/'source')
        result['status'] = 'diagnostic-captured'
    except BaseException:
        result['error'] = traceback.format_exc()
        raise
    finally:
        signal.alarm(0); signal.signal(signal.SIGALRM, previous_alarm)
        native.instrumentation_argv = original_argv
        if emulator is not None:
            try: command(adb+['emu','kill'],timeout=15,check=False)
            except Exception: pass
            try: emulator.wait(timeout=25)
            except subprocess.TimeoutExpired:
                emulator.terminate()
                try: emulator.wait(timeout=15)
                except subprocess.TimeoutExpired: emulator.kill(); emulator.wait(timeout=10)
            result['stopped_emulator'] = emulator.poll() is not None
        result['files'] = {str(p.relative_to(out)):sha(p) for p in out.rglob('*')
                           if p.is_file() and p.relative_to(out).parts[0] not in ('avd','android-user')}
        save(out/'receipt.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root',type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.root),indent=2))
