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
  assert.match(js, /if \(ok === true && state !== 'done' && \(state === 'ai' \|\|/);
  assert.match(js, /if \(h\.deeplinked\?\.\(\)\) \{ log\('deeplink'\); return; \}/);
});

test('Welcome: three steps only, no uppercase eyebrows or em dashes in its copy', () => {
  const js = read('web/core/welcome.js');
  for (const t of ['Connect your AI', 'Pick a colour', 'Say hello']) assert.ok(js.includes(t), t);
  const copy = js.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(copy, /—/);
  assert.doesNotMatch(copy, /STEP \d/i);
  assert.doesNotMatch(read('web/core/welcome.css'), /text-transform:\s*uppercase/);
});

test('Welcome: colours are the Wizard skin only, drawn with the Settings preview cards', () => {
  const js = read('web/core/welcome.js');
  assert.match(js, /const FAMILY = 'wizard'/);
  assert.match(js, /class="skp-card"/);
  assert.match(js, /class="st-root wl-skp"/);
  assert.doesNotMatch(js, /data-wl="family"/);
});

test('Welcome: same first run on every install; finishing marks Setup seen', () => {
  const js = read('web/core/welcome.js');
  assert.match(js, /setup\?\.first_run === true\)\) return open\('look'\)/);
  assert.match(js, /write\('done'\); markSeen\(\)/);
});

test('first message reuses one main Chats window and opens its thread', () => {
  assert.match(read('web/desktop/desktop.js'), /findWin\(mainChats\) \|\| newWin\([^]*?away: true[^]*?whenThreadExists\(it\.sessionId, sid => openThread\(sid\)\)/);
  assert.match(read('web/app.js'), /placeApp\(mainChats[^]*?away: true[^]*?whenThreadExists\(it\.sessionId, sid => openWizardThread\(sid\)\)/);
});

test('Welcome: branded, offers Claude (recommended), ChatGPT and Tinfoil, and opens the app straight into sign-in', () => {
  const js = read('web/core/welcome.js');
  assert.match(js, /class="wl-brand"><img src="brand\/wizard-mark-white.png"[^`]*Wizard OS/);
  assert.match(js, /app: 'wizard-claude', name: 'Claude', note: 'Recommended'[^]*app: 'wizard-chatgpt'[^]*app: 'wizard-tinfoil', name: 'Tinfoil'/);
  assert.match(js, /searchParams.set\('connect', '1'\)/);
  assert.match(js, /store\/store-install.js/, 'a missing provider app installs through the Store install path');
});

test('Welcome: Back peels the sign-in, then steps back, and both shells ask it first', () => {
  const js = read('web/core/welcome.js');
  assert.match(js, /function back\(\)[^]*?provider = null[^]*?step === 'hello'\) \{ step = 'look'/);
  assert.match(read('web/app.js'), /function backStep\(skipHosted\) \{\s*\{ const w = window\.WosWelcome\?\.back\(\)/);
  assert.match(read('web/desktop/desktop.js'), /function escStep\(\) \{\s*\{ const w = window\.WosWelcome\?\.back\(\)/);
});

test('Welcome: finishes only after the first message is queued', () => {
  const js = read('web/core/welcome.js');
  assert.match(js, /item = await H\.send\(text\)[^]*?if \(!item\) \{[^]*?return; \}\s*write\('done'\); markSeen\(\); close\(\)/);
});

test('Welcome: never covers work already started, keeps keys and focus, Back cancels the auto-advance', () => {
  const js = read('web/core/welcome.js');
  assert.match(js, /acted \|\| h\.busy\?\.\(\) \|\| h\.deeplinked\?\.\(\)\)\) \{ log\('boot:busy'\); return; \}/);
  assert.match(js, /e\.key === 'Tab'/);
  assert.match(js, /provider === chosen/);
  assert.match(read('web/desktop/desktop.js'), /function onKey\(e, fromFrame = false\) \{\s*if \(pick\.active\(\)\) return pick\.key\(e\);\s*if \(window\.WosWelcome\?\.active\)/);
  assert.match(read('web/desktop/desktop.js'), /WosWelcome\?\.boot\([^]*?busy: \(\) => VOICE\.state !== 'idle'/);
  assert.match(read('web/app.js'), /WosWelcome\?\.boot\([^]*?busy: \(\) => V\.state !== 'idle'/);
});
