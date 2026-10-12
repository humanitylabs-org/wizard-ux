(() => {
  'use strict';
  const select=document.getElementById('arch-skin'),host=document.getElementById('lab-host');
  const hosted=parent!==window;
  if(hosted)document.documentElement.dataset.previewHosted='true';
  select.value=WosSkin.current;
  select.addEventListener('change',()=>{WosSkin.set(select.value);WizardAppearance.sync(true)});
  document.getElementById('lab-presentation').addEventListener('click',()=>{host.classList.toggle('full');WizardAppearance.sync(true)});
  addEventListener('message',e=>{
    if(e.origin!==location.origin||e.source!==host.querySelector('iframe').contentWindow||e.data?.type!=='wizard:appearance:ack')return;
    document.getElementById('lab-status').textContent='Appearance v1 applied · revision '+e.data.revision+' · same app document';
  });
  function back(){
    const f=host.querySelector('iframe');
    if(f.contentWindow.__wizardCloseOverlay?.())return true;
    if(host.classList.contains('full')){host.classList.remove('full');WizardAppearance.sync(true);return true;}
    return false;
  }
  window.__wizardCloseOverlay=back;
  window.WizardArchitecture={ready:true,back};
  if(hosted)return;
  window.__wizardBrowserBackAdapter=true;
  function arm(){history.replaceState({wizardPreviewRoot:true},'',location.href);history.pushState({wizardPreviewGuard:true},'',location.href)}
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',arm);else arm();
  addEventListener('popstate',()=>{
    if(back())history.pushState({wizardPreviewGuard:true},'',location.href);
    else location.replace('../');
  });
})();
