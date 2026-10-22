"""Lightweight private diagnostics HTTP/security/retention tests (no Android build)."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scroll_diagnostics as diag
import server


class DiagnosticsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.body = json.dumps({'schema': 1, 'session': {'model': 'synthetic-fixture'}, 'events': [
            {'seq': 1, 'uptimeMs': 42, 'thread': 'main', 'method': 'scrollBy', 'data': {'y': 120}}]}).encode()

    def test_append_only_private_and_retention(self):
        names = [diag.store(self.body, self.root) for _ in range(55)]
        files = sorted(self.root.glob('*.json'))
        self.assertEqual(50, len(files))
        self.assertEqual(names[5:], [p.name for p in files])
        self.assertTrue(all(p.read_bytes() == self.body and p.stat().st_mode & 0o777 == 0o600 for p in files))

    def test_rejects_size_content_and_schema(self):
        for body in (b'x' * (diag.LIMIT + 1), b'{}', b'{', self.body.replace(b'"y": 120', b'"text": "no"')):
            with self.assertRaises(ValueError):
                diag.store(body, self.root)
        self.assertEqual([], list(self.root.glob('*')))

    def test_http_origin_size_append_and_no_read(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        def request(method, body=None, origin='http://localhost:9271', content='application/json'):
            c = http.client.HTTPConnection('127.0.0.1', httpd.server_port)
            c.request(method, diag.PATH, body=body, headers={'Origin': origin, 'Content-Type': content})
            r = c.getresponse()
            code, data = r.status, r.read()
            c.close()
            return code, json.loads(data)
        with patch.dict('os.environ', {'WIZARD_SCROLL_DIAGNOSTICS_DIR': str(self.root)}):
            self.assertEqual(403, request('POST', self.body, 'https://untrusted.invalid')[0])
            self.assertEqual(415, request('POST', self.body, content='text/plain')[0])
            self.assertEqual(413, request('POST', b'x' * (diag.LIMIT + 1))[0])
            self.assertEqual(400, request('POST', b'{}')[0])
            code, receipt = request('POST', self.body)
            self.assertEqual(201, code)
            self.assertEqual(self.body, (self.root / receipt['record']).read_bytes())
            self.assertEqual(405, request('GET')[0])


if __name__ == '__main__':
    unittest.main()
