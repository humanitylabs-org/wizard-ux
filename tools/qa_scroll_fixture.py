"""Read-only synthetic API + the REAL shell files for native document capture QA."""
import http.server
import json
import mimetypes
from pathlib import Path
import threading
import time
from urllib.parse import unquote, urlsplit

WEB = Path(__file__).resolve().parents[1] / 'web'
NOW = time.time()
SESSIONS = [dict(id='qa_doc_'+str(i), title='Native document capture '+str(i), agent='hermes', runtime='hermes', source='wizard-mobile', status='completed', message_count=28 if i == 0 else 2, started_at=NOW-600, last_active=NOW-i, wizard_last_user_at=NOW-300, wizard_last_assistant_at=NOW-i, wizard_activity_at=NOW-i, latest_message=dict(role='assistant',content='Fixture answer',timestamp=NOW-i),last_user_message=dict(role='user',content='Fixture ask',timestamp=NOW-300)) for i in range(2)]

class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def reply(self, body, mime='application/json', status=200):
        if not isinstance(body, bytes): body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)
    def do_GET(self):
        p = unquote(urlsplit(self.path).path)
        if p.startswith('/wizard-os-home/'):
            rel = p[len('/wizard-os-home/'):] or 'index.html'
            f = (WEB / rel).resolve()
            if f.is_relative_to(WEB) and f.is_file():
                return self.reply(f.read_bytes(), mimetypes.guess_type(f)[0] or 'application/octet-stream')
            if rel in ('data.js', 'summaries.js'):
                return self.reply(('window.'+('DATA' if rel == 'data.js' else 'SUMMARIES')+' = {};').encode(), 'application/javascript')
        if p == '/wizard/v1/bootstrap':
            return self.reply(dict(bootstrap=1, settings=dict(agent=dict(name='QA Agent')), capabilities=dict(voice=True,files=True,router=True), endpoints=dict(sessions='/wizard/hermes/api/sessions',runs='/wizard/hermes/v1/runs',transcribe='/wizard/voice/transcribe',route='/wizard/v1/route',upload='/wizard/files/upload')))
        if p == '/wizard/hermes/api/sessions': return self.reply(dict(data=SESSIONS,has_more=False))
        if p.endswith('/messages'):
            sid = p.split('/')[-2]; n = 14 if sid == 'qa_doc_0' else 1
            rows = []
            for i in range(n):
                for j,role in enumerate(('user','assistant')):
                    rows.append(dict(id=i*2+j+1,session_id=sid,role=role,content=('Question ' if role=='user' else 'ROW ')+str(i).zfill(2),timestamp=NOW-600+i*2+j))
            return self.reply(dict(data=rows,has_more=False))
        if '/api/sessions/qa_doc_' in p:
            return self.reply(dict(session=next(s for s in SESSIONS if s['id']==p.split('/')[-1])))
        if p == '/wizard/thread-seen': return self.reply(dict(state=dict(initializedAt=int(NOW*1000),threads={})))
        if p.endswith('/model/options'):
            return self.reply(dict(model='qa-model',provider='qa-provider',providers=[dict(slug='qa-provider',name='QA',authenticated=True,is_current=True,models=['qa-model'])]))
        return self.reply({})
    do_HEAD = do_GET
    def blocked(self): self.reply(dict(error='QA blocks writes'), status=403)
    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = blocked


def serve(port):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1',port),Fixture)
    threading.Thread(target=srv.serve_forever,daemon=True).start()
    return srv

# Styles affect only deterministic fixture bands, not capture geometry or chrome.
# Keep the real .ch-head + .ch-compose visible throughout SystemUI acquisition.
DECORATE = """(()=>{
 let style=document.getElementById('qa-bands');
 if(!style){style=document.createElement('style');style.id='qa-bands';document.head.append(style);}
 style.textContent='.ch-msgs .msg.u,.ch-msgs .ch-day,.ch-msgs .tacts,.ch-msgs .ch-receipt{display:none!important}.ch-msgs .msg.a{height:120px!important;min-height:120px!important;flex:none!important;width:100%!important;max-width:none!important;margin:0!important}.ch-msgs .msg.a .bub{width:100%;height:100%;max-width:none;border:0;border-radius:0}';
 document.querySelectorAll('.wos-doc-thread .msg.a').forEach((n,i)=>{n.style.background=`rgb(${30+i*4},60,90)`;n.querySelectorAll('.bub').forEach(b=>b.style.background=n.style.background);});
 document.querySelector('.ch-msgs').dispatchEvent(new Event('wheel',{bubbles:true}));
 return {rows:document.querySelectorAll('.wos-doc-thread .msg.a').length,mode:document.documentElement.classList.contains('wos-doc-scroll')};
})()"""
