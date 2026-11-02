#!/usr/bin/env python3
"""Freeze a diagnostic-only forum packet, without submitting, compiling or starting an emulator."""
import argparse
import json
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PRIOR = '/srv/work/AndroidBuilds/qa/graphene-orb-c07c16af-native-isolated-772c1424'
CLOSURE = ('qa_dictation_empty_hint_diagnostic.py','qa_dictation_insertion_native.py',
           'qa_dictation_case_isolation.py','qa_queue_lease.py')
REMOTE_PREPARE = r'''
import hashlib, json, sys, shutil
from pathlib import Path
root=Path(sys.argv[1]).resolve(); prior=Path(sys.argv[2]).resolve()
sys.path.insert(0,str(root))
import qa_dictation_empty_hint_diagnostic as d
if root.parent != Path('/srv/work/AndroidBuilds/jobs'): raise ValueError('unexpected worker root')
if (root/'receipt.json').exists() or (root/'empty-hint-seal.json').exists(): raise ValueError('one-use packet already executed/sealed')
config=json.loads((root/'job.json').read_text())
packet=json.loads((prior/'packet.json').read_text())
old_receipt_path=Path(packet['candidate']['receipt'])
old_receipt=json.loads(old_receipt_path.read_text())
old_config=json.loads((Path(old_receipt['job'])/'job.json').read_text())
if config['tasks']!=d.TASKS or config['host']!='forum' or config['owner_config'] or config['signing_env']:
    raise AssertionError('diagnostic must be canonical debug with exact tasks')
if packet['source_revision']!=d.PRODUCT or old_config['revision']!=d.PRODUCT:
    raise AssertionError('wrong original product')
production={k:v['sha256'] for k,v in config['files'].items() if k.startswith('android/app/src/main/')}
oldproduction={k:v['sha256'] for k,v in old_config['files'].items() if k.startswith('android/app/src/main/')}
if not production or production!=oldproduction: raise AssertionError('production source drift')
native=prior/'native'; receipt_path=native/'receipt.json'; prior_receipt=json.loads(receipt_path.read_text())
if prior_receipt['status']!='failed' or prior_receipt['stopped_emulator'] is not True:
    raise AssertionError('original failure/cleanup changed')
for lane,total in [('baseline',2),('rejected',2),('candidate',27)]:
    if len(prior_receipt['cases'][lane]['records'])!=total: raise AssertionError('original lane census')
prior_files={str(receipt_path):d.sha(receipt_path),str(old_receipt_path):d.sha(old_receipt_path),
             str(prior/'packet.json'):d.sha(prior/'packet.json')}
for name,expected in prior_receipt['files'].items():
    p=(native/name).resolve()
    if not p.is_relative_to(native.resolve()) or d.sha(p)!=expected: raise AssertionError('original evidence changed: '+name)
    prior_files[str(p)]=expected
names=['worker.py','job.json','source.tar.gz',*sys.argv[3:]]
free=shutil.disk_usage('/srv/work').free
if free < 200*1024**3:raise RuntimeError('200GiB reserve required')
seal={'diagnostic_only':True,'product_acceptance':False,'qa_revision':config['revision'],
      'product_revision':d.PRODUCT,'isolation_revision':d.ISOLATION,'methods':list(d.METHODS),
      'production_files':production,'prior_evidence':prior_files,'free_bytes_at_prepare':free,
      'files':{n:d.sha(root/n) for n in names}}
(root/'empty-hint-seal.json').write_text(json.dumps(seal,indent=2)+'\n')
spec={'host':'forum','cwd':str(root),'argv':['/usr/bin/python3',str(root/'qa_dictation_empty_hint_diagnostic.py'),str(root)],
      'timeout_seconds':2700,'label':'Empty hint · unchanged product diagnostic','diagnostic_only':True,
      'product_revision':d.PRODUCT,'qa_revision':config['revision'],'seal_sha256':d.sha(root/'empty-hint-seal.json')}
(root/'empty-hint-parent-only-spec.json').write_text(json.dumps(spec,indent=2)+'\n')
# A separate read-back verifies exactly what the parent will execute. Does not run it.
print(json.dumps({'spec':spec,'sealed_prior_files':len(prior_files),'production_files':len(production)},indent=2))
'''


def prepare(output):
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip():
        raise RuntimeError('commit and push the diagnostic branch before freezing')
    subprocess.run(['git','diff','--exit-code','c07c16afbcf80ba4d5209a195680f442db9827c0','--',
                    'android/app/src/main','android/app/src/test'],cwd=ROOT,check=True)
    subprocess.run(['android-build-forum','--prepare-only','--project',str(ROOT),'--gradle-dir','android',
                    '--output',str(output),'--',':app:testDebugUnitTest',':app:lintDebug',
                    ':app:assembleDebug',':app:assembleDebugAndroidTest'],check=True)
    job=json.loads((output/'job.json').read_text());remote=job['job']
    subprocess.run(['scp','-q',*[str(ROOT/'tools'/n) for n in CLOSURE],f'forum:{remote}/'],check=True)
    cmd=shlex.join(['/usr/bin/python3','-',remote,PRIOR,*CLOSURE])
    staged=subprocess.run(['ssh','forum',cmd],input=REMOTE_PREPARE,text=True,capture_output=True,check=True)
    result=json.loads(staged.stdout)
    (output/'diagnostic-preparation.json').write_text(json.dumps(result,indent=2)+'\n')
    check='import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);import qa_dictation_empty_hint_diagnostic as d; p=Path(sys.argv[1]);s=d.validate_seal(p);spec=json.loads((p/"empty-hint-parent-only-spec.json").read_text());assert d.sha(p/"empty-hint-seal.json")==spec["seal_sha256"];print(json.dumps(spec,indent=2))'
    readback=subprocess.run(['ssh','forum',shlex.join(['/usr/bin/python3','-c',check,remote])],
                            text=True,capture_output=True,check=True)
    spec=json.loads(readback.stdout)
    if spec!=result['spec']: raise AssertionError('parent spec read-back differs')
    (output/'parent-only-spec.json').write_text(json.dumps(spec,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    prepare(p.parse_args().output.resolve())
