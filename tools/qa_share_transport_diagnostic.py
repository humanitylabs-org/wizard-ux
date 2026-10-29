#!/usr/bin/env python3
"""One first-notification transport observation; NEVER full acceptance.

Stage beside unchanged qa_share_notification.py + its seal.json. Parent admits
only after reviewing the separate diagnostic seal. No build/sign/deploy/retry.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True


class FirstNotificationObserved(RuntimeError):
    pass


def first_only(capture):
    def observed(*args, **kwargs):
        capture(*args, **kwargs)  # includes BOTH native and compositor screenshots
        raise FirstNotificationObserved('diagnostic first-notification boundary reached; second Send forbidden')
    return observed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--diagnostic-seal-sha256', required=True)
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('transport_notification_runner', root / 'qa_share_notification.py')
    assert spec is not None and spec.loader is not None
    q = importlib.util.module_from_spec(spec); spec.loader.exec_module(q)
    binding = root / 'diagnostic-seal.json'
    if q.sha(binding) != args.diagnostic_seal_sha256:
        raise ValueError('diagnostic seal mismatch')
    diag = json.loads(binding.read_text())
    if diag['root'] != str(root) or diag['runner_sha256'] != q.sha(__file__):
        raise ValueError('diagnostic runner identity mismatch')
    if diag['full_acceptance'] is not False or diag['second_send_permitted'] is not False:
        raise ValueError('not a diagnosis-only binding')
    q.verify(root, diag['notification_seal_sha256'])
    if args.preflight:
        sys.argv = [str(root / 'qa_share_notification.py'), '--seal-sha256', diag['notification_seal_sha256'], '--preflight']
        return q.main()
    # The unchanged inner runner catches failures, retains evidence and performs
    # its existing exact-serial teardown. The first successful capture ALSO fails
    # closed at our sentinel, before second share/Send; it cannot emit a PASS.
    setattr(q, 'capture_notification', first_only(q.capture_notification))
    os.environ['WIZARD_QA_CDP_DIAGNOSTIC'] = '1'
    sys.argv = [str(root / 'qa_share_notification.py'), '--seal-sha256', diag['notification_seal_sha256']]
    rc = q.main()
    out = root / 'android-evidence'
    a = json.loads((out / 'acceptance.json').read_text())
    if rc != 1 or a['status'] != 'FAIL' or len(a['deliveries']) > 1 or a['notifications']:
        raise RuntimeError('diagnostic boundary invariant failed')
    result = {'status': 'REVIEW_REQUIRED_DIAGNOSTIC_ONLY', 'full_acceptance': False,
              'source_revision': a['revision'], 'inner_status': a['status'],
              'second_send_permitted': False, 'cause_established': False,
              'native_cleanup_complete': bool(a.get('emulator', {}).get('serial_absent') and
                    a.get('owned_avd_removed_after_serial_absent') and not a.get('cleanup_errors')),
              'inner_receipt_sha256': q.sha(out / 'acceptance.json'),
              'transport_logs': {p.name: q.sha(p) for p in out.glob('cdp-transport-*.json')}}
    (out / 'transport-diagnostic.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    # An observed failure or first-artifact stop is not an acceptance success.
    return 1


if __name__ == '__main__':
    sys.exit(main())
