#!/usr/bin/env python3
"""Sealed parent-review handoff; reuse build/share/Connect runners, never publish.
Runs ONLY under forum's inherited durable lease, after a separate exact-seal approval.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

RESERVE = 200 * 1024**3
# Both extracted Gradle builds, three retained AVDs, APKs/logs, source staging.
FOOTPRINT = (12 + 9 + 1) * 1024**3 + 256 * 1024**2
SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'


def digest(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def capacity(free):
    return dict(free_bytes=free, reserve_bytes=RESERVE, footprint_bytes=FOOTPRINT,
                required_bytes=RESERVE + FOOTPRINT, pass_gate=free >= RESERVE + FOOTPRINT)


def verify(root, expected):
    seal = root / 'release-seal.json'
    if digest(seal) != expected:
        raise ValueError('release seal drift')
    data = json.loads(seal.read_text())
    for filename, want in data['files'].items():
        p = Path(filename)
        if not p.is_absolute() or not str(p).startswith('/srv/work/') or p.is_symlink() or digest(p) != want:
            raise ValueError('sealed input drift')
    return data


def authorize(auth, seal_sha, revision):
    if auth.get('seal_sha256') != seal_sha or auth.get('revision') != revision:
        raise ValueError('authorization identity mismatch')
    for gate in ('independent_review_passed', 'version84_custody_resolved', 'live_and_feed_rechecked',
                 'signing_provisioned', 'baseline_receipt_traced', 'notification_visual_limit_accepted_for_rerun'):
        if auth.get(gate) is not True:
            raise ValueError('parent release gate missing: ' + gate)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--seal-sha256', required=True)
    p.add_argument('--authorization', required=True, type=Path)
    args = p.parse_args()
    root = Path(__file__).resolve().parent
    if os.uname().nodename != 'forum' or not str(root).startswith('/srv/work/'):
        raise SystemExit('forum durable runner only')
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    held, wanted = os.fstat(fd), Path('/srv/work/heavy/production/worker.lock').stat()
    if (held.st_dev, held.st_ino) != (wanted.st_dev, wanted.st_ino):
        raise SystemExit('wrong durable lease')
    seal = verify(root, args.seal_sha256)
    cfg = json.loads((root / 'packet.json').read_text())
    authorize(json.loads(args.authorization.read_text()), args.seal_sha256, cfg['revision'])
    state = capacity(shutil.disk_usage(root).free)
    if not state['pass_gate']:
        raise SystemExit('200 GiB reserve plus full 22.25 GiB footprint required')
    release, debug = Path(cfg['release_job']), Path(cfg['debug_job'])
    for job in (release, debug):
        d = json.loads((job / 'job.json').read_text())
        if d['revision'] != cfg['revision'] or (job / 'source').exists() or (job / 'receipt.json').exists():
            raise SystemExit('job revision drift or already used')
    sign = json.loads((release / 'job.json').read_text())
    if sign['signing_env'] != str(Path.home() / '.wizard-secure/wizard-os/signing.env') or sign['expected_signer'] != SIGNER:
        raise SystemExit('wrong signing identity')
    signing = Path(sign['signing_env'])
    if not signing.is_file() or signing.stat().st_mode & 0o077:
        raise SystemExit('private Wizard OS signing environment missing')
    # Inspect names only, never echo/import secret values in the controller.
    import re
    names = set(re.findall(r'(?m)^\s*(?:export\s+)?(WOS_[A-Z_]+)\s*=', signing.read_text()))
    if not {'WOS_KEYSTORE', 'WOS_STORE_PASSWORD', 'WOS_KEY_ALIAS', 'WOS_KEY_PASSWORD'} <= names:
        raise SystemExit('Wizard OS signing names missing')
    out = root / 'release-evidence'; out.mkdir(mode=0o700, exist_ok=False)
    report = dict(status='RUNNING', source_revision=cfg['revision'], seal_sha256=args.seal_sha256,
                  storage=state, publication=False, physical_device=False, phases=[])
    env = os.environ.copy()
    for key in list(env):
        if key.startswith('ORG_GRADLE_PROJECT_') or key in ('GRADLE_OPTS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'WIZARD_ORIGIN', 'WIZARD_DEFAULT_ORIGIN', 'WIZARD_HOME_URL', 'WIZARD_PHOTOS_SERVER', 'WIZARD_UPDATE_ORIGIN'):
            env.pop(key)
    origin = json.loads((root / 'owner82.json').read_text())['origin']
    env.update(ORG_GRADLE_PROJECT_wizardOrigin=origin, ORG_GRADLE_PROJECT_photosServer='',
               WIZARD_WORK_ROOT='/srv/work', ANDROID_BUILDS_ROOT='/srv/work/AndroidBuilds',
               ANDROID_HOME='/srv/work/android-sdk', ANDROID_SDK_ROOT='/srv/work/android-sdk',
               JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64')

    def run(name, argv):
        with (out / (name + '.log')).open('w') as log:
            result = subprocess.run(list(map(str, argv)), env=env, stdout=log, stderr=subprocess.STDOUT,
                                    pass_fds=(fd,), timeout=4800)
        report['phases'].append(dict(name=name, exit_code=result.returncode))
        if result.returncode:
            raise RuntimeError(name + ' failed; private log retained')

    try:
        run('signed-build', ['/usr/bin/python3', release / 'worker.py', '--worker', release / 'job.json'])
        totals = dict(tests=0, failures=0, errors=0, skipped=0)
        for path in (release / 'source/android/app/build/test-results/testReleaseUnitTest').glob('TEST-*.xml'):
            node = ET.parse(path).getroot()
            for key in totals: totals[key] += int(node.get(key, '0'))
        if not totals['tests'] or any(totals[key] for key in ('failures', 'errors', 'skipped')):
            raise RuntimeError('signed unit gate failed')
        report['release_junit'] = totals
        debug_seal = debug / 'android-seal.json'
        run('synthetic-native-share', ['/usr/bin/python3', debug / 'qa_unified_share_android.py',
                                      '--seal', debug_seal, '--seal-sha256', digest(debug_seal)])
        runner = release / 'source/tools/qa_android_connect.py'
        for code in (82, 62):
            run('signed-upgrade-' + str(code), ['/usr/bin/python3', runner, '--upgrade-only', release / 'receipt.json',
                root / ('baseline' + str(code) + '.apk'), root / ('owner' + str(code) + '.json'),
                release / ('upgrade-' + str(code))])
        report['status'] = 'PASS_SIGNED_AND_SYNTHETIC_GATES_REQUIRES_PARENT_VISUAL_REVIEW'
        report['limits'] = ['No paired-handset/authenticated-session/Messenger proof',
                            '82 path is empty-default recovery, not proof of a naturally paired origin',
                            '62 path proves baked-origin skipped-version recovery without seeded preferences',
                            'Parent must inspect new notification screenshot and live-feature parity before promotion']
    except BaseException:
        report['status'] = 'FAIL'
        raise
    finally:
        (out / 'receipt.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__': main()
