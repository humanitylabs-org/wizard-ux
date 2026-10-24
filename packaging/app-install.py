#!/usr/bin/env python3
"""Read-only per-app PWA documents. Private loopback upstream of the shell nginx.

No caller-provided names, icons, launch URLs or stored state. Each request rechecks
its app against the same authenticated registry the launcher reads.
"""
import html
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import ThreadingMixIn, UnixStreamServer
from urllib.parse import urlsplit

ROOT = Path(os.environ.get('WIZARD_WEB_ROOT', '/usr/share/nginx/wizard-ux'))
UPSTREAM = os.environ.get('WIZARD_AGENT_SERVICE_ORIGIN', 'http://wizard-agent-service:8787')
ROUTE = re.compile(r'^/wizard-os-home/install/([a-zA-Z0-9][a-zA-Z0-9_-]{0,95})/(manifest.webmanifest)?$')
# Forward the request's real identity, never mint owner/loopback proof.
AUTH_HEADERS = ('Host', 'Authorization', 'Cookie', 'Tailscale-User-Login', 'Tailscale-User-Name',
                'Tailscale-User-Profile-Pic', 'X-Forwarded-For', 'X-Forwarded-Host',
                'X-Forwarded-Proto', 'Cf-Access-Jwt-Assertion')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def app_record(snapshot, app_id):
    for app in snapshot.get('apps', []):
        if not isinstance(app, dict) or app.get('id') != app_id:
            continue
        value = app.get('url')
        # Only same-origin absolute paths. A URL never becomes a launch target here;
        # the existing app-session resolves it again using its own policy.
        if not isinstance(value, str) or not value.startswith('/') or value.startswith('//'):
            return None
        path = urlsplit(value).path
        if ('\\' in value or re.search(r'%(?:2f|5c|2e|25)', value, re.I)
                or any(part in ('.', '..') for part in path.split('/'))
                or path in ('', '/') or path.rsplit('/', 1)[0] == '' or path.startswith(('/wizard-os-home', '/wizard-ux'))):
            return None
        name = 'Signal' if app_id == 'wizard-signal' else str(app.get('name') or app_id)
        name = ''.join(c for c in name if c.isprintable()).strip()[:80] or app_id
        return {**app, 'name': name}
    return None


def presentation(app):
    app_id = app['id']
    base = '/wizard-os-home/install/' + app_id + '/'
    # House artwork is generated from WizSigil, not from user URLs or SVG content.
    icon = '/wizard-os-home/install-icons/' + app_id + '.png'
    if not (ROOT / 'install-icons' / (app_id + '.png')).is_file():
        icon = '/wizard-os-home/icon-512.png'
    manifest = {'id': base, 'name': app['name'], 'short_name': app['name'],
                'start_url': base + '?launch=1', 'scope': base,
                'display': 'standalone', 'background_color': '#110d1b', 'theme_color': '#110d1b',
                'icons': [{'src': icon, 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'}]}
    return base, icon, manifest


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # No names, auth or private paths in container logs.

    def reply(self, status, data, content_type):
        body = data.encode() if isinstance(data, str) else data
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Robots-Tag', 'noindex, nofollow')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        match = ROUTE.fullmatch(urlsplit(self.path).path)
        if not match:
            return self.reply(404, 'App unavailable', 'text/plain; charset=utf-8')
        app_id, resource = match.groups()
        try:
            headers = {name: self.headers[name] for name in AUTH_HEADERS if self.headers.get(name)}
            req = urllib.request.Request(UPSTREAM + '/wizard/v1/apps', headers=headers)
            with urllib.request.build_opener(NoRedirect).open(req, timeout=5) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError('registry too large')
            app = app_record(json.loads(raw), app_id)
        except urllib.error.HTTPError as error:
            code = error.code if error.code in (401, 403) else 503
            error.close()
            return self.reply(code, 'Open Wizard in your browser and sign in, then retry this link.', 'text/plain; charset=utf-8')
        except (OSError, ValueError, TypeError, AttributeError):
            return self.reply(503, 'Cannot check this app right now. Please try again.', 'text/plain; charset=utf-8')
        if not app:
            return self.reply(404, 'This app is not available on this Wizard.', 'text/plain; charset=utf-8')
        base, icon, manifest = presentation(app)
        if resource:
            return self.reply(200, json.dumps(manifest), 'application/manifest+json')
        page = (ROOT / 'install.html').read_text()
        for key, value in {'APP_NAME': app['name'], 'APP_ID': app_id, 'APP_BASE': base, 'APP_ICON': icon}.items():
            page = page.replace('{{' + key + '}}', html.escape(value, quote=True))
        self.reply(200, page, 'text/html; charset=utf-8')


if __name__ == '__main__':
    if os.environ.get('WIZARD_INSTALL_PORT'):  # isolated test harness only
        server = ThreadingHTTPServer(('127.0.0.1', int(os.environ['WIZARD_INSTALL_PORT'])), Handler)
    else:
        class UnixServer(ThreadingMixIn, UnixStreamServer):
            daemon_threads = True
        socket = Path('/tmp/wizard-install.sock')
        socket.unlink(missing_ok=True)
        server = UnixServer(str(socket), Handler)
        socket.chmod(0o600)
    server.serve_forever()
