#!/usr/bin/env python3
"""Hash-bound forum acceptance. --preflight is browser-free; parent owns queue admission."""
import argparse, hashlib, json, os, pathlib, signal, subprocess, time
p = argparse.ArgumentParser()
p.add_argument('--stage', required=True)
p.add_argument('--preflight', action='store_true')
a = p.parse_args()
stage = pathlib.Path(a.stage).resolve()
manifest = json.loads((stage / 'manifest.json').read_text())
summary = {'phases': [], 'cleanup': [], 'manifest_sha256': hashlib.sha256((stage / 'manifest.json').read_bytes()).hexdigest()}
def digest(file): return hashlib.sha256(file.read_bytes()).hexdigest()
def inventory(root): return {str(f.relative_to(root)): {'sha256': digest(f), 'mode': f.stat().st_mode & 0o777} for f in sorted(root.rglob('*')) if f.is_file()}
def verify():
    for name in ['baseline', 'candidate']:
        assert inventory(stage / name) == manifest['sources'][name]['files'], 'Source drift: ' + name
    for name, sha in manifest['archives'].items():
        assert digest(stage / name) == sha, 'Archive drift: ' + name
    assert digest(pathlib.Path(__file__)) == manifest['runner_sha256'], 'Runner drift'
    for name, sha in manifest['tools'].items():
        assert digest(pathlib.Path(name)) == sha, 'Dependency drift: ' + name
    assert (stage / 'candidate/qa-desktop-option-word-navigation.cjs').is_file()
    assert (stage / 'candidate/tests/desktop-option-word-navigation.test.mjs').is_file()
verify()
if a.preflight:
    print(json.dumps({'preflight': True, 'manifest_sha256': summary['manifest_sha256'], 'source_revisions': {n: manifest['sources'][n]['sha'] for n in ['baseline', 'candidate']}}))
    raise SystemExit(0)
out = stage / 'evidence'
out.mkdir(exist_ok=False)
def save(): (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
def survivors(marker):
    result = []
    for f in pathlib.Path('/proc').glob('[0-9]*/environ'):
        try:
            pid = int(f.parent.name)
            if pid != os.getpid() and ('TMPDIR=' + str(marker)).encode() in f.read_bytes().split(b'\0'): result.append(pid)
        except (OSError, ValueError): pass
    return result
def run(name, argv, env, timeout=90):
    marker = stage / 'tmp' / name
    marker.mkdir(parents=True, exist_ok=False)
    assert len(str(marker).encode()) + len('/org.chromium.Chromium.XXXXXX/SingletonSocket') < 100, 'Browser TMP path too long'
    log = out / (name + '.log')
    with log.open('w') as f:
        proc = subprocess.Popen(argv, cwd=stage / 'candidate', env=dict(os.environ, **env, TMPDIR=str(marker)), stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
        try: code = proc.wait(timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL); proc.wait(); code = 124
        finally:
            for sig in [signal.SIGTERM, signal.SIGKILL]:
                for pid in survivors(marker):
                    try: os.kill(pid, sig)
                    except ProcessLookupError: pass
                if survivors(marker): time.sleep(.3)
            remaining = survivors(marker)
            summary['cleanup'].append({'marker': str(marker), 'survivors': remaining})
            assert not remaining, 'Owned process survived'
    text = log.read_text()
    summary['phases'].append({'name': name, 'argv': argv, 'exit': code, 'log': str(log), 'sha256': digest(log)})
    save()
    return code, text
try:
    for name in ['baseline', 'candidate']:
        code, text = run(name + '-unit', ['node', '--test', str(stage / 'candidate/tests/desktop-option-word-navigation.test.mjs')], {'QA_SOURCE_ROOT': str(stage / name)})
        assert code == (1 if name == 'baseline' else 0), name + ' unit exit'
        assert '# tests 35' in text and ('# fail 29' if name == 'baseline' else '# fail 0') in text, name + ' unit count'
    failures = []
    for name in ['baseline', 'candidate']:
        env = {'QA_SOURCE_ROOT': str(stage / name), 'QA_OUT': str(out / (name + '-browser')), 'QA_PLAYWRIGHT': manifest['playwright'], 'QA_CHROME': manifest['chrome']}
        code, _ = run(name + '-browser', ['node', str(stage / 'candidate/qa-desktop-option-word-navigation.cjs')], env, 300)
        report = json.loads((out / (name + '-browser/results.json')).read_text())
        rows = report['results']
        try:
            assert not report.get('fatal'), report.get('fatal')
            assert [r['name'] for r in rows] == manifest['browser_cases'], 'Browser case inventory drift'
            assert not report['runs'] and not report['errors'], 'Run attempt or script error'
            if name == 'candidate':
                assert code == 0 and all(r['pass'] for r in rows), 'Candidate browser failures'
                for view in ['classic', 'ai-apps']:
                    for skin in ['nebula', 'grove']:
                        assert (out / (name + '-browser') / (view + '-' + skin + '-hints.png')).is_file(), 'Missing skin screenshot'
            else:
                negative = next(r for r in rows if r['name'] == 'classic-nebula ArrowLeft composer=""')
                assert code == 1 and not negative['pass'], 'Baseline negative control did not bite'
            summary.setdefault('browser_counts', {})[name] = {'pass': sum(r['pass'] for r in rows), 'fail': sum(not r['pass'] for r in rows), 'total': len(rows)}
        except Exception as e: failures.append(name + ': ' + repr(e))
    assert not failures, failures
    verify(); summary['passed'] = True
except Exception as e:
    summary.update(passed=False, error=repr(e)); raise
finally:
    try: verify(); summary['postflight_verified'] = True
    except Exception as e: summary.update(passed=False, postflight_error=repr(e))
    save()
