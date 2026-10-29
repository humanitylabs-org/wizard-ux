#!/usr/bin/env python3
"""Immutable, synthetic-only remote orb acceptance. --preflight never runs tests/browser."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import time


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(manifest):
    for label, spec in manifest['sources'].items():
        root = Path(spec['root']).resolve()
        actual = {str(p.relative_to(root)): {'sha256': digest(p), 'mode': stat.S_IMODE(p.stat().st_mode)}
                  for p in root.rglob('*') if p.is_file()}
        if actual != spec['files']:
            raise RuntimeError(f'source inventory drift: {label}')
    for name, spec in manifest['dependencies'].items():
        path = Path(spec['path'])
        if digest(path) != spec['sha256']:
            raise RuntimeError(f'dependency drift: {name}')
    if shutil.disk_usage(Path(manifest['sources']['candidate']['root']).parent).free < 200_000_000_000:
        raise RuntimeError('forum free-space reserve below 200 GB')


def marked_processes(tmp):
    marker = str(tmp).encode()
    found = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal() or int(proc.name) in [0, 1, os.getpid(), os.getppid()]:
            continue
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            args = (proc / 'cmdline').read_bytes()
            env = (proc / 'environ').read_bytes().split(b'\0')
            if marker in args or b'TMPDIR=' + marker in env:
                found.append(int(proc.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return found


def cleanup(tmp):
    # Playwright's browser process group is detached; reap only this exact TMPDIR marker.
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        for pid in marked_processes(tmp):
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass
        time.sleep(.2)
    if marked_processes(tmp):
        raise RuntimeError('owned browser processes survived cleanup')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    verify(manifest)
    if args.preflight:
        print(json.dumps({'preflight': 'PASS', 'revision': manifest['revision'], 'manifest_sha256': digest(args.manifest)}))
        return
    candidate = Path(manifest['sources']['candidate']['root'])
    out = args.manifest.parent / 'evidence'
    out.mkdir(exist_ok=False)
    tmp = args.manifest.parent / 'tmp'
    tmp.mkdir(exist_ok=False)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', TMPDIR=str(tmp),
               QA_PLAYWRIGHT=manifest['playwright_module'], QA_CHROME=manifest['dependencies']['chrome']['path'],
               PLAYWRIGHT_BROWSERS_PATH=manifest['browsers_path'])
    receipt = {'revision': manifest['revision'], 'manifest_sha256': digest(args.manifest), 'phases': [], 'pass': False}
    receipt_path = out / 'receipt.json'

    def save():
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')

    def run(label, argv, overrides=None, expected=0):
        log = out / (label + '.log')
        with log.open('w') as stream:
            result = subprocess.run(argv, cwd=candidate, env=env | (overrides or {}), stdout=stream, stderr=subprocess.STDOUT, timeout=240)
        receipt['phases'].append({'name': label, 'exit_code': result.returncode, 'log_sha256': digest(log)})
        save()
        if result.returncode != expected:
            raise RuntimeError(f'{label}: unexpected exit {result.returncode}, expected {expected}')
        return log.read_text()

    save()
    try:
        tests = ['tests/orb-render-recovery.test.mjs', 'tests/orb-icon-core.test.mjs', 'tests/owner-skins-guard.test.mjs']
        run('candidate-unit', ['node', '--test', '--test-reporter=tap', *tests])
        for label in ['baseline', 'published']:
            root = Path(manifest['sources'][label]['root'])
            source = root / ('orb.js' if label == 'published' else 'web/orb.js')
            log = run(label + '-unit-negative', ['node', '--test', '--test-reporter=tap', 'tests/orb-render-recovery.test.mjs'],
                      {'ORB_TEST_SOURCE': str(source)}, expected=1)
            for failure in ['undefined smoothstep(.9, .2, ...)', 'webgl must reflect loss', 'context restoration must rebuild']:
                if failure not in log:
                    raise RuntimeError(f'{label}: negative control did not reproduce {failure}')
        run('browser', ['node', 'tools/qa-orb-render-recovery.cjs'], {
            'QA_ORB_PUBLISHED': manifest['sources']['published']['root'],
            'QA_ORB_BASELINE': str(Path(manifest['sources']['baseline']['root']) / 'android/app/src/main/assets/assist'),
            'QA_ORB_CANDIDATE': str(candidate / 'android/app/src/main/assets/assist'), 'QA_OUT': str(out / 'browser')})
        browser = json.loads((out / 'browser/result.json').read_text())
        if browser.get('pass') is not True or len(browser['cases']) != 62:
            raise RuntimeError('browser incomplete')
        verify(manifest)
        receipt['pass'] = True
    except Exception as error:
        receipt['error'] = str(error)
        raise
    finally:
        try:
            cleanup(tmp)
            receipt['owned_processes_absent'] = True
        except Exception as error:
            receipt['pass'] = False
            receipt['cleanup_error'] = str(error)
            raise
        finally:
            save()
        print(json.dumps(receipt))


if __name__ == '__main__':
    main()
