#!/usr/bin/env python3
"""Prepared-only coordinator: pinned debug build + real external-app Android share.

No submission/publication. Execute ONLY inside forum's heavy lease. Device input is
adb native taps/keys; CDP reads the DOM and locates controls, never opens the sheet,
substitutes a bridge, creates a File or calls app send functions. Synthetic fixture
APIs only. The separate sender uses an explicit ACTION_SEND receiver (not an OS
chooser/Gmail claim). Every owned emulator is stopped in finally.
"""
import argparse
import hashlib
import http.client
import http.server
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tarfile
import threading
import time
import traceback
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

PKG = 'ai.wizards.os.qa'
SENDER = 'qa.unifiedshare.sender'
OWNER_KEYS = ('wizardOrigin', 'wizardHomeUrl', 'wizardLegacyHosts', 'wizardQaHomeUrl', 'photosServer', 'wizardDeepLinkHost')
REQUIRED_CASES = ('external-boilerplate', 'agent-and-chat', 'outside-cancel', 'native-back',
                  'existing-delivery', 'new-chat-resume', 'notification-tap')
QA_ONLY_DELTA = {'tools/qa_unified_share_android.py', 'tools/test_qa_unified_share_android.py',
                 'tools/unified-share-sender/SenderActivity.java', 'docs/unified-share-android-gate.md'}
APK_PATH = 'android/app/build/outputs/apk/debug/app-debug.apk'


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def verify_seal(root, seal, expected, runner_path=None):
    if sha(seal) != expected:
        raise RuntimeError('seal digest mismatch')
    data = json.loads(Path(seal).read_text())
    for name, digest in data['files'].items():
        p = root / name
        if p.is_symlink() or root not in p.resolve().parents or sha(p) != digest:
            raise RuntimeError('staged input drift: ' + name)
    cfg = json.loads((root / 'job.json').read_text())
    if cfg['revision'] != data['revision'] or cfg['manifest_sha256'] != data['source_manifest_sha256']:
        raise RuntimeError('source identity mismatch')
    if cfg['host'] != 'forum' or cfg['java'] != '21' or cfg['cap_sync'] or cfg['signing_env'] or cfg['expected_signer']:
        raise RuntimeError('debug-only forum job required')
    if cfg['tasks'] != [':app:testDebugUnitTest', ':app:assembleDebug']:
        raise RuntimeError('unexpected Gradle scope')
    # Read-only archive binding before the worker extracts anything. No omitted or extra files.
    members = {}
    with tarfile.open(root / 'source.tar.gz') as archive:
        for m in archive:
            if m.isfile():
                f = archive.extractfile(m)
                assert f is not None
                digest = hashlib.sha256()
                while block := f.read(1024 * 1024):
                    digest.update(block)
                members[m.name.removeprefix('./')] = digest.hexdigest()
    expected_files = {n: row['sha256'] for n, row in cfg['files'].items() if 'sha256' in row}
    if members != expected_files:
        raise RuntimeError('archive/member manifest mismatch')
    if members['tools/qa_unified_share_android.py'] != sha(runner_path or __file__):
        raise RuntimeError('wrapper differs from committed source')
    return data, cfg


def verify_source(source, files):
    for name, row in files.items():
        p = source / name
        if source not in p.absolute().parents or '..' in Path(name).parts:
            raise RuntimeError('unsafe source path: ' + name)
        if 'sha256' in row:
            if p.is_symlink() or sha(p) != row['sha256']:
                raise RuntimeError('source drift: ' + name)
        elif not p.is_symlink() or os.readlink(p) != row['link']:
            raise RuntimeError('source link drift: ' + name)


def verify_reuse_build(root, seal_path, expected):
    """Read-only, fail-closed custody check. Never invokes the product worker."""
    if sha(seal_path) != expected:
        raise RuntimeError('reuse seal digest mismatch')
    seal = json.loads(Path(seal_path).read_text())
    if seal['mode'] != 'reuse-build':
        raise RuntimeError('reuse seal mode mismatch')
    if not {'reuse-job.json', 'qa_unified_share_android.py'} <= set(seal['files']):
        raise RuntimeError('missing reuse staged input binding')
    for name, digest in seal['files'].items():
        p = root / name
        if p.is_symlink() or root not in p.resolve().parents or sha(p) != digest:
            raise RuntimeError('reuse staged input drift: ' + name)
    cfg = json.loads((root / 'reuse-job.json').read_text())
    if (cfg['revision'] != seal['revision'] or
            cfg['manifest_sha256'] != hashlib.sha256(json.dumps(cfg['files'], sort_keys=True).encode()).hexdigest()):
        raise RuntimeError('reuse source identity mismatch')
    old = Path(seal['build_root']).resolve()
    if old == root or old in root.parents or root in old.parents:
        raise RuntimeError('reuse requires a separate sibling QA directory')
    _, original = verify_seal(old, old / 'android-seal.json', seal['build_seal_sha256'],
                              runner_path=old / 'qa_unified_share_android.py')
    if original['revision'] != seal['build_revision']:
        raise RuntimeError('reuse build revision mismatch')
    # Preserve the entire original prepared source, and allow only this bounded QA repair.
    if set(cfg['files']) != set(original['files']):
        raise RuntimeError('reuse source membership changed')
    changed = {n for n in cfg['files'] if cfg['files'][n] != original['files'][n]}
    if not changed or not changed <= QA_ONLY_DELTA:
        raise RuntimeError('reuse non-QA source delta: ' + repr(sorted(changed)))
    verify_source(old / 'source', original['files'])
    verify_source(root / 'source', cfg['files'])
    actual_files = {str(p.relative_to(root / 'source')) for p in (root / 'source').rglob('*')
                    if p.is_file() or p.is_symlink()}
    if actual_files != set(cfg['files']):
        raise RuntimeError('reuse source has unmanifested or missing files')
    if sha(root / 'source/tools/qa_unified_share_android.py') != sha(__file__):
        raise RuntimeError('reuse wrapper differs from source')
    for name, digest in seal['build_files'].items():
        p = old / name
        if p.is_symlink() or old not in p.resolve().parents or sha(p) != digest:
            raise RuntimeError('reused evidence drift: ' + name)
    for name in ('receipt.json', 'android-evidence/acceptance.json', 'android-evidence/build.log'):
        if name not in seal['build_files']:
            raise RuntimeError('missing reused evidence binding: ' + name)
    build = json.loads((old / 'receipt.json').read_text())
    prior = json.loads((old / 'android-evidence/acceptance.json').read_text())
    junit, failures, hashes = collect_junit(old)
    require_build(0, build, original, junit, failures)
    if (junit != dict(tests=381, failures=0, errors=0, skipped=0) or
            prior['junit'] != junit or prior['junit_xml_sha256'] != hashes or
            not all(seal['build_files'].get(n) == h for n, h in hashes.items())):
        raise RuntimeError('reused 381-test JUnit evidence mismatch')
    if (prior['build'] != build or prior['phases']['build']['status'] != 'PASS' or
            prior['phases']['build']['log_sha256'] != sha(old / 'android-evidence/build.log') or
            prior['failure_phase'] != 'fixture-and-boot' or 'void cannot be dereferenced' not in prior['error']):
        raise RuntimeError('reused build checkpoint mismatch')
    apk = old / 'source' / APK_PATH
    artifacts = [x for x in build['artifacts'] if x['path'] == APK_PATH]
    if (len(artifacts) != 1 or artifacts[0]['aapt2']['package'] != PKG or
            sha(apk) != seal['apk_sha256'] or artifacts[0]['sha256'] != seal['apk_sha256'] or
            prior['apk_sha256'] != seal['apk_sha256']):
        raise RuntimeError('reused APK identity mismatch')
    configs = list((old / 'source/android/app/build/generated/source/buildConfig/debug').rglob('BuildConfig.java'))
    if not configs or any('ORIGIN = ""' not in p.read_text() or
                          seal['build_files'].get(str(p.relative_to(old))) != sha(p) for p in configs):
        raise RuntimeError('reused debug owner defaults mismatch')
    return seal, cfg, build, junit, hashes, apk


def wait(fn, seconds=30):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            last = fn()
            if last:
                return last
        except (OSError, ValueError, RuntimeError) as e:
            last = str(e)
        time.sleep(.4)
    raise RuntimeError('bounded wait failed: ' + str(last)[:400])


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def initial_report(cfg, seal_digest):
    return {'status': 'RUNNING', 'source_revision': cfg['revision'],
            'source_manifest_sha256': cfg['manifest_sha256'], 'runner_sha256': sha(__file__),
            'seal_sha256': seal_digest, 'actual_android': False, 'synthetic_backend_only': True,
            'publication': False, 'phases': {}, 'external_intents': [], 'deliveries': []}


def exception_detail(exc):
    return type(exc).__name__ + ': ' + (str(exc) or repr(exc))


def record_android_boot(report, sdk, users):
    if sdk.strip() != '35' or 'RUNNING_UNLOCKED' not in users:
        raise RuntimeError('Android runtime not ready: require SDK 35 and RUNNING_UNLOCKED')
    report['actual_android'] = True
    report['emulator']['sdk'] = sdk.strip()
    report['emulator']['user_unlocked'] = True


def collect_junit(root):
    counts = dict(tests=0, failures=0, errors=0, skipped=0)
    failures, hashes = [], {}
    for path in sorted((root / 'source/android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml')):
        suite = ET.parse(path).getroot()
        hashes[str(path.relative_to(root))] = sha(path)
        for key in counts:
            counts[key] += int(suite.get(key, '0'))
        for case in suite.iter('testcase'):
            for tag in ('failure', 'error'):
                for failure in case.findall(tag):
                    failures.append({'case': case.get('classname', suite.get('name', '')) + '.' + case.get('name', ''),
                                     'type': failure.get('type', tag), 'message': failure.get('message', '')[:2000],
                                     'xml': str(path.relative_to(root))})
    return counts, failures, hashes


def require_build(returncode, build, cfg, junit, failures):
    if returncode != 0 or build.get('status') != 'ok':
        detail = '; '.join(f["case"] + ': ' + f['message'] for f in failures)
        raise RuntimeError('Android build failed: worker exit=%s, status=%s, JUnit=%s; %s; see android-evidence/build.log'
                           % (returncode, build.get('status'), json.dumps(junit, sort_keys=True),
                              detail or build.get('error', 'no JUnit failure reported')))
    if build.get('source_revision') != cfg['revision'] or build.get('source_manifest_sha256') != cfg['manifest_sha256']:
        raise RuntimeError('build receipt source identity mismatch')
    if junit['tests'] <= 0 or junit['failures'] or junit['errors']:
        raise RuntimeError('JUnit did not pass: ' + json.dumps(junit, sort_keys=True))


def native_bounds(xml, text):
    tree = ET.fromstring(xml)
    for node in tree.iter('node'):
        if text in (node.get('text'), node.get('content-desc')):
            nums = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
            if len(nums) == 4 and nums[2] > nums[0] and nums[3] > nums[1]:
                return [(nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2]
    return None


def native_sender_bounds(xml):
    """Android renders Button labels all-caps; scope exact casefold to our sender."""
    for node in ET.fromstring(xml).iter('node'):
        if (node.get('package') == SENDER and node.get('class') == 'android.widget.Button' and
                node.get('text', '').casefold() == 'Share synthetic PDF'.casefold() and
                node.get('clickable') == 'true' and node.get('enabled') == 'true' and
                node.get('visible-to-user') != 'false' and node.get('displayed') != 'false'):
            xy = native_bounds(ET.tostring(node, encoding='unicode'), node.get('text'))
            if xy:
                return xy
    return None


def serial_present(devices, serial):
    return serial in {line.split()[0] for line in devices.splitlines() if line.split()}


class Proxy(http.server.BaseHTTPRequestHandler):
    """Loopback-only fixture proxy; real native HTTP receipts + deterministic interruption."""
    protocol_version = 'HTTP/1.0'
    backend = 0
    events = []
    blocked = threading.Event()
    gate = threading.Event()
    armed = False
    lock = threading.Lock()

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def do_PATCH(self):
        self.forward()

    def do_PUT(self):
        self.forward()

    def do_DELETE(self):
        self.forward()

    def forward(self):
        # No forward proxy, redirects or production origins are permitted.
        if not self.path.startswith('/') or self.path.startswith('//') or '://' in self.path:
            self.send_error(403)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        event = {'at': time.time(), 'method': self.command, 'path': self.path,
                 'offset': self.headers.get('Upload-Offset'), 'body_bytes': len(body)}
        if self.command == 'POST' and self.path == '/wizard/v1/shares':
            event['json'] = json.loads(body)
        with Proxy.lock:
            Proxy.events.append(event)
        if Proxy.armed and self.command == 'PATCH' and int(event['offset'] or 0) > 0 and not Proxy.gate.is_set():
            Proxy.blocked.set()
            # Return a real network retry response until the test reopens the app.
            event['gated'] = True
            self.send_response(503); self.send_header('Content-Length', '0'); self.end_headers()
            return
        conn = http.client.HTTPConnection('127.0.0.1', Proxy.backend, timeout=60)
        try:
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'connection')}
            conn.request(self.command, self.path, body, headers)
            answer = conn.getresponse(); payload = answer.read(); event['status'] = answer.status
            self.send_response(answer.status)
            for k, v in answer.getheaders():
                if k.lower() not in ('connection', 'transfer-encoding', 'content-length'):
                    self.send_header(k, v)
            self.send_header('Content-Length', str(len(payload))); self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                event['client_disconnected'] = True
        finally:
            conn.close()


class Rig:
    def __init__(self, root, cfg, report, save):
        self.root, self.source, self.cfg = root, root / 'source', cfg
        self.out, self.report, self.save = root / 'android-evidence', report, save
        self.sdk = Path(os.environ['ANDROID_HOME'])
        self.adb = self.sdk / 'platform-tools/adb'
        self.env = os.environ.copy()
        self.serial = ''
        self.emulator: Any = None
        self.fixture: Any = None
        self.proxy: Any = None
        self.page: Any = None
        self.devtools = free_port()
        self.backend, self.frontport = free_port(), free_port()
        self.origin = 'http://10.0.2.2:' + str(self.frontport)
        self.pkg = PKG  # qa_aa_lib.Page adapter
        self.S = ''

    def run(self, argv, timeout=120, binary=False, input=None, env=None):
        r = subprocess.run([str(x) for x in argv], env=env or self.env, cwd=self.root,
                           input=input, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout, text=not binary)
        if r.returncode:
            raise RuntimeError('command failed: ' + str(argv[:5]) + '\n' + (repr(r.stdout[-4000:]) if binary else r.stdout[-4000:]))
        return r.stdout

    def sh(self, *argv, **kwargs):
        return self.run(argv, **kwargs)

    def sx(self, command, **kwargs):
        return self.run([self.adb, '-s', self.serial, 'shell', command], **kwargs)

    def adb_cmd(self, *argv, **kwargs):
        return self.run([self.adb, '-s', self.serial, *argv], **kwargs)

    def ui(self):
        def get():
            self.sx('uiautomator dump /sdcard/unified-share-ui.xml >/dev/null 2>&1 || true', timeout=20)
            xml = self.sx('cat /sdcard/unified-share-ui.xml', timeout=10)
            return xml if xml.startswith('<?xml') else None
        return wait(get, 40)

    def tap_text(self, text):
        xy = wait(lambda: native_bounds(self.ui(), text), 30)
        self.sx('input tap %d %d' % tuple(xy))

    def screenshot(self, name):
        (self.out / (name + '.png')).write_bytes(self.adb_cmd('exec-out', 'screencap', '-p', binary=True))
        (self.out / (name + '-activity.txt')).write_text(self.sx('dumpsys activity activities'))

    def diagnostic(self, name):
        try:
            self.screenshot(name)
            (self.out / (name + '.xml')).write_text(self.ui())
            if self.page:
                (self.out / (name + '-dom.json')).write_text(json.dumps(self.page.ev("({url:location.href, text:document.body.innerText, sheets:[...document.querySelectorAll('.wz-share')].map(e=>e.outerHTML)})"), indent=2))
        except Exception as exc:
            (self.out / (name + '-capture-error.txt')).write_text(str(exc))

    def boot(self):
        for key in ('ANDROID_USER_HOME', 'ANDROID_EMULATOR_HOME', 'ANDROID_AVD_HOME'):
            self.env[key] = str(self.out / key.lower()); Path(self.env[key]).mkdir()
        name = 'unified_share'
        self.run([self.sdk / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', name, '-k',
                  'system-images;android-35;google_apis;x86_64', '-d', 'pixel_6'], input='no\n', env=self.env)
        devices = self.run([self.adb, 'devices'])
        for port in range(5580, 5680, 2):
            if 'emulator-' + str(port) in devices:
                continue
            try:
                with socket.socket() as x, socket.socket() as y:
                    x.bind(('127.0.0.1', port)); y.bind(('127.0.0.1', port + 1))
                break
            except OSError:
                continue
        else:
            raise RuntimeError('no unused emulator port')
        self.serial = self.S = 'emulator-' + str(port)
        log = (self.out / 'emulator.log').open('w')
        self.emulator = subprocess.Popen([str(self.sdk / 'emulator/emulator'), '@' + name, '-port', str(port),
            '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', 'swangle',
            '-feature', '-Vulkan,-GLDirectMem', '-accel', 'on', '-cores', '4', '-memory', '3072',
            '-camera-back', 'none', '-camera-front', 'none'], env=self.env, stdout=log,
            stderr=subprocess.STDOUT, start_new_session=True)
        self.report['emulator'] = {'serial': self.serial, 'pid': self.emulator.pid, 'started': True, 'stopped': False}
        self.save()
        def booted():
            if self.emulator.poll() is not None:
                raise RuntimeError('emulator exited before boot')
            return self.sx('getprop sys.boot_completed', timeout=10).strip() == '1'
        wait(booted, 360)
        self.sx('input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard; settings put system screen_off_timeout 1800000')
        users = wait(lambda: (u if 'RUNNING_UNLOCKED' in (u := self.sx('dumpsys user')) else None), 60)
        record_android_boot(self.report, self.sx('getprop ro.build.version.sdk'), users)
        self.save()
        for key in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):
            self.sx('settings put global ' + key + ' 0')
        self.sx('cmd uimode night yes')

    def fixture_start(self):
        log = (self.out / 'fixture.log').open('w')
        self.fixture = subprocess.Popen([self.env['WIZARD_QA_NODE'], str(self.source / 'tools/share-fixture.mjs'), str(self.backend),
            '--host=127.0.0.1', '--web=' + str(self.source / 'web'), '--data=' + str(self.out / 'fixture-data'),
            '--agents=2', '--throttle=4'], env=self.env, stdout=log, stderr=subprocess.STDOUT)
        wait(self.state, 20)
        Proxy.backend = self.backend
        self.proxy = http.server.ThreadingHTTPServer(('127.0.0.1', self.frontport), Proxy)
        self.proxy.daemon_threads = True
        threading.Thread(target=self.proxy.serve_forever, daemon=True).start()

    def state(self):
        return json.load(urllib.request.urlopen('http://127.0.0.1:%d/__fixture/state' % self.backend, timeout=5))

    def compile_sender(self):
        inputs = self.source / 'tools/unified-share-sender'
        work = self.out / 'sender'; work.mkdir()
        bt = self.sdk / 'build-tools/35.0.0'; jar = self.sdk / 'platforms/android-35/android.jar'
        classes, dex = work / 'classes', work / 'dex'; classes.mkdir(); dex.mkdir()
        self.run(['javac', '--release', '8', '-cp', jar, '-d', classes, inputs / 'SenderActivity.java', inputs / 'PdfProvider.java'])
        self.run([bt / 'd8', '--lib', jar, '--min-api', '28', '--output', dex, *sorted(classes.rglob('*.class'))])
        apk = work / 'sender.apk'
        self.run([bt / 'aapt2', 'link', '-I', jar, '--manifest', inputs / 'AndroidManifest.xml', '-o', apk])
        with zipfile.ZipFile(apk, 'a') as z:
            z.write(dex / 'classes.dex', 'classes.dex')
        aligned = work / 'aligned.apk'
        self.run([bt / 'zipalign', '-f', '4', apk, aligned])
        aligned.replace(apk)
        key = work / 'synthetic-debug.jks'
        # Disposable public QA credentials, NOT an owner/release key.
        self.run(['keytool', '-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android',
                  '-alias', 'fixture', '-keyalg', 'RSA', '-dname', 'CN=Synthetic fixture', '-validity', '2'])
        self.run([bt / 'apksigner', 'sign', '--ks', key, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', apk])
        self.run([bt / 'apksigner', 'verify', apk])
        self.report['sender_apk_sha256'] = sha(apk)
        self.adb_cmd('install', '-r', '-g', apk)

    def connect_page(self):
        if self.page:
            self.page.close()
        path = self.source / 'tools/qa_aa_lib.py'
        if str(path.parent) not in sys.path:
            sys.path.insert(0, str(path.parent))
        spec = importlib.util.spec_from_file_location('unified_qa_lib', path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.page = module.Page(self, self.devtools)
        wait(lambda: self.page.ev('!!(window.__wos?.chats && window.WizShareWizard && window.WosDevicePort)'), 40)

    def tap(self, selector):
        # CDP only locates the real DOM control. Android InputDispatcher supplies the event.
        def pos():
            return self.page.ev("(() => {const e=document.querySelector(%s);if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();for(const [u,v] of [[.5,.5],[.5,.05],[.5,.95],[.05,.05],[.95,.05]]){const x=b.x+b.width*u,y=b.y+b.height*v;if(x>0&&y>0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y)))return [x,y,innerWidth,innerHeight]}return null})()" % json.dumps(selector))
        x, y, w, h = wait(pos)
        # WebView visual viewport excludes navigation/status insets in some builds: bind to actual native bounds.
        dims = self.sx('wm size')
        width, height = map(int, re.findall(r'(\d+)x(\d+)', dims)[-1])
        # DOM viewport width gives CSS->physical density; WebView is edge-to-edge at y=0 in MainActivity.
        scale = width / w
        if not (0 < x < w and 0 < y < h and y * scale < height):
            raise RuntimeError('tap out of viewport')
        self.sx('input tap %d %d' % (round(x * scale), round(y * scale)))

    def sheet(self):
        return self.page.ev("!!document.querySelector('.wz-share')")

    def share(self, mode):
        self.sx('am start -W -n ' + SENDER + '/.SenderActivity --es fixture_case ' + mode)
        self.screenshot('sender-%d-%s' % (len(self.report['external_intents']), mode))
        xy = wait(lambda: native_sender_bounds(self.ui()), 30)
        self.sx('input tap %d %d' % tuple(xy))
        self.connect_page()
        wait(self.sheet, 40)
        wait(lambda: self.page.ev("!!document.querySelector('[data-sharesend]:not(:disabled)')"), 40)
        assert self.page.ev('window.WosDevicePort.present'), 'missing real native port'
        staged = json.loads(self.sx('run-as ' + PKG + ' sh -c "cat files/share/*/meta.json"'))
        name = 'genuine.pdf' if mode == 'genuine' else 'x.pdf'
        assert staged['subject'] == name and len(staged['items']) == 1
        expected_text = 'A genuine shared note mentioning genuine.pdf' if mode == 'genuine' else 'Emailing x.pdf'
        assert staged['text'] == expected_text and staged['items'][0]['name'] == name
        assert staged['items'][0]['sha256'] == self.sx('run-as ' + SENDER + ' sha256sum files/' + name).split()[0]
        (self.out / ('staged-%d-%s.json' % (len(self.report['external_intents']), mode))).write_text(json.dumps(staged, indent=2))
        self.report['external_intents'].append({'case': mode, 'action': 'android.intent.action.SEND',
            'sender_package': SENDER, 'receiver': 'ai.wizards.os.share.ShareActivity',
            'uri': 'content://qa.unifiedshare.sender.files/' + ('genuine.pdf' if mode == 'genuine' else 'x.pdf')})
        self.save()

    def pick_private(self):
        self.tap('.dv-agent')
        wait(lambda: self.page.ev("!!document.querySelector('[data-dvpick=private]')"))
        assert self.page.ev("document.querySelector('[data-dvpick=stopped]').disabled"), 'stopped selectable'
        self.tap('[data-dvpick=private]')
        wait(lambda: self.page.ev("document.querySelector('.dv-agent strong')?.textContent==='Private' && !document.querySelector('[data-sharesend]').disabled"))

    def set_comment(self, text):
        self.tap('.dv-text')
        self.page.call('Input.insertText', text=text)  # IME text insertion, not value/send/bridge replacement
        assert self.page.ev("document.querySelector('.dv-text').value") == text
        self.sx('input keyevent KEYCODE_BACK')  # dismiss keyboard only
        wait(self.sheet)

    def received(self, name):
        state = self.state()
        ups = [u for u in state['uploads'] if u['filename'] == name]
        if not ups:
            return None
        return next((s for s in state['shares'] if s['share_id'] == ups[-1]['share'] and s['status'] == 'delivered'), None)

    def verify_delivery(self, name, agent, note, thread=None):
        sh = wait(lambda: self.received(name), 180)
        state = self.state()
        deliveries = [d for d in state['deliveries'] if d['share_id'] == sh['share_id']]
        assert len(deliveries) == 1 and sh['agent'] == agent and sh['note'] == note
        if thread:
            assert sh['thread_id'] == thread
        else:
            assert sh['thread_id'] not in ('qa_private_thread', 'qa_existing_thread', 'qa_second_thread')
        u = next(u for u in state['uploads'] if u['share'] == sh['share_id'])
        actual = self.out / 'fixture-data/files' / u['file']
        src_hash = self.sx('run-as ' + SENDER + ' sha256sum files/' + name).split()[0]
        assert actual.is_file() and actual.stat().st_size == u['bytes'] and sha(actual) == src_hash
        self.report['deliveries'].append({'share': sh, 'file_sha256': src_hash, 'file_bytes': u['bytes'], 'delivery_count': len(deliveries)})
        self.save()
        return sh

    def close(self):
        failures = []
        if self.page:
            self.page.close()
        if self.emulator:
            try:
                self.adb_cmd('emu', 'kill', timeout=20)
            except Exception as exc:
                failures.append(str(exc))
            try:
                self.emulator.wait(30)
            except subprocess.TimeoutExpired:
                os.killpg(self.emulator.pid, signal.SIGTERM)
                try:
                    self.emulator.wait(10)
                except subprocess.TimeoutExpired:
                    os.killpg(self.emulator.pid, signal.SIGKILL); self.emulator.wait(10)
            self.report['emulator']['stopped'] = self.emulator.poll() is not None
            # Explicitly ensure this serial is absent, not merely a stopped parent launcher.
            try:
                wait(lambda: not serial_present(self.run([self.adb, 'devices'], timeout=5), self.serial), 30)
                self.report['emulator']['serial_absent'] = True
            except Exception as exc:
                self.report['emulator']['serial_absent'] = False
                failures.append('owned serial still present after bounded wait: ' + str(exc))
        if self.fixture:
            self.fixture.terminate()
            try:
                self.fixture.wait(10)
            except subprocess.TimeoutExpired:
                self.fixture.kill(); self.fixture.wait(10)
        if self.proxy:
            self.proxy.shutdown(); self.proxy.server_close()
        try:
            self.run([self.adb, 'forward', '--remove', 'tcp:' + str(self.devtools)])
        except Exception:
            pass
        self.report['cleanup_errors'] = failures
        self.save()


def main():
    sys.dont_write_bytecode = True  # Imported CDP helpers must not mutate the sealed source tree.
    p = argparse.ArgumentParser()
    p.add_argument('--seal', required=True)
    p.add_argument('--seal-sha256', required=True)
    p.add_argument('--reuse-build', action='store_true', help='Verify and reuse the sealed prior APK/JUnit; never run Gradle')
    a = p.parse_args()
    root = Path(__file__).resolve().parent
    if os.uname().nodename != 'forum' or not str(root).startswith('/srv/work/'):
        raise SystemExit('forum staged runner only')
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    if os.fstat(fd).st_ino != Path('/srv/work/heavy/production/worker.lock').stat().st_ino:
        raise SystemExit('wrong inherited heavy lease')
    reused = verify_reuse_build(root, Path(a.seal), a.seal_sha256) if a.reuse_build else None
    seal, cfg = reused[:2] if reused else verify_seal(root, Path(a.seal), a.seal_sha256)
    out = root / 'android-evidence'; out.mkdir(mode=0o700, exist_ok=False)
    report = initial_report(cfg, a.seal_sha256)

    def save():
        tmp = out / 'acceptance.json.tmp'; tmp.write_text(json.dumps(report, indent=2) + '\n'); tmp.replace(out / 'acceptance.json')

    save()
    rig = None
    def interrupted(signum, frame):
        raise SystemExit('interrupted by signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGALRM, interrupted)
    signal.alarm(3900)  # leave five minutes for finally before the 4200-second lease timeout
    phase = 'build'
    try:
        for key in OWNER_KEYS:
            os.environ['ORG_GRADLE_PROJECT_' + key] = ''
        for key in ('WIZARD_ORIGIN', 'WIZARD_DEFAULT_ORIGIN', 'WIZARD_HOME_URL', 'WIZARD_PHOTOS_SERVER', 'WIZARD_UPDATE_ORIGIN'):
            os.environ.pop(key, None)
        for key in list(os.environ):
            if key.startswith('WOS_'):
                os.environ.pop(key, None)
        os.environ.update(ANDROID_HOME='/srv/work/android-sdk', ANDROID_SDK_ROOT='/srv/work/android-sdk',
            JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64', WIZARD_WORK_ROOT=str(out), WIZARD_QA_NODE=seal['node'])
        os.environ['PATH'] = os.environ['JAVA_HOME'] + '/bin:' + os.environ['PATH']
        if reused:
            _, _, build, junit, hashes, apk = reused
            report.update(build=build, junit=junit, junit_failures=[], junit_xml_sha256=hashes,
                          apk_sha256=sha(apk), build_reused=True, product_source_revision=build['source_revision'],
                          reused_build_root=seal['build_root'])
            report['phases'][phase] = {'status': 'PASS', 'reused': True,
                                      'log_sha256': seal['build_files']['android-evidence/build.log']}
        else:
            with (out / 'build.log').open('w') as log:
                result = subprocess.run([sys.executable, str(root / 'worker.py'), '--worker', str(root / 'job.json')],
                                        stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,), timeout=1800)
            build = json.loads((root / 'receipt.json').read_text())
            report['build'] = build
            report['junit'], report['junit_failures'], report['junit_xml_sha256'] = collect_junit(root)
            save()  # Preserve the actual failed test before refusing the build.
            require_build(result.returncode, build, cfg, report['junit'], report['junit_failures'])
            verify_source(root / 'source', cfg['files'])
            apk = root / 'source' / APK_PATH
            artifact = next(x for x in build['artifacts'] if x['path'] == APK_PATH)
            assert sha(apk) == artifact['sha256']
            report['apk_sha256'] = sha(apk)
            generated = list((root / 'source/android/app/build/generated/source/buildConfig/debug').rglob('BuildConfig.java'))
            assert generated and 'ORIGIN = ""' in generated[0].read_text(), 'debug owner defaults not empty'
            report['phases'][phase] = {'status': 'PASS', 'log_sha256': sha(out / 'build.log')}
        save()
        rig = Rig(root, cfg, report, save)
        phase = 'fixture-and-boot'
        rig.fixture_start(); rig.boot(); rig.compile_sender()
        rig.adb_cmd('install', '-r', '-g', apk)
        # Configure only the debug loopback hook; never access real server settings/accounts.
        rig.sx('run-as ' + PKG + ' sh -c "mkdir -p files; printf ' + rig.origin + ' > files/qa_home.txt; printf ' + rig.origin + ' > files/qa_origin.txt"')
        rig.sx('am start -W -n ' + PKG + '/ai.wizards.os.MainActivity')
        rig.connect_page()
        # Seed only local onboarding preferences, then reload the real shell. No bridge/app mocks.
        rig.page.ev("localStorage.setItem('wos.coached','1');localStorage.setItem('wos.toured','1');true")
        for selector in ('#coachStart', '[data-tskip]'):
            if rig.page.ev('!!document.querySelector(' + json.dumps(selector) + ')'):
                rig.tap(selector)
        report['phases'][phase] = {'status': 'PASS'}; save()

        phase = 'external-boilerplate'
        rig.share('boilerplate')
        state = rig.page.ev("({comment:document.querySelector('.dv-text').value,placeholder:document.querySelector('.dv-text').placeholder,quote:document.querySelector('.dv-quote')?.textContent||'',files:document.querySelector('.dv-items').innerText,agent:document.querySelector('.dv-agent strong').textContent,chat:document.querySelector('.dv-chat strong').textContent})")
        assert state['comment'] == '' and state['placeholder'] == 'Add a comment (optional)' and state['quote'] == ''
        assert 'x.pdf' in state['files'] and state['agent'] == 'Wizard' and state['chat'] == 'New chat'
        assert rig.page.ev("!document.querySelector('.dv-items').isContentEditable && !document.querySelector('.dv-items input,.dv-items textarea,[contenteditable=true]')")
        rig.screenshot(phase); report['phases'][phase] = {'status': 'PASS', 'state': state}; save()

        phase = 'agent-and-chat'
        rig.tap('.dv-chat')
        assert rig.page.ev("document.querySelector('.dv-picker [role=option]')?.textContent.includes('+ New chat')")
        rig.sx('input keyevent KEYCODE_BACK')
        wait(lambda: rig.sheet() and not rig.page.ev("!!document.querySelector('.dv-picker-wrap')"))
        rig.tap('.dv-chat'); rig.tap('[data-dvpick=qa_existing_thread]')
        assert rig.page.ev("document.querySelector('.dv-chat strong').textContent==='Trip planning'")
        rig.pick_private()
        assert rig.page.ev("document.querySelector('.dv-chat strong').textContent==='New chat'")
        rig.tap('.dv-chat')
        private_rows = rig.page.ev("[...document.querySelectorAll('[data-dvpick]')].map(e=>({id:e.dataset.dvpick,text:e.innerText}))")
        assert private_rows[0]['id'] == '__new__' and any(x['id'] == 'qa_private_thread' for x in private_rows)
        assert not any(x['id'] in ('qa_existing_thread', 'qa_second_thread') for x in private_rows)
        assert any(e['path'].startswith('/wizard/hermes/api/sessions?') and 'agent=private' in e['path'] for e in Proxy.events)
        rig.screenshot(phase); rig.sx('input keyevent KEYCODE_BACK')
        report['phases'][phase] = {'status': 'PASS', 'private_rows': private_rows}; save()

        phase = 'outside-cancel'
        before = len(rig.state()['shares'])
        rig.tap('.dv-scrim'); wait(lambda: not rig.sheet())
        assert len(rig.state()['shares']) == before
        wait(lambda: not rig.sx('run-as ' + PKG + ' sh -c "ls files/share/*/meta.json 2>/dev/null || true"').strip())
        rig.screenshot(phase); report['phases'][phase] = {'status': 'PASS', 'no_backend_write': True}; save()

        phase = 'native-back'
        rig.share('boilerplate'); rig.sx('input keyevent KEYCODE_BACK')
        wait(lambda: not rig.sheet())
        assert PKG in rig.sx('dumpsys activity activities') and rig.sx('pidof ' + PKG).strip()
        rig.screenshot(phase)
        rig.share('boilerplate'); rig.tap('[aria-label="Cancel share"]'); wait(lambda: not rig.sheet())
        assert len(rig.state()['shares']) == before
        report['phases'][phase] = {'status': 'PASS', 'cancel_button': True}; save()

        phase = 'existing-delivery'
        rig.share('genuine'); rig.pick_private()
        assert rig.page.ev("document.querySelector('.dv-text').value==='' && document.querySelector('.dv-quote').textContent==='A genuine shared note mentioning genuine.pdf' && !document.querySelector('.dv-quote').isContentEditable")
        rig.tap('.dv-chat'); rig.tap('[data-dvpick=qa_private_thread]')
        rig.set_comment('Synthetic comment one')
        rig.screenshot('existing-before-send')
        rig.tap('[data-sharesend]'); wait(lambda: not rig.sheet(), 5)
        rig.sx('input keyevent KEYCODE_HOME')
        sh = rig.verify_delivery('genuine.pdf', 'private', 'Synthetic comment one\n\nA genuine shared note mentioning genuine.pdf', 'qa_private_thread')
        rig.screenshot('existing-delivered-background')
        rig.sx('cmd statusbar expand-notifications')
        rig.tap_text('Sent · tap to open the chat')
        rig.connect_page()
        wait(lambda: 'open thread qa_private_thread' in rig.sx('logcat -d -s WizardHandoff:V'), 30)
        report['phases'][phase] = {'status': 'PASS', 'share_id': sh['share_id']}; save()

        phase = 'new-chat-resume'
        Proxy.armed = True; Proxy.gate.clear(); Proxy.blocked.clear()
        rig.share('boilerplate'); rig.pick_private()
        assert rig.page.ev("document.querySelector('.dv-chat strong').textContent==='New chat'")
        rig.set_comment('Synthetic comment two'); rig.screenshot('new-before-send')
        rig.tap('[data-sharesend]'); wait(lambda: not rig.sheet(), 5)
        assert Proxy.blocked.wait(60), 'did not reach the second native upload chunk'
        rig.sx('am force-stop ' + PKG)
        queue = rig.sx('run-as ' + PKG + ' sh -c "cat files/share-out/*/item.json"')
        (out / 'persisted-native-queue.txt').write_text(queue)
        assert 'Synthetic comment two' in queue and 'private' in queue and 'uploads' in queue
        restart_at = time.time()
        rig.sx('am start -W -n ' + PKG + '/ai.wizards.os.MainActivity')
        rig.connect_page(); rig.sx('input keyevent KEYCODE_HOME')
        Proxy.gate.set()
        sh = rig.verify_delivery('x.pdf', 'private', 'Synthetic comment two')
        assert any(e['at'] >= restart_at and e['method'] == 'PATCH' and int(e['offset'] or 0) > 0 and not e.get('gated') for e in Proxy.events)
        assert 'topResumedActivity' not in rig.sx('dumpsys activity activities') or PKG not in '\n'.join(x for x in rig.sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in x)
        rig.screenshot('resumed-background')
        report['phases'][phase] = {'status': 'PASS', 'share_id': sh['share_id'], 'force_stop_and_reopen': True}; save()

        phase = 'notification-tap'
        rig.sx('cmd statusbar expand-notifications')
        wait(lambda: 'Sent · tap to open the chat' in rig.ui(), 40)
        xml = rig.ui(); (out / 'notification.xml').write_text(xml)
        assert 'x.pdf' not in xml and 'Synthetic comment' not in xml
        rig.screenshot('notification-before-tap')
        # Tap the most recent notification, not a constructed open-thread intent.
        rig.sx('logcat -c')
        rig.tap_text('Sent · tap to open the chat')
        rig.connect_page()
        wait(lambda: 'open thread ' + sh['thread_id'] in rig.sx('logcat -d -s WizardHandoff:V'), 40)
        wait(lambda: native_bounds(rig.ui(), 'x.pdf'), 40)
        rig.screenshot('notification-opened-thread')
        report['phases'][phase] = {'status': 'PASS', 'thread_id': sh['thread_id']}; save()
        assert all(report['phases'].get(x, {}).get('status') == 'PASS' for x in REQUIRED_CASES)
        assert len(rig.state()['deliveries']) == 2
        assert rig.state()['oldUploads'] == 0, 'native queue silently fell back to web upload'
        report['status'] = 'PASS_SYNTHETIC_ANDROID_DEBUG_ONLY'
    except BaseException as exc:
        error = exception_detail(exc)
        (out / 'failure-traceback.txt').write_text(traceback.format_exc())
        report['status'] = 'FAIL'; report['failure_phase'] = phase; report['error'] = error[-6000:]
        report['phases'][phase] = {'status': 'FAIL', 'error': error[-2000:]}
        if rig:
            rig.diagnostic('failure-' + phase)
    finally:
        if rig:
            try:
                (out / 'fixture-final.json').write_text(json.dumps(rig.state(), indent=2))
                (out / 'logcat.txt').write_text(rig.adb_cmd('logcat', '-d', '-v', 'threadtime', timeout=30))
                crash = rig.adb_cmd('logcat', '-d', '-b', 'crash', timeout=20)
                (out / 'crash.txt').write_text(crash)
                if 'FATAL EXCEPTION' in crash:
                    report['status'] = 'FAIL'; report['crash_detected'] = True
            except Exception as exc:
                report['diagnostics_error'] = str(exc)
            try:
                rig.close()
            except Exception as exc:
                report['status'] = 'FAIL'; report['cleanup_error'] = str(exc)
            (out / 'network-receipts.json').write_text(json.dumps(Proxy.events, indent=2))
        for name in REQUIRED_CASES:
            report['phases'].setdefault(name, {'status': 'NOT_COVERED'})
        if report.get('cleanup_errors'):
            report['status'] = 'FAIL'
        if reused:
            try:
                verify_reuse_build(root, Path(a.seal), a.seal_sha256)
                report['reused_inputs_unchanged_after_qa'] = True
            except Exception as exc:
                report['status'] = 'FAIL'; report['reuse_drift_error'] = exception_detail(exc)
        report['screenshots'] = {p.name: sha(p) for p in sorted(out.glob('*.png'))}
        report['evidence_hashes'] = {p.name: sha(p) for p in sorted(out.iterdir()) if p.is_file() and p.name != 'acceptance.json'}
        save()
    print(json.dumps(report), flush=True)
    return 0 if report['status'] == 'PASS_SYNTHETIC_ANDROID_DEBUG_ONLY' else 1


if __name__ == '__main__':
    sys.exit(main())
