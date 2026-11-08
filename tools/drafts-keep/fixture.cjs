// Synthetic registered-frame host, NOT the production shell or a device proof.
// Use actual palette application and core resources; never simulate a skin with dataset alone.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const css = ['core/base.css', 'styles.css', 'core/skins.css', 'kit/shell-tokens.css', 'core/appearance-host.css', 'core/update-banner.css'];
const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
function host(shell) {
  assert(['phone', 'desktop'].includes(shell));
  return `<!doctype html><html data-shell="${shell}"><head>${head}${css.map(p => `<link rel="stylesheet" href="/wizard-os-home/${p}">`).join('')}
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:block;color:var(--wz-text);background:var(--wz-base)}#fixture-stage{position:relative;width:100%;height:100%;isolation:isolate}#notice-mount{position:absolute;top:12px;right:18px;z-index:60}.win{position:absolute;inset:84px 8px 74px;display:flex;flex-direction:column;background:var(--wz-window);border:1px solid var(--wz-border);border-radius:16px}.win header{padding:12px}.win iframe{border:0;width:100%;flex:1;min-height:0;background:transparent}#messenger{position:absolute;left:-10000px;width:1px;height:1px;border:0}#paint-probe{position:absolute;inset:0;pointer-events:none}#dvWeb,.wos-reload-detail{will-change:transform}</style>
<script src="/wizard-os-home/core/skins.js"></script></head><body><main id="fixture-stage"><div id="paint-probe"></div><section class="win"><header>Wisdom · Synthetic reload test</header></section><div id="notice-mount"></div></main>
<script>window.WizCore={apps:()=>({APPS:[{id:'wisdom',name:'Wisdom',kind:'wizard',url:'/wisdom/'},{id:'messenger',name:'Messenger',kind:'wizard',url:'/messenger/'}]})};window.WizAppCapture={reloadCheck:()=>({safe:true,pageAudioFree:true}),cancelReloadRecovery:()=>true,staleTakes:()=>[]};</script>
<script src="/wizard-os-home/core/appearance-host.js"></script><script src="/wizard-os-home/core/app-services.js"></script><script src="/wizard-os-home/core/web-update.js"></script>
<script>WizWebUpdate.init({shell:document.documentElement.dataset.shell,mount:()=>document.documentElement.dataset.shell==='desktop'?document.querySelector('#notice-mount'):document.querySelector('#fixture-stage'),busy:()=>false,toast:()=>{}});const f=document.createElement('iframe');f.id='wisdom';f.src='/wisdom/';document.querySelector('.win').append(f);WizAppServices.attach(f,{appId:'wisdom',path:'/wisdom/'});const m=document.createElement('iframe');m.id='messenger';m.title='Background Messenger synthetic voice owner';m.src='/messenger/';document.querySelector('#fixture-stage').append(m);WizAppServices.attach(m,{appId:'messenger',path:'/messenger/'});</script></body></html>`;
}
const frame = `<!doctype html><html data-theme="dark" data-section="wisdom"><head>${head}${['base.css','wisdom.css','collections.css','app.css','wizard-appearance.css'].map(p=>`<link rel="stylesheet" href="/wisdom/${p}">`).join('')}<script src="/wisdom/wizard-appearance.js"></script><script src="/wizard-os-home/core/app-client.js"></script></head><body><div id="app"></div><div id="toast"></div><script>window.$=(q,r=document)=>r.querySelector(q);window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));window.toast=()=>{};</script><script src="/wisdom/fixture-wisdom.js"></script><script>WizardApp.ready({name:'Wisdom'}).then(()=>Wisdom.openRequest());</script></body></html>`;
const messenger = `<!doctype html><html><head>${head}<script src="/wizard-os-home/core/app-client.js"></script></head><body><script>WizardApp.ready({name:'Messenger'}).then(()=>window.fixtureReady=true);</script></body></html>`;
const mime = {'.js':'application/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.woff2':'font/woff2'};
const utf8Type = type => /^(text\/|application\/(javascript|json))/.test(type) ? type + '; charset=utf-8' : type;
function createFixture({shell, wisdom}) {
  const transformed = fs.readFileSync(path.join(wisdom,'wisdom.js'),'utf8').replace('return {syncOffline,','return {openRequest,syncOffline,');
  assert(transformed.includes('return {openRequest,syncOffline,'));
  let revision = 'a'.repeat(40);
  const server = http.createServer((q,r)=>{
    const u = new URL(q.url,'http://fixture'), p = u.pathname;
    let body, type='text/html';
    if (q.method !== 'GET') { r.writeHead(405); return r.end(); }
    if(p==='/fixture/update'){revision=(revision[0]==='a'?'b':'a').repeat(40);body='ok';type='text/plain';}
    else if(p==='/') body=host(u.searchParams.get('shell') || 'phone');
    else if(p==='/wisdom/') body=frame;
    else if(p==='/messenger/') body=messenger;
    else if(p==='/wisdom/fixture-wisdom.js'){body=transformed;type='application/javascript';}
    else if(p==='/wizard-os-home/ux-version.txt'){body=revision;type='text/plain';}
    else if(p==='/wizard-os-home/ux-changes.json'){body=JSON.stringify({updates:[]});type='application/json';}
    else {
      const base=p.startsWith('/wizard-os-home/')?shell:p.startsWith('/wisdom/')?wisdom:null;
      const rel=decodeURIComponent(p.replace(/^\/(wizard-os-home|wisdom)\//,''));
      if(!base || rel.split('/').includes('..')){r.writeHead(404);return r.end();}
      const file=path.resolve(base,rel);
      if(!file.startsWith(base+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){r.writeHead(404);return r.end();}
      body=fs.readFileSync(file);type=mime[path.extname(file)]||'application/octet-stream';
    }
    r.writeHead(200,{'Content-Type':utf8Type(type),'Cache-Control':'no-store'});r.end(body);
  });
  return server;
}
module.exports={createFixture,host,frame,messenger,utf8Type};
