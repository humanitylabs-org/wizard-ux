import { modelContext, runWithChatsModel } from './chats-list-model.mjs';
// Lightweight synthetic execution of the real list renderer, not a DOM/browser substitute.
// Peripheral services and row markup are stubbed; section selection, collapse and footer assembly are production code.
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../web/core/chats.js', import.meta.url), 'utf8');
export function listFixture({ status = false, query = '', busy = false, footer = true, inputRows = null, pinned = [] } = {}) {
  const state = { q: query }, writes = [], groups = Object.fromEntries(['errors', 'working', 'ready', 'yesterday', 'pastWeek', 'deferred', 'archive'].map(k => [k, [{ id: k, title: 'match', section: k }]]));
  const rows = inputRows || Object.values(groups).flat(), el = { querySelector: () => null, innerHTML: '', firstElementChild: null };
  const w = { id: 'synthetic', thread: null };
  const bs = { hits: new Map(), rows: new Map(), busy };
  const no = () => {}, empty = () => '', identity = x => x;
  const ctx = {
    window: { WizCore: { chatSearch: { query: () => footer ? bs : null, cancel: no, scanning: r => r.busy, footer: r => `<div class="ch-bodysearch${r.busy ? ' busy' : ''}" data-chbs="${r.busy ? 'busy' : 'done'}">Synthetic search status</div>` } } },
    H: {}, W: { synthetic: w }, ch: () => state, norm: x => String(x || '').trim().toLowerCase(),
    LIVE: { cardAt: s => s.activityAt || s.updatedAt, ok: true, statusFor: () => ({ ok: true }), searchRows: () => rows, sessionsFor: () => rows, workGroups: input => Object.fromEntries(Object.keys(groups).map(k => [k, input.filter(r => r.section === k)])), isNew: () => false, archiveAfterDays: 7 },
    syncListTitle: no, closeStream: no, winAgent: empty, STATUS: {}, focusOf: () => null, notes: () => ({ awake: [], later: [] }), focusMatches: () => true,
    PIN: { partition: rows => ({ pinned: rows.filter(s => pinned.includes(s.id)), rest: rows.filter(s => !pinned.includes(s.id)) }) }, snoozeLast: () => false, owner: () => w.id, newDrafts: () => [], esc: String,
    matchFilters: () => [], OUTBOX: null, sendPill: empty, PW: null, byStatus: () => status, readyOrdered: identity,
    SEC_PAGE: 40, STALE_LIST: 120000, waitsOn: () => false, deferredOf: () => false, isWorking: () => false, attOf: () => null,
    archSel: empty, readyBody: (list, row) => list.map(row).join(''), chatRow: (s, snip, tag) => `<div class="ch-row" data-chopen="${s.id}">${tag ? `<span class="ch-search-status">${tag}</span>` : ''}</div>`,
    listPlace: () => null, storedListPlace: () => null, compactOn: () => false, focusedAgent: empty, focusStrip: empty,
    clearReading: no, keptSheet: no, restoreSheet: no, restoreListPlace: () => true, bindFocusStrip: no,
    secOpen: Object.fromEntries(Object.keys(groups).map(k => [k, k !== 'archive'])), SEC_OPEN_KEY: 'synthetic-sections',
    localStorage: { setItem: (...args) => writes.push(args) }, track: { querySelector: () => el }, Date,
  };
  modelContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../../web/core/chat-search.js', import.meta.url), 'utf8'), ctx);
  Object.assign(ctx.window.WizCore.chatSearch, { query: () => footer ? bs : null, cancel: no, scanning: r => r.busy, footer: r => `<div class="ch-bodysearch${r.busy ? ' busy' : ''}" data-chbs="${r.busy ? 'busy' : 'done'}">Synthetic search status</div>` });
  const constants = source.slice(source.indexOf('  const SECTIONS_DAY ='), source.indexOf('\n', source.indexOf('  const SECTIONS_STATUS =')));
  const render = source.slice(source.indexOf('  function renderChatList('), source.indexOf('  /* ---- attachments:'));
  vm.runInContext(`${constants}\n${render}\nthis.render = renderChatList; this.toggle = toggleSection;`, ctx);
  return {
    state, writes,
    render(q = state.q) { state.q = q; ctx.render(w, el); return el.innerHTML; },
    toggle(k) { ctx.toggle(w, k); return el.innerHTML; },
  };
}
export const sectionKeys = html => [...html.matchAll(/<section[^>]*data-sec="([^"]+)"/g)].map(m => m[1]);
