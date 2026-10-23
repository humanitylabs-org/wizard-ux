/* Generic device port client (window.wizardDevicePort, Android 0.10.2+): versioned request/reply with capability
 * discovery. Envelope {v:1, id, method, params} → {v:1, id, ok, result | error}. See docs/android-device-message-port.md.
 * Absent port (browser, desktop, older APK): every call rejects with code 'no-port' and has() answers false, so a
 * feature falls back or says it is unavailable; it never assumes a newer APK. */
(function (root) {
  'use strict';
  function create(getPort, opts = {}) {
    const timers = opts.timers || { set: (f, ms) => setTimeout(f, ms), clear: t => clearTimeout(t) };
    const pending = new Map();
    let seq = 0, bound = null, caps = null;
    const err = code => Object.assign(new Error(code), { code });
    function onReply(ev) {
      let m; try { m = JSON.parse(ev && ev.data); } catch (e) { return; }
      if (!m || m.v !== 1 || typeof m.id !== 'string') return;
      const r = pending.get(m.id); if (!r) return;
      pending.delete(m.id); timers.clear(r.t);
      if (m.ok) r.resolve(m.result); else r.reject(err(String(m.error || 'failed')));
    }
    function bind(p) {
      if (bound === p) return;
      bound = p;
      // AndroidX ports deliver replies through onmessage (and addEventListener on newer WebViews).
      if (typeof p.addEventListener === 'function') p.addEventListener('message', onReply); else p.onmessage = onReply;
    }
    function call(method, params = {}, { timeout = 10000 } = {}) {
      const p = getPort();
      if (!p) return Promise.reject(err('no-port'));
      bind(p);
      const id = 'd' + (++seq) + '-' + Date.now().toString(36);
      return new Promise((resolve, reject) => {
        const t = timers.set(() => { pending.delete(id); reject(err('timeout')); }, timeout);
        pending.set(id, { resolve, reject, t });
        try { p.postMessage(JSON.stringify({ v: 1, id, method, params })); }
        catch (e) { pending.delete(id); timers.clear(t); reject(err('no-port')); }
      });
    }
    function capabilities() {
      if (!caps) caps = call('device.capabilities').then(r => (r && r.capabilities) || {}).catch(e => { caps = null; throw e; });
      return caps;
    }
    /** Does the device offer capability {@code name} at version {@code v} (and {@code method}, if given)? */
    async function has(name, v = 1, method) {
      try {
        const c = (await capabilities())[name];
        return !!c && c.v === v && (!method || (Array.isArray(c.methods) && c.methods.includes(name + '.' + method)));
      } catch (e) { return false; }
    }
    return { available: () => !!getPort(), call, capabilities, has, reset() { caps = null; } };
  }
  const port = () => (root.wizardDevicePort && typeof root.wizardDevicePort.postMessage === 'function') ? root.wizardDevicePort : null;
  root.WizDevicePort = Object.assign(create(port), { create });
})(typeof window !== 'undefined' ? window : globalThis);
