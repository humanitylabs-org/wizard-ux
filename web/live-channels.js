/* Wizard UX live data › the channel store, channel reads, channel daily and the agent inbox
 * stores (wizard-ux issues 1261, 1469, 1569; wizard-agent-service issue 471). Moved verbatim out of live.js (wizard-ux issue 1665: split the giant front-end
 * files, no behaviour change). live.js calls this once, where the code used to be, with the closure names it reads,
 * and keeps the names it returns under their old names. Loaded just before live.js everywhere that loads it. The
 * body below keeps live.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.liveParts = window.WizCore.liveParts || {};
window.WizCore.liveParts.channels = function () {
  /* ---- channel store (wizard-ux issue 1261) ----
   * Chats channels on the Agent Service's own store (wizard-agent-service docs/chats-channels.md, its
   * WIZARD_CHANNEL_STORE switch, issue 440 phase 2): the channel list with the shared sort, pins and archive, the
   * atomic thread move, and one channel's own feed (view=list&channel=). Channels are on for everyone (wizard-ux
   * issue 1258). A 404 (store off, or an older service) means Spaces: Chats stays on
   * ui-preferences as in phase 1 and asks again every few minutes. The last list read is kept on this device, so an
   * offline reload stays on the store. Edits show at once (applied to the kept list), are sent one at a time, and are
   * followed by a fresh read; a read that started before a later edit is dropped, so a slow answer never undoes a tap.
   * Membership is keyed by the thread's agent plus its id ('hermes' = main), as the store keys it. */
  const CHANNELS_URL = '/wizard/v1/channels', CHANNEL_MEMBERSHIP_URL = '/wizard/v1/channels/membership', CHANNELS_CACHE = 'wos.chats.channels.v1';
  // Tags (wizard-agent-service issue 608, switch wizard/chat-tags): with the box's Tags on (`tags: true` on the list) a
  // chat carries several channels; PUT {sessionId, agent, add|remove} adds or removes one.
  const CHANNEL_TAGS_URL = '/wizard/v1/channels/tags';
  function channelStore({ req, emit, normalize = r => r, onRow = r => r, onError = () => {}, now = () => Date.now(), storage = null, every = 30e3, offEvery = 5 * 60e3, feedMax = 200, moveKeep = 120e3 } = {}) {
    const ID = /^[a-z0-9-]{1,48}$/, AGENT = /^[a-z0-9][a-z0-9-]{0,47}$/;
    const agentKey = a => a && AGENT.test(a) ? a : 'hermes';
    const valid = c => !!c && typeof c.id === 'string' && ID.test(c.id) && typeof c.name === 'string' && typeof c.agent === 'string' && AGENT.test(c.agent);
    const one = c => ({ id: c.id, agent: c.agent, name: c.name.slice(0, 60), order: Number(c.order) || 0, createdAt: typeof c.createdAt === 'string' ? c.createdAt : '', archived: !!c.archived,
      ...(c.archived ? { archivedAt: typeof c.archivedAt === 'string' ? c.archivedAt : '' } : {}), pinned: !!c.pinned, ...(c.pinned ? { pinOrder: Number.isFinite(c.pinOrder) ? c.pinOrder : 0 } : {}),
      ...(c.kind === 'alerts' ? { kind: 'alerts' } : c.kind === 'daily' ? { kind: 'daily', dayStartsAt: typeof c.dayStartsAt === 'string' ? c.dayStartsAt.slice(0, 5) : '05:00' } : {}), count: Number(c.count) || 0 });
    const clean = d => d && typeof d === 'object' && Array.isArray(d.channels) ? { sort: d.sort === 'za' ? 'za' : 'az', channels: d.channels.filter(valid).map(one), ...(d.tags === true ? { tags: true } : {}) } : null;
    const store = storage || (() => { try { return globalThis.localStorage || null; } catch (_) { return null; } })();
    let doc = null; try { doc = clean(JSON.parse(store?.getItem(CHANNELS_CACHE) || 'null')); } catch (_) {}
    let rev = doc ? 1 : 0, off = false, readAt = 0, reading = null, edits = 0, pending = 0, writes = Promise.resolve();
    const MOVES = new Map(), FEEDS = new Map(), TAGS = new Map(); // TAGS: agent|id -> Map(channel id -> {on, at})
    const bump = () => { rev++; try { emit(); } catch (_) {} };
    const keep = d => { doc = d; try { if (d) store?.setItem(CHANNELS_CACHE, JSON.stringify(d)); else store?.removeItem?.(CHANNELS_CACHE); } catch (_) {} bump(); };
    function pull() {
      if (reading) return reading;
      const at = edits; readAt = now();
      reading = (async () => {
        try {
          const d = clean(await (await req(CHANNELS_URL, { cache: 'no-store' })).json());
          off = false;
          if (!d || pending || at !== edits) return; // an edit made since this read began is newer than its answer
          if (JSON.stringify(d) !== JSON.stringify(doc)) keep(d);
        } catch (e) {
          if (e?.status === 404) { const had = !!doc || !off; off = true; MOVES.clear(); FEEDS.clear(); TAGS.clear(); if (had) keep(null); }
          // Offline or busy: the list this device last read stays.
        } finally { reading = null; }
      })();
      return reading;
    }
    // The store as Chats shows it, or null (unknown yet, store off, older service). Reading it keeps it fresh.
    function state() {
      if (!reading && now() - readAt >= (off ? offEvery : every)) pull();
      return off || !doc ? null : { rev, sort: doc.sort, channels: doc.channels, ...(doc.tags ? { tags: true } : {}) };
    }
    // Sent in order; after the last one settles the list is read again (also after a refusal, to show the box's own).
    function send(url, method, body) {
      pending++; edits++;
      const p = writes.then(async () => {
        try { const r = await req(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) {} return { ok: true, body: j }; }
        catch (e) { return { ok: false, status: e?.status || 0 }; }
        finally { pending--; }
      });
      writes = p.then(() => {}, () => {});
      // A read already running began before this edit: read again once it is done.
      p.then(r => { if (!r.ok) onError(r); if (pending) return; const again = () => { readAt = 0; pull(); }; if (reading) reading.then(again); else again(); });
      return p;
    }
    function edit(fn) { if (!doc) return false; const d = { sort: doc.sort, channels: doc.channels.map(c => ({ ...c })) }; fn(d); doc = d; edits++; bump(); return true; }
    const nowIso = () => new Date(now()).toISOString();
    // Same rules as the store (channel-store.mjs update/reorder/setSort): one of {sort} | {id, name?, archived?, pinned?}
    // | {order:[ids]} | {pinOrder:[ids]}. Pinning appends to that agent's pin order.
    function patch(body) {
      if (!doc || !body || typeof body !== 'object') return Promise.resolve({ ok: false, status: 0 });
      edit(d => {
        if (body.sort === 'az' || body.sort === 'za') { d.sort = body.sort; return; }
        const ids = Array.isArray(body.order) ? body.order : Array.isArray(body.pinOrder) ? body.pinOrder : null;
        if (ids) {
          const pin = Array.isArray(body.pinOrder), mine = d.channels.filter(c => ids.includes(c.id)), agent = mine[0]?.agent;
          const rest = d.channels.filter(c => c.agent === agent && !ids.includes(c.id) && (!pin || c.pinned)).sort((a, b) => pin ? a.pinOrder - b.pinOrder : a.order - b.order);
          ids.map(id => mine.find(c => c.id === id)).filter(Boolean).concat(rest).forEach((c, i) => { if (pin) { c.pinned = true; c.pinOrder = i; } else c.order = i; });
          return;
        }
        const c = d.channels.find(x => x.id === body.id); if (!c) return;
        if (typeof body.name === 'string') c.name = body.name.trim();
        if (typeof body.archived === 'boolean' && body.archived !== c.archived) { c.archived = body.archived; if (body.archived) c.archivedAt = nowIso(); else delete c.archivedAt; }
        if (body.pinned === true && !c.pinned) { c.pinned = true; c.pinOrder = d.channels.filter(x => x.agent === c.agent && x.pinned && x !== c).reduce((m, x) => Math.max(m, x.pinOrder), -1) + 1; }
        if (body.pinned === false && c.pinned) { c.pinned = false; delete c.pinOrder; }
      });
      return send(CHANNELS_URL, 'PATCH', body);
    }
    // A new channel needs the box's id: it shows once the box answers (null = not made).
    async function create(name, agent = '') {
      const r = await send(CHANNELS_URL, 'POST', { name, ...(agentKey(agent) !== 'hermes' ? { agent: agentKey(agent) } : {}) });
      const c = r.ok && valid(r.body) ? one(r.body) : null;
      if (c && doc && !doc.channels.some(x => x.id === c.id)) edit(d => { d.channels.push(c); });
      return c;
    }
    // The atomic move (PUT membership): into channelId, out of that agent's other channel; null unfiles. Shown at once
    // and kept over list reads for a while, so a list read before the move landed never moves the chat back.
    function move(sessionId, channelId, agent = '') {
      const k = agentKey(agent) + '|' + sessionId, mark = { to: channelId || '', at: now() };
      MOVES.set(k, mark); TAGS.delete(k); bump();
      return send(CHANNEL_MEMBERSHIP_URL, 'PUT', { sessionId, channelId: channelId || null, agent: agentKey(agent) }).then(r => {
        if (!r.ok && MOVES.get(k) === mark) { MOVES.delete(k); bump(); }
        return r;
      });
    }
    function moves() { const t = now(), out = []; for (const [k, m] of MOVES) { if (t - m.at > moveKeep) MOVES.delete(k); else out.push([k, m.to]); } return out; }
    // Tags on: add or remove one tag (PUT tags), shown at once and kept over list reads for a while like a move.
    function tag(sessionId, channelId, on, agent = '') {
      const k = agentKey(agent) + '|' + sessionId, mark = { on: !!on, at: now() };
      if (!TAGS.has(k)) TAGS.set(k, new Map());
      TAGS.get(k).set(channelId, mark); bump();
      return send(CHANNEL_TAGS_URL, 'PUT', { sessionId, agent: agentKey(agent), [on ? 'add' : 'remove']: channelId }).then(r => {
        if (!r.ok && TAGS.get(k)?.get(channelId) === mark) { TAGS.get(k).delete(channelId); bump(); }
        return r;
      });
    }
    // [[agent|id, channel id, on]] still inside moveKeep.
    function tagEdits() {
      const t = now(), out = [];
      for (const [k, m] of TAGS) { for (const [c, e] of m) { if (t - e.at > moveKeep) m.delete(c); else out.push([k, c, e.on]); } if (!m.size) TAGS.delete(k); }
      return out;
    }
    /* One channel's threads (view=list&channel=<id>, oldest first) on its agent's route: the newest feedMax of them,
     * read once per open and every `every` while shown. A 404 means the channel is gone: the list is read again. */
    function feed(id, agent = '') {
      if (off || !doc || !ID.test(id)) return null;
      let f = FEEDS.get(id);
      if (!f || f.agent !== agentKey(agent)) { f = { id, agent: agentKey(agent), rows: [], at: 0, busy: false, gone: false, ok: false }; FEEDS.set(id, f); while (FEEDS.size > 8) FEEDS.delete(FEEDS.keys().next().value); }
      if (!f.busy && now() - f.at >= every) readFeed(f);
      return f;
    }
    async function readFeed(f) {
      f.busy = true; f.at = now();
      const a = f.agent !== 'hermes' ? `&agent=${encodeURIComponent(f.agent)}` : '';
      const page = async (offset, snapshot) => (await req(`/wizard/hermes/api/sessions?view=list&channel=${encodeURIComponent(f.id)}&limit=100&offset=${offset}&include_children=false${snapshot ? `&snapshot=${encodeURIComponent(snapshot)}` : ''}${a}`, { cache: 'no-store' })).json();
      try {
        for (let tries = 0; ; tries++) {
          try {
            const first = await page(0, ''), total = Number(first.channel_total ?? 0), snapshot = typeof first.snapshot === 'string' ? first.snapshot : '';
            let raw = (first.data || []).slice(), offset = raw.length, more = first.has_more === true;
            if (more && total > feedMax) { raw = []; offset = total - feedMax; }
            for (let n = 0; more && n < Math.ceil(feedMax / 100) + 1; n++) {
              const p = await page(offset, snapshot), rows = p.data || [];
              raw.push(...rows); offset += rows.length; more = p.has_more === true && rows.length > 0;
            }
            // Tags on: a tag's feed also lists chats whose primary tag is another one (`tags` holds every tag).
            f.rows = raw.map(r => { const s = normalize(r); if (!s) return null; if (f.agent !== 'hermes') s.agent = f.agent; if (!s.channel) s.channel = f.id; return onRow(s, f.agent === 'hermes' ? '' : f.agent); }).filter(s => s && (s.channel === f.id || (Array.isArray(s.tags) && s.tags.includes(f.id)))).slice(-feedMax);
            f.ok = true; f.gone = false;
            break;
          } catch (e) { if (e?.status === 409 && tries < 1) continue; throw e; }
        }
      } catch (e) {
        if (e?.status === 404) { f.gone = true; f.rows = []; readAt = 0; pull(); }
        // Offline: the rows last read stay.
      } finally { f.busy = false; bump(); }
    }
    const rows = () => [...FEEDS.values()].flatMap(f => f.rows);
    // A feed row by id ('' = any agent, main first), for a post opened from the feed outside the live list.
    function find(id, agent) {
      const list = rows().filter(s => s.id === id);
      if (agent === undefined) return list.find(s => !s.agent) || list[0] || null;
      return list.find(s => agentKey(s.agent) === agentKey(agent)) || null;
    }
    // A window coming back to the front reads again at once (another device may have pinned or sorted meanwhile).
    const fresh = () => { readAt = 0; for (const f of FEEDS.values()) f.at = 0; };
    return { state, pull, patch, create, move, moves, tag, tagEdits, feed, rows, find, fresh, get off() { return off; } };
  }
  /* ---- end channel store ---- */
  /* ---- channel reads (wizard-agent-service issue 471) ----
   * Each channel's read watermark on the box (GET/PUT /wizard/v1/channels/read, the Agent Service's
   * WIZARD_CHANNEL_READ_SYNC switch), so reading a channel to the bottom on one device clears it on the owner's others.
   * Channels are on for everyone (wizard-ux issue 1258). marks() is the box's marks (key -> ms) or
   * null (unknown yet, turned off on the box, older service: the device's own marks stay the only ones; asked again
   * every few minutes). The box keeps every mark forward only, and so does this copy: a read that answers late never
   * moves a mark back. */
  const CHANNEL_READS_URL = '/wizard/v1/channels/read';
  function channelReads({ req, emit, now = () => Date.now(), every = 30e3, offEvery = 5 * 60e3 } = {}) {
    const KEY = /^(?:general(?:\|[a-z0-9][a-z0-9-]{0,47})?|[a-z0-9][a-z0-9-]{0,47}\|[a-z0-9-]{1,48})$/;
    let doc = null, off = false, readAt = 0, reading = null;
    // Newer of each mark; true when something moved.
    function merge(at) {
      if (!at || typeof at !== 'object') return false;
      let moved = false; doc = doc || {};
      for (const [k, t] of Object.entries(at)) if (KEY.test(k) && Number.isFinite(t) && !(doc[k] >= t)) { doc[k] = t; moved = true; }
      return moved;
    }
    const tell = moved => { if (moved) { try { emit(); } catch (_) {} } };
    function pull() {
      if (reading) return reading;
      readAt = now();
      reading = (async () => {
        try { const j = await (await req(CHANNEL_READS_URL, { cache: 'no-store' })).json(); const was = !doc; off = false; tell(merge(j && j.at) || was); }
        catch (e) { if (e?.status === 404) { const had = !!doc; off = true; doc = null; tell(had); } }
        finally { reading = null; }
      })();
      return reading;
    }
    function marks() {
      if (!reading && now() - readAt >= (off ? offEvery : every)) pull();
      return off ? null : doc;
    }
    // Sends this device's newer marks (the caller already waits a couple of seconds between writes).
    async function push(at) {
      const body = {}; for (const [k, t] of Object.entries(at || {})) if (KEY.test(k) && Number.isFinite(t)) body[k] = Math.floor(t);
      const keys = Object.keys(body).slice(0, 300); if (!keys.length || off) return false;
      try {
        const r = await req(CHANNEL_READS_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at: Object.fromEntries(keys.map(k => [k, body[k]])) }) });
        let j = null; try { j = await r.json(); } catch (_) {}
        tell(merge(j && j.at)); return true;
      } catch (e) { if (e?.status === 404) { off = true; doc = null; } return false; }
    }
    const fresh = () => { readAt = 0; };
    return { marks, pull, push, fresh, get off() { return off; } };
  }
  /* ---- end channel reads ---- */
  /* ---- channel daily (wizard-ux issue 1469) ----
   * The Daily channel's days (wizard-agent-service issue 527, docs/chats-channels.md, Daily channel): one real thread
   * per day in a channel of kind 'daily'. read(id) is GET /wizard/v1/channels/<id>/days (newest first, 14 a page;
   * `today` = today's thread id or null before the first post after the day boundary); more(id) reads the next older
   * page; today(id) is POST /wizard/v1/channels/<id>/today, which names today's thread and makes it at the first send of
   * the day (racing sends get the same one), so the box alone decides where the day starts. state(id) is the days this
   * device knows (kept on the device, so an offline reload still opens Daily) and reads again every `every`. */
  const CHANNEL_DAILY_CACHE = 'wos.chats.daily.v1';
  function channelDaily({ req, emit, now = () => Date.now(), storage = null, every = 60e3, keepMax = 60 } = {}) {
    const ID = /^[a-z0-9-]{1,48}$/, DAYRX = /^\d{4}-\d{2}-\d{2}$/, SID = /^[A-Za-z0-9_.:-]{1,200}$/;
    const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
    const day = d => d && typeof d === 'object' && DAYRX.test(d.day) && typeof d.sessionId === 'string' && SID.test(d.sessionId)
      ? { day: d.day, sessionId: d.sessionId, title: str(d.title, 200), opener: str(d.opener, 200), count: Math.max(0, Number(d.count) || 0), lastAt: str(d.lastAt, 40) } : null;
    const store = storage || (() => { try { return globalThis.localStorage || null; } catch (_) { return null; } })();
    const S = new Map();
    let kept = {}; try { const v = JSON.parse(store?.getItem(CHANNEL_DAILY_CACHE) || 'null'); if (v && typeof v === 'object' && !Array.isArray(v)) kept = v; } catch (_) {}
    const tell = () => { try { emit(); } catch (_) {} };
    const save = () => {
      const out = {}; for (const [id, s] of S) if (s.days.length) out[id] = { today: s.today, days: s.days.slice(0, keepMax), end: s.end && s.days.length <= keepMax };
      try { store?.setItem(CHANNEL_DAILY_CACHE, JSON.stringify(out)); } catch (_) {}
    };
    function entry(id) {
      let s = S.get(id); if (s) return s;
      const k = kept[id] && typeof kept[id] === 'object' ? kept[id] : null, days = Array.isArray(k?.days) ? k.days.map(day).filter(Boolean) : [];
      s = { id, today: typeof k?.today === 'string' && SID.test(k.today) ? k.today : null, days, end: k?.end === true, next: null, at: 0, ok: false, busy: null, more: null, gone: false };
      s.next = !s.end && days.length ? days[days.length - 1].day : null;
      S.set(id, s); return s;
    }
    // A first page replaces those days (older days already read stay below it, unless the box says there are none);
    // an older page joins below. next = the cursor of the next older page: the oldest day held, while the box has more.
    function merge(s, page, older) {
      const got = (Array.isArray(page.days) ? page.days : []).map(day).filter(Boolean), have = new Set(got.map(d => d.day));
      const more = typeof page.next === 'string' && DAYRX.test(page.next);
      const byDay = (a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0;
      if (older) { s.days = s.days.filter(d => !have.has(d.day)).concat(got).sort(byDay); s.end = !more; }
      else {
        const last = got.length ? got[got.length - 1].day : '', below = more && last ? s.days.filter(d => !have.has(d.day) && d.day < last) : [];
        s.days = got.concat(below).sort(byDay);
        if (!below.length) s.end = !more;
        s.today = typeof page.today === 'string' && SID.test(page.today) ? page.today : null;
      }
      s.next = !s.end && s.days.length ? s.days[s.days.length - 1].day : null;
    }
    function read(id) {
      if (!ID.test(id)) return Promise.resolve(null);
      const s = entry(id); if (s.busy) return s.busy;
      s.at = now();
      s.busy = (async () => {
        try { const j = await (await req(`/wizard/v1/channels/${encodeURIComponent(id)}/days`, { cache: 'no-store' })).json(); merge(s, j || {}, false); s.ok = true; s.gone = false; save(); }
        catch (e) { if (e?.status === 404) { s.gone = true; s.days = []; s.today = null; s.next = null; save(); } }
        finally { s.busy = null; tell(); }
        return s;
      })();
      return s.busy;
    }
    function more(id) {
      const s = ID.test(id) ? entry(id) : null; if (!s || !s.next) return Promise.resolve(null);
      if (s.more) return s.more;
      const cursor = s.next;
      s.more = (async () => {
        try { const j = await (await req(`/wizard/v1/channels/${encodeURIComponent(id)}/days?cursor=${encodeURIComponent(cursor)}`, { cache: 'no-store' })).json(); merge(s, j || {}, true); save(); }
        catch (_) { /* offline: the button stays */ }
        finally { s.more = null; tell(); }
        return s;
      })();
      tell();
      return s.more;
    }
    // Today's thread, made by the box if this is the day's first send: { day, sessionId, created } (throws when unreachable).
    async function today(id) {
      if (!ID.test(id)) throw new Error('bad channel');
      const r = await req(`/wizard/v1/channels/${encodeURIComponent(id)}/today`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json(), d = day({ day: j?.day, sessionId: j?.sessionId });
      if (!d) throw new Error('bad answer');
      const s = entry(id), at = s.days.findIndex(x => x.day === d.day);
      if (at >= 0) s.days[at] = { ...s.days[at], sessionId: d.sessionId };
      else s.days = [d].concat(s.days.filter(x => x.day < d.day)).concat(s.days.filter(x => x.day > d.day)).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0);
      if (s.days[0]?.day === d.day) s.today = d.sessionId;
      save(); tell();
      return { day: d.day, sessionId: d.sessionId, created: j.created === true };
    }
    // What this device knows of a channel's days; reading it keeps it fresh.
    function state(id) {
      if (!ID.test(id)) return null;
      const s = entry(id);
      if (!s.busy && now() - s.at >= every) read(id);
      return s;
    }
    const fresh = () => { for (const s of S.values()) s.at = 0; };
    return { state, read, more, today, fresh };
  }
  /* ---- end channel daily ---- */
  /* ---- agent inbox (wizard-ux issue 1569) ----
   * The box's agent inbox (wizard-agent-service issue 549, docs/agent-inbox.md): one record per background task.
   * state().records are the tasks still working (state running) or gone quiet for 6 h (stale), newest news first, as
   * GET /wizard/v1/agent-inbox?state=running,stale answers; reading state() keeps it fresh every `every`. A 404 (a box with
   * WIZARD_AGENT_INBOX=0, or an older box) is an empty list, asked again after `every`. Chats reads it for the Running
   * view. */
  function agentInbox({ req, emit, now = () => Date.now(), every = 30e3 } = {}) {
    const SID = /^[A-Za-z0-9_.:-]{1,200}$/, RID = /^inbox_[a-f0-9]{24}$/, AID = /^[a-z][a-z0-9-]{0,40}$/;
    const str = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
    const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const rec = r => r && typeof r === 'object' && RID.test(r.id) && typeof r.thread_id === 'string' && SID.test(r.thread_id) && (r.state === 'running' || r.state === 'stale')
      ? { id: r.id, agent: typeof r.agent === 'string' && AID.test(r.agent) ? r.agent : 'hermes', thread: r.thread_id, title: str(r.title, 120), update: str(r.last_update, 200), state: r.state, createdAt: num(r.created_at), updatedAt: num(r.updated_at) || num(r.created_at) } : null;
    // privateDefault: the box's private default agent while its wizard/private-routing switch is on (wizard-agent-service
    // issue 631): its threads move too. '' otherwise (switch off, an older box): only main-agent threads, as before.
    const s = { records: [], stay: new Set(), privateDefault: '', ok: false, gone: false, at: 0, busy: null };
    const tell = () => { try { emit(); } catch (_) {} };
    function read() {
      if (s.busy) return s.busy;
      s.at = now();
      s.busy = (async () => {
        try {
          const j = await (await req('/wizard/v1/agent-inbox?state=running,stale&limit=200', { cache: 'no-store' })).json();
          s.records = (Array.isArray(j?.records) ? j.records : []).map(rec).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
          // The main agent's Daily and Alerts threads (issue 1569 review): Send to inbox is never offered for them.
          s.stay = new Set((Array.isArray(j?.stay) ? j.stay : []).filter(id => typeof id === 'string' && SID.test(id)).slice(0, 1000));
          s.privateDefault = typeof j?.private_default === 'string' && AID.test(j.private_default) && j.private_default !== 'hermes' ? j.private_default : '';
          s.ok = true; s.gone = false;
        } catch (e) { if (e?.status === 404) { s.records = []; s.stay = new Set(); s.privateDefault = ''; s.ok = true; s.gone = true; } }
        finally { s.busy = null; tell(); }
        return s;
      })();
      return s.busy;
    }
    function state() { if (!s.busy && now() - s.at >= every) read(); return s; }
    // One agent's records ('hermes' = the main agent): a view opens a record's thread only in that agent's own Chats.
    const records = agent => state().records.filter(r => r.agent === (agent || 'hermes'));
    const fresh = () => { s.at = 0; al.at = 0; nd.at = 0; };
    // Open / Send to inbox (wizard-ux issue 1570): POST /wizard/v1/agent-inbox/open|send moves one main-agent thread
    // between the chat list and the background; the box answers with its record. The list is asked again right after.
    async function move(kind, thread, extra = {}) {
      if ((kind !== 'open' && kind !== 'send') || !SID.test(String(thread || ''))) throw Object.assign(new Error('invalid'), { status: 400 });
      const body = { thread_id: thread };
      // Issue 631: a private default agent's thread names its agent (the box hides it in that agent's own Hermes).
      if (typeof extra.agent === 'string' && extra.agent && extra.agent === s.privateDefault) body.agent = extra.agent;
      const title = str(extra.title, 120), utterance = str(extra.utterance, 600);
      if (title) body.title = title;
      if (utterance) body.utterance = utterance;
      try { return await (await req(`/wizard/v1/agent-inbox/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
      finally { fresh(); read(); }
    }
    // True for a main-agent Daily or Alerts thread, which always stays in Chats.
    const stays = id => state().stay.has(id);
    /* Signal sweep card (wizard-ux issue 1586; box half wizard-agent-service issue 550, docs/agent-inbox.md). card()
     * keeps only the fields the shell draws, checked: the history row's `agent_sweep` and GET .../sweep's `card` go
     * through it alike. answer(): one tap on a token (PATCH <id> {action:'answer', option}; `later` snoozes).
     * yesToAll(): POST <card id>/yes-to-all. sweep(): the newest card with each item's current state. */
    const CID = /^sweep_[a-f0-9]{24}$/, TOK = /^[a-z][a-z0-9-]{0,19}$/, ISTATE = new Set(['running', 'new', 'surfaced', 'answered', 'parked', 'archived', 'stale']);
    const href = v => typeof v === 'string' && /^\/(?![\/\\])\S{0,600}$/.test(v) ? v : '';
    const cnt = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1e6) : 0; };
    function card(v) {
      if (!v || typeof v !== 'object' || !CID.test(v.id)) return null;
      const w = v.waiting && typeof v.waiting === 'object' ? v.waiting : {}, d = v.done && typeof v.done === 'object' ? v.done : {};
      const box = (x, link) => ({ count: cnt(x?.count), link: href(x?.link) || link });
      const items = (Array.isArray(w.items) ? w.items : []).slice(0, 7).map(i => {
        if (!i || typeof i !== 'object' || !RID.test(i.id)) return null;
        const options = [...new Set((Array.isArray(i.options) ? i.options : []).map(o => typeof o === 'string' ? o : o?.token).filter(t => typeof t === 'string' && TOK.test(t)))].slice(0, 8);
        return { id: i.id, agent: typeof i.agent === 'string' && AID.test(i.agent) ? i.agent : 'hermes', thread: typeof i.thread_id === 'string' && SID.test(i.thread_id) ? i.thread_id : '',
          title: str(i.title, 120), ask: str(i.ask, 300), recommendation: str(i.recommendation, 300), options,
          def: typeof i.default_option === 'string' && options.includes(i.default_option) ? i.default_option : '', confirm: i.confirm === true,
          seen: cnt(i.seen) || 1, state: ISTATE.has(i.state) ? i.state : 'surfaced', answer: typeof i.answer === 'string' && TOK.test(i.answer) ? i.answer : '', link: href(i.link) };
      }).filter(Boolean);
      const rf = v.rules_flag && typeof v.rules_flag === 'object' ? { day: str(v.rules_flag.day, 10), alerts: cnt(v.rules_flag.alerts), cap: cnt(v.rules_flag.cap), link: href(v.rules_flag.link) } : null;
      return { id: v.id, at: num(v.at), thread: typeof v.thread_id === 'string' && SID.test(v.thread_id) ? v.thread_id : '',
        waiting: { items, more: cnt(w.more), link: href(w.link) || '/wizard-os-home/?inbox=waiting' },
        done: { items: (Array.isArray(d.items) ? d.items : []).slice(0, 10).map(i => i && RID.test(i.id) ? { id: i.id, title: str(i.title, 120), link: href(i.link) } : null).filter(Boolean), more: cnt(d.more), link: href(d.link) || '/wizard-os-home/?inbox=done' },
        running: { ...box(v.running, '/wizard-os-home/?inbox=running'), stale: cnt(v.running?.stale) }, later: box(v.later, '/wizard-os-home/?inbox=later'), parked: box(v.parked, '/wizard-os-home/?inbox=parked'),
        missing: cnt(v.missing), rules: rf && rf.alerts ? rf : null,
        yes: { count: cnt(v.yes_to_all?.count), skipped: cnt(v.yes_to_all?.skipped) } };
    }
    const JSON_POST = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    async function answer(id, option) {
      if (!RID.test(String(id || '')) || !TOK.test(String(option || ''))) throw Object.assign(new Error('invalid'), { status: 400 });
      return (await req(`/wizard/v1/agent-inbox/${id}`, { method: 'PATCH', ...JSON_POST({ action: 'answer', option }) })).json();
    }
    async function yesToAll(cardId) {
      if (!CID.test(String(cardId || ''))) throw Object.assign(new Error('invalid'), { status: 400 });
      const j = await (await req(`/wizard/v1/agent-inbox/${cardId}/yes-to-all`, { method: 'POST', ...JSON_POST({}) })).json();
      return { answered: Array.isArray(j?.answered) ? j.answered.filter(a => a && RID.test(a.id)).map(a => ({ id: a.id, option: TOK.test(a.option) ? a.option : '' })) : [], card: card(j?.card) };
    }
    async function sweep() { return card((await (await req('/wizard/v1/agent-inbox/sweep', { cache: 'no-store' })).json())?.card); }
    /* Alert rules feedback (wizard-ux issue 1589; box half wizard-agent-service issue 552, docs/agent-inbox.md).
     * alerts(agent): the alert records still new or surfaced (GET ...?kind=alert&state=new,surfaced), kept fresh like
     * the Running list; the day's collapsed "More alerts today" alert carries how many it holds (`extra`). later():
     * the Later and FYI records (kinds fyi and note, new or surfaced) for the sweep card's Later list, read on demand.
     * feedback(id, action): PATCH <id> {action: not_urgent | should_alert}; the box answers with the record and how many
     * examples each kind now has. A 404 (WIZARD_AGENT_INBOX=0, an older box) is an empty list. */
    const FB = new Set(['not_urgent', 'should_alert']), LATER = new Set(['fyi', 'note']);
    const alertRec = r => r && typeof r === 'object' && RID.test(r.id) && typeof r.kind === 'string'
      ? { id: r.id, kind: r.kind, agent: typeof r.agent === 'string' && AID.test(r.agent) ? r.agent : 'hermes', thread: typeof r.thread_id === 'string' && SID.test(r.thread_id) ? r.thread_id : '',
        title: str(r.title, 120), ask: str(r.ask || r.last_update, 300), severity: str(r.severity, 12), collapsed: r.alert_collapsed === true, extra: cnt(r.alert_extra),
        feedback: FB.has(r.feedback) ? r.feedback : '', link: href(r.link), state: str(r.state, 12), updatedAt: num(r.updated_at) || num(r.created_at), ...(r.failed === true ? { failed: true } : {}) } : null;
    const al = { records: [], ok: false, gone: false, at: 0, busy: null };
    function readAlerts() {
      if (al.busy) return al.busy;
      al.at = now();
      al.busy = (async () => {
        try {
          const j = await (await req('/wizard/v1/agent-inbox?kind=alert&state=new,surfaced&limit=50', { cache: 'no-store' })).json();
          al.records = (Array.isArray(j?.records) ? j.records : []).map(alertRec).filter(r => r && r.kind === 'alert').sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
          al.ok = true; al.gone = false;
        } catch (e) { if (e?.status === 404) { al.records = []; al.ok = true; al.gone = true; } }
        finally { al.busy = null; tell(); }
        return al;
      })();
      return al.busy;
    }
    function alertState() { if (!al.busy && now() - al.at >= every) readAlerts(); return al; }
    const alerts = agent => alertState().records.filter(r => r.agent === (agent || 'hermes'));
    async function later() {
      const j = await (await req('/wizard/v1/agent-inbox?state=new,surfaced&limit=200', { cache: 'no-store' })).json();
      return (Array.isArray(j?.records) ? j.records : []).map(alertRec).filter(r => r && LATER.has(r.kind)).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)).slice(0, 30);
    }
    /* Inbox rows (wizard-ux issue 1779, switch wizard/inbox-rows): the records waiting on the owner (kind needs_you,
     * state new; `failed` when the task failed or stalled), read only while the switch asks for them, kept fresh like
     * the Running list. archive(id): PATCH <id> {action: archive}, gone from the list on this frame. A 404 is none. */
    const nd = { records: [], ok: false, gone: false, at: 0, busy: null };
    function readNeeds() {
      if (nd.busy) return nd.busy;
      nd.at = now();
      nd.busy = (async () => {
        try {
          const j = await (await req('/wizard/v1/agent-inbox?state=new&kind=needs_you&limit=50', { cache: 'no-store' })).json();
          nd.records = (Array.isArray(j?.records) ? j.records : []).map(alertRec).filter(r => r && r.kind === 'needs_you' && r.thread && (!r.state || r.state === 'new')).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
          nd.ok = true; nd.gone = false;
        } catch (e) { if (e?.status === 404) { nd.records = []; nd.ok = true; nd.gone = true; } }
        finally { nd.busy = null; tell(); }
        return nd;
      })();
      return nd.busy;
    }
    function needsState() { if (!nd.busy && now() - nd.at >= every) readNeeds(); return nd; }
    const needs = agent => needsState().records.filter(r => r.agent === (agent || 'hermes'));
    async function archive(id) {
      if (!RID.test(String(id || ''))) throw Object.assign(new Error('invalid'), { status: 400 });
      const was = nd.records; nd.records = nd.records.filter(r => r.id !== id); tell();
      try { return await (await req(`/wizard/v1/agent-inbox/${id}`, { method: 'PATCH', ...JSON_POST({ action: 'archive' }) })).json(); }
      catch (e) { nd.records = was; tell(); throw e; }
      finally { nd.at = 0; readNeeds(); }
    }
    /* A thread archived from anywhere (its own Archive, a link trail, a row, a swipe: LIVE.archive) takes its waiting
     * records with it (wizard-ux issue 1928), so a background task's Inbox row goes with its thread. restoreThread(thread)
     * (LIVE.restore: Undo, Restore) puts back the records this device archived for it: the box has no un-archive, and
     * its `snooze` action is the one that sets a record back to waiting (state new). Errors are swallowed: the Inbox
     * rule already leaves out a record whose thread is archived. */
    const byThread = new Map();
    function archiveThread(thread) {
      const mine = nd.records.filter(r => r.thread === thread); if (!mine.length) return Promise.resolve([]);
      const job = Promise.all(mine.map(r => archive(r.id).then(() => r, () => null))).then(done => done.filter(Boolean));
      byThread.set(thread, job);
      return job;
    }
    async function restoreThread(thread) {
      const job = byThread.get(thread); if (!job) return [];
      byThread.delete(thread);
      const done = await job.catch(() => []); if (!done.length) return [];
      const have = new Set(nd.records.map(r => r.id));
      nd.records = nd.records.concat(done.filter(r => !have.has(r.id))).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)); tell();
      try { await Promise.all(done.map(r => req(`/wizard/v1/agent-inbox/${r.id}`, { method: 'PATCH', ...JSON_POST({ action: 'snooze' }) }))); }
      catch (_) {}
      finally { await Promise.resolve(nd.busy).catch(() => {}); nd.at = 0; readNeeds(); }
      return done;
    }
    async function feedback(id, action) {
      if (!RID.test(String(id || '')) || !FB.has(action)) throw Object.assign(new Error('invalid'), { status: 400 });
      try {
        const j = await (await req(`/wizard/v1/agent-inbox/${id}`, { method: 'PATCH', ...JSON_POST({ action }) })).json();
        // The alert left Alerts (it waits for the sweep now, or the collapsed one is cleared): gone on this frame.
        if (action === 'not_urgent') al.records = al.records.filter(r => r.id !== id);
        return { record: alertRec(j?.record), examples: { not_urgent: cnt(j?.examples?.not_urgent), should_alert: cnt(j?.examples?.should_alert) } };
      } finally { al.at = 0; readAlerts(); }
    }
    const privateDefault = () => state().privateDefault;
    return { state, records, read, fresh, move, stays, privateDefault, card, answer, yesToAll, sweep, alerts, alertState, readAlerts, later, feedback, needs, needsState, readNeeds, archive, archiveThread, restoreThread };
  }
  /* ---- sent log (wizard-ux issue 1778) ----
   * The box's Sent log (wizard-agent-service issue 607, same switch as the agent inbox): one row per capture the owner
   * sent, newest first, with where it went (route), why (decided_by + rules) and its live state. state() reads
   * GET /wizard/v1/sent every `every` while something asks for it; a 404 (WIZARD_AGENT_INBOX=0 on the box, or an older box) is an
   * empty log with `gone`. correct(id, should_reply) posts the owner's correction and puts the row the box answers with
   * in place, so the row changes on that frame. Chats reads it for the Sent tab. */
  function sentLog({ req, emit, now = () => Date.now(), every = 15e3 } = {}) {
    const ID = /^sent_[a-f0-9]{24}$/, SID = /^[A-Za-z0-9_.:-]{1,200}$/, RID = /^inbox_[a-f0-9]{24}$/;
    const ROUTES = new Set(['dump', 'agent', 'command', 'reminder', 'thread']), BY = new Set(['owner_words', 'model', 'correction', 'fallback']);
    const STATES = new Set(['routing', 'running', 'done', 'needs_you', 'failed', 'unknown']);
    const str = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
    const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const list = (v, n) => (Array.isArray(v) ? v : []).map(x => str(x, 80)).filter(Boolean).slice(0, n);
    const row = r => r && typeof r === 'object' && ID.test(r.id) ? {
      id: r.id, at: num(r.at), source: str(r.source, 20), text: typeof r.text === 'string' ? r.text.slice(0, 2000) : '',
      route: ROUTES.has(r.route) ? r.route : null, decidedBy: BY.has(r.decided_by) ? r.decided_by : null, rules: list(r.rules_matched, 12),
      state: STATES.has(r.state) ? r.state : 'unknown', thread: typeof r.thread_id === 'string' && SID.test(r.thread_id) ? r.thread_id : null,
      record: typeof r.record_id === 'string' && RID.test(r.record_id) ? r.record_id : null, tags: list(r.tags, 8), urgent: r.urgent === true,
      wouldRoute: ROUTES.has(r.would_route) ? r.would_route : null, corrected: r.corrected && typeof r.corrected.should_reply === 'boolean' ? { shouldReply: r.corrected.should_reply, at: num(r.corrected.at) } : null,
      error: str(r.error, 80),
      // A reply inside a thread (wizard-ux issue 1808): did his words ask for an answer, the agent's one-line answer,
      // and quiet (it needed nothing from him, so it stayed out of Inbox).
      wantsReply: r.wants_reply !== false, answer: str(r.answer, 200), quiet: r.quiet === true,
    } : null;
    // Typed messages (wizard-agent-service issue 669, Smart inbox): how often the box's guess for a typed task matched
    // what he did, and whether typed tasks now run in the background (`on`). A box without it: null.
    const count = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
    const typedOf = t => t && typeof t === 'object' && t.background && typeof t.background === 'object' ? {
      on: t.on === true, graduated: t.graduated === true, judged: count(t.background.judged), matched: count(t.background.matched),
      rate: Number.isFinite(Number(t.background.rate)) && t.background.rate !== null ? Number(t.background.rate) : null,
      min: count(t.gate?.min) || 50, need: Number.isFinite(Number(t.gate?.rate)) ? Number(t.gate.rate) : 0.9,
    } : null;
    const s = { rows: [], next: null, ok: false, gone: false, at: 0, busy: null, deep: false, typed: null };
    const tell = () => { try { emit(); } catch (_) {} };
    function read() {
      if (s.busy) return s.busy;
      s.at = now();
      s.busy = (async () => {
        try {
          const j = await (await req('/wizard/v1/sent?limit=100', { cache: 'no-store' })).json();
          const page = (Array.isArray(j?.rows) ? j.rows : []).map(row).filter(Boolean), next = typeof j?.next === 'string' && ID.test(j.next) ? j.next : null;
          // Older pages read with Show older stay: the fresh first page, then the loaded rows after its last one.
          const k = s.deep && page.length ? s.rows.findIndex(r => r.id === page.at(-1).id) : -1;
          if (k >= 0 && k < s.rows.length - 1) { const have = new Set(page.map(r => r.id)); s.rows = page.concat(s.rows.slice(k + 1).filter(r => !have.has(r.id))); }
          else { s.rows = page; s.next = next; s.deep = false; }
          s.typed = typedOf(j?.typed_routing);
          s.ok = true; s.gone = false;
        } catch (e) { if (e?.status === 404) { s.rows = []; s.next = null; s.deep = false; s.ok = true; s.gone = true; s.typed = null; } }
        finally { s.busy = null; tell(); }
        return s;
      })();
      return s.busy;
    }
    function state() { if (!s.busy && now() - s.at >= every) read(); return s; }
    const fresh = () => { s.at = 0; };
    // The next page (older rows) after the last one shown.
    async function more() {
      if (!s.next) return s;
      const j = await (await req(`/wizard/v1/sent?limit=100&before=${encodeURIComponent(s.next)}`, { cache: 'no-store' })).json();
      const have = new Set(s.rows.map(r => r.id));
      s.rows = s.rows.concat((Array.isArray(j?.rows) ? j.rows : []).map(row).filter(r => r && !have.has(r.id)));
      s.next = typeof j?.next === 'string' && ID.test(j.next) ? j.next : null;
      s.deep = true; tell(); return s;
    }
    // Should have replied (true) / Didn't need a reply (false): the box moves the thread and keeps the example.
    async function correct(id, shouldReply) {
      if (!ID.test(String(id || '')) || typeof shouldReply !== 'boolean') throw Object.assign(new Error('invalid'), { status: 400 });
      const j = await (await req(`/wizard/v1/sent/${id}/correct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ should_reply: shouldReply }) })).json();
      const r = row(j?.row);
      if (r) { s.rows = s.rows.map(x => x.id === r.id ? r : x); tell(); }
      return { row: r, changed: j?.changed === true };
    }
    return { state, read, fresh, more, correct };
  }
  /* ---- end sent log ---- */
  return { agentInbox, channelDaily, channelReads, channelStore, sentLog };
};
