// Hermes appends its own notes to the owner's turn ("[System: The skills available in this conversation changed …]",
// recalled <memory-context>, the files block). They are for the model, never words he wrote: the thread bubble and the
// chat list preview must show only his message. Real shape from a Wizard session (31 Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const kitSrc = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const liveSrc = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
function kit() {
  const store = new Map();
  const ctx = { location: { origin: 'https://w.example', hostname: 'w.example', href: 'https://w.example/' },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(kitSrc, ctx); return ctx.WosChat;
}
const K = kit();
const m = liveSrc.match(/const clean = s => String\(s \|\| ''\)([\s\S]*?\.trim\(\));/);
const preview = vm.runInNewContext(`(chipLabel => s => String(s || '')${m[1]})(() => ' 🖼 Photo ')`);

const SKILLS = "[System: The skills available in this conversation changed after its system prompt was built.\nNow available (load with skill_view(name) when relevant, like the skills listed in the system prompt):\n    - health-owner-preferences: Use when changing Miguel's Health or WHOOP apps.\n    - wizard-mail: Use when the owner asks about his email in Mail: what cam...]";
const MEMORY = "<memory-context>\n[System note: The following is recalled memory context, NOT new user input.]\n\n## Holographic Memory\n- #708 [0.5] a fact\n</memory-context>";
// The Agent Service hands the thread its chips block (WIZARD_FILE_CHIPS_V1) and a [screenshot] line for the picture.
const FILES = '[WIZARD_FILE_CHIPS_V1]\n[{"id":"wf_839a085af4024456b3600ca0636693c6","filename":"shot.jpg","mime":"image/jpeg","bytes":97555,"status":"ready","userVisible":true}]\n[/WIZARD_FILE_CHIPS_V1]';
const words = 'Nope, and this might be a skin problem. [Not a bracket note] But the settings panel is too noisy.';
const bubble = raw => K.parseRows([{ role: 'user', content: raw, timestamp: 1 }, { role: 'assistant', content: 'Ok.', timestamp: 2 }])[0]?.u;

test('a [System: …] note appended to his turn never shows in his bubble', () => {
  assert.equal(bubble(`${words}\n${SKILLS}`).text, words);
  assert.equal(bubble(`${words}\n\n${SKILLS}\n${MEMORY}`).text, words, 'also with recalled memory after it');
  const u = bubble(`this was the screenshot\n\n${FILES}\n[screenshot]\n${SKILLS}\n${MEMORY}`);
  assert.equal(u.text, 'this was the screenshot', 'files become chips; the note and markers go');
  assert.equal(u.files.length, 1);
  assert.equal(bubble(`${words}\n[System: one]\n[System: two]`).text, words, 'several notes in a row');
});
test('his own brackets stay: only a line-start [System: …] that runs to the end of the message is a note', () => {
  assert.equal(bubble(words).text, words);
  assert.equal(bubble('Why does it say [System: busy] here?').text, 'Why does it say [System: busy] here?', 'mid-line words stay');
  assert.equal(bubble('[System: x] is what I typed\nand more words').text, '[System: x] is what I typed\nand more words', 'a note must end the message');
});
test('a turn that is only a note is not a bubble', () => {
  const rows = K.parseRows([{ role: 'user', content: SKILLS, timestamp: 1 }, { role: 'assistant', content: 'Ok.', timestamp: 2 }]);
  assert.ok(!rows.some(r => r.u && /System/.test(r.u.text)));
});
test('the chat list preview drops the same notes', () => {
  assert.equal(preview(`${words}\n${SKILLS}`), words);
  assert.equal(preview(`${words}\n\n${SKILLS}\n${MEMORY}`), words);
  assert.equal(preview(`this was the screenshot\n\n${FILES}\n[screenshot]\n${SKILLS}`), 'this was the screenshot 🖼 Photo');
  assert.equal(preview('Why does it say [System: busy] here?'), 'Why does it say [System: busy] here?');
});
