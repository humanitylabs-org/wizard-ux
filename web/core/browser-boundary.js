/* Experimental browser boundary. Loaded ONLY by the flag-on server's navigation
 * response, before the shell. The secret never enters storage, a URL or this API.
 * No generic fetch/native/install proxy is exposed to an app. Sharing requires
 * a trusted shell click; transcription is a bounded per-app capability. */
(() => {
  'use strict';
  const node = document.querySelector('meta[name="wizard-shell-token"]');
  if (!node) return;
  const secret = node.content;
  node.remove();
  if (parent !== window || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid shell bootstrap');
  const ORIGIN = location.origin, sessions = new Map(), pending = new Map();
  const nativeFetch = window.fetch.bind(window);
  const ownerPath = p => (/^\/wizard\//.test(p) && !/^\/wizard\/mcp(?:\/|$)/.test(p)) || /^\/(?:api|v1)\//.test(p) || /^\/(?:wizard-os-home|wizard-ux)\/(?:api|store-install)\//.test(p);
  window.fetch = function(input, init) {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
    const url = new URL(request.url);
    if (url.origin !== ORIGIN || !ownerPath(url.pathname)) return nativeFetch(request);
    const headers = new Headers(request.headers);
    headers.set('X-Wizard-Shell-Token', secret);
    // A redirect is NOT another authorized destination, including same-origin
    // redirects into an app backend. Never carry the credential across one.
    return nativeFetch(new Request(request, { headers, redirect: 'error' }));
  };
  let serial = 0;
  const target = frame => sessions.get(frame);
  function connected(st) { return st && st.frame.isConnected && sessions.get(st.frame) === st; }
  function send(st, op, data = {}) {
    if (!connected(st)) return;
    // Opaque origins require '*'. Source identity + channel is the admission;
    // none of these messages contain an owner credential or ambient authority.
    st.frame.contentWindow?.postMessage({ type: 'wizard:boundary', version: 1, channel: st.channel, op, ...data }, '*');
  }
  function revoke(st) {
    if (!st) return;
    for (const [id, wait] of pending) if (wait.st === st) { clearTimeout(wait.timer); pending.delete(id); wait.resolve({ status: 'stale' }); }
    st.channel = crypto.randomUUID(); st.ready = false;
    st.frame.closest('.win')?.classList.remove('wz-themed');
  }
  function ask(st, op, data = {}) {
    if (!connected(st) || !st.ready) return Promise.resolve({ status: 'unavailable' });
    if (pending.size >= 32) return Promise.resolve({ status: 'busy' });
    const id = `wb-${++serial}`;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ status: 'timeout' }); }, 1200);
      pending.set(id, { st, resolve, timer }); send(st, op, { id, ...data });
    });
  }
  function attach(frame) {
    if (!frame?.matches?.('iframe[sandbox]') || frame.sandbox.contains('allow-same-origin')) return () => {};
    if (sessions.has(frame)) return () => {};
    const st = { frame, channel: crypto.randomUUID(), ready: false };
    sessions.set(frame, st);
    const hello = () => { revoke(st); send(st, 'hello'); };
    frame.addEventListener('load', hello); hello();
    return () => { frame.removeEventListener('load', hello); revoke(st); sessions.delete(frame); };
  }
  function frameVisible(frame) {
    return frame.isConnected && !frame.closest('[hidden], [inert]') && frame.getClientRects().length > 0;
  }
  addEventListener('message', e => {
    const d = e.data;
    if (e.origin !== 'null' || !d || d.type !== 'wizard:boundary' || d.version !== 1) return;
    const st = [...sessions.values()].find(s => s.frame.contentWindow === e.source);
    if (!connected(st) || d.channel !== st.channel) return;
    if (d.op === 'ready') { st.ready = true; if (st.appearance) send(st, 'theme', { appearance: st.appearance }); return; }
    if (d.op === 'theme.applied' && d.revision === st.appearance?.revision) { const el = st.frame.closest('.win'); if (el && !el.classList.contains('wz-themed')) el.classList.add('wz-themed'); return; }
    if (d.op === 'reply' && typeof d.id === 'string') {
      const wait = pending.get(d.id);
      if (!wait || wait.st !== st) return;
      clearTimeout(wait.timer); pending.delete(d.id);
      // Consume only protocol data, never execute app-supplied callbacks/URLs.
      const statuses = ['handled', 'atRoot', 'pinned', 'inserted', 'refused', 'stale'];
      wait.resolve({ status: statuses.includes(d.status) ? d.status : 'refused', seal: typeof d.seal === 'string' && d.seal.length <= 80 ? d.seal : null });
    }
  });
  const api = Object.freeze({
    enabled: true,
    frameAttributes: () => 'sandbox="allow-scripts allow-forms allow-downloads" referrerpolicy="no-referrer"',
    attach,
    // Shell-only admission for the two bounded app services. Origin:null is
    // never an identity; bind the registered element's WindowProxy + load seal.
    admits(frame, source, channel) {
      const st = target(frame);
      return !!(connected(st) && st.ready && frame.contentWindow === source && st.channel === channel);
    },
    async back(frame, atRoot) {
      const st = target(frame);
      if (!st || !frameVisible(frame)) return 'stay';
      if (st.backPending) return 'pending';
      st.backPending = true;
      const answer = await ask(st, 'back');
      st.backPending = false;
      if (!connected(st)) return 'stay';
      // A timeout must stay put: late success may already have stepped the app.
      if (answer.status === 'atRoot') atRoot?.();
      return answer.status === 'handled' ? 'handled' : 'stay';
    },
    theme(frame, value) { const st = target(frame); if (!st) return; st.appearance = value; if (st.ready) send(st, 'theme', { appearance: value }); },
    async pinField(frame) {
      const st = target(frame);
      if (document.activeElement !== frame || !frameVisible(frame)) return null;
      const channel = st?.channel;
      const result = await ask(st, 'field.pin');
      if (!connected(st) || st.channel !== channel || result.status !== 'pinned' || !result.seal) return null;
      let used = false;
      return Object.freeze({
        async insert(text) {
          if (used || !connected(st) || st.channel !== channel || typeof text !== 'string' || text.length > 100000) return false;
          used = true;
          return (await ask(st, 'field.insert', { seal: result.seal, text })).status === 'inserted';
        },
        release() { if (used) return; used = true; send(st, 'field.release', { seal: result.seal }); },
      });
    },
  });
  Object.defineProperty(window, 'WizBrowserBoundary', { value: api, writable: false, configurable: false });
})();
