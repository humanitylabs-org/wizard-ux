#!/usr/bin/env python3
"""Activate one checked WAM install inside an EXISTING authenticated Caddy site.
Runs in the WAM Python environment, not in the browser. See docs/wizard-alpha.md.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request
import urllib.error


def run(argv):
    return subprocess.check_output(argv, text=True, timeout=60)


def atomic(path, value):
    temp = path.with_name(path.name + '.alpha-tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.chmod(0o600)
    temp.replace(path)


def require_running_image(entry, containers, verified_load):
    """Classic IDs match directly; containerd IDs are resolved only by WAM's archive verifier.

    On Docker 29 the local immutable ID is the OCI manifest rather than its config.
    Reuse the canonical checksum+manifest+config binding, never accept a mutable tag
    or a container's self-reported label as proof. The extra load is idempotent.
    """
    running = {x['Image'] for x in containers if x['State']['Running']}
    if not running:
        raise ValueError('running_image_mismatch')
    if running & {i['image_id'] for i in entry['images'].values()}:
        return
    loaded = verified_load()
    if not loaded or loaded['image_id'] not in running:
        raise ValueError('running_image_mismatch')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    p = argparse.ArgumentParser()
    for key in ('catalog', 'app', 'commit', 'receipt'):
        p.add_argument('--' + key, required=True)
    a = p.parse_args()
    from wam import cli, test_catalog
    entry = next(x for x in test_catalog.load(a.catalog) if x['id'] == a.app and x['commit'] == a.commit)
    policy = json.loads(Path(os.environ['WIZARD_ALPHA_ACTIVATION']).read_text())
    origin = policy['origin'].rstrip('/')
    if not re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::\d+)?|http://127\.0\.0\.1:\d+', origin):
        raise ValueError('private_https_or_loopback_origin_required')
    # Config/headers are owner-local policy; catalog data cannot supply an auth header or command.
    headers = json.loads(Path(policy['headers_file']).read_text()) if policy.get('headers_file') else {}
    c = cli.Config()
    rt = c.runtipi()
    app = rt.app(f'{a.app}:{cli.STORE}')
    if app.get('app', {}).get('status') != 'running':
        raise ValueError('app_not_running')
    installed = c.runtipi_root / 'apps' / cli.STORE / a.app
    store = c.runtipi_root / 'repos' / cli.STORE / 'apps' / a.app
    # Runtipi may not copy hidden provenance files. Require immutable store pin AND actual loaded container image.
    if (store / '.wizard-commit').read_text().strip() != a.commit:
        raise ValueError('installed_pin_mismatch')
    ids = run(['docker', 'ps', '-q', '--filter', f'label=com.docker.compose.project={a.app}_{cli.STORE}']).split()
    containers = json.loads(run(['docker', 'inspect', *ids])) if ids else []
    require_running_image(entry, containers, lambda: test_catalog.preload(entry, cli.private.token()))
    port = app['app'].get('port') or app['info'].get('port')
    fragment = test_catalog.gateway_fragment(entry, int(port))
    target = Path(policy['fragment_dir']) / (a.app + '.caddy')
    if not target.parent.is_dir():
        raise ValueError('existing_private_include_directory_required')
    old_fragment = target.read_bytes() if target.exists() else None
    if old_fragment is not None and not old_fragment.startswith(b'# Wizard Alpha managed\n'):
        raise ValueError('unowned_gateway_fragment')
    routes_path = c.home / 'routes.json'
    routes = json.loads(routes_path.read_text()) if routes_path.exists() else {}
    view = entry['gateway']['path']
    if routes.get(a.app, {}).get('view') not in (None, view):
        raise ValueError('existing_route_conflict')
    old_routes = routes.copy()
    try:
        target.write_text('# Wizard Alpha managed\n' + fragment)
        run(['caddy', 'validate', '--config', policy['caddy_config']])
        run(['caddy', 'reload', '--config', policy['caddy_config']])
        opener = urllib.request.build_opener(NoRedirect())
        url = origin + view
        # Require this route's existing authentication gate to reject an unauthenticated request.
        if headers:
            try:
                opener.open(url, timeout=15)
                raise ValueError('route_missing_auth_gate')
            except urllib.error.HTTPError as e:
                if e.code not in (401, 403):
                    raise
        with opener.open(urllib.request.Request(url, headers=headers), timeout=20) as response:
            body = response.read(2 * 1024 * 1024).decode('utf8')
            if response.status != 200 or 'text/html' not in response.headers.get('Content-Type', ''):
                raise ValueError('view_not_html')
        sentinel = policy.get('sentinels', {}).get(a.app)
        if not sentinel or sentinel not in body:
            raise ValueError('view_content_not_verified')
        routes[a.app] = {**routes.get(a.app, {}), 'view': view}
        atomic(routes_path, routes)
        cli.write_registry(c, rt)
        reg = json.loads((c.home / 'apps.json').read_text())
        actual = next(x for x in reg['apps'] if x['id'] == a.app)
        if actual['commit'] != a.commit or actual.get('view', {}).get('url') != view:
            raise ValueError('registry_activation_mismatch')
        atomic(Path(a.receipt), {'id': a.app, 'commit': a.commit, 'status': 'running', 'view': view,
                                'open_verified': True, 'proof': 'pinned_running_image+authenticated_html+registry'})
    except Exception:
        if old_fragment is None:
            target.unlink(missing_ok=True)
        else:
            target.write_bytes(old_fragment)
        atomic(routes_path, old_routes)
        run(['caddy', 'reload', '--config', policy['caddy_config']])
        cli.write_registry(c, rt)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No secret-bearing subprocess/HTTP diagnostics in agent or browser responses.
        raise SystemExit('alpha_activation_failed: inspect owner-local gateway, image and registry configuration')
