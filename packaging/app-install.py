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
# App-level identity for an app's own page, keyed by the first path segment the page is served at
# (/morning-report/... -> "morning-report"). The segment is only a lookup key: the app, its name,
# root and icon all come from the registry record whose url path is exactly /<segment>/.
APP_ROUTE = re.compile(r'^/wizard-os-home/install/at/([a-zA-Z0-9][a-zA-Z0-9_-]{0,95})\.webmanifest$')
BACKGROUND = '#110d1b'
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


def icon_set(app_id):
    """House PNGs at 180/192/512, else the Wizard mark at the same sizes. Never a remote or app URL."""
    if (ROOT / 'install-icons' / (app_id + '.png')).is_file():
        stem = '/wizard-os-home/install-icons/' + app_id
        files = {512: stem + '.png', 192: stem + '-192.png', 180: stem + '-180.png'}
        files = {size: url for size, url in files.items()
                 if size == 512 or (ROOT / url.removeprefix('/wizard-os-home/')).is_file()}
    else:
        files = {512: '/wizard-os-home/icon-512.png', 192: '/wizard-os-home/icon-192.png',
                 180: '/wizard-os-home/apple-touch-icon.png'}
    return files


def app_by_path(snapshot, segment):
    """The registered app served at exactly /<segment>/ on this origin, or None."""
    for item in snapshot.get('apps', []):
        if not isinstance(item, dict) or not isinstance(item.get('id'), str):
            continue
        app = app_record(snapshot, item['id'])
        if app and urlsplit(app['url']).path == '/' + segment + '/':
            return app
    return None


def app_manifest(app):
    """Clean app-level PWA: registry name, house icon, opens at the registered app root."""
    root = urlsplit(app['url'])
    start = root.path + ('?' + root.query if root.query else '') + ('#' + root.fragment if root.fragment else '')
    icons = icon_set(app['id'])
    return {'id': root.path, 'name': app['name'], 'short_name': app['name'],
            'start_url': start, 'scope': root.path, 'display': 'standalone',
            'background_color': BACKGROUND, 'theme_color': BACKGROUND,
            'icons': [{'src': icons[size], 'sizes': f'{size}x{size}', 'type': 'image/png', 'purpose': 'any'}
                      for size in (192, 512, 180) if size in icons]}


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
        path = urlsplit(self.path).path
        by_path = APP_ROUTE.fullmatch(path)
        match = ROUTE.fullmatch(path)
        if not match and not by_path:
            return self.reply(404, 'App unavailable', 'text/plain; charset=utf-8')
        app_id, resource = match.groups() if match else (by_path.group(1), None) if by_path else (None, None)
        try:
            headers = {name: self.headers[name] for name in AUTH_HEADERS if self.headers.get(name)}
            req = urllib.request.Request(UPSTREAM + '/wizard/v1/apps', headers=headers)
            with urllib.request.build_opener(NoRedirect).open(req, timeout=5) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError('registry too large')
            snapshot = json.loads(raw)
            app = app_by_path(snapshot, app_id) if by_path else app_record(snapshot, app_id)
        except urllib.error.HTTPError as error:
            code = error.code if error.code in (401, 403) else 503
            error.close()
            return self.reply(code, 'Open Wizard in your browser and sign in, then retry this link.', 'text/plain; charset=utf-8')
        except (OSError, ValueError, TypeError, AttributeError):
            return self.reply(503, 'Cannot check this app right now. Please try again.', 'text/plain; charset=utf-8')
        if not app:
            return self.reply(404, 'This app is not available on this Wizard.', 'text/plain; charset=utf-8')
        if by_path:
            return self.reply(200, json.dumps(app_manifest(app)), 'application/manifest+json')
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
