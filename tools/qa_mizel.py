#!/usr/bin/env python3
"""Mizel meeting recorder QA (runs on Thales). Fresh API35 emulator, the exact QA APK, real adb input.

usage: qa_mizel.py APK PKG [LONG_SECS=200] [OUT_DIR]

A fake meetings server on the Mac (reached from the emulator as 10.0.2.2) implements
  POST /meetings/api/meetings/{id}/chunks?source=me&seq=N&start_ms=T   (idempotent per (source, seq))
  POST /meetings/api/meetings/{id}/stop  {"final_seq":{"me":N},"reason":...}
  GET  /meetings/api/meetings/{id}       {"status": recording|processing|ready}
so no test audio reaches James's real Mizel. The debug build is pointed there by files/qa_origin.txt and given
short timers by files/qa_mizel.json (both debug-only hooks).

Pages that use window.wizardMizelPort are served on the real origin https://private.wizard001.com by CDP
Fetch interception (/mizel-qa/*, /mizel-live/*), as is a foreign origin https://example.org (iframe).

Checks
  bridge   port present on the private origin main frame, a same-origin iframe (and the real shell's iframes);
           absent on a foreign-origin iframe (f)
  long     LONG_SECS of recording with the screen off + forced Doze, a server outage and airplane mode inside it:
           contiguous seqs, start_ms = media time, every chunk acked, stop after the last chunk (a, e)
  pause    pause releases the mic (appops/audio dumps), resume re-acquires it, media time excludes the pause;
           notification Pause action; pause_timeout with the QA-short timeout (b)
  owner    side-button and Everywhere refused while a meeting records; a meeting refused while Everywhere listens (d)
  death    kill -9 mid-recording → service restarts, sends stop process_death, notification, no chunk lost;
           force-stop → next app open does the same (c)
  link     notification/deep link opens /mizel-live/#/m/<id> inside the app
  back     nested view + Back keeps the app open (g)
"""
import fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid, base64, struct
import urllib.request, urllib.parse
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
apk = P(sys.argv[1]); PKG = sys.argv[2]
LONG = int(sys.argv[3]) if len(sys.argv) > 3 else 200
job = P(sys.argv[4]) if len(sys.argv) > 4 else BASE / 'qa' / ('wos-mizel-' + uuid.uuid4().hex[:8])
job.mkdir(parents=True, exist_ok=True)
OUT = job / 'shots'; OUT.mkdir(exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5698; S = f'emulator-{PORT}'; DEVTOOLS = 9351; FAKE = 18791
ORIGIN = 'https://private.wizard001.com'
RES = []
def check(group, n, ok, d=''):
    RES.append({'group': group, 'name': n, 'ok': bool(ok), 'detail': d if isinstance(d, (str, int, float, bool, list, dict, type(None))) else str(d)})
    print(('PASS ' if ok else 'FAIL ') + f'[{group}] ' + n + (' — ' + (json.dumps(d) if not isinstance(d, str) else d)[:600] if d not in ('', None) else ''), flush=True)
def sh(*a, stdin=None, binary=False, timeout=120):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
    return r.stdout
def sx(c, timeout=60): return sh(ADB, '-s', S, 'shell', c, timeout=timeout)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name):
    try: (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
    except Exception as e: print('shot failed', name, e)
def save(name, text): (job / name).write_text(text if isinstance(text, str) else json.dumps(text, indent=1))
def ui(): sx('uiautomator dump /sdcard/ui.xml >/dev/null'); return sx('cat /sdcard/ui.xml')
def tap_text(pattern, xml=None):
    xml = xml or ui()
    for m in re.finditer(r'<node [^>]*?>', xml):
        n = m.group(0)
        for attr in ('text', 'content-desc'):
            t = re.search(' ' + attr + r'="([^"]*)"', n)
            label = t.group(1) if t else ''
            if label and re.search(pattern, label, re.I):
                b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                if b:
                    x1, y1, x2, y2 = map(int, b.groups()); sx(f'input tap {(x1 + x2) // 2} {(y1 + y2) // 2}'); return label
    return None
def mlog(pat, n=8): return sx(f'logcat -d -s WizardMizel:* | grep -E "{pat}" | tail -{n}').strip()
def wait_for(fn, secs, step=1.0):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return fn()

# ---------------------------------------------------------------- fake meetings server
LOCK = threading.Lock()
ST = {'events': [], 'chunks': {}, 'stops': {}, 'status': {}, 'down': None, 'dups': 0, 'gets': 0, 'n': 0}
def wav_info(b):
    if len(b) < 44 or b[:4] != b'RIFF' or b[8:12] != b'WAVE': return None
    fmt, ch, rate = struct.unpack('<HHI', b[20:28]); bits = struct.unpack('<H', b[34:36])[0]; data = struct.unpack('<I', b[40:44])[0]
    return {'fmt': fmt, 'ch': ch, 'rate': rate, 'bits': bits, 'data': data, 'len_ok': len(b) == 44 + data, 'dur_ms': data // 32}
class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _drop(self):
        try: self.connection.shutdown(socket.SHUT_RDWR)
        except Exception: pass
        self.close_connection = True
    def _down(self):
        d = ST['down']
        if d == 'drop': self._drop(); return True
        if d == '503': self._json(503, {'error': 'down'}); return True
        return False
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        m = re.match(r'^/meetings/api/meetings/([^/]+)$', u.path)
        if self._down(): return
        if m:
            mid = m.group(1)
            with LOCK:
                ST['gets'] += 1
                st = ST['status'].get(mid)
                if st == 'processing' and time.time() - ST['stops'][mid]['t'] > 2: st = ST['status'][mid] = 'ready'
            if not st: return self._json(404, {'error': 'meeting not found'})
            return self._json(200, {'id': mid, 'status': st})
        self._json(404, {'error': 'nope'})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        if self._down(): return
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        m = re.match(r'^/meetings/api/meetings/([^/]+)/(chunks|stop)$', u.path)
        if not m: return self._json(404, {'error': 'nope'})
        mid, kind = m.groups()
        with LOCK:
            ST['n'] += 1; order = ST['n']
            if kind == 'chunks':
                if q.get('source', [''])[0] != 'me': return self._json(400, {'error': 'source'})
                seq = int(q['seq'][0]); start = int(q['start_ms'][0]); info = wav_info(body)
                ST['events'].append({'k': 'chunk', 'mid': mid, 'seq': seq, 'start_ms': start, 'ct': self.headers.get('Content-Type'), 'n': order, 't': time.time()})
                if not info: return self._json(400, {'error': 'expected a WAV chunk'})
                ch = ST['chunks'].setdefault(mid, {})
                ST['status'].setdefault(mid, 'recording')
                if seq in ch: ST['dups'] += 1; return self._json(200, {'stored': True, 'duplicate': True})
                ch[seq] = {'start_ms': start, 'dur_ms': info['dur_ms'], 'wav': info, 'ct': self.headers.get('Content-Type'), 'n': order, 't': time.time(),
                           'peak': max((abs(x) for x in struct.unpack('<%dh' % (min(info['data'], len(body) - 44) // 2), body[44:44 + (min(info['data'], len(body) - 44) // 2) * 2])), default=0)}
                return self._json(200, {'stored': True})
            try: js = json.loads(body or b'{}')
            except Exception: js = {'_raw': body.decode(errors='replace')}
            ST['events'].append({'k': 'stop', 'mid': mid, 'body': js, 'ct': self.headers.get('Content-Type'), 'n': order, 't': time.time()})
            ST['stops'][mid] = {'body': js, 'n': order, 't': time.time(), 'count': ST['stops'].get(mid, {}).get('count', 0) + 1}
            ST['status'][mid] = 'processing'
            return self._json(200, {'id': mid, 'status': 'processing'})
srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()

def verify_meeting(group, mid, reason, expect_min_chunks=1):
    """Contiguous seqs 0..final, start_ms = media time, WAV format, stop after every chunk, reason."""
    with LOCK:
        ch = dict(ST['chunks'].get(mid, {})); stop = ST['stops'].get(mid)
    seqs = sorted(ch)
    check(group, f'{mid}: chunks arrived', len(seqs) >= expect_min_chunks, f'{len(seqs)} chunks')
    check(group, f'{mid}: seqs contiguous from 0', seqs == list(range(len(seqs))), seqs[:5] + ['…'] + seqs[-5:] if len(seqs) > 10 else seqs)
    bad_fmt = [s for s in seqs if not (ch[s]['wav']['fmt'] == 1 and ch[s]['wav']['ch'] == 1 and ch[s]['wav']['rate'] == 16000 and ch[s]['wav']['bits'] == 16 and ch[s]['wav']['len_ok'])]
    check(group, f'{mid}: every chunk is 16 kHz mono PCM16 WAV, Content-Type audio/wav', not bad_fmt and all(ch[s]['ct'] == 'audio/wav' for s in seqs), bad_fmt[:5])
    gaps = []
    for a, b in zip(seqs, seqs[1:]):
        exp = ch[a]['start_ms'] + ch[a]['dur_ms']
        if abs(ch[b]['start_ms'] - exp) > 1: gaps.append((b, ch[b]['start_ms'], exp))
    check(group, f'{mid}: start_ms = media time (each start = previous start + previous duration, ±1 ms)', seqs and ch[seqs[0]]['start_ms'] == 0 and not gaps, gaps[:5])
    full = [s for s in seqs[:-1] if ch[s]['dur_ms'] != 5000]
    media = (ch[seqs[-1]]['start_ms'] + ch[seqs[-1]]['dur_ms']) if seqs else 0
    check(group, f'{mid}: stop received once with final_seq.me = last seq and reason {reason}',
          stop and stop['body'].get('final_seq', {}).get('me') == (seqs[-1] if seqs else -1) and stop['body'].get('reason') == reason,
          {'stop': stop and stop['body'], 'count': stop and stop['count'], 'last_seq': seqs[-1] if seqs else None})
    check(group, f'{mid}: stop sent only after every chunk was stored', stop and all(ch[s]['n'] < stop['n'] for s in seqs), '')
    return {'seqs': len(seqs), 'final': seqs[-1] if seqs else None, 'media_ms': media, 'short_chunks': full, 'stop': stop and stop['body']}

PAGES = {
 '/mizel-qa/host.html': """<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>mizel-qa host</title>
<body style='background:#111;color:#eee;font:16px sans-serif'><h3>Mizel QA host</h3><div id=s></div>
<script>
window.R={pushes:[],replies:{},frames:{},levels:0,states:0};
addEventListener('message',e=>{ if(e.data&&e.data.qa) R.frames[e.data.qa]=e.data; });
const P=window.wizardMizelPort; R.hasPort=typeof P;
const W={}; let rawW=null;
if(P){P.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(x){return}; if(m.type){ if(m.type==='level')R.levels++; else {R.states++; R.last=m;} R.pushes.push(Object.assign({t:Date.now()},m)); if(R.pushes.length>600)R.pushes.splice(0,300);} else { R.replies[m.id]=m; if(W[m.id]){W[m.id](m); delete W[m.id];} else if(m.id===null && rawW){rawW(m); rawW=null;} } };}
let n=0;
window.mz=(cmd,meetingId)=>new Promise(res=>{ if(!P) return res({noport:true}); const id='q'+(++n); const o={id,cmd}; if(meetingId)o.meetingId=meetingId; W[id]=res; setTimeout(()=>{ if(W[id]){delete W[id]; res({timeout:true});} },15000); P.postMessage(JSON.stringify(o)); });
window.mzRaw=(s)=>new Promise(res=>{ rawW=res; setTimeout(()=>{ if(rawW===res){rawW=null; res({timeout:true});} },5000); P.postMessage(s); });
setInterval(()=>{document.getElementById('s').textContent=JSON.stringify(R.last||{})},500);
</script>
<iframe id=same src='/mizel-qa/frame.html' style='width:90%;height:60px'></iframe>
<iframe id=foreign src='https://example.org/qa-foreign.html' style='width:90%;height:60px'></iframe>
</body>""",
 '/mizel-qa/frame.html': """<!doctype html><meta charset=utf-8><body style='color:#9f9'>same-origin frame<script>
parent.postMessage({qa:'same', port: typeof window.wizardMizelPort},'*');
const P=window.wizardMizelPort; if(P){P.onmessage=e=>parent.postMessage({qa:'same-reply',data:e.data},'*'); P.postMessage(JSON.stringify({id:'f1',cmd:'status'}));}
</script>""",
 '/mizel-live/': """<!doctype html><meta charset=utf-8><title>mizel-live qa</title><body style='background:#123;color:#fff'>Mizel Live (QA stand-in)<div id=h></div><script>document.getElementById('h').textContent=location.href; window.QA_LIVE={href:location.href, port: typeof window.wizardMizelPort};</script>""",
 'example.org/qa-foreign.html': """<!doctype html><meta charset=utf-8><body style='color:#f99'>foreign frame<script>
let sneaky='blocked'; try { sneaky = typeof parent.wizardMizelPort; } catch(e) { sneaky = 'blocked:' + e.name; }
parent.postMessage({qa:'foreign', port: typeof window.wizardMizelPort, parentPort: sneaky, origin: location.origin},'*');
</script>""",
}

class Page:
    """Raw CDP to the app's WebView. Serves the QA pages; fails any write to real Wizard/meetings APIs."""
    def __init__(self, want='wizard-os-home'):
        pid = sx(f'pidof {PKG}').strip()
        sh(ADB, '-s', S, 'forward', f'tcp:{DEVTOOLS}', f'localabstract:webview_devtools_remote_{pid}')
        page = None; l = None
        for _ in range(60):
            try:
                l = json.load(urllib.request.urlopen(f'http://127.0.0.1:{DEVTOOLS}/json/list', timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and want in x.get('url', '')), None)
            except Exception: pass
            if page: break
            time.sleep(0.7)
        if not page:
            print('DIAG top:', top()); print('DIAG pages:', l)
            raise RuntimeError('no page ' + want)
        self.writes = []; self.served = []; self.id = 0
        u = page['webSocketDebuggerUrl']; host, path = re.match(r'ws://([^/]+)(/.*)', u).groups()
        h, p = host.split(':'); self.s = socket.create_connection((h, int(p)), timeout=30)
        key = 'dGhlIHNhbXBsZSBub25jZQ=='
        self.s.sendall(f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf: buf += self.s.recv(4096)
        self.buf = buf.split(b'\r\n\r\n', 1)[1]
        self.call('Fetch.enable', patterns=[{'urlPattern': '*/mizel-qa/*'}, {'urlPattern': '*/mizel-live/*'}, {'urlPattern': 'https://example.org/*'},
                                            {'urlPattern': '*/meetings/api/*'}, {'urlPattern': '*/hermes/*'}, {'urlPattern': '*/v1/*'}, {'urlPattern': '*/wizard/*'}])
    def _send(self, obj):
        data = json.dumps(obj).encode(); hdr = bytearray([0x81]); mask = os.urandom(4); n = len(data)
        if n < 126: hdr.append(0x80 | n)
        elif n < 65536: hdr.append(0x80 | 126); hdr += n.to_bytes(2, 'big')
        else: hdr.append(0x80 | 127); hdr += n.to_bytes(8, 'big')
        self.s.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    def _need(self, k):
        while len(self.buf) < k:
            c = self.s.recv(65536)
            if not c: raise RuntimeError('ws closed')
            self.buf += c
    def _recv(self):
        msg = b''
        while True:
            self._need(2); b1, b2 = self.buf[0], self.buf[1]; n = b2 & 0x7f; off = 2
            if n == 126: self._need(4); n = int.from_bytes(self.buf[2:4], 'big'); off = 4
            elif n == 127: self._need(10); n = int.from_bytes(self.buf[2:10], 'big'); off = 10
            self._need(off + n); payload = self.buf[off:off + n]; self.buf = self.buf[off + n:]
            msg += payload
            if b1 & 0x80: return json.loads(msg.decode())
    def _paused(self, d):
        r = d['params']['request']; url = r['url']; rid = d['params']['requestId']
        pu = urllib.parse.urlparse(url)
        key = 'example.org' + pu.path if pu.hostname == 'example.org' else pu.path
        if key in PAGES and r['method'] in ('GET', 'HEAD'):
            self.served.append(url)
            body = base64.b64encode(PAGES[key].encode()).decode()
            self._send({'id': 700000 + len(self.served), 'method': 'Fetch.fulfillRequest', 'params': {'requestId': rid, 'responseCode': 200,
                        'responseHeaders': [{'name': 'Content-Type', 'value': 'text/html; charset=utf-8'}, {'name': 'Cache-Control', 'value': 'no-store'}], 'body': body}})
        elif r['method'] not in ('GET', 'HEAD') or '/mizel-qa/' in url or '/mizel-live/' in url or pu.hostname == 'example.org':
            self.writes.append(r['method'] + ' ' + url)
            self._send({'id': 900000 + len(self.writes), 'method': 'Fetch.failRequest', 'params': {'requestId': rid, 'errorReason': 'BlockedByClient'}})
        else:
            self._send({'id': 800000 + self.id, 'method': 'Fetch.continueRequest', 'params': {'requestId': rid}})
    def call(self, method, **params):
        self.id += 1; my = self.id; self._send({'id': my, 'method': method, 'params': params})
        while True:
            d = self._recv()
            if d.get('id') == my: return d
            if d.get('method') == 'Fetch.requestPaused': self._paused(d)
    def ev(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True)
        rr = r.get('result', {})
        if rr.get('exceptionDetails'): raise RuntimeError(json.dumps(rr['exceptionDetails'])[:400])
        return rr.get('result', {}).get('value')
    def pump(self, secs, fn=None, every=1.0):
        """Keep serving intercepted requests for secs; fn() is polled each step and may end the wait."""
        t0 = time.time(); v = None
        while time.time() - t0 < secs:
            try: self.ev('1')
            except Exception as e: print('pump:', e); time.sleep(every); continue
            if fn:
                v = fn()
                if v: return v
            time.sleep(every)
        return v
    def close(self):
        try: self.s.close()
        except Exception: pass

def open_host(pg):
    pg.ev(f"window.__stale=1; location.href='{ORIGIN}/mizel-qa/host.html'")
    return pg.pump(25, lambda: pg.ev("(!window.__stale && window.R && R.frames.same && R.frames.foreign && R.frames['same-reply']) ? true : false"), 0.5)

SCHED_ERR = []

def nodes(xml):
    out = []
    for m in re.finditer(r'<node [^>]*?>', xml):
        n = m.group(0); t = re.search(r' text="([^"]*)"', n); d = re.search(r' content-desc="([^"]*)"', n)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if b: out.append(((t.group(1) if t else '') or (d.group(1) if d else ''), tuple(map(int, b.groups()))))
    return out

def tap_note_action(title, action, shot_name):
    """Real tap on a notification action button: open the shade, expand our notification if its actions are
    folded, tap the action closest below the title."""
    sx('cmd statusbar expand-notifications'); time.sleep(2)
    for attempt in range(3):
        ns = nodes(ui())
        t = next((b for l, b in ns if re.search(title, l)), None)
        if not t: time.sleep(1); continue
        acts = [b for l, b in ns if re.fullmatch(action, l, re.I) and b[1] >= t[1]]
        if acts:
            b = min(acts, key=lambda b: b[1] - t[1]); shot(shot_name)
            sx(f'input tap {(b[0] + b[2]) // 2} {(b[1] + b[3]) // 2}'); time.sleep(1.5); sx('cmd statusbar collapse'); return action
        # folded: drag the notification down to expand it
        sx(f'input swipe {(t[0] + t[2]) // 2} {t[1]} {(t[0] + t[2]) // 2} {t[1] + 400} 300'); time.sleep(1.5)
    shot(shot_name + '-notfound'); sx('cmd statusbar collapse')
    return None

def mz(pg, cmd, mid=None):
    return pg.ev(f"mz({json.dumps(cmd)}, {json.dumps(mid)})")

def mic_state(uid):
    a = sx(f'cmd appops get {PKG} RECORD_AUDIO').strip()
    au = sx('dumpsys audio')
    i = au.find('RecordActivityMonitor'); sec = au[i:i + 3000] if i >= 0 else ''
    mine = [l.strip() for l in sec.splitlines() if re.search(rf'\buid[:=]\s*{uid}\b', l)]
    running = 'running' in a.lower()
    return {'appops': a, 'audio_records': mine, 'running': running, 'held': running or any('active:true' in l.lower() or 'state:started' in l.lower() for l in mine)}

def fgs():
    d = sx(f'dumpsys activity services {PKG}')
    blk = d[d.find('MeetingRecorderService'):][:2500] if 'MeetingRecorderService' in d else ''
    return {'running': bool(blk), 'isForeground': 'isForeground=true' in blk, 'types': re.findall(r'\btypes=(0x[0-9a-f]+)', blk)}

def notes():
    return sx('dumpsys notification --noredact')

em = None; pg = None; summary = {'job': str(job), 'apk': str(apk), 'long_secs': LONG}
print('job', job, flush=True)
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        KEEP = os.environ.get('QA_KEEP_EMU') == '1'   # iteration aid: reuse/keep a running QA emulator
        reuse = KEEP and sx('getprop sys.boot_completed').strip() == '1'
        if not reuse:
          sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'q', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
          em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'q', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
          for _ in range(120):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
          time.sleep(10)
        else:
            sh(ADB, '-s', S, 'uninstall', PKG)
        summary['emulator_reused'] = reuse
        sx('settings put global window_animation_scale 0'); sx('settings put global transition_animation_scale 0'); sx('settings put global animator_duration_scale 0')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); sx('settings put system screen_off_timeout 1800000')
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
        ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0)
        uid = (re.search(rf'package:{re.escape(PKG)} uid:(\d+)', sx(f'pm list packages -U {PKG}')) or re.search(r'(?:userId|appId)=(\d+)', sx(f'dumpsys package {PKG}'))).group(1)
        check('setup', 'install', out == 'Success', out + ' ' + ver + ' uid=' + uid)
        summary.update(version=ver, uid=uid, api=sx('getprop ro.build.version.sdk').strip())
        sx(f'run-as {PKG} mkdir -p files')
        sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_origin.txt'")
        qa_cfg = {'pauseTimeoutMs': 20000, 'drainGraceMs': 30000, 'statusEveryMs': 3000, 'keepAfterReadyMs': 8000, 'fakeMic': 1, 'staticNotification': 1}
        (job / 'qa_mizel.json').write_text(json.dumps(qa_cfg))
        sh(ADB, '-s', S, 'push', job / 'qa_mizel.json', '/data/local/tmp/qa_mizel.json')
        sx(f'run-as {PKG} cp /data/local/tmp/qa_mizel.json files/qa_mizel.json')
        print('qa_mizel.json:', sx(f'run-as {PKG} cat files/qa_mizel.json').strip())
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx('logcat -c'); sx('logcat -G 16M')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(9)
        pg = Page(); pg.pump(4)
        pg.ev("new Promise(r => { const t0=Date.now(); const t = () => (window.__wos || Date.now()-t0>20000) ? r() : setTimeout(t, 200); t(); })")
        pg.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo').click(); return true; })()")
        shot('00-shell')
        inst = mlog('meeting bridge installed|WEB_MESSAGE_LISTENER|addWebMessageListener')
        check('bridge', 'WebView supports WEB_MESSAGE_LISTENER; bridge installed for the private origin', 'installed for https://private.wizard001.com' in inst, inst)

        # ------------------------------------------------ (f) origin scoping + iframe reach
        shell_port = pg.ev("typeof window.wizardMizelPort")
        check('bridge', 'shell main frame (https://private.wizard001.com/wizard-os-home/) has wizardMizelPort', shell_port == 'object', shell_port)
        # The real Mizel app window is an iframe (/meetings/) inside the shell: open it and look inside.
        pg.ev("window.dispatchEvent(new CustomEvent('wizard:open', {detail: {app: 'mizel'}}))")
        probe = "(() => { const f=[...document.querySelectorAll('iframe')].map(f => { try { return [f.contentWindow.location.href, typeof f.contentWindow.wizardMizelPort, f.contentDocument && f.contentDocument.readyState] } catch (e) { return [f.src, 'x:' + e.name] } }); return f.some(x => x[0].includes('/meetings/') && x[2] === 'complete') ? f : null })()"
        frames = pg.pump(25, lambda: pg.ev(probe), 1.0)
        frames = frames or pg.ev("[...document.querySelectorAll('iframe')].map(f => { try { return [f.src, typeof f.contentWindow.wizardMizelPort] } catch (e) { return [f.src, 'x'] } })")
        shot('01-shell-mizel-window')
        mf = [f for f in (frames or []) if '/meetings/' in f[0]]
        check('bridge', 'real Mizel iframe (/meetings/) inside the Wizard OS shell gets wizardMizelPort', mf and all(f[1] == 'object' for f in mf), frames)
        pg.ev("history.length")
        ok = open_host(pg)
        R0 = pg.ev("JSON.stringify({hasPort: R.hasPort, frames: R.frames})")
        save('bridge-frames.json', R0); R0 = json.loads(R0)
        shot('02-qa-host')
        check('bridge', 'QA page on https://private.wizard001.com (main frame) has wizardMizelPort', R0['hasPort'] == 'object', R0['hasPort'])
        check('bridge', 'same-origin iframe has wizardMizelPort and gets replies', R0['frames'].get('same', {}).get('port') == 'object' and 'same-reply' in R0['frames'], R0['frames'].get('same-reply'))
        fo = R0['frames'].get('foreign', {})
        check('bridge', 'foreign-origin iframe (https://example.org) has NO wizardMizelPort and cannot reach the parent\'s', fo.get('port') == 'undefined' and str(fo.get('parentPort', '')).startswith('blocked'), fo)
        # Protocol edge cases
        bad = pg.ev("mzRaw('not json')"); unk = pg.ev("mz('dance')"); badid = pg.ev("mz('start', '../etc')")
        nr = pg.ev("mz('pause')"); st0 = pg.ev("mz('status')")
        check('bridge', 'protocol errors: bad_request / unknown_cmd / bad_meeting_id / not_recording; status works idle',
              bad.get('error') == 'bad_request' and unk.get('error') == 'unknown_cmd' and badid.get('error') == 'bad_meeting_id' and nr.get('error') == 'not_recording' and st0.get('ok') and st0['status']['recording'] is False,
              {'bad': bad, 'unk': unk, 'badid': badid, 'nr': nr, 'status': st0})

        # ------------------------------------------------ (a)(e) long run, screen off, outage, airplane
        A = 'qa_mz_long'
        t_start = time.time()
        r = mz(pg, 'start', A)
        check('long', 'start replies ok with recording state', r.get('ok') and r['status']['recording'] and r['status']['meetingId'] == A, r)
        time.sleep(3)
        path = mlog('AudioRecord open|synthetic microphone', 3)
        summary['mic_path'] = path
        print('mic path:', path)
        ms1 = mic_state(uid); save('mic-recording-A.json', ms1)
        fg = fgs()
        check('long', 'service is foreground with type microphone', fg['isForeground'] and any(int(t, 16) & 0x80 for t in fg['types']), fg)
        check('pause', 'while recording the mic is held (appops RECORD_AUDIO running / AudioRecord active)', ms1['held'], {'running': ms1['running'], 'records': ms1['audio_records'], 'path': path})
        lv0 = pg.ev("R.levels"); pg.pump(3); lv1 = pg.ev("R.levels")
        check('bridge', 'level pushes ~5/s while recording', 10 <= (lv1 - lv0) <= 20, f'{lv1 - lv0} in ~3 s')
        sp = pg.ev("JSON.stringify(R.last)")
        check('bridge', 'state push has recording/paused/meetingId/mediaMs/pendingChunks/pausedMs', all(k in json.loads(sp) for k in ('recording', 'paused', 'meetingId', 'mediaMs', 'pendingChunks', 'pausedMs')), sp)
        # Deep link from the notification (real tap in the shade)
        sx('cmd statusbar expand-notifications'); time.sleep(2); x = ui(); shot('03-shade-recording')
        n_ok = bool(re.search(r'Recording meeting', x))
        check('link', 'notification "Recording meeting" with Pause and Stop actions', n_ok and re.search(r'text="Pause"', x, re.I) and re.search(r'text="Stop"', x, re.I), re.findall(r'text="([^"]+)"', x)[:20])
        tap_text(r'^Recording meeting$', x); time.sleep(3)
        pg.pump(6, lambda: pg.ev("location.pathname.startsWith('/mizel-live/') && !!window.QA_LIVE"), 0.5)
        href = pg.ev("location.href"); live = pg.ev("JSON.stringify(window.QA_LIVE || null)")
        shot('04-notification-opened-live')
        check('link', 'tapping the notification opens Wizard OS on /mizel-live/#/m/<id> in the app WebView', href == f'{ORIGIN}/mizel-live/#/m/{A}' and PKG in top(), {'href': href, 'top': top()[:120], 'live': live})
        check('bridge', '/mizel-live/ page (private origin) has the port too', bool(live and live != 'null' and json.loads(live).get('port') == 'object'), live)
        # Back from /mizel-live/ stays in the app (g)
        sx('input keyevent KEYCODE_BACK'); time.sleep(2.5); pg.pump(3)
        href_b = pg.ev("location.href")
        check('back', 'Back from the Mizel Live view stays inside Wizard OS', PKG in top(), {'top': top()[:120], 'href': href_b})
        # back to the QA host to watch pushes
        open_host(pg)
        st = mz(pg, 'status')
        check('bridge', 'status after a page reload reattaches to the live session', st.get('ok') and st['status']['recording'] and st['status']['meetingId'] == A, st)
        # Screen off + forced doze
        sx('input keyevent 26'); time.sleep(2)
        scr = sx('dumpsys power | grep -E "mWakefulness=|Display Power"').strip()
        sx('dumpsys deviceidle force-idle')
        print('screen:', scr, flush=True)
        t_off = time.time()
        timeline = []
        def phase(name): timeline.append((round(time.time() - t_start, 1), name)); print(f'  t+{time.time() - t_start:.0f}s {name}', flush=True)
        phase('screen off + doze')
        out_at = max(20, LONG // 4); air_at = max(out_at + 50, LONG // 2)
        pend_max = 0
        while time.time() - t_off < LONG:
            el = time.time() - t_off
            if ST['down'] is None and out_at <= el < out_at + 45 and not any(n == 'server down' for _, n in timeline): ST['down'] = 'drop'; phase('server down (connection reset)')
            if ST['down'] == 'drop' and el >= out_at + 45: ST['down'] = None; phase('server up')
            if air_at <= el and not any(n == 'airplane on' for _, n in timeline): sx('cmd connectivity airplane-mode enable'); phase('airplane on')
            if any(n == 'airplane on' for _, n in timeline) and not any(n == 'airplane off' for _, n in timeline) and el >= air_at + 40: sx('cmd connectivity airplane-mode disable'); phase('airplane off')
            try:
                pend = pg.ev("R.last ? R.last.pendingChunks : -1"); pend_max = max(pend_max, pend or 0)
            except Exception as e: print('ev', e)
            time.sleep(4)
        if not any(n == 'airplane off' for _, n in timeline): sx('cmd connectivity airplane-mode disable'); phase('airplane off')
        ST['down'] = None
        sx('dumpsys deviceidle unforce'); sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); time.sleep(2)
        phase('screen on')
        save('timeline-A.json', timeline)
        check('long', 'chunks piled up locally during the outage/airplane mode (pendingChunks > 3)', pend_max > 3, f'max pending {pend_max}')
        drained = pg.pump(150, lambda: pg.ev("R.last && R.last.pendingChunks === 0"), 2)
        check('long', 'after recovery every buffered chunk uploaded while still recording (pendingChunks back to 0)', drained, pg.ev("JSON.stringify(R.last)"))

        # ------------------------------------------------ (b) pause releases the mic; resume; media time
        t_pause = time.time()
        r = mz(pg, 'pause'); time.sleep(2.5)
        msp = mic_state(uid); save('mic-paused-A.json', msp)
        check('pause', 'pause replies ok, state paused', r.get('ok') and r['status']['paused'], r)
        check('pause', 'paused: the microphone is released (appops not running, no AudioRecord for our uid)', not msp['held'], {'running': msp['running'], 'records': msp['audio_records']})
        check('pause', 'AudioRecord released log', 'AudioRecord released' in mlog('AudioRecord released', 2), mlog('AudioRecord released', 2))
        sx('cmd statusbar expand-notifications'); time.sleep(2); x = ui(); shot('05-shade-paused')
        check('pause', 'notification shows paused with countdown and Resume/Stop', 'Meeting paused' in x and 'Ends by itself in' in x and re.search(r'text="Resume"', x, re.I), re.findall(r'text="([^"]+)"', x)[:20])
        sx('cmd statusbar collapse'); time.sleep(1)
        m0 = pg.ev("R.last.mediaMs")
        pg.pump(8)
        st = pg.ev("JSON.stringify(R.last)"); sj = json.loads(st)
        check('pause', 'media time does not advance while paused; pausedMs counts', sj['paused'] and sj['mediaMs'] == m0 and sj['pausedMs'] >= 6000, {'at_pause': m0, 'later': sj})
        paused_media = sj['mediaMs']
        r = mz(pg, 'resume'); t_resume = time.time(); time.sleep(3)
        msr = mic_state(uid); save('mic-resumed-A.json', msr)
        check('pause', 'resume re-acquires the microphone', r.get('ok') and not r['status']['paused'] and msr['held'], {'reply': r, 'running': msr['running']})
        pg.pump(12)
        after = pg.ev("R.last.mediaMs")
        check('pause', 'media time continues from where it paused', paused_media <= after <= paused_media + 16000, {'paused_at': paused_media, 'now': after})
        # Stop from the page
        r = mz(pg, 'stop')
        check('long', 'stop replies ok', r.get('ok') and not r['status']['recording'], r)
        t_stop = time.time()
        got = wait_for(lambda: ST['stops'].get(A), 60)
        wall = t_stop - t_start
        vA = verify_meeting('long', A, 'user', expect_min_chunks=LONG // 5)
        summary['meeting_A'] = vA | {'wall_s': round(wall, 1)}
        print('meeting A:', json.dumps(summary['meeting_A'])[:400])
        with LOCK: chA = dict(ST['chunks'][A])
        short = [s for s in sorted(chA)[:-1] if chA[s]['dur_ms'] != 5000]
        check('pause', 'exactly one short chunk mid-meeting (the one cut at Pause); all others 5 s', len(short) == 1, short)
        exp_s = wall - (t_resume - t_pause)
        check('long', 'media time ≈ recording wall time minus the pause (no audio lost while the screen was off)', abs(vA['media_ms'] / 1000 - exp_s) < max(6, exp_s * 0.02), {'media_s': vA['media_ms'] / 1000, 'expected_s': round(exp_s, 1), 'wall_s': round(wall, 1), 'paused_s': round(t_resume - t_pause, 1)})
        check('long', 'audio is not silent garbage (peak > 0 on most chunks) — informational for emulator mic', True, {'nonzero_peak_chunks': sum(1 for c in chA.values() if c['peak'] > 0), 'of': len(chA)})
        check('long', 'duplicates tolerated (idempotent per seq)', True, f"{ST['dups']} duplicate posts")
        # Local files kept until ready (+keepAfterReadyMs) then pruned
        ls1 = sx(f'run-as {PKG} ls files/mizel/{A}/me').split()
        check('long', 'acked chunk files are kept locally after stop (until the meeting is ready + keep time)', len(ls1) >= vA['seqs'] - 1, f'{len(ls1)} files')
        pr = wait_for(lambda: 'No such file' in sx(f'run-as {PKG} ls files/mizel/{A} 2>&1') or not sx(f'run-as {PKG} ls files/mizel/{A} 2>&1').strip(), 60, 2)
        check('long', 'after the meeting reports ready (+8 s QA keep time) the local audio is pruned', pr, mlog('ready|pruned', 4))
        s = fgs()
        check('long', 'recorder service leaves the foreground once everything is delivered', wait_for(lambda: not fgs()['isForeground'], 40, 2), fgs())

        # ------------------------------------------------ (b) pause_timeout via notification Pause
        B = 'qa_mz_pause'
        r = mz(pg, 'start', B); pg.pump(12)
        tapped = tap_note_action('Recording meeting', 'Pause', '05b-shade-pause-action')
        time.sleep(1.5)
        st = mz(pg, 'status')
        check('pause', 'notification Pause action pauses the meeting', tapped and st['status']['paused'], st)
        t_p = time.time() - (st['status']['pausedMs'] / 1000.0 if st.get('status') else 0)   # when the pause began
        got = wait_for(lambda: ST['stops'].get(B), 60, 1)
        check('pause', 'paused 20 s (QA timeout) → stops by itself with reason pause_timeout', got and got['body'].get('reason') == 'pause_timeout' and 19 <= got['t'] - t_p <= 40, {'after_s': got and round(got['t'] - t_p, 1), 'body': got and got['body']})
        verify_meeting('pause', B, 'pause_timeout', 2)

        # ------------------------------------------------ (d) one mic owner
        C = 'qa_mz_owner'
        r = mz(pg, 'start', C); time.sleep(3)
        sx('logcat -c')
        sx(f'am start -W -a android.intent.action.ASSIST -n {PKG}/ai.wizards.os.assist.AssistLockActivity'); time.sleep(4)
        shot('06-side-refused')
        al = sx('logcat -d -s WizardOSAssist:* | grep -E "start refused|recorder failed|listening" | tail -4').strip()
        check('owner', 'side-button take refused while a meeting records (toast + reason)', 'start refused: mic held by meeting' in al, al)
        sx('input keyevent KEYCODE_BACK'); time.sleep(2)
        if PKG + '/ai.wizards.os.MainActivity' not in top():
            sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(2)
        # Everywhere: overlay allowed, switch on, leave the app, tap the floating orb.
        sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow')
        pg.ev("window.WizardOSNative.setEverywhere(true)"); time.sleep(2)
        sx('input keyevent KEYCODE_HOME'); time.sleep(3)
        def bubble():
            for blk in sx('dumpsys window windows').split('Window #')[1:]:
                if 'WizardEverywhere' in blk.split('\n', 1)[0]:
                    m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
                    if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
            return None
        b = wait_for(bubble, 15)
        if b:
            sx('logcat -c'); sx(f'input tap {(b[0] + b[2]) // 2} {(b[1] + b[3]) // 2}'); time.sleep(3); shot('07-everywhere-refused')
            el = sx('logcat -d -s WizardEverywhere:* | grep -E "start refused|listening|recorder failed" | tail -4').strip()
            check('owner', 'Everywhere orb take refused while a meeting records (toast + reason)', 'start refused: mic held by meeting' in el, el)
        else:
            check('owner', 'Everywhere orb take refused while a meeting records', False, 'floating orb never appeared')
        # Stop from the notification while the app is in the background (real tap on the Stop action).
        st_tap = tap_note_action('Recording meeting', 'Stop', '07b-shade-stop')
        got = wait_for(lambda: ST['stops'].get(C), 40)
        check('owner', 'notification Stop action ends the meeting (reason user)', st_tap and got and got['body'].get('reason') == 'user', {'tapped': st_tap})
        if not got: mz(pg, 'stop'); wait_for(lambda: ST['stops'].get(C), 40)   # keep the rest of the run meaningful
        verify_meeting('owner', C, 'user', 1)
        # Reverse: Everywhere listening → meeting start refused.
        if b:
            sx('logcat -c'); sx(f'input tap {(b[0] + b[2]) // 2} {(b[1] + b[3]) // 2}'); time.sleep(1.2)
            el = sx('logcat -d -s WizardEverywhere:* | grep -E "listening|recorder failed|refused" | tail -3').strip()
            rr = mz(pg, 'start', 'qa_mz_refused')
            check('owner', 'meeting start refused (mic_busy) while the Everywhere orb is listening', rr.get('ok') is False and rr.get('error') == 'mic_busy', {'reply': rr, 'everywhere': el})
            time.sleep(1); sx(f'input tap {(b[0] + b[2]) // 2} {(b[1] + b[3]) // 2}'); time.sleep(2)  # finish that take
        pg.ev("window.WizardOSNative.setEverywhere(false)")
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(3)

        # ------------------------------------------------ (c) process death: kill -9 → sticky restart
        D = 'qa_mz_death'
        open_host(pg)
        r = mz(pg, 'start', D)
        pg.pump(23)
        ST['down'] = 'drop'  # last chunks are on disk but not yet acked when the process dies
        pg.pump(6)
        pid = sx(f'pidof {PKG}').strip()
        with LOCK: acked_before = sorted(ST['chunks'].get(D, {}))
        local_before = sx(f'run-as {PKG} ls files/mizel/{D}/me').split()
        sx('logcat -c')
        sx(f'run-as {PKG} kill -9 {pid}'); t_k = time.time()
        pg.close(); pg = None
        time.sleep(4); ST['down'] = None
        got = wait_for(lambda: ST['stops'].get(D), 150, 2)
        rs = sx('logcat -d | grep -E "Scheduling restart of crashed service|WizardMizel" | grep -E "restart|recovered|restarted|process death|notified|stop sent" | tail -8').strip()
        save('death-kill-logcat.txt', rs)
        check('death', 'after kill -9 the service restarts and sends stop with reason process_death (no app open)', got and got['body'].get('reason') == 'process_death', {'after_s': got and round(got['t'] - t_k, 1), 'log': rs[-600:]})
        vD = verify_meeting('death', D, 'process_death', 3)
        check('death', 'no acked chunk lost; every chunk on disk before the kill reached the server (incl. the torn one)', set(acked_before) <= set(range(vD['seqs'])) and vD['seqs'] >= len([f for f in local_before if f.endswith('.wav')]), {'acked_before': len(acked_before), 'local_before': local_before[-4:], 'server_final': vD['final']})
        nn = notes()
        check('death', 'notification "Recording ended unexpectedly at HH:MM"', re.search(r'Recording ended unexpectedly at \d\d:\d\d', nn) is not None, (re.search(r'Recording ended unexpectedly at \d\d:\d\d', nn) or [None])[0])
        msd = mic_state(uid)
        check('death', 'the restarted process did not reopen the microphone', not msd['held'] and 'synthetic microphone' not in sx('logcat -d -s WizardMizel:* | grep -E "AudioRecord open|synthetic"'), {'running': msd['running']})

        # force-stop → next app open recovers
        E = 'qa_mz_forcestop'
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(6)
        pg = Page(); pg.pump(3); open_host(pg)
        r = mz(pg, 'start', E); pg.pump(13)
        pg.close(); pg = None
        t_k = time.time(); sx(f'am force-stop {PKG}'); time.sleep(8)
        early = ST['stops'].get(E)
        dl = sx('logcat -d | grep -E "ai.wizards.os.qa|WizardMizel" | grep -vE "level|AudioRecord read" | tail -200')
        save('death-forcestop-logcat.txt', dl)
        SCHED_ERR.append(dl.count('could not schedule upload job'))
        t_o = time.time(); sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity')
        got = wait_for(lambda: ST['stops'].get(E), 60, 1)
        check('death', 'after force-stop the meeting is closed with process_death (by a restart or the next app open)', got and got['body'].get('reason') == 'process_death',
              {'after_force_stop_s': got and round(got['t'] - t_k, 1), 'before_app_reopen': bool(early), 'reopen_to_stop_s': got and round(got['t'] - t_o, 1)})
        verify_meeting('death', E, 'process_death', 2)

        # ------------------------------------------------ (g) Back: nested view → Back → still open
        time.sleep(4); pg = Page(); pg.pump(3)
        pg.ev("new Promise(r => { const t0=Date.now(); const t = () => (window.__wos || Date.now()-t0>20000) ? r() : setTimeout(t, 200); t(); })")
        stq = "JSON.stringify({idx: window.__wos.idx, home: window.__wos.HOME, sheet: window.__wos.sheet, log: (window.__wos.back.log || []).slice(-3)})"
        # nested 1: an overlay sheet (the launcher) → Back closes it
        pg.ev("window.__wos.openSheet('launcher')"); pg.pump(2)
        before = json.loads(pg.ev(stq)); shot('08-back-sheet-before')
        sx('input keyevent KEYCODE_BACK'); time.sleep(2); pg.pump(2)
        after = json.loads(pg.ev(stq)); shot('09-back-sheet-after')
        check('back', 'launcher sheet open → Back closes the sheet; app still open', PKG in top() and before['sheet'] and not after['sheet'], {'before': before, 'after': after, 'top': top()[:100]})
        # nested 2: another desk (the Mizel app window lives off Home) → Back returns Home
        pg.ev("window.__wos.goDesk(window.__wos.HOME + 1)"); pg.pump(2)
        before = json.loads(pg.ev(stq)); shot('10-back-desk-before')
        sx('input keyevent KEYCODE_BACK'); time.sleep(2); pg.pump(2)
        after = json.loads(pg.ev(stq)); shot('11-back-desk-after')
        check('back', 'Mizel desk open → Back returns to Home; app still open', PKG in top() and before['idx'] != before['home'] and after['idx'] == after['home'], {'before': before, 'after': after, 'top': top()[:100]})
        for i in range(3): sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
        pg.pump(2)
        check('back', 'repeated Back at the root never leaves Wizard OS', PKG in top() and pg.ev("location.pathname").startswith('/wizard-os-home'), top()[:100])
        open_host(pg); sx('input keyevent KEYCODE_BACK'); time.sleep(2.5); pg.pump(3)
        check('back', 'Back from a nested private page returns to the shell, app still open', PKG in top() and pg.ev("location.pathname").startswith('/wizard-os-home'), pg.ev('location.href'))

        SCHED_ERR.append(sx('logcat -d -s WizardMizel:*', timeout=60).count('could not schedule upload job'))
        check('death', 'upload job never trips the JobScheduler schedule() rate limit (no self-rescheduling loop)', sum(SCHED_ERR) == 0, SCHED_ERR)
        crash = sh(ADB, '-s', S, 'logcat', '-d', '-b', 'crash')
        check('setup', 'no app crashes in the crash buffer', PKG not in crash, crash[-400:])
        summary['writes_blocked_from_webview'] = pg.writes if pg else []
    except Exception as e:
        import traceback; traceback.print_exc()
        check('setup', 'suite ran to the end', False, repr(e)[:300])
        shot('zz-error')
    finally:
        try:
            save('logcat-mizel.txt', sx('logcat -d -s WizardMizel:* WizardEverywhere:* WizardOSAssist:* AndroidRuntime:*', timeout=60))
            save('logcat-all-tail.txt', '\n'.join(sx('logcat -d', timeout=60).splitlines()[-3000:]))
        except Exception: pass
        with LOCK:
            save('server.json', {'events': ST['events'], 'stops': ST['stops'], 'dups': ST['dups'], 'gets': ST['gets'],
                                 'chunks': {m: {str(k): {kk: vv for kk, vv in v.items()} for k, v in c.items()} for m, c in ST['chunks'].items()}})
        if pg: pg.close()
        if em and os.environ.get('QA_KEEP_EMU') != '1':
            subprocess.run([ADB, '-s', S, 'emu', 'kill'], env=env, capture_output=True)
            try: em.wait(30)
            except Exception: em.kill()
        srv.shutdown()
passed = sum(r['ok'] for r in RES)
summary.update(passed=passed, total=len(RES), results=RES)
save('results.json', summary)
print(f'\n{passed}/{len(RES)} passed; evidence {job}', flush=True)
sys.exit(0 if passed == len(RES) else 1)
