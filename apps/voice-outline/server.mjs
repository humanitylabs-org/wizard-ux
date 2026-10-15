import http from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { validateDocument } from './web/model.js';

const root=dirname(fileURLToPath(import.meta.url)), data=resolve(process.env.OUTLINE_DATA || './app-data');
mkdirSync(data,{recursive:true,mode:0o700});
const db=new DatabaseSync(join(data,'outline.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS document (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audio (take TEXT, seq INTEGER, hash TEXT, bytes BLOB, PRIMARY KEY(take,seq)); CREATE TABLE IF NOT EXISTS speech (id TEXT PRIMARY KEY, target TEXT, seq INTEGER, text TEXT, status TEXT, updated INTEGER);');
const initial={title:'Untitled outline',nodes:[{id:'first-bullet',parent:null,text:'',folded:false}],applied:[]};
db.prepare('INSERT OR IGNORE INTO document VALUES(1,0,?)').run(JSON.stringify(initial));
const getDoc=()=>{const row=db.prepare('SELECT * FROM document WHERE id=1').get();return {rev:row.rev,document:JSON.parse(row.body)};};
const hosts=new Set((process.env.WIZARD_TRUSTED_HOSTS||'localhost,127.0.0.1,[::1]').split(','));
const origins=new Set((process.env.WIZARD_TRUSTED_ORIGINS||'').split(',').filter(Boolean));
function trusted(req){let u;try{u=new URL('http://'+req.headers.host);}catch{return false;}if(!hosts.has(u.hostname))return false;return !req.headers.origin || req.headers.origin===`http://${req.headers.host}` || origins.has(req.headers.origin);}
function json(res,code,value){res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
async function body(req,limit=2e6){const parts=[];let bytes=0;for await(const b of req){bytes+=b.length;if(bytes>limit)throw Object.assign(new Error('Request too large'),{status:413});parts.push(b);}return Buffer.concat(parts);}
function putDoc(payload){validateDocument(payload.document);const old=getDoc();if(payload.rev!==old.rev)return {conflict:true,...old};db.prepare('UPDATE document SET rev=?,body=? WHERE id=1').run(old.rev+1,JSON.stringify(payload.document));return getDoc();}
let provider;
if(process.env.TINFOIL_API_KEY && process.env.TINFOIL_PROVIDER_MODULE){const {TinfoilProvider}=await import(pathToFileURL(resolve(process.env.TINFOIL_PROVIDER_MODULE)));provider=new TinfoilProvider(process.env.TINFOIL_API_KEY,null,'voxtral-mini-4b-realtime');}
const server=http.createServer(async(req,res)=>{
 try{
  if(!trusted(req))return json(res,403,{error:'Host or Origin not trusted'});
  const url=new URL(req.url,'http://localhost'), path=url.pathname;
  if(path==='/healthz')return json(res,200,{ok:true,app:'voice-outline',liveReady:!!provider,model:'voxtral-mini-4b-realtime',source:process.env.SOURCE_SHA||null});
  if(path==='/api/document' && req.method==='GET')return json(res,200,getDoc());
  if(path==='/api/document' && req.method==='PUT'){const result=putDoc(JSON.parse(await body(req)));return json(res,result.conflict?409:200,result);}
  if(path==='/api/speech' && req.method==='GET')return json(res,200,{utterances:db.prepare('SELECT id,target,seq,text,status FROM speech ORDER BY updated LIMIT 5000').all()});
  const audio=path.match(/^\/api\/audio\/([A-Za-z0-9_-]{1,128})\/(\d{1,6})$/);
  if(audio){const [,take,num]=audio,seq=Number(num);
   if(req.method==='PUT'){
    const b=await body(req,400000),hash=createHash('sha256').update(b).digest('hex');
    const old=db.prepare('SELECT hash FROM audio WHERE take=? AND seq=?').get(take,seq);
    if(old && old.hash!==hash)return json(res,409,{error:'Immutable audio chunk mismatch'});
    const size=db.prepare('SELECT coalesce(sum(length(bytes)),0) AS size FROM audio').get().size;
    if(!old && size+b.length>512*1024*1024)return json(res,507,{error:'Audio storage full; capture retained on device'});
    db.prepare('INSERT OR IGNORE INTO audio VALUES(?,?,?,?)').run(take,seq,hash,b);
    return json(res,200,{take,seq,hash,bytes:b.length});
   }
   const row=db.prepare('SELECT hash,bytes FROM audio WHERE take=? AND seq=?').get(take,seq);
   if(!row)return json(res,404,{error:'Chunk not found'});
   if(url.searchParams.has('raw')){res.writeHead(200,{'content-type':'audio/wav','cache-control':'no-store'});return res.end(Buffer.from(row.bytes));}
   return json(res,200,{take,seq,hash:createHash('sha256').update(row.bytes).digest('hex'),bytes:row.bytes.length});
  }
  if(path==='/mcp' && req.method==='POST'){
   const m=JSON.parse(await body(req));let result;
   if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'voice-outline',version:'0.1.0'}};
   else if(m.method==='tools/list')result={tools:[{name:'outline_read',description:'Read the durable outline and revision.',inputSchema:{type:'object',properties:{}}},{name:'outline_replace',description:'Replace an outline using its exact revision; conflicts are never overwritten.',inputSchema:{type:'object',required:['rev','document'],properties:{rev:{type:'integer'},document:{type:'object'}}}}]};
   else if(m.method==='tools/call'){const v=m.params?.name==='outline_read'?getDoc():m.params?.name==='outline_replace'?putDoc(m.params.arguments):{error:'Unknown tool'};result={content:[{type:'text',text:JSON.stringify(v)}],isError:!!(v.error||v.conflict)};}
   else if(m.method?.startsWith('notifications/')){res.writeHead(202);return res.end();}else return json(res,200,{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
   return json(res,200,{jsonrpc:'2.0',id:m.id,result});
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  let file;
  if(path.startsWith('/wizard-os-home/core/')){
   const name=path.slice('/wizard-os-home/core/'.length);
   if(!['app-client.js','app-capture.js','app-services.js'].includes(name)||!process.env.WIZARD_CORE_DIR)return json(res,404,{error:'Shared core unavailable'});
   file=join(process.env.WIZARD_CORE_DIR,name);
  }else{
   const rel=path==='/'?'index.html':decodeURIComponent(path.slice(1));file=resolve(root,'web',rel);
   if(!file.startsWith(resolve(root,'web')+'/'))return json(res,403,{error:'Forbidden'});
  }
  if(!existsSync(file))return json(res,404,{error:'Not found'});
  res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin'});res.end(readFileSync(file));
 }catch(e){json(res,e.status||400,{error:e.message});}
});
const wss=new WebSocketServer({noServer:true,maxPayload:100000});let sockets=0;
server.on('upgrade',(req,socket,head)=>{if(!trusted(req)||req.url!=='/api/live'||!provider||sockets>=4){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));});
wss.on('connection',ws=>{
 sockets++;const streams=new Map();let active=null,closed=false,total=0;
 const send=m=>{if(ws.readyState===1)ws.send(JSON.stringify(m));};
 const save=(s,status,text)=>db.prepare('INSERT INTO speech VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,status=excluded.status,updated=excluded.updated').run(s.id,s.target,s.seq,text,status,Date.now());
 const fail=(s,e)=>{s.failed=true;save(s,'draft',s.text);send({type:'error',id:s.id,reason:String(e.message||e).slice(0,200)});};
 ws.on('message',async(raw,binary)=>{
  try{
   if(binary){const s=streams.get(active);if(!s||s.ended||s.failed)throw new Error('No live utterance');total+=raw.length;if(total>32*1024*1024)throw new Error('Live safety limit reached; stop and save');s.bytes+=raw.length;
    if(s.stream)s.stream.append(Buffer.from(raw));else{if(s.queued+raw.length>640000)throw new Error('Provider startup stalled; audio retained');s.queue.push(Buffer.from(raw));s.queued+=raw.length;}return;}
   const m=JSON.parse(raw);
   if(m.type==='begin'){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(m.id)||typeof m.target!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(m.target)||!Number.isSafeInteger(m.seq))throw new Error('Invalid utterance identity');
    if(streams.size>=3)throw new Error('Waiting for earlier finals; pause before continuing');
    if(db.prepare('SELECT id FROM speech WHERE id=?').get(m.id))throw new Error('Utterance already exists');
    const s={id:m.id,target:m.target,seq:m.seq,text:'',queue:[],queued:0,bytes:0,ended:false};streams.set(s.id,s);active=s.id;save(s,'draft','');
    s.stream=await provider.openRealtime({delta:t=>{s.text+=t;save(s,'draft',s.text);send({type:'delta',id:s.id,target:s.target,seq:s.seq,text:s.text,audioBytes:s.bytes});},completed:t=>{s.text=t||s.text;save(s,'final',s.text);send({type:'final',id:s.id,target:s.target,seq:s.seq,text:s.text});streams.delete(s.id);clearTimeout(s.timer);},error:e=>fail(s,e)});
    if(s.failed||closed){s.stream.close().catch(()=>{});return;}
    for(const b of s.queue)s.stream.append(b);s.queue=[];s.queued=0;send({type:'ready',id:s.id});if(s.ended)s.stream.close().catch(e=>fail(s,e));
   }else if(m.type==='end'){
    const s=streams.get(m.id);if(!s)return;s.ended=true;if(active===s.id)active=null;
    s.timer=setTimeout(()=>{fail(s,new Error('Final timed out — draft retained'));streams.delete(s.id);s.stream?.close().catch(()=>{});},35000);
    if(!s.bytes){clearTimeout(s.timer);save(s,'final','');send({type:'final',id:s.id,target:s.target,seq:s.seq,text:''});streams.delete(s.id);}
    s.stream?.close().catch(e=>fail(s,e));
   }else throw new Error('Unknown live control');
  }catch(e){send({type:'error',reason:e.message});}
 });
 ws.on('close',()=>{closed=true;sockets--;for(const s of streams.values()){clearTimeout(s.timer);s.stream?.close().catch(()=>{});}streams.clear();});
 send({type:'connected',model:'voxtral-mini-4b-realtime'});
});
server.listen(Number(process.env.PORT||8799),process.env.BIND||'127.0.0.1',()=>console.log(JSON.stringify({event:'listening',port:server.address().port,liveReady:!!provider})));
process.on('SIGTERM',()=>{wss.clients.forEach(w=>w.close());server.close(()=>{db.close();process.exit(0);});});
