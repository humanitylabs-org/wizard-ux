#!/usr/bin/env python3
"""Canonical origin-less phone releases. Prepare on the controller; execute only on Thales.

REUSE android-build-thales for snapshots, signing, SDK audits and the inherited lease.
EXTEND the existing phone release QA with artifact-derived metadata and origin custody.
No live feed writes. GitHub publication is deliberately draft-only.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess
import sys

from apk_build_config import apk_build_config, dex_build_config, uleb  # noqa: F401  shared DEX reader (also publish_owner_phone)

SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
REPO = 'humanitylabs-org/wizard-ux'
APP = 'ai.wizards.os'
OWNER_KEYS = ('wizardOrigin', 'wizardHomeUrl', 'wizardLegacyHosts', 'wizardQaHomeUrl', 'photosServer', 'wizardDeepLinkHost')
# Build-worker toolchain defaults (Homebrew on the signing Mac); override per worker with the env vars named below.
DEFAULT_ANDROID_HOME = '/opt/homebrew/share/android-commandlinetools'  # ANDROID_HOME
DEFAULT_JAVA17_HOME = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'  # WIZARD_BUILD_JAVA17_HOME
DEFAULT_WORKER_PYTHON = '/opt/homebrew/bin/python3'  # WIZARD_BUILD_PYTHON
ORIGIN_ENV = ('WIZARD_ORIGIN', 'WIZARD_DEFAULT_ORIGIN', 'ORG_GRADLE_PROJECT_wizardOrigin', 'WIZARD_PHOTOS_SERVER')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def run(argv, **kwargs):
    return subprocess.run(list(map(str, argv)), check=True, **kwargs)


def text(argv, **kwargs):
    return run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kwargs).stdout


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + '\n')


def build_host():
    host = os.environ.get('WIZARD_BUILD_HOST', '').strip()
    require(re.fullmatch(r'[A-Za-z0-9._-]+', host or ''), 'Set WIZARD_BUILD_HOST to the SSH alias of the signing worker')
    return host


def reject_origin_environment(env):
    for key in ORIGIN_ENV + tuple('ORG_GRADLE_PROJECT_' + k for k in OWNER_KEYS):
        require(not env.get(key, '').strip(), 'Refusing configured origin/server environment')
    require(not any('wizardOrigin' in env.get(k, '') for k in ('GRADLE_OPTS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS')), 'Refusing origin in JVM options')


def reject_source_properties(source):
    for p in (source / 'gradle.properties', source / 'android/gradle.properties'):
        if p.exists():
            names = '|'.join(map(re.escape, OWNER_KEYS))
            require(not re.search(r'^\s*(?:(?:' + names + r')|systemProp\.org\.gradle\.project\.wizardOrigin)\s*[:=]\s*\S+', p.read_text(), re.M), 'Refusing origin/server in source properties')


def metadata(apk, badging, certificates, fields, commit, notes, minimum):
    match = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging, re.M)
    require(match is not None, 'Missing aapt2 package metadata')
    app, code, version = match.groups()
    require(app == APP and int(code) > 0, 'Wrong application or version code')
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid release version')
    signers = re.findall(r'^Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9:]+)\s*$', certificates, re.M)
    require(len(signers) == 1 and signers[0].replace(':', '').lower() == SIGNER, 'Wrong or ambiguous APK signer')
    require(fields.get('ORIGIN') == '' and fields.get('HOME_URL') == '' and fields.get('PHOTOS_SERVER') == '', 'Artifact contains a default origin or private server')
    require(fields.get('APPLICATION_ID') == APP and fields.get('VERSION_CODE') == int(code) and fields.get('VERSION_NAME') == version and fields.get('DEBUG') is False, 'BuildConfig disagrees with release metadata')
    require(re.fullmatch(r'[0-9a-f]{40}', commit), 'Invalid source commit')
    require(re.fullmatch(r'\d+\.\d+\.\d+', minimum), 'Invalid minimum box snapshot')
    require(isinstance(notes, str) and 0 < len(notes) <= 300 and '\n' not in notes and notes.endswith('.') and not re.search(r'https?://|/home/|\.ts\.net|@', notes), 'Notes must be one plain public sentence')
    return dict(app=app, versionCode=int(code), versionName=version, sha256=digest(apk), bytes=Path(apk).stat().st_size, signer=SIGNER,
                asset_url=f'https://github.com/{REPO}/releases/download/android-v{version}/wizard-os-{version}.apk',
                notes=notes, min_box_snapshot=minimum, source_commit=commit)


def prepare(args):
    source = args.source.resolve()
    reject_origin_environment(os.environ)
    reject_source_properties(source)
    require(not text(['git', '-C', source, 'status', '--porcelain', '--untracked-files=all']).strip(), 'Release source must be clean')
    revision = text(['git', '-C', source, 'rev-parse', 'HEAD']).strip()
    require(digest(args.previous_apk) == args.previous_sha256, 'Previous APK digest mismatch')
    # The installed runner is authoritative, not an in-repository copy.
    run([args.runner, '--prepare-only', '--wait-for-lock', '--project', source, '--gradle-dir', 'android', '--java', '17',
         '--signing-env', args.signing_env, '--expected-signer', SIGNER, '--output', args.output,
         '--', ':app:assembleRelease'])
    prepared = json.loads((args.output / 'job.json').read_text())
    job = prepared['job']
    inputs = dict(revision=revision, notes=args.notes, minimum=args.min_box_snapshot, previous_sha256=args.previous_sha256)
    write_json(args.output / 'release-inputs.json', inputs)
    remote = build_host() + ':' + job + '/'
    here = Path(__file__).resolve().parent
    run(['scp', '-q', here / 'phone_release.py', here / 'apk_build_config.py', here / 'qa_phone_origin_upgrade.py', args.output / 'release-inputs.json', remote])
    run(['scp', '-q', args.previous_apk, remote + 'previous.apk'])
    argv = [os.environ.get('WIZARD_BUILD_PYTHON') or DEFAULT_WORKER_PYTHON, job + '/phone_release.py', 'worker', '--job', job]
    result = dict(cwd=job, argv=argv, source_commit=revision, status='prepared', next='Submit once through wizard_heavy_submit; never execute Gradle on the controller.')
    write_json(args.output / 'canonical-prepared.json', result)
    print(json.dumps(result, indent=2))


def isolated_command(signing_env, home, checks, argv):
    """Shell that sources the signing env, then pins the isolated Gradle home last so the env can't undo it."""
    pin = 'export GRADLE_OPTS="${GRADLE_OPTS-} "' + shlex.quote('-Dgradle.user.home=' + str(home))
    return ('set -eu; set -a; . ' + shlex.quote(str(signing_env)) + '; set +a; if ' + checks + '; then exit 65; fi; '
            + pin + '; exec ' + shlex.join(argv))


def worker(args):
    require(sys.platform == 'darwin' and os.environ.get('WIZARD_HEAVY_LOCK_FD'), 'Use the durable Thales worker lease')
    reject_origin_environment(os.environ)
    job = args.job.resolve()
    require(job.parent.name == 'jobs' and job.parent.parent.name == 'AndroidBuilds', 'Job outside the AndroidBuilds worker root')
    cfg = json.loads((job / 'job.json').read_text())
    inputs = json.loads((job / 'release-inputs.json').read_text())
    require(cfg['revision'] == inputs['revision'] and not cfg.get('dirty'), 'Prepared source identity mismatch')
    require(cfg['expected_signer'] == SIGNER and cfg['tasks'] == [':app:assembleRelease'] and cfg['java'] == '17' and cfg['gradle_dir'] == 'android' and not cfg['cap_sync'], 'Unexpected build configuration')
    require(digest(job / 'previous.apk') == inputs['previous_sha256'], 'Previous artifact mismatch')
    out = job / 'canonical'
    out.mkdir(mode=0o700, exist_ok=True)
    env = os.environ.copy()
    # -Dgradle.user.home takes precedence over the runner's shared GRADLE_USER_HOME.
    # Reuse only immutable dependency/wrapper caches, NEVER shared owner properties or init scripts.
    home = job / 'canonical-gradle-home'
    home.mkdir(mode=0o700, exist_ok=False)
    for name in ('caches', 'wrapper'):
        cached = job.parents[1] / 'gradle-cache' / name
        if cached.is_dir():
            (home / name).symlink_to(cached, target_is_directory=True)
    fd = int(env['WIZARD_HEAVY_LOCK_FD'])
    # Source signing config privately and reject origin variables there too, before Gradle.
    checks = ' || '.join('[ -n "${' + key + '-}" ]' for key in ORIGIN_ENV)
    checks += ' || ' + ' || '.join('[ -n "${ORG_GRADLE_PROJECT_' + key + '-}" ]' for key in OWNER_KEYS)
    command = isolated_command(cfg['signing_env'], home, checks, [sys.executable, str(job / 'worker.py'), '--worker', str(job / 'job.json')])
    with (out / 'build.log').open('w') as log:
        run(['/bin/bash', '-c', command], env=env, stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,))
    receipt = json.loads((job / 'receipt.json').read_text())
    require(receipt['status'] == 'ok' and receipt['source_revision'] == inputs['revision'] and receipt['source_manifest_sha256'] == cfg['manifest_sha256'], 'Build receipt mismatch')
    require(len(receipt['artifacts']) == 1, 'Expected one APK')
    artifact = receipt['artifacts'][0]
    rel = Path(artifact['path'])
    require(not rel.is_absolute() and '..' not in rel.parts, 'Unsafe artifact path')
    apk = job / 'source' / rel
    require(digest(apk) == artifact['sha256'] and apk.stat().st_size == artifact['bytes'] and artifact['signer_sha256'] == SIGNER, 'Artifact receipt mismatch')
    sdk = Path(env.get('ANDROID_HOME') or DEFAULT_ANDROID_HOME)
    tools = sdk / 'build-tools/35.0.0'
    env['JAVA_HOME'] = env.get('WIZARD_BUILD_JAVA17_HOME') or DEFAULT_JAVA17_HOME
    env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']
    badging = text([tools / 'aapt2', 'dump', 'badging', apk], env=env)
    certs = text([tools / 'apksigner', 'verify', '--verbose', '--print-certs', apk], env=env)
    fields = apk_build_config(apk)
    phone = metadata(apk, badging, certs, fields, inputs['revision'], inputs['notes'], inputs['minimum'])
    manifest = text([tools / 'aapt2', 'dump', 'xmltree', apk, '--file', 'AndroidManifest.xml'], env=env)
    require('unconfigured.invalid' in manifest, 'Generic App Link host missing')
    # Never emit the old private origin into public metadata or build logs.
    write_json(out / 'artifact-audit.json', dict(source_commit=inputs['revision'], sha256=phone['sha256'], origin_empty=True, home_url_empty=True, placeholder_app_link_host=True))
    (out / 'aapt2.txt').write_text(badging)
    (out / 'apksigner.txt').write_text(certs)
    (out / f'wizard-os-{phone["versionName"]}.apk').write_bytes(apk.read_bytes())
    run([sys.executable, job / 'qa_phone_origin_upgrade.py', job / 'previous.apk', apk, out / 'origin-qa', inputs['previous_sha256']], env=env, pass_fds=(fd,))
    write_json(out / 'phone.json', phone)
    write_json(out / 'receipt.json', dict(status='ok', host=socket.gethostname(), job=str(job), phone=phone, upgrade_receipt=str(out / 'origin-qa/receipt.json'), source_manifest_sha256=cfg['manifest_sha256']))
    print(json.dumps(dict(status='ok', source_commit=inputs['revision'], sha256=phone['sha256'], evidence=str(out))))


def collect(args):
    args.output.mkdir(parents=True, mode=0o700, exist_ok=True)
    require(re.fullmatch(r'(/[A-Za-z0-9._-]+)+/AndroidBuilds/jobs/[A-Za-z0-9-]+', args.job) and '/../' not in args.job + '/', 'Invalid remote job')
    run(['scp', '-q', build_host() + ':' + args.job + '/canonical/phone.json', build_host() + ':' + args.job + '/canonical/receipt.json', args.output])
    phone = json.loads((args.output / 'phone.json').read_text())
    receipt = json.loads((args.output / 'receipt.json').read_text())
    require(receipt['status'] == 'ok' and receipt['phone'] == phone, 'Canonical receipt mismatch')
    name = f'wizard-os-{phone["versionName"]}.apk'
    require(re.fullmatch(r'wizard-os-\d+\.\d+\.\d+\.apk', name), 'Invalid artifact filename')
    run(['scp', '-q', build_host() + ':' + args.job + '/canonical/' + name, args.output / name])
    require(digest(args.output / name) == phone['sha256'] and (args.output / name).stat().st_size == phone['bytes'], 'Copied APK mismatch')
    run(['scp', '-q', build_host() + ':' + args.job + '/canonical/origin-qa/receipt.json', args.output / 'origin-upgrade-receipt.json'])
    qa = json.loads((args.output / 'origin-upgrade-receipt.json').read_text())
    require(qa['ok'] and qa['new_sha256'] == phone['sha256'], 'Missing exact-byte origin proof')
    if args.draft:
        draft(args.output, phone)
    print(json.dumps(phone, indent=2))


def draft(output, phone):
    tag = 'android-v' + phone['versionName']
    apk = output / f'wizard-os-{phone["versionName"]}.apk'
    require(digest(apk) == phone['sha256'], 'Draft APK mismatch')
    # Fail rather than overwrite an existing release (draft or published).
    existing = subprocess.run(['gh', 'release', 'view', tag, '--repo', REPO], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    require(existing.returncode != 0, 'Release already exists; do not overwrite it')
    run(['gh', 'release', 'create', tag, '--repo', REPO, '--draft', '--target', phone['source_commit'], '--title', 'Wizard OS Android ' + phone['versionName'], '--notes', phone['notes'], apk, output / 'phone.json'])
    state = json.loads(text(['gh', 'release', 'view', tag, '--repo', REPO, '--json', 'url,isDraft,targetCommitish,assets']))
    require(state['isDraft'] and state['targetCommitish'] == phone['source_commit'], 'Release draft/target readback failed')
    require({a['name'] for a in state['assets']} == {apk.name, 'phone.json'}, 'Release assets readback failed')
    # Exact asset bytes, not only the upload response or filenames.
    verify = output / 'draft-readback'
    verify.mkdir(exist_ok=False)
    run(['gh', 'release', 'download', tag, '--repo', REPO, '--dir', verify])
    require(digest(verify / apk.name) == phone['sha256'] and json.loads((verify / 'phone.json').read_text()) == phone, 'Draft asset bytes readback failed')
    write_json(output / 'draft-release.json', state)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest='command', required=True)
    a = commands.add_parser('prepare')
    a.add_argument('--source', type=Path, required=True)
    a.add_argument('--output', type=Path, required=True)
    a.add_argument('--runner', default='android-build-thales')
    a.add_argument('--signing-env', required=True, help='Private worker path, never credentials')
    a.add_argument('--notes', required=True)
    a.add_argument('--min-box-snapshot', default='0.3.40')
    a.add_argument('--previous-apk', type=Path, required=True)
    a.add_argument('--previous-sha256', required=True)
    a.set_defaults(func=prepare)
    a = commands.add_parser('worker')
    a.add_argument('--job', type=Path, required=True)
    a.set_defaults(func=worker)
    a = commands.add_parser('collect')
    a.add_argument('--job', required=True)
    a.add_argument('--output', type=Path, required=True)
    a.add_argument('--draft', action='store_true')
    a.set_defaults(func=collect)
    args = p.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
