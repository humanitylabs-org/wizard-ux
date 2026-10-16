"""Install this monorepo's pinned private connection package via canonical WAM.

Run with the approved WAM on PYTHONPATH. No Docker access is taken here: stock
Runtipi owns image pull and container lifecycle. Source adaptation only selects
this monorepo's package directory, after verifying its pushed exact revision.
Owner routing/network overrides must be provisioned independently beforehand.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

from wam import cli, private

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--commit', required=True)
p.add_argument('--branch', required=True)
p.add_argument('--upstream', required=True)
p.add_argument('--listen-port', type=int, required=True)
a = p.parse_args()
if not 1024 <= a.listen_port <= 65535 or not a.upstream.startswith('http://127.0.0.1:'):
    raise SystemExit('Owner connection must use an unprivileged loopback endpoint')
repo = 'humanitylabs-org/wizard-ux'
remote = subprocess.check_output(['git', 'ls-remote', 'https://github.com/'+repo+'.git', 'refs/heads/'+a.branch], text=True).split()[0]
if remote != a.commit:
    raise SystemExit('Pushed branch must match the exact installation revision')
prefix = 'apps/voice-outline/deploy/wam-trial'
original_fetch = private.fetch
original_pull = private.pull

def fetch_selected(repo_arg, commit, dest, tok):
    if repo_arg != repo or commit != a.commit:
        raise ValueError('Unexpected source request')
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryFile() as f:
        subprocess.run(['git', '-C', str(a.source), 'archive', commit+':'+prefix], stdout=f, check=True)
        f.seek(0)
        with tarfile.open(fileobj=f) as archive:
            archive.extractall(dest, filter='data')

def runtime_pull(image, tok):
    if image != 'caddy:2.10.2-alpine':
        raise ValueError('Unexpected image: '+image)
    # The unchanged Runtipi install operation pulls this public stock image.
    # This only avoids a redundant CLI-side pull requiring direct Docker access.

try:
    private.fetch = fetch_selected
    private.pull = runtime_pull
    private.head_commit = lambda repo_arg, tok: a.commit
    c = cli.Config()
    record = private.prepare(c.runtipi_root, cli.STORE, repo)
    # Runtipi's supported user-config API owns root-owned override files.
    # Never broaden filesystem/Docker permissions just to create this override.
    rt = c.runtipi()
    urn = 'outline-streaming-demo:wizardapps'
    override = ('services:\n  outline-streaming-demo:\n    network_mode: host\n'
                '    ports: !reset []\n    networks: !reset []\n    command: ' +
                json.dumps(['/bin/sh', '-ec',
                            'cp /usr/bin/caddy /tmp/caddy; exec /tmp/caddy reverse-proxy '
                            f'--from http://127.0.0.1:{a.listen_port} --to "$OUTLINE_TRIAL_UPSTREAM"'])+'\n')
    rt.req('PUT', '/user-config/'+urn, {'dockerCompose': override, 'appEnv': ''})
    saved = rt.req('GET', '/user-config/'+urn)
    if saved['dockerCompose'].strip() != override.strip() or not saved['isEnabled']:
        raise RuntimeError('Owner override readback mismatch')
    original_resolve = cli.resolve_any
    cli.resolve_any = lambda c, ref: record if ref == 'outline-streaming-demo' else original_resolve(c, ref)
    result = cli.install(c, 'outline-streaming-demo', {'OUTLINE_TRIAL_UPSTREAM': a.upstream}, wait=False)
    if result.get('status') == 'already installed':
        result = {'id': 'outline-streaming-demo', 'operation': 'update',
                  'result': rt.req('PATCH', '/app-lifecycle/'+urn+'/update', {})}
    print(json.dumps(result, indent=2))
finally:
    private.fetch = original_fetch
    private.pull = original_pull
