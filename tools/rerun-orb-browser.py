#!/usr/bin/env python3
"""Rerun only failed browser QA; retain and revalidate immutable product/unit evidence."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_inherited(manifest):
    for name, item in manifest['evidence'].items():
        if digest(item['path']) != item['sha256']:
            raise RuntimeError('inherited evidence drift: ' + name)
    old = json.loads(Path(manifest['evidence']['manifest']['path']).read_text())
    receipt = json.loads(Path(manifest['evidence']['receipt']['path']).read_text())
    if receipt['revision'] != manifest['product_revision'] or old['revision'] != manifest['product_revision']:
        raise RuntimeError('product revision mismatch')
    if receipt['manifest_sha256'] != manifest['evidence']['manifest']['sha256']:
        raise RuntimeError('inherited manifest mismatch')
    expected = [('candidate-unit', 0), ('baseline-unit-negative', 1), ('published-unit-negative', 1), ('browser', 1)]
    if [(p['name'], p['exit_code']) for p in receipt['phases']] != expected:
        raise RuntimeError('unexpected original phases')
    for phase in receipt['phases']:
        if phase['log_sha256'] != manifest['evidence'][phase['name']]['sha256']:
            raise RuntimeError('original phase log mismatch')
    for name in ['baseline', 'published']:
        text = Path(manifest['evidence'][name + '-unit-negative']['path']).read_text()
        for failure in ['undefined smoothstep(.9, .2, ...)', 'webgl must reflect loss', 'context restoration must rebuild']:
            if failure not in text:
                raise RuntimeError('missing inherited negative control: ' + failure)
    original_result = json.loads(Path(manifest['evidence']['browser-result']['path']).read_text())
    if len(original_result['cases']) != 8 or original_result.get('pass') is not False or not any('native idle must stay frozen' in e for e in original_result['errors']):
        raise RuntimeError('unexpected original browser failure')
    for rel, expected_hash in manifest['harness_files'].items():
        if digest(Path(manifest['harness_root']) / rel) != expected_hash:
            raise RuntimeError('harness drift: ' + rel)
    return old, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    old, inherited = verify_inherited(manifest)
    spec = importlib.util.spec_from_file_location('old_runner', Path(old['sources']['candidate']['root']) / 'tools/run-orb-render-recovery.py')
    assert spec is not None and spec.loader is not None
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.verify(old)
    if args.preflight:
        print(json.dumps({'preflight': 'PASS', 'qa_revision': manifest['qa_revision'], 'product_revision': manifest['product_revision'], 'manifest_sha256': digest(args.manifest)}))
        return
    root = args.manifest.parent
    out = root / 'evidence'; out.mkdir(exist_ok=False)
    tmp = root / 'tmp'; tmp.mkdir(exist_ok=False)
    receipt = {'qa_revision': manifest['qa_revision'], 'product_revision': manifest['product_revision'],
               'manifest_sha256': digest(args.manifest), 'inherited_phases': inherited['phases'][:3],
               'original_failed_browser_retained': manifest['evidence']['browser-result'], 'pass': False}
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', TMPDIR=str(tmp),
               QA_PLAYWRIGHT=old['playwright_module'], QA_CHROME=old['dependencies']['chrome']['path'],
               PLAYWRIGHT_BROWSERS_PATH=old['browsers_path'], QA_ORB_PUBLISHED=old['sources']['published']['root'],
               QA_ORB_BASELINE=str(Path(old['sources']['baseline']['root']) / 'android/app/src/main/assets/assist'),
               QA_ORB_CANDIDATE=str(Path(old['sources']['candidate']['root']) / 'android/app/src/main/assets/assist'),
               QA_OUT=str(out / 'browser'))
    try:
        log = out / 'browser.log'
        with log.open('w') as stream:
            result = subprocess.run([old['dependencies']['node']['path'], str(Path(manifest['harness_root']) / 'tools/qa-orb-render-recovery.cjs')],
                                    cwd=manifest['harness_root'], env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=240)
        receipt['browser_exit'] = result.returncode; receipt['browser_log_sha256'] = digest(log)
        browser = json.loads((out / 'browser/result.json').read_text())
        if result.returncode or browser.get('pass') is not True or len(browser['cases']) != 62 or len(browser['idleObservations']) != 8:
            raise RuntimeError('browser failed or incomplete')
        runner.verify(old); verify_inherited(manifest)
        receipt['pass'] = True
    except Exception as error:
        receipt['error'] = str(error)
        raise
    finally:
        try:
            runner.cleanup(tmp); receipt['owned_processes_absent'] = True
        except Exception as error:
            receipt['pass'] = False; receipt['cleanup_error'] = str(error)
            raise
        finally:
            (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            print(json.dumps(receipt))


if __name__ == '__main__':
    main()
