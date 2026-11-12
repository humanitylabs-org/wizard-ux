/* Shared app platform host v1. Registry + live Window/document/path are the authority.
 * No generic RPC, parent-global proxy, guessed Back, or expiring safety holds. */
(() => {
  'use strict';
  if (window.WizAppServices) return;
  const VERSION = 1, ORIGIN = location.origin, frames = new Map();
  const OPS = new Set(['ready', 'share.text', 'share.file', 'share.wizard', 'voice.transcribe', 'share.receive', 'share.targets', 'share.pending', 'share.ack', 'capture.pending', 'capture.ack', 'update.hold', 'update.release', 'badge.set', 'titlebar.set', 'orb.set', 'audio.duck', 'identity.info', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt', 'shell.openCompanion', 'shell.closeCompanion', 'shell.postCompanion', 'shell.focusApp']);
  let registry, available = null, serial = 0, rootArm = null;
  // Share receiving (docs/SHARE-SHEET.md): the share sheet hands its per-app ops here once, at shell load, before
  // any app frame exists; they are never on a global, so a frame reaches only its own app id's items.
  let shareOps = null;
  const claimShare = ops => { if (shareOps || !ops) return false; shareOps = ops; return true; };
  const uid = () => 'as-' + (++serial) + '-' + Math.random().toString(36).slice(2);
  const fault = message => new Error(message);
  // Apps use the box's one configured transcriber; no microphone or provider credentials cross the frame.
  async function transcribeFile(file, opts = {}) {
    if (!file || !['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(file)) || !file.size || file.size > 25 * 1024 * 1024) throw fault('Use an audio file up to 25 MB');
    if (opts.language != null && (typeof opts.language !== 'string' || !/^[a-zA-Z-]{0,35}$/.test(opts.language))) throw fault('Invalid transcription language');
    const config = window.WizConfig;
    await config?.ready;
    if (!config?.transcribe) return { unavailable: true };
    try { const result = await config.transcribe(file, { language: opts.language || '', prompt: config.voicePrompt?.() || '' }); return { text: String(result.text || '').trim() }; }
    catch (e) { if (e.code === 'no_voice') return { unavailable: true }; throw e; }
  }
  // Vault is an independent op group. Native uses the one device envelope, never an app-supplied appId.
  for (const op of ['vault.has', 'vault.seal', 'vault.open', 'vault.forget']) OPS.add(op);
  let vaultSeq = 0, vaultBound = null; const vaultWaits = new Map();
  function vaultPort() { const p = window.wizardVaultPort; if (!p?.postMessage) return null; if (vaultBound !== p) { vaultBound = p; p.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } const w = vaultWaits.get(m?.id); if (!w) return; vaultWaits.delete(m.id); clearTimeout(w.timer); m.ok ? w.resolve(m.result || {}) : w.reject(Object.assign(new Error(m.error || 'failed'), { code: m.error || 'failed' })); }; } return p; }
  // APK 0.10.8 exposes its own wizardVaultPort; 0.10.9+ answers vault.* on the shared device envelope (wizardDevicePort).
  async function deviceVaultCall(appId, method, extra) {
    try { return await window.WizCore.bridge.call('vault.' + method, { ...extra, appId }); }
    catch (e) { const code = e.message === 'unknown method' || e.message === 'unavailable' ? 'unavailable' : e.message || 'failed'; if (method === 'has' && code === 'unavailable') return { available: false, saved: false }; throw Object.assign(new Error(code), { code }); }
  }
  function vaultCall(appId, method, extra = {}) {
    if (!window.wizardVaultPort?.postMessage && window.wizardDevicePort?.postMessage && window.WizCore?.bridge?.call) return deviceVaultCall(appId, method, extra);
    const p = vaultPort(); if (!p) return Promise.resolve(method === 'has' ? { available: false, saved: false } : Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' })));
    const id = 'vault-' + (++vaultSeq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { vaultWaits.delete(id); reject(Object.assign(new Error('timeout'), { code: 'timeout' })); }, 120000);
      vaultWaits.set(id, { resolve, reject, timer });
      try { p.postMessage(JSON.stringify({ ...extra, id, v: 1, appId, method })); } catch (e) { clearTimeout(timer); vaultWaits.delete(id); reject(e); }
    });
  }
  // A fingerprint prompt only for the app you are looking at (James, 27 Oct 2026: after a reload a background
  // app asked for a fingerprint over a different view). seal/open wait until the app is in front and has stayed there
  // briefly (a reload passes desks on screen on its way to where you were); after VAULT_WAIT_MS the app gets
  // code 'not_in_front' and simply asks again when opened.
  const VAULT_STEADY_MS = 600, VAULT_WAIT_MS = 60000;
  function inFront(st) {
    if (document.hidden) return false;
    try { return (st.isFront || st.isVisible || (() => false))() === true; } catch (_) { return false; }
  }
  // Already steadily in front (the usual tap on "Unlock with fingerprint"): no added wait.
  function steadyFront(st) {
    const now = Date.now();
    if (!inFront(st)) { st.frontSince = 0; return false; }
    st.frontSince ||= now; return now - st.frontSince >= VAULT_STEADY_MS;
  }
  setInterval(() => { for (const st of frames.values()) steadyFront(st); }, 250);
  function whenInFront(st, alive) {
    if (steadyFront(st)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t0 = Date.now(); let since = 0;
      const tick = () => {
        if (!alive()) return reject(Object.assign(new Error('closed'), { code: 'cancelled' }));
        const now = Date.now();
        if (inFront(st)) { since ||= now; if (now - since >= VAULT_STEADY_MS) return resolve(); } else since = 0;
        if (now - t0 > VAULT_WAIT_MS) return reject(Object.assign(new Error('not_in_front'), { code: 'not_in_front' }));
        setTimeout(tick, 150);
      };
      tick();
    });
  }
  function apps() { if (!registry) registry = [window.WizCore.apps('mobile'), window.WizCore.apps('desktop')]; return registry.flatMap(r => r.APPS); }
  function registered(st) {
    const a = apps().find(a => a.id === st.appId && a.kind !== 'native' && a.url);
    if (!a) return false;
    try { return new URL(a.url, ORIGIN).href === st.url.href; } catch (_) { return false; }
  }
  // A file entry grants its directory, not arbitrary adjacent paths or the origin root.
  function within(url, base) {
    if (url.origin !== base.origin) return false;
    if (/%(?:2f|5c|2e|25)/i.test(url.pathname)) return false;
    const root = base.pathname.endsWith('/') ? base.pathname : base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
    return root !== '/' ? url.pathname.startsWith(root) : url.pathname === base.pathname;
  }
  function valid(st, doc) {
    if (!st || frames.get(st.frame) !== st || !st.frame.isConnected || !registered(st)) return false;
    try {
      const w = st.frame.contentWindow;
      return !!w && !st.frame.hasAttribute('srcdoc') && within(new URL(st.frame.src), st.url) && w.location.origin === ORIGIN && within(new URL(w.location.href), st.url) && (!doc || w.document === doc);
    } catch (_) { return false; } // off-origin resources fail closed: current path cannot be verified
  }
  // Browser owner boundary (wizard-os#133): a sandboxed app frame cannot be read, so it is verified by what the shell
  // itself controls: the registered element, still connected, its src inside the installed app's path, a document the
  // shell itself loaded there (navOk), and a ready answer on the frame's current boundary channel. Only window-local
  // services (badge, title bar) accept it.
  // navOk: the src attribute keeps the shell's URL when a page navigates its own frame (a link to another app, a
  // location change), and the new document can't be read. So a load counts only when the shell set src since the last
  // one; a self-navigated document gets no badge or title bar until the shell loads the window again.
  function trackNav(st) {
    st.navOk = true; st.navExpect = true;
    if (typeof MutationObserver !== 'function') return () => {}; // every real browser has it
    const mo = new MutationObserver(() => { st.navExpect = true; });
    mo.observe(st.frame, { attributes: true, attributeFilter: ['src'] });
    return () => mo.disconnect();
  }
  function boundaryLive(st) {
    if (!st || frames.get(st.frame) !== st || !st.frame.isConnected || !registered(st) || st.frame.hasAttribute('srcdoc') || st.navOk !== true) return false;
    if (window.WizBrowserBoundary?.ready?.(st.frame) !== true) return false;
    try { return within(new URL(st.frame.src), st.url); } catch (_) { return false; }
  }
  const live = (st, doc) => valid(st, doc) || boundaryLive(st);
  function from(source) { return [...frames.values()].find(st => st.frame.contentWindow === source); }
  const changed = () => window.dispatchEvent(new CustomEvent('wizard:app-holds'));
  function reset(st) { window.WizBackgroundAudio?.duck?.(st, false); window.WizCompanionPane?.detach(st.frame); if (st.tools) setTools(st, null); if (st.orb) setOrb(st, null); for (const [token, pin] of conversationPins) if (pin.st === st) conversationPins.delete(token); for (const off of st.captureOffs || []) { try { off(); } catch (_) {} } st.captureOffs?.clear(); st.holds.clear(); st.drafts?.clear(); st.messageHolds?.clear(); st.requests?.clear(); wsCloseAll(st); st.client = null; st.doc = null; st.pendingBack = null; changed(); }
  function reconcile() {
    for (const st of frames.values()) {
      if (st.tools && st.frame.isConnected && !barOf(st)?.querySelector(':scope > .wtools')) paintTools(st);
      if (!st.frame.isConnected || !registered(st)) { st.detach(); continue; }
      if (st.doc && !valid(st, st.doc)) reset(st);
    }
  }
  function attach(frame, { appId, path, openThread, openContextDraft, isFront, isVisible, back, readingStorage } = {}) {
    frames.get(frame)?.detach();
    if (!frame || frame.tagName !== 'IFRAME' || !appId || !path) return () => {};
    let url; try { url = new URL(path, ORIGIN); } catch (_) { return () => {}; }
    const st = { frame, appId, url, openThread, openContextDraft, isVisible, isFront, back, doc: null, client: null, holds: new Map(), pendingBack: null, lastAlive: Date.now() };
    if (!registered(st)) return () => {};
    const load = () => { if (st.boundaryNav) { st.navOk = st.navExpect; st.navExpect = false; } if (st.doc && !valid(st, st.doc)) reset(st); try { if (rootArm) frame.contentWindow.document.addEventListener('pointerdown', rootArm, true); } catch (_) {} cleanupLegacy(st).catch(() => {}); restoreReturn(st); };
    st.detach = () => { if (frames.get(frame) !== st) return; frames.delete(frame); frame.removeEventListener('load', load); reset(st); if (st.badged) setBadge(st.appId, 0); };
    frames.set(frame, st); frame.addEventListener('load', load);
    const detachReading = window.WizAppReadingPosition?.attach(frame, { appId, authorize: () => valid(st), ...(readingStorage ? { storage: readingStorage } : {}) });
    // Browser owner boundary (wizard-os#133): a sandboxed frame gets its Back/appearance/field channel. Every legacy
    // service below fails closed for it on its own (valid() cannot read an opaque document).
    const detachBoundary = window.WizBrowserBoundary?.enabled ? window.WizBrowserBoundary.attach(frame) : null;
    const stopNav = detachBoundary ? (st.boundaryNav = true, trackNav(st)) : null;
    // A sandboxed document that answers on a new channel learns a pending shell update, as a connecting one does.
    const onBoundaryReady = () => { if (available && boundaryLive(st)) window.WizBrowserBoundary.notice(frame, 'update', { available }); };
    if (detachBoundary) frame.addEventListener('wizard:boundary-ready', onBoundaryReady);
    const detachServices = st.detach;
    st.detach = () => { detachReading?.(); stopNav?.(); detachBoundary?.(); if (detachBoundary) frame.removeEventListener('wizard:boundary-ready', onBoundaryReady); detachServices(); queueSweep(); };
    // App scripts can run before the frame load event. Attach when mounting, not only on load.
    try { frame.contentWindow.WizardApp?.ready?.(); } catch (_) {}
    cleanupLegacy(st).catch(() => {});
    return st.detach;
  }
  // App badge: an installed app's own unread count on its desk mark / bar badge (same slot Notifications uses).
  // Keyed by the verified frame's app id, so an app can only badge itself; shell-owned counts are not writable.
  const SHELL_COUNTS = new Set(['wizard', 'notifications']);
  function setBadge(appId, n, plus) {
    if (SHELL_COUNTS.has(appId) || String(appId).startsWith('agent:')) throw fault('Badge unavailable');
    n = Number(n); window.WizCore?.workspaceNav?.setCount(appId, Number.isFinite(n) ? Math.min(999, Math.max(0, Math.floor(n))) : 0, plus === true);
  }
  /* Title-bar tools: a hosted app may put a few controls (older/newer, a picker, a same-app link) into its own
   * window bar instead of drawing a toolbar of its own, so its content keeps the screen. The shell renders them
   * from validated data (never app markup); taps go back to that verified document only. */
  /* Icon names are a fixed set (stroke paths on a 24 grid); `dot: true` adds a small attention dot (e.g. an account
   * that needs reconnecting). On phones each icon tool keeps a 44px tap target whatever size the skin draws it. */
  const TOOL_ICONS = { prev: 'm15 5-7 7 7 7', next: 'm9 5 7 7-7 7',
    search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2h-2z',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' };
  const barOf = st => st.frame.closest('.win')?.querySelector(':scope > .wbar') || null;
  function cleanTools(st, list, base) {
    if (list == null) return null;
    if (!Array.isArray(list) || list.length > 6) throw fault('Use up to 6 title-bar tools');
    const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
    return list.map(x => {
      if (!x || !/^[a-z0-9-]{1,32}$/.test(x.id || '') || !['button', 'select', 'link'].includes(x.kind)) throw fault('Invalid title-bar tool');
      const o = { id: x.id, kind: x.kind, label: str(x.label, 60) || x.id, text: str(x.text, 16), icon: TOOL_ICONS[x.icon] ? x.icon : '', disabled: x.disabled === true, dot: x.dot === true };
      if (x.kind === 'select') {
        if (!Array.isArray(x.options) || x.options.length > 500) throw fault('Invalid picker options');
        o.options = x.options.map(p => ({ value: str(p?.value, 64), label: str(p?.label, 60) })); o.value = str(x.value, 64);
      }
      if (x.kind === 'link') {
        let u = null; try { u = new URL(String(x.href || ''), base || st.doc?.location?.href || st.url.href); } catch (_) {}
        if (!u || !within(u, st.url)) throw fault('Title-bar links stay inside the app');
        o.href = u.href;
      }
      return o;
    });
  }
  function paintTools(st) {
    const bar = barOf(st); if (!bar) return false;
    let box = bar.querySelector(':scope > .wtools');
    if (!st.tools?.length) { box?.remove(); bar.classList.remove('has-tools'); return true; }
    if (!box) {
      box = document.createElement('span'); box.className = 'wtools';
      bar.insertBefore(box, [...bar.children].find(c => c.matches('button, .wb, .wpin, .wroute-slot')) || null);
    }
    renderTools(st.frame, box);
    bar.classList.add('has-tools');
    return true;
  }
  // Both desktop renderers use the same validated model and verified-document
  // dispatch. A layout-owned slot is not a clone of Classic's titlebar.
  const toolSlots = new WeakMap();
  function renderTools(frame, box) {
    const st = frames.get(frame), owner = st && live(st, st.doc) ? st : null;
    if (!toolSlots.has(box)) {
      toolSlots.set(box, { owner: null, key: '' });
      // Own the gesture: a tap here is never a title-bar double tap, a drag or a window action.
      for (const ev of ['pointerdown', 'dblclick']) box.addEventListener(ev, e => e.stopPropagation());
      box.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('button[data-tool]'); if (b && !b.disabled) dispatchTool(box, b.dataset.tool); });
      box.addEventListener('change', e => { const s = e.target.closest('select[data-tool]'); if (s) dispatchTool(box, s.dataset.tool, s.value); });
    }
    const state = toolSlots.get(box), tools = owner?.tools || [], key = JSON.stringify(tools);
    if (state.owner === owner && state.doc === owner?.doc && state.key === key) return !!tools.length;
    state.owner = owner; state.doc = owner?.doc; state.key = key; box.replaceChildren();
    for (const x of tools) {
      let el;
      if (x.kind === 'select') {
        el = document.createElement('select'); el.className = 'wtool wtool-pick';
        for (const p of x.options) { const op = document.createElement('option'); op.value = p.value; op.textContent = p.label; el.append(op); }
        el.value = x.value;
      } else {
        el = document.createElement(x.kind === 'link' ? 'a' : 'button'); el.className = 'wtool';
        if (x.kind === 'link') { el.href = x.href; el.target = '_blank'; el.rel = 'noopener'; } else el.type = 'button';
        if (x.icon) { el.classList.add('wtool-ic'); el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TOOL_ICONS[x.icon]}"/></svg>`; }
        else el.textContent = x.text || x.label;
        if (x.dot) el.classList.add('wtool-dot');
        if (x.disabled) { if (x.kind === 'link') el.setAttribute('aria-disabled', 'true'); else el.disabled = true; }
      }
      el.dataset.tool = x.id; el.dataset.wact = 'tool'; el.setAttribute('aria-label', x.label); el.title = x.label;
      box.append(el);
    }
    return !!tools.length;
  }
  function dispatchTool(box, id, value) {
    const held = toolSlots.get(box), st = held?.owner;
    if (!st || !live(st, held.doc)) return false;
    const tool = st.tools?.find(x => x.id === id);
    if (!tool || tool.disabled || (value === undefined ? tool.kind !== 'button' : tool.kind !== 'select' || !tool.options.some(o => o.value === value))) return false;
    if (!valid(st, held.doc)) return window.WizBrowserBoundary.tool(st.frame, id, value);
    try { st.frame.contentWindow.postMessage({ type: 'wizard:app:tool', version: VERSION, id, value }, ORIGIN); return true; } catch (_) { return false; }
  }
  /* App orb claims: one fixed icon set, a short label, the app's own registry colour. The shell decides when it shows. */
  const ORB_ICONS = new Set(['plus', 'mic', 'record', 'stop', 'send', 'search', 'edit']);
  let orbShown = () => false;
  function setOrb(st, spec) {
    const icon = spec && ORB_ICONS.has(spec.icon) ? spec.icon : null;
    const next = icon ? { icon, label: String(spec.label || '').replace(/[\x00-\x1f]/g, '').slice(0, 40) } : null;
    if (JSON.stringify(next) === JSON.stringify(st.orb || null)) return orbShown(st.frame);
    st.orb = next; window.dispatchEvent(new CustomEvent('wizard:app-orb', { detail: { appId: st.appId } }));
    return orbShown(st.frame);
  }
  function orbOf(frame) {
    const st = frames.get(frame); if (!st?.orb || !valid(st, st.doc)) return null;
    const a = apps().find(x => x.id === st.appId);
    return Object.freeze({ appId: st.appId, name: a?.name || st.appId, icon: st.orb.icon, label: st.orb.label || a?.name || st.appId, colors: Array.isArray(a?.colors) ? a.colors.slice(0, 2) : (a?.g || []) });
  }
  function orbTap(frame) {
    const st = frames.get(frame); if (!st?.orb || !valid(st, st.doc)) return false;
    try { st.frame.contentWindow.postMessage({ type: 'wizard:app:orb', version: VERSION }, ORIGIN); return true; } catch (_) { return false; }
  }
  function setTools(st, list, base) { st.tools = cleanTools(st, list, base); const shown = paintTools(st); window.dispatchEvent(new CustomEvent('wizard:app-tools')); return shown; }
  // What the phone's approval sheet gets: the catalog's name for the app (never the page's) and only the needed fields.
  function identityParams(app, method, args) {
    const params = { requester: String(app.name || app.id).replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 80) };
    if (method === 'sign') params.event = args?.event;
    if (method === 'nip44_encrypt' || method === 'nip44_decrypt') {
      params.pubkey = args?.pubkey;
      const key = method === 'nip44_encrypt' ? 'plaintext' : 'ciphertext'; params[key] = args?.[key];
    }
    return params;
  }
  // Owner-key access is narrower than ordinary app services: installed apps.json entries only,
  // never owner links, arbitrary same-origin frames or off-origin apps. Label comes from the catalog.
  async function identity(st, doc, method, args) {
    const authorize = () => {
      const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.source === 'apps.json');
      if (!app || !valid(st, doc) || st.url.origin !== ORIGIN) throw fault('Wizard ID needs an installed same-origin app');
      return app;
    };
    const app = authorize(), bridge = window.WizCore?.bridge;
    if (!window.wizardDevicePort || !bridge?.call) return { unavailable: true }; // Desktop-to-phone routing is not v1.
    const params = identityParams(app, method, args);
    // Copy now: an app cannot mutate its event after the sheet is opened.
    const payload = JSON.stringify(params);
    if (payload.length > 140000) throw fault('Wizard ID request too large');
    const result = await bridge.call('identity.' + method, JSON.parse(payload));
    authorize(); // No signature/plaintext to a reloaded, navigated, detached or uninstalled document.
    return result;
  }
  function connect(source, client) {
    const st = from(source); if (!valid(st)) return null;
    const doc = source.document;
    if (st.doc && st.doc !== doc) reset(st);
    st.doc = doc; if (client !== undefined) st.client = client; st.lastAlive = Date.now();
    const check = () => { if (!valid(st, doc)) throw fault('App frame is no longer authorized'); st.lastAlive = Date.now(); };
    const hold = (reason, options = {}) => {
      check(); if (st.holds.size >= 64) throw fault('Too many update holds');
      const id = uid(); st.holds.set(id, String(reason || 'Unsaved work').slice(0, 160)); changed();
      // A draft is skippable only after its owner confirms durable readback.
      // Capture holds never opt into this contract, even with a keep callback.
      const draft = typeof options.keep === 'function' && !/record|captur|voice|audio/i.test(reason) ? {keep: options.keep, doc, generation: 0, kept: false} : null;
      if (draft) { st.drafts ||= new Map(); st.drafts.set(id, draft); }
      let released = false;
      return { release() { if (released) return; released = true; st.holds.delete(id); st.drafts?.delete(id); changed(); } };
    };
    // Capture holds start before permission, end only after stop/cancel settles. Lifecycle never cancels capture.
    const start = async (opts, attaching = false) => {
      check(); if (!window.WizAppCapture) throw fault('Shared capture unavailable');
      if (['auto', 'command'].includes(opts?.kind)) throw fault('Capture kind is reserved for Wizard voice; use audio/meeting and task metadata');
      const shell = window.__wos || window.__wux;
      if (shell?.voice && shell.voice !== 'idle') throw Object.assign(fault('Microphone held by Wizard voice'), { code: 'busy', appId: 'wizard-voice' });
      const h = hold('Recording');
      const resource = window.WizAppCapture;
      const release = () => { h.release(); removeEventListener('wizard-app-capture-state', onCaptureState); };
      const onCaptureState = () => { if (resource.getState?.().active === false) release(); }; // actual recorder state, never elapsed time
      addEventListener('wizard-app-capture-state', onCaptureState);
      let session;
      try {
        const safe = {}; for (const key of ['kind','mime','audio','pcm','chunkMs','maxMs','maxBytes','systemAudio','meta','seqBase','offsetMs','preparedId','resumeId']) if(opts?.[key] !== undefined) safe[key]=opts[key];
        session = await (attaching ? resource.attach(st.appId) : safe.resumeId && resource.resume ? resource.resume(st.appId, safe.resumeId, safe) : resource.start(st.appId, safe));
        if (!session) { release(); check(); return null; }
        const finished = {};
        const finish = method => {
          check();
          // Stop and explicit Discard are distinct intents. The resource arbitrates their race;
          // sharing one promise here used to turn a Discard into another Stop.
          if (!finished[method]) finished[method] = Promise.resolve().then(() => session[method]()).then(r => { release(); return r; }, e => { delete finished[method]; throw e; });
          return finished[method];
        };
        check();
        const observe = (method, fn) => {
          check(); if (typeof fn !== 'function' || !session[method]) throw fault('Capture listener unavailable');
          const off=session[method](value=>{ if(valid(st,doc)) { try { fn(value); } catch (_) {} } });
          st.captureOffs ||= new Set(); const release=()=>{off();st.captureOffs.delete(release);};st.captureOffs.add(release);return release;
        };
        const call = (method, ...args) => { check(); if(!session[method]) throw fault('Capture method unavailable');return session[method](...args); };
        return Object.freeze({ id: session.id, onLevel: fn=>observe('onLevel',fn),
          onPcm: fn=>observe('onPcm',fn), onChunk: fn=>observe('onChunk',fn), onState: fn=>observe('onState',fn), onWarn: fn=>observe('onWarn',fn),
          getInfo: ()=>call('getInfo'), chunks: ()=>call('chunks'), setSystemAudio: on=>call('setSystemAudio',on),
          stop: () => finish('stop'), cancel: () => finish('cancel'),
          pause() { check(); if (!session.pause) return Promise.reject(fault('Capture pause unavailable')); return session.pause(); },
          resume() { check(); if (!session.resume) return Promise.reject(fault('Capture resume unavailable')); return session.resume(); } });
      } catch (e) {
        // The permission/native await can outlive this document. Stop and retain the take before rejecting.
        // A same-app replacement document that already attached owns the take now: leave it recording.
        if (session && !session.reattached?.()) { try { await session.stop(); } catch (_) { /* capture service retains retryable custody */ } }
        release();
        if (e.code === 'busy' && e.appId) {
          const owner = apps().find(a => a.id === e.appId);
          e.message = 'The microphone is recording in ' + (owner?.name || String(e.appId).replace(/[-_]/g, ' ')) + '. Stop that recording first.';
        }
        throw e;
      }
    };
    // Recheck the exact requesting document after the biometric prompt as well as before it.
    const vault = async (method, extra) => {
      check();
      if (method === 'seal' || method === 'open') {
        await whenInFront(st, () => { try { check(); return true; } catch (_) { return false; } });
        check();
        if (!inFront(st)) throw Object.assign(new Error('not_in_front'), { code: 'not_in_front' });
      }
      const result = await vaultCall(st.appId, method, extra); check(); return result;
    };
    source.addEventListener('pagehide', () => { if (st.doc === doc) reset(st); }, { once: true });
    return Object.freeze({ version: VERSION, appId: st.appId,
      ready() { check(); window.WizCompanionPane?.ready(st.frame); return { version: VERSION, hosted: true, appId: st.appId }; },
      identity: Object.freeze({
        info: () => identity(st, doc, 'info'),
        sign: event => identity(st, doc, 'sign', { event }),
        nip44_encrypt: args => identity(st, doc, 'nip44_encrypt', args),
        nip44_decrypt: args => identity(st, doc, 'nip44_decrypt', args),
      }),
      shell: Object.freeze({
        openCompanion(opts = {}) {
          check();
          if (typeof opts.path !== 'string' || !opts.path || opts.path.length > 4096) throw fault('Companion needs an app path');
          const url = new URL(opts.path, source.location.href);
          if (!within(url, st.url) || url.username || url.password) throw fault('Companion must stay inside the registered app path');
          if (!window.WizCompanionPane) throw fault('Companion panes unavailable');
          return window.WizCompanionPane.open(st, { ...opts, path: url.pathname + url.search + url.hash });
        },
        closeCompanion() { check(); return window.WizCompanionPane?.close(st.frame) === true; },
        postCompanion(value) { check(); return window.WizCompanionPane?.post(st.frame, value) === true; },
        focusApp() { check(); return window.WizCompanionPane?.focusApp(st.frame) === true || window.WizOpenApp?.(st.appId) === true; },
        toast(icon, message) { check(); if (typeof icon !== 'string' || typeof message !== 'string') return false; const shell = window.__wos || window.__wux; shell?.toast?.(icon.slice(0, 20), message.slice(0, 2000), 2600); return !!shell?.toast; },
      }),
      badge: Object.freeze({ set(n, o) { check(); setBadge(st.appId, n, !!(o && o.more === true)); st.badged = true; return true; } }),
      orb: Object.freeze({ set(spec) { check(); return setOrb(st, spec); }, shown() { check(); return orbShown(st.frame); } }),
      // Lower Wizard Music while this app plays a short sound; duck(false) restores it. Resolves true when ducked.
      audio: Object.freeze({ duck(on) { check(); return window.WizBackgroundAudio?.duck ? window.WizBackgroundAudio.duck(st, !!on) : Promise.resolve(false); } }),
      titlebar: Object.freeze({ set(list) { check(); return setTools(st, list); },
        shown() { check(); const b = barOf(st)?.querySelector(':scope > .wtools'); return !!b && b.getClientRects().length > 0 && b.offsetHeight > 0; } }),
      view: Object.freeze({ isVisible() { check(); return !document.hidden && st.isVisible?.() === true; } }),
      /* Photos and videos an app shows open in Wizard's one media viewer (pinch/double-tap zoom, pan, swipe between
       * items, Save/Share, Back/Esc closes) above the app, exactly as in Chats (James, 26 Oct 2026). Only this app's
       * own origin (or its blob: URLs) is opened; relative URLs resolve against the app's document. */
      media: Object.freeze({ view(items, index = 0) {
        check();
        if (st.isVisible?.() !== true || !window.WosChat?.viewer || !Array.isArray(items)) return false;
        const base = source.location.href, clean = [], list = items.slice(0, 500), want = Math.floor(+index) || 0;
        let i = want >= list.length ? Infinity : 0; // past the end (stale index, intake cap) still clamps to the last item
        for (const [n, it] of list.entries()) {
          if (n === want) i = clean.length; // the tapped item keeps its place after unsafe entries are dropped
          let u; try { u = new URL(String(it?.url || ''), base); } catch (_) { continue; }
          const own = u.origin === location.origin && /^https?:$/.test(u.protocol);
          const blob = u.protocol === 'blob:' && u.href.startsWith('blob:' + location.origin + '/');
          if (!own && !blob) continue;
          const kind = it?.kind === 'video' ? 'video' : 'image';
          clean.push({ url: u.href, kind, name: String(it?.name || '').slice(0, 200), mime: String(it?.mime || (kind === 'video' ? 'video/mp4' : 'image/jpeg')).slice(0, 100) });
        }
        return clean.length ? window.WosChat.viewer.open(clean, Math.max(0, Math.min(clean.length - 1, i))) === true : false;
      } }),
      nav: Object.freeze({ threadAgents: true, threadDrafts: true,
      /* The app finished what the owner came for (dismissed, archived, saved, deleted): take one Back past the app's
       * own views, landing on the previous screen exactly as the shell's Back would (James, 25 Oct 2026). */
      back() { check(); if (st.isVisible?.() !== true || typeof st.back !== 'function') return false; return st.back() === true; },
      openContextDraft(data) {
        check();
        // Installed Wizard apps may attach bounded reference data to a fresh MAIN Chats draft, never send or run.
        // Identity and namespace come from the attached live frame, never from the caller's payload. The id grammar
        // matches WosChat.reply.clean's key namespace, so every admitted app can produce a valid reply key.
        if (!/^[a-z][a-z0-9-]{0,40}$/.test(st.appId) || !apps().some(a => a.id === st.appId && a.kind === 'wizard') || st.isVisible?.() !== true || typeof st.openContextDraft !== 'function') throw fault('Context draft unavailable');
        if (!data || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.id) || typeof data.title !== 'string' || data.title.length > 1000 || typeof data.message !== 'string' || data.message.length > 32000) throw fault('Invalid app context');
        // A Reply: the composer stays empty; the item rides beside the draft and is framed as quoted, untrusted
        // reference DATA only in the message that is sent (WosChat.reply).
        return st.openContextDraft(st.appId + ':' + data.id, { title: data.title, message: data.message });
      }, openThread(id, opts) {
        check();
        // This bounded workflow is admitted only for an admitted installed app's current document (Manager, Wisdom).
        if (!hostedThreadAuthorized(st) || st.isVisible?.() !== true || typeof id !== 'string' || !id || id.length > 512 || /[\s\x00-\x1f]/.test(id) || id === '__new__') throw fault('Thread navigation unavailable');
        // Optional app item that rides beside the thread's draft: keyed to this app, quoted as data when sent.
        let reply = null;
        if (opts?.reply != null) {
          const r = opts.reply, key = String(r?.key || '');
          if (!key.startsWith(st.appId + ':')) throw fault('Reply context must be keyed to this app');
          reply = window.WosChat?.reply?.clean({ key, title: r?.title, message: r?.message });
          if (!reply) throw fault('Invalid reply context');
        }
        const agent = opts?.agent;
        if (agent != null) {
          const a = typeof agent === 'string' ? window.WosAgents?.get(agent) : null;
          if (!a || a.status !== 'running' || !window.WosAgents.isOther(agent)) throw fault('Thread agent unavailable');
        }
        // Optional trusted owner text stays a draft, separate from the untrusted
        // reply item. No send/run authority is added by this admission.
        let draft;
        if (opts?.draft != null) {
          if (typeof opts.draft !== 'object' || typeof opts.draft.text !== 'string' || opts.draft.text.length > 8000) throw fault('Invalid thread draft');
          draft = {text:opts.draft.text};
        }
        return st.openThread?.(id, { ...(reply ? { reply } : {}), ...(agent ? { agent } : {}), ...(draft ? {draft} : {}) }) === true;
      } }),
      share: Object.freeze({ text(data) {
        check();
        if (data?.url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(String(data.url))) {
          try { data = { ...data, url: new URL(String(data.url), source.location.href).href }; } catch (_) { return Promise.resolve('unsupported'); }
        }
        return window.WosChat?.sharePayload(data) || Promise.resolve('unsupported');
      },
        async wizard(data) {
          check();
          if (!window.WizShareWizard) return 'unsupported';
          window.WizShareWizard.valid(data);
          const h = hold('Share to Wizard');
          try { return await window.WizShareWizard.wizard(data, () => valid(st, doc)); }
          finally { h.release(); }
        },
        file(file, opts) { check(); if (!file || !['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(file))) return Promise.resolve('unsupported'); return window.WosChat?.shareFile(file, opts) || Promise.resolve('unsupported'); },
        // Receiving (docs/SHARE-SHEET.md): this verified frame registers its own app id only; items stay pending
        // until the app acks that it placed one in its own composer.
        receive(opts) { check(); return !!shareOps?.register(st.appId, { accepts: opts?.accepts, targets: opts?.targets }); },
        targets(list) { check(); return !!shareOps?.setTargets(st.appId, list); },
        pending() { check(); return shareOps?.pending(st.appId, { owner: st, alive: () => frames.get(st.frame) === st && st.frame.isConnected && valid(st, st.doc) }) || []; },
        ack(id) { check(); return typeof id === 'string' && !!shareOps?.ack(st.appId, id); } }),
      device: Object.freeze({ legacy: Object.freeze({
        available(method) { check(); return !!window.WizAndroidRelay?.legacyAvailable(source, st.appId, method); },
        call(method, args = []) { check(); if (!window.WizAndroidRelay) throw fault('Legacy device unavailable'); return window.WizAndroidRelay.legacy(source, st.appId, method, args); },
      }), backgroundAudio: Object.freeze({request(method, params) {
        check();
        if (!window.WizBackgroundAudio) return Promise.reject(fault('Background audio unavailable'));
        return window.WizBackgroundAudio.request(source, method, params);
      }}) }),
      voice: Object.freeze({ stripAddress(text) { check(); return window.WizConfig.stripAddress(String(text || '')); }, async transcribe(file, opts) { check(); const result = await transcribeFile(file, opts); check(); return result; } }),
      theme: Object.freeze({ get() { check(); return window.WizAppearance?.get(frameOf(st)) || null; } }),
      update: Object.freeze({ hold, available() { check(); return available; } }),
      capture: Object.freeze({ attach: () => { check(); if (st.frame.dataset?.voiceService) throw fault('Voice service has no capture authority'); return start({}, true); },
        start: opts => { if (st.frame.dataset?.voiceService) throw fault('Voice service has no capture authority'); return start(opts); },
        prepare(opts) {
          check(); const shell=window.__wos||window.__wux;
          if(shell?.voice && shell.voice!=='idle') throw Object.assign(fault('Microphone held by Wizard voice'),{code:'busy',appId:'wizard-voice'});
          if(!window.WizAppCapture?.prepare) throw fault('Capture preparation unavailable');
          const p=window.WizAppCapture.prepare(st.appId,opts);st.captureOffs ||= new Set();
          const release=()=>{p.release();st.captureOffs.delete(release);};st.captureOffs.add(release);
          return Object.freeze({id:p.id,release});
        },
        capabilities(opts) {check();return window.WizAppCapture?.capabilities?.(opts) || {};},
        current() {check();return window.WizAppCapture?.current?.(st.appId) || null;},
        async settle(keepId) {
          check(); if (st.frame.dataset?.voiceService) throw fault('Voice service has no capture authority');
          if (!window.WizAppCapture?.settle) throw fault('Stop-only capture recovery unavailable');
          const takes = await window.WizAppCapture.settle(st.appId, keepId); check(); return takes;
        },
        pending() { check(); if (!window.WizAppCapture) return Promise.reject(fault('Shared capture unavailable')); return window.WizAppCapture.pending(st.appId); },
        ack(id) { check(); if (!window.WizAppCapture) return Promise.reject(fault('Shared capture unavailable')); return window.WizAppCapture.ack(st.appId, id); } }),
      vault: Object.freeze({
        has: () => vault('has'),
        seal: (secret, title) => vault('seal', { secret, title }),
        open: title => vault('open', { title }),
        forget: () => vault('forget'),
      }),
      alive() { check(); return true; },
    });
  }
  const frameOf = st => st.frame;
  addEventListener('wizard-app-capture-state', changed);
  // A share was handed to an app that is already open: tell its verified frame to pull.
  addEventListener('wizard:share-pending', e => {
    for (const st of frames.values()) if (st.appId === e.detail?.appId && valid(st, st.doc)) {
      try { st.frame.contentWindow.postMessage({ type: 'wizard:app:share', version: VERSION }, ORIGIN); } catch (_) {}
    } else if (st.appId === e.detail?.appId && boundaryLive(st)) window.WizBrowserBoundary.notice(st.frame, 'share');
  });
  // onRoot: the shell's own next step, run later when a sandboxed app (browser boundary) answers that it is at its root.
  function back(frame, onRoot) {
    const st = frames.get(frame); if (!st || !registered(st) || !frame.isConnected) return 'notReady';
    if (window.WizBrowserBoundary?.owns(frame)) return window.WizBrowserBoundary.back(frame, onRoot);
    if (st.url.origin !== ORIGIN) {
      // A registered off-origin frame can only be asked to navigate, never access resources.
      if (st.pendingBack) return 'stay';
      const id = uid(); st.pendingBack = id;
      frame.contentWindow.postMessage({ type: 'wizard:app:back', version: VERSION, id }, st.url.origin);
      setTimeout(() => { if (st.pendingBack === id) st.pendingBack = null; }, 1200);
      return 'pending'; // no later shell step, including on timeout
    }
    if (!valid(st)) return 'stay';
    try {
      if (st.client && st.doc === frame.contentDocument) return st.client.back() === true ? 'handled' : 'atRoot';
      const hook = frame.contentWindow.__wizardCloseOverlay;
      if (typeof hook === 'function') return hook.call(frame.contentWindow) === true ? 'handled' : 'atRoot';
    } catch (_) { return 'stay'; }
    return 'notReady';
  }
  function busy() {
    reconcile();
    if ([...frames.values()].some(st => [...st.holds.keys()].some(id => !st.drafts?.get(id)?.kept))) return true;
    try {
      const s = window.WizAppCapture?.getState?.();
      if (s && (s.hold || s.active || s.recording || s.session || s.appId || /record|start|stop|permission/.test(s.state || s.status || ''))) return true;
    } catch (_) { return true; }
    return false;
  }
  function announce(detail) {
    available = detail;
    for (const st of frames.values()) if (valid(st, st.doc)) {
      try { st.frame.contentWindow.postMessage({ type: 'wizard:app:update', version: VERSION, available: detail }, ORIGIN); } catch (_) {}
    } else if (boundaryLive(st)) window.WizBrowserBoundary.notice(st.frame, 'update', { available: detail });
    window.dispatchEvent(new CustomEvent('wizard:app-update', { detail }));
  }
  /* Fresh data (issue 1243): an open app window must not keep old data until it is closed and reopened. The shell asks
   * a connected app to read again (`wizard:app:refresh`, see WizardApp.view.onRefresh) when its window comes back into
   * view or to the front, about once a minute while it is in view (never while hidden), and soon after an agent tool
   * named for that app finishes. At most one ask per FRESH_GAP per frame; a later ask waits for the gap, never dropped. */
  const FRESH_GAP = 3000, FRESH_POLL = 60000, FRESH_REASONS = ['visible', 'focus', 'poll', 'agent'];
  const freshSeen = st => { if (document.hidden) return false; try { return st.isVisible?.() === true; } catch (_) { return false; } };
  const freshFront = st => { try { return st.isFront?.() === true; } catch (_) { return false; } };
  function freshAsk(st, reason, now = Date.now()) {
    if (!FRESH_REASONS.includes(reason)) return false;
    if (now - (st.freshAt || 0) < FRESH_GAP) { st.freshWant = st.freshWant || reason; return false; }
    if (valid(st, st.doc)) {
      st.freshAt = now; st.freshWant = null;
      try { st.frame.contentWindow.postMessage({ type: 'wizard:app:refresh', version: VERSION, reason }, ORIGIN); return true; } catch (_) { return false; }
    }
    // A sandboxed app (browser boundary) gets the same ask over its channel; the shell never reads its document.
    if (!boundaryLive(st)) return false;
    st.freshAt = now; st.freshWant = null;
    return window.WizBrowserBoundary.notice(st.frame, 'refresh', { reason });
  }
  // The document a fresh-data ask is for: the connected same-origin document, or, for a sandboxed app (browser
  // boundary), the verified document now answering on its channel (its generation).
  const freshDocOf = st => st.doc || (boundaryLive(st) ? 'boundary:' + window.WizBrowserBoundary.gen(st.frame) : null);
  function freshTick(now = Date.now()) {
    if (document.hidden) return;
    for (const st of frames.values()) {
      const doc = freshDocOf(st);
      if (!doc) { st.freshDoc = null; continue; }
      const seen = freshSeen(st), front = seen && freshFront(st);
      // A new document has just read its data: start counting from its load, not from the last one.
      if (st.freshDoc !== doc) { st.freshDoc = doc; st.freshAt = now; st.freshWant = null; }
      else if (seen && !st.freshWasSeen) freshAsk(st, 'visible', now);
      else if (front && !st.freshWasFront) freshAsk(st, 'focus', now);
      else if (seen && st.freshWant) freshAsk(st, st.freshWant, now);
      else if (seen && now - (st.freshAt || 0) >= FRESH_POLL) freshAsk(st, 'poll', now);
      st.freshWasSeen = seen; st.freshWasFront = front;
    }
  }
  setInterval(() => freshTick(), 1000);
  // The whole page coming back already gives every app frame its own real visibilitychange: count that as the read.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const now = Date.now();
    for (const st of frames.values()) { st.freshAt = now; st.freshWant = null; st.freshWasSeen = freshSeen(st); st.freshWasFront = st.freshWasSeen && freshFront(st); }
  });
  // An agent tool finished (live.js run stream): `mcp_wizard_calendar_update_event` and `calendar_update_event` both
  // name the Calendar app (`wizard-calendar`). Apps out of view read again when they come back into view anyway.
  function freshTool(tool, now = Date.now()) {
    const name = String(tool || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    let asked = 0;
    for (const st of frames.values()) {
      const short = String(st.appId || '').toLowerCase().replace(/^wizard(?:os)?-/, '').replace(/[^a-z0-9]+/g, '_');
      if (short.length < 3 || !freshDocOf(st) || !freshSeen(st) || !new RegExp('(^|_)' + short + '(_|$)').test(name)) continue;
      freshAsk(st, 'agent', now); asked++;
    }
    return asked;
  }
  addEventListener('wizard:agent-tool', e => { freshTool(e?.detail?.tool); });
  // The shell supplies reviewed exact migration entries; apps cannot ask to unregister workers or delete caches.
  async function cleanupLegacy(st) {
    const policy = window.WizCore.appMigrations?.[st.appId]; if (!policy || !valid(st) || st.url.origin !== ORIGIN) return [];
    // An app that declares home_screen.offline owns its worker: legacy cleanup would race its clients.claim().
    if (window.WizCore.appHomeScreen?.(st.appId)?.offline) return [];
    const scope = new URL(policy.scope, ORIGIN), scripts = policy.scripts.map(path => new URL(path, ORIGIN));
    if (!within(scope, st.url) || scripts.some(script => !within(script, st.url)) || scope.pathname === '/') return [];
    const removed = [];
    for (const reg of await navigator.serviceWorker?.getRegistrations?.() || []) {
      if (!valid(st)) return removed;
      const workers = [reg.active, reg.waiting, reg.installing].filter(Boolean);
      if (reg.scope !== scope.href || !workers.length || workers.some(w => !scripts.some(script => w.scriptURL === script.href))) continue;
      if (await reg.unregister()) removed.push(reg.scope);
    }
    for (const name of policy.caches) { if (!valid(st)) return removed; if (await window.caches?.delete(name)) removed.push(name); }
    return removed;
  }
  addEventListener('message', async e => {
    const d = e.data; if (!d || d.type !== 'wizard:app:request' || d.version !== VERSION || !OPS.has(d.op) || typeof d.id !== 'string' || d.id.length > 96) return;
    const st = from(e.source); if (!st || e.origin !== ORIGIN || !valid(st, st.doc)) return;
    st.requests ||= new Set(); if (st.requests.size >= 32 || st.requests.has(d.id)) return; st.requests.add(d.id);
    // Bounded message transport handles serializable operations only. Session functions never cross it.
    const requestDoc = e.source.document;
    const reply = (value, error) => { if (valid(st, requestDoc)) e.source.postMessage({ type: 'wizard:app:reply', version: VERSION, id: d.id, value, error }, ORIGIN); };
    try {
      const svc = connect(e.source, st.client); let value;
      if (d.op === 'ready') value = svc.ready();
      if (d.op.startsWith('shell.')) value = svc.shell[d.op.slice(6)](d.args);
      if (d.op === 'share.text') value = await svc.share.text(d.args);
      if (d.op === 'share.wizard') value = await svc.share.wizard(d.args);
      if (d.op === 'share.file') value = await svc.share.file(d.args?.file, d.args?.options);
      if (d.op === 'voice.transcribe') value = await svc.voice.transcribe(d.args?.file, { language: d.args?.language });
      if (d.op === 'share.receive') value = svc.share.receive(d.args);
      if (d.op === 'share.targets') value = svc.share.targets(d.args?.targets);
      if (d.op === 'share.pending') value = svc.share.pending();
      if (d.op === 'share.ack') value = svc.share.ack(d.args?.id);
      if (d.op === 'capture.pending') value = await svc.capture.pending();
      if (d.op === 'capture.ack') value = await svc.capture.ack(d.args?.id);
      if (d.op === 'update.hold') { const h = svc.update.hold(d.args?.reason, typeof d.args?.keepId === 'string' ? {keep: () => keepMessage(st, d.args.keepId)} : {}), id = uid(); st.messageHolds ||= new Map(); st.messageHolds.set(id, h); value = id; }
      if (d.op === 'badge.set') value = svc.badge.set(d.args?.n, { more: d.args?.more === true });
      if (d.op === 'audio.duck') value = await svc.audio.duck(d.args?.on === true);
      if (d.op.startsWith('vault.')) { try { value = await svc.vault[d.op.slice(6)](d.op === 'vault.seal' ? d.args?.secret : d.args?.title, d.args?.title); } catch (err) { reply(null, 'vault:' + (err.code || 'failed')); return; } }
      if (d.op === 'titlebar.set') value = svc.titlebar.set(d.args?.tools);
      if (d.op === 'orb.set') value = svc.orb.set(d.args?.spec);
      if (d.op === 'identity.info') value = await svc.identity.info();
      if (d.op === 'identity.sign') value = await svc.identity.sign(d.args?.event);
      if (d.op === 'identity.nip44_encrypt') value = await svc.identity.nip44_encrypt(d.args);
      if (d.op === 'identity.nip44_decrypt') value = await svc.identity.nip44_decrypt(d.args);
      if (d.op === 'update.release') { st.messageHolds?.get(d.args?.id)?.release(); st.messageHolds?.delete(d.args?.id); value = true; }
      reply(value);
    } catch (err) { reply(null, String(err.message || err).slice(0, 200)); }
    finally { st.requests.delete(d.id); }
  });
  function mount() { new MutationObserver(reconcile).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  // Liveness is diagnostic only. Never discard a hold or recorder because a clock ran out.
  setInterval(() => {
    reconcile();
    for (const st of frames.values()) if (st.doc && valid(st, st.doc)) {
      try { if (st.client?.alive?.() === true) st.lastAlive = Date.now(); } catch (_) {}
      st.suspect = Date.now() - st.lastAlive > 60000;
    }
  }, 15000);
  function guardBack(step, toast) {
    let watcher = null, armed = false;
    // James: every shell stays home at root, including an ordinary browser tab.
    // Keep this in the shared guard too: adapters must not need to fake a handled
    // step to prevent the old double-Back exit path.
    function consume() {
      if (!step()) toast?.('⌂', "You're home · Back never leaves Wizard", 1400);
    }
    function arm() {
      if (!armed && navigator.userActivation?.isActive) { history.pushState({ ...history.state, __wizardShellGuard: true }, ''); armed = true; }
      if (!watcher && 'CloseWatcher' in window) { watcher = new CloseWatcher(); watcher.onclose = () => { watcher = null; consume(); setTimeout(arm, 0); }; }
    }
    rootArm = arm; document.addEventListener('pointerdown', arm, true);
    addEventListener('popstate', e => {
      if (e.state?.__wizardApp?.version === VERSION) return;
      armed = false;
      consume(); history.pushState({ ...history.state, __wizardShellGuard: true }, ''); armed = true;
    });
  }
  // Only a trusted installed catalog capability admits app voice input.
  // No endpoint supplied by apps; no postMessage/global RPC. A token binds the live
  // document AND receiver at recording start. Reload/navigation requires recovery,
  // never a replacement recipient or a fallback to Chats.
  const conversationPins = new Map();
  const voiceApp = appId => apps().find(a => a.id === appId && a.kind === 'wizard' && a.url && a.receives_voice_input === true);
  const receiverOf = st => st?.client?.voiceInput || st?.client?.conversation;
  function voiceAuthorized(st, appId) {
    const app = voiceApp(appId); if (!app || !st) return false;
    try {
      const url = new URL(app.url, location.href);
      return url.origin === ORIGIN && url.href === st.url.href && valid(st, st.doc);
    } catch (_) { return false; }
  }
  function freezeTarget(value) {
    let nodes = 0, chars = 0;
    function copy(v, depth) {
      if (++nodes > 256 || depth > 8) throw fault('Voice target too complex');
      if (v === null || typeof v === 'boolean') return v;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') { chars += v.length; if (chars > 8192) throw fault('Voice target too large'); return v; }
      if (!v || typeof v !== 'object' || Object.prototype.toString.call(v) !== (Array.isArray(v) ? '[object Array]' : '[object Object]')) throw fault('Voice target must be JSON');
      const out = Array.isArray(v) ? [] : {};
      for (const key of Object.keys(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fault('Invalid voice target key');
        chars += key.length; if (chars > 8192) throw fault('Voice target too large');
        out[key] = copy(v[key], depth + 1);
      }
      return Object.freeze(out);
    }
    if (!value || Array.isArray(value) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 160) throw fault('Voice target needs a label');
    return copy(value, 0);
  }
  function pinConversation(frame, appId) {
    const app = voiceApp(appId); if (!app) return null;
    const st = frames.get(frame), token = 'conversation-' + crypto.randomUUID();
    const pin = { appId, token, label: String(app.name || appId).slice(0, 160), target: null };
    try {
      if (!voiceAuthorized(st, appId) || !st.doc || st.appId !== appId) throw fault('App frame unavailable');
      const receiver = receiverOf(st);
      if (typeof receiver?.snapshot !== 'function' || typeof receiver?.receive !== 'function') throw fault('Voice receiver unavailable');
      const target = receiver.snapshot();
      if (target === null) return null; // deliberate inactive view, unlike absent/broken receiver
      pin.target = freezeTarget(target);
      pin.label = pin.target.label;
      conversationPins.set(token, { st, doc: st.doc, receiver, target: pin.target });
    } catch (_) { /* Keep a sealed unavailable destination, not a null/fallback route. */ }
    return Object.freeze(pin);
  }
  async function deliverConversation(pin, message) {
    const held = conversationPins.get(pin?.token);
    const authorize = () => {
      if (!held || pin.appId !== held.st.appId || !voiceAuthorized(held.st, pin.appId) || !valid(held.st, held.doc) || receiverOf(held.st) !== held.receiver)
        throw fault('App view closed, reloaded or unavailable · recording kept; copy transcript from Recordings');
    };
    authorize();
    if (!message || !/^[A-Za-z0-9_-]{8,100}$/.test(message.request_id || '') || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 12000 || message.files?.length)
      throw fault('App voice input accepts text only, up to 12000 characters · original kept');
    const receipt = await held.receiver.receive(Object.freeze({ request_id: message.request_id, text: message.text, target: held.target }), authorize);
    // Receipt is evidence of durable admission even if focus changed during POST.
    if (receipt?.accepted !== true || receipt.request_id !== message.request_id) throw fault('App receipt uncertain · original kept');
    return { accepted: true, request_id: message.request_id };
  }
  // Same list as chats.js HOSTED_APPS: apps whose conversations are the real Chats thread over their window.
  function hostedThreadAuthorized(st) {
    if (!st || !window.WizLauncher?.hasHostedThread(st.appId) || !valid(st, st.doc) || typeof st.openThread !== 'function') return false;
    const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.url);
    try { return !!app && new URL(app.url, location.href).href === st.url.href; } catch (_) { return false; }
  }
  function managerAuthorized(st) {
    if (!st || st.appId !== 'wizard-manager' || !valid(st, st.doc) || typeof st.openThread !== 'function') return false;
    const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.url);
    try { return !!app && new URL(app.url, location.href).href === st.url.href; } catch (_) { return false; }
  }
  function ownsThreadLink(source, anchor) {
    const st = from(source);
    if (!managerAuthorized(st)) return false;
    try {
      const u = new URL(anchor.href);
      return u.origin === ORIGIN && u.pathname === '/wizard-os-home/' &&
        !!anchor.dataset.wizardNativeThread && u.searchParams.get('session') === anchor.dataset.wizardNativeThread;
    } catch (_) { return false; }
  }
  /* Reload plan for the "Update ready" banner. A native meeting keeps recording through a shell reload (see
   * WizAppCapture.reloadCheck); its app's capture holds ("… recording", "… capture …") are then not a reason
   * to wait, because the app reattaches to the same meeting after load. Every other hold still blocks:
   * kind 'capture' (a recording that would stop or a save after Stop) or 'work' (unsaved app state). */
  const CAPTURE_HOLD = /record|captur/i;
  function reloadPlan() {
    reconcile();
    let cap;
    try { cap = window.WizAppCapture?.reloadCheck?.(); } catch (_) { cap = { safe: false, reason: 'capture' }; }
    if (!cap) { const s = window.WizAppCapture?.getState?.(); cap = s && (s.hold || s.active || s.recording) ? { safe: false, reason: 'capture' } : { safe: true, keeps: null }; }
    let keeps = cap.safe ? cap.keeps || null : null; const blocking = [];
    // A live Android meeting with no stored row (phone storage broken): keep only the meeting app's own frame,
    // and only while it holds a recording. Every other app's capture holds keep blocking.
    if (cap.safe && !keeps && cap.meetingApp) {
      const st = [...frames.values()].find(f => f.appId === cap.meetingApp && [...f.holds.values()].some(r => CAPTURE_HOLD.test(r)));
      if (st) keeps = { appId: st.appId };
    }
    if (!cap.safe) blocking.push({ source: 'capture', appId: cap.appId || null, kind: 'capture', reason: cap.reason || 'capture', startedAt: cap.startedAt || null });
    for (const st of frames.values()) for (const [id, reason] of st.holds) {
      if (st.drafts?.get(id)?.kept) continue;
      const capture = CAPTURE_HOLD.test(reason);
      // App-owned holds are released only by their owner. Durable shared storage cannot prove an
      // app has no private in-memory work. Only the existing native-survival contract passes here.
      if (capture && keeps && st.appId === keeps.appId) continue;
      blocking.push({ source: 'frame', appId: st.appId, kind: capture ? 'capture' : 'work', reason, keepable: !!st.drafts?.has(id) });
    }
    // A blocker says reload is unsafe, not that a known recording will eventually end.
    return { ok: !blocking.length, keeps, capture: cap, blocking, recording: cap.waitForEnd === true };
  }
  // Preparation is non-destructive: an async flush may reveal new work and abort the reload.
  // All frames share one 1.5s budget. Late callbacks, edits and document changes cannot admit reload.
  async function keepDrafts(frame = null) {
    reconcile();
    const now = typeof performance === 'undefined' ? () => Date.now() : () => performance.now();
    const deadline = now() + 1500;
    await Promise.all([...frames.values()].filter(st => !frame || st.frame === frame).flatMap(st => [...(st.drafts || [])].map(async ([id, draft]) => {
      if (draft.kept || !valid(st, draft.doc)) return;
      const generation = draft.generation;
      let timer;
      try {
        // Timers cannot run during synchronous persistence; check the clock at both boundaries.
        const result = await Promise.race([Promise.resolve().then(() => now() < deadline ? draft.keep() : false), new Promise(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - now())); })]);
        if (result === 'kept' && now() < deadline && valid(st, draft.doc) && st.drafts?.get(id) === draft && generation === draft.generation) draft.kept = true;
      } catch (_) { /* No confirmation means the original hold stays. */ }
      finally { clearTimeout(timer); }
    })));
    changed();
    return reloadPlan();
  }
  function keepMessage(st, keepId) {
    return new Promise(resolve => {
      const id = uid(), doc = st.doc;
      const done = e => {
        if (e.source !== st.frame.contentWindow || e.origin !== ORIGIN || !valid(st, doc) || e.data?.type !== 'wizard:app:kept' || e.data.version !== VERSION || e.data.id !== id) return;
        finish(e.data.result === 'kept' ? 'kept' : false);
      };
      const finish = result => { clearTimeout(timer); removeEventListener('message', done); resolve(result); };
      const timer = setTimeout(() => finish(false), 1500);
      addEventListener('message', done);
      try { st.frame.contentWindow.postMessage({type: 'wizard:app:keep', version: VERSION, id, keepId}, ORIGIN); } catch (_) { finish(false); }
    });
  }
  async function prepareReload(plan) {
    if (plan?.keeps) await window.WizAppCapture?.prepareReload?.();
  }
  // Commit only after the caller's final safety check, synchronously adjacent to location.reload().
  // Removing the kept frame avoids its standalone beforeunload prompt; its recorder lives in the shell.
  function commitReload(plan) {
    if (!plan?.keeps) return;
    for (const st of [...frames.values()]) if (st.appId === plan.keeps.appId) {
      // Come back to the same place in the app (the meeting being recorded): frames keep only path + query.
      try { const l = st.frame.contentWindow.location; if (valid(st) && l.hash && l.hash !== '#' && l.hash !== '#/') sessionStorage.setItem(RETURN_KEY, JSON.stringify({ appId: st.appId, path: l.pathname + l.search, hash: l.hash.slice(0, 512), at: Date.now() })); } catch (_) {}
      try { st.detach(); st.frame.remove(); } catch (_) {}
    }
  }
  // Per-app update check (core/app-versions.js): attached same-origin app frames, whether each is on screen, and
  // what would be lost by reloading it. A frame with no isVisible host (single-app session) is the whole page.
  function updateFrames() {
    reconcile();
    return [...frames.values()].filter(st => valid(st)).map(st => {
      let visible = true; try { if (st.isVisible) visible = st.isVisible() === true; } catch (_) { visible = false; }
      return Object.freeze({ frame: st.frame, appId: st.appId, visible, holds: [...st.holds].filter(([id]) => !st.drafts?.get(id)?.kept).map(([,reason]) => reason), keepable: [...(st.drafts?.values() || [])].some(d => !d.kept), suspect: !!st.suspect });
    });
  }
  // One-shot, after a reload that kept a recording: put the kept app's frame back on the route it showed.
  const RETURN_KEY = 'wos.reload-return.v1';
  function restoreReturn(st) {
    let r; try { r = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null'); } catch (_) { r = null; }
    if (!r || r.appId !== st.appId) return;
    try {
      const w = st.frame.contentWindow, here = w.location;
      if (Date.now() - r.at > 10 * 60e3) { sessionStorage.removeItem(RETURN_KEY); return; }
      if (!valid(st) || here.href === 'about:blank' || here.pathname + here.search !== r.path) return; // not loaded yet
      sessionStorage.removeItem(RETURN_KEY);
      if (!here.hash || here.hash === '#' || here.hash === '#/') here.hash = r.hash;
    } catch (_) {}
  }
  /* Closed means closed (James, 19 Oct 2026). Each shell reports the app ids that still have a window after a
   * close; any app outside that set loses its microphone at once (its take is saved for recovery, never
   * discarded). Hidden desks, Back and frame reloads keep the window, so they never reach this. */
  function appsClosed(openIds) {
    const open = new Set([...(openIds || [])].filter(Boolean)), cap = window.WizAppCapture;
    if (!cap?.closeApp) return [];
    reconcile(); // a still-mounted frame of the app (any surface) also counts as open
    for (const f of frames.values()) if (f.frame.isConnected && !f.frame.dataset?.voiceService) open.add(f.appId);
    const st = cap.getState?.() || {}, owners = new Set();
    if (st.active && st.appId) owners.add(st.appId);
    const stopped = [];
    for (const appId of owners) if (!open.has(appId)) {
      try { stopped.push(cap.closeApp(appId).catch(() => null)); } catch (_) {}
    }
    return stopped;
  }
  // The shell registers its window model once; every frame detach (a window closing) then re-checks it.
  let openProvider = null, sweepTimer = 0;
  function trackOpenApps(fn) { openProvider = typeof fn === 'function' ? fn : null; }
  function queueSweep() {
    if (!openProvider || sweepTimer) return;
    sweepTimer = setTimeout(() => { sweepTimer = 0; try { appsClosed(openProvider()); } catch (_) {} }, 0);
  }
  // Installed providers may opt into cold command handling with the existing
  // `provides` capability list. The app owns grammar; core only warms its page.
  const voiceFrames = new Map();
  let warmingVoice = false;
  function warmVoice() {
    if (warmingVoice || !document.createElement || !document.body) return;
    warmingVoice = true;
    try {
    // Browser owner boundary (wizard-os#133, box switch): no hidden app frames. They would run app code unsandboxed and
    // out of sight, and voice commands need same-origin access; any already warmed are removed.
    const wanted = window.WizBrowserBoundary?.enabled ? new Map() : new Map(apps().filter(a => a.provides?.includes('voice-commands')).slice(0, 64).map(a => [a.id, a]));
    for (const [id, entry] of voiceFrames) if (!wanted.has(id) || wanted.get(id).url !== entry.url) { entry.detach(); entry.frame.remove(); voiceFrames.delete(id); }
    for (const [id, app] of wanted) {
      if (voiceFrames.has(id)) continue;
      let url; try { url = new URL(app.url, location.href); } catch (_) { continue; }
      if (url.origin !== location.origin) continue;
      const frame = document.createElement('iframe'); frame.className = 'appframe'; frame.hidden = true; frame.dataset.voiceService = id;
      frame.src = url.href; frame.style.display = 'none'; frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('tabindex', '-1');
      document.body.appendChild(frame);
      const detach = attach(frame, {appId:id, path:app.url});
      voiceFrames.set(id, {frame, detach, url:app.url});
    }
    } finally { warmingVoice = false; }
  }
  addEventListener('wizard:apps', warmVoice);
  addEventListener('DOMContentLoaded', warmVoice);
  setTimeout(warmVoice, 0);
  const voiceClaims = new Map();
  function voiceCommand(text, context) {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) return null;
    const meta = Object.freeze({stage:context.stage, kind:context.kind, view:Object.freeze({kind:String(context.view?.kind || ''), appId:String(context.view?.appId || '')})});
    for (const app of apps()) for (const st of frames.values()) {
      try {
        const handler = st.client?.voiceCommands;
        if (st.appId !== app.id || typeof handler?.claims !== 'function' || typeof handler?.receive !== 'function' || !valid(st, st.doc)) continue;
        if (handler.claims(text, meta) !== true || !valid(st, st.doc)) continue;
        const token = uid();
        if (voiceClaims.size >= 32) voiceClaims.delete(voiceClaims.keys().next().value);
        voiceClaims.set(token, {st, doc:st.doc, handler, text, meta});
        return {action:'app_voice', appId:st.appId, token};
      } catch (_) {} // An app's bad claim cannot swallow shell commands.
    }
    return null;
  }
  function runVoiceCommand(command, done) {
    const claim = voiceClaims.get(command.token); voiceClaims.delete(command.token);
    if (!claim || !valid(claim.st, claim.doc) || claim.st.client?.voiceCommands !== claim.handler) return false;
    try {
      Promise.resolve(claim.handler.receive(claim.text, claim.meta)).then(ok => done?.(ok === true), () => done?.(false));
      return true;
    } catch (_) { done?.(false); return false; }
  }
  // Per app id, over every window of that app: 2 at once, and 30 files or 150 MB in any 10 minutes.
  const TRANSCRIBE = Object.freeze({ at: 2, calls: 30, bytes: 150 * 1024 * 1024, window: 10 * 60 * 1000 });
  const transcribeUse = new Map();
  function transcribeBudget(appId, file, now = Date.now()) {
    const use = transcribeUse.get(appId) || { running: 0, log: [] };
    use.log = use.log.filter(e => now - e.at < TRANSCRIBE.window);
    const size = Number(file?.size) || 0, spent = use.log.reduce((n, e) => n + e.size, 0);
    if (use.running >= TRANSCRIBE.at || use.log.length >= TRANSCRIBE.calls || spent + size > TRANSCRIBE.bytes) throw fault('Transcription budget for this app is used up for now');
    use.running++; use.log.push({ at: now, size }); transcribeUse.set(appId, use);
    let done = false;
    return () => { if (!done) { done = true; use.running--; } };
  }
  // Under the boundary a sandboxed app sets its own badge and title bar, shares out (also to Wizard), receives shares,
  // transcribes, holds shell updates, ducks Wizard Music, uses its fingerprint vault and asks for Wizard ID over the
  // boundary channel (browser-boundary.js).
  function holdFor(st, reason) {
    if (st.holds.size >= 64) throw fault('Too many update holds');
    const id = uid(); st.holds.set(id, String(reason || 'Unsaved work').slice(0, 160)); changed();
    return id;
  }
  // The fingerprint vault (Android) for a sandboxed app: the same per-app secret, always under the window's installed
  // app id (vaultCall adds it; the page never names one). The prompt shows only while that window is steadily in front,
  // and a secret goes back only to the same document that asked (gen), so a reload or another page in the window never
  // gets it. Errors cross as `vault:<code>` (app-client turns them back into error.code).
  async function boundaryVault(st, frame, method, args) {
    const B = window.WizBrowserBoundary, gen = B.gen(frame), alive = () => boundaryLive(st) && B.gen(frame) === gen;
    const fail = code => fault('vault:' + (/^[a-z_]{1,32}$/.test(String(code)) ? code : 'failed'));
    const text = (v, n) => (typeof v === 'string' && v.length <= n ? v : undefined);
    const extra = {};
    if (method === 'seal') { extra.secret = text(args?.secret, 4096); if (!extra.secret) throw fail('invalid'); }
    if (method === 'seal' || method === 'open') {
      const title = text(args?.title, 200); if (title !== undefined) extra.title = title;
      try { await whenInFront(st, alive); } catch (e) { throw fail(e.code || 'failed'); }
      if (!alive()) throw fail('cancelled');
      if (!inFront(st)) throw fail('not_in_front');
    }
    let result;
    try { result = await vaultCall(st.appId, method, extra); } catch (e) { throw fail(e.code || 'failed'); }
    if (!alive()) throw fail('cancelled'); // no secret to a reloaded, navigated or closed document
    return result;
  }
  // Wizard ID (Android) for a sandboxed app: the same rule as identity() above, checked by what the shell controls.
  // Only an installed `kind:wizard` apps.json app; the phone's own approval sheet (biometric/PIN) names the app from
  // the catalog, never from the page. A sheet opens only while that window is steadily in front, and an answer goes
  // back only to the same document that asked (gen), so a reload or another page in the window never gets it.
  async function boundaryIdentity(st, frame, method, args) {
    const B = window.WizBrowserBoundary, gen = B.gen(frame), alive = () => boundaryLive(st) && B.gen(frame) === gen;
    const authorize = () => {
      const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.source === 'apps.json');
      if (!app || !alive() || st.url.origin !== ORIGIN) throw fault('Wizard ID needs an installed app');
      return app;
    };
    const app = authorize(), bridge = window.WizCore?.bridge;
    if (!window.wizardDevicePort || !bridge?.call) return { unavailable: true }; // Desktop-to-phone routing is not v1.
    const params = identityParams(app, method, args);
    const payload = JSON.stringify(params); // a copy: the request can't change after the sheet opens
    if (payload.length > 140000) throw fault('Wizard ID request too large');
    if (method !== 'info') {
      try { await whenInFront(st, alive); } catch (e) { throw fault('Wizard ID: ' + (e.code === 'not_in_front' ? 'not_in_front' : 'cancelled')); }
      authorize();
    }
    const result = await bridge.call('identity.' + method, JSON.parse(payload));
    authorize(); // no signature or plaintext to a reloaded, navigated, closed or uninstalled window
    return result;
  }
  // Recording (capture) for a sandboxed app: the shell's one recorder (core/app-capture.js) records for the window's
  // installed app id, exactly as for a same-origin app; the page gets its sessions over the boundary channel.
  //  - A NEW recording needs a real tap in that window: browser-boundary.js hands `tapped` (a tap or key in this
  //    focused, visible frame just now), or the start names a recording this document prepared on such a tap in the
  //    last minute (the app may ask its own backend in between). Reattaching or resuming this app's own take does not
  //    (a reload must not stop or lose a meeting).
  //  - Events (level, PCM, chunks, state, warnings) go only to the document that started or attached the session; a
  //    new document gets none until it attaches. A reload never stops the recorder (as same-origin).
  //  - The recorder is held for a shell update from before the microphone prompt until it stops, also across a reload.
  //  - Hold to record on a touch screen: the browser counts a touch as a tap only when the finger lifts, so a start on
  //    touch-down has no tap yet. The client marks such a start `press` (a finger is down in it now). The recorder
  //    starts at once, in front only and without computer audio, but the take is HELD: nothing of it (no level, audio,
  //    chunks) reaches the page until a real tap in this visible window confirms it (`lifted` from browser-boundary.js:
  //    a finger lifting after a long press activates the frame without focusing it). The client then asks
  //    `capture.confirm`, or the app's own Stop comes right then. Unconfirmed within PRESS_MS, stopped without a tap, or
  //    its document gone: the take is discarded, so a page alone never gets audio.
  const CAPTURE_OPTS = ['kind', 'mime', 'audio', 'pcm', 'chunkMs', 'maxMs', 'maxBytes', 'systemAudio', 'meta', 'seqBase', 'offsetMs', 'preparedId', 'resumeId'];
  const CAPTURE_CALLS = ['stop', 'cancel', 'pause', 'resume', 'setSystemAudio', 'chunks', 'info'];
  const PREPARED_MS = 60000, PRESS_MS = 120000, PRESS_QUEUE = 4000;
  function captureOpts(opts) {
    const o = {};
    if (opts && typeof opts === 'object') for (const k of CAPTURE_OPTS) if (opts[k] !== undefined && typeof opts[k] !== 'function') o[k] = opts[k];
    const safe = JSON.parse(JSON.stringify(o)); // data only: no callbacks or objects from the page reach the recorder
    if (['auto', 'command', 'dictation'].includes(safe.kind)) throw fault('Capture kind is reserved for Wizard voice; use audio/meeting and task metadata');
    return safe;
  }
  const captureInfo = session => { try { return session.getInfo(); } catch (_) { return null; } };
  const captureCaps = () => {
    const R = window.WizAppCapture, caps = {};
    for (const meeting of [false, true]) for (const pcm of [false, true]) {
      try { caps[(meeting ? 'meeting' : 'audio') + (pcm ? '-pcm' : '')] = R?.capabilities?.({ kind: meeting ? 'meeting' : 'audio', pcm }) || {}; } catch (_) { caps[(meeting ? 'meeting' : 'audio') + (pcm ? '-pcm' : '')] = {}; }
    }
    return caps;
  };
  function captureCurrent(st) { try { return window.WizAppCapture?.current?.(st.appId) || null; } catch (_) { return null; } }
  // What this app's recorder holds now, to every ready sandboxed window of the app when it changes.
  function captureAnnounce() {
    const B = window.WizBrowserBoundary; if (!B?.notice) return;
    for (const st of frames.values()) {
      if (!st.bcap || !boundaryLive(st)) continue;
      const now = captureCurrent(st), key = JSON.stringify(now);
      if (key === st.bcap.said) continue;
      st.bcap.said = key; B.notice(st.frame, 'capture', { event: 'current', value: now });
    }
  }
  addEventListener('wizard-app-capture-state', captureAnnounce);
  const shellVoiceBusy = () => { const shell = window.__wos || window.__wux; return !!(shell?.voice && shell.voice !== 'idle'); };
  // Forget this window's sessions and preparations of documents other than `gen` (all of them for null). The recorder
  // itself keeps going.
  function captureForget(st, gen) {
    const c = st.bcap; if (!c) return;
    for (const [id, e] of c.sessions) if (e.gen !== gen) { if (e.held) captureDrop(st, e); for (const off of e.offs) { try { off(); } catch (_) {} } c.sessions.delete(id); }
    for (const [id, p] of c.prepared) if (p.gen !== gen) { c.prepared.delete(id); try { p.release(); } catch (_) {} }
    c.said = undefined;
  }
  // Held takes not yet confirmed, kept in the shell's own storage (a page can't reach it): a take still held when the
  // shell itself reloads is never handed to the app afterwards (pending, attach, resume); it is discarded instead.
  const HELD_KEY = 'wos.capture.held.v1';
  const heldIds = () => { try { const v = JSON.parse(window.localStorage.getItem(HELD_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch (_) { return []; } };
  const heldMark = (id, on) => {
    try {
      const ids = heldIds().filter(x => x !== id); if (on) ids.push(id);
      if (ids.length) window.localStorage.setItem(HELD_KEY, JSON.stringify(ids.slice(-20))); else window.localStorage.removeItem(HELD_KEY);
    } catch (_) {}
  };
  // A held take (see the header) that was never confirmed: discard it; none of it ever reached the page.
  function captureDrop(st, e, frame) {
    const h = e.held; if (!h) return; e.held = null; clearTimeout(h.timer);
    const id = e.session.id; st.bcap?.unconfirmed.add(id);
    for (const off of e.offs) { try { off(); } catch (_) {} }
    if (st.bcap?.sessions.get(id) === e) st.bcap.sessions.delete(id);
    Promise.resolve().then(() => e.session.cancel()).catch(() => {}).finally(() => { e.release(); heldMark(id, false); st.bcap?.unconfirmed.delete(id); });
    if (frame) { try { window.WizBrowserBoundary.notice(frame, 'capture', { id, event: 'warn', value: 'Recording needs a tap in the app. It was discarded.' }); } catch (_) {} }
  }
  function captureConfirm(e) {
    const h = e.held; if (!h) return; e.held = null; clearTimeout(h.timer); heldMark(e.session.id, false);
    for (const [event, value] of h.queue) e.deliver(event, value);
  }
  // Takes held when the shell reloaded: discarded, never listed.
  async function heldStale(R, appId, takes) {
    const stale = new Set(heldIds()); if (!stale.size) return takes;
    const keep = [];
    for (const t of takes) {
      if (!stale.has(t?.id)) { keep.push(t); continue; }
      try { await R.ack(appId, t.id); } catch (_) {}
      heldMark(t.id, false);
    }
    return keep;
  }
  async function boundaryCapture(st, frame, method, args, ctx) {
    const B = window.WizBrowserBoundary, R = window.WizAppCapture, gen = B.gen(frame), alive = () => boundaryLive(st) && B.gen(frame) === gen;
    if (!R) throw fault('Shared capture unavailable');
    if (!st.bcap) { st.bcap = { sessions: new Map(), prepared: new Map(), said: undefined, unconfirmed: new Set() }; (st.captureOffs ||= new Set()).add(() => captureForget(st, null)); }
    const c = st.bcap, out = value => ({ capture: value === undefined ? null : value });
    if (method === 'capture.sync') { const current = captureCurrent(st); c.said = JSON.stringify(current); return out({ current, caps: captureCaps() }); }
    if (method === 'capture.pending') { const takes = await R.pending(st.appId); return out(Array.isArray(takes) ? await heldStale(R, st.appId, takes) : takes); }
    if (method === 'capture.ack') { if (typeof args?.id !== 'string') throw fault('Invalid capture id'); await R.ack(st.appId, args.id); return out(true); }
    if (method === 'capture.settle') { const keep = typeof args?.keepId === 'string' ? args.keepId : null; return out(await R.settle(st.appId, keep)); }
    if (method === 'capture.release') { const p = c.prepared.get(args?.id); if (p && p.gen === gen) { c.prepared.delete(args.id); p.release(); } return out(true); }
    if (method === 'capture.prepare') {
      if (!ctx?.tapped) throw fault('Recording needs a tap in the app');
      if (shellVoiceBusy()) throw Object.assign(fault('Microphone held by Wizard voice'), { code: 'busy' });
      if (!R.prepare) throw fault('Capture preparation unavailable');
      if (c.prepared.size >= 8) throw fault('Too many prepared recordings');
      const p = R.prepare(st.appId, captureOpts(args?.opts));
      c.prepared.set(p.id, { gen, at: Date.now(), release: p.release });
      return out({ id: p.id });
    }
    if (method === 'capture.confirm') {
      // A lift while this document's press start is still on its way (a slow microphone prompt outlives the tap): the
      // start confirms itself when it lands (Codex P2).
      if (ctx?.lifted) c.lift = { gen, at: Date.now() };
      const e = c.sessions.get(args?.id);
      if (!e || e.gen !== gen || !e.held || !ctx?.lifted) return out(!!(e && e.gen === gen && !e.held));
      captureConfirm(e); return out(true);
    }
    if (method === 'capture.call') {
      const e = c.sessions.get(args?.id), what = args?.method;
      if (!e || e.gen !== gen) throw fault('This recording is not this page\'s');
      if (!CAPTURE_CALLS.includes(what)) throw fault('Capture method unavailable');
      if (e.held) {
        // The finger lifting is the tap that confirms a held take (the app's Stop usually comes right then).
        if (ctx?.lifted) captureConfirm(e);
        else if (what === 'stop') { captureDrop(st, e, frame); throw fault('Recording needs a tap in the app'); }
        else if (what === 'chunks' || what === 'setSystemAudio') throw fault('Recording needs a tap in the app');
        else if (what === 'cancel') { captureDrop(st, e); return out(null); }
      }
      if (what === 'info') return out(captureInfo(e.session));
      if (what === 'stop' || what === 'cancel') {
        // Stop and Discard are distinct intents; the recorder arbitrates their race (as same-origin).
        if (!e.finished[what]) e.finished[what] = Promise.resolve().then(() => e.session[what]()).then(r => { e.release(); return r; }, err => { delete e.finished[what]; throw err; });
        return out(await e.finished[what]);
      }
      if (what === 'setSystemAudio') return out(await e.session.setSystemAudio(args?.args?.on === true));
      if (!e.session[what]) throw fault('Capture method unavailable');
      return out(await e.session[what]());
    }
    if (method !== 'capture.start') throw fault('Not available');
    const attaching = args?.attach === true, opts = attaching ? {} : captureOpts(args?.opts);
    // This document's own preparation, taken out of the list now. Until the recorder uses it, every way out of this
    // start releases it (an unused preparation keeps an AudioContext and the recorder's hold; Codex P1). The recorder
    // ignores a release of one it already used.
    let prep = null;
    if (opts.preparedId !== undefined) {
      const p = c.prepared.get(opts.preparedId);
      if (p && p.gen === gen) { c.prepared.delete(opts.preparedId); prep = p; } else delete opts.preparedId;
      if (prep && Date.now() - prep.at > PREPARED_MS) { prep.release(); prep = null; delete opts.preparedId; }
    }
    const unprepare = () => { if (prep) { try { prep.release(); } catch (_) {} prep = null; } };
    const fresh = !attaching && !opts.resumeId;
    // A start on touch-down (see the header): only while this window is in front, one at a time, no computer audio.
    const press = fresh && !ctx?.tapped && !prep && args?.press === true && !opts.systemAudio && inFront(st) && ![...c.sessions.values()].some(x => x.held);
    if (fresh && !ctx?.tapped && !prep && !press) { unprepare(); throw fault('Recording needs a tap in the app'); }
    if (shellVoiceBusy()) { unprepare(); throw Object.assign(fault('Microphone held by Wizard voice'), { code: 'busy', appId: 'wizard-voice' }); }
    // The hold is the recorder's, not the document's: it stays across a reload until the recording stops (onReset keeps
    // sheetHolds).
    const hold = holdFor(st, 'Recording'); (st.sheetHolds ||= new Set()).add(hold);
    let released = false;
    const release = () => { if (released) return; released = true; removeEventListener('wizard-app-capture-state', onState); st.sheetHolds.delete(hold); if (st.holds.delete(hold)) changed(); };
    const onState = () => { if (R.getState?.().active === false) release(); };
    addEventListener('wizard-app-capture-state', onState);
    let session; const t0 = Date.now();
    try {
      session = await (attaching ? R.attach(st.appId) : opts.resumeId && R.resume ? R.resume(st.appId, opts.resumeId, opts) : R.start(st.appId, opts));
      if (!session) { release(); unprepare(); return out(null); }
      if (!alive()) throw fault('App frame is no longer authorized');
    } catch (err) {
      unprepare();
      // The microphone prompt can outlive this document: stop and keep the take (a document that attached meanwhile owns it).
      if (session && !session.reattached?.()) { try { await session.stop(); } catch (_) {} }
      release();
      if (err.code === 'busy' && err.appId) {
        const owner = apps().find(a => a.id === err.appId);
        err.message = 'The microphone is recording in ' + (owner?.name || String(err.appId).replace(/[-_]/g, ' ')) + '. Stop that recording first.';
      }
      throw err;
    }
    const old = c.sessions.get(session.id);
    // A held take is never handed to anyone but the document that pressed it, and stays held for it. One held when the
    // shell reloaded has nobody to confirm it: it is discarded.
    if (c.unconfirmed.has(session.id) || (old?.held && old.gen !== gen)) { release(); return out(null); }
    if (!press && !old?.held && heldIds().includes(session.id)) {
      try { await session.cancel(); } catch (_) {}
      heldMark(session.id, false); release(); return out(null);
    }
    if (old) for (const off of old.offs) { try { off(); } catch (_) {} }
    const e = { session, gen, offs: [], finished: {}, release, infoAt: 0, held: null };
    const holdUntil = until => { e.held = { queue: old?.held?.queue || [], until, timer: setTimeout(() => captureDrop(st, e, frame), Math.max(0, until - Date.now())) }; };
    if (old?.held) { clearTimeout(old.held.timer); holdUntil(old.held.until); old.held = null; }
    else if (press) { heldMark(session.id, true); holdUntil(Date.now() + PRESS_MS); }
    c.sessions.set(session.id, e);
    if (e.held && c.lift?.gen === gen && c.lift.at >= t0) captureConfirm(e);
    // Events go to this document only. Levels come many times a second; the session info rides along at most once a second.
    e.deliver = (event, value) => {
      if (c.sessions.get(session.id) !== e || !alive()) return;
      const now = Date.now(), withInfo = event !== 'level' && event !== 'pcm' || now - e.infoAt >= 1000;
      if (withInfo) e.infoAt = now;
      B.notice(frame, 'capture', { id: session.id, event, value, ...(withInfo ? { info: captureInfo(session) } : {}) });
    };
    // A held take keeps its events (not the levels, which are only live) until it is confirmed.
    const send = (event, value) => {
      if (!e.held) return e.deliver(event, value);
      if (event === 'level' || c.sessions.get(session.id) !== e) return;
      if (e.held.queue.length >= PRESS_QUEUE) return captureDrop(st, e, frame);
      e.held.queue.push([event, value]);
    };
    for (const [event, on] of [['level', 'onLevel'], ['pcm', 'onPcm'], ['chunk', 'onChunk'], ['state', 'onState'], ['warn', 'onWarn']]) {
      if (typeof session[on] !== 'function') continue;
      try { e.offs.push(session[on](v => send(event, event === 'warn' && v && typeof v === 'object' ? String(v.message || '') : v))); } catch (_) {}
    }
    return out({ id: session.id, info: captureInfo(session), ...(e.held ? { held: true } : {}) });
  }
  /* An app's own backend call under the boundary (net.fetch, docs/browser-boundary.md): the page's fetch to this host
   * is made here, with the shell's credentials for this host, but only inside the window's own app path (within(), the
   * same rule as its links) and never to an owner route, so the shell token is never added. The browser hides where a
   * redirect goes until it has followed it, so only GET and HEAD follow one (and an answer from outside the path is
   * refused); a POST or any other method is never sent on to a redirect's address, which may be another app. An address outside the path answers `outside`: the page's own fetch then goes out
   * unchanged (Origin: null), as before. */
  const NET_METHOD = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/, NET_CACHE = ['default', 'no-store', 'reload', 'no-cache', 'force-cache'];
  const NET_DROP = /^(?:x-wizard-shell-token|cookie|cookie2|host|origin|referer)$/i;
  const outside = () => Object.assign(fault('Outside this app'), { code: 'outside' });
  const netTarget = (st, href) => {
    let u; try { u = new URL(String(href)); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    return within(u, st.url) && !window.WizBrowserBoundary.ownerRoute(u.href) ? u : null;
  };
  async function boundaryNet(st, args) {
    const B = window.WizBrowserBoundary, MAX = B.netMax;
    if (!args || typeof args !== 'object' || typeof args.url !== 'string' || args.url.length > 8192) throw fault('Bad request');
    const u = netTarget(st, args.url); if (!u) throw outside();
    const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';
    if (!NET_METHOD.test(method)) throw fault('Method not allowed');
    const headers = new Headers();
    if (Array.isArray(args.headers)) for (const h of args.headers.slice(0, 100)) {
      if (!Array.isArray(h) || typeof h[0] !== 'string' || typeof h[1] !== 'string' || h[0].length > 256 || h[1].length > 16384 || NET_DROP.test(h[0])) continue;
      try { headers.append(h[0], h[1]); } catch (_) {}
    }
    let body;
    if (args.body != null) {
      if (Object.prototype.toString.call(args.body) !== '[object ArrayBuffer]' || args.body.byteLength > MAX) throw fault('Request too large');
      if (method !== 'GET' && method !== 'HEAD') body = args.body;
    }
    const gen = B.gen(st.frame), safe = method === 'GET' || method === 'HEAD';
    // The page can stop its own call (net.abort with this call's key): one key per open call, this window's only.
    const key = typeof args.key === 'string' && args.key.length <= 64 ? args.key : '';
    // A streamed answer (stream: true, with a key) comes back as its status and headers first, then its body in pieces.
    const stream = args.stream === true && !!key;
    const stop = new AbortController(); st.netCalls ||= new Map();
    if (key) {
      if (st.netCalls.has(key)) throw fault('Bad request');
      if (st.netCalls.size >= NET_OPEN) throw fault('Too many open app calls');
      st.netCalls.set(key, stop);
    }
    let pumping = false;
    try {
      const res = await window.fetch(u.href, { method, headers, body, credentials: args.credentials === 'omit' ? 'omit' : 'same-origin', redirect: safe ? 'follow' : 'manual',
        cache: NET_CACHE.includes(args.cache) ? args.cache : 'default', referrerPolicy: 'no-referrer', signal: stop.signal });
      if (res.type === 'opaqueredirect') throw fault('Redirect not followed for ' + method);
      // A redirect may not leave the app's path (another app, an owner route): its answer stays with the shell.
      if (!netTarget(st, res.url || u.href)) { try { res.body?.cancel(); } catch (_) {} throw fault('Redirected outside this app'); }
      if (!stream || !res.body || method === 'HEAD') return await netAnswer(st, res, u, method, gen, MAX);
      if (!boundaryLive(st) || B.gen(st.frame) !== gen) { try { res.body.cancel(); } catch (_) {} throw fault('App document changed'); }
      // The head goes back first (this answer); the pieces follow as `net` notices once it has been sent.
      pumping = true;
      setTimeout(() => netPump(st, key, res.body.getReader(), gen, stop), 0);
      return { net: { status: res.status, statusText: res.statusText, headers: [...res.headers], body: null, stream: true, url: res.url || u.href, redirected: res.redirected === true } };
    } finally { if (!pumping && key && st.netCalls.get(key) === stop) st.netCalls.delete(key); }
  }
  /* A streamed answer's body (server-sent events, a reply that arrives as it is written): pieces of at most NET_PIECE
   * bytes go to the window's current document as `net` notices (chunk, then end or error). The page says how much it
   * has taken (net.ack); the shell reads on only while less than NET_WINDOW bytes wait in between, so a page that stops
   * reading stops the stream (as a browser does). It ends with the call (net.abort), the document (a load) or the
   * window. */
  const NET_OPEN = 16, NET_PIECE = 256 * 1024, NET_WINDOW = 1024 * 1024;
  async function netPump(st, key, reader, gen, stop) {
    const B = window.WizBrowserBoundary, flow = { sent: 0, acked: 0, wake: null };
    const live = () => !stop.signal.aborted && boundaryLive(st) && B.gen(st.frame) === gen && st.netCalls?.get(key) === stop;
    const wake = () => { const w = flow.wake; flow.wake = null; w?.(); };
    stop.signal.addEventListener('abort', wake, { once: true });
    (st.netFlows ||= new Map()).set(key, { ack: n => { if (Number.isFinite(n) && n > flow.acked) { flow.acked = Math.min(n, flow.sent); wake(); } } });
    let ended = false;
    try {
      // Waits while the page has NET_WINDOW bytes or more not yet taken (between reads and between the pieces of one
      // large read alike); false once the call is over.
      const room = async () => { while (live() && flow.sent - flow.acked >= NET_WINDOW) await new Promise(r => { flow.wake = r; }); return live(); };
      read: for (;;) {
        if (!await room()) break;
        const { done, value } = await reader.read();
        if (!live()) break;
        if (done) { ended = true; B.notice(st.frame, 'net', { key, event: 'end' }); break; }
        for (let at = 0; at < value.byteLength; at += NET_PIECE) {
          if (!await room()) break read;
          const piece = value.slice(at, at + NET_PIECE);
          if (!B.notice(st.frame, 'net', { key, event: 'chunk', chunk: piece.buffer })) throw fault('App document changed');
          flow.sent += piece.byteLength;
        }
      }
    } catch (err) {
      ended = true;
      if (live()) B.notice(st.frame, 'net', { key, event: 'error', message: String(err?.message || 'Connection lost').slice(0, 200) });
    } finally {
      stop.signal.removeEventListener('abort', wake);
      if (!ended) { try { reader.cancel(); } catch (_) {} }
      st.netFlows?.delete(key);
      if (st.netCalls?.get(key) === stop) st.netCalls.delete(key);
    }
  }
  async function netAnswer(st, res, u, method, gen, MAX) {
    const B = window.WizBrowserBoundary;
    let out = null;
    if (res.body && method !== 'HEAD') {
      const reader = res.body.getReader(), parts = []; let n = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        n += value.byteLength; if (n > MAX) { try { reader.cancel(); } catch (_) {} throw fault('Answer too large'); }
        parts.push(value);
      }
      const all = new Uint8Array(n); let at = 0; for (const p of parts) { all.set(p, at); at += p.byteLength; }
      out = all.buffer;
    }
    // The window loaded another page meanwhile: that page never gets this answer.
    if (!boundaryLive(st) || B.gen(st.frame) !== gen) throw fault('App document changed');
    return { net: { status: res.status, statusText: res.statusText, headers: [...res.headers], body: out, url: res.url || u.href, redirected: res.redirected === true } };
  }
  /* An app's own WebSocket under the boundary (ws.open, ws.send, ws.close; docs/browser-boundary.md). An opaque page's
   * socket goes out with `Origin: null` and no cookies, and an app server that checks Origin (the Recorder's live
   * transcript) refuses it. So the shell opens it, with this host's origin and cookies, only inside the window's own
   * app path (the same rule as net.fetch) and never to an owner route. Messages from the server go to the window's
   * current document as `ws` notices; the page's own messages come back as ws.send. A socket ends with the page's close,
   * the server, the document (a load) or the window, and at most WS_OPEN are open per window. An address outside the
   * path answers `outside`: the page's own WebSocket then goes out unchanged, as before. */
  const WS_OPEN = 8, WS_MSG = 4 * 1024 * 1024, WS_BUFFER = 16 * 1024 * 1024, WS_WAIT = 45000;
  const WS_PROTOCOL = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
  const wsTarget = (st, href) => {
    let u; try { u = new URL(String(href)); } catch (_) { return null; }
    if (!/^wss?:$/.test(u.protocol) || u.username || u.password || u.hash) return null;
    const h = new URL(u.href); h.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return netTarget(st, h.href) ? u : null;
  };
  // A text message's size as sent: its UTF-8 bytes (a lone surrogate goes as U+FFFD, 3 bytes).
  const utf8 = t => {
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c < 0x80) n++; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length && (t.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; } else n += 3;
    }
    return n;
  };
  const wsBytes = d => (typeof d === 'string' ? utf8(d) : d.byteLength);
  // Every socket of this window closes; no page gets their messages.
  function wsCloseAll(st) { for (const c of [...(st.wsConns?.values() || [])]) c.end(); st.wsConns?.clear(); }
  // A window that went away without a detach (its frame left the page) still closes its sockets (checked every 5 s
  // while any is open).
  const wsOwners = new Set();
  let wsSweep = 0;
  const wsWatch = () => {
    if (wsSweep) return;
    wsSweep = setInterval(() => {
      for (const st of [...wsOwners]) {
        for (const c of [...(st.wsConns?.values() || [])]) if (!c.live()) c.end();
        if (!st.wsConns?.size) wsOwners.delete(st);
      }
      if (!wsOwners.size) { clearInterval(wsSweep); wsSweep = 0; }
    }, 5000);
  };
  function boundaryWsOpen(st, args) {
    const B = window.WizBrowserBoundary;
    if (!args || typeof args !== 'object' || typeof args.url !== 'string' || args.url.length > 8192) throw fault('Bad request');
    const key = typeof args.key === 'string' && args.key && args.key.length <= 64 ? args.key : '';
    if (!key) throw fault('Bad request');
    const u = wsTarget(st, args.url); if (!u) throw outside();
    const protocols = Array.isArray(args.protocols) ? args.protocols : [];
    if (protocols.length > 16 || protocols.some(p => typeof p !== 'string' || !WS_PROTOCOL.test(p)) || new Set(protocols).size !== protocols.length) throw fault('Bad request');
    st.wsConns ||= new Map();
    if (st.wsConns.has(key)) throw fault('Bad request');
    if (st.wsConns.size >= WS_OPEN) throw fault('Too many open app sockets');
    const gen = B.gen(st.frame);
    let ws;
    try { ws = new window.WebSocket(u.href, protocols); } catch (_) { throw fault('Bad request'); }
    ws.binaryType = 'arraybuffer';
    let opened = false, ended = false, settle = null, timer = 0;
    const live = () => !ended && boundaryLive(st) && B.gen(st.frame) === gen && st.wsConns?.get(key) === c;
    const c = {
      ws, live,
      // Ends the socket in the shell; the page hears nothing more of it (its document or channel is gone, or it asked).
      end() {
        if (ended) return; ended = true; clearTimeout(timer);
        if (st.wsConns?.get(key) === c) st.wsConns.delete(key);
        try { ws.close(); } catch (_) {}
        settle?.(false);
      },
      // The shell gives up on it (a message too large, a server not reading): the page hears an abnormal close.
      fail() { tellGone(1006, '', false); c.end(); },
    };
    st.wsConns.set(key, c); wsOwners.add(st); wsWatch();
    timer = setTimeout(() => { if (!opened) c.end(); }, WS_WAIT);
    const tell = data => { if (!live() || !B.notice(st.frame, 'ws', { key, ...data })) { c.end(); return false; } return true; };
    ws.addEventListener('message', e => {
      if (!opened || ended) return;
      const d = e.data;
      if (typeof d !== 'string' && Object.prototype.toString.call(d) !== '[object ArrayBuffer]') return;
      // Larger than the shell passes on: the page's socket fails (1009, as a browser's own does) and this one closes.
      if (wsBytes(d) > B.netMax) { tellGone(1009, 'Message too large', false); c.end(); return; }
      tell({ event: 'message', data: d });
    });
    const tellGone = (code, reason, wasClean) => { if (live()) B.notice(st.frame, 'ws', { key, event: 'close', code, reason, wasClean }); };
    ws.addEventListener('close', e => {
      clearTimeout(timer);
      if (ended) return;
      if (opened) tellGone(e.code, e.reason, e.wasClean);
      ended = true; if (st.wsConns?.get(key) === c) st.wsConns.delete(key);
      settle?.(false);
    });
    return new Promise((resolve, reject) => {
      settle = ok => { settle = null; if (!ok) reject(fault('Connection failed')); };
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        if (ended) return;
        if (!live()) { c.end(); return; }
        opened = true; settle = null;
        resolve({ ws: { protocol: ws.protocol, extensions: ws.extensions } });
      });
    });
  }
  function boundaryWsSend(st, args) {
    const c = typeof args?.key === 'string' ? st.wsConns?.get(args.key) : null;
    if (!c || !c.live() || c.ws.readyState !== 1) return false;
    const d = args.data;
    if (typeof d !== 'string' && Object.prototype.toString.call(d) !== '[object ArrayBuffer]') return false;
    // Too large a message, or the server is not reading: the socket fails, as a browser's own does.
    const n = wsBytes(d);
    if (n > WS_MSG || c.ws.bufferedAmount + n > WS_BUFFER) { c.fail(); return false; }
    try { c.ws.send(d); } catch (_) { c.fail(); return false; }
    return true;
  }
  function boundaryWsClose(st, args) {
    const c = typeof args?.key === 'string' ? st.wsConns?.get(args.key) : null;
    if (!c) return false;
    const code = Number.isInteger(args.code) && (args.code === 1000 || (args.code >= 3000 && args.code <= 4999)) ? args.code : undefined;
    const reason = typeof args.reason === 'string' && utf8(args.reason) <= 123 ? args.reason : '';
    // Not open yet: it never opens. Open: the closing handshake runs and its close comes to the page as a notice.
    if (c.ws.readyState !== 1) { c.end(); return true; }
    try { code ? c.ws.close(code, reason) : c.ws.close(); } catch (_) { c.end(); }
    return true;
  }
  if (window.WizBrowserBoundary?.serve) {
    window.WizBrowserBoundary.serve((frame, method, args, ctx) => {
      const st = frames.get(frame);
      if (!boundaryLive(st)) throw fault('App window not verified');
      if (method === 'badge.set') { setBadge(st.appId, args?.n, args?.more === true); st.badged = true; return true; }
      if (method === 'titlebar.set') {
        // The page's own address, only as the base for relative links (each link must still stay inside the app).
        let base = null; try { if (typeof args?.base === 'string' && args.base.length <= 2048) { const u = new URL(args.base); if (within(u, st.url)) base = u.href; } } catch (_) {}
        return setTools(st, args?.tools, base);
      }
      // Sharing out: browser-boundary.js already checked a real tap in this visible window. The shell's own share
      // sheet always opens (never `direct`), so the owner picks where it goes; the app gets only the outcome.
      if (method === 'share.text') {
        const payload = {};
        for (const k of ['text', 'title', 'url']) if (typeof args?.[k] === 'string' && args[k]) payload[k] = args[k];
        if (payload.url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(payload.url)) {
          // A relative link resolves against the page's own address, which must be inside the app.
          let base = null; try { if (typeof args?.base === 'string' && args.base.length <= 2048) { const u = new URL(args.base); if (within(u, st.url)) base = u; } } catch (_) {}
          try { payload.url = new URL(payload.url, base || st.url).href; } catch (_) { return 'unsupported'; }
        }
        return window.WosChat?.sharePayload ? window.WosChat.sharePayload(payload) : 'unsupported';
      }
      if (method === 'share.file') {
        const file = args?.file;
        if (!file || !['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(file))) return 'unsupported';
        const title = typeof args?.options?.title === 'string' ? args.options.title.slice(0, 1024) : undefined;
        return window.WosChat?.shareFile ? window.WosChat.shareFile(file, { title, direct: false }) : 'unsupported';
      }
      // Share to Wizard: browser-boundary.js already checked a real tap in this visible window. The shell's own Send to
      // <agent> sheet opens; the owner reads it and sends or cancels. It sends only while this same document is still
      // the verified app in this window (gen), and a shell update waits while the sheet is open.
      if (method === 'share.wizard') {
        if (!window.WizShareWizard) return 'unsupported';
        const data = { files: args?.files ?? [], text: args?.text ?? '', title: args?.title ?? '' };
        window.WizShareWizard.valid(data);
        const gen = window.WizBrowserBoundary.gen(frame);
        // This hold is the shell's own sheet's: it lasts until the sheet settles, also across a reload of the window.
        const id = holdFor(st, 'Share to Wizard'); (st.sheetHolds ||= new Set()).add(id);
        return Promise.resolve(window.WizShareWizard.wizard(data, () => boundaryLive(st) && window.WizBrowserBoundary.gen(frame) === gen))
          .finally(() => { st.sheetHolds.delete(id); if (st.holds.delete(id)) changed(); });
      }
      // Update holds: the app's unsaved work makes a shell update wait. They belong to the document now in the window and
      // end with it (onReset). No keep callback crosses the boundary, so such a hold always waits (never skipped).
      if (method === 'update.hold') return holdFor(st, args?.reason);
      if (method === 'update.release') { const id = args?.id; if (typeof id !== 'string' || !st.holds.delete(id)) return false; changed(); return true; }
      // The box's one transcriber, within a per-app budget (an app could otherwise spend the owner's transcription
      // provider without limit). No microphone or provider credential crosses the frame.
      if (method === 'voice.transcribe') {
        const take = transcribeBudget(st.appId, args?.file);
        return transcribeFile(args?.file, { language: args?.language }).finally(take);
      }
      // Receiving shares (docs/SHARE-SHEET.md): the same per-app ops a same-origin frame uses, always for this window's
      // installed app id (never one the page names). An item stays pending, claimed by this window, until the app acks
      // that it placed it; browser-boundary.js lets only the item's own share fields cross.
      if (method === 'share.receive') return !!shareOps?.register(st.appId, { accepts: args?.accepts, targets: args?.targets });
      if (method === 'share.targets') return !!shareOps?.setTargets(st.appId, args?.targets);
      if (method === 'share.pending') return shareOps?.pending(st.appId, { owner: st, alive: () => boundaryLive(st) }) || [];
      if (method === 'share.ack') return typeof args?.id === 'string' && !!shareOps?.ack(st.appId, args.id);
      // Lower Wizard Music while this app plays a short sound. The window owns the duck: a new document or closing the
      // window restores the music (onReset, reset).
      if (method === 'audio.duck') return window.WizBackgroundAudio?.duck ? window.WizBackgroundAudio.duck(st, args?.on === true) : false;
      if (method === 'vault.has' || method === 'vault.seal' || method === 'vault.open' || method === 'vault.forget') return boundaryVault(st, frame, method.slice(6), args);
      if (['identity.info', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt'].includes(method)) return boundaryIdentity(st, frame, method.slice(9), args);
      if (method.startsWith('capture.')) return boundaryCapture(st, frame, method, args, ctx);
      // The app's own saved settings (its localStorage stand-in, core/app-client.js): always the window's installed
      // app id, never one the page names.
      if (method === 'storage.load') return window.WizBrowserBoundary.appStorage.load(st.appId);
      if (method === 'storage.save') return window.WizBrowserBoundary.appStorage.save(st.appId, args?.ops);
      // Its IndexedDB (the stand-in in core/app-client.js), the same way. After a change, the app's other windows read
      // that database again before their next transaction.
      if (method === 'idb.load') return window.WizBrowserBoundary.appIdb.load(st.appId, args?.name);
      if (method === 'idb.list') return window.WizBrowserBoundary.appIdb.list(st.appId);
      if (method === 'idb.commit' || method === 'idb.drop') {
        const B = window.WizBrowserBoundary, name = args?.name;
        return (method === 'idb.commit' ? B.appIdb.commit(st.appId, name, args?.ops, args?.base) : B.appIdb.drop(st.appId, name)).then(v => {
          const ok = v === true || !!v?.idb;
          if (ok) for (const o of frames.values()) if (o !== st && o.appId === st.appId && boundaryLive(o)) B.notice(o.frame, 'idb', { name });
          return v;
        });
      }
      if (method === 'net.fetch') return boundaryNet(st, args);
      if (method === 'net.abort') { const c = typeof args?.key === 'string' ? st.netCalls?.get(args.key) : null; if (!c) return false; c.abort(); st.netCalls.delete(args.key); return true; }
      // How much of a streamed answer the page has taken (see netPump): the shell may read on.
      if (method === 'net.ack') { const fl = typeof args?.key === 'string' ? st.netFlows?.get(args.key) : null; if (!fl) return false; fl.ack(Number(args.n)); return true; }
      // The app's own WebSocket (see boundaryWsOpen): open, a message from the page, close.
      if (method === 'ws.open') return boundaryWsOpen(st, args);
      if (method === 'ws.send') return boundaryWsSend(st, args);
      if (method === 'ws.close') return boundaryWsClose(st, args);
      throw fault('Not available');
    });
    window.WizBrowserBoundary.onReset(frame => {
      const st = frames.get(frame); if (!st) return;
      if (st.tools) setTools(st, null);
      window.WizBackgroundAudio?.duck?.(st, false); // the old document's duck ends with it
      captureForget(st, window.WizBrowserBoundary.gen(frame)); // its recording events and preparations end; the recorder keeps going
      for (const c of st.netCalls?.values() || []) c.abort(); // the old document's backend calls stop; no page gets their answers
      st.netCalls?.clear(); st.netFlows?.clear();
      wsCloseAll(st); // and its sockets close
      // A new document: the old one's holds end with it (its client places its holds again on the new channel). An open
      // Send to sheet is the shell's, not the document's: its hold stays until the sheet settles.
      let gone = false;
      for (const id of [...st.holds.keys()]) if (!st.sheetHolds?.has(id)) { st.holds.delete(id); st.drafts?.delete(id); gone = true; }
      if (gone) changed();
    });
  }
  // The shell is about to load a page in this window itself (location.replace keeps src as it was): see trackNav.
  const expectLoad = frame => { const st = frames.get(frame); if (st) st.navExpect = true; };
  window.WizAppServices = Object.freeze({ expectLoad, fresh: Object.freeze({ tick: freshTick, tool: freshTool }), voiceCommand, runVoiceCommand, authorized: frame => { const st = frames.get(frame); return valid(st, st?.doc); }, version: VERSION, claimShare, attach, connect, back, guardBack, ownsThreadLink, appsClosed, trackOpenApps,
    titlebar: Object.freeze({ render: renderTools }),
    orb: Object.freeze({ of: orbOf, tap: orbTap, presenter(fn) { orbShown = typeof fn === 'function' ? fn : () => false; } }),
    voiceInput: Object.freeze({ pin: pinConversation, deliver: deliverConversation }),
    conversation: Object.freeze({ pin: pinConversation, deliver: deliverConversation }),
    update: Object.freeze({ busy, announce, available: () => available, reloadPlan, keepDrafts, prepareReload, commitReload, frames: updateFrames }),
    inspect: () => { reconcile(); return [...frames.values()].map(st => ({ appId: st.appId, path: st.url.pathname, ready: !!st.doc, holds: [...st.holds.values()], suspect: !!st.suspect })); },
  });
})();
