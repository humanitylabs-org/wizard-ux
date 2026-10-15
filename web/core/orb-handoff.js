/* Trusted shell coordinator. Metadata never enters the agent prompt. */
(() => {
  const KEY='wos.orb-meeting-events.v1', endpoint='/mizel-live/orb-events';
  let busy=false, syncing=false;
  const read=()=>JSON.parse(localStorage.getItem(KEY)||'{}');
  function update(id, patch) {
    const rows=read(), old=rows[id]||{}, next={...old,...patch,id};
    if(JSON.stringify({...old,clientRevision:0,acked:0})===JSON.stringify({...next,clientRevision:0,acked:0}))return old;
    next.clientRevision=(old.clientRevision||0)+1;rows[id]=next;localStorage.setItem(KEY,JSON.stringify(rows));
    void sync();return next;
  }
  async function sync() {
    if(syncing || navigator.onLine===false)return;syncing=true;
    try {for(const row of Object.values(read())) {
      if(row.status==='reserving'||row.acked===row.clientRevision)continue;
      try {
        const r=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(row),signal:AbortSignal.timeout(10000)});
        if(!r.ok)continue;const {event}=await r.json();
        const check=await fetch(endpoint+'?meetingId='+encodeURIComponent(row.meetingId),{cache:'no-store',signal:AbortSignal.timeout(10000)});
        const saved=(await check.json()).events?.find(e=>e.id===row.id);
        if(!check.ok||!saved||saved.clientRevision<row.clientRevision||saved.meetingId!==row.meetingId||saved.captureId!==row.captureId||event.id!==row.id)continue;
        const rows=read();if(rows[row.id]?.clientRevision===row.clientRevision){rows[row.id].acked=row.clientRevision;localStorage.setItem(KEY,JSON.stringify(rows));}
      }catch{/* original journal remains retryable; never re-send the message */}
    }}finally{syncing=false;}
  }
  async function begin() {
    if(busy)throw Error('A microphone handoff is already starting');busy=true;
    const s=window.WizAppCapture.getState(), id='orb-'+crypto.randomUUID();let loan;
    try {
      if(!s.meetingId)throw Error('Microphone held by another app');
      update(id,{meetingId:s.meetingId,captureId:s.id,status:'reserving',pausedAt:Date.now()});
      loan=await window.WizAppCapture.beginVoiceBorrow(id);
      update(id,{...loan,voiceTakeId:undefined,status:'paused'});
      return {...loan,native:s.native,captureId:s.id};
    }catch(e){if(loan)await window.WizAppCapture.endVoiceBorrow(id,{status:'cancelled'}).catch(()=>{});throw e;}
    finally{busy=false;}
  }
  async function end(loan, detail) {
    if(!loan)return;
    update(loan.id,{...detail,endedAt:Date.now()});
    // Stop wins: stale_handoff means the meeting is no longer running, not permission to restart it.
    try{return await window.WizAppCapture.endVoiceBorrow(loan.id,detail);}catch(e){if(e.code!=='stale_handoff')throw e;}
  }
  function track(it) {
    if(!it.meetingEventId)return;
    update(it.meetingEventId,{voiceTakeId:it.nativeId||it.id,deliveryKey:it.id,question:it.text||'',
      status:it.state==='sent'?'sent':['failed','unconfirmed'].includes(it.state)?it.state:it.state==='held'?'local':'queued',
      ...(it.state==='sent'?{threadId:it.sessionId,runId:it.runId,...(it.userMessageId?{userMessageId:it.userMessageId}:{})}:{})});
  }
  window.WosOrbHandoff={begin,end,update,sync,read,track};
  const ob=window.WosOutbox;
  ob?.onChange(()=>{for(const it of ob._items.values())try{track(it);}catch(e){console.error('Meeting link retained in outbox',e);}});
  ob?.onSent(track);
  addEventListener('online',sync);setInterval(sync,5000);void sync();
})();
