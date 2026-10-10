/* Wizard OS carry, OLD side (runs only in carry.html on the retired name, inside the Android app).
 *
 * A WebView keeps localStorage and IndexedDB per origin, so moving the app to the tailnet name would
 * otherwise start it with no drafts, no unsent messages and every thread unread. This reads everything
 * this origin kept on the phone and hands it to WizardOSNative.carryOut(json) once. Nothing is deleted
 * here: the old origin's copy stays as it was (a rollback build can still read it).
 *
 *   ls       every localStorage key on this origin (the shell and every hosted app share it)
 *   outbox   unsent Wizard OS messages (IndexedDB wos-outbox); voice audio as base64 while it fits
 */
(() => {
  'use strict';
  const N = window.WizardOSNative;
  if (!N || typeof N.carryOut !== 'function') return;
  const LIMIT = 20e6; // characters handed across the bridge; Carry.MAX_CHARS is 24M
  const out = { v: 1, from: location.origin, at: Date.now(), ls: {}, outbox: [] };
  try {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k != null) out.ls[k] = localStorage.getItem(k); }
  } catch (e) { /* storage unavailable: carry what we can */ }

  const b64 = blob => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || '').split(',')[1] || '');
    r.onerror = () => res('');
    r.readAsDataURL(blob);
  });
  const readOutbox = () => new Promise(res => {
    let req;
    try { req = indexedDB.open('wos-outbox', 1); } catch (e) { return res([]); }
    req.onupgradeneeded = () => { try { req.result.createObjectStore('items', { keyPath: 'id' }); } catch (e) {} };
    req.onerror = () => res([]);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const g = db.transaction('items', 'readonly').objectStore('items').getAll();
        g.onsuccess = () => { res(g.result || []); db.close(); };
        g.onerror = () => { res([]); db.close(); };
      } catch (e) { res([]); }
    };
  });

  const send = () => { try { N.carryOut(JSON.stringify(out)); } catch (e) { /* the app times out and goes home */ } };
  (async () => {
    let size = JSON.stringify(out.ls).length;
    for (const it of await readOutbox()) {
      if (!it || !it.id || it.state === 'sent' || it.state === 'empty') continue;
      const x = { ...it, audio: null };
      if (it.state === 'sending') x.state = 'waiting';
      const a = it.audio;
      if (a && typeof a === 'object' && typeof a.size === 'number' && size + a.size * 1.4 < LIMIT) {
        x.audio64 = await b64(a);
        x.audioType = it.audioType || a.type || 'audio/webm';
        size += x.audio64.length;
      }
      size += JSON.stringify(x).length - (x.audio64 ? x.audio64.length : 0);
      out.outbox.push(x);
    }
    send();
  })().catch(send);
})();
