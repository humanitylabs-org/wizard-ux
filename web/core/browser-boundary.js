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
    st.port?.postMessage({ type: 'wizard:boundary', version: 1, channel: st.channel, op, ...data });
  }
  function revoke(st) {
    if (!st) return;
    for (const [id, wait] of pending) if (wait.st === st) { clearTimeout(wait.timer); pending.delete(id); wait.resolve({ status: 'stale' }); }
    st.port?.close(); st.port = null;
    if (st.binding) window.fetch('/wizard/v1/browser-adapters/revoke', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:st.binding.handle})}).catch(() => {});
    st.binding = null; st.bindingPromise = null; st.seen = new Set(); st.inflight = 0;
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
  function attach(frame, { appId, authorize, service } = {}) {
    if (!frame?.matches?.('iframe[sandbox]') || frame.sandbox.contains('allow-same-origin')) return () => {};
    if (sessions.has(frame)) return () => {};
    const st = { frame, appId, authorize, service, channel: crypto.randomUUID(), ready: false };
    sessions.set(frame, st);
    const hello = () => {
      revoke(st);
      st.challenge = null;
      st.frame.contentWindow?.postMessage({ type:'wizard:boundary',version:1,channel:st.channel,op:'hello' }, '*');
    };
    frame.addEventListener('load', hello); hello();
    return () => { frame.removeEventListener('load', hello); revoke(st); sessions.delete(frame); };
  }
  function frameVisible(frame) {
    return frame.isConnected && !frame.closest('[hidden], [inert]') && frame.getClientRects().length > 0;
  }
  addEventListener('message', e => {
    const d=e.data;
    if (e.origin !== 'null' || !d || d.type !== 'wizard:boundary' || d.version !== 1 || d.op !== 'ready' || d.portRole !== 'document') return;
    const st=[...sessions.values()].find(s=>s.frame.contentWindow === e.source);
    if (!connected(st) || st.channel !== d.channel || st.port || e.ports?.length !== 1) { for (const p of e.ports || []) p.close(); return; }
    st.port=e.ports[0]; st.challenge=crypto.randomUUID(); const channel=st.channel;
    st.port.onmessage = event => { if (connected(st) && st.channel === channel) receive(st,event.data); }; st.port.start();
    send(st,'challenge',{nonce:st.challenge});
  });
  function receive(st, d) {
    if (!d || d.type !== 'wizard:boundary' || d.version !== 1) return;
    if (!connected(st) || d.channel !== st.channel) return;
    if (d.op === 'challenge.reply' && st.challenge && d.nonce === st.challenge) { st.challenge=null; st.ready=true; send(st,'connected'); if (st.appearance) send(st, 'theme', { appearance: st.appearance }); return; }
    if (!st.ready) return;
    if (d.op === 'theme.applied' && d.revision === st.appearance?.revision) { const el = st.frame.closest('.win'); if (el && !el.classList.contains('wz-themed')) el.classList.add('wz-themed'); return; }
    if (d.op === 'reply' && typeof d.id === 'string') {
      const wait = pending.get(d.id);
      if (!wait || wait.st !== st) return;
      clearTimeout(wait.timer); pending.delete(d.id);
      // Consume only protocol data, never execute app-supplied callbacks/URLs.
      const statuses = ['handled', 'atRoot', 'pinned', 'inserted', 'refused', 'stale'];
      wait.resolve({ status: statuses.includes(d.status) ? d.status : 'refused', seal: typeof d.seal === 'string' && d.seal.length <= 80 ? d.seal : null });
    }
    if (d.op === 'service.request') handleService(st,d);
  }
  const coded = code => Object.assign(new Error(code),{code});
  // Reviewed operation ids only; the Service re-checks every one against WAM install/grant state.
  const DATA_OPERATIONS = new Set(['fixture.notifications.list','notifications.list','notifications.mark_read','notifications.inbox','notifications.mark']);
  const WRITES = new Set(['notifications.mark_read','notifications.mark']);
  async function server(path, body) {
    const r = await window.fetch('/wizard/v1/browser-adapters/'+path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let value; try { value = await r.json(); } catch (_) { throw coded(r.ok ? 'backend_failed' : 'outcome_unknown'); }
    if (!r.ok) {
      // Keep only documented outcome fields; a write without a reply is never reported as saved.
      const e = coded(typeof value.error === 'string' ? value.error : 'backend_failed');
      if (value.outcome === 'unknown' || value.outcome === 'not_started_or_unknown') e.outcome = value.outcome;
      if (typeof value.operationKey === 'string') e.operationKey = value.operationKey;
      throw e;
    }
    return value;
  }
  async function handleService(st,d) {
    const channel = st.channel;
    const authorize = () => connected(st) && st.ready && st.channel === channel && st.authorize?.(channel) === true;
    const reply = (value,error) => { if (authorize()) send(st,'service.reply',{id:d.id,value,error}); };
    if (!authorize() || typeof d.id !== 'string' || !/^wbs-[1-9][0-9]{0,9}$/.test(d.id)) return;
    if (st.seen.has(d.id)) { reply(undefined,{code:'replay',message:'Request already used',retryable:false}); return; }
    if (st.seen.size >= 4096 || st.inflight >= 32) { reply(undefined,{code:'busy',message:'Reconnect app',retryable:true}); return; }
    st.seen.add(d.id); st.inflight++;
    try {
      if (Object.keys(d).sort().join(',') !== 'args,channel,id,method,op,type,version') throw coded('bad_request');
      if (['state.remove','state.list','state.clear'].includes(d.method) || (d.method.startsWith('state.') && d.args?.area !== undefined && d.args.area !== 'persistent')) throw coded('unsupported_capability');
      if (['data.call','data.status','state.read','state.write','state.transaction'].includes(d.method)) {
        if (new TextEncoder().encode(JSON.stringify(d)).byteLength > 65536) throw coded('too_large');
        st.bindingPromise ||= server('bindings',{appId:st.appId,generation:channel}).then(b => {
          if (!authorize()) { server('revoke',{handle:b.handle}).catch(() => {}); throw coded('denied'); }
          st.binding=b; return b;
        }).catch(e => { if (st.channel === channel) st.bindingPromise=null; throw e; });
        const binding = await st.bindingPromise;
        if (!authorize()) throw coded('denied');
        let operation = 'state.local', args = {}, extra = {};
        if (d.method === 'data.call') {
          const keys = d.args && typeof d.args === 'object' ? Object.keys(d.args).sort().join(',') : '';
          if (keys !== 'args,operation' && keys !== 'args,operation,operationKey') throw coded('bad_request');
          operation=d.args.operation; args=d.args.args;
          if (!DATA_OPERATIONS.has(operation)) throw coded('not_allowed');
          if (WRITES.has(operation) !== (keys === 'args,operation,operationKey')) throw coded('bad_request');
          if (WRITES.has(operation)) extra = {operationKey:d.args.operationKey};
        } else if (d.method === 'data.status') {
          if (!d.args || Object.keys(d.args).sort().join(',') !== 'operation,operationKey' || !WRITES.has(d.args.operation)) throw coded('bad_request');
          operation='data.status'; args={operation:d.args.operation,operationKey:d.args.operationKey};
        }
        const value = await server('call',{handle:binding.handle,generation:channel,requestId:d.id,operation,args,...extra});
        if (!authorize()) throw coded('denied');
        // Shell-internal signal after a proven write (e.g. the Notifications badge re-reads its own count).
        // It carries the registered app id, never app-supplied data; frames cannot dispatch shell events.
        if (d.method === 'data.call' && WRITES.has(operation)) { try { dispatchEvent(new CustomEvent('wizard:browser-data-written', { detail: Object.freeze({ appId: st.appId, operation }) })); } catch (_) {} }
        if (d.method === 'data.call' || d.method === 'data.status') reply(value);
        else reply(await window.WizAppState.call({appId:st.appId,sourceId:value.principal?.sourceId,namespace:value.namespace,quota:value.quota,authorize},d.method,d.args));
      } else if (['ready','share.wizard','voice.transcribe','nav.contextDraft'].includes(d.method)) {
        await st.service?.(d,reply,authorize);
      } else throw coded('not_allowed');
    } catch(e) { const code=e.code || 'backend_failed'; reply(undefined,{code,message:code,retryable:['backend_unavailable','storage_unavailable','busy','timeout'].includes(code),...(e.outcome ? {outcome:e.outcome} : {}),...(e.operationKey ? {operationKey:e.operationKey} : {})}); }
    finally { if (st.channel === channel) st.inflight--; }
  }
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
