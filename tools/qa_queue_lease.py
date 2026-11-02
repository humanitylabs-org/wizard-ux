"""QA-only Linux queue lease transport; never opens, takes or releases a lock."""
import os
from pathlib import Path
import re
import stat
import subprocess

WORKER_LOCK = Path('/srv/work/heavy/production/worker.lock')


def validated_queue_fd(lock_path=WORKER_LOCK):
    value = os.environ.get('WIZARD_HEAVY_LOCK_FD', '')
    if not re.fullmatch(r'[1-9][0-9]*', value) or int(value) < 3:
        raise RuntimeError('valid inherited queue descriptor required')
    fd = int(value)
    actual, expected = os.fstat(fd), Path(lock_path).stat()
    if not stat.S_ISREG(actual.st_mode) or (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
        raise RuntimeError('queue descriptor identity mismatch')
    # fdinfo reports the lock on this inherited open file description, not merely
    # a same-inode lock held by some unrelated process. Read only; never flock here.
    info = Path(f'/proc/self/fdinfo/{fd}').read_text()
    if not re.search(r'^lock:\s+\d+: FLOCK\s+ADVISORY\s+WRITE\s+', info, re.M):
        raise RuntimeError('inherited descriptor has no exclusive queue lease')
    return fd


def run_with_queue_lease(argv, **kwargs):
    fd = validated_queue_fd()
    if 'pass_fds' in kwargs or 'close_fds' in kwargs:
        raise ValueError('queue descriptor transport is not caller-overridable')
    return subprocess.run(argv, pass_fds=(fd,), close_fds=True, **kwargs)
