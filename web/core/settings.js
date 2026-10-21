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
    const held = it.state === 'held', audio = !!(it.audio || it.audioFile || it.hasAudio);
    const st = blocked ? esc(ctx.outbox?.quarantined?.(it.id) ? 'Waiting for device storage verification' : it.error || 'Could not confirm delivery · original kept') : it.state === 'empty' ? 'No speech detected · recording kept' : held ? esc(it.error || 'Kept on this device · no delivery intent confirmed; not queued') : it.state === 'failed' ? `<b class="fail">Not sent</b> · ${esc(it.error || '')}` : ['sending', 'queued'].includes(it.state) ? 'Queued / sending · awaiting receipt' : esc(window.WizReach?.failure().short || 'Checking connection · retrying');
    const src = it.origin === 'everywhere' ? 'Everywhere button' : it.source === 'orb' ? 'Orb' : 'Chat';
    const canRetry = it.origin === 'app' ? ctx.outbox?.canRetry(it) : !blocked && ['failed', 'waiting'].includes(it.state);
    const transcript = it.recoveryText || it.text || '';
    const recovery = it.origin === 'app' && it.audio && ['held', 'empty', 'failed', 'unconfirmed'].includes(it.state);
    const working = ctx.outbox?.transcribingRecording?.(it.id);
    return `<div class="ub-row ${esc(it.state)}" data-ubid="${esc(it.id)}" data-uborigin="${it.origin}"><div class="ub-t"><span>${esc(transcript || it.typed || (audio ? 'Retained voice recording' : 'Retained message'))}</span></div><div class="ub-m">${src} · ${esc(when)} · ${st}</div>${it.recoveryError ? `<div class="ub-m">${esc(it.recoveryError)}</div>` : ''}<div class="ub-a">${it.state === 'waiting' ? '<button data-ub="troubleshoot">Open Troubleshooter</button>' : ''}${it.parkedDraft && ctx.restoreReply ? '<button data-ub="restore-reply">Return to paused reply</button>' : ''}${canRetry ? `<button data-ub="retry">${it.state === 'empty' ? 'Retry speech & send' : 'Retry'}</button>` : ''}${recovery ? `<button data-ub="play">Play audio</button><button data-ub="download">Save audio</button>${!ctx.outbox?.quarantined?.(it.id) ? `<button data-ub="transcribe" ${working ? 'disabled' : ''}>${working ? 'Transcribing…' : 'Transcribe only'}</button>` : ''}` : ''}${transcript ? '<button data-ub="copy">Copy transcript</button>' : ''}${it.origin === 'app' && it.sessionId && ctx.live?.session(it.sessionId) ? '<button data-ub="open">Open thread</button>' : ''}${it.origin === 'app' && !audio && !blocked && !held && !it.body && !['sending', 'queued'].includes(it.state) ? '<button data-ub="edit">Edit</button>' : ''}<button data-ub="delete" class="ghost">Delete</button></div></div>`;
  }
  function focusUnsent(id) {
    requestAnimationFrame(() => {
      const row = [...document.querySelectorAll('[data-ubid]')].find(el => el.dataset.ubid === id && el.getClientRects().length);
      if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('button')?.focus({ preventScroll: true }); }
    });
  }
  let preview = null, previewUrl = '';
  function stopPreview() { if (preview) { preview.pause(); preview.remove(); preview = null; } if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  function retryAll(ctx) {
    const n = ctx.outbox?.retryAll() || 0;
    // Native retained custody has independent intent/receipt rules. Never wildcard it
    // from a web bulk action; its explicit per-item recovery remains available.
    ctx.toast?.('↻', ctx.outbox?.retryFeedback(n) || 'Nothing eligible to retry', 2400);
    setTimeout(() => ctx.render?.(), 300); return n;
  }
  function unsentAction(ctx, id, origin, action) {
    if (action === 'troubleshoot') { window.WizReach?.open(); return; }
    if (origin === 'everywhere') {
      if (action === 'retry') native()?.retryUnsent?.(id);
      if (action === 'delete') native()?.deleteUnsent?.(id);
      setTimeout(() => ctx.changed?.(), 300); return;
    }
    const it = ctx.outbox?.get(id); if (!it) return;
    if (action === 'restore-reply') { ctx.restoreReply?.(id); return; }
    if (action === 'retry') ctx.toast?.('↻', ctx.outbox.retryFeedback(ctx.outbox.retry(id)), 2400);
    if (action === 'transcribe') { ctx.outbox.transcribeRecording(id).then(() => { ctx.changed?.(); ctx.render?.(); }); return; }
    if (action === 'copy') { window.WosChat.copyText(it.recoveryText || it.text || '').then(() => ctx.toast?.('✓', 'Transcript copied · nothing sent', 2000)); return; }
    if (action === 'play' && it.audio) {
      stopPreview(); previewUrl = URL.createObjectURL(it.audio); preview = document.createElement('audio');
      preview.controls = true; preview.src = previewUrl; preview.style.maxWidth = '100%';
      const row = [...document.querySelectorAll('[data-ubid]')].find(el => el.dataset.ubid === id && el.getClientRects().length);
      row?.appendChild(preview); preview.onended = stopPreview;
      preview.play().catch(() => ctx.toast?.('!', 'Could not play this format · Save audio instead', 2400)); return;
    }
    if (action === 'download' && it.audio) {
      const url = URL.createObjectURL(it.audio), a = document.createElement('a');
      const ext = /aac/.test(it.audioType) ? 'aac' : /mp4|m4a/.test(it.audioType) ? 'm4a' : /wav/.test(it.audioType) ? 'wav' : /ogg/.test(it.audioType) ? 'ogg' : 'webm';
      a.href = url; a.download = `wizard-recording-${id}.${ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); return;
    }
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
    return `<div class="st-group"><h4>Unsent & retained <span>${all.length || ''}</span></h4>${all.length ? all.map(it => unsentRow(it, ctx)).join('') + (all.length > 1 ? '<button class="st-wide" data-ub-all="retry">Retry all</button>' : '') : '<div class="st-empty">No messages awaiting delivery on this device.</div>'}<p class="st-note">Held recordings are not queued. Retry all sends eligible failed/waiting messages only; held commands and unconfirmed delivery stay kept.</p></div>`;
  }, act(ctx, el) {
    const b = el.closest('[data-ub]');
    if (b) { const r = b.closest('[data-ubid]'); unsentAction(ctx, r.dataset.ubid, r.dataset.uborigin, b.dataset.ub); return true; }
    if (!el.closest('[data-ub-all]')) return false;
    retryAll(ctx); return true;
  } });
  /* My skin (core/my-skin.js): the owner's own CSS on top of the picked skin, kept in Files outside the shell. */
  const mySkinSub = base => {
    const M = window.WosMySkin, st = M && M.state;
    if (!M) return '';
    if (st.off) return `Off for this visit · on top of ${base}`;
    if (st.info && st.info.unavailable) return `Not on this box yet · ${base} as made`;
    return st.empty ? `Empty · ${base} exactly as made` : `On top of ${base}`;
  };
  function mySkinRow(base) {
    if (!window.WosMySkin) return '';
    return `<div class="st-row static my-skin-row"><span class="st-ic">✎</span><span class="st-tx"><b>My skin</b><small data-myskinsub>${esc(mySkinSub(base))}</small></span><span class="ms-acts"><button type="button" data-myskin="edit">Edit</button><button type="button" class="ghost" data-myskin="reset">Reset</button></span></div>`;
  }
  async function mySkinAction(ctx, what) {
    const M = window.WosMySkin; if (!M) return;
    if (what === 'edit') {
      const url = `/files/files/${M.FILE.split('/').map(encodeURIComponent).join('/')}`;
      const opened = window.WizCanOpen?.('files') && ctx.openLink ? ctx.openLink(url, 'My skin') : false;
      if (!opened) ctx.toast?.('✎', 'Ask your agent: "change my skin so …"', 2600);
      return;
    }
    if (what === 'reset') {
      if (M.state.empty) { ctx.toast?.('✓', 'My skin is already empty', 1600); return; }
      try { await M.reset(); ctx.toast?.('✓', 'My skin emptied · your skin as its author made it', 2200); }
      catch (e) { ctx.toast?.('!', 'Could not reset My skin right now', 2400); }
      for (const m of mounts) m.render();
    }
  }
  // Settings › Look (wizard-os spec/SKINS_AND_VIEWS.md §1): one card per skin, then that skin's palettes (Colours).
  // Picking a skin puts on the palette last worn in it; picking a colour applies at once, in place.
  const famOf = (S, id) => S.families?.find(f => f.id === S.familyOf?.(id)) || null;
  const lookName = (S, id) => { const f = famOf(S, id), p = S.list.find(k => k.id === id)?.name || ''; return f ? `${f.name} · ${p}` : p; };
  const palBtn = (k, cur) => `<button class="sk-opt" data-skinpick="${esc(k.id)}" aria-pressed="${k.id === cur}" aria-label="${esc(k.name)}" style="--sk-bg:${esc(k.bg)};--sk-ac:${esc(k.accent)}"><span class="sk-dot"></span><span class="sk-nm">${esc(k.name)}</span></button>`;
  function famBtn(S, f, cur) {
    const on = f.id === S.familyOf(cur), pals = f.palettes.map(id => S.list.find(k => k.id === id)).filter(Boolean);
    const dots = pals.slice(0, 5).map(k => `<i style="--sk-bg:${esc(k.bg)};--sk-ac:${esc(k.accent)}"></i>`).join('');
    return `<button class="sk-famopt" data-skinfamily="${esc(f.id)}" aria-pressed="${on}" aria-label="${esc(f.name)} skin"><span class="sk-fdots" aria-hidden="true">${dots}</span><span class="sk-ftx"><b>${esc(f.name)}</b><small>${pals.length} ${pals.length === 1 ? 'colour' : 'colours'}</small></span></button>`;
  }
  function lookHtml(S) {
    const cur = S.current, nm = S.list.find(k => k.id === cur)?.name || '', fams = S.families || [];
    const f = famOf(S, cur), pals = f ? S.list.filter(k => f.palettes.includes(k.id)) : S.list;
    const famRow = fams.length > 1 ? `<div class="sk-fam" role="group" aria-label="Skin">${fams.map(x => famBtn(S, x, cur)).join('')}</div>` : '';
    const palRow = pals.length > 1 ? `${famRow ? '<div class="sk-sub">Colours</div>' : ''}<div class="sk-sw" role="group" aria-label="Colours">${pals.map(k => palBtn(k, cur)).join('')}</div>` : '';
    return `<div class="st-group" data-stgroup="look"><h4>Look</h4><div class="st-row static sk-row"><div class="sk-head"><span class="st-ic">◐</span><span class="st-tx"><b>Skin</b><small data-skinname>${esc(lookName(S, cur))}</small></span></div>${famRow}${palRow}</div>${mySkinRow(nm)}</div>`;
  }
  register({ id: 'look', aliases: ['skin'], html() {
    const S = window.WosSkin; if (!S) return '';
    return lookHtml(S);
  }, act(ctx, el) {
    const my = el.closest('[data-myskin]');
    if (my) { mySkinAction(ctx, my.dataset.myskin); return true; }
    const S = window.WosSkin;
    const fb = el.closest('[data-skinfamily]');
    if (fb) {
      if (fb.getAttribute('aria-pressed') !== 'true') { S.setFamily(fb.dataset.skinfamily); for (const m of mounts) m.render(); }
      ctx.haptic?.(8); return true;
    }
    const b = el.closest('[data-skinpick]'); if (!b) return false;
    const now = S.set(b.dataset.skinpick);
    ctx.root.querySelectorAll('[data-skinpick]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.skinpick === now)));
    const nm = S.list.find(k => k.id === now)?.name || '';
    ctx.root.querySelector('[data-skinname]').textContent = lookName(S, now);
    const sub = ctx.root.querySelector('[data-myskinsub]'); if (sub) sub.textContent = mySkinSub(nm);
    ctx.haptic?.(8); return true;
  } });
  // Phone only: desktop always keeps framed windows. One switch, on by default; skin JSON import stays for designers.
  register({ id: 'skin-frame', available: () => !!window.WosSkin?.frameAdjustable, html() {
    const S = window.WosSkin; if (!S?.frame) return '';
    const on = S.frame.foundation === 'borderless';
    return `<div class="st-group sf-section"><h4>Windows</h4><button class="st-row" data-skinborderless role="switch" aria-checked="${on}"><span class="st-ic">▢</span><span class="st-tx"><b>Borderless apps</b><small>${on ? 'On · apps fill the screen with a floating X' : 'Off · apps open in framed windows'}</small></span><span class="sw ${on ? 'on' : ''}"><i></i></span></button><button class="sf-import" data-skinimport>Import skin JSON</button><input type="file" data-skinfile accept="application/json,.json" hidden><p data-skinimport-status role="status"></p></div>`;
  }, act(ctx, el) {
    if (el.closest('[data-skinimport]')) { ctx.root.querySelector('[data-skinfile]').click(); return true; }
    if (!el.closest('[data-skinborderless]')) return false;
    const S = window.WosSkin; S.setFoundation(S.frame.foundation === 'borderless' ? 'framed' : 'borderless');
    ctx.haptic?.(8); ctx.render(); return true;
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
  register({ id: 'photos-backup', available: () => typeof window.wizardPhotosPort?.postMessage === 'function', html() {
    return `<div class="st-group"><h4>Photos</h4>${row('photos-backup', '▧', 'Photos backup', 'Originals backed up to your photo server')}</div>`;
  }, act(ctx, el) {
    if (el.closest('[data-st]')?.dataset.st !== 'photos-backup') return false;
    window.wizardPhotosPort.postMessage('open'); return true;
  } });
  register({ id: 'voice', html: () => window.WizCore.voiceStatus?.card() || '' });
  register({ id: 'microphone', aliases: ['mic'], available: () => !!window.WosMic?.available(), html: () => window.WosMic?.html() || '', act: (ctx, el) => window.WosMic?.act(el, ctx) });
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
    let skinImportMessage = '';
    ctx.render = render;
    ctx.paintUsage = () => { const g = root.querySelector('[data-usage]'); if (g) g.outerHTML = window.WosUsage.html(); };
    function render() {
      if (adapter.visible && !adapter.visible()) return;
      const top = root.scrollTop, active = root.contains(document.activeElement) ? document.activeElement : null;
      const attrs = active ? [...active.attributes].filter(a => a.name.startsWith('data-')) : [];
      const record = active?.closest('[data-ubid]')?.dataset.ubid;
      root.innerHTML = `<div class="st-inner"><h3 class="st-title" tabindex="-1">Settings</h3>${[...features.values()].filter(f => !f.available || f.available(ctx)).map(f => `<section data-settings-feature="${esc(f.id)}">${f.html(ctx)}</section>`).join('')}</div>`;
      root.scrollTop = top;
      const importStatus = root.querySelector('[data-skinimport-status]'); if (importStatus) importStatus.textContent = skinImportMessage;
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
    const change = async e => {
      const input = e.target.closest('[data-skinfile]'); if (!input) return;
      const file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 8192) throw new Error('Skin JSON must be 8 KB or smaller');
        const definition = JSON.parse(await file.text());
        if (!root.isConnected) return;
        window.WosSkin.compose(definition);
        skinImportMessage = 'Skin composition applied on this device.'; render();
      } catch (error) {
        skinImportMessage = `Not applied: ${error.message}`;
        const status = root.querySelector('[data-skinimport-status]'); if (status) status.textContent = skinImportMessage;
      } finally { input.value = ''; }
    };
    const key = e => {
      const b = e.target.closest('[data-skinpick], [data-skinfamily]'); if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const attr = b.hasAttribute('data-skinfamily') ? 'data-skinfamily' : 'data-skinpick';
      e.preventDefault(); const buttons = [...root.querySelectorAll(`[${attr}]`)], at = buttons.indexOf(b);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      const id = buttons[n].getAttribute(attr); buttons[n].focus(); buttons[n].click();
      root.querySelector(`[${attr}="${id}"]`)?.focus(); // a skin change re-renders the group
    };
    const unsubscribe = ctx.live?.onChange?.(() => render());
    function destroy() { if (typeof unsubscribe === 'function') unsubscribe(); mounts.delete(api); root.removeEventListener('click', click); root.removeEventListener('keydown', key); root.removeEventListener('change', change); }
    root.addEventListener('click', click); root.addEventListener('keydown', key); root.addEventListener('change', change); mounts.add(api); render(); return api;
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
  window.WosMySkin?.on(() => { for (const m of mounts) { const sub = m.context?.root?.querySelector?.('[data-myskinsub]'); if (sub) { const S = window.WosSkin; sub.textContent = mySkinSub(S?.list.find(k => k.id === S.current)?.name || ''); } } });
  window.WosSettings = { refresh: () => { for (const m of mounts) m.render(); }, register, mount, route, trap, moveDraft, unsentAll, unsentRow, unsentAction, retryAll, focusUnsent, get features() { return [...features.values()].map(({ id, aliases }) => ({ id, aliases: aliases || [] })); } };
})();
