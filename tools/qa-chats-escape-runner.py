#!/usr/bin/env python3
"""Browser-only continuation; inherit exact unchanged source-bound unit evidence."""
import argparse,hashlib,json,os,pathlib,re,signal,subprocess,threading,time,http.server,functools
p=argparse.ArgumentParser();p.add_argument('--stage',required=True);p.add_argument('--playwright',required=True);p.add_argument('--chrome',required=True);p.add_argument('--tmp-root',required=True);a=p.parse_args()
stage=pathlib.Path(a.stage).resolve();out=stage/'evidence';out.mkdir(exist_ok=False)
manifest=json.loads((stage/'manifest.json').read_text());summary={'phases':[],'cleanup':[],'manifest_sha256':hashlib.sha256((stage/'manifest.json').read_bytes()).hexdigest()}
def save(): (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inventory(root):return {str(x.relative_to(root)):digest(x) for x in sorted(root.rglob('*')) if x.is_file()}
def verify_sources(root,m):
 for name in ['baseline','candidate']:
  assert inventory(root/name)==m['sources'][name]['files'], 'Source drift '+str(root/name)
  for rel,mode in m['sources'][name]['modes'].items():assert (root/name/rel).stat().st_mode & 0o777 == mode, 'Source mode drift '+name+'/'+rel
 for name,h in m['archives'].items():assert digest(root/name)==h,'Archive drift '+str(root/name)
def verify():
 verify_sources(stage,manifest)
 assert digest(pathlib.Path(__file__))==manifest['runner_sha256'],'Runner drift'
 assert digest(stage/'candidate/tools/qa-chats-escape-runner.py')==manifest['runner_sha256'],'Source runner mismatch'
 assert digest(pathlib.Path(a.chrome))==manifest['tools']['chrome_sha256'],'Chrome drift'
 assert inventory(pathlib.Path(a.playwright))==manifest['tools']['playwright_files'],'Playwright drift'
 assert inventory(pathlib.Path(a.playwright).with_name('playwright-core'))==manifest['tools']['playwright_core_files'],'Playwright core drift'
 i=manifest['inheritance'];old=pathlib.Path(i['stage'])
 assert digest(old/'manifest.json')==i['manifest_sha256'],'Inherited manifest drift'
 prior=json.loads((old/'manifest.json').read_text());verify_sources(old,prior)
 assert inventory(old/'evidence')==i['evidence_files'],'Inherited evidence drift'
 assert digest(pathlib.Path(i['worker_log']))==i['worker_log_sha256'],'Failed worker log drift'
 assert digest(old/'runner.py')==prior['runner_sha256'],'Inherited runner drift'
 # Full dependency closure outside the exact two fixture/runner changes.
 for name in ['baseline','candidate']:
  before=prior['sources'][name]['files'];after=manifest['sources'][name]['files']
  assert set(before)==set(after),'Source member drift '+name
  changes=sorted(k for k in before if before[k]!=after[k])
  assert changes==(i['allowed_changes'] if name=='candidate' else []),('Unexpected changed dependency',name,changes)
 prior_summary=json.loads((old/'evidence/summary.json').read_text())
 assert prior_summary['passed'] is False and all(not row['survivors'] for row in prior_summary['cleanup'])
 for expected in i['phases']:
  actual=next(x for x in prior_summary['phases'] if x['name']==expected['name']);assert actual==expected,'Inherited phase drift'
  log=pathlib.Path(actual['log']);assert digest(log)==actual['sha256'],'Inherited phase bytes drift'
  text=log.read_text()
  if actual['name']=='baseline-unit':assert actual['exit']==1 and '# pass 4' in text and '# fail 7' in text and 'not ok 1 - Escape in split search clears query' in text
  elif actual['name']=='candidate-unit':assert actual['exit']==0 and '# pass 11' in text and '# fail 0' in text
  else:assert actual['name']=='search-adjacent' and actual['exit']==0 and '# pass 1' in text and '# fail 0' in text
 summary['inherited_phases']=i['phases'];summary['inherited_job']=i['job_id']
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,format,*args):pass
 def do_POST(self):self.send_error(405)
 def do_PUT(self):self.send_error(405)
 def do_PATCH(self):self.send_error(405)
 def do_DELETE(self):self.send_error(405)
def cleanup(marker):
 def found():
  ids=[]
  for f in pathlib.Path('/proc').glob('[0-9]*/environ'):
   try:
    pid=int(f.parent.name)
    if pid>1 and pid!=os.getpid() and ('TMPDIR='+str(marker)).encode() in f.read_bytes().split(b'\0'):ids.append(pid)
   except (OSError,ValueError):pass
  return ids
 before=found()
 for sig in [signal.SIGTERM,signal.SIGKILL]:
  for pid in found():
   try:os.kill(pid,sig)
   except ProcessLookupError:pass
  if found():time.sleep(.5)
 after=found();summary['cleanup'].append({'marker':str(marker),'found':before,'survivors':after});save();assert not after,'Owned process survived'
def run(name,argv,env,timeout):
 log=out/(name+'.log');marker=pathlib.Path(a.tmp_root)/name;marker.mkdir(parents=True,exist_ok=False)
 e=dict(os.environ,**env,TMPDIR=str(marker),PYTHONDONTWRITEBYTECODE='1');proc=None;code=None
 try:
  with log.open('w') as f:
   proc=subprocess.Popen(argv,cwd=stage,env=e,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
   try:code=proc.wait(timeout=timeout)
   except subprocess.TimeoutExpired:
    os.killpg(proc.pid,signal.SIGKILL);proc.wait();code=124
 finally:
  if proc and proc.poll() is None:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
  cleanup(marker)
 summary['phases'].append({'name':name,'argv':argv,'exit':code,'log':str(log),'sha256':digest(log)});save();return code,log.read_text()
try:
 verify();summary['preflight_verified']=True;save()
 browser_failures=[]
 for name in ['baseline','candidate']:
  tree=stage/name;server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(tree/'web')))
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  # The fixture fulfills static assets only below this shell prefix.
  origin='http://127.0.0.1:'+str(server.server_port)+'/wizard-os-home/'
  try:
   env={'QA_WEB_DIR':str(tree),'QA_PLAYWRIGHT':a.playwright,'QA_CHROME':a.chrome,'QA_OUT':str(out/(name+'-browser')),'QA_ORIGIN':origin}
   code,_=run(name+'-browser',['node',str(stage/'candidate/qa-chats-search-escape.cjs'),origin],env,200)
  finally:
   server.shutdown();server.server_close();thread.join(timeout=5)
   summary.setdefault('servers',[]).append({'source':name,'origin':origin,'thread_alive':thread.is_alive(),'socket_closed':server.socket.fileno()==-1});save()
  try:
   report=json.loads((out/(name+'-browser/results.json')).read_text());rs=report['results']
   assert [x['name'] for x in rs]==manifest['browser_cases'],'Incomplete/duplicate browser case inventory '+name
   focused=next(x for x in rs if x['name']=='desktop focused search Escape clears stored query and keeps chip/thread')
   assert not report['routeErrors'],'Synthetic route errors'
   assert not any('/v1/runs' in x for x in report['writes']),'Agent run attempted'
   for tag in ['desktop','phone']:
    for skin in ['nebula','grove']:assert (out/(name+'-browser')/(tag+'-'+skin+'.png')).is_file(),'Missing skin screenshot'
   if name=='baseline':assert code==1 and not focused['pass'],'Browser negative control did not bite original'
   else:assert code==0 and all(x['pass'] for x in rs),'Candidate browser failures'
   summary.setdefault('browser_counts',{})[name]={'pass':sum(x['pass'] for x in rs),'fail':sum(not x['pass'] for x in rs),'total':len(rs)}
  except Exception as e:browser_failures.append(name+': '+repr(e))
 assert not browser_failures,browser_failures
 verify();summary['passed']=True
except Exception as e:
 summary.update(passed=False,error=repr(e));raise
finally:
 try:verify();summary['postflight_verified']=True
 except Exception as e:summary.update(passed=False,postflight_error=repr(e))
 save()
if not summary.get('passed'):raise SystemExit(1)
