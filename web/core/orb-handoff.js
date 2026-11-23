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
  // A failed send waits longer each time (issue 1762: a stale meeting answered 409 to the same PUT every 5 s for
  // 40 minutes). The wait is kept in the row, so a reload doesn't restart it. The meeting server refusing the same
  // revision 4 times (a 4xx other than 408/429) parks it: it is sent again only once the row itself changes.
  const WAIT=[5e3,15e3,60e3,3*60e3,10*60e3,30*60e3,60*60e3], PARK_AFTER=4;
  function failed(row,status,error) {
    const rows=read(),cur=rows[row.id];if(!cur||cur.clientRevision!==row.clientRevision)return;
    const was=cur.retry?.rev===row.clientRevision?cur.retry:null,n=(was?.n||0)+1;
    const refused=status>=400&&status<500&&status!==408&&status!==429,parked=refused&&n>=PARK_AFTER;
    cur.retry={rev:row.clientRevision,n,at:Date.now()+WAIT[Math.min(n,WAIT.length)-1],...(status?{status}:{}),error:String(error||'').slice(0,160),...(parked?{parked:true}:{})};
    localStorage.setItem(KEY,JSON.stringify(rows));
    if(parked)console.warn('Meeting marker refused by the meeting server; kept on this device',row.id,status,cur.retry.error);
  }
  async function sync(force=true) {
    // Android/WebView connectivity is only a hint; native uploads can succeed
    // while it reports offline. Try the endpoint; retain the journal on failure.
    if(syncing)return;syncing=true;
    try {for(const row of Object.values(read())) {
      if(row.status==='reserving'||row.acked===row.clientRevision)continue;
      const wait=row.retry?.rev===row.clientRevision?row.retry:null;
      if(wait?.parked||(!force&&wait&&Date.now()<wait.at))continue;
      const {retry,...body}=row;
      try {
        const r=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
        if(!r.ok){failed(row,r.status,await r.text?.().catch(()=>'')||'');continue;}const {event}=await r.json();
        const check=await fetch(endpoint+'?meetingId='+encodeURIComponent(row.meetingId),{cache:'no-store',signal:AbortSignal.timeout(10000)});
        const saved=(await check.json()).events?.find(e=>e.id===row.id);
        if(!check.ok||!saved||saved.clientRevision<row.clientRevision||saved.meetingId!==row.meetingId||saved.captureId!==row.captureId||event.id!==row.id){failed(row,0,'not confirmed on read-back');continue;}
        const rows=read();if(rows[row.id]?.clientRevision===row.clientRevision){rows[row.id].acked=row.clientRevision;delete rows[row.id].retry;localStorage.setItem(KEY,JSON.stringify(rows));}
      }catch(e){failed(row,0,e?.message);/* original journal remains retryable; never re-send the message */}
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
    try{const receipt=await window.WizAppCapture.endVoiceBorrow(loan.id,detail);if(receipt?.endedAt)update(loan.id,{endedAt:receipt.endedAt,pausedByHandoff:receipt.pausedByHandoff});return receipt;}catch(e){if(e.code!=='stale_handoff')throw e;}
  }
  function track(it) {
    if(!it.meetingEventId)return;
    update(it.meetingEventId,{voiceTakeId:it.nativeId||it.id,deliveryKey:it.id,question:it.text||'',agent:it.agent||'',steered:!!it.steered,...(it.audioFile?.id?{audioFileId:it.audioFile.id}:{}),
      status:it.state==='sent'?'sent':['failed','unconfirmed'].includes(it.state)?it.state:it.state==='held'?'local':'queued',
      ...(it.state==='sent'?{threadId:it.sessionId,runId:it.runId,...(it.userMessageId?{userMessageId:it.userMessageId}:{})}:{})});
  }
  function bind(loan,takeId,snap){if(!loan)return;const v=snap?.view;update(loan.id,{voiceTakeId:takeId,routing:{route:snap?.route||null,target:['chat thread','agent chats'].includes(v?.kind)?{kind:v.kind,id:v.id,thread:v.thread||'',agent:v.agent||'',private:!!v.private}:null}});}
  function forTake(takeId){return takeId?Object.values(read()).find(row=>row.voiceTakeId===takeId)||null:null;}
  function takeSnap(takeId){const row=forTake(takeId);if(!row)return null;return {meetingEventId:row.id,route:row.routing?.route||null,view:row.routing?.target?{...row.routing.target}:null,conversation:null,others:[],screen:''};}
  // Read the real native producer: events is a map of JSON-encoded receipt strings.
  // This proves an already-created take's ownership; it never recreates a microphone loan.
  function nativeTake(takeId) {
    const row=forTake(takeId);if(!row)return null;
    try{const events=JSON.parse(window.WizardOSDevice?.recHandoffEvents?.()||'{}'),receipt=JSON.parse(events[row.id]||'null');
      return receipt?.id===row.id && receipt.meetingId===row.meetingId && receipt.voiceTakeId===takeId ? {...row,native:true,nativeReceipt:receipt}:null;
    }catch{return null;}
  }
  window.WosOrbHandoff={begin,end,update,sync,read,track,bind,forTake,takeSnap,nativeTake};
  const ob=window.WosOutbox;
  ob?.onChange(()=>{for(const it of ob._items.values())try{track(it);}catch(e){console.error('Meeting link retained in outbox',e);}});
  ob?.onSent(track);
  addEventListener('online',()=>sync());setInterval(()=>sync(false),5000);void sync(false);
})();
