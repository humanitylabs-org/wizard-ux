/* One responsive Settings feature surface. Register once: both shells render and dispatch it.
 * Shell adapters own navigation/input only; capability checks never depend on viewport width.
 * Existing outbox/recording stores remain the sole owners of durable user content. */
(() => {
  'use strict';
  const features = new Map(), mounts = new Set();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Product name: WizardOS, always one word (James, 8 Nov 2026; wizard-os#436).
  const OS = () => 'WizardOS';
  const native = () => window.WizardOSNative;
  const android = () => !!native() || /Android/i.test(navigator.userAgent);
  const shell = () => !native() && /WizardShell\//.test(navigator.userAgent || '');
  const shellOrb = () => shell() && window.WosDeviceOrb?.ready ? window.WosDeviceOrb : null;
  // Rows are plain lines split by hairlines: no boxes, no icon tiles; a second line only when it says something.
  const row = (id, title, sub) => `<button class="st-row wz-row" data-st="${esc(id)}"><span class="st-tx"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="st-go">›</span></button>`;
  // System pages are filled by packages (WosSettings.register with page = one of these); a page with nothing on it hides.
  const filled = id => () => [...features.values()].some(f => f.page === id && (!f.available || f.available()));
  const PAGES = [
    { id: 'overview', title: 'Your network', group: 'System', available: filled('overview') },
    { id: 'ai', title: 'AI', group: 'System', available: filled('ai') },
    { id: 'network', title: 'Network & security', group: 'System', available: filled('network') },
    { id: 'storage', title: 'Storage & backups', group: 'System', available: filled('storage') },
    { id: 'appearance', title: 'Appearance', group: 'Preferences' },
    // With Skins are look only on (wizard-ux issue 1190), feature switches get their own page: Appearance is colours
    // and background only. Off: they stay at the bottom of Look, as before.
    { id: 'try-features', title: 'Try new features', available: () => lookOnlyDraft() && !!tweakRows(window.WosSkin, 'try') },
    { id: 'chats', title: 'Chats & app screens' },
    // Where each app's notifications go: a badge on its icon, or Chats (core/notif-bell.js routes; one place each).
    { id: 'notifications', title: 'Notifications', available: () => typeof window.WosBell?.routes === 'function' },
    { id: 'voice', title: 'Voice & typing' },
    // Phones over Tailscale (Phone Setup). Hidden on a Wizard without Phone Setup or for a non-owner.
    // Hidden only for a non-owner; a Wizard without phone access shows the shared "not available yet" note.
    { id: 'phones', title: 'Phones & devices', available: phonesAvailable },
    { id: 'phone', title: 'Phone', available: () => shell() ? !!shellOrb() : android() },
    // Connections: the App Manager's own view (agents, what each may use, app-to-app links), only where its owner
    // listener answers. System pieces that come with every box live in Settings, not the launcher (wizard-os issue 324).
    // pending: availability not known yet; a deep link to it waits for the answer instead of falling back to the root.
    // Privacy: private AI (standard first, wizard-ux issue 1800); hidden while nothing is on it.
    { id: 'privacy', title: 'Privacy', available: filled('privacy') },
    { id: 'connections', title: 'Connections', available: () => connectionsAvailable() || filled('connections')(), pending: () => conn.ok === null && !features.has('saved-wizards') },
    { id: 'recovery', title: 'Unsent & recovered' },
    // Resources: the Home resource bars (AI + Compute) from the shared renderer, when it is there; else AI usage.
    // Kept beside the System pages: it is the only place with service health and the manual refresh.
    { id: 'usage', get title() { return window.WosResources?.bars ? 'Resources' : 'AI usage'; } },
    { id: 'schedules', title: 'Schedules', available: () => !!window.WosSchedules?.available },
    { id: 'about', title: 'About & updates' },
  ];
  const featurePages = { look: 'appearance', 'window-glass': 'appearance', 'skin-frame': 'appearance', 'chats-default': 'chats', 'own-views': 'chats', voice: 'voice', microphone: 'voice', selection: 'voice', assistant: 'phone', unsent: 'recovery', cancelled: 'recovery', usage: 'usage' };
  const pageOf = f => f?.page != null ? PAGES.some(p => p.id === f.page) ? f.page : 'about' : featurePages[f?.id] || 'about';
  /* Connections is served by the App Manager behind its owner channel, on this origin; the page hosts it as is, so
   * its owner-only actions (Disconnect, Reconnect, agent access, Restore defaults) stay the App Manager's own. The tab
   * shows only once that listener answers this device (a non-owner, or a box without it, never sees an empty tab). */
  // Beside the shell's own pages (/wizard-os-home/), like the Store's install routes.
  const CONNECTIONS = (() => { try { return new URL('store-install/_connections/', document.baseURI || location.href).pathname; } catch (_) { return '/wizard-os-home/store-install/_connections/'; } })();
  const conn = { ok: null, at: 0, busy: false };
  function connectionsAvailable() {
    if (!conn.busy && Date.now() - conn.at > (conn.ok ? 300000 : 60000) && typeof fetch === 'function') {
      conn.busy = true;
      fetch(CONNECTIONS, { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok, () => conn.ok).then(ok => {
        const was = conn.ok; conn.ok = ok === true; conn.at = Date.now(); conn.busy = false;
        if (was !== conn.ok) for (const m of mounts) m.render();
      });
    }
    return conn.ok === true;
  }
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
    // Whatever the notification routing part puts on the Settings cog (stock: nothing) opens Notifications.
    const at = window.WosBell?.attention?.();
    if (at?.n) items.push({ title: `${at.n} ${at.label}`, feature: 'notification-routing' });
    return items;
  }
  // A quiet value on the right of a row, only where it tells you something at a glance; '' otherwise.
  function subtitle(id, ctx) {
    if (id === 'phones') { const pc = phones(), v = pc?.view; if (!v) return ''; if (pc.lost) return 'Can’t check'; const n = v.phones.length; return pc.on ? (n ? `${n} ${n === 1 ? 'device' : 'devices'}` : 'On') : pc.settingUp ? 'Setting up' : v.step === 'off' ? 'Off' : ''; }
    if (id === 'appearance') return window.WosSkin ? (mySkinWorn() && !lookOnlyDraft() ? window.WosMySkin.active.name + ' · ' : '') + lookName(window.WosSkin, window.WosSkin.current) : '';
    if (id === 'phone') { if (shell()) return shellOrb()?.state.on ? 'Everywhere on' : ''; try { return JSON.parse(native()?.everywhere?.() || '{}').enabled ? 'Everywhere on' : ''; } catch (_) { return ''; } }
    if (id === 'recovery') { const n = new Set([...unsentAll(ctx), ...recovered()].map(x => x.id)).size; return n ? String(n) : ''; }
    // Resources: quiet unless something is running low (under a quarter left), then the lowest one.
    const own = [...features.values()].find(f => f.page === id && typeof f.subtitle === 'function');
    if (own) { try { return String(own.subtitle() || '').slice(0, 40); } catch (_) { return ''; } }
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
    const st = blocked ? esc(ctx.outbox?.quarantined?.(it.id) ? 'Waiting for device storage verification' : it.error || 'Could not confirm delivery · original kept') : it.state === 'empty' ? 'No speech detected · recording kept' : held ? esc(it.error || 'Kept on this device · no delivery intent confirmed; not queued') : it.state === 'failed' ? `<b class="fail">Not sent</b> · ${esc(it.error || '')}` : ['sending', 'queued'].includes(it.state) ? 'Queued / sending · awaiting receipt' : esc(window.WizReach?.label?.('send') || 'Reconnecting…');
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
      if (action === 'delete') { for (const row of ctx.root?.querySelectorAll('[data-ubid]') || []) if (row.dataset.ubid === id) { const b = row.querySelector('[data-ub="delete"]'); if (b) { b.disabled = true; b.textContent = 'Deleting…'; } } native()?.deleteUnsent?.(id); }
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
    if (action === 'delete') {
      // Custody deletes must be durable before losing the original; acknowledge the tap now.
      const buttons = [...(ctx.root?.querySelectorAll('[data-ubid]') || [])].filter(row => row.dataset.ubid === id).map(row => row.querySelector('[data-ub="delete"]')).filter(Boolean);
      for (const b of buttons) { if (b.disabled) return; b.disabled = true; b.textContent = 'Deleting…'; }
      Promise.resolve(ctx.outbox.remove(id)).then(ok => { ctx.render?.(); ctx.toast?.(ok === false ? '!' : '✕', ok === false ? 'Could not save deletion · keep Wizard open' : 'Deleted', 2400); }, () => { for (const b of buttons) { b.disabled = false; b.textContent = 'Delete'; } ctx.toast?.('!', 'Could not save deletion · original kept', 2400); });
    }
    if (action === 'open') ctx.openThread(it.sessionId);
    // Moving an audio-bearing/in-flight record to a text composer would lose custody. Never do it.
    if (action === 'edit') {
      if (it.audio || it.audioFile || it.hasAudio || it.body || it.state === 'sending' || it.state === 'unconfirmed' || ctx.outbox.quarantined?.(id)) return ctx.toast?.('!', 'Recording or sending message kept · retry it, or open its thread', 2400);
      ctx.editUnsent(it);
    }
  }
  register({ id: 'unsent', aliases: ['unsent'], html(ctx) {
    const all = unsentAll(ctx);
    return `<div class="st-group"><h4>Unsent & retained <span>${all.length || ''}</span></h4>${all.length ? all.map(it => unsentRow(it, ctx)).join('') + (all.length > 1 ? '<button class="st-wide wz-button secondary" data-ub-all="retry">Retry all</button>' : '') : '<div class="st-empty">No messages awaiting delivery on this device.</div>'}<details class="st-info"><summary aria-label="About retained messages">?</summary><p class="st-note">Held recordings are not queued. Retry all sends eligible failed/waiting messages only; held commands and unconfirmed delivery stay kept.</p></details></div>`;
  }, act(ctx, el) {
    const b = el.closest('[data-ub]');
    if (b) { const r = b.closest('[data-ubid]'); unsentAction(ctx, r.dataset.ubid, r.dataset.uborigin, b.dataset.ub); return true; }
    if (!el.closest('[data-ub-all]')) return false;
    retryAll(ctx); return true;
  } });
  // Public kind-0 only. The signed event comes from native; no secret is handled by the page.
  const identityRelays = ['wss://relay.aiwizards.com', 'wss://nos.lol', 'wss://relay.damus.io'];
  function publishIdentityProfile(event) {
    return Promise.any(identityRelays.map(url => new Promise((resolve, reject) => {
      let socket; const timer = setTimeout(() => { socket?.close(); reject(new Error('relay timeout')); }, 8000);
      const finish = (ok, message) => { clearTimeout(timer); socket?.close(); ok ? resolve(url) : reject(new Error(message || 'relay refused')); };
      try {
        socket = new WebSocket(url);
        socket.onopen = () => socket.send(JSON.stringify(['EVENT', event]));
        socket.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } if (m[0] === 'OK' && m[1] === event.id) finish(m[2] === true, m[3]); };
        socket.onerror = () => finish(false, 'relay unavailable');
        socket.onclose = () => { clearTimeout(timer); reject(new Error('relay closed')); };
      } catch (e) { clearTimeout(timer); reject(e); }
    })));
  }
  let identityInfo = null, identityAsked = false;
  register({ id: 'wizard-id', page: 'phone', aliases: ['wizard-id'], available: () => !!window.wizardDevicePort,
    html(ctx) {
      if (!identityAsked) { identityAsked = true; window.WizCore?.bridge?.call('identity.info').then(info => { identityInfo = info?.npub ? info : null; (ctx?.render || ctx?.changed)?.(); }).catch(() => { identityAsked = false; }); }
      const sub = identityInfo?.npub ? `${identityInfo.name || 'Your ID'} · ${identityInfo.backed_up ? 'Backed up' : 'Not backed up'}` : 'Not set up · your signing key stays on this phone';
      return `<div class="st-group"><h4>Identity</h4>${row('wizard-id', 'Wizard ID', sub)}</div>`;
    },
    act(ctx, el) {
      if (!el.closest('[data-st="wizard-id"]')) return false;
      window.WizCore.bridge.call('identity.setup').then(async result => {
        if (result.cancelled || result.denied) return;
        identityInfo = await window.WizCore.bridge.call('identity.info');
        ctx.changed?.();
        if (result.profile_event) {
          try { await publishIdentityProfile(result.profile_event); ctx.toast?.('✓', 'Wizard ID profile published', 2200); }
          catch (_) { ctx.toast?.('!', 'ID saved on this phone · profile not published. Open Wizard ID to retry.', 4500); }
        }
      }).catch(() => ctx.toast?.('!', 'Wizard ID unavailable · update the Wizard Android app', 3000));
      return true;
    }
  });
  let savingChatAction = false;
  register({ id: 'chat-after-action', page: 'chats', aliases: ['chat-after-action'],
    html() {
      const value = window.WizConfig?.chatAfterAction?.() || 'stay';
      return `<div class="st-group"><h4>After actions on your phone</h4><p class="st-hint">After sending, archiving, snoozing or marking unread. Desktop chats stay open.</p><div role="radiogroup" aria-label="After actions on your phone">${[['stay', 'Stay on this chat'], ['list', 'Back to chats list']].map(([id, label]) => `<button type="button" class="st-row wz-row" data-chat-after="${id}" role="radio" aria-checked="${value === id}" tabindex="${value === id ? 0 : -1}"${savingChatAction ? ' disabled' : ''}><span class="st-tx"><b>${label}</b></span><span aria-hidden="true">${value === id ? '●' : '○'}</span></button>`).join('')}</div></div>`;
    },
    act(ctx, el) {
      const button = el.closest('[data-chat-after]'); if (!button) return false;
      if (savingChatAction) return true;
      const value = button.dataset.chatAfter, hadFocus = document.activeElement === button;
      savingChatAction = true;
      const done = window.WizConfig.setChatAfterAction(value);
      ctx.changed?.();
      done.then(scope => ctx.toast?.('✓', scope === 'owner' ? 'Saved on your Wizard' : 'Saved on this device', 2200), e => ctx.toast?.('!', e.message, 3200)).finally(() => {
        savingChatAction = false; ctx.changed?.();
        if (hadFocus && document.activeElement === document.body) ctx.root?.querySelector(`[data-chat-after="${value}"]`)?.focus({ preventScroll: true });
      });
      return true;
    },
  });
  window.addEventListener?.('wos:prefs', () => { for (const m of mounts) m.render(); });
  // Reply style belongs to each agent's own persona (SOUL.md), not to Wizard: one source, survives detach.
  register({ id: 'response-style', page: 'chats', aliases: ['response-style'],
    html() {
      return `<div class="st-group"><div class="st-row static"><span class="st-tx"><b>Reply style</b><small>Each agent keeps its own. Tell an agent how you like replies and it remembers.</small></span></div></div>`;
    },
  });
  register({ id: 'working-order', page: 'chats', aliases: ['working-order'], available: () => !!window.WizChatsListModel,
    html() {
      const M = window.WizChatsListModel, current = window.WizLive?.workingOrder?.() || 'alphabetical';
      return `<div class="st-group"><h4>Working threads</h4><label class="st-row wz-row"><span class="st-tx"><b>Sort Working</b><small>The same order on your phone and desktop.</small></span><select data-settings-working-order aria-label="Sort Working">${M.WORKING_SORTS.map(([v, word]) => `<option value="${v}"${v === current ? ' selected' : ''}>${word}</option>`).join('')}</select></label></div>`;
    },
    input(ctx, el) { if (el.matches('[data-settings-working-order]')) window.WizLive?.setWorkingOrder?.(el.value); },
  });
  const mySkinWorn = () => !!window.WosMySkin?.active;
  function mySkinRow(skin) {
    const M = window.WosMySkin, st = M?.state, js = st?.script;
    // A script that failed to load names its file and the reason, and stays off until the owner turns it on again.
    const jsFile = js?.file || (M.active ? 'Skins/' + M.active.id + '/skin.js' : 'skin.js');
    // Skins are look only (wizard-ux#1190): while that switch is on the script is paused, whatever its approval.
    const paused = !!window.WosSkinHost?.lookOnly;
    const jsTitle = paused ? 'Skin script paused' : js?.error && !js.approved ? 'Skin script off' : js?.approved ? 'Skin script on' : 'Skin script changed';
    const jsSub = paused ? `${jsFile} · paused while Skins are look only is on` : js?.error && !js.approved ? `${jsFile} didn’t load: ${js.error.message}` : `${jsFile} · approval on this device`;
    const script = js?.exists && !st.off ? `<div class="st-row static my-skin-row${js.error && !js.approved ? ' failed' : ''}" data-myskin-script${js.error && !js.approved ? ' data-myskin-error' : ''}><span class="st-tx"><b>${jsTitle}</b><small>${esc(jsSub)}</small></span><span class="ms-acts">${paused ? '' : js.approved ? '<button type="button" class="ghost" data-myskin="off">Turn off</button>' : `<button type="button" data-myskin="on" data-myskin-hash="${esc(js.sha256 || '')}" ${js.valid ? '' : 'disabled'}>Turn on</button>`}</span></div>` : '';
    return `<div class="ms-panel" data-ownskin-panel><button class="st-row wz-row" data-myskin="edit"><span class="st-tx"><b>Edit with your Wizard</b><small>Ask your Wizard ‘change my ${esc(skin.name)} skin so…’</small></span><span class="st-go">›</span></button><p class="st-hint">${M.storage === 'box' ? 'Saved on your Wizard.' : M.storage === 'local' ? 'Saved on this device until your Wizard is updated.' : 'Offline · showing a cached skin.'}</p>${script}<button class="st-row wz-row" data-ownskin-remove="${esc(skin.id)}"><span class="st-tx"><b>Remove skin</b></span><span class="st-go">›</span></button></div>`;
  }
  function mySkinAction(ctx, what, event) {
    const M = window.WosMySkin; if (!M) return;
    if (what === 'on') { M.turnOn(event); return; }
    if (what === 'off') { M.turnOff(); return; }
    if (what === 'edit') {
      const app = ['wizard-files', 'files'].find(id => window.WizCanOpen?.(id));
      // Open the registered app, not a guessed folder URL or an app id absent on this box.
      const opened = app && window.WizOpenApp?.(app);
      if (!opened) ctx.toast?.('✎', esc(`Ask your Wizard: “change my ${M.active?.name || 'own'} skin so…”`), 4000);
    }
  }
  // Settings › Look: choose a skin family, then one of its colours. Tweaks stay independent.
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
  /* Tweaks are separate from color: a row of published sets to start from (Standard, Miguel's, …), then one
   * disclosure with every installed tweak as a switch. Picking a set clears the per-tweak choices. */
  const tweakSwitches = (items, attr, busy = false, by = null) => items.map(t => `<button type="button" class="st-row tw-row" ${attr}="${esc(t.id)}" role="switch" aria-checked="${!!t.on}"${busy ? ' disabled' : ''}><span class="st-tx"><b>${esc(t.name)}</b>${by ? `<small class="tw-by">${t.where ? esc(t.where) + ' · ' : ''}by ${esc(by(t.author))}</small>` : ''}${t.description ? `<small>${esc(t.description)}</small>` : ''}</span><span class="sw ${t.on ? 'on' : ''}" aria-hidden="true"><i></i></span></button>`).join('');
  // One support predicate for both Look and New skin. Filter rows only: the
  // draft map must retain hidden other-shell defaults when it is saved.
  const shellTweaks = (items, shell) => items.filter(t => !t.view || !Array.isArray(t.shells) || t.shells.includes(shell));
  // part: 'all' (Look, switch off), 'look' (views only) or 'try' (the Try new features page, Skins are look only on).
  function tweakRows(S, part = 'all') {
    const E = window.WosExperience; if (!E) return '';
    const s = E.state, own = window.WosMySkin?.active;
    if (!s.tweaks.length && !s.error) return '';
    if (!authorList) E.authors?.().then(list => { authorList = list; for (const m of mounts) m.render(); }, () => {});
    const name = who => (authorList || []).find(a => a.id === who)?.name || who;
    // Release-wide features are ordinary settings on their own pages (settingRow below), never tweaks.
    const exp = s.tweaks.filter(t => !t.builtin && !(E.desktopViews?.length && t.layout));
    const views = E.desktopViews || [];
    const viewPicker = views.length ? `<div class="tw-group"><h4>Shell view</h4><p class="st-hint">On this desktop</p><div role="radiogroup" aria-label="Shell view">${views.map(v => `<button type="button" class="st-row wz-row" data-desktop-view="${esc(v.id)}" role="radio" aria-checked="${E.desktopView === v.id}"><span class="st-tx"><b>${esc(v.name)}</b></span><span aria-hidden="true">${E.desktopView === v.id ? '●' : '○'}</span></button>`).join('')}</div></div>` : '';
    // Views are chosen per type of device (desktop / phone): only the ones this one can wear, marked as such.
    const whereView = s.shell === 'desktop' ? 'Desktop view' : 'Phone view';
    const shown = shellTweaks(exp, s.shell).map(t => t.view && s.shell ? { ...t, where: whereView } : t);
    const err = s.error ? `<p role="alert">${esc(s.error)}</p>` : '';
    // Feature switches live in two places with one state, Chrome-flags style (Miguel, 7 Nov 2026): here under "Try new
    // features" and in the WizardOS Tracker app. Both write look.json `tweaks` (Settings via WosExperience.toggle and
    // WosLookSync, the Tracker via the box's feature-switch API); WosLookSync's refresh brings either side's flip to the
    // other. The section shows only when the box is on For testers (channel latest); on For everyone it is hidden and
    // experience.js keeps the switches off and locked. Views stay their own list (a way to see the shell, not a feature).
    // Each list is flat, A to Z, each switch labelled "by <author>".
    const list = [...shown].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)) || a.id.localeCompare(b.id));
    const cells = list.map(t => tweakSwitches([t], 'data-tweak-toggle', s.busy, name) + (t.on && tweakOpts.has(t.id) ? `<div class="tw-opts" data-tweak-opts="${esc(t.id)}"></div>` : ''));
    const viewRows = cells.filter((_, i) => list[i].view).join('');
    const testers = s.channel === 'latest';
    const features = testers ? cells.filter((_, i) => !list[i].view).join('') : '';
    // For everyone, or the channel not read yet: a switch that is on keeps its options, without the switch itself.
    const opts = testers ? '' : list.filter(t => !t.view && t.on && tweakOpts.has(t.id)).map(t => `<div class="st-row static tw-row"><span class="st-tx"><b>${esc(t.name)}</b></span></div><div class="tw-opts" data-tweak-opts="${esc(t.id)}"></div>`).join('');
    const tryNew = testers && features ? `<div class="tw-group" data-try-features><h4>Try new features</h4><p class="st-hint">Unfinished features you can switch on to try. The team can see which ones you use only if you allow it.</p>${err}<div class="tw-list">${features}</div></div>` : '';
    const optsHtml = opts ? `<div class="tw-group"><div class="tw-list">${opts}</div></div>` : '';
    if (part === 'try') return tryNew || optsHtml ? `${tryNew}${optsHtml}` : '';
    if (part === 'look') return `${viewPicker}${viewRows ? `<div class="tw-group"><h4>Views</h4>${err}<div class="tw-list">${viewRows}</div></div>` : ''}`;
    return `${viewPicker}${viewRows ? `<div class="tw-group"><h4>Views</h4>${tryNew ? '' : err}<div class="tw-list">${viewRows}</div></div>` : ''}${tryNew}${optsHtml}${!viewRows && !tryNew ? err : ''}`;
  }
  let authorList = null;
  const tweakOpts = new Map(); // tweak id -> its options node (skin-host api.settings.section(.., 'look', node))
  function tweakOptions(id, node) {
    tweakOpts.set(id, node); for (const m of mounts) m.render();
    return () => { if (tweakOpts.get(id) === node) { tweakOpts.delete(id); node.remove?.(); for (const m of mounts) m.render(); } };
  }
  window.addEventListener?.('wos:experience', () => { for (const m of mounts) m.render(); paintTweakCards(); });
  /* A chat reply can carry a tweak (marker WIZARD_TWEAK_V1, core/chat-kit.js tweakIds): Look's own switch row above, bound
   * to WosExperience. A message is history, so the card always shows the tweak's CURRENT state, never the state when it
   * was sent. A tap paints the flipped switch on its own frame (pending), then the real state reconciles; a failure
   * reverts with the same toast as Look. Every card on screen and Look repaint together on wos:experience. */
  const cardPending = new Map(), ONLY = { desktop: 'Desktop only', phone: 'Phone only' };
  /* App feature switches in the same card (wizard-ux issue 1560, switch wizard/chat-app-switches): `<app id>:<switch id>`
   * rows come from the App Manager's one catalog, store-install/_feature-switches (wizard-os docs/APP_SWITCHES.md), and
   * flip through its POST, the owner-proof path the Tracker's Try it uses, so the app's own /api/switches changes. Live
   * state: read when a card paints (at most every 15 s), when the page shows again, and from every flip's answer. An
   * installed app without that switch yet is greyed with "Update <app> first" + Update (opens it in the App Store); an app
   * that isn't installed or declares no switches stays hidden. While the switch is off app ids are dropped, as before. */
  const APP_SWITCH = /^([a-z0-9][a-z0-9-]{0,62}):[a-z0-9][a-z0-9-]{0,63}$/, APP_SWITCHES_TWEAK = 'wizard/chat-app-switches';
  const appSw = { list: null, at: 0, read: null, err: false, gen: 0, timer: 0 };
  const appSwOn = () => { try { return String(document.documentElement?.dataset?.tweaks || '').split(' ').includes(APP_SWITCHES_TWEAK); } catch (e) { return false; } };
  const homePath = p => { try { return new URL(p, document.baseURI || location.href).pathname; } catch (e) { return '/wizard-os-home/' + p; } };
  function appSwTake(d) {
    if (!d || !Array.isArray(d.switches)) return;
    appSw.list = { switches: d.switches.filter(x => x && x.kind === 'app' && APP_SWITCH.test(String(x.id || ''))), apps: Array.isArray(d.apps) ? d.apps.filter(a => a && typeof a.id === 'string') : [] };
    appSw.err = false; appSw.at = Date.now();
  }
  async function appSwFetch(body) {
    const r = await window.fetch(homePath('store-install/_feature-switches'), { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Wizard-Store': '1' } : { Accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(String(d?.error || `The App Manager said ${r.status}`).slice(0, 200));
    return d;
  }
  // A read started before a flip never lands over the flip's answer (gen); the flip's answer is the newer catalog.
  function appSwRead(force) {
    if (appSw.read || (!force && Date.now() - appSw.at < 15000) || typeof window.fetch !== 'function') return appSw.read;
    const gen = appSw.gen;
    appSw.read = appSwFetch().then(d => { if (gen === appSw.gen) appSwTake(d); }, () => { if (gen === appSw.gen) appSw.err = true; })
      .finally(() => { appSw.read = null; appSw.at = Date.now(); paintTweakCards(); });
    return appSw.read;
  }
  // Another device (or the Tracker) may flip it meanwhile: while an app row is on screen and the page shows, read again
  // every 15 s, so an idle card never keeps showing, or toggling from, an old state.
  const appSwShown = () => [...(document.querySelectorAll?.('[data-chat-tweak-card]') || [])].some(n => !n.hidden && String(n.dataset?.chatTweakCard || '').split(' ').some(id => APP_SWITCH.test(id)));
  function appSwTick() {
    const later = window.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null);
    if (appSw.timer || !later) return;
    appSw.timer = later(() => { appSw.timer = 0; if (!appSwOn() || document.visibilityState === 'hidden' || !appSwShown()) return; void appSwRead(true); appSwTick(); }, 15000);
  }
  function appSwRow(id) {
    const app = APP_SWITCH.exec(id)[1], L = appSw.list;
    if (!L) return `<div class="st-row static tw-row tw-gone" data-chat-tweak-gone="${esc(id)}"><span class="st-tx"><small>${appSw.err ? 'Can’t read this Wizard’s app switches right now' : 'Loading switch…'}</small></span></div>`;
    const s = L.switches.find(x => x.id === id), st = L.apps.find(a => a.id === app);
    if (s) return tweakSwitches([{ id, name: s.name || id, description: s.description || '', author: s.app_name || st?.name || app, on: cardPending.has(id) ? cardPending.get(id) : s.on === true }], 'data-chat-tweak', false, who => who);
    if (!st) return ''; // not installed here, or it declares no switches: hidden like any unknown id
    const nm = String(st.name || app), code = Number(st.status) || 0;
    const update = st.ok !== false || code === 404, why = update ? `Update ${nm} first` : code === 401 || code === 403 ? `Open ${nm} once, then try again` : `Can’t reach ${nm} right now`;
    return tweakSwitches([{ id, name: nm, description: why, on: false }], 'data-chat-tweak', true) + (update ? `<div class="ch-tweak-upd"><button type="button" data-chat-tweak="" data-chat-tweak-update="${esc(app)}" aria-label="Update ${esc(nm)}">Update</button></div>` : '');
  }
  function appSwTap(btn, id, toast) {
    if (btn.disabled || cardPending.has(id) || !appSwOn() || typeof window.fetch !== 'function') return false;
    const was = btn.getAttribute('aria-checked') === 'true';
    cardPending.set(id, !was);
    btn.setAttribute('aria-checked', String(!was)); btn.querySelector('.sw')?.classList.toggle('on', !was); // this frame
    paintTweakCards();
    appSw.gen++;
    appSwFetch({ id, on: !was }).then(d => { appSw.gen++; appSwTake(d); cardPending.delete(id); paintTweakCards(); },
      e => { cardPending.delete(id); paintTweakCards(); toast?.('!', e?.message || 'Couldn’t change that switch'); void appSwRead(true); });
    return true;
  }
  function appSwUpdate(app, toast) {
    const open = window.WizOpenApp, path = homePath('store/index.html') + '?app=' + encodeURIComponent(app) + '&open=1';
    if (!(typeof open === 'function' && open('app-store', path))) toast?.('!', 'Open the App Store to update this app');
    return true;
  }
  window.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible' && appSw.list && appSwOn()) { void appSwRead(true); appSwTick(); } });
  function tweakCardRows(list) {
    const E = window.WosExperience, s = E?.state;
    if (s && !authorList) E.authors?.().then(a => { authorList = a; paintTweakCards(); }, () => {});
    const name = who => (authorList || []).find(a => a.id === who)?.name || who;
    if (list.some(id => APP_SWITCH.test(id))) { void appSwRead(false); appSwTick(); }
    return list.map(id => {
      if (APP_SWITCH.test(id)) return appSwRow(id);
      const t = s?.tweaks.find(x => x.id === id);
      if (!t) return `<div class="st-row static tw-row tw-gone" data-chat-tweak-gone="${esc(id)}"><span class="st-tx"><small>${!s || (!s.tweaks.length && !s.error) ? 'Loading tweak…' : 'This tweak isn’t installed on this Wizard'}</small></span></div>`;
      const here = !Array.isArray(t.shells) || t.shells.includes(s.shell);
      const on = cardPending.has(id) ? cardPending.get(id) : t.on;
      return tweakSwitches([{ ...t, on, where: t.locked ? 'For testers only' : here ? '' : ONLY[t.shells[0]] || '' }], 'data-chat-tweak', s.busy || !here || !!t.locked, name);
    }).join('');
  }
  const cardIds = ids => [...new Set((Array.isArray(ids) ? ids : String(ids || '').split(' ')).filter(id => id && (!APP_SWITCH.test(id) || appSwOn())))];
  function tweakCard(ids) {
    const list = cardIds(ids); if (!list.length) return '';
    const rows = tweakCardRows(list);
    return `<div class="ch-tweak" data-chat-tweak-card="${esc(list.join(' '))}" role="group" aria-label="${list.length > 1 ? 'Tweaks' : 'Tweak'}"${rows ? '' : ' hidden'}>${rows}</div>`;
  }
  function paintTweakCards() {
    for (const n of document.querySelectorAll?.('[data-chat-tweak-card]') || []) {
      const rows = tweakCardRows(cardIds(n.dataset.chatTweakCard)); if (n.__wosRows === rows) continue;
      const focused = n.contains(document.activeElement) ? document.activeElement.dataset?.chatTweak : '';
      n.innerHTML = rows; n.__wosRows = rows; n.hidden = !rows;
      if (focused) [...n.querySelectorAll('[data-chat-tweak]')].find(x => x.dataset.chatTweak === focused)?.focus({ preventScroll: true });
    }
  }
  function tweakCardTap(btn, toast) {
    if (btn.dataset.chatTweakUpdate) return appSwUpdate(btn.dataset.chatTweakUpdate, toast);
    if (APP_SWITCH.test(btn.dataset.chatTweak || '')) return appSwTap(btn, btn.dataset.chatTweak, toast);
    const id = btn.dataset.chatTweak, E = window.WosExperience;
    if (!id || !E || btn.disabled || cardPending.has(id)) return false;
    const was = btn.getAttribute('aria-checked') === 'true';
    if (!was && typeof askIntercept === 'function' && askIntercept(id)) return true;
    cardPending.set(id, !was);
    btn.setAttribute('aria-checked', String(!was)); btn.querySelector('.sw')?.classList.toggle('on', !was); // this frame
    paintTweakCards(); // every other card naming it, the same frame
    const done = () => { cardPending.delete(id); paintTweakCards(); };
    Promise.resolve().then(() => E.toggle(id)).then(done, e => { done(); toast?.('!', e?.message || 'Couldn’t change that tweak'); });
    return true;
  }
  const newTile = () => window.WosMySkin ? '<button type="button" class="skp-card skp-my" data-newskin aria-label="New skin"><span class="skp-mini skp-mini-my" aria-hidden="true"><i class="skp-plus"></i></span><span class="skp-nm">+ New skin</span></button>' : '';
  function skinAction(action, done, failed) {
    try { const result = action(); if (result?.then) result.then(done, failed); else done(result); } catch (e) { failed(e); }
  }
  function ownTiles(S, removing) {
    const M = window.WosMySkin;
    return (M?.recipes || []).filter(skin => skin.id !== removing).map(skin => {
      const palette = S.list.find(k => k.id === skin.base);
      return `<button type="button" class="skp-card" data-ownskin="${esc(skin.id)}" aria-pressed="${M.active?.id === skin.id}" aria-label="${esc(skin.name)}">${palette ? mini(palette) : ''}<span class="skp-nm">${esc(skin.name)}</span></button>`;
    }).join('');
  }
  async function draftDefaults(ctx, base) {
    const draft = ctx.skinDraft; if (!draft) return;
    const seq = draft.seq = (draft.seq || 0) + 1;
    draft.base = base || draft.base; draft.error = '';
    // The list is warmed when Look opens, so Loading only shows on a cold first read.
    draft.loading = !window.WosExperience.installedReady; ctx.render?.();
    try {
      let [items, map] = await Promise.all([window.WosExperience.installed(), window.WosExperience.defaults()]);
      if (ctx.skinDraft !== draft || draft.seq !== seq) return;
      if (draft.recoveryTweaks) map = { ...map, ...draft.recoveryTweaks };
      // A replacement group (two Home maps) is one switch: keep only the member that would load, so the draft never
      // shows two and never saves the hidden one as off (any member saved off turns the whole group off).
      for (const g of window.WosExperience.groups?.() || []) {
        const present = g.filter(id => items.some(t => t.id === id)); if (present.length < 2) continue;
        const pick = present.find(id => map[id]) || present[0];
        map = Object.fromEntries(Object.entries(map).filter(([id]) => id === pick || !present.includes(id)));
        items = items.filter(t => t.id === pick || !present.includes(t.id));
      }
      // Feature switches (not built-in, not a view) are switched only under Try new features and in the Tracker app:
      // the New skin draft does not list them, so it cannot flip one; their current state is carried over unchanged.
      const builtin = new Set((window.WosExperience.state?.tweaks || []).filter(t => t.builtin).map(t => t.id));
      items = items.filter(t => t.view || builtin.has(t.id));
      draft.items = items; draft.tweaks = map;
    } catch (e) { if (ctx.skinDraft === draft && draft.seq === seq) draft.error = 'Could not load installed tweaks. Try again.'; }
    finally { if (ctx.skinDraft === draft && draft.seq === seq) { draft.loading = false; ctx.render?.(); } }
  }
  /* Skins are look only (wizard-ux issue 1190, switch wizard/skins-look-only): while it is on, a new skin carries no
   * feature choices, so it can never decide what runs (not even after the switch goes off). A recovered device skin
   * keeps the choices it already had. */
  const lookOnlyDraft = () => { try { return !!window.WosExperience?.lookOnly; } catch (_) { return false; } };
  function newSkinHtml(S, draft) {
    const family = S.families.find(f => f.id === S.familyOf(draft.base));
    return `<div class="st-group sc-sheet skin-create" data-newskin-sheet><h4>New skin</h4><label>Name<input data-skin-name maxlength="60" autocomplete="off" value="${esc(draft.name)}" placeholder="Give your skin a name"></label><label>Base skin<select data-skin-base>${S.families.map(f => `<option value="${esc(f.id)}"${f.id === family?.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label><h4>Color</h4><div class="skp" role="group" aria-label="New skin colors">${(family?.palettes || []).map(id => S.list.find(k => k.id === id)).filter(Boolean).map(k => skinCard(k, draft.base)).join('')}</div>${lookOnlyDraft() ? '<p class="st-hint" data-newskin-look-only>A skin is a look only. Features are switched under Try new features.</p>' : `<h4>Tweaks</h4><p class="st-hint">Starts with the ones on now.</p>${draft.loading ? '<p role="status">Loading tweaks…</p>' : tweakSwitches(shellTweaks(draft.items || [], window.WosExperience?.state.shell).map(t => ({ ...t, on: draft.tweaks[t.id] })), 'data-draft-tweak')}`}${draft.validation ? `<p role="alert">${esc(draft.validation)}</p>` : ''}${draft.error && !lookOnlyDraft() ? `<p role="alert">${esc(draft.error)}</p><button data-skinretry>Try again</button>` : ''}<div class="st-actions"><button data-skin-create${(!lookOnlyDraft() && (draft.loading || draft.error)) || draft.saving ? ' disabled' : ''}>Create skin</button></div></div>`;
  }
  function deviceSkinRecovery() {
    const previews = window.WosMySkin?.previews || [];
    if (!previews.length) return '';
    return `<details class="st-advanced"><summary>Recover device skins</summary><p>These previews are still on this device. Recover opens New skin; nothing is saved until you choose Create.</p>${previews.map(s => `<div><button type="button" data-skin-preview="${esc(s.id)}">Recover ${esc(s.name)}</button><button type="button" data-skin-preview-dismiss="${esc(s.id)}">Dismiss preview</button></div>`).join('')}</details>`;
  }
  function lookHtml(S, ctx) {
    window.WosExperience?.installed?.().catch(() => {}); // warm the tweak list for New skin
    if (ctx.skinDraft) return newSkinHtml(S, ctx.skinDraft);
    if (lookOnlyDraft()) return lookOnlyHtml(S, ctx);
    const cur = S.current, base = lookName(S, cur), own = window.WosMySkin?.active;
    loadFaces();
    const fams = S.families || [{ id: cur, name: base, palettes: S.list.map(k => k.id) }];
    const worn = S.familyOf?.(cur) || fams[0]?.id;
    const family = fams.find(f => f.id === worn) || fams[0];
    const tiles = fams.map(f => {
      const k = S.list.find(k => k.id === (S.lastIn?.(f.id) || f.palettes[0]));
      return `<button type="button" class="skp-card" data-skinfamily="${esc(f.id)}" aria-pressed="${!own && f.id === worn}" aria-label="${esc(f.name)}">${k ? mini(k) : ''}<span class="skp-nm">${esc(f.name)}</span></button>`;
    }).join('');
    const grid = `<div class="skp skp-families" role="group" aria-label="Skins">${tiles}${ownTiles(S, ctx.skinRemoving)}${newTile()}</div>`;
    const colours = `<div class="skp-colours"><h4>Colors</h4><div class="skp" role="group" aria-label="${esc(own?.name || family?.name || 'Skin')} colors">${(family?.palettes || []).map(id => S.list.find(k => k.id === id)).filter(Boolean).map(k => skinCard(k, cur)).join('')}</div></div>` + (!own && (S.wizardBackgrounds || twinned(S, family)) ? backgroundHtml(S, family, cur, ctx) : '');
    const confirm = ctx.skinRemove ? `<div class="st-confirm-scrim"><section class="st-confirm" role="alertdialog" aria-modal="true" aria-labelledby="skin-remove-title"><h3 id="skin-remove-title">Remove ${esc(ctx.skinRemove.name)}?</h3><p>You can undo this removal. Your Wizard keeps the folder in trash for seven days.</p><div class="st-actions"><button data-skin-remove-cancel>Cancel</button><button data-skin-remove-confirm>Remove skin</button></div></section></div>` : '';
    const undo = ctx.skinUndo ? `<div class="st-skin-toast" role="status">Skin removed<button data-skin-undo>Undo</button><button data-skin-undo-dismiss aria-label="Dismiss">×</button></div>` : '';
    return `<div class="st-group" data-stgroup="look"><h4>Skin</h4><div class="skp-all${facesReady ? '' : ' skp-wait'}">${grid}${colours}</div>${deviceSkinRecovery()}${tweakRows(S)}${own ? mySkinRow(own) : ''}${confirm}${undo}</div>`;
  }
  /* Skins are look only (wizard-ux issue 1190, Miguel 20 Nov 2026: "it's really just colors and background"): no skins,
   * own skins or New skin, one row of every colour (the scenic landscapes colours are a Background, not a colour), the
   * worn colour's Background, and Views. Feature switches are on their own page (try-features above). Picking a colour
   * takes off an own skin (my-skin.js leaves it when the worn colour changes); switching off brings the skins back. */
  function lookOnlyHtml(S, ctx) {
    const cur = S.current;
    loadFaces();
    const fams = S.families || [{ id: cur, name: lookName(S, cur), palettes: S.list.map(k => k.id) }];
    const family = fams.find(f => f.id === S.familyOf?.(cur)) || fams[0];
    const ids = [...new Set(fams.flatMap(f => f.palettes || []))].filter(id => !/^landscapes/.test(id));
    const shownCur = /^landscapes/.test(cur) ? family?.palettes.find(id => !/^landscapes/.test(id) && isLight(id) === isLight(cur)) || cur : cur;
    const colours = `<div class="skp-colours"><h4>Colors</h4><div class="skp" role="group" aria-label="Colors">${ids.map(id => S.list.find(k => k.id === id)).filter(Boolean).map(k => skinCard(k, shownCur)).join('')}</div></div>`;
    const background = family && (S.wizardBackgrounds || twinned(S, family)) ? backgroundHtml(S, family, cur, ctx) : '';
    return `<div class="st-group" data-stgroup="look" data-look-only><div class="skp-all${facesReady ? '' : ' skp-wait'}">${colours}${background}</div>${tweakRows(S, 'look')}</div>`;
  }
  // Background + Mode (Miguel, 4 Nov 2026): a skin whose colours come in dark/light twins shows ONE row of
  // backgrounds (Plain, landscape pictures, WizardOS scenes) and a separate Dark | Light switch. Keep the
  // independent Colors control too (the shared Look contract). Background and Mode never disappear into a palette name.
  const twinned = (S, family) => typeof S.setWallpaper === 'function' && typeof S.twin === 'function' && (family?.palettes || []).length > 1 && family.palettes.every(id => S.twin(id));
  const isLight = id => /-light$/.test(id);
  function backgroundHtml(S, family, cur, ctx = {}) {
    const light = isLight(cur), plain = family.palettes.find(id => !/^landscapes/.test(id) && isLight(id) === light);
    const scenic = family.palettes.find(id => /^landscapes/.test(id) && isLight(id) === light);
    const wizard = !!S.wizardBackgrounds, onScene = wizard || /^landscapes/.test(cur), chosen = onScene ? S.wallpaper : 'plain';
    const card = (id, name, k, img) => `<button type="button" class="skp-card" data-bgpick="${esc(id)}" aria-pressed="${id === chosen}" aria-label="${esc(name)}"><span class="skp-mini" data-skp="${esc(k.id)}" style="${pvars(k)}${img ? `;background:linear-gradient(180deg, color-mix(in srgb, var(--p-bg, var(--wz-bg)) 35%, transparent), transparent 34%, transparent 66%, color-mix(in srgb, var(--p-bg, var(--wz-bg)) 45%, transparent)),url('${img}') center / cover` : ''}" aria-hidden="true"><i class="skp-a"></i><i class="skp-a skp-a2"></i><i class="skp-u"></i><i class="skp-dock"><i class="skp-orb"></i></i></span><span class="skp-nm">${esc(name)}</span></button>`;
    const pk = S.list.find(k => k.id === plain), lk = S.list.find(k => k.id === (wizard ? cur : scenic));
    const cards = [wizard ? card('living', 'Living canvas', lk) : pk ? card('plain', 'Plain', pk) : '', ...(lk ? S.wallpapers.map(w => card(w.id, w.name, lk, S.wallpaperThumb(w.id))) : []), wizard && lk ? card('custom', 'Custom', lk, S.wallpaperThumb('custom')) : ''].join('');
    const note = wizard && chosen === 'custom' ? 'Your image, shared with your other desktops.' : wizard && chosen === 'living' ? 'The living canvas for this color.' : onScene ? (S.wallpapers.find(w => w.id === S.wallpaper)?.who || '') : 'Plain black or white, no picture.';
    const mode = `<div class="st-seg" role="radiogroup" aria-label="Mode">${[['dark', 'Dark'], ['light', 'Light']].map(([m, n]) => `<button type="button" role="radio" aria-checked="${(m === 'light') === light}" data-skinmode="${m}">${n}</button>`).join('')}</div>`;
    return `<div class="skp-colours">${wizard ? '' : `<h4>Mode</h4>${mode}`}<h4>Background</h4><div class="skp" role="radiogroup" aria-label="Background">${cards}</div><p class="st-hint" data-wp-note>${esc(note)}</p>${wizard ? `<div class="st-actions"><button type="button" data-background-upload ${ctx.backgroundUploading ? 'disabled' : ''}>${S.desktopBackdrop?.wide ? 'Replace image' : 'Choose image'}</button>${S.desktopBackdrop?.wide ? `<button type="button" data-background-portrait ${ctx.backgroundUploading ? 'disabled' : ''}>${S.desktopBackdrop.tall ? 'Replace portrait image' : 'Add portrait image'}</button>` : ''}</div><p class="st-hint" role="status" data-background-status>${esc(ctx.backgroundUploading || 'PNG, JPEG, WebP, AVIF or GIF · up to 20 MB. Optional portrait image for tall desktop windows.')}</p>` : ''}</div>`;
  }
  function chooseBackgroundImage(ctx, portrait = false) {
    if (ctx.backgroundUploading) return;
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/avif,image/gif';
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) return;
      ctx.backgroundUploading = 'Uploading image…'; ctx.render();
      void window.WosSkin.uploadWallpaper(file, { portrait, onProgress(sent, total) {
        ctx.backgroundUploading = `Uploading image… ${Math.round(sent / total * 100)}%`;
        const status = ctx.root.querySelector('[data-background-status]'); if (status) status.textContent = ctx.backgroundUploading;
      } }).then(() => { ctx.backgroundUploading = ''; for (const m of mounts) m.render(); }, e => {
        ctx.backgroundUploading = ''; ctx.render(); ctx.toast?.('!', e.message || 'Could not upload image. Try again.', 4000);
      });
    }, { once: true });
    input.click();
  }
  function backgroundAct(ctx, el, pick) {
    const S = window.WosSkin, cur = S.current, light = isLight(cur);
    if (el.closest('[data-background-upload]')) { chooseBackgroundImage(ctx); return true; }
    if (el.closest('[data-background-portrait]')) { chooseBackgroundImage(ctx, true); return true; }
    const m = el.closest('[data-skinmode]');
    if (m) { const want = m.dataset.skinmode === 'light'; if (want !== light) { const t = S.twin(cur); if (t) pick(t.id); } return true; }
    const b = el.closest('[data-bgpick]'); if (!b) return false;
    const fam = S.families.find(f => f.id === S.familyOf(cur)), id = b.dataset.bgpick;
    if (S.wizardBackgrounds) { if (id === 'custom' && !S.desktopBackdrop?.wide) { chooseBackgroundImage(ctx); return true; } S.setWallpaper(id); ctx.render(); ctx.haptic?.(8); return true; }
    const target = fam.palettes.find(p => isLight(p) === light && (id === 'plain' ? !/^landscapes/.test(p) : /^landscapes/.test(p)));
    if (id !== 'plain') S.setWallpaper(id);
    if (target && target !== cur) pick(target); else { ctx.render(); ctx.haptic?.(8); }
    return true;
  }
  register({ id: 'look', aliases: ['skin'], html(ctx) {
    const S = window.WosSkin; if (!S) return '';
    return lookHtml(S, ctx);
  }, deferRefresh: ctx => !!(ctx.skinDraft || ctx.skinRemove) || [...tweakOpts.values()].some(n => n.contains?.(document.activeElement) && document.activeElement?.matches?.('input, textarea')),
  painted(ctx, section) { for (const slot of section?.querySelectorAll?.('[data-tweak-opts]') || []) { const n = tweakOpts.get(slot.dataset.tweakOpts); if (n && n.parentNode !== slot) slot.append(n); } },
  leave(ctx) { ctx.skinDraft = null; ctx.skinRemove = null; },
  back(ctx) {
    if (ctx.skinRemove) { ctx.skinRemove = null; ctx.render(); return true; }
    if (!ctx.skinDraft) return false;
    ctx.skinDraft = null; ctx.render(); ctx.root.querySelector('[data-newskin]')?.focus(); return true;
  }, input(ctx, el) {
    if (!ctx.skinDraft || ctx.skinDraft.saving) return;
    if (el.matches('[data-skin-name]')) ctx.skinDraft.name = el.value;
    if (el.matches('[data-skin-base]')) {
      const S = window.WosSkin, family = S.families.find(f => f.id === el.value);
      if (family && S.familyOf(ctx.skinDraft.base) !== family.id) {
        ctx.skinDraft.base = S.lastIn(family.id); ctx.render();
      }
    }
  }, act(ctx, el, event) {
    const M = window.WosMySkin, S = window.WosSkin;
    const pickPalette = id => skinAction(() => M?.active && !lookOnlyDraft() ? M.update({ base: id }) : S.set(id), () => { void window.WosExperience?.chooseSkin?.(); for (const m of mounts) m.render(); ctx.haptic?.(8); }, e => ctx.toast?.('!', e.message, 3000));
    if (backgroundAct(ctx, el, pickPalette)) return true;
    if (el.closest('[data-skin-remove-cancel]')) { ctx.skinRemove = null; ctx.render(); return true; }
    if (el.closest('[data-skin-remove-confirm]')) {
      if (ctx.skinSaving) return true; ctx.skinSaving = true;
      const removed = ctx.skinRemove; ctx.skinRemoving = removed.id; ctx.skinRemove = null; ctx.render();
      skinAction(() => M.remove(removed.id), snapshot => { ctx.skinSaving = false; ctx.skinRemoving = null; ctx.skinUndo = snapshot; ctx.render(); ctx.root.querySelector('[data-skin-undo]')?.focus(); }, e => { ctx.skinSaving = false; ctx.skinRemoving = null; if (!ctx.skinRemove) ctx.skinRemove = removed; ctx.render(); ctx.toast?.('!', e.message || 'Could not remove skin', 3000); }); return true;
    }
    if (ctx.skinRemove) return true;
    if (el.closest('[data-skin-undo]')) { if (ctx.skinSaving) return true; ctx.skinSaving = true; skinAction(() => M.restore(ctx.skinUndo), () => { ctx.skinSaving = false; ctx.skinUndo = null; ctx.render(); }, e => { ctx.skinSaving = false; ctx.toast?.('!', e.message || 'Could not restore skin', 3000); }); return true; }
    if (el.closest('[data-skin-undo-dismiss]')) { ctx.skinUndo = null; ctx.render(); return true; }
    const dismiss = el.closest('[data-skin-preview-dismiss]');
    if (dismiss) { M.dismissPreview(dismiss.dataset.skinPreviewDismiss); ctx.render(); return true; }
    const preview = el.closest('[data-skin-preview]');
    if (preview) {
      const saved = M.previews.find(s => s.id === preview.dataset.skinPreview); if (!saved) return true;
      ctx.skinDraft = { name: saved.name, items: [], tweaks: {}, previewId: saved.id, recoveryTweaks: { ...saved.tweaks } };
      void draftDefaults(ctx, saved.base); return true;
    }
    if (el.closest('[data-newskin]')) {
      ctx.skinDraft = { name: '', items: [], tweaks: {} };
      void draftDefaults(ctx, S.current);
      ctx.root.querySelector('[data-skin-name]')?.focus(); return true;
    }
    if (ctx.skinDraft) {
      const draft = ctx.skinDraft, tweak = el.closest('[data-draft-tweak]'), colour = el.closest('[data-skinpick]');
      if (draft.saving) return true;
      if (tweak) { const id = tweak.dataset.draftTweak; if (!(draft.items || []).some(t => t.id === id)) return true; draft.tweaks[id] = !draft.tweaks[id]; ctx.render(); return true; }
      if (colour) { draft.base = colour.dataset.skinpick; ctx.render(); return true; }
      if (el.closest('[data-skinretry]')) { void draftDefaults(ctx, draft.base); return true; }
      if (el.closest('[data-skin-create]') && (lookOnlyDraft() || (!draft.loading && !draft.error))) {
        if (draft.saving) return true; draft.saving = true; ctx.render();
        const snapshot = { name: draft.name, base: draft.base, tweaks: lookOnlyDraft() ? { ...(draft.recoveryTweaks || {}) } : { ...draft.tweaks } };
        skinAction(() => M.create(snapshot), () => { if (draft.previewId) M.dismissPreview(draft.previewId); draft.saving = false; if (ctx.skinDraft !== draft) return; ctx.skinDraft = null; ctx.render(); ctx.root.querySelector('[data-ownskin][aria-pressed="true"]')?.focus(); }, e => { draft.saving = false; draft.validation = e.message; if (ctx.skinDraft === draft) ctx.render(); }); return true;
      }
      return false;
    }
    const remove = el.closest('[data-ownskin-remove]');
    if (remove) { ctx.skinRemove = M.recipes.find(s => s.id === remove.dataset.ownskinRemove); ctx.render(); ctx.root.querySelector('[data-skin-remove-cancel]')?.focus(); return true; }
    const own = el.closest('[data-ownskin]');
    // Tapping the skin you wear takes it off (back to plain color + tweaks); any other one puts it on.
    if (own) { skinAction(() => M.active?.id === own.dataset.ownskin ? M.leave() : M.wear(own.dataset.ownskin), () => ctx.render(), e => ctx.toast?.('!', e.message, 3000)); return true; }
    const view = el.closest('[data-desktop-view]');
    if (view) { void window.WosExperience.chooseDesktopView(view.dataset.desktopView).catch(e => ctx.toast?.('!', e.message, 2400)); return true; }
    const tweak = el.closest('[data-tweak-toggle]');
    if (tweak && typeof askIntercept === 'function' && askIntercept(tweak.dataset.tweakToggle)) return true;
    if (tweak) { void window.WosExperience.toggle(tweak.dataset.tweakToggle).catch(e => ctx.toast?.('!', e.message, 2400)); return true; }
    const my = el.closest('[data-myskin]');
    if (my) { mySkinAction(ctx, my.dataset.myskin, event); return true; }
    const family = el.closest('[data-skinfamily]');
    if (family) { skinAction(() => M?.active ? M.leave() : undefined, () => { S.setFamily(family.dataset.skinfamily); void window.WosExperience?.chooseSkin?.(); for (const m of mounts) m.render(); ctx.haptic?.(8); }, e => ctx.toast?.('!', e.message, 3000)); return true; }
    const b = el.closest('[data-skinpick]'); if (!b) return false;
    skinAction(() => M?.active && !lookOnlyDraft() ? M.update({ base: b.dataset.skinpick }) : S.set(b.dataset.skinpick), () => {
      void window.WosExperience?.chooseSkin?.();
      for (const m of mounts) m.render(); ctx.haptic?.(8);
    }, e => ctx.toast?.('!', e.message, 3000)); return true;
  } });
  // Try new features as its own page while Skins are look only is on (wizard-ux issue 1190): the same switches, state
  // and options as the Look section it replaces; the page hides when the switch is off (PAGES above).
  register({ id: 'try-features', page: 'try-features', aliases: ['try-new-features', 'feature-switches'], available: () => lookOnlyDraft(),
    html: () => tweakRows(window.WosSkin, 'try'),
    painted(ctx, section) { for (const slot of section?.querySelectorAll?.('[data-tweak-opts]') || []) { const n = tweakOpts.get(slot.dataset.tweakOpts); if (n && n.parentNode !== slot) slot.append(n); } },
    deferRefresh: () => [...tweakOpts.values()].some(n => n.contains?.(document.activeElement) && document.activeElement?.matches?.('input, textarea')),
    act: (ctx, el) => settingAct(ctx, el) });
  // Window opacity: one slider for the glass behind every window (Chats and every app). Per device, like the skin.
  const glassPct = S => Math.round((S.glass ?? S.skinGlass) * 100);
  const glassNote = S => S.glass == null ? 'Skin default · every window and app' : 'Every window and app';
  register({ id: 'window-glass', aliases: ['window-opacity', 'opacity'], available: () => typeof window.WosSkin?.setGlass === 'function', html() {
    const S = window.WosSkin, r = S.glassRange, pct = glassPct(S);
    return `<div class="st-group wg-section"><h4>Windows</h4><div class="st-row static wg-row"><span class="st-tx"><b id="wg-label">Window opacity</b><small data-wg-note>${glassNote(S)}</small></span><output data-wg-val for="wg-range">${pct}%</output></div><input id="wg-range" class="wg-range" type="range" min="${Math.round(r.min * 100)}" max="${Math.round(r.max * 100)}" step="1" value="${pct}" data-wg-range aria-labelledby="wg-label" aria-valuetext="${pct}%">${S.glass == null ? '' : '<button type="button" class="wg-reset" data-wg-reset>Use skin default</button>'}</div>`;
  }, input(ctx, el) {
    if (!el.matches('[data-wg-range]')) return;
    const S = window.WosSkin, n = S.setGlass(Number(el.value) / 100), g = el.closest('.wg-section');
    el.setAttribute('aria-valuetext', `${Math.round(n * 100)}%`);
    const out = g?.querySelector('[data-wg-val]'); if (out) out.textContent = `${Math.round(n * 100)}%`;
    const note = g?.querySelector('[data-wg-note]'); if (note) note.textContent = glassNote(S);
    if (g && !g.querySelector('[data-wg-reset]')) el.insertAdjacentHTML('afterend', '<button type="button" class="wg-reset" data-wg-reset>Use skin default</button>');
  }, act(ctx, el) {
    if (!el.closest('[data-wg-reset]')) return false;
    window.WosSkin.setGlass(null); ctx.render(); ctx.root.querySelector('[data-wg-range]')?.focus(); return true;
  } });
  /* Features on for everyone (catalog `defaults`) are plain settings where they act: one switch each, no author. */
  const settingRow = id => { const t = window.WosExperience?.state.tweaks.find(x => x.id === id && x.builtin); return t ? tweakSwitches([t], 'data-tweak-toggle', window.WosExperience.state.busy) : ''; };
  const settingAct = (ctx, el) => { const b = el.closest('[data-tweak-toggle]'); if (!b) return false; if (typeof askIntercept === 'function' && askIntercept(b.dataset.tweakToggle)) return true; void window.WosExperience.toggle(b.dataset.tweakToggle).catch(e => ctx.toast?.('!', e.message, 2400)); return true; };
  register({ id: 'home-network', page: 'appearance', html: () => { const r = settingRow('wizard/machines-home'); return r ? `<div class="st-group"><h4>Home</h4>${r}</div>` : ''; }, act: settingAct });
  register({ id: 'skin-frame', available: () => !!window.WosSkin && !lookOnlyDraft(), html() {
    return '<div class="st-group sf-section"><details class="st-advanced"><summary>Advanced</summary><button class="sf-import" data-skinimport>Import skin JSON</button><input type="file" data-skinfile accept="application/json,.json" hidden><p data-skinimport-status role="status"></p></details></div>';
  }, act(ctx, el) {
    if (!el.closest('[data-skinimport]')) return false;
    ctx.root.querySelector('[data-skinfile]').click(); return true;
  } });
  // Wizard Shell: Everywhere is the shell's floating orb (device.orb). One switch; nothing the shell can't do.
  function shellAssistant() {
    const O = shellOrb(); if (!O) return '';
    const s = O.state, on = !!s.on;
    const sub = on ? (s.permitted ? 'On · tap to talk, hold to pause recording · hides while Wizard is open' : 'Needs “Display over other apps”') : s.permitted ? 'A floating Wizard button over your other apps. Tap to talk, drag to move.' : 'A floating Wizard button over your other apps. Android asks to let Wizard display over other apps.';
    return `<div class="st-group"><h4>Assistant</h4><button class="st-row wz-row" data-st="everywhere" role="switch" aria-checked="${on}"><span class="st-tx"><b>Wizard Everywhere</b><small>${esc(sub)}</small></span><span class="sw ${on ? 'on' : ''}"><i></i></span></button></div>`;
  }
  register({ id: 'assistant', aliases: ['everywhere', 'orb', 'floating-orb'], available: android, html(ctx) {
    if (shell()) return shellAssistant();
    const N = native(), evNative = typeof N?.setEverywhere === 'function'; let ev = null;
    try { ev = evNative ? JSON.parse(N.everywhere()) : null; } catch (_) {}
    const evOn = !!ev?.enabled;
    const evSub = !N ? `Works in the ${OS()} Android app` : !evNative ? `Update the ${OS()} app (0.5.0) to turn this on` : evOn ? (ev.overlay ? (ev.hold ? 'On · tap to talk · hold for Select text, Translate and Hide' : `On · floats over other apps, hides while ${OS()} is open`) : 'Needs “Display over other apps”') : 'A floating Wizard button over your other apps. Tap to talk, drag to move.';
    return `<div class="st-group"><h4>Assistant</h4><button class="st-row wz-row" data-st="everywhere" role="switch" aria-checked="${evOn}" ${evNative ? '' : 'disabled'}><span class="st-tx"><b>Wizard Everywhere</b><small>${esc(evSub)}</small></span><span class="sw ${evOn ? 'on' : ''}"><i></i></span></button>${evNative && evOn && typeof N.voiceTypingSettings === 'function' ? row('typing', 'Voice typing & screenshots', ev.keyboard ? 'On · with a keyboard open the orb types what you say' : 'Off · tap to set up: the orb types into any app and attaches screenshots') : ''}<button class="st-row wz-row" data-st="side" ${N ? '' : 'disabled'}><span class="st-tx"><b>Side button</b><small>${esc(!N ? `Works in the ${OS()} Android app` : ctx.sideReady?.() ? 'On · hold the side button to talk' : 'Hold the side button to talk, even when locked')}</small></span><span class="st-go">›</span></button></div>`;
  }, act(ctx, el) {
    const st = el.closest('[data-st]')?.dataset.st, N = native();
    if (shell()) { const O = shellOrb(); if (st !== 'everywhere' || !O) return false; O.toggle().then(() => ctx.render()); ctx.haptic?.(8); return true; }
    if (st === 'typing' && N?.voiceTypingSettings) { N.voiceTypingSettings(); return true; }
    if (st === 'everywhere' && N?.setEverywhere) { let on = false; try { on = JSON.parse(N.everywhere()).enabled; } catch (_) {} N.setEverywhere(!on); setTimeout(ctx.render, 250); ctx.haptic?.(8); return true; }
    if (st === 'side' && N) { ctx.openSub('side'); return true; } return false;
  } });
  /* ---------------- Phones & devices ----------------
   * The owner's phones over Tailscale. Connecting is the shared phone-connect component (web/core/phone-connect.js),
   * the same one Setup's phone screen and Mac onboarding show, so every place says the same thing, including when
   * this Wizard can't do device access yet. Below it: the phones on the owner's tailnet and turning device access off
   * (the same reset as Setup's Disconnect, behind a confirmation sheet). A phone is a device on the owner's Tailscale
   * account, so removing one happens in Tailscale's admin; the page links there. Hidden only for a non-owner. */
  const PH = { pc: null, wanted: false, confirm: false, error: '', summary: '' };
  const phoneShell = () => document.documentElement.dataset.shell === 'phone' ? 'phone' : 'desktop';
  function phones() {
    if (PH.pc || typeof window.WizPhoneConnect?.create !== 'function' || typeof fetch !== 'function') return PH.pc;
    PH.pc = window.WizPhoneConnect.create({
      layout: phoneShell(), qrScript: 'setup/vendor/qrcode.js',
      active: () => PH.wanted && document.visibilityState === 'visible',
      // The connection pill's evidence: Wizard's live reads are failing from this device (not a missing permission).
      offline: () => { const L = window.WizLive; return !!L && !!L.error && L.error !== 'access'; },
      // Settings redraws only when what it shows itself changes (the list entry, phones, Turn off); the component
      // redraws its own part.
      onChange: pc => {
        const v = pc.view, key = JSON.stringify([pc.status, pc.lost, pc.connecting, v?.step, v?.phones]);
        if (key !== PH.summary) { PH.summary = key; for (const m of mounts) m.render(); }
      },
    });
    // When the connection drops or comes back, re-check at once instead of showing the last answer as current.
    try { window.WizLive?.onChange?.(() => { const off = !!window.WizLive.error && window.WizLive.error !== 'access'; if (off !== PH.off) { PH.off = off; PH.pc?.refresh(); } }); } catch (e) {}
    return PH.pc;
  }
  function phonesAvailable() { const pc = phones(); if (!pc) return false; pc.refresh(15000); return pc.status !== 'denied'; }
  const osName = os => ({ ios: 'iPhone', android: 'Android', ipados: 'iPad' })[String(os || '').toLowerCase()] || 'Device';
  function closePhonesSheet(ctx) { PH.confirm = false; PH.error = ''; ctx.render(); ctx.root.querySelector('[data-st="phones-off"]')?.focus(); }
  register({ id: 'phones', page: 'phones', aliases: ['phones', 'devices', 'phone-access'], available: phonesAvailable, html() {
    const pc = phones(); if (!pc) return '';
    const v = pc.view, busy = pc.busy;
    let h = '<div class="st-group"><h4>Device access</h4><div class="st-pc" data-phone-connect></div></div>';
    if (pc.on && !pc.connecting) {
      h += '<div class="st-group"><h4>Your devices</h4>';
      h += v.phones.length ? v.phones.map(p => `<div class="st-row wz-row static"><span class="st-tx wz-main"><b>${esc(p.name)}</b><small>${esc(osName(p.os))} · ${p.online ? 'Online' : 'Offline'}</small></span></div>`).join('')
        : '<div class="st-empty">No device on your Tailscale account yet.</div>';
      h += '<a class="st-row" data-st="phones-manage" href="https://login.tailscale.com/admin/machines" target="_blank" rel="noopener noreferrer"><span class="st-tx"><b>Remove a device</b><small>Devices are listed on your Tailscale account. Remove one there and it can’t reach Wizard any more.</small></span><span class="st-go">↗</span></a>';
      h += '</div>';
    }
    if (!pc.connecting && (pc.on || pc.settingUp)) h += '<div class="st-group"><h4>Turn off</h4>' + row('phones-off', 'Turn off device access', 'Disconnects this Wizard from Tailscale. Your chats stay here.') + '</div>';
    if (PH.confirm) h += `<div class="st-confirm-scrim"><section class="st-confirm" role="alertdialog" aria-modal="true" aria-labelledby="phones-off-title" aria-describedby="phones-off-text"><h3 id="phones-off-title">Turn off device access?</h3><p id="phones-off-text">Every device loses access to this Wizard until you connect one again. Your chats stay here.</p>${PH.error ? `<p class="sc-error" role="alert">${esc(PH.error)}</p>` : ''}<div class="st-actions"><button data-st="phones-off-cancel" ${busy ? 'disabled' : ''}>Cancel</button><button data-st="phones-off-confirm" ${busy ? 'disabled' : ''}>${busy ? 'Turning off…' : 'Turn off'}</button></div></section></div>`;
    return h;
  }, painted(ctx, section) {
    const host = section?.querySelector('[data-phone-connect]'); if (host) phones()?.attach(host);
  }, deferRefresh: () => PH.confirm,
  enter() { PH.wanted = true; },
  leave() { PH.wanted = false; if (!PH.pc?.busy) { PH.confirm = false; PH.error = ''; } },
  back(ctx) { if (PH.pc?.back()) return true; if (!PH.confirm) return false; if (!PH.pc?.busy) closePhonesSheet(ctx); return true; },
  act(ctx, el) {
    const st = el.closest('[data-st]')?.dataset.st;
    if (st === 'phones-manage') return false; // the link leaves on its own
    if (st === 'phones-off') { PH.confirm = true; PH.error = ''; ctx.render(); ctx.root.querySelector('[data-st="phones-off-cancel"]')?.focus(); return true; }
    if (st === 'phones-off-cancel') { if (!PH.pc?.busy) closePhonesSheet(ctx); return true; }
    if (st === 'phones-off-confirm' && PH.pc && !PH.pc.busy) {
      const done = PH.pc.reset();
      ctx.render(); // the sheet shows "Turning off…"
      done.then(ok => {
        if (ok) { PH.confirm = false; ctx.toast?.('✓', 'Device access is off', 2200); }
        else PH.error = 'Couldn’t turn off device access. Try again.';
        ctx.render();
      });
      return true;
    }
    return false;
  } });
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
  // Desktop bar: one mic by default; the other three voice buttons live in its menu and on their keys, and this puts
  // them back in the bar (James, 31 Oct 2026: fewer icons on the right, nothing new in their place).
  // Phone shell only (core/orb-switcher.js is not loaded on the desktop): the row opens the Orb switcher sheet.
  register({ id: 'orb-switcher', page: 'phone', aliases: ['orb-switcher', 'orb-radial'], available: () => !!window.WosOrbSwitcher?.available,
    html: () => window.WosOrbSwitcher.settingsRow(),
    act: (ctx, el) => { if (!el.closest('[data-orbsw-open]')) return false; window.WosOrbSwitcher.openSettings(); return true; } });
  register({ id: 'bar-voice-buttons', page: 'voice', available: ctx => !!ctx?.barMics?.(),
    html: ctx => { const on = !!ctx.barMics().get(), k = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌥' : 'Alt+';
      return `<div class="st-group" data-bar-mics><h4>Top bar</h4><button class="st-row" data-bar-mics-set role="switch" aria-checked="${on}"><span class="st-tx"><b>Show every voice button</b><small>${esc(`New voice chat, Dictate and Tell the computer beside the mic. Off, they are in the mic’s menu (right-click or hold) and on ${k}V, ${k}D and ${k}C.`)}</small></span><span class="sw ${on ? 'on' : ''}"><i></i></span></button></div>`; },
    act: (ctx, el) => { const m = ctx.barMics?.(); if (!m || !el.closest('[data-bar-mics-set]')) return false; m.set(!m.get()); ctx.render?.(); return true; } });
  // Moved from the phone adapter: one About renderer, native data/actions only in WosDevice.
  function deviceAboutHtml() {
    const d = window.WosDevice?.settingsState?.(); if (!d) return '';
    return `<div class="st-row static"><span class="st-tx"><b>Recording</b><small>Keeps going with the screen off or in another app · Stop and Send in the notification</small></span></div>
      <div class="st-row static"><span class="st-tx"><b>Reply notifications</b><small>${d.notificationsAllowed ? `On · when ${esc(window.WizConfig.agent())} answers a chat you sent from here · clear once you read the thread` : 'Off · allow notifications for WizardOS in Android settings'}</small></span></div>
      <button class="st-row" data-dvupd data-settings-version="phone"><span class="st-tx"><b>Phone app (Android) ${esc(d.installed || '· version unavailable')}</b><small>${esc(d.updateDescription)}</small></span><span class="st-go">›</span></button>`;
  }
  register({ id: 'wizard', html(ctx) {
    const status = ctx.live?.ok ? 'Connected' : ctx.live?.error === 'access' ? 'Sign-in needed' : 'Connecting…';
    // No separate "Check for updates": the shell checks every minute and the update card offers Reload.
    const observed = window.WizWebUpdate?.firstObservedVersion || '';
    const device = deviceAboutHtml();
    return `<div class="st-group"><h4>Wizard</h4><div class="st-row static"><span class="st-tx"><b>${esc(status)}</b><small>${esc(native()?.platform?.() || 'Web')} · ${esc(location.host)}</small></span></div><p class="st-hint">The interface and your Wizard’s server update separately.${device ? ' The Android phone app updates separately too. Their version numbers are not comparable.' : ''}</p>${device}<details data-settings-technical><summary>Technical details</summary><div class="st-row static" data-settings-version="interface"><span class="st-tx"><b>Interface revision at first check</b><small title="${esc(observed)}">${esc(observed ? observed.slice(0, 8) : 'Not available yet')}</small></span></div><p class="st-hint" data-settings-observed-full style="overflow-wrap:anywhere">${esc(observed || 'Not available yet')}</p><p class="st-hint">The first successful version-file check, not a stamp of the code loaded in this page.</p></details>${row('help', 'Gestures & help', ctx.helpSub)}</div>`;
  }, act(ctx, el) { const st = el.closest('[data-st]')?.dataset.st; if (!['files', 'help'].includes(st)) return false; ctx.openSub(st); return true; } });
  // Settings › Resources shows the Home bars themselves (core/resources.js draws them into this host and keeps them
  // live); tapping a bar opens the same detail sheet as on Home (devices, health, AI accounts with reset times).
  register({ id: 'usage', aliases: ['usage', 'resources'], html: () => window.WosResources?.bars ? '<div class="st-group st-res" data-st-resources></div>' : window.WosUsage?.html() || '',
    painted(ctx, section) { const host = section?.querySelector?.('[data-st-resources]'); if (host) window.WosResources.bars(host); },
    act(ctx, el) { if (!el.closest('[data-usage-refresh]')) return false; window.WosUsage?.load(true).then(ctx.paintUsage); ctx.paintUsage(); return true; } });
  // A shell chooses the composer; common code owns preservation before consuming an unsent record.
  // key: put the words into that draft (a channel's own box, wizard-ux issue 1294) instead of the window's composer.
  function moveDraft({ chats, wid, item, outbox, toast, key = '' }) {
    if (item.audio || item.audioFile || item.hasAudio || item.body || item.state === 'unconfirmed' || item.state === 'sending' || outbox.quarantined?.(item.id)) {
      toast('!', 'Original kept · retry it or open its thread', 2400); return false;
    }
    if (item.model) {
      let selected; try { selected = window.WosModels?.snapshot(item.kind === 'reply' ? item.sessionId : '', null, item.agent || ''); } catch (_) {}
      if (!selected || selected.model !== item.model || (item.provider && selected.provider !== item.provider)) {
        toast('!', 'Original model route kept · select that model before editing', 2600); return false;
      }
    }
    const draft = key ? window.WosChat?.drafts.get(key) || {} : chats.ch(wid);
    if ((key ? draft.text?.trim() : draft.draft) || draft.files?.length) { toast('!', 'Existing draft kept · finish it before editing this unsent message', 2600); return false; }
    const text = item.text || item.typed || '', files = item.files || [];
    if (key) window.WosChat?.drafts.set(key, text, files); else chats.setDraft(wid, text, files);
    const saved = window.WosChat?.drafts.get(key || chats.ch(wid).draftFor);
    if (!saved || saved.text !== text || files.length !== saved.files.length || files.some((f, i) => f.id !== saved.files[i]?.id)) {
      toast('!', 'Draft could not be saved · original unsent message kept', 2600); return false;
    }
    outbox.remove(item.id); return true;
  }
  // The frame is kept while the page is open: background refreshes never reload it under the owner's hand.
  register({ id: 'connections', page: 'connections', aliases: ['connections', 'app-connections'], available: () => connectionsAvailable(),
    deferRefresh: ctx => !!ctx.root?.querySelector?.('[data-st-connections] iframe'),
    // Back steps inside the view first, the way an app window does: its open pop-up (the kit's canonical
    // __wizardCloseOverlay hook), then the map back to the list; only then does Settings leave the page.
    back(ctx) {
      const f = ctx.root?.querySelector?.('[data-st-connections] iframe');
      try {
        const w = f?.contentWindow; if (!w || w.location.origin !== location.origin) return false;
        if (typeof w.__wizardCloseOverlay === 'function' && w.__wizardCloseOverlay() === true) return true;
        const list = w.document.querySelector('[data-cm-seelist]');
        if (list && list.getClientRects().length) { list.click(); return true; }
      } catch (_) {}
      return false;
    },
    // ?embed=settings: the view drops its own title, sheet and canvas and takes the shell's skin (Appearance v1), so the
    // page head is the one title and the content sits straight on the Settings page, with no box around it.
    html: () => `<div class="st-embed" data-st-connections><iframe src="${esc(CONNECTIONS)}?embed=settings" title="Connections" allow="geolocation 'none'"></iframe></div>` });
  register({ id: 'notifications-in-chats', page: 'chats', html: () => { const r = settingRow('wizard/unified-inbox'); return r ? `<div class="st-group"><h4>Notifications</h4>${r}</div>` : ''; }, act: settingAct });
  // Draft marks are on for everyone (wizard-ux issue 1604, James: "just ship this"); an owner can still turn them off here.
  /* Settings › Notifications: one choice per app, Badge or Chats, never both (Miguel, 1 Nov 2026). Lists
   * Notifications and every installed app that has an inbox feed (only those can put items in Chats); every other app
   * shows a badge. Saved on this device. Chats needs Notifications in Chats (Settings › Chats) on. */
  // The picker itself is WosBell.picker: the same one sits on every notification opened in Chats.
  const routeSeg = (r, off) => window.WosBell.picker(r.id, { name: r.name, off });
  register({ id: 'notification-routing', page: 'notifications', aliases: ['notifications', 'notification-routing'],
    subtitle: () => { const at = window.WosBell?.attention?.(); if (at?.n) return `${at.n} ${at.short}`; const n = (window.WosBell?.routes?.() || []).filter(r => r.chats).length; return n ? `${n} in Chats` : ''; },
    // The routing part hears the page open and close (it may treat opening as having seen what it counts).
    enter: () => { window.WosBell?.discover?.(); window.WosBell?.entered?.(); },
    leave: () => { window.WosBell?.left?.(); },
    html() {
      const B = window.WosBell, list = B?.routes?.() || [], off = !B?.chatsAvailable;
      if (!B?.routes) return '';
      void B.discover?.();
      // Every word below comes from the routing part (WosBell.describe / intro / groups); stock = Badge | Chats.
      const row = r => `<div class="st-nr" data-notify-app="${esc(r.id)}"><span class="st-tx"><b>${esc(r.name)}</b><small>${esc(B.describe ? B.describe(r, off) : '')}</small></span>${routeSeg(r, off)}</div>`;
      const rows = list.map(row).join('');
      const ago = t => { const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60)); return m < 60 ? `${m || 1}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
      const listHtml = (l, key) => l?.items.length ? `<h4>${esc(l.title)}</h4><ul class="st-${key}-list">${l.items.map(i => `<li class="${i.fresh ? 'new' : ''}${i.needs ? ' needs' : ''}"><span class="st-tx"><b>${esc(i.title)}</b><small>${esc(i.text)}</small></span><time>${esc(ago(i.time))}</time></li>`).join('')}</ul>` : '';
      const more = (B.groups?.() || []).filter(g => g.rows.length).map(g => `<div class="st-group st-${g.key}"><h4>${esc(g.title)}</h4>${g.hint ? `<p class="st-hint">${esc(g.hint)}</p>` : ''}${g.rows.map(row).join('')}${listHtml(g.list, g.key)}</div>`).join('');
      const intro = B.intro?.(), lead = intro ? intro.lead.map(([t, b]) => b ? `<b>${esc(t)}</b>` : esc(t)).join('') : '';
      const note = off ? `<p class="st-hint">Chats isn’t showing notifications on this device, so every app shows a badge. Turn on Notifications in Chats to choose Chats:</p>${settingRow('wizard/unified-inbox')}` : '';
      return `<div class="st-group"><p class="st-hint">${lead}</p>${note}${rows || '<p class="st-hint">No apps send notifications yet.</p>'}<p class="st-hint">${esc(intro?.foot || '')}</p></div>${more}`;
    },
    act(ctx, el) {
      const b = el.closest('[data-notify-route]');
      if (!b) return settingAct(ctx, el);
      if (b.disabled) return true;
      window.WosBell?.setRoute?.(b.dataset.notifyRoute, b.dataset.notifyTo);
      ctx.render?.(); ctx.root?.querySelector?.(`[data-notify-route="${CSS.escape(b.dataset.notifyRoute)}"][data-notify-to="${CSS.escape(b.dataset.notifyTo)}"]`)?.focus?.({ preventScroll: true });
      return true;
    } });
  register({ id: 'chats-default', page: 'chats', aliases: ['chats-default'], html(ctx) {
    const host = chatsHost(), apps = host?.installed() || [{ id: 'wizard-chats' }], current = host?.defaultId() || 'wizard-chats';
    apps.sort((a, b) => (b.id === 'wizard-chats') - (a.id === 'wizard-chats'));
    return `<div class="st-group"><h4>Default Chats</h4><div class="st-chats-options" role="radiogroup" aria-label="Default Chats">${apps.map(a => `<button class="st-row wz-row" role="radio" aria-checked="${a.id === current}" data-chats-choice="${esc(a.id)}" ${ctx.chatsBusy ? 'disabled' : ''}><span aria-hidden="true">${a.id === current ? '◉' : '○'}</span><span class="st-tx"><b>${esc(a.id === 'wizard-chats' ? 'Wizard Chats (built in)' : a.name)}</b></span></button>`).join('')}</div>${apps.length === 1 ? '<div class="st-store-hint">Install another Chats from the <button data-chats-store>Store</button> to switch</div>' : ''}</div>`;
  } });
  /* The Settings view (mount), deep links (route) and the focus trap live in core/settings-view.js (wizard-ux issue 1665). */
  const { cancelWait, mount, route, trap } = window.WizCore.settingsParts.view({ attention, cardHtml, chatsHost, chatsName, esc, featurePages, features, filled, mounts, pageOf, PAGES, subtitle });
  window.WosMySkin?.on(() => { for (const m of mounts) m.render(); });
  /* Share feature counts (wizard-app-manager issue 701, box switch wizard/try-feature-counts, off by default): while it
   * is on, read the Try new features state (tried, thumbs) of every app the App Manager can't call itself (no owner
   * proof key, wizard-os#133) the way the Tracker's Try it does (same origin, the owner's Serve login, X-Wizard-Switch: 1)
   * and hand only {id, issues, tried, vote} to this box's App Manager (store-install/_switch-feedback), which sends the
   * anonymous counts. A few seconds after start, then at most every 10 minutes while the shell is visible. */
  const COUNTS_TWEAK = 'wizard/try-feature-counts', COUNTS_EVERY = 10 * 60 * 1000, COUNT_APP = /^[a-z0-9][a-z0-9-]{0,62}$/;
  const counts = { at: 0, busy: false, timer: 0 };
  const countsOn = () => { try { return String(document.documentElement?.dataset?.tweaks || '').split(' ').includes(COUNTS_TWEAK); } catch (e) { return false; } };
  async function countsListing(app) {
    for (const p of ['api/switches', 'api/view/switches']) {
      const r = await window.fetch(`/${encodeURIComponent(app)}/${p}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'X-Wizard-Switch': '1' } });
      if (r.status === 404) continue;
      const j = /json/.test(r.headers.get('content-type') || '') ? await r.json().catch(() => null) : null;
      return r.ok && j && Array.isArray(j.switches) ? j.switches : null;
    }
    return null;
  }
  async function countsCollect() {
    const cat = await appSwFetch();
    const apps = (Array.isArray(cat?.apps) ? cat.apps : []).filter(a => a && a.ok === false && COUNT_APP.test(String(a.id || '')));
    const out = [];
    for (const a of apps) {
      try {
        const sw = await countsListing(a.id);
        if (sw) out.push({ id: a.id, switches: sw.filter(x => x && typeof x.id === 'string').map(x => ({ id: x.id, issues: Array.isArray(x.issues) ? x.issues : [], tried: x.tried === true, vote: x.vote === 'up' || x.vote === 'down' ? x.vote : null })) });
      } catch (e) { /* that app is restarting or gone: next time */ }
    }
    if (!out.length) return { apps: 0 };
    const r = await window.fetch(homePath('store-install/_switch-feedback'), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ apps: out }) });
    return { apps: out.length, status: r.status };
  }
  function countsRun() {
    if (counts.busy || !countsOn() || typeof window.fetch !== 'function' || document.visibilityState === 'hidden' || Date.now() - counts.at < COUNTS_EVERY) return null;
    counts.busy = true; counts.at = Date.now();
    return countsCollect().catch(() => null).finally(() => { counts.busy = false; });
  }
  // Armed only while the switch is on (wos:experience fires once the shell has applied its switches): a few seconds after
  // start, then every 10 minutes. Switched off, no timer is left behind.
  function countsArm() {
    if (counts.timer || !countsOn() || typeof setTimeout !== 'function') return;
    counts.timer = setTimeout(() => { counts.timer = 0; void countsRun(); countsArm(); }, counts.at ? COUNTS_EVERY : 4000);
  }
  window.addEventListener?.('wos:experience', countsArm);
  window.addEventListener?.('visibilitychange', () => { void countsRun(); countsArm(); });
  /* Ask before feature counts leave the box (wizard-ux issue 1817, switch wizard/feature-counts-ask, off by default).
   * James, 25 Nov 2026: counts are never sent without the owner's explicit opt-in. Share feature counts stays off until
   * the owner says Share to one plain prompt that names exactly what is sent. The prompt opens the first time the owner
   * taps a thumb in an app's Try new features section (an app frame in this shell, or a thumb already saved that this
   * device finds on its next look), and whenever Share feature counts is turned on from the shell. Share turns it on;
   * Don't share keeps it off and this device never asks again on a thumb. Waiting on the prompt reads or sends nothing.
   * Turning it off stays one tap. */
  const ASK_TWEAK = 'wizard/feature-counts-ask', ASK_KEY = 'wos.feature-counts.answer.v1', ASK_EVERY = 10 * 60 * 1000;
  const ask = { el: null, dismissed: false, at: 0, busy: false, docs: typeof WeakSet === 'function' ? new WeakSet() : null };
  const askOn = () => { try { return String(document.documentElement?.dataset?.tweaks || '').split(' ').includes(ASK_TWEAK); } catch (e) { return false; } };
  const askAnswer = () => { try { return localStorage.getItem(ASK_KEY) || ''; } catch (e) { return ''; } };
  const askDue = () => askOn() && !countsOn() && !askAnswer() && !ask.dismissed && !ask.el;
  const askHtml = example => `<div class="st-confirm-scrim fc-ask-scrim" data-fc-ask><section class="st-confirm fc-ask" role="dialog" aria-modal="true" aria-labelledby="fc-ask-title">`
    + `<h3 id="fc-ask-title">Share feature counts?</h3>`
    + `<p>Your thumbs up and down stay on this Wizard. You can also share them with the WizardOS team, so they see which test features people try and like.</p>`
    + `<p>If you choose Share, this Wizard sends only this, for each test feature you tried or gave a thumb:</p>`
    + `<ul><li>the feature’s switch id${example ? ` (this one is <code>${esc(example)}</code>)` : ''}</li><li>whether you tried it</li><li>your thumbs up or down</li><li>a random box id, so your Wizard is counted once</li></ul>`
    + `<p>No names, messages or other content, and nothing that says who you are. Nothing is sent unless you choose Share. You can turn it off again in Settings, under Try new features (Share feature counts).</p>`
    + `<div class="st-actions"><button type="button" class="ghost" data-fc-ask-no>Don’t share</button><button type="button" class="fc-ask-yes" data-fc-ask-yes>Share</button></div></section></div>`;
  function askOpen(example) {
    if (ask.el || !document.body) return false;
    const holder = document.createElement('div'); holder.innerHTML = askHtml(example);
    const el = ask.el = holder.firstElementChild;
    el.addEventListener('click', e => {
      if (e.target.closest?.('[data-fc-ask-yes]')) void askDone('share');
      else if (e.target.closest?.('[data-fc-ask-no]')) void askDone('decline');
      else if (e.target === el) void askDone(''); // a tap outside is no answer: nothing is sent
    });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void askDone(''); } });
    document.body.appendChild(el);
    el.querySelector('[data-fc-ask-yes]')?.focus?.({ preventScroll: true });
    return true;
  }
  async function askDone(answer) {
    const el = ask.el; if (!el) return '';
    ask.el = null; el.remove();
    if (!answer) { ask.dismissed = true; return 'feature-counts-ask'; }
    try { localStorage.setItem(ASK_KEY, answer); } catch (e) { /* private mode: asks again next start */ }
    if (answer === 'share' && !countsOn()) {
      try { await window.WosExperience?.toggle(COUNTS_TWEAK); } catch (e) { (window.__wos?.toast || window.__wux?.toast)?.('!', e?.message || 'Couldn’t turn on Share feature counts', 2400); }
    }
    return 'feature-counts-ask';
  }
  // Turning Share feature counts ON from the shell (Settings row, chat switch card) goes through the prompt; OFF is one tap.
  function askIntercept(id) {
    if (id !== COUNTS_TWEAK || !askOn() || countsOn() || ask.el) return false;
    return askOpen('');
  }
  // A thumb tapped in an app frame: the kit's buttons carry data-try-vote inside a row with data-try-id. The vote itself
  // is still saved by the app on the box (it never leaves it); only the prompt is added.
  function askHook(frame) {
    let doc = null; try { doc = frame.contentDocument; } catch (e) { return; } // another origin: the next look finds it
    if (!doc || !ask.docs || ask.docs.has(doc)) return;
    ask.docs.add(doc);
    doc.addEventListener('click', e => {
      const b = e.target?.closest?.('[data-try-vote]'); if (!b || !askDue()) return;
      let app = frame.dataset?.ownApp || '';
      if (!app) try { app = decodeURIComponent(String(frame.contentWindow.location.pathname).split('/')[1] || ''); } catch (err) { app = ''; }
      const sw = b.closest('[data-try-id]')?.getAttribute('data-try-id') || '';
      askOpen(COUNT_APP.test(app) && sw ? `${app}:${sw}` : '');
    }, true);
  }
  function askScan() { if (askOn()) for (const f of document.querySelectorAll?.('iframe') || []) askHook(f); }
  // A thumb given before (or in an app opened outside the shell): the box's switch catalog, then the apps the App
  // Manager can't read itself, the same reads the counts use, kept on this device. At most every 10 minutes.
  async function askLook() {
    if (!askDue() || ask.busy || typeof window.fetch !== 'function' || document.visibilityState === 'hidden' || Date.now() - ask.at < ASK_EVERY) return;
    ask.busy = true; ask.at = Date.now();
    try {
      const cat = await appSwFetch();
      const voted = s => s && typeof s.id === 'string' && (s.vote === 'up' || s.vote === 'down');
      let hit = (Array.isArray(cat?.switches) ? cat.switches : []).find(s => s?.kind === 'app' && voted(s))?.id || '';
      for (const a of (Array.isArray(cat?.apps) ? cat.apps : []).filter(a => a && a.ok === false && COUNT_APP.test(String(a.id || '')))) {
        if (hit) break;
        try { const sw = (await countsListing(a.id) || []).find(voted); if (sw) hit = `${a.id}:${sw.id}`; } catch (e) { /* next time */ }
      }
      if (hit && askDue()) askOpen(hit);
    } catch (e) { /* no App Manager here: nothing to look at */ } finally { ask.busy = false; }
  }
  function askArm() { if (!askOn()) return; askScan(); void askLook(); }
  document.addEventListener?.('load', e => { if (e.target?.tagName === 'IFRAME' && askOn()) askHook(e.target); }, true);
  window.addEventListener?.('wos:experience', askArm);
  window.addEventListener?.('visibilitychange', () => { if (document.visibilityState !== 'hidden') askArm(); });
  window.WosSettings = { refresh: () => { for (const m of mounts) m.render(); }, countsCollect, countsAsk: { get isOpen() { return !!ask.el; }, back: () => { void askDone(''); return 'feature-counts-ask'; }, open: askOpen, intercept: askIntercept }, register, mount, route, cancelWait, tweakCard, tweakCardTap, hasSystem: () => PAGES.some(p => p.group === 'System' && p.available()), systemPages: Object.freeze(PAGES.filter(p => p.group === 'System').map(p => p.id)), trap, pageOf, attention, moveDraft, unsentAll, unsentRow, unsentAction, retryAll, focusUnsent, tweakOptions, get features() { return [...features.values()].map(f => ({ id: f.id, aliases: f.aliases || [], page: pageOf(f) })); } };
})();
