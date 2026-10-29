#!/usr/bin/env python3
"""Offline real-loopback characterization, NOT WebSocket compliance/Android proof.

Known defects are asserted as defects, not relabelled passing invariants. Load
actual Page AST to avoid unrelated SDK discovery at qa_aa_lib module import.
"""
import ast
import collections
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.request
import uuid
import re

SOURCE = Path(__file__).with_name('qa_aa_lib.py')
node = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.ClassDef) and n.name == 'Page')
namespace = dict(globals(), pathlib=__import__('pathlib'), ADB='synthetic-adb')
exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), 'exec'), namespace)
Page = namespace['Page']


def retain(page, name):
    root = os.environ.get('WIZARD_QA_TRANSPORT_EVIDENCE')
    if root:
        Path(root, name).write_bytes(page._diag_path.read_bytes())


def frame(payload, opcode=1, fin=True):
    n = len(payload)
    return bytes([(128 if fin else 0) | opcode, n if n < 126 else 126 if n < 65536 else 127]) + (b'' if n < 126 else n.to_bytes(2 if n < 65536 else 8, 'big')) + payload


def need(sock, n):
    data = b''
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise EOFError('synthetic client EOF')
        data += chunk
    return data


def request(sock):
    b1, b2 = need(sock, 2)
    n = b2 & 127
    if n in (126, 127):
        n = int.from_bytes(need(sock, 2 if n == 126 else 8), 'big')
    mask = need(sock, 4) if b2 & 128 else b''
    payload = need(sock, n)
    data = bytes(b ^ mask[i % 4] for i, b in enumerate(payload)) if mask else payload
    return b1, bool(mask), json.loads(data)


@contextlib.contextmanager
def peer(handler, out=None, status=b'101 Switching Protocols', accept=b's3pPLMBiTxaQ9kYGzzhZRbK+xOo='):
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0)); listener.listen(1); listener.settimeout(2)
    port = listener.getsockname()[1]
    errors, seen, commands = [], [], []
    def serve():
        try:
            with listener.accept()[0] as conn:
                conn.settimeout(2)
                header = b''
                while b'\r\n\r\n' not in header:
                    header += need(conn, 1)
                seen.append(header)
                conn.sendall(b'HTTP/1.1 ' + status + b'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n')
                handler(conn, seen)
        except Exception as exc:
            errors.append(exc)
    t = threading.Thread(target=serve, daemon=True); t.start()
    def sx(cmd, **kw):
        commands.append((cmd, kw))
        return '2603' if cmd.startswith('pidof') else '2603 (app with spaces) ' + ' '.join(['S'] + ['0'] * 18 + ['123456'])
    def sh(*args, **kw):
        commands.append((args, kw))
        return 'emulator-5554 tcp:%d localabstract:webview_devtools_remote_2603\nother tcp:%d other\n' % (port, port)
    emu = SimpleNamespace(pkg='synthetic.pkg', S='emulator-5554', out=out, sx=sx, sh=sh)
    listing = json.dumps([{'type': 'page', 'url': 'http://synthetic/wizard-os-home', 'webSocketDebuggerUrl': 'ws://127.0.0.1:%d/devtools/page/synthetic' % port}]).encode()
    page = None
    try:
        with patch.dict(os.environ, {'WIZARD_QA_CDP_DIAGNOSTIC': '1' if out else '0'}), patch.object(urllib.request, 'urlopen', return_value=io.BytesIO(listing)):
            page = Page(emu, port)
        page.s.settimeout(2)
        yield page, seen, commands
    finally:
        if page:
            page.close()
        t.join(3); listener.close()
        if t.is_alive():
            raise AssertionError('loopback server did not stop')
        if errors:
            raise AssertionError(errors)


class TransportTest(unittest.TestCase):
    def test_first_only_boundary_keeps_capture_but_never_reaches_second_send(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('diag_boundary', SOURCE.with_name('qa_share_transport_diagnostic.py'))
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        calls = []
        def capture():
            calls.extend(['native-screenshot', 'compositor-screenshot'])
        with self.assertRaises(module.FirstNotificationObserved):
            module.first_only(capture)()
            calls.append('second-send')
        self.assertEqual(calls, ['native-screenshot', 'compositor-screenshot'])
        def failing_capture():
            raise RuntimeError('original transport failure')
        with self.assertRaisesRegex(RuntimeError, '^original transport failure$'):
            module.first_only(failing_capture)()

    def test_masked_send_lengths_and_plain_large_fragmented_responses(self):
        for size in (8, 200, 70000):
            with self.subTest(size=size):
                def handler(conn, seen):
                    b1, masked, obj = request(conn); seen.append((b1, masked, obj))
                    data = json.dumps({'id': obj['id'], 'result': {'data': 'x' * size}}).encode()
                    cut = len(data) // 2
                    conn.sendall(frame(data[:cut], fin=False) + frame(data[cut:], opcode=0))
                with peer(handler) as (p, seen, _):
                    self.assertEqual(p.call('Synthetic.method', input='x' * size)['result']['data'], 'x' * size)
                    self.assertEqual(seen[1][0:2], (129, True))

    def test_event_interleave_and_coalesced_frames(self):
        def handler(conn, seen):
            request(conn)
            conn.sendall(frame(b'{"method":"Inspector.detached","params":{"reason":"synthetic"}}') + frame(b'{"id":1,"result":{}}'))
        with peer(handler) as (p, _, __):
            self.assertEqual(p.call('Synthetic.method'), {'id': 1, 'result': {}})

    def test_eof_is_actual_empty_recv_not_json_or_timeout(self):
        def handler(conn, seen):
            request(conn)  # clean TCP close, without WebSocket close frame
        with peer(handler) as (p, seen, _):
            with self.assertRaisesRegex(RuntimeError, '^ws closed$'):
                p.call('Page.captureScreenshot', format='png')
            self.assertEqual(len(seen), 1)

    def test_truncated_large_frame_also_collapses_to_same_eof(self):
        def handler(conn, seen):
            request(conn); conn.sendall(frame(b'x' * 70000)[:40])
        with peer(handler) as (p, _, __):
            with self.assertRaisesRegex(RuntimeError, '^ws closed$'):
                p.call('Synthetic.method')

    def test_known_defect_ping_is_json_error_not_historic_eof(self):
        def handler(conn, seen):
            request(conn); conn.sendall(frame(b'probe', opcode=9))
        with peer(handler) as (p, _, __):
            with self.assertRaises(json.JSONDecodeError):
                p.call('Synthetic.method')

    def test_known_defect_interleaved_ping_breaks_fragmentation(self):
        def handler(conn, seen):
            request(conn); conn.sendall(frame(b'{"id":', fin=False) + frame(b'probe', opcode=9) + frame(b'1}', opcode=0))
        with peer(handler) as (p, _, __):
            with self.assertRaises(json.JSONDecodeError):
                p.call('Synthetic.method')

    def test_known_defect_close_code_is_json_error_not_historic_eof(self):
        def handler(conn, seen):
            request(conn); conn.sendall(frame((1001).to_bytes(2, 'big'), opcode=8))
        with peer(handler) as (p, _, __):
            with self.assertRaises(UnicodeDecodeError):
                p.call('Synthetic.method')

    def test_known_defect_invalid_status_and_accept_are_not_validated(self):
        for status, accept in ((b'403 Forbidden', b'bad'), (b'101 Switching Protocols', b'bad')):
            def handler(conn, seen):
                request(conn); conn.sendall(frame(b'{"id":1}'))
            with peer(handler, status=status, accept=accept) as (p, _, __):
                self.assertEqual(p.call('Synthetic.method'), {'id': 1})

    def test_diagnostic_eof_has_method_id_partial_frame_identity_no_payload(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            def handler(conn, seen):
                request(conn); conn.sendall(frame(b'x' * 70000)[:40])
            with peer(handler, out=Path(td)) as (p, _, commands):
                with self.assertRaisesRegex(RuntimeError, '^ws closed$'):
                    p.call('Page.captureScreenshot', sentinel='DO_NOT_LOG_THIS')
                rows = json.loads(p._diag_path.read_text())['events']
                eof = next(r for r in rows if r['event'] == 'eof')
                self.assertEqual(eof['pending'], {'id': 1, 'method': 'Page.captureScreenshot'})
                self.assertEqual(eof['needed'], 70010)
                self.assertEqual(eof['buffered'], 40)
                identity = [r for r in rows if r['event'] == 'native-identity']
                self.assertEqual(len(identity), 3)
                self.assertTrue(all(r['pid'] == '2603' and r['start_ticks'] == '123456' and len(r['forwards']) == 1 for r in identity))
                self.assertNotIn('DO_NOT_LOG_THIS', p._diag_path.read_text())
                retain(p, 'synthetic-partial-frame-eof.json')
                self.assertEqual(sum(1 for c, _ in commands if isinstance(c, tuple) and '--list' not in c), 1)

    def test_diagnostic_close_local_close_detach_and_bounded_ring(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            def handler(conn, seen):
                request(conn)
                conn.sendall(frame(b'{"method":"Inspector.detached","params":{"reason":"replaced_with_devtools"}}') + frame((1001).to_bytes(2, 'big'), opcode=8))
            with peer(handler, out=Path(td)) as (p, _, __):
                with self.assertRaises(UnicodeDecodeError):
                    p.call('Synthetic.method')
                rows = json.loads(p._diag_path.read_text())['events']
                self.assertIn('inspector-detached', [r['event'] for r in rows])
                self.assertEqual(next(r for r in rows if r['event'] == 'inspector-detached')['reason'], 'replaced_with_devtools')
                self.assertEqual(next(r for r in rows if r['event'] == 'peer-close')['code'], 1001)
                retain(p, 'synthetic-detach-and-close.json')
                for _ in range(200):
                    p._record('synthetic')
                p.close()
                rows = json.loads(p._diag_path.read_text())['events']
                self.assertEqual(len(rows), 96)
                self.assertEqual(rows[-1]['event'], 'local-close')
                self.assertEqual(len(json.loads(p._diag_path.read_text())['identities']), 3)
                self.assertLess(p._diag_path.stat().st_size, 50000)


if __name__ == '__main__':
    unittest.main()
