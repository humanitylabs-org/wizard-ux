#!/usr/bin/env python3
"""Refresh the public CI distribution from a committed canonical checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

DEST = Path(__file__).resolve().parent / 'style'
NAMES = ['check_style.py', 'style-policy.json']


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', type=Path, help='canonical wizard-os git checkout')
    ap.add_argument('--check', action='store_true', help='verify recorded distribution hashes offline')
    args = ap.parse_args()
    if args.check:
        pin = json.loads((DEST / 'source.json').read_text())
        for name in NAMES:
            assert hashlib.sha256((DEST / name).read_bytes()).hexdigest() == pin['files'][name], name
        print('PASS: canonical style scanner/policy mirror matches its immutable pin')
        return
    if args.source is None:
        ap.error('refresh needs --source pointing to the canonical wizard-os checkout')
    source = args.source.resolve()
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    files = {}
    DEST.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        data = subprocess.check_output(['git', '-C', str(source), 'show', revision + ':style/' + name])
        (DEST / name).write_bytes(data)
        files[name] = hashlib.sha256(data).hexdigest()
    pin = dict(source='https://github.com/humanitylabs-org/wizard-os', revision=revision, files=files)
    (DEST / 'source.json').write_text(json.dumps(pin, indent=2) + '\n')
    print('Refreshed canonical style admission at ' + revision)


if __name__ == '__main__':
    main()
