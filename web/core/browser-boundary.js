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
  // The Troubleshooter's own recovery gate (optional; same navigation-only bootstrap). A DISTINCT secret: the host
  // recovery listener checks it itself, so it keeps working with the Agent Service down, and it never sees the shell
  // token. Sent only to /troubleshoot/api/ on this origin.
  const recoveryNode = document.querySelector('meta[name="wizard-recovery-token"]');
  const recoverySecret = recoveryNode && /^[a-f0-9]{64}$/.test(recoveryNode.content) && recoveryNode.content !== secret ? recoveryNode.content : '';
  recoveryNode?.remove();
  const ORIGIN = location.origin, sessions = new Map(), pending = new Map();
  const nativeFetch = window.fetch.bind(window);
  const ownerPath = p => (/^\/wizard\//.test(p) && !/^\/wizard\/mcp(?:\/|$)/.test(p)) || /^\/(?:api|v1)\//.test(p) || /^\/(?:wizard-os-home|wizard-ux)\/(?:api|store-install)\//.test(p);
  window.fetch = function(input, init) {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
    const url = new URL(request.url);
    if (url.origin === ORIGIN && /^\/troubleshoot\/api\/(?!ping$)/.test(url.pathname)) {
      if (!recoverySecret) return nativeFetch(request);
      const headers = new Headers(request.headers);
      headers.set('X-Wizard-Recovery-Token', recoverySecret);
      return nativeFetch(new Request(request, { headers, redirect: 'error' }));
    }
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
    try { st.intent?.cancel(); } catch (_) {}
    if (st.binding) window.fetch('/wizard/v1/browser-adapters/revoke', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:st.binding.handle})}).catch(() => {});
    st.binding = null; st.bindingPromise = null; st.seen = new Set(); st.inflight = 0; st.uploads = new Map();
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
  function attach(frame, { appId, authorize, service, recovery, store } = {}) {
    if (!frame?.matches?.('iframe[sandbox]') || frame.sandbox.contains('allow-same-origin')) return () => {};
    if (sessions.has(frame)) return () => {};
    const st = { frame, appId, authorize, service, recovery: recovery?.builtIn === true ? Object.freeze({ builtIn: true, openApp: recovery.openApp }) : null,
      store: store?.builtIn === true ? Object.freeze({ builtIn: true }) : null, channel: crypto.randomUUID(), ready: false };
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
  const DATA_OPERATIONS = new Set(['fixture.notifications.list','notifications.list','notifications.mark_read','notifications.inbox','notifications.mark',
    'ai_accounts.inventory','ai_accounts.progress','ai_accounts.step','claude_code.status','claude_code.code','claude_code.cancel','claude_code.test',
    'files.list','files.index','files.thumbnail']);
  const WRITES = new Set(['notifications.mark_read','notifications.mark','ai_accounts.step','claude_code.code','claude_code.cancel','claude_code.test']);
  // Owner-consent operations (shell intents): never a data.call; only through the shell's own review dialog.
  const CONSENT_OPERATIONS = new Set(['ai_accounts.change','claude_code.connect','claude_code.logout']);
  // Scoped media tickets (ADAPTER-SKETCH §6): one reviewed operation per app; the Service re-checks the grant.
  const MEDIA_OPERATIONS = Object.freeze({ notifications: 'notifications.media', 'wizard-files': 'files.content' });
  // Per media operation: the purposes a frame may ask for, and the content types a ticket may carry back.
  const MEDIA_PURPOSES = Object.freeze({ 'notifications.media': ['thumbnail', 'read'], 'files.content': ['read', 'play'] });
  const MEDIA_MIME = Object.freeze({ 'notifications.media': /^image\/(png|jpeg|gif|webp)$/,
    'files.content': /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime|x-m4v)|audio\/(mpeg|mp4|x-m4a|wav|ogg|opus|flac|aac)|text\/plain|application\/pdf|application\/octet-stream)$/ });
  // Upload port + trusted downloads (ADAPTER-SKETCH §6): the operation family per app; the ticket stays in the shell.
  const TRANSFER_APPS = Object.freeze({ 'wizard-files': 'files' });
  const TRANSFER_METHODS = new Set(['upload.create', 'upload.chunk', 'upload.status', 'upload.commit', 'upload.abort', 'download.request']);
  const UPLOAD_CHUNK = 1048576;
  // Only a ticket on the dedicated content origin goes back to a frame: never the owner origin, a path or a redirect.
  function ticketOf(v, operation = 'notifications.media') {
    if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'bytes,expiresAt,kind,methods,mime,range,url' || v.kind !== 'ticket') throw coded('backend_failed');
    let u; try { u = new URL(v.url); } catch (_) { throw coded('backend_failed'); }
    if (!/^https?:$/.test(u.protocol) || u.origin === ORIGIN || u.username || u.password || u.search || u.hash || !/^\/t\/[A-Za-z0-9_-]{43}$/.test(u.pathname)) throw coded('backend_failed');
    if (!MEDIA_MIME[operation]?.test(v.mime) || !Number.isSafeInteger(v.bytes) || v.bytes < 0 || typeof v.expiresAt !== 'string' || !(Date.parse(v.expiresAt) > 0)) throw coded('backend_failed');
    return Object.freeze({ kind: 'ticket', url: u.href, expiresAt: v.expiresAt, mime: v.mime, bytes: v.bytes, methods: ['GET', 'HEAD'], range: v.range === true });
  }
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
  function bindingOf(st, channel, authorize) {
    st.bindingPromise ||= server('bindings',{appId:st.appId,generation:channel}).then(b => {
      if (!authorize()) { server('revoke',{handle:b.handle}).catch(() => {}); throw coded('denied'); }
      st.binding=b; return b;
    }).catch(e => { if (st.channel === channel) st.bindingPromise=null; throw e; });
    return st.bindingPromise;
  }
  /* ---- Shell intents (wizard-os spec/browser-trust-shell-intents) ----
   * An app QUEUES an owner confirmation (intent.confirm) or a provider sign-in page (intent.open); it never opens a
   * dialog or a tab itself. The Service checks the operation/target against WAM state and returns only a summary.
   * The shell then shows a Review chip in that app's own window bar; the owner opens the review there. The dialog
   * is shell DOM: its action button wakes 500 ms after it is shown, then needs a fresh trusted activation INSIDE it
   * (pointer down and up on the button after the delay, or a keyboard/assistive click). The Service consumes the
   * intent once, bound to the exact arguments, document and permission revision. An app's `confirmed:true`, a
   * synthetic event or an app-side click is never consent. At most 3 reviews a minute per app (the Service enforces
   * the same per installation). Navigation opens only the URL the Service matched to the installed contract. */
  const INTENT_DELAY_MS = 500, INTENT_PER_MINUTE = 3, intentLog = new Map();
  const INTENT_CSS = `
.wz-intent-chip{position:fixed;z-index:240;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--line-2,rgba(205,190,255,.3));
 background:color-mix(in srgb,var(--violet-2,#b99bff) 22%,transparent);color:var(--ink,#f3efff);font:600 12px/1 var(--font-ui,system-ui);cursor:pointer;white-space:nowrap}
.wz-intent-chip::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--violet-2,#b99bff);box-shadow:0 0 0 3px color-mix(in srgb,var(--violet-2,#b99bff) 30%,transparent)}
.wz-intent-chip.wz-intent-float{left:50%;bottom:calc(16px + var(--safe-b,0px));translate:-50% 0;height:36px;padding:0 16px;font-size:14px}
dialog.wz-intent{width:min(420px,calc(100vw - 32px));padding:18px 18px 14px;border-radius:18px;border:1px solid var(--line-2,rgba(205,190,255,.24));
 background:color-mix(in srgb,var(--bg,#05030c) 94%,var(--ink,#f3efff) 6%);color:var(--ink,#f3efff);font:400 14px/1.4 var(--font-ui,system-ui);box-shadow:0 18px 60px rgba(0,0,0,.45)}
dialog.wz-intent::backdrop{background:rgba(3,1,10,.55)}
.wz-intent .wzi-from{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:650;color:var(--ink-3,#7d74a3);letter-spacing:.01em}
.wz-intent .wzi-from b{color:var(--ink-2,#b9b0d8)}
.wz-intent h2{margin:10px 0 6px;font-size:17px;font-weight:750;line-height:1.25}
.wz-intent p{margin:0 0 6px;color:var(--ink-2,#b9b0d8)}
.wz-intent .wzi-host{display:block;margin:8px 0 2px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--ink,#f3efff) 7%,transparent);font:600 13px/1.3 ui-monospace,monospace;color:var(--ink,#f3efff);overflow-wrap:anywhere}
.wz-intent .wzi-note{font-size:12px;color:var(--ink-3,#7d74a3)}
.wz-intent .wzi-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.wz-intent button{min-height:40px;padding:0 16px;border-radius:12px;border:1px solid var(--line-2,rgba(205,190,255,.24));background:transparent;color:inherit;font:650 14px/1 var(--font-ui,system-ui);cursor:pointer}
.wz-intent .wzi-go{position:relative;overflow:hidden;background:var(--violet-2,#b99bff);border-color:transparent;color:var(--bg,#05030c)}
.wz-intent .wzi-go.danger{background:#e5484d;color:#fff}
.wz-intent .wzi-go[aria-disabled=true]{opacity:.55;cursor:default}
.wz-intent .wzi-go[aria-disabled=true]::after{content:'';position:absolute;left:0;bottom:0;height:3px;width:100%;background:currentColor;opacity:.5;transform-origin:left;animation:wzi-wake ${INTENT_DELAY_MS}ms linear forwards}
@keyframes wzi-wake{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.wz-intent .wzi-go.pressed{filter:brightness(.9)}
.wz-intent .wzi-fallback{display:none;margin-top:10px;font-weight:650;color:var(--violet-2,#b99bff)}
.wz-intent .wzi-status{min-height:1.2em;margin-top:6px;font-size:12px;color:var(--ink-3,#7d74a3)}`;
  function intentStyles() {
    if (document.getElementById('wz-intent-css')) return;
    const style = document.createElement('style'); style.id = 'wz-intent-css'; style.textContent = INTENT_CSS; document.head.append(style);
  }
  const appName = st => { const t = st.frame.closest('.win')?.querySelector(':scope > .wbar :is(.wt,.t)')?.textContent?.trim(); return (t && t.length <= 60 ? t : '') || st.appId; };
  // The chip sits on the app's own window bar (shell chrome the frame cannot draw over). It is shell DOM in the main
  // document, kept aligned with that bar while it waits; without a visible bar it floats at the bottom of the screen.
  function intentChip(st, label, open) {
    intentStyles();
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'wz-intent-chip';
    chip.textContent = label; chip.title = label; chip.setAttribute('data-wz-intent', st.appId);
    // Only a trusted activation of the SHELL's chip opens the review; the app cannot press it (it is outside its frame).
    chip.addEventListener('click', e => { if (e.isTrusted) open(); });
    document.body.append(chip);
    const place = () => {
      if (!chip.isConnected) return;
      const bar = st.frame.closest('.win')?.querySelector(':scope > .wbar'), r = bar?.getBoundingClientRect();
      if (r && r.width > 120 && r.height > 0) {
        chip.classList.remove('wz-intent-float');
        chip.style.top = Math.round(r.top + (r.height - chip.offsetHeight) / 2) + 'px';
        chip.style.left = Math.round(Math.max(r.left + 8, r.right - chip.offsetWidth - 56)) + 'px';
      } else { chip.classList.add('wz-intent-float'); chip.style.top = chip.style.left = ''; }
      requestAnimationFrame(place);
    };
    place();
    return chip;
  }
  function intentDialog(st, summary, kind) {
    intentStyles();
    const dlg = document.createElement('dialog');
    dlg.className = 'wz-intent'; dlg.setAttribute('aria-labelledby', 'wzi-t');
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const from = el('div', 'wzi-from'); from.append(el('span', null, 'Wizard · request from '), el('b', null, appName(st)));
    const title = el('h2', null, String(summary?.title || 'Confirm').slice(0, 120)); title.id = 'wzi-t';
    const detail = el('p', null, String(summary?.detail || '').slice(0, 300));
    dlg.append(from, title, detail);
    if (kind === 'navigate' && summary?.host) dlg.append(el('span', 'wzi-host', 'https://' + String(summary.host).slice(0, 120) + String(summary.path || '').slice(0, 120)));
    dlg.append(el('p', 'wzi-note', kind === 'navigate' ? 'Wizard checked this page against what the app is allowed to open.' : 'Wizard shows this, not the app. Nothing happens until you confirm.'));
    const status = el('div', 'wzi-status'); status.setAttribute('role', 'status');
    const fallback = el('a', 'wzi-fallback', 'Open the sign-in page'); fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
    const acts = el('div', 'wzi-acts'), cancel = el('button', 'wzi-no', 'Cancel'), go = el('button', 'wzi-go' + (summary?.danger ? ' danger' : ''), String(summary?.action || 'Confirm').slice(0, 24));
    cancel.type = go.type = 'button';
    acts.append(cancel, go); dlg.append(status, fallback, acts);
    document.body.append(dlg);
    return { dlg, go, cancel, status, fallback };
  }
  function intentBudget(appId) {
    const t = Date.now(), log = (intentLog.get(appId) || []).filter(x => x > t - 60_000);
    if (log.length >= INTENT_PER_MINUTE) throw coded('rate_limited');
    log.push(t); intentLog.set(appId, log);
  }
  async function intentRequest(st, d, channel, authorize) {
    const a = d.args;
    let body;
    if (d.method === 'intent.confirm') {
      if (!a || typeof a !== 'object' || Object.keys(a).sort().join(',') !== 'args,operation,operationKey' || !CONSENT_OPERATIONS.has(a.operation) || typeof a.operationKey !== 'string') throw coded('bad_request');
      body = { kind: 'confirm', operation: a.operation, args: a.args, operationKey: a.operationKey };
    } else {
      if (!a || typeof a !== 'object' || Object.keys(a).sort().join(',') !== 'ref,target' || typeof a.target !== 'string' || typeof a.ref !== 'string' || a.ref.length > 80) throw coded('bad_request');
      body = { kind: 'navigate', target: a.target, ref: a.ref };
    }
    if (new TextEncoder().encode(JSON.stringify(d)).byteLength > 65536) throw coded('too_large');
    if (st.intent) throw coded('busy');
    intentBudget(st.appId);
    const binding = await bindingOf(st, channel, authorize);
    if (!authorize()) throw coded('denied');
    const queued = await server('intents', { handle: binding.handle, generation: channel, requestId: d.id, ...body });
    if (!authorize()) { server('intents/cancel', { handle: binding.handle, intent: queued.intent }).catch(() => {}); throw coded('denied'); }
    return new Promise((resolve, reject) => {
      let ui = null, chip = null, done = false, wake = 0, armed = false, popup = null;
      const kind = body.kind;
      const finish = (value, error) => {
        if (done) return; done = true;
        clearTimeout(timer); clearInterval(watch);
        chip?.remove(); if (ui) { try { ui.dlg.close(); } catch (_) {} ui.dlg.remove(); }
        if (st.intent === state) st.intent = null;
        if (error) { if (!error.accepted) server('intents/cancel', { handle: binding.handle, intent: queued.intent }).catch(() => {}); reject(error); }
        else resolve(value);
      };
      const state = { cancel: () => finish(null, coded('cancelled')) };
      st.intent = state;
      const timer = setTimeout(() => finish(null, coded('expired')), Math.max(1000, Date.parse(queued.expiresAt) - Date.now()));
      // A new document, detach or lost authority ends the review: nothing is confirmed on behalf of a replaced view.
      const watch = setInterval(() => { if (!authorize()) finish(null, coded('denied')); }, 400);
      const activate = async () => {
        if (done || !authorize() || performance.now() < wake) return;
        ui.go.setAttribute('aria-disabled', 'true'); ui.cancel.disabled = true; ui.status.textContent = kind === 'navigate' ? 'Opening…' : 'Working…';
        // Navigation: open the tab inside this trusted activation, then point it at the checked page.
        if (kind === 'navigate') { try { popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null; } catch (_) { popup = null; } }
        try {
          const out = await server('intents/confirm', { handle: binding.handle, generation: channel, intent: queued.intent });
          if (!authorize()) { try { popup?.close(); } catch (_) {} return finish(null, coded('denied')); }
          if (kind === 'navigate') {
            const u = new URL(out.url);
            if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.hostname !== queued.summary?.host || u.pathname !== queued.summary?.path) { try { popup?.close(); } catch (_) {} throw coded('backend_failed'); }
            if (popup) {
              const doc = popup.document, meta = doc.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; doc.head.append(meta);
              const link = doc.createElement('a'); link.href = u.href; link.rel = 'noreferrer noopener'; doc.body.append(link); link.click();
              return finish({ opened: true });
            }
            // The browser blocked the tab: the owner's own tap on this shell link opens it (still never the app).
            ui.fallback.href = u.href; ui.fallback.style.display = 'block'; ui.status.textContent = 'Your browser kept the tab closed. Tap the link to open it.';
            ui.go.hidden = true; ui.cancel.disabled = false; ui.cancel.textContent = 'Done';
            ui.fallback.addEventListener('click', e => { if (e.isTrusted) setTimeout(() => finish({ opened: true }), 0); }, { once: true });
            ui.cancel.onclick = () => finish({ opened: false });
            return;
          }
          finish(out.value);
        } catch (e) { try { popup?.close(); } catch (_) {} finish(null, Object.assign(coded(e.code || 'backend_failed'), e.outcome ? { outcome: e.outcome } : {}, e.operationKey ? { operationKey: e.operationKey } : {}, { code: e.code || 'backend_failed', accepted: true })); }
      };
      const openReview = () => {
        if (done || ui || !authorize()) return;
        chip?.remove(); chip = null;
        ui = intentDialog(st, queued.summary, kind);
        ui.dlg.addEventListener('cancel', e => { e.preventDefault(); finish(null, coded('cancelled')); });
        ui.cancel.addEventListener('click', e => { if (e.isTrusted && ui.cancel.textContent === 'Cancel') finish(null, coded('cancelled')); });
        ui.go.setAttribute('aria-disabled', 'true');
        // Pointer: both down and up on the action button, after the delay. Feedback paints at once.
        ui.go.addEventListener('pointerdown', e => { armed = e.isTrusted && e.isPrimary && performance.now() >= wake; ui.go.classList.add('pressed'); });
        ui.go.addEventListener('pointerleave', () => { armed = false; ui.go.classList.remove('pressed'); });
        ui.go.addEventListener('pointerup', e => { ui.go.classList.remove('pressed'); const ok = armed && e.isTrusted && ui.go.contains(e.target) && performance.now() >= wake; armed = false; if (ok) activate(); });
        // Keyboard / assistive activation: a trusted click with no pointer press (detail 0) inside the dialog.
        ui.go.addEventListener('click', e => { if (e.isTrusted && e.detail === 0 && ui.dlg.contains(document.activeElement)) activate(); });
        ui.dlg.showModal();
        ui.cancel.focus();
        wake = performance.now() + INTENT_DELAY_MS;
        setTimeout(() => { if (!done && ui) ui.go.removeAttribute('aria-disabled'); }, INTENT_DELAY_MS);
      };
      chip = intentChip(st, kind === 'navigate' ? `Review: ${appName(st)} sign-in page` : `Review: ${String(queued.summary?.title || 'Confirm').slice(0, 48)}`, openReview);
    }).catch(e => { if (e.accepted) { delete e.accepted; } throw e; });
  }
  /* ---- App Store panel (wizard-os 389 O1; spec REVIEW-BRIEF: Store is a shell-controlled panel) ----
   * The built-in App Store renders the public index (untrusted text) in an opaque window, so its own reads of the
   * owner's /wizard-os-home/store-data/ and store-install/ are refused from Origin:null, correctly: those owner APIs
   * get no CORS. Instead the shell itself answers a fixed set of typed Store operations for ONLY that registered
   * built-in window (app-services; an installed app can never take its id or path). Each operation maps to ONE fixed
   * path with exact, validated arguments; the frame never names a URL, method or header. Reads are answered as they
   * are. Owner changes (install/update/switch, remove, a model approval) first need the owner's own confirmation in
   * shell UI (Review chip + dialog, same trusted-activation rules and rate as shell intents): a script in the
   * Store's frame can ask, never decide. No installed-app grant is involved: this is shell power, not an app's. */
  const STORE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/, STORE_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/, STORE_SHA = /^[a-f0-9]{40}$/;
  const STORE_FEATURE = /^[a-z0-9][a-z0-9_-]{0,63}$/, STORE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;
  const STORE_READ_LIMIT = 4194304;
  const STORE_OPS = {
    catalog: a => exactKeys(a, ['offset', 'refresh']) && Number.isSafeInteger(a.offset) && a.offset >= 0 && a.offset <= 100000 && typeof a.refresh === 'boolean'
      && { path: `store-data/wizard/v1/index/search?limit=100&offset=${a.offset}${a.refresh ? '&refresh=1' : ''}` },
    'installed.runtipi': a => exactKeys(a, []) && { path: 'store-data/api/apps/installed' },
    'installed.wizard': a => exactKeys(a, []) && { path: 'store-data/wizard/v1/installed-apps' },
    link: a => exactKeys(a, ['repo', 'commit']) && STORE_REPO.test(a.repo) && (a.commit === null || STORE_SHA.test(a.commit))
      && { path: 'store-data/wizard/v1/link?' + new URLSearchParams({ repo: a.repo, ...(a.commit ? { commit: a.commit } : {}) }) },
    'router.needs': a => exactKeys(a, ['app']) && STORE_ID.test(a.app) && { path: 'store-data/router/v1/needs/' + a.app },
    'install.status': a => exactKeys(a, ['id']) && STORE_ID.test(a.id) && { path: 'store-install/' + a.id },
    'remove.plan': a => exactKeys(a, ['id']) && STORE_ID.test(a.id) && { path: `store-install/_remove/${a.id}/plan` },
    'remove.status': a => exactKeys(a, ['id']) && STORE_ID.test(a.id) && { path: 'store-install/_remove/' + a.id },
    'app.agents': a => exactKeys(a, ['id']) && STORE_ID.test(a.id) && { abs: `/wizard/v1/apps/${a.id}/agents` },
    install: a => exactKeys(a, ['id', 'source', 'repo', 'commit', 'operation']) && STORE_ID.test(a.id) && STORE_ID.test(a.source) && STORE_REPO.test(a.repo)
      && STORE_SHA.test(a.commit) && ['install', 'update', 'switch'].includes(a.operation)
      && { path: 'store-install/' + a.id, body: { source: a.source, repo: a.repo, commit: a.commit, operation: a.operation },
        confirm: { title: `${{ install: 'Install', update: 'Update', switch: 'Switch' }[a.operation]} ${a.id}?`,
          detail: `From github.com/${a.repo} at ${a.commit.slice(0, 12)} (${a.source}).`, action: { install: 'Install', update: 'Update', switch: 'Switch' }[a.operation] } },
    remove: a => exactKeys(a, ['id', 'repo', 'commit', 'dependents', 'empties']) && STORE_ID.test(a.id) && STORE_REPO.test(a.repo) && STORE_SHA.test(a.commit)
      && Array.isArray(a.dependents) && a.dependents.length <= 64 && a.dependents.every(x => STORE_ID.test(x))
      && Array.isArray(a.empties) && a.empties.length <= 64 && a.empties.every(x => typeof x === 'string' && STORE_ID.test(x))
      && { path: 'store-install/_remove/' + a.id, body: { repo: a.repo, commit: a.commit, dependents: a.dependents, empties: a.empties },
        confirm: { title: `Remove ${a.id}?`, detail: `Removes the app and its data from this Wizard${a.dependents.length ? `, and ${a.dependents.length} app${a.dependents.length === 1 ? '' : 's'} that need it` : ''}.`, action: 'Remove', danger: true } },
    'router.approve': a => exactKeys(a, ['app', 'feature', 'provider', 'model']) && STORE_ID.test(a.app) && STORE_FEATURE.test(a.feature) && STORE_ID.test(a.provider) && STORE_MODEL.test(a.model)
      && { path: 'store-data/router/v1/approve', body: { app: a.app, feature: a.feature, provider: a.provider, model: a.model },
        confirm: { title: `Let ${a.app} use ${a.model}?`, detail: `For "${a.feature}", through ${a.provider}.`, action: 'Allow' } },
  };
  // The owner's confirmation in shell DOM (same chip, dialog, wake delay, trusted activation and 3-a-minute budget as
  // shell intents). Resolves true only on the owner's own activation of the dialog's action button.
  function shellConfirm(st, summary, authorize) {
    intentBudget(st.appId);
    if (st.intent) throw coded('busy');
    return new Promise((resolve, reject) => {
      let ui = null, chip = null, done = false, wake = 0, armed = false;
      const finish = (ok, error) => {
        if (done) return; done = true; clearInterval(watch); clearTimeout(timer);
        chip?.remove(); if (ui) { try { ui.dlg.close(); } catch (_) {} ui.dlg.remove(); }
        if (st.intent === state) st.intent = null;
        if (error) reject(error); else resolve(ok);
      };
      const state = { cancel: () => finish(false, coded('cancelled')) };
      st.intent = state;
      const timer = setTimeout(() => finish(false, coded('expired')), 120000);
      const watch = setInterval(() => { if (!authorize()) finish(false, coded('denied')); }, 400);
      const activate = () => { if (!done && authorize() && performance.now() >= wake) finish(true); };
      const openReview = () => {
        if (done || ui || !authorize()) return;
        chip?.remove(); chip = null;
        ui = intentDialog(st, summary, 'confirm');
        ui.dlg.addEventListener('cancel', e => { e.preventDefault(); finish(false, coded('cancelled')); });
        ui.cancel.addEventListener('click', e => { if (e.isTrusted) finish(false, coded('cancelled')); });
        ui.go.setAttribute('aria-disabled', 'true');
        ui.go.addEventListener('pointerdown', e => { armed = e.isTrusted && e.isPrimary && performance.now() >= wake; ui.go.classList.add('pressed'); });
        ui.go.addEventListener('pointerleave', () => { armed = false; ui.go.classList.remove('pressed'); });
        ui.go.addEventListener('pointerup', e => { ui.go.classList.remove('pressed'); const ok = armed && e.isTrusted && ui.go.contains(e.target) && performance.now() >= wake; armed = false; if (ok) activate(); });
        ui.go.addEventListener('click', e => { if (e.isTrusted && e.detail === 0 && ui.dlg.contains(document.activeElement)) activate(); });
        ui.dlg.showModal(); ui.cancel.focus();
        wake = performance.now() + INTENT_DELAY_MS;
        setTimeout(() => { if (!done && ui) ui.go.removeAttribute('aria-disabled'); }, INTENT_DELAY_MS);
      };
      chip = intentChip(st, `Review: ${String(summary.title).slice(0, 48)}`, openReview);
    });
  }
  async function storeCall(st, args, authorize) {
    if (!exactKeys(args, ['op', 'args']) || typeof args.op !== 'string') throw coded('bad_request');
    if (!Object.hasOwn(STORE_OPS, args.op)) throw coded('not_allowed');
    const spec = STORE_OPS[args.op](args.args);
    if (!spec) throw coded('bad_request');
    if (spec.confirm && !(await shellConfirm(st, spec.confirm, authorize))) throw coded('cancelled');
    if (!authorize()) throw coded('denied');
    const url = spec.abs || '/wizard-os-home/' + spec.path;
    let r;
    try {
      r = await window.fetch(url, spec.body ? { method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify(spec.body) } : { cache: 'no-store', credentials: 'same-origin' });
    } catch (_) { throw coded('backend_unavailable'); }
    const text = await r.text().catch(() => '');
    if (text.length > STORE_READ_LIMIT) throw coded('too_large');
    let value = null; try { value = text ? JSON.parse(text) : null; } catch (_) { value = null; }
    // The Store keeps its own handling of each endpoint's statuses (e.g. 404 = "App Manager needs updating").
    return { status: r.status, value };
  }
  /* ---- Troubleshooter recovery view (wizard-os #385 census row "troubleshooter"; default-off) ----
   * Only the shell's built-in Troubleshooter window (registered by app-services with `recovery`) gets these typed
   * operations: each maps to ONE fixed path on the host recovery listener (/troubleshoot/api/), called by the shell
   * with the recovery token (fetch wrapper above). No Agent Service in the path except `provider_run`, which reads a
   * Service fact and degrades to "not yet" when the Service is down. Not a relay: fixed paths, exact arguments,
   * bounded replies; the frame never names a URL, method or header. */
  const RECOVERY_ENGINES = ['claude', 'chatgpt', 'tinfoil'];
  const RECOVERY_APPS = ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil', 'app-store'];
  const RECOVERY_CACHE = 'wos.recovery.troubleshooter.engines';
  const exactKeys = (a, keys) => !!a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).sort().join(',') === [...keys].sort().join(',');
  const hex = (v, n) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
  const RECOVERY_OPS = {
    status: a => exactKeys(a, ['fresh', 'accounts']) && typeof a.fresh === 'boolean' && typeof a.accounts === 'boolean'
      && { path: 'status' + (a.fresh || a.accounts ? '?' + new URLSearchParams({ ...(a.fresh ? { fresh: '1' } : {}), ...(a.accounts ? { accounts: '1' } : {}) }) : '') },
    engines: a => exactKeys(a, []) && { path: 'engines' },
    'engine.set': a => exactKeys(a, ['engine']) && RECOVERY_ENGINES.includes(a.engine) && { path: 'engine', body: { engine: a.engine } },
    incidents: a => exactKeys(a, []) && { path: 'incidents' },
    repairs: a => exactKeys(a, ['limit']) && Number.isInteger(a.limit) && a.limit >= 1 && a.limit <= 50 && { path: 'repairs?limit=' + a.limit },
    'repair.read': a => exactKeys(a, ['id', 'since']) && hex(a.id, 16) && Number.isSafeInteger(a.since) && a.since >= 0 && { path: `repair/${a.id}?since=${a.since}` },
    'repair.start': a => exactKeys(a, ['id', 'message', 'engine']) && (a.id === null || hex(a.id, 16)) && typeof a.message === 'string' && a.message.trim() && a.message.length <= 16000
      && ['auto', ...RECOVERY_ENGINES].includes(a.engine) && { path: 'repair', body: { id: a.id, message: a.message, engine: a.engine } },
    'repair.stop': a => exactKeys(a, []) && { path: 'repair/stop', body: {} },
    'repair.approve': a => exactKeys(a, ['id', 'approvalId', 'approved']) && (a.id === null || hex(a.id, 16)) && hex(a.approvalId, 32) && typeof a.approved === 'boolean'
      && { path: 'repair/approve', body: { id: a.id, approvalId: a.approvalId, approved: a.approved } },
    action: a => exactKeys(a, ['action']) && typeof a.action === 'string' && /^[a-z]{1,20}:[a-z-]{1,40}$/.test(a.action) && { path: 'action', body: { action: a.action } },
  };
  async function recoveryCall(st, args) {
    if (!exactKeys(args, ['op', 'args']) || typeof args.op !== 'string') throw coded('bad_request');
    const a = args.args;
    if (args.op === 'provider_run') {
      // The diagnosed sign-in screen: "was the waiting message sent?" One boolean from the Agent Service.
      if (!exactKeys(a, ['runId']) || typeof a.runId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(a.runId)) throw coded('bad_request');
      try { const r = await window.fetch('/wizard/v1/provider-recovery?run_id=' + encodeURIComponent(a.runId), { cache: 'no-store' }); return { sent: r.ok && (await r.json())?.sent === true }; }
      catch (_) { return { sent: false }; }
    }
    if (args.op === 'cache.read') {
      if (!exactKeys(a, [])) throw coded('bad_request');
      try { const v = JSON.parse(localStorage.getItem(RECOVERY_CACHE) || 'null'); return v && typeof v === 'object' ? v : null; } catch (_) { return null; }
    }
    if (args.op === 'cache.write') {
      // Last known picker only (painted before the first answer). Plain display data, shape-checked, 8 KiB.
      const v = a?.value, cell = x => x === undefined || x === null || typeof x === 'boolean' || (typeof x === 'string' && x.length <= 200);
      if (!exactKeys(a, ['value']) || !exactKeys(v, ['engines', 'selected']) || !Array.isArray(v.engines) || v.engines.length > 6 || !(v.selected === null || RECOVERY_ENGINES.includes(v.selected))
        || !v.engines.every(e => e && typeof e === 'object' && !Array.isArray(e) && Object.keys(e).length <= 16 && Object.values(e).every(cell))) throw coded('bad_request');
      const text = JSON.stringify(v);
      if (text.length > 8192) throw coded('too_large');
      try { localStorage.setItem(RECOVERY_CACHE, text); } catch (_) { throw coded('storage_unavailable'); }
      return { saved: true };
    }
    if (args.op === 'open_app') {
      // Source-bound navigation: only from this registered window, only while the owner is in it, only a connection
      // app the shell itself knows, opened as a Wizard window (never a URL from the frame).
      if (!exactKeys(a, ['appId']) || !RECOVERY_APPS.includes(a.appId)) throw coded('bad_request');
      if (document.activeElement !== st.frame || document.hidden) throw coded('denied');
      return { opened: !!st.recovery.openApp?.(a.appId) };
    }
    if (!Object.hasOwn(RECOVERY_OPS, args.op)) throw coded('not_allowed');
    const spec = RECOVERY_OPS[args.op](a);
    if (!spec) throw coded('bad_request');
    let r;
    try {
      r = await window.fetch('/troubleshoot/api/' + spec.path, spec.body ? { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Wizard-Troubleshoot': '1' }, body: JSON.stringify(spec.body) } : { cache: 'no-store' });
    } catch (_) { throw coded('backend_unavailable'); }
    const text = await r.text().catch(() => '');
    if (text.length > 1048576) throw coded('backend_failed');
    let value = null; try { value = JSON.parse(text); } catch (_) { throw coded(r.ok ? 'backend_failed' : 'backend_unavailable'); }
    if (r.ok) return value;
    // The recovery page shows the listener's own short reason (e.g. "Approval expired or not active").
    const e = coded(r.status === 403 || r.status === 401 ? 'not_allowed' : r.status === 409 ? 'conflict' : r.status >= 500 ? 'backend_failed' : 'bad_request');
    e.detail = String(value?.error || value?.detail || ('HTTP ' + r.status)).slice(0, 300);
    throw e;
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
      if (TRANSFER_METHODS.has(d.method)) {
        reply(await transfer(st, d, channel, authorize));
      } else if (['data.call','data.status','media.open','state.read','state.write','state.transaction'].includes(d.method)) {
        if (new TextEncoder().encode(JSON.stringify(d)).byteLength > 65536) throw coded('too_large');
        const binding = await bindingOf(st, channel, authorize);
        if (!authorize()) throw coded('denied');
        let operation = 'state.local', args = {}, extra = {};
        if (d.method === 'data.call') {
          const keys = d.args && typeof d.args === 'object' ? Object.keys(d.args).sort().join(',') : '';
          if (keys !== 'args,operation' && keys !== 'args,operation,operationKey') throw coded('bad_request');
          operation=d.args.operation; args=d.args.args;
          if (!DATA_OPERATIONS.has(operation)) throw coded('not_allowed');
          if (WRITES.has(operation) !== (keys === 'args,operation,operationKey')) throw coded('bad_request');
          if (WRITES.has(operation)) extra = {operationKey:d.args.operationKey};
        } else if (d.method === 'media.open') {
          operation = Object.hasOwn(MEDIA_OPERATIONS, st.appId) ? MEDIA_OPERATIONS[st.appId] : '';
          if (!operation) throw coded('not_allowed');
          if (!d.args || Object.keys(d.args).sort().join(',') !== 'purpose,resourceId' || typeof d.args.resourceId !== 'string' || d.args.resourceId.length > 200 || !MEDIA_PURPOSES[operation].includes(d.args.purpose)) throw coded('bad_request');
          args = {resourceId:d.args.resourceId, purpose:d.args.purpose};
        } else if (d.method === 'data.status') {
          if (!d.args || Object.keys(d.args).sort().join(',') !== 'operation,operationKey' || !WRITES.has(d.args.operation)) throw coded('bad_request');
          operation='data.status'; args={operation:d.args.operation,operationKey:d.args.operationKey};
        }
        const value = await server('call',{handle:binding.handle,generation:channel,requestId:d.id,operation,args,...extra});
        if (!authorize()) throw coded('denied');
        // Shell-internal signal after a proven write (e.g. the Notifications badge re-reads its own count).
        // It carries the registered app id, never app-supplied data; frames cannot dispatch shell events.
        if (d.method === 'data.call' && WRITES.has(operation)) { try { dispatchEvent(new CustomEvent('wizard:browser-data-written', { detail: Object.freeze({ appId: st.appId, operation }) })); } catch (_) {} }
        if (d.method === 'media.open') reply(ticketOf(value, operation));
        else if (d.method === 'data.call' || d.method === 'data.status') reply(value);
        else reply(await window.WizAppState.call({appId:st.appId,sourceId:value.principal?.sourceId,namespace:value.namespace,quota:value.quota,authorize},d.method,d.args));
      } else if (d.method === 'recovery.call') {
        // Only the built-in Troubleshooter window; never an installed app, whatever its id.
        if (st.recovery?.builtIn !== true || st.appId !== 'troubleshooter') throw coded('not_allowed');
        if (new TextEncoder().encode(JSON.stringify(d)).byteLength > 65536) throw coded('too_large');
        const value = await recoveryCall(st, d.args);
        if (!authorize()) throw coded('denied');
        reply(value);
      } else if (d.method === 'store.call') {
        // Only the shell's built-in App Store window; never an installed app, whatever its id.
        if (st.store?.builtIn !== true || st.appId !== 'app-store') throw coded('not_allowed');
        if (new TextEncoder().encode(JSON.stringify(d)).byteLength > 65536) throw coded('too_large');
        const value = await storeCall(st, d.args, authorize);
        if (!authorize()) throw coded('denied');
        reply(value);
      } else if (d.method === 'intent.confirm' || d.method === 'intent.open') {
        reply(await intentRequest(st, d, channel, authorize));
      } else if (['ready','share.wizard','voice.transcribe','nav.contextDraft'].includes(d.method)) {
        await st.service?.(d,reply,authorize);
      } else throw coded('not_allowed');
    } catch(e) { const code=e.code || 'backend_failed'; reply(undefined,{code,message:typeof e.detail === 'string' ? e.detail : code,retryable:['backend_unavailable','backend_failed','storage_unavailable','busy','timeout'].includes(code) && e.retryable !== false,...(e.outcome ? {outcome:e.outcome} : {}),...(e.operationKey ? {operationKey:e.operationKey} : {}),...(Number.isSafeInteger(e.offset) ? {offset:e.offset} : {})}); }
    finally { if (st.channel === channel) st.inflight--; }
  }
  /* Upload port and trusted downloads (wizard-os ADAPTER-SKETCH §6; first-party Files view). The frame sends typed
   * messages over its own authenticated boundary port; the shell holds the upload ticket (never given to the frame),
   * forwards one outstanding chunk of at most 1 MiB with its offset and hash, and the Agent Service checks binding,
   * generation, installation and the files.upload grant again for EVERY chunk. Downloads are shell save/open actions:
   * the frame names a resource id, never a URL, and only while the owner is acting (user activation). */
  async function transfer(st, d, channel, authorize) {
    const family = Object.hasOwn(TRANSFER_APPS, st.appId) ? TRANSFER_APPS[st.appId] : '';
    if (!family) throw coded('not_allowed');
    const a = d.args;
    if (d.method !== 'upload.chunk' && new TextEncoder().encode(JSON.stringify(d)).byteLength > 16384) throw coded('too_large');
    // Downloads: the owner's own action in this window, checked before anything else happens.
    const activated = navigator.userActivation ? navigator.userActivation.isActive : false;
    const binding = await bindingOf(st, channel, authorize);
    if (!authorize()) throw coded('denied');
    const call = async (operation, args) => { const v = await server('call', { handle: binding.handle, generation: channel, requestId: d.id, operation, args }); if (!authorize()) throw coded('denied'); return v; };
    const uploads = st.uploads ||= new Map();
    const hex = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v), id = v => typeof v === 'string' && /^up_[0-9a-f]{32}$/.test(v);
    if (d.method === 'upload.create') {
      if (!exactKeys(a, ['folder', 'filename', 'mime', 'bytes', 'clientUploadId'])) throw coded('bad_request');
      const v = await call(family + '.upload.create', a);
      if (!v || !id(v.uploadId) || !Number.isSafeInteger(v.offset) || !Number.isSafeInteger(v.bytes) || typeof v.status !== 'string') throw coded('backend_failed');
      if (typeof v.ticket === 'string') { if (uploads.size >= 64) uploads.delete(uploads.keys().next().value); uploads.set(v.uploadId, { ticket: v.ticket, busy: false }); }
      return { uploadId: v.uploadId, offset: v.offset, bytes: v.bytes, status: v.status, chunkBytes: Math.min(UPLOAD_CHUNK, Number(v.chunkBytes) || UPLOAD_CHUNK) };
    }
    if (d.method === 'upload.chunk') {
      if (!exactKeys(a, ['uploadId', 'offset', 'sha256', 'bytes']) || !id(a.uploadId) || !Number.isSafeInteger(a.offset) || a.offset < 0 || !hex(a.sha256)
        || Object.prototype.toString.call(a.bytes) !== '[object ArrayBuffer]' || a.bytes.byteLength < 1 || a.bytes.byteLength > UPLOAD_CHUNK) throw coded('bad_request');
      const u = uploads.get(a.uploadId);
      if (!u) throw Object.assign(coded('expired'), { retryable: false });
      if (u.busy) throw coded('busy');   // one outstanding chunk per upload
      u.busy = true;
      try {
        let r;
        try {
          r = await window.fetch('/wizard/v1/browser-adapters/upload-chunk', { method: 'POST', cache: 'no-store', body: a.bytes,
            headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(a.offset), 'X-Wizard-Upload-Ticket': u.ticket, 'X-Wizard-Chunk-Sha256': a.sha256 } });
        } catch (_) { throw coded('backend_unavailable'); }
        let v = {}; try { v = await r.json(); } catch (_) { throw coded('backend_failed'); }
        if (!authorize()) throw coded('denied');
        if (!r.ok) { const e = coded(typeof v.error === 'string' ? v.error : 'backend_failed'); if (Number.isSafeInteger(v.offset)) e.offset = v.offset; if (v.retryable === false) e.retryable = false; if (e.code === 'expired') uploads.delete(a.uploadId); throw e; }
        if (!Number.isSafeInteger(v.offset)) throw coded('backend_failed');
        return { offset: v.offset };
      } finally { u.busy = false; }
    }
    if (d.method === 'upload.status' || d.method === 'upload.abort') {
      if (!exactKeys(a, ['uploadId']) || !id(a.uploadId)) throw coded('bad_request');
      const v = await call(family + (d.method === 'upload.status' ? '.upload.status' : '.upload.abort'), { uploadId: a.uploadId });
      if (d.method === 'upload.abort' || v?.status !== 'open') uploads.delete(a.uploadId);
      return v;
    }
    if (d.method === 'upload.commit') {
      if (!exactKeys(a, ['uploadId', 'sha256', 'operationKey']) || !id(a.uploadId) || !hex(a.sha256) || typeof a.operationKey !== 'string' || !/^[0-9a-f-]{36}$/.test(a.operationKey)) throw coded('bad_request');
      const v = await call(family + '.upload.commit', a);
      uploads.delete(a.uploadId);
      return v;
    }
    // download.request {resourceId, action: 'save' | 'open'}: the shell itself saves or opens the file.
    if (!exactKeys(a, ['resourceId', 'action']) || typeof a.resourceId !== 'string' || a.resourceId.length > 200 || !['save', 'open'].includes(a.action)) throw coded('bad_request');
    if (!activated || document.hidden) throw coded('denied');
    const v = ticketOf(await call(family + '.content', { resourceId: a.resourceId, purpose: a.action === 'save' ? 'download' : 'read' }), family + '.content');
    if (a.action === 'open') { window.open(v.url, '_blank', 'noopener,noreferrer'); return { done: 'opened' }; }
    const link = document.createElement('a');
    link.href = v.url; link.download = ''; link.rel = 'noreferrer noopener'; link.referrerPolicy = 'no-referrer'; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    return { done: 'saved' };
  }
  /* Reviewed separate-origin exception (wizard-os #385, Files decision 2 Nov 2026): File Browser runs on its own https
   * origin and opens ONLY as its own tab, never in a Wizard window. The Agent Service flags it (`own_tab`) from WAM state;
   * the shell checks the address is a different https origin, then opens it with no opener and no referrer. Nothing
   * crosses into the tab: no token, no frame, no message channel. */
  function ownTabUrl(a) {
    if (a?.ownTab !== true || typeof a.url !== 'string') return '';
    let u; try { u = new URL(a.url); } catch (_) { return ''; }
    if (u.protocol !== 'https:' || u.origin === ORIGIN || u.username || u.password || u.hash) return '';
    return u.href;
  }
  function openOwnTab(a) {
    const href = ownTabUrl(a);
    if (!href) return false;
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  }
  const api = Object.freeze({
    enabled: true,
    ownTabUrl, openOwnTab,
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
