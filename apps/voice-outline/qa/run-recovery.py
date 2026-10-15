"""Run bounded recovery QA against an isolated server; set core/audio/Playwright env paths."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

root = Path(__file__).resolve().parent.parent
lane = root.parent
evidence = Path(os.environ.get('EVIDENCE_DIR', lane / 'evidence'))
evidence.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
port = int(env.get('PORT', '18874'))
with socket.socket() as probe:
    probe.bind(('127.0.0.1', port))
env.update(PORT=str(port), BIND='127.0.0.1', OUTLINE_URL=f'http://127.0.0.1:{port}',
           OUTLINE_DATA=str(lane / 'data'), EVIDENCE_DIR=str(evidence))
files = ['server.mjs', 'audio.mjs', 'realtime.mjs', 'web/app.js', 'web/model.js']
(evidence / 'source-hashes.json').write_text(json.dumps({f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files if (root / f).exists()}, indent=2))
with (evidence / 'server.log').open('ab') as log:
    server = subprocess.Popen(['node', 'server.mjs'], cwd=root, env=env, stdout=log, stderr=log)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(env['OUTLINE_URL'] + '/healthz', timeout=1).close()
                break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('Isolated server did not become healthy')
        code = subprocess.run(['node', 'qa/recovery.mjs'], cwd=root, env=env, timeout=180).returncode
    finally:
        server.terminate()
        server.wait(timeout=10)
sys.exit(code)
