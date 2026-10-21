#!/usr/bin/env python3
"""Photos backup release chain (runs on Thales under one heavy lease).
1. Full Photos backup E2E + signed release build (qa_photos_backup_thales.py).
2. Upgrade rehearsal: published OLD release -> this signed release, in place (qa_upgrade.py).
Exits nonzero if either step fails.
usage: qa_photos_release_chain.py --old-apk PATH -- <qa_photos_backup_thales.py args>"""
import json, os, pathlib, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
args = sys.argv[1:]
assert args[0] == '--old-apk' and args[2] == '--', __doc__
old_apk, rig_args = pathlib.Path(args[1]), args[3:]
rel = pathlib.Path(rig_args[rig_args.index('--release-job') + 1])
# Children reuse the heavy lease's inherited worker.lock fd; subprocess closes fds unless passed explicitly.
_fd = os.environ.get('WIZARD_HEAVY_LOCK_FD')
keep = (int(_fd),) if _fd else ()

rc = subprocess.run([sys.executable, str(here / 'qa_photos_backup_thales.py'), *rig_args], pass_fds=keep).returncode
if rc:
    print(json.dumps({'chain': 'fail', 'step': 'photos-e2e', 'rc': rc})); sys.exit(rc)

new_apk = rel / 'source/android/app/build/outputs/apk/release/app-release.apk'
assert new_apk.is_file() and old_apk.is_file(), (new_apk, old_apk)
upgrade = here / 'qa_upgrade.py'
if not upgrade.is_file():
    upgrade = rel / 'source/tools/qa_upgrade.py'
p = subprocess.run([sys.executable, str(upgrade), str(old_apk), str(new_apk)], capture_output=True, text=True, pass_fds=keep)
print(p.stdout[-4000:]); print(p.stderr[-2000:], file=sys.stderr)
fails = [l for l in p.stdout.splitlines() if l.startswith('FAIL')]
ok = p.returncode == 0 and not fails and 'PASS' in p.stdout
print(json.dumps({'chain': 'pass' if ok else 'fail', 'step': 'upgrade', 'rc': p.returncode, 'fails': fails}))
sys.exit(0 if ok else 1)
