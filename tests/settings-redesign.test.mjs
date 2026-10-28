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
  const act = (attribute, value = '') => view.dispatch({ closest: sel => sel === '[data-settings-feature]' ? {dataset:{settingsFeature:'look'}} : sel === `[${attribute}]` ? { dataset: { [attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : null });
  return { s, root, view, act, storage, posts, reads, notices, changed, stores };
}
test('root is only an index: seven Android categories and no feature bodies; desktop has two panes', () => {
  const h = harness({ android: true });
  assert.equal((h.root.innerHTML.match(/class="st-category"/g) || []).length, 7);
  assert.doesNotMatch(h.root.innerHTML, /data-settings-feature=/);
  assert.doesNotMatch(h.root.innerHTML, /st-attention/);
  assert.match(h.root.innerHTML, /<span class="st-tx"><b>Appearance<\/b><\/span><span class="st-val" data-st-subtitle="appearance">Nebula<\/span>/, 'Look shows the skin name as a quiet value, not a family-prefixed subtitle');
  assert.doesNotMatch(h.root.innerHTML, /Nothing waiting|<small|st-ic|Wizard · Nebula/, 'no subtitles, no icon tiles on the index');
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
  h.s.WizCore.voiceStatus = { card: () => '', state: { ready: false } }; h.view.context.live.error = 'access';
  h.view.render();
  h.s.WizWebUpdate = { pending: true };
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
test('tap outside closes Settings confirmations like Back without leaving the owning page', () => {
  for (const shell of ['phone','desktop']) {
    const h = harness({shell});
    const outside = {classList:{contains: c => c === 'st-confirm-scrim'},closest:()=>null};
    h.view.focus('chats-default'); h.act('data-chats-choice','mizel-chats');
    assert.match(h.root.innerHTML,/role="alertdialog"/);
    assert.equal(h.view.dispatch(outside),true);
    assert.doesNotMatch(h.root.innerHTML,/role="alertdialog"/);
    assert.equal(h.view.page,'chats'); assert.equal(h.posts.length,0);
  }
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
test('built-in only has selected built-in and a Store hint that opens the Store', () => {
  const h = harness({ installed: false }); h.view.focus('chats-default');
  assert.match(h.root.innerHTML, /aria-checked="true" data-chats-choice="wizard-chats"/); assert.match(h.root.innerHTML, /Install another Chats from the/);
  h.act('data-chats-store'); assert.equal(h.stores.length, 1); assert.equal(h.posts.length, 0);
});
test('no skin suggests a Chats app: Look and Chats show no pairing on any skin', () => {
  const h = harness(); h.s.WosSkin.current = 'obsidian-light';
  for (const feature of ['look', 'chats-default']) { h.view.focus(feature); assert.doesNotMatch(h.root.innerHTML, /data-chats-suggest|goes with/); }
  assert.doesNotMatch(source, /recommendation\(|suggestionHtml|data-chats-dismiss/);
  assert.equal(h.posts.length, 0);
});
test('Look: family tiles lead, only the worn family colours render, and Layout is gone', () => {
  const h = harness(); h.s.WosSkin.current = 'obsidian-light'; h.view.focus('look');
  const html = h.root.innerHTML;
  assert.match(html, /data-skinfamily="wizard"[^]*data-skinfamily="mizel" aria-pressed="true"/);
  assert.match(html, /<h4>Colours<\/h4>[^]*aria-label="Mizel colours"[^]*data-skinpick="obsidian-light"/);
  assert.doesNotMatch(html, /data-skinpick="nebula"|data-layout-row|data-layoutpick|<b>Layout<\/b>/);
  h.s.WosSkin.current = 'nebula'; h.view.render();
  assert.match(h.root.innerHTML, /aria-label="Wizard colours"[^]*data-skinpick="nebula"/);
  assert.doesNotMatch(h.root.innerHTML, /data-skinpick="obsidian-light"/);
});
test('index: one update card on top when there is something to do, nothing otherwise; desktop does not repeat it beside About', () => {
  const h = harness();
  let cardHtml = '';
  h.s.WosUpdates = { state: { mode: 'ask' }, cardHtml: () => cardHtml };
  h.view.render();
  assert.doesNotMatch(h.root.innerHTML, /osu-card|st-card-wrap|Check for updates|Update ready/, 'nothing to do: no card at all');
  cardHtml = '<div class="osu-card" data-osu-card="behind"><button data-osu="apply">Update</button></div>';
  h.view.render();
  assert.match(h.root.innerHTML, /<h3 class="st-title" tabindex="-1">Settings<\/h3><section class="st-card-wrap" data-settings-feature="updates"><div class="osu-card" data-osu-card="behind">/);
  const d = harness({ shell: 'desktop' }); d.s.WosUpdates = h.s.WosUpdates; d.view.focus('about');
  assert.doesNotMatch(d.root.innerHTML, /st-card-wrap/, 'desktop: About & updates beside the list carries the card');
  d.view.focus('look'); assert.match(d.root.innerHTML, /st-card-wrap/);
  h.s.WosSettings.register({ id: 'updates', aliases: ['updates'], html: () => '<div data-osu-group>U</div>' });
  h.view.focus('updates'); assert.equal(h.view.page, 'about');
  assert.ok(h.root.innerHTML.indexOf('data-settings-feature="updates"><div data-osu-group>') < h.root.innerHTML.indexOf('data-settings-feature="wizard"'), 'About & updates leads with updates');
});
test('About has no separate Check for updates; rows carry no icon tiles anywhere in Settings', () => {
  const h = harness(); h.s.WizWebUpdate = { check() {}, pending: false };
  h.view.focus('wizard');
  assert.doesNotMatch(h.root.innerHTML, /Check for updates|web-update|st-ic/);
  assert.match(h.root.innerHTML, /Gestures &amp; help|Gestures & help/);
  for (const f of ['settings', 'mic', 'voice-status', 'sel-menu', 'os-updates']) {
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
  assert.doesNotMatch(css, /\.st-ic \{|\.st-hero \{|\.st-suggestion \{/);
});
test('New skin is last; nested Back returns to Look on both shells, never leaves the app', async () => {
  for (const shell of ['phone', 'desktop']) {
    const h = harness({shell});
    h.s.WosMySkin = { recipes: [], state: { empty: true, script: {} } };
    h.s.WosExperience = { installed: async()=>[], defaults: async()=>({}), state: {tweaks:[]} };
    h.view.focus('look');
    assert.match(h.root.innerHTML, /data-skinfamily="mizel"[^]*data-newskin[^]*\+ New skin/);
    h.act('data-newskin'); await tick();
    assert.match(h.root.innerHTML, /data-newskin-sheet/);
    assert.match(h.root.innerHTML, /aria-label="Back to Look"/);
    assert.equal(h.view.back(), true); assert.equal(h.view.page, 'appearance');
    assert.doesNotMatch(h.root.innerHTML, /data-newskin-sheet/);
    assert.match(h.root.innerHTML, /data-newskin/);
    h.act('data-newskin'); h.view.focus('chats'); await tick();
    assert.equal(h.view.context.skinDraft, null, 'leave invalidates pending form defaults');
  }
});
test('desktop implicit Appearance uses its feature lifecycle for New skin Back, refresh and leave', async () => {
  const h = harness({shell:'desktop'});
  h.s.WosMySkin = {recipes:[],state:{script:{}}};
  h.s.WosExperience = {installed:async()=>[],defaults:async()=>({}),state:{tweaks:[]}};
  h.view.render(); assert.equal(h.view.page, '');
  h.act('data-newskin'); await tick();
  assert.equal(h.root.dataset.settingsNested,'true');
  const html = h.root.innerHTML; h.view.render(); assert.equal(h.root.innerHTML,html);
  assert.equal(h.view.back(),true); assert.equal(h.view.context.skinDraft,null);
  assert.equal(h.root.dataset.settingsNested,'false');
  h.act('data-newskin'); h.view.focus('chats'); await tick();
  assert.equal(h.view.context.skinDraft,null);
});
test('own tiles use base preview; own panel shows colours, edit hint and a nested remove confirmation', () => {
  const h = harness();
  const own = {id:'mine',name:'Quiet',base:'nebula',tweaks:{}};
  h.s.WosMySkin = { recipes:[own],active:own,state:{script:{}} };
  h.view.focus('look');
  assert.match(h.root.innerHTML,/data-ownskin="mine" aria-pressed="true"/);
  assert.match(h.root.innerHTML,/aria-label="Quiet colours"/);
  assert.match(h.root.innerHTML,/change my Quiet skin so…/);
  h.act('data-ownskin-remove','mine'); assert.match(h.root.innerHTML,/role="alertdialog"/);
  assert.equal(h.view.back(),true); assert.equal(h.view.page,'appearance');
  assert.doesNotMatch(h.root.innerHTML,/role="alertdialog"/);
});
test('own skin Edit opens only registered Files IDs or shows the Wizard hint', () => {
  const h = harness(); const opened=[];
  h.s.WosMySkin = {recipes:[],active:{name:'Quiet'},state:{script:{}}};
  h.s.WizCanOpen = id => id === 'wizard-files'; h.s.WizOpenApp = id => {opened.push(id); return true;};
  h.act('data-myskin','edit'); assert.deepEqual(opened,['wizard-files']);
  h.s.WizCanOpen = id => id === 'files'; h.act('data-myskin','edit'); assert.deepEqual(opened,['wizard-files','files']);
  h.s.WizCanOpen = () => false; h.act('data-myskin','edit');
  assert.equal(opened.length,2); assert.match(h.notices.at(-1)[1],/change my Quiet skin so/);
});
test('arrows reach every tile without silently wearing or opening it', () => {
  assert.match(source,/\[data-ownskin\], \[data-newskin\]/);
  assert.match(source,/buttons\[n\]\.focus\(\);/);
  assert.doesNotMatch(source,/buttons\[n\]\.click/);
});
test('Resources: the page shows the Home resource bars from the shared renderer; the index row stays quiet unless something is low', () => {
  const h = harness();
  const hosts = [];
  let low = { label: 'Disk', left: 60, value: '40/100 GB used' };
  h.s.WosResources = { bars: host => hosts.push(host), lowest: () => low };
  h.view.render();
  assert.match(h.root.innerHTML, /<b>Resources<\/b><\/span><span class="st-val" data-st-subtitle="usage"><\/span>/, 'renamed, no value while nothing is low');
  low = { label: 'Disk', left: 12, value: '88/100 GB used' }; h.view.render();
  assert.match(h.root.innerHTML, /data-st-subtitle="usage">Disk 88\/100 GB used</, 'under a quarter left: the lowest one');
  const section = { querySelector: sel => sel === '[data-st-resources]' ? { host: true } : null };
  h.root.querySelector = sel => sel === '[data-settings-feature="usage"]' ? section : null;
  h.view.focus('resources');
  assert.equal(h.view.page, 'usage');
  assert.match(h.root.innerHTML, /<h3 tabindex="-1">Resources<\/h3><\/header><section data-settings-feature="usage"><div class="st-group st-res" data-st-resources><\/div>/);
  assert.ok(hosts.some(x => x.host), 'WosResources.bars draws into the page host');
});
test('Resources falls back to AI usage where the shared bars are not there', () => {
  const h = harness();
  h.s.WosUsage = { html: () => '<p>usage</p>', loading: true, snap: {}, at: Date.now(), load: async () => {} };
  h.view.focus('usage');
  assert.match(h.root.innerHTML, /<h3 tabindex="-1">AI usage<\/h3>[^]*<p>usage<\/p>/);
});
