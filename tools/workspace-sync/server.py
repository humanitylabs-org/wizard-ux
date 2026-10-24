#!/usr/bin/env python3
"""Workspace sync: one box-wide copy of the owner's workspaces (desks and the apps in them), shared by every
Wizard client (phone, desktop, other devices) over the owner's tailnet.

  GET  /wizard-os-home/workspace-sync/api/state?since=<rev>&wait=<s>   long-poll; returns {rev, state, closed, device, at}
  PUT  /wizard-os-home/workspace-sync/api/state  {baseRev, device, state}   200 {rev, ...} | 409 {rev, state, ...} (stale base)

Loopback only; Tailscale Serve mounts it on the shell origins, so only the owner's tailnet reaches it.
Window positions and the current desk stay on each device; this stores only which desks exist, their order,
the apps in them and the page or thread each app has open. Closed desks are kept briefly so any device can reopen them.
The upstream home for this API is the Agent Service (/wizard/v1/workspaces); this is the owner-box candidate.
"""
import json, os, re, threading, time, http.server, urllib.parse

PATH = os.path.expanduser(os.environ.get('WORKSPACE_SYNC_FILE', '~/.wizard-os/workspace-sync.json'))
PORT = int(os.environ.get('WORKSPACE_SYNC_PORT', '8824'))
PREFIX = '/wizard-os-home/workspace-sync/api'
MAX_BODY = 512 * 1024
MAX_DESKS, MAX_WINS, MAX_CLOSED = 40, 12, 12
APPS = {'chats', 'frame', 'review', 'maps', 'feature'}
ID = re.compile(r'^[A-Za-z0-9_~-]{1,40}$')
STR_FIELDS = {'appId': 120, 'url': 2048, 'thread': 200, 'agent': 120, 'chatsProvider': 120, 'title': 200,
              'dest': 300, 'mode': 40, 'query': 300, 'featureId': 120}

lock = threading.Condition()


def clean_win(w):
    if not isinstance(w, dict) or not isinstance(w.get('id'), str) or not ID.match(w['id']) or w.get('app') not in APPS:
        return None
    out = {'id': w['id'], 'app': w['app']}
    for k, n in STR_FIELDS.items():
        v = w.get(k)
        if isinstance(v, str) and 0 < len(v) <= n and not re.search(r'[\x00-\x1f\x7f]', v):
            out[k] = v
    for k in ('z', 'featureOptions'):  # small JSON objects owned by the review/feature views
        v = w.get(k)
        if isinstance(v, dict) and len(json.dumps(v)) <= 2000:
            out[k] = v
    return out


def clean_state(s):
    if not isinstance(s, dict) or not isinstance(s.get('desks'), list):
        return None
    desks, seen_d, seen_w = [], set(), set()
    for d in s['desks'][:MAX_DESKS]:
        if not isinstance(d, dict) or not isinstance(d.get('id'), str) or not ID.match(d['id']) or d['id'] in seen_d:
            continue
        wins = []
        for w in (d.get('wins') if isinstance(d.get('wins'), list) else [])[:MAX_WINS]:
            c = clean_win(w)
            if c and c['id'] not in seen_w:
                seen_w.add(c['id']); wins.append(c)
        if wins:
            seen_d.add(d['id']); desks.append({'id': d['id'], 'wins': wins})
    return {'desks': desks}


def load():
    try:
        with open(PATH) as f:
            j = json.load(f)
        if isinstance(j, dict) and isinstance(j.get('rev'), int):
            j['state'] = clean_state(j.get('state')) or {'desks': []}
            j.setdefault('closed', [])
            return j
    except Exception:
        pass
    return {'rev': 0, 'state': {'desks': []}, 'closed': [], 'device': '', 'at': ''}


DB = load()


def save():
    tmp = PATH + '.tmp'
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(tmp, 'w') as f:
        json.dump(DB, f)
    os.replace(tmp, PATH)


def closed_desks(old, new, device):
    """Desks that vanished along with their windows (a window moved to another desk is not a close)."""
    alive = {w['id'] for d in new['desks'] for w in d['wins']}
    ids = {d['id'] for d in new['desks']}
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    out = []
    for d in old['desks']:
        if d['id'] in ids:
            continue
        gone = [w for w in d['wins'] if w['id'] not in alive]
        if gone:
            out.append({'desk': {'id': d['id'], 'wins': gone}, 'closedAt': now, 'device': device})
    return out


def snapshot():
    return {k: DB[k] for k in ('rev', 'state', 'closed', 'device', 'at')}


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def route(self):
        u = urllib.parse.urlsplit(self.path)
        return u.path.rstrip('/'), urllib.parse.parse_qs(u.query)

    def do_GET(self):
        path, q = self.route()
        if path == PREFIX + '/health':
            return self.send(200, {'ok': True, 'rev': DB['rev']})
        if path != PREFIX + '/state':
            return self.send(404, {'error': 'not_found'})
        try:
            since = int(q.get('since', ['-1'])[0]); wait = max(0.0, min(25.0, float(q.get('wait', ['0'])[0])))
        except ValueError:
            return self.send(400, {'error': 'bad_query'})
        with lock:
            end = time.time() + wait
            while DB['rev'] <= since and time.time() < end:
                lock.wait(end - time.time())
            return self.send(200, snapshot())

    def do_PUT(self):
        path, _ = self.route()
        if path != PREFIX + '/state':
            return self.send(404, {'error': 'not_found'})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            return self.send(413, {'error': 'too_large'})
        try:
            body = json.loads(self.rfile.read(n))
        except Exception:
            return self.send(400, {'error': 'bad_json'})
        state = clean_state(body.get('state') if isinstance(body, dict) else None)
        if state is None or not isinstance(body.get('baseRev'), int):
            return self.send(400, {'error': 'bad_state'})
        device = body.get('device') if isinstance(body.get('device'), str) else ''
        device = re.sub(r'[\x00-\x1f\x7f]', '', device)[:60]
        with lock:
            if body['baseRev'] != DB['rev']:
                return self.send(409, snapshot())
            if state != DB['state']:
                gone = closed_desks(DB['state'], state, device)
                back = {d['id'] for d in state['desks']} | {w['id'] for d in state['desks'] for w in d['wins']}
                closed = [c for c in DB['closed'] if c['desk']['id'] not in back and not any(w['id'] in back for w in c['desk']['wins'])]
                DB['closed'] = (gone[::-1] + closed)[:MAX_CLOSED]
                DB.update(rev=DB['rev'] + 1, state=state, device=device, at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
                save()
                lock.notify_all()
            return self.send(200, snapshot())

    def do_POST(self):  # forget one recently closed desk: {desk: <id>}
        path, _ = self.route()
        if path != PREFIX + '/closed/forget':
            return self.send(404, {'error': 'not_found'})
        n = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(min(n, 4096)) or b'{}')
        except Exception:
            return self.send(400, {'error': 'bad_json'})
        with lock:
            before = len(DB['closed'])
            DB['closed'] = [c for c in DB['closed'] if c['desk']['id'] != body.get('desk')]
            if len(DB['closed']) != before:
                DB['rev'] += 1; save(); lock.notify_all()
            return self.send(200, snapshot())

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):  # a device that closed its long-poll is not an error
        import sys
        if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            super().handle_error(request, client_address)


if __name__ == '__main__':
    srv = Server(('127.0.0.1', PORT), H)
    srv.serve_forever()
