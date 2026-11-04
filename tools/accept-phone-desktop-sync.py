#!/usr/bin/env python3
"""Queue-only acceptance entrypoint. Staging is not execution/admission.
Run via wizard_heavy_submit host=forum, with the immutable packet as argv[1].
No production requests, deployment, merges, or physical-device operations.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

packet = Path(sys.argv[1]).resolve()
if not str(packet).startswith('/srv/work/'):
    raise SystemExit('Forum /srv/work packet required')
meta = json.loads((packet / 'pins.json').read_text())
for name, expected in meta['archives'].items():
    got = hashlib.sha256((packet / name).read_bytes()).hexdigest()
    if got != expected:
        raise SystemExit(f'Archive changed: {name}')
# Extracted source must be exactly what the staged archives recorded.
for tree, records in meta['files'].items():
    for rel, expected in records.items():
        if hashlib.sha256((packet / tree / rel).read_bytes()).hexdigest() != expected:
            raise SystemExit(f'Pinned source changed: {tree}/{rel}')

out = packet / 'evidence'
out.mkdir(exist_ok=True)
tmp = packet / 'tmp'
tmp.mkdir(exist_ok=True)
env = os.environ.copy()
env.update(TMPDIR=str(tmp), QA_OUT=str(out / 'browser'),
           QA_PLAYWRIGHT=str(packet / 'deps/node_modules/playwright'),
           QA_CHROME='/home/james/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome')
phases = []

def run(name, argv, cwd, seconds=600, extra=None):
    started = time.monotonic()
    log = out / (name + '.log')
    p = subprocess.Popen(argv, cwd=cwd, env={**env, **(extra or {})},
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         start_new_session=True, text=True)
    timed_out = False
    try:
        text, _ = p.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(p.pid, signal.SIGTERM)
        try:
            text, _ = p.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            text, _ = p.communicate()
    log.write_text(text)
    row = {'phase': name, 'argv': argv, 'cwd': str(cwd), 'returncode': p.returncode,
           'timedOut': timed_out, 'seconds': round(time.monotonic() - started, 3), 'log': str(log)}
    phases.append(row)
    print(json.dumps(row), flush=True)
    return p.returncode, text

candidate = packet / 'candidate'
baseline = packet / 'baseline'
regression = 'tests/phone-desktop-sync.test.mjs'
rc, text = run('baseline-regressions', ['node', '--test', '--test-reporter=tap', regression], candidate,
               extra={'WIZARD_SYNC_SOURCE_ROOT': str(baseline)})
failed_names = re.findall(r'^not ok \d+ - (.+)$', text, re.MULTILINE)
baseline_expected = rc != 0 and len(failed_names) == 5 and not any(s in text for s in ['ReferenceError', 'SyntaxError', 'ERR_MODULE_NOT_FOUND'])
# A red baseline is deliberate only if all five intended cases actually ran.
phases[-1]['expectedRegressionFailures'] = baseline_expected
phases[-1]['failedNames'] = failed_names
run('candidate-regressions', ['node', '--test', '--test-reporter=tap', regression], candidate)
# The complete existing suite includes all affected look, migration, inbox, view,
# list-window, agent-parity and skin/colour separation suites; no selected subset.
run('full-existing-suite', ['node', '--test', '--test-concurrency=4', *sorted(str(p.relative_to(candidate)) for p in (candidate / 'tests').glob('*.test.mjs'))], candidate, seconds=900)
run('app-parity-gate', ['python3', str(packet / 'app-parity-gate'), str(baseline), str(candidate), '--core', 'first-party', '--json'], packet)
run('two-shell-browser', ['node', 'tools/qa-phone-desktop-sync.cjs'], candidate, seconds=300)
checks_pass = baseline_expected and all(p['returncode'] == 0 and not p['timedOut'] for p in phases[1:])
result = {'pins': {k: meta[k] for k in ['baseline_sha', 'candidate_sha', 'agent_service_pin']},
          'phases': phases, 'machine_checks_pass': checks_pass,
          'visual_review_pending': True, 'physical_phone_verified': False,
          'release_eligible': False, 'note': 'Parent must inspect screenshots, independently verify claims, and compare current live/main before integration. No deploy/merge performed.'}
(out / 'acceptance.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2), flush=True)
raise SystemExit(0 if checks_pass else 1)
