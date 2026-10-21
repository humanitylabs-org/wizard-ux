#!/usr/bin/env python3
"""Build/acceptance chain for Samsung scroll proxy; never publishes or merges.
usage: qa_scroll_release.py RELEASE_JOB QA_JOB OLD_APK OUTPUT REVISION
Run by the durable Thales worker, with its inherited Android lease.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
from qa_paths import work_root

SIGNER='3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
OLD_SHA='ce4068f7dc6194d1bd3b505ede8a3229c0c554ecd165352fa5dedfe3d1eae4c0'

def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
    release_job,qa_job,old_apk,out=map(Path,sys.argv[1:5]);revision=sys.argv[5]
    if sys.platform!='darwin' or not os.environ.get('WIZARD_HEAVY_LOCK_FD'):
        raise SystemExit('Use the durable Thales worker with its inherited lease')
    for p in (release_job,qa_job,old_apk,out):
        if not p.resolve().is_relative_to(work_root()):raise SystemExit('Work must remain on ThalesMedia')
    fd=int(os.environ['WIZARD_HEAVY_LOCK_FD']);out.mkdir(parents=True,exist_ok=False)
    receipt={'source_revision':revision,'ok':False,'steps':[],'old_sha256':digest(old_apk)}
    def run(name,argv):
        with (out/(name+'.log')).open('w') as log:
            r=subprocess.run(list(map(str,argv)),stdout=log,stderr=subprocess.STDOUT,pass_fds=(fd,))
        receipt['steps'].append({'name':name,'exit_code':r.returncode,'log':str(out/(name+'.log'))})
        print(('PASS ' if r.returncode==0 else 'FAIL ')+name+' '+str(out/(name+'.log')),flush=True)
        if r.returncode:raise RuntimeError(name+' failed; read exact phase log')
    def build(job,name):
        cfg=json.loads((job/'job.json').read_text());assert cfg['revision']==revision,'revision drift'
        run(name,[sys.executable,job/'worker.py','--worker',job/'job.json'])
        result=json.loads((job/'receipt.json').read_text())
        assert result['status']=='ok' and result['source_revision']==revision
        assert result['source_manifest_sha256']==cfg['manifest_sha256']
        receipt[name]=result
        totals=dict(tests=0,failures=0,errors=0,skipped=0);math_found=False
        for report in (job/'source/android/app/build/test-results').rglob('TEST-*.xml'):
            root=ET.parse(report).getroot()
            for k in totals:totals[k]+=int(root.attrib.get(k,0))
            if root.attrib.get('name')=='ai.wizards.os.ScrollProxyMetricsTest':
                assert int(root.attrib['tests'])==3;math_found=True
        assert totals['tests'] and not totals['failures'] and not totals['errors'] and math_found,totals
        receipt[name+'_units']=totals;print('PASS '+name+' JUnit '+json.dumps(totals),flush=True)
        artifacts={}
        for a in result['artifacts']:
            apk=job/'source'/a['path'];assert digest(apk)==a['sha256'];artifacts[a['aapt2']['package']]=(apk,a)
        return artifacts
    try:
        assert receipt['old_sha256']==OLD_SHA,'previous published APK drift'
        release=build(release_job,'release-build');qa=build(qa_job,'qa-build')
        signed,meta=release['ai.wizards.os']
        assert meta['aapt2']['version_name']=='0.9.37' and str(meta['aapt2']['version_code'])=='61'
        assert meta['signer_sha256']==SIGNER
        debug,_=qa['ai.wizards.os.qa'];test,_=qa['ai.wizards.os.qa.test'];src=qa_job/'source'
        run('signed-upgrade',[sys.executable,src/'tools/qa_upgrade.py',old_apk,signed])
        run('aosp-scroll-capture',[sys.executable,src/'tools/qa_scroll_capture.py',debug,out/'aosp'])
        aosp=json.loads((out/'aosp/receipt.json').read_text());assert aosp['passed']==aosp['total'] and aosp['total']
        receipt['aosp_scroll_capture']=aosp
        run('native-scroll-proxy',[sys.executable,src/'tools/qa_scroll_proxy.py',debug,test,out/'proxy'])
        proxy=json.loads((out/'proxy/receipt.json').read_text());assert proxy['ok'];receipt['native_proxy']=proxy
        receipt.update(ok=True,artifact=str(signed),sha256=meta['sha256'],signer=meta['signer_sha256'])
        print('PASS Samsung scroll proxy Thales release gates '+json.dumps({'apk':str(signed),'sha256':meta['sha256'],'version':'0.9.37/61'}),flush=True)
    finally:
        (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')

if __name__=='__main__': main()
