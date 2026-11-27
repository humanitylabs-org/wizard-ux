/* Wizard UX core: inline action cards in chat (wizard-ux issue 1463, on for everyone; switch wizard/action-cards removed).
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
 * The marker is always hidden from the text (core/chat-kit.js actionIds/cleanText), like every chat marker. Look:
 * core/action-cards.css. */
'use strict';
(() => {
  const SCHEMA = 'wizard.app-actions/1', FRESH_MS = 15000;
  const KEY = /^([a-z0-9][a-z0-9-]{0,62})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/, FIELD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const DONE = { approved: 'Approved', rejected: 'Rejected', failed: 'Didn’t go through', expired: 'No longer waiting' };
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
  // The thread's markup for one reply's cards (core/chats-attach.js turnHtml).
  function html(list) {
    return keysOf(list).map(key => `<div class="ch-act" data-action-card="${esc(key)}" data-morph-key="act:${esc(key)}" role="group" aria-label="Proposed action">${rows(key)}</div>`).join('');
  }
  function paint() {
    let nodes = []; try { nodes = [...(document.querySelectorAll?.('[data-action-card]') || [])]; } catch (_) {}
    for (const n of nodes) {
      const key = n.dataset.actionCard, next = rows(key);
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
    if (!a || !c.doc || c.doc.state !== 'pending' || c.busy) return;
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
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') return; for (const n of document.querySelectorAll('[data-action-card]')) void read(n.dataset.actionCard, true); });
  } catch (_) {}
  /* ---- Tap-to-answer buttons inside a reply (wizard-ux issue 1889, off-by-default switch wizard/reply-buttons) ----
   * The agent writes [WIZARD_BUTTONS_V1]{"group","buttons":[{"id","label"}]} lines (core/chat-kit.js buttonGroups);
   * the reply draws each group's buttons where its line sits. A tap marks the button picked on the tap frame (the
   * group's others dim) and joins this thread's batch; RB_BATCH_MS after the last tap the batch goes as ONE ordinary
   * owner message through the thread's own send path (the outbox: retries, routed agents, steering a running reply),
   * readable "Tapped Done · Workout" lines plus [WIZARD_TAPS_V1]{"taps":[{thread,message,group,button,label}]}. The
   * thread draws that message as a machine line (core/chats-attach.js). What is picked is read back from the thread's
   * own history (so a reload and every other device see it) plus this device's taps not landed yet; a group can be
   * changed until the agent has replied after its tap. */
  const RB_SWITCH = 'wizard/reply-buttons', RB_BATCH_MS = 3000, RB_MAX_WAIT_MS = 10000, RB_LOCAL_MS = 10 * 60e3;
  const rbOn = () => { try { return String(document.documentElement.dataset.tweaks || '').split(/\s+/).includes(RB_SWITCH); } catch (_) { return false; } };
  const rbLocal = new Map(); // `${thread}\n${message}\n${group}` -> { button, label, at } (tapped here, not in the history yet)
  const rbBatch = new Map(); // thread -> { taps: [], t, first, send }
  const rbKey = (sid, msg, group) => `${sid}\n${msg}\n${group}`;
  const KIT = () => window.WosChat || null;
  const tapsOfText = s => KIT()?.tapsOf ? KIT().tapsOf(s).taps : [];
  // Thread `sid`'s picks: `${message}\n${group}` -> { button, label, at, locked }. A tap in a turn the agent has answered
  // since is locked; a later tap of the same group wins; this device's newer taps (not landed yet) win over history.
  function rbPicks(turns, sid) {
    const out = new Map();
    for (const tn of Array.isArray(turns) ? turns : []) {
      const own = tn?.u ? (tn.u.taps || tapsOfText(tn.u.text)) : [];
      for (const t of own) out.set(`${t.message}\n${t.group}`, { button: t.button, label: t.label, at: tn.u.at, locked: !!tn.a });
      for (const st of tn?.steers || []) for (const t of st.taps || tapsOfText(st.text)) out.set(`${t.message}\n${t.group}`, { button: t.button, label: t.label, at: st.at, locked: !!(tn.a && isFinite(tn.a.at) && tn.a.at > st.at) });
    }
    const now = Date.now();
    for (const [k, v] of rbLocal) {
      const [s, msg, group] = k.split('\n'); if (s !== String(sid)) continue;
      const h = out.get(`${msg}\n${group}`), waiting = rbBatch.get(s)?.taps.some(t => t.message === msg && t.group === group);
      if (!waiting && (now - v.at > RB_LOCAL_MS || h?.button === v.button)) { rbLocal.delete(k); continue; } // landed (or stale): history says it
      out.set(`${msg}\n${group}`, { button: v.button, label: v.label, at: v.at, locked: false, local: true });
    }
    return out;
  }
  // A group drawn once for several copies (chat-kit `also`, issue 1942): the newest pick on any of its messages.
  function rbPick(g, picks) {
    let p = null;
    for (const msg of [g.msg, ...(Array.isArray(g.also) ? g.also : [])]) { const q = picks?.get(`${msg}\n${g.group}`); if (q && (!p || Number(q.at) > Number(p.at))) p = q; }
    return p;
  }
  function rbGroupHtml(g, picks) {
    const p = rbPick(g, picks), locked = !!p?.locked;
    return `<div class="ch-rb${p ? ' picked' : ''}${locked ? ' locked' : ''}" role="group" aria-label="${esc(g.group)}" data-rb-group="${esc(g.group)}" data-rb-msg="${esc(g.msg)}" data-morph-key="rb:${esc(g.msg)}:${esc(g.group)}">`
      + `<span class="ch-rb-ask" aria-hidden="true">${esc(g.group)}</span>` // the ask this row answers, on screen (issue 1963)
      + g.buttons.map(b => { const on = p?.button === b.id; return `<button type="button" class="ch-rb-btn${on ? ' on' : p ? ' dim' : ''}" data-rb="${esc(b.id)}" aria-pressed="${on}"${locked ? ' disabled' : ''}>${on ? '✓ ' : ''}${esc(b.label)}</button>`; }).join('')
      + '</div>';
  }
  // A reply's body with its buttons in place: `btext` (chat-kit buttonsText) is cut at each group's token line, every
  // piece goes through the thread's own markdown (`mdOf`, the same media hook), groups not placed follow the text.
  function rbHtml(btext, groups, mdOf, picks) {
    const tok = KIT()?.RB_TOKEN, placed = new Set(); let h = '', buf = [];
    const flush = () => { const s = buf.join('\n').trim(); if (s) h += mdOf(s); buf = []; };
    for (const line of String(btext || '').split('\n')) {
      const m = tok && tok.exec(line.trim()), g = m ? groups[Number(m[1])] : null;
      if (!g || g.placed === false) { if (!m) buf.push(line); continue; }
      flush(); h += rbGroupHtml(g, picks); placed.add(g);
    }
    flush();
    for (const g of groups) if (!placed.has(g)) h += rbGroupHtml(g, picks);
    return h;
  }
  // The thread's tap message: one quiet line per tap (core/chats-attach.js turnHtml and the outbox's pending copy).
  const rbLinesHtml = taps => taps.map(t => `<span class="ch-rb-tap">${esc(KIT()?.tapLine ? KIT().tapLine(t) : `Tapped ${t.label} · ${t.group}`)}</span>`).join('');
  function rbMessage(taps) {
    const lines = taps.map(t => (KIT()?.tapLine ? KIT().tapLine(t) : `Tapped ${t.label} · ${t.group}`)).join('\n');
    return `${lines}\n[WIZARD_TAPS_V1]${JSON.stringify({ taps: taps.map(({ thread, message, group, button, label }) => ({ thread, message, group, button, label })) })}[/WIZARD_TAPS_V1]`;
  }
  async function rbFlush(sid) {
    const b = rbBatch.get(sid); if (!b) return; clearTimeout(b.t); rbBatch.delete(sid);
    if (!b.taps.length) return;
    let ok = false;
    try { ok = !!(await b.send(rbMessage(b.taps))); } catch (_) { ok = false; }
    if (!ok) { // nothing was saved: the buttons show what the agent really has
      for (const t of b.taps) { const k = rbKey(sid, t.message, t.group); if (rbLocal.get(k)?.at === t.at) rbLocal.delete(k); }
      b.toast?.('!', 'Couldn’t send that tap · try again');
    }
    b.repaint?.();
  }
  // A tap on a reply button (core/chats-bind.js). ctx: { sid, send(text) -> promise of the outbox item (null = not
  // saved), repaint(), toast }. Returns true when it was a reply button.
  function rbTap(btn, ctx = {}) {
    const box = btn?.closest?.('.ch-rb'), id = btn?.dataset?.rb, sid = String(ctx.sid || '');
    if (!box || !id || !sid || sid === '__new__') return false;
    if (btn.disabled || !rbOn() || typeof ctx.send !== 'function') { ctx.repaint?.(); return true; }
    const msg = box.dataset.rbMsg, group = box.dataset.rbGroup, label = String(btn.textContent || '').replace(/^✓\s*/, '').trim();
    if (!msg || !group || !label) return true;
    const k = rbKey(sid, msg, group), cur = rbLocal.get(k);
    if (cur?.button === id || (btn.getAttribute?.('aria-pressed') === 'true' && !cur)) return true; // already the pick
    const at = Date.now(), tap = { thread: sid, message: msg, group, button: id, label, at };
    rbLocal.set(k, { button: id, label, at });
    let b = rbBatch.get(sid);
    if (!b) rbBatch.set(sid, b = { taps: [], t: 0, first: at });
    b.taps = [...b.taps.filter(t => !(t.message === msg && t.group === group)), tap];
    b.send = ctx.send; b.repaint = ctx.repaint; b.toast = ctx.toast;
    clearTimeout(b.t);
    b.t = setTimeout(() => void rbFlush(sid), Math.max(0, Math.min(RB_BATCH_MS, b.first + RB_MAX_WAIT_MS - at)));
    ctx.repaint?.();
    return true;
  }
  // Leaving the page sends what is waiting at once (the outbox keeps it if the network is gone).
  try { window.addEventListener('pagehide', () => { for (const sid of [...rbBatch.keys()]) void rbFlush(sid); }); } catch (_) {}
  window.WosActionCards = Object.freeze({ SCHEMA, html, paint, tap, keys: keysOf, normalize: norm, _cards: cards,
    REPLY_SWITCH: RB_SWITCH, replyOn: rbOn, replyHtml: rbHtml, replyPicks: rbPicks, replyTap: rbTap, replyFlush: rbFlush, replyMessage: rbMessage, tapLinesHtml: rbLinesHtml });
})();
