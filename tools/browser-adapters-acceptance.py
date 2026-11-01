"""Parent-admitted synthetic acceptance. Preflight never starts a browser.
Run with the immutable manifest hash. A receipt preserves every phase failure.
The browser report retains the synthetic service trace for its final run check.
"""
import argparse, hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent
p = argparse.ArgumentParser()
p.add_argument('--manifest', required=True)
p.add_argument('--manifest-sha256', required=True)
p.add_argument('--verify-only', action='store_true')
a = p.parse_args()
mp = Path(a.manifest).resolve()
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
assert sha(mp) == a.manifest_sha256, 'manifest drift'
m = json.loads(mp.read_text())
assert mp.parent.is_relative_to(Path(m['env']['WIZARD_WORK_ROOT']).resolve()), 'configured scratch root required'
assert Path(m['env']['TMPDIR']).parent.is_dir(), 'prepare TMPDIR parent before admission'
# Service parity fixtures add this suffix to TMPDIR. Keep the immutable source
# and evidence roots descriptive, but the actual runtime path comfortably short.
socket_sample = Path(m['env']['TMPDIR'])/'parity-XXXXXX/os/agents/parity-agent/gateway/ingress.sock'
assert len(os.fsencode(socket_sample)) < 100, 'synthetic ingress socket path too long: '+str(socket_sample)
for fresh in [mp.parent/'evidence', mp.parent/'synthetic-home', Path(m['env']['TMPDIR'])]:
    assert not fresh.exists(), 'stage already consumed: '+str(fresh)
assert sha(__file__) == m['runner_sha256'], 'runner drift'
for repo, row in m['sources'].items():
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=row['path'],text=True).strip() == row['head'], repo+' HEAD drift'
    assert not subprocess.check_output(['git','status','--porcelain'],cwd=row['path'],text=True).strip(), repo+' dirty'
for name, digest in m['files'].items():
    assert sha(name) == digest, 'input drift: '+name
for name in m['executables']:
    assert os.access(name,os.X_OK), 'missing executable: '+name
for name in m['link_check']:
    r=subprocess.run(['ldd',name],text=True,capture_output=True)
    assert r.returncode == 0 and 'not found' not in r.stdout+r.stderr, 'unavailable linker input: '+name
for check in m['syntax_checks']:
    subprocess.run(check,check=True,cwd=mp.parent,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
print(json.dumps({'verified':True,'scope':'static preflight only' if a.verify_only else 'parent-admitted acceptance','manifest_sha256':sha(mp)}),flush=True)
if a.verify_only:
    sys.exit(0)
out=mp.parent/'evidence';out.mkdir()  # Never reuse/overwrite a prior run.
home=mp.parent/'synthetic-home';home.mkdir()
marker=Path(m['env']['TMPDIR']);marker.mkdir(parents=True,exist_ok=False)
env={'LANG':'C.UTF-8','CI':'1','PATH':m['path'],'HOME':str(home),'WIZARD_OS_HOME':str(home/'.wizard-os'),'HERMES_HOME':str(home/'.hermes'),'PYTHONDONTWRITEBYTECODE':'1',**m['env']}
def owned_pids():
    pids=set()
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal() or int(proc.name) in {1,os.getpid(),os.getppid()}:continue
        try:
            if proc.stat().st_uid != os.getuid():continue
            if ('TMPDIR='+str(marker)).encode() in (proc/'environ').read_bytes().split(b'\0'):pids.add(int(proc.name))
        except (OSError,ProcessLookupError):pass
    return pids
assert not owned_pids(), 'preexisting fixture children'
rows=[]
try:
    for step in m['steps']:
        log=out/(step['name']+'.log');start=time.monotonic();timed_out=False;code=None
        with log.open('wb') as f:
            proc=subprocess.Popen(step['argv'],cwd=step['cwd'],env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
            try:code=proc.wait(timeout=step['timeout'])
            except subprocess.TimeoutExpired:
                timed_out=True;code=124
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                proc.wait(timeout=10)
        row={'name':step['name'],'exit_code':code,'timeout':timed_out,'seconds':time.monotonic()-start,'log_sha256':sha(log),'passed':code==0 and not timed_out}
        rows.append(row);print(json.dumps(row),flush=True)
        # Preserve failures and continue: browser screenshots remain valuable even
        # if an unrelated full-suite baseline is already red.
finally:
    for sig in [signal.SIGTERM,signal.SIGKILL]:
        for pid in owned_pids():
            try:os.kill(pid,sig)
            except ProcessLookupError:pass
        end=time.monotonic()+3
        while owned_pids() and time.monotonic()<end:time.sleep(.1)
    survivors=sorted(owned_pids())
    result={'complete':len(rows)==len(m['steps']),'passed':len(rows)==len(m['steps']) and all(r['passed'] for r in rows) and not survivors,'release_ready':False,'manifest_sha256':sha(mp),'sources':m['sources'],'steps':rows,'children_absent':not survivors,'survivors':survivors,'screenshots_inspected':False}
    (out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)
if not result['passed']:sys.exit(1)
