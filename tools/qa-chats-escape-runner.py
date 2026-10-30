#!/usr/bin/env python3
"""Bounded synthetic A/B shell QA. Stage only until owning parent admits this runner."""
import argparse,hashlib,json,os,pathlib,re,signal,subprocess,threading,time,http.server,functools
p=argparse.ArgumentParser();p.add_argument('--stage',required=True);p.add_argument('--playwright',required=True);p.add_argument('--chrome',required=True);p.add_argument('--tmp-root',required=True);a=p.parse_args()
stage=pathlib.Path(a.stage).resolve();out=stage/'evidence';out.mkdir(exist_ok=False)
manifest=json.loads((stage/'manifest.json').read_text());summary={'phases':[],'cleanup':[],'manifest_sha256':hashlib.sha256((stage/'manifest.json').read_bytes()).hexdigest()}
def save(): (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inventory(root):return {str(x.relative_to(root)):digest(x) for x in sorted(root.rglob('*')) if x.is_file()}
def verify():
 for name in ['baseline','candidate']:assert inventory(stage/name)==manifest['sources'][name]['files'], 'Source drift '+name
 assert digest(pathlib.Path(__file__))==manifest['runner_sha256'],'Runner drift'
 for name,h in manifest['archives'].items():assert digest(stage/name)==h,'Archive drift '+name
verify();save()
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
 for name in ['baseline','candidate']:
  env={'QA_SOURCE_DIR':str(stage/name)}
  code,text=run(name+'-unit',['node','--test',str(stage/'candidate/tests/desktop-chats-escape.test.cjs')],env,30)
  if name=='candidate':assert code==0 and '# pass 11' in text and '# fail 0' in text
  else:assert code==1 and 'not ok 1 - Escape in split search clears query' in text and '# fail 7' in text,'Missing original-specific negative control'
 code,_=run('search-adjacent',['node','--test',str(stage/'candidate/tests/chat-search-copy.test.mjs')],{},30);assert code==0
 browser_failures=[]
 for name in ['baseline','candidate']:
  tree=stage/name;server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(tree/'web')))
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  origin='http://127.0.0.1:'+str(server.server_port)+'/'
  try:
   env={'QA_WEB_DIR':str(tree),'QA_PLAYWRIGHT':a.playwright,'QA_CHROME':a.chrome,'QA_OUT':str(out/(name+'-browser')),'QA_ORIGIN':origin}
   code,_=run(name+'-browser',['node',str(stage/'candidate/qa-chats-search-escape.cjs'),origin],env,200)
  finally:server.shutdown();server.server_close();thread.join(timeout=5)
  try:
   report=json.loads((out/(name+'-browser/results.json')).read_text());rs=report['results']
   assert len(rs)==18, 'Incomplete browser case inventory '+name+': '+str(len(rs))
   focused=next(x for x in rs if x['name']=='desktop focused search Escape clears stored query and keeps chip/thread')
   if name=='baseline':assert code==1 and not focused['pass'],'Browser negative control did not bite original'
   else:assert code==0 and all(x['pass'] for x in rs),'Candidate browser failures'
  except Exception as e:browser_failures.append(name+': '+repr(e))
 assert not browser_failures,browser_failures
 verify();summary['passed']=True
except Exception as e:
 summary.update(passed=False,error=repr(e));raise
finally:save()
