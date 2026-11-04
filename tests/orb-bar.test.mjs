// The orb bar (Miguel, 2 Nov 2026): the Wizard standard for a full-screen app under a shell view's orb (AI apps, Apps,
// and the Orb view's phone apps, which share layouts/apps/chrome.js). The orb has ONE fixed spot, bottom centre, and an
// app's own bottom tab bar is laid out around it: its tabs split evenly left and right of the orb, on the orb's row,
// never under it. Feature-detected in the shell (skin-host's inset), so any app with a bottom nav / footer / tablist
// works on any Wizard without an app change; without an orb over the frame (desktop) the bar is lifted, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const host = read('web/core/skin-host.js');

/* a tiny DOM: enough for orbTabs (tags, a few attribute selectors, rects, closest, contains) */
class N {
  constructor(tag, attrs = {}, rect = null, kids = []) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.rect = rect; this.children = []; this.parentElement = null;
    for (const k of kids) { k.parentElement = this; this.children.push(k); }
  }
  hasAttribute(k) { return k in this.attrs; } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  is(sel) {
    return sel.split(',').some(s => {
      s = s.trim(); const m = /^([a-z]*)((?:\[[^\]]+\])*)$/.exec(s); if (!m) throw new Error('selector ' + s);
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      return [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, k, v]) => v === undefined ? this.hasAttribute(k) : this.getAttribute(k) === v);
    });
  }
  querySelectorAll(sel) { return this.all().filter(n => n.is(sel)); }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.is(sel)) return n; return null; }
  contains(n) { for (; n; n = n.parentElement) if (n === this) return true; return false; }
  getClientRects() { return this.rect ? [this.rect] : []; }
  getBoundingClientRect() { const r = this.rect || { left: 0, top: 0, width: 0, height: 0 }; return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }; }
}
const R = (left, top, width, height) => ({ left, top, width, height });
const docOf = body => ({ querySelectorAll: s => body.querySelectorAll(s), defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) } });
// orbTabs and its setAttr helper, run on their own (the rest of skin-host is the shell's)
const src = host.match(/  const setAttr = [^\n]+\n  const WOS_MARKS = [^\n]+\n  const WOS_MARKED = [^\n]+\n  const unmark = [^\n]+\n/)[0]
  + host.match(/  function orbTabs\(d, bar, vw\) \{[\s\S]*?\n  \}\n/)[0] + host.match(/  function tabFit\(sides, room\) \{[\s\S]*?\n  \}\n/)[0];
const ctx = {}; vm.runInNewContext(src + ';globalThis.orbTabs = orbTabs; globalThis.tabFit = tabFit;', ctx);
const tabsOf = row => row.all().filter(n => n.hasAttribute('data-wos-tab')).map(n => (n.attrs['aria-label'] || '') + ':' + n.attrs['data-wos-tab']);

test('a bar of four tabs (Money): the bar itself is the row, two tabs left of the orb, two right', () => {
  const tabs = ['Review', 'Spending', 'Net worth', 'Accounts'].map((t, i) => new N('button', { role: 'tab', 'aria-label': t }, R(8 + i * 94, 740, 94, 44)));
  const bar = new N('nav', { role: 'tablist' }, R(0, 735, 390, 53), tabs), body = new N('body', {}, R(0, 0, 390, 788), [bar]);
  assert.equal(ctx.orbTabs(docOf(body), bar, 390), true);
  assert.equal(bar.attrs['data-wos-tabs'], 'bar'); assert.equal(bar.attrs['data-wos-nl'], '2'); assert.equal(bar.attrs['data-wos-nr'], '2');
  assert.deepEqual(tabsOf(bar), ['Review:l', 'Spending:l', 'Net worth:r', 'Accounts:r']);
});

test('tabs grouped by the app (Podcasts: a pair + Filters): the group flattens, the tabs themselves are split', () => {
  const feed = new N('button', { 'aria-label': 'My feed' }, R(4, 736, 127, 48)), disc = new N('button', { 'aria-label': 'Discover' }, R(131, 736, 127, 48));
  const pair = new N('div', { role: 'group' }, null, [feed, disc]), filt = new N('button', { 'aria-label': 'Filters' }, R(259, 736, 127, 48));
  const bar = new N('nav', {}, R(0, 731, 390, 57), [pair, filt]), body = new N('body', {}, R(0, 0, 390, 788), [bar]);
  assert.equal(ctx.orbTabs(docOf(body), bar, 390), true);
  assert.equal(bar.attrs['data-wos-tabs'], 'bar'); assert.equal(pair.attrs['data-wos-flat'], '', 'the wrapper steps aside (display: contents)');
  assert.deepEqual(tabsOf(bar), ['My feed:l', 'Discover:l', 'Filters:r']); assert.equal(bar.attrs['data-wos-nl'], '2'); assert.equal(bar.attrs['data-wos-nr'], '1');
});

test('a segmented control inside the bar (Health): the control is the row (its pill steps aside), one choice each side', () => {
  const a = new N('button', { role: 'radio', 'aria-label': 'Activity' }, R(16, 732, 178, 44)), b = new N('button', { role: 'radio', 'aria-label': 'Recovery' }, R(196, 732, 178, 44));
  const seg = new N('div', { role: 'radiogroup' }, R(12, 728, 366, 52), [a, b]), bar = new N('nav', {}, R(0, 719, 390, 69), [seg]);
  const body = new N('body', {}, R(0, 0, 390, 788), [bar]);
  assert.equal(ctx.orbTabs(docOf(body), bar, 390), true);
  assert.equal(seg.attrs['data-wos-tabs'], 'inner'); assert.equal(bar.attrs['data-wos-tabs'], undefined);
  assert.deepEqual(tabsOf(seg), ['Activity:l', 'Recovery:r']);
});

test('no tab row (one wide button, a mini player above the tabs): nothing is split, earlier marks are cleared', () => {
  const play = new N('button', { 'aria-label': 'Play' }, R(169, 674, 52, 52)), tab1 = new N('button', { 'aria-label': 'A' }, R(0, 740, 195, 44)), tab2 = new N('button', { 'aria-label': 'B' }, R(195, 740, 195, 44));
  const bar = new N('footer', {}, R(0, 668, 390, 120), [play, tab1, tab2]), body = new N('body', {}, R(0, 0, 390, 788), [bar]);
  assert.equal(ctx.orbTabs(docOf(body), bar, 390), true, 'only the lowest row counts (the player sits above it)');
  assert.deepEqual(tabsOf(bar), ['A:l', 'B:r']); assert.equal(play.attrs['data-wos-tab'], undefined);
  const wide = new N('button', { 'aria-label': 'Save' }, R(12, 740, 366, 48)), bar2 = new N('footer', {}, R(0, 730, 390, 58), [wide]);
  const stale = new N('div', { 'data-wos-tabs': 'bar', 'data-wos-nl': '1' }, R(0, 0, 10, 10));
  const body2 = new N('body', {}, R(0, 0, 390, 788), [bar2, stale]);
  assert.equal(ctx.orbTabs(docOf(body2), bar2, 390), false);
  assert.equal(wide.attrs['data-wos-tab'], undefined); assert.equal(stale.attrs['data-wos-tabs'], undefined, 'stale marks go');
});

test('a bar with a date picker in its row (Morning Report: ‹ date › PDF) is not split: the picker is never crushed', () => {
  const older = new N('button', { 'aria-label': 'Older report' }, R(78, 682, 40, 40)), sel = new N('select', { 'aria-label': 'Report date' }, R(124, 682, 142, 40));
  const newer = new N('button', { 'aria-label': 'Newer report' }, R(272, 682, 40, 40)), pdf = new N('a', { href: '#' }, R(331, 682, 51, 40));
  const nav = new N('span', {}, R(78, 682, 234, 40), [older, new N('label', {}, R(124, 682, 142, 40), [sel]), newer]);
  const bar = new N('nav', { 'aria-label': 'Report navigation' }, R(0, 673, 390, 57), [nav, pdf]), body = new N('body', {}, R(0, 0, 390, 788), [bar]);
  bar.attrs['data-wos-tabs'] = 'bar'; older.attrs['data-wos-tab'] = 'l';   // marks from an earlier pass go too
  assert.equal(ctx.orbTabs(docOf(body), bar, 390), false);
  assert.deepEqual(tabsOf(bar), []); assert.equal(bar.attrs['data-wos-tabs'], undefined);
  // a hidden field does not count
  sel.attrs.type = 'hidden'; sel.tagName = 'INPUT';
  assert.equal(ctx.orbTabs(docOf(body), bar, 390), true);
});

test('the shell wiring: the CSS around the orb, gated on the orb being over the frame; the views hand over the dock orb', () => {
  // the split rules apply only while html.wos-orb-bar is set; without it the old lift (room above the orb) stays
  assert.match(host, /'html:not\(\.wos-orb-bar\):not\(\.wos-orb-end\) \[data-wos-inset-bar\]:not\(\[data-wos-lift="self"\]\)\{height:auto!important;padding-bottom:calc\(var\(--wos-inset-b,0px\) - 12px\)!important\}'/);
  assert.match(host, /html\.wos-orb-bar \[data-wos-tabs\]::after\{content:""!important;display:block!important;position:static!important;order:2!important;flex:0 0 var\(--wos-orb-slot,80px\)!important/, 'an empty slot as wide as the orb in the middle');
  assert.match(host, /min-height:calc\(2\*var\(--wos-orb-cy,40px\)\)!important/, 'the tabs sit on the orb\'s row');
  assert.match(host, /html\.wos-orb-bar \[data-wos-tab\]\{order:1!important;flex:0 0 calc\(\(100% - var\(--wos-orb-slot,80px\)\)\/2\*var\(--wos-tab-f,1\)\)!important/, 'each side gets half the rest, shared by its tabs (tabFit\'s shares)');
  assert.match(host, /html\.wos-orb-bar \[data-wos-fs\]\{white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important;max-width:none!important/, 'a label is never cut or ellipsed');
  assert.match(host, /if \(row\) fitTabs\(d, row\);/, 'the split bar is measured and shared by its labels');
  assert.match(host, /if \(o && o\.d > 0 && cy > o\.d \/ 2 && cy < 160 && \(fr\.width >= vwTop \* \.9 && Math\.abs\(vwTop \/ 2 - o\.x\) < 8 \|\| fr\.width >= vwTop \* \.6 && Math\.abs\(fr\.left \+ fr\.width \/ 2 - o\.x\) < 8\)\) \{/, 'only a screen-wide frame with the orb centred over its bottom (or the desktop AI apps frame beside its sidebar, the orb centred over it)');
  assert.match(host, /d\.documentElement\.style\.setProperty\('--wos-orb-slot', Math\.round\(o\.d \+ 16\) \+ 'px'\);/);
  assert.match(host, /inset\(px, orb = null, place = null\) \{/, 'api.apps.inset(px, orb, place): the layout says where its orb is (and hears where the app wants it)');
  assert.match(host, /new d\.defaultView\.MutationObserver\(/, 'an app that redraws its bar is laid out again');
  const chrome = read('web/layouts/apps/chrome.js');
  assert.match(chrome, /const rawSpot = orb \|\| \(shell === 'phone' \? orbSpot : null\);/, 'phone views hand over the dock orb; a view drawing its own orb says where it is (desktop AI apps); else the lift');
  assert.match(chrome, /api\.apps\.inset\(inset \?\? FLOAT_INSET\[shell\], rawSpot \? home : null, s => \{ appSpot = s \|\| null; placeOrb\(\); \}\)/, 'the orb\'s own spot (untransformed) is what the bars go around; the app\'s spot moves it');
  assert.match(chrome, /d = o\.offsetWidth \|\| r\.width;/, 'the untransformed size: pressing the orb never reflows the bar');
});

/* Every label whole (Miguel, 2 Nov 2026: Podcasts has three tabs, two share the left side, and 'Discover' read 'Dis…').
 * tabFit shares each side by what the tabs need instead of in equal parts, and shrinks labels only as far as needed. Label
 * widths below are the apps' bold labels as measured on a phone (about .6 em per letter); the orb slot is the phone's
 * (60 px orb + 16). For every phone width 360-430: each tab is at least as wide as its label (or icon) plus a little room
 * and at least 44 px, a side's tabs fill exactly its half (never under the orb), and labels stay >= 10 px. */
const SLOT = 76, em = (s, fs) => s.length * .6 * fs;
const tab = (label, fs = 14) => ({ icon: 20, text: em(label, fs), word: Math.max(...label.split(' ').map(w => em(w, fs))), fs, label });
function check(labels, fs, { wrapOk = false } = {}) {
  for (let vw = 360; vw <= 430; vw += 10) {
    const tabs = labels.map(l => tab(l, fs)), nl = Math.ceil(tabs.length / 2), sides = [tabs.slice(0, nl), tabs.slice(nl)], room = (vw - SLOT) / 2;
    const fit = ctx.tabFit(sides.map(s => s.map(({ icon, text, word, fs }) => ({ icon, text, word, fs }))), room);
    assert.ok(fit.s * fs >= 10 - 1e-9, `${vw}px: labels stay >= 10 px (${(fit.s * fs).toFixed(1)})`);
    if (!wrapOk) assert.equal(fit.wrap, false, `${vw}px: ${labels.join(', ')} each on one line`);
    sides.forEach((side, i) => {
      if (!side.length) return;
      const shares = fit.share[i], sum = shares.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-6, `${vw}px: side ${i} is filled exactly (${sum})`);
      side.forEach((t, j) => {
        const w = shares[j] * room, label = (fit.wrap ? t.word : t.text) * fit.s;
        assert.ok(w >= 44 - 1e-6, `${vw}px: ${t.label} is a 44 px target (${w.toFixed(1)})`);
        assert.ok(w >= label + 4 && w >= t.icon + 4, `${vw}px: '${t.label}' fits whole: ${label.toFixed(1)} px label in a ${w.toFixed(1)} px tab`);
      });
    });
  }
}

test('three tabs (Podcasts: My feed · Discover | orb | Filters): every label whole at 360-430 px, the pair shares by need', () => {
  check(['My feed', 'Discover', 'Filters'], 14);
  // the old equal split gave 'Discover' (≈ 67 px at 14 px) half of the 142 px side at 360 px: 71 px with the app's
  // 6 px padding each side = 59 px for the word, so it was cut; now its share follows its label
  const room = (360 - SLOT) / 2, fit = ctx.tabFit([[tab('My feed'), tab('Discover')], [tab('Filters')]], room);
  assert.ok(fit.share[0][1] > fit.share[0][0], 'the longer label gets the larger share');
  assert.deepEqual(fit.share[1], [1], 'a single tab takes its whole side');
});

test('five tabs (two sides of 3 and 2) and the rest of 1-6: labels whole, smaller only when a side is tight', () => {
  check(['Home', 'Search', 'Library', 'Saved', 'Settings'], 12);
  check(['Review', 'Spending', 'Net worth', 'Accounts'], 14);   // Money
  check(['Activity', 'Recovery & sleep'], 14, { wrapOk: true }); // Health (two words may take two lines)
  check(['Inbox'], 14); check(['Feed', 'Saved'], 14); check(['Home', 'Search', 'Library', 'Saved', 'Profile', 'More'], 11);
  const roomy = ctx.tabFit([[tab('Home'), tab('Feed')], [tab('Saved'), tab('More')]], (430 - SLOT) / 2);
  assert.equal(roomy.s, 1, 'room to spare: the app\'s own label size'); assert.equal(roomy.wrap, false);
});

test('a bar of one tab: it sits left of the orb, the orb stays centred (the slot takes the empty right half)', () => {
  const only = new N('button', { 'aria-label': 'Inbox' }, R(150, 740, 90, 44)), bar = new N('nav', {}, R(0, 735, 390, 53), [only]);
  assert.equal(ctx.orbTabs(docOf(new N('body', {}, R(0, 0, 390, 788), [bar])), bar, 390), true);
  assert.equal(only.attrs['data-wos-tab'], 'l'); assert.equal(bar.attrs['data-wos-nl'], '1'); assert.equal(bar.attrs['data-wos-nr'], '0');
  assert.match(host, /html\.wos-orb-bar \[data-wos-tabs\]\[data-wos-nr="0"\]::after\{flex-basis:calc\(var\(--wos-orb-slot,80px\) \+ \(100% - var\(--wos-orb-slot,80px\)\)\/2\)!important\}/);
});

/* Round 5 (Miguel, 2 Nov 2026: "the orb floats over Messenger"): an app's bottom controls are not always a kit tab bar.
 * bottomBar finds any block of controls that stays put along the page's bottom (Messenger's filter rows, Notes' vault
 * footer, a composer, a lone Load more); such a block is lifted above the orb's row (its own surface running on under
 * the orb, one bar), never split; a button floating just above it (Messenger's ✎) rises with it. Tabs still split. */
class B {
  constructor(tag, attrs = {}, rect = null, kids = [], css = {}) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.rect = rect; this.css = { position: 'static', overflowY: 'visible', visibility: 'visible', ...css };
    this.children = []; this.parentElement = null; this.scrollHeight = css.sh || (rect ? rect.height : 0); this.clientHeight = rect ? rect.height : 0;
    for (const k of kids) { k.parentElement = this; this.children.push(k); }
  }
  hasAttribute(k) { return k in this.attrs; } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(sel) {
    if (sel === '*') return true;
    return sel.split(',').some(one => {
      const m = /^([a-z]*)((?:\[[^\]]+\])*)(?::not\((\[[^\]]+\])\))?$/.exec(one.trim()); if (!m) throw new Error('selector ' + one);
      const attr = a => { const [, k, v] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a); return v === undefined ? this.hasAttribute(k) : this.getAttribute(k) === v; };
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      if (!(m[2].match(/\[[^\]]+\]/g) || []).every(attr)) return false;
      return !m[3] || !attr(m[3]);
    });
  }
  querySelectorAll(sel) { return this.all().filter(n => n.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
  contains(n) { for (; n; n = n.parentElement) if (n === this) return true; return false; }
  getClientRects() { return this.rect ? [this.rect] : []; }
  getBoundingClientRect() { const r = this.rect || { left: 0, top: 0, width: 0, height: 0 }; return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }; }
}
const pageOf = (kids, { docScroll = false } = {}) => {
  const body = new B('body', {}, R(0, 0, 390, 788), kids), html = new B('html', {}, R(0, 0, 390, 788), [body]);
  const hs = {}; html.style = { setProperty: (k, v) => { hs[k] = v; }, getPropertyValue: k => hs[k] || '' };
  const hit = (n, x, y) => { for (const c of [...n.children].reverse()) { const r = c.rect; if (r && x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) return hit(c, x, y) || c; } return null; };
  return { body, documentElement: html, elementFromPoint: (x, y) => hit(body, x, y) || body, scrollingElement: { scrollHeight: docScroll ? 2000 : 788, clientHeight: 788 },
    defaultView: { getComputedStyle: n => n.css } };
};
const bb = host.match(/  const CONTROLS = [\s\S]*?\n(?=  function insetFrame\(f\) \{)/)[0];
const bctx = {}; vm.runInNewContext(bb + ';globalThis.bottomBar = bottomBar; globalThis.floatsOver = floatsOver; globalThis.hasEntry = hasEntry; globalThis.isTabBar = isTabBar;', bctx);

test('round 5: Messenger\'s filter rows (a plain div of controls under its list) are the bar; its ✎ rises with it', () => {
  const list = new B('div', { class: 'u-list' }, R(0, 0, 390, 693), [new B('button', {}, R(6, 630, 378, 52))], { overflowY: 'auto', sh: 4462 });
  const seg = new B('div', { role: 'radiogroup' }, R(12, 702, 366, 38), [new B('button', { role: 'radio' }, R(15, 705, 89, 32)), new B('button', { role: 'radio' }, R(106, 705, 89, 32))]);
  const chips = new B('div', {}, R(12, 744, 366, 40), [new B('button', {}, R(14, 746, 36, 36)), new B('button', {}, R(300, 746, 76, 36))]);
  const filters = new B('div', { id: 'u-filters', role: 'group' }, R(0, 693, 390, 95), [seg, chips]);
  const fab = new B('button', { class: 'u-fab' }, R(318, 620, 56, 56), [], { position: 'absolute' });
  const section = new B('section', {}, R(0, 0, 390, 788), [list, filters, fab], { overflowY: 'hidden' });
  const d = pageOf([section]);
  assert.equal(bctx.bottomBar(d, 390, 788), filters, 'the outermost block of controls along the bottom, not the list above it');
  assert.equal(bctx.isTabBar(filters), false, 'not a tab bar: lifted, never split');
  filters.setAttribute('data-wos-inset-bar', ''); bctx.floatsOver(d, filters, 390);
  assert.equal(fab.attrs['data-wos-float'], '', 'the compose button above it rises with the bar');
  assert.equal(list.children[0].attrs['data-wos-float'], undefined, 'a list row never does');
});

test('round 5: content that scrolls is never the bar; a composer footer is lifted, not split; a lone Load more counts', () => {
  // a list running to the bottom edge: its rows are content (no bar)
  const rows = new B('div', {}, R(0, 0, 390, 788), [new B('button', {}, R(6, 740, 378, 52))], { overflowY: 'auto', sh: 3000 });
  assert.equal(bctx.bottomBar(pageOf([rows]), 390, 788), null);
  // a page that scrolls as a whole: an in-flow card at the bottom is content too; a fixed bar is not
  const card = new B('div', {}, R(0, 700, 390, 88), [new B('button', {}, R(10, 710, 100, 40))]);
  assert.equal(bctx.bottomBar(pageOf([card], { docScroll: true }), 390, 788), null);
  const fixed = new B('div', {}, R(0, 720, 390, 68), [new B('button', {}, R(10, 730, 100, 40))], { position: 'fixed' });
  assert.equal(bctx.bottomBar(pageOf([fixed], { docScroll: true }), 390, 788), fixed);
  // the Troubleshooter's footer: a field and Send; a footer, yet it holds a field, so it is lifted whole
  const ta = new B('textarea', {}, R(16, 712, 290, 60)), send = new B('button', {}, R(310, 712, 64, 60));
  const foot = new B('footer', {}, R(0, 656, 390, 132), [ta, send]), dd = pageOf([foot]);
  assert.equal(bctx.isTabBar(foot), true); assert.equal(bctx.hasEntry(dd, foot), true, 'a composer is never split around the orb');
  // Mail: a lone Load more under its list (nothing else along the bottom)
  const more = new B('button', { class: 'wz-button' }, R(12, 732, 366, 44)), mail = new B('section', {}, R(0, 0, 390, 788), [new B('div', {}, R(0, 150, 390, 582), [], { overflowY: 'auto', sh: 3000 }), more]);
  assert.equal(bctx.bottomBar(pageOf([mail]), 390, 788), more);
  const host2 = host;
  assert.match(host2, /bar\.setAttribute\('data-wos-lift', bar\.matches\(CONTROLS\) \? 'self' : 'block'\)/, 'found this way = lifted (a lone control by a margin)');
  assert.match(host2, /split = !\/\^\(block\|self\)\$\/\.test\(bar\.getAttribute\('data-wos-lift'\) \|\| ''\) && isTabBar\(bar\) && !hasEntry\(d, bar\) && orbTabs\(/, 'only a real tab bar with no field splits');
  assert.match(host2, /'html:not\(\.wos-orb-bar\):not\(\.wos-orb-end\) \[data-wos-float\]\{translate:0 calc\(-1 \* var\(--wos-lift,0px\)\)!important\}'/);
  assert.match(host2, /\[data-wos-inset-scroll\]::after\{content:""/, 'a plain scroller under the orb gets room after its last item');
});

/* Round 6 (Miguel, 2 Nov 2026: "never waste a whole band at the bottom of the phone screen"): a block that is not a tab
 * bar keeps its place; the orb takes a compact spot at the end of its lowest row of controls (Messenger's composer:
 * after its mic; its chips: after Filters), the row making room for it; if the row has no room, the old lift. */
const ectx = {}; vm.runInNewContext(bb + ';globalThis.endRow = endRow; globalThis.orbEnd = orbEnd; globalThis.endSize = endSize;', ectx);
const live = (d, n) => { n.css.paddingRight ||= '0px'; n.css.paddingBottom ||= '0px'; n.css.marginBottom ||= '0px'; return n; };
function pageWith(kids) {
  const d = pageOf(kids), cls = new Set();
  d.documentElement.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) };
  d.documentElement.clientWidth = 390; d.querySelectorAll = sel => d.body.querySelectorAll(sel); d.cls = cls;
  return d;
}
const styled = (n, onSet) => { const st = {}; n.style = { setProperty: (k, v) => { st[k] = v; onSet?.(k, v); }, removeProperty: k => { delete st[k]; onSet?.(k, null); }, getPropertyValue: k => st[k] || '' }; n.scrollWidth = n.clientWidth = n.rect?.width || 0; return n; };

test('round 6: the lowest row of controls: a composer row, the chips under the filters, a lone Load more', () => {
  const att = new B('button', {}, R(8, 707, 44, 44)), ta = new B('textarea', {}, R(58, 707, 274, 44)), mic = new B('button', {}, R(338, 707, 44, 44));
  const form = new B('form', {}, R(0, 700, 390, 58), [att, ta, mic]), d = pageWith([form]);
  const p = ectx.endRow(d, form); assert.equal(p.row, form); assert.equal(p.self, false); assert.equal(p.ctrls.length, 3);
  const seg = new B('div', { role: 'radiogroup' }, R(12, 627, 366, 38), [new B('button', { role: 'radio' }, R(15, 630, 89, 32)), new B('button', { role: 'radio' }, R(106, 630, 89, 32))]);
  const c1 = new B('button', {}, R(12, 668, 36, 36)), c2 = new B('button', {}, R(311, 668, 67, 36)), chips = new B('div', {}, R(12, 664, 366, 44), [c1, c2]);
  const filters = new B('div', { id: 'u-filters' }, R(0, 615, 390, 100), [seg, chips]), d2 = pageWith([filters]);
  const p2 = ectx.endRow(d2, filters); assert.equal(p2.row, chips, 'the chips\' row, not the filters above it'); assert.equal(p2.ctrls.length, 2); assert.equal(p2.ctrls[0], c1); assert.equal(p2.ctrls[1], c2);
  const more = new B('button', { class: 'wz-button' }, R(12, 660, 366, 44)), d3 = pageWith([more]);
  assert.equal(ectx.endRow(d3, more).self, true, 'a lone control is its own row');
  assert.deepEqual(JSON.parse(JSON.stringify(ectx.endSize(36, 66))), { D: 44, slot: 52 }, 'the orb as tall as the row\'s controls plus a little');
  assert.deepEqual(JSON.parse(JSON.stringify(ectx.endSize(80, 66))), { D: 66, slot: 74 }, 'never over its own size');
});

test('round 6: Messenger\'s composer: the orb at the row\'s end (no band, no lift); a row with no room falls back to the lift', () => {
  const fr = { left: 0, top: 56 }, o = { x: 195, y: 806, d: 66 };
  const att = live(null, new B('button', {}, R(8, 707, 44, 44))), ta = live(null, new B('textarea', {}, R(58, 707, 274, 44))), mic = live(null, new B('button', {}, R(338, 707, 44, 44)));
  // the row makes room: the field gives up what the orb's spot takes (a flex row), the mic moves left with it
  const form = styled(live(null, new B('form', {}, R(0, 700, 390, 58), [att, ta, mic])), (k, v) => { if (k !== '--wos-end-pad') return; const pad = v ? parseFloat(v) : 0; ta.rect = R(58, 707, 274 - pad, 44); mic.rect = R(338 - pad, 707, 44, 44); });
  const d = pageWith([form]);
  const spot = ectx.orbEnd(d, form, o, fr);
  assert.equal(form.attrs['data-wos-end'], 'row'); assert.equal(form.style.getPropertyValue('--wos-end-pad'), '64px', 'room for a 52 px orb, its gap and 4 px from the edge');
  assert.ok(d.cls.has('wos-orb-end'), 'the lift is off: the app keeps its own height');
  assert.deepEqual(JSON.parse(JSON.stringify(spot)), { x: 360, y: 56 + 729, d: 52 }, 'the orb after the mic, on the row\'s line');
  // a row that cannot give up room (nothing moves): no spot, nothing left marked, the lift comes back
  const btns = [0, 1, 2, 3, 4, 5, 6].map(i => live(null, new B('button', {}, R(4 + i * 54, 707, 50, 44))));
  const full = styled(live(null, new B('div', {}, R(0, 700, 390, 58), btns))), d2 = pageWith([full]);
  assert.equal(ectx.orbEnd(d2, full, o, fr), null);
  assert.equal(full.attrs['data-wos-end'], undefined); assert.ok(!d2.cls.has('wos-orb-end'));
  assert.match(host, /if \(!split\) \{ try \{ spot = orbEnd\(d, bar, o, fr\); \} catch \(_\) \{ spot = null; \} \}/, 'every bar that is not split around the orb tries the row\'s end first');
  assert.match(host, /'html\.wos-orb-end\{--wos-inset-b:0px!important\}'/, 'no room under the list either: the bar is the end of the page');
  assert.match(host, /function placeSync\(\) \{/, 'the app in front decides where the orb goes');
});

test('round 6: the desktop Messenger: its thread\'s composer beside its list (not page-wide) is found right under the orb', () => {
  const list = new B('div', {}, R(0, 0, 322, 844), [new B('button', {}, R(6, 790, 300, 52))], { overflowY: 'auto', sh: 4000 });
  const att = new B('button', {}, R(330, 792, 44, 44)), ta = new B('textarea', {}, R(380, 792, 700, 44)), mic = new B('button', {}, R(1096, 792, 44, 44));
  const form = new B('form', {}, R(322, 784, 830, 60), [att, ta, mic]), pane = new B('section', {}, R(322, 0, 830, 844), [new B('div', {}, R(322, 0, 830, 784), [], { overflowY: 'auto', sh: 3000 }), form]);
  const d = pageWith([list, pane]);
  assert.equal(bctx.bottomBar(d, 1152, 844), null, 'not page-wide: no bar for the stock pass');
  assert.equal(bctx.bottomBar(d, 1152, 844, (864 - 288) / 1152), form, 'right under the orb: the composer is the bar');
  assert.equal(bctx.bottomBar(d, 1152, 844, .1), null, 'under the list: content, never a bar');
});
