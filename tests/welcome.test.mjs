// The Welcome (web/core/welcome.js), run for real in node:vm against a fake box (tests/fixtures/welcome-harness.mjs).
// Each test drives it the way an owner would and checks what they see; none of them reads the source as text
// (wizard-ux issue 1674). Pick a skin: tests/welcome-every-skin.test.mjs; what counts as signed in:
// tests/welcome-ai-ready.test.mjs; seen on other devices: tests/welcome-two-devices.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { fakeBox, device, flush } from './fixtures/welcome-harness.mjs';

const read = p => withShellParts(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const title = d => (/<h2[^>]*>([^<]*)<\/h2>/.exec(d.html()) || [])[1];
const choices = d => [...d.html().matchAll(/data-wl="provider" data-app="([^"]+)"[^>]*>(.*?)<\/button>/g)].map(m => ({ app: m[1], tag: (/class="wl-tag[^"]*">([^<]*)/.exec(m[2]) || [])[1] || '' }));
const skins = () => ({ list: [{ id: 'nebula', name: 'Nebula', t: {} }, { id: 'grove', name: 'Grove', t: {} }], current: 'nebula', set(id) { this.current = id; } });
const SEEN = 'POST /wizard/v1/setup/seen';

test('Welcome: Claude is listed first and recommended, then ChatGPT and Tinfoil, under the WizardOS brand', async () => {
  const d = device(fakeBox());
  await d.boot();
  assert.equal(title(d), 'Connect your AI');
  assert.deepEqual(choices(d), [{ app: 'wizard-claude', tag: 'Recommended' }, { app: 'wizard-chatgpt', tag: '' }, { app: 'wizard-tinfoil', tag: 'Private' }]);
  assert.match(d.html(), /<div class="wl-brand"><img src="brand\/wizard-mark-white.png" alt=""><span>WizardOS<\/span><\/div>/, 'one word (James, 8 Nov 2026)');
  assert.match(d.html(), /<p>Oscar thinks with your own AI subscription/);
});

test('Welcome: opens only without a signed-in provider, resumes after sign-in, never on a deep link', async () => {
  const none = device(fakeBox()); await none.boot();
  assert.ok(none.W.active, 'nothing signed in: Connect your AI');

  const ready = device(fakeBox({ signedIn: true, firstRun: false })); await ready.boot();
  assert.ok(!ready.W.active, 'an existing Wizard with a provider never sees it');

  const resumed = device(fakeBox({ signedIn: true }), { skins: skins() });
  resumed.store.set('wos.welcome.v1', 'ai'); // signed in during an earlier Welcome, then reloaded
  await resumed.boot();
  assert.ok(resumed.W.active); assert.equal(title(resumed), 'Pick a skin');

  const linked = device(fakeBox(), { deeplinked: () => true }); await linked.boot();
  assert.ok(!linked.W.active, 'a deep link wins');
  assert.ok(linked.log().includes('deeplink'));
});

// wizard-ux issue 1750: an existing Wizard whose AI is signed out gets one screen, Reconnect your AI. Once the chosen
// provider is connected it saves done and closes; no name, no Pick a skin, no Say hello, and the next launch shows nothing.
test('Reconnect: an existing Wizard with its AI signed out sees only Reconnect your AI, then it closes by itself', async () => {
  for (const [why, firstRun, saved] of [['the box says it is not new', false, ''], ['this device finished the Welcome (no answer from the box)', undefined, 'done']]) {
    const box = fakeBox({ name: 'Wizard', firstRun, providers: [{ slug: 'openai-codex', authenticated: false }] });
    if (firstRun === undefined) box.fetch = (f => async (u, i) => String(u).endsWith('/wizard/v1/setup') ? { ok: false, status: 503, json: async () => ({}) } : f(u, i))(box.fetch);
    const d = device(box, { skins: skins() }); if (saved) d.store.set('wos.welcome.v1', saved);
    await d.boot();
    assert.ok(d.W.active, why); assert.equal(title(d), 'Reconnect your AI', `${why}: no name step, straight to the AI`);
    assert.match(d.html(), /<p>Your AI isn\u2019t connected\. Reconnect it so Wizard can answer\.<\/p>/);
    assert.doesNotMatch(d.html(), /wl-dots/, 'no first-run step dots');
    assert.deepEqual(choices(d).map(c => c.app), ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil'], 'the same provider choices');
    d.press('provider', { app: 'wizard-chatgpt' }); assert.equal(title(d), 'Sign in to ChatGPT');
    box.providers = [{ slug: 'openai-codex', authenticated: true }];
    await d.advance(3000); assert.match(d.html(), /ChatGPT is connected\./);
    await d.advance(1200);
    assert.ok(!d.W.active, `${why}: closed by itself, no Pick a skin or Say hello`);
    assert.equal(d.store.get('wos.welcome.v1'), 'done');
    assert.ok(!box.calls.includes(SEEN), 'markSeen stays with Say hello');
    const next = device(box, { skins: skins() }); next.store.set('wos.welcome.v1', 'done'); await next.boot();
    assert.ok(!next.W.active, `${why}: the next launch shows nothing`);
  }
});

test('Reconnect: a device that saved "ai" on an existing Wizard never reopens Pick a skin; a fresh Wizard still does', async () => {
  const old = device(fakeBox({ signedIn: true, firstRun: false }), { skins: skins() }); old.store.set('wos.welcome.v1', 'ai');
  await old.boot(); assert.ok(!old.W.active, 'reconnected on an older build: nothing');
  const fresh = device(fakeBox(), { skins: skins() }); await fresh.boot();
  assert.equal(title(fresh), 'Connect your AI'); assert.match(fresh.html(), /wl-dots/);
  // A reset box (first_run true again) gets the whole Welcome even where this browser remembers done.
  const reset = device(fakeBox(), { skins: skins() }); reset.store.set('wos.welcome.v1', 'done'); await reset.boot();
  assert.equal(title(reset), 'Connect your AI'); assert.match(reset.html(), /wl-dots/);
  // The Setup tile and Settings open the whole Welcome on any Wizard.
  const tile = device(fakeBox({ signedIn: true, firstRun: false }), { skins: skins() }); await tile.boot();
  tile.W.open(); assert.equal(title(tile), 'Connect your AI'); assert.match(tile.html(), /wl-dots/);
});

test('Welcome: three steps only (AI, skin, hello), no uppercase eyebrows or em dashes in what it shows', async () => {
  const box = fakeBox(), d = device(box, { skins: skins() });
  await d.boot();
  const seen = [title(d)], copy = [d.html()];
  assert.equal((d.html().match(/<i class/g) || []).length, 3, 'three dots');
  box.providers = [{ slug: 'anthropic', authenticated: true }];
  d.press('provider', { app: 'wizard-claude' }); await d.advance(3000 + 1200);
  seen.push(title(d)); copy.push(d.html());
  d.press('next'); seen.push(title(d)); copy.push(d.html());
  assert.deepEqual(seen, ['Connect your AI', 'Pick a skin', 'Say hello']);
  for (const h of copy) { assert.doesNotMatch(h, /—/); assert.doesNotMatch(h, /STEP \d/i); }
  assert.doesNotMatch(read('web/core/welcome.css'), /text-transform:\s*uppercase/);
});

test('Welcome: same first run on every install (a fresh box starts at the skin); finishing marks Setup seen', async () => {
  const box = fakeBox({ signedIn: true, firstRun: true }), d = device(box, { skins: skins() });
  await d.boot();
  assert.ok(d.W.active); assert.equal(title(d), 'Pick a skin');
  d.press('next'); assert.equal(title(d), 'Say hello');
  await d.submit('Hello there'); await flush();
  assert.ok(!d.W.active);
  assert.equal(d.store.get('wos.welcome.v1'), 'done');
  assert.ok(box.calls.includes(SEEN));
});

test('first message reuses one main Chats window and opens its thread once the agent has it', async () => {
  // The shells' own send hooks, run with their real code against stubs of what they call.
  const hooks = (file, env) => {
    const s = read(file), a = s.indexOf('window.WosWelcome?.boot({'), b = s.indexOf('} });', a) + 5;
    const ctx = { ...env, window: { WosWelcome: { boot: h => { ctx.h = h; }, whenThreadExists: (sid, open) => ctx.waits.push([sid, open]) }, __deeplinkLog: [] }, waits: [] };
    vm.createContext(ctx); vm.runInContext(s.slice(a, b), ctx); return ctx;
  };
  const sent = [], opened = [], made = [];
  const desk = hooks('web/desktop/desktop.js', { APP: {}, mainChats: () => true, findApp: () => null, openApp() {}, VOICE: { state: 'idle' },
    findWin: () => ({ id: 'main' }), newWin: w => (made.push(w), { id: 'new' }), focusWin: id => opened.push(['focus', id]),
    CHATS: { sendChat: async (...a) => (sent.push(a), { sessionId: 's9' }) }, openThread: sid => opened.push(['thread', sid]) });
  assert.deepEqual(await desk.h.send('hi'), { sessionId: 's9' });
  assert.deepEqual(made, [], 'the main Chats window is reused');
  assert.equal(sent[0][0], 'main'); assert.equal(sent[0][1], 'hi'); assert.equal(sent[0][4].away, true);
  assert.equal(desk.waits[0][0], 's9'); desk.waits[0][1]('s9');
  assert.deepEqual(opened, [['focus', 'main'], ['thread', 's9']]);
  desk.VOICE.state = 'listening'; assert.equal(desk.h.busy(), true, 'a recording keeps the Welcome away');
  desk.window.__deeplinkLog.push('x'); assert.equal(desk.h.deeplinked(), true);

  const phoneOpened = [];
  const phone = hooks('web/app-boot.js', { APP: {}, openApp() {}, V: { state: 'idle' }, closeSheets() {}, mainChats: () => true,
    placeApp: () => ({ id: 'chats-1' }), sendChat: async (...a) => (sent.push(a), { sessionId: 's8' }), openWizardThread: sid => phoneOpened.push(sid) });
  await phone.h.send('hello');
  assert.equal(sent[1][0], 'chats-1'); assert.equal(sent[1][4].away, true);
  phone.waits[0][1]('s8'); assert.deepEqual(phoneOpened, ['s8']);
  phone.V.state = 'recording'; assert.equal(phone.h.busy(), true);
});

test('Welcome: a provider that is installed opens its own page straight into sign-in (?connect=1)', async () => {
  const d = device(fakeBox());
  await d.boot();
  d.press('provider', { app: 'wizard-claude' });
  assert.equal(title(d), 'Sign in to Claude');
  assert.equal(d.nodes.iframe.attrs.src, 'https://box.test/wizard-claude/?connect=1');
  assert.ok(d.card.cls.has('wide'));
});

test('Welcome: a provider that is not installed installs through the Store install path, then signs in', async () => {
  const apps = { 'wizard-claude': { url: '/wizard-claude/' } }, box = fakeBox(), base = box.fetch;
  box.fetch = async (u, i = {}) => {
    const s = String(u);
    if (s.includes('store-data/wizard/v1/index/search')) { box.calls.push('search'); return { ok: true, status: 200, json: async () => ({ apps: [{ id: 'wizard-tinfoil', version: '1.0.0', source: 's', repo: 'r', commit: 'c' }] }) }; }
    if (s.includes('store-install/wizard-tinfoil') && i.method === 'POST') { box.calls.push('install ' + JSON.parse(i.body).operation); apps['wizard-tinfoil'] = { url: '/wizard-tinfoil/' }; return { ok: true, status: 200, json: async () => ({ state: 'installed' }) }; }
    return base(u, i);
  };
  const d = device(box, { apps });
  await d.boot();
  d.press('provider', { app: 'wizard-tinfoil' });
  assert.match(d.html(), /data-app="wizard-tinfoil" disabled>.*Installing…/);
  await d.advance(10);
  assert.deepEqual(box.calls.filter(c => c === 'search' || c.startsWith('install')), ['search', 'install install']);
  assert.equal(title(d), 'Sign in to Tinfoil');
  assert.equal(d.nodes.iframe.attrs.src, 'https://box.test/wizard-tinfoil/?connect=1');
});

test('Welcome: Back peels the sign-in, then steps back; the shells\' Back asks the Welcome first', async () => {
  const box = fakeBox(), d = device(box, { skins: skins() });
  await d.boot();
  d.press('provider', { app: 'wizard-chatgpt' });
  assert.equal(d.W.back(), 'welcome'); assert.equal(title(d), 'Connect your AI', 'Back leaves the sign-in page');
  box.providers = [{ slug: 'openai-codex', authenticated: true }];
  d.press('provider', { app: 'wizard-chatgpt' }); await d.advance(4200);
  d.press('next'); assert.equal(title(d), 'Say hello');
  d.W.back(); assert.equal(title(d), 'Pick a skin', 'Say hello steps back to the skin');
  d.W.back(); assert.ok(!d.W.active, 'at the start Back closes it');

  // The one Back catalog both shells install (web/core/escape-back.js): an open Welcome takes the press.
  const ctx = { window: {}, document: { documentElement: {} }, MutationObserver: class { observe() {} disconnect() {} }, queueMicrotask: f => f() };
  vm.createContext(ctx); vm.runInContext(read('web/core/escape-back.js'), ctx);
  const calls = []; ctx.window.WosWelcome = { active: true, back: () => { calls.push('welcome'); return 'welcome'; } };
  const stack = ctx.window.WizEscapeBack.create();
  ctx.window.WizEscapeBack.installOwners(stack, { chats: () => ({}), links: () => null });
  assert.equal(stack.run(), 'welcome');
  assert.deepEqual(calls, ['welcome']);
});

test('Welcome: finishes only after the first message is queued; a failed send keeps the words', async () => {
  let ok = false; const box = fakeBox({ signedIn: true, firstRun: true });
  const d = device(box, { send: async () => (ok ? { sessionId: 's1' } : null) });
  await d.boot();
  assert.equal(title(d), 'Say hello', 'no skins in this box: straight to hello');
  await d.submit('Hi Oscar'); await flush();
  assert.ok(d.W.active);
  assert.match(d.html(), /role="alert">That didn’t send\. Try again\./);
  assert.equal(d.nodes.textarea.value, 'Hi Oscar');
  assert.ok(!box.calls.includes(SEEN)); assert.notEqual(d.store.get('wos.welcome.v1'), 'done');
  ok = true; await d.submit('Hi Oscar'); await flush();
  assert.ok(!d.W.active); assert.ok(box.calls.includes(SEEN));
});

test('Welcome: Say hello sends the shown default when the box is empty or blank, typed words as typed (issue 1729)', async () => {
  for (const [typed, want] of [['', 'Hi! What can you help me with?'], ['   ', 'Hi! What can you help me with?'], ['Hello', 'Hello']]) {
    const sent = []; const box = fakeBox({ signedIn: true, firstRun: true });
    const d = device(box, { send: async t => (sent.push(t), { sessionId: 's1' }) });
    await d.boot();
    assert.equal(title(d), 'Say hello');
    assert.match(d.html(), /placeholder="Hi! What can you help me with\?"/, 'the box shows the default it sends');
    await d.submit(typed); await flush();
    assert.deepEqual(sent, [want], `typed ${JSON.stringify(typed)}`);
    assert.ok(!d.W.active, 'Send is never a dead tap: the Welcome finishes');
  }
  // A failed send puts the words that went (here the default) back into the box as real text.
  const box = fakeBox({ signedIn: true, firstRun: true });
  const d = device(box, { send: async () => null });
  await d.boot(); await d.submit(''); await flush();
  assert.ok(d.W.active); assert.equal(d.nodes.textarea.value, 'Hi! What can you help me with?');
});

test('Welcome: never covers work already started, keeps keys and focus, Back cancels the auto-advance', async () => {
  // A tap or a key before the reads come back keeps it away, and so does a recording.
  const tapped = device(fakeBox());
  tapped.W.boot(tapped.hooks); tapped.shell('pointerdown'); await tapped.advance(0);
  assert.ok(!tapped.W.active); assert.ok(tapped.log().includes('boot:busy'));
  const recording = device(fakeBox(), { busy: () => true }); await recording.boot();
  assert.ok(!recording.W.active);

  // Tab stays inside the card, the shell never sees the keys.
  const d = device(fakeBox());
  await d.boot();
  assert.deepEqual(d.nodes.focusables.map(n => n.attrs['data-app']), ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil']);
  d.doc.activeElement = d.nodes.focusables[2];
  const tab = d.key('Tab'); assert.equal(d.doc.activeElement, d.nodes.focusables[0], 'Tab wraps to the first');
  assert.ok(tab.prevented && tab.stopped);
  d.key('Tab', { shiftKey: true }); assert.equal(d.doc.activeElement, d.nodes.focusables[2], 'Shift+Tab wraps back');
  assert.ok(d.key('k').stopped, 'shell shortcuts wait');

  // Signed in: the step moves on by itself after a moment, unless Back came first.
  const box = fakeBox(), e = device(box, { skins: skins() });
  await e.boot();
  box.providers = [{ slug: 'anthropic', authenticated: true }];
  e.press('provider', { app: 'wizard-claude' }); await e.advance(3000);
  assert.match(e.html(), /Claude is connected\./);
  e.W.back(); await e.advance(2000);
  assert.equal(title(e), 'Connect your AI', 'Back cancelled the auto-advance');

  // desktop Esc: the shell's key handler hands Escape to the Welcome and runs no shortcut behind it
  const desktop = read('web/desktop/desktop.js'), start = desktop.indexOf('  function onKey(e, fromFrame = false)');
  const head = desktop.slice(start, desktop.indexOf('    keyHints.down(e);', start)), calls = [];
  const context = { pick: { active: () => false }, window: { WosWelcome: { active: true, back: () => calls.push('back') } }, desktopBack: () => { context.window.WosWelcome.back(); return 'welcome'; }, log() {} };
  vm.createContext(context); vm.runInContext(head + ' calls.push("shell"); }', Object.assign(context, { calls }));
  context.onKey({ key: 'Escape', target: { matches: () => false }, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') });
  assert.deepEqual(calls, ['prevent', 'stop', 'back']);
  calls.length = 0; context.onKey({ key: 'g', target: { matches: () => false } }); assert.deepEqual(calls, []);
});

test('Welcome: the server seen mark is retried until acknowledged; the Setup tile opens the Welcome', async () => {
  const box = fakeBox({ signedIn: true, firstRun: true, seen: [503, 200] });
  const d = device(box, { send: async () => ({ sessionId: 's1' }) });
  await d.boot(); await d.submit('hi'); await flush();
  assert.equal(d.store.get('wos.welcome.v1.seen-pending'), '1', 'not acknowledged yet');
  const later = device(box); for (const [k, v] of d.store) later.store.set(k, v);
  await later.boot();
  assert.equal(box.calls.filter(c => c === SEEN).length, 2);
  assert.equal(later.store.has('wos.welcome.v1.seen-pending'), false);

  // Both shells' openApp send the Setup tile to the Welcome; the phone also ends the tile's opening state.
  const openApp = (file, head) => {
    const s = read(file), a = s.indexOf(head), line = s.slice(a, s.indexOf('\n', s.indexOf("a.id === 'setup'", a)));
    const ctx = { window: { WosWelcome: { open: () => ctx.done.push('welcome') } }, done: [], openingEnd: id => ctx.done.push('end:' + id), closeSheets: () => ctx.done.push('sheets') };
    vm.createContext(ctx); vm.runInContext(line + '\n return false; }', ctx); return ctx;
  };
  const phone = openApp('web/app-search.js', 'function openApp(a, extra = {}, opts = {}) {');
  assert.equal(phone.openApp({ id: 'setup' }), true); assert.deepEqual(phone.done, ['end:setup', 'sheets', 'welcome']);
  const desk = openApp('web/desktop/desktop-resize.js', 'function openApp(a, opts = {}) {');
  assert.equal(desk.openApp({ id: 'setup' }), true); assert.deepEqual(desk.done, ['welcome']);
});

test('Welcome: Back can close during an install; the app-list wait is bounded', async () => {
  const box = fakeBox(), base = box.fetch; let release;
  box.fetch = (u, i) => String(u).includes('store-data') ? new Promise(r => { release = r; }) : base(u, i);
  const d = device(box, { apps: {} });
  await d.boot();
  d.press('provider', { app: 'wizard-claude' });
  assert.match(d.html(), /Installing…/);
  assert.equal(d.W.back(), 'welcome'); assert.ok(!d.W.active, 'Back closes while the install goes on');
  assert.ok(release);

  const slow = device(fakeBox(), { appsLoaded: () => new Promise(() => {}) });
  slow.W.boot(slow.hooks); await slow.advance(4000);
  assert.ok(!slow.W.active, 'still waiting for the app list');
  await slow.advance(1000);
  assert.ok(slow.W.active, 'opens after at most 5 s');
});

test('Welcome: works without AbortSignal.timeout; a late thread open never pulls the owner back', async () => {
  const old = device(fakeBox(), { noTimeout: true });
  await old.boot();
  assert.ok(old.W.active, 'older iOS WebViews still get the Welcome');

  const box = fakeBox(), d = device(box), opened = [];
  const wait = d.W.whenThreadExists('s1', sid => opened.push(sid));
  await d.advance(1000); d.shell('pointerdown'); // the owner moves on before the agent has the thread
  box.threads.s1 = [{ role: 'user', content: 'hi' }];
  await d.advance(3000); await wait;
  assert.deepEqual(opened, []); assert.ok(d.log().includes('thread:moved'));

  const e = device(box), got = [];
  await Promise.all([e.W.whenThreadExists('s1', sid => got.push(sid)), e.advance(10)]);
  assert.deepEqual(got, ['s1'], 'left alone, it opens the thread once it exists');
});

test('Welcome: a stale install completion never takes over a reopened Welcome', async () => {
  const apps = {}, box = fakeBox(), base = box.fetch; let finish;
  box.fetch = (u, i = {}) => {
    const s = String(u);
    if (s.includes('store-data')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ apps: [{ id: 'wizard-claude', version: '1' }] }) });
    if (s.includes('store-install/') && i.method === 'POST') return new Promise(r => { finish = () => { apps['wizard-claude'] = { url: '/wizard-claude/' }; r({ ok: true, status: 200, json: async () => ({ state: 'installed' }) }); }; });
    return base(u, i);
  };
  const d = device(box, { apps });
  await d.boot();
  d.press('provider', { app: 'wizard-claude' }); await d.advance(0);
  d.W.close(); d.W.open(); await d.advance(0);
  finish(); await d.advance(10);
  assert.ok(d.W.active); assert.equal(title(d), 'Connect your AI', 'the reopened Welcome stays where it is');
  assert.equal(d.nodes.iframe, null);
});

test('Welcome: Escape inside the embedded sign-in page steps back', () => {
  const handler=read('web/core/welcome.js').match(/fr\.contentDocument\.addEventListener\('keydown', (e => \{[^\n]+?\}), true\)/);
  const calls=[],window={WosBack:{escape:()=>calls.push('shared')}};
  const cb=vm.runInNewContext('('+handler[1]+')',{window,back:()=>calls.push('local')});
  cb({key:'Escape',preventDefault(){}});assert.deepEqual(calls,['shared']);
  delete window.WosBack;cb({key:'Escape',preventDefault(){}});assert.deepEqual(calls,['shared','local']);
});

test('Welcome: a readiness reply for an earlier provider choice is ignored', async () => {
  const box = fakeBox(), base = box.fetch; let answer;
  box.fetch = (u, i) => String(u).endsWith('/model/options') && box.hold ? new Promise(r => { answer = r; }) : base(u, i);
  const d = device(box);
  await d.boot();
  d.press('provider', { app: 'wizard-claude' });
  box.hold = true; await d.advance(3000); // Claude's readiness read is out
  d.W.back(); d.press('provider', { app: 'wizard-chatgpt' });
  answer({ ok: true, status: 200, json: async () => ({ providers: [{ slug: 'anthropic', authenticated: true }] }) });
  await d.advance(1500);
  assert.equal(title(d), 'Sign in to ChatGPT');
  assert.doesNotMatch(d.html(), /is connected/);
});
