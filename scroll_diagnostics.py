"""Append-only, bounded private shell diagnostics. No public read/list endpoint."""
import json
import os
from pathlib import Path
import threading
import time
import uuid

LIMIT = 256 * 1024
LOCK = threading.Lock()
PATH = '/wizard-os-home/api/diagnostics/scroll-capture'


def store(body, root=None):
    if not body or len(body) > LIMIT:
        raise ValueError('size')
    payload = json.loads(body)
    if not isinstance(payload, dict) or set(payload) != {'schema', 'session', 'events'} or payload['schema'] != 1:
        raise ValueError('schema')
    if not isinstance(payload['session'], dict) or not isinstance(payload['events'], list) or len(payload['events']) > 400:
        raise ValueError('schema')
    # The client never sends page content. Reject accidental additions rather than silently persisting them.
    session_keys = {'id', 'manufacturer', 'model', 'sdk', 'appVersion', 'versionCode', 'oneui',
                    'webviewPackage', 'webviewVersion', 'accessibilityServices'}
    data_keys = {'reason', 'direction', 'result', 'proxy', 'x', 'y', 'deltaX', 'deltaY', 'scrollY', 'rangeY',
                 'maxOverY', 'touch', 'present', 'scrollable', 'actions', 'childCount', 'virtualId', 'count',
                 'action', 'arguments', 'source', 'toolType', 'flags', 'deviceId', 'zeroDeviceId', 'downCount',
                 'moveCount', 'upCount', 'startY', 'endY', 'hasFocus', 'top', 'orientation', 'widthDp', 'heightDp',
                 'densityDpi', 'height', 'extent', 'dpr', 'vw', 'left', 'right', 'bottom', 'cancelled'}
    if set(payload['session']) - session_keys:
        raise ValueError('session fields')
    for event in payload['events']:
        if not isinstance(event, dict) or set(event) - {'seq', 'uptimeMs', 'thread', 'method', 'data', 'callers'}:
            raise ValueError('event fields')
        if not isinstance(event.get('data'), dict) or set(event['data']) - data_keys:
            raise ValueError('data fields')
    root = root or Path(os.environ.get('WIZARD_SCROLL_DIAGNOSTICS_DIR',
        str(Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes')) / 'data/apps/wizard-os-diagnostics/scroll-capture')))
    root = Path(root)
    with LOCK:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        name = f'{time.time_ns()}-{uuid.uuid4().hex[:8]}.json'
        fd = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        # Retention removes oldest records only; existing records are never overwritten.
        for old in sorted(root.glob('*.json'))[:-50]:
            old.unlink()
    return name
