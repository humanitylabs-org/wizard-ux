/* Wizard UX core: inline action cards in chat (wizard-ux issue 1463, off-by-default switch wizard/action-cards).
 *
 * An app's agent tool prepares an action (a Messenger draft, a mail reply, a calendar event) and keeps it in the app,
 * pending. The agent puts one marker line in its reply:
 *
 *   [WIZARD_ACTION_V1]{"app":"wizard-messenger","id":"draft-42"}[/WIZARD_ACTION_V1]
 *
 * and the thread shows a small card instead: the app's own preview (title, short body, fields), with Approve, Edit
 * and Open in app (and a quiet Reject). The contract is wizard-os spec/APP_ACTIONS.md (`wizard.app-actions/1`):
 *
 *   GET  <app url>api/actions/<id>  -> { schema, id, title, body?, fields?, state, open?, approve_label?, message? }
 *   POST <app url>api/actions/<id>  (X-Wizard-Action: 1, the box Origin) { decision: approve|reject, fields? } -> same
 *
 * The marker names only the app and the item: what the card shows and what Approve does always come from the app
 * itself, read at the app's own same-origin path (the owner's browser, like the app's own page), never from the
 * agent's words. The path is fixed (`api/actions/<id>` under the installed app's url), so a reply can't aim the POST
 * anywhere else. A message is history: the card shows the item's CURRENT state (read when it paints, at most every
 * 15 s, and again when the page shows), so an item already sent from the app or another device reads as done.
 *
 * The marker is always hidden from the text (core/chat-kit.js actionIds/cleanText), like every chat marker; with the
 * switch off no card is drawn and nothing is read or sent. */
'use strict';
(() => {
  const SWITCH = 'wizard/action-cards', SCHEMA = 'wizard.app-actions/1', FRESH_MS = 15000;
  const KEY = /^([a-z0-9][a-z0-9-]{0,62})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/, FIELD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const DONE = { approved: 'Approved', rejected: 'Rejected', failed: 'Didn’t go through', expired: 'No longer waiting' };
  const on = () => { try { return String(document.documentElement.dataset.tweaks || '').split(/\s+/).includes(SWITCH); } catch (_) { return false; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const cards = new Map(); // key -> { doc, at, read, busy, err, gone, fail, edit, draft }
  const cardOf = key => { let c = cards.get(key); if (!c) cards.set(key, c = { doc: null, at: 0, read: null, busy: '', err: '', gone: false, fail: '', edit: false, draft: {} }); return c; };

  // The installed app (the box's own list), its page on this origin. Anything else: no card reads or sends.
  function appOf(app) {
    let a = null;
    try { for (const r of [window.WizCore?.apps?.('mobile'), window.WizCore?.apps?.('desktop')]) { a = r?.APP?.[app] || (r?.APPS || []).find(x => x.id === app) || null; if (a) break; } } catch (_) {}
    const raw = a && a.kind === 'wizard' ? (a.originalUrl || a.url || '') : '';
    if (!raw) return null;
    try {
      const u = new URL(raw, location.href);
      if (u.origin !== location.origin) return null;
      const base = u.pathname.endsWith('/') ? u.pathname : u.pathname.replace(/[^/]*$/, '');
      return { id: app, name: String(a.name || app), base };
    } catch (_) { return null; }
  }
  const apiOf = (a, id) => a.base + 'api/actions/' + encodeURIComponent(id);

  function norm(d, id) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || String(d.id ?? '') !== id) return null;
    if (d.schema !== undefined && d.schema !== SCHEMA) return null;
    const state = d.state === 'pending' || Object.hasOwn(DONE, d.state) ? d.state : 'pending';
    const fields = (Array.isArray(d.fields) ? d.fields : []).filter(f => f && typeof f === 'object' && FIELD.test(String(f.id || ''))).slice(0, 8).map(f => {
      const value = typeof f.value === 'string' ? f.value.slice(0, 4000) : f.value == null ? '' : String(f.value).slice(0, 4000);
      return { id: String(f.id), label: str(f.label, 60) || String(f.id), value, editable: f.editable === true, multiline: f.multiline === true || value.length > 60 || value.includes('\n') };
    });
    return { id, state, title: str(d.title, 140) || 'Proposed action', kind: str(d.kind, 40), body: str(d.body, 600), fields, open: str(d.open, 600), approve: str(d.approve_label, 30) || 'Approve', message: str(d.message, 240) };
  }

  async function call(a, id, body) {
    const r = await window.fetch(apiOf(a, id), { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Wizard-Action': '1' } : { Accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const d = await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, d };
  }
  function read(key, force) {
    const c = cardOf(key), m = KEY.exec(key), a = m && appOf(m[1]);
    if (!a || c.read || c.busy || c.edit || typeof window.fetch !== 'function') return c.read;
    if (!force && c.at && Date.now() - c.at < FRESH_MS) return null;
    c.at = Date.now();
    c.read = call(a, m[2]).then(r => {
      if (c.busy) return; // a decision's answer is newer
      if (r.status === 404) { c.gone = true; c.fail = ''; return; }
      const doc = r.ok ? norm(r.d, m[2]) : null;
      if (doc) { c.doc = doc; c.gone = false; c.fail = ''; } else c.fail = r.status === 401 || r.status === 403 ? 'signin' : 'down';
    }, () => { c.fail = 'down'; }).finally(() => { c.read = null; c.at = Date.now(); paint(); });
    return c.read;
  }

  function buttons(c, a, d) {
    const busy = !!c.busy, dis = busy ? ' disabled' : '';
    const open = a ? `<button type="button" class="ch-act-btn" data-act="open"${dis}>Open in app</button>` : '';
    if (!d || d.state !== 'pending') return open ? `<div class="ch-act-btns">${open}</div>` : '';
    const editable = d.fields.some(f => f.editable);
    if (c.edit) return `<div class="ch-act-btns"><button type="button" class="ch-act-btn pri" data-act="approve"${dis}>${busy && c.busy === 'approve' ? 'Sending…' : esc(d.approve)}</button><button type="button" class="ch-act-btn" data-act="cancel"${dis}>Cancel</button>${open}</div>`;
    return `<div class="ch-act-btns"><button type="button" class="ch-act-btn pri" data-act="approve"${dis}>${busy && c.busy === 'approve' ? 'Sending…' : esc(d.approve)}</button>`
      + `${editable ? `<button type="button" class="ch-act-btn" data-act="edit"${dis}>Edit</button>` : ''}${open}`
      + `<button type="button" class="ch-act-btn no" data-act="reject"${dis}>${busy && c.busy === 'reject' ? 'Rejecting…' : 'Reject'}</button></div>`;
  }
  function fieldsHtml(c, d) {
    if (!d.fields.length) return '';
    const editing = c.edit && d.state === 'pending';
    return `<div class="ch-act-f">${d.fields.map(f => {
      if (editing && f.editable) {
        const v = Object.hasOwn(c.draft, f.id) ? c.draft[f.id] : f.value;
        return `<label class="ch-act-fr"><span>${esc(f.label)}</span>${f.multiline ? `<textarea data-act-field="${esc(f.id)}" rows="3" maxlength="4000">${esc(v)}</textarea>` : `<input data-act-field="${esc(f.id)}" maxlength="4000" value="${esc(v)}">`}</label>`;
      }
      return `<div class="ch-act-fr"><span>${esc(f.label)}</span><p>${esc(f.value)}</p></div>`;
    }).join('')}</div>`;
  }
  function rows(key) {
    const m = KEY.exec(key); if (!m) return '';
    const c = cardOf(key), a = appOf(m[1]), name = a?.name || m[1];
    const head = sub => `<div class="ch-act-h"><span class="ch-act-app">${esc(name)}${sub ? ` · ${esc(sub)}` : ''}</span></div>`;
    if (!a) return head() + `<p class="ch-act-note">${esc(name)} isn’t installed on this Wizard.</p>`;
    void read(key, false);
    const d = c.doc;
    if (c.gone) return head() + `<p class="ch-act-note">This item is no longer in ${esc(name)}.</p>` + buttons(c, a, null);
    if (!d) return head() + `<p class="ch-act-note">${c.fail === 'signin' ? `Open ${esc(name)} once, then try again.` : c.fail ? `Can’t reach ${esc(name)} right now.` : `Loading from ${esc(name)}…`}</p>` + (c.fail ? buttons(c, a, null) : '');
    const st = d.state === 'pending' ? '' : `<p class="ch-act-st ${d.state === 'approved' ? 'ok' : 'no'}" role="status">${d.state === 'approved' ? '✓ ' : ''}${esc(DONE[d.state])}${d.message ? ` · ${esc(d.message)}` : ''}</p>`;
    return head(d.kind) + `<b class="ch-act-t">${esc(d.title)}</b>${d.body ? `<p class="ch-act-b">${esc(d.body)}</p>` : ''}${fieldsHtml(c, d)}${st}`
      + `${c.err ? `<small class="ch-act-err" role="alert">${esc(c.err)}</small>` : ''}${buttons(c, a, d)}`;
  }
  const keysOf = list => [...new Set((Array.isArray(list) ? list : String(list || '').split(' ')).filter(k => KEY.test(String(k))))].slice(0, 4);
  // The thread's markup for one reply's cards (core/chats-attach.js turnHtml), or '' with the switch off.
  function html(list) {
    if (!on()) return '';
    return keysOf(list).map(key => `<div class="ch-act" data-action-card="${esc(key)}" data-morph-key="act:${esc(key)}" role="group" aria-label="Proposed action">${rows(key)}</div>`).join('');
  }
  function paint() {
    let nodes = []; try { nodes = [...(document.querySelectorAll?.('[data-action-card]') || [])]; } catch (_) {}
    for (const n of nodes) {
      const key = n.dataset.actionCard, next = on() ? rows(key) : '';
      if (n.__wosAct === next) continue;
      const f = n.contains(document.activeElement) ? document.activeElement : null;
      const field = f?.dataset?.actField, act = f?.dataset?.act, sel = field && typeof f.selectionStart === 'number' ? [f.selectionStart, f.selectionEnd] : null;
      n.innerHTML = next; n.__wosAct = next; n.hidden = !next;
      const back = field ? n.querySelector(`[data-act-field="${CSS.escape(field)}"]`) : act ? n.querySelector(`[data-act="${CSS.escape(act)}"]`) : null;
      if (back) { back.focus({ preventScroll: true }); if (sel) try { back.setSelectionRange(sel[0], sel[1]); } catch (_) {} }
    }
  }

  async function decide(key, decision, toast) {
    const c = cardOf(key), m = KEY.exec(key), a = m && appOf(m[1]);
    if (!a || !c.doc || c.doc.state !== 'pending' || c.busy || !on()) return;
    const fields = {};
    if (decision === 'approve' && c.edit) for (const f of c.doc.fields) if (f.editable && Object.hasOwn(c.draft, f.id)) fields[f.id] = String(c.draft[f.id]).slice(0, 4000);
    c.busy = decision; c.err = ''; paint();
    try {
      const r = await call(a, m[2], { decision, ...(Object.keys(fields).length ? { fields } : {}) });
      const doc = norm(r.d, m[2]);
      if (doc) c.doc = doc;
      if (r.ok && doc) { c.edit = false; c.draft = {}; }
      else if (r.status === 404) { c.gone = true; c.edit = false; }
      else if (!doc || doc.state === 'pending') c.err = str(r.d?.message, 200) || str(r.d?.error, 200) || `${a.name} said no (${r.status})`;
      else { c.edit = false; c.draft = {}; }
    } catch (_) { c.err = `Couldn’t reach ${a.name}. Nothing was sent.`; }
    c.busy = ''; c.at = Date.now(); paint();
    if (c.err) toast?.('!', c.err);
  }
  function openIn(key, toast) {
    const m = KEY.exec(key), a = m && appOf(m[1]); if (!a) return;
    const d = cardOf(key).doc;
    let path = '';
    if (d?.open) { try { const u = new URL(d.open, location.origin + a.base); if (u.origin === location.origin && u.pathname.startsWith(a.base)) path = u.pathname + u.search + u.hash; } catch (_) {} }
    const open = window.WizOpenApp;
    if (typeof open === 'function' && ((path && open(a.id, path)) || open(a.id))) return;
    toast?.('!', `Open ${a.name} from Apps`);
  }
  // A tap inside a card (core/chats-bind.js routes [data-act] here). Returns true when it was a card's button.
  function tap(btn, toast) {
    const card = btn?.closest?.('[data-action-card]'), key = card?.dataset.actionCard, act = btn?.dataset?.act;
    if (!card || !KEY.test(String(key)) || !act || btn.disabled) return false;
    const c = cardOf(key);
    if (act === 'open') openIn(key, toast);
    else if (!on()) paint();
    else if (act === 'approve' || act === 'reject') void decide(key, act, toast);
    else if (act === 'edit' && c.doc?.state === 'pending') {
      c.edit = true; c.err = ''; c.draft = Object.fromEntries(c.doc.fields.filter(f => f.editable).map(f => [f.id, f.value])); paint();
      card.querySelector('[data-act-field]')?.focus({ preventScroll: true });
    } else if (act === 'cancel') { c.edit = false; c.draft = {}; c.err = ''; paint(); }
    return true;
  }
  try {
    document.addEventListener('input', e => {
      const f = e.target?.closest?.('[data-action-card] [data-act-field]'); if (!f) return;
      const c = cardOf(f.closest('[data-action-card]').dataset.actionCard); if (c.edit) c.draft[f.dataset.actField] = String(f.value).slice(0, 4000);
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || !on()) return; for (const n of document.querySelectorAll('[data-action-card]')) void read(n.dataset.actionCard, true); });
  } catch (_) {}
  window.WosActionCards = Object.freeze({ SWITCH, SCHEMA, on, html, paint, tap, keys: keysOf, normalize: norm, _cards: cards });
})();
