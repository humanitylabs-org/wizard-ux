// wizard-ux issue 1236 (James, 10 Nov 2026: "make that the default"): the desktop-style phone Chats list
// (wizard/desktop-chats) is a release-wide default. Fresh and undecided installs get it; an owner who switched it off
// keeps it off (also the off he chose before it became a default, carried by look sync); desktop is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const ID = 'wizard/desktop-chats', INBOX = 'wizard/unified-inbox';
const tick = async () => { for (let n = 0; n < 12; n++) await new Promise(r => setImmediate(r)); };

test('catalog: desktop-chats is a default, still listed, promoted once, never a profile off', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json')), prof = JSON.parse(read('web/tweaks/wizard/profile.json'));
  assert.ok(cat.defaults.includes(ID)); assert.ok(cat.tweaks.includes(ID));
  assert.deepEqual(cat.promotedDefaults, [ID]);
  for (const id of cat.promotedDefaults) assert.ok(cat.defaults.includes(id), id + ' promoted must be a default');
  assert.ok(!(prof.off || []).includes(ID));
  assert.ok(!(cat.lookOnlyOff || []).includes(ID), 'the look-only drop list never turns the new default off');
});

test('desktop is unchanged: every rule is phone-only and the script returns at once on desktop', () => {
  const css = read('web/tweaks/wizard/desktop-chats/tweak.css'), js = read('web/tweaks/wizard/desktop-chats/tweak.js');
  for (const sel of css.replace(/\/\*[^]*?\*\//g, '').split('}').map(b => b.split('{')[0].trim()).filter(s => s && !s.startsWith('@')))
    for (const part of sel.split(',')) assert.match(part.trim(), /^html\[data-tweaks~="wizard\/desktop-chats"\]\[data-shell="phone"\]/, part);
  assert.match(js, /if \(api\.env\.shell !== 'phone'\) return \(\) => \{\};/);
  assert.deepEqual(JSON.parse(read('web/tweaks/wizard/desktop-chats/manifest.json')).shells, ['phone']);
});

function box(channel, saved, extra = {}) {
  const storage = new Map([['wos.skin', 'obsidian'], ...Object.entries(extra)]);
  if (saved) storage.set('wos.skin-tweaks.v1', JSON.stringify(saved));
  if (channel) storage.set('wos.channel.v1', channel);
  let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  return { E: window.WosExperience, storage, active: () => Array.from(active) };
}

test('a fresh install with no saved Look runs it, on For testers and on For everyone', async () => {
  for (const ch of [undefined, 'latest', 'stable']) {
    const b = box(ch); await b.E.refresh();
    assert.ok(b.active().includes(ID), String(ch));
    const t = b.E.state.tweaks.find(x => x.id === ID);
    assert.equal(t.on, true); assert.equal(t.builtin, true); assert.notEqual(t.locked, true);
    assert.equal(b.E.defaultChoices[ID], true);
    assert.deepEqual(clone(b.E.promotedDefaults), [ID]);
  }
});

test('an install updating from before keeps getting it unless the owner chose; his off stays off after reload', async () => {
  const before = { version: 1, off: {}, preset: 'none', mix: { 'miguel/send-and-go': true }, machinesHomeMoved: true, miguelLayoutMoved: true };
  const b = box('latest', before); await b.E.refresh();
  assert.ok(b.active().includes(ID), 'undecided owner gets the new default');
  await b.E.toggle(ID);
  assert.ok(!b.active().includes(ID));
  assert.ok(JSON.parse(b.storage.get('wos.skin-tweaks.v1')).defaultsOff.includes(ID));
  const again = box('latest', JSON.parse(b.storage.get('wos.skin-tweaks.v1'))); await again.E.refresh();
  assert.ok(!again.active().includes(ID), 'explicit off survives a reload');
  assert.equal(again.E.state.tweaks.find(x => x.id === ID).on, false);
});

test('a pre-upgrade device whose off is still in the look-sync queue (offline, or no Pages) keeps it off, once', async () => {
  const before = { version: 1, off: {}, preset: 'none', mix: { 'miguel/send-and-go': true }, machinesHomeMoved: true, miguelLayoutMoved: true };
  const queue = { version: null, synced: false, pending: { skin: null, tweaks: { [ID]: { on: false, at: 4 }, 'miguel/send-and-go': { on: true, at: 3 } } } };
  const b = box('latest', before, { 'wos.look-sync.v1': JSON.stringify(queue) }); await b.E.refresh();
  assert.ok(!b.active().includes(ID), 'queued off kept');
  const saved = JSON.parse(b.storage.get('wos.skin-tweaks.v1'));
  assert.deepEqual(saved.promotedMigrated, [ID]); assert.ok(saved.defaultsOff.includes(ID));
  // Once: turning it on later is not undone by the same old queue entry.
  await b.E.toggle(ID); assert.ok(b.active().includes(ID));
  const again = box('latest', JSON.parse(b.storage.get('wos.skin-tweaks.v1')), { 'wos.look-sync.v1': JSON.stringify(queue) }); await again.E.refresh();
  assert.ok(again.active().includes(ID), 'migration runs once per id');
  // A queued on, or no queue, leaves the new default on.
  for (const tweaks of [{ [ID]: { on: true, at: 2 } }, {}]) {
    const q = box('latest', before, { 'wos.look-sync.v1': JSON.stringify({ pending: { tweaks } }) }); await q.E.refresh();
    assert.ok(q.active().includes(ID), JSON.stringify(tweaks));
  }
  // A synced device's mix false (adopt writes false for every switch not on) is not an off.
  const synced = box('latest', { ...before, mix: { [ID]: false, 'miguel/send-and-go': true } }); await synced.E.refresh();
  assert.ok(synced.active().includes(ID));
});

// Look sync (web/core/look-sync.js) with a fake box, as in look-default-sync.test.mjs.
function look(initial) {
  let doc = initial, version = 0;
  return { get doc() { return clone(doc); },
    async req(url, init = {}) {
      const method = init.method || 'GET', reply = (status, data) => ({ status, ok: status < 300, json: async () => clone(data) });
      if (method === 'GET') return doc ? reply(200, { text: JSON.stringify(doc), version: String(version) }) : reply(404, { error: 'file_not_found' });
      const body = JSON.parse(init.body);
      if ((body.version ?? null) !== (doc ? String(version) : null)) return reply(409, { current: { text: JSON.stringify(doc), version: String(version), exists: !!doc } });
      doc = JSON.parse(body.text); version++; return reply(200, { version: String(version) });
    } };
}
function device(b, defaults, promoted = [ID]) {
  const win = {}, store = new Map();
  vm.runInNewContext(read('web/core/look-sync.js'), { window: win, JSON, Date, Object, Number, Error, Math, setTimeout, clearTimeout });
  const state = { defaults: { ...defaults }, mix: {} };
  const exp = { get defaultChoices() { return clone(state.defaults); }, get promotedDefaults() { return promoted ? [...promoted] : undefined; }, get mix() { return clone(state.mix); }, get views() { return {}; }, state: { tweaks: [] },
    async tweakIds() { return ['miguel/send-and-go']; },
    adopt(m, v, d = {}) { state.mix = clone(m); for (const [id, on] of Object.entries(d)) if (Object.hasOwn(state.defaults, id)) state.defaults[id] = on; } };
  const c = win.WosLookSync.create({ req: b.req, exp, store: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
    skin: { chosen: null, current: 'nebula', has: () => true, set() {} }, later: () => 0, cancel() {} });
  return { c, state };
}

test('look sync: an off the owner chose before the promotion is carried into defaults and wins over the new seed', async () => {
  const b = look({ version: 1, skin: null, tweaks: { [ID]: { on: false, at: 7 }, 'miguel/send-and-go': { on: true, at: 4 } } });
  const d = device(b, { [INBOX]: true, [ID]: true });
  await d.c.sync(); await tick();
  assert.equal(d.state.defaults[ID], false, 'his earlier off is kept');
  assert.deepEqual(b.doc.defaults[ID], { on: false, at: 7 });
  assert.deepEqual(b.doc.defaults[INBOX], { on: true, at: 0 });
  // A later choice is newer and wins, both ways.
  d.state.defaults[ID] = true; d.c.defaultChoice(ID, true); await d.c.sync(); await tick();
  assert.equal(b.doc.defaults[ID].on, true); assert.ok(b.doc.defaults[ID].at > 7);
  const other = device(b, { [INBOX]: true, [ID]: false }); await other.c.sync(); await tick();
  assert.equal(other.state.defaults[ID], true);
});

test('look sync: an on chosen before stays on; no earlier choice gets the default; only promoted ids are carried', async () => {
  const on = look({ version: 1, skin: null, tweaks: { [ID]: { on: true, at: 3 } } });
  const a = device(on, { [ID]: true }); await a.c.sync(); await tick();
  assert.equal(a.state.defaults[ID], true); assert.deepEqual(on.doc.defaults[ID], { on: true, at: 3 });
  const none = look({ version: 1, skin: null, tweaks: { 'miguel/send-and-go': { on: true, at: 2 } } });
  const n = device(none, { [ID]: true }); await n.c.sync(); await tick();
  assert.equal(n.state.defaults[ID], true); assert.deepEqual(none.doc.defaults[ID], { on: true, at: 0 });
  // An old tweaks entry for an id that is not promoted (here the inbox) never overrides that default.
  const old = look({ version: 1, skin: null, tweaks: { [INBOX]: { on: false, at: 5 } } });
  const o = device(old, { [INBOX]: true, [ID]: true }); await o.c.sync(); await tick();
  assert.equal(o.state.defaults[INBOX], true); assert.deepEqual(old.doc.defaults[INBOX], { on: true, at: 0 });
  // A shell without the getter (older experience.js) syncs as before.
  const legacy = look({ version: 1, skin: null, tweaks: { [ID]: { on: false, at: 7 } } });
  const l = device(legacy, { [ID]: true }, null); await l.c.sync(); await tick();
  assert.equal(l.state.defaults[ID], true);
});

test('Settings › Chats has the plain switch, since a default is not listed under Try new features', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /register\(\{ id: 'chats-list-style', page: 'chats', html: \(\) => \{ const r = settingRow\('wizard\/desktop-chats'\); return r \? `<div class="st-group"><h4>Chats list<\/h4>\$\{r\}<\/div>` : ''; \}, act: settingAct \}\);/);
});
