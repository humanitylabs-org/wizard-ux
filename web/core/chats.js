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
  /* ---- end shims ---- */

  const CH = {}; // per window: { q, rows, turns, loadedFor, loading, pending, err, at }
  const ch = id => (CH[id] = CH[id] || { q: '', turns: null, loadedFor: '', pending: [], at: 0 });
  const INTERNAL = ['[IMPORTANT: Background process ', '[ASYNC DELEGATION BATCH COMPLETE', '[CONTEXT COMPACTION', '[CONTEXT SUMMARY]:', '[PRIOR CONTEXT', '[Your active task list was preserved', '[Your previous agent loop was paused', '[James requested recovery', '[OUT-OF-BAND', '[SYSTEM:'];
  const msgText = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : p?.text || '').join('\n') : c && typeof c === 'object' ? String(c.text || c.content || '') : '';
  function chipFiles(s) {
    const out = [];
    for (const m of String(s).matchAll(/\[WIZARD_FILE_CHIPS_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_FILE_CHIPS_V1\]/g)) {
      try { for (const f of JSON.parse(m[1])) out.push({ id: /^[A-Za-z0-9._:-]+$/.test(String(f.id || '')) ? String(f.id) : '', name: String(f.filename || f.name || 'file'), mime: String(f.mime || ''), bytes: Number(f.bytes) || 0 }); } catch (e) {}
    }
    return out;
  }
  const cleanMsg = s => String(s || '')
    .replace(/\[WIZARD_FILES_V1\][\s\S]*?\[\/WIZARD_FILES_V1\]/g, '')
    .replace(/\[WIZARD_FILE_CHIPS_V1\][\s\S]*?\[\/WIZARD_FILE_CHIPS_V1\]/g, '')
    .replace(/\[WIZARD_CLOSE_AND_FILE_V1\][\s\S]*?\[\/WIZARD_CLOSE_AND_FILE_V1\]/g, '')
    .replace(/<memory-context>[\s\S]*?<\/memory-context>/g, '')
    .replace(/^\[Workspace::v1: [^\]\r\n]+\]\s*/, '')
    .replace(/\n*\[Browser dogfooding policy[\s\S]*$/, '')
    .replace(/<\s*\/?\s*helm_attachments\s*>/gi, '')
    .trim();
  // One turn = what James said, the work in between, and the final answer.
  function toTurns(rows) {
    const out = []; let cur = null;
    for (const m of rows) {
      const kind = m.display_kind || '';
      const raw = msgText(m.display_content ?? m.content);
      if (m.role === 'user') {
        if (kind || INTERNAL.some(p => raw.trimStart().startsWith(p))) { if (cur) cur.steps++; continue; }
        const files = chipFiles(raw);
        let t = cleanMsg(raw);
        if (files.length && /^Please use the attached (file|files)\.$/.test(t)) t = '';
        if (!t && !files.length) continue;
        cur = { u: { text: t, files, at: m.timestamp }, a: null, notes: [], steps: 0 }; out.push(cur);
      } else if (m.role === 'assistant') {
        const t = cleanMsg(raw);
        if (!cur) { cur = { u: null, a: null, notes: [], steps: 0 }; out.push(cur); }
        if (!t) { cur.steps++; continue; }
        if (kind === 'commentary') { cur.notes.push(t); cur.steps++; continue; }
        if (cur.a) cur.notes.push(cur.a.text);
        cur.a = { text: t, at: m.timestamp };
      } else if (cur) cur.steps++;
    }
    return out;
  }
  function md(src) {
    const blocks = [];
    let s = String(src || '').replace(/```[^\n]*\n([\s\S]*?)```/g, (_, c) => { blocks.push(c); return `\u0000${blocks.length - 1}\u0000`; });
    let h = esc(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    let out = '', list = null, para = [];
    const flushP = () => { if (para.length) { out += `<p>${para.join('<br>')}</p>`; para = []; } };
    const flushL = () => { if (list) { out += `</${list}>`; list = null; } };
    for (const ln of h.split('\n')) {
      let m;
      if (/^\s*\u0000\d+\u0000\s*$/.test(ln)) { flushP(); flushL(); out += ln.trim(); continue; }
      if ((m = ln.match(/^#{1,4}\s+(.*)$/))) { flushP(); flushL(); out += `<h4>${m[1]}</h4>`; continue; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (list !== 'ul') { flushL(); out += '<ul>'; list = 'ul'; } out += `<li>${m[1]}</li>`; continue; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (list !== 'ol') { flushL(); out += '<ol>'; list = 'ol'; } out += `<li>${m[1]}</li>`; continue; }
      if (/^\s*\|.*\|\s*$/.test(ln)) { if (/^\s*\|[\s:|-]+\|\s*$/.test(ln)) continue; flushP(); flushL(); out += `<div class="trow">${ln.trim().slice(1, -1).split('|').map(c => `<span>${c.trim()}</span>`).join('')}</div>`; continue; }
      if (!ln.trim()) { flushP(); flushL(); continue; }
      flushL(); para.push(ln);
    }
    flushP(); flushL();
    return out.replace(/\u0000(\d+)\u0000/g, (_, k) => `<pre>${esc(blocks[+k])}</pre>`);
  }
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
      <span class="pv">${working ? '<i class="st working"></i>Working · ' : needs ? '<i class="st needs"></i>' : isNew ? '<i class="st unread"></i>' : ''}${esc(clip(s.preview || '', 110))}</span></span></button>`;
  }
  function renderChatList(w, el) {
    const c = ch(w.id), n = norm(c.q);
    const all = LIVE.ok ? LIVE.sessions.filter(s => !s.hidden) : [];
    const hit = n ? all.filter(s => norm(s.title).includes(n) || norm(s.preview).includes(n)) : all;
    const groups = LIVE.workGroups(hit);
    c.more = c.more || {};
    const head = `<div class="ch-top"><label class="ch-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input data-chsearch placeholder="Search threads" value="${esc(c.q)}" enterkeyhint="search" spellcheck="false"></label><button class="ch-new" data-chnew aria-label="New chat"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>`;
    let body;
    if (!LIVE.ok) body = `<div class="ch-empty">${LIVE.error === 'access' ? 'Wizard needs you to sign in. Open /wizard/ once, then come back.' : 'Connecting to Wizard…'}</div>`;
    else if (!hit.length) body = `<div class="ch-empty">No threads match “${esc(c.q)}”.</div>`;
    else body = SECTIONS.map(([k, label]) => {
      const list = groups[k];
      if (!list.length && (k === 'errors' || n)) return '';
      // While searching, every section with a hit opens so nothing is buried.
      const open = n ? true : secOpen[k];
      const newN = k === 'ready' ? list.filter(s => LIVE.isNew(s)).length : 0;
      const shown = c.more[k] ? list : list.slice(0, SEC_PAGE);
      return `<section class="ch-sec${open ? ' open' : ''}" data-sec="${k}"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span><small>${list.length}</small>${newN ? `<b>${newN} new</b>` : ''}<i aria-hidden="true"></i></button>
        ${open ? `<div class="ch-sec-b">${list.length ? shown.map(chatRow).join('') : '<span class="ch-none">None</span>'}${list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''}</div>` : ''}</section>`;
    }).join('');
    const scroll = el.querySelector('.ch-scroll')?.scrollTop || 0;
    el.innerHTML = `<div class="ch-list">${head}<div class="ch-scroll">${body}</div></div>`;
    const sc = el.querySelector('.ch-scroll'); if (sc) sc.scrollTop = scroll;
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
      try { Object.assign(local, await uploadFile(file), { uploading: false }); }
      catch (e) { c.files = c.files.filter(x => x !== local); toast('!', e.user ? e.message : 'Upload failed · not attached', 3200); }
      refreshCompose(wid);
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
  function fileChip(f) {
    const k = fileKind(f);
    if (k === 'voice' && f.id) { loadDuration(f.id); return `<button type="button" class="vnote" data-vnote="${esc(f.id)}" aria-label="Play voice note"><span class="vp">${PLAY_SVG}<i></i></span><span class="vw"><span class="vt">${MIC_SVG}Voice note</span><span class="vbar"><b></b></span></span><span class="vd">${DUR[f.id] ? mmss(DUR[f.id]) : ''}</span></button>`; }
    if (k === 'voice') return `<span class="fchip">${MIC_SVG} Voice note</span>`;
    if (k === 'image' && f.id) return `<a class="fimg" href="${esc(fileUrl(f.id))}" target="_blank" rel="noopener"><img src="${esc(fileUrl(f.id))}" alt="${esc(f.name)}" loading="lazy"></a>`;
    return f.id ? `<a class="fchip" href="${esc(fileUrl(f.id))}" target="_blank" rel="noopener">${CLIP_SVG} ${esc(f.name)}</a>` : `<span class="fchip">${CLIP_SVG} ${esc(f.name)}</span>`;
  }
  function turnHtml(tn, last, working) {
    let h = '';
    if (tn.u) h += `<div class="msg u"><div class="bub">${tn.u.files.length ? `<div class="fchips">${tn.u.files.map(fileChip).join('')}</div>` : ''}${tn.u.text ? md(tn.u.text) : ''}</div></div>`;
    const live = last && working;
    if (tn.steps || tn.notes.length || live) {
      const label = live ? (tn.notes.length ? esc(clip(tn.notes[tn.notes.length - 1], 90)) : 'Working') : `Worked through ${tn.steps} step${tn.steps === 1 ? '' : 's'}`;
      h += `<details class="steps${live ? ' live' : ''}"><summary>${live ? '<i class="dots"><b></b><b></b><b></b></i>' : '◇'} ${label}</summary>${tn.notes.map(x => `<div class="note-line">${md(x)}</div>`).join('')}</details>`;
    }
    if (tn.a) h += `<div class="msg a"><div class="bub">${md(tn.a.text)}</div></div>`;
    return h;
  }
  function renderThread(w, el) {
    const c = ch(w.id), isNew = w.thread === '__new__', s = isNew ? null : LIVE.session(w.thread);
    const working = !!s && WORKING_ST.has(s.status);
    const sub = isNew ? 'Starts a new thread with Archimedes' : working ? 'Archimedes is working' : s?.status === 'waiting_for_approval' ? 'Waiting for your approval' : s ? `Updated ${ago(s.lastAssistantAt || s.updatedAt)}` : '';
    const turns = c.loadedFor === w.thread ? c.turns || [] : null;
    let msgs;
    const pend = pendingFor(w);
    if (isNew && !pend.length) msgs = `<div class="ch-empty"><b>New chat</b><br>${esc(H.newChatHint || 'Type below.')}</div>`;
    else if (!turns && !isNew && !pend.length) msgs = `<div class="ch-empty">${c.err ? esc(c.err) : 'Loading thread…'}</div>`;
    else msgs = (turns || []).slice(-60).map((tn, k, arr) => turnHtml(tn, k === arr.length - 1, working)).join('')
      + pend.map(pendingHtml).join('')
      + (pend.some(p => p.state !== 'failed') && !working ? `<details class="steps live"><summary><i class="dots"><b></b><b></b><b></b></i> ${pend.some(p => p.state === 'waiting') ? 'Waiting for Wizard · will retry' : 'Sending'}</summary></details>` : '');
    const box = el.querySelector('.ch-msgs');
    const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const draft = el.querySelector('textarea')?.value || c.draft || '';
    const hadFocus = el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
    el.innerHTML = `<div class="ch-thread">
      <div class="ch-head"><button class="ch-back" data-chback aria-label="Back to threads"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="emo">${isNew ? '✎' : emoOf(w.thread)}</span><div class="ti"><b>${esc(winTitle(w))}</b><small>${esc(sub)}</small></div></div>
      <div class="ch-msgs">${msgs}</div>
      <form class="ch-compose" data-chform>${attachTray(c)}<div class="ch-row2"><button type="button" class="ch-attach" data-chattach aria-label="Attach photos or files">${CLIP_SVG}</button><textarea rows="1" placeholder="${working ? 'Steer Archimedes…' : 'Message Archimedes'}" enterkeyhint="enter">${esc(draft)}</textarea><button type="submit" aria-label="Send" ${(c.files || []).some(f => f.uploading) ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>
    </div>`;
    const nb = el.querySelector('.ch-msgs');
    nb.scrollTop = atBottom ? nb.scrollHeight : (box ? box.scrollTop : nb.scrollHeight);
    if (hadFocus) { const ta = el.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    growTa(el.querySelector('textarea'));
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
  function pendingHtml(p) {
    const files = (p.files || []).filter(f => f !== p.audioFile);
    const voice = p.audio || p.audioFile ? `<span class="fchip">${MIC_SVG} Voice note${p.text ? '' : ' · words come when it sends'}</span>` : '';
    return `<div class="msg u pending ${p.state}" data-ob="${esc(p.id)}"><div class="bub">${files.length || voice ? `<div class="fchips">${voice}${files.map(fileChip).join('')}</div>` : ''}${p.text ? md(p.text) : ''}</div><div class="pmeta">${pendingState(p)}</div></div>`;
  }
  function renderChats(w) {
    const el = track.querySelector(`[data-chats="${w.id}"]`); if (!el) return;
    if (w.thread) { renderThread(w, el); loadThread(w); } else renderChatList(w, el);
  }
  async function loadThread(w, force) {
    const c = ch(w.id); if (!w.thread || w.thread === '__new__' || c.loading) return;
    const s = LIVE.session(w.thread);
    const fresh = c.loadedFor === w.thread && Date.now() - c.at < (s && WORKING_ST.has(s.status) ? 3500 : 15000);
    if (fresh && !force) return;
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
      if (changed) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && W[w.id].thread === w.thread) renderThread(W[w.id], el); }
    } catch (e) { c.err = e.status === 403 ? 'Wizard sign-in needed' : pendingFor(w).length ? '' : 'Couldn’t load this thread'; c.at = Date.now(); }
    finally { c.loading = false; }
  }
  function openChat(wid, sid) {
    const w = W[wid]; if (!w) return;
    w.thread = sid; save();
    if (sid !== '__new__') LIVE.markSeen(sid);
    renderChats(w); applyLayout(deskOf(wid));
  }
  function chatsBack(w) { w.thread = null; save(); renderChats(w); applyLayout(deskOf(w.id)); }
  async function sendChat(wid, text, how = 'typing in the Chats window', audio = null) {
    const w = W[wid]; text = String(text || '').trim(); if (!w) return;
    const c = ch(wid);
    const files = (c.files || []).filter(f => f.id && !f.uploading);
    if (!text && !files.length && !audio) return;
    if ((c.files || []).some(f => f.uploading)) { toast('…', 'Still uploading · send when it finishes', 2000); return; }
    const isNew = w.thread === '__new__';
    const s = isNew ? null : LIVE.session(w.thread);
    const steerRunId = s && WORKING_ST.has(s.status) && s.runId ? s.runId : '';
    c.draft = ''; c.files = [];
    // Saved on the phone first; the outbox delivers it (and retries) from here.
    const it = await OUTBOX.enqueue({ kind: isNew ? 'new' : 'reply', sessionId: isNew ? '' : w.thread, steerRunId, text, audio,
      instructions: viewContext(wid, how), files: files.map(f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes })), wid, how, source: 'chat' });
    if (isNew && W[wid]) { W[wid].thread = it.sessionId; save(); c.loadedFor = ''; }
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
    const o = e.target.closest('[data-chopen]'); if (o) { openChat(id, o.dataset.chopen); return true; }
    if (e.target.closest('[data-chback]')) { chatsBack(w); return true; }
    if (e.target.closest('[data-chnew]')) { openChat(id, '__new__'); return true; }
    const sec = e.target.closest('[data-sectoggle]'); if (sec) { toggleSection(w, sec.dataset.sectoggle); return true; }
    const more = e.target.closest('[data-secmore]'); if (more) { const c = ch(id); c.more = { ...(c.more || {}), [more.dataset.secmore]: true }; renderChatList(w, elOf(id)); return true; }
    if (e.target.closest('[data-chattach]')) { pickFor = id; picker.accept = ''; picker.click(); return true; }
    const rm = e.target.closest('[data-attrm]'); if (rm) { const c = ch(id); c.files = (c.files || []).filter(f => f.key !== rm.dataset.attrm); refreshCompose(id); return true; }
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
      if (e.target.matches('.ch-compose textarea')) { growTa(e.target); ch(idOf(e.target)).draft = e.target.value; }
    });
    root.addEventListener('keydown', e => {
      if (e.target.matches('.ch-compose textarea') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.form.requestSubmit(); }
    });
  }
  /* Words from outside (dictation, a native shell) go in at the composer's cursor. */
  function insertText(id, text) {
    const ta = elOf(id)?.querySelector('.ch-compose textarea'); if (!ta || !text) return false;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b); ta.focus();
    ta.setSelectionRange(a + text.length, a + text.length); ch(id).draft = ta.value; growTa(ta);
    return true;
  }
  const forget = id => { delete CH[id]; };
  return { CH, ch, click, bind, insertText, forget, renderChats, renderChatList, renderThread, loadThread, openChat, chatsBack, sendChat, uploadFile,
    refreshCompose, toggleVoice, growTa, markVisibleThreadsSeen, addFiles, toTurns, md, MIC_SVG, CLIP_SVG, WORKING_ST };
};
