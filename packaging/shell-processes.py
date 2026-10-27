#!/usr/bin/env python3
"""Keep the read-only install responder and nginx in one failure domain."""
import signal
import subprocess
import sys
import time

children = []
stopping = False


def stop(*_):
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    children.append(subprocess.Popen([sys.executable, '/etc/wizard-shell/app-install.py']))
    children.append(subprocess.Popen(['nginx', '-c', '/tmp/nginx.conf', '-g', 'daemon off;']))
    while not stopping and all(child.poll() is None for child in children):
        time.sleep(.2)
    code = 0 if stopping else 1
finally:
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
sys.exit(code)
