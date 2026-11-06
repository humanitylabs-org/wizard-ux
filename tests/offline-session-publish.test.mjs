import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=new URL('..',import.meta.url).pathname;
function boot(){
  const stores=new Map();
  const caches={open:async n=>{if(!stores.has(n))stores.set(n,new Map());const m=stores.get(n);return {match:async u=>m.get(u)?.clone(),put:async(u,r)=>m.set(u,r.clone())}}};
  const listeners={};
  const ctx=vm.createContext({caches,Response,navigator:{},addEventListener:(n,f)=>listeners[n]=f,setTimeout,clearTimeout,window:{},globalThis:null});
  ctx.globalThis=ctx;vm.runInContext(readFileSync(root+'web/core/offline-session.js','utf8'),ctx);
  return {S:ctx.WizOfflineSession,stores,listeners,ctx};
}
const app=(id,offline,source='apps.json')=>({id,source,homeScreen:offline?{offline:true}:null});
const saved=async stores=>JSON.parse(await (await stores.get('wizard-os-home-registry').get('/wizard-os-home/offline-apps.json')).text());
test('publishes exactly the ids installed apps declared offline, sorted',async()=>{
  const {S,stores}=boot();assert.equal(await S.publish([app('zeta',true),app('alpha',true),app('plain',false)]),true);
  assert.deepEqual(await saved(stores),{v:1,ids:['alpha','zeta']});
});
test('an empty or launcher-only registry never erases the last good list',async()=>{
  const {S,stores}=boot();await S.publish([app('alpha',true)]);
  assert.equal(await S.publish([]),false);assert.equal(await S.publish([app('x',true,'launcher.json')]),false);
  assert.deepEqual(await saved(stores),{v:1,ids:['alpha']});
});
test('an uninstall or withdrawn declaration is published once a real registry arrives',async()=>{
  const {S,stores}=boot();await S.publish([app('alpha',true)]);await S.publish([app('alpha',false),app('beta',false)]);
  assert.deepEqual(await saved(stores),{v:1,ids:[]});
});
test('ids that are not safe app ids are never published',async()=>{
  const {S,stores}=boot();await S.publish([app('good',true),app('../x',true),app('A',true)]);assert.deepEqual(await saved(stores),{v:1,ids:['good']});
});
test('generated worker config is current',()=>{
  const r=spawnSync('python3',['tools/build-offline-session.py','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});
