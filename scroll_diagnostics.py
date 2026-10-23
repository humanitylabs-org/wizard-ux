"""Append-only, bounded private shell diagnostics. No public read/list endpoint."""
import json
import os
import re
from pathlib import Path
import threading
import time
import uuid

LIMIT = 256 * 1024
LOCK = threading.Lock()
PATH = '/wizard-os-home/api/diagnostics/scroll-capture'


def _capture_detail(d):
    # Null is expected when discovery stopped before hit testing. Never accept text/URLs
    # or extra keys just because a new native diagnostic field was added.
    if d is None:
        return True
    if not isinstance(d, dict) or set(d) != {'scroller','port','vh','vw','vv','blockers','floaters','band'}:
        return False
    def label(v): return isinstance(v, str) and bool(re.fullmatch(r'[a-zA-Z0-9#._-]{1,80}', v))
    def nums(v,n): return isinstance(v,list) and len(v)==n and all(type(x) in (int,float) for x in v)
    if not label(d['scroller']) or not nums(d['port'],4) or not nums(d['band'],2): return False
    if not all(type(d[k]) in (int,float) for k in ('vh','vw')) or (d['vv'] is not None and not nums(d['vv'],2)): return False
    if not isinstance(d['floaters'],list) or len(d['floaters'])>4 or not all(label(v) for v in d['floaters']): return False
    if not isinstance(d['blockers'],list) or len(d['blockers'])>4: return False
    for b in d['blockers']:
        if not isinstance(b,dict) or set(b) != {'el','rect','pos','z','pe','up'}: return False
        if not label(b['el']) or not nums(b['rect'],4): return False
        if b['pos'] not in ('static','relative','absolute','fixed','sticky'): return False
        if b['pe'] not in ('auto','none') or not isinstance(b['z'],str) or not re.fullmatch(r'auto|-?\d+',b['z']): return False
        if not isinstance(b['up'],str) or not re.fullmatch(r'[a-zA-Z0-9#._-]{0,80}<[a-zA-Z0-9#._-]{0,80}',b['up']): return False
    return True


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
                 'densityDpi', 'height', 'extent', 'dpr', 'vw', 'left', 'right', 'bottom', 'cancelled',
                 'detail', 'ok', 'granted', 'ours', 'pauseWanted'}
    if set(payload['session']) - session_keys:
        raise ValueError('session fields')
    for event in payload['events']:
        if not isinstance(event, dict) or set(event) - {'seq', 'uptimeMs', 'thread', 'method', 'data', 'callers'}:
            raise ValueError('event fields')
        if not isinstance(event.get('data'), dict) or set(event['data']) - data_keys:
            raise ValueError('data fields')
        data = event['data']
        if 'detail' in data:
            detail = data['detail']
            if event.get('method') != 'search.detail' or not _capture_detail(detail):
                raise ValueError('capture detail')
        if 'pauseWanted' in data and (event.get('method') != 'capture.render' or not isinstance(data['pauseWanted'], bool)):
            raise ValueError('capture render')
        if 'ok' in data and not isinstance(data['ok'], bool):
            raise ValueError('capture result')
        for key in ('granted', 'ours'):
            if key in data and (event.get('method') != 'start.result' or not isinstance(data[key], str) or
                                not re.fullmatch(r'(?:|null|Rect\(-?\d+, -?\d+ - -?\d+, -?\d+\))', data[key])):
                raise ValueError('capture rect')
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
