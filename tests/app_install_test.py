"""HTTP contract for registry-backed installation (no live owner data)."""
import importlib.util
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('app_install', ROOT / 'packaging/app-install.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.ROOT = ROOT / 'web'


class Registry(BaseHTTPRequestHandler):
    records = []
    seen = []
    status = 200

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        self.seen.append(dict(self.headers))
        self.send_response(self.status)
        self.send_header('Location', '/unexpected')
        self.end_headers()
        self.wfile.write(json.dumps({'apps': self.records}).encode())


class InstallTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = ThreadingHTTPServer(('127.0.0.1', 0), Registry)
        app.UPSTREAM = 'http://127.0.0.1:' + str(cls.registry.server_port)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        for server in (cls.registry, cls.server):
            threading.Thread(target=server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for server in (cls.server, cls.registry):
            server.shutdown()
            server.server_close()

    def setUp(self):
        Registry.records = [{'id':'wisdom', 'name':'Wisdom', 'url':'/wisdom/'},
                            {'id':'wizard-signal', 'name':'Wizard Signal', 'url':'/wizard-signal/'}]
        Registry.status = 200
        Registry.seen = []

    def get(self, suffix='', id='wisdom', headers=None):
        request = urllib.request.Request(self.origin + '/wizard-os-home/install/' + id + '/' + suffix, headers=headers or {})
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read().decode()

    def test_distinct_stable_identity(self):
        manifests = []
        for id in ('wisdom', 'wizard-signal'):
            code, headers, body = self.get('manifest.webmanifest', id)
            self.assertEqual(code, 200)
            self.assertEqual(headers['Content-Type'], 'application/manifest+json')
            self.assertIn('no-store', headers['Cache-Control'])
            manifest = json.loads(body)
            self.assertEqual(manifest['scope'], '/wizard-os-home/install/' + id + '/')
            self.assertEqual(manifest['id'], manifest['scope'])
            self.assertEqual(manifest['start_url'], manifest['scope'] + '?launch=1')
            self.assertTrue((app.ROOT / manifest['icons'][0]['src'].removeprefix('/wizard-os-home/')).is_file())
            manifests.append(manifest)
        self.assertNotEqual(manifests[0]['id'], manifests[1]['id'])
        self.assertNotEqual(manifests[0]['icons'], manifests[1]['icons'])
        self.assertEqual(manifests[1]['name'], 'Signal')

    def test_unknown_malformed_removed_and_unsafe(self):
        for id in ('unknown', 'a%2Fb', 'x.y', 'a' * 97):
            self.assertEqual(self.get(id=id)[0], 404)
        for url in ('https://evil.example/app/', '//evil/app/', '/wizard-os-home/', '/wizard-ux/', '/', '/file.html', '/a/../b/', '/a/%252e/', '/a\\evil/'):
            Registry.records[0]['url'] = url
            self.assertEqual(self.get()[0], 404, url)
        Registry.records = []
        self.assertEqual(self.get('manifest.webmanifest')[0], 404)

    def test_names_and_icons_are_not_markup_or_navigation(self):
        Registry.records[0].update(name='<script>alert("x")</script>', icon='https://evil.example/icon.png')
        code, headers, body = self.get()
        self.assertEqual(code, 200)
        self.assertNotIn('<script>alert', body)
        self.assertNotIn('evil.example', body)
        self.assertIn('&lt;script&gt;', body)
        self.assertIn('apple-mobile-web-app-title', body)
        self.assertIn('apple-touch-icon', body)
        self.assertIn("base-uri 'none'", headers['Content-Security-Policy'])

    def test_real_identity_forwarding_without_minted_proof(self):
        self.get(headers={'Authorization':'Bearer fixture', 'Cookie':'test=fixture'})
        self.assertEqual(Registry.seen[0]['Authorization'], 'Bearer fixture')
        self.assertEqual(Registry.seen[0]['Cookie'], 'test=fixture')
        self.assertNotIn('Tailscale-User-Login', Registry.seen[0])
        self.get(headers={'Tailscale-User-Login':'fixture@example.test'})
        self.assertEqual(Registry.seen[-1]['Tailscale-User-Login'], 'fixture@example.test')

    def test_auth_unavailable_and_redirect_fail_closed(self):
        for status, expected in ((401,401), (403,403), (500,503), (302,503)):
            Registry.status = status
            self.assertEqual(self.get()[0], expected)
        self.assertEqual(len(Registry.seen), 4, 'registry redirects are not followed')


if __name__ == '__main__':
    unittest.main()
