#!/usr/bin/env python3
"""Pinned synthetic layout proof. Run ONLY through the Forum light queue."""
import json, os, pathlib, subprocess, sys, time
ROOT = pathlib.Path('/srv/work/layout-never-classic-20261106')
OUT = ROOT / 'layout-fallback-evidence-r2'
OUT.mkdir(exist_ok=True)
os.chdir(ROOT)
env = dict(os.environ, QA_PLAYWRIGHT='/srv/work/tt-late-git/node_modules/playwright', QA_BOOT_INTERACT='0')
steps = []
def run(name, argv, extra=None, expected=0, timeout=220):
    e = dict(env, **(extra or {}))
    start = time.time()
    with (OUT / (name + '.log')).open('w') as log:
        p = subprocess.run(argv, env=e, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    step = dict(name=name, code=p.returncode, seconds=time.time()-start, log=str(OUT / (name+'.log')))
    steps.append(step)
    (OUT/'steps.json').write_text(json.dumps(steps, indent=2)+'\n')
    print(json.dumps(step), flush=True)
    if expected == 'red':
        r = json.loads((OUT/'red'/'boot-report.json').read_text())
        faults = [c.get('fault', {}) for c in r['cases']]
        assert p.returncode != 0 and any(
            f.get('after', {}).get('disabled') is True and f.get('after', {}).get('active') is False
            and f.get('sameScene') is False and f.get('sidebarVisible') is False
            and f.get('classicMenuVisible') is True
            and 'QA synthetic layout callback fault' in f.get('diagnostic', {}).get('stack', '')
            for f in faults
        ), 'Old source must execute the injected callback, disable the layout, remove AI apps and reveal Classic'
    else:
        assert p.returncode == expected, name + ' failed; read '+step['log']
run('units', ['node','--test','tests/qa-layout-callback-fault.test.mjs','tests/desktop-boot-layout.test.mjs','tests/desktop-layout-resilience.test.mjs','tests/layouts.test.mjs','tests/my-skin-script.test.mjs','tests/skin-packages.test.mjs','tests/tweak-packages.test.mjs','tests/look-sync.test.mjs','tests/stale-layout-boot.test.mjs'], timeout=90)
common = dict(QA_LAYOUT_FAULTS='1', QA_BOOT_MODES='restored-apps-chat')
run('red', ['node','tests/qa-desktop-boot-layout.cjs'], dict(common, QA_SOURCE=str(ROOT/'baseline'), QA_OUT=str(OUT/'red'), QA_SOURCE_SHA='4b1a5f1deab9bb3971c0fead465463ae6fd94883'), expected='red')
run('green', ['node','tests/qa-desktop-boot-layout.cjs'], dict(common, QA_BOOT_MODES='restored-apps-chat,restored-apps-front', QA_OUT=str(OUT/'green'), QA_SOURCE_SHA='a307620e98923ff2f1959595a722a76b86a496a1'))
run('recovery', ['node','tests/qa-desktop-boot-layout.cjs'], dict(QA_LAYOUT_BUNDLE_MISSING='1', QA_BOOT_MODES='restored-apps-chat', QA_OUT=str(OUT/'recovery')), timeout=100)
print('LAYOUT_FALLBACK_PROOF_PASS', flush=True)
