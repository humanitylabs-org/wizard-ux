// Home update pop-up (core/os-updates.js, wizard-os#186): the Settings card's state on Home with ×, per-state dismiss,
// and the old "Wizard OS was updated" banner stepping aside so only one shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/os-updates.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const REL = { name: "Miguel's release", base: '2ebbb689', build: 'aaaa111', behind: 0, new: [], building: false, failed: null };
const ST = rel => ({ mode: 'ask', chosen: true, channel: 'latest', installed: null, latest: '2ebbb689', update_available: rel.behind > 0, unpinned: false, checked: true, installing: false, interrupted: false, release: rel });

function el(tag) {
  const e = { tag, className: '', dataset: {}, style: {}, attrs: {}, innerHTML: '', listeners: {}, removed: false,
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; }, remove() { this.removed = true; body.kids = body.kids.filter(k => k !== this); } };
  return e;
}
const body = { kids: [], appendChild(e) { this.kids.push(e); } };
async function boot({ status, build = 'aaaa111', home = true, storage = new Map(), web } = {}) {
  body.kids = [];
  let mineBuild = build;
  const posts = [];
  const fetch = async (url, opts = {}) => {
    if (url.endsWith('my-release.json')) return { ok: true, json: async () => ({ name: "Miguel's release", base: { ref: '2ebbb689' }, build: mineBuild, changes: [] }) };
    if (opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ started: true }) }; }
    return { ok: true, json: async () => status };
  };
  const window = { innerHeight: 874, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    __wos: { idx: home ? 0 : 1, sheet: null, desks: [{ wins: [] }], toast() {} }, WizWebUpdate: web };
  const document = { body, hidden: false, currentScript: { src: 'https://box/wizard-os-home/core/os-updates.js' },
    createElement: el, querySelector: sel => sel === '#dock, .dock' ? { getBoundingClientRect: () => ({ top: 790, height: 84 }) } : null, addEventListener() {} };
  new Function('window', 'document', 'fetch', 'location', 'setInterval', 'clearInterval', src)(window, document, fetch, { href: 'https://box/wizard-os-home/', reload() {} }, () => 0, () => {});
  await tick(); await tick(); await tick();
  return { U: window.WosUpdates, window, storage, posts, pop: () => body.kids.find(k => k.className === 'osu-pop' && !k.removed), setBuild: b => { mineBuild = b; } };
}
const click = (pop, sel) => pop.listeners.click({ target: { closest: s => (s === sel || (sel === '[data-osu]' && s === '[data-osu]')) ? { dataset: { osu: 'apply' } } : null } });

test('pop-up shows Update with the same words and button as the card, above the dock', async () => {
  const b = await boot({ status: ST({ ...REL, behind: 3, new: [{ sha: 'c3', title: 'x' }] }) });
  b.U.popup();
  const p = b.pop(); assert.ok(p, 'pop-up on Home');
  assert.match(p.innerHTML, /<b>3 new changes on Latest<\/b><span>Get them under your release<\/span><\/div><button type="button" class="osu-pop-go" data-osu="apply" >Update<\/button>/);
  assert.match(p.innerHTML, /data-osu-dismiss aria-label="Dismiss">×/);
  assert.equal(p.style.bottom, (874 - 790 + 12) + 'px', 'sits 12px above the dock top');
  click(p, '[data-osu]'); await tick();
  assert.deepEqual(b.posts, [{ action: 'apply' }], 'tapping Update does what Settings does');
});
test('pop-up shows Couldn’t update and Reload (new build); nothing when there is nothing to do', async () => {
  const f = await boot({ status: ST({ ...REL, behind: 2, failed: { code: 'CONFLICT' } }) }); f.U.popup();
  assert.match(f.pop().innerHTML, /Couldn’t update.*Try again/s);
  const n = await boot({ status: ST(REL) }); n.U.popup();
  assert.equal(n.pop(), undefined, 'nothing to do: no pop-up');
  n.setBuild('bbbb222'); await n.U.poll(); n.U.popup();
  assert.match(n.pop().innerHTML, /New build ready.*Reload/s);
  assert.equal(n.U.popKey(n.U.card()), 'reload:bbbb222');
});
test('× hides it for that state only; a new key brings it back; never off Home', async () => {
  const storage = new Map();
  const b = await boot({ status: ST(REL), storage }); b.setBuild('bbbb222'); await b.U.poll(); b.U.popup();
  b.pop().listeners.click({ target: { closest: s => s === '[data-osu-dismiss]' ? {} : null } });
  assert.equal(b.pop(), undefined); assert.equal(storage.get('wos.osu.dismissed'), 'reload:bbbb222');
  b.U.popup(); assert.equal(b.pop(), undefined, 'stays dismissed for the same build');
  const again = await boot({ status: ST(REL), storage }); again.setBuild('bbbb222'); await again.U.poll(); again.U.popup();
  assert.equal(again.pop(), undefined, 'dismissal survives a reload of the page');
  again.setBuild('cccc333'); await again.U.poll(); again.U.popup();
  assert.match(again.pop().innerHTML, /New build ready/, 'a newer build shows again');
  const away = await boot({ status: ST({ ...REL, behind: 3 }), home: false }); away.U.popup();
  assert.equal(away.pop(), undefined, 'not on Home: no pop-up');
});
test('only one: the old web banner steps aside while the pop-up carries the reload or after its ×', async () => {
  const web = { pending: true, version: 'v:abc', render() {}, armed: false };
  const b = await boot({ status: ST(REL), web }); b.U.popup();
  assert.match(b.pop().innerHTML, /Reload/);
  assert.equal(b.U.ownsReload(), true);
  const w = readFileSync(new URL('../web/core/web-update.js', import.meta.url), 'utf8');
  assert.match(w, /if \(window\.WosUpdates\?\.ownsReload\?\.\(\)\) \{ document\.getElementById\('dvWeb'\)\?\.remove\(\)/);
  const off = await boot({ status: ST(REL), web, home: false }); off.U.popup();
  assert.equal(off.U.ownsReload(), false, 'off Home and not dismissed: the old banner keeps telling');
  const css = readFileSync(new URL('../web/core/update-banner.css', import.meta.url), 'utf8');
  assert.match(css, /\.osu-pop \{[^}]*--wz-text/, 'styled with --wz-* tokens');
});
