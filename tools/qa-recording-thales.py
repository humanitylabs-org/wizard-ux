#!/usr/bin/env python3
"""Run the synthetic recording acceptance only on Thales, under the shared worker lock.
Usage: python3 tools/qa-recording-thales.py SNAPSHOT_DIR SOURCE_COMMIT
Snapshot contains web/, qa-recording-retention.cjs and this script from git archive.
No dependency installation, service access or production writes.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from qa_paths import work_root

ROOT = Path(str(work_root() / 'wizard-modular-shell-20261012/recording-qa'))
source = Path(sys.argv[1]).resolve()
commit = sys.argv[2]
if sys.platform != 'darwin' or not source.is_relative_to(ROOT):
    raise SystemExit('Thales externalSSD snapshot required')
if len(commit) != 40 or any(c not in '0123456789abcdef' for c in commit):
    raise SystemExit('Exact source commit required')
evidence = source / 'evidence'
evidence.mkdir(exist_ok=True)
manifest = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((source / 'web').rglob('*')) if p.is_file()}
for name in ('qa-recording-retention.cjs', 'tools/qa-recording-thales.py'):
    manifest[name] = hashlib.sha256((source / name).read_bytes()).hexdigest()
(evidence / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
lock_path = str(work_root() / 'AndroidBuilds/worker.lock')
with open(lock_path, 'a') as lock:
    print('WAIT_SHARED_LOCK', time.time(), flush=True)
    fcntl.flock(lock, fcntl.LOCK_EX)
    started = time.time()
    print('LOCK_ACQUIRED', os.uname(), started, flush=True)
    with open(evidence / 'browser.log', 'w') as log:
        run = subprocess.run(['node', str(source / 'qa-recording-retention.cjs'), str(source / 'web'), str(evidence)], stdout=log, stderr=subprocess.STDOUT)
    receipt = {'host': os.uname().nodename, 'machine': os.uname().machine,
               'source_commit': commit, 'source_directory': str(source),
               'lock': lock_path, 'started': started, 'finished': time.time(),
               'exit': run.returncode, 'node': subprocess.check_output(['node', '--version'], text=True).strip()}
    result = evidence / 'results.json'
    if result.exists():
        rows = json.loads(result.read_text())['results']
        receipt.update(passed=sum(bool(x['ok']) and not x.get('known_defect') for x in rows), failed=sum(not x['ok'] for x in rows),
                       known_defects=[x['name'] for x in rows if x.get('known_defect')])
    (evidence / 'execution.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print((evidence / 'browser.log').read_text(), flush=True)
    print(json.dumps(receipt), flush=True)
    sys.exit(run.returncode)
