#!/usr/bin/env python3
"""Checkpointed forum-only rendered-browser gate. No Android builds or live endpoints.
Stage this committed tree and a baseline export, bind a sibling manifest, then submit via wizard_heavy_submit.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--source', required=True)
p.add_argument('--before', required=True)
p.add_argument('--evidence', required=True)
p.add_argument('--manifest', required=True)
p.add_argument('--node', default='/srv/work/node22/bin/node')
p.add_argument('--playwright', default='/srv/work/provider-signin-browser/node_modules/playwright')
a = p.parse_args()
source, before, evidence = map(lambda x: Path(x).resolve(), (a.source, a.before, a.evidence))
if not str(source).startswith('/srv/work/') or not str(before).startswith('/srv/work/') or not str(evidence).startswith('/srv/work/'):
    raise SystemExit('Refused: the browser gate must run under /srv/work on forum')
manifest = json.loads(Path(a.manifest).read_text())
for base, files in [(source, manifest['files']), (before, manifest['before_files'])]:
    for name, digest in files.items():
        path = base / name
        if path.is_symlink() or base not in path.resolve().parents or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise SystemExit('Refused: source manifest drift at ' + str(path))
evidence.mkdir(parents=True, exist_ok=True)
receipt = {'commit':manifest['commit'], 'baseline':manifest['baseline'], 'phases':{}, 'actual_android':False}

def save():
    (evidence/'acceptance.json').write_text(json.dumps(receipt,indent=2)+'\n')

def run(name, argv, env=None, expected=0, timeout=180):
    values = {**os.environ, **(env or {})}
    result = subprocess.run(argv,cwd=source,env=values,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout)
    output = result.stdout
    log = evidence/(name+'.log'); log.write_text(output)
    receipt['phases'][name]={'exit_code':result.returncode,'expected_exit_code':expected,'log':str(log),'sha256':hashlib.sha256(log.read_bytes()).hexdigest()}
    save()
    if result.returncode != expected:
        raise RuntimeError(name+' failed; see '+str(log))
    return output

try:
    out = run('unit-green',[a.node,'--test','tests/share-sheet-comment-separate.test.mjs','tests/app-share-wizard.test.mjs','tests/share-sheet.test.mjs'])
    for key, expected in [('tests',24),('pass',24),('fail',0)]:
        match = re.search(r'^# '+key+r' (\d+)$',out,re.M)
        if not match or int(match[1]) != expected: raise RuntimeError('Wrong unit-green '+key+' count')
    out = run('unit-before-red',[a.node,'--test','tests/share-sheet-comment-separate.test.mjs'],{'SHARE_TEST_TREE':str(before)},expected=1)
    if not re.search(r'^# fail 8$',out,re.M): raise RuntimeError('Baseline did not fail all eight new checks')
    run('browser-green',[a.node,'tests/share-sheet-comment-separate.browser.cjs'],{'PLAYWRIGHT_MODULE':a.playwright,'EVIDENCE_DIR':str(evidence/'browser')},timeout=180)
    browser = json.loads((evidence/'browser/receipt.json').read_text())
    if browser['passed'] != len(browser['checks']) or browser['passed'] != 26: raise RuntimeError('Wrong rendered-browser count')
    receipt['browser_checks_passed']=browser['passed']
    run('browser-before-red',[a.node,'tests/share-sheet-comment-separate.browser.cjs'],{'PLAYWRIGHT_MODULE':a.playwright,'EVIDENCE_DIR':str(evidence/'browser-before'),'SHARE_TEST_TREE':str(before)},expected=1,timeout=90)
    receipt['screenshots']=[str(x) for x in sorted((evidence/'browser').glob('share-unified-*.png'))]
    receipt['status']='PASS_SYNTHETIC_WEB_ONLY'
except Exception as exc:
    receipt['status']='FAIL'; receipt['error']=str(exc)
    save()
    raise
save()
print(json.dumps(receipt))
