// Synthetic metadata only. Run before the shell loads its cached receiver registry.
(() => {
  const targets = [
    {id:'test-a',name:'Test Person A',detail:'Messenger',lastActivity:100},
    {id:'test-c',name:'Test Person C',detail:'Messenger',lastActivity:300},
    {id:'test-b',name:'Test Person B',detail:'Messenger',lastActivity:200},
  ];
  localStorage.setItem('wos.share.receivers.v1',JSON.stringify({messenger:{accepts:['text','url','image','file'],targets}}));
  localStorage.setItem('wos.share.recent.v1',JSON.stringify(['messenger|test-a']));
  localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.voiceTipSeen','true');
  document.addEventListener('DOMContentLoaded', () => {
    const ready = setInterval(() => {
      if (!window.WosShareSheet || !window.WosChat || !window.WizCore?.apps?.()?.APP?.messenger) return;
      clearInterval(ready);
      const banner=document.createElement('button'); banner.type='button'; banner.textContent='STAGING · synthetic people · tap to share again';
      banner.style.cssText='position:fixed;top:12px;left:12px;right:12px;z-index:200;padding:12px;background:var(--bg);color:var(--ink);border:1px solid var(--line-2);border-radius:12px';
      const show=()=>window.WosChat.sharePayload({text:'Synthetic item — add your note before sending.',url:'https://example.test/shared-item'});
      banner.addEventListener('click',show); document.body.append(banner); show();
    },100);
    setTimeout(()=>clearInterval(ready),15000);
  });
})();
