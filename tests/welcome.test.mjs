import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('Welcome: Claude is listed first and recommended, then ChatGPT', () => {
  const js = read('web/core/welcome.js');
  const claude = js.indexOf("app: 'wizard-claude'"), gpt = js.indexOf("app: 'wizard-chatgpt'");
  assert.ok(claude > 0 && claude < gpt);
  assert.match(js, /app: 'wizard-claude', name: 'Claude', note: 'Recommended'/);
});

test('Welcome: opens only without a signed-in provider, resumes after sign-in, never on a deep link', () => {
  const js = read('web/core/welcome.js');
  assert.match(js, /p\.authenticated === true/);
  assert.match(js, /if \(ok === false\) return open\('ai'\)/);
  assert.match(js, /if \(ok === true && state === 'ai'\) return open\('look'\)/);
  assert.match(js, /if \(h\.deeplinked\?\.\(\)\) \{ log\('deeplink'\); return; \}/);
});

test('Welcome: three steps only, no uppercase eyebrows or em dashes in its copy', () => {
  const js = read('web/core/welcome.js');
  for (const t of ['Connect your AI', 'Pick a look', 'Say hello']) assert.ok(js.includes(t), t);
  const copy = js.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(copy, /—/);
  assert.doesNotMatch(copy, /STEP \d/i);
  assert.doesNotMatch(read('web/core/welcome.css'), /text-transform:\s*uppercase/);
});
