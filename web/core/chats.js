/* Wizard UX core: Chats, a native Wizard client on the Wizard API. Shared by every shell.
 *
 * A list of threads, a thread view and a composer, on Wizard's own read state and the durable outbox.
 * The shell owns windows and layout and hands this module a host:
 *   win(id)          → { id, thread } for a Chats window (thread: null = list, '__new__' = new chat)
 *   root()           → element that contains every [data-chats=id] node of this shell
 *   save()           → persist the shell's window state
 *   layout(id)       → that window's content changed shape (re-tile, re-measure)
 *   toast(icon, text, ms), title(w), viewContext(id, how)
 *   visible()        → ids of windows on screen (their open threads count as read)
 *   editUnsent(item) → put an unsent message back into a composer
 *   newChatHint      → the line under "New chat" (the phone mentions the orb, the desktop its keys)
 *   openLink(url, title) → (optional) open a private-origin link in a window of this shell; return true if it did
 *   owner(id)        → (optional) the window a pane belongs to (the desktop's list pane id::list → id)
 *   overlay(open)         → (optional) the media viewer opened/closed (the phone arms its Back guard)
 *   vib(ms)               → (optional) haptic tick
 *
 * Parsing, Markdown, Bangkok time, drafts, copy/share and the media viewer live in core/chat-kit.js
 * (window.WosChat), loaded before this file by both shells.
 *
 * The body below the shims is kept line-for-line identical to the original mobile code it came from
 * (app.js, Chats section), so in-flight branches that edit that section port over with
 * `tools/port-chats-patch.sh <branch>`.
 */
window.WizCore = window.WizCore || {};
window.WizCore.chats = function createChats(H) {
  'use strict';
  const { esc, clip, norm, ago, emoOf } = window.WizCore;
  const LIVE = window.WizLive;
  const OUTBOX = window.WosOutbox || null;
  /* ---- shims: the original body's names, backed by the host ---- */
  const W = new Proxy({}, { get: (_, id) => (typeof id === 'string' ? H.win(id) : undefined) });
  const track = { querySelector: sel => H.root().querySelector(sel) };
  const save = () => H.save();
  const toast = (...a) => H.toast(...a);
  const viewContext = (id, how) => H.viewContext(id, how);
  const winTitle = w => H.title(w);
  const deskOf = id => id;
  const applyLayout = id => H.layout(id);
  const idx = 0, desks = [{ get wins() { return H.visible(); } }];
  const vib = ms => { if (H.vib) return H.vib(ms); try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  /* ---- end shims ---- */

  const CH = {}; // per window: { q, turns, loadedFor, loading, pending, err, at, show, files }
  const ch = id => (CH[id] = CH[id] || { q: '', turns: null, loadedFor: '', pending: [], at: 0 });
  // Parsing, Markdown, Bangkok time, drafts, copy/share and the media viewer live in chat-kit.js.
  const KIT = window.WosChat;
  const toTurns = KIT.parseRows, md = KIT.md;
  const WORKING_ST = new Set(['submitting', 'queued', 'running', 'stopping']);
  // Same sections, order and day boundaries as Wizard's Work view.
  const SECTIONS = [['errors', 'Errors'], ['working', 'Working'], ['ready', 'Ready'], ['yesterday', 'Yesterday'], ['pastWeek', 'Past week'], ['deferred', 'Deferred'], ['archive', 'Archive']];
  const SEC_OPEN_KEY = 'wos.chats.sections.v1';
  const SEC_DEFAULT = { errors: true, working: true, ready: true, yesterday: true, pastWeek: false, deferred: false, archive: false };
  let secOpen = (() => { try { return { ...SEC_DEFAULT, ...JSON.parse(localStorage.getItem(SEC_OPEN_KEY) || '{}') }; } catch (e) { return { ...SEC_DEFAULT }; } })();
  const SEC_PAGE = 40;
  function chatRow(s) {
    const isNew = LIVE.isNew(s), working = WORKING_ST.has(s.status), needs = s.status === 'waiting_for_approval' || s.status === 'failed' || s.status === 'interrupted';
    return `<button class="ch-row${isNew ? ' unread' : ''}" data-chopen="${esc(s.id)}"><span class="emo">${emoOf(s.id)}</span>
      <span class="bd"><span class="tp"><b>${esc(s.title)}</b><time>${esc(ago(LIVE.cardAt(s)))}</time></span>
      <span class="pv">${working ? '<i class="st working"></i>' + (s.waitingOn === 'helper' ? 'Waiting on a helper' : 'Working') + ' · ' : needs ? '<i class="st needs"></i>' : isNew ? '<i class="st unread"></i>' : ''}${esc(clip(s.preview || '', 110))}</span></span></button>`;
  }
  function renderChatList(w, el) {
    const c = ch(w.id), n = norm(c.q);
    const all = LIVE.ok ? LIVE.sessions.filter(s => !s.hidden) : [];
    const hit = n ? all.filter(s => norm(s.title).includes(n) || norm(s.preview).includes(n)) : all;
    const groups = LIVE.workGroups(hit);
    c.more = c.more || {};
    const head = `<div class="ch-top"><label class="ch-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input data-chsearch placeholder="Search threads" value="${esc(c.q)}" enterkeyhint="search" spellcheck="false"></label>${PW?.FOLDER_SVG && window.WosFiles ? `<button class="ch-new ch-files-b" data-chfiles aria-label="Files">${PW.FOLDER_SVG}</button>` : ''}<button class="ch-new" data-chnew aria-label="New chat"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>`;
    let body;
    if (!LIVE.ok) body = `<div class="ch-empty">${LIVE.error === 'access' ? 'Wizard needs you to sign in. Open /wizard/ once, then come back.' : 'Connecting to Wizard…'}</div>`;
    else if (!hit.length) body = `<div class="ch-empty">No threads match “${esc(c.q)}”.</div>`;
    else body = SECTIONS.map(([k, label]) => {
      const list = PW && k === 'errors' ? PW.errorsFilter(groups[k]) : groups[k];
      // Errors also holds failed background work and voice notes that didn't send (chat-power.js #12).
      const extra = PW && k === 'errors' && !n ? PW.errorsExtra() : { n: 0, html: '' };
      if (!list.length && !extra.n && (k === 'errors' || n)) return '';
      // While searching, every section with a hit opens so nothing is buried.
      const open = n ? true : secOpen[k];
      const newN = k === 'ready' ? list.filter(s => LIVE.isNew(s)).length : 0;
      const shown = c.more[k] ? list : list.slice(0, SEC_PAGE);
      return `<section class="ch-sec${open ? ' open' : ''}" data-sec="${k}"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span><small>${list.length + extra.n}</small>${newN ? `<b>${newN} new</b>` : ''}<i aria-hidden="true"></i></button>
        ${open ? `<div class="ch-sec-b">${list.length || extra.n ? (k === 'errors' && PW ? shown.map(s => PW.errorRow(s, chatRow(s))).join('') + extra.html : shown.map(chatRow).join('')) : '<span class="ch-none">None</span>'}${list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''}</div>` : ''}</section>`;
    }).join('');
    const scroll = el.querySelector('.ch-scroll')?.scrollTop || 0;
    el.innerHTML = `<div class="ch-list">${head}<div class="ch-scroll">${body}</div></div>`;
    const sc = el.querySelector('.ch-scroll'); if (sc) sc.scrollTop = scroll;
    PW?.paint(w.id, el);
  }
  function toggleSection(w, k) {
    secOpen = { ...secOpen, [k]: !secOpen[k] };
    try { localStorage.setItem(SEC_OPEN_KEY, JSON.stringify(secOpen)); } catch (e) {}
    const el = track.querySelector(`[data-chats="${w.id}"]`); if (el) renderChatList(w, el);
  }
  /* ---- attachments: the same Wizard Files upload + wizard_file_ids contract Wizard uses ---- */
  const MAX_FILES = 8, MAX_BYTES = 64 * 1024 * 1024;
  const fileKind = f => /^audio\//.test(f.mime || '') || /^wizard-voice-/.test(f.name || '') ? 'voice' : /^image\//.test(f.mime || '') ? 'image' : 'file';
  const fsize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
  const fileUrl = id => `/wizard/files/${encodeURIComponent(id)}/content`;
  async function uploadFile(file) {
    if (file.size > MAX_BYTES) throw Object.assign(new Error('That file is larger than the 64 MB upload limit.'), { user: true });
    const r = await fetch('/wizard/files/upload', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Wizard-Filename': file.name || 'upload', 'X-Wizard-Mime': file.type || 'application/octet-stream' }, body: file });
    if (!r.ok) throw Object.assign(new Error(r.status === 413 ? 'That file is too large for Wizard Files.' : `Wizard Files is unavailable (${r.status}).`), { status: r.status, user: true });
    const f = (await r.json()).file || {};
    if (!f.id) throw new Error('Wizard Files returned an invalid upload receipt.');
    return { id: String(f.id), name: String(f.filename || file.name), mime: String(f.mime || file.type || ''), bytes: Number(f.bytes) || file.size };
  }
  async function addFiles(wid, list) {
    const c = ch(wid); c.files = c.files || [];
    for (const file of [...list]) {
      if (c.files.length >= MAX_FILES) { toast('!', `Up to ${MAX_FILES} files per message`, 2400); break; }
      const local = { key: Math.random().toString(36).slice(2), name: file.name, mime: file.type, bytes: file.size, uploading: true, preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' };
      c.files.push(local); refreshCompose(wid);
      try { Object.assign(local, await uploadFile(file), { uploading: false }); if (local.preview) PREVIEW[local.id] = local.preview; }
      catch (e) { c.files = c.files.filter(x => x !== local); toast('!', e.user ? e.message : 'Upload failed · not attached', 3200); }
      refreshCompose(wid); saveDraft(wid);
    }
  }
  function attachTray(c) {
    const files = c.files || [];
    if (!files.length) return '';
    return `<div class="ch-tray">${files.map(f => `<span class="ch-att${f.uploading ? ' up' : ''}" data-attkey="${esc(f.key)}">${f.preview ? `<img src="${esc(f.preview)}" alt="">` : `<span class="ic">${fileKind(f) === 'voice' ? MIC_SVG : CLIP_SVG}</span>`}<span class="nm">${esc(fileKind(f) === 'voice' ? 'Voice note' : f.name)}<small>${f.uploading ? 'Uploading…' : esc(fsize(f.bytes))}</small></span><button type="button" data-attrm="${esc(f.key)}" aria-label="Remove">×</button></span>`).join('')}</div>`;
  }
  function refreshCompose(wid) {
    const el = track.querySelector(`[data-chats="${wid}"]`); const form = el?.querySelector('[data-chform]'); if (!form) return;
    const c = ch(wid), old = form.querySelector('.ch-tray');
    const html = attachTray(c);
    if (old) old.outerHTML = html || ''; else if (html) form.insertAdjacentHTML('afterbegin', html);
    const busy = (c.files || []).some(f => f.uploading);
    form.querySelector('[type=submit]').disabled = busy;
  }
  const MIC_SVG = '<svg viewBox="0 0 24 24"><path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18v4"/></svg>';
  const CLIP_SVG = '<svg viewBox="0 0 24 24"><path d="m9.5 17.5 7.7-7.7a3 3 0 0 0-4.2-4.2l-8 8a5 5 0 0 0 7.1 7.1l8-8"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
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
  const mediaOfFile = f => ({ id: f.id, name: f.name, mime: f.mime || '', bytes: f.bytes || 0, kind: /^image\//.test(f.mime || '') ? 'image' : /^video\//.test(f.mime || '') ? 'video' : /^audio\//.test(f.mime || '') ? 'audio' : 'file', url: f.id ? fileUrl(f.id) : '', thumb: PREVIEW[f.id] || '' });
  // Every photo/file in the open thread gets an index into c.media; tapping it opens the in-app viewer.
  function mediaBtn(c, m) {
    const k = c.media.push(m) - 1;
    if (m.kind === 'image') return `<button type="button" class="mimg" data-mi="${k}" aria-label="Open ${esc(m.name || 'photo')}"><img src="${esc(m.thumb || m.url)}" alt="${esc(m.name || 'Photo')}" loading="lazy" decoding="async"></button>`;
    if (m.kind === 'audio') return `<div class="mcard aud"><span class="mic">♪</span><span class="mn"><b>${esc(m.name)}</b><audio controls preload="none" src="${esc(m.url)}"></audio>${m.transcript ? `<small>${esc(m.transcript)}</small>` : ''}</span></div>`;
    return `<button type="button" class="mcard" data-mi="${k}"><span class="mic">${m.kind === 'video' ? PLAY_SVG : CLIP_SVG}</span><span class="mn"><b>${esc(m.name)}</b><small>${esc(m.kind === 'video' ? 'Video' : (m.mime.split('/')[1] || 'File').toUpperCase())}${m.bytes ? ' · ' + esc(fsize(m.bytes)) : ''}</small></span></button>`;
  }
  function mediaBlock(c, list) {
    if (!list.length) return '';
    const imgs = list.filter(m => m.kind === 'image'), rest = list.filter(m => m.kind !== 'image');
    return (imgs.length ? `<div class="mgrid n${Math.min(imgs.length, 4)}">${imgs.map(m => mediaBtn(c, m)).join('')}</div>` : '') + (rest.length ? `<div class="mcards">${rest.map(m => mediaBtn(c, m)).join('')}</div>` : '');
  }
  // What the owner sent: voice notes play inline, photos and screenshots show as photos, other files as cards.
  function userMedia(c, files, images) {
    const voice = files.filter(f => fileKind(f) === 'voice');
    const list = files.filter(f => fileKind(f) !== 'voice').map(mediaOfFile).filter(m => m.url || m.thumb)
      .concat((images || []).map((u, i) => ({ id: 'img' + i, name: 'Photo', mime: 'image/*', kind: 'image', url: u })));
    const unnamed = files.filter(f => fileKind(f) !== 'voice' && !f.id).map(f => `<span class="fchip">${CLIP_SVG} ${esc(f.name)}</span>`).join('');
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
  const timeTag = ms => isFinite(ms) ? `<time title="${esc(KIT.time.full(ms))}">${esc(KIT.time.clock(ms))}</time>` : '';
  function turnHtml(c, tn, last, working) {
    let h = '';
    if (tn.u) h += `<div class="msg u"><div class="bub">${userMedia(c, tn.u.files, tn.u.images)}${tn.u.text ? md(tn.u.text) : ''}</div><div class="mmeta">${timeTag(tn.u.at)}</div></div>`;
    const live = last && working;
    const wk = PW ? PW.workHtml(c, tn, live) : null; // the work receipt (chat-work.js #17)
    if (wk != null) h += wk;
    else if (tn.steps || tn.notes.length || live) {
      const label = live ? (tn.notes.length ? esc(clip(tn.notes[tn.notes.length - 1], 90)) : 'Working') : `Worked through ${tn.steps} step${tn.steps === 1 ? '' : 's'}`;
      h += `<details class="steps${live ? ' live' : ''}"><summary>${live ? '<i class="dots"><b></b><b></b><b></b></i>' : '◇'} ${label}</summary>${tn.notes.map(x => `<div class="note-line">${md(x)}</div>`).join('')}</details>`;
    }
    if (tn.a || tn.media.length) {
      const k = tn.a ? c.texts.push(tn.a.text) - 1 : -1;
      h += `<div class="msg a"><div class="bub">${tn.a ? md(tn.a.text) : ''}${mediaBlock(c, tn.media)}</div>`
        + `<div class="mmeta">${timeTag(tn.a?.at ?? tn.mediaAt)}${k >= 0 ? `<button type="button" data-mcopy="${k}" aria-label="Copy response">${COPY_SVG}Copy</button><button type="button" data-mshare="${k}" aria-label="Share response">${SHARE_SVG}Share</button>` : ''}</div></div>`;
    }
    return h;
  }
  const turnAt = tn => [tn.u?.at, tn.a?.at, tn.mediaAt].find(v => isFinite(v));
  /* Thread actions, same rules as Wizard: Done / Close & file / Defer on a settled thread with an answer;
   * Restore (and Done) on a deferred or archived one; nothing while the agent is working or waiting. */
  function threadActions(s, turns) {
    if (!s || LIVE.busy(s.id)) return [];
    if (WORKING_ST.has(s.status) || s.status === 'waiting_for_approval') return [];
    const inArchive = s.archived || LIVE.workGroups([s]).archive.length > 0;
    if (s.deferred && !s.archived) return ['restore', 'done'];
    if (inArchive) return ['restore'];
    if (turns && !turns.some(t => t.a || t.media.length)) return [];
    return ['done', 'defer', 'file'];
  }
  const ACT = {
    done: { label: 'Done', icon: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>', hint: 'Mark done' },
    defer: { label: 'Defer', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/></svg>', hint: 'Defer thread' },
    file: { label: 'Close & file', icon: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="4" rx="1.2"/><path d="M5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg>', hint: 'Close and file thread' },
    restore: { label: 'Restore', icon: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/></svg>', hint: 'Restore to Work' },
  };
  const owner = id => (H.owner ? H.owner(id) : id);
  async function threadAct(wid, sid, a) {
    wid = owner(wid);
    const s = LIVE.session(sid); if (!s || !ACT[a]) return;
    const w = W[wid];
    vib(8);
    if (a !== 'restore' && w && w.thread === sid) chatsBack(w);
    const msg = { done: ['✓', 'Marked done'], defer: ['◷', 'Moved to Deferred'], file: ['▤', 'Filing…'], restore: ['↺', 'Restored to Work'] }[a];
    toast(msg[0], msg[1], 1600);
    const ok = await (a === 'done' ? LIVE.archive(sid) : a === 'file' ? LIVE.archive(sid, { file: true }) : a === 'defer' ? LIVE.defer(sid) : LIVE.restore(sid));
    if (ok && a === 'file') toast('▤', 'Filed in Archive', 1800);
    if (!ok) toast('!', { done: 'Couldn’t mark done · thread restored', file: 'Couldn’t close & file · thread restored', defer: 'Couldn’t defer · thread kept open', restore: 'Couldn’t restore · thread kept where it was' }[a], 3200);
    for (const id of Object.keys(CH)) { const x = W[id]; if (x) renderChats(x); } H.changed?.();
  }
  /* Long-press (or swipe left on) a thread in the list: the same actions in a small sheet. */
  let rowSheet = null; // { wid, sid }
  function openRowSheet(wid, sid) {
    const s = LIVE.session(sid), el = track.querySelector(`[data-chats="${wid}"]`); if (!s || !el) return;
    closeRowSheet();
    const acts = threadActions(s, null);
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Thread actions"><div class="ch-sheet-b"><div class="ch-sheet-t">${esc(s.title)}</div>
      <button type="button" data-rsopen>${'<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'}Open</button>
      ${acts.map(a => `<button type="button" data-rsact="${a}">${ACT[a].icon}${ACT[a].label}</button>`).join('')}
      ${acts.length ? '' : `<p class="ch-sheet-n">${WORKING_ST.has(s.status) || s.status === 'waiting_for_approval' ? `${window.WizConfig.agent()} is still on this one.` : 'Nothing to file yet.'}</p>`}</div></div>`);
    rowSheet = { wid, sid }; vib(10);
  }
  function closeRowSheet() {
    if (!rowSheet) return false;
    H.root().querySelectorAll('.ch-sheet').forEach(n => n.remove()); rowSheet = null; return true;
  }
  /* Approval: the live run's request, with Wizard's own choices (api.ts approve). */
  function approvalHtml(c, s) {
    const ap = c.approval;
    if (!ap || !s || ap.runId !== s.runId) return '';
    if (ap.resolved) return `<div class="appr done">${esc(KIT.choiceReceipt(ap.resolved))}</div>`;
    return `<div class="appr" role="group" aria-label="Approval required"><b>Needs your approval</b><pre>${esc(ap.action)}</pre>
      <div class="appr-b${ap.choices.length > 2 ? ' many' : ''}">${ap.choices.map(ch => `<button type="button" data-approve="${esc(ch.value)}" class="${/^(deny|reject)$/.test(ch.value) ? 'no' : ''}" ${ap.pending ? 'disabled' : ''}>${ap.pending === ch.value ? 'Sending…' : esc(ch.label)}</button>`).join('')}</div>
      ${ap.error ? `<small class="err">${esc(ap.error)}</small>` : '<small>Options come from your Wizard’s safety settings.</small>'}</div>`;
  }
  async function loadApproval(w, s) {
    const c = ch(w.id);
    if (!s || s.status !== 'waiting_for_approval' || !s.runId) { if (c.approval && !c.approval.resolved) c.approval = null; return false; }
    if (c.approval && c.approval.runId === s.runId && (c.approval.pending || c.approval.resolved || Date.now() - c.approval.at < 3000)) return false;
    try {
      const run = await LIVE.run(s.runId);
      const ap = KIT.normalizeApproval(run.approval);
      const prev = c.approval;
      c.approval = ap ? { ...ap, runId: s.runId, at: Date.now() } : (run.status === 'waiting_for_approval' ? null : prev?.resolved ? prev : null);
      return JSON.stringify(prev && { a: prev.action, c: prev.choices, r: prev.resolved }) !== JSON.stringify(c.approval && { a: c.approval.action, c: c.approval.choices, r: c.approval.resolved });
    } catch (e) { return false; }
  }
  async function chooseApproval(wid, choice) {
    const w = W[wid], c = ch(wid), ap = c.approval; if (!w || !ap || ap.pending || ap.resolved || !ap.choices.some(x => x.value === choice)) return;
    ap.pending = choice; ap.error = ''; renderThreadNow(w);
    try { await LIVE.approve(ap.runId, choice, ap.requestId); ap.resolved = choice; }
    catch (e) { if (e.status === 404 || e.status === 409) { ap.resolved = 'closed'; toast('·', 'This approval is no longer waiting', 2200); } else ap.error = 'Couldn’t send your decision. Check the connection and try again.'; }
    ap.pending = '';
    renderThreadNow(w); if (ap.resolved) LIVE.refresh();
  }
  function renderThreadNow(w) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && w.thread) renderThread(w, el); }
  const PAGE = 60;
  function renderThread(w, el, keep) {
    const c = ch(w.id), isNew = w.thread === '__new__', s = isNew ? null : LIVE.session(w.thread);
    const working = !!s && WORKING_ST.has(s.status);
    const sub = isNew ? `Starts a new thread with ${window.WizConfig.agent()}` : s?.status === 'stopping' ? 'Stopping…' : working ? (s.waitingOn === 'helper' ? `A helper is finishing this for ${window.WizConfig.agent()}` : `${window.WizConfig.agent()} is working`) : s?.status === 'waiting_for_approval' ? 'Waiting for your approval' : s?.deferred && !s.archived ? 'Deferred' : s?.archived ? 'Archived' : s ? `Updated ${ago(s.lastAssistantAt || s.updatedAt)}` : '';
    const turns = c.loadedFor === w.thread ? c.turns || [] : null;
    c.media = []; c.texts = [];
    let msgs;
    const pend = pendingFor(w);
    if (isNew && !pend.length) msgs = `<div class="ch-empty"><b>New chat</b><br>${esc(H.newChatHint || 'Type below.')}</div>`;
    else if (!turns && !isNew && !pend.length) msgs = `<div class="ch-empty">${c.err ? esc(c.err) : 'Loading thread…'}</div>`;
    else {
      const all = turns || [];
      if (c.showFor !== w.thread) { c.show = PAGE; c.showFor = w.thread; }
      const from = Math.max(0, all.length - c.show), shown = all.slice(from);
      let day = '';
      msgs = (from > 0 ? `<button type="button" class="ch-earlier" data-chearlier>Load earlier messages · ${from} more</button>` : '')
        + shown.map((tn, k, arr) => {
          const at = turnAt(tn), dk = KIT.time.dayKey(at);
          const div = dk && dk !== day ? `<div class="ch-day"><span>${esc(KIT.time.day(at))}</span></div>` : '';
          if (dk) day = dk;
          return div + turnHtml(c, tn, k === arr.length - 1, working);
        }).join('')
        + approvalHtml(c, s)
        + pend.map(p => pendingHtml(p, c)).join('')
        + (pend.some(p => p.state !== 'failed') && !working ? `<details class="steps live"><summary><i class="dots"><b></b><b></b><b></b></i> ${pend.some(p => p.state === 'waiting') ? 'Waiting for Wizard · will retry' : 'Sending'}</summary></details>` : '');
    }
    const acts = isNew ? [] : threadActions(s, turns);
    const box = el.querySelector('.ch-msgs');
    const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const dkey = draftKey(w);
    const oldTa = el.querySelector('textarea');
    const draft = oldTa && el.dataset.draftFor === dkey ? oldTa.value : (c.draftFor === dkey ? c.draft || '' : loadDraft(w));
    const hadFocus = el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
    const canStop = working && !!s?.runId && s.status !== 'stopping';
    PW?.ensureModels();
    const chip = PW ? PW.modelChip(w, s) : '';
    const fail = PW && !isNew && turns ? PW.failureHtml(w, s) : '';
    el.innerHTML = `<div class="ch-thread">
      <div class="ch-head"><button class="ch-back" data-chback aria-label="Back to threads"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="emo">${isNew ? '✎' : emoOf(w.thread)}</span><div class="ti"><b>${esc(winTitle(w))}</b><small>${esc(sub)}${chip}</small></div>${acts.length ? `<div class="ch-acts">${acts.map(a => `<button type="button" data-chact="${a}" aria-label="${ACT[a].hint}" title="${ACT[a].hint}">${ACT[a].icon}<span>${a === 'file' ? 'File' : ACT[a].label}</span></button>`).join('')}</div>` : ''}</div>
      <div class="ch-msgs">${msgs}${fail}</div>${PW ? PW.latestBtn() : ''}
      <form class="ch-compose" data-chform>${attachTray(c)}<div class="ch-row2"><button type="button" class="ch-attach" data-chattach aria-label="Attach photos or files">${CLIP_SVG}</button>${PW ? PW.filesBtn() : ''}<textarea rows="1" placeholder="${working ? `Steer ${esc(window.WizConfig.agent())}…` : `Message ${esc(window.WizConfig.agent())}`}" enterkeyhint="enter">${esc(draft)}</textarea>${PW ? PW.micBtn(w.id) : ''}${canStop ? '<button type="button" class="ch-stop" data-chstop aria-label="Stop Archimedes"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>' : ''}<button type="submit" aria-label="Send" ${(c.files || []).some(f => f.uploading) ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>
    </div>`;
    el.dataset.draftFor = dkey; c.draft = draft; c.draftFor = dkey;
    const nb = el.querySelector('.ch-msgs');
    if (keep) nb.scrollTop = nb.scrollHeight - keep.h + keep.top;
    else if (PW && PW.position(w, el, nb, { keep, atBottom, box, turns, working })) {} // reading position (#18)
    else nb.scrollTop = atBottom ? nb.scrollHeight : (box ? box.scrollTop : nb.scrollHeight);
    // Photos load after layout: keep a thread that was at the bottom pinned to the bottom.
    if (!keep && atBottom) nb.querySelectorAll('img').forEach(im => { if (!im.complete) im.addEventListener('load', () => { if (nb.scrollHeight - nb.scrollTop - nb.clientHeight < 400) nb.scrollTop = nb.scrollHeight; }, { once: true }); });
    if (hadFocus) { const ta = el.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    growTa(el.querySelector('textarea'));
    PW?.paint(w.id, el);
  }
  /* ---- drafts: one per thread (and one for a new chat), kept across reloads ---- */
  const draftKey = w => w.thread === '__new__' ? 'new' : 'direct:' + w.thread;
  function loadDraft(w) {
    const c = ch(w.id), key = draftKey(w), d = KIT.drafts.get(key);
    c.draftFor = key; c.draft = d.text;
    c.files = d.files.map(f => ({ ...f, key: Math.random().toString(36).slice(2), preview: /^image\//.test(f.mime || '') ? (PREVIEW[f.id] || fileUrl(f.id)) : '' }));
    return d.text;
  }
  function saveDraft(wid) { const w = W[wid], c = ch(wid); if (!w || !w.thread) return; KIT.drafts.set(draftKey(w), c.draft || '', c.files || []); }
  function openMedia(wid, k) {
    const c = ch(wid), list = c.media || [], m = list[k]; if (!m) return;
    // Photos swipe as one gallery (this thread, oldest first); a file or video opens on its own.
    if (m.kind === 'image') { const g = list.filter(x => x.kind === 'image'); return KIT.viewer.open(g, g.indexOf(m)); }
    KIT.viewer.open([m], 0);
  }
  KIT.K.notify = (icon, text) => toast(icon, text, 1800);
  KIT.K.onChange = open => H.overlay?.(open);
  /* Long-press or swipe left on a thread row → thread actions (listeners in bind()). */
  let lp = null, lpUntil = 0;
  // Long-press / swipe / right-click on rows, and paste-to-attach; bound to each shell's root in bind().
  function bindGestures(root) {
    root.addEventListener('pointerdown', e => {
      const row = e.target.closest('.ch-list [data-chopen]'); if (!row || e.button > 0) return;
      const wid = idOf(row);
      lp = { row, wid, sid: row.dataset.chopen, x: e.clientX, y: e.clientY, dx: 0, t: setTimeout(() => { if (!lp) return; lpUntil = Date.now() + 700; openRowSheet(lp.wid, lp.sid); lp = null; }, 480) };
    });
    root.addEventListener('pointermove', e => {
      if (!lp) return;
      const dx = e.clientX - lp.x, dy = e.clientY - lp.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(lp.t); lp.row.style.transform = ''; lp = null; return; }
      if (Math.abs(dx) > 10) clearTimeout(lp.t);
      if (dx < 0) { lp.dx = dx; lp.row.style.transform = `translateX(${Math.max(dx, -90)}px)`; }
    });
    const lpEnd = () => {
      if (!lp) return; const q = lp; lp = null; clearTimeout(q.t); q.row.style.transform = '';
      if (q.dx < -60) { lpUntil = Date.now() + 700; openRowSheet(q.wid, q.sid); }
    };
    root.addEventListener('pointerup', lpEnd); root.addEventListener('pointercancel', lpEnd);
    // Right-click (a mouse) opens the same sheet; a touch long-press already did.
    root.addEventListener('contextmenu', e => { const row = e.target.closest('.ch-list [data-chopen]'); if (!row) return; e.preventDefault(); if (!rowSheet && !lp) { lpUntil = Date.now() + 700; openRowSheet(idOf(row), row.dataset.chopen); } });
    /* Paste a photo or file into the composer: it uploads into the tray like the paperclip. */
    root.addEventListener('paste', e => {
      const ta = e.target.closest?.('.ch-compose textarea'); if (!ta) return;
      const files = [...(e.clipboardData?.items || [])].filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      const id = idOf(ta);
      const named = files.map((f, i) => f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${files.length > 1 ? '-' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }));
      addFiles(id, named);
    });
  }
  /* ---- durable outbox: every message is saved on the phone before it is sent ---- */
  function pendingFor(w) {
    if (!OUTBOX || !w.thread) return [];
    return OUTBOX.forThread(w.thread === '__new__' ? '' : w.thread, w.thread === '__new__' ? w.id : '');
  }
  function pendingState(p) {
    if (p.state === 'failed') return `<span class="pst fail">Not sent · ${esc(p.error || 'Wizard didn’t take it')}</span><button type="button" class="pbtn" data-obretry="${esc(p.id)}">Retry</button><button type="button" class="pbtn ghost" data-obedit="${esc(p.id)}">Edit</button>`;
    if (p.state === 'waiting') return `<span class="pst wait">${esc(p.error || 'Couldn’t reach Wizard')} · retrying</span><button type="button" class="pbtn" data-obretry="${esc(p.id)}">Retry now</button>`;
    if (p.state === 'sent') return '<span class="pst ok">Sent</span>';
    return '<span class="pst">Sending…</span>';
  }
  function pendingHtml(p, c) {
    const files = (p.files || []).filter(f => f !== p.audioFile);
    const voice = p.audio || p.audioFile ? `<div class="fchips"><span class="fchip">${MIC_SVG} Voice note${p.text ? '' : ' · words come when it sends'}</span></div>` : '';
    return `<div class="msg u pending ${p.state}" data-ob="${esc(p.id)}"><div class="bub">${voice}${userMedia(c || { media: [] }, files, [])}${p.text ? md(p.text) : ''}</div><div class="pmeta">${pendingState(p)}</div></div>`;
  }
  function renderChats(w) {
    const el = track.querySelector(`[data-chats="${w.id}"]`); if (!el) return;
    if (w.thread) { renderThread(w, el); loadThread(w); } else renderChatList(w, el);
  }
  async function loadThread(w, force) {
    const c = ch(w.id); if (!w.thread || w.thread === '__new__' || c.loading) return;
    const s = LIVE.session(w.thread);
    const fresh = c.loadedFor === w.thread && Date.now() - c.at < (s && WORKING_ST.has(s.status) ? 3500 : 15000);
    // Status changes (Stopping…, Deferred, Archived) re-render the header even between message reads.
    const hk = s ? [s.status, !!s.archived, !!s.deferred, s.runId].join('|') : '';
    if (fresh && !force) { if (c.loadedFor === w.thread && hk !== c.hk) { c.hk = hk; const el = track.querySelector(`[data-chats="${w.id}"]`); if (el) renderThread(w, el); } return; }
    c.loading = true;
    try {
      const rows = await LIVE.messages(w.thread);
      if (!W[w.id] || W[w.id].thread !== w.thread) return;
      const turns = toTurns(rows);
      const sig = JSON.stringify(turns.slice(-3));
      let changed = c.loadedFor !== w.thread || sig !== c.sig;
      Object.assign(c, { turns, loadedFor: w.thread, at: Date.now(), err: '', sig });
      // A sent message has landed once a recent user turn in the thread matches it.
      const sent = OUTBOX ? OUTBOX.forThread(w.thread).filter(p => p.state === 'sent') : [];
      if (sent.length) {
        const us = turns.filter(t => t.u).slice(-4).map(t => t.u);
        const landed = p => us.some(u => ((p.files || []).length && p.files.some(f => (u.files || []).some(x => x.id === f.id)))
          || (!!p.text && (u.text || '').includes(p.text.slice(0, 40))));
        let gone = false;
        for (const p of sent) if (landed(p)) { OUTBOX.landed(p.id); gone = true; }
        if (gone) changed = true;
      }
      if (await loadApproval(w, LIVE.session(w.thread))) changed = true;
      const s2 = LIVE.session(w.thread), hk2 = s2 ? [s2.status, !!s2.archived, !!s2.deferred, s2.runId].join('|') : '';
      if (hk2 !== c.hk) { c.hk = hk2; changed = true; }
      if (changed) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && W[w.id].thread === w.thread) renderThread(W[w.id], el); }
    } catch (e) { c.err = e.status === 403 ? 'Wizard sign-in needed' : pendingFor(w).length ? '' : 'Couldn’t load this thread'; c.at = Date.now(); }
    finally { c.loading = false; }
  }
  function openChat(wid, sid) {
    const w = W[wid]; if (!w) return;
    if (w.thread) saveDraft(wid);
    closeRowSheet();
    const c = ch(wid); c.approval = null;
    PW?.opened(wid, sid);
    w.thread = sid; save(); loadDraft(w);
    if (sid !== '__new__') LIVE.markSeen(sid);
    renderChats(w); applyLayout(deskOf(wid));
  }
  function chatsBack(w) { if (w.thread) saveDraft(w.id); const c = ch(w.id); c.files = []; c.draft = ''; c.draftFor = ''; w.thread = null; save(); renderChats(w); applyLayout(deskOf(w.id)); }
  async function sendChat(wid, text, how = 'typing in the Chats window', audio = null) {
    const w = W[wid]; text = String(text || '').trim(); if (!w) return;
    const c = ch(wid);
    const files = (c.files || []).filter(f => f.id && !f.uploading);
    if (!text && !files.length && !audio) return;
    if ((c.files || []).some(f => f.uploading)) { toast('…', 'Still uploading · send when it finishes', 2000); return; }
    const isNew = w.thread === '__new__';
    const s = isNew ? null : LIVE.session(w.thread);
    const steerRunId = s && WORKING_ST.has(s.status) && s.runId ? s.runId : '';
    KIT.drafts.clear(draftKey(w)); c.draft = ''; c.files = [];
    // Saved on the phone first; the outbox delivers it (and retries) from here.
    const nm = isNew && PW ? PW.newModel(c) : null; // a model picked for this new chat (#11)
    const it = await OUTBOX.enqueue({ kind: isNew ? 'new' : 'reply', sessionId: isNew ? '' : w.thread, steerRunId, text, audio,
      instructions: viewContext(wid, how), files: files.map(f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes })), wid, how, source: 'chat', ...(nm ? { model: nm.model, provider: nm.provider } : {}) });
    c.follow = true; if (nm) c.newModel = null;
    if (isNew && W[wid]) { W[wid].thread = it.sessionId; save(); c.loadedFor = ''; c.draftFor = draftKey(W[wid]); }
    renderChats(W[wid]); applyLayout(deskOf(wid));
  }
  const picker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
  picker.setAttribute('data-chfile', '');
  document.body.appendChild(picker);
  let pickFor = '';
  picker.addEventListener('change', () => { const list = [...picker.files]; picker.value = ''; if (pickFor && W[pickFor] && list.length) addFiles(pickFor, list); });
  function growTa(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
  // While a thread is on screen, new replies count as read (same rule as Wizard).
  function markVisibleThreadsSeen() {
    if (!LIVE?.ok || document.hidden) return;
    for (const id of desks[idx].wins) {
      const w = W[id]; if (w?.app !== 'chats' || !w.thread || w.thread === '__new__') continue;
      const s = LIVE.session(w.thread); if (s && LIVE.isNew(s)) LIVE.markSeen(w.thread);
    }
  }

  const elOf = id => H.root().querySelector(`[data-chats="${id}"]`);
  const idOf = t => t.closest('[data-chats]')?.dataset.chats || '';
  /* Clicks inside a Chats window. Returns true when it handled the click. */
  function click(e, id) {
    const w = H.win(id); if (!w) return false;
    const rb = e.target.closest('[data-obretry]'); if (rb) { OUTBOX.retry(rb.dataset.obretry); H.toast('↻', 'Sending again', 1400); return true; }
    const eb = e.target.closest('[data-obedit]'); if (eb) { const it = OUTBOX.get(eb.dataset.obedit); if (it) H.editUnsent(it); return true; }
    if (PW && PW.click(e, id)) return true;
    if (justPressed() && e.target.closest('[data-chopen]')) return true; // a long-press/swipe just opened the actions sheet
    const o = e.target.closest('[data-chopen]'); if (o) { openChat(id, o.dataset.chopen); return true; }
    if (e.target.closest('[data-chback]')) { chatsBack(w); return true; }
    if (e.target.closest('[data-chnew]')) { openChat(id, '__new__'); return true; }
    const sec = e.target.closest('[data-sectoggle]'); if (sec) { toggleSection(w, sec.dataset.sectoggle); return true; }
    const more = e.target.closest('[data-secmore]'); if (more) { const c = ch(id); c.more = { ...(c.more || {}), [more.dataset.secmore]: true }; renderChatList(w, elOf(id)); return true; }
    if (e.target.closest('[data-chattach]')) { pickFor = id; picker.accept = ''; picker.click(); return true; }
    const rm = e.target.closest('[data-attrm]'); if (rm) { const c = ch(id); c.files = (c.files || []).filter(f => f.key !== rm.dataset.attrm); refreshCompose(id); saveDraft(id); return true; }
    const rsa = e.target.closest('[data-rsact]'); if (rsa && rowSheet) { const { wid: rw, sid } = rowSheet; closeRowSheet(); threadAct(rw, sid, rsa.dataset.rsact); return true; }
    if (e.target.closest('[data-rsopen]') && rowSheet) { const { wid: rw, sid } = rowSheet; closeRowSheet(); openChat(owner(rw), sid); return true; }
    if (rowSheet && e.target.closest('.ch-sheet') && !e.target.closest('.ch-sheet-b')) { closeRowSheet(); return true; }
    const ca = e.target.closest('[data-chact]'); if (ca && w.thread) { threadAct(id, w.thread, ca.dataset.chact); return true; }
    if (e.target.closest('[data-chstop]')) { const s = LIVE.session(w.thread); if (s?.runId) { e.target.closest('[data-chstop]').disabled = true; toast('■', 'Stopping…', 1400); LIVE.stop(s.runId).catch(() => { toast('!', 'Couldn’t stop · try again', 2600); renderThreadNow(w); }); } return true; }
    const apb = e.target.closest('[data-approve]'); if (apb) { chooseApproval(id, apb.dataset.approve); return true; }
    if (e.target.closest('[data-chearlier]')) { const c = ch(id), el = elOf(id), box = el.querySelector('.ch-msgs'); c.show = (c.show || PAGE) + PAGE; renderThread(w, el, { h: box.scrollHeight, top: box.scrollTop }); return true; }
    const mi = e.target.closest('[data-mi]'); if (mi) { e.preventDefault(); openMedia(id, +mi.dataset.mi); return true; }
    const ml = e.target.closest('a[data-mlink]'); if (ml) { e.preventDefault(); const u = ml.dataset.mlink; KIT.viewer.open([{ url: u, name: ml.textContent.trim() || 'File', kind: 'file', mime: '' }]); return true; }
    const sl = e.target.closest('a[data-session]'); if (sl) { e.preventDefault(); openChat(owner(id), sl.dataset.session); return true; }
    // A private-origin link (a report, a hosted app) opens in a window of this shell: the shell never navigates away.
    const al = e.target.closest('.bub a[href]');
    if (al && H.openLink) { let u = null; try { u = new URL(al.getAttribute('href'), location.href); } catch (err) {}
      if (u && (u.origin === location.origin || u.hostname === 'private.wizard001.com') && !u.pathname.startsWith('/wizard-os-home')) { e.preventDefault(); H.openLink(u.pathname + u.search + u.hash, (al.textContent || '').trim().slice(0, 40) || u.pathname); return true; } }
    const cc = e.target.closest('[data-codecopy]'); if (cc) { const t = cc.closest('.code')?.querySelector('pre')?.textContent || ''; KIT.copyText(t).then(ok => { cc.textContent = ok ? 'Copied' : 'Couldn’t copy'; setTimeout(() => { cc.textContent = 'Copy'; }, 1500); }); return true; }
    const cs = e.target.closest('[data-codeshare]'); if (cs) { const t = cs.closest('.code')?.querySelector('pre')?.textContent || ''; KIT.shareText(t).then(r => r === 'copied' && toast('⧉', 'Copied · sharing isn’t available here', 1800)); return true; }
    const mc = e.target.closest('[data-mcopy]'); if (mc) { const t = ch(id).texts?.[+mc.dataset.mcopy] ?? ''; KIT.copyText(t).then(ok => toast(ok ? '⧉' : '!', ok ? 'Copied' : 'Couldn’t copy', 1400)); return true; }
    const ms = e.target.closest('[data-mshare]'); if (ms) { const t = ch(id).texts?.[+ms.dataset.mshare] ?? ''; KIT.shareText(`From ${window.WizConfig.agent()}:\n\n${t}`).then(r => r === 'copied' ? toast('⧉', 'Copied · sharing isn’t available here', 1800) : r === 'failed' && toast('!', 'Couldn’t share', 1800)); return true; }
    const v = e.target.closest('.vnote[data-vnote]'); if (v) { e.preventDefault(); toggleVoice(v.dataset.vnote); return true; }
    return false;
  }
  /* Submit, search-as-you-type, drafts and ⌘/Ctrl+Enter, delegated from the shell's root. */
  function bind(root) {
    root.addEventListener('submit', e => {
      const f = e.target.closest('[data-chform]'); if (!f) return;
      e.preventDefault(); const id = idOf(f); const ta = f.querySelector('textarea');
      const text = ta.value; const c = ch(id);
      if (!text.trim() && !(c.files || []).some(f => f.id)) return;
      if ((c.files || []).some(f => f.uploading)) { H.toast('…', 'Still uploading · send when it finishes', 2000); return; }
      ta.value = ''; sendChat(id, text);
    });
    root.addEventListener('input', e => {
      if (e.target.matches('[data-chsearch]')) {
        const id = idOf(e.target); ch(id).q = e.target.value; const el = elOf(id);
        if (el?.querySelector('.ch-scroll')) { renderChatList(H.win(id), el); const inp = el.querySelector('[data-chsearch]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      }
      if (e.target.matches('.ch-compose textarea')) { growTa(e.target); const id = idOf(e.target); ch(id).draft = e.target.value; saveDraft(id); }
    });
    root.addEventListener('keydown', e => {
      if (e.target.matches('.ch-compose textarea') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.form.requestSubmit(); }
    });
    bindGestures(root);
    PW?.bind(root);
  }
  /* Words from outside (dictation, a native shell) go in at the composer's cursor. */
  function insertText(id, text) {
    const ta = elOf(id)?.querySelector('.ch-compose textarea'); if (!ta || !text) return false;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b); ta.focus();
    ta.setSelectionRange(a + text.length, a + text.length); ch(id).draft = ta.value; saveDraft(id); growTa(ta);
    return true;
  }
  const forget = id => { delete CH[id]; };
  function justPressed() { return Date.now() < lpUntil; }
  // A list must not re-render under an open actions sheet or a finger mid-press.
  const holdList = id => rowSheet?.wid === id || (!!lp && lp.wid === id) || !!PW?.holds(id);
  // Back / Esc: the media viewer, then the actions sheet. Returns what it closed, or ''.
  const closeOverlay = () => (KIT.viewer.close() ? 'viewer' : closeRowSheet() ? 'thread-actions' : PW?.closeSheet() ? 'chat-sheet' : '');
  // Put words (and already-uploaded files) back into a composer, e.g. editing an unsent message.
  function setDraft(wid, text, files) {
    const w = W[wid], c = ch(wid); if (!w) return;
    c.draft = text || ''; c.files = (files || []).map(f => ({ ...f, key: Math.random().toString(36).slice(2), preview: /^image\//.test(f.mime || '') && f.id ? (PREVIEW[f.id] || fileUrl(f.id)) : '' }));
    c.draftFor = draftKey(w); saveDraft(wid);
    const el = elOf(wid); if (el) delete el.dataset.draftFor;
  }
  // Models, Errors actions, composer mic, work receipts, reading position, Files (core/chat-power.js).
  const PW = window.WosChatPower ? window.WosChatPower({ CH, ch, toast, H, md, KIT, MIC_SVG, WORKING_ST, elOf, owner, vib, renderChats, renderThreadNow, openChat, refreshCompose, saveDraft, closeRowSheet }) : null;
  return { CH, ch, click, bind, PW, sendVoiceTo: (...a) => PW?.sendVoiceTo(...a), insertText, forget, renderChats, renderChatList, renderThread, loadThread, openChat, chatsBack, sendChat, uploadFile,
    refreshCompose, toggleVoice, growTa, markVisibleThreadsSeen, addFiles, toTurns, md, MIC_SVG, CLIP_SVG, WORKING_ST,
    KIT, threadAct, openRowSheet, closeRowSheet, closeOverlay, holdList, justPressed, setDraft, saveDraft };
};
