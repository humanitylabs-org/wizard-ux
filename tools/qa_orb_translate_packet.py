#!/usr/bin/env python3
"""Admitted forum packet: signed release, focused UI regression, exact signed87 upgrade.

Stages are sealed outside the repository before admission. This tool never publishes.
All private image/origin files and receipts remain mode0700/0600 out of tree.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
BASELINE = '04a188ae173b3a2cd22139256be9fe3158355079949f8b44c4be0eca2f90b767'
TASKS = [':app:assembleRelease', ':app:testReleaseUnitTest', ':app:lintRelease']

def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def verify(root, seal, digest):
    assert os.uname().nodename == 'forum'
    assert root.is_relative_to('/srv/work/') and not root.is_symlink()
    assert sha(root / 'seal.json') == digest
    for name, expected in seal['files'].items():
        p = root / name
        assert not p.is_symlink() and p.resolve().is_relative_to(root.resolve()) and sha(p) == expected, name
    job = Path(seal['build_root'])
    assert job.is_relative_to('/srv/work/AndroidBuilds/jobs') and not job.is_symlink()
    for name, expected in seal['build_files'].items():
        assert sha(job / name) == expected, name
    cfg = json.loads((job / 'job.json').read_text())
    assert cfg['host'] == 'forum' and cfg['revision'] == seal['revision'] and cfg['tasks'] == TASKS
    assert cfg['expected_signer'] == SIGNER
    secure = Path.home() / '.wizard-secure/wizard-os'
    assert Path(cfg['signing_env']) == secure / 'signing.env'
    assert Path(cfg['owner_config']) == secure / 'wizard-address.gradle.properties'
    assert sha(root / 'baseline87.apk') == BASELINE
    assert shutil.disk_usage('/srv/work').free >= 220 * 1024**3
    return job

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--root', type=Path, required=True)
    ap.add_argument('--seal-sha256', required=True); ap.add_argument('--preflight', action='store_true')
    args = ap.parse_args(); root = args.root.resolve(); seal = json.loads((root / 'seal.json').read_text())
    job = verify(root, seal, args.seal_sha256)
    if args.preflight:
        print(json.dumps({'ok': True, 'mode': 'static-only', 'revision': seal['revision']})); return
    os.umask(0o077)
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    lock, inherited = Path('/srv/work/heavy/production/worker.lock').stat(), os.fstat(fd)
    assert (lock.st_dev, lock.st_ino) == (inherited.st_dev, inherited.st_ino)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    out = root / 'evidence'; out.mkdir(mode=0o700)
    result = {'ok': False, 'published': False, 'physical_phone': False, 'native_overlay_acceptance': False,
              'source_revision': seal['revision'], 'phases': {}, 'seal_sha256': args.seal_sha256}
    env = os.environ.copy(); env.update(QA_PLAYWRIGHT=seal['playwright'], PYTHONDONTWRITEBYTECODE='1', WIZARD_WORK_ROOT='/srv/work')
    def phase(name, argv, cwd=None, timeout=600, collect=False):
        with (out / (name + '.log')).open('w') as log:
            r = subprocess.run([str(x) for x in argv], cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,), timeout=timeout)
        result['phases'][name] = {'exit_code': r.returncode, 'log_sha256': sha(out / (name + '.log'))}
        (out / 'receipt.json').write_text(json.dumps(result, indent=2))
        if not collect:
            assert r.returncode == 0, name
        return r.returncode
    try:
        phase('signed-build', [sys.executable, job / 'worker.py', '--worker', job / 'job.json'], timeout=2400)
        receipt = json.loads((job / 'receipt.json').read_text()); assert receipt['status'] == 'ok'
        cfg = json.loads((job / 'job.json').read_text())
        assert receipt['source_revision'] == seal['revision'] and receipt['source_manifest_sha256'] == cfg['manifest_sha256']
        row, = [a for a in receipt['artifacts'] if a['aapt2']['package'] == 'ai.wizards.os']
        assert row['signer_sha256'] == SIGNER and row['aapt2']['version_code'] == '89' and row['aapt2']['version_name'] == '0.10.25'
        source = job / 'source'; apk = source / row['path']; assert sha(apk) == row['sha256']
        result['artifact'] = row
        counts = dict(tests=0, failures=0, errors=0, skipped=0)
        xmls = list((source / 'android/app/build/test-results/testReleaseUnitTest').glob('TEST-*.xml')); assert xmls
        for file in xmls:
            xml = ET.parse(file).getroot()
            for key in counts: counts[key] += int(xml.attrib.get(key, 0))
        assert counts['tests'] >= 392 and not any(counts[k] for k in ('failures','errors','skipped'))
        result['junit'] = counts
        phase('focused-node', ['node','--test','tests/screen-picture-translation.test.mjs','tests/screen-picture-fixture.test.mjs'],cwd=source,timeout=120)
        # Preserve a failed browser verdict while still collecting the independent upgrade.
        phase('exact-image-browser', ['node','tools/qa-screen-picture-translate.cjs',root / 'fixture',out / 'browser'],cwd=source,timeout=240,collect=True)
        browser_path = out / 'browser/receipt.json'
        browser = json.loads(browser_path.read_text()) if browser_path.exists() else {}
        result['browser_checks'] = len(browser.get('checks', []))
        result['browser_ok'] = bool(browser.get('ok') and browser.get('checks') and all(c['ok'] for c in browser['checks']))
        phase('existing-screen-browser', ['node','tools/qa-screen-page.cjs',source / 'android/app/src/main/assets/assist/screen.html',out / 'existing-screen'],cwd=source,timeout=240,collect=True)
        sys.path.insert(0, str(source / 'tools'))
        from apk_build_config import apk_build_config
        before, after = apk_build_config(root / 'baseline87.apk'), apk_build_config(apk)
        assert before['ORIGIN'] and before['ORIGIN'] == after['ORIGIN']
        assert before['HOME_URL'] == after['HOME_URL'] and not after['PHOTOS_SERVER']
        config = dict(origin=after['ORIGIN'], baseline_sha256=BASELINE, baseline_version_code=87,
                      candidate_version_code=89, candidate_version_name='0.10.25', baseline_origin_mode='paired')
        private = root / 'upgrade-private.json'; private.write_text(json.dumps(config)); private.chmod(0o600)
        phase('signed-upgrade', [sys.executable,source / 'tools/qa_android_connect.py','--upgrade-only',job / 'receipt.json',root / 'baseline87.apk',private,out / 'signed-upgrade'],timeout=900)
        upgrade = json.loads((out / 'signed-upgrade/receipt.json').read_text())
        assert upgrade['ok'] and upgrade['new_sha256'] == row['sha256'] and upgrade['old_sha256'] == BASELINE
        assert upgrade['total'] == len(upgrade['checks']) == upgrade['passed'] and all(c['passed'] for c in upgrade['checks'])
        assert len({c['name'] for c in upgrade['checks']}) == upgrade['total'] and any(c['name'] == 'owned emulator serial is absent' for c in upgrade['checks'])
        result['upgrade_checks'] = upgrade['total']
        result['ok'] = result['browser_ok'] and all(p['exit_code'] == 0 for p in result['phases'].values())
    finally:
        (out / 'receipt.json').write_text(json.dumps(result,indent=2)); print(json.dumps(result),flush=True)
    if not result['ok']:
        raise SystemExit(1)

if __name__ == '__main__': main()
