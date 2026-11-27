// Tap-to-answer buttons inside agent replies (wizard-ux issue 1889, switch wizard/reply-buttons). The agent writes
// [WIZARD_BUTTONS_V1]{"group","buttons":[{"id","label"}]}[/WIZARD_BUTTONS_V1] lines; the reply draws each group where
// it sits; taps within a few seconds go back as ONE owner message carrying [WIZARD_TAPS_V1]{"taps":[...]}; the picked
// state is read back from the thread's own history. Runs the real chat-kit.js, action-cards.js and live.js normalizer.
import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withLiveParts } from './fixtures/live-parts.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const GROUP = (group, ...labels) => `[WIZARD_BUTTONS_V1]${JSON.stringify({ group, buttons: labels.map(l => ({ id: l.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: l })) })}[/WIZARD_BUTTONS_V1]`;
const REPLY = `Two things today.\n\n**Ship desks?** I tested both layouts.\n${GROUP('Ship desks', 'Go for it', 'Drop this')}\n\n**Morning**\n1. Workout\n${GROUP('Workout', 'Done')}\n\nThat's all.`;
const rows = (content, extra = []) => [{ role: 'user', timestamp: 1, content: 'What is up today?' }, { id: 41, role: 'assistant', timestamp: 2, content }, ...extra];

function world({ on = true } = {}) {
  const docEl = { dataset: { tweaks: on ? 'wizard/reply-buttons' : '' } };
  const ctx = { URL, Intl, Date, JSON, Promise, Map, Set, navigator: {}, setTimeout, clearTimeout, CSS: { escape: s => String(s) },
    location: { origin: 'https://box.example', href: 'https://box.example/wizard-os-home/' },
    document: { documentElement: docEl, activeElement: null, visibilityState: 'visible', addEventListener() {}, querySelector() { return null; }, querySelectorAll: () => [] },
    addEventListener() {} };
  ctx.window = ctx; modelContext(ctx);
  vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-kit.js'), ctx);
  vm.runInContext(read('web/core/action-cards.js'), ctx);
  return { KIT: ctx.WosChat, AC: ctx.WosActionCards, docEl };
}
// A tapped button as core/chats-bind.js hands it over: its group box carries the message and group.
const button = (msg, group, id, label, pressed = false) => {
  const box = { dataset: { rbMsg: msg, rbGroup: group } };
  return { dataset: { rb: id }, textContent: (pressed ? '✓ ' : '') + label, disabled: false, getAttribute: a => a === 'aria-pressed' ? String(pressed) : null, closest: q => q === '.ch-rb' ? box : null };
};
const md = s => `<p>${s.replace(/\n+/g, ' ')}</p>`;

test('marker: groups parsed in place, the plain text keeps their labels, a reply without it is unchanged', () => {
  const { KIT } = world();
  const [tn] = KIT.parseRows(rows(REPLY));
  assert.deepEqual(clone(tn.a.buttons), [
    { group: 'Ship desks', buttons: [{ id: 'go-for-it', label: 'Go for it' }, { id: 'drop-this', label: 'Drop this' }], msg: '41' },
    { group: 'Workout', buttons: [{ id: 'done', label: 'Done' }], msg: '41' }]);
  for (const t of [tn.a.text, tn.a.plainText]) {
    assert.doesNotMatch(t, /WIZARD_BUTTONS|"group"/, 'no marker text');
    assert.match(t, /I tested both layouts\.\n\nShip desks: \[Go for it\] \[Drop this\]\n\n\*\*Morning\*\*\n1\. Workout\n\nWorkout: \[Done\]\n\nThat's all\./, 'the ask and its labels as text where the buttons sit');
  }
  assert.deepEqual(tn.a.btext.split('\n').filter(l => KIT.RB_TOKEN.test(l)).map(l => KIT.RB_TOKEN.exec(l)[1]), ['0', '1'], 'one token line per group, in order');
  const plain = KIT.parseRows(rows('Nothing to tap.'))[0];
  assert.ok(!('buttons' in plain.a) && !('btext' in plain.a)); assert.equal(plain.a.text, 'Nothing to tap.');
  // no id in the history row: the message is named by its time
  assert.equal(KIT.parseRows([{ role: 'assistant', timestamp: 5, content: GROUP('A', 'Yes') }])[0].a.buttons[0].msg, 't5000');
});

test('marker: bad groups are dropped (hidden), 1 to 6 buttons, unique groups, cut-off marker hidden', () => {
  const { KIT } = world();
  const seven = `[WIZARD_BUTTONS_V1]${JSON.stringify({ group: 'Many', buttons: Array.from({ length: 7 }, (_, i) => ({ id: 'b' + i, label: 'B' + i })) })}[/WIZARD_BUTTONS_V1]`;
  assert.equal(KIT.buttonGroups(seven)[0].buttons.length, 6);
  for (const bad of ['[WIZARD_BUTTONS_V1]{nope[/WIZARD_BUTTONS_V1]', `[WIZARD_BUTTONS_V1]${JSON.stringify({ group: '', buttons: [{ id: 'a', label: 'A' }] })}[/WIZARD_BUTTONS_V1]`,
    `[WIZARD_BUTTONS_V1]${JSON.stringify({ group: 'G', buttons: [{ id: '../x', label: 'A' }, { id: 'b', label: ' ' }] })}[/WIZARD_BUTTONS_V1]`]) {
    const [tn] = KIT.parseRows(rows(`Done.\n${bad}`));
    assert.equal(tn.a.text, 'Done.', bad); assert.ok(!('buttons' in tn.a), bad);
  }
  assert.equal(KIT.buttonGroups(GROUP('Same', 'A') + GROUP('Same', 'B')).length, 1);
  assert.equal(KIT.parseRows(rows('Pick one:\n[WIZARD_BUTTONS_V1]{"group":"x","butt'))[0].a.text, 'Pick one:', 'mid-stream marker hidden');
});

test('switch on: each group is drawn where it sits, plain buttons, nothing picked yet', () => {
  const { KIT, AC } = world();
  const [tn] = KIT.parseRows(rows(REPLY));
  const html = AC.replyHtml(tn.a.btext, tn.a.buttons, md, AC.replyPicks([tn], 's1'));
  const order = ['I tested both layouts', 'data-rb-group="Ship desks"', 'Morning', 'data-rb-group="Workout"', 'That&#39;s all'].map(x => html.indexOf(x.replace('&#39;', "'")) >= 0 ? html.indexOf(x.replace('&#39;', "'")) : html.indexOf(x));
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), 'groups between the text, in place: ' + order);
  assert.equal((html.match(/<button /g) || []).length, 3);
  assert.doesNotMatch(html, /aria-pressed="true"|disabled|WIZARD_|\[Go for it\]/);
  assert.match(html, /<button type="button" class="ch-rb-btn" data-rb="go-for-it" aria-pressed="false">Go for it<\/button>/);
});

test('taps: one in each group within the batch window go as ONE message naming both; the tap shows at once', async () => {
  const { KIT, AC } = world(), sent = [], painted = [];
  const ctx = { sid: 's1', send: async text => { sent.push(text); return { id: 'ob1' }; }, repaint: () => painted.push(1) };
  assert.equal(AC.replyTap(button('41', 'Ship desks', 'go-for-it', 'Go for it'), ctx), true);
  assert.equal(AC.replyTap(button('41', 'Workout', 'done', 'Done'), ctx), true);
  assert.equal(sent.length, 0, 'nothing sent before the batch window ends');
  assert.equal(painted.length, 2, 'each tap repaints on its own frame');
  const [tn] = KIT.parseRows(rows(REPLY));
  const now = AC.replyHtml(tn.a.btext, tn.a.buttons, md, AC.replyPicks([tn], 's1'));
  assert.match(now, /class="ch-rb-btn on" data-rb="go-for-it" aria-pressed="true">✓ Go for it/);
  assert.match(now, /class="ch-rb-btn dim" data-rb="drop-this" aria-pressed="false">Drop this/);
  assert.match(now, /class="ch-rb-btn on" data-rb="done" aria-pressed="true">✓ Done/);
  await AC.replyFlush('s1');
  assert.equal(sent.length, 1, 'two taps, one turn');
  assert.match(sent[0], /^Tapped Go for it · Ship desks\nTapped Done · Workout\n\[WIZARD_TAPS_V1\]/);
  assert.deepEqual(clone(KIT.tapsOf(sent[0]).taps), [
    { thread: 's1', message: '41', group: 'Ship desks', button: 'go-for-it', label: 'Go for it' },
    { thread: 's1', message: '41', group: 'Workout', button: 'done', label: 'Done' }]);
});

test('taps: changing a group inside the window keeps only the last pick; the batch sends by itself after 3 s', async () => {
  const { KIT, AC } = world(), sent = [];
  const ctx = { sid: 's2', send: async text => { sent.push(text); return { id: 'ob' }; } };
  AC.replyTap(button('41', 'Ship desks', 'go-for-it', 'Go for it'), ctx);
  AC.replyTap(button('41', 'Ship desks', 'drop-this', 'Drop this'), ctx);
  await new Promise(r => setTimeout(r, 3300));
  assert.equal(sent.length, 1);
  assert.deepEqual(clone(KIT.tapsOf(sent[0]).taps).map(t => t.button), ['drop-this']);
});

test('history: the picked state comes back on reload and on a second device; locked once the agent answered', () => {
  const tapMsg = AC0 => AC0.replyMessage([{ thread: 's3', message: '41', group: 'Workout', button: 'done', label: 'Done' }]);
  const a = world(), b = world(); // two devices, one history
  const history = rows(REPLY, [{ id: 42, role: 'user', timestamp: 3, content: tapMsg(a.AC) }]);
  for (const { KIT, AC } of [a, b]) {
    const turns = KIT.parseRows(history);
    assert.equal(turns.length, 2, 'the tap message is its own turn');
    assert.deepEqual(clone(turns[1].u.taps).map(t => t.label), ['Done']);
    assert.equal(turns[1].u.text, 'Tapped Done · Workout', 'readable line, no marker');
    const html = AC.replyHtml(turns[0].a.btext, turns[0].a.buttons, md, AC.replyPicks(turns, 's3'));
    assert.match(html, /aria-pressed="true">✓ Done<\/button>/);
    assert.doesNotMatch(html, /disabled/, 'the agent has not acted yet: still changeable');
    assert.match(html, /data-rb-group="Ship desks"[^>]*><span class="ch-rb-ask" aria-hidden="true">Ship desks<\/span>(<button[^>]*aria-pressed="false"[^>]*>[^<]*<\/button>){2}/, 'other group untouched');
  }
  const answered = a.KIT.parseRows([...history, { id: 43, role: 'assistant', timestamp: 4, content: 'Logged your workout.' }]);
  const locked = a.AC.replyHtml(answered[0].a.btext, answered[0].a.buttons, md, a.AC.replyPicks(answered, 's3'));
  assert.match(locked, /class="ch-rb picked locked"[^>]*data-rb-group="Workout"/);
  assert.match(locked, /aria-pressed="true" disabled>✓ Done/);
  assert.doesNotMatch(locked.slice(0, locked.indexOf('Workout')), /disabled/, 'Ship desks still open');
});

test('switch off: no tap is sent; a failed save puts the buttons back', async () => {
  const off = world({ on: false }), sent = [];
  assert.equal(off.AC.replyOn(), false);
  assert.equal(off.AC.replyTap(button('41', 'Workout', 'done', 'Done'), { sid: 's4', send: async t => { sent.push(t); return {}; } }), true);
  await off.AC.replyFlush('s4'); assert.equal(sent.length, 0);
  const { KIT, AC } = world(), toasts = [];
  AC.replyTap(button('41', 'Workout', 'done', 'Done'), { sid: 's5', send: async () => null, toast: (i, t) => toasts.push(t) });
  await AC.replyFlush('s5');
  const [tn] = KIT.parseRows(rows(REPLY));
  assert.doesNotMatch(AC.replyHtml(tn.a.btext, tn.a.buttons, md, AC.replyPicks([tn], 's5')), /aria-pressed="true"/);
  assert.deepEqual(toasts, ['Couldn’t send that tap · try again']);
});

// Agent chat parity (AGENTS.md; wizard-agent-service qa/agent-parity/features.json "chat-reply-buttons"): the same reply in
// a main thread and in host-profile, container and restricted routed threads gives the same buttons, the same tap
// message (only its thread differs) and the same clean Chats preview.
const ROUTES = { main: ['wizard_1793157258294_34b4a71ae61a', ''], 'host-profile': ['20261028_101500_ab12cd', 'qa-host-profile'],
  container: ['agent-research:20261028_101501_ef34', 'agent-research'], restricted: ['restricted.vault_20261028-101502', 'restricted.vault'] };
function listNormalizer() {
  const live = withLiveParts(read('web/live.js')), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  assert.ok(a > 0 && b > a, 'live.js normalizer block found');
  const context = modelContext({});
  vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}
test('parity: main and routed threads (host-profile, container, restricted) get the same buttons, tap message and preview', async () => {
  const normalize = listNormalizer(), htmls = new Set(), msgs = new Set();
  for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
    const { KIT, AC } = world(), sent = [];
    const history = rows(REPLY).map(r => ({ ...r, session_id: sid, ...(agent ? { agent } : {}) }));
    const [tn] = KIT.parseRows(history);
    htmls.add(AC.replyHtml(tn.a.btext, tn.a.buttons, md, AC.replyPicks([tn], sid)));
    AC.replyTap(button('41', 'Workout', 'done', 'Done'), { sid, send: async t => { sent.push(t); return {}; } });
    await AC.replyFlush(sid);
    const taps = KIT.tapsOf(sent[0]).taps;
    assert.equal(taps[0].thread, sid, kind);
    msgs.add(JSON.stringify(taps.map(({ thread, ...t }) => t)));
    const full = normalize({ id: sid, title: 'Synthetic', status: 'completed', ...(agent ? { agent } : {}), latest_message: { role: 'assistant', content: REPLY, timestamp: 2 } });
    assert.equal(full.agent, agent, `${kind}: row keeps its agent`);
    assert.doesNotMatch(full.preview, /WIZARD_|"group"/, `${kind}: no marker in the preview`);
    assert.doesNotMatch(full.preview, /\[Go for it\]|\[Done\]/, `${kind}: the buttons are drawn in the thread, not in the one-line preview (wizard-os issue 974)`);
    const tapRow = normalize({ id: sid, title: 'Synthetic', status: 'completed', ...(agent ? { agent } : {}), latest_message: { role: 'user', content: sent[0], timestamp: 3 } });
    assert.equal(tapRow.preview, 'Tapped Done · Workout', `${kind}: the tap message previews as its line`);
  }
  assert.equal(htmls.size, 1, 'byte-identical buttons for every runtime kind');
  assert.equal(msgs.size, 1, 'the same tap for every runtime kind');
});

// Issue 1942: a reporter rewrite of a reply with buttons drew the group twice (original + rewrite in one turn).
const BAR = GROUP('Four-section phone bar', 'Yes, on for everyone', 'Let me try it first', 'No, drop it');
const REPORTER_ROW = { role: 'user', timestamp: 3, content: '[reporter] Your last report does not meet the report format: no status line. Rewrite it now in the format, nothing else.\n\nreport=status' };
const rewriteRows = (reporter, extra = [], gap = 120) => [{ role: 'user', timestamp: 1, content: 'Phone navigation redesign?' },
  { id: 4449732, role: 'assistant', timestamp: 2, content: `Original report.\n${BAR}` }, ...(reporter ? [reporter] : []),
  { id: 4449734, role: 'assistant', timestamp: 2 + gap, content: `Rewritten report.\n${BAR}` }, ...extra];
const drawn = (AC, tn, picks = new Map()) => AC.replyHtml(tn.a.btext, tn.a.buttons, md, picks);
test('reporter rewrite: one text and one set of buttons, from the rewrite, whatever shape the reporter row has', () => {
  const { KIT, AC } = world();
  // No reporter row at all (a history that drops it): only the same-name guard can tell, within one turn.
  for (const [reporter, gap] of [[REPORTER_ROW, 120], [{ ...REPORTER_ROW, display_kind: 'hidden' }, 120], [null, 20]]) {
    const turns = KIT.parseRows(rewriteRows(reporter, [], gap));
    assert.equal(turns.length, 1, 'one turn: the reporter is not the owner speaking, the rewrite is not a later turn');
    const [tn] = turns, html = drawn(AC, tn);
    assert.equal((html.match(/class="ch-rb"/g) || []).length, 1, 'the group is drawn once');
    assert.equal((html.match(/<button /g) || []).length, 3);
    assert.match(html, /data-rb-msg="4449734"/, 'the surviving copy is the rewrite');
    assert.match(html, /Rewritten report/); assert.doesNotMatch(html, /Original report/);
    assert.doesNotMatch(JSON.stringify(turns), /\[reporter\]|Rewrite it now/, 'the reporter prompt never shows');
    if (reporter) assert.deepEqual(clone(tn.notes), [], 'the replaced reply is not kept in the turn either');
  }
});
test('reporter rewrite: a tap on the original still counts, a tap on the survivor sends the usual line and reloads picked', async () => {
  const { KIT, AC } = world(), sent = [];
  const tapOn = msg => ({ id: 50, role: 'user', timestamp: 200, content: AC.replyMessage([{ thread: 's9', message: msg, group: 'Four-section phone bar', button: 'let-me-try-it-first', label: 'Let me try it first' }]) });
  let turns = KIT.parseRows(rewriteRows(REPORTER_ROW, [tapOn('4449732')]));
  assert.match(drawn(AC, turns[0], AC.replyPicks(turns, 's9')), /aria-pressed="true">✓ Let me try it first/, 'earlier message id counts as the pick');
  AC.replyTap(button('4449734', 'Four-section phone bar', 'yes-on-for-everyone', 'Yes, on for everyone'), { sid: 's9', send: async t => { sent.push(t); return {}; } });
  await AC.replyFlush('s9');
  assert.match(sent[0], /^Tapped Yes, on for everyone · Four-section phone bar\n\[WIZARD_TAPS_V1\]/);
  turns = KIT.parseRows(rewriteRows(REPORTER_ROW, [{ id: 51, role: 'user', timestamp: 300, content: sent[0] }]));
  assert.match(drawn(AC, turns[0], AC.replyPicks(turns, 's9')), /aria-pressed="true">✓ Yes, on for everyone/, 'history reload shows the pick');
});
test('guard: the same group name twice in one turn draws the last copy; two different names both show', () => {
  const { KIT, AC } = world();
  const [tn] = KIT.parseRows([{ role: 'user', timestamp: 1, content: 'Hi' }, { id: 7, role: 'assistant', timestamp: 2, content: `First.\n${GROUP('Workout', 'Done')}` },
    { id: 8, role: 'assistant', timestamp: 3, content: `Second.\n${GROUP('Workout', 'Done', 'Skip')}\n${GROUP('Ship desks', 'Go for it')}` }]);
  const html = drawn(AC, tn);
  assert.equal((html.match(/data-rb-group="Workout"/g) || []).length, 1);
  assert.match(html, /data-rb-group="Workout" data-rb-msg="8"/);
  assert.equal((html.match(/data-rb-group="Ship desks"/g) || []).length, 1);
  const [two] = KIT.parseRows([{ role: 'user', timestamp: 1, content: 'Hi' }, { id: 7, role: 'assistant', timestamp: 2, content: `First.\n${GROUP('Workout', 'Done')}` },
    { id: 8, role: 'assistant', timestamp: 3, content: `Second.\n${GROUP('Ship desks', 'Go for it')}` }]);
  assert.deepEqual(clone(two.a.buttons).map(g => [g.group, g.msg]), [['Ship desks', '8'], ['Workout', '7']], 'different names: both kept');
});
test('reporter rewrite that failed: the original reply stands', () => {
  const { KIT, AC } = world();
  const [tn] = KIT.parseRows([{ role: 'user', timestamp: 1, content: 'Hi' }, { id: 1, role: 'assistant', timestamp: 2, content: `Original report.\n${BAR}` }, REPORTER_ROW,
    { id: 2, role: 'assistant', timestamp: 4, display_kind: 'failed_turn', content: 'Your request was not processed. Send it again if you still want me to carry it out.' }]);
  assert.match(drawn(AC, tn), /data-rb-msg="1"/);
});

// Issue 1963: several groups with the same labels (Approve / Decline) looked identical; each row names its ask on
// screen, picked and locked rows keep it, and the text fallback (Copy, switch off) names it too.
test('asks: every row shows its group as a caption, also picked and locked; the fallback names the ask', async () => {
  const { KIT, AC } = world(), sent = [];
  const ASKS = `Four things to decide.\n${GROUP('Smart inbox switch', 'Approve', 'Decline')}\n${GROUP('Typed messages go quiet', 'Approve', 'Decline')}`;
  const [tn] = KIT.parseRows(rows(ASKS));
  for (const t of [tn.a.text, tn.a.plainText]) assert.match(t, /Smart inbox switch: \[Approve\] \[Decline\]\n+Typed messages go quiet: \[Approve\] \[Decline\]/, 'fallback names each ask');
  const caps = h => [...h.matchAll(/<div class="ch-rb[^"]*"[^>]*data-rb-group="([^"]*)"[^>]*><span class="ch-rb-ask" aria-hidden="true">([^<]*)<\/span><button/g)].map(m => [m[1], m[2]]);
  const both = [['Smart inbox switch', 'Smart inbox switch'], ['Typed messages go quiet', 'Typed messages go quiet']];
  assert.deepEqual(caps(AC.replyHtml(tn.a.btext, tn.a.buttons, md, AC.replyPicks([tn], 'a1'))), both, 'caption first in each row, before its buttons');
  AC.replyTap(button('41', 'Smart inbox switch', 'approve', 'Approve'), { sid: 'a1', send: async t => { sent.push(t); return {}; } });
  const picked = AC.replyHtml(tn.a.btext, tn.a.buttons, md, AC.replyPicks([tn], 'a1'));
  assert.deepEqual(caps(picked), both, 'picked row keeps its caption');
  assert.match(picked, /class="ch-rb picked"[^>]*><span class="ch-rb-ask" aria-hidden="true">Smart inbox switch<\/span><button[^>]*aria-pressed="true">✓ Approve/);
  await AC.replyFlush('a1');
  assert.match(sent[0], /^Tapped Approve · Smart inbox switch\n/);
  const turns = KIT.parseRows(rows(ASKS, [{ id: 42, role: 'user', timestamp: 3, content: sent[0] }, { id: 43, role: 'assistant', timestamp: 4, content: 'Turned it on.' }]));
  const locked = AC.replyHtml(turns[0].a.btext, turns[0].a.buttons, md, AC.replyPicks(turns, 'a1'));
  assert.match(locked, /class="ch-rb picked locked"[^>]*><span class="ch-rb-ask" aria-hidden="true">Smart inbox switch<\/span>/, 'locked row keeps its caption');
  // one group reads as before plus its one caption; the name is escaped like the rest of the row
  const [one] = KIT.parseRows(rows(`Log it?\n${GROUP('Workout <b>', 'Done')}`));
  const h = AC.replyHtml(one.a.btext, one.a.buttons, md, new Map());
  assert.equal((h.match(/class="ch-rb-ask"/g) || []).length, 1);
  assert.match(h, /<span class="ch-rb-ask" aria-hidden="true">Workout &lt;b&gt;<\/span>/);
  assert.match(one.a.text, /^Log it\?\n\nWorkout <b>: \[Done\]$/);
});
