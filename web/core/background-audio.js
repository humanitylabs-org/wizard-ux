/* Background audio v1 pilot. Only the live registered Music app document can drive it. */
(() => {
  'use strict';
  const TYPE = 'wizard:background-audio:v1', pending = new Map();
  const METHODS = new Set(['capabilities','attach','state','load','play','pause','seek','next','previous','jump','enqueueNext','removeCurrent','removeUpcoming','volume','detach','stop']);
  let registry = () => ({}), admit = () => false, seq = 0, boundPort;
  function frameOk(win, origin = location.origin) {
    if (!win || win === window || origin !== location.origin) return false;
    const app = registry()['wizard-music'];
    if (!app?.url) return false;
    const f = [...document.querySelectorAll('iframe.appframe')].find(f => f.contentWindow === win);
    if (!f?.isConnected || !admit(f) || f.hasAttribute('srcdoc')) return false;
    try {
      const src = new URL(f.getAttribute('src'), location.href), live = new URL(win.location.href), expected = new URL(app.url, location.href);
      return [src, live, expected].every(u => u.origin === location.origin && u.pathname === '/wizard-music/') && !!win.document.documentElement;
    } catch (_) { return false; }
  }
  function port() { return window.wizardAudioPort?.postMessage ? window.wizardAudioPort : null; }
  function reply(p, data) { if (frameOk(p.win) && p.win.document === p.document) p.win.postMessage({type:TYPE,id:p.id,...data}, location.origin); }
  function listen(pt) {
    if (pt === boundPort) return;
    boundPort = pt;
    pt.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer);
      if (m.ok && m.result) window.WizBackgroundAudio.lastState = m.result;
      reply(p, {ok:!!m.ok,result:m.result,error:m.error});
    };
  }
  window.addEventListener('message', e => {
    const d = e.data;
    if (d?.type !== TYPE || !frameOk(e.source,e.origin)) return;
    const p = {win:e.source,document:e.source.document,id:String(d.id || '').slice(0,80)};
    if (!METHODS.has(d.method) || pending.size >= 16) return reply(p,{ok:false,error:'Audio request refused'});
    const pt = port(); if (!pt) return reply(p,{ok:false,error:'Background audio unavailable'});
    listen(pt); const id = 'audio-' + (++seq);
    p.timer = setTimeout(() => { if(pending.delete(id)) reply(p,{ok:false,error:'Audio request timed out'}); },20000);
    pending.set(id,p);
    try { pt.postMessage(JSON.stringify({...d.params,id,v:1,appId:'wizard-music',method:d.method})); }
    catch (_) { pending.delete(id); clearTimeout(p.timer); reply(p,{ok:false,error:'Audio unavailable'}); }
  });
  window.WizBackgroundAudio = {init:(fn, grant) => {registry=fn;admit=grant;}, frameOk, canAttach:win => !!port() && frameOk(win), lastState:null};
})();
