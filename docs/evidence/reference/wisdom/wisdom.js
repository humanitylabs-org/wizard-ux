/* Evergreen reading stays independent from live-feed polling. */
const Wisdom = (() => {
 let data=null,error='',loading=false,serial=0,writing=false;
 const scrolls=new Map();
 let currentRoute='';
 // Reader text size: 0 small … 3 extra large, remembered on this device.
 const sizeKey='wisdom:'+new URL('.',location.href).pathname+':size';
 let size=1;try{const v=localStorage.getItem(sizeKey)??localStorage.getItem('wisdom:/wizard-signal/:size');if(v!==null&&/^[0-3]$/.test(v))size=+v}catch{}
 const parseRoute=()=>location.hash.slice(1).split('/');
 const active=()=>route==='wisdom';
 const link=(path,text,cls='')=>`<a class="${cls}" href="#${path||'/'}" data-wisdom-route="${esc(path)}">${text}</a>`;
 const thinker=e=>data.thinkers.find(t=>t.id===e.thinker);
 const label=e=>e.label||(e.part?`Part ${e.part}`:'Overview');
 const pubIcon=t=>avatar({name:t.name});
 function inline(s){
  // Escape everything first. Editorial Markdown has no raw HTML surface.
  const links=[];
  const hold=(t,u)=>{links.push(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);return `\u0000${links.length-1}\u0000`};
  return esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,t,u)=>hold(t,u)).replace(/https?:\/\/[^\s<>\u0000]+/g,u=>{const clean=u.replace(/[.,;]+$/,'');return hold(clean,clean)+u.slice(clean.length)}).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/\u0000(\d+)\u0000/g,(_,i)=>links[Number(i)]);
 }
 function markdown(text){
  return text.replace(/^# [^\n]+\n+/,'').split(/\n\s*\n/).map(block=>{
   if(/^---+$/.test(block.trim()))return '<hr>';
   const h=block.match(/^(#{2,4}) (.+)$/);if(h)return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
   if(block.startsWith('> '))return `<blockquote>${inline(block.replace(/^> ?/gm,'')).replace(/\n/g,'<br>')}</blockquote>`;
   if(/^[-*] /.test(block))return `<ul>${block.split(/\n(?=[-*] )/).map(x=>`<li>${inline(x.replace(/^[-*] /,''))}</li>`).join('')}</ul>`;
   if(/^\d+\. /.test(block))return `<ol>${block.split(/\n(?=\d+\. )/).map(x=>`<li>${inline(x.replace(/^\d+\. /,''))}</li>`).join('')}</ol>`;
   return `<p>${inline(block).replace(/\n/g,'<br>')}</p>`;
  }).join('');
 }
 // Foreign-language phrases (James, 12 Oct): each glossed phrase gets a thin dotted underline; a tap opens a
 // popover with the romanisation, an English sound-alike and the meaning. Glosses live in content/glosses.json.
 const GLOSS_RUN=/[\u3400-\u9fff\uf900-\ufaff][\u3400-\u9fff\uf900-\ufaff，。？！、；：·]*[\u3400-\u9fff\uf900-\ufaff]|[\u3400-\u9fff\uf900-\ufaff]/g;
 function glossed(html){
  const g=data.glosses||{},keys=Object.keys(g).sort((a,b)=>b.length-a.length);if(!keys.length)return html;
  const wrap=k=>`<span class="wb-gloss" lang="${esc(g[k].lang||'')}" data-gloss="${esc(k)}" role="button" tabindex="0" aria-label="${esc(k)}: translate">${k}</span>`;
  let inA=0;
  return html.split(/(<[^>]*>)/).map(part=>{
   if(part.startsWith('<')){if(/^<a[\s>]/i.test(part))inA++;else if(/^<\/a>/i.test(part))inA=Math.max(0,inA-1);return part}
   if(inA)return part;
   return part.replace(GLOSS_RUN,run=>{
    if(g[run])return wrap(run);
    let out='',i=0;while(i<run.length){const k=keys.find(k=>run.startsWith(k,i));if(k){out+=wrap(k);i+=k.length}else out+=run[i++]}
    return out;
   });
  }).join('');
 }
 function entryActions(e){return `<div class="wisdom-card-actions"><button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="saved" aria-pressed="${e.saved}" aria-label="${e.saved?'Unstar':'Star'} ${esc(e.title)}">${icon('star')}<span>${e.saved?'Starred':'Star'}</span></button>${e.archived?`<button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="archived" aria-label="Restore ${esc(e.title)}">${icon('undo')}<span>Restore</span></button>`:`<button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="done" aria-label="Done reading ${esc(e.title)}">${icon('check')}<span>Done</span></button><button class="wisdom-action" data-wisdom-entry="${esc(e.id)}" data-field="archived" aria-label="Archive ${esc(e.title)}">${icon('archive')}<span>Archive</span></button>`}</div>`}
 const status=e=>`${e.saved?' · ★ Starred':''}${e.archived?' · Archived':e.read?' · Read':''}`;
 // Collections are ordered chapter lists (one thinker or many); thinkers are a separate index.
 // A chapter's number is its place in a collection, so links carry the collection: #/read/<id>/<collection>.
 const seriesOf=id=>data.entries.filter(x=>x.thinker===id&&!x.dive_of).sort((a,b)=>a.part-b.part);
 const colById=id=>(data.collections||[]).find(c=>c.id===id);
 const colOf=(e,cid)=>{const c=cid&&colById(cid);return c&&c.entries.includes(e.id)?c:colById((e.collections||[])[0])};
 const chapNo=(e,c)=>c?.numbers?.[e.id];
 const short=(e,c=colOf(e))=>e.dive_of?'Deep dive':chapNo(e,c)?`Chapter ${chapNo(e,c)}`:c&&c.overview===e.id?'Overview':'';
 const dotted=(...xs)=>xs.filter(Boolean).join(' · ');
 const readLink=(e,c)=>'/read/'+e.id+(c?'/'+c.id:'');
 const art=e=>e.art||thinker(e).portrait;
 const bookTitle=c=>{const m=/^The wisdom of (.+)$/i.exec(c.title||'');return m?['The wisdom of',m[1]]:['',c.title]};
 const readCount=id=>seriesOf(id).filter(x=>x.read).length;
 const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
 const img=(src,cls,alt='')=>src?`<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`:`<span class="${cls} wb-noart" aria-hidden="true"></span>`;
 const initials=n=>esc(n.split(/\s+/).map(w=>w[0]).slice(0,2).join(''));
 // A many-minds collection gets a mosaic of its first portraits.
 const colArt=(c,cls)=>c.portrait?img(c.portrait,cls,c.title):c.mosaic?.length?`<span class="${cls} wb-mosaic n${c.mosaic.length}">${c.mosaic.map(src=>img(src,'wb-portrait')).join('')}</span>`:`<span class="${cls} wb-initial">${initials(bookTitle(c)[1])}</span>`;
 function colCover(c,{form=true}={}){
  const [,n]=bookTitle(c);
  return link('/collection/'+c.id,`<span class="wb-cover-art">${colArt(c,'wb-portrait')}${form?`<span class="wb-cover-form">${esc(FORMS[c.form]||'Theme')}</span>`:''}<span class="wb-cover-copy"><small>${esc(c.kind||'Collection')}</small><strong>${esc(n)}</strong></span></span><span class="wb-cover-meta">${dotted(plural(c.count,'chapter'),c.read?`${c.read} read`:'')}</span>${c.fresh?'<span class="wb-cover-new">New</span>':''}`,'wb-cover');
 }
 function thinkerCover(t){
  const total=seriesOf(t.id).length,done=readCount(t.id);
  return link('/thinker/'+t.id,`<span class="wb-cover-art">${t.portrait?img(t.portrait,'wb-portrait',t.name):`<span class="wb-portrait wb-initial">${initials(t.name)}</span>`}<span class="wb-cover-copy"><strong>${esc(t.name)}</strong></span></span><span class="wb-cover-meta">${dotted(plural(total,'chapter'),done?`${done} read`:'')}</span>${t.more?'<span class="wb-cover-pin" aria-label="Prioritized">★</span>':''}${t.fresh?'<span class="wb-cover-new">New</span>':''}`,'wb-cover');
 }
 // Library card with art thumbnail. The title link stays first in DOM.
 function row(e,{lead=false,reason=false}={}){
  const t=thinker(e);
  return `<article class="wisdom-row wisdom-card wb-row ${lead?'wisdom-lead':''} ${e.read?'is-read':''}" data-wisdom-id="${esc(e.id)}"><div class="wisdom-card-main">${link('/read/'+e.id,`<span class="wisdom-row-title">${esc(e.title)}</span>`,'wisdom-title-link')}<div class="wisdom-pubrow">${link('/thinker/'+e.thinker,`<span class="wisdom-byline-name">${esc(t.name)}</span>`,'wisdom-byline')}${short(e)?`<span class="wb-dot">·</span><span class="wb-chap">${esc(short(e))}</span>`:''}</div>${link('/read/'+e.id,`<p class="wisdom-description">${esc(e.deck||e.description)}</p>`,'wisdom-preview-link')}<div class="wisdom-card-foot"><span class="wisdom-meta">${e.minutes} min${status(e)}</span>${entryActions(e)}</div></div>${link('/read/'+e.id,img(art(e),'wb-thumb'),'wb-thumb-link')}</article>`;
 }
 function pref(t,compact=false){return `<button class="wisdom-action wisdom-thumb ${t.more?'selected':''}" data-wisdom-pref="${esc(t.id)}" aria-pressed="${t.more}" aria-label="More from ${esc(t.name)}" title="${t.more?'Tap to reset. ':''}Prioritize ${esc(t.name)} in your Wisdom feed, including tomorrow’s picks.">${icon('up')}<span>${compact?(t.more?'Prioritized':'More'):(t.more?'Prioritizing this thinker':'More from this thinker')}</span></button>`}
 const views={'to-read':'To read',starred:'Starred',archived:'Archived',all:'All'};
 const matches=(e,view)=>view==='starred'?e.saved:view==='archived'?e.archived:view==='all'?true:!e.archived;
 function viewTabs(view){const n=(data.highlights||[]).length;return `<nav class="wisdom-views" aria-label="Wisdom library views">${Object.entries(views).map(([id,name])=>link('/library/'+id,`${name} <span>${data.entries.filter(e=>matches(e,id)).length}</span>`,view===id?'selected':'')).join('')}${n||view==='highlights'?link('/highlights',`Highlights <span>${n}</span>`,view==='highlights'?'selected':''):''}</nav>`}
 // Highlights page: every saved passage, newest first, grouped by reading.
 function highlightsPage(){
  const list=data.highlights||[],byid=new Map(data.entries.map(e=>[e.id,e]));
  if(!list.length)return `<section class="wisdom-library"><p class="wisdom-empty">Long-press any sentence in a chapter, then tap Highlight. Your highlights collect here.</p></section>`;
  const groups=[];for(const h of list){const e=byid.get(h.entry_id);if(!e)continue;let g=groups.find(x=>x.e===e);if(!g)groups.push(g={e,hs:[]});g.hs.push(h)}
  return `<section class="wisdom-library wb-hl-page">${groups.map(({e,hs})=>`<article class="wb-hl-group"><header>${link('/read/'+e.id,`<strong>${esc(e.title)}</strong><span>${esc(dotted(thinker(e).name,short(e)))}</span>`,'wb-hl-src')}</header>${hs.sort((a,b)=>a.start-b.start).map(h=>`<figure class="wb-hl-item"><blockquote>${esc(h.text)}</blockquote><button class="wb-quiet" data-wisdom-copy="${h.id}" aria-label="Copy highlight">${icon('copy')}<span>Copy</span></button></figure>`).join('')}</article>`).join('')}</section>`;
 }
 // Home (James, 12 Oct): Currently reading → Suggested (+ Browse all) → one Search → Request a new collection.
 const FORMS={book:'Book',thinker:'Thinker',theme:'Theme'};
 const formOf=c=>FORMS[c.form]||'Theme';
 const entryById=id=>data.entries.find(x=>x.id===id);
 // Started = any chapter (or the overview) read; finished = no unread numbered chapter left.
 const started=c=>c.read>0&&!!c.next_id;
 const unstarted=c=>c.overview?!(entryById(c.overview)||{}).read&&!c.done:!c.read;
 function heroCol(){return (data.collections||[]).filter(c=>c.fresh&&unstarted(c)).sort((a,b)=>(b.added_at||'').localeCompare(a.added_at||''))[0]||null}
 function readingList(){
  return (data.collections||[]).filter(started).sort((a,b)=>(b.last_read_at||'').localeCompare(a.last_read_at||'')||(b.done/b.count-a.done/a.count));
 }
 function reading(){
  const list=readingList();if(!list.length)return '';
  return `<section class="wb-reading" aria-label="Currently reading"><div class="wb-head"><h2>Currently reading</h2><span>${list.length}</span></div><ol class="wb-reading-list">${list.map(c=>{
   const e=entryById(c.next_id),n=chapNo(e,c),pct=Math.round(100*c.done/Math.max(1,c.count));
   return `<li>${link(readLink(e,c),`<span class="wb-reading-art">${colArt(c,'wb-portrait')}</span><span class="wb-reading-copy"><small>${esc(formOf(c))} · ${esc(bookTitle(c).join(' ').trim())}</small><strong>${n?`Chapter ${n} of ${c.count}`:esc(short(e,c)||'Next')}</strong><span class="wb-reading-next">${esc(e.title)}</span><span class="wb-reading-bar" aria-label="${c.done} of ${c.count} chapters read"><span data-pct="${pct}"></span></span></span><span class="wb-reading-go" aria-hidden="true">›</span>`,'wb-reading-row')}</li>`}).join('')}</ol></section>`;
 }
 function suggestions(){
  const lead=heroCol(),taste=c=>c.thinkers.reduce((s,id)=>{const t=data.thinkers.find(x=>x.id===id);return s+(t?(t.more?3:0)+(t.taste||0):0)},0)/Math.max(1,c.thinkers.length);
  return (data.collections||[]).filter(c=>unstarted(c)&&c!==lead).sort((a,b)=>(b.fresh-a.fresh)||(b.fresh&&a.fresh?(b.added_at||'').localeCompare(a.added_at||''):0)||(taste(b)-taste(a))||((b.by==='Wizard')-(a.by==='Wizard'))).slice(0,6);
 }
 function suggested(){
  const list=suggestions(),all=(data.collections||[]).length;
  return `<section class="wb-shelf-wrap wb-suggested" aria-label="Suggested"><div class="wb-head"><h2>Suggested</h2>${link('/browse',`Browse all ${all} ›`,'wb-head-link')}</div>${list.length?`<div class="wb-shelf">${list.map(c=>colCover(c,{form:true})).join('')}</div>`:`<p class="wb-quiet-note">You’ve started every collection. ${link('/browse','Browse all')}</p>`}</section>`;
 }
 function browse(){
  const cols=[...(data.collections||[])].sort((a,b)=>(b.fresh-a.fresh)||started(b)-started(a)||a.title.localeCompare(b.title));
  const group=(form,title)=>{const list=cols.filter(c=>formOf(c)===FORMS[form]);return list.length?`<section class="wb-all-group" data-form="${form}"><div class="wb-head"><h2>${title}</h2><span>${list.length}</span></div><div class="wb-all-grid">${list.map(c=>colCover(c,{form:false})).join('')}</div></section>`:''};
  return `<section class="wb-all-thinkers wb-browse"><header class="wb-all-top">${link('','‹','wb-round" aria-label="Back')}<h1>Browse</h1></header>${group('book','Books')}${group('thinker','Thinkers')}${group('theme','Themes')}<p class="wb-browse-foot">${link('/thinkers',`Every thinker in Wisdom · ${data.thinkers.length} ›`,'wb-head-link')}</p></section>`;
 }
 // One search over collections, thinkers and chapters. Diacritics fold away ('nagarjuna' finds Nāgārjuna).
 let query='';
 const STOP=new Set('a an and are about as at be by can could do for from give how i i\'d id im in into is it like looking me more my of on or read reading show some something somebody someone tell that the their them there these this to want what which who why with would you'.split(' '));
 const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function search(q){
  const words=fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);if(!words.length)return null;
  // Spoken queries are sentences ("something on Stoic anger"): drop filler words; with 3+ terms half must match.
  const terms=words.filter(w=>w.length>1&&!STOP.has(w));if(!terms.length)terms.push(...words);
  const need=terms.length<3?terms.length:Math.ceil(terms.length/2);
  const score=fields=>{let total=0,hit=0;for(const t of terms){let best=0;for(const [text,w] of fields){if(fold(text).includes(t))best=Math.max(best,w)}if(best){hit++;total+=best}}return hit>=need?total+hit*10:0};
  const names=id=>data.thinkers.find(t=>t.id===id)||{};
  const cols=(data.collections||[]).map(c=>({c,s:score([[c.title,4],[formOf(c),2],[c.kind,2],[c.thinkers.map(id=>names(id).name).join(' '),3],[c.bio,1],[c.thinkers.map(id=>names(id).bio).join(' '),1]])})).filter(x=>x.s).sort((a,b)=>b.s-a.s).map(x=>x.c);
  const inCols=new Set(cols.flatMap(c=>c.thinkers));
  const ths=data.thinkers.map(t=>({t,s:score([[t.name,4],[t.bio,1],[t.series,2],[t.kind,2]])})).filter(x=>x.s&&!inCols.has(x.t.id)).sort((a,b)=>b.s-a.s).map(x=>x.t);
  const chs=data.entries.map(e=>({e,s:score([[e.title,4],[e.deck||e.description,2],[thinker(e)?.name,2]])})).filter(x=>x.s).sort((a,b)=>b.s-a.s).map(x=>x.e);
  return {cols,ths,chs};
 }
 function results(){
  const q=query.trim(),r=search(q);if(!r)return '';
  const req=`<button class="wb-request-q" data-wisdom-request="${esc(q)}">${icon('plus')}<span>Request a collection on “${esc(q)}”</span></button>`;
  const colRow=c=>link('/collection/'+c.id,`<span class="wb-res-art">${colArt(c,'wb-portrait')}</span><span class="wb-res-copy"><small>${esc(formOf(c))} · ${esc(c.kind||'Collection')}</small><strong>${esc(c.title)}</strong><span>${dotted(plural(c.count,'chapter'),c.done?`${c.done} read`:'')}</span></span>`,'wb-res wb-res-col');
  const thRow=t=>link('/thinker/'+t.id,`<span class="wb-res-art">${t.portrait?img(t.portrait,'wb-portrait',t.name):`<span class="wb-portrait wb-initial">${initials(t.name)}</span>`}</span><span class="wb-res-copy"><small>Thinker</small><strong>${esc(t.name)}</strong><span>${plural(seriesOf(t.id).length,'chapter')}</span></span>`,'wb-res wb-res-th');
  const chRow=e=>{const c=colOf(e);return link(readLink(e,c),`<span class="wb-res-art wb-res-ch">${img(art(e),'wb-portrait')}</span><span class="wb-res-copy"><small>${esc(dotted(c?bookTitle(c)[1]:thinker(e).name,short(e,c)))}</small><strong>${esc(e.title)}</strong><span>${esc(e.deck||'')}</span></span>`,'wb-res wb-res-chap')};
  const none=!r.cols.length&&!r.ths.length&&!r.chs.length;
  return `<div class="wb-results" aria-live="polite">${none?`<p class="wb-quiet-note">Nothing in Wisdom on “${esc(q)}” yet.</p>`:''}${r.cols.length?`<h3 class="wb-res-h">Collections</h3>${r.cols.map(colRow).join('')}`:''}${r.ths.length?`<h3 class="wb-res-h">Thinkers</h3>${r.ths.slice(0,6).map(thRow).join('')}`:''}${r.chs.length?`<h3 class="wb-res-h">Chapters <span>${r.chs.length}</span></h3>${r.chs.slice(0,12).map(chRow).join('')}`:''}${req}</div>`;
 }
 const micOn=target=>mic.recording&&mic.target===target;
 const micNote=target=>mic.target===target||(!mic.target&&mic.lastTarget===target)?mic.note:'';
 const micBtn=(target,label)=>`<button class="wb-mic ${micOn(target)?'on':''}" type="button" data-wisdom-mic="${target}" data-label="${esc(label)}" aria-pressed="${micOn(target)}" aria-label="${micOn(target)?'Stop recording':label}">${micOn(target)?'<span class="wb-mic-dot"></span>':micSvg}</button>`;
 const micSvg='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
 function searchBox(){
  return `<section class="wb-search" aria-label="Search"><div class="wb-head"><h2>Search</h2></div><div class="wb-search-field">${icon('search')}<input type="search" id="wb-q" enterkeyhint="search" autocomplete="off" placeholder="Search by topic, theme or thinker" aria-label="Search by topic, theme or thinker" value="${esc(query)}">${micBtn('search','Search by voice')}</div><p class="wb-mic-status" data-mic-status="search" role="status">${esc(micNote('search'))}</p><div id="wb-results">${results()}</div></section>`;
 }
 const reqStatus=r=>r.status==='building'?'Archimedes is building it':r.status==='unsent'?'Saved, not sent':r.status==='requested'?'Sending…':r.status==='done'?'Ready':r.status;
 function requestBlock(){
  const mine=(data.requests||[]).slice(0,3);
  return `<section class="wb-request" aria-label="Request a new collection"><button class="wb-request-btn" data-wisdom-request="">${icon('spark')}<span><strong>Request a new collection</strong><small>Describe it, or tap the mic and say it</small></span></button>${mine.length?`<ul class="wb-req-list">${mine.map(r=>`<li><span>${esc(r.text)}</span><small class="${r.status==='unsent'?'is-unsent':''}">${esc(reqStatus(r))}${r.status==='unsent'?` · <button class="wb-linkbtn" data-wisdom-retry-req="${r.seq}">Retry</button>`:''}</small></li>`).join('')}</ul>`:''}</section>`;
 }
 function allThinkers(){
  const byCount=(a,b)=>seriesOf(b.id).length-seriesOf(a.id).length||a.name.localeCompare(b.name);
  const ths=[...data.thinkers].sort(byCount),series=ths.filter(t=>seriesOf(t.id).length>1),single=ths.filter(t=>seriesOf(t.id).length<=1);
  const grid=(title,list)=>list.length?`<section class="wb-all-group"><div class="wb-head"><h2>${title}</h2><span>${list.length}</span></div><div class="wb-all-grid">${list.map(thinkerCover).join('')}</div></section>`:'';
  return `<section class="wb-all-thinkers"><header class="wb-all-top">${link('','‹','wb-round" aria-label="Back')}<h1>All thinkers</h1></header>${grid('Several chapters',series)}${grid('One chapter',single)}</section>`;
 }
 function hero(){
  // Newly added, unstarted collection leads (James just asked for it), else today's first read.
  // Unstarted means its overview is unread, so a collection built around a chapter James already read still leads.
  // Continuing a started collection lives in Currently reading just below, so the hero never repeats it.
  const nc=heroCol(),c=null;
  const e=nc?data.entries.find(x=>x.id===(nc.overview||nc.entries[0])):c?data.entries.find(x=>x.id===c.next_id):data.entries.find(x=>x.id===data.picks[0]);
  if(!e)return '';const th=thinker(e),col=c||colOf(e),n=chapNo(e,col);
  return `<section class="wb-hero-wrap">${link(readLink(e,col),`${img(art(e),'wb-hero-art')}<span class="wb-hero-shade"></span><span class="wb-hero-copy"><small>${nc?'New collection':c?'Continue reading':'Today’s first read'} · ${esc(nc?bookTitle(nc).join(' ').trim():c&&c.thinkers.length>1?c.title:th.name)}</small><strong>${esc(e.title)}</strong><span class="wb-hero-deck">${esc(e.deck)}</span><span class="wb-hero-foot"><span class="wb-pill">Read · ${e.minutes} min</span><span>${nc?`${nc.overview===e.id?'Overview · ':''}${plural(nc.count,'chapter')}`:n?`Chapter ${n} of ${col.count}`:''}</span></span></span>`,'wb-hero')}</section>`;
 }
 function picks(){
  const list=data.picks.map(id=>data.entries.find(e=>e.id===id)).filter(Boolean);
  if(!list.length)return '<p class="wisdom-empty">You’re caught up. Browse your collections to revisit a chapter.</p>';
  return `<section class="wb-picks-wrap" aria-label="Today’s picks"><div class="wb-head"><h2>Today’s picks</h2><span>A mix of minds</span></div><div class="wb-picks">${list.map(e=>link(readLink(e,colOf(e)),`${img(art(e),'wb-pick-art')}<span class="wb-pick-copy"><small>${esc(dotted(thinker(e).name,short(e)))}</small><strong>${esc(e.title)}</strong><span>${e.minutes} min</span></span>`,'wb-pick')).join('')}</div></section>`;
 }
 function library(view='to-read',omitPicks=false){
  const ids=data.orders?.[view]||data.entries.filter(e=>matches(e,view)).map(e=>e.id);
  const byid=new Map(data.entries.map(e=>[e.id,e]));
  const entries=ids.filter(id=>!omitPicks||!data.picks.includes(id)).map(id=>byid.get(id));
  return `<section class="wisdom-library"><div class="wisdom-section-label"><h2>${omitPicks?'Keep exploring':views[view]}</h2></div>${entries.map(e=>row(e)).join('')||`<p class="wisdom-empty">${view==='starred'?'Star a chapter to keep it here—even after you archive it.':view==='archived'?'Finished chapters will stay here. Done marks a chapter finished; Archive puts it aside.':omitPicks&&data.picks.length?'Your remaining chapters are in today’s choices above.':'You’re caught up. Your chapters are still in All and Archived.'}</p>`}</section>`;
 }
 function render(){
  document.documentElement.classList.toggle('wb-open',parseRoute()[1]==='read'&&!!data);
  if(!data)return `<section class="wisdom-notice"><h2>${error?'Wisdom couldn’t load':'Opening your library…'}</h2>${error?`<p>${esc(error)}</p><button class="btn" data-wisdom-retry>Try again</button>`:'<span class="spinner"></span>'}</section>`;
  let [,kind,id]=parseRoute();
  // Home stays simple: the long chapter list moved behind the library tabs at the foot.
  if(!kind)return `<div class="wisdom-home wb-home">${hero()}${reading()}${suggested()}${searchBox()}${requestBlock()}${picks()}<div class="wb-library-links">${viewTabs('to-read')}</div></div>`;
  if(kind==='browse')return browse();
  if(kind==='library'){const view=id;if(!views[view])return missing();return `${viewTabs(view)}<div class="wisdom-home">${library(view,false)}</div>`}
  if(kind==='thinkers')return allThinkers();
  if(kind==='highlights')return `${viewTabs('highlights')}<div class="wisdom-home">${highlightsPage()}</div>`;
  // One chapter row. In a many-minds collection the row names its thinker.
  const tocRow=(e,c,{who=false,next=null}={})=>`<li class="${e.read?'is-read':''} ${next===e.id?'is-next':''}">${link(readLink(e,c),`<span class="wb-ep-art">${img(art(e),'wb-toc-art')}${e.read?'<span class="wb-ep-done">✓</span>':''}</span><span class="wb-toc-copy"><small>${dotted(esc(short(e,c)),who?esc(thinker(e).name):'',`${e.minutes} min`)}${next===e.id?' · <b>Next</b>':''}</small><strong>${esc(e.title)}</strong><span>${esc(e.deck)}</span></span>`)}</li>`;
  const bookHero=({artHtml,kicker,title,stats,bio,cta,back=''})=>`<header class="wb-book-hero">${artHtml}<span class="wb-hero-shade"></span><div class="wb-book-top">${link(back,'‹','wb-round" aria-label="Back')}</div><div class="wb-book-copy"><small>${kicker}</small><h1>${title}</h1><div class="wb-book-stats">${stats.filter(Boolean).map(x=>`<span>${x}</span>`).join('')}</div><p>${esc(bio||'')}</p><div class="wb-book-cta">${cta}</div></div></header>`;
  if(kind==='collection'){
   const c=colById(id);if(!c)return missing();
   const [k,n]=bookTitle(c),start=data.entries.find(e=>e.id===c.next_id)||data.entries.find(e=>e.id===c.entries[0]),single=c.thinkers.length===1,t=single?data.thinkers.find(x=>x.id===c.thinkers[0]):null;
   const cta=(start?link(readLink(start,c),`${c.read?'Continue':'Start'} · ${esc(short(start,c)||'Overview')} →`,'wb-primary'):'')+(t?pref(t,true):'');
   const byid=new Map(data.entries.map(e=>[e.id,e]));
   const list=c.sections.filter(s=>s.entries.length).map(s=>`<section class="wb-season">${s.title?`<div class="wb-season-head"><h2>${esc(s.title)}</h2></div>`:''}<ol class="wb-toc">${s.entries.map(i=>tocRow(byid.get(i),c,{who:!single,next:c.next_id})).join('')}</ol></section>`).join('');
   const who=single?'':`<p class="wb-col-minds">${c.thinkers.map(i=>{const x=data.thinkers.find(t=>t.id===i);return link('/thinker/'+i,esc(x.name))}).join(' · ')}</p>`;
   return `<section class="wisdom-thinker wb-book wb-collection">${bookHero({artHtml:colArt(c,'wb-book-portrait'),kicker:`<span class="wb-form-tag">${esc(formOf(c))}</span> ${esc(c.kind||'Collection')} · by ${esc(c.by||'Wizard')}`,title:`${k?`<span>${esc(k)}</span>`:''}${esc(n)}`,stats:[plural(c.count,'chapter'),`${c.minutes} min`,c.read?`${c.read} read`:''],bio:c.bio,cta})}${list}${who}${c.url?`<p class="wb-book-source"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Original work ↗</a></p>`:''}</section>`;
  }
  if(kind==='thinker'){
   const t=data.thinkers.find(t=>t.id===id);if(!t)return missing();
   const mine=data.entries.filter(e=>e.thinker===id),mins=mine.reduce((a,e)=>a+e.minutes,0),done=mine.filter(e=>e.read).length;
   // Chapters grouped under the collections they belong to; the rest stand alone.
   const cols=(data.collections||[]).filter(c=>c.thinkers.includes(id));
   const grouped=cols.map(c=>({c,list:c.entries.map(i=>mine.find(e=>e.id===i)).filter(Boolean)}));
   const loose=mine.filter(e=>!cols.some(c=>c.entries.includes(e.id)));
   const firstUnread=grouped.flatMap(g=>g.list.filter(e=>!e.read&&e.id!==g.c.overview).map(e=>[e,g.c])).concat(loose.filter(e=>!e.read).map(e=>[e,null]))[0];
   const [start,sc]=firstUnread||[mine[0],colOf(mine[0])];
   const cta=(start?link(readLink(start,sc),`${done?'Continue':'Start'} →`,'wb-primary'):'')+pref(t,true);
   const groups=grouped.map(({c,list})=>`<section class="wb-season"><div class="wb-season-head">${link('/collection/'+c.id,`<h2>${esc(c.title)}</h2><span>${c.thinkers.length>1?`${list.length} of ${plural(c.count,'chapter')}`:plural(c.count,'chapter')} ›</span>`,'wb-season-link')}</div><ol class="wb-toc">${list.map(e=>tocRow(e,c,{next:c.next_id})).join('')}</ol></section>`).join('');
   const rest=loose.length?`<section class="wb-season">${grouped.length?`<div class="wb-season-head"><h2>More chapters</h2><span>${loose.length}</span></div>`:''}<ol class="wb-toc">${loose.map(e=>tocRow(e,null)).join('')}</ol></section>`:'';
   return `<section class="wisdom-thinker wb-book wb-collection wb-thinker-page">${bookHero({artHtml:t.portrait?img(t.portrait,'wb-book-portrait',t.name):'<span class="wb-book-portrait wb-noart"></span>',kicker:'Thinker',title:esc(t.name),stats:[plural(mine.length,'chapter'),`${mins} min`,done?`${done} read`:''],bio:t.bio,cta})}${groups}${rest}<p class="wb-book-source"><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Original work ↗</a></p></section>`;
  }
  if(kind==='read'){
   const e=data.entries.find(e=>e.id===id);if(!e)return missing();
   const t=thinker(e),col=colOf(e,parseRoute()[3]),index=col?col.entries.indexOf(e.id):-1,next=col?data.entries.find(x=>x.id===col.entries[index+1]):null,n=chapNo(e,col);
   const home=col?'/collection/'+col.id:'/thinker/'+t.id,homeName=col?bookTitle(col)[1]:t.name;
   let body=e.body.replace(/^# [^\n]+\n+/,'').replace(/^\*[^*\n]+\*\s*\n+/,'');
   let epigraph='';const m=/^## ([^\n]+)\n+((?:> ?[^\n]*\n?)+)\n*/.exec(body);
   if(m){epigraph=`<section class="wb-slide wb-epigraph"><div><span class="wb-label">${esc(m[1])}</span><blockquote>${glossed(inline(m[2].replace(/^> ?/gm,'').replace(/\[\d+\]/g,'').trim()).replace(/\n/g,'<br>'))}</blockquote><span class="wb-attrib">— ${esc(t.name)}</span></div></section>`;body=body.slice(m[0].length)}
   const count=e.dive_of?'Deep dive':n?`Chapter ${n} of ${col.count}`:short(e,col);
   const end=next?link(readLink(next,col),`${img(art(next),'wb-next-art')}<span class="wb-hero-shade"></span><span class="wb-next-copy"><small>${esc(dotted('Next',short(next,col),col&&col.thinkers.length>1?thinker(next).name:''))}</small><strong>${esc(next.title)}</strong><span class="wb-primary">Keep reading →</span></span>`,'wb-next" data-wisdom-replace="1'):link(home,`Back to ${esc(homeName)}`,'wb-back-quiet" data-wisdom-replace="1');
      const rate=`<div class="wb-rate" role="group" aria-label="Rate this chapter"><span class="wb-rate-q">How was it?</span><div class="wb-rate-btns"><button class="wb-thumb ${e.rating===1?'on':''}" data-wisdom-rate="${esc(e.id)}" data-value="1" aria-pressed="${e.rating===1}" aria-label="Thumbs up">${icon('up')}</button><button class="wb-thumb ${e.rating===-1?'on':''}" data-wisdom-rate="${esc(e.id)}" data-value="-1" aria-pressed="${e.rating===-1}" aria-label="Thumbs down">${icon('down')}</button></div></div>`;
   const quiet=`<div class="wb-end-quiet"><button class="wb-quiet ${e.saved?'on':''}" data-wisdom-entry="${esc(e.id)}" data-field="saved" aria-pressed="${e.saved}" aria-label="${e.saved?'Unstar':'Star'} ${esc(e.title)}">${icon('star')}<span>${e.saved?'Starred':'Star'}</span></button><a class="wb-quiet" href="${esc(e.source_url)}" target="_blank" rel="noopener noreferrer">Source ↗</a></div>`;
   return `<article class="wisdom-reader wb-reader" data-read="${esc(id)}" data-size="${size}"><header class="wb-top">${link(home,'‹','wb-round" data-wisdom-replace="1" aria-label="Back')}<div class="wb-top-title"><strong>${esc(t.name)}</strong><span>${esc(dotted(count,e.title))}</span></div><div class="wisdom-size" role="group" aria-label="Text size"><button class="wb-round" data-wisdom-size="-1" aria-label="Smaller text" ${size<=0?'disabled':''}>A−</button><button class="wb-round" data-wisdom-size="1" aria-label="Larger text" ${size>=3?'disabled':''}>A+</button></div></header><div class="wb-stage"><div class="wb-track"><section class="wb-slide wb-opener">${img(art(e),'wb-opener-art')}<span class="wb-hero-shade"></span><div class="wb-opener-copy"><small>${esc(dotted(col&&col.thinkers.length>1?col.title:t.name,count))}</small><h1>${esc(e.title)}</h1><p>${esc(e.deck)}</p><span class="wb-swipe">${e.minutes} min · Swipe to begin <b>→</b></span></div></section>${epigraph}<div class="wb-flow wisdom-body">${glossed(markdown(body))}<span class="wb-sentinel"></span></div><section class="wb-slide wb-end"><div class="wb-end-head"><small>${esc(dotted('✓ Finished',count))}</small><h2>${esc(e.title)}</h2></div>${rate}${end}${quiet}</section></div></div><footer class="wb-foot"><div class="wb-bar"><span></span></div><div class="wb-foot-row"><span class="wb-count" aria-live="polite"></span><span class="wb-left"></span></div></footer><div class="wb-hlpop" role="toolbar" aria-label="Highlight" hidden><button data-hl-act="highlight" hidden><span class="wb-swatch"></span>Highlight</button><button data-hl-act="copy">${icon('copy')}Copy</button><button data-hl-act="search">${icon('search')}Search</button><button data-hl-act="remove"><span class="wb-swatch off"></span>Remove highlight</button></div><span class="wb-handle s" hidden aria-hidden="true"></span><span class="wb-handle e" hidden aria-hidden="true"></span><div class="wb-glosspop" role="dialog" aria-label="Translation" hidden></div></article>`;
  }
  return missing();
 }
 function missing(){return `<div class="wisdom-notice"><h2>That read isn’t in Wisdom</h2>${link('','Back to your library')}</div>`}
 // Desktop rail: author navigation with honest to-read counts.
 function rail(){
  if(!data)return '';
  const [,kind,id]=parseRoute(),current=kind==='thinker'?id:kind==='read'?data.entries.find(e=>e.id===id)?.thinker:'';
  return `<section class="rail-card"><h2>Thinkers</h2><div class="rail-list">${[...data.thinkers].sort((a,b)=>(seriesOf(b.id).length>1)-(seriesOf(a.id).length>1)).map(t=>{const n=data.entries.filter(e=>e.thinker===t.id&&!e.archived).length;return link('/thinker/'+t.id,`${pubIcon(t)}<span class="rail-stack"><span class="rail-title">${esc(t.name)}${t.more?' <span class="rail-badge">Prioritized</span>':''}</span><span class="rail-sub">${esc(t.series)} · ${n} to read</span></span>`,'rail-row'+(current===t.id?' selected':''))}).join('')}</div></section><p class="rail-foot">${icon('shield')}<span>Private to your Wizard</span></p>`;
 }
 async function load({restore=false}={}){
  const mine=++serial;loading=true;error='';if(active())window.renderWisdom();
  try{const d=await api('wisdom');if(mine!==serial)return;data=d;}
  catch(e){if(mine!==serial)return;error=e.message;}
  finally{if(mine===serial){loading=false;if(active()){window.renderWisdom();if(restore)window.scrollTo(0,scrolls.get(location.hash)||0);}}}
 }
 function remember(){if(currentRoute)scrolls.set(currentRoute,window.scrollY)}
 function enter({restore=false}={}){
  currentRoute=location.hash;route='wisdom';
  window.renderWisdom();if(data){window.scrollTo(0,restore?(scrolls.get(currentRoute)||0):0);refreshDay()}else load({restore});
 }
 function refreshDay(){if(active()&&(['','#','#/'].includes(location.hash)||location.hash.startsWith('#/library/'))&&data&&!loading&&data.day!==new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))load()}
 function navigate(path='',{replace=false}={}){
  remember();route='wisdom';epoch++;history[replace?'replaceState':'pushState']({wisdom:true},'',path?'#'+path:location.pathname);enter();
 }
 async function change(payload,button){
  if(writing)return;writing=true;
  document.querySelectorAll('[data-wisdom-entry],[data-wisdom-pref],[data-wisdom-rate]').forEach(e=>e.disabled=true);
  try{
   const d=await api('wisdom/reaction',payload);data=d;writing=false;
   const y=window.scrollY,keep=reader()?page:null;if(active()){window.renderWisdom();window.scrollTo(0,y);if(keep!==null)go(keep,false)}
   toast(payload.field==='rating'?(payload.value>0?'Noted. More like this.':payload.value<0?'Noted. Less like this.':'Rating cleared.'):payload.field==='more'?(payload.value?'You’ll see more from this thinker.':'Thinker preference reset.'):payload.field==='done'?'Finished and archived.':payload.field==='archived'?(payload.value?'Archived.':'Restored to To read.'):(payload.value?'Starred.':'Star removed.'));
  }catch(e){writing=false;toast('Couldn’t save. Tap again to retry.');document.querySelectorAll('[data-wisdom-entry],[data-wisdom-pref],[data-wisdom-rate]').forEach(e=>e.disabled=false);}
 }

 let sheetPop=false;
 // Sheets own one history entry: Back (or Cancel/Done, which call history.back) closes the sheet and stays put.
 window.addEventListener('popstate',ev=>{const sh=document.querySelector('.wb-sheet');if(sh||sheetPop){if(mic.target==='request')stopMic(true);sh?.remove();sheetPop=false;ev.stopImmediatePropagation()}},true);
 function closeSheet(){if(sheetPop)history.back();else{document.querySelector('.wb-sheet')?.remove();if(mic.target==='request')stopMic(true)}}
 // Request a new collection (James, 12 Oct): stored by Wisdom first, then handed to Archimedes to build.
 let reqState={phase:'form',text:'',seq:null,error:''};
 function sheetHtml(){
  const s=reqState;
  if(s.phase==='sent')return `<div class="wb-sheet-card" role="dialog" aria-modal="true" aria-label="Request sent"><small>Requested</small><h3>Archimedes is on it</h3><p class="wb-req-ok">Requested. Archimedes is building it; it will appear at the top of Wisdom when ready.</p><blockquote class="wb-req-quote">${esc(s.text)}</blockquote><div class="wb-sheet-actions"><button class="wb-primary" data-sheet-close>Done</button></div></div>`;
  if(s.phase==='unsent')return `<div class="wb-sheet-card" role="dialog" aria-modal="true" aria-label="Request saved, not sent"><small>Saved, not sent</small><h3>Archimedes didn’t get it yet</h3><p class="wb-req-err">${s.seq?'Your request is saved in Wisdom, but it couldn’t be handed to Archimedes':'Couldn’t reach Wisdom, so nothing was saved'}: ${esc(s.error)}.</p><blockquote class="wb-req-quote">${esc(s.text)}</blockquote><div class="wb-sheet-actions"><button class="wb-sheet-cancel" data-sheet-close>Close</button><button class="wb-primary" data-req-retry>Retry</button></div></div>`;
  const busy=s.phase==='sending';
  return `<div class="wb-sheet-card" role="dialog" aria-modal="true" aria-label="Request a new collection"><small>Request</small><h3>Request a new collection</h3><p>What do you want to read? A topic, a thinker, a book, a question. Archimedes builds it as a Wisdom collection.</p><div class="wb-req-field"><textarea id="wb-req-text" rows="4" maxlength="2000" placeholder="e.g. Nāgārjuna and emptiness, for a beginner" ${busy?'disabled':''}>${esc(s.text)}</textarea>${micBtn('request','Describe it by voice')}</div><p class="wb-mic-status" data-mic-status="request" role="status">${esc(micNote('request'))}</p><div class="wb-sheet-actions"><button class="wb-sheet-cancel" data-sheet-close>Cancel</button><button class="wb-primary" data-req-send ${busy?'disabled':''}>${busy?'Sending…':'Send'}</button></div></div>`;
 }
 function paintSheet(){
  const sh=document.querySelector('.wb-sheet');if(!sh)return;sh.innerHTML=sheetHtml();
  sh.querySelectorAll('[data-sheet-close]').forEach(b=>b.onclick=closeSheet);
  const ta=sh.querySelector('#wb-req-text');if(ta)ta.oninput=()=>{reqState.text=ta.value};
  sh.querySelector('[data-req-send]')?.addEventListener('click',()=>sendRequest());
  sh.querySelector('[data-req-retry]')?.addEventListener('click',()=>sendRequest());
  bindMics(sh);
 }
 function openRequest(text){
  if(document.querySelector('.wb-sheet'))return;
  reqState={phase:'form',text:text||'',seq:null,error:''};
  const sh=document.createElement('div');sh.className='wb-sheet';sh.onclick=ev=>{if(ev.target===sh)closeSheet()};document.body.appendChild(sh);
  try{history.pushState(history.state,'',location.href);sheetPop=true}catch{}
  paintSheet();const ta=sh.querySelector('#wb-req-text');if(ta&&!text)ta.focus();
 }
 async function postRequest(body){
  const r=await fetch(new URL('api/wisdom/request',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  let d={};try{d=await r.json()}catch{}
  return {ok:r.ok,d};
 }
 async function sendRequest(seq){
  if(reqState.phase==='sending')return;
  seq=seq||reqState.seq;
  const text=(reqState.text||'').trim();if(!seq&&!text){toast('Describe the collection first.');return}
  if(mic.target==='request')stopMic(true);
  reqState.phase='sending';paintSheet();
  try{
   const {ok,d}=await postRequest(seq?{seq}:{text});
   if(d.requests&&data){data.requests=d.requests;if(active()&&!parseRoute()[1]){const y=window.scrollY;window.renderWisdom();window.scrollTo(0,y)}}
   if(d.request){reqState.seq=d.request.seq;reqState.text=d.request.text}
   if(ok&&d.sent){reqState.phase='sent'}
   else{reqState.phase=d.request?'unsent':'form';reqState.error=d.error||'Something went wrong';if(!d.request)toast(reqState.error)}
  }catch(e){reqState.phase='unsent';reqState.error=e.name==='TimeoutError'?'Wisdom took too long to answer':'Wisdom couldn’t be reached'}
  if(document.querySelector('.wb-sheet'))paintSheet();
  else toast(reqState.phase==='sent'?'Requested. Archimedes is building it.':'Saved, but not sent to Archimedes. Retry from Wisdom home.');
 }
 // Voice input: record in the page, transcribe with Wizard Voice Core, drop the words where the mic was tapped.
 const mic={target:null,recording:false,note:'',rec:null,stream:null,chunks:[],timer:0};
 function paintMic(){
  document.querySelectorAll('[data-wisdom-mic]').forEach(b=>{const on=micOn(b.dataset.wisdomMic);b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);b.setAttribute('aria-label',on?'Stop recording':b.dataset.label);b.innerHTML=on?'<span class="wb-mic-dot"></span>':micSvg;b.disabled=!on&&mic.target===b.dataset.wisdomMic&&!!mic.busy});
  document.querySelectorAll('[data-mic-status]').forEach(p=>{p.textContent=micNote(p.dataset.micStatus);p.classList.toggle('is-error',!!mic.error&&p.textContent!=='')});
 }
 function micError(target,msg){mic.target=null;mic.recording=false;mic.busy=false;mic.lastTarget=target;mic.note=msg;mic.error=true;paintMic()}
 async function startMic(target){
  if(mic.recording){const same=mic.target===target;stopMic();if(same)return}
  if(mic.busy)return;
  mic.lastTarget=target;mic.error=false;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return micError(target,'Voice input isn’t supported in this browser. Type instead.');
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}
  catch(e){return micError(target,e.name==='NotAllowedError'||e.name==='SecurityError'?'Microphone access is blocked. Allow the microphone for Wisdom, then tap the mic again.':e.name==='NotFoundError'?'No microphone found on this device.':'The microphone couldn’t start ('+(e.message||e.name)+').')}
  const type=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported?.(t))||'';
  let rec;try{rec=new MediaRecorder(stream,type?{mimeType:type}:undefined)}catch(e){stream.getTracks().forEach(t=>t.stop());return micError(target,'Recording couldn’t start ('+(e.message||e.name)+').')}
  Object.assign(mic,{target,recording:true,busy:false,note:'Listening… tap the mic again to stop.',rec,stream,chunks:[],cancel:false});
  rec.ondataavailable=ev=>{if(ev.data&&ev.data.size)mic.chunks.push(ev.data)};
  rec.onstop=()=>{const chunks=mic.chunks,cancel=mic.cancel;mic.chunks=[];if(!cancel)transcribe(target,new Blob(chunks,{type:(rec.mimeType||type||'audio/webm')}))};
  rec.start(250);clearTimeout(mic.timer);mic.timer=setTimeout(()=>{if(mic.recording&&mic.rec===rec)stopMic()},90000);
  paintMic();
 }
 function stopMic(cancel=false){
  clearTimeout(mic.timer);const rec=mic.rec;mic.cancel=cancel;
  mic.stream?.getTracks().forEach(t=>t.stop());mic.stream=null;mic.rec=null;
  if(rec&&rec.state!=='inactive'){mic.recording=false;mic.busy=!cancel;mic.note=cancel?'':'Transcribing…';try{rec.stop()}catch{}}
  else{mic.recording=false}
  if(cancel){mic.target=null;mic.busy=false;mic.note=''}
  paintMic();
 }
 async function transcribe(target,blob){
  if(!blob.size)return micError(target,'Nothing was recorded. Tap the mic and speak.');
  try{
   const r=await fetch(new URL('api/wisdom/transcribe',base),{method:'POST',headers:{'Content-Type':blob.type||'audio/webm'},body:blob,signal:AbortSignal.timeout(100000)});
   let d={};try{d=await r.json()}catch{}
   if(!r.ok)return micError(target,d.error||'Transcription failed.');
   const text=(d.text||'').trim();if(!text)return micError(target,'No speech heard. Try again.');
   Object.assign(mic,{target:null,busy:false,note:'',error:false});
   if(target==='search'){query=text;const q=document.getElementById('wb-q');if(q)q.value=text;updateResults()}
   else{reqState.text=reqState.text.trim()?reqState.text.trim()+' '+text:text;const ta=document.getElementById('wb-req-text');if(ta)ta.value=reqState.text}
   paintMic();
  }catch(e){micError(target,e.name==='TimeoutError'?'Transcription took too long. Try a shorter recording.':'Transcription is unavailable right now.')}
 }
 function bindMics(root){root.querySelectorAll('[data-wisdom-mic]').forEach(b=>b.onclick=ev=>{ev.preventDefault();startMic(b.dataset.wisdomMic)})}
 function bindLinks(root){
  root.querySelectorAll('[data-wisdom-route]').forEach(e=>e.onclick=ev=>{ev.preventDefault();ev.stopPropagation();navigate(e.dataset.wisdomRoute,{replace:!!e.dataset.wisdomReplace})});
  root.querySelectorAll('[data-wisdom-request]').forEach(b=>b.onclick=()=>openRequest(b.dataset.wisdomRequest));
  root.querySelectorAll('[data-wisdom-retry-req]').forEach(b=>b.onclick=()=>{const r=(data.requests||[]).find(x=>x.seq===+b.dataset.wisdomRetryReq);if(!r)return;openRequest(r.text);reqState.seq=r.seq;sendRequest(r.seq)});
 }
 function updateResults(){const el=document.getElementById('wb-results');if(!el)return;el.innerHTML=results();bindLinks(el);el.querySelectorAll('img').forEach(i=>i.onerror=()=>{i.style.display='none'})}
 function bindSearch(){
  const q=document.getElementById('wb-q');if(!q)return;
  q.oninput=()=>{query=q.value;updateResults()};
  q.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();q.blur()}};
 }
 // Paged reader: one horizontal track of full-screen pages (story-style, not a book).
 const posKey=id=>'wisdom:'+new URL('.',location.href).pathname+':pos:'+id;
 let page=0,pages=1,pageW=0,textFrom=0,textPages=1,drag=null,suppressClick=false;
 function reader(){return document.querySelector('.wb-reader')}
 function layout(keep){
  const r=reader();if(!r)return;const stage=r.querySelector('.wb-stage'),flow=r.querySelector('.wb-flow'),track=r.querySelector('.wb-track');
  hlWords=null;if(hlAct){hlAct=null;hidePop();paint(r)}
  if(glossOpen())closeGloss();
  const frac=keep&&pages>1?page/(pages-1):null;
  const W=stage.clientWidth,H=stage.clientHeight;pageW=W;
  const P=W>760?Math.round((W-660)/2):Math.max(24,Math.round(W*.075));
  const T=r.querySelector('.wb-top').offsetHeight+6,B=r.querySelector('.wb-foot').offsetHeight+18;
  flow.style.cssText=`width:${W}px;height:${H}px;padding:${T}px ${P}px ${B}px;column-width:${W-2*P}px;column-gap:${2*P}px;column-fill:auto`;
  const s=flow.querySelector('.wb-sentinel'),left=s.getBoundingClientRect().left-flow.getBoundingClientRect().left;
  textPages=Math.max(1,Math.floor(left/W)+1);
  flow.style.width=(textPages*W)+'px';flow.style.columnCount=textPages;
  r.querySelectorAll('.wb-slide').forEach(x=>{x.style.width=W+'px';x.style.height=H+'px'});
  textFrom=r.querySelectorAll('.wb-track>.wb-slide:not(.wb-end)').length;
  pages=textFrom+textPages+1;
  if(frac!==null)page=Math.round(frac*(pages-1));
  else{let saved=0;try{saved=Number(localStorage.getItem(posKey(r.dataset.read))??localStorage.getItem('wisdom:/wizard-signal/:pos:'+r.dataset.read))||0}catch{}const e=data.entries.find(x=>x.id===r.dataset.read);page=e&&!e.read&&saved>0&&saved<1?Math.round(saved*(pages-1)):0}
  go(page,false);
 }
 function go(n,animate=true){
  const r=reader();if(!r)return;const track=r.querySelector('.wb-track');
  const to=Math.max(0,Math.min(pages-1,n));if(to!==page&&hlAct)deactivate();if(to!==page&&glossOpen())closeGloss();page=to;
  track.style.transition=animate?'transform .34s cubic-bezier(.2,.8,.2,1)':'none';
  track.style.transform=`translate3d(${-page*pageW}px,0,0)`;
  r.querySelector('.wb-count').textContent=`${page+1} / ${pages}`;
  r.querySelector('.wb-bar>span').style.transform=`scaleX(${pages>1?page/(pages-1):1})`;
  const e=data.entries.find(x=>x.id===r.dataset.read),t=Math.min(textPages,Math.max(0,page-textFrom+1));
  r.querySelector('.wb-left').textContent=page>=pages-1?'Finished':page<textFrom?`${e.minutes} min read`:`${Math.max(1,Math.ceil(e.minutes*(1-t/textPages)))} min left`;
  r.dataset.at=page===0?'opener':page>=pages-1?'end':'text';
  try{localStorage.setItem(posKey(e.id),String(pages>1?page/(pages-1):0))}catch{}
  if(page>=pages-1&&!(e.read&&e.archived)&&!writing){const was=[e.read,e.archived];e.read=e.archived=true;api('wisdom/reaction',{kind:'entry',id:e.id,field:'done',value:true}).then(d=>{data=d}).catch(()=>{[e.read,e.archived]=was})}
 }
 function step(d){
  const r=reader();if(!r)return;
  if(d>0&&page>=pages-1){const n=r.querySelector('.wb-next');if(n)navigate(n.dataset.wisdomRoute,{replace:true});return}
  go(page+d);
 }
 // Kindle-style highlights (James, 10 Oct). A highlight is a [start,end) character range in the reading's
 // rendered text, so it survives text-size changes and re-pagination. Wisdom draws its own selection: the
 // native one is off, so Android's Copy/Translate/Select-all toolbar never appears. Long-press a word and
 // drag; lifting the finger on five words or more saves the highlight at once (no extra tap). Fewer words
 // (a single long-pressed word, a short phrase) stay a plain selection, drawn blue, with Highlight / Copy /
 // Search (James, 12 Oct). Tap a highlight to get drag handles that grow or shrink it word by word, plus
 // Copy, Search and Remove highlight. Search opens Wizard Search on its own desk beside Wisdom.
 const HL_MIN=5;
 const flowOf=r=>r?.querySelector('.wb-flow');
 var hlWords=null,hlSel=null,hlAct=null,hlPress=0,hlHandle=null;
 function popOpen(){const p=reader()?.querySelector('.wb-hlpop');return !!(p&&!p.hidden)}
 function hidePop(){const r=reader();const p=r?.querySelector('.wb-hlpop');if(p)p.hidden=true;r?.querySelectorAll('.wb-handle').forEach(h=>h.hidden=true)}
 function buzz(){try{(window.parent!==window&&window.parent.WizardOSNative?.haptic)?window.parent.WizardOSNative.haptic(12):navigator.vibrate?.(12)}catch{}}
 // Word index: every word's character range and line boxes, relative to the flow so page turns don't stale it.
 function words(){
  const flow=flowOf(reader());if(!flow)return [];
  if(hlWords&&hlWords.flow===flow)return hlWords.list;
  const fr=flow.getBoundingClientRect(),w=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT),list=[],rg=document.createRange();let n,pos=0;
  while((n=w.nextNode())){
   const re=/\S+/g;let m;
   while((m=re.exec(n.nodeValue))){
    rg.setStart(n,m.index);rg.setEnd(n,m.index+m[0].length);
    const rects=[...rg.getClientRects()].filter(x=>x.width>0).map(x=>({l:x.left-fr.left,t:x.top-fr.top,r:x.right-fr.left,b:x.bottom-fr.top}));
    if(rects.length)list.push({s:pos+m.index,e:pos+m.index+m[0].length,rects});
   }
   pos+=n.nodeValue.length;
  }
  hlWords={flow,list};return list;
 }
 // The word under (or nearest on the same line to) a screen point, on the page in view.
 function wordAt(x,y){
  const flow=flowOf(reader());if(!flow)return -1;const fr=flow.getBoundingClientRect(),px=x-fr.left,py=y-fr.top,L=words();
  let best=-1,score=1e9;
  L.forEach((wd,i)=>{for(const q of wd.rects){const ax=q.l+fr.left;if(ax<-2||q.r+fr.left>innerWidth+2)continue;
   const dx=Math.max(q.l-px,0,px-q.r),dy=Math.max(q.t-py,0,py-q.b),sc=dy*4+dx;if(sc<score){score=sc;best=i}}});
  return score<160?best:-1;
 }
 // Line boxes for a range on screen. A drop cap's tall box is left out so handles sit on the text line.
 function rectsFor(s,e){const flow=flowOf(reader()),fr=flow.getBoundingClientRect();const rs=words().filter(w=>w.s<e&&w.e>s).flatMap(w=>w.rects.map(q=>({left:q.l+fr.left,top:q.t+fr.top,right:q.r+fr.left,bottom:q.b+fr.top}))).filter(q=>q.right>0&&q.left<innerWidth);
  const lo=Math.min(...rs.map(q=>q.bottom-q.top));return rs.filter(q=>q.bottom-q.top<=lo*1.6)}
 // Readable text for a range: paragraphs keep their breaks when copied.
 function textFor(flow,s,e){
  const w=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT);let n,pos=0,out='',lastBlock=null;
  while((n=w.nextNode())){
   const L=n.nodeValue.length,a=Math.max(s,pos),b=Math.min(e,pos+L);
   if(a<b){const blk=n.parentElement.closest('p,li,blockquote,h2,h3,h4');if(lastBlock&&blk!==lastBlock)out+='\n\n';lastBlock=blk;out+=n.nodeValue.slice(a-pos,b-pos)}
   pos+=L;if(pos>=e)break;
  }
  return out.replace(/[ \t]+\n/g,'\n').trim();
 }
 // What the page shows: saved highlights, with a live range (being selected or adjusted) merged over them.
 function shown(r,live){
  let list=(data.highlights||[]).filter(h=>h.entry_id===r.dataset.read);
  if(!live&&hlAct&&hlAct.pending)live={start:hlAct.start,end:hlAct.end,pending:true};
  if(!live)return list;
  // A selection that won't save on its own shows exactly what's selected, on top of any highlight.
  if(live.pending)return list.concat([{id:'live',start:live.start,end:live.end,live:true,sel:true}]);
  list=list.filter(h=>h.id!==live.replaces);
  const over=list.filter(h=>h.start<live.end&&h.end>live.start);
  const s=Math.min(live.start,...over.map(h=>h.start)),e=Math.max(live.end,...over.map(h=>h.end));
  return list.filter(h=>!over.includes(h)).concat([{id:'live',start:s,end:e,live:true}]);
 }
 function paint(r,live){
  const flow=flowOf(r);if(!flow)return;
  flow.querySelectorAll('mark.wb-hl').forEach(m=>m.replaceWith(...m.childNodes));flow.normalize();
  for(const h of shown(r,live).sort((a,b)=>(a.sel?1:0)-(b.sel?1:0)||a.start-b.start)){
   const w=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT),nodes=[];let n,pos=0;
   while((n=w.nextNode())){nodes.push([n,pos]);pos+=n.nodeValue.length}
   for(const [node,s] of nodes){
    const L=node.nodeValue.length,a=Math.max(h.start,s),b=Math.min(h.end,s+L);if(a>=b)continue;
    let t=node;if(b<s+L)t.splitText(b-s);if(a>s)t=t.splitText(a-s);
    if(!t.nodeValue.trim()&&!t.parentElement.closest('p,li,blockquote,h2,h3,h4'))continue;
    const m=document.createElement('mark');m.className='wb-hl'+(h.sel?' sel':h.live||(hlAct&&h.id===hlAct.id)?' on':'');m.dataset.hl=h.id;t.replaceWith(m);m.appendChild(t);
   }
  }
 }
 // Range covered by the live selection, merged with any highlight it touches (what gets saved).
 function merged(r,s,e,replaces){const over=(data.highlights||[]).filter(h=>h.entry_id===r.dataset.read&&h.id!==replaces&&h.start<e&&h.end>s);return {s:Math.min(s,...over.map(h=>h.start)),e:Math.max(e,...over.map(h=>h.end))}}
 // Show handles + Copy / Remove for the active highlight.
 function showActive(){
  const r=reader();if(!r||!hlAct)return hidePop();
  const rects=rectsFor(hlAct.start,hlAct.end);if(!rects.length)return hidePop();
  const [hs,he]=r.querySelectorAll('.wb-handle'),first=rects[0],last=rects[rects.length-1];
  hs.hidden=he.hidden=false;
  hs.style.transform=`translate3d(${first.left}px,${first.bottom}px,0)`;he.style.transform=`translate3d(${last.right}px,${last.bottom}px,0)`;
  // Line height under each handle (a drop cap makes the first box tall; cap it at a normal line).
  hs.dataset.lineh=Math.min(44,Math.round(first.bottom-first.top));he.dataset.lineh=Math.min(44,Math.round(last.bottom-last.top));
  const p=r.querySelector('.wb-hlpop'),sel=!!hlAct.pending;p.setAttribute('aria-label',sel?'Selection':'Highlight');
  p.querySelector('[data-hl-act="highlight"]').hidden=!sel;p.querySelector('[data-hl-act="remove"]').hidden=sel;
  p.hidden=false;const w=p.offsetWidth,h=p.offsetHeight,top0=r.querySelector('.wb-top').getBoundingClientRect().bottom;
  // Above the passage, clear of the handles below it; below the handles when the passage sits at the top.
  let top=Math.min(...rects.map(q=>q.top))-12-h;if(top<top0+4)top=Math.max(...rects.map(q=>q.bottom))+40;
  const cx=(Math.min(...rects.map(q=>q.left))+Math.max(...rects.map(q=>q.right)))/2;
  p.style.top=Math.min(innerHeight-h-60,top)+'px';p.style.left=Math.max(10,Math.min(innerWidth-w-10,cx-w/2))+'px';
 }
 // Forgiving tap target: a tap in the gap between a highlight's lines, or just beside it, still counts.
 function markNear(x,y){
  let best=null,score=1e9;
  reader()?.querySelectorAll('.wb-flow mark.wb-hl').forEach(m=>{for(const q of m.getClientRects()){
   if(!q.width||q.right<0||q.left>innerWidth)continue;const pad=Math.max(12,q.height*.7);
   const dx=Math.max(q.left-12-x,0,x-q.right-12),dy=Math.max(q.top-pad-y,0,y-q.bottom-pad);
   if(dx===0&&dy===0){const d=Math.abs(y-(q.top+q.bottom)/2);if(d<score){score=d;best=m}}}});
  return best;
 }
 function deactivate(){if(!hlAct)return;hlAct=null;const r=reader();hidePop();if(r)paint(r)}
 // A short selection: shown with handles and the pop-up, saved only if James taps Highlight.
 function select(r,s,e){hlAct={id:'sel',pending:true,start:s,end:e};paint(r);showActive()}
 // Search opens Wizard Search with an AI overview of the passage. Inside Wizard the shell routes this to a
 // desk of its own right beside Wisdom (Back returns here); in a plain browser it opens a new tab.
 function searchFor(t){
  const q=String(t||'').replace(/\s+/g,' ').replace(/^[\s"'“‘(\[]+|[\s"'”’)\],.;:!?]+$/g,'').trim().slice(0,240);if(!q)return false;
  const url=new URL('/wizard-search/?q='+encodeURIComponent(q),location.origin).href;
  // Inside Wizard, the shell's frame guard takes over window.open (and returns null), so never retry.
  try{window.open(url,'_blank');return true}catch{return false}
 }
 function activate(id){const h=(data.highlights||[]).find(x=>x.id===id);if(!h)return;hlAct={id:h.id,start:h.start,end:h.end};const r=reader();paint(r);showActive()}
 async function copyText(t){
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(t);return true}}catch{}
  const ta=document.createElement('textarea');ta.value=t;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch{}ta.remove();return ok;
 }
 // Save a range (merging what it touches) and make it the active highlight. Optimistic: paints first.
 async function commit(r,s,e,replaces){
  const flow=flowOf(r),m=merged(r,s,e,replaces),text=textFor(flow,m.s,m.e);if(!text)return deactivate();
  const before=data.highlights||[];
  data.highlights=[{id:-1,entry_id:r.dataset.read,start:m.s,end:m.e,text}].concat(before.filter(h=>!(h.entry_id===r.dataset.read&&(h.id===replaces||(h.start<m.e&&h.end>m.s)))));
  hlAct={id:-1,start:m.s,end:m.e};paint(r);showActive();
  try{
   const d=await api('wisdom/highlight',{action:'add',entry_id:r.dataset.read,start:m.s,end:m.e,text});
   data.highlights=d.highlights;if(hlAct&&hlAct.id===-1&&hlAct.start===m.s&&hlAct.end===m.e)hlAct.id=d.id;if(reader()===r){paint(r);if(hlAct)showActive()}
  }catch(err){data.highlights=before;hlAct=null;if(reader()===r){paint(r);hidePop()}toast('Couldn’t save the highlight. Try again.')}
 }
 function bindPop(r){
  const p=r.querySelector('.wb-hlpop');if(!p)return;
  p.onpointerdown=ev=>ev.stopPropagation();
  p.onclick=async ev=>{
   const b=ev.target.closest('button');if(!b||!hlAct)return;ev.stopPropagation();
   const act=b.dataset.hlAct,cur={...hlAct};
   if(act==='copy'){const ok=await copyText(textFor(flowOf(r),cur.start,cur.end));toast(ok?'Copied.':'Couldn’t copy. Try again.');deactivate();return}
   if(act==='highlight'){if(cur.pending)commit(r,cur.start,cur.end,undefined);return}
   if(act==='search'){const t=textFor(flowOf(r),cur.start,cur.end);deactivate();searchFor(t);return}
   if(act==='remove'&&!cur.pending){
    const before=data.highlights;data.highlights=before.filter(h=>h.id!==cur.id);hlAct=null;paint(r);hidePop();
    try{if(cur.id>0){const d=await api('wisdom/highlight',{action:'remove',id:cur.id});data.highlights=d.highlights;if(reader()===r)paint(r)}toast('Highlight removed.')}
    catch(err){data.highlights=before;if(reader()===r)paint(r);toast('Couldn’t remove it. Try again.')}
   }
  };
  // Handles: drag to grow or shrink the active highlight, snapping to whole words.
  r.querySelectorAll('.wb-handle').forEach(hd=>{
   hd.onpointerdown=ev=>{
    if(!hlAct||ev.button)return;ev.preventDefault();ev.stopPropagation();try{hd.setPointerCapture(ev.pointerId)}catch{}
    // Keep the finger's offset from the text line, so the word being picked is never hidden under it.
    const end=hd.classList.contains('e'),rs=rectsFor(hlAct.start,hlAct.end),q=end?rs[rs.length-1]:rs[0];
    const cy=q?(q.top+q.bottom)/2:hd.getBoundingClientRect().top-12;
    hlHandle={end,id:ev.pointerId,dy:ev.clientY-cy,start:hlAct.start,stop:hlAct.end,replaces:hlAct.id};
    r.querySelector('.wb-hlpop').hidden=true;hd.classList.add('drag');
   };
   hd.onpointermove=ev=>{
    if(!hlHandle||ev.pointerId!==hlHandle.id)return;ev.preventDefault();
    const L=words(),i=wordAt(ev.clientX,ev.clientY-hlHandle.dy);if(i<0)return;
    let s=hlAct.start,e=hlAct.end;
    if(hlHandle.end){const first=L.find(w=>w.s>=s);e=Math.max(L[i].e,first?first.e:e)}else{const last=[...L].reverse().find(w=>w.e<=e);s=Math.min(L[i].s,last?last.s:s)}
    if(s===hlAct.start&&e===hlAct.end)return;
    hlAct.start=s;hlAct.end=e;paint(r,hlAct.pending?undefined:{start:s,end:e,replaces:hlHandle.replaces});
    const rects=rectsFor(s,e);if(rects.length){const [hs,he]=r.querySelectorAll('.wb-handle');hs.style.transform=`translate3d(${rects[0].left}px,${rects[0].bottom}px,0)`;he.style.transform=`translate3d(${rects[rects.length-1].right}px,${rects[rects.length-1].bottom}px,0)`}
   };
   const done=ev=>{
    if(!hlHandle||ev.pointerId!==hlHandle.id)return;const h=hlHandle;hlHandle=null;hd.classList.remove('drag');
    if(hlAct.pending||(hlAct.start===h.start&&hlAct.end===h.stop)){paint(r);showActive();return}
    commit(r,hlAct.start,hlAct.end,h.replaces);
   };
   hd.onpointerup=done;hd.onpointercancel=done;
  });
  // The native selection, its toolbar and the long-press menu stay off inside the reader.
  r.addEventListener('contextmenu',ev=>ev.preventDefault());
  r.addEventListener('selectstart',ev=>{if(ev.target.closest?.('.wb-stage')||ev.target.parentElement?.closest('.wb-stage'))ev.preventDefault()});
 }
 // Long-press on a word starts a selection; dragging extends it word by word; lifting saves it.
 function pressStart(r,ev){
  clearTimeout(hlPress);if(!ev.target.closest('.wb-flow')||ev.target.closest('a,button'))return;
  const x=ev.clientX,y=ev.clientY,id=ev.pointerId,stage=r.querySelector('.wb-stage');
  hlPress=setTimeout(()=>{
   if(!drag||drag.on)return;const i=wordAt(x,y);if(i<0)return;
   drag=null;deactivate();hlSel={a:i,c:i,id};buzz();try{stage.setPointerCapture(id)}catch{}
   const w=words()[i];paint(r,{start:w.s,end:w.e,pending:HL_MIN>1});
  },420);
 }
 function pressMove(r,ev){
  if(!hlSel||ev.pointerId!==hlSel.id)return false;
  const i=wordAt(ev.clientX,ev.clientY);if(i>=0&&i!==hlSel.c){hlSel.c=i;const L=words(),a=L[Math.min(hlSel.a,i)],b=L[Math.max(hlSel.a,i)];paint(r,{start:a.s,end:b.e,pending:Math.abs(i-hlSel.a)+1<HL_MIN})}
  return true;
 }
 function pressEnd(r,ev){
  clearTimeout(hlPress);if(!hlSel||(ev&&ev.pointerId!==hlSel.id))return false;
  const L=words(),n=Math.abs(hlSel.c-hlSel.a)+1,a=L[Math.min(hlSel.a,hlSel.c)],b=L[Math.max(hlSel.a,hlSel.c)];hlSel=null;
  suppressClick=true;setTimeout(()=>suppressClick=false,80);
  if(n>=HL_MIN)commit(r,a.s,b.e,undefined);else select(r,a.s,b.e);return true;
 }
 var glossHist=false,glossBack=false;
 function glossOpen(){const p=reader()?.querySelector('.wb-glosspop');return !!(p&&!p.hidden)}
 function closeGloss(fromBack){
  const r=reader(),p=r?.querySelector('.wb-glosspop');if(p)p.hidden=true;r?.querySelectorAll('.wb-gloss.on').forEach(x=>x.classList.remove('on'));
  if(glossHist&&!fromBack){glossHist=false;glossBack=true;history.back()}else if(fromBack)glossHist=false;
 }
 function openGloss(r,el,x,y){
  const k=el.dataset.gloss,g=(data.glosses||{})[k],p=r.querySelector('.wb-glosspop');if(!g||!p)return;
  r.querySelectorAll('.wb-gloss.on').forEach(e=>e.classList.remove('on'));el.classList.add('on');
  p.innerHTML=`<div class="wb-gp-script" lang="${esc(g.lang||'')}">${esc(k)}</div>${g.roman?`<div class="wb-gp-roman">${esc(g.roman)}</div>`:''}${g.say?`<div class="wb-gp-say">sounds like “${esc(g.say)}”</div>`:''}<p class="wb-gp-en">${esc(g.en)}</p>${g.note?`<p class="wb-gp-note">${esc(g.note)}</p>`:''}${g.language?`<small>${esc(g.language)}</small>`:''}`;
  p.hidden=false;
  // Anchor to the line that was tapped (a phrase can wrap across lines).
  const rects=[...el.getClientRects()],box=rects.find(q=>y>=q.top-4&&y<=q.bottom+4)||rects[0]||el.getBoundingClientRect();
  const W=innerWidth,H=innerHeight,w=Math.min(340,W-24);p.style.width=w+'px';
  const cx=x??(box.left+box.right)/2,h=p.offsetHeight;
  let top=box.bottom+10;if(top+h>H-12)top=box.top-10-h;top=Math.max(12,Math.min(top,H-12-h));
  p.style.left=Math.round(Math.min(W-12-w,Math.max(12,cx-w/2)))+'px';p.style.top=Math.round(top)+'px';
  // Back closes the popover first and keeps the chapter open.
  if(!glossHist){try{history.pushState(history.state,'',location.href);glossHist=true}catch{}}
 }
 window.addEventListener('popstate',ev=>{
  if(glossBack){glossBack=false;ev.stopImmediatePropagation();return}
  if(glossHist||glossOpen()){closeGloss(true);ev.stopImmediatePropagation()}
 },true);
 function bindReader(){
  const r=reader();if(!r)return;const stage=r.querySelector('.wb-stage'),track=r.querySelector('.wb-track');
  stage.ondragstart=ev=>ev.preventDefault();
  stage.onpointerdown=ev=>{if(ev.button)return;drag={x:ev.clientX,y:ev.clientY,t:Date.now(),on:false};pressStart(r,ev)};
  stage.onpointermove=ev=>{if(pressMove(r,ev))return;if(!drag)return;if(Math.hypot(ev.clientX-drag.x,ev.clientY-drag.y)>10)clearTimeout(hlPress);const dx=ev.clientX-drag.x,dy=ev.clientY-drag.y;if(!drag.on&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){drag.on=true;try{stage.setPointerCapture(ev.pointerId)}catch{}}if(drag.on){const edge=(page===0&&dx>0)||(page>=pages-1&&dx<0&&!r.querySelector('.wb-next'));track.style.transition='none';track.style.transform=`translate3d(${-page*pageW+(edge?dx/3:dx)}px,0,0)`}};
  const up=ev=>{if(!drag)return;const d=drag;drag=null;if(!d.on)return;suppressClick=true;setTimeout(()=>suppressClick=false,60);const dx=ev.clientX-d.x,v=Math.abs(dx)/Math.max(1,Date.now()-d.t);if(dx<-50||(dx<-12&&v>.45))step(1);else if(dx>50||(dx>12&&v>.45))step(-1);else go(page)};
  stage.onpointerup=ev=>{if(pressEnd(r,ev))return;clearTimeout(hlPress);up(ev)};stage.onpointercancel=ev=>{if(pressEnd(r,ev))return;clearTimeout(hlPress);if(drag?.on)go(page);drag=null};
  stage.onclick=ev=>{
   if(suppressClick||ev.target.closest('a,button'))return;
   // A glossed phrase opens its translation; with one open, a tap elsewhere only closes it.
   const gl=ev.target.closest('.wb-gloss');
   if(glossOpen()){const was=r.querySelector('.wb-gloss.on');if(gl&&gl!==was&&!hlAct){openGloss(r,gl,ev.clientX,ev.clientY);return}closeGloss();return}
   if(gl&&!hlAct){openGloss(r,gl,ev.clientX,ev.clientY);return}
   // A tap on a highlight makes it active (handles + Copy / Remove); with one active, any other tap only
   // dismisses it and never turns the page.
   const m=ev.target.closest('mark.wb-hl')||markNear(ev.clientX,ev.clientY);
   if(hlAct){if(m&&m.dataset.hl!=='live'&&+m.dataset.hl!==hlAct.id)activate(+m.dataset.hl);else deactivate();return}
   if(m&&m.dataset.hl!=='live'){activate(+m.dataset.hl);return}
   const x=ev.clientX-stage.getBoundingClientRect().left,W=stage.clientWidth;if(x<W*.28)step(-1);else if(x>W*.72)step(1);else r.classList.toggle('wb-calm')};
  bindPop(r);
  const gp=r.querySelector('.wb-glosspop');if(gp){gp.onpointerdown=ev=>ev.stopPropagation();gp.onclick=ev=>{ev.stopPropagation();closeGloss()}}
  stage.onkeydown=ev=>{const gl=ev.target.closest?.('.wb-gloss');if(gl&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();ev.stopPropagation();const b=gl.getBoundingClientRect();openGloss(r,gl,(b.left+b.right)/2,b.top+2)}};
  // Group the closing "Sources" section so it sets in smaller type.
  r.querySelectorAll('.wb-flow h2').forEach(h=>{if(/^sources$/i.test(h.textContent.trim())){h.classList.add('wb-sources-h');let n=h.nextElementSibling;while(n&&n.tagName!=='H2'){n.classList.add('wb-sources');n=n.nextElementSibling}}});
  r.querySelectorAll('.wb-flow p').forEach(p=>{if(p.children.length===1&&p.firstElementChild.tagName==='STRONG'&&p.textContent.trim()===p.firstElementChild.textContent.trim())p.classList.add('wb-keyline')});
  paint(r);
  const fontsReady=document.fonts?.ready||Promise.resolve();
  layout(false);fontsReady.then(()=>layout(true));
 }
 let resizeTimer=0;
 window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>layout(true),120)});
 window.addEventListener('keydown',ev=>{if(!reader()||ev.target.closest?.('input,textarea'))return;if(['ArrowRight','PageDown',' '].includes(ev.key)){ev.preventDefault();step(1)}else if(['ArrowLeft','PageUp'].includes(ev.key)){ev.preventDefault();step(-1)}});
 function progress(){const bar=document.querySelector('.wisdom-progress>span');if(!bar)return;const max=document.documentElement.scrollHeight-innerHeight;bar.style.transform=`scaleX(${max>0?Math.min(1,scrollY/max):0})`}
 window.addEventListener('scroll',progress,{passive:true});
 // The cover resting at a shelf's left edge shows in colour; the rest stay black and white.
 // Recomputed on scroll (rAF-throttled), so swiping through the shelf moves the light along.
 function litShelf(sh){
  const pick=()=>{const L=sh.getBoundingClientRect().left+parseFloat(getComputedStyle(sh).paddingLeft||0);let best=null,d=1e9;
   sh.querySelectorAll('.wb-cover').forEach(c=>{const x=Math.abs(c.getBoundingClientRect().left-L);if(x<d){d=x;best=c}});
   sh.querySelectorAll('.wb-cover.lit').forEach(c=>{if(c!==best)c.classList.remove('lit')});best?.classList.add('lit')};
  let raf=0;sh.onscroll=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;pick()})};pick();
 }
 function bind(){
  document.querySelectorAll('[data-wisdom-id]').forEach(e=>e.onclick=ev=>{if(!ev.target.closest('a,button'))navigate('/read/'+e.dataset.wisdomId)});
  bindLinks(document);bindMics(document.getElementById('app')||document);bindSearch();
  document.querySelector('[data-wisdom-retry]')?.addEventListener('click',()=>load());

  document.querySelectorAll('[data-wisdom-pref]').forEach(e=>e.onclick=()=>{const id=e.dataset.wisdomPref,t=data.thinkers.find(x=>x.id===id);change({kind:'thinker',id,field:'more',value:!t.more},e)});
  document.querySelectorAll('[data-wisdom-entry]').forEach(e=>e.onclick=()=>{const id=e.dataset.wisdomEntry,field=e.dataset.field,item=data.entries.find(x=>x.id===id);change({kind:'entry',id,field,value:field==='done'?true:!item[field]},e)});
  document.querySelectorAll('[data-wisdom-size]').forEach(b=>b.onclick=()=>{size=Math.min(3,Math.max(0,size+Number(b.dataset.wisdomSize)));try{localStorage.setItem(sizeKey,String(size))}catch{}const r=document.querySelector('.wisdom-reader');if(r)r.dataset.size=size;document.querySelectorAll('[data-wisdom-size]').forEach(x=>x.disabled=Number(x.dataset.wisdomSize)<0?size<=0:size>=3);layout(true)});
  document.querySelectorAll('[data-wisdom-copy]').forEach(b=>b.onclick=async()=>{const h=(data.highlights||[]).find(x=>x.id===+b.dataset.wisdomCopy);if(h)toast(await copyText(h.text)?'Copied.':'Couldn’t copy. Try again.')});
  document.querySelectorAll('[data-pct]').forEach(x=>x.style.width=x.dataset.pct+'%');
  document.querySelectorAll('.wb-shelf').forEach(litShelf);
  document.querySelectorAll('[data-wisdom-rate]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();const id=b.dataset.wisdomRate,v=+b.dataset.value,item=data.entries.find(x=>x.id===id);change({kind:'entry',id,field:'rating',value:item.rating===v?0:v},b)});
  bindReader();
 }
 function syncHash(){if(!active()||location.hash!==currentRoute){remember();route='wisdom';epoch++;history.replaceState({wisdom:true},'',location.href);enter()}}
 return {render,rail,bind,load,enter,navigate,active,remember,syncHash,refreshDay};
})();
