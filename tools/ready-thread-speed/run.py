#!/usr/bin/env python3
"""Durable-queue entrypoint. Execute only via wizard_heavy_submit on forum."""
import hashlib,json,os,signal,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve()
manifest=json.loads((root/'manifest.json').read_text())
evidence=root/'evidence';evidence.mkdir(exist_ok=True)
node=manifest['tools']['node'];env=os.environ.copy()
env.update({'PATH':str(Path(node).parent)+':'+env.get('PATH',''),'TMPDIR':str(root/'tmp'),'HOME':str(root/'runtime-home'),'QA_PLAYWRIGHT':manifest['tools']['playwright'],'QA_CHROME':manifest['tools']['chrome'],'WIZARD_LIST_CACHE':'on'})
for key in ['TMPDIR','HOME']:Path(env[key]).mkdir(exist_ok=True)
report={'schema':1,'manifest_sha256':hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest(),'phases':[],'live_verified':False,'handset_verified':False,'private_owner_data_read':False}
def save(): (evidence/'report.json').write_text(json.dumps(report,indent=2)+'\n')
def run(name,args,cwd,timeout=300,extra=None):
    start=time.monotonic();result={'name':name,'argv':[str(x) for x in args],'cwd':str(cwd)}
    with (evidence/(name+'.log')).open('w') as log:
        p=subprocess.Popen(result['argv'],cwd=cwd,env={**env,**(extra or {})},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try: code=p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid,signal.SIGTERM)
            try:p.wait(timeout=15)
            except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
            code=124
    result.update(exit_code=code,elapsed_seconds=time.monotonic()-start);report['phases'].append(result);save();print(json.dumps(result),flush=True)
    return code==0
# Verify the exact archives and staged runner before exercising any source.
for rel,expected in manifest['artifacts'].items():
    actual=hashlib.sha256((root/rel).read_bytes()).hexdigest()
    if actual!=expected:raise SystemExit(f'Artifact changed: {rel}')
for name,tree in manifest['trees'].items():
    base=root/'sources'/name
    actual={str(p.relative_to(base)):hashlib.sha256(p.read_bytes()).hexdigest() for p in base.rglob('*') if p.is_file() and '.git' not in p.relative_to(base).parts and 'node_modules' not in p.relative_to(base).parts}
    if actual!=tree['files']:raise SystemExit(f'Source manifest differs: {name}')
for rel,expected in manifest['dependencies'].items():
    if hashlib.sha256((root/'deps'/rel).read_bytes()).hexdigest()!=expected:raise SystemExit(f'Dependency changed: {rel}')
report['source_verified']=True;save()
service=root/'sources/candidate-service';ux=root/'sources/candidate-ux';tools=ux/'tools/ready-thread-speed'
# Regresions are focused; this is not a new whole-repository test portfolio.
run('service-node',[node,'--test','tests/ready-thread-speed.node.mjs','tests/session-list-cache.node.mjs','tests/session-list-cache-http.node.mjs','tests/open-ask.node.mjs','tests/incognito.node.mjs'],service,300)
run('service-correctness',[node,root/'deps/node_modules/vitest/vitest.mjs','run','--maxWorkers=1','tests/owned-open-work.test.ts','tests/helper-status.test.ts','tests/owed-helper-work.test.ts','tests/helper-continuation-evidence.test.ts','tests/heavy-wait.test.ts','tests/heavy-status.test.ts','tests/session-truth-seek.test.ts'],service,420)
run('ux-correctness',[node,'--test','tests/ready-thread-speed.test.mjs','tests/ready-thread-loading.test.mjs','tests/helper-working-no-ready-blip.test.mjs','tests/thread-reading-spot.test.mjs','tests/outbox-voice-reload-handoff.test.mjs'],ux,300)
for label in ['baseline','candidate']:
    run(label+'-overlap-and-taps',[node,tools/'acceptance.mjs',root/'sources'/f'{label}-service',root/'sources'/f'{label}-ux',evidence/label,label],root,800)
run('scoped-browser',[node,tools/'scope-browser.mjs',service,ux,evidence/'scopes'],root,300)
report['pass']=all(p['exit_code']==0 for p in report['phases'])
report['limits']=['Loopback synthetic load; not tailnet, handset or confidential-model proof.','CPU profiles and per-second user/system CPU are retained separately from elapsed latency.','Background canonical progress, list refresh and self-check run; automatic agent continuations are disabled to preserve no-agent-write custody.','Do not attribute the full live CPU stall to one evidence read from this isolated contributor A/B.','Review screenshots, traces, profiles, current serving lineage and parity before activation.']
# A baseline measurement may intentionally lack the new hang/retry behavior; its
# budget is never used as a candidate pass. Verify the candidate's complete gate.
candidate=evidence/'candidate/results.json'
if candidate.exists():report['candidate']=json.loads(candidate.read_text());report['pass']=report['pass'] and report['candidate']['budgets_pass']
else:report['pass']=False
save();print(json.dumps({'pass':report['pass'],'report':str(evidence/'report.json')}),flush=True)
sys.exit(0 if report['pass'] else 1)
