// Disposable synthetic service. No owner stores, credentials or upstream writes.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {historyRevision} from './cache-evidence.mjs';
const [service, ux, root] = process.argv.slice(2).map(p=>resolve(p));
mkdirSync(root,{recursive:true});
const { createWizardServer, listen } = await import(pathToFileURL(join(service,'server/service.mjs')));
const path=join(root,'state.db'),db=new DatabaseSync(path), now=Date.now()/1000;
db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,title_source TEXT,started_at REAL,source TEXT,model TEXT,model_config TEXT,ended_at REAL,end_reason TEXT,message_count INT,parent_session_id TEXT,last_activity_at REAL,pinned INT DEFAULT 0,archived INT DEFAULT 0,hidden INT DEFAULT 0);
 CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp REAL,active INT DEFAULT 1,compacted INT DEFAULT 0,display_kind TEXT,display_metadata TEXT,tool_calls TEXT,tool_call_id TEXT,finish_reason TEXT DEFAULT 'stop');
 CREATE INDEX history_idx ON messages(session_id,timestamp DESC);
 CREATE TABLE session_turn_leases(conversation_id TEXT,expires_at REAL);
 CREATE TABLE async_delegations(delegation_id TEXT PRIMARY KEY,origin_session_id TEXT,parent_session_id TEXT,origin_ui_session_id TEXT,state TEXT,dispatched_at REAL,completed_at REAL,task_json TEXT,delivery_state TEXT,result_json TEXT);
 CREATE INDEX delegation_idx ON async_delegations(origin_session_id,state);`);
const put=db.prepare('INSERT INTO messages(session_id,role,content,timestamp,display_kind) VALUES(?,?,?,?,?)');
const status=(i)=>`\n[WIZARD_STATUS_V1]${JSON.stringify({state:'done',ask:`Synthetic answer ${i} saved`,subject:'Speed fixture'})}[/WIZARD_STATUS_V1]`;
db.exec('BEGIN');
for(let i=0;i<600;i++){
 const id=`wizard_speed_${i}`,count=i===0?1200:30,at=now-i;
 db.prepare('INSERT INTO sessions(id,title,title_source,started_at,source,model,message_count,last_activity_at) VALUES(?,?,?,?,?,?,?,?)').run(id,`Synthetic Ready ${i}`,'user',at-4000,'wizard-mobile','fixture',count,at);
 for(let k=0;k<count;k++)put.run(id,k%2?'assistant':'user',k===count-1?`SYNTHETIC_CURRENT_ANSWER_${i}_v1`+status(i):`Synthetic ${k%2?'answer':'request'} ${i}/${k} `+'content '.repeat(20),at-count+k,k%2?'final':null);
}
db.exec('COMMIT');
let upstreamWrites=0, ticks=0;
const histories=id=>db.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY timestamp,id').all(id);
const sessions=()=>db.prepare('SELECT * FROM sessions ORDER BY last_activity_at DESC,id').all().map(s=>({...s,created_at:s.started_at,status:'completed',last_active:s.last_activity_at}));
const send=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const fetchImpl=async(url,init={})=>{
 if(init.method&&!['GET','HEAD'].includes(init.method)){upstreamWrites++;throw Error('SYNTHETIC_UPSTREAM_WRITE_REFUSED');}
 const u=new URL(url),m=u.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(messages))?$/);
 if(m){const s=sessions().find(s=>s.id===m[1]);if(!s)return new Response('{}',{status:404});
  if(!m[2])return send({session:s});
  const all=histories(s.id),offset=+(u.searchParams.get('offset')||0),limit=+(u.searchParams.get('limit')||500),data=all.slice(offset,offset+limit);
  return send({data,pagination:{returned:data.length},has_more:offset+limit<all.length});}
 if(u.pathname==='/api/sessions')return send({data:sessions(),has_more:false});
 if(u.pathname==='/health')return send({status:'ok',model:'synthetic',provider:'synthetic'});
 return send({data:[],activities:[],sessions:[]});
};
for(const name of ['os','files','skins','home'])mkdirSync(join(root,name),{recursive:true});
writeFileSync(join(root,'apps.json'),JSON.stringify({apps:[]}));
// Start after onboarding, using real persisted Setup state rather than hiding UI.
writeFileSync(join(root,'settings.json'),JSON.stringify({schema:1,setup:{seen_at:new Date().toISOString()}}));
const server=createWizardServer({requireAccess:false,hermesKey:'synthetic-only',fetchImpl,
 uxDir:join(ux,'web'),wizardOsHome:join(root,'os'),hermesHome:join(root,'home'),appsJsonPath:join(root,'apps.json'),
 userFilesRoot:join(root,'files'),skinsStateDir:join(root,'skins'),settingsPath:join(root,'settings.json'),
 hermesStatePath:path,sessionDbPath:path,runQueueStatePath:join(root,'queue.db'),
 canonicalSessionReader:async()=>sessions(),archivedSessionReader:()=>[],followThrough:false,ownedOpenWork:false,
 listCacheCheckMs:2000,skins:{relays:[],blossom:'https://127.0.0.1/fixture-offline'}});
await listen(server,'127.0.0.1',0);
const origin=`http://127.0.0.1:${server.address().port}`;
writeFileSync(join(root,'ready.json'),JSON.stringify({origin,pid:process.pid,threads:db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,messages:db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,synthetic:true}));
const delay=monitorEventLoopDelay({resolution:10});delay.enable();let cpu=process.cpuUsage(),at=performance.now();
const metrics=setInterval(()=>{
 const usage=process.cpuUsage(cpu),end=performance.now();cpu=process.cpuUsage();
 appendFileSync(join(root,'metrics.jsonl'),JSON.stringify({elapsed_ms:end-at,cpu_user_ms:usage.user/1000,cpu_system_ms:usage.system/1000,eventloop_p95_ms:delay.percentile(95)/1e6,eventloop_max_ms:delay.max/1e6,upstreamWrites,ticks})+'\n');at=end;delay.reset();
},1000);
// Background progress changes canonical revision during every list/check sample.
const writer=setInterval(()=>{ticks++;put.run('wizard_speed_599','tool',`Synthetic background heartbeat ${ticks}`,Date.now()/1000,null);db.prepare('UPDATE sessions SET message_count=message_count+1,last_activity_at=? WHERE id=?').run(Date.now()/1000,'wizard_speed_599')},300);
process.on('message',m=>{
 if(m.op!=='answer'||!/^wizard_speed_\d+$/.test(m.id))return;
 db.exec('BEGIN');put.run(m.id,'user','Synthetic newer owner request',m.stamp,null);put.run(m.id,'assistant',m.text+status(m.id),m.stamp+.001,'final');
 db.prepare('UPDATE sessions SET message_count=message_count+2,last_activity_at=? WHERE id=?').run(m.stamp+.001,m.id);db.exec('COMMIT');
 process.send?.({id:m.id,revision:historyRevision(histories(m.id))});
});
async function stop(){clearInterval(writer);clearInterval(metrics);delay.disable();server.closeAllConnections?.();await new Promise(r=>server.close(r));writeFileSync(join(root,'custody.json'),JSON.stringify({upstreamWrites,ticks}));db.close();process.exit(upstreamWrites?2:0)}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
