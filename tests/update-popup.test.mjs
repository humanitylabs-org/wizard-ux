// Home update pop-up (core/os-updates.js): the Settings update card's words and button on Home with ×, per-state
// dismiss, and the old "Wizard OS was updated" banner stepping aside so only one notice shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/os-updates.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const ST = (o = {}) => ({ mode: 'ask', chosen: true, channel: 'stable', installed: '0.3.32', latest: '0.3.33', stable: '0.3.33', update_available: true, unpinned: false, checked: true, installing: false, interrupted: false, ...o });

const body = { kids: [], appendChild(e) { this.kids.push(e); } };
function el(tag) {
  return { tag, className: '', dataset: {}, style: {}, attrs: {}, innerHTML: '', listeners: {}, removed: false,
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; }, remove() { this.removed = true; body.kids = body.kids.filter(k => k !== this); } };
}
async function boot({ status, home = true, storage = new Map(), web, desktop = false, overlay = null, timers = [], now = null } = {}) {
  body.kids = [];
  const posts = [];
  const fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ started: true }) }; }
    return { ok: true, json: async () => status };
  };
  const window = { innerHeight: 874, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) }, WizWebUpdate: web };
  if (desktop) window.__wux = { homeOpen: home, ws: [{ wins: home ? [] : [1] }], cur: 0, toast() {} };
  else window.__wos = { idx: home ? 0 : 1, sheet: null, desks: [{ wins: [] }], toast() {} };
  const document = { body, hidden: false, currentScript: { src: 'https://box/wizard-os-home/core/os-updates.js' },
    createElement: el, querySelector: sel => sel === '#dock, .dock' ? { getBoundingClientRect: () => ({ top: 790, height: 84 }) } : overlay && sel.includes(overlay) ? {} : null, addEventListener() {} };
  const D = now ? { now: () => now.t } : Date;
  new Function('window', 'document', 'fetch', 'location', 'setInterval', 'clearInterval', 'Date', src)(window, document, fetch, { href: 'https://box/wizard-os-home/', reload() {} }, (f, ms) => { timers.push({ f, ms }); return 0; }, () => {}, D);
  await tick(); await tick(); await tick();
  return { U: window.WosUpdates, window, storage, posts, setStatus: v => { status = v; }, pop: () => body.kids.find(k => k.className === 'osu-pop' && !k.removed) };
}
const tapGo = pop => pop.listeners.click({ target: { closest: s => s === '[data-osu]' ? { dataset: { osu: 'apply' } } : null } });
const tapX = pop => pop.listeners.click({ target: { closest: s => s === '[data-osu-dismiss]' ? {} : null } });

test('pop-up shows Update with the same words and button as the Settings card, just above the dock', async () => {
  const b = await boot({ status: ST() });
  b.U.popup();
  const p = b.pop(); assert.ok(p, 'pop-up on Home');
  assert.match(p.innerHTML, /<b>Update available<\/b><span>Wizard OS 0\.3\.32 → 0\.3\.33<\/span><\/div><button type="button" class="osu-pop-go" data-osu="apply" >Update<\/button>/);
  assert.match(b.U.cardHtml(), /<b data-osu-title>Update available<\/b><span>Wizard OS 0\.3\.32 → 0\.3\.33<\/span>[^]*>Update<\/button>/, 'same words in Settings');
  assert.match(p.innerHTML, /data-osu-dismiss aria-label="Dismiss">×/);
  assert.equal(p.style.bottom, (874 - 790 + 12) + 'px', 'sits 12px above the dock top');
  tapGo(p); await tick();
  assert.deepEqual(b.posts, [{ action: 'apply' }], 'tapping Update does what Settings does');
});
test('interrupted says Try again; up to date, updating and unpinned show no pop-up', async () => {
  const f = await boot({ status: ST({ interrupted: true }) }); f.U.popup();
  assert.match(f.pop().innerHTML, /Update interrupted.*Try again/s);
  for (const s of [ST({ update_available: false, latest: '0.3.32' }), ST({ installing: true }), ST({ unpinned: true })]) {
    const n = await boot({ status: s }); n.U.popup();
    assert.equal(n.pop(), undefined, JSON.stringify(s));
  }
});
test('× hides it for that release only; it survives a page reload; a newer release brings it back; never off Home', async () => {
  const storage = new Map();
  const b = await boot({ status: ST(), storage }); b.U.popup();
  tapX(b.pop());
  assert.equal(b.pop(), undefined); assert.equal(storage.get('wos.osu.dismissed'), 'behind:0.3.33');
  b.U.popup(); assert.equal(b.pop(), undefined, 'stays dismissed for the same release');
  const again = await boot({ status: ST(), storage }); again.U.popup();
  assert.equal(again.pop(), undefined, 'dismissal survives a reload of the page');
  const newer = await boot({ status: ST({ latest: '0.3.34' }), storage }); newer.U.popup();
  assert.match(newer.pop().innerHTML, /0\.3\.32 → 0\.3\.34/, 'a newer release shows again');
  const away = await boot({ status: ST(), home: false }); away.U.popup();
  assert.equal(away.pop(), undefined, 'not on Home: no pop-up');
  const desk = await boot({ status: ST(), desktop: true }); desk.U.popup();
  assert.equal(desk.pop()?.dataset.shell, 'desktop', 'desktop Home shows it too, placed by CSS');
});
test('only one notice: the old web banner steps aside while the pop-up carries the reload, and after its ×', async () => {
  const storage = new Map();
  const web = { pending: true, version: 'v:abc', render() {}, armed: false };
  const b = await boot({ status: ST({ update_available: false, latest: '0.3.32' }), web, storage }); b.U.popup();
  assert.match(b.pop().innerHTML, /<b>Wizard OS was updated<\/b><span>Reload to see it<\/span>[^]*data-osu="reload" >Reload</);
  assert.equal(b.U.ownsReload(), true);
  tapX(b.pop()); assert.equal(storage.get('wos.osu.dismissed'), 'reload:v:abc');
  assert.equal(b.U.ownsReload(), true, 'dismissed: the old banner does not come back for the same build');
  const off = await boot({ status: ST({ update_available: false }), web, home: false }); off.U.popup();
  assert.equal(off.U.ownsReload(), false, 'off Home and not dismissed: the old banner keeps telling');
  const w = readFileSync(new URL('../web/core/web-update.js', import.meta.url), 'utf8');
  assert.match(w, /if \(window\.WosUpdates\?\.ownsReload\?\.\(\)\) \{ document\.getElementById\('dvWeb'\)\?\.remove\(\)/);
  assert.match(w, /get version\(\) \{ return printNow; \}/);
  const css = readFileSync(new URL('../web/core/update-banner.css', import.meta.url), 'utf8');
  assert.match(css, /\.osu-pop \{[^}]*--wz-text/, 'styled with --wz-* tokens');
});
test('desktop: the pop-up never sits above an open overlay (palette, keys, Inbox, Usage, Settings)', async () => {
  for (const o of ['#palette', '#keys', '#inbox', '.usage-ov', '.dsettings']) {
    const b = await boot({ status: ST(), desktop: true, overlay: o }); b.U.popup();
    assert.equal(b.pop(), undefined, o);
  }
});
test('Home hears about a new release without a reload: the status is re-read every 10 minutes', async () => {
  const now = { t: 1e6 }, timers = [];
  const b = await boot({ status: ST({ update_available: false, latest: '0.3.32' }), timers, now }); b.U.popup();
  assert.equal(b.pop(), undefined);
  b.setStatus(ST());
  const tick = timers.find(t => t.ms === 60e3); assert.ok(tick, 'a one-minute tick');
  now.t += 5 * 60e3; tick.f(); await tick0(); b.U.popup(); assert.equal(b.pop(), undefined, 'not before 10 minutes');
  now.t += 5 * 60e3; tick.f(); await tick0(); await tick0(); b.U.popup();
  assert.match(b.pop().innerHTML, /Update available/);
});
const tick0 = () => new Promise(r => setTimeout(r, 0));
test('a box without my-release.json keeps the stock card and words (release states are data-gated)', async () => {
  const b = await boot({ status: ST() });
  assert.equal(b.U.release, false);
  assert.equal(b.U.title(), 'About & updates');
  assert.match(b.U.cardHtml(), /Update available/);
  assert.doesNotMatch(b.U.html(), /Your changes|Propose|data-osu-release/);
});
