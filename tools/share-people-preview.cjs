// Disposable synthetic-only preview. NO upstream, credentials, owner files, databases or send endpoints.
// Serves the real candidate shell and one fake Messenger receiver using the real WizardApp SDK.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const WEB = path.resolve(process.env.PREVIEW_WEB || path.join(__dirname, '../web'));
const ROOT = path.join(__dirname, '../tests/fixtures/share-people');
const PORT = Number(process.env.PORT || 9581);
const app = {id:'messenger', name:'Messenger', url:'/messenger/', view:{mode:'original',url:'/messenger/'}, status:'running', source:'apps.json', type:'service', category:'app'};
const agents = [{id:'hermes',label:'Test Agent',is_default:true,harness:'hermes',privacy:'standard',status:'running',appearance:{glyph:'spark',hue:265},permissions:{files:'shared-write'}}];
const types = {'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.webmanifest':'application/manifest+json'};
const csp = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
http.createServer((req,res) => {
  const u = new URL(req.url,'http://preview');
  const send = (body,type='application/json',status=200) => {res.writeHead(status,{'content-type':type,'cache-control':'no-store','content-security-policy':csp});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
  if (!['GET','HEAD'].includes(req.method)) return send({error:'Synthetic preview: sending and all server writes are disabled'},'application/json',403);
  if (u.pathname==='/__preview/receipt') return send({synthetic:true,upstream:false,writes:false,sha:process.env.PREVIEW_SHA||'working-tree'});
  if (u.pathname==='/') {res.writeHead(302,{location:'/wizard-os-home/?shell=phone'});return res.end();}
  if (u.pathname==='/__preview/bootstrap.js') return send(fs.readFileSync(path.join(ROOT,'bootstrap.js')),'application/javascript');
  if (u.pathname.startsWith('/messenger/')) return send(fs.readFileSync(path.join(ROOT,u.pathname.endsWith('receiver.js')?'receiver.js':'index.html')),u.pathname.endsWith('receiver.js')?'application/javascript':'text/html');
  if (u.pathname==='/wizard/v1/bootstrap') return send({bootstrap:1,settings:{owner:{name:'Test Owner'},agent:{name:'Test Agent'},clock:{timezone:'UTC',day_starts_at:'00:00'},voice:{language:'',vocabulary:[]}},capabilities:{files:true},endpoints:{apps:'/wizard/v1/apps',sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs'}});
  if (u.pathname==='/wizard/v1/apps') return send({schema:1,apps:[app],in_development:[],slots:{},parking:[]});
  if (u.pathname==='/wizard/v1/agents') return send({agents});
  if (u.pathname==='/wizard/hermes/api/sessions') return send({object:'list',data:[],has_more:false});
  if (u.pathname==='/wizard/v1/ui-preferences') return send({pinnedChats:[],spaces:[],readyOrder:'newest',subjectOrder:[],migrations:{'launcher.v1':true}});
  if (/\/events$/.test(u.pathname)) return send('','text/event-stream');
  if (/^\/wizard-os-home\/(data|summaries)\.js$/.test(u.pathname)) return send('','application/javascript');
  if (u.pathname.startsWith('/wizard-os-home/')) {
    let rel; try {rel=decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length))||'index.html';} catch{return send({},'application/json',400);}
    if (rel.split('/').some(s=>s==='..'||s.startsWith('.'))) return send({},'application/json',404);
    const f=path.resolve(WEB,rel); if (!f.startsWith(WEB+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()) return send({},'application/json',404);
    let body=fs.readFileSync(f); if (rel==='index.html'||rel==='desktop.html') body=body.toString().replace('<head>','<head><script src="/__preview/bootstrap.js"></script>');
    return send(body,types[path.extname(f)]||'application/octet-stream');
  }
  return send({});
}).listen(PORT,'127.0.0.1',()=>console.log(`Synthetic share-people preview on ${PORT}, shell=${WEB}, no upstream`));
