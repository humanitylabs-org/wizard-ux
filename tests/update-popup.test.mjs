// Home update pop-up (core/os-updates.js): the Settings update card's words and button on Home with ×, per-state
// dismiss, and the old "Interface updated" banner stepping aside so only one notice shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { fixture as webUpdate } from './fixtures/web-update-harness.mjs';

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
  assert.match(p.innerHTML, /<b>WizardOS update<\/b><span>Takes 10–20 minutes<\/span><\/div><button type="button" class="osu-pop-go" data-osu="apply" >Install<\/button>/);
  assert.match(b.U.cardHtml(), /<b data-osu-title>WizardOS update<\/b><span>Takes 10–20 minutes<\/span>[^]*>Install<\/button>/, 'same words in Settings');
  assert.match(p.innerHTML, /data-osu-dismiss aria-label="Dismiss">×/);
  assert.equal(p.style.bottom, (874 - 790 + 12) + 'px', 'sits 12px above the dock top');
  tapGo(p); await tick();
  assert.deepEqual(b.posts, [{ action: 'apply' }], 'tapping Update does what Settings does');
});
test('interrupted says Try again; up to date, updating and unpinned show no pop-up', async () => {
  const f = await boot({ status: ST({ interrupted: true }) }); f.U.popup();
  assert.match(f.pop().innerHTML, /WizardOS update didn’t finish.*Try again/s);
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
  assert.equal(newer.pop()?.dataset.key, 'behind:0.3.34', 'a newer release shows again');
  const away = await boot({ status: ST(), home: false }); away.U.popup();
  assert.equal(away.pop(), undefined, 'not on Home: no pop-up');
  const desk = await boot({ status: ST(), desktop: true }); desk.U.popup();
  assert.equal(desk.pop()?.dataset.shell, 'desktop', 'desktop Home shows it too, placed by CSS');
});
test('only one notice: the old web banner steps aside while the pop-up carries the reload, and after its ×', async () => {
  const storage = new Map();
  const web = { pending: true, version: 'v:abc', render() {}, armed: false };
  const b = await boot({ status: ST({ update_available: false, latest: '0.3.32' }), web, storage }); b.U.popup();
  const drawn = b.pop().className;
  assert.match(b.pop().innerHTML, /<b>Interface updated<\/b><span>Reload to see the changes<\/span>[^]*data-osu="reload" >Reload</);
  assert.equal(b.U.ownsReload(), true);
  tapX(b.pop()); assert.equal(storage.get('wos.osu.dismissed'), 'reload:v:abc');
  assert.equal(b.U.ownsReload(), true, 'dismissed: the old banner does not come back for the same build');
  const off = await boot({ status: ST({ update_available: false }), web, home: false }); off.U.popup();
  assert.equal(off.U.ownsReload(), false, 'off Home and not dismissed: the old banner keeps telling');
  // the old banner's real render() step: while the pop-up owns the reload the banner goes and nothing is drawn
  const w = readFileSync(new URL('../web/core/web-update.js', import.meta.url), 'utf8');
  for (const owns of [true, false]) {
    const gone = [];
    const R = runRecording(`this.f = () => {\n${between(w, '    if (window.WosUpdates?.ownsReload?.())', '\n')}\n  return 'drawn';\n};`,
      { window: { WosUpdates: { ownsReload: () => owns } }, document: { getElementById: id => ({ remove: () => gone.push(id) }) }, listOpen: true });
    assert.equal(R.f(), owns ? undefined : 'drawn', owns ? 'owned: not drawn' : 'not owned: the banner draws'); assert.deepEqual(gone, owns ? ['dvWeb'] : []);
  }
  // the pop-up keys its dismiss on the build the banner would reload to (WizWebUpdate.version, the real file)
  const wu = webUpdate(); await wu.update(); assert.equal(wu.web.version, 'v:' + 'b'.repeat(40), 'the new build (the same v:<build> the dismiss key above carries)');
  const css = readFileSync(new URL('../web/core/update-banner.css', import.meta.url), 'utf8');
  const page = createDocument(), pop = page.createElement('div'); pop.className = drawn; page.body.appendChild(pop);
  assert.match(cascade(pop, css)['--wz-text']?.value || '', /^var\(--ink/, 'the pop-up as drawn is styled with --wz-* tokens');
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
  assert.match(b.pop().innerHTML, /WizardOS update/);
});
const tick0 = () => new Promise(r => setTimeout(r, 0));
test('the stock module reads no personal release file and has no release-layer states', () => {
  assert.doesNotMatch(src, /my-release|\bmine\b|Propose|behind > 0|data-mine/);
});

// Two kinds of update, two names (Miguel, 27 Oct 2026): "WizardOS" means only the box's own install; the screens are
// the "Interface", already here and a Reload away. Automatic says when it will install; Ask me says how long it takes.
test('words: the interface never says WizardOS; WizardOS says overnight (Automatic) or how long (Ask me)', async () => {
  const fs = await import('node:fs');
  const web = fs.readFileSync(new URL('../web/core/web-update.js', import.meta.url), 'utf8');
  const shown = (web.match(/'[^'\n]*'|`[^`\n]*`/g) || []).filter(x => /WizardOS/.test(x));
  assert.ok(!shown.length, 'no interface notice string names WizardOS: ' + shown.join(', '));
  // the reload burst the interface draws (real web-update.js burst()) says Reloading
  const doc = createDocument();
  runRecording(`${block(web, '  function burst() {')}\nburst();`, { document: doc, Array, Math });
  assert.match(doc.querySelector('.wos-burst .wb-text')?.textContent || '', /^Reloading/);
  // the real cards (core/os-updates.js card()) in each state
  const cardOf = async (status, web) => (await boot({ status, web })).U.card();
  const pick = c => c && { title: c.title, line: c.line, action: c.action, label: c.label };
  assert.deepEqual(pick(await cardOf(ST(), { pending: true })), { title: 'Interface updated', line: 'Reload to see the changes', action: 'reload', label: 'Reload' }, 'the interface: a Reload, never WizardOS');
  assert.deepEqual(pick(await cardOf(ST())), { title: 'WizardOS update', line: 'Takes 10–20 minutes', action: 'apply', label: 'Install' }, 'Ask me says how long');
  assert.equal((await cardOf(ST({ quick: true }))).line, 'Takes about 2 minutes', 'about 2 minutes only when the App Manager says quick');
  assert.equal((await cardOf(ST({ quick: 'yes' }))).line, 'Takes 10–20 minutes');
  assert.deepEqual(pick(await cardOf(ST({ mode: 'auto' }))), { title: 'WizardOS update', line: 'Installs tonight when it’s quiet', action: 'apply', label: 'Install now' }, 'Automatic says when');
});
