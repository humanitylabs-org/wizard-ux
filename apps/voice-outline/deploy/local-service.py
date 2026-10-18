"""Credential-free foreground service. Config/data stay outside pinned source.

Usage: python3 local-service.py /absolute/private/config.json web|adapter
Own each process via a systemd SSH -tt service (PTY hangup kills the remote
foreground process). Do not source a production provider environment.
"""
import json
import os
from pathlib import Path
import sys

config = json.loads(Path(sys.argv[1]).read_text())
role = sys.argv[2]
root = Path(config['root']).resolve()
if not str(root).startswith('/Volumes/ThalesMedia/'):
    raise SystemExit('All runtime state must live on ThalesMedia')
env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
       'HOME': os.environ['HOME'], 'TMPDIR': str(root/'tmp')}
if role == 'web':
    env.update(PORT=str(config['web_port']), BIND='127.0.0.1',
               OUTLINE_DATA=str(root/config.get('data', 'data')),
               OUTLINE_PROVIDER=config.get('provider', 'wizard-shared'),
               OUTLINE_LOCAL_WS=f"ws://127.0.0.1:{config['adapter_port']}",
               OUTLINE_ADAPTER_SHA=config['adapter_sha'], SOURCE_SHA=config['source_sha'],
               WIZARD_CORE_DIR=config['core'],
               WIZARD_TRUSTED_HOSTS=','.join(config['hosts']),
               WIZARD_TRUSTED_ORIGINS=','.join(config['origins']))
    if env['OUTLINE_PROVIDER'] == 'wizard-shared':
        # Reuse the exact attested provider module and credential already installed
        # for Wizard voice. Never copy a key into source or choose another model.
        env['TINFOIL_PROVIDER_MODULE'] = config['shared_provider_module']
        for line in Path(config['shared_provider_env']).read_text().splitlines():
            if line.startswith('TINFOIL_API_KEY='):
                env['TINFOIL_API_KEY'] = line.split('=', 1)[1].strip().strip("\"'")
        if not env.get('TINFOIL_API_KEY'):
            raise SystemExit('Shared Wizard voice credential is unavailable')
    os.chdir(config['source'])
    os.execve(config['node'], [config['node'], 'server.mjs'], env)
elif role == 'adapter':
    if (root/'runtime/adapter-paused').exists():
        raise SystemExit('Adapter paused for isolated outage acceptance')
    env.update(OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='4', HF_HUB_OFFLINE='1')
    argv = [config['python'], config['adapter'], '--model', 'nemotron',
            '--model-dir', config['model_dir'], '--threads', '4',
            '--port', str(config['adapter_port']), '--receipt', str(root/'evidence/adapter-runtime.json')]
    os.execve(argv[0], argv, env)
else:
    raise SystemExit('Unknown service role')
