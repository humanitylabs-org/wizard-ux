#!/usr/bin/env python3
"""Sealed coordinator for the parent-owned forum queue; no build/emulator at preparation time."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback
from qa_queue_lease import validated_queue_fd, run_with_queue_lease


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(root):
    root = Path(root).resolve()
    seal = json.loads((root/'seal.json').read_text())
    for name, expected in seal['files'].items():
        path = Path(name)
        if not path.is_absolute() or not path.resolve().is_relative_to('/srv/work/AndroidBuilds'):
            raise ValueError('sealed path outside worker root')
        if digest(path) != expected: raise ValueError('seal mismatch: '+name)
    config = json.loads((root/'packet.json').read_text())
    if config['source_revision'] != seal['source_revision']: raise ValueError('source revision mismatch')
    if set(config['workers']) != {'candidate','baseline','rejected'}: raise ValueError('missing control build')
    for name, worker in config['workers'].items():
        cfg=json.loads(Path(worker['config']).read_text())
        if cfg['host'] != 'forum' or cfg.get('signing_env') or cfg.get('expected_signer'):
            raise ValueError('debug/control build must have no signing environment or release certificate pin')
        expected_tasks=[':app:assembleDebug',':app:assembleDebugAndroidTest']
        if name == 'candidate': expected_tasks=[':app:testDebugUnitTest',':app:lintDebug']+expected_tasks
        if cfg['tasks'] != expected_tasks or cfg['revision'] != config[name]['revision']:
            raise ValueError('worker task/revision differs: '+name)
    custody = json.loads((root/'custody.json').read_text())
    mandatory = {str(root/name) for name in ('packet.json','custody.json')}
    mandatory.update(str(root/name) for name in custody['qa_files'])
    mandatory.update(custody['preserved_originals'])
    mandatory.update(str(root/'jobs'/lane/member) for lane in config['workers'] for member in ('job.json','source.tar.gz','worker.py'))
    if not mandatory.issubset(seal['files']): raise ValueError('incomplete sealed closure')
    for name, expected in custody['preserved_originals'].items():
        if seal['files'][name] != expected: raise ValueError('preservation binding differs')
    for name, expected in custody['qa_files'].items():
        if seal['files'][str(root/name)] != expected: raise ValueError('QA source binding differs')
    original = json.loads(Path(custody['original_packet']).read_text())
    if config['source_revision'] != custody['product_revision'] or original['source_revision'] != config['source_revision']:
        raise ValueError('immutable product revision differs')
    for key in ('candidate_cases','control_overlay','emulator_port','handset_proven'):
        if config[key] != original[key]: raise ValueError('original control differs: '+key)
    for lane, worker in config['workers'].items():
        old_worker = original['workers'][lane]
        cfg = json.loads(Path(worker['config']).read_text())
        if cfg.get('owner_config') or cfg != json.loads(Path(old_worker['config']).read_text()):
            raise ValueError('original worker configuration differs: '+lane)
        manifest = hashlib.sha256(json.dumps(cfg['files'],sort_keys=True).encode()).hexdigest()
        if manifest != original[lane]['manifest_sha256'] or manifest != config[lane]['manifest_sha256']:
            raise ValueError('source manifest differs: '+lane)
        if {k:v for k,v in config[lane].items() if k != 'receipt'} != {k:v for k,v in original[lane].items() if k != 'receipt'}:
            raise ValueError('original source identity differs: '+lane)
        job = Path(worker['config']).parent
        if job != root/'jobs'/lane or worker['cwd'] != str(job) or worker['argv'] != ['/usr/bin/python3',str(job/'worker.py'),'--worker',str(job/'job.json')]:
            raise ValueError('unexpected nested worker path: '+lane)
        if config[lane]['receipt'] != str(job/'receipt.json'):
            raise ValueError('receipt must stay in fresh sibling: '+lane)
        for member in ('job.json','source.tar.gz','worker.py'):
            if digest(job/member) != digest(Path(old_worker['cwd'])/member):
                raise ValueError('original worker bytes differ: '+lane+'/'+member)
        for path, expected in original['control_overlay'].items():
            if cfg['files'][path]['sha256'] != expected:
                raise ValueError('fixture overlay differs: '+lane+'/'+path)
    return config


def execute(root):
    root=Path(root).resolve(); config=verify(root)
    validated_queue_fd()
    if (root/'receipt.json').exists(): raise RuntimeError('packet is one-use')
    if shutil.disk_usage(root).free < 200*1024**3: raise RuntimeError('200 GiB reserve required')
    evidence={'status':'failed','source_revision':config['source_revision'],'stages':{},'handset_proven':False}
    try:
        for name in ('baseline','rejected','candidate'):
            worker=config['workers'][name]
            log=root/(name+'-build-controller.log')
            with log.open('w') as out:
                completed=run_with_queue_lease(worker['argv'],cwd=worker['cwd'],stdout=out,stderr=subprocess.STDOUT,timeout=1800)
            receipt=json.loads(Path(config[name]['receipt']).read_text())
            evidence['stages'][name]={'exit_code':completed.returncode,'receipt':config[name]['receipt'],'receipt_sha256':digest(config[name]['receipt'])}
            if completed.returncode or receipt.get('status') != 'ok': raise RuntimeError(name+' worker failed')
        runner=root/'qa_dictation_insertion_native.py'
        with (root/'native-controller.log').open('w') as out:
            completed=run_with_queue_lease([sys.executable,str(runner),str(root/'packet.json'),str(root/'native')],
                                     cwd=root,stdout=out,stderr=subprocess.STDOUT,timeout=2400)
        evidence['native_exit_code']=completed.returncode
        if completed.returncode: raise RuntimeError('native gate failed')
        native=json.loads((root/'native/receipt.json').read_text())
        if native.get('status') != 'ok' or not native.get('stopped_emulator'): raise RuntimeError('native receipt not accepted')
        evidence['native_receipt_sha256']=digest(root/'native/receipt.json');evidence['status']='ok'
    except BaseException:
        evidence['error']=traceback.format_exc();raise
    finally:
        (root/'receipt.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--verify-only',action='store_true')
    p.add_argument('--seal-sha256',required=True)
    a=p.parse_args()
    if digest(a.root/'seal.json') != a.seal_sha256: raise ValueError('queue-pinned seal mismatch')
    print(json.dumps(verify(a.root) if a.verify_only else execute(a.root),indent=2))
