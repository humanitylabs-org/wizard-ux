/* One responsive Settings feature surface. Register once: both shells render and dispatch it.
 * Shell adapters own navigation/input only; capability checks never depend on viewport width.
 * Existing outbox/recording stores remain the sole owners of durable user content. */
(() => {
  'use strict';
  const features = new Map(), mounts = new Set();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const native = () => window.WizardOSNative;
  const android = () => !!native() || /Android/i.test(navigator.userAgent);
  // Rows are plain lines split by hairlines: no boxes, no icon tiles; a second line only when it says something.
  const row = (id, title, sub) => `<button class="st-row" data-st="${esc(id)}"><span class="st-tx"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="st-go">›</span></button>`;
  const PAGES = [
    { id: 'appearance', title: 'Appearance' },
    { id: 'chats', title: 'Chats & app screens' },
    { id: 'voice', title: 'Voice & typing' },
    { id: 'phone', title: 'Phone', available: android },
    { id: 'recovery', title: 'Unsent & recovered' },
    // Resources: the Home resource bars (AI + Compute) from the shared renderer, when it is there; else AI usage.
    { id: 'usage', get title() { return window.WosResources?.bars ? 'Resources' : 'AI usage'; } },
    { id: 'schedules', title: 'Schedules', available: () => !!window.WosSchedules?.available },
    { id: 'about', title: 'About & updates' },
  ];
  const featurePages = { look: 'appearance', 'skin-frame': 'appearance', 'chats-default': 'chats', 'own-views': 'chats', voice: 'voice', microphone: 'voice', selection: 'voice', assistant: 'phone', 'photos-backup': 'phone', unsent: 'recovery', cancelled: 'recovery', usage: 'usage' };
  const pageOf = f => f?.page != null ? PAGES.some(p => p.id === f.page) ? f.page : 'about' : featurePages[f?.id] || 'about';
  const chatsHost = () => window.WizChatsHost;
  const chatsName = id => id === 'wizard-chats' ? 'Wizard Chats' : chatsHost()?.installed().find(a => a.id === id)?.name || id;
  const recovered = () => window.WosCancelled?.list?.() || [];
  function attention(ctx) {
    const items = [], n = unsentAll(ctx).length, r = recovered().length;
    if (n) items.push({ title: `${n} ${n === 1 ? 'message' : 'messages'} not sent`, feature: 'unsent' });
    if (r) items.push({ title: `${r} ${r === 1 ? 'recording' : 'recordings'} to recover`, feature: 'cancelled' });
    // Updates never appear here: the update card at the top of Settings says it once.
    if (window.WizCore.voiceStatus?.state?.ready === false) items.push({ title: 'Voice unavailable', feature: 'voice' });
    if (ctx.live?.error === 'access') items.push({ title: 'Sign-in needed', feature: 'wizard' });
    return items;
  }
  // A quiet value on the right of a row, only where it tells you something at a glance; '' otherwise.
  function subtitle(id, ctx) {
    if (id === 'appearance') return window.WosSkin ? (mySkinWorn() ? 'My skin · ' : '') + lookName(window.WosSkin, window.WosSkin.current) : '';
    if (id === 'phone') { try { return JSON.parse(native()?.everywhere?.() || '{}').enabled ? 'Everywhere on' : ''; } catch (_) { return ''; } }
    if (id === 'recovery') { const n = new Set([...unsentAll(ctx), ...recovered()].map(x => x.id)).size; return n ? String(n) : ''; }
    // Resources: quiet unless something is running low (under a quarter left), then the lowest one.
    if (id === 'usage') { const low = window.WosResources?.lowest?.(); return low && low.left < 25 ? `${low.label} ${low.value || (100 - low.left) + '% used'}` : ''; }
    return '';
  }
  // The update card (os-updates.js) sits above the list, same look in every state; nothing to do = nothing shown.
  function cardHtml() {
    const h = window.WosUpdates?.cardHtml?.(); if (!h) return '';
    return `<section class="st-card-wrap" data-settings-feature="updates">${h}</section>`;
  }
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
    return `<div class="st-group"><h4>Unsent & retained <span>${all.length || ''}</span></h4>${all.length ? all.map(it => unsentRow(it, ctx)).join('') + (all.length > 1 ? '<button class="st-wide" data-ub-all="retry">Retry all</button>' : '') : '<div class="st-empty">No messages awaiting delivery on this device.</div>'}<details class="st-info"><summary aria-label="About retained messages">?</summary><p class="st-note">Held recordings are not queued. Retry all sends eligible failed/waiting messages only; held commands and unconfirmed delivery stay kept.</p></details></div>`;
  }, act(ctx, el) {
    const b = el.closest('[data-ub]');
    if (b) { const r = b.closest('[data-ubid]'); unsentAction(ctx, r.dataset.ubid, r.dataset.uborigin, b.dataset.ub); return true; }
    if (!el.closest('[data-ub-all]')) return false;
    retryAll(ctx); return true;
  } });
  /* My skin: CSS plus an optional, per-version owner-approved hook module, kept in Files. */
  // Launch model (23 Oct 2026): Nebula is the one default skin; the owner's first appearance request makes "My skin",
  // their own layer on top of the skin they wear, and from then on Look shows it as theirs on every device.
  const mySkinWorn = () => { const st = window.WosMySkin?.state; return !!st && !st.off && !st.empty && !st.info?.unavailable; };
  const MY_SKIN_INVITE = 'Everything you see is customizable. Ask your Wizard for one change and it becomes My skin.';
  const mySkinSub = base => {
    const M = window.WosMySkin, st = M && M.state;
    if (!M) return '';
    if (st.off) return `Off for this visit · on top of ${base}`;
    if (st.info && st.info.unavailable) return `Not on this box yet · ${base} as made`;
    return st.empty ? MY_SKIN_INVITE : `Wearing it · your changes on top of ${base}`;
  };
  function mySkinRow(base) {
    if (!window.WosMySkin) return '';
    const st = window.WosMySkin.state, js = st.script, worn = mySkinWorn();
    const script = js?.exists && !st.off ? `<div class="st-row static my-skin-row" data-myskin-script><span class="st-tx"><b>${js.approved ? 'My skin script on' : 'My skin script changed'}</b><small>Skins/My skin/skin.js · this device only</small></span><span class="ms-acts">${js.approved ? '<button type="button" class="ghost" data-myskin="off">Turn off</button>' : `<button type="button" data-myskin="on" data-myskin-hash="${esc(js.sha256 || '')}" ${js.valid ? '' : 'disabled'}>Turn on</button>`}</span></div>` : '';
    // Reset only when there is something to reset (an empty form never shows Clear).
    const reset = st.empty ? '' : '<button type="button" class="ghost" data-myskin="reset">Reset</button>';
    return `<div class="st-row static my-skin-row${worn ? ' worn' : ''}" data-myskin-row data-worn="${worn}"><span class="st-tx"><b>My skin</b><small data-myskinsub>${esc(mySkinSub(base))}</small></span><span class="ms-acts"><button type="button" data-myskin="edit">Edit</button>${reset}</span></div>${script}`;
  }
  async function mySkinAction(ctx, what, event) {
    const M = window.WosMySkin; if (!M) return;
    if (what === 'on') { M.turnOn(event); return; }
    if (what === 'off') { M.turnOff(); return; }
    if (what === 'edit') {
      const url = `/files/files/${(M.state.info?.path || M.FILE).split('/').map(encodeURIComponent).join('/')}`;
      const opened = window.WizCanOpen?.('files') && ctx.openLink ? ctx.openLink(url, 'My skin') : false;
      if (!opened) ctx.toast?.('✎', 'Ask your agent: "change my skin so …"', 2600);
      return;
    }
    if (what === 'reset') {
      if (M.state.empty) { ctx.toast?.('✓', 'My skin is already empty', 1600); return; }
      try { await M.reset(); ctx.toast?.('✓', 'My skin emptied · back to the skin as its author made it', 2200); }
      catch (e) { ctx.toast?.('!', 'Could not reset My skin right now', 2400); }
      for (const m of mounts) m.render();
    }
  }
  // Settings › Look: one tile per family, then only that family's colours. My skin stays an overlay.
  const lookName = (S, id) => S.list.find(k => k.id === id)?.name || '';
  // Skin picker: a grid of small preview cards, one per look, in the skins' own order. Each card is a miniature of
  // that look (its background, a reply and a sent bubble, the dock with its orb) drawn in CSS from its own tokens, with
  // the name set in its own face. Names stay hidden until those faces load (at most 2.5s), so they never flash.
  let facesP = null, facesReady = false;
  const faceCss = f => f ? `font-family:${f.family};font-weight:${f.weight || 400};font-style:${f.style || 'normal'}` : '';
  function loadFaces() {
    if (facesP) return facesP;
    const L = window.WosSkin?.list || [], F = typeof document !== 'undefined' && document.fonts;
    if (!F || !F.load) { facesReady = true; return (facesP = Promise.resolve()); }
    const all = Promise.all(L.filter(k => k.face).map(k => F.load(`${k.face.style || 'normal'} ${k.face.weight || 400} 15px ${k.face.family}`).catch(() => null)));
    facesP = Promise.race([all, new Promise(r => setTimeout(r, 2500))]).then(() => {
      facesReady = true;
      for (const m of mounts) m.context?.root?.querySelectorAll?.('.skp-wait').forEach(n => n.classList.remove('skp-wait'));
    });
    return facesP;
  }
  const pvars = k => { const t = k.t || {}; return [['bg', t.bg || k.bg], ['ink', t.ink], ['ac', t.violet || k.accent], ['ac2', t['violet-2']], ['pk', t.pink], ['cy', t.cyan], ['dock', t['sk-dock']], ['dl', t['sk-dock-line']]]
    .filter(([, v]) => v).map(([n, v]) => `--p-${n}:${esc(v)}`).join(';'); };
  const mini = k => `<span class="skp-mini" data-skp="${esc(k.id)}" style="${pvars(k)}" aria-hidden="true"><i class="skp-a"></i><i class="skp-a skp-a2"></i><i class="skp-u"></i><i class="skp-dock"><i class="skp-orb"></i></i></span>`;
  const skinCard = (k, cur) => `<button type="button" class="skp-card" data-skinpick="${esc(k.id)}" aria-pressed="${k.id === cur}" aria-label="${esc(k.name)}">${mini(k)}<span class="skp-nm" style="${esc(faceCss(k.face))}">${esc(k.name)}</span></button>`;
  /* A skin brings its author's tweaks. One disclosure under the picker lists them with on/off; skins without
   * tweaks show nothing. No separate setup, following or copy: changing skin is the only way in or out. */
  function tweakRows(S) {
    const E = window.WosExperience; if (!E) return '';
    const s = E.state; if (!s.owner || (!s.tweaks.length && !s.error)) return '';
    const fam = (S.families || []).find(f => f.id === S.familyOf?.(S.current)), who = esc(fam?.name || 'This skin');
    const on = s.tweaks.filter(t => t.on).length, disabled = s.busy ? ' disabled' : '';
    const rows = s.tweaks.map(t => `<button type="button" class="st-row tw-row" data-tweak-toggle="${esc(t.id)}" role="switch" aria-checked="${t.on}"${disabled}><span class="st-tx"><b>${esc(t.name)}</b>${t.description ? `<small>${esc(t.description)}</small>` : ''}</span><span class="sw ${t.on ? 'on' : ''}" aria-hidden="true"><i></i></span></button>`).join('');
    return `<details class="tw-set" data-tweakset${tweaksOpen ? ' open' : ''}><summary class="st-row"><span class="st-ic">◇</span><span class="st-tx"><b>${who} also changes how things work</b><small>${on} of ${s.tweaks.length} changes on · tap to choose</small></span><span class="st-go" aria-hidden="true">›</span></summary>${s.error ? `<p role="alert">${esc(s.error)}</p>` : ''}${rows}</details>`;
  }
  let tweaksOpen = false;
  window.addEventListener?.('wos:experience', () => { for (const m of mounts) m.render(); });
  // My skin is the last tile of the same grid, same size, drawn dashed (ringed while worn). Tapping it opens its
  // controls (Edit, Reset when non-empty, the script switch) right under the grid; while it is empty and closed, the
  // launch invite stays on screen under the grid.
  let myOpen = false;
  const myTile = () => window.WosMySkin ? `<button type="button" class="skp-card skp-my${mySkinWorn() ? ' worn' : ''}" data-myskin-tile aria-expanded="${myOpen}" aria-label="My skin"><span class="skp-mini skp-mini-my" aria-hidden="true"><i class="skp-plus"></i></span><span class="skp-nm">My skin</span></button>` : '';
  function lookHtml(S) {
    const cur = S.current, base = lookName(S, cur);
    loadFaces();
    const fams = S.families || [{ id: cur, name: base, palettes: S.list.map(k => k.id) }];
    const worn = S.familyOf?.(cur) || fams[0]?.id;
    const family = fams.find(f => f.id === worn) || fams[0];
    const ordered = [...fams].sort((a, b) => ['wizard', 'mizel', 'novairecito'].indexOf(a.id) - ['wizard', 'mizel', 'novairecito'].indexOf(b.id));
    const tiles = ordered.map(f => {
      const k = S.list.find(k => k.id === (S.lastIn?.(f.id) || f.palettes[0]));
      return `<button type="button" class="skp-card" data-skinfamily="${esc(f.id)}" aria-pressed="${f.id === worn}" aria-label="${esc(f.name)}">${k ? mini(k) : ''}<span class="skp-nm">${esc(f.name)}</span></button>`;
    }).join('');
    const grid = `<div class="skp skp-families" role="group" aria-label="Skins">${tiles}${myTile()}</div>`;
    const M = window.WosMySkin;
    const panel = M && myOpen ? `<div class="ms-panel" data-myskin-panel>${mySkinRow(base)}</div>` : '';
    const invite = M && !myOpen && M.state.empty ? `<p class="st-hint ms-invite" data-myskinsub>${esc(mySkinSub(base))}</p>` : '';
    const colours = myOpen ? '' : `<div class="skp-colours"><h4>Colours</h4><div class="skp" role="group" aria-label="${esc(family?.name || 'Skin')} colours">${(family?.palettes || []).map(id => S.list.find(k => k.id === id)).filter(Boolean).map(k => skinCard(k, cur)).join('')}</div></div>`;
    return `<div class="st-group" data-stgroup="look"><h4>Skin</h4><div class="skp-all${facesReady ? '' : ' skp-wait'}">${grid}${panel}${invite}${colours}</div>${myOpen ? '' : tweakRows(S)}</div>`;
  }
  register({ id: 'look', aliases: ['skin'], html() {
    const S = window.WosSkin; if (!S) return '';
    return lookHtml(S);
  }, act(ctx, el, event) {
    const tweak = el.closest('[data-tweak-toggle]');
    if (tweak) { tweaksOpen = true; void window.WosExperience.toggle(tweak.dataset.tweakToggle).catch(e => ctx.toast?.('!', e.message, 2400)); return true; }
    const set = el.closest('[data-tweakset] > summary');
    if (set) { event?.preventDefault?.(); tweaksOpen = !set.parentElement.open; set.parentElement.open = tweaksOpen; return true; }
    const my = el.closest('[data-myskin]');
    if (my) { mySkinAction(ctx, my.dataset.myskin, event); return true; }
    if (el.closest('[data-myskin-tile]')) {
      myOpen = !myOpen; ctx.render?.(); ctx.haptic?.(8);
      if (myOpen) ctx.root.querySelector?.('[data-myskin-panel]')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      // A tap leaves no focus ring on the re-rendered tile; Enter/Space (detail 0) keeps it for keyboard users.
      const t = ctx.root.querySelector?.('[data-myskin-tile]');
      if (event?.detail > 0 && t && t === document.activeElement) t.blur?.();
      return true;
    }
    const S = window.WosSkin;
    const family = el.closest('[data-skinfamily]');
    if (family) {
      myOpen = false; S.setFamily(family.dataset.skinfamily); void window.WosExperience?.chooseSkin?.();
      ctx.render?.(); ctx.haptic?.(8); return true;
    }
    const b = el.closest('[data-skinpick]'); if (!b) return false;
    myOpen = false; const now = S.set(b.dataset.skinpick); void window.WosExperience?.chooseSkin?.();
    ctx.root.querySelectorAll('[data-skinpick]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.skinpick === now)));
    const label = ctx.root.querySelector('[data-skinname]'); if (label) label.textContent = lookName(S, now);
    const sub = ctx.root.querySelector('[data-myskinsub]'); if (sub) sub.textContent = mySkinSub(lookName(S, now));
    for (const m of mounts) m.render();
    ctx.haptic?.(8); return true;
  } });
  // Phone only: desktop always keeps framed windows. One switch, on by default; skin JSON import stays for designers.
  register({ id: 'skin-frame', available: () => !!window.WosSkin?.frameAdjustable, html() {
    const S = window.WosSkin; if (!S?.frame) return '';
    const on = S.frame.foundation === 'borderless';
    return `<div class="st-group sf-section"><h4>Windows</h4><button class="st-row" data-skinborderless role="switch" aria-checked="${on}"><span class="st-tx"><b>Borderless apps</b><small>${on ? 'On · apps fill the screen with a floating X' : 'Off · apps open in framed windows'}</small></span><span class="sw ${on ? 'on' : ''}"><i></i></span></button><details class="st-advanced"><summary>Advanced</summary><button class="sf-import" data-skinimport>Import skin JSON</button><input type="file" data-skinfile accept="application/json,.json" hidden><p data-skinimport-status role="status"></p></details></div>`;
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
    return `<div class="st-group"><h4>Assistant</h4><button class="st-row" data-st="everywhere" role="switch" aria-checked="${evOn}" ${evNative ? '' : 'disabled'}><span class="st-tx"><b>Wizard Everywhere</b><small>${esc(evSub)}</small></span><span class="sw ${evOn ? 'on' : ''}"><i></i></span></button>${evNative && evOn && typeof N.voiceTypingSettings === 'function' ? row('typing', 'Voice typing & screenshots', ev.keyboard ? 'On · with a keyboard open the orb types what you say' : 'Off · tap to set up: the orb types into any app and attaches screenshots') : ''}<button class="st-row" data-st="side" ${N ? '' : 'disabled'}><span class="st-tx"><b>Side button</b><small>${esc(!N ? 'Works in the Wizard OS Android app' : ctx.sideReady?.() ? 'On · hold the side button to talk' : 'Hold the side button to talk, even when locked')}</small></span><span class="st-go">›</span></button></div>`;
  }, act(ctx, el) {
    const st = el.closest('[data-st]')?.dataset.st, N = native();
    if (st === 'typing' && N?.voiceTypingSettings) { N.voiceTypingSettings(); return true; }
    if (st === 'everywhere' && N?.setEverywhere) { let on = false; try { on = JSON.parse(N.everywhere()).enabled; } catch (_) {} N.setEverywhere(!on); setTimeout(ctx.render, 250); ctx.haptic?.(8); return true; }
    if (st === 'side' && N) { ctx.openSub('side'); return true; } return false;
  } });
  // Photos backup registers itself from core/photos-settings.js (web page over window.wizardPhotosPort v1).
  register({ id: 'server', available: () => typeof native()?.changeServer === 'function', html() {
    return `<div class="st-group"><h4>Connection</h4>${row('change-server', 'Change Wizard', 'Scan another box QR or enter its address')}</div>`;
  }, act(ctx, el) {
    if (el.closest('[data-st]')?.dataset.st !== 'change-server') return false;
    native().changeServer(); return true;
  } });
  register({ id: 'voice', html: () => window.WizCore.voiceStatus?.card() || '' });
  register({ id: 'microphone', aliases: ['mic'], available: () => !!window.WosMic?.available(), html: () => window.WosMic?.html() || '', act: (ctx, el) => window.WosMic?.act(el, ctx) });
  register({ id: 'cancelled', html: () => window.WosCancelled?.html() || '', act: (ctx, el) => window.WosCancelled?.act(el) });
  register({ id: 'selection', html: () => window.WosSelMenu?.html() || '', act: (ctx, el) => window.WosSelMenu?.act(el) });
  register({ id: 'wizard', html(ctx) {
    const status = ctx.live?.ok ? 'Connected' : ctx.live?.error === 'access' ? 'Sign-in needed' : 'Connecting…';
    // No separate "Check for updates": the shell checks every minute and the update card offers Reload.
    return `<div class="st-group"><h4>Wizard</h4><div class="st-row static"><span class="st-tx"><b>${esc(status)}</b><small>${esc(native()?.platform?.() || 'Web')} · ${esc(location.host)}</small></span></div>${window.WosDevice?.settingsHtml?.() || ''}${row('help', 'Gestures & help', ctx.helpSub)}</div>`;
  }, act(ctx, el) { const st = el.closest('[data-st]')?.dataset.st; if (!['files', 'help'].includes(st)) return false; ctx.openSub(st); return true; } });
  // Settings › Resources shows the Home bars themselves (core/resources.js draws them into this host and keeps them
  // live); tapping a bar opens the same detail sheet as on Home (devices, health, AI accounts with reset times).
  register({ id: 'usage', aliases: ['usage', 'resources'], html: () => window.WosResources?.bars ? '<div class="st-group st-res" data-st-resources></div>' : window.WosUsage?.html() || '',
    painted(ctx, section) { const host = section?.querySelector?.('[data-st-resources]'); if (host) window.WosResources.bars(host); },
    act(ctx, el) { if (!el.closest('[data-usage-refresh]')) return false; window.WosUsage?.load(true).then(ctx.paintUsage); ctx.paintUsage(); return true; } });
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
  register({ id: 'chats-default', page: 'chats', aliases: ['chats-default'], html(ctx) {
    const host = chatsHost(), apps = host?.installed() || [{ id: 'wizard-chats' }], current = host?.defaultId() || 'wizard-chats';
    apps.sort((a, b) => (b.id === 'wizard-chats') - (a.id === 'wizard-chats'));
    return `<div class="st-group"><h4>Default Chats</h4><div class="st-chats-options" role="radiogroup" aria-label="Default Chats">${apps.map(a => `<button class="st-row" role="radio" aria-checked="${a.id === current}" data-chats-choice="${esc(a.id)}" ${ctx.chatsBusy ? 'disabled' : ''}><span aria-hidden="true">${a.id === current ? '◉' : '○'}</span><span class="st-tx"><b>${esc(a.id === 'wizard-chats' ? 'Wizard Chats (built in)' : a.name)}</b></span></button>`).join('')}</div>${apps.length === 1 ? '<div class="st-store-hint">Install another Chats from the <button data-chats-store>Store</button> to switch</div>' : ''}</div>`;
  } });
  function mount(root, adapter) {
    root.classList.add('st-root'); root.dataset.settingsRoot = '';
    const ctx = { ...adapter, root }, api = { render, focus, back, destroy, dispatch, context: ctx, get page() { return page; } };
    let skinImportMessage = '', page = '', confirm = null;
    const desktop = adapter.shell === 'desktop';
    ctx.render = () => render(true);
    ctx.paintUsage = () => { const g = root.querySelector('[data-usage]'); if (g) g.outerHTML = window.WosUsage.html(); paintSubtitles(); };
    function paintSubtitles() {
      root.querySelectorAll?.('[data-st-subtitle]').forEach(el => { el.textContent = subtitle(el.dataset.stSubtitle, ctx); });
    }
    function render(force = false) {
      // Background polls must not replace an active form under a keystroke.
      // Explicit feature actions render via ctx.render; skin changes use tokens.
      if (force !== true && [...features.values()].some(f => pageOf(f) === page && f.deferRefresh?.(ctx))) return;
      if (adapter.visible && !adapter.visible()) return;
      const top = root.scrollTop, paneTop = root.querySelector('.st-page')?.scrollTop || 0, active = root.contains(document.activeElement) ? document.activeElement : null;
      const attrs = active ? [...active.attributes].filter(a => a.name.startsWith('data-')) : [];
      const record = active?.closest('[data-ubid]')?.dataset.ubid;
      const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
      const pages = PAGES.filter(p => !p.available || p.available(ctx));
      if (page && !pages.some(p => p.id === page)) page = '';
      const selected = page || (desktop ? 'appearance' : '');
      const heading = PAGES.find(p => p.id === selected)?.title || '';
      const items = attention(ctx);
      const attentionHtml = items.length ? `<div class="st-attention" aria-label="Needs attention">${items.map(i => `<button data-st-attention="${esc(i.feature)}">${esc(i.title)}<span aria-hidden="true">›</span></button>`).join('')}</div>` : '';
      // Desktop shows About & updates beside the list with the card on it, so the list does not repeat it.
      const card = desktop && selected === 'about' ? '' : cardHtml();
      const nav = pages.map(p => `<button class="st-category" data-st-page="${p.id}" aria-current="${p.id === selected ? 'page' : 'false'}"><span class="st-tx"><b>${p.title}</b></span><span class="st-val" data-st-subtitle="${p.id}">${esc(subtitle(p.id, ctx))}</span><span class="st-go" aria-hidden="true">›</span></button>`).join('');
      const fs = [...features.values()].filter(f => pageOf(f) === selected && (!f.available || f.available(ctx)));
      // About & updates leads with the update card and its choices; the connection rows follow.
      if (selected === 'about') fs.sort((x, y) => (y.id === 'updates') - (x.id === 'updates'));
      const content = fs.map(f => `<section data-settings-feature="${esc(f.id)}">${f.html(ctx)}</section>`).join('');
      const footer = `<footer class="st-shortcuts">${window.WosFiles ? '<button data-st-shortcut="files" data-st="files">Files</button>' : ''}${(window.WosFeatures?.entries || []).filter(f => !f.available || f.available()).map(f => `<button data-st-shortcut="${esc(f.id)}">${esc(f.title || f.id)}</button>`).join('')}</footer>`;
      root.dataset.settingsPage = page;
      root.innerHTML = `<div class="st-inner ${desktop ? 'st-desktop' : 'st-phone'} ${page ? 'st-in-page' : ''}"><div class="st-index"><h3 class="st-title" tabindex="-1">Settings</h3>${card}${attentionHtml}<nav aria-label="Settings categories">${nav}</nav>${footer}</div><div class="st-page" ${selected ? '' : 'hidden'}><header class="st-page-head"><button data-st-back aria-label="Back to Settings">‹</button><h3 tabindex="-1">${heading}</h3></header>${content}</div></div>${confirm ? `<div class="st-confirm-scrim"><section class="st-confirm" role="alertdialog" aria-modal="true" aria-labelledby="st-confirm-title"><h3 id="st-confirm-title">Use ${esc(chatsName(confirm.id))} for all your chats?</h3><p>You can switch back here any time.</p><div class="st-actions"><button data-chats-cancel ${ctx.chatsBusy ? 'disabled' : ''}>Cancel</button><button data-chats-confirm ${ctx.chatsBusy ? 'disabled' : ''}>${ctx.chatsBusy ? 'Switching…' : 'Use ' + esc(chatsName(confirm.id))}</button></div></section></div>` : ''}`;
      for (const f of fs) if (f.painted) { try { f.painted(ctx, root.querySelector(`[data-settings-feature="${CSS.escape(f.id)}"]`)); } catch (e) { console.error(e); } }
      root.scrollTop = top;
      const pane = root.querySelector('.st-page'); if (pane) pane.scrollTop = paneTop;
      const importStatus = root.querySelector('[data-skinimport-status]'); if (importStatus) importStatus.textContent = skinImportMessage;
      if (attrs.length) { const scope = record ? root.querySelector(`[data-ubid="${CSS.escape(record)}"]`) : root; const sel = attrs.map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join(''); const target = scope?.querySelector(sel); target?.focus({ preventScroll: true }); if (target && selection) target.setSelectionRange(...selection); }
      const U = window.WosUsage;
      if (U && !U.loading && (!U.snap || Date.now() - U.at > 60000)) U.load().then(ctx.paintUsage);
    }
    function focus(id) {
      for (const f of features.values()) if (pageOf(f) === page) f.leave?.(ctx);
      const f = features.get(id) || [...features.values()].find(f => f.aliases?.includes(id));
      page = f ? pageOf(f) : featurePages[id] || (id === 'updates' ? 'about' : PAGES.some(p => p.id === id) ? id : '');
      for (const f of features.values()) if (pageOf(f) === page) f.enter?.(ctx);
      confirm = null; render(); root.scrollTop = 0;
      const pane = root.querySelector('.st-page'); if (pane) pane.scrollTop = 0;
      const g = id && root.querySelector(`[data-settings-feature="${CSS.escape(f?.id || id)}"]`);
      g?.scrollIntoView?.({ block: 'nearest' });
      (g?.querySelector('button:not(:disabled)') || root.querySelector(page ? '.st-page-head h3' : '.st-title'))?.focus({ preventScroll: true });
    }
    function back() {
      for (const f of features.values()) if (pageOf(f) === page && f.back?.(ctx)) return true;
      if (confirm) { if (!ctx.chatsBusy) { confirm = null; render(); root.querySelector('[data-chats-choice][aria-checked="true"]')?.focus(); } return true; }
      if (!page) return false;
      const previous = page; focus(); root.querySelector(`[data-st-page="${previous}"]`)?.focus({ preventScroll: true }); return true;
    }
    function openStore(id) { ctx.openStore?.(id); }
    function askChats(id) {
      if (ctx.chatsBusy || id === chatsHost()?.defaultId() || !chatsHost()?.installed().some(a => a.id === id)) return;
      confirm = { id }; render(); root.querySelector('[data-chats-cancel]')?.focus();
    }
    async function useChats() {
      if (!confirm || ctx.chatsBusy) return;
      const id = confirm.id; ctx.chatsBusy = true; render();
      try {
        const url = '/wizard-os-home/store-install/_slots/chats';
        const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ default: id }) });
        if (!response.ok) { let message = 'Could not change Chats'; try { message = (await response.json()).error || message; } catch (_) {} throw Error(message); }
        const check = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if (!check.ok || (await check.json()).default !== id) throw Error('The App Manager has not confirmed this Chats choice. Try again.');
        await window.WizCore.refreshApps();
        if (chatsHost()?.defaultId() !== id) throw Error('The app list has not confirmed this Chats choice. Try again.');
        ctx.chatsChanged?.(id);
        ctx.toast?.('✓', 'Using ' + chatsName(id), 2200);
      } catch (error) { ctx.toast?.('!', String(error.message || error), 3200); }
      finally { ctx.chatsBusy = false; confirm = null; render(); root.querySelector('[data-chats-choice][aria-checked="true"]')?.focus({ preventScroll: true }); }
    }
    function dispatch(el, event) {
      if (el.closest('[data-chats-confirm]')) { useChats(); return true; }
      if (el.closest('[data-chats-cancel]')) { back(); return true; }
      if (confirm) return false;
      const nav = el.closest('[data-st-page]'), att = el.closest('[data-st-attention]');
      if (nav || att) { focus(nav ? nav.dataset.stPage : att.dataset.stAttention); return true; }
      if (el.closest('[data-st-back]')) return back();
      const shortcut = el.closest('[data-st-shortcut]');
      if (shortcut) { const id = shortcut.dataset.stShortcut; if (id === 'files') ctx.openSub('files'); else window.WosFeatures?.open(id); return true; }
      const choose = el.closest('[data-chats-choice]'); if (choose) { askChats(choose.dataset.chatsChoice); return true; }
      if (el.closest('[data-chats-store]')) { openStore(); return true; }
      const id = el.closest('[data-settings-feature]')?.dataset.settingsFeature, f = features.get(id);
      return !!f?.act?.(ctx, el, event);
    }
    const click = e => dispatch(e.target, e);
    const featureInput = e => { const id = e.target.closest('[data-settings-feature]')?.dataset.settingsFeature; features.get(id)?.input?.(ctx, e.target); };
    const change = async e => {
      featureInput(e);
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
      const dialog = root.querySelector('[data-settings-feature] [aria-modal="true"]');
      if (dialog) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); } else trap(e, dialog); return; }
      if (confirm) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); } else trap(e, root.querySelector('.st-confirm')); return; }
      const category = e.target.closest('[data-st-page]');
      if (category && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault(); const buttons = [...root.querySelectorAll('[data-st-page]')], at = buttons.indexOf(category), n = (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        const id = buttons[n].dataset.stPage; focus(id); root.querySelector(`[data-st-page="${id}"]`)?.focus(); return;
      }
      const radio = e.target.closest('[data-chats-choice]');
      if (radio && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); const buttons = [...root.querySelectorAll('[data-chats-choice]')], at = buttons.indexOf(radio), delta = ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 1;
        buttons[(at + delta + buttons.length) % buttons.length].focus(); return;
      }
      const b = e.target.closest('[data-skinpick], [data-skinfamily], [data-myskin-tile]'); if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const attr = b.hasAttribute('data-skinfamily') ? 'data-skinfamily' : 'data-skinpick';
      // The skin grid's arrows/Home/End also reach its last tile, My skin. Landing on it only moves focus (it opens
      // its controls on Enter/Space or a tap), so arrowing past never toggles the panel.
      const sel = attr === 'data-skinpick' ? '[data-skinpick], [data-myskin-tile]' : `[${attr}]`;
      e.preventDefault(); const buttons = [...root.querySelectorAll(sel)], at = buttons.indexOf(b);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      if (buttons[n].hasAttribute('data-myskin-tile')) { buttons[n].focus(); return; }
      const id = buttons[n].getAttribute(attr); buttons[n].focus(); buttons[n].click();
      root.querySelector(`[${attr}="${id}"]`)?.focus();
    };
    const unsubscribe = ctx.live?.onChange?.(() => render());
    const appsChanged = () => render();
    window.addEventListener?.('wizard:apps', appsChanged);
    function destroy() { for (const f of features.values()) f.leave?.(ctx); root.removeEventListener('input', featureInput); if (typeof unsubscribe === 'function') unsubscribe(); window.removeEventListener?.('wizard:apps', appsChanged); mounts.delete(api); root.removeEventListener('click', click); root.removeEventListener('keydown', key); root.removeEventListener('change', change); }
    root.addEventListener('input', featureInput); root.addEventListener('click', click); root.addEventListener('keydown', key); root.addEventListener('change', change); mounts.add(api); render(); return api;
  }
  function route(view, open) {
    if (view === 'settings') { open(); return true; }
    const f = [...features.values()].find(f => f.aliases?.includes(view));
    if (!f && !features.has(view)) return false; open(f?.id || view); return true;
  }
  // Shared focus containment. Existing shell Back guards own history; never add a second guard here.
  function trap(event, panel) {
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]')].filter(e => e.getClientRects().length);
    if (!controls.length) return;
    const at = controls.indexOf(document.activeElement);
    if (at < 0 || (!event.shiftKey && at === controls.length - 1) || (event.shiftKey && at === 0)) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus(); }
  }
  window.WosMySkin?.on(() => { for (const m of mounts) m.render(); });
  window.WosSettings = { refresh: () => { for (const m of mounts) m.render(); }, register, mount, route, trap, pageOf, attention, moveDraft, unsentAll, unsentRow, unsentAction, retryAll, focusUnsent, get features() { return [...features.values()].map(f => ({ id: f.id, aliases: f.aliases || [], page: pageOf(f) })); } };
})();
