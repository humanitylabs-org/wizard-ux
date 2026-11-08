"""Pure-Python contract tests for tools/qa_orb_screen.py. No Android, SDK, emulator, browser or network.

Run: python3 -m unittest discover -s tools -p test_qa_orb_screen_static.py -v
The lane runs at import time, so its new pieces are lifted out by AST and executed against stubs. These tests are NOT
native acceptance evidence; that comes only from the forum emulator run.
"""
import ast
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from typing import Any

SRC = Path(__file__).with_name('qa_orb_screen.py').read_text()
TREE = ast.parse(SRC)
NAMES = ('PIC_OVERLAY_HTML', 'PIC_LINES', 'HIT_JS', '_EXPORT', 'in_page', 'wm', 'web_rect', 'settle', 'picture_overlay')


def lifted(**stubs):
    """The lane's picture-overlay definitions, executed with stubbed device calls."""
    body = []
    for node in TREE.body:
        targets = [t.id for t in getattr(node, 'targets', []) if isinstance(t, ast.Name)]
        if getattr(node, 'name', None) in NAMES or any(t in NAMES for t in targets) \
                or (isinstance(node, ast.Assert) and '_EXPORT' in ast.unparse(node)):
            body.append(node)
    ns = {'P': Path, '__file__': str(Path(__file__).with_name('qa_orb_screen.py')), 're': re, 'json': json, 'time': __import__('time'),
          'STATE': {'read_paths': [], 'geometry_reply': None}, **stubs}
    exec(compile(ast.Module(body=body, type_ignores=[]), 'qa_orb_screen.py', 'exec'), ns)
    return ns


class Stop(Exception):
    pass


class NativeLaneContract(unittest.TestCase):
    def test_forum_uses_x86_64_google_apis_and_canonical_inherited_lease_without_fallback(self):
        self.assertIn("ABI = 'x86_64' if FORUM else 'arm64-v8a'", SRC)
        self.assertIn("'system-images;android-35;google_apis;' + ABI", SRC)
        self.assertIn("P('/srv/work/heavy/production/worker.lock') if FORUM", SRC)
        self.assertIn("if FORUM and not _inherited: raise SystemExit", SRC)
        self.assertIn("(_want.st_dev, _want.st_ino) != (_have.st_dev, _have.st_ino)", SRC)
        self.assertIn("raise SystemExit('inherited canonical lease is not held')", SRC)
        self.assertNotIn("BASE / 'worker.lock').open", SRC.split('_lockfile =')[1].split('\n')[0].replace('LOCK_PATH', ''))

    def test_held_witness_reads_a_real_exclusive_flock_on_this_descriptor(self):
        if not Path('/proc/self/fdinfo').is_dir():
            self.skipTest('needs Linux /proc fdinfo (forum)')
        held = lambda fd: any(l.startswith('lock:') and 'FLOCK' in l and 'WRITE' in l
                              for l in Path(f'/proc/self/fdinfo/{fd}').read_text().splitlines())
        self.assertIn("l.startswith('lock:') and 'FLOCK' in l and 'WRITE' in l", SRC)
        with tempfile.NamedTemporaryFile() as f, open(f.name, 'a') as lock:
            self.assertFalse(held(lock.fileno()), 'an unheld descriptor must not pass')
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertTrue(held(lock.fileno()))

    def test_disk_reserve_before_boot_and_owned_cleanup_in_finally(self):
        self.assertIn('RESERVE, GUEST = 200 * 1024**3, 20 * 1024**3', SRC)
        self.assertLess(SRC.index('FREE < RESERVE + GUEST'), SRC.index("'create', 'avd'"), 'reserve is checked before the guest exists')
        self.assertLess(SRC.index("if S in sh(ADB, 'devices'): raise SystemExit"), SRC.index('em = subprocess.Popen'))
        fin = SRC[SRC.rindex('    finally:'):]
        for owned in ("'forward', '--remove', f'tcp:{DEVTOOLS}'", "'reverse', '--remove', f'tcp:{FAKE}'", "'emu', 'kill'",
                      'os.killpg(em.pid', 'srv.shutdown()', "check('owned emulator serial is gone'", "(job / 'receipt.json').write_text"):
            self.assertIn(owned, fin)
        self.assertIn('start_new_session=True', SRC)
        self.assertNotIn('killall', SRC)

    def test_receipt_records_named_check_inventory_and_honest_fixture_labels(self):
        self.assertIn("CHECKS.append({'name': n, 'passed': bool(ok)", SRC)
        fin = SRC[SRC.rindex('    finally:'):]
        for key in ("'checks': CHECKS", "'read_image_paths'", "NOT live inference", "'physical_device': False", "'apk_sha256'"):
            self.assertIn(key, fin)
        self.assertIn("'fixture': 'synthetic lines-only'", SRC)
        self.assertIn('NOT inference', SRC)

    def test_geometry_fixture_is_computed_from_the_drawn_canvas_and_line_sized(self):
        captured = {}
        xml = ('<node index="0" text="" class="android.widget.FrameLayout" package="com.android.chrome" bounds="[0,0][1080,2400]" />'
               '<node index="1" text="" class="android.webkit.WebView" package="com.android.chrome" bounds="[0,318][1080,2337]" />')
        out = {'size': 'Physical size: 1080x2400', 'density': 'Physical density: 420'}
        def open_menu():
            captured['reply'] = json.loads(json.dumps(ns['STATE']['geometry_reply']))
            raise Stop()
        ns = lifted(chrome=lambda html: captured.setdefault('html', html), shot=lambda n: None, ui=lambda: xml,
                    sx=lambda c: out[c.split()[1]], check=lambda n, ok, d='': captured.setdefault('checks', []).append((n, bool(ok))),
                    open_menu=open_menu)
        with self.assertRaises(Stop):
            ns['picture_overlay']()
        self.assertIsNone(ns['STATE']['geometry_reply'], 'the geometry fixture is withdrawn after the scene')
        r = captured['reply']
        self.assertEqual(r['lines'], ['ปิดวันจันทร์', 'CLOSED ON MONDAY'])
        self.assertIn('NOT inference', r['fixture'])
        self.assertIn("x.fillText('ปิดวันจันทร์',24,160)", captured['html'])
        self.assertNotIn('<p', captured['html'], 'picture only: no text layer')
        dpr = 420 / 160
        for (l, t, rr, b), (_, css) in zip(r['boxes'], ns['PIC_LINES']):
            self.assertTrue(0 <= l < rr <= 1 and 0 <= t < b <= 1)
            self.assertAlmostEqual(l * 1080, css[0] * dpr, delta=1)
            self.assertAlmostEqual(t * 2400, 318 + css[1] * dpr, delta=1)
            # screen.html pictureBox: at most 20 % of the screen height and 30 % of its area (css = screen / dpr)
            self.assertLess((b - t) * 2400, 0.2 * 2400)
            self.assertLess((rr - l) * (b - t), 0.3)
        thai = r['boxes'][0]
        self.assertTrue(thai[1] * 2400 <= 318 + (160 - 30) * dpr and thai[3] * 2400 >= 318 + (160 + 8) * dpr, 'the box spans the drawn Thai line')
        self.assertEqual(captured['checks'], [('native picture overlay: Chrome web content located for the fixture boxes', True)])

    def test_no_web_content_fails_closed_without_a_fixture(self):
        checks = []
        ns = lifted(chrome=lambda html: None, shot=lambda n: None, ui=lambda: '<node class="android.widget.FrameLayout" />',
                    sx=lambda c: {'size': 'Physical size: 1080x2400', 'density': 'Physical density: 420'}[c.split()[1]],
                    check=lambda n, ok, d='': checks.append(bool(ok)), open_menu=lambda: self.fail('must not open Screen mode'))
        ns['picture_overlay']()
        self.assertEqual(checks, [False])
        self.assertIsNone(ns['STATE']['geometry_reply'])

    def test_in_page_wraps_the_shared_hit_helpers_as_valid_javascript(self):
        node = shutil.which('node') or str(Path.home() / '.local/bin/node')
        if not Path(node).exists():
            self.skipTest('node not available')
        ns = lifted()
        sent = []
        ns['in_page'](type('Page', (), {'ev': lambda self, e: sent.append(e)})(), "hitTarget('tCopy')")
        self.assertNotIn('module.exports', sent[0])
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
            f.write('const v = ' + sent[0] + ';')
        try:
            r = subprocess.run([node, '--check', f.name], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
        finally:
            os.unlink(f.name)

    def test_scene_checks_keep_the_original_overlay_contract(self):
        fn = ast.get_source_segment(SRC, next(n for n in TREE.body if getattr(n, 'name', None) == 'picture_overlay'))
        for name in ('the production native bridge asked read-image with geometry=1',
                     'the Thai picture line is painted in English over its own place (in-place overlay)',
                     'no picture panel opens by itself; the translation bar is shown',
                     'the pill says Thai → English (never English → English), nothing left unplaced',
                     'Original shows the untouched picture (overlay hidden)',
                     'a real outside tap (hit-tested on the touch layer) dismisses the sheet; the overlay stays',
                     'Copy translation (hit-tested) copies the picture line’s English',
                     'Back steps off the picked line first; Screen mode and the overlay stay',
                     'then Back closes Screen mode, Chrome still in front'):
            self.assertIn(name, fn)
        self.assertNotIn('S.back()', fn)
        self.assertNotIn('picture(', fn.replace('picture_overlay', ''))


def check_names(node):
    return [ast.unparse(n.args[0]) for n in ast.walk(node) if isinstance(n, ast.Call) and getattr(n.func, 'id', None) == 'check' and n.args]


def picture_only_if():
    found = [n for n in ast.walk(TREE) if isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == 'PICTURE_ONLY']
    assert len(found) == 1
    return found[0]


class FocusedModeAndPorts(unittest.TestCase):
    def test_args_parse_safely_with_optional_web_and_flag(self):
        fn = next(n for n in TREE.body if getattr(n, 'name', None) == 'parse_args')
        ns = {'P': Path, '__file__': str(Path(__file__).with_name('qa_orb_screen.py'))}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), 'qa_orb_screen.py', 'exec'), ns)
        parse = ns['parse_args']
        with tempfile.TemporaryDirectory() as d:
            apk, web = Path(d) / 'app-debug.apk', Path(d) / 'web'
            apk.write_bytes(b'unit-test-only-not-an-apk'); web.mkdir(); (web / 'index.html').write_text('')
            pkg = 'ai.wizards.os.qa'
            self.assertEqual(parse([str(apk), pkg, str(web), '--picture-only']), (apk, pkg, web, True))
            self.assertEqual(parse([str(apk), pkg, '--picture-only', str(web)]), (apk, pkg, web, True))
            self.assertEqual(parse([str(apk), pkg, str(web)]), (apk, pkg, web, False))
            self.assertEqual(parse([str(apk), pkg])[3], False)
            for bad in ([str(apk), pkg, str(web), '--all'], [str(apk), pkg, str(web), '--picture-only', '--picture-only'],
                        [str(apk)], [str(apk), pkg, str(web), 'extra'], [str(apk), pkg, d],  # web without index.html
                        [str(Path(d) / 'missing.apk'), pkg, str(web)]):
                with self.assertRaises(SystemExit, msg=str(bad)):
                    parse(bad)

    def test_picture_only_runs_set_up_then_only_the_picture_scene(self):
        node = picture_only_if()
        self.assertEqual([ast.unparse(b) for b in node.body], ['picture_scene()'])
        full = ast.unparse(node)
        self.assertEqual(full.count('picture_scene()'), 2, 'full mode runs the same scene once, in its original place')
        # set-up stays shared and before the split; crashes, cleanup and receipt come after it in both modes
        self.assertLess(SRC.index("check('QA build installs'"), SRC.index('        if PICTURE_ONLY:'))
        self.assertLess(SRC.index("check('Everywhere on (overlay + accessibility)"), SRC.index('        if PICTURE_ONLY:'))
        self.assertGreater(SRC.index("crashed = sx('logcat -d -b crash')"), SRC.index('        if PICTURE_ONLY:'))
        self.assertIn("'mode': 'picture-only' if PICTURE_ONLY else 'full'", SRC)

    def test_full_mode_keeps_every_original_check(self):
        original = {
            "'QA build installs'", "'the orb floats over Chrome'", "'Hide orb removes the orb from the screen'",
            "'a screen that is only a picture gets read automatically (Read picture text)'",
            "'picking Japanese translates the screen into Japanese'", "'no WizardOS crashes'", "'script ran to the end'",
            "'without Accessibility, Select text opens WizardOS on the one-step setup'"}
        names = check_names(TREE)
        self.assertEqual(len(names), 64, 'all 48 original + 16 picture/lease check sites')
        self.assertTrue(original <= set(names))
        # the 48 originals = 4 shared set-up/end checks (run in both modes) + 44 case-flow checks that only the full
        # mode runs; --picture-only skips them, nothing is removed
        shared = {"'QA build installs'", "'Everywhere on (overlay + accessibility), status says hold is available'",
                  "'no WizardOS crashes'", "'script ran to the end'"}
        orelse = check_names(ast.Module(body=picture_only_if().orelse, type_ignores=[]))
        self.assertEqual(len(orelse), 44)
        self.assertTrue(shared <= set(names) and not shared & set(orelse))
        self.assertEqual(orelse.count('picture_scene') + orelse.count("'native picture overlay scene ran to the end'"), 0)

    def test_port_is_a_spare_recommended_pair_never_fixed_5696(self):
        self.assertNotIn('5696', SRC)
        self.assertIn('from qa_android_connect import choose_emulator_port', SRC)
        self.assertIn("PORT = choose_emulator_port(sh(ADB, 'devices')); S = f'emulator-{PORT}'", SRC)
        self.assertLess(SRC.index('PORT = choose_emulator_port'), SRC.index('em = subprocess.Popen'))
        self.assertGreater(SRC.index('PORT = choose_emulator_port'), SRC.index('fcntl.flock(lock'), 'chosen under the lease')
        import importlib.util, socket, sys
        sys.path.insert(0, str(Path(__file__).parent))
        spec = importlib.util.spec_from_file_location('connect_for_port', Path(__file__).with_name('qa_android_connect.py'))
        connect = importlib.util.module_from_spec(spec); spec.loader.exec_module(connect)
        with socket.socket() as busy:
            try: busy.bind(('127.0.0.1', 5583))  # the ADB half of 5582: that pair must be skipped
            except OSError: pass  # already bound elsewhere: skipped either way
            port = connect.choose_emulator_port('List of devices attached\nemulator-5584\tdevice\n')
        self.assertTrue(5554 <= port <= 5580 and port % 2 == 0, port)
        with socket.socket() as a, socket.socket() as b:  # both sockets of the chosen pair are actually free
            a.bind(('127.0.0.1', port)); b.bind(('127.0.0.1', port + 1))
        all_registered = '\n'.join('emulator-%d\tdevice' % p for p in range(5554, 5585, 2))
        with self.assertRaises(RuntimeError):
            connect.choose_emulator_port(all_registered)


def receipt_dict():
    """The receipt dict literal json.dumps'd in the lane's final finally."""
    return next(n for n in ast.walk(TREE) if isinstance(n, ast.Dict)
                and any(isinstance(k, ast.Constant) and k.value == 'completed' for k in n.keys))


class Interruption(unittest.TestCase):
    def test_sigterm_routes_through_finally_and_leaves_an_incomplete_receipt(self):
        handler = [n for n in TREE.body if getattr(n, 'name', None) == '_interrupted'
                   or (isinstance(n, ast.For) and '_interrupted' in ast.unparse(n))]
        self.assertEqual(len(handler), 2, 'the handler and its SIGTERM/SIGINT installation')
        ok_expr = ast.unparse(next(v for k, v in zip(receipt_dict().keys, receipt_dict().values) if k.value == 'ok'))
        child = '\n'.join([
            'import json, os, signal, sys',
            'COMPLETED, INTERRUPTED = False, None',
            ast.unparse(ast.Module(body=handler, type_ignores=[])),
            'res = [True, True, True]  # a few passing set-up checks before the controller gives up',
            'cleaned = []',
            'try:',
            '    os.kill(os.getpid(), signal.SIGTERM)',
            '    import time; time.sleep(5)',
            '    COMPLETED = True',
            'finally:',
            '    os.kill(os.getpid(), signal.SIGTERM)  # a second signal must not interrupt cleanup',
            '    cleaned.append("owned emulator, forwards, fixture server")',
            '    print(json.dumps({"ok": ' + ok_expr + ', "completed": COMPLETED, "interrupted": INTERRUPTED, "cleaned": cleaned}))',
        ])
        r = subprocess.run([__import__('sys').executable, '-B', '-c', child], capture_output=True, text=True, timeout=20)
        self.assertEqual(r.returncode, 128 + 15, r.stderr)
        receipt = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(receipt, {'ok': False, 'completed': False, 'interrupted': 'SIGTERM',
                                   'cleaned': ['owned emulator, forwards, fixture server']})

    def test_receipt_ok_requires_completion_and_completion_is_set_only_after_the_crash_check(self):
        keys = [k.value for k in receipt_dict().keys]
        for key in ('ok', 'completed', 'interrupted', 'mode'):
            self.assertIn(key, keys)
        ok_expr = ast.unparse(receipt_dict().values[keys.index('ok')])
        for completed, res, want in ((False, [True] * 5, False), (True, [True] * 5, True), (True, [True, False], False), (True, [], False)):
            self.assertIs(bool(eval(ok_expr, {'COMPLETED': completed, 'res': res})), want, (completed, res))
        done = SRC.index('COMPLETED = True')
        self.assertLess(SRC.index("check('no WizardOS crashes'"), done)
        self.assertLess(done, SRC.index("check('script ran to the end', False"), 'never set on the error path')
        self.assertEqual(SRC.count('COMPLETED = True'), 1)
        self.assertLess(SRC.index('signal.signal(_sig, _interrupted)'), SRC.index('with _lockfile as lock:'), 'installed before anything is owned')
        self.assertIn('if not COMPLETED or not res or not all(res): sys.exit(1)', SRC)


class Startup(unittest.TestCase):
    APPSTATE = (Path(__file__).resolve().parents[1] / 'android/app/src/main/java/ai/wizards/os/device/AppState.java').read_text()

    def lift(self, **stubs):
        names = ('QA_HOME', 'EXPECTED_HOME', 'QA_ORIGIN_RE', 'startup_diagnostics', 'shell_page')
        body = [n for n in TREE.body if getattr(n, 'name', None) in names
                or any(isinstance(t, ast.Name) and t.id in names for t in getattr(n, 'targets', []))]
        ns = {'FAKE': 18779, 'PKG': 'ai.wizards.os.qa', 'DEVTOOLS': 9347, 'STATE': {'log': ['GET /wizard-os-home/']},
              'json': json, 're': re, 'time': type('T', (), {'sleep': staticmethod(lambda s: None)}), 'urllib': __import__('urllib.request'),
              'job': Path(tempfile.mkdtemp()), 'top': lambda: 'topResumedActivity=ai.wizards.os.qa/ai.wizards.os.MainActivity',
              'ui': lambda: '<hierarchy/>', 'shot': lambda n: None, 'require_device': lambda: None,
              'device_snapshot': lambda: {'serial': 'emulator-5554', 'target_device': True}, **stubs}
        exec(compile(ast.Module(body=body, type_ignores=[]), 'qa_orb_screen.py', 'exec'), ns)
        return ns

    def test_fixture_is_the_root_origin_the_app_accepts_and_the_page_is_its_home_url(self):
        ns = self.lift(sx=lambda c, **kw: '')
        java_re = re.search(r'o\.matches\("([^"]+)"\)', self.APPSTATE).group(1).replace('\\\\', '\\')
        self.assertEqual(ns['QA_ORIGIN_RE'], java_re, 'same rule as AppState.isQaOrigin')
        self.assertIn('return origin(c) + "/wizard-os-home/"', self.APPSTATE)
        self.assertRegex(ns['QA_HOME'], '^' + java_re + '$')
        self.assertEqual(ns['EXPECTED_HOME'], 'http://localhost:18779/wizard-os-home/')
        for wrong in (ns['EXPECTED_HOME'], 'http://127.0.0.1:18779', 'https://localhost:18779', 'http://localhost:18779/'):
            self.assertIsNone(re.fullmatch(java_re, wrong), wrong + ' would be ignored by the app: it falls back to the real origin')
        self.assertIn("echo {QA_HOME} > files/qa_home.txt", SRC)
        self.assertIn('pg = shell_page()', SRC)
        self.assertNotIn("Page('wizard-os-home')\n        pg.ev(", SRC)

    def page(self, ready=True, fail=None):
        seen = {}
        class Page:
            def __init__(self, match, sock):
                seen['match'], seen['sock'] = match, sock
                if fail: raise RuntimeError(fail)
            def ev(self, expr): seen['bridge'] = 'WizardOSNative' in expr; return ready
            def close(self): seen['closed'] = True
        return Page, seen

    def test_success_selects_the_exact_home_page_of_the_one_app_process_and_needs_the_bridge(self):
        Page, seen = self.page()
        ns = self.lift(sx=lambda c, **kw: '4321' if c.startswith('pidof') else '', Page=Page)
        ns['shell_page']()
        self.assertEqual(seen['match'], 'http://localhost:18779/wizard-os-home/')
        self.assertEqual(seen['sock'], 'webview_devtools_remote_4321')
        self.assertTrue(seen['bridge'])
        self.assertFalse((ns['job'] / 'startup-diagnostics.json').exists())

    def test_every_startup_failure_records_diagnostics_before_raising(self):
        for case, sx, kw in (('no page', lambda c, **kw: '4321' if c.startswith('pidof') else 'x', {'fail': 'no page'}),
                             ('no process', lambda c, **kw: '', {}), ('two processes', lambda c, **kw: '4321 4322' if c.startswith('pidof') else '', {}),
                             ('no bridge', lambda c, **kw: '4321' if c.startswith('pidof') else '', {'ready': False})):
            Page, seen = self.page(**kw)
            ns = self.lift(sx=sx, Page=Page)
            with self.assertRaises(RuntimeError, msg=case):
                ns['shell_page']()
            d = json.loads((ns['job'] / 'startup-diagnostics.json').read_text())
            self.assertEqual(d['expected_url'], 'http://localhost:18779/wizard-os-home/', case)
            for key in ('why', 'top', 'pidof', 'qa_home', 'qa_origin', 'devtools_sockets', 'fake_server_log', 'targets'):
                self.assertIn(key, d, case)
            self.assertTrue((ns['job'] / 'startup-ui.xml').exists() and (ns['job'] / 'startup-logcat.txt').exists(), case)


class CommandEvidence(unittest.TestCase):
    def lift(self, directory, **stubs):
        names = {'sh', 'sx', 'shot', 'device_snapshot', 'require_device'}
        ns: dict[str, Any] = dict(subprocess=subprocess, json=json, re=re, time=__import__('time'), job=Path(directory), OUT=Path(directory),
                  env=os.environ.copy(), S='emulator-5554', ADB='adb', em=None)
        ns.update(stubs)
        exec(compile(ast.Module(body=[n for n in TREE.body if getattr(n, 'name', None) in names], type_ignores=[]), 'qa_orb_screen.py', 'exec'), ns)
        return ns

    def test_real_subprocess_failure_is_not_blank_success_and_stderr_is_retained(self):
        import sys
        with tempfile.TemporaryDirectory() as d:
            ns = self.lift(d)
            args = (sys.executable, '-c', 'import sys;sys.stderr.write("adb: device not found");sys.exit(7)')
            with self.assertRaisesRegex(RuntimeError, 'device not found'): ns['sh'](*args)
            self.assertEqual(ns['sh'](*args, check=False), '')
            entries = [json.loads(l) for l in (Path(d)/'commands.jsonl').read_text().splitlines()]
            self.assertEqual(len(entries), 2)
            for e in entries:
                self.assertEqual(e['argv'], list(args)); self.assertEqual(e['returncode'], 7)
                self.assertEqual(e['stderr'], 'adb: device not found'); self.assertEqual(e['serial'], 'emulator-5554')
                self.assertEqual(e['timeout_seconds'], 30)

    def test_real_timeout_is_bounded_recorded_and_binary_capture_rejects_empty(self):
        import sys
        with tempfile.TemporaryDirectory() as d:
            ns = self.lift(d)
            with self.assertRaises(subprocess.TimeoutExpired):
                ns['sh'](sys.executable, '-c', 'import time;time.sleep(5)', timeout=.05)
            entry = json.loads((Path(d)/'commands.jsonl').read_text().splitlines()[-1])
            self.assertTrue(entry['timed_out']); self.assertIsNone(entry['returncode'])
            ns['sh'] = lambda *a, **kw: b''
            with self.assertRaisesRegex(RuntimeError, 'no PNG'): ns['shot']('bad')
            self.assertFalse((Path(d)/'bad.png').exists())

    def test_serial_and_emulator_process_must_both_be_alive_before_startup(self):
        for rc, devices, good in [(None, 'emulator-5554\tdevice\n', True), (1, 'emulator-5554\tdevice\n', False),
                                   (None, 'emulator-5556\tdevice\n', False), (None, 'emulator-5554\toffline\n', False)]:
            with tempfile.TemporaryDirectory() as d:
                diagnostics = []
                ns = self.lift(d, em=type('Em', (), dict(pid=123, poll=lambda self: rc))(),
                               startup_diagnostics=lambda why: diagnostics.append(why))
                ns['sh'] = lambda *a, **kw: devices
                if good: ns['require_device']()
                else:
                    with self.assertRaisesRegex(RuntimeError, 'not a live ADB target'): ns['require_device']()
                    self.assertTrue(diagnostics)
                state = json.loads((Path(d)/'device-ready.json').read_text())
                self.assertEqual(state['emulator_returncode'], rc); self.assertEqual(state['devices'], devices)
                self.assertIn('ADB_SERVER_SOCKET', state['environment'])
        self.assertIn('    require_device()\n    pid =', SRC)


if __name__ == '__main__':
    unittest.main()
