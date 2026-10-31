#!/usr/bin/env python3
"""Final full A/B entrypoint; execute only through the parent's Forum queue."""
import ast,hashlib,json,math,os,re,shutil,signal,subprocess,sys,time
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
from typing import Any
root=Path(sys.argv[1]).resolve();expected=sys.argv[2]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(root/'manifest.json')==expected,'manifest identity'
m=json.loads((root/'manifest.json').read_text())
def inventory(base,exclude=()):
 out={}
 for p in sorted(base.rglob('*')):
  rel=str(p.relative_to(base))
  if rel.split('/')[0] in exclude:continue
  if p.is_symlink():out[rel]={'kind':'symlink','target':os.readlink(p),'mode':p.lstat().st_mode&0o777}
  elif p.is_file():out[rel]={'kind':'file','sha256':sha(p),'mode':p.stat().st_mode&0o777}
 return out
def verify():
 for rel,digest in m['artifacts'].items():assert sha(root/rel)==digest,rel
 for rel,target in m['dependency_links'].items():assert (root/rel).is_symlink() and os.readlink(root/rel)==target,rel
 for name,tree in m['trees'].items():assert inventory(root/'sources'/name,('node_modules',))==tree['inventory'],name
 assert inventory(root/'deps')==m['dependencies']['inventory'],'protected task-local dependency donor changed'
 for name,tool in m['tool_inventories'].items():assert inventory(Path(tool['root']))==tool['inventory'],name
 for item in m['inherited']['files']:assert sha(Path(item['path']))==item['sha256'],item['path']
 prior=Path(m['recovery_provenance']['prior_stage']);assert inventory(prior/'evidence')==m['recovery_provenance']['prior_evidence_inventory'],'prior evidence changed'
 for base,expected_inventory in m['recovery_provenance'].get('earlier_evidence_inventories',{}).items():assert inventory(Path(base))==expected_inventory,base
verify()
evidence=root/'evidence';evidence.mkdir();node=m['tools']['node']
env={'PATH':str(Path(node).parent)+':/usr/bin:/bin','TMPDIR':str(root/'tmp'),'HOME':str(root/'runtime-home'),'QA_PLAYWRIGHT':m['tools']['playwright'],'QA_CHROME':m['tools']['chrome'],'WIZARD_LIST_CACHE':'on','CI':'1','PYTHONDONTWRITEBYTECODE':'1'}
for key in ['TMPDIR','HOME']:Path(env[key]).mkdir()
env.update(HERMES_HOME=str(root/'runtime-home/.hermes'),WIZARD_OS_HOME=str(root/'runtime-home/.wizard-os'),XDG_CACHE_HOME=str(root/'runtime-home/.cache'))
# Test runners may write their own task-local caches, never the sealed donor or
# an older stage's shared node_modules. No install/network dependency acquisition.
shutil.copytree(root/'deps',root/'runtime-deps',symlinks=True)
assert inventory(root/'runtime-deps')==m['dependencies']['inventory']
for rel in m['dependency_links']:
 link=root/rel;assert link.is_symlink() and link.resolve()==root/'runtime-deps/node_modules'
r={'schema':2,'manifest_sha256':expected,'source_verified':True,'full_acceptance':True,'pass':False,'phases':[],'failures':[],'sources':{k:v['commit'] for k,v in m['trees'].items()},'production_equivalence':m['production_equivalence'],'inherited_provenance':{k:v for k,v in m['inherited'].items() if k!='files'},'inherited_passes_used':False,'private_owner_data_read':False,'live_verified':False,'handset_verified':False,'deployment_performed':False}
def save():(evidence/'report.json').write_text(json.dumps(r,indent=2)+'\n')
def run(name,args,cwd,timeout=300,extra=None):
 start=time.monotonic();argv=[str(x) for x in args]
 with (evidence/(name+'.log')).open('w') as log:
  p=subprocess.Popen(argv,cwd=cwd,env={**env,**(extra or {})},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=15)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   code=124
 phase={'name':name,'argv':argv,'cwd':str(cwd),'exit_code':code,'elapsed_seconds':time.monotonic()-start,'log_sha256':sha(evidence/(name+'.log'))}
 r['phases'].append(phase)
 if code:r['failures'].append(name+': exit '+str(code))
 save();print(json.dumps(phase),flush=True)
 return code==0
def jsonlines(path):
 with path.open() as f:
  for line in f:
   if line.strip():yield json.loads(line)
def stats(values):
 values=sorted(values);return {'n':len(values),'p50':values[math.ceil(len(values)*.5)-1],'p95':values[math.ceil(len(values)*.95)-1],'max':values[-1]}
def digest(rows):
 def iso(v):
  if isinstance(v,(float,int)):return datetime.fromtimestamp(int(v*1000)/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
  return datetime.fromisoformat(v.replace('Z','+00:00')).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
 payload=[[row['role'],row['content'],iso(row['timestamp'])] for row in rows]
 return hashlib.sha256(json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def validate_side(label,inherited_partial=False):
 focus=m.get('focused_recovery',False);baseline=focus and label=='baseline';n=30 if not focus or baseline else 1
 continuation=m.get('phone_continuation',False)
 base=Path(m['recovery_provenance']['prior_stage'])/'evidence/candidate' if inherited_partial else evidence/label;d=json.loads((base/'results.json').read_text())
 assert d['custody']['upstreamWrites']==0,label
 if inherited_partial:
  assert continuation and label=='candidate' and not d['focused_complete'] and not d['budgets_pass']
  assert len(d['failures'])==2 and all(any(f.startswith('phone/'+skin+': AssertionError') and "'rejected-old-copy'" in f and "'current-copy-refilled'" in f and 'acceptance.mjs:212:56' in f for f in d['failures']) for skin in ['nebula','signal'])
 else:assert (d['focused_complete'] if focus else d['complete']) and not d['failures'],label
 if focus:assert not d['complete'] and not d['full_matrix_claimed'] and d['focus_profile']==('baseline-missing-cell' if baseline else 'rs17-phone-continuation' if continuation and not inherited_partial else 'live-integration')
 cells=[('phone','nebula')] if baseline else [(shell,skin) for shell in ['phone','desktop'] for skin in ['nebula','signal']]
 groups=[(*c,state) for c in cells for state in (['stale'] if baseline else ['current','empty','stale'])]
 if continuation:
  if inherited_partial:groups=[g for g in groups if g[0]=='desktop' or g[2]=='current'];cells=[('desktop',skin) for skin in ['nebula','signal']]
  else:cells=[('phone',skin) for skin in ['nebula','signal']];groups=[(*c,state) for c in cells for state in ['empty','stale']]
 records=d['browser'];timing=[x for x in records if 'state' in x];ancillary=[x for x in records if 'case' in x]
 assert len(timing)==len(groups) and Counter((x['shell'],x['skin'],x['state']) for x in timing)==Counter(groups)
 cases=['long-history','no-js-errors','pending-voice-hang-deadline-retry','ready-prefetch-uses-existing-current-cache']
 assert len(ancillary)==len(cells)*4 and Counter((x['shell'],x['skin'],x['case']) for x in ancillary)==Counter((*c,k) for c in cells for k in cases)
 assert len(d['api'])==(0 if focus else 3) and {x['name'] for x in d['api']}==(set() if focus else {'health','detail','history'})
 api=[] if focus else list(jsonlines(base/'api.jsonl'));assert len(api)==(0 if focus else 150)
 for group in d['api']:
  rows=[x for x in api if x['name']==group['name']];assert sorted(x['i'] for x in rows)==list(range(50))
  assert all(group[k]==v for k,v in stats([x['ms'] for x in rows]).items())
  budget=100 if group['name']=='health' else 200;assert group['budget_ms']==budget and group['pass']==(group['p95']<budget)
 traces=list(jsonlines(base/'tap-traces.jsonl'));assert len(traces)==len(groups)*n
 by_tuple={}
 for trace in traces:
  key=(trace['shell'],trace['skin'],trace['state'],trace['n']);assert key not in by_tuple;by_tuple[key]=trace
  target=['current','empty','stale'].index(trace['state'])+1 if focus and not baseline and not inherited_partial else trace['n']
  assert trace['id']=='wizard_speed_'+str(target) and trace['tap']>0 and trace['stale'] is False
  if continuation and not inherited_partial and trace['state']=='empty':
   read=trace['cold_read'];assert read['request']>=trace['tap'] and read['response']>=read['request'] and read['status']==200 and read['pending'] is False
   assert read['capturedKey']==trace['canonical']['key'] and '/'+trace['id']+'/messages?' in read['url'] and 'limit=500' in read['url']
  assert trace['geometry']['inViewport'] and trace['geometry']['hit'] and trace['header']['hit']
  assert trace['header']['backVisible']==(trace['shell']=='phone')
  if trace['state']=='stale':
   c=trace['cache'];assert c['released_at'] and c['held_requests'] and c['canonical']==trace['canonical']
   assert c['canonical']['messageCount']==c['old']['messageCount']+2
 for group in timing:
  key=(group['shell'],group['skin'],group['state']);rows=[by_tuple[(*key,n)] for n in range(1,n+1)]
  assert all(group[k]==v for k,v in stats([x['ms'] for x in rows]).items())
  budget=150 if group['state']=='current' else 1000;assert group['budget_ms']==budget and group['pass']==(group['p95']<budget)
 # Recount each physical stale counterproof and each full-content paint without
 # trusting declared aggregate totals or interpreting a missing cache as stale.
 seen=Counter();batch_seen=Counter();post_seen=Counter();pre_seen=Counter()
 for item in jsonlines(base/'cache-evidence.jsonl'):
  cell=(item['shell'],item['skin']);s=item['snapshot'];phase=item['phase']
  if phase=='batch-ready':
   key=(*cell,s['id']);batch_seen[key]+=1;e=s['canonical'];db=s['db']
   assert s['accepted'] is None and s['key']==e['key'] and s['trusted']
   assert s['raw']['messageCount']==db['session']['message_count']==db['actualCount']==db['canonicalReader']['row']['message_count']==e['messageCount']
   assert db['revision']['key']==e['key']
   for k in ['lastAssistantAt','lastUserAt']:assert s['raw'][k]==s['list'][k]==e[k]
   assert digest(s['persisted']['rows'])==s['old']['contentSha256']
  if phase in ['all-states-immediately-before-tap','all-states-after-current-paint','immediately-before-tap']:
   key=(*cell,item['state'],item['n'])
   if inherited_partial and key not in by_tuple:
    assert key in [('phone',skin,'empty',1) for skin in ['nebula','signal']] and phase=='all-states-immediately-before-tap'
    continue # failed setup remains failed; this pre-tap-only record is never inherited as a pass
   assert key in by_tuple;e=by_tuple[key]['canonical']
   assert s['canonical']==e and s['key']==e['key'] and s['trusted']
   if phase=='all-states-immediately-before-tap':
    pre_seen[key]+=1
    if item['state']=='current':assert digest(s['accepted'])==e['contentSha256']
    else:assert s['accepted'] is None
   elif phase=='all-states-after-current-paint':
    post_seen[key]+=1;assert digest(s['accepted'])==e['contentSha256']
    if continuation and not inherited_partial and item['state']=='empty':
     t=by_tuple[key];reads=[v for v in s['traffic'] if v['request']>=t['tap'] and v['response'] is not None and v['response']<=s['at'] and v.get('status')==200 and not v['pending']]
     assert len(reads)==1 and reads[0]==t['cold_read'] and reads[0]['capturedKey']==e['key']
   else:
    seen[key]+=1;assert item['state']=='stale' and s['accepted'] is None and s['gate']['releasedAt'] is None and not s['gate']['requests']
    assert digest(s['persisted']['rows'])==by_tuple[key]['cache']['old']['contentSha256']
 assert pre_seen==post_seen==Counter({key:1 for key in by_tuple})
 assert seen==Counter({key:1 for key in by_tuple if key[2]=='stale'})
 stale_cells={g[:2] for g in groups if g[2]=='stale'}
 assert batch_seen==Counter({(*cell,'wizard_speed_'+str(n)):1 for cell in stale_cells for n in range(1,31)})
 for item in ancillary:
  if label=='baseline' and item['case']=='pending-voice-hang-deadline-retry':assert item['durable'] and item['held_send_attempts']>0 and item.get('known_limitation')
  else:assert item['pass'],item
 if label=='candidate':assert (d['budgets_pass'] or inherited_partial) and all(x['pass'] for x in d['api']+records)
 return {'complete':not focus,'focused_complete':focus and not inherited_partial,'fresh':not inherited_partial,'api_groups':len(d['api']),'api_samples':len(api),'tap_groups':len(groups),'taps':len(traces),'stale_counterproofs':sum(seen.values()),'batch_ready_old_copies':sum(batch_seen.values()),'ancillary_cases':len(ancillary),'budgets_pass':all(x['pass'] for x in d['api']+records),'timing_tuples':groups,'ancillary_cells':cells}
try:
 service=root/'sources/candidate-service';ux=root/'sources/candidate-ux';tools=ux/'tools/ready-thread-speed'
 if m.get('phone_continuation'):
  r.update(full_acceptance=False,inherited_passes_used=True)
  prior=Path(m['recovery_provenance']['prior_stage'])
  oldns:dict[str,Any]=dict(json=json,hashlib=hashlib,math=math,Counter=Counter,datetime=datetime,timezone=timezone,evidence=prior/'evidence',m=json.loads((prior/'manifest.json').read_text()))
  oldfunctions:list[ast.stmt]=[s for s in ast.parse((prior/'run.py').read_text()).body if isinstance(s,ast.FunctionDef) and s.name in ['jsonlines','stats','digest','validate_side']]
  exec(compile(ast.Module(body=oldfunctions,type_ignores=[]),'read-only-rs17-validator','exec'),oldns)
  r['inherited_rs17_baseline']=oldns['validate_side']('baseline');r['inherited_rs17_baseline']['fresh']=False
  r['inherited_rs17_candidate']=validate_side('candidate',inherited_partial=True)
  assert r['inherited_rs17_candidate']['taps']==8 and r['inherited_rs17_candidate']['ancillary_cases']==8
  assert run('focused-setup-regressions',[node,'--test','--test-name-pattern=focused cold setup|focused samples','tests/ready-thread-loading.test.mjs',tools/'batch-preparation.test.mjs'],ux,180)
  regression_log=(evidence/'focused-setup-regressions.log').read_text();assert re.search(r'^# pass 2$',regression_log,re.M) and re.search(r'^# fail 0$',regression_log,re.M),'exactly two focused setup regressions must execute'
  assert run('candidate-phone-continuation',[node,tools/'acceptance.mjs',service,ux,evidence/'candidate','candidate'],root,400,{'READY_SPEED_FOCUS':'rs17-phone-continuation'})
  r['candidate_phone']=validate_side('candidate')
  assert r['candidate_phone']['taps']==4 and r['candidate_phone']['ancillary_cases']==8 and r['candidate_phone']['stale_counterproofs']==2
  previous=r['inherited_rs17_candidate'];fresh=r['candidate_phone']
  all_groups=[tuple(g) for g in previous['timing_tuples']+fresh['timing_tuples']]
  assert Counter(all_groups)==Counter((shell,skin,state) for shell in ['phone','desktop'] for skin in ['nebula','signal'] for state in ['current','empty','stale'])
  all_cells=[tuple(c) for c in previous['ancillary_cells']+fresh['ancillary_cells']]
  assert Counter(all_cells)==Counter((shell,skin) for shell in ['phone','desktop'] for skin in ['nebula','signal'])
  r['composite']={'focused_integration_complete':True,'fresh_full_matrix':False,'taps':12,'fresh_taps':4,'inherited_taps':8,'ancillary_cases':16,'fresh_ancillary':8,'inherited_ancillary':8,'budgets_pass':True,'original_failed_aggregate_preserved':True}
  r['pass']=len(r['phases'])==2 and not r['failures']
 elif m.get('focused_recovery'):
  r.update(full_acceptance=False,inherited_passes_used=True)
  run('changed-source-ux',[node,'--test','tests/ready-thread-speed.test.mjs','tests/ready-thread-loading.test.mjs','tests/app-native-thread.test.mjs','tests/thread-draft-admission.test.mjs','tests/wisdom-hosted-thread.test.mjs'],ux,180)
  # Observer/content modules are unchanged; count selection is independently recounted below.
  for label,profile in [('baseline','baseline-missing-cell'),('candidate','live-integration')]:
   run(label+'-focused',[node,tools/'acceptance.mjs',root/'sources'/f'{label}-service',root/'sources'/f'{label}-ux',evidence/label,label],root,600,{'READY_SPEED_FOCUS':profile})
   try:r[label]=validate_side(label)
   except Exception as e:r['failures'].append(label+' focused: '+repr(e))
   save()
  assert r['baseline']['taps']==30 and r['candidate']['taps']==12
  assert r['baseline']['stale_counterproofs']==30 and r['candidate']['stale_counterproofs']==4
  r['pass']=len(r['phases'])==3 and not r['failures']
 else:
  run('service-node',[node,'--test','tests/ready-thread-speed.node.mjs','tests/session-list-cache.node.mjs','tests/session-list-cache-http.node.mjs','tests/open-ask.node.mjs','tests/incognito.node.mjs'],service,300)
  run('service-correctness',[node,root/'runtime-deps/node_modules/vitest/vitest.mjs','run','--no-cache','--maxWorkers=1','tests/owned-open-work.test.ts','tests/helper-status.test.ts','tests/owed-helper-work.test.ts','tests/helper-continuation-evidence.test.ts','tests/heavy-wait.test.ts','tests/heavy-status.test.ts','tests/session-truth-seek.test.ts'],service,420)
  run('ux-correctness',[node,'--test','tests/ready-thread-speed.test.mjs','tests/ready-thread-loading.test.mjs','tests/helper-working-no-ready-blip.test.mjs','tests/thread-reading-spot.test.mjs','tests/outbox-voice-reload-handoff.test.mjs'],ux,300)
  run('harness-regressions',[node,'--test',tools/'cache-evidence.test.mjs',tools/'paint-probe.test.mjs',tools/'batch-preparation.test.mjs'],ux,180)
  for label in ['baseline','candidate']:
   run(label+'-overlap-and-taps',[node,tools/'acceptance.mjs',root/'sources'/f'{label}-service',root/'sources'/f'{label}-ux',evidence/label,label],root,800)
   try:r[label]=validate_side(label)
   except Exception as e:r['failures'].append(label+' matrix: '+repr(e))
   save()
  run('scoped-browser',[node,tools/'scope-browser.mjs',service,ux,evidence/'scopes'],root,300)
  scoped=json.loads((evidence/'scopes/results.json').read_text());assert scoped['pass'] and scoped['count']==scoped['expected']==24 and scoped['positive_count']==20 and scoped['legacy_count']==4
  assert len(scoped['cells'])==24 and len({(c['shell'],c['skin'],c['kind']) for c in scoped['cells']})==24
  assert all(c['pass'] for c in scoped['cells']);r['scopes']={'fresh':True,'count':24,'positive':20,'legacy':4,'pass':True}
  verify();r['post_run_source_deps_tools_prior_verified']=True
  r['pass']=len(r['phases'])==7 and not r['failures']
 verify();r['post_run_source_deps_tools_prior_verified']=True
except Exception as e:r['pass']=False;r['failures'].append(repr(e))
r['limits']=['Focused recovery uses inherited SHA-bound evidence; new integration samples are not a fresh statistical matrix or deployment proof.','Baseline budgets and missing skeleton/retry are measurements, never candidate passes.','The 45 s exact whole-batch revision barrier is unmeasured fixture preparation; all speed budgets and counts are unchanged.','Server-only full mandatory acceptance is separately owned by parent rss2; this job supplies fresh focused correctness and exact-pair browser/API gates.','Previous passed and failed evidence is immutable provenance only, not relabelled as this full run.','Screenshots, CPU profiles, actual serving lineage, release/parity and rollback still require parent review before activation.']
save();print(json.dumps({'pass':r['pass'],'full_acceptance':r['full_acceptance'],'report':str(evidence/'report.json'),'failures':r['failures']}),flush=True)
sys.exit(0 if r['pass'] else 1)
