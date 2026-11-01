 'use strict';
const field=document.querySelector('#draft'), status=document.querySelector('#status');
let revision=null, serial=0, queue=Promise.resolve(), saving=false;
async function hydrate() {
  const saved=await WizardApp.state.read({area:'persistent',key:'draft'});
  revision=saved.revision;field.value=saved.exists ? saved.value.text : '';field.disabled=false;
  status.textContent='Recovered locally · '+(revision || 'new draft');
}
function start() { hydrate().catch(e=>{status.textContent='Recovery unavailable: '+e.code;}); }
field.addEventListener('input',()=>{
  const text=field.value, edit=++serial;
  status.textContent='Unsaved locally'; // Immediate paint; never pretend backend durability.
  queue=queue.then(async()=>{
    saving=true;const operationKey=crypto.randomUUID();
    try {
      const saved=await WizardApp.state.write({area:'persistent',key:'draft',value:{text},ifRevision:revision,operationKey});
      revision=saved.revision;
      if(edit===serial)status.textContent='Saved locally · '+revision;
    } catch(e) {
      status.textContent='Not saved ('+e.code+'). Copy your text before recovery.';
      // A conflict must not overwrite either copy or auto-adopt a foreign revision.
      field.readOnly=true;
    } finally {saving=false;}
  });
});
document.querySelector('#recover').onclick=async()=>{
  if(saving || field.readOnly || status.textContent.startsWith('Unsaved')) {status.textContent='Keep or copy unsaved text before recovery.';return;}
  try {await queue;await hydrate();}catch(e){status.textContent='Recovery unavailable: '+e.code;}
};
addEventListener('beforeunload',e=>{if(saving || status.textContent.startsWith('Unsaved') || field.readOnly){e.preventDefault();e.returnValue='';}});
if(window.WizBoundaryClient?.ready)start();else addEventListener('wizard:boundary:connected',start,{once:true});
