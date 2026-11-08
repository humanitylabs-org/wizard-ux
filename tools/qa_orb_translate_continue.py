#!/usr/bin/env python3
"""QA-only continuation for an immutable successful Orb APK. Never builds or publishes."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
from typing import Any
import xml.etree.ElementTree as ET
import zipfile


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(root, digest):
    assert os.uname().nodename == 'forum'
    assert root.is_relative_to('/srv/work/AndroidBuilds/') and not root.is_symlink()
    assert sha(root / 'manifest.json') == digest
    spec = json.loads((root / 'manifest.json').read_text())
    for name, expected in spec['files'].items():
        path = Path(name)
        assert path.is_absolute() and path.is_relative_to('/srv/work/') and not path.is_symlink()
        assert sha(path) == expected, name
    job = Path(spec['build_root'])
    signed = json.loads((job / 'receipt.json').read_text())
    failed = json.loads((Path(spec['prior_root']) / 'evidence/receipt.json').read_text())
    assert signed['status'] == 'ok' and signed['source_revision'] == spec['built_revision']
    assert signed['source_manifest_sha256'] == spec['source_manifest_sha256']
    assert failed['phases']['signed-build']['exit_code'] == failed['phases']['focused-node']['exit_code'] == 0
    assert failed['phases']['exact-image-browser']['exit_code'] == 1
    artifact, = signed['artifacts']
    assert artifact == failed['artifact']
    apk = job / 'source' / artifact['path']
    assert sha(apk) == spec['apk_sha256'] == artifact['sha256']
    assert artifact['signer_sha256'] == spec['signer_sha256']
    assert artifact['aapt2']['version_code'] == '89' and artifact['aapt2']['version_name'] == '0.10.25'
    asset = job / 'source/android/app/src/main/assets/assist/screen.html'
    with zipfile.ZipFile(apk) as packaged:
        assert packaged.read('assets/assist/screen.html') == asset.read_bytes()
    assert sha(asset) == spec['screen_asset_sha256']
    # Every regular archived input, including the Android asset, stays byte-identical.
    # QA files run from this sibling stage, never from mutations to the original job.
    count = 0
    with tarfile.open(job / 'source.tar.gz') as archive:
        for member in archive.getmembers():
            assert not (member.issym() or member.islnk()), member.name
            if not member.isfile():
                continue
            target = job / 'source' / member.name
            assert target.resolve().is_relative_to((job / 'source').resolve()) and not target.is_symlink()
            stream = archive.extractfile(member)
            assert stream is not None
            expected = hashlib.sha256(stream.read()).hexdigest()
            assert sha(target) == expected, member.name
            count += 1
    counts = dict(tests=0, failures=0, errors=0, skipped=0)
    xmls = sorted((job / 'source/android/app/build/test-results/testReleaseUnitTest').glob('TEST-*.xml'))
    assert xmls
    for path in xmls:
        assert str(path) in spec['files'], path
        xml = ET.parse(path).getroot()
        for key in counts:
            counts[key] += int(xml.attrib.get(key, 0))
    assert counts == failed['junit'] == dict(tests=392, failures=0, errors=0, skipped=0)
    return spec, job, apk, counts, count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    spec, job, apk, counts, source_count = verify(root, args.manifest_sha256)
    if args.preflight:
        print(json.dumps(dict(ok=True, mode='static-only', source_files=source_count, junit=counts, apk_sha256=sha(apk))))
        return
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    expected, actual = Path('/srv/work/heavy/production/worker.lock').stat(), os.fstat(fd)
    assert (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.umask(0o077)
    out = root / 'evidence'
    out.mkdir(mode=0o700)  # Refuse an existing result before entering finally.
    result: dict[str, Any] = dict(ok=False, published=False, physical_phone=False, native_overlay_acceptance=False,
                  built_revision=spec['built_revision'], qa_revision=spec['qa_revision'],
                  inherited_heavy_job=spec['inherited_heavy_job'], artifact_sha256=sha(apk),
                  inherited_junit=counts, inherited_source_files=source_count,
                  manifest_sha256=args.manifest_sha256, phases={})
    env = os.environ.copy()
    env.update(QA_PLAYWRIGHT=spec['playwright'], WIZARD_WORK_ROOT='/srv/work',
               ANDROID_BUILDS_ROOT='/srv/work/AndroidBuilds', PYTHONDONTWRITEBYTECODE='1',
               SCREEN_PAGE_SOURCE=str(job / 'source/android/app/src/main/assets/assist/screen.html'))

    def phase(name, argv, timeout=240):
        log_path = out / (name + '.log')
        with log_path.open('w') as log:
            process = subprocess.Popen([str(v) for v in argv], cwd=job / 'source', env=env,
                                       stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,), start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise
        result['phases'][name] = dict(exit_code=code, log_sha256=sha(log_path))
        (out / 'receipt.json').write_text(json.dumps(result, indent=2))
        return code

    try:
        phase('fixture-bridge', ['node', '--test', root / 'tests/screen-picture-fixture.test.mjs'], 60)
        # A failed optional interaction remains failed; independent signed-upgrade QA still runs.
        phase('exact-image-browser', ['node', root / 'tools/qa-screen-picture-translate.cjs',
                                     Path(spec['prior_root']) / 'fixture', out / 'browser'])
        browser_path = out / 'browser/receipt.json'
        if browser_path.exists():
            browser = json.loads(browser_path.read_text())
            result['browser'] = dict(ok=browser.get('ok', False), checks=browser.get('checks', []),
                                     screenshots=browser.get('screenshots', []))
        # This exact source already passed the existing-screen phase in the failed packet.
        result['inherited_existing_screen'] = failed_phase = json.loads((Path(spec['prior_root']) / 'evidence/receipt.json').read_text())['phases']['existing-screen-browser']
        assert failed_phase['exit_code'] == 0
        sys.path.insert(0, str(job / 'source/tools'))
        from apk_build_config import apk_build_config
        baseline = Path(spec['prior_root']) / 'baseline87.apk'
        before, after = apk_build_config(baseline), apk_build_config(apk)
        assert before['ORIGIN'] and before['ORIGIN'] == after['ORIGIN']
        assert before['HOME_URL'] == after['HOME_URL'] and not after['PHOTOS_SERVER']
        private = root / 'upgrade-private.json'
        private.write_text(json.dumps(dict(origin=after['ORIGIN'], baseline_sha256=sha(baseline),
                                           baseline_version_code=87, candidate_version_code=89,
                                           candidate_version_name='0.10.25', baseline_origin_mode='paired')))
        private.chmod(0o600)
        phase('signed-upgrade', [sys.executable, root / 'tools/qa_android_connect.py', '--upgrade-only',
                                job / 'receipt.json', baseline, private, out / 'signed-upgrade'], 940)
        upgrade_path = out / 'signed-upgrade/receipt.json'
        if upgrade_path.exists():
            upgrade = json.loads(upgrade_path.read_text())
            assert upgrade['new_sha256'] == sha(apk) and upgrade['old_sha256'] == sha(baseline)
            assert upgrade['total'] == len(upgrade['checks'])
            assert len({row['name'] for row in upgrade['checks']}) == upgrade['total']
            assert any(row['name'] == 'owned emulator serial is absent' and row['passed'] for row in upgrade['checks'])
            result['upgrade'] = dict(ok=upgrade['ok'], total=upgrade['total'], passed=upgrade['passed'])
        result['ok'] = (len(result['phases']) == 3 and all(p['exit_code'] == 0 for p in result['phases'].values())
                        and result.get('browser', {}).get('ok') and result.get('upgrade', {}).get('ok'))
    finally:
        (out / 'receipt.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    if not result['ok']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
