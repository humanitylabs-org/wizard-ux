// All source merging/search happens here: private names and queries never go upstream.
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {cached, refresh, stateDir, readJSON} from './wizard-alpha.mjs';
export function privateApps(path=process.env.WAM_PRIVATE_CATALOG) {
  if(!path) return [];
  const doc=JSON.parse(readFileSync(path,'utf8'));
  if(doc.schema!==1 || doc.scope!=='private-test' || !Array.isArray(doc.apps)) throw Error('invalid_private_catalog');
  return doc.apps.map(a=>{
    if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.id) || !/^[0-9a-f]{40}$/.test(a.commit) || !/^[\w.-]+\/[\w.-]+$/.test(a.repo)) throw Error('invalid_private_pin');
    return {...a,type:'view',category:'app',tags:['private-test'],uses:[],provides:[],private:true,source:'owner-private',source_name:'Private test',channel:'standard',publisher:'Private test',url:`https://github.com/${a.repo}/tree/${a.commit}`};
  });
}
const text=(v,n)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,n):'';
const words=v=>Array.isArray(v)?v.filter(x=>typeof x==='string' && x.length<=60).slice(0,32):[];
// An allowlist, not a spread: neither catalog extras nor local command/config values reach clients.
export function projection(a) {
  return {id:text(a.id,64),name:text(a.name,80),summary:text(a.summary,400),repo:text(a.repo,201),version:text(a.version,40),
    source:text(a.source || 'standard',64),source_name:text(a.source_name || 'Standard',60),channel:a.channel==='alpha'?'alpha':'standard',
    commit:/^[a-f0-9]{40}$/.test(a.commit || a.install?.commit || '')?(a.commit || a.install.commit):'',
    private:a.private===true,type:text(a.type,24),category:text(a.category,32),publisher:text(a.publisher,80),
    tags:words(a.tags),uses:words(a.uses),provides:words(a.provides),architectures:words(a.architectures),
    release_notes:text(a.release_notes,2000),url:text(a.url,250),logo:text(a.logo,250),installs:Number.isSafeInteger(a.installs)?a.installs:0};
}
export function mergeRows(rows,installed={}) {
  const groups=new Map(),repos=new Map();
  for(const raw of rows) {
    const a=projection(raw); if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.id)) continue;
    const key=`${a.id}\0${a.repo}`, group=groups.get(key) || [];
    if(!group.some(x=>x.source===a.source && x.commit===a.commit)) group.push(a);
    groups.set(key,group); if(!repos.has(a.id)) repos.set(a.id,new Set()); repos.get(a.id).add(a.repo);
  }
  return [...groups.values()].map(releases=>{
    // Migrate only an exact legacy identity/pin; different legacy versions remain selectable.
    releases=releases.filter(a=>a.source!=='owner-private' || !releases.some(b=>b.channel==='alpha' && b.commit===a.commit));
    const i=installed[releases[0].id], preferred=releases.find(a=>a.source===i?.source) || releases.find(a=>a.channel==='standard') || releases[0];
    const alpha=releases.some(a=>a.channel==='alpha'), standard=releases.some(a=>a.channel==='standard');
    return {...preferred,releases,alpha_badge:alpha?(standard?'Alpha available':'Alpha'):'',conflict:repos.get(preferred.id).size>1,
      installed_source:text(i?.source,64),installed_commit:text(i?.commit,40),installed_app_id:text(i?.launcher_id,64),update_available:!!i && releases.some(a=>a.source===i.source && a.commit && a.commit!==i.commit)};
  });
}
export function withPrivateCatalog(upstream,read=privateApps,{home=stateDir(),sourceRead=()=>cached(home),refreshSource=()=>refresh(home),now=Date.now}={}) {
  let publicRows=[],publicAt=0,publicError=false,inflight=null,sourceFlight=null,legacy=[],legacyError=false;
  async function publicSnapshot(force=false) {
    if(!force && publicAt && now()-publicAt<60000) return;
    if(inflight) return inflight;
    inflight=(async()=>{
      const rows=[],seen=new Set(); let offset=0;
      try {
        for(let page=0;page<100;page++) {
          // No client parameters, IDs, names or private paths are forwarded.
          const r=await upstream('/search',new URLSearchParams({limit:'100',offset:String(offset)}));
          if(r.status!==200 || !Array.isArray(r.body?.apps)) throw Error('index_unavailable');
          rows.push(...r.body.apps); if(r.stale) throw Error('index_stale');
          const next=r.body.next_offset;
          if(next===null || next===undefined) { publicRows=rows; publicError=false; publicAt=now(); return; }
          if(!Number.isSafeInteger(next) || next<=offset || seen.has(next)) throw Error('invalid_pagination');
          seen.add(next); offset=next;
        }
        throw Error('index_too_large');
      } catch { publicError=true; publicAt=now(); }
    })().finally(()=>{inflight=null;}); return inflight;
  }
  return async(path,q=new URLSearchParams())=>{
    if(!['/search','/tags'].includes(path) && !/^\/apps\/[\w.-]+\/[\w.-]+$/.test(path)) return {status:404,body:{error:'not_found'}};
    let source=sourceRead();
    // Opening uses LKG immediately; forced Refresh awaits only a read-only catalog fetch.
    if(source && !sourceFlight) sourceFlight=refreshSource().catch(()=>null).finally(()=>{sourceFlight=null;});
    if(q.get('refresh')==='1' && source) { if(sourceFlight) await sourceFlight; await refresh(home,{force:true}).catch(()=>null); source=sourceRead(); }
    await publicSnapshot(q.get('refresh')==='1');
    try {legacy=read();legacyError=false;} catch {legacyError=true;}
    let installed={}; try {if(existsSync(join(home,'installed.json'))) installed=readJSON(join(home,'installed.json'));} catch {}
    const alpha=(source?.snapshot?.apps || []).map(a=>({...a,source:source.snapshot.source.id,source_name:source.snapshot.source.name,channel:'alpha',private:true,type:'view',category:'app',tags:['alpha'],publisher:source.snapshot.source.name,url:`https://github.com/${a.repo}/tree/${a.commit}`}));
    const rows=mergeRows([...publicRows,...legacy,...alpha],installed);
    const statuses=[{id:'standard',name:'Standard',stale:publicError,error:publicError?'index_unavailable':null},{id:'owner-private',name:'Private test',stale:legacyError,error:legacyError?'private_catalog_unavailable':null},...(source?[{id:source.snapshot?.source.id || 'alpha',name:source.snapshot?.source.name || 'Wizard Alpha',...source.status}]:[])];
    if(path.startsWith('/apps/')) {
      const a=rows.find(x=>x.repo===path.slice(6)); return a?{status:200,body:{...a,sources:statuses}}:{status:404,body:{error:'not_found',sources:statuses}};
    }
    if(path==='/tags') return {status:200,body:{tags:[...new Set(rows.flatMap(a=>a.releases.flatMap(r=>r.tags)))].sort(),sources:statuses}};
    const term=(q.get('q') || '').toLowerCase();
    let filtered=rows.filter(a=>(!q.get('id') || a.id===q.get('id')) && a.releases.some(r=>(!q.get('source') || r.source===q.get('source')) && (!q.get('type') || r.type===q.get('type')) && (!q.get('category') || r.category===q.get('category')) && (!q.get('tag') || r.tags.includes(q.get('tag'))) && (!term || [r.name,r.summary,r.publisher,...r.tags].join(' ').toLowerCase().includes(term))));
    if(q.get('sort')==='name') filtered.sort((a,b)=>a.name.localeCompare(b.name));
    else if(q.get('sort')==='installs') filtered.sort((a,b)=>b.installs-a.installs);
    const limit=Math.min(100,Math.max(1,Number(q.get('limit') || 100)||100)), offset=Math.max(0,Number(q.get('offset') || 0)||0);
    return {status:200,body:{apps:filtered.slice(offset,offset+limit),next_offset:offset+limit<filtered.length?offset+limit:null,total:filtered.length,sources:statuses,public_index_unavailable:publicError}};
  };
}
