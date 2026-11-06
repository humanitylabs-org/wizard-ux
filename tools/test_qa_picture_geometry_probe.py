"""Origin validation for qa_picture_geometry_probe.py: no real image, filesystem write, git or network."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('qa_picture_geometry_probe', HERE / 'qa_picture_geometry_probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Reached(Exception):
    pass


HOSTILE = [
    'http://127.0.0.1:9191@evil.example',      # userinfo: real host is evil.example
    'http://127.0.0.1:9191@evil.example:80',
    'http://user:pw@127.0.0.1:9191',
    'http://localhost:9191@10.0.0.1:9191',
    'http://127.0.0.1:9191/',                  # exact origin, not URL: trailing slash is a path
    'http://127.0.0.1:9191/wizard-search',
    'http://127.0.0.1:9191?x=1',
    'http://127.0.0.1:9191?',
    'http://127.0.0.1:9191#f',
    'http://127.0.0.1:9191#',
    'https://127.0.0.1:9191',
    'HTTP://127.0.0.1:9191',
    'ftp://127.0.0.1:9191',
    'http://127.0.0.1',
    'http://127.0.0.1:',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:09191',
    'http://127.0.0.1:+9191',
    'http://127.0.0.1: 9191',
    'http://127.0.0.1:9191 ',
    'http://127.0.0.1.evil.example:9191',
    'http://LOCALHOST:9191',
    'http://localhost.:9191',
    'http://[::1]:9191',
    'http://127.0.0.2:9191',
    '//127.0.0.1:9191',
    'http://127.0.0.1:9191\n',
    'http://127.0.0.1:9191\\@evil.example',
]
VALID = ['http://127.0.0.1:9191', 'http://localhost:1', 'http://127.0.0.1:65535']


def run_main(origin, out):
    argv = ['qa_picture_geometry_probe.py', '--image', '/nonexistent/exact-image.jpg', '--out', str(out), '--origin', origin]
    with mock.patch.object(sys, 'argv', argv):
        probe.main()


class OriginValidation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / 'fixture'

    def tearDown(self):
        self.tmp.cleanup()

    def guarded(self):
        """Any filesystem, git, image or network step after validation raises Reached (sentinel)."""
        def reached(*a, **k):
            raise Reached(a[:1])
        return [mock.patch.object(probe, 'inside_git', side_effect=reached),
                mock.patch.object(probe.Path, 'read_bytes', reached),
                mock.patch.object(probe.Path, 'mkdir', reached),
                mock.patch.object(probe.Path, 'resolve', reached),
                mock.patch.object(probe.urllib.request, 'urlopen', side_effect=reached)]

    def test_hostile_origin_refused_before_any_image_read_or_network(self):
        for origin in HOSTILE:
            with self.subTest(origin=origin):
                patches = self.guarded()
                for p in patches:
                    p.start()
                try:
                    with self.assertRaises(SystemExit):  # Reached here means validation came too late or not at all
                        run_main(origin, self.out)
                finally:
                    for p in patches:
                        p.stop()

    def test_userinfo_origin_never_reaches_image_read(self):
        # The old startswith() guard let this through to the private image read, then to evil.example.
        read = mock.Mock(side_effect=Reached('image read'))
        with mock.patch.object(probe, 'inside_git', return_value=False), \
             mock.patch.object(probe.Path, 'read_bytes', read), \
             mock.patch.object(probe.urllib.request, 'urlopen', side_effect=Reached('network')):
            with self.assertRaises(SystemExit):
                run_main('http://127.0.0.1:9191@evil.example', self.out)
        read.assert_not_called()
        self.assertFalse(self.out.exists())

    def test_validate_origin_accepts_exact_loopback_origins_only(self):
        for origin in VALID:
            self.assertEqual(probe.validate_origin(origin), origin)
        for origin in HOSTILE:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                probe.validate_origin(origin)

    def test_valid_loopback_reaches_mocked_normal_workflow(self):
        urls, written = [], {}

        class Reply(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def urlopen(req, timeout=None):
            url = req if isinstance(req, str) else req.full_url
            urls.append(url)
            if url.endswith('/health'):
                return Reply(json.dumps({'revision': 'r'}).encode())
            if 'read-image' in url:
                return Reply(json.dumps({'lines': ['a', 'b'], 'boxes': [[.1, .1, .2, .2], None], 'model': 'm'}).encode())
            return Reply(json.dumps({'items': json.loads(req.data)['items']}).encode())

        with mock.patch.object(probe, 'inside_git', return_value=False), \
             mock.patch.object(probe.Path, 'read_bytes', lambda self: b'synthetic-not-an-image'), \
             mock.patch.object(probe.urllib.request, 'urlopen', side_effect=urlopen), \
             mock.patch.object(probe, 'write', lambda p, data: written.__setitem__(p.name, data)), \
             mock.patch('sys.stdout', new_callable=io.StringIO) as stdout:
            run_main('http://127.0.0.1:9191', self.out)
        self.assertEqual(urls, ['http://127.0.0.1:9191/wizard-search/api/health',
                                'http://127.0.0.1:9191/wizard-search/api/read-image?geometry=1',
                                'http://127.0.0.1:9191/wizard-search/api/translate'])
        self.assertEqual(set(written), {'live-read-image.json', 'live-translate.json', 'geometry-boxes.svg'})
        summary = json.loads(stdout.getvalue())
        self.assertTrue(summary['ok'])
        self.assertEqual((summary['lines'], summary['boxes']), (2, 1))


if __name__ == '__main__':
    unittest.main()
