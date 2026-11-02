#!/usr/bin/env python3
"""Prepare/seal the narrowly reviewed product correction; parent-only queue admission.

Adopt successful control builds by exact source/receipt/APK hashes, never rebuild them.
Keep the fixed queue transport and all native assertions/cases byte-identical.
"""
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
import tarfile
import traceback

TEST = 'android/app/src/test/java/ai/wizards/os/everywhere/ClipRestoreTest.java'
SOURCE_DELTA = {TEST,
    'android/app/src/main/java/ai/wizards/os/everywhere/EverywhereOutbox.java',
    'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java',
    'android/app/src/androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java'}
EXTRA_CASES = {'slowPreflightAcceptedPasteKeepsShapedPayloadAndSingleCompletion',
    'reentrantDeliveryCannotStealAcceptedPasteOwnership',
    'throwingOwnerAfterDispatchDoesNotRewriteDelayedPaste',
    'throwingDuplicateCompletionCannotRecoverOrRepeatPaste'}
OLD_PRODUCT = '28d2027bcda85a36ecfe4d304f4ed5d06ea58543'
FIXED_QA = 'e6da4622bbee86d28e24595c86526c3df7050204'
FIXED_FILES = ('qa_queue_lease.py', 'qa_dictation_insertion_native.py', 'qa_dictation_packet.py',
               'test_qa_queue_lease.py', 'test_qa_dictation_insertion_native.py')
TASKS = [':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug', ':app:assembleDebugAndroidTest']


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    with Path(path).open('x') as stream:
        stream.write(json.dumps(value, sort_keys=True, indent=2) + '\n')
    Path(path).chmod(0o600)


def manifest_hash(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def archive_files(archive):
    result = {}
    with tarfile.open(archive) as source:
        for member in source:
            path = Path(member.name)
            if path.is_absolute() or '..' in path.parts: raise ValueError('unsafe archive path')
            if member.isdir(): continue
            if not member.isfile() or member.name in result: raise ValueError('nonregular/duplicate archive member')
            stream = source.extractfile(member)
            if stream is None: raise ValueError('missing regular archive member')
            h = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
            result[member.name] = {'sha256': h.hexdigest(), 'mode': member.mode}
    return result


def reviewed_delta(before, after):
    if set(before) != set(after): raise ValueError('source inventory changed')
    delta = {name for name in before if before[name] != after[name]}
    if delta != SOURCE_DELTA: raise ValueError('not the exact reviewed correction: ' + repr(delta))
    if any(before[name]['mode'] != after[name]['mode'] for name in delta): raise ValueError('source mode changed')


def check_proof(proof, files):
    if proof['old_revision'] != OLD_PRODUCT or proof['commit_chain'][0] != OLD_PRODUCT or proof['commit_chain'][-1] != proof['new_revision']:
        raise ValueError('Git ancestry differs from reviewed product')
    if not re.fullmatch('[a-f0-9]{40}', proof['new_revision']): raise ValueError('full product revision required')
    if set(proof['changed_paths']) != SOURCE_DELTA or set(proof['changed_file_sha256']) != SOURCE_DELTA:
        raise ValueError('Git reviewed correction paths differ')
    if any(files[name]['sha256'] != value for name,value in proof['changed_file_sha256'].items()):
        raise ValueError('prepared archive not the exact pushed Git source')
    if set(proof['unchanged_trees']) != {'android/app/src/main/assets', 'web'} or any(a != b for a,b in proof['unchanged_trees'].values()):
        raise ValueError('assets or web source drift')
    if proof['old_unit_tests'] != 406 or proof['old_clip_tests'] != 4 or proof['new_clip_tests'] != 8:
        raise ValueError('test census proof differs')


def verify(root):
    root = Path(root).resolve(); seal = read(root/'seal.json')
    base = Path(seal['worker_base']).resolve()
    if not root.is_relative_to(base/'qa'): raise ValueError('packet outside worker QA root')
    for name, expected in seal['files'].items():
        path = Path(name)
        if not path.is_absolute() or not path.resolve().is_relative_to(base): raise ValueError('sealed path escaped worker root')
        if digest(path) != expected: raise ValueError('sealed input drift: ' + name)
    custody = read(root/'custody.json'); packet = read(root/'packet.json')
    old_root = Path(custody['old_root']); old = read(old_root/'packet.json')
    old_seal = read(old_root/'seal.json')
    if old_seal['qa_revision'] != FIXED_QA or old['source_revision'] != OLD_PRODUCT:
        raise ValueError('wrong source/lease repair baseline')
    mandatory = set(old_seal['files']) | set(custody['preserved_originals'])
    mandatory.update(str(root/name) for name in (*FIXED_FILES, 'qa_dictation_candidate_resume.py', 'test_qa_dictation_candidate_resume.py',
                                               'source-proof.json', 'packet.json', 'custody.json'))
    mandatory.update(str(root/'jobs/candidate'/name) for name in ('job.json','source.tar.gz','worker.py'))
    if not mandatory.issubset(seal['files']): raise ValueError('incomplete sealed closure')
    for name, expected in old_seal['files'].items():
        if seal['files'][name] != expected: raise ValueError('historical seal was relabelled')
    for name, expected in custody['preserved_originals'].items():
        if seal['files'][name] != expected: raise ValueError('historical evidence binding differs')
    for name in FIXED_FILES:
        if digest(root/name) != digest(old_root/name): raise ValueError('fixed transport/native cases changed')
    proof = read(root/'source-proof.json')
    new_cfg = read(root/'jobs/candidate/job.json')
    check_proof(proof, new_cfg['files'])
    if packet['source_revision'] != proof['new_revision'] or seal['source_revision'] != proof['new_revision']:
        raise ValueError('candidate revision mismatch')
    for key in ('control_overlay','emulator_port','handset_proven'):
        if packet[key] != old[key]: raise ValueError('native gate changed: ' + key)
    if set(packet['candidate_cases']) != set(old['candidate_cases']) | EXTRA_CASES or len(packet['candidate_cases']) != 27:
        raise ValueError('native case census differs')
    old_cfg = read(old_root/'jobs/candidate/job.json')
    reviewed_delta(old_cfg['files'], new_cfg['files'])
    expected_cfg = copy.deepcopy(old_cfg)
    expected_cfg.update(files=new_cfg['files'], revision=proof['new_revision'], manifest_sha256=manifest_hash(new_cfg['files']))
    if new_cfg != expected_cfg or new_cfg['tasks'] != TASKS or new_cfg.get('owner_config') or new_cfg.get('signing_env') or new_cfg.get('expected_signer'):
        raise ValueError('candidate configuration changed beyond test source identity')
    candidate = root/'jobs/candidate'
    if digest(candidate/'worker.py') != digest(old_root/'jobs/candidate/worker.py'):
        raise ValueError('build worker changed')
    if archive_files(candidate/'source.tar.gz') != new_cfg['files']:
        raise ValueError('candidate archive not exact manifest')
    if archive_files(old_root/'jobs/candidate/source.tar.gz') != old_cfg['files']:
        raise ValueError('old source archive drift')
    expected_worker = {'argv':['/usr/bin/python3',str(candidate/'worker.py'),'--worker',str(candidate/'job.json')],
                       'cwd':str(candidate),'config':str(candidate/'job.json')}
    if packet['workers'] != {'candidate': expected_worker}: raise ValueError('control builds must not be scheduled')
    if packet['candidate'] != {'receipt':str(candidate/'receipt.json'), 'revision':proof['new_revision'],
                               'manifest_sha256':new_cfg['manifest_sha256']}:
        raise ValueError('candidate identity differs')
    # Immutable receipts plus both APKs are mandatory, not just cached status strings.
    for lane in ('baseline','rejected'):
        if packet[lane] != old[lane]: raise ValueError('adopted control identity differs')
        cfg = read(old_root/'jobs'/lane/'job.json')
        receipt_path = Path(old[lane]['receipt']); receipt = read(receipt_path)
        if str(receipt_path) not in seal['files'] or receipt.get('status') != 'ok' or receipt.get('host') != 'forum':
            raise ValueError('missing successful control receipt')
        if receipt['source_revision'] != old[lane]['revision'] or receipt['source_manifest_sha256'] != old[lane]['manifest_sha256']:
            raise ValueError('control source identity differs')
        if manifest_hash(cfg['files']) != old[lane]['manifest_sha256'] or archive_files(old_root/'jobs'/lane/'source.tar.gz') != cfg['files']:
            raise ValueError('control source archive differs')
        if receipt['tasks'] != [':app:assembleDebug',':app:assembleDebugAndroidTest'] or receipt['tasks'] != cfg['tasks']:
            raise ValueError('control task mismatch')
        if len(receipt['artifacts']) != 2: raise ValueError('control artifact census differs')
        packages = set()
        for artifact in receipt['artifacts']:
            path = Path(receipt['job'])/'source'/artifact['path']
            if not path.resolve().is_relative_to(Path(receipt['job'])/'source') or str(path) not in seal['files']:
                raise ValueError('unbound control artifact')
            if digest(path) != artifact['sha256'] or path.stat().st_size != artifact['bytes']:
                raise ValueError('control APK drift')
            packages.add(artifact['aapt2']['package'])
        if packages != {'ai.wizards.os.qa','ai.wizards.os.qa.test'}: raise ValueError('wrong control packages')
    return packet


def prepare(root, old_root, proof_path, prepared_job, revision, worker_base):
    root=root.resolve(); old_root=old_root.resolve(); base=worker_base.resolve()
    if os.uname().nodename != 'forum' or root.exists() or not root.is_relative_to(base/'qa') or not old_root.is_relative_to(base/'qa'):
        raise ValueError('fresh forum QA sibling required')
    if not re.fullmatch('[a-f0-9]{40}', revision): raise ValueError('full QA revision required')
    if shutil.disk_usage(base).free < 240*1024**3: raise ValueError('200 GiB reserve plus 40 GiB pending allocation required')
    if not prepared_job.resolve().is_relative_to(base/'jobs') or (prepared_job/'receipt.json').exists() or (prepared_job/'source').exists():
        raise ValueError('fresh unexecuted prepared candidate job required')
    cfg=read(prepared_job/'job.json')
    proof=read(proof_path); check_proof(proof,cfg['files'])
    old=read(old_root/'packet.json'); old_seal=read(old_root/'seal.json')
    if old_seal['qa_revision'] != FIXED_QA: raise ValueError('wrong lease coordinator revision')
    preserved=dict(old_seal['files'])
    for name, expected in preserved.items():
        if digest(name) != expected: raise ValueError('historical seal drift: ' + name)
    for path in old_root.iterdir():
        if path.is_file(): preserved[str(path)]=digest(path)
    # Preserve both historical successful builds and the concrete failed test evidence.
    for lane in ('baseline','rejected','candidate'):
        job=old_root/'jobs'/lane
        for path in job.iterdir():
            if path.is_file(): preserved[str(path)]=digest(path)
        for path in (job/'source/android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
            preserved[str(path)]=digest(path)
        if lane != 'candidate':
            for artifact in read(job/'receipt.json')['artifacts']:
                path=job/'source'/artifact['path']; preserved[str(path)]=digest(path)
    for name, expected in preserved.items():
        if digest(name) != expected: raise ValueError('historical input drift')
    os.umask(0o077); root.mkdir(mode=0o700); (root/'jobs/candidate').mkdir(parents=True); (root/'scratch').mkdir()
    for name in FIXED_FILES:
        shutil.copyfile(old_root/name,root/name)
    shutil.copyfile(Path(__file__),root/'qa_dictation_candidate_resume.py')
    shutil.copyfile(Path(__file__).with_name('test_qa_dictation_candidate_resume.py'),root/'test_qa_dictation_candidate_resume.py')
    shutil.copyfile(proof_path,root/'source-proof.json')
    candidate=root/'jobs/candidate'; old_job=old_root/'jobs/candidate'
    # Fresh complete canonical helper export, not a test overlay on superseded production.
    for name in ('job.json','source.tar.gz','worker.py'):
        shutil.copyfile(prepared_job/name,candidate/name)
        preserved[str(prepared_job/name)]=digest(prepared_job/name)
    packet=copy.deepcopy(old)
    packet['candidate_cases']=old['candidate_cases']+sorted(EXTRA_CASES)
    packet.update(source_revision=proof['new_revision'],workers={'candidate':{
        'argv':['/usr/bin/python3',str(candidate/'worker.py'),'--worker',str(candidate/'job.json')],
        'cwd':str(candidate),'config':str(candidate/'job.json')}})
    packet['candidate']={'receipt':str(candidate/'receipt.json'),'revision':proof['new_revision'],'manifest_sha256':cfg['manifest_sha256']}
    write(root/'packet.json',packet)
    write(root/'custody.json',{'old_root':str(old_root),'qa_revision':revision,'fixed_qa_revision':FIXED_QA,
          'reviewed_product_revision':OLD_PRODUCT,'source_revision':proof['new_revision'],
          'preserved_originals':preserved,'separate_release_untouched':True,
          'inherited_control_builds':['baseline','rejected'],'fresh_control_builds':[],
          'scope':'fresh exact pushed product; only P2 outbox correction, unit guard and four new real native regressions; unchanged prior 23/control assertions, assets and web',
          'prepared_candidate_job':str(prepared_job),
          'superseded_release_not_publishable':OLD_PRODUCT,
          'unit_expected_tests':406-4+8,'native_expected_candidate_cases':27,
          'native_expected_baseline_cases':2,'native_expected_rejected_assertion_failures':2,
          'native_acceptance_executed':False,'handset_proven':False})
    files=dict(preserved)
    for path in root.rglob('*'):
        if path.is_file(): files[str(path)]=digest(path)
    write(root/'seal.json',{'worker_base':str(base),'source_revision':proof['new_revision'],'qa_revision':revision,'files':files})
    verify(root)
    spec={'host':'forum','lane':'heavy','key':'dictation-candidate-resume-'+proof['new_revision']+'-'+revision,
          'cwd':str(root),'argv':['/usr/bin/env','PYTHONDONTWRITEBYTECODE=1','TMPDIR='+str(root/'scratch'),
          '/usr/bin/python3',str(root/'qa_dictation_candidate_resume.py'),'execute',str(root),'--seal-sha256',digest(root/'seal.json')],
          'timeout_seconds':9000}
    write(root/'parent-only-spec.json',spec)
    write(root/'preparation.json',{'status':'prepared_not_submitted','source_revision':proof['new_revision'],
          'qa_revision':revision,'seal_sha256':digest(root/'seal.json'),'spec_sha256':digest(root/'parent-only-spec.json'),
          'originals_preserved':True,'fresh_source_tree_absent':not (candidate/'source').exists(),
          'free_bytes':shutil.disk_usage(base).free,'reserve_bytes':200*1024**3,
          'controller_tests_executed':False,'candidate_build_executed':False,'native_acceptance_executed':False,'handset_proven':False})
    return spec


def execute(root):
    # Imports occur only after the queue-pinned seal is checked by main.
    from qa_queue_lease import validated_queue_fd, run_with_queue_lease
    from qa_dictation_insertion_native import unit_census
    root=root.resolve(); packet=verify(root); validated_queue_fd()
    if (root/'receipt.json').exists(): raise ValueError('packet is one-use')
    if shutil.disk_usage(root).free < 200*1024**3: raise ValueError('200 GiB reserve required')
    evidence={'status':'failed','source_revision':packet['source_revision'],'handset_proven':False,
              'adopted_control_builds':{},'fresh_control_builds':[]}
    try:
        for lane in ('baseline','rejected'):
            evidence['adopted_control_builds'][lane]={'receipt':packet[lane]['receipt'],'receipt_sha256':digest(packet[lane]['receipt'])}
        with (root/'controller-tests.log').open('w') as out:
            result=run_with_queue_lease([sys.executable,'-m','unittest','-v','test_qa_queue_lease','test_qa_dictation_insertion_native','test_qa_dictation_candidate_resume'],
                                       cwd=root,stdout=out,stderr=subprocess.STDOUT,timeout=120)
        if result.returncode: raise RuntimeError('lease/native protocol controller regressions failed')
        worker=packet['workers']['candidate']
        with (root/'candidate-build-controller.log').open('w') as out:
            result=run_with_queue_lease(worker['argv'],cwd=worker['cwd'],stdout=out,stderr=subprocess.STDOUT,timeout=3600)
        receipt=read(packet['candidate']['receipt'])
        evidence['candidate_build']={'exit_code':result.returncode,'receipt_sha256':digest(packet['candidate']['receipt'])}
        if result.returncode or receipt.get('status') != 'ok' or receipt['source_revision'] != packet['source_revision']:
            raise RuntimeError('candidate build failed')
        evidence['unit']=unit_census(Path(receipt['job'])/'source')
        if evidence['unit']['tests'] != read(root/'custody.json')['unit_expected_tests']:
            raise RuntimeError('full candidate unit census differs')
        # Recheck all sealed inputs/control APKs before the unchanged real native gate.
        verify(root)
        with (root/'native-controller.log').open('w') as out:
            result=run_with_queue_lease([sys.executable,str(root/'qa_dictation_insertion_native.py'),str(root/'packet.json'),str(root/'native')],
                                       cwd=root,stdout=out,stderr=subprocess.STDOUT,timeout=2400)
        evidence['native_exit_code']=result.returncode
        if result.returncode: raise RuntimeError('native gate failed')
        native=read(root/'native/receipt.json')
        if native.get('status') != 'ok' or not native.get('stopped_emulator'): raise RuntimeError('native result/cleanup refused')
        evidence['native_receipt_sha256']=digest(root/'native/receipt.json'); evidence['status']='ok'
    except BaseException:
        evidence['error']=traceback.format_exc(); raise
    finally:
        write(root/'receipt.json',evidence)
    return evidence


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest='mode',required=True)
    prep=sub.add_parser('prepare'); prep.add_argument('root',type=Path)
    for name in ('old-root','proof','prepared-job','worker-base'):
        prep.add_argument('--'+name,type=Path,required=True)
    prep.add_argument('--qa-revision',required=True)
    for mode in ('verify','execute'):
        command=sub.add_parser(mode); command.add_argument('root',type=Path); command.add_argument('--seal-sha256',required=True)
    args=parser.parse_args()
    if args.mode == 'prepare':
        result=prepare(args.root,args.old_root,args.proof,args.prepared_job,args.qa_revision,args.worker_base)
    else:
        if digest(args.root/'seal.json') != args.seal_sha256: raise ValueError('parent-pinned seal mismatch')
        result=verify(args.root) if args.mode == 'verify' else execute(args.root)
    print(json.dumps(result,sort_keys=True,indent=2))
