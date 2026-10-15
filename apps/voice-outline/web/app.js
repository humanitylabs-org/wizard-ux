import {uid,clone,apply,depth,visible,moveOperation,inverse,markdown,SpeechLedger} from './model.js';
const $=id=>document.getElementById(id), W=window.WizardApp;
let doc={title:'Untitled outline',nodes:[{id:'first-bullet',parent:null,text:'',folded:false}],applied:[]},rev=0,ops=[],selected='first-bullet',editing=null,editingDraft=null,undo=[],redo=[],ledger=new SpeechLedger(),saving=false,saveTimer,db,localWrites=Promise.resolve(),hold;
let session=null,socket=null,current=null,seq=0,starting=false,stopping=false,stopObserved=false,paused=false,offs=[],uploadChain=Promise.resolve(),uploadError=null,acked=new Set(),finalWait,liveTimer,startedAt=0;
const note=t=>{$('notice').textContent=t;};
const request=async(path,options={})=>{const r=await fetch(path,{cache:'no-store',...options});const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.error||'Request failed'),{status:r.status,value});return value;};
const put=value=>({method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
function remember(){
 const state=clone({doc,rev,ops,selected,drafts:ledger.items,seq,undo,redo});
 localWrites=localWrites.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{if(!db)return reject(new Error('Local recovery unavailable'));const tx=db.transaction('recovery','readwrite');tx.objectStore('recovery').put(state,'outline');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));
 localWrites.catch(()=>{note('Local recovery failed. Keep this tab open and retry saving.');});return localWrites;
}
function changed(){hold||=(W.update.hold('Outline has unsaved changes'));$('save').textContent='Saving…';remember();clearTimeout(saveTimer);saveTimer=setTimeout(save,350);}
function operation(part,{history=true,renderView=true}={}){const op={...part,id:part.id||uid()},inv=inverse(doc,op);if(!apply(doc,op))return;if(history&&inv){const {id,speechId,...forward}=part;undo.push({forward,back:inv});redo=[];}ops.push(op);changed();if(renderView)render();}
async function save(){
 if(saving)return;saving=true;
 try{if(!ops.length){const remote=await request('./api/document');rev=remote.rev;doc=remote.document;for(const op of ops)apply(doc,op);render();await remember();}while(ops.length){const count=ops.length,snapshot=clone(doc),version=rev;
  let response;
  try{response=await request('./api/document',put({rev:version,document:snapshot}));}
  catch(e){if(e.status===409){doc=e.value.document;rev=e.value.rev;for(const op of ops)apply(doc,op);render();await remember();continue;}throw e;}
  const check=await request('./api/document');
  if(check.rev!==response.rev||JSON.stringify(check.document)!==JSON.stringify(snapshot))throw new Error('Save readback changed; retry safely');
  rev=response.rev;ops.splice(0,count);for(const [id,s] of Object.entries(ledger.items))if(s.status==='final'&&doc.applied.includes('speech-'+id))delete ledger.items[id];await remember();
 }
 $('save').textContent='Saved';hold?.release();hold=null;
 }catch(e){$('save').textContent=navigator.onLine?'Save failed · retry':'On this device only';note('Your edits remain on this device. '+e.message);}
 finally{saving=false;}
}
function select(id,{edit=false}={}){if(editing&&editing!==id)editing=null;selected=id;if(session&&current?.target!==id)boundary();if(edit){detachDraft(id);editing=id;}remember();render();if(edit)focusEditor();}
function focusEditor(){const el=$('tree').querySelector('textarea');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);resize(el);}}
function resize(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}
function newBullet(child=false){const n=doc.nodes.find(n=>n.id===selected)||doc.nodes.at(-1),id=uid();if(child&&n.folded)operation({kind:'fold',target:n.id,folded:false});operation({kind:'insert',node:{id,parent:child?n.id:n.parent,text:'',folded:false},after:child?null:n.id});select(id,{edit:!session});document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({block:'nearest'});}
function move(direction){const op=moveOperation(doc,selected,direction);if(op)operation(op);else note(direction>0?'No previous sibling to indent beneath.':'Already at the outer level.');}
function fold(){const n=doc.nodes.find(n=>n.id===selected);if(n)operation({kind:'fold',target:n.id,folded:!n.folded});}
function historyStep(forward){const from=forward?redo:undo,to=forward?undo:redo,item=from.pop();if(!item)return;operation(forward?item.forward:item.back,{history:false});to.push(item);remember();render();}
function render(){
 const draftFocused=document.activeElement?.classList.contains('draft-editor');const focused=document.activeElement?.tagName==='TEXTAREA',position=focused?document.activeElement.selectionStart:null;
 const scroll=$('canvas').scrollTop;const tree=$('tree');tree.replaceChildren();
 if(document.activeElement!==$('title'))$('title').value=doc.title;
 const shown=visible(doc);for(const n of shown){
  const level=depth(doc,n),row=document.createElement('div');row.className='bullet'+(n.id===selected?' selected':'')+(session&&current?.target===n.id?' live-target':'');row.dataset.id=n.id;row.style.setProperty('--depth',level);row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(level+1));row.setAttribute('aria-selected',String(n.id===selected));
  for(let i=0;i<level;i++){const guide=document.createElement('i');guide.className='branch-guide';guide.style.setProperty('--guide',i);row.append(guide);}
  const children=doc.nodes.some(x=>x.parent===n.id),dot=document.createElement('button');dot.className='dot'+(n.folded?' folded':'');dot.textContent=children?(n.folded?'⊙':'▾'):'•';dot.setAttribute('aria-label',children?(n.folded?'Unfold branch':'Fold branch'):'Select bullet');if(children)row.setAttribute('aria-expanded',String(!n.folded));
  dot.onclick=()=>{if(dot.dataset.swiped){delete dot.dataset.swiped;return;}select(n.id);if(children)fold();};
  let touch;
  dot.addEventListener('pointerdown',e=>{touch={x:e.clientX,y:e.clientY};dot.setPointerCapture(e.pointerId);});
  dot.addEventListener('pointerup',e=>{if(!touch)return;const dx=e.clientX-touch.x,dy=e.clientY-touch.y;touch=null;if(Math.abs(dx)>=48&&Math.abs(dy)<Math.abs(dx)*.577){dot.dataset.swiped='1';selected=n.id;move(dx>0?1:-1);}});
  row.append(dot);const content=document.createElement('div');content.className='bullet-content';
  if(editing===n.id){const input=document.createElement('textarea');input.className='editor';input.setAttribute('aria-label','Edit bullet');input.value=n.text;input.rows=1;input.oninput=()=>{operation({kind:'text',target:n.id,before:doc.nodes.find(x=>x.id===n.id).text,text:input.value},{renderView:false});resize(input);};input.onkeydown=keys;content.append(input);queueMicrotask(()=>resize(input));}
  else{const text=document.createElement('div');text.className='text'+(!n.text?' empty':'');text.textContent=n.text;text.tabIndex=0;text.setAttribute('role','textbox');text.setAttribute('aria-label',n.text||'Empty bullet');text.onclick=()=>select(n.id,{edit:true});text.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();select(n.id,{edit:true});}};content.append(text);}
  const drafts=Object.values(ledger.items).filter(s=>s.target===n.id&&!doc.applied.includes('speech-'+s.id));
  for(const s of drafts){const draft=document.createElement('div');draft.className='draft';draft.dataset.utterance=s.id;const label=document.createElement('small');label.textContent=s.status==='draft'?'Draft':s.status==='final'?'Waiting for earlier speech':s.text?'Unconfirmed speech · retained text':'Unconfirmed speech · no transcript';draft.append(label);
   if(editingDraft===s.id){const input=document.createElement('textarea');input.className='draft-editor';input.setAttribute('aria-label','Edit unconfirmed speech');input.value=s.text;input.oninput=()=>{s.text=input.value;s.edited=true;remember();draft.querySelector('[data-accept]').disabled=!s.text.trim();};draft.append(input);}
   else draft.append(document.createTextNode(s.text|| (s.status==='draft'?'Listening…':'No words were returned. Review the original recording in the menu.')));
   if(s.status==='unconfirmed'){const actions=document.createElement('div');actions.className='draft-actions';const accept=document.createElement('button');accept.textContent='Accept';accept.dataset.accept=s.id;accept.disabled=!s.text.trim();accept.onclick=()=>acceptDraft(s.id);const edit=document.createElement('button');edit.textContent=editingDraft===s.id?'Done editing':'Edit';edit.onclick=()=>{editingDraft=editingDraft===s.id?null:s.id;render();$('tree').querySelector('.draft-editor')?.focus();};actions.append(accept,edit);draft.append(actions);}content.append(draft);}
  row.append(content);tree.append(row);
 }
 $('canvas').scrollTop=scroll;$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;$('done').hidden=!editing;
 document.querySelector('.hint').hidden=doc.nodes.some(n=>n.text)||doc.nodes.length>1;
 if(focused&&(editing||editingDraft)){const e=tree.querySelector(draftFocused?'.draft-editor':'.editor');e?.focus({preventScroll:true});e?.setSelectionRange(position,position);}
}
function keys(e){if(e.isComposing)return;if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();newBullet();}else if(e.key==='Tab'){e.preventDefault();move(e.shiftKey?-1:1);}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();historyStep(e.shiftKey);}else if(e.key==='Escape'&&editing){e.preventDefault();e.stopPropagation();editing=null;render();}}
function detachDraft(id){if(!Object.values(ledger.items).some(s=>s.target===id&&!doc.applied.includes('speech-'+s.id)))return;const n=doc.nodes.find(n=>n.id===id),newId=uid();operation({kind:'insert',node:{id:newId,parent:n?.parent||null,text:'',folded:false},after:id});ledger.detach(id,newId,doc.applied);if(current?.target===id)current.target=newId;note('The ongoing speech is beside this bullet so typing cannot overwrite it.');remember();}
function begin(){if(!socket||socket.readyState!==1||!session||paused||stopping)return;const s=ledger.begin(uid(),selected,++seq);s.parent=doc.nodes.find(n=>n.id===selected)?.parent||null;current=s;socket.send(JSON.stringify({type:'begin',id:s.id,target:s.target,seq:s.seq}));remember();render();}
function boundary(){if(current){socket?.send(JSON.stringify({type:'end',id:current.id}));current=null;}begin();}
function settle(){
 const items=Object.values(ledger.items).sort((a,b)=>a.seq-b.seq);
 for(const s of items){if(s.status==='draft')break;if(s.status==='final'&&!doc.applied.includes('speech-'+s.id))operation({speechId:s.id,kind:'voice',target:s.target,parent:s.parent,text:s.text});}
 remember();render();if(!items.some(s=>s.status==='draft'))finalWait?.();
}
function acceptDraft(id){const s=ledger.items[id];if(!s||s.status!=='unconfirmed'||!s.text.trim())return;s.status='final';editingDraft=null;settle();note('Accepted text. Original audio is unchanged.');}
async function digest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function upload(take,c){const key=take+':'+c.seq;if(acked.has(key))return;uploadChain=uploadChain.catch(()=>{}).then(async()=>{const hash=await digest(c.blob),url=`./api/audio/${encodeURIComponent(take)}/${c.seq}`;await request(url,{method:'PUT',body:c.blob});const r=await request(url);if(r.hash!==hash||r.bytes!==c.blob.size)throw new Error('Audio readback mismatch');acked.add(key);}).catch(e=>{uploadError=e;note('Audio retained by Wizard. '+e.message);});}
async function archive(result){uploadError=null;for(const c of result.streamChunks||[])upload(result.id,c);await uploadChain;if(uploadError)throw uploadError;if(!result.streamChunks?.length&&result.blob?.size>44)throw new Error('Capture chunk metadata unavailable; retained');await W.capture.ack(result.id);note('Audio saved and verified.');}
async function recover(){try{const pending=await W.capture.pending();for(const result of pending)await archive(result);await save();note(pending.length?'Retained audio saved and verified. No new transcript was recovered; review unconfirmed speech or original recordings.':'No retained audio waiting. Unconfirmed speech still needs review.');}catch(e){note('Recovery pending: '+e.message);}}
async function startLive(){
 if(starting||stopping)return;starting=true;$('live').disabled=true;$('live').textContent='Starting…';let prepared;
 try{
  if(!W.capture.capabilities({kind:'outline',pcm:true}).pcm)throw new Error('Live PCM is unavailable in this recorder. Use the browser preview; no meeting will be created.');
  prepared=W.capture.prepare({kind:'outline',pcm:true});
  if((await W.capture.pending()).length)throw new Error('Retained audio needs recovery first. Open the menu → Recover.');
  const health=await request('./healthz');if(!health.liveReady)throw new Error('Tinfoil is not configured on this preview.');
  socket=new WebSocket(new URL('./api/live',location.href).href.replace(/^http/,'ws'));socket.binaryType='arraybuffer';
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Live connection timed out')),12000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(new Error('Live connection failed'));};});
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='delta'||m.type==='final'){ledger.event(m);if(m.type==='final')settle();else{remember();render();}}else if(m.type==='error'){note('Live words unavailable: '+m.reason+'. Audio remains retained.');if(m.id&&ledger.items[m.id]&&ledger.items[m.id].status!=='final')ledger.items[m.id].status='unconfirmed';settle();if(session&&!paused&&(!m.id||m.id===current?.id))pauseLive();}};
  socket.onclose=()=>{if(session&&!stopping){note('Connection lost. Recording paused; stop to save retained audio.');pauseLive();}};
  editing=null;
  session=await W.capture.start({kind:'outline',pcm:true,mime:'audio/wav',chunkMs:5000,maxMs:15*60*1000,maxBytes:32*1024*1024,preparedId:prepared.id,meta:{app:'voice-outline'},audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  startedAt=Date.now();paused=false;stopObserved=false;begin();const take=session.id;
  offs.push(session.onPcm(f=>{if(!current||paused)return;if(socket.readyState!==1||socket.bufferedAmount>640000){note('Live network is behind. Paused; audio retained.');pauseLive();return;}socket.send(f.pcm);}),session.onChunk(c=>upload(take,c)),session.onWarn(w=>note(String(w?.message||w))),session.onState(st=>{if(stoppedByCore())stopLive();}));
  liveTimer=setInterval(liveUI,1000);note('Listening to the marked bullet. New bullet or Child starts the next thought.');liveUI();render();
 }catch(e){note(e.message);socket?.close();socket=null;if(session)await stopLive();}
 finally{prepared?.release();starting=false;$('live').disabled=false;liveUI();}
}
function stoppedByCore(){return session?.getInfo().inputStopped&&!stopping&&!stopObserved;}
function liveUI(){if(stoppedByCore())void stopLive();const ended=session?.getInfo().inputStopped;$('live').classList.toggle('active',!!session&&!ended);$('live').textContent=session?(ended?'Save pending':'◉ '+(paused?'Paused':'Recording')):'◉ Go Live';$('live-status').textContent=session?(ended?'Microphone off · tap to retry save':`${Math.floor((Date.now()-startedAt)/60000)}:${String(Math.floor((Date.now()-startedAt)/1000)%60).padStart(2,'0')} · Tap to stop`):'Your words, not a rewrite.';}
async function pauseLive(){if(!session||stopping)return;try{if(paused){if(socket?.readyState!==1)throw new Error('Connection closed. Stop & save, then start Live again.');await session.resume();paused=false;begin();}else{await session.pause();paused=true;if(current){socket?.send(JSON.stringify({type:'end',id:current.id}));current=null;}}liveUI();render();}catch(e){note(e.message);}}
async function stopLive(){
 if(!session||stopping)return;stopping=true;stopObserved=true;$('live').disabled=true;const s=session;
 try{const result=await s.stop();if(current){socket?.send(JSON.stringify({type:'end',id:current.id}));current=null;}
  note('Microphone stopped. Waiting for final words and audio readback…');
  await archive(result);
  if(Object.values(ledger.items).some(s=>s.status==='draft'))await new Promise(resolve=>{const timer=setTimeout(resolve,35000);finalWait=()=>{clearTimeout(timer);resolve();};});
  for(const item of Object.values(ledger.items))if(item.status==='draft')item.status='unconfirmed';settle();await save();
  socket?.close();socket=null;session=null;for(const off of offs.splice(0))off();clearInterval(liveTimer);note('Stopped. '+(Object.values(ledger.items).some(s=>s.status==='unconfirmed')?'Unconfirmed speech is retained as a draft.':'Words and audio saved.'));
 }catch(e){note('Stop/save needs retry. Audio retained: '+e.message);}
 finally{stopping=false;finalWait=null;$('live').disabled=false;liveUI();render();}
}
async function recordings(){const list=$('recordings');list.replaceChildren();list.textContent='Loading original recordings…';try{const {takes}=await request('./api/audio');list.replaceChildren();if(!takes.length)list.textContent='No saved recordings yet. Retained takes must be recovered first.';for(const take of takes){const row=document.createElement('div');row.className='recording';const label=document.createElement('p');label.textContent=`${take.createdAt?new Date(take.createdAt).toLocaleString():take.id} · ${take.bytes} bytes`;const url=`./api/audio/${encodeURIComponent(take.id)}/wav`;const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=url;audio.setAttribute('aria-label','Original recording '+take.id);const download=document.createElement('a');download.href=url;download.download=take.id+'.wav';download.textContent='Download original WAV';row.append(label,audio,download);list.append(row);}}catch(e){list.textContent='Original recordings unavailable: '+e.message;}}
let sheetBack;
function closeSheet(){if(!$('sheet').open)return false;$('sheet').close();sheetBack?.release();sheetBack=null;return true;}
$('menu').onclick=()=>{$('sheet').showModal();void recordings();sheetBack=W.back.push(()=>closeSheet());};$('close-sheet').onclick=closeSheet;$('sheet').addEventListener('cancel',e=>{e.preventDefault();closeSheet();});
W.back.register({canGoBack:()=>editing!==null||editingDraft!==null,back:()=>{if(editingDraft!==null){editingDraft=null;render();return true;}editing=null;render();return true;}});
W.theme.onChange(()=>{});W.ready({name:'Outline'});
$('done').onclick=()=>{editing=null;render();};
$('new').onclick=()=>newBullet();$('child').onclick=()=>newBullet(true);$('outdent').onclick=()=>move(-1);$('indent').onclick=()=>{closeSheet();move(1);};$('fold').onclick=fold;$('undo').onclick=()=>historyStep(false);$('redo').onclick=()=>historyStep(true);$('save').onclick=save;
$('title').oninput=()=>operation({kind:'title',text:$('title').value},{renderView:false});
$('live').onclick=()=>session?stopLive():startLive();$('stop').onclick=()=>{closeSheet();stopLive();};$('pause').onclick=()=>{closeSheet();pauseLive();};$('recover').onclick=()=>{closeSheet();recover();};$('share').onclick=async()=>{const result=await W.share.text({title:doc.title,text:markdown(doc)});note(result==='copied'?'Outline copied.':result==='shared'?'Outline shared.':result==='cancelled'?'Share cancelled.':'Sharing is unavailable here.');};
addEventListener('online',()=>save());document.addEventListener('keydown',e=>{if(e.target.tagName!=='TEXTAREA')keys(e);});
async function load(){
 let remoteRead=false;
 try{db=await new Promise((resolve,reject)=>{const req=indexedDB.open('voice-outline-recovery',1);req.onupgradeneeded=()=>req.result.createObjectStore('recovery');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const local=await new Promise((resolve,reject)=>{const req=db.transaction('recovery').objectStore('recovery').get('outline');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  if(local){({doc,rev,ops,selected,seq}=local);undo=local.undo||[];redo=local.redo||[];for(const item of [...undo,...redo]){delete item.forward.id;delete item.forward.speechId;}ledger=new SpeechLedger(local.drafts||{});for(const s of Object.values(ledger.items))if(s.status==='draft')s.status='unconfirmed';}
  try{const remote=await request('./api/document');remoteRead=true;rev=remote.rev;doc=remote.document;for(const op of ops)apply(doc,op);const speech=await request('./api/speech');for(const s of speech.utterances){if(!doc.applied.includes('speech-'+s.id)){ledger.event({...s,type:s.status==='final'?'final':'delta'});if(s.status!=='final')ledger.items[s.id].status='unconfirmed';}}}catch(e){note('Offline recovery. Changes stay on this device until the server returns.');}
  if(!doc.nodes.some(n=>n.id===selected))selected=doc.nodes[0].id;settle();render();await remember();if(ops.length)await save();else $('save').textContent=remoteRead?'Saved':'On this device only';
  const existing=W.capture.current();
  if(existing&&existing.phase!=='starting'){
   session=await W.capture.start({kind:'outline',pcm:true,resumeId:existing.id});startedAt=Date.now()-(session.getInfo().durationMs||0);paused=!!session.getInfo().paused;stopObserved=false;
   liveTimer=setInterval(liveUI,1000);liveUI();note('Wizard is still recording audio from before this view reopened. Live words disconnected; tap Recording to stop and save the original take.');
  }else{const pending=await W.capture.pending();if(pending.length)note('Wizard retains audio from an interrupted take. Open menu → Recover.');}
 }catch(e){note('Could not load recovery: '+e.message);render();}
}
load();
