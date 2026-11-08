// A chat reply can carry a tweak (James, 6 Nov 2026): [WIZARD_TWEAK_V1]{"id":"…"}[/WIZARD_TWEAK_V1] on its own line draws
// Settings › Look's own switch row in the message, live-bound to WosExperience (current state, never the state at send
// time). The marker never shows as text, in copy, in the Chats preview or in a streaming answer.
import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const chats = read('web/core/chats.js'), settings = read('web/core/settings.js');
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} .. ${b}`); return src.slice(i, j); };

const kitCtx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
kitCtx.window = kitCtx; modelContext(kitCtx); vm.runInContext(read('web/core/chat-kit.js'), kitCtx);
const KIT = kitCtx.WosChat;
const MARK = id => `[WIZARD_TWEAK_V1]{"id":"${id}"}[/WIZARD_TWEAK_V1]`;
const reply = `Shipped the phone list. It starts off.\n\n${MARK('wizard/desktop-chats')}\n\nSay if it reads right.`;
const rows = content => [{ role: 'user', timestamp: 1, content: 'Ship it' }, { role: 'assistant', timestamp: 2, content }];

test('marker: parsed into the answer\'s tweak ids and stripped from its text and copy text', () => {
  const [tn] = KIT.parseRows(rows(reply));
  assert.deepEqual([...tn.a.tweaks], ['wizard/desktop-chats']);
  for (const t of [tn.a.text, tn.a.plainText]) { assert.doesNotMatch(t, /WIZARD_TWEAK|desktop-chats/); assert.match(t, /starts off\.\n\nSay if/); }
  assert.deepEqual([...KIT.tweakIds('[WIZARD_TWEAK_V1]{"ids":["miguel/ai-apps","wizard/desktop-chats","miguel/ai-apps"]}[/WIZARD_TWEAK_V1]')], ['miguel/ai-apps', 'wizard/desktop-chats']);
});

test('marker: malformed or unsafe ids are hidden, never shown; a reply without one is unchanged', () => {
  for (const bad of ['[WIZARD_TWEAK_V1]{nope[/WIZARD_TWEAK_V1]', '[WIZARD_TWEAK_V1]{"id":"<b>x</b>"}[/WIZARD_TWEAK_V1]', '[WIZARD_TWEAK_V1]{"id":"../../x"}[/WIZARD_TWEAK_V1]']) {
    const [tn] = KIT.parseRows(rows(`Done.\n${bad}`));
    assert.equal(tn.a.text, 'Done.'); assert.equal(tn.a.tweaks, undefined);
  }
  const [plain] = KIT.parseRows(rows('Done.'));
  assert.ok(!('tweaks' in plain.a));
});

test('marker: a card-only reply still lands, and a later message in the same turn keeps the card', () => {
  const [only] = KIT.parseRows(rows(MARK('wizard/desktop-chats')));
  assert.deepEqual([...only.a.tweaks], ['wizard/desktop-chats']); assert.equal(only.a.text, '');
  const [two] = KIT.parseRows([{ role: 'user', timestamp: 1, content: 'Go' }, { role: 'assistant', timestamp: 2, content: `First.\n${MARK('wizard/desktop-chats')}` }, { role: 'assistant', timestamp: 3, content: 'Second.' }]);
  assert.equal(two.a.text, 'Second.'); assert.deepEqual([...two.a.tweaks], ['wizard/desktop-chats']);
});

test('marker: stripped from the Chats preview (live.js) and from a streaming answer, also while half typed', () => {
  const live = read('web/live.js');
  const ctx = { chipLabel: () => ' ' };
  vm.runInNewContext(between(live, '  const clean = s =>', '\n\n') + '\nglobalThis.clean = clean;', ctx);
  assert.equal(ctx.clean(reply), 'Shipped the phone list. It starts off. Say if it reads right.');
  const st = {};
  vm.runInNewContext(between(chats, '  const assistantStamp =', '  function closeStream(c)') + '\nglobalThis.cleanStream = streamAnswer;', st);
  assert.equal(st.cleanStream(reply), 'Shipped the phone list. It starts off.\n\nSay if it reads right.');
  assert.equal(st.cleanStream('Shipped.\n[WIZARD_TWEAK_V1]{"id":"wiz'), 'Shipped.');
  for (let n = 1; n <= 17; n++) assert.equal(st.cleanStream('Shipped.\n' + '[WIZARD_TWEAK_V1]'.slice(0, n)), 'Shipped.');
});

// The card itself: Settings' tweakSwitches + the card block, over a fake WosExperience.
function cardKit({ tweaks, shell = 'phone', busy = false, toggle }) {
  const calls = [], cards = [];
  const E = { state: null, toggle: id => { calls.push(id); return toggle ? toggle(id) : Promise.resolve(); }, authors: async () => [{ id: 'wizard', name: 'Wizard' }] };
  const setState = patch => { E.state = { shell, busy, error: '', tweaks, ...patch }; };
  setState({});
  const doc = { activeElement: null, querySelectorAll: q => q === '[data-chat-tweak-card]' ? cards : [] };
  const ctx = { window: { WosExperience: E }, document: doc, esc: KIT.esc, authorList: [{ id: 'wizard', name: 'Wizard' }] };
  vm.runInNewContext(`${between(settings, '  const tweakSwitches = ', '\n')}\n${between(settings, '  const cardPending = ', '  const newTile')}\nglobalThis.api = { tweakCard, tweakCardTap, paintTweakCards, tweakSwitches };`, ctx);
  return { ...ctx.api, E, calls, cards, setState, ctx };
}
const desktopChats = { id: 'wizard/desktop-chats', name: 'Desktop-style Chats list', description: 'One quiet line per chat.', author: 'wizard', builtin: false, layout: '', view: '', shells: ['phone'] };

test('card: the same switch row as Settings › Look, showing the CURRENT state (off, then on)', () => {
  const k = cardKit({ tweaks: [{ ...desktopChats, on: false }] });
  const off = k.tweakCard(['wizard/desktop-chats']);
  assert.ok(off.startsWith('<div class="ch-tweak" data-chat-tweak-card="wizard/desktop-chats" role="group" aria-label="Tweak">'));
  // Byte-for-byte Look's row (same helper), only the data attribute differs.
  assert.ok(off.includes(k.tweakSwitches([{ ...desktopChats, on: false, where: '' }], 'data-chat-tweak', false, w => w === 'wizard' ? 'Wizard' : w)));
  assert.match(off, /role="switch" aria-checked="false"/); assert.match(off, /class="sw "/); assert.match(off, /by Wizard/);
  k.setState({ tweaks: [{ ...desktopChats, on: true }] });
  assert.match(k.tweakCard(['wizard/desktop-chats']), /aria-checked="true"[^]*class="sw on"/, 'a message is history: the card follows today\'s state');
});

test('card: an unknown id is a quiet line, no switch; loading says so; another shell\'s tweak is disabled and labelled', () => {
  const k = cardKit({ tweaks: [{ ...desktopChats, on: false }], shell: 'desktop' });
  const gone = k.tweakCard(['wizard/not-here']);
  assert.match(gone, /This tweak isn’t installed on this Wizard/); assert.doesNotMatch(gone, /role="switch"|class="sw/);
  k.setState({ tweaks: [] }); assert.match(k.tweakCard(['wizard/not-here']), /Loading tweak…/);
  k.setState({ tweaks: [{ ...desktopChats, on: false }] });
  const other = k.tweakCard(['wizard/desktop-chats']);
  assert.match(other, /role="switch" aria-checked="false" disabled>/); assert.match(other, /<small class="tw-by">Phone only · by Wizard<\/small>/);
  k.setState({ tweaks: [{ ...desktopChats, shells: ['desktop'], on: false }], shell: 'phone' });
  assert.match(k.tweakCard(['wizard/desktop-chats']), /Desktop only · by Wizard/);
  assert.doesNotMatch(k.tweakCard(['wizard/desktop-chats']).replace(/<small class="tw-by">[^<]*<\/small>/, ''), /only/);
});

function fakeButton(id, on) {
  const sw = { cls: new Set(on ? ['sw', 'on'] : ['sw']), classList: null };
  sw.classList = { toggle: (c, v) => (v ? sw.cls.add(c) : sw.cls.delete(c)) };
  const attrs = { 'aria-checked': String(on) };
  return { dataset: { chatTweak: id }, disabled: false, sw, getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }, querySelector: q => q === '.sw' ? sw : null };
}
const fakeCard = ids => ({ dataset: { chatTweakCard: ids }, innerHTML: '', contains: () => false, querySelectorAll: () => [] });

test('card tap: paints the flipped switch on the tap\'s own frame, calls WosExperience.toggle exactly once, then reconciles', async () => {
  let settle; const k = cardKit({ tweaks: [{ ...desktopChats, on: false }], toggle: () => new Promise(r => { settle = r; }) });
  const a = fakeCard('wizard/desktop-chats'), b = fakeCard('wizard/desktop-chats'); k.cards.push(a, b);
  const btn = fakeButton('wizard/desktop-chats', false);
  assert.equal(k.tweakCardTap(btn), true);
  assert.equal(btn.getAttribute('aria-checked'), 'true'); assert.ok(btn.sw.cls.has('on'), 'flipped synchronously, before any await');
  for (const c of [a, b]) assert.match(c.innerHTML, /aria-checked="true"/, 'every card naming it repaints on the same frame');
  assert.equal(k.tweakCardTap(btn), false, 'a second tap while pending is not a second toggle');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(k.calls, ['wizard/desktop-chats']);
  k.setState({ tweaks: [{ ...desktopChats, on: true }] }); settle();
  await new Promise(r => setTimeout(r, 0));
  for (const c of [a, b]) assert.match(c.innerHTML, /aria-checked="true"[^]*class="sw on"/);
});

test('card tap: a failed toggle reverts to the real state with the toast', async () => {
  const toasts = []; const k = cardKit({ tweaks: [{ ...desktopChats, on: false }], toggle: () => Promise.reject(new Error('Couldn’t load that tweak')) });
  const card = fakeCard('wizard/desktop-chats'); k.cards.push(card);
  k.tweakCardTap(fakeButton('wizard/desktop-chats', false), (i, t) => toasts.push([i, t]));
  assert.match(card.innerHTML, /aria-checked="true"/);
  await new Promise(r => setTimeout(r, 0));
  assert.match(card.innerHTML, /aria-checked="false"/); assert.deepEqual(toasts, [['!', 'Couldn’t load that tweak']]);
});

test('card stays in sync with Look and other cards: one wos:experience listener repaints every card', () => {
  assert.match(settings, /window\.addEventListener\?\.\('wos:experience', \(\) => \{ for \(const m of mounts\) m\.render\(\); paintTweakCards\(\); \}\);/);
  const k = cardKit({ tweaks: [{ ...desktopChats, on: false }] });
  const card = fakeCard('wizard/desktop-chats'); k.cards.push(card);
  k.paintTweakCards(); assert.match(card.innerHTML, /aria-checked="false"/);
  k.setState({ tweaks: [{ ...desktopChats, on: true }] }); k.paintTweakCards(); assert.match(card.innerHTML, /aria-checked="true"/);
  k.setState({ busy: true, tweaks: [{ ...desktopChats, on: true }] }); k.paintTweakCards(); assert.match(card.innerHTML, /disabled>/, 'busy like Look');
});

test('wiring: Chats draws the card inside the reply and routes its tap; WosSettings exports the one implementation', () => {
  assert.match(chats, /const tweak = tn\.a\?\.tweaks\?\.length \? window\.WosSettings\?\.tweakCard\?\.\(tn\.a\.tweaks\) \|\| '' : '';/);
  assert.match(chats, /<div class="bub">\$\{shown\}\$\{tweak\}\$\{mediaBlock\(/);
  assert.match(chats, /closest\('\[data-chat-tweak\]'\); if \(twk\) \{ window\.WosSettings\?\.tweakCardTap\?\.\(twk,/);
  assert.match(settings, /window\.WosSettings = \{[^\n]*\btweakCard, tweakCardTap,/);
  assert.equal((settings.match(/class="st-row tw-row"/g) || []).length, 1, 'one switch-row markup, shared');
  const css = read('web/core/chats.css'), rule = css.slice(css.indexOf('.msg.a .ch-tweak {'), css.indexOf('}', css.indexOf('.msg.a .ch-tweak {')));
  assert.match(rule, /background: linear-gradient\(var\(--wz-surface\), var\(--wz-surface\)\), var\(--wz-panel, var\(--wz-base, var\(--bg\)\)\)/, 'text-bearing card is opaque (base.css always defines --bg)');
  assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgba?\(/i, '--wz-* tokens only');
});

test('experience state names the shells a non-view tweak declares (so the card can say Phone only)', () => {
  const src = read('web/core/experience.js');
  assert.match(src, /: Array\.isArray\(manifests\.get\(t\.id\)\?\.shells\) \? \{ \.\.\.t, shells: shellsOf\(t\.id\) \} : t\)\.map\(t => locked\(\) && !t\.builtin && !t\.view \? \{ \.\.\.t, on: false, locked: true \} : t\), locked: locked\(\), channel \}\);/);
});

test('marker: a reply cut off inside an unterminated marker never shows the protocol text (saved text, copy, preview)', () => {
  const cut = 'Shipped the phone list. It starts off.\n\n[WIZARD_TWEAK_V1]{"id":"wizard/desk';
  const [tn] = KIT.parseRows(rows(cut));
  for (const t of [tn.a.text, tn.a.plainText]) { assert.doesNotMatch(t, /WIZARD_TWEAK|wizard\/desk/); assert.match(t, /starts off\./); }
  assert.equal([...(tn.a.tweaks || [])].length, 0, 'no card from a half marker');
  const ctx = { chipLabel: () => ' ' };
  vm.runInNewContext(between(read('web/live.js'), '  const clean = s =>', '\n\n') + '\nglobalThis.clean = clean;', ctx);
  assert.equal(ctx.clean(cut), 'Shipped the phone list. It starts off.');
});


// Agent chat parity (AGENTS.md; wizard-agent-service qa/agent-parity/features.json "chat-tweak-card"): the same reply in a
// main thread and in host-profile, container and restricted routed threads gives the same card, the same tap and the
// same clean Chats preview. Routed ids and agent pins as the Service sends them (tests/chat-pins.test.mjs KINDS).
const ROUTES = { main: ['wizard_1793157258294_34b4a71ae61a', ''], 'host-profile': ['20261028_101500_ab12cd', 'qa-host-profile'],
  container: ['agent-research:20261028_101501_ef34', 'agent-research'], restricted: ['restricted.vault_20261028-101502', 'restricted.vault'] };
function listNormalizer() {
  const live = read('web/live.js'), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  assert.ok(a > 0 && b > a, 'live.js normalizer block found');
  const context = modelContext({});
  vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}
test('parity: main and routed threads (host-profile, container, restricted) get the same card, tap and preview', async () => {
  const normalize = listNormalizer(), seen = new Map();
  for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
    const history = rows(reply).map(r => ({ ...r, session_id: sid, ...(agent ? { agent } : {}) }));
    const [tn] = KIT.parseRows(history);
    assert.deepEqual([...tn.a.tweaks], ['wizard/desktop-chats'], `${kind}: tweak parsed from history`);
    assert.doesNotMatch(tn.a.text + tn.a.plainText, /WIZARD_TWEAK|desktop-chats/, `${kind}: marker hidden in thread and copy`);
    const k = cardKit({ tweaks: [{ ...desktopChats, on: false }] });
    const html = k.tweakCard(tn.a.tweaks);
    assert.match(html, /role="switch" aria-checked="false"/, kind);
    const card = fakeCard('wizard/desktop-chats'); k.cards.push(card);
    assert.equal(k.tweakCardTap(fakeButton('wizard/desktop-chats', false)), true, `${kind}: tap accepted`);
    assert.match(card.innerHTML, /aria-checked="true"/, `${kind}: painted on the tap's frame`);
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(k.calls, ['wizard/desktop-chats'], `${kind}: one toggle`);
    const full = normalize({ id: sid, title: 'Synthetic', status: 'completed', ...(agent ? { agent } : {}), latest_message: { role: 'assistant', content: reply, timestamp: 2 } });
    assert.equal(full.agent, agent, `${kind}: row keeps its agent`);
    assert.equal(full.preview, 'Shipped the phone list. It starts off. Say if it reads right.', `${kind}: full-list preview`);
    // The slim list arrives already cleaned by the Service (wizard-agent-service tests/session-list-view.node.mjs).
    const slim = normalize({ listVersion: 1, id: sid, status: 'completed', agent, preview: full.preview });
    assert.equal(slim.preview, full.preview, `${kind}: slim-list preview`);
    seen.set(kind, html);
  }
  assert.equal(new Set(seen.values()).size, 1, 'byte-identical card for every runtime kind');
});
