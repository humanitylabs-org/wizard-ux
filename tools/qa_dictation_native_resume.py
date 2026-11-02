#!/usr/bin/env python3
"""Seal a native-only rerun using all SIX existing APKs unchanged. Parent submits, never this helper."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import traceback
import zipfile

PRODUCT = 'c07c16afbcf80ba4d5209a195680f442db9827c0'
MEMBERS = ('qa_dictation_native_resume.py','qa_dictation_insertion_native.py',
           'qa_dictation_case_evidence.py',
           'qa_dictation_case_isolation.py','test_qa_dictation_case_isolation.py',
           'test_qa_dictation_accessibility_lifecycle.py','qa_queue_lease.py','test_qa_queue_lease.py',
           'qa_dictation_packet.py','test_qa_dictation_insertion_native.py',
           'qa_dictation_candidate_resume.py','test_qa_dictation_candidate_resume.py')
TEST_MODULES = ('test_qa_queue_lease','test_qa_dictation_insertion_native',
                'test_qa_dictation_case_isolation',
                'test_qa_dictation_candidate_resume','test_qa_dictation_accessibility_lifecycle')


def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def read(path): return json.loads(Path(path).read_text())


def write(path,value):
    with Path(path).open('x') as stream: stream.write(json.dumps(value,sort_keys=True,indent=2)+'\n')
    Path(path).chmod(0o600)


def closure(root):
    """Historical sealed sources, all actual build artifacts and failure diagnostics, not AVD scratch."""
    old=read(root/'seal.json'); files=dict(old['files']); packet=read(root/'packet.json')
    for path in root.iterdir():
        if path.is_file(): files[str(path)]=digest(path)
    for path in (root/'native').rglob('*'):
        if path.is_file() and path.relative_to(root/'native').parts[0] not in ('avd','android-user'):
            files[str(path)]=digest(path)
    for lane in ('baseline','rejected','candidate'):
        receipt_path=Path(packet[lane]['receipt']); receipt=read(receipt_path)
        cfg_path=receipt_path.with_name('job.json'); cfg=read(cfg_path)
        if receipt.get('status') != 'ok' or receipt.get('host') != 'forum': raise ValueError('successful forum build required')
        if receipt['source_revision'] != packet[lane]['revision'] or receipt['source_manifest_sha256'] != packet[lane]['manifest_sha256']:
            raise ValueError('adopted source identity drift')
        if receipt['source_manifest_sha256'] != cfg['manifest_sha256']: raise ValueError('source configuration mismatch')
        for name in ('receipt.json','job.json','source.tar.gz','worker.py'):
            path=receipt_path.with_name(name); files[str(path)]=digest(path)
        if len(receipt['artifacts']) != 2: raise ValueError('two original APKs required')
        packages=set()
        for a in receipt['artifacts']:
            path=Path(receipt['job'])/'source'/a['path']
            if not path.resolve().is_relative_to(Path(receipt['job'])/'source'): raise ValueError('artifact escape')
            if digest(path) != a['sha256'] or path.stat().st_size != a['bytes']: raise ValueError('APK drift')
            packages.add(a['aapt2']['package']); files[str(path)]=a['sha256']
        if packages != {'ai.wizards.os.qa','ai.wizards.os.qa.test'}: raise ValueError('package census differs')
        # Source singletons and selected test class must be the real target/test fixture.
        selected='android/app/src/androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java'
        source=Path(receipt['job'])/'source'
        test=(source/selected).read_text()
        if 'getUiAutomation()' in test or test.count('getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)') != 1:
            raise ValueError('selected fixture automation flags differ')
        for name in (selected,'android/app/src/main/AndroidManifest.xml',
                     'android/app/src/debug/AndroidManifest.xml',
                     'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java',
                     'android/app/src/main/java/ai/wizards/os/everywhere/WizardKeyboardService.java'):
            path=source/name
            if digest(path) != cfg['files'][name]['sha256']: raise ValueError('built fixture/source drift')
            files[str(path)]=digest(path)
        if lane == 'candidate':
            for path in (source/'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
                files[str(path)]=digest(path)
            path=source/'android/app/build/reports/lint-results-debug.xml'; files[str(path)]=digest(path)
    for path,expected in files.items():
        if digest(path) != expected: raise ValueError('historical closure drift: '+path)
    return files


def verify(root):
    root=root.resolve(); seal=read(root/'seal.json'); base=Path(seal['worker_base']).resolve()
    if not root.is_relative_to(base/'qa'): raise ValueError('packet escaped QA root')
    for path,expected in seal['files'].items():
        file=Path(path)
        if not file.is_absolute() or not file.resolve().is_relative_to(base): raise ValueError('sealed input escaped worker root')
        if digest(file) != expected: raise ValueError('sealed input drift: '+path)
    custody=read(root/'custody.json'); old_root=Path(custody['old_root'])
    old=read(old_root/'packet.json'); packet=read(root/'packet.json')
    expected=copy.deepcopy(old); expected['workers']={}
    if packet != expected or packet['source_revision'] != PRODUCT or len(packet['candidate_cases']) != 27 or len(set(packet['candidate_cases'])) != 27:
        raise ValueError('native methods, controls, product or overlay changed')
    mandatory=set(read(old_root/'seal.json')['files']) | set(custody['preserved_originals'])
    mandatory.update(str(root/name) for name in (*MEMBERS,'packet.json','custody.json','diagnosis.json'))
    if not mandatory.issubset(seal['files']): raise ValueError('incomplete sealed closure')
    for path,expected_hash in custody['preserved_originals'].items():
        if seal['files'][path] != expected_hash: raise ValueError('original evidence relabelled')
    if custody['fresh_builds'] != [] or custody['product_revision'] != PRODUCT: raise ValueError('no rebuilds permitted')
    if custody['apk_count'] != 6: raise ValueError('six APK identities required')
    # Re-read metadata against every APK and source file, not merely a successful prior status.
    if closure(old_root) != custody['preserved_originals']: raise ValueError('historical closure inventory differs')
    return packet


def prepare(root,old_root,revision,diagnosis,base):
    root=root.resolve(); old_root=old_root.resolve(); base=base.resolve()
    if os.uname().nodename != 'forum' or root.exists() or not root.is_relative_to(base/'qa') or not old_root.is_relative_to(base/'qa'):
        raise ValueError('fresh forum QA sibling required')
    if not re.fullmatch('[a-f0-9]{40}',revision): raise ValueError('full pushed QA revision required')
    if shutil.disk_usage(base).free < 220*1024**3: raise ValueError('200 GiB reserve plus 20 GiB emulator headroom required')
    packet=read(old_root/'packet.json')
    if packet['source_revision'] != PRODUCT: raise ValueError('exact reviewed product required')
    native=read(old_root/'native/receipt.json')
    if not native.get('stopped_emulator') or native['status'] != 'failed': raise ValueError('original failed cleanup evidence required')
    originals=closure(old_root)
    os.umask(0o077); root.mkdir(mode=0o700); (root/'scratch').mkdir()
    for name in MEMBERS: shutil.copyfile(Path(__file__).with_name(name),root/name)
    shutil.copyfile(diagnosis,root/'diagnosis.json')
    packet['workers']={}; write(root/'packet.json',packet)
    write(root/'custody.json',{'old_root':str(old_root),'qa_revision':revision,'product_revision':PRODUCT,
        'preserved_originals':originals,'fresh_builds':[],'apk_count':6,'native_expected_counts':{'baseline':2,'rejected':2,'candidate':27},
        'rejected_requires_exact_insertion_assertions':True,'android_source_changes':[],
        'isolation':'one instrumentation, fresh target/editor/test processes and no stale fixture per method',
        'baseline_eligibility':'both original IC paths remain required; no node is NOT a source guard on baseline IC commit',
        'native_acceptance_executed':False,'signed_product_untouched':True,'handset_proven':False})
    files=dict(originals)
    for path in root.iterdir():
        if path.is_file(): files[str(path)]=digest(path)
    write(root/'seal.json',{'worker_base':str(base),'qa_revision':revision,'source_revision':PRODUCT,'files':files})
    verify(root)
    spec={'host':'forum','lane':'heavy','key':'dictation-native-isolation-'+PRODUCT+'-'+revision,
        'cwd':str(root),'argv':['/usr/bin/env','PYTHONDONTWRITEBYTECODE=1','TMPDIR='+str(root/'scratch'),
        '/usr/bin/python3',str(root/'qa_dictation_native_resume.py'),'execute',str(root),'--seal-sha256',digest(root/'seal.json')],
        'timeout_seconds':3600}
    write(root/'parent-only-spec.json',spec)
    write(root/'preparation.json',{'status':'prepared_not_submitted','source_revision':PRODUCT,'qa_revision':revision,
        'seal_sha256':digest(root/'seal.json'),'spec_sha256':digest(root/'parent-only-spec.json'),
        'fresh_builds':[],'native_acceptance_executed':False,'handset_proven':False})
    return spec


def execute(root):
    from qa_queue_lease import validated_queue_fd,run_with_queue_lease
    from qa_dictation_insertion_native import unit_census
    root=root.resolve(); packet=verify(root); validated_queue_fd()
    if (root/'receipt.json').exists(): raise ValueError('one-use packet already executed')
    evidence={'status':'failed','source_revision':PRODUCT,'fresh_builds':[],'handset_proven':False}
    try:
        with (root/'controller-tests.log').open('w') as out:
            result=run_with_queue_lease([sys.executable,'-m','unittest','-v',*TEST_MODULES],cwd=root,
                stdout=out,stderr=subprocess.STDOUT,timeout=120)
        if result.returncode: raise RuntimeError('controller regression failure')
        source=Path(read(packet['candidate']['receipt'])['job'])/'source'
        evidence['unit']=unit_census(source)
        if evidence['unit']['tests'] != 410: raise ValueError('candidate full unit census differs')
        verify(root)
        with (root/'native-controller.log').open('w') as out:
            result=run_with_queue_lease([sys.executable,str(root/'qa_dictation_insertion_native.py'),
                str(root/'packet.json'),str(root/'native')],cwd=root,stdout=out,stderr=subprocess.STDOUT,timeout=2700)
        evidence['native_exit_code']=result.returncode
        if (root/'native/receipt.json').is_file():
            native=read(root/'native/receipt.json'); evidence['native_receipt_sha256']=digest(root/'native/receipt.json')
            evidence['stopped_emulator']=native.get('stopped_emulator',False)
        else: native={}
        if result.returncode or native.get('status') != 'ok' or not native.get('stopped_emulator'):
            raise RuntimeError('native gate failed; inspect per-lane protocol and diagnostics')
        verify(root); evidence['status']='ok'
    except BaseException:
        evidence['error']=traceback.format_exc(); raise
    finally: write(root/'receipt.json',evidence)
    return evidence


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest='mode',required=True)
    prep=sub.add_parser('prepare'); prep.add_argument('root',type=Path)
    for name in ('old-root','diagnosis','worker-base'): prep.add_argument('--'+name,type=Path,required=True)
    prep.add_argument('--qa-revision',required=True)
    for mode in ('verify','execute'):
        p=sub.add_parser(mode); p.add_argument('root',type=Path); p.add_argument('--seal-sha256',required=True)
    args=parser.parse_args()
    if args.mode=='prepare': result=prepare(args.root,args.old_root,args.qa_revision,args.diagnosis,args.worker_base)
    else:
        if digest(args.root/'seal.json') != args.seal_sha256: raise ValueError('parent-pinned seal mismatch')
        result=verify(args.root) if args.mode=='verify' else execute(args.root)
    print(json.dumps(result,sort_keys=True,indent=2))
