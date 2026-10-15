#!/usr/bin/env node
// Owner-local CLI and read-only Store source cache. No credential or command is catalog-controlled.
import {readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync, statSync, copyFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const exec = promisify(execFile);
export const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA = /^[a-f0-9]{40}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const MAX = 2 * 1024 * 1024;
const fail = code => { throw Error(code); };
const text = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n && !/[\x00-\x1f\x7f]/.test(v);
const keys = (o, allowed) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => allowed.includes(k));
export const stateDir = () => resolve(process.env.WIZARD_ALPHA_HOME || join(homedir(), '.local/share/wizard-alpha'));
export function readJSON(p) { if (statSync(p).size > MAX) fail('document_too_large'); return JSON.parse(readFileSync(p, 'utf8')); }
export function atomic(p, value) {
  mkdirSync(dirname(p), {recursive:true, mode:0o700});
  const tmp = p + '.' + randomUUID();
  try { writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', {mode:0o600, flag:'wx'}); renameSync(tmp,p); }
  finally { rmSync(tmp, {force:true}); }
}
export async function locked(home, name, fn) {
  mkdirSync(home,{recursive:true,mode:0o700}); const p=join(home,name+'.lock');
  try { mkdirSync(p); } catch { fail('operation_busy'); }
  try { return await fn(); } finally { rmSync(p,{recursive:true,force:true}); }
}
export function validateEntry(a) {
  if (!keys(a,['id','name','summary','repo','commit','version','tag','architectures','images','gateway','release_url','release_notes'])) fail('invalid_entry_fields');
  if (!ID.test(a.id || '') || !REPO.test(a.repo || '') || !SHA.test(a.commit || '') || !text(a.name,80) || !text(a.summary,400) || !text(a.version,40) || !/^[\w.+-]+$/.test(a.version) || !text(a.tag,100) || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(a.tag)) fail('invalid_release');
  if (!Array.isArray(a.architectures) || !a.architectures.length || a.architectures.length>2 || new Set(a.architectures).size!==a.architectures.length || a.architectures.some(x=>!['amd64','arm64'].includes(x))) fail('invalid_architectures');
  if (!keys(a.images,a.architectures) || Object.keys(a.images).length!==a.architectures.length) fail('missing_images');
  for (const arch of a.architectures) {
    const i=a.images[arch];
    if (!keys(i,['asset','sha256','image_id','image','asset_id','bytes']) || !/^[\w.-]+\.tar(?:\.gz)?$/.test(i.asset || '') || !/^[a-f0-9]{64}$/.test(i.sha256 || '') || !/^sha256:[a-f0-9]{64}$/.test(i.image_id || '') || !/^[a-zA-Z0-9][a-zA-Z0-9/_.:@-]{0,250}$/.test(i.image || '') || !Number.isSafeInteger(i.asset_id) || i.asset_id<=0 || !Number.isSafeInteger(i.bytes) || i.bytes<=0) fail('invalid_image');
  }
  if (!keys(a.gateway,['path','strip_prefix']) || !/^\/[a-z0-9][a-z0-9-]*\/$/.test(a.gateway.path || '') || typeof a.gateway.strip_prefix!=='boolean') fail('invalid_gateway');
  if (a.release_url!==undefined && a.release_url!==`https://github.com/${a.repo}/releases/tag/${a.tag}`) fail('invalid_release_url');
  if (a.release_notes!==undefined && !text(a.release_notes,2000)) fail('invalid_release_notes');
  return structuredClone(a);
}
export function validateSnapshot(doc) {
  if (!keys(doc,['source','revision','apps']) || !keys(doc.source,['schema','id','name','channel']) || doc.source.schema!==1 || !ID.test(doc.source.id || '') || !text(doc.source.name,60) || doc.source.channel!=='alpha' || !SHA.test(doc.revision || '') || !Array.isArray(doc.apps) || doc.apps.length>200) fail('invalid_source');
  const seen=new Set(); for (const a of doc.apps) { validateEntry(a); if(seen.has(a.id)) fail('duplicate_app'); seen.add(a.id); }
  return doc;
}
export async function run(argv, options={}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x=>typeof x!=='string' || x.includes('\0'))) fail('invalid_local_command');
  return exec(argv[0],argv.slice(1),{timeout:120000,maxBuffer:MAX,...options});
}
export async function gh(endpoint, body, env=process.env) {
  // Never echo gh stderr: it may include private repository names or auth diagnostics.
  try {
    const argv=['gh','api',endpoint]; if(body) argv.push('--method','PUT','--input','-');
    if (!body) return JSON.parse((await run(argv,{env})).stdout);
    return await new Promise((ok,no)=>{
      const p=execFile(argv[0],argv.slice(1),{env,timeout:120000,maxBuffer:MAX},(e,out)=>{ if(e) no(Error('github_write_failed')); else {try{ok(JSON.parse(out));}catch{no(Error('github_invalid_response'));}} });
      p.stdin.end(JSON.stringify(body));
    });
  } catch { fail(body?'github_write_failed':'github_read_failed'); }
}
export function config(home=stateDir()) {
  const c=readJSON(join(home,'config.json'));
  if(c.schema!==1 || !REPO.test(c.repo || '') || !text(c.ref,120) || !/^[\w./-]+$/.test(c.ref) || c.ref.includes('..')) fail('invalid_config');
  return c;
}
export async function fetchSnapshot(c, api=gh) {
  const head=await api(`repos/${c.repo}/commits/${encodeURIComponent(c.ref)}`);
  if(!SHA.test(head.sha || '')) fail('invalid_revision');
  const tree=await api(`repos/${c.repo}/git/trees/${head.sha}?recursive=1`);
  if(tree.truncated || !Array.isArray(tree.tree) || tree.tree.length>1000) fail('catalog_tree_too_large');
  const files=tree.tree.filter(x=>x.path==='source.json' || /^apps\/[^/]+\.json$/.test(x.path));
  if(files.length>201 || !files.some(x=>x.path==='source.json')) fail('invalid_catalog_tree');
  const docs=[];
  for(const f of files) {
    if(f.type!=='blob' || f.mode!=='100644' || f.size>64000) fail('invalid_catalog_file');
    const b=await api(`repos/${c.repo}/git/blobs/${f.sha}`);
    if(b.encoding!=='base64' || b.size>64000) fail('invalid_catalog_blob');
    const d=JSON.parse(Buffer.from(b.content,'base64').toString('utf8'));
    if(f.path!=='source.json' && f.path!==`apps/${d.id}.json`) fail('entry_filename_mismatch');
    docs.push([f.path,d]);
  }
  const source=docs.find(([p])=>p==='source.json')[1];
  if(c.sourceId && source.id!==c.sourceId) fail('source_identity_changed');
  return validateSnapshot({source,revision:head.sha,apps:docs.filter(([p])=>p!=='source.json').map(([,d])=>d)});
}
export async function refresh(home=stateDir(), {force=false,api=gh,now=Date.now}={}) {
  return locked(home,'refresh',async()=>{
    const c=config(home); const old=existsSync(join(home,'snapshot.json'))?readJSON(join(home,'snapshot.json')):null;
    const s=existsSync(join(home,'status.json'))?readJSON(join(home,'status.json')):{};
    if(!force && s.at && now()-s.at<60000) return {snapshot:old,status:s};
    try {
      const snapshot=await fetchSnapshot(c,api); atomic(join(home,'snapshot.json'),snapshot);
      const status={at:now(),last_good:now(),stale:false,error:null,revision:snapshot.revision}; atomic(join(home,'status.json'),status);
      return {snapshot,status};
    } catch {
      const status={at:now(),last_good:s.last_good || null,stale:true,error:'source_unavailable',revision:old?.revision || null}; atomic(join(home,'status.json'),status);
      return {snapshot:old,status};
    }
  });
}
export function cached(home=stateDir()) {
  if(!existsSync(join(home,'config.json'))) return null;
  let snapshot=null,status={stale:true,error:'not_refreshed'};
  try { snapshot=validateSnapshot(readJSON(join(home,'snapshot.json'))); } catch {}
  try { status=readJSON(join(home,'status.json')); } catch {}
  // Configuration URLs, command argv, paths and credentials never reach the Store.
  return {snapshot,status:{stale:status.stale===true,error:status.error?'source_unavailable':null,last_good:status.last_good || null,revision:snapshot?.revision || null}};
}
export async function subscribe(repo, ref='main', home=stateDir(),api=gh) {
  if(!REPO.test(repo || '') || !/^[\w./-]+$/.test(ref) || ref.includes('..')) fail('invalid_subscription');
  return locked(home,'config',async()=>{
    const old=existsSync(join(home,'config.json'))?config(home):null;
    if(old && (old.repo!==repo || old.ref!==ref)) fail('subscription_exists_use_separate_home');
    const c={schema:1,repo,ref}; const snapshot=await fetchSnapshot(c,api);
    for(const a of snapshot.apps) await verifyRelease(a,api);
    atomic(join(home,'config.json'),{...old,...c,sourceId:snapshot.source.id});
    atomic(join(home,'snapshot.json'),snapshot); atomic(join(home,'status.json'),{at:Date.now(),last_good:Date.now(),stale:false,revision:snapshot.revision});
    return {source:snapshot.source.id,revision:snapshot.revision,apps:snapshot.apps.length};
  });
}
export async function verifyRelease(a,api=gh) {
  validateEntry(a);
  const commit=await api(`repos/${a.repo}/commits/${a.commit}`); if(commit.sha!==a.commit) fail('source_commit_mismatch');
  const md=await api(`repos/${a.repo}/contents/wizard.md?ref=${a.commit}`);
  const raw=Buffer.from(md.content || '','base64').toString('utf8');
  if(!new RegExp(`^id:\\s*["']?${a.id}["']?\\s*$`,'m').test(raw)) fail('manifest_identity_mismatch');
  const release=await api(`repos/${a.repo}/releases/tags/${encodeURIComponent(a.tag)}`);
  const tagged=await api(`repos/${a.repo}/commits/${encodeURIComponent(a.tag)}`);
  if(tagged.sha!==a.commit) fail('release_tag_commit_mismatch');
  for(const i of Object.values(a.images)) {
    const asset=release.assets?.find(x=>x.id===i.asset_id);
    if(!asset || asset.name!==i.asset || asset.size!==i.bytes || (asset.digest && asset.digest!==`sha256:${i.sha256}`)) fail('artifact_identity_mismatch');
  }
  return a;
}
export async function publish(entry,home=stateDir(),{api=gh,expected}={}) {
  const c=config(home), a=await verifyRelease(validateEntry(entry),api);
  // Shared default branches must change by PR. Publish to an explicitly subscribed review branch.
  if(['main','master','daily'].includes(c.ref)) fail('publish_requires_review_branch');
  const initial=await fetchSnapshot(c,api), prior=initial.apps.find(x=>x.id===a.id);
  if(prior && prior.repo!==a.repo) fail('app_repository_conflict');
  if(expected!==undefined && (prior?.commit || 'absent')!==expected) fail('publish_conflict');
  const base=JSON.stringify(prior || null);
  for(let attempt=0;attempt<3;attempt++) {
    const current=await fetchSnapshot(c,api), previous=current.apps.find(x=>x.id===a.id);
    if(JSON.stringify(previous)===JSON.stringify(a)) return {revision:current.revision,unchanged:true,detail:`/wizard-os-home/store/?app=${a.id}&source=${current.source.id}`};
    if(JSON.stringify(previous || null)!==base) fail('publish_conflict');
    let blob;
    if(previous) blob=await api(`repos/${c.repo}/contents/apps/${a.id}.json?ref=${current.revision}`);
    try {
      const r=await api(`repos/${c.repo}/contents/apps/${a.id}.json`,{message:`alpha: ${a.id} ${a.version}`,branch:c.ref,content:Buffer.from(JSON.stringify(a,null,2)+'\n').toString('base64'),...(blob?{sha:blob.sha}:{})});
      const check=await fetchSnapshot({...c,ref:r.commit.sha},api);
      if(JSON.stringify(check.apps.find(x=>x.id===a.id))!==JSON.stringify(a)) fail('publish_readback_mismatch');
      await refresh(home,{force:true,api});
      return {revision:check.revision,detail:`/wizard-os-home/store/?app=${a.id}&source=${check.source.id}`,review_branch:c.ref};
    } catch(e) { if(e.message!=='github_write_failed' || attempt===2) throw e; }
  }
}
export async function install({source,id,commit,update=false},home=stateDir(),{runner=run,api=gh}={}) {
  if(!ID.test(source || '') || !ID.test(id || '') || !SHA.test(commit || '')) fail('invalid_selection');
  return locked(home,'install',async()=>{
    const c=config(home), snap=cached(home)?.snapshot;
    if(!snap || snap.source.id!==source) fail('source_not_subscribed');
    const a=snap.apps.find(x=>x.id===id && x.commit===commit); if(!a) fail('selected_release_not_current_refresh_and_reselect');
    await verifyRelease(a,api);
    const arch=process.env.WIZARD_ALPHA_ARCH || ({arm64:'arm64',x64:'amd64'}[process.arch]); if(!a.architectures.includes(arch)) fail('unsupported_architecture');
    const policy=readJSON(join(home,'install-policy.json'));
    // Executables/activation adapter are owner-local, never supplied by the remote catalog or browser.
    if(!Array.isArray(policy.wam) || !Array.isArray(policy.activate) || !policy.activate.length) fail('activation_not_configured');
    if(!policy.registry) fail('installed_registry_required');
    const registry=readJSON(policy.registry), existing=registry.apps?.find(x=>x.id===id);
    if(existing && existing.repo!==a.repo) fail('installed_repository_conflict');
    if(existing && !update) fail('already_installed_explicit_update_required');
    if(!existing && update) fail('not_installed_use_install');
    const dir=join(home,'installs',`${source}-${id}-${commit}`); mkdirSync(dir,{recursive:true,mode:0o700});
    const catalog=join(dir,'catalog.json'); atomic(catalog,{schema:1,scope:'private-test',apps:[a]});
    const env={...process.env,WAM_PRIVATE_CATALOG:catalog};
    // update is explicit: never silently turn install into a channel switch.
    await runner([...policy.wam,...(update?['app','update',id]:['install',id])],{env,timeout:900000});
    const receiptFile=join(dir,'activation.json'); rmSync(receiptFile,{force:true});
    await runner([...policy.activate,'--catalog',catalog,'--app',id,'--commit',commit,'--receipt',receiptFile],{env,timeout:120000});
    const r=readJSON(receiptFile);
    if(r.id!==id || r.commit!==commit || r.status!=='running' || r.open_verified!==true || !/^\/[a-z0-9][a-z0-9-]*\/$/.test(r.view || '')) fail('activation_not_verified');
    const installed=existsSync(join(home,'installed.json'))?readJSON(join(home,'installed.json')):{};
    installed[id]={source,id,repo:a.repo,commit,version:a.version,view:r.view,verified_at:Date.now()}; atomic(join(home,'installed.json'),installed);
    return {id,source,commit,version:a.version,view:r.view,open_verified:true};
  });
}
function flags(args) {
  const out={}; for(let i=0;i<args.length;i++) { if(!args[i].startsWith('--')) fail('expected_named_option'); const k=args[i].slice(2); out[k]=['force','update'].includes(k)?true:args[++i]; } return out;
}
async function main() {
  const [cmd,...args]=process.argv.slice(2), f=flags(args), home=resolve(f.home || stateDir()); let result;
  if(cmd==='subscribe') result=await subscribe(f.repo,f.ref || 'main',home);
  else if(cmd==='refresh') {const r=await refresh(home,{force:!!f.force}); result={...r.status,apps:r.snapshot?.apps.length || 0}; if(r.status.stale) process.exitCode=1;}
  else if(cmd==='publish') {
    const manifest=readJSON(f.catalog); if(manifest.schema!==1 || manifest.scope!=='private-test') fail('checked_private_catalog_required');
    const a=manifest.apps?.find(a=>a.id===f.app); if(!a || (f.repo && f.repo!==a.repo) || (f.commit && f.commit!==a.commit)) fail('release_not_in_manifest');
    result=await publish({...a,...(f.notes?{release_notes:f.notes}:{})},home,{expected:f.expected});
  } else if(cmd==='install') result=await install({source:f.source,id:f.app,commit:f.commit,update:!!f.update},home);
  else if(cmd==='status') {const c=cached(home); result={source:c?.snapshot?.source,status:c?.status,apps:c?.snapshot?.apps.map(a=>({id:a.id,commit:a.commit,version:a.version})) || []};}
  else fail('usage_subscribe_refresh_publish_install_status');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(JSON.stringify({error:/^[a-z_]+$/.test(e.message)?e.message:'operation_failed'}));process.exitCode=1;});
