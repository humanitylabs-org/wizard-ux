// Synthetic-only appearance preview. Used by qa-origin and CI: zero upstream networking.
const fs = require('node:fs'), path = require('node:path');
const apps = [['preview-notes','Notes'],['preview-calendar','Calendar'],['preview-stories','Stories'],['preview-wisdom','Wisdom'],['preview-topics','Topics']];
let refused = 0, runs = 0;
const bootstrap = `(() => {
  if (sessionStorage.getItem('backgrounds-orb-seeded')) return;
  sessionStorage.setItem('backgrounds-orb-seeded','1');
  for (const [k,v] of Object.entries({'wos.coached':'true','wos.voiceTipSeen':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic','wos.skin':'nebula','wos.skin-tweaks.v1':JSON.stringify({version:1,off:{},preset:'none',mix:{}})})) localStorage.setItem(k,v);
})();`;
const json = (res, status, value) => { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify(value)); };
module.exports = function handle(req, res, web) {
  const u = new URL(req.url,'http://preview'), p = u.pathname;
  if (!['GET','HEAD'].includes(req.method)) {
    refused++; if (/\/v1\/runs|\/sessions$/.test(p)) runs++;
    json(res,403,{error:'Synthetic appearance preview: sends, voice, and upstream writes disabled'}); return true;
  }
  if (p === '/__preview/receipt') { json(res,200,{sha:process.env.PREVIEW_SHA || 'ci',synthetic:true,readOnly:true,upstream:false,refused,runs}); return true; }
  if (p === '/__preview/bootstrap.js') { res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'}); res.end(bootstrap); return true; }
  if (p === '/') { res.writeHead(302,{location:'/wizard-os-home/?shell=desktop&view=skin'}); res.end(); return true; }
  if (p.startsWith('/wizard-os-home/')) {
    const rel=p.slice('/wizard-os-home/'.length) || 'index.html';
    if (['index.html','desktop.html'].includes(rel)) {
      const html=fs.readFileSync(path.join(web,rel),'utf8').replace('<head>','<head><script src="/__preview/bootstrap.js"></script>');
      res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','permissions-policy':'microphone=()'}); res.end(html); return true;
    }
    if (['data.js','summaries.js'].includes(rel)) { res.writeHead(200,{'content-type':'application/javascript'}); res.end(rel==='data.js'?'window.WIZ_DATA={threads:[],projects:{}};':'window.WIZ_SUMMARIES={};'); return true; }
    return false; // Only this candidate's tracked static shell files reach qa-origin; no live data fallback.
  }
  const app=apps.find(([id])=>p===`/preview-apps/${id}/`);
  if (app) {
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});
    res.end(`<!doctype html><title>${app[1]} · synthetic preview</title><script src="/wizard-os-home/core/app-client.js"></script><style>body{background:var(--wz-base,#05030c);color:var(--wz-text,#f3efff);font:16px system-ui;padding:24px}</style><h1>${app[1]}</h1><p>Sample app for appearance review. No owner data or actions.</p>`); return true;
  }
  if (p === '/wizard/v1/bootstrap') { json(res,200,{bootstrap:1,api:'wizard-agent-service/1',settings:{owner:{name:'Preview'},agent:{name:'Wizard'},clock:{timezone:'UTC',day_starts_at:'06:00'},voice:{language:'en',vocabulary:[]}},capabilities:{voice:false,router:false,files:false,approvals:false,steer:false,markdown:true},endpoints:{sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs',apps:'/wizard/v1/apps'}}); return true; }
  if (p === '/wizard/v1/apps') { json(res,200,{apps:apps.map(([id,name])=>({id,name,desc:'Synthetic preview app',url:`/preview-apps/${id}/`,icon:name[0],source:'launcher.json'}))}); return true; }
  if (p === '/wizard/hermes/api/sessions') { json(res,200,{data:[],has_more:false}); return true; }
  if (p === '/wizard/hermes/api/model/options') { json(res,200,{model:'preview',provider:'fixture',providers:[{slug:'fixture',name:'Synthetic appearance preview (no inference)',authenticated:true,is_current:true,models:['preview']}]}); return true; }
  if (p === '/wizard/v1/ui-preferences') { json(res,200,{pinnedChats:[],spaces:[],migrations:{'launcher.v1':true}}); return true; }
  if (p === '/wizard/thread-seen') { json(res,200,{state:{initializedAt:1793836800000,threads:{}}}); return true; }
  if (p === '/wizard/thread-dispositions') { json(res,200,{state:{}}); return true; }
  if (p === '/wizard/v1/skins' || p === '/wizard/v1/pages/wizard-look/look.json') { json(res,404,{error:'No box state in synthetic preview'}); return true; }
  json(res,200,{}); return true;
};
