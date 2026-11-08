/* Thread tracker (tweak wizard/thread-tracker, off by default).
 *
 * The asks inside one thread, kept by the Agent Service from each reply's hidden status line, drawn as
 *   - a strip under the thread title ("7 asks · ●2 ●2 ●3") that opens into one list in the order the replies came in
 *     (oldest first; rows still working last; acknowledged folded at the end), each row keeping its own status dot,
 *   - small dots on every thread row in Chats (counts of needs-you / running / finished-not-seen),
 *   - Reply on any message (a quote above the composer, a header on the sent bubble: see chat-kit reply.quote).
 * The chat itself stays an ordinary linear chat: nothing here moves a message. Tapping a row only scrolls to the
 * reply that covers it (chats.js jumpToMessage) and flashes it.
 *
 * Data: GET /wizard/v1/thread-items?thread=<id>[&agent=<id>] → { items, counts }, POST …/seen { thread, agent, ids },
 * GET …/counts → { threads: { '<agent>/<thread>': counts } }. Seen is stored on the box, so phone and desktop agree.
 * Everything paints from local state first (a tap never waits on the box); the box then confirms.
 *
 *   WosThreadTracker.on() · load(sid, agent) · stripHtml(sid, agent) · dots(sid, agent) · dotsNode(sid, agent) · loadCounts()
 *   · click(e, { sid, agent, jump, resume }) · itemFor(message) · isOpen() · close() · repaint()
 * Stopped rows (marked running, nothing behind them) carry Resume: resume(text) is the host's ordinary owner send,
 * the row spins on the tap's frame and goes back to stopped only if that send was refused.
 */
(() => {
  'use strict';
  const ID = 'wizard/thread-tracker';
  const BASE = '/wizard/v1/thread-items';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const on = () => { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(ID); } catch (_) { return false; } };
  const listWorking = (sid, agent = '') => {
    const session = window.WizLive?.sessionFor?.(sid, agent) || window.WizLive?.session?.(sid);
    return !!window.WizChatsListModel?.isListWorking(session);
  };
  const key = (sid, agent) => `${agent || 'hermes'}/${sid}`;
  const threads = new Map(); // key → { items, at, loading }
  let counts = {}, countsAt = 0, countsLoading = false;
  const openKeys = new Set(), ackKeys = new Set();
  let opened = null; // the key of the one open dropdown (a tap outside closes it)
  const pendingSeen = new Map(); // key → seen writes in flight
  const sendSnapshots = new Map(); // explicit send/steer: exact server versions already loaded in this scope
  // Owner replies answer older amber/red asks: per-thread server versions (id@updated_at) taken at send time. Never
  // sent to the box; the agent's next reply re-lists anything still open, which is a new version and so counts again.
  const ANSWERED_KEY = 'wos:tt-answered';
  const answered = new Map(); // key → { tokens:Set, at, started }
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(ANSWERED_KEY) || '{}'))) answered.set(k, { tokens: new Set(v), at: 0, started: true }); } catch (_) { /* no storage */ }
  const saveAnswered = () => { try { localStorage.setItem(ANSWERED_KEY, JSON.stringify(Object.fromEntries([...answered].filter(([, a]) => a.tokens.size).map(([k, a]) => [k, [...a.tokens].slice(-200)])))); } catch (_) { /* no storage */ } };
  const WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);
  function workingNow(k, a) {
    const s = k.indexOf('/'), sid = k.slice(s + 1), agent = k.slice(0, s) === 'hermes' ? '' : k.slice(0, s);
    const row = window.WizLive?.sessionFor?.(sid, agent) || window.WizLive?.session?.(sid);
    if (row && WORKING.has(row.status)) { a.started = true; return true; }
    return !a.started && Date.now() - a.at < 20000; // the run may not have reported yet
  }
  // Items as the strip shows them: answered amber/red asks spin while the run works, then stay out of every count.
  // Answered comes from the box's own times (James, 7 Nov 2026: a reply from any device, or one sent before this
  // shipped, answers the asks above it): an amber/red ask whose reply is older than the owner's latest message
  // (the session row's lastUserAt) is answered. A newer reply that lists it again is a newer anchor, so it is live
  // again. The local send tokens above stay as the same-frame paint until the list row catches up.
  function project(k, items) {
    const a = answered.get(k), local = a?.tokens.size ? a : null;
    const replied = repliedBefore(k);
    if (!local && !replied) return items;
    let runLocal, runServer;
    return (items || []).map(i => {
      if (!(i.state === 'needs_you' || i.state === 'blocked') || i.seen) return i;
      const byLocal = !!local?.tokens.has(`${i.id}@${i.updated_at}`), byServer = !!replied?.(i);
      if (!byLocal && !byServer) return i;
      const run = byLocal ? (runLocal ??= workingNow(k, local)) : (runServer ??= listWorking(...splitKey(k)));
      return run ? { ...i, state: 'running', answered: true } : { ...i, state: 'needs_you', seen: true, answered: true };
    });
  }
  const splitKey = k => { const s = k.indexOf('/'); return [k.slice(s + 1), k.slice(0, s) === 'hermes' ? '' : k.slice(0, s)]; };
  const msgMs = v => (typeof v === 'number' && Number.isFinite(v) ? (Math.abs(v) < 1e12 ? v * 1000 : v) : Date.parse(String(v ?? '')));
  // → (item → true when the owner wrote after the reply it sits on), or null when the box gave no owner time.
  // The reply's time is the item's own `at` (set from the message); without one, the anchor message's timestamp
  // in the thread's stored copy. Both sides are server times; the device clock is never read.
  // The owner's latest message the thread itself shows: the list row's lastUserAt, or a newer user bubble in the
  // stored copy (the list's time can lag, e.g. voice notes; James, 7 Nov 2026). Memoised per stored copy.
  const userAtOf = new WeakMap();
  // Owner bubbles of parsed turns: the turn's own message and any steer sent while it ran (notes are not the owner).
  function userAtOfTurns(turns) {
    let t = NaN;
    for (const tn of turns || []) for (const u of [tn.u, ...(tn.steers || []).filter(x => !x.note)]) if (u && Number.isFinite(u.at) && !(u.at <= t)) t = u.at;
    return t;
  }
  // The transcript Chats just read, for every agent (routed threads keep no stored copy): chats.js hands its turns.
  const shownUserAt = new Map();
  function shown(sid, agent, turns) { const t = userAtOfTurns(turns); if (Number.isFinite(t)) shownUserAt.set(key(sid, agent || ''), t); }
  function latestUserAt(rows) {
    if (!Array.isArray(rows) || !rows.length || !window.WosChat?.parseRows) return NaN;
    if (!userAtOf.has(rows)) {
      let t = NaN;
      try { t = userAtOfTurns(window.WosChat.parseRows(rows)); } catch (_) {}
      userAtOf.set(rows, t);
    }
    return userAtOf.get(rows);
  }
  function repliedBefore(k) {
    const [sid, agent] = splitKey(k);
    const s = window.WizLive?.sessionFor ? window.WizLive.sessionFor(sid, agent) : agent ? null : window.WizLive?.session?.(sid); // never another agent's row
    let rows;
    const stored = () => (rows ??= window.WizLive?.cachedMessages?.(sid) || window.WizLive?.savedMessages?.(sid)?.rows || []);
    const listed = Date.parse(String(s?.lastUserAt ?? ''));
    const owner = Math.max(...[listed, latestUserAt(stored()), shownUserAt.get(k)].map(v => (Number.isFinite(v) ? v : 0)));
    if (!(owner > 0)) return null;
    const anchorTime = i => {
      const t = Math.max(0, ...(i.members || [i]).map(m => (typeof m.at === 'number' && Number.isFinite(m.at) ? m.at : 0)));
      if (t > 0) return t;
      const id = anchorKey(i.message_id); if (id === null) return null;
      stored();
      const m = Array.isArray(rows) ? rows.find(r => r && String(r.id ?? r.message_id) === id) : null;
      const at = m ? msgMs(m.timestamp ?? m.created_at) : NaN;
      return Number.isFinite(at) && at > 0 ? at : null;
    };
    return i => { const t = anchorTime(i); return t !== null && owner > t; };
  }
  const seenLocally = new Map(); // key → Set(id@updated_at): taps the box has not confirmed yet
  // Resume taps: key → { ids:Set, at, started }. The tapped rows spin from the tap until the thread itself reports
  // work (then the live row owns the spinner) or 30 s pass; a refused send drops the hold at once.
  const RESUME_MS = 30000;
  const resuming = new Map();
  function resumeHeld(k, working) {
    const r = resuming.get(k); if (!r) return null;
    if (working) r.started = true;
    if (r.started || Date.now() - r.at > RESUME_MS) { resuming.delete(k); return null; }
    return r.ids;
  }

  const isSeen = i => i.seen === true;
  // Same read-time projection as Agent Service: a reply is one thing to check, not one row per ask.
  const anchorKey = value => typeof value === 'string' && value.trim() ? value
    : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
  const memberKind = i => (isSeen(i) && (i.state === 'done' || i.state === 'needs_you') ? 'ack' : i.state === 'done' ? 'done' : i.state === 'blocked' ? 'bad' : i.state === 'needs_you' ? 'you' : 'run');
  const urgency = { bad: 0, you: 1, run: 2, done: 3, ack: 4 };
  const groupsOf = items => {
    const groups = [], anchors = new Map();
    for (const i of items) {
      if (!i || typeof i !== 'object' || Array.isArray(i)) continue;
      const anchor = anchorKey(i.message_id);
      let members = anchor === null ? null : anchors.get(anchor);
      if (!members) { members = []; groups.push(members); if (anchor !== null) anchors.set(anchor, members); }
      members.push(i);
    }
    return groups.map(members => {
      const member = [...members].sort((a, b) => urgency[memberKind(a)] - urgency[memberKind(b)])[0];
      return { ...member, members, ids: members.map(i => i.id),
        title: [...new Set(members.map(i => i.title))].join(' · '),
        updated_at: Math.max(...members.map(i => i.updated_at || i.at || 0)),
        kind: members.length > 1 && members.every(isSeen) ? 'ack' : memberKind(member) };
    });
  };
  const tally = items => {
    const out = { needs_you: 0, running: 0, done_unseen: 0, blocked: 0, acknowledged: 0, total: 0 };
    const names = { ack: 'acknowledged', done: 'done_unseen', bad: 'blocked', you: 'needs_you', run: 'running' };
    for (const i of groupsOf(items)) { out.total++; out[names[i.kind]]++; }
    return out;
  };
  // When the reply a row points at arrived in the chat: the anchor message's own time (`at`, set from the message
  // and never moved by seen or state edits), then its message id (chat order). Unknown keeps ledger order.
  const anchorAt = i => {
    const t = Math.max(0, ...(i.members || [i]).map(m => (typeof m.at === 'number' && Number.isFinite(m.at) ? m.at : 0)));
    return t > 0 ? t : null;
  };
  const anchorSeq = i => (/^\d+$/.test(String(i.message_id ?? '')) ? Number(i.message_id) : null);
  const byArrival = list => list.map((i, n) => ({ i, n })).sort((a, b) => {
    const ta = anchorAt(a.i), tb = anchorAt(b.i);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    const sa = anchorSeq(a.i), sb = anchorSeq(b.i);
    if (sa !== null && sb !== null && sa !== sb) return sa - sb;
    return a.n - b.n;
  }).map(x => x.i);
  const ago = ms => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  };
  const req = (path, init) => fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  const agentQ = agent => (agent && agent !== 'hermes' ? `&agent=${encodeURIComponent(agent)}` : '');

  function merge(k, items) {
    const mine = seenLocally.get(k);
    const list = (items || []).map(i => (mine?.has(`${i.id}@${i.updated_at}`) ? { ...i, seen: true } : i));
    for (const i of items || []) if (i.seen) mine?.delete(`${i.id}@${i.updated_at}`); // only server confirmation retires the local pin
    return list;
  }
  async function load(sid, agent = '') {
    if (!on() || !sid || sid === '__new__') return;
    const k = key(sid, agent), cur = threads.get(k);
    if (cur?.loading || (cur && Date.now() - cur.at < 2500)) return;
    threads.set(k, { items: cur?.items || [], at: Date.now(), loading: true });
    try {
      const r = await req(`${BASE}?thread=${encodeURIComponent(sid)}${agentQ(agent)}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const items = merge(k, j.items);
      const changed = JSON.stringify(items) !== JSON.stringify(cur?.items || []);
      threads.set(k, { items, at: Date.now(), loading: false });
      applySendSeen(sid, agent); // a send may beat ledger ingestion or navigation
      const projected = threads.get(k).items;
      if (changed || JSON.stringify(counts[k]) !== JSON.stringify(tally(project(k, projected)))) { counts[k] = tally(project(k, projected)); changedEvent(); }
    } catch (_) { threads.set(k, { items: cur?.items || [], at: Date.now(), loading: false }); }
  }
  async function loadCounts(force = false) {
    if (!on() || countsLoading || (!force && Date.now() - countsAt < 4000)) return;
    countsLoading = true;
    try {
      const r = await req(`${BASE}/counts`);
      if (r.ok) {
        const next = (await r.json())?.threads || {};
        // A thread open in this shell knows its own latest; keep that over a poll that raced a tap.
        // Only a tap the box has not confirmed yet is kept over the poll; otherwise the poll is the newer truth, and a
        // loaded thread whose tally moved is reloaded so its strip follows.
        for (const [k, t] of threads) {
          if (!t.items.length) continue;
          if (pendingSeen.get(k) > 0 && next[k]) next[k] = tally(project(k, t.items));
          else {
            if (JSON.stringify(next[k] || null) !== JSON.stringify(counts[k] || null) && !t.loading) { t.at = 0; const s = k.indexOf('/'); load(k.slice(s + 1), k.slice(0, s) === 'hermes' ? '' : k.slice(0, s)); }
            // Loaded items own the paint, even while an older backend still returns per-ask counts.
            next[k] = tally(project(k, t.items));
          }
        }
        if (JSON.stringify(next) !== JSON.stringify(counts)) { counts = next; changedEvent(); }
        countsAt = Date.now();
        // A rolling backend upgrade can still count asks. Hydrate multi-ask list rows so unopened Chats dots
        // use the same reply projection too; no change to the stored ledger or the wire schema is needed.
        // Amber/red rows hydrate too: only their items say whether the owner has already replied after them.
        for (const [k, c] of Object.entries(next)) if ((c.total > 1 || c.needs_you || c.blocked) && !threads.has(k)) {
          const s = k.indexOf('/'); load(k.slice(s + 1), k.slice(0, s) === 'hermes' ? '' : k.slice(0, s));
        }
      }
    } catch (_) { /* offline: dots stay as they were */ }
    countsLoading = false;
  }
  // Let Chats capture its eye-line before repaint can remove the last addressable strip.
  const changedEvent = detail => { try { window.dispatchEvent(new CustomEvent('wos:thread-tracker', { detail })); } catch (_) { /* no window events */ } repaint(); };

  /* ---------- the strip ---------- */
  const dot = (kind) => `<i class="tt-dot ${kind}" aria-hidden="true"></i>`;
  const kindOf = i => i.kind || memberKind(i);
  const subOf = (i, fallbackAsk = '') => {
    if (kindOf(i) === 'stopped') return 'Stopped · nothing running';
    const when = ago(i.updated_at || i.at || Date.now());
    if (kindOf(i) === 'ack') return i.answered ? `Answered by your reply · ${when}` : `Seen · ${when}`;
    if (i.answered) return 'Answered · working on it';
    if (i.state === 'done') return `Finished · ${when}`;
    if (i.state === 'blocked') return `Stuck · ${when}`;
    if (i.state === 'needs_you') return i.ask || i.summary || fallbackAsk || i.title;
    return `Working · since ${ago(i.created_at || i.at || Date.now()).replace(' ago', '')}`;
  };
  function rowHtml(i, fallbackAsk = '') {
    const kind = kindOf(i);
    const act = kind === 'stopped' ? '<button type="button" class="tt-btn resume" data-tt-resume aria-label="Resume: ask the agent to continue this">Resume</button>'
      : kind === 'ack' || kind === 'run' ? '' : i.state === 'done' ? '<button type="button" class="tt-btn ok" data-tt-seen aria-label="Mark seen">✓ Seen</button>'
      : i.state === 'needs_you' ? '<button type="button" class="tt-btn go" data-tt-open>Open</button><button type="button" class="tt-btn" data-tt-dismiss aria-label="Dismiss: read it, nothing to do">Dismiss</button>'
      : '<button type="button" class="tt-btn go" data-tt-open>Open</button>';
    return `<div class="tt-row ${kind}" role="button" tabindex="0" data-tt-row="${esc(i.id)}" aria-label="${esc(i.title)}: go to the reply">${dot(kind)}<span class="tt-ti"><span class="tt-t">${esc(i.title)}</span><span class="tt-s">${esc((i.members?.length > 1 ? `${i.members.length} asks in one reply · ` : '') + subOf(i, fallbackAsk))}</span></span>${act}</div>`;
  }
  function innerHtml(sid, agent) {
    const k = key(sid, agent), raw = project(k, threads.get(k)?.items || []), working = listWorking(sid, agent);
    const held = resumeHeld(k, working);
    const items = groupsOf(raw).map(i => i.kind === 'run' && !working && !held?.has(i.id) ? { ...i, kind: 'stopped' } : i);
    if (!items.length) return '';
    const c = tally(raw), open = openKeys.has(k), fold = ackKeys.has(k);
    // Keep work in progress visible; only acknowledged history has no strip.
    // Use the same reply grouping as its rows and Chats dots.
    if (!(c.needs_you || c.blocked || c.done_unseen || c.running)) return '';
    const live = items.filter(i => kindOf(i) !== 'ack');
    const ack = items.filter(i => kindOf(i) === 'ack');
    // Header = rows listed = sum of the visible tally: answered asks still working on it count as open.
    const openN = live.length;
    // One list in the order the replies came in, oldest first, so the first tap goes to the oldest open reply and
    // the rest follow down the chat. Status never reorders it; only rows genuinely still working wait at the bottom.
    const run = byArrival(live.filter(i => kindOf(i) === 'run'));
    const stopped = live.filter(i => kindOf(i) === 'stopped');
    const rows = [...byArrival(live.filter(i => kindOf(i) !== 'run')), ...run];
    const session = window.WizLive?.sessionFor?.(sid, agent || '') || window.WizLive?.session?.(sid);
    const fallbackAsk = session?.attention?.ask || '';
    const tl = (n, kind) => n ? `<span class="tt-tally" title="${n} ${kind === 'stopped' ? 'stopped' : kind === 'run' ? 'running' : kind}" aria-label="${n} ${kind === 'stopped' ? 'stopped' : kind === 'run' ? 'running' : kind}">${dot(kind)}${n}</span>` : '';
    const head = `<button type="button" class="tt-h" data-tt-toggle aria-expanded="${open}" aria-label="Open items in this thread"><span class="tt-tot">${openN ? `${openN} open` : 'Working on your reply'}</span>${tl(c.needs_you, 'you')}${tl(c.blocked, 'bad')}${tl(c.running - stopped.length, 'run')}${tl(stopped.length, 'stopped')}${tl(c.done_unseen, 'done')}<span class="tt-caret" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></button>`;
    // One Resume for every stopped row sits beside the header (never inside its toggle button).
    const headRow = stopped.length ? `<div class="tt-hrow">${head}<button type="button" class="tt-btn resume" data-tt-resume-all aria-label="Resume ${stopped.length} stopped">Resume</button></div>` : head;
    const body = `<div class="tt-panel" ${open ? '' : 'hidden'}>${rows.length ? `<div class="tt-g tt-list">${rows.map(i => rowHtml(i, fallbackAsk)).join('')}</div>` : ''}`
      + (ack.length ? `<div class="tt-g tt-ackg"><button type="button" class="tt-more" data-tt-ack aria-expanded="${fold}">${ack.length} acknowledged · ${fold ? 'hide' : 'show'}</button>${fold ? byArrival(ack).map(i => rowHtml(i)).join('') : ''}</div>` : '')
      + (!live.length && !ack.length ? '<div class="tt-none">Nothing here yet</div>' : '') + '</div>';
    return headRow + body;
  }
  function stripHtml(sid, agent = '') {
    if (!on() || !sid || sid === '__new__') return '';
    const inner = innerHtml(sid, agent);
    if (!inner) return '';
    const k = key(sid, agent);
    return `<div class="tt-strip${openKeys.has(k) ? ' open' : ''}" data-part="thread-tracker" data-tt-strip="${esc(sid)}" data-tt-agent="${esc(agent || '')}">${inner}</div>`;
  }
  function dots(sid, agent = '') {
    if (!on()) return '';
    const k = key(sid, agent), loaded = threads.get(k);
    const c = loaded?.items.length ? tally(project(k, loaded.items)) : counts[k];
    if (!c) return '';
    const lw = listWorking(sid, agent), spin = lw || !!resumeHeld(k, lw);
    const n = (v, kind, label) => v ? `<span class="tt-d" title="${v} ${label}" aria-label="${v} ${label}">${dot(kind)}${v > 1 ? `<b>${v}</b>` : ''}</span>` : '';
    const html = n(c.needs_you, 'you', 'need you') + n(c.blocked, 'bad', 'stuck') + n(c.running, spin ? 'run' : 'stopped', spin ? 'running' : 'stopped') + n(c.done_unseen, 'done', 'finished, not seen');
    return html ? `<span class="tt-dots" data-tt-dots="${esc(key(sid, agent))}">${html}</span>` : '';
  }
  // The same dots as a node, for a list that builds its rows with the DOM (the AI apps sidebar).
  function dotsNode(sid, agent = '') {
    const html = dots(sid, agent); if (!html || typeof document === 'undefined') return null;
    const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild;
  }
  // Repaint what is on screen from local state (a tap and a poll both end here). Only the strip's inside and the
  // dots are replaced, so the thread, its scroll and the composer are never touched.
  function repaint() {
    if (typeof document === 'undefined') return;
    for (const k of openKeys) {
      const c = tally(project(k, threads.get(k)?.items || []));
      if (!(c.needs_you || c.blocked || c.done_unseen || c.running)) { openKeys.delete(k); if (opened === k) opened = null; }
    }
    for (const el of document.querySelectorAll('[data-tt-strip]')) {
      const sid = el.dataset.ttStrip, agent = el.dataset.ttAgent || '', k = key(sid, agent), html = innerHtml(sid, agent);
      if (!html) { el.remove(); continue; }
      el.classList.toggle('open', openKeys.has(k));
      if (el.dataset.ttSig !== html) { el.innerHTML = html; el.dataset.ttSig = html; }
    }
    for (const el of document.querySelectorAll('[data-tt-dots]')) {
      const k = el.dataset.ttDots, slash = k.indexOf('/'), html = dots(k.slice(slash + 1), k.slice(0, slash) === 'hermes' ? '' : k.slice(0, slash));
      if (!html) el.remove();
      else if (el.outerHTML !== html) el.outerHTML = html;
    }
    for (const [nb, v] of views) if (nb.isConnected) watch(nb, v);
  }

  /* A green reply is seen only in the front, visible thread, never in its dropdown.
   * IO admits candidate anchors; geometry/hit testing and a continuous dwell guard occlusion,
   * document scrolling, desk switches and focus changes that do not themselves emit IO entries. */
  const views = new Map();
  function viewportTop(nb, base) {
    if (!on()) return base;
    const strip = nb?.closest('.ch-thread')?.querySelector('[data-tt-strip]');
    return strip?.getClientRects().length ? Math.max(base, strip.getBoundingClientRect().bottom + 8) : base;
  }
  function watch(nb, { sid, agent = '', active } = {}) {
    if (!nb || typeof IntersectionObserver !== 'function') return;
    let v = views.get(nb);
    if (!v || v.sid !== sid || v.agent !== agent) {
      v?.io.disconnect();
      v = { nb, sid, agent, active, nodes: new Map() };
      v.io = new IntersectionObserver(entries => { for (const e of entries) { const n = v.nodes.get(e.target); if (n) { n.intersects = e.isIntersecting; if (!e.isIntersecting) n.since = 0; } } }, { threshold: [0, .4, 1] });
      views.set(nb, v);
    }
    v.active = active;
    const groups = groupsOf(threads.get(key(sid, agent))?.items || []).filter(g => g.kind === 'done' && g.members.every(i => i.state === 'done'));
    const wanted = new Set();
    const nodes = [...nb.querySelectorAll('.msg.a[data-mid], .msg.a[data-mat]')];
    for (const node of nodes) {
      const g = groups.find(g => anchorKey(g.message_id) ? anchorKey(g.message_id) === node.dataset.mid
        : g.at > 0 && Math.abs((+node.dataset.mat || 0) - g.at) < 1500
          && nodes.filter(n => Math.abs((+n.dataset.mat || 0) - g.at) < 1500).length === 1);
      if (!g) continue;
      wanted.add(node);
      const sig = JSON.stringify(g.members.map(i => [i.id, i.updated_at, i.seen]));
      if (v.nodes.get(node)?.sig !== sig) { v.nodes.set(node, { sig, group: g, since: 0, intersects: false }); v.io.unobserve(node); v.io.observe(node); }
    }
    for (const node of v.nodes.keys()) if (!wanted.has(node)) { v.io.unobserve(node); v.nodes.delete(node); }
  }
  function checkViews() {
    for (const [nb, v] of views) {
      if (!nb.isConnected || !on()) { v.io.disconnect(); views.delete(nb); continue; }
      // Streamed/final bubbles may acquire their anchor after the last render or ledger read.
      watch(nb, v);
      // Phone WebViews can report no document focus while the front thread is being read.
      const nativePhone = document.documentElement.dataset.shell === 'phone' && (window.WizardNative || window.WizardOSNative || /; wv\)|WizardNative|WizardOS-DocScroll/.test(globalThis.navigator?.userAgent || ''));
      const front = document.visibilityState === 'visible' && (nativePhone || document.hasFocus()) && v.active?.();
      const strip = nb.closest('.ch-thread')?.querySelector('[data-tt-strip]');
      const box = nb.getBoundingClientRect(), rstrip = strip?.getBoundingClientRect();
      const top = viewportTop(nb, Math.max(0, box.top)), bottom = Math.min(innerHeight, box.bottom);
      for (const [node, n] of v.nodes) {
        const r = node.getBoundingClientRect(), h = Math.min(r.bottom, bottom) - Math.max(r.top, top);
        const x = Math.max(box.left, r.left) + Math.min(box.width, r.width) / 2;
        const y = Math.max(r.top, top) + Math.min(20, h / 2);
        const hit = h > 0 && document.elementFromPoint(x, y);
        const visible = front && !strip?.classList.contains('open') && n.intersects && node.isConnected
          && bottom > top && h >= Math.min(40, r.height)
          && (r.height > bottom - top || r.top >= top && r.top < bottom - 20 || h >= .4 * Math.min(r.height, bottom - top))
          && node.contains(hit) && (!rstrip || y > rstrip.bottom);
        if (!visible) { n.since = 0; n.attempted = false; continue; }
        if (!n.since) n.since = Date.now();
        if (!n.attempted && Date.now() - n.since >= 1000) {
          n.attempted = true;
          const current = groupsOf(threads.get(key(v.sid, v.agent))?.items || []).find(g => g.id === n.group.id);
          if (current?.kind === 'done' && current.members.every(i => i.state === 'done')) markSeen(v.sid, v.agent, current.ids);
        }
      }
    }
  }
  const resetDwell = () => { for (const v of views.values()) for (const n of v.nodes.values()) n.since = 0; };
  document.addEventListener('visibilitychange', resetDwell);
  window.addEventListener('blur', resetDwell);
  setInterval(checkViews, 200);

  /* ---------- taps ---------- */
  const anchorOf = i => ({ message_id: i.message_id || null, at: i.at || 0 });
  function markSeen(sid, agent, ids, defer = false, versions = null, dismiss = false) {
    const k = key(sid, agent), t = threads.get(k);
    if (!t) return;
    const expected = new Map(t.items.filter(i => ids.includes(i.id)).map(i => [i.id, { id: i.id, updated_at: i.updated_at }]));
    const restore = new Map(t.items.filter(i => ids.includes(i.id) && !i.seen).map(i => [`${i.id}@${i.updated_at}`, i]));
    const mine = seenLocally.get(k) || new Set(); seenLocally.set(k, mine);
    t.items = t.items.map(i => { if (ids.includes(i.id) && !i.seen) { mine.add(`${i.id}@${i.updated_at}`); return { ...i, seen: true }; } return i; });
    counts[k] = tally(project(k, t.items));
    let readyConfirmed;
    const c = counts[k], L = window.WizLive;
    if (dismiss && !c.needs_you && !c.blocked && !c.running && !c.done_unseen && L?.archive
      && (L.agentOf?.(sid) || 'hermes') === (agent || 'hermes')) {
      // Reuse Ready's Done operation, including its rollback. Never archive a
      // thread which still has other unread work, or persist before Seen confirms.
      const confirmed = new Promise(resolve => { readyConfirmed = resolve; });
      L.archive(sid, { confirmed });
    }
    changedEvent(); // painted before the box hears about it
    pendingSeen.set(k, (pendingSeen.get(k) || 0) + 1);
    let phase = 'staged';
    const settle = () => { if (phase === 'settled') return; phase = 'settled'; pendingSeen.set(k, Math.max(0, (pendingSeen.get(k) || 1) - 1)); };
    // A write the box did not take is rolled back at once and the thread re-read, so this device never hides what the others still show.
    const undo = () => {
      readyConfirmed?.(false);
      settle(); const set = seenLocally.get(k); for (const tok of restore.keys()) set?.delete(tok);
      const cur = threads.get(k);
      if (cur) { cur.items = cur.items.map(i => restore.get(`${i.id}@${i.updated_at}`) || i); cur.at = 0; counts[k] = tally(project(k, cur.items)); changedEvent(); }
      load(sid, agent);
    };
    const commit = () => {
      if (phase !== 'staged') return; phase = 'committed';
      // Custody may take seconds. Never send a blanket id acknowledgement if the
      // loaded server version or one of its reply-group members changed meanwhile.
      let posting = ids;
      if (versions) {
        const cur = threads.get(k), allowed = new Set(groupsOf(cur?.items || [])
          .filter(g => g.members.every(i => i.state === 'done' && versions.has(`${i.id}@${i.updated_at}`))).flatMap(g => g.ids));
        posting = ids.filter(id => allowed.has(id));
        for (const [tok, i] of restore) if (!allowed.has(i.id)) mine.delete(tok);
        if (cur) { cur.items = cur.items.map(i => !allowed.has(i.id) ? restore.get(`${i.id}@${i.updated_at}`) || i : i); counts[k] = tally(project(k, cur.items)); changedEvent(); }
        if (!posting.length) { settle(); return; }
      }
    // ids keeps old boxes compatible; new boxes prefer exact versions from the
    // action's snapshot, not whichever version happens to be loaded at save time.
    req(`${BASE}/seen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread: sid, agent: agent || 'hermes', ids: posting, items: posting.map(id => expected.get(id)) }) })
      .then(r => (r.ok ? r.json() : null)).then(j => {
        if (!j?.items) { undo(); return; }
        for (const result of j.results || []) if (result.status === 'stale') {
          const i = expected.get(result.id); if (i) mine.delete(`${i.id}@${i.updated_at}`);
        }
        readyConfirmed?.(!j.results?.some(r => r.status === 'stale') && j.items.every(i => i.seen === true));
        settle(); threads.set(k, { items: merge(k, j.items), at: Date.now(), loading: false }); counts[k] = tally(project(k, threads.get(k).items)); changedEvent();
      })
      .catch(undo);
    };
    if (!defer) commit();
    return { commit, cancel() { if (phase === 'staged') undo(); } };
  }
  // Sending is explicit evidence that the owner has moved on from older finished replies.
  // Pin server versions, never compare the phone clock with server timestamps.
  // A late reload can only acknowledge versions known all-done at the send tap.
  function applySendSeen(sid, agent, defer = false) {
    const k = key(sid, agent), send = sendSnapshots.get(k); if (!on() || !send || (!send.committed && !defer)) return;
    const ids = [];
    for (const g of groupsOf(threads.get(k)?.items || [])) {
      if (g.kind !== 'done' || !g.members.every(i => i.state === 'done' && send.versions.has(`${i.id}@${i.updated_at}`))) continue;
      const tokens = g.members.map(i => `${i.id}@${i.updated_at}`);
      if (tokens.some(t => send.attempted.has(t))) continue;
      tokens.forEach(t => send.attempted.add(t)); ids.push(...g.ids);
    }
    if (ids.length) return markSeen(sid, agent, ids, defer, send.versions);
  }
  function beforeSend(sid, agent = '', at = Date.now(), { defer = false } = {}) {
    if (!on() || !sid || sid === '__new__' || !Number.isFinite(at)) return;
    const k = key(sid, agent), prior = sendSnapshots.get(k);
    const versions = new Set(groupsOf(threads.get(k)?.items || [])
      .filter(g => g.kind === 'done' && g.members.every(i => i.state === 'done' && Number.isFinite(i.updated_at)))
      .flatMap(g => g.members.map(i => `${i.id}@${i.updated_at}`)));
    const send = { versions, attempted: new Set(), committed: !defer };
    // The owner has now answered every amber/red ask loaded at this tap (exact server versions, no clock).
    let a = answered.get(k); if (!a) { a = { tokens: new Set(), at: 0, started: false }; answered.set(k, a); }
    a.at = Date.now(); a.started = false;
    const added = (threads.get(k)?.items || []).filter(i => (i.state === 'needs_you' || i.state === 'blocked') && !i.seen && Number.isFinite(i.updated_at))
      .map(i => `${i.id}@${i.updated_at}`).filter(t => !a.tokens.has(t));
    added.forEach(t => a.tokens.add(t)); if (added.length) { saveAnswered(); changedEvent(); }
    sendSnapshots.set(k, send);
    const staged = applySendSeen(sid, agent, defer); // same-frame paint before navigation
    const commit = () => {
      send.committed = true; staged?.commit();
      const t = threads.get(k); if (t && !t.loading) t.at = 0;
      load(sid, agent); // late ingestion cannot expand the send's pinned server versions
    };
    if (!defer) commit();
    return { commit, cancel() {
      if (send.committed) return;
      if (added.length) { for (const t of added) a.tokens.delete(t); saveAnswered(); changedEvent(); }
      if (sendSnapshots.get(k) === send) { if (prior) sendSnapshots.set(k, prior); else sendSnapshots.delete(k); }
      staged?.cancel();
    } };
  }
  function close() { if (!opened) return false; openKeys.delete(opened); opened = null; repaint(); return true; }
  // Returns true when the tap belonged to the tracker.
  // Stopped rows as the strip shows them right now (the same projection as innerHtml).
  function stoppedOf(sid, agent) {
    const k = key(sid, agent), working = listWorking(sid, agent), held = resumeHeld(k, working);
    if (working) return [];
    return groupsOf(project(k, threads.get(k)?.items || [])).filter(i => i.kind === 'run' && !held?.has(i.id));
  }
  // Paint first: the rows spin on this frame; the host's ordinary send follows. A refused send puts them back
  // (the host's send path shows its own error).
  function resumeRows(sid, agent, rows, resume) {
    if (!rows.length || typeof resume !== 'function') return null;
    const k = key(sid, agent), prev = resuming.get(k);
    const hold = { ids: new Set([...(prev && !prev.started ? prev.ids : []), ...rows.map(i => i.id)]), at: Date.now(), started: false };
    resuming.set(k, hold); changedEvent();
    setTimeout(() => { if (resuming.get(k) === hold) repaint(); }, RESUME_MS + 50);
    const text = `Continue the stopped items: ${rows.map(i => i.title).join('; ')}`;
    const undo = () => { if (resuming.get(k) === hold) { resuming.delete(k); changedEvent(); } };
    let sent;
    try { sent = resume(text); } catch (_) { undo(); return null; }
    Promise.resolve(sent).then(it => { if (!it) undo(); }, undo);
    return text;
  }
  function click(e, { sid, agent = '', jump, resume } = {}) {
    const t = e.target;
    const strip = t.closest?.('[data-tt-strip]');
    if (!strip) { if (opened && !t.closest?.('[data-tt-strip]')) close(); return false; }
    const s = strip.dataset.ttStrip, a = strip.dataset.ttAgent || '', k = key(s, a);
    if (t.closest('[data-tt-toggle]')) {
      if (openKeys.has(k)) { openKeys.delete(k); opened = null; } else { openKeys.add(k); opened = k; }
      repaint(); return true;
    }
    if (t.closest('[data-tt-ack]')) { ackKeys.has(k) ? ackKeys.delete(k) : ackKeys.add(k); repaint(); return true; }
    if (t.closest('[data-tt-resume-all]')) { resumeRows(s, a, stoppedOf(s, a), resume); return true; }
    const row = t.closest('[data-tt-row]');
    if (!row) return true;
    const item = groupsOf(project(k, threads.get(k)?.items || [])).find(i => i.id === row.dataset.ttRow);
    if (!item) return true;
    if (t.closest('[data-tt-resume]')) { resumeRows(s, a, stoppedOf(s, a).filter(i => i.id === item.id), resume); return true; }
    if (t.closest('[data-tt-dismiss]') && item.kind === 'you') { markSeen(s, a, item.ids, false, null, true); return true; }
    if (t.closest('[data-tt-seen]')) { markSeen(s, a, item.ids); return true; }
    // Opening is not seeing: close the list and jump; the visible dwell acknowledges green replies.
    openKeys.delete(k); opened = null; repaint();
    if (typeof jump === 'function') jump(anchorOf(item), item);
    return true;
  }
  const itemFor = (sid, agent, m) => {
    const list = threads.get(key(sid, agent))?.items || [];
    const hit = list.filter(i => m.message_id && anchorKey(i.message_id) !== null
      ? String(i.message_id) === String(m.message_id) : m.at && i.at && Math.abs(i.at - m.at) < 1500);
    return hit.sort((x, y) => urgency[memberKind(x)] - urgency[memberKind(y)])[0] || null;
  };
  // A brief highlight on the message that was jumped to.
  function flash(node) {
    if (!node) return;
    node.classList.remove('tt-flash'); void node.offsetWidth; node.classList.add('tt-flash');
    setTimeout(() => node.classList.remove('tt-flash'), 1800);
  }
  window.WosThreadTracker = Object.freeze({ ID, on, load, shown, loadCounts, stripHtml, dots, dotsNode, repaint, click, close, isOpen: () => !!opened, itemFor, flash, watch, viewportTop, beforeSend, key, _tally: tally });
  // The host's mounted state is authoritative: a choice can arrive before its package, and Look sync sends no choice.
  // Reuse the session list's lifecycle notifications; never add a liveness poll.
  window.WizLive?.onChange?.(repaint);
  let wasOn = on();
  function syncEnabled() {
    const enabled = on(); if (enabled === wasOn) return;
    wasOn = enabled;
    if (enabled) { countsAt = 0; loadCounts(true); }
    else { openKeys.clear(); opened = null; sendSnapshots.clear(); }
    changedEvent({ enabled }); // Chats hydrates every currently open thread and refreshes Reply on both edges.
  }
  window.addEventListener('wos:tweak-choice', e => { if (e?.detail?.id === ID) syncEnabled(); });
  // A tap anywhere outside the open list closes it on the same frame (the tap itself still goes through).
  document.addEventListener('pointerdown', e => { if (opened && !e.target.closest?.('[data-tt-strip]')) close(); }, true);
  // The host writes data-tweaks once the package is mounted (a toggle, a sync from the other device, a reload).
  try { new MutationObserver(syncEnabled).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] }); } catch (_) { /* no observer: the toggle event above still repaints */ }
  setInterval(() => { if (on() && !document.hidden) loadCounts(); }, 15000);
})();
