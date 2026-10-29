#!/usr/bin/env python3
"""Synthetic read-only upstream for per-app installation QA; never production data."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import mimetypes
from urllib.parse import unquote

APPS = [
    {'id':'wisdom', 'name':'Wisdom', 'url':'/wisdom/', 'source':'apps.json'},
    {'id':'wizard-signal', 'name':'Wizard Signal', 'url':'/wizard-signal/', 'source':'apps.json'},
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path.startswith('/wizard-os-home/') and os.environ.get('QA_WEB_ROOT'):
            root = Path(os.environ['QA_WEB_ROOT']).resolve()
            file = (root / unquote(path.removeprefix('/wizard-os-home/') or 'index.html')).resolve()
            if not file.is_relative_to(root) or not file.is_file():
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(file)[0] or 'application/octet-stream')
            self.end_headers()
            self.wfile.write(file.read_bytes())
            return
        if path == '/wizard/v1/apps':
            data = {'apps': APPS}
        elif path == '/wizard/v1/bootstrap':
            data = {'bootstrap':1, 'settings':{}, 'capabilities':{}, 'endpoints':{'apps':'/wizard/v1/apps'}}
        elif path in ('/wisdom/', '/wizard-signal/'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<!doctype html><title>Synthetic app</title><h1>QA app</h1><a href="#nested">Nested view</a>')
            return
        else:
            data = {}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_POST(self):
        self.send_error(405)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('QA_FIXTURE_PORT', '9080'))), Handler).serve_forever()
