/* Android Apps relay: the shell's narrow door between the Android Apps view (a hosted frame) and Wizard OS native.
 *
 * Hosted frames never see native interfaces. Wizard OS (0.8.9+) gives the SHELL a message port,
 * window.wizardAppsPort (AndroidX addWebMessageListener, private origin, main frame only). This relay accepts
 *   {type:'wizard-os:android', id, method, params}
 * only from a frame that is (1) one of the shell's own app iframes, (2) same origin, (3) at /android-apps/, and only
 * for the allowlisted methods. Answers go back to that frame as {type:'wizard-os:android', id, ok, result|error};
 * native pushes (install status, resume) go to every Android Apps frame as {type:'wizard-os:android-push', ...}.
 * Without the port (older Wizard OS, a browser), every call answers {ok:false, error:'no-bridge'} so the view can say
 * "Update Wizard OS to use Android Apps".
 */
(() => {
  'use strict';
  const T = 'wizard-os:android', PUSH = 'wizard-os:android-push';
  const METHODS = new Set(['list', 'icon', 'launch', 'openPlay', 'appInfo', 'uninstall', 'install', 'status']);
  const PATH = /^\/android-apps(\/|$)/;
  const pending = new Map(); // native id → {win, id}
  let seq = 0, listening = false;
  const log = m => { window.__androidRelayLog = (window.__androidRelayLog || []).concat(m).slice(-40); };

  const port = () => window.wizardAppsPort && typeof window.wizardAppsPort.postMessage === 'function' ? window.wizardAppsPort : null;

  // The sending window must be the content window of one of the shell's own app iframes, at /android-apps/.
  function frameOk(win, origin) {
    if (!win || win === window || origin !== location.origin) return false;
    const f = [...document.querySelectorAll('iframe.appframe')].find(x => x.contentWindow === win);
    if (!f) return false;
    try { return PATH.test(win.location.pathname); } catch (e) { return false; }
  }
  function frames() {
    return [...document.querySelectorAll('iframe.appframe')].map(f => f.contentWindow).filter(w => { try { return w && PATH.test(w.location.pathname); } catch (e) { return false; } });
  }
  function reply(win, id, ok, x) { try { win.postMessage(ok ? { type: T, id, ok: true, result: x } : { type: T, id, ok: false, error: x }, location.origin); } catch (e) {} }

  function onNative(ev) {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m) return;
    if (m.type) { frames().forEach(w => { try { w.postMessage({ type: PUSH, push: m }, location.origin); } catch (e) {} }); return; }
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    reply(p.win, p.id, !!m.ok, m.ok ? m.result : (m.error || 'failed'));
  }
  function listen(pt) {
    if (listening) return;
    listening = true;
    // AndroidX ports deliver replies through onmessage (and addEventListener on newer WebViews).
    if (typeof pt.addEventListener === 'function') pt.addEventListener('message', onNative); else pt.onmessage = onNative;
  }

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.type !== T) return;
    if (!frameOk(ev.source, ev.origin)) { log('refused:frame'); return; }
    const id = String(d.id || '').slice(0, 64);
    if (!METHODS.has(d.method)) { log('refused:method:' + d.method); return reply(ev.source, id, false, 'unknown method'); }
    const pt = port();
    if (!pt) { log('no-bridge:' + d.method); return reply(ev.source, id, false, 'no-bridge'); }
    listen(pt);
    const nid = 'r' + (++seq);
    pending.set(nid, { win: ev.source, id });
    setTimeout(() => { if (pending.delete(nid)) reply(ev.source, id, false, 'timeout'); }, 20000);
    const params = d.params && typeof d.params === 'object' ? d.params : {};
    log('call:' + d.method);
    try { pt.postMessage(JSON.stringify({ id: nid, method: d.method, params })); }
    catch (e) { pending.delete(nid); reply(ev.source, id, false, 'no-bridge'); }
  });
  window.WizAndroidRelay = { METHODS, frameOk, available: () => !!port() };
})();
