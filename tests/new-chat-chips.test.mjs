// wizard-ux issue 1965 (on for everyone; switch wizard/new-chat-chips removed): a new, empty chat shows quick-link chips
// above the message box, in this order: Catch me up, What's waiting on me, Plan my day; each sends its prompt as the
// owner's message. Runs the real core/chats-status.js in a vm. The full paint, tap and send run in a real browser in
// tests/qa-new-chat-chips.cjs (phone and AI apps desktop, two skins).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/chats-status.js', import.meta.url), 'utf8');
function status(tweaks) {
  const window = { WizCore: { chatsParts: {} }, WizConfig: { owner: () => 'Sam', agent: () => 'Wizard' } };
  const document = { documentElement: { dataset: { tweaks } } };
  vm.runInNewContext(src, { window, document, globalThis: window, Date });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return window.WizCore.chatsParts.status({ agentName: () => 'Wizard', agentRec: () => null, AGS: () => null, esc, H: {}, handledNow: () => 0, isWorking: () => false });
}
const chips = html => [...html.matchAll(/<button type="button" data-chquick="([^"]*)">([^<]*)<\/button>/g)].map(m => [m[2], m[1].replace(/&#39;/g, "'")]);
const ORDER = [['Catch me up', 'catch me up'], ['What’s waiting on me', "What's waiting on me?"], ['Plan my day', 'Plan my day']];

test('three chips in the order James asked, each with its exact prompt', () => {
  const S = status('');
  assert.deepEqual(chips(S.quickLinksHtml()), ORDER);
  assert.match(S.quickLinksHtml(), /^<div class="ch-quick" role="group" aria-label="Quick links">/);
});

test('the chips are data: the drawn row follows QUICK_LINKS', () => {
  const S = status('');
  assert.deepEqual(chips(S.quickLinksHtml()), JSON.parse(JSON.stringify(S.QUICK_LINKS.map(q => [q.label, q.prompt]))));
});

test('no switch: drawn whatever tweaks are running, also with none at all', () => {
  for (const t of ['', 'wizard/auto-tags', undefined]) assert.deepEqual(chips(status(t).quickLinksHtml()), ORDER);
});

test('the old switch is gone from the catalog', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(!JSON.stringify(catalog).includes('wizard/new-chat-chips'));
});
