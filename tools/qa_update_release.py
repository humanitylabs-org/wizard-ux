#!/usr/bin/env python3
"""Bounded Thales release gate for a prepared signed + QA updater build pair.
Never publishes. Requires an inherited durable-worker lease; evidence survives failures.
usage: qa_update_release.py RELEASE_JOB QA_JOB OLD_APK OUTPUT REVISION
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    release_job, qa_job, old_apk, output = map(Path, sys.argv[1:5])
    revision = sys.argv[5]
    if sys.platform != 'darwin' or not os.environ.get('WIZARD_HEAVY_LOCK_FD'):
        raise SystemExit('Use the durable Thales worker with its inherited lease')
    for p in (release_job, qa_job, old_apk, output):
        if not p.resolve().is_relative_to('/Volumes/ThalesMedia'):
            raise SystemExit('Work must remain on ThalesMedia')
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    output.mkdir(parents=True, exist_ok=False)
    receipt = {'source_revision': revision, 'ok': False, 'steps': [], 'old_sha256': digest(old_apk)}

    def run(name, argv):
        print(name, flush=True)
        with (output / (name + '.log')).open('w') as log:
            result = subprocess.run(list(map(str, argv)), stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,))
        receipt['steps'].append({'name': name, 'exit_code': result.returncode, 'log': str(output / (name + '.log'))})
        if result.returncode:
            raise RuntimeError(name + ' failed; read its private phase log')

    def build(job, name):
        config = json.loads((job / 'job.json').read_text())
        assert config['revision'] == revision, 'prepared revision drift'
        run(name, [sys.executable, job / 'worker.py', '--worker', job / 'job.json'])
        result = json.loads((job / 'receipt.json').read_text())
        assert result['status'] == 'ok' and result['source_revision'] == revision
        assert result['source_manifest_sha256'] == config['manifest_sha256']
        receipt[name] = result
        totals = dict(tests=0, failures=0, errors=0, skipped=0)
        suites = []
        for report in (job / 'source/android/app/build/test-results').rglob('TEST-*.xml'):
            root = ET.parse(report).getroot()
            suites.append({'name': root.attrib.get('name'), **{k: int(root.attrib.get(k, 0)) for k in totals}})
            for k in totals:
                totals[k] += int(root.attrib.get(k, 0))
        assert totals['tests'] and not totals['failures'] and not totals['errors'], totals
        receipt[name + '_units'] = {'totals': totals, 'suites': suites}
        print(name + ' JUnit ' + json.dumps(totals), flush=True)
        artifacts = {}
        for artifact in result['artifacts']:
            apk = job / 'source' / artifact['path']
            assert digest(apk) == artifact['sha256']
            artifacts[artifact['aapt2']['version_name']] = apk
        return artifacts

    try:
        release = build(release_job, 'release-build')
        qa = build(qa_job, 'qa-build')
        assert len(release) == 1
        version, signed_apk = next(iter(release.items()))
        assert version == '0.9.31'
        meta = receipt['release-build']['artifacts'][0]
        assert meta['aapt2']['version_code'] == '55'
        assert meta['aapt2']['package'] == 'ai.wizards.os'
        assert meta['signer_sha256'] == '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
        assert receipt['old_sha256'] == '31db00254c7c901c04da98b0d3b8719be217666f6d57bbc6c6a5dccfa2b06166'
        src = qa_job / 'source'
        run('signed-upgrade', [sys.executable, src / 'tools/qa_upgrade.py', old_apk, signed_apk])
        run('silent-update', [sys.executable, src / 'tools/qa_silent_update.py', qa[version+'-qa'], qa[version+'-qanext'], qa[version+'-qalater'], src / 'web', output / 'silent-update'])
        silent = json.loads((output / 'silent-update/receipt.json').read_text())
        assert silent['total'] and silent['passed'] == silent['total']
        receipt['silent_update'] = silent
        receipt['ok'] = True
        print(json.dumps({'ok': True, 'artifact': str(signed_apk), 'sha256': meta['sha256'], 'emulator_checks': silent['total']}), flush=True)
    finally:
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
