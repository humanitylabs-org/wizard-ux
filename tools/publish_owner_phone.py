#!/usr/bin/env python3
"""Audit/promote a signed APK to this installation's private owner update feed.

No Gradle/SDK or handset operations. Audit is the default; --publish is explicit.
The owner address comes ONLY from private settings at publication time. Generic
artifacts belong to the separate canonical/draft release route, never this feed.
"""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile

from apk_build_config import apk_build_config, require

APP = 'ai.wizards.os'
SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'


def owner_origin(settings):
    value = json.loads(Path(settings).read_text())['network']['base_url']
    # Match the build-time HTTPS origin contract, without normalizing a mistake.
    from urllib.parse import urlsplit
    require(isinstance(value, str), 'Missing owner origin in private settings')
    u = urlsplit(value)
    require(u.scheme == 'https' and bool(u.hostname) and not u.username and not u.password
            and u.port is None and not u.path and not u.query and not u.fragment
            and value == 'https://' + u.netloc and not any(c.isspace() for c in value),
            'Private network.base_url must be an exact HTTPS origin')
    return value


def audit(blob, receipt, settings, notes):
    fields = apk_build_config(io.BytesIO(blob))
    # A skipped-version phone may have NO wizard_server preference. Do not infer
    # migration from yesterday's APK or from an already-paired emulator.
    origin = owner_origin(settings)
    require(fields.get('ORIGIN') == origin,
            'Owner feed refused: baked ORIGIN does not equal private network.base_url; pre-preference phones would open Connect')
    require(fields.get('HOME_URL') == origin + '/wizard-os-home/', 'Owner HOME_URL disagrees with ORIGIN')
    require(fields.get('APPLICATION_ID') == APP and fields.get('DEBUG') is False
            and fields.get('BUILD_TYPE') == 'release' and fields.get('UPDATE_SIGNER') == SIGNER,
            'Not the established production phone package/configuration')
    version, code = fields.get('VERSION_NAME'), fields.get('VERSION_CODE')
    require(isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+', version)
            and type(code) is int and code > 0, 'Invalid artifact version')
    sha = hashlib.sha256(blob).hexdigest()
    require(receipt.get('status') == 'ok' and re.fullmatch(r'[0-9a-f]{40}', receipt.get('source_revision', '')),
            'Require a successful signed build receipt')
    matches = [a for a in receipt.get('artifacts', []) if a.get('sha256') == sha]
    require(len(matches) == 1, 'APK bytes do not match the build receipt')
    a = matches[0]
    require(a.get('bytes') == len(blob) and a.get('signer_sha256') == SIGNER,
            'APK size/signer does not match the trusted release receipt')
    meta = a.get('aapt2', {})
    require(meta.get('package') == APP and str(meta.get('version_code')) == str(code)
            and meta.get('version_name') == version, 'Receipt and DEX metadata disagree')
    require(isinstance(notes, str) and 0 < len(notes.strip()) <= 1000 and '\n' not in notes, 'Supply one-line release notes')
    return dict(app=APP, version=version, versionName=version, versionCode=code,
                url='wizard-os-' + version + '.apk', bytes=len(blob), sha256=sha, signer=SIGNER, notes=notes)


def atomic_write(path, blob):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(blob)
            f.flush()
            os.fsync(f.fileno())
            os.fchmod(f.fileno(), 0o644)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def promote(apk, receipt_path, settings, feed_dir, notes, publish=False):
    # Freeze bytes once: replacing the caller's file after audit cannot change
    # what gets admitted. No unvalidated value supplies a destination filename.
    blob = Path(apk).read_bytes()
    receipt = json.loads(Path(receipt_path).read_text())
    metadata = audit(blob, receipt, settings, notes)
    if not publish:
        return dict(status='audit-only', sha256=metadata['sha256'], owner_origin_matches=True)
    feed_dir = Path(feed_dir)
    require(feed_dir.is_dir(), 'Existing private feed directory required')
    with (feed_dir / '.owner-publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        # Re-read settings under the publication lease, not a baked owner value.
        metadata = audit(blob, receipt, settings, notes)
        target = feed_dir / 'latest.json'
        previous = target.read_bytes()
        current = json.loads(previous)
        require(type(current.get('versionCode')) is int and metadata['versionCode'] > current['versionCode'],
                'Refuse a non-newer owner feed release')
        artifact = feed_dir / metadata['url']
        require(not artifact.exists() or artifact.read_bytes() == blob, 'Refuse replacing different versioned APK bytes')
        atomic_write(artifact, blob)
        require(artifact.read_bytes() == blob, 'Staged APK readback failed; feed not promoted')
        atomic_write(feed_dir / ('latest.json.bak-' + str(current['versionCode'])), previous)
        # Publish feed LAST: it is the updater's immediate admission boundary.
        atomic_write(target, (json.dumps(metadata, indent=2) + '\n').encode())
        require(json.loads(target.read_text()) == metadata and artifact.read_bytes() == blob,
                'Published feed/APK readback failed')
    return dict(status='published', sha256=metadata['sha256'], owner_origin_matches=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--apk', type=Path, required=True)
    p.add_argument('--receipt', type=Path, required=True, help='Successful trusted signing-worker receipt')
    p.add_argument('--settings', type=Path, default=Path.home() / '.wizard-os/settings.json')
    p.add_argument('--feed-dir', type=Path, default=Path.home() / '.hermes/data/apps/private-reports/wizard-os')
    p.add_argument('--notes', required=True)
    p.add_argument('--publish', action='store_true', help='Explicitly promote after all release review/QA gates')
    args = p.parse_args()
    try:
        result = promote(args.apk, args.receipt, args.settings, args.feed_dir, args.notes, args.publish)
    except (ValueError, KeyError, OSError) as e:
        # Do not echo settings, credentials, addresses or arbitrary parser input.
        p.exit(1, 'Owner release refused (' + type(e).__name__ + '); inspect private inputs and owner-origin contract.\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
