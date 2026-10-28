#!/usr/bin/env python3
"""Forum-only isolated acceptance over staged ux, ux-main, service, service-main trees.
No live service is used. Logs and screenshot evidence stay in this scratch work directory.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

root = Path.cwd()
results = {}

def run(name, argv, cwd, timeout=1200, env=None):
    target = root / 'evidence'
    target.mkdir(exist_ok=True)
    with (target / (name + '.log')).open('w') as out:
        try:
            p = subprocess.run(argv, cwd=cwd, env={**os.environ, **(env or {})}, stdout=out, stderr=subprocess.STDOUT, timeout=timeout)
            code = p.returncode
        except subprocess.TimeoutExpired:
            code = 124
    text = (target / (name + '.log')).read_text()
    totals = re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)\s*$', text, re.M)
    results[name] = {'exit_code':code, 'totals':dict(totals), 'log':'evidence/' + name + '.log'}
    print(name, json.dumps(results[name]), flush=True)
    (target / 'results.json').write_text(json.dumps(results, indent=2))
    return code

for tree in ['ux-main','ux']:
    run(tree + '-npm-test', ['npm','test'], root / tree)
run('service-install', ['npm','ci','--ignore-scripts','--no-audit','--no-fund'], root / 'service-main')
node_modules = root / 'service' / 'node_modules'
if not node_modules.exists():
    node_modules.symlink_to(root / 'service-main' / 'node_modules', target_is_directory=True)
for tree in ['service-main','service']:
    run(tree + '-npm-test', ['npm','test'], root / tree, timeout=1800)
for tree, files in [('ux',['web/core/privileges.js','web/core/chat-kit.js','web/core/chat-work.js','web/core/links.js','web/core/resources.js','web/store/store.js','web/setup/recommended.js','tools/privilege-status.mjs','tools/store-data-origin.mjs','tools/qa-privileges.cjs']),('service',['server/service.mjs','server/owner-approval-projection.mjs'])]:
    for f in files:
        run(tree + '-syntax-' + Path(f).stem, ['node','--check',f], root / tree, timeout=30)
run('ux-browser', ['node','tools/qa-privileges.cjs'], root / 'ux', timeout=240,
    env={'QA_OUTPUT':str(root / 'ux' / 'qa' / 'privsep')})
print(json.dumps(results, indent=2), flush=True)
sys.exit(1 if any(r['exit_code'] for r in results.values()) else 0)
