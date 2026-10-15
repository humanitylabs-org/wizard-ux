/* One responsive Settings feature surface. Register once: both shells render and dispatch it.
 * Shell adapters own navigation/input only; capability checks never depend on viewport width.
 * Existing outbox/recording stores remain the sole owners of durable user content. */
(() => {
  'use strict';
  const features = new Map(), mounts = new Set();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const native = () => window.WizardOSNative;
  const android = () => !!native() || /Android/i.test(navigator.userAgent);
  const row = (id, icon, title, sub) => `<button class="st-row" data-st="${esc(id)}"><span class="st-ic">${icon}</span><span class="st-tx"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="st-go">›</span></button>`;
  function register(feature) {
    if (!feature.id || features.has(feature.id) || typeof feature.html !== 'function') throw new Error('Settings feature requires a unique id and html');
    features.set(feature.id, feature);
    for (const m of mounts) m.render();
    return () => { features.delete(feature.id); for (const m of mounts) m.render(); };
  }
  function unsentAll(ctx) {
    let nat = []; try { nat = JSON.parse(native()?.unsent?.() || '[]'); } catch (_) {}
    return [...(ctx.outbox?.unsent() || []).map(it => ({ ...it, origin: 'app' })), ...nat.map(it => ({ ...it, origin: 'everywhere' }))].sort((a, b) => a.createdAt - b.createdAt);
  }
  function unsentRow(it, ctx) {
    const when = ctx.ago?.(new Date(it.createdAt).toISOString()) || '';
    const blocked = it.state === 'unconfirmed' || ctx.outbox?.quarantined?.(it.id);
    const st = blocked ? esc(ctx.outbox?.quarantined?.(it.id) ? 'Waiting for device storage verification' : it.error) : it.state === 'empty' ? 'No speech detected · recording kept' : it.state === 'held' ? 'Kept on this device · not queued' : it.state === 'failed' ? `<b class="fail">Not sent</b> · ${esc(it.error || '')}` : it.state === 'sending' ? 'Sending…' : `${esc(it.error || 'Waiting')} · retrying`;
    const src = it.origin === 'everywhere' ? 'Everywhere button' : it.source === 'orb' ? 'Orb' : 'Chat';
    return `<div class="ub-row ${esc(it.state)}" data-ubid="${esc(it.id)}" data-uborigin="${it.origin}"><div class="ub-t"><span>${esc(it.text || (it.state === 'empty' ? 'Voice recording' : 'Voice note · words come when it sends'))}</span></div><div class="ub-m">${src} · ${esc(when)} · ${st}</div><div class="ub-a">${!blocked && it.state !== 'held' ? `<button data-ub="retry">${it.state === 'failed' ? 'Retry' : 'Retry now'}</button>` : ''}${it.origin === 'app' && it.sessionId && ctx.live?.session(it.sessionId) ? '<button data-ub="open">Open thread</button>' : ''}${it.origin === 'app' && !blocked ? '<button data-ub="edit">Edit</button>' : ''}<button data-ub="delete" class="ghost">Delete</button></div></div>`;
  }
  function unsentAction(ctx, id, origin, action) {
    if (origin === 'everywhere') {
      if (action === 'retry') native()?.retryUnsent?.(id);
      if (action === 'delete') native()?.deleteUnsent?.(id);
      setTimeout(() => ctx.changed?.(), 300); return;
    }
    const it = ctx.outbox?.get(id); if (!it) return;
    if (action === 'retry') { if (it.state === 'held' || it.state === 'unconfirmed' || ctx.outbox.quarantined?.(id)) return; ctx.outbox.retry(id); ctx.toast?.('↻', 'Sending again', 1400); }
    if (action === 'delete') Promise.resolve(ctx.outbox.remove(id)).then(ok => ctx.toast?.(ok === false ? '!' : '✕', ok === false ? 'Could not save deletion · keep Wizard open' : 'Deleted', 2400));
    if (action === 'open') ctx.openThread(it.sessionId);
    // Moving an audio-bearing/in-flight record to a text composer would lose custody. Never do it.
    if (action === 'edit') {
      if (it.audio || it.audioFile || it.hasAudio || it.body || it.state === 'sending' || it.state === 'unconfirmed' || ctx.outbox.quarantined?.(id)) return ctx.toast?.('!', 'Recording or sending message kept · retry it, or open its thread', 2400);
      ctx.editUnsent(it);
    }
  }
  register({ id: 'unsent', aliases: ['unsent'], html(ctx) {
    const all = unsentAll(ctx);
    return `<div class="st-group"><h4>Unsent <span>${all.length || ''}</span></h4>${all.length ? all.map(it => unsentRow(it, ctx)).join('') + (all.length > 1 ? '<button class="st-wide" data-ub-all="retry">Retry all</button>' : '') : '<div class="st-empty">Everything you’ve said reached Wizard.</div>'}<p class="st-note">Originals are kept while delivery is pending. Unconfirmed steering is never automatically retried.</p></div>`;
  }, act(ctx, el) {
    const b = el.closest('[data-ub]');
    if (b) { const r = b.closest('[data-ubid]'); unsentAction(ctx, r.dataset.ubid, r.dataset.uborigin, b.dataset.ub); return true; }
    if (!el.closest('[data-ub-all]')) return false;
    ctx.outbox?.retryAll(); native()?.retryUnsent?.('*'); ctx.toast?.('↻', 'Sending everything again', 1600); setTimeout(ctx.render, 300); return true;
  } });
  register({ id: 'look', aliases: ['skin'], html() {
    const S = window.WosSkin; if (!S) return '';
    const cur = S.current, nm = S.list.find(k => k.id === cur)?.name || '';
    return `<div class="st-group" data-stgroup="look"><h4>Look</h4><div class="st-row static sk-row"><div class="sk-head"><span class="st-ic">◐</span><span class="st-tx"><b>Skin</b><small data-skinname>${esc(nm)} · tap to wear</small></span></div><div class="sk-sw" role="group" aria-label="Skin">${S.list.map(k => `<button class="sk-opt" data-skinpick="${esc(k.id)}" aria-pressed="${k.id === cur}" aria-label="${esc(k.name)}" style="--sk-bg:${esc(k.bg)};--sk-ac:${esc(k.accent)}"><span class="sk-dot"></span><span class="sk-nm">${esc(k.name)}</span></button>`).join('')}</div></div></div>`;
  }, act(ctx, el) {
    const b = el.closest('[data-skinpick]'); if (!b) return false;
    const S = window.WosSkin, now = S.set(b.dataset.skinpick);
    ctx.root.querySelectorAll('[data-skinpick]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.skinpick === now)));
    ctx.root.querySelector('[data-skinname]').textContent = `${S.list.find(k => k.id === now)?.name || ''} · tap to wear`;
    ctx.haptic?.(8); return true;
  } });
  register({ id: 'assistant', available: android, html(ctx) {
    const N = native(), evNative = typeof N?.setEverywhere === 'function'; let ev = null;
    try { ev = evNative ? JSON.parse(N.everywhere()) : null; } catch (_) {}
    const evOn = !!ev?.enabled;
    const evSub = !N ? 'Works in the Wizard OS Android app' : !evNative ? 'Update the Wizard OS app (0.5.0) to turn this on' : evOn ? (ev.overlay ? (ev.hold ? 'On · tap to talk · hold for Select text, Translate and Hide' : 'On · floats over other apps, hides while Wizard OS is open') : 'Needs “Display over other apps”') : 'A floating Wizard button over your other apps. Tap to talk, drag to move.';
    return `<div class="st-group"><h4>Assistant</h4><button class="st-row" data-st="everywhere" role="switch" aria-checked="${evOn}" ${evNative ? '' : 'disabled'}><span class="st-ic">${window.WizBrand.html}</span><span class="st-tx"><b>Wizard Everywhere</b><small>${esc(evSub)}</small></span><span class="sw ${evOn ? 'on' : ''}"><i></i></span></button>${evNative && evOn && typeof N.voiceTypingSettings === 'function' ? row('typing', '⌨', 'Voice typing & screenshots', ev.keyboard ? 'On · with a keyboard open the orb types what you say' : 'Off · tap to set up: the orb types into any app and attaches screenshots') : ''}<button class="st-row" data-st="side" ${N ? '' : 'disabled'}><span class="st-ic">◉</span><span class="st-tx"><b>Side button</b><small>${esc(!N ? 'Works in the Wizard OS Android app' : ctx.sideReady?.() ? 'On · hold the side button to talk' : 'Hold the side button to talk, even when locked')}</small></span><span class="st-go">›</span></button></div>`;
  }, act(ctx, el) {
    const st = el.closest('[data-st]')?.dataset.st, N = native();
    if (st === 'typing' && N?.voiceTypingSettings) { N.voiceTypingSettings(); return true; }
    if (st === 'everywhere' && N?.setEverywhere) { let on = false; try { on = JSON.parse(N.everywhere()).enabled; } catch (_) {} N.setEverywhere(!on); setTimeout(ctx.render, 250); ctx.haptic?.(8); return true; }
    if (st === 'side' && N) { ctx.openSub('side'); return true; } return false;
  } });
  register({ id: 'voice', html: () => window.WizCore.voiceStatus?.card() || '' });
  register({ id: 'cancelled', html: () => window.WosCancelled?.html() || '', act: (ctx, el) => window.WosCancelled?.act(el) });
  register({ id: 'selection', html: () => window.WosSelMenu?.html() || '', act: (ctx, el) => window.WosSelMenu?.act(el) });
  register({ id: 'wizard', html(ctx) {
    const status = ctx.live?.ok ? 'Connected' : ctx.live?.error === 'access' ? 'Sign-in needed' : 'Connecting…';
    return `<div class="st-group"><h4>Wizard</h4><div class="st-row static"><span class="st-ic">◇</span><span class="st-tx"><b>${esc(status)}</b><small>${esc(native()?.platform?.() || 'Web')} · ${esc(location.host)}</small></span></div>${window.WosDevice?.settingsHtml?.() || ''}${window.WizWebUpdate ? row('web-update', '↻', 'Check for updates', 'Updates both layouts · reload only when you choose') : ''}${row('help', '?', 'Gestures & help', ctx.helpSub)}${window.WosFiles ? row('files', '▤', 'Files', 'Everything in Wizard Files · preview, attach to a chat') : ''}</div>`;
  }, act(ctx, el) { const st = el.closest('[data-st]')?.dataset.st; if (st === 'web-update') { window.WizWebUpdate?.check(); ctx.toast?.('↻', 'Checking for updates', 1400); return true; } if (!['files', 'help'].includes(st)) return false; ctx.openSub(st); return true; } });
  register({ id: 'usage', aliases: ['usage'], html: () => window.WosUsage?.html() || '', act(ctx, el) { if (!el.closest('[data-usage-refresh]')) return false; window.WosUsage?.load(true).then(ctx.paintUsage); ctx.paintUsage(); return true; } });
  // A shell chooses the composer; common code owns preservation before consuming an unsent record.
  function moveDraft({ chats, wid, item, outbox, toast }) {
    if (item.audio || item.audioFile || item.hasAudio || item.body || item.state === 'unconfirmed' || item.state === 'sending' || outbox.quarantined?.(item.id)) {
      toast('!', 'Original kept · retry it or open its thread', 2400); return false;
    }
    if (item.model) {
      let selected; try { selected = window.WosModels?.snapshot(item.kind === 'reply' ? item.sessionId : '', null, item.agent || ''); } catch (_) {}
      if (!selected || selected.model !== item.model || (item.provider && selected.provider !== item.provider)) {
        toast('!', 'Original model route kept · select that model before editing', 2600); return false;
      }
    }
    const draft = chats.ch(wid);
    if (draft.draft || draft.files?.length) { toast('!', 'Existing draft kept · finish it before editing this unsent message', 2600); return false; }
    const text = item.text || item.typed || '', files = item.files || [];
    chats.setDraft(wid, text, files);
    const saved = window.WosChat?.drafts.get(chats.ch(wid).draftFor);
    if (!saved || saved.text !== text || files.length !== saved.files.length || files.some((f, i) => f.id !== saved.files[i]?.id)) {
      toast('!', 'Draft could not be saved · original unsent message kept', 2600); return false;
    }
    outbox.remove(item.id); return true;
  }
  function mount(root, adapter) {
    root.classList.add('st-root'); root.dataset.settingsRoot = '';
    const ctx = { ...adapter, root }, api = { render, focus, destroy, dispatch, context: ctx };
    ctx.render = render;
    ctx.paintUsage = () => { const g = root.querySelector('[data-usage]'); if (g) g.outerHTML = window.WosUsage.html(); };
    function render() {
      if (adapter.visible && !adapter.visible()) return;
      const top = root.scrollTop, active = root.contains(document.activeElement) ? document.activeElement : null;
      const attrs = active ? [...active.attributes].filter(a => a.name.startsWith('data-')) : [];
      const record = active?.closest('[data-ubid]')?.dataset.ubid;
      root.innerHTML = `<div class="st-inner"><h3 class="st-title" tabindex="-1">Settings</h3>${[...features.values()].filter(f => !f.available || f.available(ctx)).map(f => `<section data-settings-feature="${esc(f.id)}">${f.html(ctx)}</section>`).join('')}</div>`;
      root.scrollTop = top;
      if (attrs.length) { const scope = record ? root.querySelector(`[data-ubid="${CSS.escape(record)}"]`) : root; const sel = attrs.map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join(''); scope?.querySelector(sel)?.focus({ preventScroll: true }); }
      const U = window.WosUsage;
      if (U && !U.loading && (!U.snap || Date.now() - U.at > 60000)) U.load().then(ctx.paintUsage);
    }
    function focus(id) {
      const g = root.querySelector(`[data-settings-feature="${CSS.escape(id || '')}"]`);
      if (g) root.scrollTop += g.getBoundingClientRect().top - root.getBoundingClientRect().top - 8;
      (g?.querySelector('button:not(:disabled)') || root.querySelector('.st-title'))?.focus({ preventScroll: true });
    }
    function dispatch(el) {
      const id = el.closest('[data-settings-feature]')?.dataset.settingsFeature, f = features.get(id);
      return !!f?.act?.(ctx, el);
    }
    const click = e => dispatch(e.target);
    const key = e => {
      const b = e.target.closest('[data-skinpick]'); if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const buttons = [...root.querySelectorAll('[data-skinpick]')], at = buttons.indexOf(b);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[n].focus(); buttons[n].click();
    };
    const unsubscribe = ctx.live?.onChange?.(() => render());
    function destroy() { if (typeof unsubscribe === 'function') unsubscribe(); mounts.delete(api); root.removeEventListener('click', click); root.removeEventListener('keydown', key); }
    root.addEventListener('click', click); root.addEventListener('keydown', key); mounts.add(api); render(); return api;
  }
  function route(view, open) {
    if (view === 'settings') { open(); return true; }
    const f = [...features.values()].find(f => f.aliases?.includes(view));
    if (!f) return false; open(f.id); return true;
  }
  // Shared focus containment. Existing shell Back guards own history; never add a second guard here.
  function trap(event, panel) {
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button:not(:disabled), input, textarea, a[href], [tabindex="0"]')].filter(e => e.getClientRects().length);
    if (!controls.length) return;
    const at = controls.indexOf(document.activeElement);
    if (at < 0 || (!event.shiftKey && at === controls.length - 1) || (event.shiftKey && at === 0)) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus(); }
  }
  window.WosSettings = { refresh: () => { for (const m of mounts) m.render(); }, register, mount, route, trap, moveDraft, unsentAll, unsentRow, unsentAction, get features() { return [...features.values()].map(({ id, aliases }) => ({ id, aliases: aliases || [] })); } };
})();
