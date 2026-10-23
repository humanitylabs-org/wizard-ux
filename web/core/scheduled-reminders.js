/* Recall scheduling UI — shared by phone and desktop. Durable timing and legacy API names live in Agent Service. */
(() => {
  'use strict';
  const API='/wizard/v1/boomerangs', J={'Content-Type':'application/json'};
  const DEFAULT_ZONE='Asia/Bangkok';
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEKDAYS=['Su','Mo','Tu','We','Th','Fr','Sa'];
  const PRESETS=[
    ['1h','In 1 hour'],['2h','In 2 hours'],['4h','In 4 hours'],
    ['tomorrow-am','Tomorrow morning'],['tomorrow-pm','Tomorrow afternoon'],
    ['2d','In 2 days'],['4d','In 4 days'],['1w','In 1 week'],['2w','In 2 weeks'],['1m','In 1 month']
  ];
  let reminders=[], sheet=null, listeners=new Set(), poll=0, pendingId='', openedReminder=null, restoreFocus=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad=n=>String(n).padStart(2,'0');
  const dateString=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
  const parseDate=s=>{const [y,m,d]=String(s).split('-').map(Number);return{y,m,d}};
  const daysInMonth=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
  function addWallDays(date,n){const {y,m,d}=parseDate(date),v=new Date(Date.UTC(y,m-1,d+n));return dateString(v.getUTCFullYear(),v.getUTCMonth()+1,v.getUTCDate())}
  function addWallMonths(date,n){const {y,m,d}=parseDate(date),v=new Date(Date.UTC(y,m-1+n,1));return dateString(v.getUTCFullYear(),v.getUTCMonth()+1,Math.min(d,daysInMonth(v.getUTCFullYear(),v.getUTCMonth()+1)))}
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
  function offsetAt(t,z){const p={};for(const x of new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)))p[x.type]=x.value;return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-Math.floor(t/1000)*1000}
  function wallToUtc(date,time,z=DEFAULT_ZONE){
    const {y,m,d}=parseDate(date),[h,min]=time.split(':').map(Number);if(!validZone(z))throw new Error('Choose a valid timezone.');let guess=Date.UTC(y,m-1,d,h,min);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)||m<1||m>12||d<1||d>daysInMonth(y,m)||h<0||h>23||min<0||min>59||!Number.isFinite(guess))throw new Error('Choose a real date and time.');
    for(let i=0;i<4;i++)guess=Date.UTC(y,m-1,d,h,min)-offsetAt(guess,z);
    const check=parts(guess,z);if(check.y!==y||check.m!==m||check.d!==d||check.h!==h||check.min!==min)throw new Error('That local time does not exist in this timezone.');
    return new Date(guess).toISOString();
  }
  function preset(kind,z=DEFAULT_ZONE,now=Date.now()){
    const p=parts(now,z),today=dateString(p.y,p.m,p.d);
    if(/^[124]h$/.test(kind)){const h=Number(kind[0]),q=parts(now+h*3600000,z);return{date:dateString(q.y,q.m,q.d),time:`${pad(q.h)}:${pad(q.min)}`}}
    if(kind==='tomorrow-am')return{date:addWallDays(today,1),time:'09:00'};
    if(kind==='tomorrow-pm')return{date:addWallDays(today,1),time:'14:00'};
    if(kind==='1m')return{date:addWallMonths(today,1),time:'09:00'};
    const n={ '2d':2,'4d':4,'1w':7,'2w':14 }[kind]||1;return{date:addWallDays(today,n),time:'09:00'};
  }
  function formatPreset(v,z){const utc=wallToUtc(v.date,v.time,z);return new Intl.DateTimeFormat('en',{timeZone:z,weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(utc))}
  function presetButtons(z){return PRESETS.map(([id,label])=>{const v=preset(id,z);return `<button type="button" data-boom-preset="${id}"><span>${label}</span><small>${esc(formatPreset(v,z))}</small></button>`}).join('')}
  function years(selected){const now=new Date().getUTCFullYear(),from=Math.min(now-2,selected),to=Math.max(now+10,selected);let html='';for(let y=from;y<=to;y++)html+=`<option value="${y}"${y===selected?' selected':''}>${y}</option>`;return html}
  function calendarHtml(selected){const {y,m,d}=parseDate(selected);return `<section class="boom-calendar" data-boom-calendar hidden aria-label="Choose date"><div class="boom-cal-head"><button type="button" data-cal-prev aria-label="Previous month">‹</button><select name="cal-month" aria-label="Month">${MONTHS.map((x,i)=>`<option value="${i+1}"${i+1===m?' selected':''}>${x}</option>`).join('')}</select><select name="cal-year" aria-label="Year">${years(y)}</select><button type="button" data-cal-next aria-label="Next month">›</button></div><div class="boom-weekdays" aria-hidden="true">${WEEKDAYS.map(x=>`<span>${x}</span>`).join('')}</div><div class="boom-grid" role="grid" aria-label="${MONTHS[m-1]} ${y}" data-cal-grid data-year="${y}" data-month="${m}"></div></section>`}
  function renderCalendar(form,focusDate=''){
    const grid=form.querySelector('[data-cal-grid]'),y=+form.elements['cal-year'].value,m=+form.elements['cal-month'].value,selected=form.date.value,today=(()=>{const p=parts(Date.now(),form.timezone.value);return dateString(p.y,p.m,p.d)})();
    grid.dataset.year=y;grid.dataset.month=m;grid.setAttribute('aria-label',`${MONTHS[m-1]} ${y}`);grid.innerHTML='';
    for(let i=0;i<new Date(Date.UTC(y,m-1,1)).getUTCDay();i++)grid.insertAdjacentHTML('beforeend','<span aria-hidden="true"></span>');
    for(let d=1;d<=daysInMonth(y,m);d++){const value=dateString(y,m,d),chosen=value===selected,disabled=value<today;grid.insertAdjacentHTML('beforeend',`<button type="button" role="gridcell" data-cal-day="${value}" aria-selected="${chosen}"${disabled?' disabled':''} tabindex="${chosen||(!selected.startsWith(`${y}-${pad(m)}`)&&value===today)?'0':'-1'}">${d}</button>`)}
    const target=focusDate&&grid.querySelector(`[data-cal-day="${focusDate}"]`);if(target){target.tabIndex=0;target.focus()}
  }
  function shiftCalendar(form,months){let y=+form.elements['cal-year'].value,m=+form.elements['cal-month'].value+months;if(m<1){m=12;y--}if(m>12){m=1;y++}form.elements['cal-year'].innerHTML=years(y);form.elements['cal-year'].value=String(y);form.elements['cal-month'].value=String(m);renderCalendar(form)}
  function close(){if(!sheet)return false;const old=sheet;sheet=null;old.remove();restoreFocus?.focus?.({preventScroll:true});restoreFocus=null;return true}
  function back(){return close()?'boomerang':false}
  function returnLabel(r){const d=new Date(r.due_at),date=d.toLocaleDateString([],{dateStyle:'medium',timeZone:r.timezone}),time=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:r.timezone});return `Returns ${date} at ${time}`}
  function open(opts,existing=null){
    close();restoreFocus=document.activeElement;const selectedZone=validZone(existing?.timezone)?existing.timezone:DEFAULT_ZONE,ep=existing?parts(Date.parse(existing.due_at),selectedZone):null,p=existing?{date:dateString(ep.y,ep.m,ep.d),time:`${pad(ep.h)}:${pad(ep.min)}`}:preset('tomorrow-am',selectedZone),hasNote=Boolean(existing?.note||opts.note);
    sheet=document.createElement('div');sheet.className='boom-sheet';sheet.innerHTML=`<form class="boom-card" data-boom-form role="dialog" aria-modal="true" aria-labelledby="boom-title"><header><span aria-hidden="true">🪄</span><b id="boom-title">Recall</b><button type="button" data-boom-close aria-label="Close Recall">×</button></header><p class="boom-context">${esc(opts.context||'This thread')}</p><p class="boom-prompt">When should this return?</p><section class="boom-quick" aria-labelledby="boom-quick-title"><h3 id="boom-quick-title">Quick choices</h3><div class="boom-presets">${presetButtons(selectedZone)}</div></section><section class="boom-exact" aria-labelledby="boom-exact-title"><h3 id="boom-exact-title">Exact date &amp; time</h3><div class="boom-fields"><label>Date<span class="boom-date-control"><input required type="date" name="date" value="${p.date}"><button type="button" data-boom-calendar-toggle aria-expanded="false" aria-label="Open Recall calendar">▣</button></span></label><label>Time<input required type="time" name="time" value="${p.time}" step="60"></label></div>${calendarHtml(p.date)}<label class="boom-zone">Timezone<select required name="timezone">${zoneOptions(selectedZone)}</select><small>Bangkok by default · saved as UTC</small></label></section><button type="button" class="boom-link" data-boom-note-toggle aria-expanded="${hasNote}">${hasNote?'Hide note':'＋ Add a note'}</button><label class="boom-note"${hasNote?'':' hidden'}>Note<input name="note" maxlength="500" value="${esc(existing?.note||opts.note||'')}" placeholder="What should Future You remember?"></label><p class="boom-error" role="alert"></p><footer>${existing?'<button type="button" class="danger" data-boom-cancel aria-label="Remove Recall">Remove</button>':''}<button type="button" data-boom-close>Cancel</button><button type="submit" class="primary">${existing?'Save Recall':'Set Recall'}</button></footer></form>`;
    document.body.append(sheet);const form=sheet.querySelector('form'),calendar=form.querySelector('[data-boom-calendar]'),toggle=form.querySelector('[data-boom-calendar-toggle]');renderCalendar(form);
    const refreshPresets=()=>{form.querySelector('.boom-presets').innerHTML=presetButtons(form.timezone.value)};
    sheet.addEventListener('click',e=>{
      const pre=e.target.closest('[data-boom-preset]');if(pre){const v=preset(pre.dataset.boomPreset,form.timezone.value);form.date.value=v.date;form.time.value=v.time;form.querySelectorAll('[data-boom-preset]').forEach(b=>b.classList.toggle('selected',b===pre));renderCalendar(form);return}
      if(e.target.closest('[data-boom-calendar-toggle]')){calendar.hidden=!calendar.hidden;toggle.setAttribute('aria-expanded',String(!calendar.hidden));if(!calendar.hidden){const v=parseDate(form.date.value);form.elements['cal-month'].value=String(v.m);form.elements['cal-year'].innerHTML=years(v.y);form.elements['cal-year'].value=String(v.y);renderCalendar(form);form.elements['cal-month'].focus()}return}
      if(e.target.closest('[data-cal-prev]')){shiftCalendar(form,-1);return}if(e.target.closest('[data-cal-next]')){shiftCalendar(form,1);return}
      const day=e.target.closest('[data-cal-day]');if(day){form.date.value=day.dataset.calDay;renderCalendar(form);calendar.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();return}
      const nt=e.target.closest('[data-boom-note-toggle]');if(nt){const note=form.querySelector('.boom-note');note.hidden=!note.hidden;nt.setAttribute('aria-expanded',String(!note.hidden));nt.textContent=note.hidden?'＋ Add a note':'Hide note';if(!note.hidden)form.note.focus();return}
      if(e.target.closest('[data-boom-close]')||e.target===sheet){e.stopPropagation();close();return}if(e.target.closest('[data-boom-cancel]')){e.stopPropagation();void cancel(existing.id)}
    },true);
    form.addEventListener('change',e=>{if(e.target.name==='timezone'){refreshPresets();renderCalendar(form)}if(e.target.name==='date'){const v=parseDate(form.date.value);form.elements['cal-month'].value=String(v.m);form.elements['cal-year'].innerHTML=years(v.y);form.elements['cal-year'].value=String(v.y);renderCalendar(form)}if(e.target.name==='cal-month'||e.target.name==='cal-year')renderCalendar(form)});
    form.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return}
      if(e.key==='Tab'){const fs=[...form.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(x=>x.offsetParent!==null),a=fs[0],b=fs.at(-1);if(e.shiftKey&&document.activeElement===a){e.preventDefault();b.focus()}else if(!e.shiftKey&&document.activeElement===b){e.preventDefault();a.focus()}return}
      const day=e.target.closest?.('[data-cal-day]');if(!day||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))return;e.preventDefault();const move={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key],current=day.dataset.calDay;let next=current;if(move)next=addWallDays(current,move);else if(e.key==='Home')next=addWallDays(current,-new Date(`${current}T00:00:00Z`).getUTCDay());else if(e.key==='End')next=addWallDays(current,6-new Date(`${current}T00:00:00Z`).getUTCDay());else next=addWallMonths(current,e.key==='PageUp'?-1:1);const v=parseDate(next);form.elements['cal-month'].value=String(v.m);form.elements['cal-year'].innerHTML=years(v.y);form.elements['cal-year'].value=String(v.y);renderCalendar(form,next)
    });
    form.onsubmit=async e=>{e.preventDefault();const error=form.querySelector('.boom-error');error.textContent='';try{const timezone=form.timezone.value,due_at=wallToUtc(form.date.value,form.time.value,timezone);if(Date.parse(due_at)<=Date.now())throw new Error('Choose a future date and time.');const body={due_at,timezone,note:form.note.value};if(existing)await req(`${API}/${encodeURIComponent(existing.id)}`,{method:'PATCH',headers:J,body:JSON.stringify(body)});else await req(API,{method:'POST',headers:J,body:JSON.stringify({session_id:opts.sessionId,runtime:'direct',target_kind:opts.targetKind,anchor_at:opts.anchorAt||null,context:String(opts.context||'').slice(0,500),client_request_id:`web-${crypto.randomUUID()}`,...body})});await refresh();close()}catch(err){error.textContent=err.message||'Could not save reminder'}};
    form.querySelector('[data-boom-close]').focus();
  }
  async function cancel(id){await req(`${API}/${encodeURIComponent(id)}`,{method:'DELETE'});await refresh();close()}
  async function acknowledge(id){await req(`${API}/${encodeURIComponent(id)}/acknowledge`,{method:'POST'});await refresh()}
  async function consume(id){pendingId=String(id||'');await refresh();emit()}
  const pendingFor=sessionId=>reminders.find(r=>r.id===pendingId&&r.session_id===sessionId)||null;
  const openedFor=sessionId=>openedReminder?.session_id===sessionId?openedReminder:null;
  async function opened(id){if(id!==pendingId)return;openedReminder=reminders.find(r=>r.id===id)||openedReminder;pendingId='';await acknowledge(id)}
  function banner(sessionId){const due=dueFor(sessionId),next=nextFor(sessionId);if(!due.length&&!next)return'';const r=due[0]||next,isDue=Boolean(due.length);return `<aside class="boom-banner ${isDue?'due':''}" data-boom-id="${esc(r.id)}" role="status" aria-label="${isDue?'Recall returned':'Recall scheduled'}"><span><b><span aria-hidden="true">🪄</span> ${isDue?'Recall returned':'Recall'}</b><small>${esc(r.note||r.context||'Follow up')}</small><time>${esc(returnLabel(r))} · ${esc(r.timezone)}</time></span>${isDue?'<button type="button" data-boom-open aria-label="Open recalled context">Open context</button>':''}<button type="button" data-boom-change aria-label="Edit Recall">Edit</button><button type="button" data-boom-cancel aria-label="Cancel Recall">Cancel</button></aside>`}
  async function handle(target,openContext){const box=target.closest('[data-boom-id]'),id=box?.dataset.boomId,r=reminders.find(x=>x.id===id);if(!r)return false;if(target.closest('[data-boom-open]')){pendingId=id;openContext?.(r);return true}if(target.closest('[data-boom-change]')){open({sessionId:r.session_id,targetKind:r.target_kind,anchorAt:r.anchor_at,context:r.context,note:r.note},r);return true}if(target.closest('[data-boom-cancel]')){await cancel(id);return true}return false}
  function start(){if(poll)return;void refresh();poll=setInterval(refresh,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()})}
  window.WosBoomerang={start,refresh,open,close,back,banner,handle,dueFor,nextFor,forSession,consume,pendingFor,openedFor,opened,_wallToUtc:wallToUtc,_addWallDays:addWallDays,_addWallMonths:addWallMonths,_daysInMonth:daysInMonth,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}};start();
})();
