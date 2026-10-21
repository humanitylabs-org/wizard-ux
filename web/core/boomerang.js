/* Boomerang scheduled defer — shared by phone and desktop. Durable timing lives in Agent Service. */
(() => {
  'use strict';
  const API='/wizard/v1/boomerangs', J={'Content-Type':'application/json'};
  let reminders=[], sheet=null, listeners=new Set(), poll=0, pendingId='', openedReminder=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DEFAULT_ZONE='Asia/Bangkok';
  const validZone=z=>{try{new Intl.DateTimeFormat('en',{timeZone:z}).format();return Boolean(z)}catch{return false}};
  const zones=()=>[DEFAULT_ZONE,Intl.DateTimeFormat().resolvedOptions().timeZone,'UTC','America/New_York','Europe/London'].filter((z,i,a)=>validZone(z)&&a.indexOf(z)===i);
  const zoneOptions=selected=>zones().map(z=>`<option value="${esc(z)}"${z===selected?' selected':''}>${esc(z)}</option>`).join('');
  const req=async(path,init={})=>{const r=await fetch(path,{cache:'no-store',credentials:'same-origin',...init});let p={};try{p=await r.json()}catch{}if(!r.ok)throw new Error(p.error?.message||p.error||`HTTP ${r.status}`);return p};
  const emit=()=>listeners.forEach(fn=>{try{fn(reminders)}catch{}});
  async function refresh(){try{const p=await req(API);reminders=Array.isArray(p.reminders)?p.reminders:[];emit();return reminders}catch{return reminders}}
  const forSession=id=>reminders.filter(r=>r.session_id===id&&r.status!=='cancelled'&&r.status!=='acknowledged');
  const dueFor=id=>forSession(id).filter(r=>r.status==='due');
  const nextFor=id=>forSession(id).filter(r=>r.status==='scheduled').sort((a,b)=>Date.parse(a.due_at)-Date.parse(b.due_at))[0]||null;
  const parts=(t=Date.now(),z=DEFAULT_ZONE)=>{const p={};for(const x of new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)))p[x.type]=x.value;return{y:+p.year,m:+p.month,d:+p.day,h:+p.hour%24,min:+p.minute}};
  const pad=n=>String(n).padStart(2,'0');
  function offsetAt(t,z){const p={};for(const x of new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)))p[x.type]=x.value;return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-Math.floor(t/1000)*1000}
  function wallToUtc(date,time,z=DEFAULT_ZONE){
    const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);if(!validZone(z))throw new Error('Choose a valid timezone.');let guess=Date.UTC(y,m-1,d,h,min);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)||!Number.isFinite(guess))throw new Error('Choose a real date and time.');
    for(let i=0;i<4;i++)guess=Date.UTC(y,m-1,d,h,min)-offsetAt(guess,z);
    const check={};for(const x of new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)))check[x.type]=x.value;
    if(+check.year!==y||+check.month!==m||+check.day!==d||+check.hour!==h||+check.minute!==min)throw new Error('That local time does not exist in this timezone.');
    return new Date(guess).toISOString();
  }
  function preset(kind,z=DEFAULT_ZONE){const n=new Date(),p=parts(n,z);let day=new Date(Date.UTC(p.y,p.m-1,p.d));if(kind==='tomorrow')day.setUTCDate(day.getUTCDate()+1);if(kind==='week')day.setUTCDate(day.getUTCDate()+7);return{date:`${day.getUTCFullYear()}-${pad(day.getUTCMonth()+1)}-${pad(day.getUTCDate())}`,time:kind==='today'?`${pad(Math.min(23,p.h+2))}:${pad(Math.ceil(p.min/15)*15%60)}`:'09:00'}}
  function close(){sheet?.remove();sheet=null}
  function open(opts,existing=null){
    close();const selectedZone=validZone(existing?.timezone)?existing.timezone:DEFAULT_ZONE,ep=existing?parts(Date.parse(existing.due_at),selectedZone):null,p=existing?{date:`${ep.y}-${pad(ep.m)}-${pad(ep.d)}`,time:`${pad(ep.h)}:${pad(ep.min)}`}:preset('tomorrow',selectedZone);
    sheet=document.createElement('div');sheet.className='boom-sheet';sheet.innerHTML=`<form class="boom-card" data-boom-form><header><b>${existing?'Change reminder':'Boomerang this'}</b><button type="button" data-boom-close aria-label="Close">×</button></header><p class="boom-context">${esc(opts.context||'This thread')}</p><div class="boom-presets"><button type="button" data-boom-preset="today">Later today</button><button type="button" data-boom-preset="tomorrow">Tomorrow</button><button type="button" data-boom-preset="week">Next week</button></div><div class="boom-fields"><label>Date<input required type="date" name="date" value="${p.date}"></label><label>Time<input required type="time" name="time" value="${p.time}" step="60"></label></div><label>Timezone<select required name="timezone">${zoneOptions(selectedZone)}</select><small>Saved as UTC so it returns at the same instant on every device.</small></label><label>Reminder note<input name="note" maxlength="500" value="${esc(existing?.note||opts.note||'')}" placeholder="What should Future You remember?"></label><p class="boom-error" role="alert"></p><footer>${existing?'<button type="button" class="danger" data-boom-cancel>Cancel reminder</button>':''}<button type="button" data-boom-close>Back</button><button type="submit" class="primary">${existing?'Save change':'Set reminder'}</button></footer></form>`;
    document.body.append(sheet);const form=sheet.querySelector('form');
    sheet.addEventListener('click',e=>{const pre=e.target.closest('[data-boom-preset]');if(pre){const v=preset(pre.dataset.boomPreset,form.timezone.value);form.date.value=v.date;form.time.value=v.time;return}if(e.target.closest('[data-boom-close]')||e.target===sheet){e.stopPropagation();close();return}if(e.target.closest('[data-boom-cancel]')){e.stopPropagation();void cancel(existing.id)}},true);
    form.onsubmit=async e=>{e.preventDefault();const error=form.querySelector('.boom-error');error.textContent='';try{const timezone=form.timezone.value,due_at=wallToUtc(form.date.value,form.time.value,timezone);if(Date.parse(due_at)<=Date.now())throw new Error('Choose a future date and time.');const body={due_at,timezone,note:form.note.value};if(existing)await req(`${API}/${encodeURIComponent(existing.id)}`,{method:'PATCH',headers:J,body:JSON.stringify(body)});else await req(API,{method:'POST',headers:J,body:JSON.stringify({session_id:opts.sessionId,runtime:'direct',target_kind:opts.targetKind,anchor_at:opts.anchorAt||null,context:String(opts.context||'').slice(0,500),client_request_id:`web-${crypto.randomUUID()}`,...body})});await refresh();close()}catch(err){error.textContent=err.message||'Could not save reminder'}};
    form.date.focus();
  }
  async function cancel(id){await req(`${API}/${encodeURIComponent(id)}`,{method:'DELETE'});await refresh();close()}
  async function acknowledge(id){await req(`${API}/${encodeURIComponent(id)}/acknowledge`,{method:'POST'});await refresh()}
  async function consume(id){pendingId=String(id||'');await refresh();emit()}
  const pendingFor=sessionId=>reminders.find(r=>r.id===pendingId&&r.session_id===sessionId)||null;
  const openedFor=sessionId=>openedReminder?.session_id===sessionId?openedReminder:null;
  async function opened(id){if(id!==pendingId)return;openedReminder=reminders.find(r=>r.id===id)||openedReminder;pendingId='';await acknowledge(id)}
  function banner(sessionId){const due=dueFor(sessionId),next=nextFor(sessionId);if(!due.length&&!next)return'';const r=due[0]||next;return `<aside class="boom-banner ${due.length?'due':''}" data-boom-id="${esc(r.id)}"><span><b>${due.length?'Boomerang is back':'Reminder set'}</b><small>${esc(r.note||r.context||'Follow up')}</small><time>${new Date(r.due_at).toLocaleString([],{dateStyle:'medium',timeStyle:'short',timeZone:r.timezone})} · ${esc(r.timezone)}</time></span>${due.length?'<button type="button" data-boom-open>Open context</button>':''}<button type="button" data-boom-change>Change</button><button type="button" data-boom-cancel>Cancel</button></aside>`}
  async function handle(target,openContext){const box=target.closest('[data-boom-id]'),id=box?.dataset.boomId,r=reminders.find(x=>x.id===id);if(!r)return false;if(target.closest('[data-boom-open]')){pendingId=id;openContext?.(r);return true}if(target.closest('[data-boom-change]')){open({sessionId:r.session_id,targetKind:r.target_kind,anchorAt:r.anchor_at,context:r.context,note:r.note},r);return true}if(target.closest('[data-boom-cancel]')){await cancel(id);return true}return false}
  function start(){if(poll)return;void refresh();poll=setInterval(refresh,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()})}
  window.WosBoomerang={start,refresh,open,close,banner,handle,dueFor,nextFor,forSession,consume,pendingFor,openedFor,opened,_wallToUtc:wallToUtc,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}};start();
})();
