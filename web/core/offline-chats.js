/* Explicit flight replica. WosOutbox remains the ONLY submission journal. */
(() => {
  'use strict';
  const db = WizOffline.collection({name:'wos-chats-flight-v1'});
  const rows = new Map(), heads = new Map();
  const RECENT = 'wos-chats-opened-v1';
  let receipt = null, failed = '', busy = false, disconnected = !navigator.onLine, sending = null, epoch = 0;
  let recent = []; try { recent = JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch (_) {}
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock = at => new Date(at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false});
  const live = () => window.WizLive;
  const main = id => !!id && !(live()?.agentOf(id)) && !(live()?.session(id)?.agent && window.WosAgents?.isOther(live().session(id).agent));
  function changed() { live()?.emit(); }
  const ready = (async () => {
    receipt = await db.manifest();
    for (const id of receipt?.ids || []) { const r = await db.get(id); if (r) { rows.set(id,r); heads.set(id,r.messages.at(-1)); if (live()?.cached && !live().session(id)) live().sessions.push(r.summary); } }
    changed();
  })().catch(e => { failed = 'Offline storage unavailable: ' + e.message; changed(); });
  function textOnly(value) {
    const text = typeof value === 'string' ? value : Array.isArray(value) ? value.map(p => typeof p === 'string' ? p : ['text','input_text','output_text'].includes(p?.type) ? p.text || '' : '').join('\n') : '';
    return text.replace(/\[WIZARD_(?:FILE_CHIPS|FILES|IMAGE_INTENT)_V1\][\s\S]*?\[\/WIZARD_(?:FILE_CHIPS|FILES|IMAGE_INTENT)_V1\]/g,'')
      .replace(/<helm_attachments>[\s\S]*?<\/helm_attachments>/gi,'')
      .replace(/!\[[^\]]*\]\([^)]*\)/g,'[Image not saved offline]')
      .replace(/<img\b[^>]*>/gi,'[Image not saved offline]')
      .replace(/(?:https?:\/\/[^\s)"<>]+)?\/wizard\/(?:attachments|files)\/[^\s)"<>]+/g,'[Attachment not saved offline]');
  }
  function clean(messages) {
    return messages.filter(m => ['user','assistant'].includes(m.role)).map(m => ({
      id: String(m.id || m.message_id || ''), role:m.role, content:textOnly(m.content ?? m.text),
      timestamp:m.timestamp ?? m.created_at, ...(m.finish_reason ? {finish_reason:m.finish_reason} : {}),
      ...(m.display_kind ? {display_kind:m.display_kind} : {})
    }));
  }
  function observe(id, messages) { if (main(id)) heads.set(id,clean(messages).at(-1)); }
  function opened(id) {
    if (!main(id) || id==='__new__') return;
    recent = [{id,at:Date.now()},...recent.filter(r=>r.id!==id)].slice(0,30);
    try { localStorage.setItem(RECENT,JSON.stringify(recent)); } catch (_) {}
  }
  async function download() {
    if (busy) return; busy=true; failed=''; const generation=epoch; changed();
    try {
      await ready;
      if (!navigator.onLine) throw Error('Needs a connection');
      await live().refresh(true);
      if (live().error || live().cached) throw Error('Chats list did not refresh');
      const all = live().sessions.filter(s=>main(s.id)&&!s.hidden&&!s.optimistic&&!s.synthetic);
      // workGroups is the exact Ready grouping used by Chats, not an inferred age/status rule.
      const groups = live().workGroups(all);
      const selected = new Map((groups.ready || []).map(s=>[s.id,s]));
      for (const r of recent.slice(0,30)) { const s=all.find(s=>s.id===r.id)||live().session(r.id); if(s&&main(s.id))selected.set(s.id,s); }
      const entries = []; let cursor=0; const list=[...selected.values()];
      await Promise.all(Array.from({length:Math.min(2,list.length||1)},async()=>{
        while(cursor<list.length){const s=list[cursor++];
          try { const messages=clean(await live().messages(s.id));
            if(!main(s.id))throw Error('Thread scope changed');
            const route=window.WosModels?.snapshot(s.id);
            if(!route?.model||!route?.provider)throw Error('Model route unavailable');
            const current=live().session(s.id)||s;
            const summary={id:s.id,title:s.title||'Chat',status:s.status,updatedAt:s.updatedAt,activityAt:s.activityAt,model:route.model,provider:route.provider,messageCount:current.messageCount,agent:''};
            entries.push([s.id,{title:s.title||'Chat',messages,route,summary}]);
          }catch(e){throw Error(`“${s.title||'Chat'}” did not save: ${e.message}`)}
        }
      }));
      // The pin worker supplies this single scoped shell cache, extended for opt-in Chats.
      if (!window.WosShellOffline?.warm) throw Error('Wizard offline shell unavailable');
      await window.WosShellOffline.warm({chats:true});
      let persistent=false; try{persistent=await navigator.storage?.persist?.()||false;}catch(_){}
      const at=Date.now(), manifest={at,ids:entries.map(([id])=>id),persistent};
      if(generation!==epoch)throw Error('Wizard account changed · download again');
      await db.replace(entries,manifest);
      if(generation!==epoch)throw Error('Wizard account changed · download again');
      const stored=await db.manifest();
      if(stored?.at!==at || (await db.keys()).length!==entries.length)throw Error('Device did not confirm the saved threads');
      live().saveSnapshot?.();
      rows.clear(); for(const [id,r] of entries){r.at=at;rows.set(id,r);heads.set(id,r.messages.at(-1));}
      receipt=manifest; disconnected=false;
    }catch(e){failed='Not ready for flight · '+e.message;}
    finally{busy=false;changed();}
  }
  function offline() { return disconnected || !navigator.onLine; }
  function connection(ok) { if(disconnected===!ok)return;disconnected=!ok;changed(); }
  function stamp(id,agent) {
    if(!id || id==='__new__' || agent || !offline())return null;
    const h=heads.get(id);
    return {recordedOfflineAt:new Date().toISOString(),lastSeenMessageId:h?.id||null,lastSeenMessagePreview:String(h?.content||'').replace(/\s+/g,' ').slice(0,220)};
  }
  const held = () => (window.WosOutbox?.unsent()||[]).filter(it=>it.offlineContext);
  function statusHTML() {
    const label = busy?'Saving for flight…':failed|| (receipt?`Ready for flight · ${receipt.ids.length} threads · saved ${clock(receipt.at)}`:'Text only · main agent · Ready and recently opened');
    return `<section class="wos-flight" aria-label="Offline chats"><button type="button" data-flight-download ${busy?'disabled':''}>Download for flight</button><span role="${failed?'alert':'status'}" data-flight-ready>${esc(label)}</span></section>`;
  }
  function trayHTML() {
    const items=held(); if(!items.length)return '';
    const count=items.length, label=`${count} ${count===1?'reply':'replies'} recorded offline`;
    return `<section class="wos-flight-tray" aria-label="Replies recorded offline"><details open><summary>${esc(label)}</summary>
      <div class="wos-flight-toolbar"><button type="button" data-flight-send ${offline()||sending?'disabled':''}>Send all</button><p role="status" data-flight-progress>${sending?`Sending ${sending.current} of ${sending.total}`:offline()?'Held on this device · send when you land':'Review your replies, then send when ready.'}</p></div>
      ${items.map(it=>`<div class="wos-flight-row" data-flight-row="${esc(it.id)}"><b>${esc(rows.get(it.sessionId)?.title||live()?.session(it.sessionId)?.title||'Chat')}</b><span>${esc(String(it.text||it.typed||(it.durationMs ? Math.round(it.durationMs/1000)+' s voice reply · recording kept' : 'Voice reply · recording kept')).slice(0,180))}${it.state==='unconfirmed'?' · Could not confirm':it.state==='failed'?' · '+esc(it.error):''}</span>${it.audio?`<button type="button" data-flight-play="${esc(it.id)}">Play</button>`:''}<button type="button" data-flight-delete="${esc(it.id)}" ${it.state==='sending'?'disabled':''}>Delete</button></div>`).join('')}
      </details></section>`;
  }
  let playing;
  async function action(target) {
    if(target.closest('[data-flight-download]')){void download();return true;}
    const del=target.closest('[data-flight-delete]');
    if(del){const ok=await window.WosOutbox.remove(del.dataset.flightDelete);if(!ok){failed='Delete not saved · original reply kept';changed();}return true;}
    const play=target.closest('[data-flight-play]');
    if(play){const audio=window.WosOutbox.get(play.dataset.flightPlay)?.audio;if(audio){if(playing){playing.pause();URL.revokeObjectURL(playing.src);}playing=new Audio(URL.createObjectURL(audio));playing.onended=()=>URL.revokeObjectURL(playing.src);void playing.play().catch(()=>{});}return true;}
    if(target.closest('[data-flight-send]')){
      if(!offline()&&!sending){sending={current:0,total:held().length};changed();try{await window.WosOutbox.sendFlight((current,total)=>{sending={current,total};changed();});}finally{sending=null;changed();}}return true;
    }
    return false;
  }
  // Sync click dispatcher: Chats uses a boolean to decide whether a click was consumed.
  function click(target){if(!target.closest('[data-flight-download],[data-flight-delete],[data-flight-play],[data-flight-send]'))return false;void action(target).catch(e=>{failed=e.message;changed();});return true;}
  window.WosFlight={ready,download,offline,connection,opened,observe,stamp,statusHTML,trayHTML,click,
    async saved(id){await ready;if(!main(id))return null;const r=rows.get(id);return r?{...r,at:receipt.at}:null;},
    banner(at){return `<div class="wos-flight-saved" role="status">Saved ${esc(clock(at))} · offline</div>`;},
    route(id){return rows.get(id)?.route||null;},
    get receipt(){return receipt;}};
  addEventListener('offline',()=>connection(false));
  // online is only a hint: a successful authoritative Chats read confirms landing.
  addEventListener('online',()=>{void live()?.refresh(true)});
  addEventListener('wizard-account-change',()=>{epoch++;rows.clear();heads.clear();receipt=null;recent=[];localStorage.removeItem(RECENT);void db.clear();});
  window.WosOutbox?.onChange(changed);
})();
