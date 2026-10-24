import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness({ android = false, shell = 'phone', installed = true, failure = false, stale = false } = {}) {
  const storage = new Map(), posts = [], reads = [], notices = [], changed = [], stores = [];
  let current = 'wizard-chats', slot = current;
  const s = { console, Map, Set, Date, String, CSS: { escape: String }, setTimeout, document: { activeElement: null }, navigator: { userAgent: android ? 'Android' : 'Desktop' }, location: { host: 'example.test' }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } };
  s.window = s;
  s.WizCore = { refreshApps: async () => { if (!stale) current = slot; } };
  s.WizBrand = { html: 'W' };
  s.WizChatsHost = { defaultId: () => current, installed: () => [{ id: 'wizard-chats', name: 'Chats' }, ...(installed ? [{ id: 'mizel-chats', name: 'Mizel Chats' }] : [])] };
  s.WosSkin = { current: 'nebula', list: [{ id: 'nebula', name: 'Nebula' }, { id: 'obsidian-light', name: 'Light' }], families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula'] }, { id: 'mizel', name: 'Mizel', palettes: ['obsidian-light'], recommends: { chats: 'mizel-chats' } }], familyOf: id => id === 'nebula' ? 'wizard' : 'mizel' };
  s.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') { posts.push({ url, ...opts }); if (failure) return { ok: false, json: async () => ({ error: 'Owner connection needed' }) }; slot = JSON.parse(opts.body).default; return { ok: true }; }
    reads.push(url); return { ok: true, json: async () => ({ default: slot }) };
  };
  vm.runInNewContext(source, s);
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell, live: { ok: true }, helpSub: 'Help', toast: (...a) => notices.push(a), chatsChanged: id => changed.push(id), openStore: id => stores.push(id) });
  const act = (attribute, value = '') => view.dispatch({ closest: sel => sel === `[${attribute}]` ? { dataset: { [attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : null });
  return { s, root, view, act, storage, posts, reads, notices, changed, stores };
}
test('root is only an index: seven Android categories and no feature bodies; desktop has two panes', () => {
  const h = harness({ android: true });
  assert.equal((h.root.innerHTML.match(/class="st-category"/g) || []).length, 7);
  assert.doesNotMatch(h.root.innerHTML, /data-settings-feature=/);
  assert.doesNotMatch(h.root.innerHTML, /st-attention/);
  assert.match(h.root.innerHTML, /Wizard · Nebula/);
  assert.match(h.root.innerHTML, /Nothing waiting/);
  const d = harness({ shell: 'desktop' }); assert.match(d.root.innerHTML, /st-desktop/); assert.match(d.root.innerHTML, /data-settings-feature="look"/);
});
test('registry page, fallback and every historical alias route to their owning page', () => {
  const h = harness();
  h.s.WosSettings.register({ id: 'custom', page: 'chats', aliases: ['custom-link'], html: () => 'Custom' });
  h.s.WosSettings.register({ id: 'unmapped', page: 'unknown', aliases: ['future-link'], html: () => 'Future' });
  for (const [alias, page] of [['skin', 'appearance'], ['usage', 'usage'], ['mic', 'voice'], ['unsent', 'recovery'], ['chats-default', 'chats'], ['custom-link', 'chats'], ['future-link', 'about'], ['settings', '']]) {
    assert.equal(h.s.WosSettings.route(alias, h.view.focus), true); assert.equal(h.view.page, page, alias);
  }
  assert.equal(h.s.WosSettings.route('unknown', h.view.focus), false);
  assert.equal(h.s.WosSettings.pageOf({ id: 'look', page: 'typo' }), 'about', 'invalid explicit pages never silently use a legacy mapping');
  h.view.focus('unmapped'); assert.match(h.root.innerHTML, /Future/);
});
test('attention is conditional, counts real stores and routes each item; recovery subtitle deduplicates custody', () => {
  const h = harness();
  h.view.context.outbox = { canRetry: () => false, unsent: () => [{ id: 'same', createdAt: 1, state: 'failed' }] };
  h.s.WosCancelled = { html: () => '', list: () => [{ id: 'same' }, { id: 'other' }] };
  h.s.WosUpdates = { state: { update_available: true } };
  h.s.WizCore.voiceStatus = { card: () => '', state: { ready: false } }; h.view.context.live.error = 'access';
  h.view.render();
  for (const text of ['1 message not sent', '2 recordings to recover', 'Update ready', 'Voice unavailable', 'Sign-in needed', '2 waiting']) assert.ok(h.root.innerHTML.includes(text), text);
  for (const [feature, page] of [['unsent', 'recovery'], ['cancelled', 'recovery'], ['updates', 'release'], ['voice', 'voice'], ['wizard', 'about']]) { h.act('data-st-attention', feature); assert.equal(h.view.page, page); }
});
test('page Back returns to root, then leaves closing to the shell; confirm Back only dismisses', () => {
  const h = harness(); h.view.focus('chats-default'); h.act('data-chats-choice', 'mizel-chats');
  assert.match(h.root.innerHTML, /role="alertdialog"/); assert.equal(h.view.back(), true); assert.equal(h.view.page, 'chats');
  assert.equal(h.view.back(), true); assert.equal(h.view.page, ''); assert.equal(h.view.back(), false); assert.equal(h.posts.length, 0);
});
test('chooser confirms before POST, reads the exact slot, refreshes registry and rerenders only after confirmation', async () => {
  const h = harness(); h.view.focus('chats-default');
  assert.match(h.root.innerHTML, /Wizard Chats \(built in\)/); assert.match(h.root.innerHTML, /Mizel Chats/);
  h.act('data-chats-choice', 'mizel-chats'); assert.equal(h.posts.length, 0); assert.match(h.root.innerHTML, /Use Mizel Chats for all your chats\?/);
  h.act('data-chats-confirm'); await tick();
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].url, '/wizard-os-home/store-install/_slots/chats');
  assert.equal(h.posts[0].body, '{"default":"mizel-chats"}'); assert.equal(h.posts[0].credentials, 'same-origin');
  assert.deepEqual(h.reads, ['/wizard-os-home/store-install/_slots/chats']); assert.deepEqual(h.changed, ['mizel-chats']);
  assert.match(h.root.innerHTML, /aria-checked="true" data-chats-choice="mizel-chats"/);
});
test('chooser failure keeps old selected provider and toasts the server error', async () => {
  const h = harness({ failure: true }); h.view.focus('chats-default'); h.act('data-chats-choice', 'mizel-chats'); h.act('data-chats-confirm'); await tick();
  assert.match(h.root.innerHTML, /aria-checked="true" data-chats-choice="wizard-chats"/); assert.equal(h.changed.length, 0); assert.equal(h.notices[0][1], 'Owner connection needed');
});
test('unconfirmed registry does not claim success or rerender Chats', async () => {
  const h = harness({ stale: true }); h.view.focus('chats-default'); h.act('data-chats-choice', 'mizel-chats'); h.act('data-chats-confirm'); await tick();
  assert.equal(h.changed.length, 0); assert.match(h.notices[0][1], /app list has not confirmed/);
});
test('built-in only has selected built-in and a Store hint; uninstalled suggestion opens exact Store app', () => {
  const h = harness({ installed: false }); h.view.focus('chats-default');
  assert.match(h.root.innerHTML, /aria-checked="true" data-chats-choice="wizard-chats"/); assert.match(h.root.innerHTML, /Install another Chats from the/);
  h.s.WosSkin.current = 'obsidian-light'; h.view.render(); assert.match(h.root.innerHTML, /Mizel goes with Mizel Chats/); assert.match(h.root.innerHTML, />Get it<\/button>/);
  h.act('data-chats-suggest', 'mizel-chats'); assert.deepEqual(h.stores, ['mizel-chats']); assert.equal(h.posts.length, 0);
});
test('recommendation appears on both pages, never switches automatically, and Not now persists per skin family', () => {
  const h = harness(); h.s.WosSkin.current = 'obsidian-light';
  for (const feature of ['look', 'chats-default']) { h.view.focus(feature); assert.match(h.root.innerHTML, /Mizel goes with Mizel Chats/); assert.match(h.root.innerHTML, />Use it<\/button>/); }
  assert.equal(h.posts.length, 0); h.act('data-chats-dismiss', 'mizel');
  for (const feature of ['look', 'chats-default']) { h.view.focus(feature); assert.doesNotMatch(h.root.innerHTML, /data-chats-suggestion/); }
  assert.equal(h.storage.get('wos.settings.chats.dismiss.mizel'), 'mizel-chats'); assert.equal(h.posts.length, 0);
});

test('index opens on My release as one hero card, then the categories; Look is design only; About comes last', () => {
  const h = harness();
  assert.doesNotMatch(h.root.innerHTML, /st-hero/, 'no release card until the updates module knows something');
  h.s.WosUpdates = { state: { mode: 'ask' }, hero: () => ({ title: "Miguel's release", lines: ['Built on Latest b79c1e9', '4 changes of your own'], state: 'Up to date', tone: 'ok', mine: true }) };
  h.view.render();
  const html = h.root.innerHTML;
  assert.match(html, /<nav aria-label="Settings categories"><button class="st-hero" data-st-page="release"[^>]*><span class="st-tx"><b>Miguel&#39;s release<\/b><small>Built on Latest b79c1e9<\/small><small>4 changes of your own<\/small><\/span><span class="st-hero-state ok">Up to date<\/span>/);
  assert.doesNotMatch(html, /data-st-page="release"[^>]*class="st-category"|class="st-category" data-st-page="release"/, 'the hero replaces the plain row');
  const order = [...html.matchAll(/data-st-page="([a-z]+)"/g)].map(m => m[1]);
  assert.equal(order[0], 'release'); assert.equal(order.at(-1), 'about');
  assert.match(html, /<b>Look<\/b>/); assert.doesNotMatch(html, /Updates &amp; about|Updates & about|>Appearance</);
  h.act('data-st-page', 'release'); assert.equal(h.view.page, 'release');
  assert.match(h.root.innerHTML, /<h3 tabindex="-1">My release &amp; updates<\/h3>|<h3 tabindex="-1">My release & updates<\/h3>/);
  for (const alias of ['updates', 'my-release']) { h.view.focus(alias); assert.equal(h.view.page, 'release', alias); }
  h.view.focus('look'); assert.equal(h.view.page, 'appearance');
  assert.match(h.root.innerHTML, /<p class="st-intro">Design only: colours, fonts, backgrounds\. Separate from My release\.<\/p>/);
  const d = harness({ shell: 'desktop' }); d.s.WosUpdates = h.s.WosUpdates; d.view.render(); d.view.focus();
  assert.match(d.root.innerHTML, /<h3 tabindex="-1">My release/, 'desktop opens on My release when there is one');
});
