#!/usr/bin/env python3
"""Prepared combined phone release + pinned 0.10.11 upgrade. Thales worker only; never publishes.
usage: qa_phone_release.py RELEASE_JOB OLD_APK OUTPUT REVISION
Android unit/lint evidence is supplied separately by CI on this exact revision.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from qa_paths import required_work_root, android_sdk, java_home

SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
OLD_SHA = '643a68d497166ed5c4164b65f9bc1c1d06cb65c42d156ab78df7baa65ca5d76b'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate(config, revision):
    if config['revision'] != revision:
        raise ValueError('prepared revision drift')
    if config.get('dirty'):
        raise ValueError('prepared tree is dirty')
    if config.get('expected_signer') != SIGNER:
        raise ValueError('established phone signer required')
    if Path(config.get('signing_env', '')).resolve() != Path.home() / '.hermes/secure/wizard-os/signing.env':
        raise ValueError('Wizard OS WOS_* signing configuration required')
    if config['tasks'] != [':app:assembleRelease']:
        raise ValueError('expected one release build; Android unit tests belong to CI')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release_job', type=Path)
    parser.add_argument('old_apk', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('revision')
    args = parser.parse_args()
    if sys.platform != 'darwin' or not os.environ.get('WIZARD_HEAVY_LOCK_FD'):
        raise SystemExit('Use the durable Thales worker with its inherited lease')
    root = required_work_root()
    for path in (args.release_job, args.old_apk, args.output):
        if not path.resolve().is_relative_to(root):
            raise SystemExit('Work must remain on the configured work volume')
    config = json.loads((args.release_job / 'job.json').read_text())
    validate(config, args.revision)
    if digest(args.old_apk) != OLD_SHA:
        raise SystemExit('0.10.11/75 previous APK drift')
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    args.output.mkdir(parents=True, exist_ok=False)
    receipt = {'source_revision': args.revision, 'old_sha256': OLD_SHA, 'ok': False, 'steps': []}
    env = dict(os.environ, WOS_NEW='0.10.12', JAVA_HOME=java_home(), ANDROID_HOME=str(android_sdk()), ANDROID_SDK_ROOT=str(android_sdk()))
    env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']

    def run(name, argv):
        with (args.output / (name + '.log')).open('w') as log:
            result = subprocess.run(list(map(str, argv)), env=env, stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,))
        receipt['steps'].append({'name': name, 'exit_code': result.returncode})
        if result.returncode:
            raise RuntimeError(name + ' failed; inspect private phase log')
        print('PASS ' + name, flush=True)

    try:
        run('signed-release', [sys.executable, args.release_job / 'worker.py', '--worker', args.release_job / 'job.json'])
        built = json.loads((args.release_job / 'receipt.json').read_text())
        assert built['status'] == 'ok' and built['source_revision'] == args.revision
        assert built['source_manifest_sha256'] == config['manifest_sha256']
        assert len(built['artifacts']) == 1
        artifact = built['artifacts'][0]
        metadata = artifact['aapt2']
        assert metadata['package'] == 'ai.wizards.os'
        assert metadata['version_name'] == '0.10.12' and str(metadata['version_code']) == '76'
        assert artifact['signer_sha256'] == SIGNER
        apk = args.release_job / 'source' / artifact['path']
        assert digest(apk) == artifact['sha256']
        receipt['build'] = built
        run('signed-upgrade-0.10.11-to-0.10.12', [sys.executable, args.release_job / 'source/tools/qa_upgrade.py', args.old_apk, apk])
        receipt.update(ok=True, artifact=str(apk), sha256=artifact['sha256'])
    finally:
        (args.output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
