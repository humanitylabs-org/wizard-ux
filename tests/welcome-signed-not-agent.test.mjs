// wizard-ux issue 1749: signed in to Claude in Welcome › Connect your AI, but the agent's model still pointed at a
// ChatGPT that was never signed in. The step waited forever on "This continues by itself once you are signed in."
// The Claude app now makes the sign-in the agent's model when the agent has none that works (wizard-app-store); the
// step says what it waits for meanwhile, and moves on as soon as the subscription is the agent's model.
// Runs the real web/core/welcome.js in the fake browser of tests/fixtures/welcome-harness.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeBox, device } from './fixtures/welcome-harness.mjs';

const SUB = 'claude-subscription-directsdk-experimental';
const skins = () => ({ list: [{ id: 'nebula', name: 'Nebula', t: {} }], current: 'nebula', set() {} });

function janBox() {
  const box = fakeBox({ providers: [{ slug: SUB, authenticated: true }, { slug: 'openai-codex', authenticated: false }] });
  box.current = 'openai-codex';
  const inner = box.fetch;
  box.fetch = async (url, init) => {
    if (String(url).endsWith('/wizard/hermes/api/model/options')) {
      return { ok: true, status: 200, json: async () => ({ provider: box.current, providers: JSON.parse(JSON.stringify(box.providers)) }) };
    }
    return inner(url, init);
  };
  return box;
}

test('signed in but not yet the agent\'s AI: the step says so, then what is missing after 20 s; continues once it is the model', async () => {
  const box = janBox(), d = device(box, { skins: skins() });
  const status = { textContent: '' };
  const q = d.card.querySelector;
  d.card.querySelector = s => (s === '.wl-status' ? status : q(s));
  await d.boot();
  assert.ok(d.W.active, 'no usable AI: Connect your AI');
  d.press('provider', { app: 'wizard-claude' });
  assert.match(d.html(), /This continues by itself once you are signed in\./, 'before any reading: the usual line');
  await d.advance(3000);
  assert.ok(d.log().includes('signed:making'), d.log().join(' '));
  assert.equal(status.textContent, 'Signed in. Making Claude your agent\u2019s AI\u2026');
  await d.advance(21000);
  assert.ok(d.log().includes('signed:not-agent'), d.log().join(' '));
  assert.match(status.textContent, /^Claude is signed in, but it isn\u2019t your agent\u2019s AI yet\. Press Test/);
  assert.ok(!d.log().includes('connected'), 'never moves on while the agent\'s model cannot answer');
  // The Claude app makes the subscription the agent's model (a sign-in or a passing Test): the step moves on.
  box.current = SUB;
  await d.advance(3000);
  assert.ok(d.log().includes('connected'));
  await d.advance(1500);
  assert.match(d.html(), /Pick a skin/);
});

test('nothing signed in yet: the usual line stays, no waiting line', async () => {
  const box = janBox(); box.providers = [{ slug: SUB, authenticated: false }, { slug: 'openai-codex', authenticated: false }];
  const d = device(box, { skins: skins() });
  await d.boot();
  d.press('provider', { app: 'wizard-claude' });
  await d.advance(30000);
  assert.ok(!d.log().some(l => l.startsWith('signed:')), d.log().join(' '));
  assert.match(d.html(), /This continues by itself once you are signed in\./);
});

test('a working model the owner chose is kept and the step still moves on (alongside Claude account)', async () => {
  const box = janBox(); box.current = 'openai-codex';
  box.providers = [{ slug: 'anthropic', authenticated: true }, { slug: 'openai-codex', authenticated: true }];
  const d = device(box, { skins: skins() });
  await d.boot();
  assert.ok(!d.W.active, 'a working model: no Welcome at all');
  d.W.open('ai');
  d.press('provider', { app: 'wizard-claude' });
  await d.advance(3000);
  assert.ok(d.log().includes('connected'));
  assert.equal(box.current, 'openai-codex');
});
