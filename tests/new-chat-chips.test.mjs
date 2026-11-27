// wizard-ux issue 1965 (switch wizard/new-chat-chips, off): a new, empty chat shows quick-link chips above the message
// box, in this order: Catch me up, What's waiting on me, Plan my day; each sends its prompt as the owner's message.
// Runs the real core/chats-status.js in a vm. The full paint, tap and send run in a real browser in
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

test('switch on: three chips in the order James asked, each with its exact prompt', () => {
  const S = status('wizard/result-reader wizard/new-chat-chips');
  assert.deepEqual(chips(S.quickLinksHtml()), [['Catch me up', 'catch me up'], ['What’s waiting on me', "What's waiting on me?"], ['Plan my day', 'Plan my day']]);
  assert.match(S.quickLinksHtml(), /^<div class="ch-quick" role="group" aria-label="Quick links">/);
});

test('the chips are data: the drawn row follows QUICK_LINKS', () => {
  const S = status('wizard/new-chat-chips');
  assert.deepEqual(chips(S.quickLinksHtml()), JSON.parse(JSON.stringify(S.QUICK_LINKS.map(q => [q.label, q.prompt]))));
});

test('switch off (or a look-alike id): nothing is drawn', () => {
  for (const t of ['', 'wizard/new-chat-chips-x wizard/first-chat-goals', undefined]) assert.equal(status(t).quickLinksHtml(), '');
});
