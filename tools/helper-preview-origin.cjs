// Local QA origin for when the Thales tunnel (127.0.0.1:18443) is down.
// Serves <web dir> at /wizard-os-home/ and proxies READS of /wizard/* to the Wizard Agent
// Service (127.0.0.1:8923), the same backend the live origin fronts. Any non-GET/HEAD to
// /wizard/* is refused here (403) as a second fence: suites must intercept writes themselves.
// Usage: node tools/qa-origin.cjs [port=9371] [webDir=<repo>/web]
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +(process.argv[2] || process.env.QA_ORIGIN_PORT || 9371);
const WEB = path.resolve(process.argv[3] || process.env.QA_ORIGIN_WEB || path.join(__dirname, '..', 'web'));
const FALLBACK = process.env.WIZARD_UX_FALLBACK_WEB || WEB; // optional untracked data.js / summaries.js build outputs
const BACKEND = { host: '127.0.0.1', port: 8923 };
const STATIC = { '127.0.0.1:9271': '/api/' }; // voice/router endpoints of the prototype server
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
let refused = 0;
const helperModule = () => import(require('node:url').pathToFileURL(path.resolve(require('./qa-paths.cjs').required('QA_HELPER_STATUS_MODULE'))).href);
const demos = new Map();
const demoStarts = new Map();
const DEMO = ['running','finishing','stalled'];
function demoRows(key) {
  const now=Date.now()/1000, resumed=demos.get(key)||0;
  if(!demoStarts.has(key)) demoStarts.set(key,now);
  const at=demoStarts.get(key);
  return DEMO.map((mode,i)=>{
    const finished=mode==='stalled' && resumed && now-resumed>3;
    const phase=mode==='running'?'running':mode==='finishing' || resumed && !finished?'integrating':'stalled';
    const id='wizard_preview_helpers_'+mode;
    return {id,source:'wizard-mobile',title:'Preview · '+({running:'Helpers running',finishing:'Finishing answer',stalled:'Stalled helpers'}[mode]),status:finished?'completed':'running',started_at:at-2200,wizard_last_user_at:at-2200,wizard_last_assistant_at:finished?resumed+3:0,wizard_activity_at:finished?resumed+3:at-1,message_count:2,archived:false,hidden:false,
      wizard_helper_status:finished?null:{phase,pending:mode==='running'?2:0,returned:mode==='running'?1:2,since:mode==='running'?at-2040:mode==='finishing'?at-22:resumed||at-720,checkedAt:now,resumeEligible:mode==='stalled'&&!resumed,preview:true},
      wizard_attention:finished?{state:'done',ask:'Example request completed after Continue',subject:'Wizard OS'}:null,
      latest_message:{role:'assistant',content:finished?'The preview request is complete. Continue resumed it, and this example has moved to Ready. Live work was unchanged.':'Illustrative helper-status example. Live work is unchanged.',timestamp:finished?resumed+3:at-1},
      last_user_message:{role:'user',content:'Example only: finish this request after its helpers return.',timestamp:at-2200}};
  });
}
async function helperPreview(req,res,u) {
  const cookie=(req.headers.cookie||'').match(/wos_helper_preview=([a-zA-Z0-9-]+)/);
  const key=cookie?.[1]||require('crypto').randomUUID();
  if(!cookie) res.setHeader('Set-Cookie',`wos_helper_preview=${key}; Path=/; HttpOnly; SameSite=Lax`);
  const json=(code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if(u.pathname==='/wizard/preview/helper-continue' && req.method==='POST') {
    let raw=''; for await(const c of req) {raw+=c;if(raw.length>1024)return json(413,{error:'too_large'});}
    let body;try{body=JSON.parse(raw)}catch{return json(400,{error:'invalid_request'});}
    if(body.session_id!=='wizard_preview_helpers_stalled')return json(403,{error:'only_the_example_can_resume'});
    if(demos.has(key))return json(409,{error:'already_active'});
    demos.set(key,Date.now()/1000);return json(202,{ok:true,preview:true});
  }
  if(req.method!=='GET')return false;
  const mm=u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/(wizard_preview_helpers_(?:running|finishing|stalled))(\/messages)?$/);
  if(mm){
    const s=demoRows(key).find(x=>x.id===mm[1]);
    if(mm[2])return json(200,{object:'list',data:[{id:1,session_id:s.id,role:'user',content:s.last_user_message.content,timestamp:s.wizard_last_user_at},{id:2,session_id:s.id,role:'assistant',content:s.latest_message.content,timestamp:s.latest_message.timestamp}],pagination:{returned:2,limit:500,offset:0}});
    return json(200,{session:s});
  }
  if(u.pathname==='/wizard/hermes/api/sessions') {
    const r=await fetch('http://127.0.0.1:8923'+req.url);if(!r.ok)return json(r.status,{error:'upstream_unavailable'});
    const p=await r.json(),rows=p.data||p.sessions||[];
    const {readHelperStatuses}=await helperModule();
    const statuses=readHelperStatuses(require('./qa-paths.cjs').hermesPath('state.db'),rows.map(r=>r.id),{activeSessionIds:new Set(rows.filter(r=>r.wizard_run_id&&['running','queued','submitting','stopping'].includes(r.status)).map(r=>r.id))});
    for(const row of rows){const h=statuses.get(row.id);if(h)row.wizard_helper_status={...h,resumeEligible:false,previewReadOnly:true};}
    if((u.searchParams.get('offset')||'0')==='0')rows.unshift(...demoRows(key));
    if(p.data)p.data=rows;else p.sessions=rows;
    return json(200,p);
  }
  return false;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try { if(await helperPreview(req,res,u)!==false) return; } catch(e) {res.writeHead(502);return res.end('Preview read unavailable');}
  if (u.pathname === '/__qa/refused') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ refused })); }
  if (u.pathname.startsWith('/wizard/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { refused++; res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"qa-origin refuses writes"}'); }
    const headers = { ...req.headers }; delete headers.host; delete headers.origin; delete headers.referer;
    const p = http.request({ ...BACKEND, method: req.method, path: req.url, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', e => { res.writeHead(502); res.end(String(e)); });
    return p.end();
  }
  if (u.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') { refused++; res.writeHead(403); return res.end('{}'); }
    const p = http.request({ host: '127.0.0.1', port: 9271, method: 'GET', path: req.url }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); });
    return p.end();
  }
  let rel = u.pathname.startsWith('/wizard-os-home/') ? u.pathname.slice('/wizard-os-home/'.length) : u.pathname === '/wizard-os-home' ? '' : null;
  if (rel == null) { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
  rel = decodeURIComponent(rel) || 'index.html';
  if (rel.includes('..') || rel.split('/').some(s => s.startsWith('.'))) { res.writeHead(404); return res.end(); }
  let f = path.join(WEB, rel);
  if (!fs.existsSync(f)) f = path.join(FALLBACK, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP, 'permissions-policy': 'microphone=(self)' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`qa-origin http://127.0.0.1:${PORT}/wizard-os-home/ → ${WEB} (reads proxied to :8923, writes refused)`));