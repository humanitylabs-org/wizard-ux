#!/usr/bin/env python3
"""Seal full empty-hint acceptance for parent-only forum admission. No build during prepare.

REUSE: canonical Android worker, queue lease, real-service native runner and per-case isolation.
EXTEND: exact product/source proof, preserved old failures and unchanged baseline/rejected APKs.
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
import tempfile
import traceback

from qa_dictation_candidate_resume import archive_files, manifest_hash
from qa_dictation_native_resume import closure

BASE = Path('/srv/work/AndroidBuilds')
PRIOR = BASE/'qa/graphene-orb-c07c16af-native-isolated-772c1424'
DIAGNOSTIC = BASE/'jobs/20261102T050208Z-60220c6f'
DIAGNOSTIC_SHA = '78f90cdafb8403bdef2a907cc16874a12b5dfa3590993ed910189e64651be3df'
PREBUILD_FAILURE = BASE/'jobs/20261102T052250Z-b6c11dfe'
PREBUILD_LOG_SHA = 'bb3e34b8c226511c94c7d706bd6c3de0dc4fad167858559b14de370c2d95579a'
FAILED_QUEUE_LOG = Path('/srv/work/heavy/production/spool/heavy_162a9ed1bf3742e7b75153a1cf498d5b.log')
FAILED_QUEUE_LOG_SHA = 'f095c09ec52032c4bf3bff291d16cd7921ae0d52de4b05620019e1aefde61baf'
OLD = 'bc9e87effda72220cfca9c8ee306639f1677217a'
TASKS = [':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug', ':app:assembleDebugAndroidTest']
EXTRA = {'emptyHintNoopPasteRetainsTakeWithoutSecondWrite',
         'emptyHintFocusBeforeDispatchStillWritesNothing',
         'emptyHintFocusChangeAfterPasteCannotVerifyOtherField',
         'emptyHintLatePasteRetainsTakeWithoutSecondWrite',
         'emptyWithoutHintUnknownSelectionUsesOnlyKnownInputConnection'}
JAVA = 'android/app/src/main/java/ai/wizards/os/everywhere/'
TEST = 'android/app/src/androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java'
PRODUCT_DELTA = {JAVA+'DictationCommit.java', JAVA+'WizardKeyboardService.java'}
ANDROID_DELTA = PRODUCT_DELTA | {TEST,
    'android/app/src/test/java/ai/wizards/os/everywhere/DictationCommitTest.java',
    'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java'}
MEMBERS = ('qa_dictation_empty_hint_acceptance.py','qa_dictation_insertion_native.py',
           'qa_dictation_case_isolation.py','qa_dictation_case_evidence.py','qa_queue_lease.py',
           'qa_dictation_candidate_resume.py','qa_dictation_native_resume.py','qa_dictation_packet.py',
           'test_qa_dictation_empty_hint_acceptance.py','test_qa_queue_lease.py',
           'test_qa_dictation_insertion_native.py','test_qa_dictation_case_isolation.py',
           'test_qa_dictation_accessibility_lifecycle.py','test_qa_dictation_candidate_resume.py')
TEST_MODULES = ('test_qa_dictation_empty_hint_acceptance','test_qa_queue_lease',
                'test_qa_dictation_insertion_native','test_qa_dictation_case_isolation',
                'test_qa_dictation_accessibility_lifecycle','test_qa_dictation_candidate_resume')


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def read(path): return json.loads(Path(path).read_text())


def write(path,value):
    with Path(path).open('x') as f: f.write(json.dumps(value,sort_keys=True,indent=2)+'\n')
    Path(path).chmod(0o600)


def check_cases(old, new):
    if len(old)!=27 or len(set(old))!=27 or set(new)!=set(old)|EXTRA or len(new)!=32:
        raise ValueError('original 27 plus five cases required without duplicates')


def check_contract_inputs(root, packet):
    """Both source contracts exist before build; the future receipt must not be read."""
    from qa_dictation_case_isolation import historical_source, editor_contract
    historical = read(root/'historical-packet.json')
    old_source = historical_source(root/'historical-packet.json')
    old_contract = editor_contract(old_source, historical['candidate_cases'])
    check_cases(list(old_contract), packet['candidate_cases'])
    # Read the real candidate fixture bytes from the sealed canonical archive,
    # without creating source/ or a receipt or substituting historical APKs.
    fixture = 'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java'
    with tempfile.TemporaryDirectory(prefix='current-contract-', dir=root/'scratch') as td:
        source = Path(td)
        with tarfile.open(root/'source.tar.gz') as archive:
            for rel in (TEST, fixture):
                target = source/rel; target.parent.mkdir(parents=True, exist_ok=True)
                member = archive.extractfile(rel)
                if member is None: raise ValueError('candidate contract member missing')
                target.write_bytes(member.read())
        methods = re.findall(r'@Test public void (\w+)\(', (source/TEST).read_text())
        if len(methods) != 32 or set(methods) != set(packet['candidate_cases']):
            raise ValueError('current archive method census differs')
        current_contract = editor_contract(source, packet['candidate_cases'])
    if {m:current_contract[m] for m in old_contract} != old_contract:
        raise ValueError('original editor contracts changed')
    return {'historical_cases':len(old_contract), 'current_cases':len(current_contract),
            'future_build_receipt_required':False}


def failed_prebuild_closure():
    """Preserve the real controller failure; never mint its unbuilt Android receipt."""
    log = PREBUILD_FAILURE/'controller-tests.log'
    if sha(FAILED_QUEUE_LOG) != FAILED_QUEUE_LOG_SHA: raise ValueError('original queue failure log drift')
    if sha(log) != PREBUILD_LOG_SHA: raise ValueError('original pre-build failure log drift')
    failure = read(PREBUILD_FAILURE/'acceptance-receipt.json')
    if failure['status'] != 'failed' or failure['stages'] != {'controller_tests':1}:
        raise ValueError('original pre-build failure classification differs')
    if any((PREBUILD_FAILURE/n).exists() for n in ('receipt.json','source','native')):
        raise ValueError('original unbuilt failure unexpectedly mutated')
    files = dict(read(PREBUILD_FAILURE/'acceptance-seal.json')['files'])
    for name in ('controller-tests.log','acceptance-receipt.json','acceptance-seal.json',
                 'parent-only-acceptance-spec.json','acceptance-preparation.json'):
        p = PREBUILD_FAILURE/name; files[str(p)] = sha(p)
    for p, expected in files.items():
        if sha(p) != expected: raise ValueError('original pre-build closure drift')
    return files


def diagnostic_closure():
    receipt=DIAGNOSTIC/'empty-hint-native/receipt.json'
    if sha(receipt)!=DIAGNOSTIC_SHA: raise ValueError('diagnostic receipt changed')
    d=read(receipt)
    if d['status']!='diagnostic-captured' or not d['stopped_emulator'] or d['product_acceptance']:
        raise ValueError('old diagnostic cleanup/status differs')
    for method in ('substringDoesNotVerifyInsertion','hintIsNotExistingTextAndSentenceCapitalizationSurvives'):
        case=d['cases'][method]; obs=case['observation']; pre=obs['preflight']
        if case['native_result']['records'][0]['code']!=-2 or obs['actual_write']!='commit' or obs['wizard_clip_seen']:
            raise ValueError('old regression evidence differs')
        if not (pre['nodeEditable'] and pre['nodeFocused'] and pre['nodeShowingHint']
                and pre['nodeStart']==pre['nodeEnd']==-1 and pre['snapshot']['valid'] is False):
            raise ValueError('empty-hint mechanism evidence differs')
    control=d['cases']['noopInputConnectionWorkingPastePreservesSingleInsertion']
    if control['native_result']['status']!='ok' or control['observation']['actual_write']!='paste':
        raise ValueError('nonempty diagnostic control differs')
    result={str(receipt):sha(receipt)}
    for name,expected in d['files'].items():
        p=(receipt.parent/name).resolve()
        if not p.is_relative_to(receipt.parent) or sha(p)!=expected: raise ValueError('old raw evidence drift')
        result[str(p)]=expected
    for name in ('empty-hint-seal.json','empty-hint-parent-only-spec.json','receipt.json','job.json','source.tar.gz','worker.py'):
        p=DIAGNOSTIC/name; result[str(p)]=sha(p)
    cfg=read(DIAGNOSTIC/'job.json'); built=read(DIAGNOSTIC/'receipt.json')
    if built['status']!='ok' or built['source_revision']!=OLD or cfg['revision']!=OLD or cfg['tasks']!=TASKS:
        raise ValueError('diagnostic build identity differs')
    if built['source_manifest_sha256']!=cfg['manifest_sha256'] or manifest_hash(cfg['files'])!=cfg['manifest_sha256']:
        raise ValueError('diagnostic build manifest differs')
    for artifact in built['artifacts']:
        p=Path(built['job'])/'source'/artifact['path']
        if sha(p)!=artifact['sha256']: raise ValueError('diagnostic built APK differs')
        result[str(p)]=sha(p)
    source=DIAGNOSTIC/'source'
    xml=list((source/'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'))
    if not xml: raise ValueError('diagnostic unit XML absent')
    for p in xml+[source/'android/app/build/reports/lint-results-debug.xml']:
        result[str(p)]=sha(p)
    return result


def check_review(review, proof):
    if review.get('is_error') or review.get('permission_denials') or not review.get('result'):
        raise ValueError('review invocation incomplete')
    models=review.get('modelUsage',{})
    if len(models)!=1 or not next(iter(models)).startswith('claude-opus-'):
        raise ValueError('independent Opus route required')
    if not re.search(r'(?im)^\s*(?:#{1,6}\s*)?(?:\*\*)?Verdict:\s*(?:\*\*)?PASS(?: WITH NITS)?\b',review['result']) or proof['reviewed_revision'] not in review['result']:
        raise ValueError('exact-source passing review required')


def check_source(cfg, old_cfg, proof):
    if cfg['host']!='forum' or cfg['tasks']!=TASKS or any(cfg.get(k) for k in ('owner_config','signing_env','expected_signer','cap_sync')):
        raise ValueError('canonical unsigned debug tasks required')
    if cfg['revision']!=proof['revision'] or manifest_hash(cfg['files'])!=cfg['manifest_sha256']:
        raise ValueError('candidate source identity differs')
    before={k:v for k,v in old_cfg['files'].items() if k.startswith('android/app/src/main/')}
    after={k:v for k,v in cfg['files'].items() if k.startswith('android/app/src/main/')}
    if set(before)!=set(after) or {k for k in before if before[k]!=after[k]}!=PRODUCT_DELTA:
        raise ValueError('only two reviewed production files may differ')
    if set(proof['android_changed_paths'])!=ANDROID_DELTA or proof['old_revision']!=OLD:
        raise ValueError('Android delta not exact review')
    for name,expected in proof['android_sha256'].items():
        if cfg['files'][name]['sha256']!=expected: raise ValueError('reviewed Android source drift')
    if set(proof['android_sha256'])!=ANDROID_DELTA: raise ValueError('incomplete reviewed source closure')
    if proof['unit_expected_tests']!=417 or proof['dictation_unit_tests']!=21:
        raise ValueError('unit method census differs')


def verify(root):
    root=Path(root).resolve(); seal=read(root/'acceptance-seal.json')
    if root.parent!=BASE/'jobs': raise ValueError('fresh canonical forum job root required')
    for name,expected in seal['files'].items():
        p=Path(name)
        if not p.is_absolute() or not p.resolve().is_relative_to(BASE) or sha(p)!=expected:
            raise ValueError('sealed source/evidence drift: '+name)
    cfg=read(root/'job.json'); proof=read(root/'source-proof.json'); packet=read(root/'packet.json')
    check_source(cfg,read(DIAGNOSTIC/'job.json'),proof)
    check_review(read(root/'opus-review.json'),proof)
    if archive_files(root/'source.tar.gz')!=cfg['files']: raise ValueError('canonical source archive drift')
    prior=read(PRIOR/'packet.json'); expected=copy.deepcopy(prior)
    expected.update(source_revision=cfg['revision'],workers={},candidate_cases=prior['candidate_cases']+sorted(EXTRA))
    expected['candidate']={'receipt':str(root/'receipt.json'),'revision':cfg['revision'],'manifest_sha256':cfg['manifest_sha256']}
    if packet!=expected: raise ValueError('native controls or runner settings changed')
    check_cases(prior['candidate_cases'],packet['candidate_cases'])
    if (root/'historical-packet.json').read_bytes() != (PRIOR/'packet.json').read_bytes():
        raise ValueError('frozen historical packet differs')
    if sha(root/'prior-heavy-failure.log') != FAILED_QUEUE_LOG_SHA:
        raise ValueError('preserved queue failure log drift')
    check_contract_inputs(root, packet)
    required={str(root/n) for n in (*MEMBERS,'worker.py','job.json','source.tar.gz','source-proof.json','packet.json','historical-packet.json','prior-heavy-failure.log','custody.json','opus-review.json','opus-review-prompt.md')}
    custody=read(root/'custody.json')
    required.update(custody['preserved_originals'])
    if not required.issubset(seal['files']): raise ValueError('incomplete acceptance closure')
    for p,h in custody['preserved_originals'].items():
        if seal['files'][p]!=h: raise ValueError('old evidence relabelled')
    for lane in ('baseline','rejected'):
        d=read(packet[lane]['receipt'])
        if d['status']!='ok' or d['source_revision']!=packet[lane]['revision'] or d['source_manifest_sha256']!=packet[lane]['manifest_sha256']:
            raise ValueError('adopted control identity differs')
        if d['tasks']!=[':app:assembleDebug',':app:assembleDebugAndroidTest'] or len(d['artifacts'])!=2:
            raise ValueError('control build contract differs')
    return packet


def prepare(root):
    root=root.resolve()
    if os.uname().nodename!='forum' or root.parent!=BASE/'jobs': raise ValueError('forum-only preparation')
    if any((root/n).exists() for n in ('receipt.json','source','acceptance-seal.json','native')):
        raise ValueError('fresh unexecuted prepared job required')
    if shutil.disk_usage(BASE).free<240*1024**3: raise ValueError('200 GiB reserve plus 40 GiB pending headroom required')
    originals=closure(PRIOR); originals.update(diagnostic_closure()); originals.update(failed_prebuild_closure())
    prior_receipt=read(PRIOR/'native/receipt.json')
    if prior_receipt['status']!='failed' or not prior_receipt['stopped_emulator']:
        raise ValueError('preserve original failure/cleanup')
    cfg=read(root/'job.json'); proof=read(root/'source-proof.json')
    check_source(cfg,read(DIAGNOSTIC/'job.json'),proof)
    packet=read(PRIOR/'packet.json');packet['source_revision']=cfg['revision'];packet['workers']={}
    packet['candidate_cases']+=sorted(EXTRA)
    packet['candidate']={'receipt':str(root/'receipt.json'),'revision':cfg['revision'],'manifest_sha256':cfg['manifest_sha256']}
    write(root/'packet.json',packet)
    shutil.copyfile(PRIOR/'packet.json',root/'historical-packet.json')
    (root/'historical-packet.json').chmod(0o600)
    shutil.copyfile(FAILED_QUEUE_LOG,root/'prior-heavy-failure.log')
    (root/'prior-heavy-failure.log').chmod(0o600)
    write(root/'custody.json',{'source_revision':cfg['revision'],'preserved_originals':originals,
        'inherited_control_builds':['baseline','rejected'],'fresh_control_builds':[],
        'fresh_candidate_tasks':TASKS,'native_cases':{'candidate':32,'baseline':2,'rejected_expected_assertion_failures':2},
        'prior_diagnostic_sha256':DIAGNOSTIC_SHA,'unit_expected_tests':417,
        'prior_queue_failure':{'path':str(FAILED_QUEUE_LOG),'sha256':FAILED_QUEUE_LOG_SHA},
        'handset_proven':False,'native_acceptance_executed':False,'publication_authorized':False})
    (root/'scratch').mkdir(mode=0o700)
    files=dict(originals)
    for name in (*MEMBERS,'worker.py','job.json','source.tar.gz','source-proof.json','packet.json','historical-packet.json','prior-heavy-failure.log','custody.json','opus-review.json','opus-review-prompt.md'):
        files[str(root/name)]=sha(root/name)
        if name in MEMBERS and cfg['files']['tools/'+name]['sha256']!=sha(root/name):
            raise ValueError('QA file not exact pushed candidate: '+name)
    write(root/'acceptance-seal.json',{'source_revision':cfg['revision'],'files':files})
    verify(root)
    spec={'host':'forum','lane':'heavy','key':'dictation-empty-hint-acceptance-'+cfg['revision'],
        'cwd':str(root),'argv':['/usr/bin/env','PYTHONDONTWRITEBYTECODE=1','TMPDIR='+str(root/'scratch'),
        '/usr/bin/python3',str(root/'qa_dictation_empty_hint_acceptance.py'),'execute',str(root),
        '--seal-sha256',sha(root/'acceptance-seal.json')],'timeout_seconds':7200}
    write(root/'parent-only-acceptance-spec.json',spec)
    write(root/'acceptance-preparation.json',{'status':'prepared_not_submitted','source_revision':cfg['revision'],
        'seal_sha256':sha(root/'acceptance-seal.json'),'spec_sha256':sha(root/'parent-only-acceptance-spec.json'),
        'free_bytes':shutil.disk_usage(BASE).free,'reserve_bytes':200*1024**3,
        'build_executed':False,'native_acceptance_executed':False,'handset_proven':False})
    return spec


def controller_preflight(root, runner=subprocess.run, log_name='controller-tests.log'):
    """Exact shared pre-build command; controller-only, never starts Gradle or Android."""
    packet = verify(root)
    with (root/log_name).open('x') as out:
        p = runner([sys.executable,'-m','unittest','-v',*TEST_MODULES],cwd=root,
            stdout=out,stderr=subprocess.STDOUT,timeout=180)
    log = (root/log_name).read_text()
    counts = re.findall(r'^Ran (\d+) tests? in ', log, re.M)
    if p.returncode or len(counts) != 1 or int(counts[0]) < 73 or not log.rstrip().endswith('OK'):
        raise RuntimeError('controller regressions failed or incomplete')
    return {'exit_code':p.returncode,'tests':int(counts[0]),'failures':0,'errors':0,'skipped':0,
            'log_sha256':sha(root/log_name),'contracts':check_contract_inputs(root,packet)}


def preflight(root):
    root = root.resolve()
    if any((root/n).exists() for n in ('receipt.json','source','native','acceptance-receipt.json')):
        raise ValueError('preflight requires exact fresh pre-build environment')
    result = controller_preflight(root,log_name='preflight-controller-tests.log')
    if any((root/n).exists() for n in ('receipt.json','source','native','acceptance-receipt.json')):
        raise ValueError('controller preflight created build/native output')
    result.update(status='controller_only_pass',source_revision=read(root/'job.json')['revision'],
                  build_executed=False,native_acceptance_executed=False,submitted=False)
    write(root/'controller-preflight.json',result)
    return result


def execute(root):
    from qa_queue_lease import validated_queue_fd,run_with_queue_lease
    from qa_dictation_insertion_native import unit_census
    root=root.resolve();packet=verify(root);validated_queue_fd()
    if (root/'acceptance-receipt.json').exists() or (root/'receipt.json').exists() or (root/'native').exists():
        raise ValueError('acceptance packet one-use')
    if shutil.disk_usage(BASE).free<240*1024**3: raise ValueError('200 GiB reserve plus 40 GiB pending headroom required')
    result={'status':'failed','source_revision':packet['source_revision'],'handset_proven':False,'stopped_emulator':False,
            'inherited_control_builds':['baseline','rejected'],'fresh_control_builds':[],'stages':{}}
    try:
        result['controller_tests']=controller_preflight(root,runner=run_with_queue_lease)
        result['stages']['controller_tests']=result['controller_tests']['exit_code']
        with (root/'candidate-build-controller.log').open('w') as out:
            p=run_with_queue_lease(['/usr/bin/python3',str(root/'worker.py'),'--worker',str(root/'job.json')],cwd=root,
                stdout=out,stderr=subprocess.STDOUT,timeout=3600)
        result['stages']['candidate_build']=p.returncode
        if p.returncode: raise RuntimeError('canonical full unit/lint/debug/test build failed')
        built=read(root/'receipt.json')
        if built['status']!='ok' or built['source_revision']!=packet['source_revision'] or built['source_manifest_sha256']!=packet['candidate']['manifest_sha256']:
            raise ValueError('fresh candidate build identity differs')
        result['build_receipt_sha256']=sha(root/'receipt.json')
        result['unit']=unit_census(root/'source')
        if result['unit']['tests']!=417: raise ValueError('full unit census differs')
        verify(root)
        with (root/'native-controller.log').open('w') as out:
            p=run_with_queue_lease([sys.executable,str(root/'qa_dictation_insertion_native.py'),str(root/'packet.json'),str(root/'native')],
                cwd=root,stdout=out,stderr=subprocess.STDOUT,timeout=2700)
        result['stages']['native']=p.returncode
        n=read(root/'native/receipt.json');result['stopped_emulator']=n.get('stopped_emulator',False)
        result['native_receipt_sha256']=sha(root/'native/receipt.json')
        if p.returncode or n['status']!='ok' or not result['stopped_emulator']: raise RuntimeError('full native acceptance/cleanup failed')
        for lane,total in (('candidate',32),('baseline',2),('rejected',2)):
            if n['cases'][lane]['status']!='ok' or len(n['cases'][lane]['records'])!=total:
                raise ValueError('full native census differs: '+lane)
        result['old_fails_new_passes']={m:{'old_receipt':str(DIAGNOSTIC/'empty-hint-native/receipt.json'),
            'old_code':-2,'new_code':0} for m in ('substringDoesNotVerifyInsertion','hintIsNotExistingTextAndSentenceCapitalizationSurvives')}
        verify(root);result['status']='ok'
    except BaseException:
        result['error']=traceback.format_exc();raise
    finally:
        p=root/'native/receipt.json'
        if p.is_file():
            result['native_receipt_sha256']=sha(p);result['stopped_emulator']=read(p).get('stopped_emulator',False)
        write(root/'acceptance-receipt.json',result)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=('prepare','verify','preflight','execute'));p.add_argument('root',type=Path)
    p.add_argument('--seal-sha256');a=p.parse_args()
    if a.mode!='prepare' and sha(a.root/'acceptance-seal.json')!=a.seal_sha256: raise ValueError('parent-pinned seal mismatch')
    print(json.dumps(prepare(a.root) if a.mode=='prepare' else verify(a.root) if a.mode=='verify' else preflight(a.root) if a.mode=='preflight' else execute(a.root),indent=2))
