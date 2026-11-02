#!/usr/bin/env python3
"""Controller-only process isolation for the unchanged native APKs. Not native acceptance.

REUSE: native.instrument/collect_lane and their real service lifecycle and assertions.
Fresh target/editor/test processes make the sole pre-dispatch package-matching input
session belong to THIS case, not the previous activity. No production fence is bypassed.
"""
import json
from pathlib import Path
import re
import time
import traceback


def save(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')


def package_processes(text, packages):
    """Android ps -A -o PID,NAME; match exact packages and their named processes only."""
    rows = []
    for line in text.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[0].isdigit():
            if any(fields[1] == p or fields[1].startswith(p + ':') for p in packages):
                rows.append({'pid': int(fields[0]), 'name': fields[1]})
    return rows


def stop_processes(native, command, adb, out, phase):
    command(adb + ['shell', 'settings', 'put', 'secure', 'enabled_accessibility_services', 'null'])
    command(adb + ['shell', 'settings', 'put', 'secure', 'accessibility_enabled', '0'])
    for package in (native.TEST, native.PKG):
        command(adb + ['shell', 'am', 'force-stop', package])
    deadline = time.monotonic() + 8
    samples = []
    while True:
        text = command(adb + ['shell', 'ps', '-A', '-o', 'PID,NAME'], timeout=10)
        if not re.search(r'\bPID\s+NAME\b', text):
            raise ValueError('unrecognized Android process census')
        rows = package_processes(text, (native.PKG, native.TEST))
        samples.append({'host_monotonic': time.monotonic(), 'processes': rows, 'raw': text})
        save(out / (phase + '-process-absence.json'), samples)
        if not rows:
            return samples
        if time.monotonic() >= deadline:
            raise TimeoutError('old target/editor/test process survived force-stop')
        time.sleep(0.1)


def fresh_case(native, command, adb, out):
    samples = stop_processes(native, command, adb, out, 'before')
    # Kill callbacks BEFORE deleting files; otherwise a dying activity may recreate them.
    files = ['files/dictation-fixture.json', 'files/dictation-fixture.json.tmp']
    command(adb + ['shell', 'run-as', native.PKG, 'rm', '-f', *files])
    for file in files:
        # run-as arguments are forwarded through the device shell, not a host shell.
        command(adb + ['shell', 'run-as', native.PKG, 'test', '!', '-e', file])
    save(out / 'isolation.json', {'status': 'fresh_processes_and_no_fixture',
        'packages': [native.PKG, native.TEST], 'previous_processes': samples[-1]['processes'],
        'removed_fixture_files': files, 'apk_rebuilt': False,
        'readiness_basis': 'one editor launch in a fresh target and :dictationEditor process; unchanged real IME package guard'})


def historical_source(packet_path):
    """Resolve only the frozen, already-built 27-case product, never a live candidate."""
    from qa_dictation_native_resume import PRODUCT
    packet = json.loads(Path(packet_path).read_text())
    candidate = packet['candidate']
    if packet['source_revision'] != PRODUCT or candidate['revision'] != PRODUCT:
        raise ValueError('historical product identity differs')
    receipt_path = Path(candidate['receipt'])
    receipt = json.loads(receipt_path.read_text())
    cfg = json.loads(receipt_path.with_name('job.json').read_text())
    if (receipt['status'] != 'ok' or receipt['host'] != 'forum'
            or receipt['source_revision'] != PRODUCT or cfg['revision'] != PRODUCT
            or receipt['source_manifest_sha256'] != candidate['manifest_sha256']
            or cfg['manifest_sha256'] != candidate['manifest_sha256']):
        raise ValueError('historical build identity differs')
    source = Path(receipt['job'])/'source'
    import hashlib
    for rel in ('android/app/src/androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java',
                'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java'):
        if hashlib.sha256((source/rel).read_bytes()).hexdigest() != cfg['files'][rel]['sha256']:
            raise ValueError('historical fixture source drift')
    return source


def editor_contract(source, methods):
    """Fail closed if unchanged APK source cannot justify first-session identity.

    This is source/process proof, not a replacement for Android's real readiness wait.
    Every selected case creates only one activity/editor. Selection precedes setContentView,
    requestFocus and connection creation. Other-field focus changes happen only on dispatch.
    """
    root = Path(source) / 'android/app/src'
    test = (root / 'androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java').read_text()
    fixture = (root / 'debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java').read_text()
    before_dispatch = test[test.index('private void editor('):test.index('private void dispatch(')]
    for token in ('fixture.delete();', 'FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK',
                  'getCurrentInputEditorInfo()', 'context.getPackageName().equals(method.getCurrentInputEditorInfo().packageName)'):
        if token not in before_dispatch: raise ValueError('original editor readiness contract drift: ' + token)
    if fixture.index('editor.setSelection(') > fixture.index('setContentView(layout); editor.requestFocus();'):
        raise ValueError('selection no longer precedes initial input session')
    if fixture.count('editor.requestFocus()') != 1:
        raise ValueError('multiple pre-dispatch focus paths')
    bodies = re.split(r'@Test public void ', test)[1:]
    found = {}
    for body in bodies:
        name = body.split('(', 1)[0]
        if name not in methods: continue
        calls = re.findall(r'editor\(("(?:[^"\\]|\\.)*"),("(?:[^"\\]|\\.)*"),(\d+),(\d+)\)', body)
        if len(calls) != 1: raise ValueError('case is not one literal editor launch: ' + name)
        mode, text, start, end = calls[0]
        found[name] = {'mode': json.loads(mode), 'text': json.loads(text), 'start': int(start), 'end': int(end)}
    if set(found) != set(methods) or len(methods) != len(set(methods)):
        raise ValueError('source case census differs')
    return found


def editor_sessions(log):
    sessions = []
    # API 35 A11yInputMethod prints lifecycle only, NOT EditorInfo fields.
    # The real installed keyboard logs its actual onStartInput EditorInfo in one
    # line. Audit that editor identity; do not pretend it is an accessibility probe.
    for line in log.splitlines():
        if 'GoogleInputMethodService.onStartInput()' not in line: continue
        pkg = re.search(r'packageName=([^,}]+)', line)
        field = re.search(r'fieldId=([^,}]+)', line)
        selection = re.search(r'initialSelStart=(-?\d+), initialSelEnd=(-?\d+)', line)
        if pkg and pkg[1] == 'ai.wizards.os.qa' and field and selection:
            sessions.append({'package':pkg[1], 'field_id':field[1], 'start':int(selection[1]), 'end':int(selection[2])})
    return sessions


def audit_editor(case_out, lane, expected):
    """Post-run audit, not an explicit accessibility pre-dispatch field probe."""
    fixture = json.loads((case_out/(lane+'-editor.json')).read_text())
    if fixture.get('mode') != expected['mode']:
        raise AssertionError('fixture belongs to another case: '+repr(fixture))
    log = (case_out/(lane+'-logcat.txt')).read_text()
    sessions = editor_sessions(log)
    save(case_out/'real-editor-sessions.json', {'sessions':sessions, 'expected':expected,
         'source':'real GoogleInputMethodService onStartInput log; not accessibility EditorInfo probe',
         'accessibility_lifecycle':[line for line in log.splitlines() if 'A11yInputMethod:' in line],
         'explicit_pre_dispatch_field_probe':False, 'identity_basis':'fresh processes and one editor before dispatch'})
    if not sessions or sessions[0] != {'package':'ai.wizards.os.qa','field_id':'1','start':expected['start'],'end':expected['end']}:
        raise AssertionError('first real editor field/selection did not match new fixture: '+repr(sessions))


def collect_isolated_lane(native, command, adb, lane, methods, out, env, contract=None):
    """Never stop independent cases because an earlier setup/assertion failed."""
    if not methods or len(methods) != len(set(methods)) or any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', m) for m in methods):
        raise ValueError('invalid/duplicate/empty case selection')
    result = {'status': 'failed', 'expected_cases': list(methods), 'per_case': {}, 'records': []}
    protocols = []
    for index, method in enumerate(methods, 1):
        case_out = out / lane / ('%02d-' % index + method)
        case_out.mkdir(parents=True, exist_ok=False)
        case = {'status': 'failed', 'method': method, 'evidence_directory': str(case_out)}
        try:
            fresh_case(native, command, adb, case_out)
            case.update(native.collect_lane(command, adb, lane, [method], case_out, env))
            path = case_out / (lane + '-instrumentation.txt')
            if path.is_file(): protocols.append(path.read_text())
            # Do not let a diagnostic/freshness mismatch turn into acceptance. Raw
            # protocol was already preserved even if this audit rejects the run.
            if contract is not None:
                try: audit_editor(case_out, lane, contract[method])
                except Exception:
                    case['status'] = 'failed'; case['editor_audit_error'] = traceback.format_exc()
        except Exception:
            case['error'] = traceback.format_exc()
            case['diagnostic_errors'] = native.diagnostics(command, adb, lane, case_out)
        finally:
            # collect_lane has already captured live diagnostics, BEFORE this teardown.
            try: stop_processes(native, command, adb, case_out, 'after')
            except Exception:
                case['status'] = 'failed'; case['cleanup_error'] = traceback.format_exc()
            result['records'].extend(case.get('records', []))
            result['per_case'][method] = case
            save(case_out / 'receipt.json', case)
            save(out / (lane + '-partial-receipt.json'), result)
    text = '\n'.join(protocols)
    (out / (lane + '-instrumentation.txt')).write_text(text)
    try:
        native.validate_native(text, methods, rejected=lane == 'rejected')
        if any(c['status'] != 'ok' for c in result['per_case'].values()):
            raise AssertionError('isolated setup/transport/assertion/cleanup failure')
        result['status'] = 'ok'
    except Exception:
        result['validation_error'] = traceback.format_exc()
    save(out / (lane + '-receipt.json'), result)
    return result
