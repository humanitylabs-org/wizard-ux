#!/usr/bin/env python3
"""Prepare (never submit) final native acceptance and separate owner-configured release jobs."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess

import qa_dictation_empty_hint_acceptance as qa
from qa_orb_phone_packet import signing_paths

ROOT=Path(__file__).resolve().parents[1]
OS_SIGNER='3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'


def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def prepare(output, review, review_prompt, reviewed_revision, owner_config=None, signing_env=None):
    owner_config, signing_env = signing_paths(owner_config, signing_env)
    if git('status','--porcelain'):raise RuntimeError('commit and push before freezing')
    revision=git('rev-parse','HEAD')
    if git('ls-remote','origin','refs/heads/'+git('branch','--show-current')).split()[0]!=revision:
        raise RuntimeError('candidate must be exact pushed head')
    if set(git('diff','--name-only',qa.OLD,revision,'--','android/app/src').splitlines())!=qa.ANDROID_DELTA:
        raise ValueError('not exact reviewed Android delta')
    files={}
    for name in qa.ANDROID_DELTA:
        now=subprocess.check_output(['git','show',revision+':'+name],cwd=ROOT)
        reviewed=subprocess.check_output(['git','show',reviewed_revision+':'+name],cwd=ROOT)
        if now!=reviewed:raise ValueError('unreviewed Android bytes: '+name)
        files[name]=hashlib.sha256(now).hexdigest()
    unit='android/app/src/test/java/ai/wizards/os/everywhere/DictationCommitTest.java'
    count=lambda rev:len(re.findall(rb'@Test\s+public\s+void',subprocess.check_output(['git','show',rev+':'+unit],cwd=ROOT)))
    proof={'old_revision':qa.OLD,'revision':revision,'reviewed_revision':reviewed_revision,
           'android_changed_paths':sorted(qa.ANDROID_DELTA),'android_sha256':files,
           'unit_expected_tests':410+count(revision)-count(qa.OLD),'dictation_unit_tests':count(revision)}
    qa.check_review(json.loads(review.read_text()),proof)
    output.mkdir(parents=True,exist_ok=False)
    qa.write(output/'source-proof.json',proof)
    subprocess.run(['android-build-forum','--prepare-only','--project',str(ROOT),'--gradle-dir','android',
                    '--output',str(output/'canonical-debug'),'--',*qa.TASKS],check=True)
    debug=json.loads((output/'canonical-debug/job.json').read_text());remote=debug['job']
    subprocess.run(['scp','-q',*[str(ROOT/'tools'/n) for n in qa.MEMBERS],f'forum:{remote}/'],check=True)
    for path,name in ((output/'source-proof.json','source-proof.json'),(review,'opus-review.json'),(review_prompt,'opus-review-prompt.md')):
        subprocess.run(['scp','-q',str(path),f'forum:{remote}/{name}'],check=True)
    command=shlex.join(['/usr/bin/env','PYTHONDONTWRITEBYTECODE=1','/usr/bin/python3',remote+'/qa_dictation_empty_hint_acceptance.py','prepare',remote])
    prepared=subprocess.run(['ssh','forum',command],text=True,capture_output=True,check=True)
    spec=json.loads(prepared.stdout)
    verify=shlex.join(['/usr/bin/env','PYTHONDONTWRITEBYTECODE=1','/usr/bin/python3',remote+'/qa_dictation_empty_hint_acceptance.py','verify',remote,
                      '--seal-sha256',spec['argv'][-1]])
    subprocess.run(['ssh','forum',verify],text=True,capture_output=True,check=True)
    readback=subprocess.check_output(['ssh','forum',shlex.join(['/usr/bin/python3','-c',
        'import json,sys;from pathlib import Path;print(json.dumps(json.loads(Path(sys.argv[1]).read_text())))',remote+'/parent-only-acceptance-spec.json'])],text=True)
    if json.loads(readback)!=spec:raise ValueError('native spec read-back differs')
    qa.write(output/'parent-only-acceptance-spec.json',spec)
    subprocess.run(['android-build-forum','--prepare-only','--project',str(ROOT),'--gradle-dir','android',
                    '--owner-config',owner_config,
                    '--signing-env',signing_env,'--expected-signer',OS_SIGNER,
                    '--output',str(output/'owner-release'),'--',':app:assembleRelease'],check=True)
    release=json.loads((output/'owner-release/job.json').read_text())
    if release['source_revision']!=revision:raise ValueError('release source revision differs')
    release_spec={'host':'forum','lane':'heavy','key':'dictation-empty-hint-owner-release-'+revision,
                  'cwd':release['cwd'],'argv':release['argv'],'timeout_seconds':3600}
    qa.write(output/'parent-only-release-spec.json',release_spec)
    # Metadata-only readback: never open the private owner properties/signing environment.
    program='import json,sys,hashlib;from pathlib import Path;p=Path(sys.argv[1]);c=json.loads((p/"job.json").read_text());print(json.dumps({"config":{k:v for k,v in c.items() if k!="files"},"inputs":{n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ("job.json","worker.py","source.tar.gz")},"unexecuted":not (p/"receipt.json").exists() and not (p/"source").exists()}))'
    remote_release=json.loads(subprocess.check_output(['ssh','forum',shlex.join(['/usr/bin/python3','-c',program,release['job']])],text=True))
    config=remote_release['config']
    if (not remote_release['unexecuted'] or config['revision']!=revision or config['tasks']!=[':app:assembleRelease']
            or config['owner_config']!=owner_config
            or config['signing_env']!=signing_env
            or config['expected_signer']!=OS_SIGNER or config['manifest_sha256']!=debug['source_manifest_sha256']):
        raise ValueError('exact owner-configured OS-signer release metadata differs')
    qa.write(output/'release-inputs-readback.json',remote_release)
    qa.write(output/'parent-only-jobs.json',{'source_revision':revision,'native_acceptance':spec,
        'owner_release':release_spec,'owner_release_preparation':release,'submitted':False,'published':False,'phone_installed':False,
        'release_requires_native_acceptance_before_any_publication':True})
    print(json.dumps(json.loads((output/'parent-only-jobs.json').read_text()),indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--review',type=Path,required=True);p.add_argument('--review-prompt',type=Path,required=True)
    p.add_argument('--reviewed-revision',required=True)
    p.add_argument('--owner-config',help='absolute owner properties path on the worker; or WIZARD_OWNER_CONFIG')
    p.add_argument('--signing-env',help='absolute signing environment path on the worker; or WIZARD_OS_SIGNING_ENV')
    a=p.parse_args()
    prepare(a.output.resolve(),a.review.resolve(),a.review_prompt.resolve(),a.reviewed_revision,
            a.owner_config,a.signing_env)
