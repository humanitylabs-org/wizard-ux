#!/usr/bin/env python3
"""Thales-only API35 native View scroll proxy instrumentation (not a Samsung emulator).
usage: qa_scroll_proxy.py DEBUG_APK ANDROID_TEST_APK OUTPUT
"""
import fcntl
import hashlib
import http.server
import json
import os
from pathlib import Path
import sys
import threading
import traceback
from qa_aa_lib import Emu, BASE, ADB

APK, TEST_APK, OUT = map(Path, sys.argv[1:4])
OUT.mkdir(parents=True, exist_ok=True)
PKG = 'ai.wizards.os.qa'
FIXTURE = b'''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>html,body{margin:0;overflow:hidden;background:#171020;color:#fff} .ch-msgs{position:absolute;top:50px;left:8px;right:8px;height:calc(100dvh - 140px);overflow-y:auto}p{height:96px}</style>
<div data-chats="proxy" data-draft-for="proxy-fixture"><div class="ch-msgs"></div></div>
<script>document.querySelector('.ch-msgs').innerHTML=Array.from({length:80},(_,i)=>'<p>Proxy fixture row '+i+'</p>').join('');window.qaScrollProxyFixture=true;window.__wosNativeBack=()=>{window.qaBack=(window.qaBack||0)+1;return true;};</script>'''

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_GET(self):
        data = FIXTURE if self.path.startswith('/wizard-os-home/') else b'{}'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html' if data == FIXTURE else 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if sys.platform != 'darwin': raise SystemExit('Run only on Thales/Mac mini')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
inherited = os.environ.get('WIZARD_HEAVY_LOCK_FD')
lock = os.fdopen(int(inherited), 'a', closefd=False) if inherited else (BASE/'worker.lock').open('a')
em = Emu(OUT, 5692, PKG)
checks = []
def check(name, yes, detail=''):
    checks.append({'name': name, 'pass': bool(yes), 'detail': detail})
    print(('PASS ' if yes else 'FAIL ') + name + (' — '+str(detail) if detail else ''), flush=True)

with lock:
    if inherited:
        a,b=(BASE/'worker.lock').stat(),os.fstat(lock.fileno())
        if (a.st_dev,a.st_ino)!=(b.st_dev,b.st_ino):raise RuntimeError('inherited lease identity mismatch')
    fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if inherited else 0))
    try:
        em.boot()
        check('install exact QA APK', 'Success' in em.sh(ADB,'-s',em.S,'install',APK))
        check('install exact instrumentation APK', 'Success' in em.sh(ADB,'-s',em.S,'install',TEST_APK))
        em.sh(ADB,'-s',em.S,'reverse',f'tcp:{PORT}',f'tcp:{PORT}')
        em.sx(f"run-as {PKG} sh -c 'mkdir -p files; echo http://localhost:{PORT} > files/qa_home.txt'")
        em.sx('logcat -c')
        result = em.sx(f'am instrument -w -r -e class ai.wizards.os.ScrollProxyE2eTest {PKG}.test/androidx.test.runner.AndroidJUnitRunner')
        (OUT/'instrumentation.log').write_text(result)
        log = em.sx('logcat -d -s WizardScrollProxyTest:I WizardScrollCapture:I AndroidRuntime:E')
        (OUT/'native-logcat.txt').write_text(log)
        print(result, flush=True)
        print(log, flush=True)
        check('real native View proxy instrumentation', 'OK (1 test)' in result and 'FAILURES' not in result)
        # The native test intentionally visits a foreign page as its final negative case.
        # Fresh process returns to the fixture; hardware Back still cannot leave Wizard.
        em.sx(f'am force-stop {PKG}')
        em.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity')
        import time
        time.sleep(3)
        for i in range(3):
            em.sx('input keyevent KEYCODE_BACK');time.sleep(.3)
            top=em.top()
            check(f'proxy-enabled native Back {i+1} stays in app', PKG in top, top)
        crash=em.sx('logcat -d -b crash')
        (OUT/'crash-logcat.txt').write_text(crash)
        check('no native crashes', 'FATAL EXCEPTION' not in crash)
    except Exception:
        check('runner', False, traceback.format_exc())
    finally:
        em.kill();server.shutdown()
        (OUT/'receipt.json').write_text(json.dumps({'ok':bool(checks) and all(c['pass'] for c in checks),
            'apk_sha256':hashlib.sha256(APK.read_bytes()).hexdigest(),
            'test_apk_sha256':hashlib.sha256(TEST_APK.read_bytes()).hexdigest(),
            'emulator_evidence':str(em.job),'checks':checks},indent=2)+'\n')
print(json.dumps({'passed':sum(c['pass'] for c in checks),'failed':sum(not c['pass'] for c in checks),'evidence':str(OUT)}))
sys.exit(0 if checks and all(c['pass'] for c in checks) else 1)
