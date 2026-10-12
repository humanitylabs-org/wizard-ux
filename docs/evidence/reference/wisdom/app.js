'use strict';
/* Wisdom shell: one quiet space. No feed, no tabs, no links to other apps. */
const $=s=>document.querySelector(s), base=new URL('.',location.href);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={feed:'M4 7h16M4 12h16M4 17h10',home:'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',wisdom:'M12 7a4 4 0 0 0-4-3H2v15h6a4 4 0 0 1 4 2 4 4 0 0 1 4-2h6V4h-6a4 4 0 0 0-4 3zm0 0v14',people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6m-3-3h6',plus:'M12 5v14M5 12h14',save:'M6 3h12v18l-6-4-6 4z',me:'M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',arrow:'M7 17 17 7M7 7h10v10',close:'m6 6 12 12M6 18 18 6',check:'m5 12 4 4L19 6',shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z',refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2',more:'M5 12h.01M12 12h.01M19 12h.01',up:'M7 10v10H3V10h4zm0 0 5-7h2v7h6l-2 10H7',down:'M7 14V4H3v10h4zm0 0 5 7h2v-7h6L18 4H7',play:'m9 5 11 7-11 7z',back:'m15 18-6-6 6-6',star:'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',archive:'M3 4h18v4H3zM5 8v12h14V8M10 12h4',undo:'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',alert:'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',copy:'M9 9h11v11H9zM5 15H4V4h11v1',search:'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5.2-5.2',spark:'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'};
const icon=n=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[n]||icons.wisdom}"/></svg>`;
function safe(raw){if(typeof raw!=='string'||!raw.trim())return '';try{let u=new URL(raw,base);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
function avatar(s){let name=String(s.name||s.source_name||s.author||'?').trim(),initials=name.replace(/^@/,'').split(/\s+/).map(x=>x[0]).slice(0,2).join('')||'?';return `<span class="avatar" data-tone="${name.length%5}" data-initials="${esc(initials)}">${s.avatar?`<img src="${esc(safe(s.avatar))}" alt="" loading="lazy" referrerpolicy="no-referrer">`:esc(initials)}</span>`}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000)}
async function api(path,body){let r=await fetch(new URL('api/'+path,base),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});let d=await r.json();if(!r.ok)throw Error(d.error||'Unable to connect');return d}
// wisdom.js reads these names; in this app the route is always Wisdom.
let route='wisdom',epoch=0;
function render(){
 $('#app').innerHTML=`<div class="w-layout"><main class="w-main" id="content">${Wisdom.render()}</main><aside class="w-rail" aria-label="Collections">${Wisdom.rail()}</aside></div>`;
 document.querySelectorAll('img').forEach(i=>i.onerror=()=>{i.style.display='none';const p=i.parentElement;if(p?.classList.contains('avatar'))p.textContent=p.dataset.initials||'?'});
 Wisdom.bind();
}
window.renderWisdom=render;
// Back never exits: a root sentinel sits under the library; reaching it re-arms and stays on the library.
// Inside a Wizard window the shell owns Back at the app's root, so no sentinel there.
const framed=(()=>{try{return window.top!==window}catch{return true}})();
const startHash=location.hash;
if(!framed){history.replaceState({wisdom:true,root:true},'',location.pathname);history.pushState({wisdom:true},'',location.pathname+startHash)}
else history.replaceState({wisdom:true},'',location.pathname+startHash);
window.addEventListener('popstate',e=>{
 if(document.querySelector('.wb-sheet'))return;
 // A typed/linked hash change arrives with no state: just follow it.
 if(!e.state&&location.hash.length>1){Wisdom.syncHash();return}
 Wisdom.remember();epoch++;
 if(!framed&&(!e.state||e.state.root)){history.pushState({wisdom:true},'',location.pathname);Wisdom.enter({restore:true});toast('You’re at your library.');return}
 Wisdom.enter({restore:true});
});
window.addEventListener('hashchange',()=>Wisdom.syncHash());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)Wisdom.refreshDay()});
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
Wisdom.enter();
