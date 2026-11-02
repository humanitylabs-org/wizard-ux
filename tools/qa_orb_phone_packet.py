#!/usr/bin/env python3
"""One sealed forum build + signed86 upgrade + bounded native overlay gate.

Prepare only in the controller; execution requires the parent's heavy lease.
No feed/source deployment. Passed Chromium proof is inherited only by exact
renderer bytes; fresh device GL checks use the same assets in a debug WebView.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import xml.etree.ElementTree as ET

SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
OLD_SHA = '469b765e58e1525fffd78944c9f2cb8c4d1d97a4f9e156a79130d505512838b9'
SIGNED_TASKS = [':app:assembleRelease', ':app:testReleaseUnitTest', ':app:lintRelease']
DEBUG_TASKS = [':app:assembleDebug']


def signing_paths(owner_config=None, signing_env=None) -> tuple[str, str]:
    """Explicit remote worker paths only; never read the credential files here."""
    owner_config = owner_config or os.environ.get('WIZARD_OWNER_CONFIG')
    signing_env = signing_env or os.environ.get('WIZARD_OS_SIGNING_ENV')
    if not all(isinstance(p, str) and p and Path(p).is_absolute()
               for p in (owner_config, signing_env)):
        raise ValueError('absolute worker owner-config and signing-env paths are required')
    assert isinstance(owner_config, str) and isinstance(signing_env, str)
    return owner_config, signing_env


def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def verify_job(root, entry, signed):
    root = Path(root)
    assert root.is_relative_to('/srv/work/AndroidBuilds/jobs') and not root.is_symlink()
    for name, digest in entry['files'].items():
        p = root / name
        assert not p.is_symlink() and sha(p) == digest, name
    cfg = json.loads((root / 'job.json').read_text())
    assert cfg['host'] == 'forum' and cfg['java'] == '21' and not cfg['cap_sync']
    assert cfg['tasks'] == (SIGNED_TASKS if signed else DEBUG_TASKS)
    assert cfg['expected_signer'] == (SIGNER if signed else None)
    owner_config, signing_env = signing_paths() if signed else (None, None)
    assert cfg['signing_env'] == signing_env
    assert cfg['owner_config'] == owner_config
    assert cfg['revision'] == entry['revision'] and cfg['manifest_sha256'] == entry['manifest_sha256']
    members = {}
    with tarfile.open(root / 'source.tar.gz') as tar:
        for m in tar:
            if m.isfile():
                assert not Path(m.name).is_absolute() and '..' not in Path(m.name).parts
                f = tar.extractfile(m); assert f is not None
                members[m.name.removeprefix('./')] = hashlib.file_digest(f, 'sha256').hexdigest()
    assert members == {k:v['sha256'] for k,v in cfg['files'].items() if 'sha256' in v}
    assert members['tools/qa_orb_phone_packet.py'] == sha(__file__)
    return cfg


def verify(root, seal_path, digest):
    root = Path(root); seal_path = Path(seal_path)
    assert sha(seal_path) == digest
    seal = json.loads(seal_path.read_text())
    assert seal['schema'] == 'orb-phone-packet/v1'
    assert seal['old_apk_sha256'] == OLD_SHA and sha(root / 'baseline86.apk') == OLD_SHA
    for name, expected in seal['files'].items():
        p = root / name
        assert not p.is_symlink() and p.resolve().is_relative_to(root.resolve()) and sha(p) == expected, name
    a = verify_job(seal['signed']['root'], seal['signed'], True)
    b = verify_job(seal['debug']['root'], seal['debug'], False)
    assert a['revision'] == b['revision'] == seal['revision']
    assert a['files'] == b['files']
    assert a['files']['web/orb.js']['sha256'] == seal['reviewed_orb_sha256']
    assert a['files']['android/app/src/main/assets/assist/orb.js']['sha256'] == seal['reviewed_orb_sha256']
    assert sha(seal['prior_browser_receipt']) == seal['prior_browser_receipt_sha256']
    # Staging is read-only. Reserve includes both Gradle children and one guest.
    assert shutil.disk_usage('/srv/work').free >= (200 + 20) * 1024**3
    return seal


def artifact(root, package):
    receipt = json.loads((root / 'receipt.json').read_text())
    assert receipt['status'] == 'ok'
    cfg = json.loads((root / 'job.json').read_text())
    assert receipt['source_revision'] == cfg['revision'] and receipt['source_manifest_sha256'] == cfg['manifest_sha256']
    row, = [x for x in receipt['artifacts'] if x['aapt2']['package'] == package]
    p = root / 'source' / row['path']
    assert p.resolve().is_relative_to((root / 'source').resolve()) and sha(p) == row['sha256']
    assert row['aapt2']['version_code'] == '87'
    if package == 'ai.wizards.os':
        assert row['signer_sha256'] == SIGNER and row['aapt2']['version_name'] == '0.10.23'
    return p, row


def junit_counts(root):
    files = list((root / 'source/android/app/build/test-results/testReleaseUnitTest').glob('TEST-*.xml'))
    assert files
    counts = dict(tests=0, failures=0, errors=0, skipped=0)
    for p in files:
        xml = ET.parse(p).getroot()
        for k in counts: counts[k] += int(xml.attrib.get(k, '0'))
    assert counts['tests'] >= 392 and not any(counts[k] for k in ('failures', 'errors', 'skipped'))
    return counts


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--seal', required=True); ap.add_argument('--sha256', required=True)
    ap.add_argument('--preflight', action='store_true'); a = ap.parse_args()
    assert os.uname().nodename == 'forum'
    root = Path(a.seal).parent
    seal = verify(root, a.seal, a.sha256)
    if a.preflight:
        print(json.dumps({'ok': True, 'mode': 'static-only', 'revision': seal['revision'], 'seal_sha256': a.sha256})); return
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    st = Path('/srv/work/heavy/production/worker.lock').stat(); got = os.fstat(fd)
    assert (st.st_dev, st.st_ino) == (got.st_dev, got.st_ino)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    out = root / 'evidence'; out.mkdir()
    env = os.environ.copy(); env.update(PYTHONDONTWRITEBYTECODE='1', WIZARD_WORK_ROOT='/srv/work',
        ANDROID_HOME='/srv/work/android-sdk', ANDROID_SDK_ROOT='/srv/work/android-sdk',
        JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64')
    env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']
    result = {'ok': False, 'revision': seal['revision'], 'seal_sha256': a.sha256,
              'browser_proof': 'inherited exact reviewed renderer; 132 unique Chromium cases, not rerun', 'phases': {}}
    def phase(name, argv, cwd=None, timeout=900):
        with (out / (name + '.log')).open('w') as log:
            r = subprocess.run([str(x) for x in argv], cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                               pass_fds=(fd,), timeout=timeout)
        result['phases'][name] = {'exit_code': r.returncode, 'log_sha256': sha(out / (name + '.log'))}
        (out / 'receipt.json').write_text(json.dumps(result, indent=2))
        assert r.returncode == 0, name
    try:
        signed = Path(seal['signed']['root']); debug = Path(seal['debug']['root'])
        phase('signed-build', [sys.executable, signed / 'worker.py', '--worker', signed / 'job.json'], timeout=1800)
        release, row = artifact(signed, 'ai.wizards.os')
        result['junit'] = junit_counts(signed)
        phase('debug-build', [sys.executable, debug / 'worker.py', '--worker', debug / 'job.json'], timeout=1200)
        qa, _ = artifact(debug, 'ai.wizards.os.qa')
        source = signed / 'source'; tools = source / 'tools'
        phase('focused-node', ['node', '--test', 'tests/orb-render-recovery.test.mjs', 'tests/orb-icon-core.test.mjs',
              'tests/owner-skins-guard.test.mjs', 'tests/manager-orb-route.test.mjs'], cwd=source, timeout=120)
        sys.path.insert(0, str(tools))
        from apk_build_config import apk_build_config
        old_fields, new_fields = apk_build_config(root / 'baseline86.apk'), apk_build_config(release)
        assert old_fields['ORIGIN'] and old_fields['ORIGIN'] == new_fields['ORIGIN']
        assert new_fields['HOME_URL'] == old_fields['HOME_URL'] and not new_fields['PHOTOS_SERVER']
        cfg = dict(origin=new_fields['ORIGIN'], baseline_sha256=OLD_SHA,
                   baseline_version_code=86, candidate_version_code=87, candidate_version_name='0.10.23',
                   baseline_origin_mode='paired')
        private = root / 'upgrade-private.json'; private.write_text(json.dumps(cfg)); private.chmod(0o600)
        phase('signed-upgrade', [sys.executable, tools / 'qa_android_connect.py', '--upgrade-only', signed / 'receipt.json',
              root / 'baseline86.apk', private, signed / 'orb-upgrade'], timeout=900)
        phase('native-overlay', [sys.executable, tools / 'qa_orb_release_native.py', release, qa, signed / 'orb-native'], timeout=900)
        native = json.loads((signed / 'orb-native/receipt.json').read_text())
        assert native['ok'] and native['emulator_stopped'] and all(x['passed'] for x in native['checks'])
        result.update(ok=True, native_receipt=str(signed / 'orb-native/receipt.json'),
                      native_receipt_sha256=sha(signed / 'orb-native/receipt.json'), signed_artifact=row,
                      release_ready=False, remaining='Parent screenshot review + current feed/reservation readback + owner publisher audit; never sideload')
    finally:
        (out / 'receipt.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)


if __name__ == '__main__': main()
