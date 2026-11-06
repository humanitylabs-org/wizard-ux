#!/usr/bin/env python3
"""Forum-only red/green voice destination acceptance, no real owner requests."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
baseline = root.parent / 'red'
out = root.parent / 'evidence'
out.mkdir(exist_ok=True)
env = dict(os.environ, QA_PLAYWRIGHT='/srv/work/tt-late-git/node_modules/playwright', QA_VOICE_REPLY_ONLY='1')
results = {}
for name, source, smoke in [('red-live', baseline, True), ('green-candidate', root, False)]:
    target = out / name
    target.mkdir(exist_ok=True)
    current = dict(env, QA_SOURCE=str(source), QA_OUT=str(target), QA_VOICE_REPLY_SMOKE='1' if smoke else '0')
    with (target / 'browser.log').open('w') as log:
        p = subprocess.run(['node', str(root / 'qa-voice-custody-callers.cjs')], cwd=root, env=current, stdout=log, stderr=subprocess.STDOUT, timeout=600)
    receipt = target / 'receipt.json'
    data = json.loads(receipt.read_text()) if receipt.exists() else {'results': []}
    failures = [r for r in data['results'] if not r['pass']]
    results[name] = {'exit': p.returncode, 'assertions': len(data['results']), 'failures': failures, 'receipt': str(receipt)}
    print(name, json.dumps(results[name]), flush=True)
# A harness/boot error is NOT valid regression evidence. Demand the wrong destination assertion.
red_ok = any(r['name'].endswith(': original destination retained') for r in results['red-live']['failures'])
green_ok = results['green-candidate']['exit'] == 0 and results['green-candidate']['assertions'] >= 100 and not results['green-candidate']['failures']
results['acceptance'] = {'red_regression': red_ok, 'green_matrix': green_ok}
(out / 'pair-receipt.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results['acceptance']), flush=True)
sys.exit(0 if red_ok and green_ok else 1)
