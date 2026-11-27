// Draft marks (wizard-ux issue 1445; on for everyone since issue 1604, the wizard/draft-marks switch is gone): an Activity row whose thread has a saved, unsent draft
// says "✎ Draft" ahead of its preview, and a Channels line whose box holds one wears the same pencil. This runs the real
// drafts store (core/chat-kit.js), the real Inbox renderer (core/chats-inboxrows.js, wizard-ux issue 1779) over the real live.js
// list read, the real Channels list (chats.js channelsBody) and the real list model rows the AI apps sidebar draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const kitSrc = read('web/core/chat-kit.js'), live = withLiveParts(read('web/live.js')), chats = withParts(read('web/core/chats.js'));
const RAW = JSON.parse(read('tests/fixtures/sessions-list-1360.json'));
const SHIFT = Date.now() - 5 * 60e3 - Math.max(...RAW.data.map(s => Date.parse(s.activityAt)));
const shift = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? new Date(Date.parse(v) + SHIFT).toISOString() : Array.isArray(v) ? v.map(shift) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)])) : v;
const PAYLOAD = shift(RAW);
const ON = '', OTHER = 'wizard/sent-rows'; // no switch any more (issue 1604): marks show whatever data-tweaks holds
const GREEN = 'synthetic_1360_green', NEEDS = 'synthetic_1360_needs';

// One device: its localStorage survives a "reload" (a new context on the same storage).
function device(storage = new Map(), dataset = { tweaks: ON }) {
  const events = [];
  const c = { console, AbortSignal, URL, URLSearchParams, structuredClone, Promise, Date, JSON, Map, Set,
    document: { documentElement: { dataset }, readyState: 'loading', hidden: false, addEventListener() {}, querySelector: () => null },
    navigator: {}, location: { origin: 'https://box.test', href: 'https://box.test/wizard-os-home/' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), key: () => null, get length() { return 0; } },
    setInterval() {}, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, addEventListener: (t, fn) => { (c._on[t] = c._on[t] || []).push(fn); }, removeEventListener() {},
    dispatchEvent: e => { events.push(e.type); for (const fn of c._on[e.type] || []) fn(e); return true; }, _on: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } }, Event: class { constructor(type) { this.type = type; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, WosAgents: { isOther: id => !!id && id !== 'hermes', get: id => ({ id, privacy: 'standard' }), others: () => [] },
    fetch: async url => {
      const u = new URL(url, 'https://box.test'), json = v => ({ ok: true, status: 200, json: async () => structuredClone(v) });
      if (u.pathname === '/wizard/hermes/api/sessions') return json(u.searchParams.get('agent') ? { data: [], has_more: false } : PAYLOAD);
      if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: 1, threads: {} } });
      return json({ state: {} });
    } };
  c.window = c; c.globalThis = c; modelContext(c);
  vm.runInContext(kitSrc, c); vm.runInContext(live, c);
  const line = t => { const i = chats.indexOf('\n  ' + t); assert.ok(i >= 0, t); return chats.slice(i + 1, chats.indexOf('\n', i + 1)); };
  const block = (a, b) => { const i = chats.indexOf('\n  ' + a); assert.ok(i >= 0, a); const j = chats.indexOf('\n  ' + b, i); assert.ok(j > i, b); return chats.slice(i + 1, j); };
  const repaints = [];
  Object.assign(c, { KIT: c.WosChat, LIVE: c.WizLive, snoozeLast: () => false, deferredOf: s => !!s.deferred && !s.archived,
    readyOrder: 'newest', SEC_PAGE: 40, secOpen: { working: true, ready: true, recent: true }, ch: () => ({ more: {} }), noteRow: () => '', noteAt: () => 0,
    STI: new Proxy({}, { get: () => '' }), esc: v => String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]),
    clip: (v, n) => String(v ?? '').slice(0, n), ago: () => '1m', workLabel: () => 'Working', privRow: () => false, AGS: () => null, topicOn: () => false,
    TOPIC: null, subjectOf: () => '', PIN: { has: () => false, on: () => true }, BOOM: () => null, PIN_SVG: '', chanName: () => 'launch', agentTail: () => '',
    // the list windows the repaint walks: one Activity list, one channel feed (its box is being typed in), one thread
    CH: { list: {}, feed: {}, thread: {} }, W: { list: { id: 'list' }, feed: { id: 'feed', feedOpen: true }, thread: { id: 'thread', thread: 's1' } },
    chanOpen: w => w.feedOpen ? { id: 'launch' } : null, chanElsewhere: () => false, holdList: () => false, elOf: id => ({ id }),
    renderChatList: w => repaints.push(w.id) });
  vm.runInContext(['const WORKING_ST =', 'const isWorking =', 'const handledNow =', 'const chanNeeds =',
    'const chanUnread =', 'const actNeeds =', 'const actUnread =', 'const actMark =', 'const chanAt =', 'const ATT =', 'const attOf =', 'const STI_LAB =', 'const STI_TIP ='].map(line).join('\n')
    + '\nconst WosThreadTracker = { on: () => false, onFor: () => false };\n'
    + block('/* Draft marks (wizard-ux issue 1445', '// A row\'s marker, drawn just left')
    + '\nthis.rule = { actMark, actNeeds, actUnread, attOf, chanAt, isWorking, draftTag }; this.rowDraft = rowDraft; this.chanLineDraft = chanLineDraft;', c);
  // Chats › Inbox (wizard-ux issue 1779, on for everyone): the real chats-inboxrows.js part over the real rule above.
  c.WizCore = { chatsParts: {} }; vm.runInContext(read('web/core/chats-inboxrows.js'), c);
  const R = c.rule, ib = c.WizCore.chatsParts.inboxrows({ ...R, AGS: () => null, agentName: () => 'Wizard', agentRec: id => ({ id }), ago: c.ago,
    chanFace: n => ({ emoji: '💬', label: n, own: false }), chanStore: () => ({ channels: [] }), chatVars: { readyOrder: 'newest', secOpen: {} }, ch: c.ch, clip: c.clip,
    elOf: () => null, esc: c.esc, LIVE: c.WizLive, noteAt: c.noteAt, noteRow: c.noteRow, renderChatList: () => {}, rowAgent: () => 'hermes', spacesOf: () => [{ name: 'launch' }],
    threadAct: () => {}, toast: () => {}, W: {}, winAgent: () => '' });
  c.activityBody = ib.inboxRowsBody;
  return { c, L: c.WizLive, drafts: c.WosChat.drafts, events, repaints, storage, dataset };
}
// Each Activity row's id -> whether its preview line starts with the Draft mark.
function marks(d) {
  const html = d.c.activityBody({ id: 'w' }, d.L.sessions, null), out = {};
  for (const [, id, row] of html.matchAll(/data-morph-key="row:synthetic_1360_([a-z]+)">([^]*?)<\/button>/g))
    out[id] = /<span class="ch-ib-pv"><span class="ch-draft-tag"><span aria-hidden="true">✎<\/span> Draft<\/span> · /.test(row);
  return { out, order: [...html.matchAll(/data-morph-key="row:synthetic_1360_([a-z]+)"/g)].map(m => m[1]), html };
}
const drafted = d => Object.entries(marks(d).out).filter(([, v]) => v).map(([k]) => k);

test('Activity: the mark appears on the first keystroke, stays while typing, and leaves on send', async () => {
  const d = device(); await d.L.refresh();
  const before = marks(d);
  assert.deepEqual(drafted(d), [], 'no drafts, no marks');
  d.drafts.set('direct:' + GREEN, 'h', []); // first keystroke
  assert.deepEqual(d.events.filter(e => e === 'wos:drafts-keys').length, 1, 'the key gaining a draft is announced once');
  assert.deepEqual(drafted(d), ['green'], 'the row with the draft says Draft');
  for (const t of ['he', 'hel', 'hello']) d.drafts.set('direct:' + GREEN, t, []);
  assert.equal(d.events.filter(e => e === 'wos:drafts-keys').length, 1, 'more keystrokes announce nothing (no repaint per key)');
  const after = marks(d);
  assert.deepEqual(after.order, before.order, 'rows keep their order');
  assert.equal(after.html.split('data-sec=').length, before.html.split('data-sec=').length, 'same sections');
  assert.match(after.html, /<span class="ch-ib-from">launch<\/span>[^]*?<span class="ch-ib-pv"><span class="ch-draft-tag"><span aria-hidden="true">✎<\/span> Draft<\/span> · [^<]/, 'Draft sits ahead of the last message, under the tag line');
  d.drafts.clear('direct:' + GREEN); // send clears the thread's draft
  assert.equal(d.events.filter(e => e === 'wos:drafts-keys').length, 2, 'the draft going is announced');
  assert.deepEqual(drafted(d), [], 'sent: the mark is gone');
});

test('Activity: discard clears it, emptying the box clears it, and a draft survives a reload', async () => {
  const d = device(); await d.L.refresh();
  d.drafts.set('direct:' + NEEDS, 'half a thought', []);
  d.drafts.set('direct:' + GREEN, 'x', []); d.drafts.set('direct:' + GREEN, '   ', []); // typed, then deleted back to nothing
  assert.deepEqual(drafted(d), ['needs'], 'an emptied box is no draft');
  const again = device(d.storage); await again.L.refresh(); // reload: same device storage, fresh page
  assert.deepEqual(drafted(again), ['needs'], 'the mark is back after a reload');
  again.drafts.clear('direct:' + NEEDS); // Discard draft (chats.js discardDraft) clears the key
  assert.deepEqual(drafted(again), [], 'discarded: gone');
});

test('Activity: a draft that is only a file or only a reply card counts', async () => {
  const d = device(); await d.L.refresh();
  d.drafts.set('direct:' + GREEN, '', [{ id: 'file_1', name: 'a.png', mime: 'image/png', bytes: 3 }]);
  assert.equal(d.drafts.setReply('direct:' + NEEDS, { key: 'notif:n1', title: 'Reminder', message: 'Call back' }), true, 'the reply card is kept');
  const keys = d.drafts.keys();
  assert.ok(keys.has('direct:' + GREEN), 'files only');
  assert.ok(keys.has('direct:' + NEEDS), 'reply card only');
  assert.deepEqual(drafted(d).sort(), ['green', 'needs']);
  d.drafts.setReply('direct:' + NEEDS, null); // the card taken off an empty draft: no draft left
  assert.deepEqual(drafted(d), ['green']);
});

test('no switch (issue 1604): marks show with any or no data-tweaks, and the draft store is unchanged', async () => {
  for (const tweaks of ['', OTHER, 'wizard/draft-marks']) {
    const d = device(new Map(), { tweaks }); await d.L.refresh();
    d.drafts.set('direct:' + GREEN, 'words', []);
    assert.deepEqual(drafted(d), ['green'], JSON.stringify(tweaks) + ': marked');
    assert.equal(d.c.rowDraft({ id: GREEN }), true);
    assert.equal(d.drafts.get('direct:' + GREEN).text, 'words', 'drafts work as before');
  }
});

test('live: a draft appearing or going repaints the lists, never the window whose channel box is being typed in', async () => {
  const d = device(); await d.L.refresh();
  d.drafts.set('chan:hermes:launch', 'p', []);
  assert.deepEqual(d.repaints, ['list'], 'the Activity / Channels list repaints; the open feed and the thread do not');
  d.drafts.set('chan:hermes:launch', 'po', []);
  assert.deepEqual(d.repaints, ['list'], 'no repaint per keystroke');
  d.drafts.clear('chan:hermes:launch');
  assert.deepEqual(d.repaints, ['list', 'list']);
  d.dataset.tweaks = OTHER; d.drafts.set('chan:hermes:launch', 'q', []);
  assert.deepEqual(d.repaints, ['list', 'list', 'list'], 'no switch gates the repaint (issue 1604)');
});

test('issue 1709: a thread\'s draft repaints the open channel feed too (its post card follows); a channel box\'s draft still waits; the event names the keys', async () => {
  const d = device(); await d.L.refresh();
  const seen = []; d.c.addEventListener('wos:drafts-keys', e => seen.push([...(e.detail?.keys || [])]));
  d.drafts.set('direct:' + GREEN, 'h', []);
  assert.deepEqual(d.repaints, ['list', 'feed'], 'the Activity list and the feed whose thread card shows it; never the open thread');
  assert.deepEqual(seen.at(-1), ['direct:' + GREEN], 'the key that gained its draft');
  d.drafts.set('direct:' + GREEN, 'he', []);
  assert.deepEqual(d.repaints, ['list', 'feed'], 'no repaint per keystroke');
  d.drafts.set('chan:hermes:launch', 'p', []);
  assert.deepEqual(d.repaints, ['list', 'feed', 'list'], 'a channel box\'s draft leaves the feed being typed in alone');
  d.drafts.clear('direct:' + GREEN);
  assert.deepEqual(seen.at(-1), ['direct:' + GREEN], 'the key that lost its draft');
  assert.deepEqual(d.repaints, ['list', 'feed', 'list', 'list', 'feed'], 'sent or discarded: the feed repaints and the mark goes');
});

test('Channels: the pencil follows the box key of every agent kind (main, host, container, restricted, General, agent feed)', () => {
  const d = device();
  const cases = [
    [{ id: 'launch', agent: 'hermes' }, '', 'chan:hermes:launch'],
    [{ id: 'host-ops', agent: 'host' }, '', 'chan:host:host-ops'],
    [{ id: 'box', agent: 'container' }, '', 'chan:container:box'],
    [{ id: 'locked', agent: 'restricted' }, '', 'chan:restricted:locked'],
    [{ id: '__general__', general: true }, '', 'chan::__general__'],
    [{ id: '__general__', general: true }, 'host', 'chan:host:__general__'],
    [{ id: '@agent:container', agent: 'container' }, '', 'chan:container:@agent:container'],
  ];
  for (const [c0, ag, key] of cases) {
    assert.equal(d.c.chanLineDraft(c0, ag), false, key + ': no draft yet');
    d.drafts.set(key, 'w', []);
    assert.equal(d.c.chanLineDraft(c0, ag), true, key + ': marked');
    for (const [o, oag, okey] of cases) if (okey !== key) assert.equal(d.c.chanLineDraft(o, oag), false, `${okey} is not marked by ${key}`);
    d.drafts.clear(key);
    assert.equal(d.c.chanLineDraft(c0, ag), false, key + ': cleared');
  }
});

test('AI apps sidebar: Activity rows from the list model carry draft (no switch since issue 1604)', async () => {
  const d = device(); await d.L.refresh();
  const M = d.c.WizChatsListModel, chatsApi = { activityNeeds: () => false, activityUnread: () => false, activityDraft: s => d.c.rowDraft(s), threadActions: () => [], channelOf: () => 'launch', stiKind: () => '' };
  const list = () => M.activityList(d.L.workGroups(), { live: d.L, chats: chatsApi }, { now: Date.now() });
  const flat = l => ['working', 'ready', 'recent'].flatMap(k => l[k] || []);
  assert.ok(flat(list()).every(r => !('draft' in r)), 'no draft: no key (row shape unchanged)');
  d.drafts.set('direct:' + GREEN, 'w', []);
  assert.deepEqual(flat(list()).filter(r => r.draft).map(r => r.id), [GREEN]);
  d.dataset.tweaks = OTHER;
  assert.deepEqual(flat(list()).filter(r => r.draft).map(r => r.id), [GREEN], 'no switch gates it');
});

test('issue 1604: the wizard/draft-marks switch is gone everywhere; its CSS lives in core/chats.css', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json')), prof = JSON.parse(read('web/tweaks/wizard/profile.json'));
  for (const k of ['tweaks', 'defaults', 'promotedDefaults', 'lookOnlyOff']) assert.ok(!(cat[k] || []).includes('wizard/draft-marks'), k);
  assert.ok(!Object.keys(cat.aliases || {}).includes('wizard/draft-marks') && !(prof.off || []).includes('wizard/draft-marks') && !(prof.tweaks || []).includes?.('wizard/draft-marks'));
  assert.doesNotMatch(read('web/core/settings.js'), /draft-marks/, 'no Settings row');
  assert.doesNotMatch(read('web/core/chats-daily.js'), /draftMarksOn|DRAFT_MARKS/, 'no gate');
  assert.throws(() => read('web/tweaks/wizard/draft-marks/manifest.json'), 'package deleted');
  // its CSS: core chats.css styles every mark with no switch on the page (a skeleton of each mark's markup), and
  // colours come through tokens
  const css = read('web/core/chats.css'), doc = createDocument();
  doc.body.innerHTML = '<div class="ch-row"><span class="ch-draft-tag">✎ Draft</span></div><div class="ch-chan"><span class="ch-chan-draft">✎</span></div><div class="ch-post-r"><span class="ch-post-draft ch-draft-tag">✎ Draft</span></div>'
    + '<div class="aad-rw" data-draft="1"><span class="aad-chan-line">#launch</span></div><div class="aad-rw" data-draft="1"><span class="aad-draft-line"></span></div>';
  doc.documentElement.setAttribute('data-layout', 'ai-apps');
  const marks = [['.ch-row .ch-draft-tag'], ['.ch-chan-draft'], ['.ch-post-draft'], ['.aad-rw[data-draft] .aad-chan-line', '::before'], ['.aad-draft-line', '::before']];
  for (const [sel, pseudo] of marks) {
    const got = cascade(doc.querySelector(sel), css, { pseudo });
    assert.match(got.color?.value || got.content?.value || '', /wz-warning|✎/, `${sel}${pseudo || ''} is styled with no data-tweaks`);
    for (const [k, d] of Object.entries(got)) if (/colou?r|background|border/.test(k)) assert.doesNotMatch(d.value.replace(/var\(--wz-[a-z-]+, #[0-9a-f]+\)/g, ''), /#[0-9a-f]{3,6}\b/i, `${sel} ${k}: colours only through tokens`);
  }
  const noDraft = createDocument(); noDraft.documentElement.setAttribute('data-layout', 'ai-apps'); noDraft.body.innerHTML = '<div class="aad-rw"><span class="aad-chan-line">#launch</span></div>';
  assert.equal(cascade(noDraft.querySelector('.aad-chan-line'), css, { pseudo: '::before' }).content, undefined, 'a channel line without a draft has no pencil');
});

test('on by default, main and routed rows alike: a thread of the main agent, host, container or restricted is marked by the same draft key its box saves under (direct:<id>)', async () => {
  const d = device(); await d.L.refresh();
  for (const agent of [undefined, 'host', 'container', 'restricted']) {
    const s = { id: 'routed_' + (agent || 'main'), ...(agent ? { agent, owner: agent } : {}) };
    assert.equal(d.c.rowDraft(s), false, (agent || 'main') + ': no draft, no mark');
    d.drafts.set('direct:' + s.id, 'words', []);
    assert.equal(d.c.rowDraft(s), true, (agent || 'main') + ': its draft marks it');
    d.drafts.clear('direct:' + s.id);
    assert.equal(d.c.rowDraft(s), false, (agent || 'main') + ': sent, gone');
  }
});
