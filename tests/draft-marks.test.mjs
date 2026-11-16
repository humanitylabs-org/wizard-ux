// Draft marks (switch wizard/draft-marks, wizard-ux issue 1445): an Activity row whose thread has a saved, unsent draft
// says "✎ Draft" ahead of its preview, and a Channels line whose box holds one wears the same pencil. This runs the real
// drafts store (core/chat-kit.js), the real Activity renderer (chats.js activityBody -> chatRow) over the real live.js
// list read, the real Channels list (chats.js channelsBody) and the real list model rows the AI apps sidebar draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const kitSrc = read('web/core/chat-kit.js'), live = read('web/live.js'), chats = read('web/core/chats.js');
const RAW = JSON.parse(read('tests/fixtures/sessions-list-1360.json'));
const SHIFT = Date.now() - 5 * 60e3 - Math.max(...RAW.data.map(s => Date.parse(s.activityAt)));
const shift = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? new Date(Date.parse(v) + SHIFT).toISOString() : Array.isArray(v) ? v.map(shift) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)])) : v;
const PAYLOAD = shift(RAW);
const ON = 'wizard/chat-channels wizard/draft-marks', OFF = 'wizard/chat-channels';
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
  Object.assign(c, { KIT: c.WosChat, CHAN_SWITCH: 'wizard/chat-channels', LIVE: c.WizLive, snoozeLast: () => false, deferredOf: s => !!s.deferred && !s.archived,
    readyOrder: 'newest', SEC_PAGE: 40, secOpen: { working: true, ready: true, recent: true }, ch: () => ({ more: {} }), noteRow: () => '', noteAt: () => 0,
    STI: new Proxy({}, { get: () => '' }), esc: v => String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]),
    clip: (v, n) => String(v ?? '').slice(0, n), ago: () => '1m', workLabel: () => 'Working', privRow: () => false, AGS: () => null, topicOn: () => false,
    TOPIC: null, subjectOf: () => '', PIN: { has: () => false, on: () => true }, BOOM: () => null, PIN_SVG: '', chanName: () => 'launch', agentTail: () => '',
    // the list windows the repaint walks: one Activity list, one channel feed (its box is being typed in), one thread
    CH: { list: {}, feed: {}, thread: {} }, W: { list: { id: 'list' }, feed: { id: 'feed', feedOpen: true }, thread: { id: 'thread', thread: 's1' } },
    chanOpen: w => w.feedOpen ? { id: 'launch' } : null, chanElsewhere: () => false, holdList: () => false, elOf: id => ({ id }),
    renderChatList: w => repaints.push(w.id) });
  vm.runInContext(['const WORKING_ST =', 'const isWorking =', 'const channelsOn =', 'const markDoneOn =', 'const handledNow =', 'const chanNeeds =',
    'const chanUnread =', 'const actNeeds =', 'const actUnread =', 'const actMark =', 'const chanAt =', 'const ATT =', 'const attOf =', 'const STI_LAB =', 'const STI_TIP ='].map(line).join('\n')
    + '\nconst WosThreadTracker = { on: () => false, onFor: () => false };\n'
    + block('/* Draft marks (wizard-ux issue 1445', '// A row\'s marker at its right end') + block('function actRowMark(s)', '// A thread of an agent other') + block('function stiKind(s)', 'const stiBadge =') + block('function chatRow(s', '/* Ready has three orders')
    + block('const ACT_SORTS = () =>', '// The sort and Show older taps').replace('let actOlder = false;', 'let actOlder = false, rowChan = true;')
    + '\nthis.activityBody = activityBody; this.rowDraft = rowDraft; this.chanLineDraft = chanLineDraft;', c);
  return { c, L: c.WizLive, drafts: c.WosChat.drafts, events, repaints, storage, dataset };
}
// Each Activity row's id -> whether its preview line starts with the Draft mark.
function marks(d) {
  const html = d.c.activityBody({ id: 'w' }, d.L.sessions, null), out = {};
  for (const [, id, row] of html.matchAll(/data-morph-key="row:synthetic_1360_([a-z]+)">([^]*?)<\/button>/g))
    out[id] = /<span class="pv">(<span class="ch-chan-tag">[^]*?<\/span> · )?<span class="ch-draft-tag"><span aria-hidden="true">✎<\/span> Draft<\/span> · /.test(row);
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
  assert.match(after.html, /<span class="ch-chan-tag"># launch<\/span> · <span class="ch-draft-tag"><span aria-hidden="true">✎<\/span> Draft<\/span> · /, 'Draft sits ahead of the last message, after the channel');
  assert.match(after.html, /<span class="ch-chan-line"><span class="ch-draft-tag"><span aria-hidden="true">✎<\/span> Draft<\/span> · # launch<\/span>/, 'the phone\'s one-line row (channel line only) leads with it too');
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

test('switch off: no marks, and the draft store is unchanged', async () => {
  const d = device(new Map(), { tweaks: OFF }); await d.L.refresh();
  d.drafts.set('direct:' + GREEN, 'words', []);
  assert.deepEqual(drafted(d), [], 'off: no Draft tag');
  assert.equal(d.c.rowDraft({ id: GREEN }), false);
  assert.equal(d.drafts.get('direct:' + GREEN).text, 'words', 'drafts work as before');
  assert.doesNotMatch(marks(d).html, /ch-draft-tag/);
});

test('live: a draft appearing or going repaints the lists, never the window whose channel box is being typed in', async () => {
  const d = device(); await d.L.refresh();
  d.drafts.set('chan:hermes:launch', 'p', []);
  assert.deepEqual(d.repaints, ['list'], 'the Activity / Channels list repaints; the open feed and the thread do not');
  d.drafts.set('chan:hermes:launch', 'po', []);
  assert.deepEqual(d.repaints, ['list'], 'no repaint per keystroke');
  d.drafts.clear('chan:hermes:launch');
  assert.deepEqual(d.repaints, ['list', 'list']);
  d.dataset.tweaks = OFF; d.drafts.set('chan:hermes:launch', 'q', []);
  assert.deepEqual(d.repaints, ['list', 'list'], 'switch off: no repaints');
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

test('AI apps sidebar: Activity rows from the list model carry draft only while the switch is on', async () => {
  const d = device(); await d.L.refresh();
  const M = d.c.WizChatsListModel, chatsApi = { activityNeeds: () => false, activityUnread: () => false, activityDraft: s => d.c.rowDraft(s), threadActions: () => [], channelOf: () => 'launch', stiKind: () => '' };
  const list = () => M.activityList(d.L.workGroups(), { live: d.L, chats: chatsApi }, { now: Date.now() });
  const flat = l => ['working', 'ready', 'recent'].flatMap(k => l[k] || []);
  assert.ok(flat(list()).every(r => !('draft' in r)), 'no draft: no key (row shape unchanged)');
  d.drafts.set('direct:' + GREEN, 'w', []);
  assert.deepEqual(flat(list()).filter(r => r.draft).map(r => r.id), [GREEN]);
  d.dataset.tweaks = OFF;
  assert.deepEqual(flat(list()).filter(r => r.draft).map(r => r.id), [], 'off');
});

test('the switch is a listed, off-by-default tweak package', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes('wizard/draft-marks'));
  assert.ok(!cat.defaults.includes('wizard/draft-marks'));
  const m = JSON.parse(read('web/tweaks/wizard/draft-marks/manifest.json'));
  assert.equal(m.id, 'wizard/draft-marks'); assert.match(m.description, /issue 1445/);
  const css = read('web/tweaks/wizard/draft-marks/tweak.css');
  for (const rule of css.split('}').map(r => r.trim()).filter(r => r && !r.startsWith('/*'))) assert.match(rule.replace(/^\/\*[^]*?\*\/\s*/, ''), /^html\[data-tweaks~="wizard\/draft-marks"\]/, rule);
  assert.doesNotMatch(css.replace(/var\(--wz-[a-z-]+, #[0-9a-f]+\)/g, ''), /#[0-9a-f]{3,6}\b/i, 'colours only through --wz-* tokens (with a dark fallback)');
});
