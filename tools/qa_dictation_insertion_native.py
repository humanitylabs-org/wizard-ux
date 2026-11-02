#!/usr/bin/env python3
"""Forum queue-only dictation native gate. Run after the sealed debug/control build workers.

Real accessibility service, real inherited EverywhereService.onDictated, real outbox, cross-process
native editor. No audio/server/handset claim. An attached caller deliberately avoids unrelated
meeting-sync/overlay startup; tests explicitly exercise the production insertion/delivery methods.
All emulator state is job-owned, finally stopped; no existing emulator or phone may be targeted.
"""
import argparse

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import time
import traceback
import xml.etree.ElementTree as ET
from qa_queue_lease import validated_queue_fd
from qa_dictation_case_isolation import collect_isolated_lane, editor_contract

SDK = Path('/srv/work/android-sdk')
BASE = Path('/srv/work/AndroidBuilds')
PKG = 'ai.wizards.os.qa'
TEST = 'ai.wizards.os.qa.test'
CLASS = 'ai.wizards.os.everywhere.DictationInsertionE2eTest'
CONTROLS = {'noopInputConnectionWorkingPastePreservesSingleInsertion',
            'missingNodeWorkingInputConnectionPreservesSingleInsertion'}


class NativeDeadline(BaseException):
    """Unwind through the emulator's finally BEFORE the parent's hard child timeout."""


def expire_native(signum, frame):
    raise NativeDeadline('native 2300-second budget exhausted; no acceptance claim')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def statuses(text):
    """Only completed per-test protocol records count, never grep 'OK' or process exit alone."""
    results, current, last = [], {}, None
    for line in text.splitlines():
        match = re.match(r'INSTRUMENTATION_STATUS: ([^=]+)=(.*)', line)
        if match:
            last = match[1]
            current[last] = match[2]
        elif line.startswith('INSTRUMENTATION_STATUS_CODE:'):
            code = int(line.split(':', 1)[1].strip())
            if code != 1:
                results.append(dict(current, code=code))
            current, last = {}, None
        elif last is not None:
            current[last] += '\n' + line
    return results


def validate_native(text, expected, rejected=False):
    records = statuses(text)
    names = [row.get('test') for row in records]
    if len(records) != len(expected) or set(names) != set(expected) or len(names) != len(set(names)):
        raise AssertionError(f'native completion census differs: {names!r}')
    if 'INSTRUMENTATION_FAILED' in text or 'Process crashed' in text:
        raise AssertionError('instrumentation failed/crashed')
    for row in records:
        if row.get('class') != CLASS:
            raise AssertionError(f'foreign native class: {row}')
        if rejected:
            if row['code'] != -2 or 'exact field text' not in row.get('stack', ''):
                raise AssertionError(f'negative control did not fail at the expected insertion assertion: {row}')
        elif row['code'] != 0:
            raise AssertionError(f'native case failed/skipped: {row}')
    return records


def unit_census(source):
    rows = []
    for report in (Path(source) / 'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
        root = ET.parse(report).getroot()
        rows.append({key: root.attrib.get(key, '0') for key in ('name', 'tests', 'failures', 'errors', 'skipped')})
    if not rows or any(int(row[k]) for row in rows for k in ('failures','errors','skipped')):
        raise AssertionError('missing/failing/skipped unit census')
    return {'tests': sum(int(row['tests']) for row in rows), 'suites': rows}


def artifact(receipt, package):
    entries = [a for a in receipt['artifacts'] if a.get('aapt2',{}).get('package') == package]
    if len(entries) != 1:
        raise AssertionError(f'expected one {package} APK, got {entries}')
    entry = entries[0]
    path = Path(receipt['job']) / 'source' / entry['path']
    if not path.resolve().is_relative_to(Path(receipt['job']) / 'source') or sha(path) != entry['sha256']:
        raise AssertionError('APK identity mismatch')
    return path, entry


def automation_ready(text):
    """API-35 framework registration is after am's destructive start-instrumentation step.

    Use the LAST registration: a default getUiAutomation() call must not pass on
    an earlier non-suppressing instance. This is a readiness signal, never proof
    that WizardKeyboardService or the cross-process editor works.
    """
    flags = re.findall(r'UiAutomationManager\s*: Registering UiTestAutomationService '
                       r'\(id=com\.android\.server\.accessibility/UiAutomation, flags=0x([0-9a-fA-F]+)\)', text)
    return bool(flags) and int(flags[-1], 16) & 1 == 1


def instrumentation_argv(adb, methods, lane):
    selection = ','.join(CLASS+'#'+method for method in methods)
    return [str(a) for a in adb] + ['shell','am','instrument','-w','-r','-e','lane',
        'candidate' if lane == 'candidate' else 'control','-e','class',selection,
        TEST+'/androidx.test.runner.AndroidJUnitRunner']


def instrument(command, adb, methods, lane, out, env, *, timeout=600):
    """Enable the REAL service only AFTER instrumentation has killed/restarted its process.

    Existing @Before already requests FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES.
    Before am instrument, keep the service disabled so force-stop cannot remove
    its enablement or kill a binding. No APK/test method changes or service stub.
    """
    command(adb+['shell','settings','put','secure','enabled_accessibility_services','null'])
    command(adb+['shell','settings','put','secure','accessibility_enabled','0'])
    command(adb+['logcat','-c'])
    (out/(lane+'-pre-instrument-accessibility.txt')).write_text(command(adb+['shell','dumpsys','accessibility']))
    deadline = time.monotonic() + timeout
    error = None
    with (out/(lane+'-instrumentation.txt')).open('w') as stdout, (out/(lane+'-instrumentation-stderr.txt')).open('w') as stderr:
        proc = subprocess.Popen(instrumentation_argv(adb,methods,lane), env=env, stdout=stdout, stderr=stderr)
        try:
            while proc.poll() is None:
                text = command(adb+['logcat','-d','-v','threadtime','-s','UiAutomationManager:I'],timeout=10)
                (out/(lane+'-automation-readiness.txt')).write_text(text)
                if automation_ready(text):
                    component = PKG+'/ai.wizards.os.everywhere.WizardKeyboardService'
                    command(adb+['shell','settings','put','secure','enabled_accessibility_services',component])
                    command(adb+['shell','settings','put','secure','accessibility_enabled','1'])
                    break
                if time.monotonic() >= deadline: raise TimeoutError('UiAutomation non-suppressing registration missing')
                time.sleep(0.1)
            else:
                raise RuntimeError('instrumentation exited before non-suppressing UiAutomation registration')
            proc.wait(timeout=max(0.1,deadline-time.monotonic()))
            if proc.returncode: raise RuntimeError('am instrument exit '+str(proc.returncode))
        except Exception:
            error = traceback.format_exc()
        finally:
            if proc.poll() is None:
                # Do not leave device instrumentation running after terminating the host adb.
                try: command(adb+['shell','am','force-stop',PKG],timeout=15)
                except Exception: pass
                proc.terminate()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=10)
    return error


def diagnostics(command, adb, lane, out):
    """Best effort only; missing optional editor output must never replace test results."""
    errors = {}
    tasks = [
        ('accessibility.txt', ['shell','dumpsys','accessibility'], False),
        ('services.txt', ['shell','dumpsys','activity','services',PKG], False),
        ('processes.txt', ['shell','ps','-A'], False),
        ('enabled-services.txt', ['shell','settings','get','secure','enabled_accessibility_services'], False),
        ('logcat.txt', ['logcat','-d','-v','threadtime'], False),
        ('screen.png', ['exec-out','screencap','-p'], True),
        ('editor.json', ['shell','run-as',PKG,'cat','files/dictation-fixture.json'], False)]
    for name, args, binary in tasks:
        try:
            data = command(adb+args,binary=binary,timeout=30)
            path = out/(lane+'-'+name)
            if binary: path.write_bytes(data)
            else: path.write_text(data)
        except Exception:
            errors[name] = traceback.format_exc()
    return errors


def collect_lane(command, adb, lane, methods, out, env):
    result = {'status':'failed','expected_cases':list(methods)}
    try:
        transport_error = instrument(command,adb,methods,lane,out,env,timeout=90)
        text = (out/(lane+'-instrumentation.txt')).read_text()
        result['records'] = statuses(text)  # retain raw failures even when strict validation refuses them
        try:
            validate_native(text,methods,rejected=lane=='rejected')
        except Exception:
            result['validation_error'] = traceback.format_exc()
        if transport_error: result['transport_error'] = transport_error
        if not transport_error and 'validation_error' not in result: result['status']='ok'
    except Exception:
        result['error'] = traceback.format_exc()
    finally:
        # Capture live framework/process state BEFORE accessibility disable/uninstall.
        result['diagnostic_errors'] = diagnostics(command,adb,lane,out)
    return result


def require_lanes(cases):
    failures = {lane:result for lane,result in cases.items() if result['status'] != 'ok'}
    if set(cases) != {'baseline','rejected','candidate'} or failures:
        raise AssertionError('native lanes failed/incomplete: '+', '.join(failures or sorted(set(cases)^{'baseline','rejected','candidate'})))


def run(config_path, out):
    config = json.loads(Path(config_path).read_text())
    # Parent supplies an inherited queue lease. No direct-SSH or standalone emulator bypass.
    validated_queue_fd()
    if shutil.disk_usage(BASE).free < 200*1024**3: raise RuntimeError('200 GiB reserve required')
    if not out.resolve().is_relative_to(BASE) or out.exists():
        raise ValueError('output must be a NEW directory under worker root')
    out.mkdir(parents=True)
    env = dict(os.environ, ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK),
               ANDROID_AVD_HOME=str(out/'avd'), ANDROID_USER_HOME=str(out/'android-user'),
               JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64')
    env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']
    Path(env['ANDROID_AVD_HOME']).mkdir()
    Path(env['ANDROID_USER_HOME']).mkdir()
    evidence = {'status':'failed','handset_proven':False,'server_or_microphone_tested':False,
                'source_revision':config['source_revision'],'cases':{}, 'stopped_emulator':False}
    emulator = None
    emlog = None
    def command(argv, *, timeout=180, stdin=None, binary=False, check=True):
        result = subprocess.run([str(a) for a in argv],env=env,input=stdin,capture_output=True,
                                text=not binary,timeout=timeout)
        if check and result.returncode:
            raise RuntimeError(f'command exit {result.returncode}: {argv}: {result.stderr!r}')
        return result.stdout
    port = config.get('emulator_port',5756)
    # Do not attach to or kill any existing instance; refuse an occupied port.
    for number in (port,port+1):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',number))
    serial = f'emulator-{port}'
    adb = [SDK/'platform-tools/adb','-s',serial]
    previous_alarm = signal.signal(signal.SIGALRM, expire_native)
    signal.alarm(2300)
    try:
        command([SDK/'cmdline-tools/latest/bin/avdmanager','create','avd','--force','-n','dictation',
                 '-k','system-images;android-35;google_apis;x86_64','--device','pixel_7'],stdin='no\n')
        emlog = (out/'emulator.log').open('w')
        emulator = subprocess.Popen([str(SDK/'emulator/emulator'),'-avd','dictation','-port',str(port),
                  '-no-window','-no-audio','-no-boot-anim','-no-snapshot','-wipe-data','-accel','on',
                  '-gpu','swiftshader_indirect','-memory','3072','-cores','4'],env=env,stdout=emlog,stderr=subprocess.STDOUT)
        deadline = time.monotonic()+240
        while time.monotonic() < deadline:
            if emulator.poll() is not None: raise RuntimeError('emulator exited during boot')
            value = command(adb+['shell','getprop','sys.boot_completed'],timeout=15,check=False)
            if value.strip() == '1': break
            time.sleep(2)
        else: raise TimeoutError('emulator boot')
        command(adb+['shell','input','keyevent','82'])
        for lane in ('baseline','rejected','candidate'):
            # One instrumentation and fresh target/editor processes per method. Do not
            # reuse the previous activity/IME session, nor lose independent failed protocols.
            try:
                receipt = json.loads(Path(config[lane]['receipt']).read_text())
                if receipt.get('status') != 'ok' or receipt['source_revision'] != config[lane]['revision']:
                    raise AssertionError(f'{lane} receipt mismatch')
                apk, meta = artifact(receipt,PKG); test, testmeta = artifact(receipt,TEST)
                command(adb+['uninstall',TEST],check=False); command(adb+['uninstall',PKG],check=False)
                command(adb+['install','-t',apk]); command(adb+['install','-t',test])
                # No owner defaults or endpoints: both override channels point to dead loopback.
                for name in ('qa_origin.txt','qa_home.txt'):
                    command(adb+['shell','run-as',PKG,'sh','-c',f'"mkdir -p files; printf http://127.0.0.1:1 > files/{name}"'])
                methods = config['candidate_cases'] if lane == 'candidate' else sorted(CONTROLS)
                contract = editor_contract(Path(receipt['job'])/'source', methods)
                (out/(lane+'-editor-contract.json')).write_text(json.dumps(contract,indent=2)+'\n')
                result = collect_isolated_lane(__import__(__name__),command,adb,lane,methods,out,env,contract=contract)
                result.update(apk=meta,test_apk=testmeta,revision=receipt['source_revision'])
                evidence['cases'][lane] = result
                if lane == 'candidate':
                    source = Path(receipt['job'])/'source'
                    evidence['unit'] = unit_census(source)
                    lint = source/'android/app/build/reports/lint-results-debug.xml'
                    issues = ET.parse(lint).getroot().findall('issue')
                    evidence['lint'] = {severity:sum(i.get('severity')==severity for i in issues) for severity in ('Error','Fatal','Warning')}
                    if evidence['lint']['Error'] or evidence['lint']['Fatal']: raise AssertionError('lint errors')
                    evidence['lint_sha256'] = sha(lint)
            except Exception:
                result = evidence['cases'].setdefault(lane,{'status':'failed'})
                result['status'] = 'failed'; result['error'] = traceback.format_exc()
                result.setdefault('diagnostic_errors',diagnostics(command,adb,lane,out))
            finally:
                try: command(adb+['shell','settings','put','secure','accessibility_enabled','0'])
                except Exception:
                    evidence.setdefault('cleanup_errors',{})[lane] = traceback.format_exc()
        require_lanes(evidence['cases'])
        if evidence.get('cleanup_errors'): raise AssertionError('accessibility cleanup failed')
        evidence['status']='ok'
    except BaseException:
        evidence['error']=traceback.format_exc()
        raise
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_alarm)
        if emulator is not None:
            try: command(adb+['emu','kill'],timeout=15,check=False)
            except (subprocess.SubprocessError, OSError): pass
            try: emulator.wait(timeout=25)
            except subprocess.TimeoutExpired:
                emulator.terminate()
                try: emulator.wait(timeout=15)
                except subprocess.TimeoutExpired: emulator.kill(); emulator.wait(timeout=10)
            evidence['stopped_emulator']=emulator.poll() is not None
        if emlog: emlog.close()
        evidence['files']={str(p.relative_to(out)):sha(p) for p in out.rglob('*')
                           if p.is_file() and p.relative_to(out).parts[0] not in ('avd','android-user')}
        (out/'receipt.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args(); print(json.dumps(run(args.config,args.output),indent=2))
