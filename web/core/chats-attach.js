/* Wizard UX core: Chats › attachments and voice notes: the composer's attachment tray and uploads, the mic / send
 * button swap, voice-note recording, and how a turn with media renders. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the functions it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.attach = function ({ ch, CHEV_SVG, clip, COG_SVG, draftKey, draftsLate, elOf, esc, fileRef, INC, KIT, leadText, md, regenOn, replyBubble, replyCard, saveDraft, summaryOf, summaryStartsOpen, sweepHtml, toast, track, W, winAgent }) {
  let PW; // late-bound: chats.js declares these after the call, see bindLate
  /* ---- attachments: Wizard Files + the wizard_file_ids contract Wizard uses ----
   * Every attachment goes through the resumable /wizard/v1/uploads API when the box offers it (core/uploads.js):
   * chunked, any size, resumes after a dropped network or a Wizard restart, progress on the chip. A box without
   * capabilities.resumable_uploads keeps the old one-shot POST /wizard/files/upload (its own 64 MB limit). */
  // No per-message file COUNT cap (James, 6 Nov 2026: "don't impose arbitrary limits on the user"); only real
  // limits remain: per-file size on the upload route, and the Agent Service's inline-image byte budget.
  const OLD_ROUTE_MAX = 64 * 1024 * 1024;
  const PEND = window.WizUploads?.pending || null;
  // A placeholder for a file still uploading (sent before it finished) shows its local thumbnail until it lands.
  const pendRef = f => { const r = PEND ? PEND.ref(f) : (f && f.id && !f.uploading ? fileRef(f) : null); if (r && PEND?.isPending(r.id) && f.preview) PREVIEW[r.id] = f.preview; return r; };
  const fileKind = f => /^audio\//.test(f.mime || '') || /^wizard-voice-/.test(f.name || '') ? 'voice' : /^image\//.test(f.mime || '') ? 'image' : 'file';
  const fsize = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
  const fileUrl = id => `/wizard/files/${encodeURIComponent(id)}/content`;
  async function uploadFile(file, { signal, onProgress } = {}) {
    if (window.WizUploads?.supported()) {
      try { return await window.WizUploads.upload(file, { signal, onProgress }); }
      catch (e) {
        // A cached bootstrap can outlive the box's support (rolled-back service): only a create that the route
        // itself refuses (404/405) drops to the old path; everything else is a real answer.
        if (!(e.status === 404 || e.status === 405) || e.code) throw e;
      }
    }
    return uploadFileOnce(file, { signal });
  }
  async function uploadFileOnce(file, { signal } = {}) {
    if (file.size > OLD_ROUTE_MAX) throw Object.assign(new Error('This Wizard takes files up to 64 MB · update it for bigger files.'), { user: true });
    const r = await fetch('/wizard/files/upload', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Wizard-Filename': file.name || 'upload', 'X-Wizard-Mime': file.type || 'application/octet-stream' }, body: file, signal });
    if (!r.ok) throw Object.assign(new Error(r.status === 413 ? 'That file is too large for Wizard Files.' : `Wizard Files is unavailable (${r.status}).`), { status: r.status, user: true });
    const f = (await r.json()).file || {};
    if (!f.id) throw new Error('Wizard Files returned an invalid upload receipt.');
    return { id: String(f.id), name: String(f.filename || file.name), mime: String(f.mime || file.type || ''), bytes: Number(f.bytes) || file.size };
  }
  // A multi-pick stages every file at once (each shows immediately), then they upload side by side.
  // Progress paints into the chip in place (no tray re-render per tick); removing a chip cancels its upload.
  function paintUpload(wid, f) {
    window.WizAttachChip.paint(track.querySelector(`[data-chats="${wid}"] [data-attkey="${CSS.escape(f.key)}"]`), chipOf(f));
  }

  async function addFiles(wid, list) {
    if (INC?.active(wid)) { toast('!', 'Attachments aren’t available in Incognito', 2200); return; }
    const c = ch(wid); c.files = c.files || [];
    const picked = [...list];
    const locals = picked.map(file => ({ file, key: Math.random().toString(36).slice(2), name: file.name, mime: file.type, bytes: file.size, uploading: true, sent: 0, total: file.size, upState: 'uploading', preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' }));
    if (!locals.length) return;
    c.files.push(...locals); refreshCompose(wid);
    const tray = c.files; // a channel's tray can be parked while this uploads (chanComposer); it settles there
    await Promise.all(locals.map(async local => {
      const { file } = local; delete local.file;
      const abort = new AbortController(); UPLOAD_ABORT.set(local.key, abort);
      let painted = 0;
      const onProgress = (sent, total, state) => {
        local.sent = sent; local.total = total; local.upState = state;
        const t = performance.now(); if (t - painted < 120 && state === 'uploading' && sent < total) return;
        painted = t; paintUpload(wid, local);
      };
      // Sending never waits for this: a send while it runs takes a placeholder (WizUploads.pending) and the outbox
      // collects the receipt from here, or re-uploads the kept bytes if this upload dies.
      const settle = PEND ? PEND.track(local, file) : null;
      try { const f = await uploadFile(file, { signal: abort.signal, onProgress }); Object.assign(local, f, { uploading: false }); settle?.ok(f); if (local.preview) PREVIEW[local.id] = local.preview; }
      catch (e) { settle?.fail(e); c.files = c.files.filter(x => x !== local); if (tray !== c.files && tray.includes(local)) tray.splice(tray.indexOf(local), 1); if (!abort.signal.aborted && !local.handedOff) toast('!', e.user ? e.message : 'Upload failed · not attached', 3200); }
      finally { UPLOAD_ABORT.delete(local.key); }
      refreshCompose(wid);
    }));
    // Parked with its channel (another channel opened meanwhile): save it there, never into the box in front.
    for (const [k, t] of c.chanTrays || []) if (t === tray && tray !== c.files) KIT.drafts.set(k, KIT.drafts.get(k).text, t);
    saveDraft(wid);
  }
  const UPLOAD_ABORT = new Map();
  // Photos and screenshots stage as big thumbnails only; other files keep a name chip.
  // The tray's chips are Wizard's one attachment chip (core/attach-chip.js), shared with every app's chat box.
  const chipOf = f => { const k = fileKind(f); return { key: f.key, name: f.name, bytes: f.bytes, kind: k === 'voice' || k === 'image' ? k : 'file', preview: f.preview, uploading: !!f.uploading, sent: f.sent, total: f.total, state: f.upState }; };
  function attachTray(c) {
    const files = c.files || [];
    if (!files.length) return '';
    return `<div class="ch-tray">${files.map(f => window.WizAttachChip.html(chipOf(f))).join('')}</div>`;
  }

  /* Mic only while the draft is completely empty. Typed words or a staged attachment (.has-text) swap it for Send;
   * a voice take already recording in this thread still turns the mic itself into Send (.ch-mic.on). */
  const hasContent = (text, files = []) => !!String(text || '').trim() || files.some(f => f && (f.id || f.uploading));
  function syncSend(form, c) { if (form) form.classList.toggle('has-text', hasContent(form.querySelector('textarea')?.value, c?.files || [])); }
  // Repaint only the reply bubble (the textarea, its words and focus stay put).
  function refreshReply(wid) {
    const w = W[wid], form = elOf(wid)?.querySelector('[data-chform]'); if (!w || !form) return;
    const r = w.thread && (w.thread !== '__new__' || !winAgent(w)) ? KIT.drafts.get(draftKey(w)).reply : null;
    form.querySelector('[data-chreply]')?.remove(); form.classList.toggle('has-reply', !!r);
    if (r) form.insertAdjacentHTML('afterbegin', replyBubble(r));
  }
  function refreshCompose(wid) {
    if (INC?.active(wid)) return;
    const el = track.querySelector(`[data-chats="${wid}"]`); const form = el?.querySelector('[data-chform]'); if (!form) return;
    const c = ch(wid), old = form.querySelector('.ch-tray');
    const html = attachTray(c);
    if (old) old.outerHTML = html || ''; else if (html) form.insertAdjacentHTML('afterbegin', html);
    syncSend(form, c); // Send stays live while files upload: they go with the message and finish behind it
  }
  const MIC_SVG = '<svg viewBox="0 0 24 24"><path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18v4"/></svg>';
  const CLIP_SVG = '<svg viewBox="0 0 24 24"><path d="m9.5 17.5 7.7-7.7a3 3 0 0 0-4.2-4.2l-8 8a5 5 0 0 0 7.1 7.1l8-8"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
  const DL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>';
  /* ---- voice notes: mic + "Voice note" + length, tap to play (Telegram-style) ---- */
  const DUR_KEY = 'wos.voice-durations.v1';
  let DUR = (() => { try { return JSON.parse(localStorage.getItem(DUR_KEY) || '{}'); } catch (e) { return {}; } })();
  const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const durLoading = new Set();
  function loadDuration(id) {
    if (!id || DUR[id] != null || durLoading.has(id)) return; durLoading.add(id);
    const a = new Audio(); a.preload = 'metadata';
    const done = d => { durLoading.delete(id); if (isFinite(d) && d > 0) { DUR[id] = d; try { localStorage.setItem(DUR_KEY, JSON.stringify(DUR)); } catch (e) {} for (const n of document.querySelectorAll(`[data-vnote="${CSS.escape(id)}"] .vd`)) n.textContent = mmss(d); } a.src = ''; };
    a.addEventListener('loadedmetadata', () => {
      if (isFinite(a.duration)) return done(a.duration);
      // Some m4a files report Infinity until the end is probed.
      a.addEventListener('timeupdate', function f() { a.removeEventListener('timeupdate', f); done(a.duration); a.currentTime = 0; });
      a.currentTime = 1e7;
    });
    a.addEventListener('error', () => durLoading.delete(id));
    a.src = fileUrl(id);
  }
  let player = null; // { id, audio }
  function toggleVoice(id) {
    if (INC?.active(id)) { toast('!', 'Incognito is text only', 2200); return; }
    if (player && player.id === id) { if (player.audio.paused) player.audio.play().catch(() => {}); else player.audio.pause(); return; }
    if (player) { player.audio.pause(); paintVoice(player.id, false, 0); }
    const audio = new Audio(fileUrl(id)); player = { id, audio };
    audio.addEventListener('timeupdate', () => { const d = DUR[id] || audio.duration; paintVoice(id, !audio.paused, isFinite(d) && d ? audio.currentTime / d : 0, audio.currentTime); });
    audio.addEventListener('play', () => paintVoice(id, true));
    audio.addEventListener('pause', () => paintVoice(id, false));
    audio.addEventListener('ended', () => { paintVoice(id, false, 0); player = null; });
    audio.addEventListener('error', () => { paintVoice(id, false, 0); player = null; toast('!', 'Couldn’t play this voice note', 2400); });
    audio.play().catch(() => {});
  }
  function paintVoice(id, playing, frac, t) {
    for (const n of document.querySelectorAll(`[data-vnote="${CSS.escape(id)}"]`)) {
      n.classList.toggle('playing', !!playing);
      if (frac != null) n.style.setProperty('--p', String(Math.min(1, frac)));
      const vd = n.querySelector('.vd'); if (vd && t != null && playing) vd.textContent = mmss(t); else if (vd && !playing && DUR[id]) vd.textContent = mmss(DUR[id]);
    }
  }
  // Local thumbnails for files uploaded from this phone, so a just-sent photo shows before Wizard has it.
  const PREVIEW = {};
  // wizard-ux#1840: once Wizard has the file, the bubble shows Wizard's copy. The local blob: preview is only a stand-in
  // while it is still uploading: on an Android WebView it can stop being readable, which left a broken photo in the
  // owner's own bubble until a reload. It stays as `local`, a fallback for a moment Wizard can't be reached, and is
  // released as soon as Wizard's copy has loaded (photoLoaded below).
  const mediaOfFile = f => {
    const url = f.id && !PEND?.isPending(f.id) ? fileUrl(f.id) : '', mine = PREVIEW[f.id] || '';
    return { id: f.id, name: f.name, mime: f.mime || '', bytes: f.bytes || 0, kind: /^image\//.test(f.mime || '') ? 'image' : /^video\//.test(f.mime || '') ? 'video' : /^audio\//.test(f.mime || '') ? 'audio' : 'file', url, thumb: url ? '' : mine, local: url ? mine : '' };
  };
  const photoOf = e => { const img = e.target; return img instanceof HTMLImageElement && img.dataset.local ? img : null; };
  function photoLoaded(e) {
    const img = photoOf(e), u = img?.dataset.local; if (!img || img.getAttribute('src') === u) return;
    img.removeAttribute('data-local');
    for (const [id, p] of Object.entries(PREVIEW)) if (p === u) delete PREVIEW[id];
    if (/^blob:/.test(u)) URL.revokeObjectURL(u);
  }
  function photoFailed(e) {
    const img = photoOf(e), u = img?.dataset.local; if (!img || img.getAttribute('src') === u) return;
    img.setAttribute('src', u); // Wizard's copy didn't load this time: the phone's own copy, while it still has it
  }
  // load/error don't bubble: listen in the capture phase, once for every thread this Chats draws.
  document.addEventListener('load', photoLoaded, true);
  document.addEventListener('error', photoFailed, true);
  // Every photo/file in the open thread gets an index into c.media; tapping it opens the in-app viewer.
  function mediaBtn(c, m) {
    const k = c.media.push(m) - 1;
    // Inline bytes are already local. Lazy decoding can deadlock an image-only
    // shrink-to-fit bubble at zero width, so only network images remain lazy; the owner's own images (m.eager, set by
    // userMedia) load at once too, in a steer bubble beside a voice note as well (wizard-ux#1840).
    if (m.kind === 'image') return `<button type="button" class="mimg" data-mi="${k}" aria-label="Open ${esc(m.name || 'photo')}"><img src="${esc(m.thumb || m.url)}"${m.local ? ` data-local="${esc(m.local)}"` : ''} alt="${esc(m.name || 'Photo')}" loading="${m.eager || /^data:image\//i.test(m.thumb || m.url || '') ? 'eager' : 'lazy'}" decoding="async"></button>`;
    if (m.kind === 'audio') return `<div class="mcard aud"><span class="mic">♪</span><span class="mn"><b>${esc(m.name)}</b><audio controls preload="none" src="${esc(m.url)}"></audio>${m.transcript ? `<small>${esc(m.transcript)}</small>` : ''}</span></div>`;
    // A file or video card: tap it to view it in Wizard; the ⤓ beside the name downloads it in one tap.
    const card = `<button type="button" class="mcard" data-mi="${k}"><span class="mic">${m.kind === 'video' ? PLAY_SVG : CLIP_SVG}</span><span class="mn"><b>${esc(m.name)}</b><small>${esc(m.kind === 'video' ? 'Video' : (m.mime.split('/')[1] || 'File').toUpperCase())}${m.bytes ? ' · ' + esc(fsize(m.bytes)) : ''}</small></span></button>`;
    if (!m.url) return card;
    return `<div class="mfile">${card}<button type="button" class="mdl" data-mdl="${k}" title="Download" aria-label="Download ${esc(m.name || 'file')}">${DL_SVG}</button></div>`;
  }
  function mediaBlock(c, list) {
    if (!list.length) return '';
    const imgs = list.filter(m => m.kind === 'image'), rest = list.filter(m => m.kind !== 'image');
    return (imgs.length ? `<div class="mgrid n${Math.min(imgs.length, 4)}">${imgs.map(m => mediaBtn(c, m)).join('')}</div>` : '') + (rest.length ? `<div class="mcards">${rest.map(m => mediaBtn(c, m)).join('')}</div>` : '');
  }
  // What the owner sent: voice notes play inline, photos and screenshots show as photos, other files as cards.
  function userMedia(c, files, images) {
    const voice = files.filter(f => fileKind(f) === 'voice');
    const list = files.filter(f => fileKind(f) !== 'voice').map(f => ({ ...mediaOfFile(f), eager: true })).filter(m => m.url || m.thumb)
      .concat((images || []).map((u, i) => ({ id: 'img' + i, name: 'Photo', mime: 'image/*', kind: 'image', url: u })));
    const unnamed = files.filter(f => fileKind(f) !== 'voice' && (!f.id || (PEND?.isPending(f.id) && !PREVIEW[f.id]))).map(f => `<span class="fchip">${CLIP_SVG} ${esc(f.name)}</span>`).join('');
    return (voice.length ? `<div class="fchips">${voice.map(fileChip).join('')}</div>` : '') + mediaBlock(c, list) + (unnamed ? `<div class="fchips">${unnamed}</div>` : '');
  }
  function fileChip(f) {
    const k = fileKind(f);
    if (k === 'voice' && f.id) { loadDuration(f.id); return `<button type="button" class="vnote" data-vnote="${esc(f.id)}" aria-label="Play voice note"><span class="vp">${PLAY_SVG}<i></i></span><span class="vw"><span class="vt">${MIC_SVG}Voice note</span><span class="vbar"><b></b></span></span><span class="vd">${DUR[f.id] ? mmss(DUR[f.id]) : ''}</span></button>`; }
    if (k === 'voice') return `<span class="fchip">${MIC_SVG} Voice note</span>`;
    return `<span class="fchip">${CLIP_SVG} ${esc(f.name)}</span>`;
  }
  const COPY_SVG = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const SHARE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  draftsLate({ CHECK_SVG });
  const timeTag = ms => isFinite(ms) ? `<time title="${esc(KIT.time.full(ms))}">${esc(KIT.time.stamp(ms))}</time>` : '';
  // A note another agent thread wrote into this one: never shown as the owner's message. Collapsed to one labelled
  // line (who sent it); tap to read it.
  function noteHtml(n) {
    const from = n.from ? `From the \u201c${esc(n.from)}\u201d thread` : 'From another agent thread';
    return `<details class="msg agentnote" data-agentnote><summary><span class="an-ic">\u21aa</span><span class="an-from">${from}</span>${timeTag(n.at)}</summary><div class="an-body">${md(n.text)}</div></details>`;
  }
  function runContextHtml(later) {
    const ctx = later.context;
    const text = value => typeof value === 'string' ? value : '';
    const title = ctx?.kind === 'cross_thread' ? 'Context received from another thread' : 'Context received for this run';
    const body = ctx
      ? `<b class="rc-title">${title}</b>${text(ctx.from) ? `<p class="rc-from">From: <strong>${esc(text(ctx.from))}</strong></p>` : ''}<p class="rc-excerpt">${esc(text(ctx.summary))}</p>${text(ctx.requested_action) ? `<p class="rc-action"><strong>Requested action:</strong> ${esc(text(ctx.requested_action))}</p>` : ''}${text(ctx.original) ? `<details class="rc-original" data-run-original="${esc(later.id || String(later.at))}"><summary>Show original message</summary>${ctx.redacted ? '<p class="rc-disclosure">Private context or sensitive values have been omitted.</p>' : ''}${ctx.original_truncated ? '<p class="rc-disclosure">The original message is shortened here.</p>' : ''}<pre>${esc(text(ctx.original))}</pre></details>` : ''}`
      : '<p class="rc-unavailable">The message that started this run isn’t available in this history.</p>';
    return `<section class="msg runcontext" data-run-context><div class="laterrun" data-later><span class="lr-ic">\u21aa</span><span>Started without a new message from you</span>${timeTag(later.at)}</div><div class="rc-body">${body}</div></section>`;
  }
  // Thread tracker: every message carries its row id and time so a tracker row or a quote can find it again.
  // Main builder agent only: turnHtml passes tt (onFor the thread's agent), so other agents' bubbles carry neither.
  // Issue 1331: Needs you in the thread makes Reply standard (turnHtml's tt: main agent) and retires the tracker itself.
  const msgIds = (m, at, tt = true) => (tt && m ? `${m.id != null ? ` data-mid="${esc(String(m.id))}"` : ''}${isFinite(at ?? m.at) ? ` data-mat="${at ?? m.at}"` : ''}` : '');
  const quoteBtn = (tt = true) => (tt ? '<button type="button" data-mquote aria-label="Reply to this message" title="Reply"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/></svg>Reply</button>' : '');
  // needs: the amber Needs you line (issue 1331) drawn right above this turn's reply bubble.
  function turnHtml(c, tn, last, working, helperStatus, reconnect, tt = true, needs = '') {
    let h = '';
    // A provider sign-out has its own panel (Open Claude / Open ChatGPT) in place of Hermes' generic failed-turn notice.
    if (last && reconnect && tn.a?.failed) tn = { ...tn, a: null };
    // A turn whose last agent message still called tools never finished (failed, stopped, restarted): that message is a
    // progress note, so it stays in the work fold and the turn says it stopped, instead of posing as the reply.
    const stopped = !(last && working) && tn.a && tn.a.final === false && !tn.a.failed && !tn.a.sweep && !tn.media.length;
    if (stopped) tn = { ...tn, notes: [...tn.notes, tn.a.text], steps: tn.steps + 1, a: null };
    // 9 Nov 2026 (James: "the message I sent is disappearing"): a message Hermes never took in stays in the thread,
    // marked Not sent. Retry here is the failed panel's own Retry (the same saved words and files, sent once).
    const unsent = tn.u && ['failed', 'interrupted'].includes(tn.u.queue?.status);
    const unsentRetry = unsent && c.retryRunId && tn.u.queue.runId === c.retryRunId
      ? `<button type="button" class="pbtn" data-chretry${c.retrying ? ' disabled' : ''}>${c.retrying ? 'Retrying…' : 'Retry'}</button>` : '';
    // The same words sent again after an unfinished turn (see parseRows) are a quiet line, not a second bubble. It keeps
    // the message ids so going to that message (a quote's header, a tracker row) still lands on it.
    // The owner's reply-button taps (wizard-ux issue 1889, core/action-cards.js): a quiet machine line, never his words.
    const RB = globalThis.WosActionCards?.replyOn?.() ? globalThis.WosActionCards : null;
    const tapsIn = u => (RB && u ? u.taps || KIT.tapsOf?.(u.text)?.taps || [] : []); // a local copy still carries the raw text
    const taps = unsent ? [] : tapsIn(tn.u);
    if (taps.length) h += `<div class="ch-renamed ch-taps" data-rb-taps${isFinite(tn.u.at) ? ` data-morph-key="u${tn.u.at}"` : ''}${msgIds(tn.u, undefined, tt)}>${RB.tapLinesHtml(taps)}${isFinite(tn.u.at) ? `<span class="ch-rb-at">${esc(KIT.time.stamp(tn.u.at))}</span>` : ''}</div>`;
    else if (tn.u?.again && !unsent) h += `<div class="ch-renamed ch-again"${isFinite(tn.u.at) ? ` data-morph-key="u${tn.u.at}"` : ''}${msgIds(tn.u, undefined, tt)}><span>Sent again${isFinite(tn.u.at) ? ` · ${esc(KIT.time.stamp(tn.u.at))}` : ''}</span></div>`;
    else if (tn.u) h += `<div class="msg u${tn.u.reply ? ' has-rq' : ''}${unsent ? ' unsent' : ''}"${isFinite(tn.u.at) ? ` data-morph-key="u${tn.u.at}"` : ''}${msgIds(tn.u, undefined, tt)}><div class="bub">${replyCard(tn.u.reply)}${userMedia(c, tn.u.files, tn.u.images)}${tn.u.text ? md(tn.u.text) : ''}</div><div class="mmeta">${unsent ? `<span class="pst fail" data-unsent>Not sent · message saved</span>${unsentRetry}` : ''}${timeTag(tn.u.at)}${quoteBtn(tt)}</div></div>`;
    else if (tn.note) h += noteHtml(tn.note);
    else if (tn.later) h += runContextHtml(tn.later);
    // A send a graceful restart holds is not live work: no Working timer under it (renderThread sets c.restartHeld).
    const live = last && working && !c.restartHeld;
    const steersHtml = (tn.steers || []).map(st => st.note ? noteHtml(st) : tapsIn(st).length ? `<div class="ch-renamed ch-taps steer" data-rb-taps>${RB.tapLinesHtml(tapsIn(st))}</div>` : `<div class="msg u steer" data-steer><div class="bub">${userMedia(c, st.files || [], [])}${md(st.text)}</div><div class="mmeta"><span class="srcpt">${CHECK_SVG}Read by ${esc(window.WizConfig.agent())}</span>${timeTag(st.at)}</div></div>`).join('');
    const wk = PW ? PW.workHtml(c, tn, live, helperStatus) : null; // the work receipt (chat-work.js #17)
    if (wk != null) h += wk;
    else if (tn.steps || tn.notes.length || live) {
      const label = live && c.stopping ? 'Stopping…' : live ? (tn.notes.length ? esc(clip(tn.notes[tn.notes.length - 1], 90)) : 'Working') : `Worked through ${tn.steps} step${tn.steps === 1 ? '' : 's'}`;
      h += `<details class="steps${live ? ' live' : ''}"><summary>${live ? '<i class="dots"><b></b><b></b><b></b></i>' : '◇'} ${label}</summary>${tn.notes.map(x => `<div class="note-line">${md(x)}</div>`).join('')}</details>`;
    }
    h += steersHtml;
    if (stopped) h += `<div class="ch-renamed ch-stopped" role="status"><span>Stopped before finishing</span></div>`;
    if (tn.a || tn.media.length) {
      const text = tn.a?.plainText ?? tn.a?.text;
      const k = text ? c.texts.push(text) - 1 : -1;
      const bAt = tn.a?.at ?? tn.mediaAt;
      const placed = new Set();
      const mediaHook = (url, marker) => {
        if (!marker || tn.a.inlineMedia?.[marker] !== url) return null;
        const image = tn.media.find(m => m.kind === 'image' && m.url === url);
        if (!image) return null; // no metadata: keep the ordinary safe image link
        if (placed.has(image.id)) return '';
        placed.add(image.id);
        return mediaBlock(c, [image]); // same thumbnail, gallery and viewer as bottom attachments
      };
      // Reply buttons (wizard-ux issue 1889): each group drawn where its line sits; off, the text keeps their labels.
      const rbBody = RB && !tn.a?.sweep && tn.a?.buttons?.length ? RB.replyHtml(tn.a.btext || tn.a.text, tn.a.buttons, t => md(t, mediaHook), c.rbPicks) : '';
      const sweep = tn.a?.sweep && typeof sweepHtml === 'function' ? sweepHtml(tn.a.sweep) : '';
      const body = sweep || (typeof rbBody === 'string' && rbBody) || (tn.a ? md(tn.a.text, (url, marker) => mediaHook(url, marker)) : '');
      const lead = summaryOf(tn.a), rk = esc(String(bAt));
      const open = !!lead && (c.rsum?.get(String(bAt)) ?? summaryStartsOpen());
      const shown = lead ? `<button type="button" class="rsum" data-reply-summary="${rk}" aria-expanded="false"${open ? ' hidden' : ''}><span class="rsum-t">${esc(leadText(lead))}</span>${CHEV_SVG}</button>`
        + `<div class="rdet" data-reply-details="${rk}"${open ? '' : ' hidden'}><div class="rtools"><button type="button" class="rcog" data-reply-length aria-label="Short answer length" title="Short answer length">${COG_SVG}</button><button type="button" class="rless" data-reply-summary="${rk}" aria-expanded="true">Show less${CHEV_SVG}</button></div>${body}</div>` : body;
      // A tweak the reply carries (WIZARD_TWEAK_V1): Settings' own switch row, live state (core/settings.js tweakCard).
      const tweak = tn.a?.tweaks?.length ? window.WosSettings?.tweakCard?.(tn.a.tweaks) || '' : '';
      // An app's proposed action the reply carries (WIZARD_ACTION_V1, wizard-ux issue 1463): core/action-cards.js, '' while off.
      const action = tn.a?.actions?.length ? window.WosActionCards?.html?.(tn.a.actions) || '' : '';
      h += (needs || '') + `<div class="msg a${lead ? ` has-rsum${open ? ' rsum-open' : ''}` : ''}"${isFinite(bAt) ? ` data-boom-at="${bAt}" data-morph-key="a${bAt}"` : ''}${msgIds(tn.a, bAt, tt)}><div class="bub">${shown}${tweak}${mediaBlock(c, tn.media.filter(m => !placed.has(m.id)))}${action}</div>`
        + `<div class="mmeta">${timeTag(tn.a?.at ?? tn.mediaAt)}${k >= 0 ? `<button type="button" data-mcopy="${k}" aria-label="Copy response">${COPY_SVG}Copy</button><button type="button" data-mshare="${k}" aria-label="Share response">${SHARE_SVG}Share</button>` : ''}${quoteBtn(tt)}${k >= 0 && last && !working && regenOn() ? '<button type="button" data-mregen aria-label="Regenerate response">↻ Regenerate</button>' : ''}</div></div>`;
    }
    return h;
  }
  const turnAt = tn => [tn.u?.at, tn.a?.at, tn.mediaAt].find(v => isFinite(v));
  return { addFiles, attachTray, CHECK_SVG, CLIP_SVG, fileUrl, hasContent, mediaOfFile, MIC_SVG, PEND, pendRef, PREVIEW, refreshCompose, refreshReply, syncSend, timeTag, toggleVoice, turnAt, turnHtml, UPLOAD_ABORT, uploadFile, userMedia, bindLate: v => { if ('PW' in v) PW = v.PW; } };
};
