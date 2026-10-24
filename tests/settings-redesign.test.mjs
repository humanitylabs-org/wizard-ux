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
  s.WosSkin = { current: 'nebula', list: [{ id: 'nebula', name: 'Nebula' }, { id: 'obsidian-light', name: 'Light' }], families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula'] }, { id: 'mizel', name: 'Mizel', palettes: ['obsidian-light'] }], familyOf: id => id === 'nebula' ? 'wizard' : 'mizel' };
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
  assert.match(h.root.innerHTML, /<span class="st-tx"><b>Look<\/b><\/span><span class="st-val" data-st-subtitle="appearance">Nebula<\/span>/, 'Look shows the skin name as a quiet value');
  assert.doesNotMatch(h.root.innerHTML, /Nothing waiting|<small|st-ic/, 'no subtitles, no icon tiles on the index');
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
test('falsy root focus from real shell settings buttons never treats a boolean as an Element', () => {
  for (const shell of ['phone', 'desktop']) {
    const h = harness({ shell });
    for (const id of [undefined, null, '', false, 0]) {
      h.view.focus('look');
      assert.equal(h.view.page, 'appearance');
      assert.doesNotThrow(() => h.view.focus(id));
      assert.equal(h.view.page, '');
    }
  }
});
test('attention is conditional, counts real stores and routes each item; recovery subtitle deduplicates custody', () => {
  const h = harness();
  h.view.context.outbox = { canRetry: () => false, unsent: () => [{ id: 'same', createdAt: 1, state: 'failed' }] };
  h.s.WosCancelled = { html: () => '', list: () => [{ id: 'same' }, { id: 'other' }] };
  h.s.WosUpdates = { state: { update_available: true } };
  h.s.WizWebUpdate = { pending: true };
  h.s.WizCore.voiceStatus = { card: () => '', state: { ready: false } }; h.view.context.live.error = 'access';
  h.view.render();
  for (const text of ['1 message not sent', '2 recordings to recover', 'Voice unavailable', 'Sign-in needed', 'data-st-subtitle="recovery">2<']) assert.ok(h.root.innerHTML.includes(text), text);
  assert.doesNotMatch(h.root.innerHTML, /Update ready|<h4>Needs attention/, 'updates are said once, by the update card');
  for (const [feature, page] of [['unsent', 'recovery'], ['cancelled', 'recovery'], ['voice', 'voice'], ['wizard', 'about']]) { h.act('data-st-attention', feature); assert.equal(h.view.page, page); }
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
test('built-in only has selected built-in and a Store hint; Store opens the Store', () => {
  const h = harness({ installed: false }); h.view.focus('chats-default');
  assert.match(h.root.innerHTML, /aria-checked="true" data-chats-choice="wizard-chats"/); assert.match(h.root.innerHTML, /Install another Chats from the/);
  h.act('data-chats-store'); assert.deepEqual(h.stores, [undefined]); assert.equal(h.posts.length, 0);
});
test('no skin suggests a Chats app: Look and Chats show no pairing on any skin', () => {
  const h = harness();
  for (const skin of ['nebula', 'obsidian-light']) {
    h.s.WosSkin.current = skin;
    for (const feature of ['look', 'chats-default']) { h.view.focus(feature); assert.doesNotMatch(h.root.innerHTML, /data-chats-suggestion|goes with/); }
  }
  h.view.focus('look');
  assert.doesNotMatch(h.root.innerHTML, /skp-fam/); assert.match(h.root.innerHTML, /data-skinpick="nebula"[\s\S]*data-skinpick="obsidian-light"/);
  assert.equal(h.posts.length, 0);
});

test('index: the update card leads when there is something to do, nothing otherwise; My release is a plain row', () => {
  const h = harness();
  assert.doesNotMatch(h.root.innerHTML, /osu-card|data-st-page="release"/, 'no release row until the updates module knows something');
  let cardHtml = '';
  h.s.WosUpdates = { state: { mode: 'ask' }, mine: { name: 'x' }, title: () => 'My release', cardHtml: () => cardHtml };
  h.view.render();
  let html = h.root.innerHTML;
  assert.doesNotMatch(html, /osu-card|st-card-wrap/, 'nothing to do: no card at all');
  assert.match(html, /<nav aria-label="Settings categories"><button class="st-category" data-st-page="release" aria-current="false"><span class="st-tx"><b>My release<\/b><\/span>/);
  const order = [...html.matchAll(/data-st-page="([a-z]+)"/g)].map(m => m[1]);
  assert.equal(order[0], 'release'); assert.equal(order.at(-1), 'about');
  assert.doesNotMatch(html, /st-hero|Check for updates|Update ready/);
  cardHtml = '<div class="osu-card" data-osu-card="behind"><button data-osu="apply">Update</button></div>';
  h.view.render(); html = h.root.innerHTML;
  assert.match(html, /<h3 class="st-title" tabindex="-1">Settings<\/h3><section class="st-card-wrap" data-settings-feature="updates"><div class="osu-card" data-osu-card="behind">/);
  h.act('data-st-page', 'release'); assert.equal(h.view.page, 'release');
  assert.match(h.root.innerHTML, /<h3 tabindex="-1">My release<\/h3>/);
  for (const alias of ['updates', 'my-release']) { h.view.focus(alias); assert.equal(h.view.page, 'release', alias); }
  h.view.focus('look'); assert.equal(h.view.page, 'appearance');
  assert.doesNotMatch(h.root.innerHTML, /st-intro/);
  const d = harness({ shell: 'desktop' }); d.s.WosUpdates = h.s.WosUpdates; d.view.render(); d.view.focus();
  assert.match(d.root.innerHTML, /<h3 tabindex="-1">My release/, 'desktop opens on My release when there is one');
  assert.doesNotMatch(d.root.innerHTML, /st-card-wrap/, 'desktop: the release page beside the list carries the card, the list does not repeat it');
  const stock = harness(); stock.s.WosUpdates = { state: { mode: 'auto' }, title: () => 'Updates', cardHtml: () => '' }; stock.view.render();
  assert.match(stock.root.innerHTML, /<b>Updates<\/b>/);
});
test('About has no separate Check for updates; rows carry no icon tiles anywhere in Settings', () => {
  const h = harness(); h.s.WizWebUpdate = { check() {}, pending: false };
  h.view.focus('wizard');
  assert.doesNotMatch(h.root.innerHTML, /Check for updates|web-update|st-ic/);
  assert.match(h.root.innerHTML, /Gestures &amp; help|Gestures & help/);
  for (const f of ['settings', 'mic', 'voice-status', 'sel-menu', 'workspace-sync']) {
    const code = fs.readFileSync(new URL(`../web/core/${f}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /class="st-ic"/, f);
  }
  assert.doesNotMatch(fs.readFileSync(new URL('../web/device.js', import.meta.url), 'utf8'), /class="st-ic"/);
});
test('settings.css: rows are hairline lines, not boxes', () => {
  const css = fs.readFileSync(new URL('../web/core/settings.css', import.meta.url), 'utf8');
  const rule = sel => (css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';
  for (const sel of ['.st-row', '.st-category', '.ub-row', '.cx-row', '.sc-row']) {
    const r = rule(sel);
    assert.ok(r, sel);
    assert.match(r, /border-bottom: 1px solid var\(--wz-border\)/, sel);
    assert.doesNotMatch(r, /background: var\(--wz-surface\)|border-radius: 1[2-9]px/, sel);
  }
  assert.doesNotMatch(css, /\.st-ic \{|\.st-hero \{/);
});
