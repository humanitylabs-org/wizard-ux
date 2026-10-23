"""Opt-in device-port proof and owner-switch checks for qa_android_apps.py.

No production relay is replaced. Device mode sends directly from the actual shell
main frame, polls the new status operation (v1 has no push subscription), and
records every correlated request/reply. Only synthetic localhost owners are used.
"""
import contextlib
import fcntl
import http.server
import json
import os
import pathlib
import re
import threading
import time
import traceback
import uuid


@contextlib.contextmanager
def worker_lock(path):
    """Honor the durable worker's inherited lease, without re-lock deadlock."""
    inherited = os.environ.get('WIZARD_HEAVY_LOCK_FD')
    if inherited:
        fd = int(inherited)
        expected, actual = pathlib.Path(path).stat(), os.fstat(fd)
        if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
            raise RuntimeError('inherited Android worker lock identity mismatch')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    else:
        with pathlib.Path(path).open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield


class Port:
    def __init__(self, page, receipt, mode='device'):
        self.page, self.receipt, self.mode = page, receipt, mode
        self.name = 'wizardDevicePort' if mode == 'device' else 'wizardAppsPort'

    def rpc(self, method, params=None):
        rid = 'qa-' + uuid.uuid4().hex
        wire = ('device.packages.' + method) if self.mode == 'device' and method != 'device.capabilities' else method
        request = dict(id=rid, method=wire, params=params or {})
        if self.mode == 'device': request['v'] = 1
        # Install onmessage before postMessage, not after. Ignore pushes/unrelated ids.
        reply = self.page.ev("""new Promise(resolve => {
          const p = window[%s]; if (!p) return resolve({missingPort:true});
          const request = %s;
          const timer = setTimeout(() => resolve({timeout:true}), 12000);
          p.onmessage = ev => { let m; try { m=JSON.parse(ev.data); } catch (_) { return; }
            if (m.id !== request.id) return;
            clearTimeout(timer); resolve(m);
          };
          p.postMessage(JSON.stringify(request));
        })""" % (json.dumps(self.name), json.dumps(request)))
        self.receipt.setdefault('rpc', []).append({'port': self.name, 'request': request, 'reply': reply})
        if not isinstance(reply, dict) or reply.get('id') != rid:
            raise AssertionError('uncorrelated/missing reply: ' + repr(reply))
        if self.mode == 'device' and reply.get('v') != 1:
            raise AssertionError('wrong response version: ' + repr(reply))
        if reply.get('ok') is not True or 'result' not in reply or 'error' in reply:
            raise AssertionError('not an ok/result response: ' + repr(reply))
        return reply['result']


def connect_origin(n, origin, page=None):
    """Drive the production changeServer/Connect UI; never write server prefs."""
    em, wait = n['em'], n['wait']
    if page:
        page.ev("(WizardOSNative.changeServer(), true)")
    else:
        em.sx('am start -n %s/ai.wizards.os.ConnectActivity' % n['PKG'])
    if not wait(lambda: 'ConnectActivity' in em.top(), 15):
        raise RuntimeError('ConnectActivity did not open: ' + em.top())
    if not em.tap_text(r'^Wizard address$'):
        raise RuntimeError('Connect has no Wizard address field: ' + em.ui())
    em.sx('input keycombination 113 29')  # Ctrl+A in the address EditText.
    em.sx('input text ' + origin)
    em.sx('input keyevent KEYCODE_BACK')  # hide keyboard, do not leave Connect
    if not em.tap_text(r'^Connect$'):
        raise RuntimeError('Connect button unavailable: ' + em.ui())
    if not wait(lambda: 'MainActivity' in em.top(), 30):
        raise RuntimeError('Connect refused/timed out: ' + em.ui())
    time.sleep(2)
    page = n['Page'](em, n['DEVTOOLS'], 'wizard-os-home')
    # The WebView may still be on about:blank or the previous page right after MainActivity appears.
    href = lambda: str(page.ev('location.href') or '')
    if not wait(lambda: href().startswith(origin + '/') and page.ev('document.readyState') == 'complete', 30):
        raise RuntimeError('Connect did not change runtime origin to %s: %s' % (origin, href()))
    return page


def owner_switch(n, page):
    """Switch with a real unconfirmed A install, then probe B and retired A."""
    em, check, wait = n['em'], n['check'], n['wait']
    receipt, fix, sha = n['receipt'], n['FIX'], n['SHA']
    marker = 'owner-A-' + uuid.uuid4().hex
    seen_b = []
    class OwnerB(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *a): pass
        def do_GET(self):
            seen_b.append({'path': self.path, 'headers': dict(self.headers)})
            if self.path.startswith('/wizard-os-home'):
                body = b'<!doctype html><title>Wizard OS QA owner B</title><!-- core/ --><h1>Owner B isolation probe</h1>'
                ctype = 'text/html'
            else:
                body = b'{"items":[],"apps":[]}'; ctype = 'application/json'
            self.send_response(200); self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            seen_b.append({'path': self.path, 'headers': dict(self.headers), 'body': body.decode(errors='replace')})
            self.send_response(200); self.send_header('Content-Length', '2'); self.end_headers(); self.wfile.write(b'{}')
    port_b = n['FAKE'] + 1
    b = 'http://localhost:%d' % port_b
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port_b), OwnerB)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        em.sh(n['ADB'], '-s', em.S, 'reverse', 'tcp:%d' % port_b, 'tcp:%d' % port_b)
        # localStorage is origin scoped. Cookies intentionally are NOT port scoped:
        # use distinct localhost hostnames for cookie credentials, or this test
        # would mislabel ordinary browser cookie semantics as a native leak.
        page.ev('localStorage.setItem("qaOwnerCredential", %s)' % json.dumps(marker))
        rpc = Port(page, receipt, n['args'].port)
        n['ST']['serve'][sha['old']] = n['OLD']
        n['ST']['queue'] = [n['item']('old', qid='a00000000002', name=marker)]
        started = rpc.rpc('install', dict(package=fix, sha256=sha['old'], signer=n['SIG']['old'], versionCode=81))
        check('owner-switch: A package request acknowledged', started == {'started': True}, started)
        pending = wait(lambda: rpc.rpc('status').get('installs', {}).get(fix, {}).get('state') == 'confirm', 45)
        check('owner-switch: A has a real pending Android confirm', pending and em.vcode(fix) == 0, em.top())
        n['shot']('owner-A-pending')
        # Put Wizard back on top without accepting the PackageInstaller dialog.
        n['front_wizard'](); page.close()
        page = n['Page'](em, n['DEVTOOLS'], 'wizard-os-home')
        page = connect_origin(n, b, page)
        check('owner-switch: real Connect changes A to B', page.ev('location.origin') == b, page.ev('location.href'))
        n['shot']('owner-B-shell')
        bp = Port(page, receipt)
        status = bp.rpc('status')
        receipt['owner_b_status'] = status
        installs = status.get('installs', {})
        check('owner-switch: B receives no A pending install/status', fix not in installs and sha['old'] not in json.dumps(installs), installs)
        credential = page.ev('localStorage.getItem("qaOwnerCredential")')
        check('owner-switch: B receives no A synthetic storage credential', credential is None and marker not in json.dumps(seen_b), {'storage': credential, 'requests': seen_b})
        queue = page.ev('fetch("/android-apps/api/queue").then(r=>r.json())')
        check('owner-switch: B has no A server queue', queue.get('items') == [] and bool(n['ST']['queue']), queue)
        # Force top-level A in THIS WebView via CDP, rather than opening a browser
        # or merely exercising the already-tested main-frame rejection in an iframe.
        page.call('Page.navigate', url=n['ORIGIN'] + '/wizard-os-home/?retired-owner-probe=1')
        wait(lambda: page.ev('location.origin') == n['ORIGIN'], 12)
        at_a = page.ev('location.origin') == n['ORIGIN']
        check('owner-switch: retired A top-level page is actually loaded', at_a, page.ev('location.href'))
        reply = page.ev("""new Promise(resolve => {
          let replies = []; const p = window.wizardDevicePort;
          if (!p) return resolve({injected:false,replies});
          p.onmessage = e => replies.push(e.data);
          p.postMessage(JSON.stringify({v:1,id:'retired-A',method:'device.packages.status',params:{}}));
          setTimeout(() => resolve({injected:true,replies}), 2500);
        })""") if at_a else None
        check('owner-switch: retired A gets no wizardDevicePort reply', at_a and isinstance(reply, dict) and reply['replies'] == [], reply)
        receipt['retired_a_probe'] = reply
        n['shot']('owner-retired-A-no-port')
    except Exception:
        receipt['owner_switch_exception'] = traceback.format_exc()
        check('owner-switch: real Connect/isolation flow completed', False, receipt['owner_switch_exception'][-1800:])
        try: n['shot']('owner-switch-error'); (n['job'] / 'owner-ui.xml').write_text(em.ui())
        except Exception: pass
    finally:
        receipt['owner_b_requests'] = seen_b
        server.shutdown()
    return page


def run_device(n):
    """Real PackageInstaller flows, exclusively new-port requests; no web adapter."""
    em, wait, check = n['em'], n['wait'], n['check']
    receipt, fix, pkg = n['receipt'], n['FIX'], n['PKG']
    page = None
    with worker_lock(n['BASE'] / 'worker.lock'):
        try:
            em.boot()
            check('API35 emulator', em.sx('getprop ro.build.version.sdk').strip() == '35')
            result = em.sh(n['ADB'], '-s', em.S, 'install', '-r', n['QA_APK'])
            check('install the candidate QA build', 'Success' in result, result)
            em.sx('svc wifi disable'); em.sx('svc data disable')
            em.sh(n['ADB'], '-s', em.S, 'reverse', 'tcp:%d' % n['FAKE'], 'tcp:%d' % n['FAKE'])
            em.sx('pm grant %s android.permission.POST_NOTIFICATIONS' % pkg)
            # No qa_home override: exercise persisted owner selection from the start.
            page = connect_origin(n, n['ORIGIN'])
            check('Connect A loads the fake Wizard shell', page.ev('location.origin') == n['ORIGIN'])
            rpc = Port(page, receipt)
            caps = rpc.rpc('device.capabilities')
            methods = caps.get('capabilities', {}).get('device.packages', {}).get('methods', [])
            check('device.capabilities advertises install/status/uninstall', all(m in methods for m in ('device.packages.install', 'device.packages.status', 'device.packages.uninstall')), caps)
            status = rpc.rpc('status')
            check('device.packages.status reports API35 and candidate app', status.get('sdk') == 35 and status.get('app') == pkg, status)
            check('device.packages.list returns launchable packages', len(rpc.rpc('list').get('apps', [])) >= 3)
            n['ST']['serve'].update({n['SHA'][k]: n['FX'][k] for k in n['FX']})
            def params(kind):
                return dict(package=fix, sha256=n['SHA'][kind], signer=n['SIG']['old'], versionCode=81 if kind == 'old' else 82)
            def state(): return rpc.rpc('status').get('installs', {}).get(fix, {})
            needs = rpc.rpc('install', params('old'))
            check('new-port first install requests unknown-app permission', needs == {'needsPermission': True} and em.vcode(fix) == 0, needs)
            n['shot']('device-01-permission')
            em.sx('appops set %s REQUEST_INSTALL_PACKAGES allow' % pkg)
            n['front_wizard']()
            check('new-port install old acknowledged', rpc.rpc('install', params('old')) == {'started': True})
            dlg = wait(em.installer_ui, 40)
            n['shot']('device-02-install-confirm')
            tapped = wait(lambda: em.tap_text(r'^(Install|INSTALL)$'), 10) if dlg else None
            check('new-port install old: Android confirm → versionCode81', dlg and tapped and wait(lambda: em.vcode(fix) == 81, 60), em.top())
            check('old fixture Wizard installer/update owner', em.source(fix)['installer'] == pkg and em.source(fix)['updateOwner'] == pkg, em.source(fix))
            n['front_wizard']()
            check('old install terminal status', wait(lambda: state().get('state') == 'installed', 20), state())
            n['shot']('device-03-old-installed')
            check('wrong-signer request acknowledged (asynchronous validation)', rpc.rpc('install', params('wrong')) == {'started': True})
            seen, s = False, {}
            until = time.monotonic() + 45
            while time.monotonic() < until:
                seen |= em.installer_ui()
                s = state()
                if s.get('state') == 'error': break
                time.sleep(.5)
            check('new-port wrong signer refused before installer; still versionCode81', s.get('state') == 'error' and ('key' in s.get('message', '').lower()) and not seen and em.vcode(fix) == 81, s)
            n['shot']('device-04-wrong-signer-refused')
            check('new-port update request acknowledged', rpc.rpc('install', params('new')) == {'started': True})
            seen = False
            until = time.monotonic() + 90
            while time.monotonic() < until and em.vcode(fix) != 82:
                seen |= em.installer_ui(); time.sleep(.5)
            check('new-port update old→new: versionCode82 without dialog', em.vcode(fix) == 82 and not seen, em.vcode(fix))
            check('new-port update terminal status', wait(lambda: state().get('state') == 'installed', 20), state())
            n['shot']('device-05-new-installed')
            check('new-port uninstall request acknowledged', rpc.rpc('uninstall', {'package': fix}) is True)
            dlg = wait(lambda: em.installer_ui() or 'uninstall' in em.ui().lower(), 15)
            n['shot']('device-06-uninstall-confirm')
            tapped = wait(lambda: em.tap_text(r'^(OK|Uninstall|UNINSTALL)$'), 10) if dlg else None
            check('new-port uninstall: Android confirm → package removed', dlg and tapped and wait(lambda: em.vcode(fix) == 0, 45), em.vcode(fix))
            n['front_wizard']()
            check('new-port list no longer contains removed package', wait(lambda: not any(a.get('package') == fix for a in rpc.rpc('list').get('apps', [])), 20))
            n['shot']('device-07-uninstalled')
            if n['args'].owner_switch: page = owner_switch(n, page)
            check('no crashes', 'FATAL EXCEPTION' not in em.sx('logcat -d -b crash'))
        except Exception:
            receipt['exception'] = traceback.format_exc()
            check('device QA ran to the end', False, receipt['exception'][-1800:])
            try: n['shot']('zz-error'); (n['job'] / 'error-ui.xml').write_text(em.ui())
            except Exception: pass
        finally:
            receipt['wizard_apps_log'] = em.sx('logcat -d -s WizardApps:*')
            (n['job'] / 'logcat.txt').write_text(em.sx('logcat -d'))
            if page: page.close()
            em.kill(); n['srv'].shutdown()
            receipt.update(passed=sum(n['res']), total=len(n['res']), apk=str(n['QA_APK']), apk_sha256=n['sha'](n['QA_APK']),
                           mode='device', screenshots=sorted(str(p) for p in n['OUT'].glob('*.png')))
            (n['job'] / 'receipt.json').write_text(json.dumps(receipt, indent=2, default=str))
    return 0 if all(n['res']) else 1
