#!/usr/bin/env python3
"""Pinned lifecycle bridge using the installed WAM library and authenticated Runtipi API.
No WAM source patches, replacement installer, Docker compose bypass or browser route.
"""
import json
import os
import sys
from wam import cli, test_catalog


def main(args):
    update = len(args) == 3 and args[:2] == ['app', 'update']
    if update:
        app_id = args[2]
    elif len(args) >= 2 and args[0] == 'install':
        # Delegate ordinary install/form handling entirely to the installed WAM CLI.
        return cli.main(args)
    else:
        raise ValueError('only_install_and_explicit_update_supported')
    entries = test_catalog.load(os.environ['WAM_PRIVATE_CATALOG'])
    selected = next(a for a in entries if a['id'] == app_id)
    c = cli.Config()
    rt = c.runtipi()
    urn = f'{app_id}:{cli.STORE}'
    before = rt.app(urn)
    if not before.get('app'):
        raise ValueError('not_installed')
    # Resolve the exact private entry FIRST: authenticates source and archive, verifies
    # checksum/image identity and stages checked metadata for the existing lifecycle.
    rec = cli.resolve_any(c, app_id)
    if rec.get('repo') != selected['repo'] or (rec.get('install') or {}).get('commit') != selected['commit']:
        raise ValueError('resolved_release_mismatch')
    result = rt.req('PATCH', f'/app-lifecycle/{urn}/update', {'performBackup': True}, timeout=120)
    status = rt.wait_status(urn, {'running', 'stopped'})
    if status != 'running':
        raise ValueError('update_not_running')
    cli.write_registry(c, rt)
    # This is only lifecycle completion; the separate activation adapter MUST verify
    # actual running image, exact registry pin and authenticated content before Open.
    print(json.dumps({'id': app_id, 'commit': selected['commit'], 'lifecycle_status': status,
                      'request': result, 'open_verified': False}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception:
        raise SystemExit('pinned_wam_lifecycle_failed: inspect owner-local WAM logs')
