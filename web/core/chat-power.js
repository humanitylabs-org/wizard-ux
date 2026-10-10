/* Wizard UX core: the power features of a Chats thread, wired into core/chats.js through small hooks.
 * Shared by every shell. Each feature's data/rendering lives in its own module; this file is the glue.
 *
 *  #11 model picker   header chip → sheet (thread: POST …/sessions/:id/model; new chat: rides with the first send)
 *                     failed thread → “Needs retry” panel: Retry · Choose another model · Dismiss      (chat-models.js)
 *  #12 Errors section failed threads, failed background work (/wizard/attention) and failed voice notes (outbox),
 *                     each with Retry / Dismiss                                                         (chat-errors.js)
 *  #13 composer mic   records a voice reply pinned to THIS thread (the shell's recorder via H.recordReply),
 *                     delivered by the durable outbox with the recording attached                        (sendVoiceTo)
 *  #17 work receipt   one collapsible row per turn: Worked for 3m · 2 of 4 done · named steps         (chat-work.js)
 *  #18 reading place  opens at the start of the latest reply, remembers where you were for an hour,
 *                     “↓ Latest” jump; a Working thread follows the bottom until you scroll up
 *  #23 Files          browse Wizard Files, preview in the media viewer, attach to a chat              (files.js)
 *
 *   const PW = window.WosChatPower(api)   (api: the Chats instance's internals, see chats.js)
 */
window.WosChatPower = function chatPower(A) {
  'use strict';
  const { esc, clip } = window.WizCore;
  const LIVE = window.WizLive, OUTBOX = window.WosOutbox || null;
  const M = window.WosModels || null, WK = window.WosWork || null, E = window.WosErrors || null, F = window.WosFiles || null;
  const { ch, toast, H } = A;
  const agent = () => window.WizConfig.agent();
  const FAILED = new Set(['failed', 'interrupted']);
  const FOLDER_SVG = '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/></svg>';

  /* ================= #18 reading position ================= */
  // wizard-mobile ff86db8c readingPosition.ts: same key, one hour, newest 32 threads.
  const RP_KEY = 'wizard.mobile.reading-positions.v1', RP_TTL = 60 * 60 * 1000, RP_MAX = 32;
  const RP = {
    all(now = Date.now()) {
      try {
        const raw = JSON.parse(localStorage.getItem(RP_KEY) || '{}'), out = {};
        for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
          if (!v || v.sessionId !== k || typeof v.messageId !== 'string' || !isFinite(v.savedAt) || !isFinite(v.scrollTop)) continue;
          if (now - v.savedAt >= RP_TTL || v.savedAt > now + RP_TTL) continue;
          out[k] = v;
        }
        return out;
      } catch (e) { return {}; }
    },
    read(sid) { return sid ? RP.all()[sid] || null : null; },
    save(p) {
      const all = RP.all(p.savedAt); all[p.sessionId] = p;
      const keep = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, RP_MAX));
      try { localStorage.setItem(RP_KEY, JSON.stringify(keep)); } catch (e) {}
    },
  };
  const latestId = turns => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].a) return `${i}:${turns[i].a.at ?? ''}`; return ''; };
  const lastReply = nb => { const a = nb.querySelectorAll('.msg.a'); return a.length ? a[a.length - 1] : null; };
  const relTop = (nb, el) => el.getBoundingClientRect().top - nb.getBoundingClientRect().top;
  const bottomGap = nb => nb.scrollHeight - nb.scrollTop - nb.clientHeight;
  const toBottom = nb => { nb.scrollTop = nb.scrollHeight; };
  function paintLatest(el, nb) {
    const b = el.querySelector('[data-chlatest]'); if (!b || !nb) return;
    b.hidden = bottomGap(nb) < 160;
  }
  /* Called by renderThread after the new DOM is in. Returns true when it placed the scroll itself. */
  function position(w, el, nb, o) {
    const c = ch(w.id), sid = w.thread;
    if (o.keep || !nb) return false;
    if (sid === '__new__' || !o.turns) { toBottom(nb); return true; }
    c.lid = latestId(o.turns);
    if (c.posFor !== sid) {
      c.posFor = sid;
      const saved = RP.read(sid), reply = lastReply(nb);
      if (o.working) { c.follow = true; toBottom(nb); }
      else if (saved && c.lid && saved.messageId === c.lid) {
        // Back where you were: anchored to the latest reply, so layout changes don't shift it.
        if (saved.atBottom) toBottom(nb);
        else nb.scrollTop = reply && isFinite(saved.anchorOffset) ? nb.scrollTop + relTop(nb, reply) - saved.anchorOffset : saved.scrollTop;
        c.follow = !!saved.atBottom;
      } else if (reply) {
        // A fresh reply: open at its first line, not the end of it.
        nb.scrollTop = Math.max(0, nb.scrollTop + relTop(nb, reply) - 8);
        c.follow = bottomGap(nb) < 80;
        c.atStart = sid;
      } else { c.follow = true; toBottom(nb); }
      paintLatest(el, nb);
      return true;
    }
    // Later renders: a thread that follows stays on the bottom; otherwise the reading place holds.
    if (c.follow || (o.working && o.atBottom)) toBottom(nb);
    else if (o.boxTop != null) nb.scrollTop = o.boxTop; // read before the old list was replaced (a detached box reads 0)
    paintLatest(el, nb);
    return true;
  }
  let saveT = 0;
  function onScroll(nb) {
    const el = nb.closest('[data-chats]'); if (!el) return;
    const id = el.dataset.chats, w = H.win(id); if (!w || !w.thread || w.thread === '__new__') return;
    const c = ch(id);
    c.follow = bottomGap(nb) < 80;
    paintLatest(el, nb);
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!c.lid || c.posFor !== w.thread) return;
      const reply = lastReply(nb);
      RP.save({ sessionId: w.thread, messageId: c.lid, anchorOffset: reply ? relTop(nb, reply) : 0, scrollTop: Math.max(0, Math.round(nb.scrollTop)), savedAt: Date.now(), atBottom: bottomGap(nb) < 80, following: !!c.follow });
    }, 200);
  }
  // Pick from what's already in Wizard Files (#23), next to the paperclip.
  const filesBtn = () => (F ? `<button type="button" class="ch-fromfiles" data-chfiles aria-label="Attach from Wizard Files" title="From Wizard Files">${FOLDER_SVG}</button>` : '');
  const latestBtn = () => '<button type="button" class="ch-latest" data-chlatest hidden aria-label="Jump to the latest message">↓ Latest</button>';

  /* ================= #17 work receipt ================= */
  const turnKey = tn => `${tn.u?.at ?? tn.at ?? ''}:${(tn.u?.text || '').length}`;
  function workHtml(c, tn, live) {
    if (!WK) return null;
    const key = turnKey(tn);
    return WK.html(tn, { live, open: !!c.wkOpen?.has(key), md: A.md, esc, clip, key });
  }

  /* ================= #11 models ================= */
  const MOVER = new Map(); // sid -> { model, provider, at }: a change Wizard's list hasn't caught up with yet
  function threadModel(s) {
    const o = s && MOVER.get(s.id);
    if (o && Date.now() - o.at < 120e3 && !(s.model === o.model && (!o.provider || s.provider === o.provider))) return o;
    if (o) MOVER.delete(s.id);
    return s ? { model: s.model || '', provider: s.provider || '' } : { model: '', provider: '' };
  }
  function newModel(c) { return c.newModel || (M?.defaultOption() ? { model: M.defaultOption().value, provider: M.defaultOption().provider, isDefault: true } : null); }
  // The chip in the thread header: the model this thread (or this new chat) runs on. Tap to change it.
  function modelChip(w, s) {
    if (!M) return '';
    const cur = w.thread === '__new__' ? newModel(ch(w.id)) : s ? threadModel(s) : null;
    const label = cur?.model ? M.short(cur.model, cur.provider) : M.ready ? 'Default model' : 'Model';
    return `<button type="button" class="ch-model" data-chmodel aria-label="Model: ${esc(cur?.model ? M.name(cur.model, cur.provider) : 'default')}. Change model" title="${esc(cur?.model || '')}">${esc(label)}<i aria-hidden="true">▾</i></button>`;
  }
  let modelsAsked = false;
  function ensureModels() {
    if (!M || modelsAsked) return;
    modelsAsked = true;
    M.load().then(() => { for (const id of Object.keys(A.CH)) { const w = H.win(id); if (w?.thread) A.renderThreadNow(w); } });
  }
  async function pickModel(o) {
    const sh = sheet; if (!sh || sh.type !== 'model') return;
    const c = ch(sh.wid), w = H.win(sh.wid); closeSheet();
    if (sh.mode === 'new') { c.newModel = { model: o.value, provider: o.provider }; toast('◇', `New chat on ${o.name}`, 1400); if (w) A.renderThreadNow(w); return; }
    const s = LIVE.session(sh.sid); if (!s) return;
    const cur = threadModel(s);
    const same = cur.model === o.value && (!o.provider || cur.provider === o.provider);
    if (!same) {
      try { await M.setThreadModel(sh.sid, o); }
      catch (e) { toast('!', 'Couldn’t change the model · try again', 2600); return; }
      MOVER.set(sh.sid, { model: o.value, provider: o.provider, at: Date.now() });
      Object.assign(s, { model: o.value, provider: o.provider });
    }
    if (sh.mode === 'retry') return retryThread(sh.wid, sh.sid, o);
    toast('◇', same ? `Already on ${o.name}` : `This thread now uses ${o.name}`, 1600);
    if (w) A.renderThreadNow(w);
  }

  /* ================= #11/#12 failure recovery ================= */
  const failedShown = s => !!s && FAILED.has(s.status) && !(E && E.dismissed(s.id));
  function failureHtml(w, s) {
    if (!M || !failedShown(s)) return '';
    const c = ch(w.id), busy = E?.busy.get(s.id) || (c.retrying === s.id ? 'retry' : '');
    const req = requestOf(w, s);
    return M.failureHtml({ s: { ...s, ...threadModel(s) }, busy, canRetry: !!req });
  }
  function requestOf(w, s) {
    if (s?.request) return s.request;
    const c = w && ch(w.id), turns = c && c.loadedFor === s?.id ? c.turns || [] : [];
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].u?.text) return turns[i].u.text;
    return '';
  }
  // Retry = send the thread's last request again, through the durable outbox, on the same thread
  // (and the same model, unless one was just picked). controller.ts retryServerFailedSession.
  async function retryThread(wid, sid, o) {
    const s = LIVE.session(sid); if (!s || !OUTBOX) return false;
    const w = H.win(wid), text = requestOf(w && w.thread === sid ? w : null, s);
    if (!text) { toast('!', 'This thread has no request to send again · open it to reply', 2600); return false; }
    const cur = o ? { model: o.value, provider: o.provider } : threadModel(s);
    const c = w ? ch(wid) : null; if (c) c.retrying = sid;
    try {
      await OUTBOX.enqueue({ kind: 'reply', sessionId: sid, text, wid: w && w.thread === sid ? wid : '', how: 'retry', source: 'chat',
        instructions: `${window.WizConfig.owner() || 'The owner'} pressed Retry on this thread after the last request failed${o ? `, choosing ${o.name}` : ''}. This is the same request again.`,
        ...(cur.model ? { model: cur.model, provider: cur.provider } : {}) });
      E?.cleared.set(sid, Date.now());
      toast('↻', o ? `Retrying on ${o.name}` : 'Retrying', 1600);
      if (c) c.follow = true;
      return true;
    } catch (e) { toast('!', 'Couldn’t queue the retry', 2400); return false; }
    finally { if (c) c.retrying = ''; rerenderAll(); }
  }
  async function dismissThread(sid) {
    const ok = await E?.dismissFailure(sid);
    toast(ok ? '✓' : '!', ok ? 'Dismissed · history kept' : 'Couldn’t dismiss · try again', ok ? 1400 : 2600);
    rerenderAll();
  }
  function rerenderAll() { for (const id of Object.keys(A.CH)) { const w = H.win(id); if (w) A.renderChats(w); } H.changed?.(); }

  /* Errors section extras: background work Wizard flagged (/wizard/attention) and voice notes that didn't send. */
  const voiceFailed = () => (OUTBOX ? OUTBOX.unsent().filter(it => it.state === 'failed' && (it.audio || it.audioFile)) : []);
  let confirmDel = { id: '', at: 0 };
  function errorsFilter(list) { return E ? list.filter(s => !E.dismissed(s.id)) : list; }
  function errorRow(s, rowHtml) {
    if (!E) return rowHtml;
    const busy = E.busy.get(s.id);
    return `<div class="ch-err" data-errsid="${esc(s.id)}">${rowHtml}<div class="ch-err-b"><button type="button" data-errretry="${esc(s.id)}" ${busy ? 'disabled' : ''}>Retry</button><button type="button" class="ghost" data-errdismiss="${esc(s.id)}" ${busy ? 'disabled' : ''}>${busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}</button></div></div>`;
  }
  function errorsExtra() {
    if (!E) return { n: 0, html: '' };
    if (!E.ready && !E.loading) E.load();
    const att = E.items, vf = voiceFailed();
    const html = att.map(a => `<div class="ch-err att" data-errattn="${esc(a.id)}"><div class="ch-err-t"><b>${esc(a.title)}</b><small>${esc(clip(a.detail || 'Recovery controls are available here.', 140))}</small></div><div class="ch-err-b">`
        + `${a.canRetry ? `<button type="button" data-attretry="${esc(a.id)}" ${E.busy.has(a.id) ? 'disabled' : ''}>${E.busy.get(a.id) === 'retry' ? 'Retrying…' : 'Retry'}</button>` : ''}`
        + `${a.sessionId && LIVE.session(a.sessionId) ? `<button type="button" class="ghost" data-chopen="${esc(a.sessionId)}">Open</button>` : ''}`
        + `<button type="button" class="ghost" data-attdismiss="${esc(a.id)}" ${E.busy.has(a.id) ? 'disabled' : ''}>${E.busy.get(a.id) === 'dismiss' ? 'Dismissing…' : 'Dismiss'}</button></div></div>`).join('')
      + vf.map(it => {
        const sure = confirmDel.id === it.id && Date.now() - confirmDel.at < 4000;
        return `<div class="ch-err ch-err-vn" data-errob="${esc(it.id)}"><div class="ch-err-t"><b>${A.MIC_SVG}Voice note${it.text ? ` · ${esc(clip(it.text, 60))}` : ''}</b><small>Not sent · ${esc(it.error || 'Wizard didn’t take it')}</small></div><div class="ch-err-b">`
          + `<button type="button" data-obretry="${esc(it.id)}">Retry</button><button type="button" class="ghost${sure ? ' warn' : ''}" data-obdismiss="${esc(it.id)}">${sure ? 'Delete recording?' : 'Dismiss'}</button></div></div>`;
      }).join('');
    return { n: att.length + vf.length, html };
  }
  if (E) E.onChange(() => rerenderLists());
  function rerenderLists() { for (const id of Object.keys(A.CH)) { const w = H.win(id); if (w && !w.thread) A.renderChats(w); } }

  /* ================= #13 composer mic ================= */
  // On while a take pinned to THIS thread is recording (recordingFor() names the thread the take belongs to).
  // While its take records, the mic IS the send button (arrow, recording ring); otherwise it is the mic.
  const SEND_SVG = '<svg class="snd" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const micBtn = wid => { if (!H.recordReply) return ''; const sid = H.win(wid)?.thread, on = !!sid && H.recordingFor?.() === sid; return `<button type="button" class="ch-mic${on ? ' on' : ''}" data-chmic aria-pressed="${on}" aria-label="${on ? 'Send this voice reply' : 'Record a voice reply to this thread'}" title="${on ? 'Send voice reply' : 'Voice reply to this thread'}">${A.MIC_SVG.replace('<svg ', '<svg class="mc" ')}${SEND_SVG}</button>`; };
  /* A recording made from a thread's composer: always delivered to that thread (pinned when recording started),
   * through the durable outbox, which transcribes it and keeps the recording as a voice note. */
  async function sendVoiceTo(wid, sid, blob, files = []) {
    if (!OUTBOX || !blob || !sid) return null;
    const w = H.win(wid), c = ch(wid);
    const isNew = sid === '__new__';
    const s = isNew ? null : LIVE.session(sid);
    const steerRunId = s && A.WORKING_ST.has(s.status) && s.runId ? s.runId : '';
    const nm = isNew ? (c.newModel || null) : null;
    // Files already attached in this thread's composer ride with the voice reply and leave the composer, the
    // same as a typed send; otherwise they'd stay behind as a "draft" of a message that already went.
    // Typed words stay put: the outbox treats a non-empty text as the transcript.
    const dkey = isNew ? 'new' : 'direct:' + sid, here = !!w && w.thread === sid;
    const comp = (here ? (c.files || []) : A.KIT.drafts.get(dkey).files).filter(f => f && f.id && !f.uploading);
    const all = [...(files || []), ...comp].filter((f, i, a) => a.findIndex(x => x.id === f.id) === i).slice(0, 8);
    // Cleared before the await, so the other parts of an interrupted take don't carry the same files again.
    const kept = here ? (c.draft || '') : A.KIT.drafts.get(dkey).text;
    const clearTray = list => { if (here) { c.files = list; A.refreshCompose(wid); } A.KIT.drafts.set(dkey, kept, list); };
    if (comp.length) clearTray([]);
    let it;
    try {
      it = await OUTBOX.enqueue({ kind: isNew ? 'new' : 'reply', sessionId: isNew ? '' : sid, steerRunId, text: '', audio: blob,
        instructions: H.viewContext(wid, 'a voice reply recorded in this thread'), files: all.map(f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes })),
        wid: isNew ? wid : (w && w.thread === sid ? wid : ''), how: 'voice reply in this thread', source: 'chat', ...(nm ? { model: nm.model, provider: nm.provider } : {}) });
    } catch (e) { if (comp.length) clearTray(comp); throw e; } // not saved anywhere: the attachments go back
    if (isNew) c.newModel = null;
    c.follow = true;
    // Send and go: a voice reply from the composer mic steps back to the list like a typed send (chats.js).
    if (w) A.leaveAfterSend?.(wid, sid, isNew, 'voice reply in this thread');
    if (w) A.renderChats(w);
    return it;
  }
  function paintMic(on, sid) {
    H.root().querySelectorAll('[data-chmic]').forEach(b => { const id = b.closest('[data-chats]')?.dataset.chats, x = !!on && !!sid && H.win(id)?.thread === sid; b.classList.toggle('on', x); b.setAttribute('aria-pressed', String(x)); b.setAttribute('aria-label', x ? 'Send this voice reply' : 'Record a voice reply to this thread'); });
  }

  /* ================= sheets: model picker, Files ================= */
  let sheet = null; // { type: 'model'|'files', pane, wid, sid, mode, all, list, q, kind }
  function closeSheet() {
    if (!sheet) return false;
    H.root().querySelectorAll('.ch-psheet').forEach(n => n.remove());
    sheet = null; return true;
  }
  function paint(paneId, el) {
    if (!sheet || sheet.pane !== paneId || !el) return;
    el.querySelectorAll('.ch-psheet').forEach(n => n.remove());
    let html = '';
    if (sheet.type === 'model') {
      const r = M.sheetHtml({ mode: sheet.mode, cur: sheet.cur, all: sheet.all, title: '' });
      sheet.list = r.list; html = r.html;
    } else if (sheet.type === 'files') {
      const tw = H.win(sheet.wid), c = ch(sheet.wid);
      html = F.panelHtml({ q: sheet.q, kind: sheet.kind, attach: !!tw?.thread, picked: (c.files || []).map(f => f.id).filter(Boolean), when: ms => `${A.KIT.time.day(ms)} ${A.KIT.time.clock(ms)}` });
    }
    el.insertAdjacentHTML('beforeend', html.replace('class="ch-sheet ', 'class="ch-sheet ch-psheet '));
  }
  function openSheet(o) {
    A.closeRowSheet(); closeSheet();
    sheet = o; const el = A.elOf(o.pane); paint(o.pane, el); H.overlay?.(true); A.vib(8);
  }
  function openModels(pane, mode) {
    if (!M) return;
    const wid = A.owner(pane), w = H.win(wid); if (!w || !w.thread) return;
    const s = w.thread === '__new__' ? null : LIVE.session(w.thread);
    const cur = mode === 'new' ? newModel(ch(wid)) : threadModel(s);
    openSheet({ type: 'model', pane, wid, sid: w.thread, mode, cur, all: false });
    if (!M.ready) M.load().then(() => { if (sheet?.type === 'model') paint(sheet.pane, A.elOf(sheet.pane)); });
  }
  function openFiles(pane) {
    if (!F) return;
    openSheet({ type: 'files', pane, wid: A.owner(pane), q: '', kind: 'all' });
    F.load().then(() => { if (sheet?.type === 'files') paint(sheet.pane, A.elOf(sheet.pane)); });
  }
  function attachExisting(f) {
    const sh = sheet; if (!sh) return;
    let w = H.win(sh.wid); if (!w) return;
    if (!w.thread) { A.openChat(sh.wid, '__new__'); w = H.win(sh.wid); }
    const c = ch(sh.wid); c.files = c.files || [];
    const had = c.files.findIndex(x => x.id === f.id);
    if (had >= 0) { c.files.splice(had, 1); toast('✕', 'Removed from this message', 1200); }
    else if (c.files.length >= 8) { toast('!', 'Up to 8 files per message', 2400); return; }
    else { c.files.push({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes, key: Math.random().toString(36).slice(2), preview: f.kind === 'image' ? F.media(f).url : '' }); toast('📎', `Attached · ${f.kind === 'voice' ? 'Voice note' : clip(f.name, 32)}`, 1400); }
    A.saveDraft(sh.wid); A.refreshCompose(sh.wid);
    paint(sh.pane, A.elOf(sh.pane));
  }

  /* ================= clicks, scroll, toggles ================= */
  function click(e, id) {
    const t = e.target;
    if (sheet && sheet.pane === id) {
      if (t.closest('[data-ficlose]') || (t.closest('.ch-psheet') && !t.closest('.ch-sheet-b'))) { closeSheet(); return true; }
      if (sheet.type === 'model') {
        if (t.closest('[data-mall]')) { sheet.all = true; paint(id, A.elOf(id)); return true; }
        const p = t.closest('[data-mpick]'); if (p) { const o = sheet.list?.[+p.dataset.mpick]; if (o) pickModel(o); return true; }
      }
      if (sheet.type === 'files') {
        const k = t.closest('[data-fikind]'); if (k) { sheet.kind = k.dataset.fikind; paint(id, A.elOf(id)); return true; }
        const op = t.closest('[data-fiopen]'); if (op) { const f = F.get(op.dataset.fiopen); if (f) { const list = f.kind === 'image' ? F.filter(sheet.q, sheet.kind).filter(x => x.kind === 'image') : [f]; A.KIT.viewer.open(list.map(F.media), Math.max(0, list.indexOf(f))); } return true; }
        const at = t.closest('[data-fiattach]'); if (at) { const f = F.get(at.dataset.fiattach); if (f) attachExisting(f); return true; }
      }
      if (t.closest('.ch-psheet')) return true;
    }
    const w = H.win(id);
    if (t.closest('[data-chfiles]')) { openFiles(id); return true; }
    if (t.closest('[data-chmodel]')) { const ww = H.win(A.owner(id)); openModels(id, ww?.thread === '__new__' ? 'new' : 'thread'); return true; }
    if (t.closest('[data-chlatest]')) { const nb = A.elOf(id)?.querySelector('.ch-msgs'); if (nb) { ch(id).follow = true; nb.scrollTo({ top: nb.scrollHeight, behavior: 'smooth' }); } return true; }
    if (t.closest('[data-chmic]')) {
      if (!w?.thread || !H.recordReply) return true;
      const r = H.recordReply(id, w.thread);
      Promise.resolve(r).then(st => { if (st === 'busy') toast('…', 'Finishing the last recording', 1400); });
      return true;
    }
    // Failed thread panel
    if (t.closest('[data-chretry]') && w?.thread) { retryThread(id, w.thread); return true; }
    if (t.closest('[data-chretrymodel]') && w?.thread) { openModels(id, 'retry'); if (sheet) sheet.mode = 'retry'; paint(id, A.elOf(id)); return true; }
    if (t.closest('[data-chdismiss]') && w?.thread) { dismissThread(w.thread); return true; }
    // Errors section
    const er = t.closest('[data-errretry]'); if (er) { retryThread(A.owner(id), er.dataset.errretry); return true; }
    const ed = t.closest('[data-errdismiss]'); if (ed) { dismissThread(ed.dataset.errdismiss); return true; }
    const ar = t.closest('[data-attretry]'); if (ar) { E.retryAttention(ar.dataset.attretry).then(ok => toast(ok ? '↻' : '!', ok ? 'Retrying' : 'Couldn’t retry · try again', ok ? 1400 : 2400)); return true; }
    const ad = t.closest('[data-attdismiss]'); if (ad) { E.dismissAttention(ad.dataset.attdismiss).then(ok => toast(ok ? '✓' : '!', ok ? 'Dismissed' : 'Couldn’t dismiss · try again', ok ? 1400 : 2400)); return true; }
    const od = t.closest('[data-obdismiss]'); if (od) {
      const oid = od.dataset.obdismiss;
      if (confirmDel.id === oid && Date.now() - confirmDel.at < 4000) { confirmDel = { id: '', at: 0 }; OUTBOX.remove(oid); toast('✕', 'Recording deleted', 1400); }
      else { confirmDel = { id: oid, at: Date.now() }; rerenderLists(); setTimeout(() => { if (confirmDel.id === oid) { confirmDel = { id: '', at: 0 }; rerenderLists(); } }, 4100); }
      return true;
    }
    return false;
  }
  function bind(root) {
    root.addEventListener('scroll', e => { const t = e.target; if (t && t.classList && t.classList.contains('ch-msgs')) onScroll(t); }, true);
    root.addEventListener('toggle', e => {
      const d = e.target; if (!d || !d.matches || !d.matches('details[data-wk]')) return;
      const id = d.closest('[data-chats]')?.dataset.chats; if (!id) return;
      const c = ch(id); c.wkOpen = c.wkOpen || new Set();
      if (d.open) c.wkOpen.add(d.dataset.wk); else c.wkOpen.delete(d.dataset.wk);
    }, true);
    root.addEventListener('input', e => {
      if (!e.target.matches('[data-fiq]') || !sheet || sheet.type !== 'files') return;
      sheet.q = e.target.value; const el = A.elOf(sheet.pane); paint(sheet.pane, el);
      const inp = el?.querySelector('[data-fiq]'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
  }
  const opened = (wid, sid) => { const c = ch(wid); c.posFor = ''; c.follow = false; if (sid !== '__new__') c.newModel = null; if (sheet && A.owner(sheet.pane) === wid && sheet.type === 'model') closeSheet(); };
  const holds = id => !!sheet && sheet.pane === id;
  return { position, latestBtn, filesBtn, workHtml, modelChip, ensureModels, failureHtml, errorsFilter, errorRow, errorsExtra, micBtn, sendVoiceTo, paintMic,
    paint, closeSheet, click, bind, opened, holds, openFiles, openModels, retryThread, FOLDER_SVG, RP, newModel: c => c.newModel || null };
};
