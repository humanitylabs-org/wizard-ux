// wizard-ux issue 1961: a reply with tap-to-answer buttons showed twice. The transcript's plain text keeps each group's
// labels ([File all three] [Only 1 and 2] [Leave it], chat-kit buttonsFallback) while the live stream drops the whole
// group, so a late replay of that run (a reopen while the list or outbox still names it) never matched the reply already
// drawn and stayed below it as a second copy. Turns come from the real chat-kit parseRows; the stream is chats-stream.js.
import { modelContext } from './fixtures/chats-list-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const kitCtx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
kitCtx.window = kitCtx; modelContext(kitCtx); vm.runInContext(read('web/core/chat-kit.js'), kitCtx);
const KIT = kitCtx.WosChat;
const chats = withParts(read('web/core/chats.js'));

const GROUP = '[WIZARD_BUTTONS_V1]{"group":"Badge styling tweaks","buttons":[{"id":"all","label":"File all three"},{"id":"two","label":"Only 1 and 2"},{"id":"leave","label":"Leave it"}]}[/WIZARD_BUTTONS_V1]';
const STATUS = '[WIZARD_STATUS_V1]{"state":"done","ask":"Pick one"}[/WIZARD_STATUS_V1]';
const REPLY = `Yes. The badge is cut off because it is placed against our guess.\n\nThese are the minor fixes I would make:\n\n1. Smaller\n2. Inset\n3. Ring\n\n${GROUP}\n\n${STATUS}`;
const rows = [
  { role: 'user', timestamp: 1, content: 'Why is the badge cut off?' }, { role: 'assistant', timestamp: 2, content: 'Earlier answer.' },
  { role: 'user', timestamp: 3, content: 'Fix the badge?' }, { id: 4450724, role: 'assistant', timestamp: 4, content: REPLY },
];

function stream(turns, { working = true, agent = '' } = {}) {
  const w = { id: 'w', thread: 'sid' }, c = {}, row = { status: working ? 'running' : 'completed', runId: 'run-1' };
  let callback, closed = 0;
  const ctx = { LIVE: { pendingRun: () => 'run-1', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close: () => closed++ }) },
    W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }), isWorking: s => s.status === 'running', esc: s => s,
    md: s => `<p>${s}</p>`, renderThreadLive() {}, loadThread: async () => {}, setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
  assert.equal(ctx.syncStream(w, c, turns, agent), '', 'nothing streamed yet');
  return { ctx, w, c, turns, send: snap => callback(snap), paint: () => ctx.syncStream(w, c, turns, agent), closed: () => closed };
}

test('the transcript keeps the buttons as labels in its plain text (why the replay never matched)', () => {
  const t = KIT.parseRows(rows).at(-1);
  assert.match(t.a.text, /\[File all three\] \[Only 1 and 2\] \[Leave it\]/);
  assert.equal(t.a.buttons.length, 1);
});

// Main and routed threads (host profile, container, restricted) share this path; each gets the same answer.
for (const agent of ['', 'host', 'container', 'restricted']) test(`issue 1961: a finished replay of a reply with buttons is retired, not drawn as a second copy (${agent || 'main'})`, () => {
  const s = stream(KIT.parseRows(rows), { agent });
  s.send({ text: REPLY, steps: [], terminal: true });
  assert.equal(s.paint(), '', 'the reply is drawn once, from the transcript');
  assert.equal(s.c.stream.landed, true); assert.equal(s.closed(), 1);
});

test('issue 1961: a replay ending on the buttons line (no status) is retired too', () => {
  const raw = REPLY.replace(`\n\n${STATUS}`, '');
  const s = stream(KIT.parseRows([...rows.slice(0, 3), { id: 9, role: 'assistant', timestamp: 4, content: raw }]));
  s.send({ text: raw, steps: [], terminal: true });
  assert.equal(s.paint(), ''); assert.equal(s.c.stream.landed, true);
});

test('a genuinely new reply that ends like the one with buttons still streams', () => {
  const s = stream(KIT.parseRows(rows));
  s.send({ text: `New words first. ${REPLY}`, steps: [], terminal: true });
  assert.match(s.paint(), /New words first/); assert.equal(s.c.stream.landed, false);
});

test('mid-run: words already drawn above a button group are not repeated under Replying…', () => {
  const mid = [...rows.slice(0, 3), { id: 5, role: 'assistant', timestamp: 4, content: `Here are the options.\n\n${GROUP}`, tool_calls: [{ id: 'x' }] }];
  const s = stream(KIT.parseRows(mid));
  s.send({ text: `Here are the options.\n\n${GROUP}\n\nChecking the icon now.`, steps: [], terminal: false });
  const html = s.paint();
  assert.match(html, /Checking the icon now\./); assert.doesNotMatch(html, /Here are the options/);
});

test('words in the prose that read like a button label are kept: a new reply is not taken for the old one', () => {
  const raw = 'Choose [Done] now.\n\n[WIZARD_BUTTONS_V1]{"group":"Step","buttons":[{"id":"done","label":"Done"}]}[/WIZARD_BUTTONS_V1]';
  const s = stream(KIT.parseRows([...rows.slice(0, 3), { id: 7, role: 'assistant', timestamp: 4, content: raw }]));
  s.send({ text: 'Choose now.', steps: [], terminal: true });
  assert.match(s.paint(), /Choose now\./, 'a genuinely new reply still shows'); assert.equal(s.c.stream.landed, false);
  const again = stream(KIT.parseRows([...rows.slice(0, 3), { id: 7, role: 'assistant', timestamp: 4, content: raw }]));
  again.send({ text: raw, steps: [], terminal: true });
  assert.equal(again.paint(), '', 'its own replay is retired'); assert.equal(again.c.stream.landed, true);
});
