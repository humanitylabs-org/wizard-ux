/* Wizard UX phone shell › the shade: Recorder recording strips, notification groups and rows, and the moons
 * around the orb. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.inbox = function ({ $, ago, CHATS_APP, clip, closeSheets, emoOf, esc, inboxEl, live, LIVE, onUnsentChange, openWizardThread, OUTBOX, paintOrbBadge, toast, unsentAction, unsentAll, unsentRow, vib }) {

  // Recorder recordings (formerly Mizel.ai): the bridge opens one "🎙 …" thread per recording; they live in the shade as their own source.
  const isRec = n => /^\s*\u{1F399}/u.test(n?.title || '');
  const REC_WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);
  function recState(s) { if (REC_WORKING.has(s.status)) return { k: 'run', g: '⏳', t: 'Follow-ups running' };
    if (/\u2705/u.test(s.preview || '')) return { k: 'done', g: '✅', t: 'Ready for review' };
    if (s.status === 'failed' || s.status === 'interrupted') return { k: 'fail', g: '⚠', t: 'Needs a look' };
    return { k: 'sum', g: '◦', t: 'Summary ready' }; }
  function recStripHtml() {
    const rows = (LIVE?.sessions || []).filter(x => isRec(x) && !x.archived && !x.hidden)
      .sort((p, q) => (Date.parse(q.activityAt || q.updatedAt) || 0) - (Date.parse(p.activityAt || p.updatedAt) || 0)).slice(0, 10);
    const items = rows.map(r => { const st = recState(r); const t = r.title.replace(/^\s*\u{1F399}\uFE0F?\s*/u, '');
      return `<button class="rec-row ${st.k}${LIVE.isNew(r) ? ' new' : ''}" data-rec="${esc(r.id)}" title="${esc(st.t)}"><span class="rt">${esc(ago(r.activityAt || r.updatedAt))}</span><span class="rn">${esc(t)}</span><span class="rs" aria-label="${esc(st.t)}">${st.g}</span></button>`; }).join('');
    return `<div class="rec-h"><b>◉ Recordings</b><span>${rows.length ? rows.length + ' latest' : ''}</span></div><div class="rec-list">${items || '<div class="rec-empty">New recordings land here and in Chats.</div>'}</div>`;
  }
  function refreshRecStrips() { const h = recStripHtml(); document.querySelectorAll('.rec-strip').forEach(el => { if (el.innerHTML !== h) el.innerHTML = h; }); }
  document.addEventListener('click', e => { const r = e.target.closest('[data-rec]'); if (!r) return; e.stopPropagation(); vib(6); openWizardThread(r.dataset.rec); }, true);

  const GROUPS = [
    { g: 'working', name: 'Working', c: 'var(--violet-2)' },
    { g: 'ready', name: 'Unread', c: 'var(--green)' },
    { g: 'needs', name: 'Needs you', c: 'var(--amber)' },
  ];
  function noteHtml(n, g) {
    const sub = n.status === 'queued' && n.queueReason === 'provider_access' ? 'AI could not start · message saved · choose another model or retry' : g === 'working' ? (n.status === 'queued' ? 'Queued' : `${window.WizConfig.agent()} is on it`) : g === 'needs' ? (n.status === 'waiting_for_approval' ? 'Waiting for your approval' : n.status === 'failed' || n.status === 'interrupted' ? 'Stopped · needs a look' : 'Needs you') : (n.preview || '');
    return `<button class="note ${g === 'working' ? 'working' : ''}" data-note="${esc(n.id)}" data-g="${g}">${isRec(n) ? '<span class="ic rec">◉</span>' : `<span class="ic emo">${emoOf(n.id)}</span>`}
      <span class="bd"><span class="tp"><span class="src${isRec(n) ? ' mizel' : ''}">${isRec(n) ? 'Recorder' : 'Chats'}</span><span class="tm">${esc(ago(g === 'working' ? (n.lastUserAt || n.updatedAt) : (n.lastAssistantAt || n.activityAt || n.updatedAt)))}</span></span><span class="ti">${esc(n.title)}</span><span class="sb">${esc(clip(sub, 120))}</span></span></button>`;
  }
  function renderInbox() {
    const L = live();
    let html = '<div class="push"></div>';
    if (!LIVE.ok) html += `<div class="ibx-empty">${LIVE.error === 'access' ? 'Wizard needs you to sign in. Open Wizard once, then come back.' : 'Connecting to Wizard…'}</div>`;
    // Most urgent sits lowest: closest to the thumb and the orb.
    for (const G of GROUPS) {
      const items = L[G.g]; if (!items.length) continue;
      html += `<div class="ibx-h" style="--c:${G.c}"><h4><i></i>${G.name}</h4><span>${items.length}${G.g === 'ready' && items.length > 1 ? ' · <button class="ibx-all" data-allread>Mark all read</button>' : ''}</span></div>` + items.slice(0, 40).map(n => noteHtml(n, G.g)).join('');
    }
    // Unsent sits lowest of all: it is the one thing that can be lost if nobody looks.
    const un = unsentAll();
    if (un.length) html += `<div class="ibx-h" style="--c:var(--amber)"><h4><i></i>Unsent</h4><span>${un.length}${un.length > 1 ? ' · <button class="ibx-all" data-ub-all="retry">Retry all</button>' : ''}</span></div>` + un.map(unsentRow).join('');
    if (LIVE.ok && !un.length && !L.needs.length && !L.ready.length && !L.working.length) html += `<div class="ibx-empty"><b>All clear.</b> Nothing unread, nothing running.</div>`;
    html += `<div class="sec-title" style="justify-content:center;margin:10px 0 4px"><span>Tap to open · swipe right to mark read</span></div>`;
    $('#inboxBody').innerHTML = html;
    const b = $('#inboxBody'); b.scrollTop = b.scrollHeight;
  }
  // tap opens the real thread, swipe right marks it read everywhere
  let ns = null;
  inboxEl.addEventListener('pointerdown', e => { const el = e.target.closest('.note'); if (el) ns = { el, x: e.clientX, y: e.clientY, dx: 0 }; });
  inboxEl.addEventListener('pointermove', e => { if (!ns) return; ns.dx = e.clientX - ns.x; if (Math.abs(e.clientY - ns.y) > 20 && Math.abs(ns.dx) < 20) { ns.el.style.transform = ''; ns = null; return; } if (ns.dx > 0) ns.el.style.transform = `translateX(${ns.dx}px)`; });
  inboxEl.addEventListener('pointerup', () => {
    if (!ns) return; const { el, dx } = ns; ns = null;
    const id = el.dataset.note, g = el.dataset.g;
    if (dx > 90 && g !== 'working') { el.classList.add('gone'); vib(8); setTimeout(() => { LIVE.markSeen(id); toast('✓', 'Marked read'); }, 200); return; }
    el.style.transform = '';
    if (Math.abs(dx) < 8) { closeSheets(true); openWizardThread(id); }
  });
  inboxEl.addEventListener('pointercancel', () => { if (ns) ns.el.style.transform = ''; ns = null; });
  inboxEl.addEventListener('click', e => {
    if (e.target.closest('[data-allread]')) { LIVE.markSeen(live().ready.map(s => s.id)); vib(8); toast('✓', 'All marked read'); return; }
    const ub = e.target.closest('[data-ub]'); if (ub) { const r = ub.closest('[data-ubid]'); return unsentAction(r.dataset.ubid, r.dataset.uborigin, ub.dataset.ub); }
    if (e.target.closest('[data-ub-all]')) window.WosSettings.retryAll({ outbox: OUTBOX, toast, render: onUnsentChange });
  });

  // Moons orbit the orb: one per running agent (violet) or thread that needs you (amber).
  function renderMoons() {
    const L = live();
    const m = [...L.needs.map(() => 'var(--amber)'), ...L.working.map(() => 'var(--violet-2)'), ...L.ready.map(() => 'var(--green)')].slice(0, 8);
    $('#moons').innerHTML = m.map((c, k) => { const a = (k / Math.max(m.length, 1)) * Math.PI * 2 - Math.PI / 2, r = Math.round(($('#orbWrap').offsetWidth || 44) / 2 + 8);
      return `<i style="--c:${c};transform:translate(${(Math.cos(a) * r).toFixed(1)}px,${(Math.sin(a) * r).toFixed(1)}px)"></i>`; }).join('');
    // Notification badges reflect unread, independently of the Ready workflow. The orb shows the current desk.
    window.WizCore.workspaceNav.refreshChats(LIVE, CHATS_APP.id);
    paintOrbBadge();
  }
  return { refreshRecStrips, renderInbox, renderMoons };
};
