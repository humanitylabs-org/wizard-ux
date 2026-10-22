#!/usr/bin/env python3
"""Thales-only bounded build + disposable Immich/emulator acceptance.
Run through wizard_heavy_submit with its inherited worker lock. Never a phone/real account.
No daemon survives this process; explicit project/context commands and finally teardown.
"""
import argparse, fcntl, hashlib, http.server, json, os, pathlib, secrets, shutil
import subprocess, sys, threading, time, urllib.request

P = pathlib.Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug-job', required=True)
    ap.add_argument('--release-job', required=True)
    ap.add_argument('--rig-root', required=True)
    ap.add_argument('--photos-server', required=True)
    args = ap.parse_args()
    assert sys.platform == 'darwin', 'Thales required'
    root = P(args.rig_root).resolve()
    assert str(root).startswith('/Volumes/') and root.name == 'immich-bktest'
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True)
    out = root / ('receipt-' + time.strftime('%Y%m%dT%H%M%S'))
    out.mkdir()
    env = os.environ.copy()
    env['PATH'] = env.get('PATH', '')
    assert args.photos_server.startswith('https://') and '\n' not in args.photos_server
    env['ORG_GRADLE_PROJECT_photosServer'] = args.photos_server
    result = {'status': 'running', 'privacy': 'generated/disposable only', 'evidence': str(out)}
    def save(): (out / 'pipeline.json').write_text(json.dumps(result, indent=2) + '\n')
    def run(argv, **kw):
        return subprocess.run([str(x) for x in argv], check=True, env=env, **kw)
    def docker(*a, **kw): return run(['docker', '--context', 'colima-photos', *a], **kw)
    # Read only the synthetic project's metadata. Never enumerate real Immich assets, volumes or accounts.
    old = docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=immich-bktest', capture_output=True, text=True).stdout.strip()
    assert not old, 'Disposable project already owned; do not disturb it'
    default_before = run(['docker', 'context', 'show'], capture_output=True, text=True).stdout.strip()
    assert default_before == 'default', 'Global Docker context was not default; no mutation attempted'
    compose = out / 'compose.json'
    db_password = secrets.token_urlsafe(24)
    config = {
        'name': 'immich-bktest',
        'services': {
            'server': {'image': 'ghcr.io/immich-app/immich-server:v3.3.3',
                'ports': ['127.0.0.1:2286:2283'], 'volumes': ['media:/data'],
                'environment': {'DB_HOSTNAME': 'database', 'DB_USERNAME': 'postgres', 'DB_PASSWORD': db_password,
                    'DB_DATABASE_NAME': 'immich', 'REDIS_HOSTNAME': 'redis'},
                'depends_on': {'database': {'condition': 'service_healthy'}, 'redis': {'condition': 'service_started'}}, 'restart': 'on-failure:5'},
            'database': {'image': 'ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23',
                'environment': {'POSTGRES_PASSWORD': db_password, 'POSTGRES_USER': 'postgres', 'POSTGRES_DB': 'immich', 'POSTGRES_INITDB_ARGS': '--data-checksums'},
                'volumes': ['database:/var/lib/postgresql/data'], 'shm_size': '128mb', 'restart': 'no'},
            'redis': {'image': 'docker.io/valkey/valkey:9@sha256:c123e3715db63d06d4ad6964884037aa0d5d4d703939b9929954112889708e1d', 'restart': 'no'}},
        'volumes': {'media': {}, 'database': {}}}
    compose.write_text(json.dumps(config))
    def dc(*a, **kw): return docker('compose', '-p', 'immich-bktest', '-f', compose, *a, **kw)
    def api(path, data=None, token=None, method=None):
        headers = {'Content-Type': 'application/json'}
        if token: headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request('http://127.0.0.1:2286/api' + path,
            None if data is None else json.dumps(data).encode(), headers, method=method)
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read(); return json.loads(raw) if raw else None
    em = None
    server = None
    started = False
    try:
        # These jobs were prepared from the exact pushed revision, before entering this lane.
        job = P(args.debug_job)
        with (out / 'debug-build.log').open('w') as log:
            run([sys.executable, job / 'worker.py', '--worker', job / 'job.json'], stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,), timeout=2400)
        debug = json.loads((job / 'receipt.json').read_text())
        assert debug['status'] == 'ok'
        result['debug_build'] = debug
        source = job / 'source'
        with (out / 'npm-test.log').open('w') as log:
            run(['npm', 'test'], cwd=source, stdout=log, stderr=subprocess.STDOUT, timeout=600)
        result['npm_test'] = 'pass'; save()
        # Never inherit production Compose env/configuration. Named volumes belong only to this project.
        started = True
        with (out / 'compose-up.log').open('w') as log: dc('up', '-d', stdout=log, stderr=subprocess.STDOUT, timeout=600)
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            try:
                version = api('/server/version')
                if all(version.get(k) == v for k, v in {'major': 3, 'minor': 3, 'patch': 3}.items()): break
            except Exception: pass
            time.sleep(2)
        else: raise RuntimeError('Disposable Immich v3.3.3 did not become ready')
        result['server_version'] = version
        email = 'backup-test@example.invalid'
        password = secrets.token_urlsafe(32)
        api('/auth/admin-sign-up', {'email': email, 'password': password, 'name': 'Generated backup test'})
        token = api('/auth/login', {'email': email, 'password': password})['accessToken']
        settings = api('/system-config', token=token)
        settings['machineLearning']['enabled'] = False
        api('/system-config', settings, token, 'PUT')
        key = api('/api-keys', {'name': 'Disposable emulator backup', 'permissions': ['asset.upload', 'asset.read', 'user.read']}, token)['secret']
        # Real candidate web assets, with all server interactions confined to this disposable fixture.
        class Shell(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw): super().__init__(*a, directory=str(source / 'web'), **kw)
            def log_message(self, *_): pass
            def do_GET(self):
                if self.path.startswith('/wizard-os-home/'):
                    self.path = '/' + self.path[len('/wizard-os-home/'):]
                    return super().do_GET()
                if self.path.startswith('/api/'):
                    body = json.dumps({'sessions': [], 'agents': [], 'items': [], 'ok': True}).encode()
                    self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body); return
                return super().do_GET()
            def do_POST(self): self.send_error(403, 'Fixture: mutations forbidden')
            do_PUT = do_DELETE = do_POST
        server = http.server.ThreadingHTTPServer(('127.0.0.1',2290),Shell)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        sys.path.insert(0,str(source/'tools'))
        from qa_aa_lib import Emu, ADB
        devices = run([ADB,'devices'],capture_output=True,text=True).stdout
        assert 'emulator-5694' not in devices, 'Chosen emulator port is owned'
        em = Emu(out,5694,'ai.wizards.os.qa')
        em.boot()
        assert em.sx('getprop sys.boot_completed').strip() == '1'
        assert em.sx('getprop ro.hardware').strip() in ('ranchu','goldfish')
        main_apk = next(a for a in debug['artifacts'] if a['aapt2']['package']=='ai.wizards.os.qa')
        test_apk = next(a for a in debug['artifacts'] if a['aapt2']['package']=='ai.wizards.os.qa.test')
        for a in (main_apk,test_apk):
            apk = source/a['path']; assert hashlib.sha256(apk.read_bytes()).hexdigest()==a['sha256']
            assert 'Success' in em.sh(ADB,'-s',em.S,'install','-r',apk)
        for port in (2286,2290): run([ADB,'-s',em.S,'reverse',f'tcp:{port}',f'tcp:{port}'],capture_output=True)
        em.sx('run-as ai.wizards.os.qa mkdir -p files')
        def private_file(name, data):
            # exec-in + run-as dd wrote empty files on API 35; stage via /data/local/tmp and verify the size.
            staged = out / ('.stage-' + name); staged.write_bytes(data)
            tmp = '/data/local/tmp/wizard-photos-' + name
            run([ADB,'-s',em.S,'push',staged,tmp],capture_output=True); staged.unlink()
            em.sx(f'chmod 644 {tmp}')
            em.sx(f'run-as {em.pkg} cp {tmp} files/{name}')
            em.sx(f'rm -f {tmp}')
            got = em.sx(f'run-as {em.pkg} stat -c %s files/{name}').strip()
            assert got == str(len(data)), f'private fixture {name}: expected {len(data)} bytes, got {got!r}'
        private_file('photos-test.json', json.dumps({'server':'http://localhost:2286','key':key}).encode())
        private_file('qa_home.txt', b'http://localhost:2290')
        for i,color in enumerate(('red','blue')):
            video = out/f'fixture-video-{i}.mp4'
            run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i',f'color=c={color}:s=96x64:d=1:r=10','-c:v','libx264','-pix_fmt','yuv420p',video],capture_output=True,timeout=40)
            private_file(video.name,video.read_bytes())
        em.sh(ADB,'-s',em.S,'logcat','-c')
        test = em.sh(ADB,'-s',em.S,'shell','am','instrument','-w','-r','-e','class','ai.wizards.os.photos.BackupE2eTest','ai.wizards.os.qa.test/androidx.test.runner.AndroidJUnitRunner',timeout=1100)
        (out/'instrumentation.txt').write_text(test)
        (out/'logcat-photos.txt').write_text(em.sh(ADB,'-s',em.S,'logcat','-d','-s','WizardPhotos:V','WM-WorkerWrapper:V','WM-Processor:V','WM-GreedyScheduler:V','WM-ConstraintTracker:V','JobScheduler:V','AndroidRuntime:E'))
        (out/'jobscheduler.txt').write_text(em.sx(f'dumpsys jobscheduler {em.pkg}'))
        (out/'connectivity.txt').write_text(em.sx('dumpsys connectivity | head -120'))
        for name in ('receipt.json','photos.png'):
            content=em.sh(ADB,'-s',em.S,'exec-out','run-as',em.pkg,'dd','status=none','if=files/photos-e2e/'+name,binary=True)
            # dd writes statistics on stderr; exec-out output contains only its stdout.
            (out/name).write_bytes(content)
        crash=em.sh(ADB,'-s',em.S,'logcat','-d','-b','crash'); (out/'crash.txt').write_text(crash)
        assert 'FATAL EXCEPTION' not in crash
        acceptance=json.loads((out/'receipt.json').read_text()); result['acceptance']=acceptance; save()
        assert acceptance.get('status')=='pass' and 'OK (1 test)' in test
        for k in ('switch_starts_signin','enable_after_signin'):
            assert str(acceptance.get(k,'')).startswith('pass'), (k, acceptance.get(k))
        # Native child-only QA is not enough: tap the shared registration in the actual candidate shell.
        from qa_aa_lib import Page, wait
        import socket
        with socket.socket() as free:
            free.bind(('127.0.0.1',0)); devtools=free.getsockname()[1]
        # `am instrument` kills the app process when the test ends; relaunch the real shell before driving its WebView.
        em.sx('svc wifi enable'); em.sx('svc data enable')
        for port in (2286,2290): run([ADB,'-s',em.S,'reverse',f'tcp:{port}',f'tcp:{port}'],capture_output=True)
        em.sx('input keyevent KEYCODE_WAKEUP'); em.sx('wm dismiss-keyguard')
        em.sx(f'am start -W -n {em.pkg}/ai.wizards.os.MainActivity')
        assert wait(lambda: '.MainActivity' in em.top(),30), 'Wizard shell did not relaunch after instrumentation'
        em.shot(out,'shell-relaunched')
        page=Page(em,devtools)
        try:
            # A fresh install shows the first-run tour/coach over the shell; a returning user has dismissed it.
            page.ev("(() => { try { localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.tour.v1','true'); localStorage.setItem('wos.voiceTipSeen','true'); } catch (e) {} location.reload(); return 1; })()")
            time.sleep(4); page.close(); page=Page(em,devtools)
            page.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo')?.click(); return 1; })()"); time.sleep(0.8)
            page.ev("window.__wosHandoff({action:'settings'})")
            visible="(() => { const e=document.querySelector('[data-settings-feature=\"photos-backup\"] button'); if(!e) return false; e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); const h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2); return b.height>0 && b.y>=0 && b.bottom<=innerHeight && !!h && e.contains(h); })()"
            assert wait(lambda: page.ev(visible),20), 'Photos backup row not visible and hittable in the Settings sheet'
            assert wait(lambda: page.ev("!!document.querySelector('[data-settings-feature=\"photos-backup\"] button')"),20)
            em.sh(ADB,'-s',em.S,'shell','input','keyevent','KEYCODE_WAKEUP')
            em.sh(ADB,'-s',em.S,'shell','wm','dismiss-keyguard')
            sel='[data-settings-feature="photos-backup"] button'
            time.sleep(1.5); em.shot(out,'settings-before-tap')
            assert page.tap(sel)
            if wait(lambda: '.photos.PhotosActivity' in em.top(),10):
                result['settings_entry']='pass: touch on candidate shared Settings row → native Photos'
            else:
                # Record what the synthetic touch hit, then drive the same row's real click handler and native port.
                result['settings_touch_target']=page.ev("(() => { const e=document.querySelector(%s); const b=e.getBoundingClientRect(); const h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2); return {hit: h ? (h.outerHTML||'').slice(0,160) : null, inside: !!(h && e.contains(h)), rect:[b.x,b.y,b.width,b.height], vw: innerWidth, vh: innerHeight}; })()" % json.dumps(sel))
                em.shot(out,'settings-after-touch')
                raise AssertionError('Visible Settings row was touched but native Photos did not open')
            em.shot(out,'photos-from-settings')
            em.sh(ADB,'-s',em.S,'shell','input','keyevent','KEYCODE_BACK')
            assert wait(lambda: '.MainActivity' in em.top(),15)
        finally:
            page.close(); em.sh(ADB,'-s',em.S,'forward','--remove',f'tcp:{devtools}')
        inventory=api('/search/metadata',{'size':100,'page':1},token)
        (out/'disposable-inventory.json').write_text(json.dumps(inventory,indent=2))
        items=inventory['assets']['items']
        # 50 unique initial + 1 auto-detected; the photo taken off Wi-Fi only counts when Wi-Fi resume was testable.
        expected=51+(1 if str(acceptance.get('wifi_resume','')).startswith('pass') else 0)
        assert len(items)==expected, f'Expected {expected} unique generated assets, got {len(items)}'
        assert len({i['originalFileName'] for i in items})==len(items), 'duplicate asset on server'
        result['server_unique_assets']=len(items)
        # Release has a separate signed job: never compare debug/test certificates against the owner signer.
        release_job=P(args.release_job)
        with (out/'release-build.log').open('w') as log:
            run([sys.executable,release_job/'worker.py','--worker',release_job/'job.json'],stdout=log,stderr=subprocess.STDOUT,pass_fds=(fd,),timeout=2400)
        release=json.loads((release_job/'receipt.json').read_text()); assert release['status']=='ok'
        result['release_build']=release
        result['status']='pass'
    except Exception as exc:
        result['status']='fail'; result['error']=str(exc)
        raise
    finally:
        if server: server.shutdown(); server.server_close()
        if em:
            try:
                (out/'final-crash.txt').write_text(em.sh(ADB,'-s',em.S,'logcat','-d','-b','crash'))
                if not (out/'receipt.json').exists():
                    (out/'receipt.json').write_bytes(em.sh(ADB,'-s',em.S,'exec-out','run-as',em.pkg,'dd','status=none','if=files/photos-e2e/receipt.json',binary=True))
            except Exception: pass
            em.kill()
            shutil.rmtree(out/'dev',ignore_errors=True); shutil.rmtree(out/'avd',ignore_errors=True)
        if started:
            with (out/'compose-down.log').open('w') as log:
                down=dc('down','--volumes','--remove-orphans',stdout=log,stderr=subprocess.STDOUT,timeout=180)
            containers=docker('ps','-aq','--filter','label=com.docker.compose.project=immich-bktest',capture_output=True,text=True).stdout.strip()
            volumes=docker('volume','ls','-q','--filter','label=com.docker.compose.project=immich-bktest',capture_output=True,text=True).stdout.strip()
            networks=docker('network','ls','-q','--filter','label=com.docker.compose.project=immich-bktest',capture_output=True,text=True).stdout.strip()
            context=run(['docker','context','show'],capture_output=True,text=True).stdout.strip()
            result['teardown']={'containers':containers,'volumes':volumes,'networks':networks,'global_context':context,'pass':not containers and not volumes and not networks and context=='default'}
            if not result['teardown']['pass']: result['status']='fail'
        else: result['teardown']={'pass':True,'note':'disposable project never started'}
        compose.unlink(missing_ok=True)
        save()
        print(json.dumps({'status':result['status'],'receipt':str(out/'pipeline.json')}),flush=True)
    return 0 if result['status']=='pass' else 1

if __name__=='__main__': sys.exit(main())
