#!/usr/bin/env python3
"""Thales-only QA lease. BSD flock and POSIX lockf are separate on macOS;
acquire both, BSD first to match native workers wrapping POSIX workers.
Never unlink worker.lock (inode identity is the serialization contract).
"""
import fcntl, json, os, pathlib, socket, subprocess, sys, time
from datetime import datetime, timezone
root = pathlib.Path('/Volumes/ThalesMedia/wizard-branding-20261014/hat-home')
if 'thales' not in socket.gethostname().lower() or not root.is_dir():
    raise SystemExit('Thales /Volumes/ThalesMedia placement required')
lock = pathlib.Path('/Volumes/ThalesMedia/AndroidBuilds/worker.lock')
receipt = {'host': socket.gethostname(), 'pid': os.getpid(), 'lock': str(lock), 'types': ['BSD flock', 'POSIX lockf'], 'queued_at': datetime.now(timezone.utc).isoformat()}
print(json.dumps(receipt), flush=True)
with lock.open('a') as f:
    # Never retain one lock family while waiting for the other: older workers
    # can nest them in the opposite order, which otherwise deadlocks the queue.
    until = time.monotonic() + 7200
    while True:
        bsd = False
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            bsd = True
            fcntl.lockf(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if bsd:
                fcntl.flock(f, fcntl.LOCK_UN)
            if time.monotonic() >= until:
                raise SystemExit('shared worker lease wait expired')
            time.sleep(1)
    receipt['acquired_at'] = datetime.now(timezone.utc).isoformat()
    receipt['inode'] = os.fstat(f.fileno()).st_ino
    # A separate process must fail to acquire either family while this parent owns it.
    probe = 'import fcntl,sys; f=open(sys.argv[1],"a"); ok=0\nfor fn in (fcntl.flock,fcntl.lockf):\n try: fn(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n except BlockingIOError: ok+=1\nprint(ok);sys.exit(0 if ok==2 else 1)'
    q = subprocess.run([sys.executable, '-c', probe, str(lock)], capture_output=True, text=True, check=True)
    receipt['both_lock_families_verified'] = q.stdout.strip() == '2'
    print('LOCK_ACQUIRED', json.dumps(receipt), flush=True)
    try:
        receipt['exit_code'] = subprocess.run(['/bin/zsh', str(root/'run-remote.zsh')], cwd=root).returncode
    finally:
        receipt['released_at'] = datetime.now(timezone.utc).isoformat()
        (root/'lease-receipt.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt), flush=True)
sys.exit(receipt['exit_code'])
