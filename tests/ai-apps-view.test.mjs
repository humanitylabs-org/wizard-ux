import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// AI apps view (Miguel, 2 Nov 2026): the ChatGPT / Claude / Perplexity phone layout as a third shell view beside Orb
// and Apps (miguel/ai-apps, off by default; the views are mutually exclusive; all off = Desks). Guards:
//   - packaging: a view built into the shell (web/core/core-features.json, issue 1352), named 'Different shell view - AI apps',
//     never a default; the desktop wears layout 'ai-apps', the phone keeps its stock view;
//   - the layout: a top bar (☰ · the Wizard's name · workspaces), a drawer (open apps, All apps = the shared three-level
//     sheet, Recents = Working then Ready, View all, Settings, New chat), a long-press row menu mapped to Chats' own
//     actions, Home and the bare list become the chat; round 4: Home = a New chat with no greeting (the skin's
//     background, the composer, the orb), reached from anywhere by the name in the top bar, the orb's swipe up and the
//     drawer's +; the composer has no voice button (the dock orb stays under it), Send only with words;
//   - the core hooks it needs: the phone adapter's sessionList / sessionAct / showChats / newChat, the layout API's
//     sessions.act actions, sessions.chats / newChat, workspaces, desk.settings;
//   - Desks / Orb / Apps untouched: every rule is scoped to the worn layout, no literal colours, no timers of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { cascade, parseCss } from './fixtures/mini-css.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { layoutApi } from './fixtures/q1-layout-host.mjs';
import { desktopBoot, desktopPart } from './fixtures/q1-desktop-boot.mjs';
import { keysGuide } from './fixtures/keys-guide-harness.mjs';
import { resolveVars, px } from './fixtures/r7A-css.mjs';
import { fixture } from './fixtures/tweaks.mjs';
import { coreFeatures } from './fixtures/core-features.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';

import { El, FakePointerEvent, world, deskWorld, layout, matchesSel } from './fixtures/ai-apps-world.mjs';
// file readers stay local (a reader is not running code: tools/source-text-tests.mjs counts fixture imports as running)
const root = new URL('../', import.meta.url);
const read = p => withShellParts(withWebParts(readFileSync(new URL(p, root), 'utf8')));
const settle = () => new Promise(r => setTimeout(r, 15));
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// A desktop AI apps view mounted on a stage with the main Chats desk (desk 1: one window, a thread inside) and an app
// desk (Money, desk 4: one window with its own title bar), plus the shell's #bar with its fuel gauge; the html wears
// the desktop layout so desktop.css can be asked what wins on what the real view drew (wizard-ux issue 1674).
const DESK_CSS = [parseCss(readFileSync(new URL('web/layouts/ai-apps/desktop.css', root), 'utf8'))];   // parsed once
const node = (tag, cls, parent) => { const n = new El(tag); if (cls) n.className = cls; parent?.append(n); return n; };
async function panelDesk({ wins = 1, before } = {}) {
  const d = deskWorld(), { w } = d, guides = [];
  w.api.keys.guide = (fn, opts) => { guides.push([fn, opts]); return () => {}; };
  const bar = node('div', ''), gauge = node('span', 'mh-gauge', bar); bar.id = 'bar';
  const stage = node('div', ''); stage.id = 'stage';
  const chatDesk = node('div', 'wsp', stage), chatWin = node('div', 'win', chatDesk), wbody = node('div', 'wbody', chatWin), dchats = node('div', 'dchats', wbody);
  const paneMain = node('div', 'pane-main', dchats), thread = node('div', 'ch-thread', paneMain), msgs = node('div', 'ch-msgs', thread);
  const appDesk = node('div', 'wsp', stage), appWins = [];
  for (let i = 0; i < wins; i++) { const x = node('div', 'win', appDesk); x.dataset.win = 'money-' + i; node('div', 'wbar', x); node('iframe', '', node('div', 'wbody', x)); appWins.push(x); }
  w.html.children[0].append(bar, stage);
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  before?.(d);
  const off = (await layout()).default(w.api);
  const go = route => { w.st.route = { home: false, thread: null, ...route }; w.emit('route', w.st.route); w.run(); };
  const style = (n, opts) => { assert.ok(n, 'drawn'); const c = cascade(n, DESK_CSS, opts); return k => c[k]?.value ?? ''; };
  const important = (n, k) => !!cascade(n, DESK_CSS)[k]?.important;
  return { ...d, off, guides, go, style, important, bar, gauge, stage, chatDesk, chatWin, wbody, dchats, paneMain, thread, msgs, appDesk, appWins };
}

test('packaging: AI apps is a view built into the shell (wizard-ux issue 1352), desktop only, never a tweak package', async () => {
  const man = coreFeatures['miguel/ai-apps'];
  assert.equal(man.name, 'Different shell view - AI apps'); assert.equal(man.view, 'AI apps'); assert.equal(man.layout, 'ai-apps'); assert.deepEqual(man.shells, ['desktop']);
  assert.notEqual(man.default, true, 'a view, not a release-wide default');
  const cat = JSON.parse(read('web/tweaks/catalog.json')), prof = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.ok(!cat.tweaks.includes('miguel/ai-apps') && !cat.defaults.includes('miguel/ai-apps'), 'no longer a tweak in the catalog');
  assert.ok(!prof.tweaks.includes('miguel/ai-apps') && !prof.off.includes('miguel/ai-apps'), 'nor in his profile');
  assert.ok(!existsSync(new URL('../web/tweaks/miguel/ai-apps', import.meta.url)), 'the tweak package is gone');
  assert.ok(!/miguel\/ai-apps/.test(read('web/core/experience.js')), 'the standard desktop choice never depends on a personal tweak');
  const p = fixture({ shell: 'phone' });
  await p.mount('miguel/ai-apps'); await settle();
  assert.equal(p.host.layout, 'classic', 'desktop only (Miguel, 4 Nov 2026): the phone keeps its stock view');
  assert.ok(!p.doc.head.children.some(l => /layouts\/|tweaks\//.test(l.href || '')), 'nothing loads on the phone');
  await p.clear(); assert.equal(p.host.layout, 'classic');
  const d = fixture({ shell: 'desktop' });
  const listed = d.host.layouts.find(l => l.id === 'ai-apps');
  assert.equal(listed?.name, 'AI apps', 'the host lists the AI apps layout by name'); assert.deepEqual([...listed.shells], ['desktop']);
  // a stale AI apps layout no live tweak wears (and not the standard one) goes back to Desks on the next tweak load
  d.host.setLayout('ai-apps'); assert.equal(d.host.layout, 'ai-apps');
  await d.clear(); assert.equal(d.host.layout, 'classic', 'only unowned stale layouts go back to Desks; a standard desktop layout stays');
});

test('standard AI apps and the personal tweak are idempotent and release cannot remove the standard view', async () => {
  const d = fixture({ shell: 'desktop' });
  d.host.setStandardLayout('ai-apps'); await settle();
  assert.ok(!d.ctx.localStorage.getItem('wos.layout'), 'desktop default must not leak into the phone legacy layout key');
  await d.clear(); assert.equal(d.host.layout, 'ai-apps');
  d.ctx.localStorage.setItem('wos.layout', 'orb');
  d.host.setStandardLayout('classic'); assert.equal(d.host.layout, 'classic');
  d.host.setStandardLayout('ai-apps'); assert.equal(d.host.layout, 'ai-apps');
  assert.equal(d.ctx.localStorage.getItem('wos.layout'), 'orb', 'desktop changes preserve an existing phone choice');
});

// static-rule: every layout.css and tweak.css rule is scoped to the worn phone layout, colours are skin tokens, type is
// in rem, and layout.js keeps no timers, markup strings, storage or fetches of its own (a lint over the whole files)
test('scoped and quiet: every rule needs the worn layout on the phone; skin tokens only; no timers or storage of its own', () => {
  const css = read('web/layouts/ai-apps/layout.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("[^"]*"\)/g, 'url()');
  const body = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]*\{/g, '');
  for (const sel of [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(Boolean)) for (const part of sel.split(/,(?![^(]*\))/))
    assert.ok(/^html\[data-shell="phone"\]\[data-layout="ai-apps"\]/.test(part.trim()) || /^html\[data-shell="desktop"\]\[data-layout="ai-apps"\]\[data-(chats-owner|layout-booting)\]/.test(part.trim()), `unscoped: ${part.trim()}`);   // the desktop's two first-frame rules (core/skin-host.js boot)
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), 'colours are skin tokens');
  assert.ok(!/font(-size)?\s*:[^;}]*\b\d+px/.test(css), 'type in rem');
  const js = noComments(read('web/layouts/ai-apps/layout.js'));
  assert.ok(!/Math\.random|innerHTML|localStorage|setTimeout|setInterval|fetch\(/.test(js), 'no timers, markup strings, storage or fetches of its own');
});

test('desktop: a sidebar (open apps, All apps, the Archive / Working / Ready sections, + New chat, cog) that folds to a rail; the top row; the orb', async () => {
  const w = world({ shell: 'desktop' });
  const store = {}, keys = [];
  Object.assign(w.api, { asset: n => '/wizard-os-home/layouts/ai-apps/' + n, storage: { get: k => k in store ? store[k] : null, set: (k, v) => { store[k] = v; } },
    keys: { on: h => { keys.push(h); return () => {}; }, guide: g => { (w.st.guides ||= []).push(g); return () => {}; } }, orb: { ready: () => new Promise(() => {}), onLevel: () => () => {} }, voice: { state: () => ({ state: 'idle' }), talk: () => w.st.orbDown.push('talk'), command: () => w.st.orbDown.push('command') },
    desk: { settings: p => w.st.settings.push(p ?? ''), home: () => {} } });
  w.api.apps.inset = (px, orb) => { w.st.inset = px; w.st.insetOrb = orb; return () => { w.st.inset = null; }; };
  const off = (await layout()).default(w.api);
  assert.equal(w.html.dataset.aiApps, 'desktop'); assert.equal(w.html.dataset.viewChrome, 'desktop', 'the shared view chrome (the three-level sheet)');
  assert.equal(w.st.inset, 84, 'hosted apps keep room for the floating orb'); assert.equal(typeof w.st.insetOrb, 'function', 'and the orb says where it is (the orb bar)');
  assert.ok(w.q('link').getAttribute('href').endsWith('/desktop.css'), 'its own stylesheet, desktop-scoped');
  assert.equal(w.html.dataset.aadSide, 'open', 'open from 680 px up');
  assert.ok(w.html.attrs['data-settings-over'] === '', 'Settings opens over the page (a centred panel), never beside the chat');
  // the sidebar: wordmark · 🔍 · ◫; Apps grid (badged first, All apps last); the sections (round 5: Ready open)
  assert.deepEqual(w.q('.aad-sh').children.filter(c => !c.hidden).map(c => c.className.split(' ').pop()), ['aad-ws', 'aad-find', 'aad-sswap', 'aad-tog'], 'round 7: the workspace switcher in place of the name; round 16: no ⌂ (Home = ✕, Esc, ⌥`)');
  assert.equal(w.q('.aad-homeb'), null, 'round 16: the left sidebar is the chats only'); assert.equal(w.q('.aad-pins'), null, 'round 16: no pinned row on the left');
  assert.equal(w.q('.aad-sh .aad-wsn').textContent, 'Miguel');
  assert.equal(w.q('.aad-sh .aad-wsd'), null, 'round 8: the name is text only (and a small chevron), no disc');
  assert.equal(w.q('.aad-grid'), null, 'the sidebar is the chat list only: no app grid');
  // round 10: no apps sidebar on the right; Home's grid (open first, badged first; installed; Get more), paged
  assert.equal(w.q('.aad-apps'), null, 'round 10: the right apps sidebar is gone'); assert.equal(w.html.dataset.aadApps, undefined);
  assert.equal(w.html.dataset.aadHome, '', 'Home');
  // round 15: Home is clean (no grid, no tab strip); round 16 item 7: the column's + is the picker (no All apps grid)
  assert.equal(w.q('.aad-hg'), null, 'round 16: no All apps grid');
  assert.equal(w.q('.aad-strip'), null, 'round 15: no tab strip'); assert.equal(w.q('.aad-tplus'), null, 'no New tab +');
  w.q('.aad-vall').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.html.dataset.vcSheet, 'open', 'the picker'); assert.ok(w.q('.vc-sheet.vc-pick')); assert.equal(w.st.newChats, 0, 'no new chat for it');
  assert.deepEqual(w.qa('.vc-pick .vc-app[data-app]').map(b => b.dataset.app), ['mail', 'music', 'money', 'notes', 'maps', 'movies'], 'desktop app search includes installed, open and pinned apps');
  assert.equal(w.q('.vc-pick .vc-fold'), null, 'no Already open row');
  assert.ok(w.q('.vc-pick .vc-more'), '+ Get more last');
  assert.deepEqual(w.qa('.aad-sec').map(h => `${h.dataset.sec}:${h.getAttribute('aria-expanded')}`), ['working:false', 'ready:true', 'archive:false'], 'Activity (Channels on for everyone, issue 1258): Working, Ready, Recent, then Snoozed and Archived folded at the bottom; an empty one (here Recent and Snoozed) is not drawn (issue 1731)');
  assert.deepEqual(w.qa('.aad-rw').map(r => `${r.dataset.sid}:${r.dataset.kind}`), ['r1:ready', 'r2:ready']);
  assert.equal(w.q('.aad-viewall'), null, 'no View all: the sidebar is the chat list');
  w.q('.aad-sec[data-sec="working"]').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.qa('.aad-rw').map(r => r.dataset.sid), ['w1', 'r1', 'r2'], 'Working opens above Ready');
  assert.deepEqual(store.sections, { archive: false, working: true, snoozed: false, ready: true }, 'kept on this device');
  w.q('.aad-sec[data-sec="working"]').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.q('.aad-tog .aad-count'), null, 'round 18 item 4a: no Ready count on ◫ any more');
  assert.equal(w.q('.aad-sec[data-sec="ready"] .aad-sec-n').textContent, '2', 'round 18 item 4a: Ready\'s count on its own header (the rail\'s amber disc)');
  assert.deepEqual(w.q('.aad-foot').children.map(b => [b.className, b.getAttribute('aria-label'), b.textContent]), [['aad-set', 'Settings', ''], ['aad-fuel', null, ''], ['aad-new', 'New chat', '']], 'round 7: cog left, the fuel gauge between, + right');
  w.q('.aad-new').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.newChats, 1);
  w.q('.aad-set').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.settings, ['']);
  assert.equal(w.html.dataset.vcSheet, undefined, 'New chat closed the picker'); w.q('.aad-vall').dispatchEvent(new FakePointerEvent('click'));
  w.q('.vc-pick .vc-app[data-app="movies"]').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.opened.at(-1), 'movies', 'a pick opens it');
  assert.equal(w.html.dataset.vcSheet, undefined, 'a pick closes the picker');
  w.q('.aad-vall').dispatchEvent(new FakePointerEvent('click'));
  w.q('.vc-pick .vc-more').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.opened.at(-1), 'app-store', 'Get more = the App Store as it is');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyR' }), true, 'round 21: ⌥R folds the apps column (the right one)');
  assert.equal(w.html.dataset.aadTabs, 'rail'); keys[1].down({ altKey: true, code: 'KeyR' }); assert.equal(w.html.dataset.aadTabs, 'open');
  // ⋯ on a row: the same menu as the phone's long press, through Chats' own actions
  w.q('.aad-rw[data-sid="r2"] .aad-more').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.qa('.aad-pop-i').map(b => b.textContent), ['Pin', 'Rename', 'Mark unread', 'Move to channel…', 'Snooze', 'Archive']);
  w.q('.aad-pop-i[data-act="done"]').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.acts, [['r2', 'done']]); assert.equal(w.q('.aad-pop'), null);
  w.q('.aad-rw[data-sid="r1"] .aad-row').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.opened.at(-1), 'thread:r1');
  // fold to the rail with ◫ or Ctrl / ⌘ + Shift + S; kept on this device
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.q('.aad-rtog .aad-count'), null, 'round 16: no count on the rail\'s ◫ (Ready is right under it)'); assert.equal(w.q('.aad-rtog').getAttribute('aria-label'), 'Open sidebar');
  assert.equal(w.html.dataset.aadSide, 'rail'); assert.equal(store.folded, true);
  assert.equal(w.q('.aad-rail .aad-rapps'), null, 'the rail: no apps either');
  // round 12: the rail is words with counts (plain Ready chats count in Ready only, no status rows for them); no icons
  assert.deepEqual(w.q('.aad-rlist').children.map(n => n.dataset.k + ':' + n.querySelector('.aad-rk-n').dataset.n + n.querySelector('.aad-rk-w').textContent), ['working:1Working', 'ready:2Ready'], 'round 22: Working (while chats work), Snoozed and Ready (no Archive), a count over its word');
  assert.deepEqual(w.qa('.aad-rk[data-k="working"] .aad-d').map(d => d.className), ['aad-d is-spin'], 'round 23b: Working = one spinner');
  assert.equal(w.q('.aad-rk[data-k="working"] .aad-rk-wn').textContent, '1', 'round 23b: and its number');
  assert.deepEqual(w.qa('.aad-rk[data-k="ready"] .aad-d').map(d => d.className), ['aad-d is-dot'], 'round 23c: Ready = ONE amber dot, not a dot per chat');
  assert.equal(w.q('.aad-rk[data-k="ready"] .aad-rk-wn').textContent, '2', 'round 23c: and its number');
  assert.doesNotMatch(read('web/layouts/ai-apps/desktop.js'), /DOTS_MAX|aad-dots/, 'round 23c: no tally of dots past four (looked weird)');
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  const spin = cascade(w.q('.aad-rk[data-k="working"] .aad-d'), DESK_CSS).animation?.value || '';
  assert.match(spin, /^aad-spin 900ms linear infinite$/, 'the same spin as the expanded Working tally');
  assert.equal(w.q('.aad-rail .aad-pins'), null, 'round 16: no pinned apps on the rail');
  assert.equal(w.q('.aad-rlist .aad-sti'), null, 'round 12: no status icons'); assert.equal(w.q('.aad-rc'), null); assert.equal(w.q('.aad-rg'), null, 'no coloured dots');
  assert.equal(keys.length, 2, 'Ctrl/⌘+Shift+S and the view’s ⌥ keys; Escape belongs to the core dispatcher');
  assert.equal(w.st.guides.length, 1, 'round 21: one hold-⌥ guide, the view\'s targets (no app letters any more)');
  const chips = w.st.guides[0]();
  assert.ok(Array.isArray(chips), 'the guide lists chips');
  w.q('.aad-vall').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.escape(), true, 'Esc closes the picker'); assert.equal(w.html.dataset.vcSheet, undefined);
  assert.equal(w.escape(), true, 'bare AI apps root consumes Escape without legacy navigation');
  assert.equal(keys[0].down({ ctrlKey: true, shiftKey: true, code: 'KeyS', key: 'S' }), true); assert.equal(w.html.dataset.aadSide, 'open');
  assert.equal(keys[0].down({ metaKey: true, shiftKey: true, code: 'KeyS', key: 's' }), true); assert.equal(w.html.dataset.aadSide, 'rail');
  assert.equal(keys[0].down({ altKey: true, code: 'KeyS', key: 's' }), false, 'the ⌥ keys stay the shell\'s');
  // round 15: the top row holds a docked chat's title + ✕ and the app panel's header (no tab strip)
  assert.deepEqual(w.q('.aad-top').children.map(c => c.className), ['aad-ctop', 'aad-ptop']); // parked until an app owns it
  assert.equal(w.q('.aad-top .aad-ws'), null, 'the switcher lives in the sidebar header');
  assert.equal(w.q('.aad-wsn').textContent, 'Miguel'); assert.match(w.q('.aad-ws').getAttribute('aria-label'), /Workspace: Miguel/);
  w.q('.aad-ws').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.qa('.aad-wr b').map(b => b.textContent), ['Miguel', 'Carlos']); assert.ok(w.q('.aad-wm'));
  w.q('.aad-wm').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.settings.at(-1), 'connections', 'wizard-ux#1209: Manage lands where the saved Wizards are added, not Network & security');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aiFront, 'app'); assert.equal(w.q('.aad-vtab.is-on').dataset.app, 'money', 'its tab on the right in front');
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aiFront, 'chat'); assert.equal(w.html.dataset.aadChat, undefined, 'round 15: no Chats desk on the stage here, nothing to dock (the docking: below)');
  // Home = the empty new chat: + goes there (round 7: no name button, no home button in the top row)
  const before = w.st.newChats;
  assert.equal(w.q('.aad-home'), null); assert.equal(w.q('.aad-word'), null);
  w.q('.aad-rnew').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.st.newChats, before + 1, 'Home = a new chat, from anywhere');
  // no voice button in the composer: its Send is the stock one; the orb is the one way to talk (click talks, hold commands)
  const form = new El('form'); form.className = 'ch-compose'; const row2 = new El('div'); row2.className = 'ch-row2'; const send = new El('button'); send.className = 'ch-send';
  form.append(row2); row2.append(send); w.device.append(form);
  const e = w.fire('pointerdown', send, { pointerId: 21 }); assert.ok(!e.defaultPrevented, 'the composer\'s button is only Send');
  const orb = w.q('.aad-orbbtn');
  orb.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 22, button: 0, clientX: 10, clientY: 10 })); orb.dispatchEvent(new FakePointerEvent('pointerup', {}));
  assert.deepEqual(w.st.orbDown, ['talk'], 'a click on the orb talks');
  orb.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 23, button: 0, clientX: 10, clientY: 10 })); w.st.timers.filter(t => t.ms === 300).at(-1).fn();
  assert.deepEqual(w.st.orbDown, ['talk', 'command'], 'a hold gives a command');
  // Home becomes the empty new chat
  const nc = w.st.newChats; w.st.route = { home: true, view: 'desk', thread: null, desk: 0 }; w.emit('route', w.st.route); w.run(); assert.ok(w.st.newChats > nc, 'Home → a new chat');
  off();
  assert.equal(w.q('.aad'), null); assert.equal(w.html.dataset.aiApps, undefined); assert.equal(w.html.dataset.viewChrome, undefined); assert.equal(w.html.attrs['data-settings-over'], undefined);
});

// static-rule: every desktop.css rule is scoped to the worn layout, colours are skin tokens, type is in rem, and
// desktop.js keeps no markup, timers, storage or fetches of its own (a lint over the whole files)
test('desktop scoped and quiet: every rule needs the worn layout on the desktop; skin tokens only; measured sizes', () => {
  const css = read('web/layouts/ai-apps/desktop.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("[^"]*"\)/g, 'url()');
  const body = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]*\{/g, '');
  for (const sel of [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(Boolean)) for (const part of sel.split(/,(?![^(]*\))/))
    assert.ok(/^html\[data-shell="desktop"\]\[data-layout="ai-apps"\]/.test(part.trim()), `unscoped: ${part.trim()}`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css.replace(/#(bar|logo|wsList|clock|searchBtn|micBtn|status|settingsBtn|keysBtn|generalVoice|commandBtn|dictateBtn|stage|desktopHome)\b/g, '')), 'colours are skin tokens');
  assert.ok(!/font(-size)?\s*:[^;}]*\b\d+px/.test(css), 'type in rem');
  const js = noComments(read('web/layouts/ai-apps/desktop.js'));
  // The orb identity reuses WizSigil's already-rendered glyph markup, not a
  // second renderer. Keep that narrow exception visible; forbid other sinks.
  const withoutSigilMarkup = js.replace('micG.innerHTML', 'micGlyph').replace('micG.innerHTML = html', 'micGlyph = html');
  assert.ok(!/Math\.random|innerHTML|localStorage|setTimeout|setInterval|fetch\(/.test(withoutSigilMarkup), 'no independent markup, timers, storage or fetches beyond the shared sigil glyph');
});

test('desktop measured sizes: a 288 px sidebar, a 52 px rail, a 768 px column and a 52 px pill composer', async () => {
  const { SIDE, RAIL, DOCKED_FROM, CROWDED_FROM } = await import(new URL('web/layouts/ai-apps/desktop.js', root).href);
  assert.deepEqual([SIDE, RAIL, DOCKED_FROM, CROWDED_FROM], [288, 52, 680, 900]);
  // the real desktop.css on the root and on a Chats window shaped like the one Chats draws
  const css = read('web/layouts/ai-apps/desktop.css'), doc = createDocument(), html = doc.documentElement;
  html.setAttribute('data-shell', 'desktop'); html.setAttribute('data-layout', 'ai-apps');
  const side = () => cascade(html, css)['--aad-side']?.value;
  assert.equal(side(), '288px', 'a 288 px sidebar (Claude; ChatGPT\'s panel)');
  for (const v of ['rail', 'over']) { html.setAttribute('data-aad-side', v); assert.equal(side(), '52px', `round 16: a 52 px rail (ChatGPT's collapsed rail): ${v}`); }
  html.removeAttribute('data-aad-side');
  doc.body.innerHTML = '<div id="stage"><div class="wsp"><div class="win"><div class="dchats"><div class="pane-main"><div class="ch-thread"><div class="ch-newchat"></div><form class="ch-compose"><div class="ch-row2"><div class="ch-field"></div><button class="ch-send"></button></div></form></div></div></div></div></div></div>';
  const st = (sel, ...p) => { const c = cascade(doc.querySelector(sel), css); return p.map(k => c[k]?.value ?? ''); };
  assert.deepEqual(st('.ch-compose', 'width', 'box-sizing', 'margin'), ['min(768px, calc(100% - 48px))', 'border-box', '0 auto 24px'], 'a 768 px column, the composer docked 24 px from the bottom (round 6: the orb is inside it)');
  assert.deepEqual(st('.ch-row2', 'display', 'min-height', 'border-radius'), ['grid', '52px', '26px'], 'a 52 px pill composer (r 26)');
  assert.equal(st('.ch-send', 'display')[0], 'none', 'Send only with words; no voice button of its own');
  doc.querySelector('.ch-compose').classList.add('has-text');
  assert.notEqual(st('.ch-send', 'display')[0], 'none', 'Send shows with words');
  assert.equal(st('.ch-newchat', 'display')[0], 'none', 'Home has no greeting');
});

// (from 12 Nov 2026 the window under 1100 px is one app at a time: the list stays beside the chat down to 680 px, then
// the list alone fills the window, the chat after it with Back; the rail is the wide window's fold)
test('desktop: the sidebar stays open down to 680 px wide, below it the list alone (James, 12 Nov 2026: half / third of the screen)', async () => {
  const had = globalThis.innerWidth;
  const at = async width => {
    globalThis.innerWidth = width;
    const w = world({ shell: 'desktop' }), store = {};
    Object.assign(w.api, { asset: n => '/wizard-os-home/layouts/ai-apps/' + n, storage: { get: k => k in store ? store[k] : null, set: (k, v) => { store[k] = v; } },
      keys: { on: () => () => {}, guide: () => () => {} }, orb: { ready: () => new Promise(() => {}), onLevel: () => () => {} }, voice: { state: () => ({ state: 'idle' }), talk: () => {}, command: () => {} },
      desk: { settings: () => {}, home: () => {} } });
    w.api.apps.inset = () => () => {};
    const off = (await layout()).default(w.api);
    const side = w.html.dataset.aadSide; off?.();
    return side;
  };
  try {
    assert.equal(await at(700), 'open', 'open at 700 px');
    assert.equal(await at(680), 'open', 'open at exactly 680 px');
    assert.equal(await at(660), 'full', 'below 680 px the list alone (one thing at a time)');
  } finally { if (had === undefined) delete globalThis.innerWidth; else globalThis.innerWidth = had; }
});

test('desktop core hooks: the adapter lists chats with Chats\' own actions, shows the Chats desk, a New chat in it; Settings over the page', () => {
  const dj = read('web/desktop/desktop.js');
  const fn = dj.match(/sessionList: (\(\) => window\.WizChatsListModel\.sessionList\([^\n]+\)),\n    \/\/ The thread's own actions/)[1];
  const s = (id, extra = {}) => ({ id, title: id.toUpperCase(), status: 'completed', ...extra });
  const LIVE = { ok: true, workGroups: () => ({ working: [s('w')], ready: [s('r'), s('n')], archive: [s('a')] }), isNew: x => x.id === 'n', cardAt: () => '' };
  const CHATS = { threadActions: x => x.id === 'w' ? [] : x.id === 'a' ? ['restore', 'snooze'] : ['snooze', 'stop_watch', 'done'] };
  const out = runWithChatsModel(`(${fn})()`, { LIVE, CHATS, window: { WosChatPins: { has: id => id === 'r' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(out.working[0].actions)), ['pin', 'rename']);
  assert.deepEqual(JSON.parse(JSON.stringify(out.ready.map(r => [r.id, r.pinned, r.unread, r.actions]))), [['r', true, false, ['pin', 'rename', 'unread', 'snooze', 'done']], ['n', false, true, ['pin', 'rename', 'snooze', 'done']]]);
  assert.deepEqual(JSON.parse(JSON.stringify(out.archive[0].actions)), ['pin', 'rename', 'restore', 'snooze']);
  // the adapter's showChats / newChat, run: the Chats desk in front (its window), a New chat only when there is one
  const hooks = win => runRecording(`this.h = {\n${between(dj, '    showChats: () => ', '\n    /* The AI apps sidebar')}\n};`, { skinShowChats: () => win });
  const none = hooks(null), one = hooks({ id: 'c1' });
  assert.equal(none.h.showChats(), false); assert.equal(none.h.newChat(), false, 'no Chats window, no New chat');
  assert.deepEqual(none.calls.filter(c => c[0] === 'newChat'), []);
  assert.equal(one.h.showChats(), true); assert.equal(one.h.newChat(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(one.calls.filter(c => c[0] === 'newChat'))), [['newChat']], 'a New chat in the Chats desk');
  // openSettings, run: html[data-settings-over] keeps Settings the centred panel over the page, also off Home
  const settings = (over, homeOpen = false) => {
    const ctx = runRecording(`${between(dj, '  const settingsOver = ', ';\n')};\n${block(dj, '  function openSettings(focus) {')}\nthis.open = openSettings;`,
      { homeOpen, document: { documentElement: { hasAttribute: k => over && k === 'data-settings-over' }, activeElement: null }, settingsWin: () => ({ id: 's1' }), setEl: { hidden: true } });
    ctx.open(); return ctx.calls.filter(c => ['showSettingsModal', 'focusWin', 'newWin'].includes(c[0])).map(c => c[0]);
  };
  assert.deepEqual(settings(true), ['showSettingsModal'], 'a layout may keep Settings over the page');
  assert.deepEqual(settings(false), ['focusWin'], 'without it, off Home, the Settings window comes forward');
  assert.deepEqual(settings(false, true), ['showSettingsModal'], 'from Home always the centred panel');
});

test('nothing hidden: failed / interrupted chats and By day\'s Yesterday / Past week are in Ready (both adapters)', () => {
  // (Miguel, 4 Nov 2026: "the grouping and sorting doesn't always show everything"): this view has no Errors or day
  // sections, so stock's errors / yesterday / pastWeek groups must land in Ready, a failed one ranked with Needs you.
  for (const [file, re] of [['web/desktop/desktop.js', /sessionList: (\(\) => window\.WizChatsListModel\.sessionList\([^\n]+\)),\n    \/\/ The thread's own actions/], ['web/app.js', /sessionList: (\(\) => window\.WizChatsListModel\.sessionList\([^\n]+\)),\n    sessionAct/]]) {
    const fn = read(file).match(re)[1];
    const s = (id, extra = {}) => ({ id, title: id, status: 'completed', ...extra });
    const LIVE = { ok: true, readyRank: () => 5, isNew: () => false, cardAt: () => '',
      workGroups: () => ({ errors: [s('e', { status: 'interrupted' })], working: [s('w', { status: 'running' })], ready: [s('r')], yesterday: [s('y')], pastWeek: [s('p')], deferred: [], archive: [s('a')] }) };
    const CHATS = { threadActions: () => [], stiKind: x => x.status === 'interrupted' ? 'failed' : 'none' };
    const out = runWithChatsModel(`(${fn})()`, { LIVE, CHATS, window: {} });
    const all = ['working', 'ready', 'snoozed', 'archive'].flatMap(k => out[k].map(r => r.id)).sort();
    assert.deepEqual(all, ['a', 'e', 'p', 'r', 'w', 'y'], file + ': every chat is listed somewhere');
    assert.deepEqual(JSON.parse(JSON.stringify(out.ready.map(r => [r.id, r.state, r.rank]))), [['e', 'failed', 1], ['r', 'none', 5], ['y', 'none', 5], ['p', 'none', 5]], file);
  }
});

test('top bar: ☰ (the unread badge) · Home · the workspace switcher (Home only); the drawer: open apps, All apps, Archive / Working / Ready, Settings, New chat', async () => {
  const w = world();
  const off = (await layout()).default(w.api);
  assert.equal(w.html.dataset.aiApps, 'on'); assert.equal(w.html.dataset.viewChrome, 'phone', 'the shared view chrome (dock without its switcher)');
  assert.deepEqual(w.st.swipes, { up: 'new', side: null, down: null }, 'round 5: a swipe up on the orb = a New chat to type in (tap = talk)');
  assert.equal(w.st.inset, 96, 'hosted apps keep room for the floating orb');
  const top = w.q('.aa-top'); assert.ok(top);
  assert.deepEqual(top.children.map(c => c.className), ['aa-tb aa-menu', 'aa-tb aa-home'], 'round 7: the switcher moved to the drawer header');
  assert.equal(w.q('.aa-name'), null, 'round 5: no name in the middle, a home button');
  assert.equal(w.q('.aa-home').getAttribute('aria-label'), 'Home'); assert.equal(w.q('.aa-home').tagName, 'BUTTON');
  assert.equal(w.q('.aa-ws-i').textContent, 'M'); assert.match(w.q('.aa-dws').getAttribute('aria-label'), /Workspace: Miguel/);
  assert.equal(w.q('.aa-dws .aa-word').textContent, 'Miguel', 'the drawer header names this Wizard');
  assert.match(w.q('.aa-menu').getAttribute('aria-label'), /2 unread/);
  assert.equal(w.q('.aa-menu .aa-count').textContent, '2', 'the shared unread badge on ☰, a number (no bare dot)'); assert.equal(w.q('.aa-dot'), null);
  // open the drawer
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.html.dataset.aaDrawer, 'open'); assert.equal(w.st.backs.length, 1, 'Back closes it');
  const rows = w.q('.aa-scroll').children.map(n => n.className.split(' ').find(c => /^aa-(grid|app|more|all|div|sec|sec-b|chat|viewall|empty)$/.test(c)));
  assert.deepEqual(rows.map(c => c || 'aa-sech'), ['aa-sech', 'aa-sec-b', 'aa-sec', 'aa-sec-b', 'aa-sech', 'aa-sec-b', 'aa-sec', 'aa-sec-b'], 'the drawer = the chat list only (Miguel: apps live on Home), no Recents, no View all');
  assert.equal(w.q('.aa-scroll .aa-grid'), null, 'no app grid and no All apps in the drawer');
  assert.deepEqual(w.qa('.aa-chat').map(b => `${b.dataset.sid}:${b.dataset.kind}`), ['r1:ready', 'r2:ready'], 'Ready open; Working and Archive folded at first');
  assert.ok(w.q('.aa-chat[data-sid="r1"] .aa-st').classList.contains('is-new') && w.q('.aa-chat[data-sid="r1"] .aa-pin'), 'new dot, pin mark');
  assert.equal(w.q('.aa-chat[data-sid="r2"] .aa-st'), null, 'a seen chat is a plain title (no state ring)');
  assert.deepEqual(w.q('.aa-chat[data-sid="r1"]').children.map(c => c.className.split(' ').pop()), ['aa-row-t', 'aa-pin', 'is-new'], 'title first, the state at the end');
  // Home: the apps above the composer, open first (badged first), then the rest installed, then Get more
  w.q('.aa-scrim').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.q('.ah-grid').children.map(b => b.dataset.app || (b.classList.contains('ah-tidy') ? 'tidy' : '+')), ['notes', 'maps', '+', 'tidy'], 'round 19 item 4: the open apps not pinned, +, tidy');
  assert.deepEqual(w.qa('.ah-dock .ah-app').map(b => b.dataset.app), ['music', 'mail', 'money'], 'round 19 item 4: his pins in the dock');
  assert.equal(w.q('.ah-app[data-app="money"] .ah-badge').textContent, '3', 'the shell\'s own count, on the icon');
  assert.equal(w.q('.ah-app[data-app="money"] .ah-name').textContent, 'Money');
  assert.equal(w.q('.ah-app[data-app="money"]').getAttribute('aria-label'), 'Money, 3 new, open', 'round 18: an open app says so (its running dot)');
  w.q('.ah-app[data-app="money"]').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.gone, [4], 'an app goes to its desk (full screen on the phone)');
  w.q('.ah-plus').dispatchEvent(new FakePointerEvent('click')); assert.ok(w.q('.vc-sheet.vc-pick'), '+ = the picker');
  w.q('.vc-pick .vc-app[data-app="movies"]').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.opened.at(-1), 'movies', 'an installed app opens on a desk of its own');
  w.q('.ah-plus').dispatchEvent(new FakePointerEvent('click')); w.q('.vc-pick .vc-more').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.opened.at(-1), 'app-store', 'Get more = the App Store');
  // round 7 (Miguel, familiarity first): Home is the grid only, no Grid | Orb switch, no orb scene
  assert.equal(w.q('.ah-sw'), null); assert.equal(w.q('.ah-scene'), null); assert.deepEqual(w.q('.ah').children.map(c => c.className.split(' ')[0]), ['ah-grid', 'ah-dock'], 'round 19 item 4: the grid, then the dock');
  // footer
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  // round 2: icons only — a big round + (New chat) where ChatGPT's compose button sits, then a cog (Settings); no words,
  // no avatar letter; their accessible names say what they do
  assert.deepEqual(w.q('.aa-foot').children.map(b => [b.className, b.getAttribute('aria-label'), b.textContent]), [['aa-set', 'Settings', ''], ['aa-fuel', null, ''], ['aa-new', 'New chat', '']], 'round 7: cog left, gauge between, + right');
  assert.equal(w.q('.aa-av'), null); assert.equal(w.q('.aa-acct'), null);
  w.q('.aa-new').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.newChats, 1);
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  w.q('.aa-set').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.settings, ['']);
  assert.equal(w.q('.aa-viewall'), null, 'no View all'); assert.deepEqual(w.st.lists, []);
  off();
  assert.equal(w.q('.aa-top'), null); assert.equal(w.html.dataset.aiApps, undefined); assert.equal(w.html.dataset.viewChrome, undefined);
});

test('desktop contextual Chats search never recommends apps; local input, rail, Back and thread actions stay intact', async () => {
  const w = world({ shell: 'desktop' }), keys = [];
  Object.assign(w.api, { asset: n => '/wizard-os-home/layouts/ai-apps/' + n,
    keys: { on: h => { keys.push(h); return () => {}; }, guide: () => () => {} },
    orb: { ready: () => new Promise(() => {}), onLevel: () => () => {} },
    voice: { state: () => ({ state: 'idle' }), talk() {}, command() {} } });
  const ordinaryApps = w.api.apps.list;
  w.api.apps.list = () => [...ordinaryApps(), { id: 'browser', name: 'Browser' }, { id: 'app-only', name: 'Apponlycounterexample' }];
  w.st.sessions.ready[0].title = 'Browser research';
  w.st.sessions.archive[0].title = 'Old browser discussion';
  w.st.sessions.archive.push({ ...w.st.sessions.ready[0] }); // same thread in two buckets: one result
  const off = (await layout()).default(w.api);
  const ids = () => w.qa('.aad-scroll .aad-rw').map(n => n.dataset.sid);
  const sections = () => w.qa('.aad-sec').map(n => [n.dataset.sec, n.getAttribute('aria-expanded')]);
  const originalSections = sections(), originalIds = ids();
  const input = q => { const f = w.q('.aad-q'); f.value = q; f.dispatchEvent(new FakePointerEvent('input')); };
  for (const s of ['.aad-find', '.aad-rfind', '.aad-q']) assert.equal(w.q(s).getAttribute('aria-label'), 'Search chats');
  assert.equal(w.q('.aad-q').getAttribute('placeholder'), 'Search chats');
  w.q('.aad-find').dispatchEvent(new FakePointerEvent('click'));
  const readSessions = w.api.sessions.list;
  w.api.sessions.list = () => { throw Error('typing must use the existing local projection'); };
  input('browser');
  w.api.sessions.list = readSessions;
  assert.deepEqual(ids(), ['r1', 'a1'], 'synchronous current + archive thread matches, deduplicated');
  assert.equal(w.q('.aad-scroll [data-app]'), null, 'installed Browser never enters contextual results');
  assert.deepEqual(w.qa('.aad-scroll .aad-lab').map(n => n.textContent), ['Chats']);
  for (const term of ['Apponlycounterexample', 'no-such-chat']) {
    input(term); assert.deepEqual(ids(), []); assert.equal(w.q('.aad-scroll [data-app]'), null);
    assert.equal(w.q('.aad-empty').textContent, 'No chats by that name.');
    w.q('.aad-q').dispatchEvent(new FakePointerEvent('keydown', { key: 'Enter' }));
    assert.deepEqual(w.st.opened, [], 'Enter on empty results must not open an app or thread');
  }
  input(''); assert.deepEqual(sections(), originalSections); assert.deepEqual(ids(), originalIds);
  input('browser'); w.q('.aad-cancel').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.q('.aad-search').hidden, true); assert.deepEqual(sections(), originalSections);
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.html.dataset.aadSide, 'rail');
  w.q('.aad-rfind').dispatchEvent(new FakePointerEvent('click')); input('browser'); assert.deepEqual(ids(), ['r1', 'a1']);
  assert.equal(w.escape(), true); assert.equal(w.q('.aad-search').hidden, true); assert.deepEqual(sections(), originalSections);
  assert.equal(keys[1].down({ altKey: true, code: 'KeyK' }), true); input('browser');
  w.q('.aad-rw[data-sid="a1"] .aad-row').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.st.opened, ['thread:a1'], 'exact archive thread clicked, no app open');
  assert.deepEqual(w.st.acts, []); assert.equal(w.q('.aad-search').hidden, true);
  off();
});

test('phone search still covers chats (archive too) and apps; a chat row opens its thread; a long press opens its menu, mapped to Chats\' own actions', async () => {
  const w = world();
  (await layout()).default(w.api);
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  w.q('.aa-find').dispatchEvent(new FakePointerEvent('click'));
  const f = w.q('.aa-q'); f.value = 'mo'; f.dispatchEvent(new FakePointerEvent('input'));
  assert.deepEqual(w.qa('.aa-scroll .aa-gi, .aa-scroll .aa-row').map(b => b.dataset.app || b.dataset.sid), ['money', 'movies', 'a1']);
  w.q('.aa-cancel').dispatchEvent(new FakePointerEvent('click'));
  // tap
  w.q('.aa-chat[data-sid="r2"]').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.st.opened, ['thread:r2']); assert.equal(w.html.dataset.aaDrawer, undefined);
  // long press → menu
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  const row = w.q('.aa-chat[data-sid="r2"]');
  row.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 3, clientX: 50, clientY: 300, button: 0 }));
  const lp = w.st.timers.find(t => t.ms === 450); assert.ok(lp, 'a 450 ms still press'); lp.fn();
  assert.deepEqual(w.qa('.aa-pop-i').map(b => b.textContent), ['Pin', 'Rename', 'Mark unread', 'Move to channel…', 'Snooze', 'Archive'], 'their order, Wizard\'s actions, filing last');
  assert.ok(row.classList.contains('is-held'));
  // the lift right after the press never closes it or picks an item
  w.q('.aa-menu-scrim').dispatchEvent(new FakePointerEvent('click')); assert.ok(w.q('.aa-pop'), 'still open after the lift');
  row.dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.opened, ['thread:r2'], 'the lift does not open the chat');
  const realNow = Date.now; Date.now = () => realNow() + 2000;
  try {
    w.q('.aa-pop-i[data-act="snooze"]').dispatchEvent(new FakePointerEvent('click'));
    assert.deepEqual(w.st.acts, [['r2', 'snooze']]); assert.equal(w.q('.aa-pop'), null);
    // a pinned row says Unpin; Rename closes the drawer first (Chats' rename sheet opens over the chat)
    const r1 = w.q('.aa-chat[data-sid="r1"]');
    r1.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 4, button: 0 })); w.st.timers.filter(t => t.ms === 450).at(-1).fn();
    assert.equal(w.q('.aa-pop-i[data-act="pin"]').textContent, 'Unpin');
    Date.now = () => realNow() + 4000;
    w.q('.aa-pop-i[data-act="rename"]').dispatchEvent(new FakePointerEvent('click'));
  } finally { Date.now = realNow; }
  assert.deepEqual(w.st.acts.at(-1), ['r1', 'rename']); assert.equal(w.html.dataset.aaDrawer, undefined);
  // Move to channel… also steps the drawer aside, for Chats' own channel picker (wizard-ux issue 1292)
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  w.q('.aa-chat[data-sid="r2"]').dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 6, button: 0 })); w.st.timers.filter(t => t.ms === 450).at(-1).fn();
  Date.now = () => realNow() + 6000;
  try { w.q('.aa-pop-i[data-act="move"]').dispatchEvent(new FakePointerEvent('click')); } finally { Date.now = realNow; }
  assert.deepEqual(w.st.acts.at(-1), ['r2', 'move']); assert.equal(w.html.dataset.aaDrawer, undefined, 'the drawer closed for the picker');
  // a working thread offers only what Chats allows on it
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  w.q('.aa-sec[data-sec="working"]').dispatchEvent(new FakePointerEvent('click'));
  w.q('.aa-chat[data-sid="w1"]').dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 5, button: 0 })); w.st.timers.filter(t => t.ms === 450).at(-1).fn();
  assert.deepEqual(w.qa('.aa-pop-i').map(b => b.dataset.act), ['pin', 'rename']);
});

test('desktop: covered AI apps panel apps never receive front-only service admission (04bd2899 C6)', () => {
  const js = read('web/desktop/desktop.js');
  const expression = js.match(/isFront: (\(\) => .*?), back: \(\) => closeWorkflow/)[1];
  for (const hidden of [false, true]) for (const hosted of [false, true]) {
    const value = runWithChatsModel('(' + expression + ')()', { WosSkinHost: { panelMode: true }, panelHas: () => true, w: { id: 'qa-app' }, pal: { hidden }, CHATS: { isHosted: () => hosted }, homeOpen: true });
    assert.equal(value, hidden && !hosted, 'palette=' + !hidden + ', hosted=' + hosted);
  }
});

test('phone: deferred Chats preparation never opens the drawer over a shell sheet', async () => {
  for (const which of ['settings', 'launcher']) {
    const w = world();
    (await layout()).default(w.api);
    w.emit('route', w.st.route); // initial empty thread is also a thread
    w.device.classList.add('sheet-open'); w.device.dataset.sheet = which;
    w.st.route = { ...w.st.route, view: 'list', thread: null };
    w.emit('route', w.st.route); w.run();
    assert.equal(w.st.newChats, 1, 'Chats still prepares behind the sheet');
    assert.equal(w.q('.aa-layer').hidden, true, which + ' keeps the drawer hidden');
    assert.equal(w.html.dataset.aaDrawer, undefined);
    assert.equal(w.st.backs.length, 0, 'no drawer Back handler steals the sheet dismissal');
    w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
    assert.equal(w.q('.aa-layer').hidden, true, 'explicit drawer opens also yield to a shell sheet');
    w.fire('touchstart', w.device, { touches: [{ clientX: 2, clientY: 400 }] });
    w.fire('touchmove', w.device, { touches: [{ clientX: 180, clientY: 400 }] });
    assert.equal(w.q('.aa-layer').hidden, true, 'edge gestures cannot cover the sheet');
    w.device.classList.remove('sheet-open'); delete w.device.dataset.sheet;
    w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
    assert.equal(w.html.dataset.aaDrawer, 'open', 'menu works after the sheet closes');
    w.st.backs.at(-1)(); w.run();
    assert.equal(w.q('.aa-layer').hidden, true, 'Back closes the drawer, never exits');
  }
});

test('phone: a sheet opened between route and deferred drawer work still wins', async () => {
  const w = world(); (await layout()).default(w.api);
  w.emit('route', w.st.route);
  w.st.route = { ...w.st.route, view: 'list', thread: null };
  w.emit('route', w.st.route);
  w.device.classList.add('sheet-open');
  w.run();
  assert.equal(w.q('.aa-layer').hidden, true);
  assert.equal(w.st.newChats, 1);
});

test('phone: a shell sheet cancels a drawer drag before move or release without a stranded layer', async () => {
  for (const phase of ['before-move', 'before-release']) {
    const w = world(); (await layout()).default(w.api);
    w.fire('touchstart', w.device, { touches: [{ clientX: 2, clientY: 400 }] });
    if (phase === 'before-move') w.device.classList.add('sheet-open');
    w.fire('touchmove', w.device, { touches: [{ clientX: 240, clientY: 400 }] });
    if (phase === 'before-release') {
      assert.equal(w.q('.aa-layer').hidden, false, 'drag layer was visible before the sheet opened');
      w.device.classList.add('sheet-open');
    }
    w.fire('touchend', w.device, { changedTouches: [{ clientX: 240, clientY: 400 }] }); // go:true must clean up instead of stranding open:false
    assert.equal(w.q('.aa-layer').hidden, true, 'sheet wins on the same frame at ' + phase);
    assert.equal(w.q('.aa-layer').classList.contains('is-drag'), false);
    w.run();
    assert.equal(w.q('.aa-layer').classList.contains('is-open'), false);
    assert.equal(w.html.dataset.aaDrawer, undefined);
    assert.equal(w.st.backs.length, 0);
    w.device.classList.remove('sheet-open');
    w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
    assert.equal(w.html.dataset.aaDrawer, 'open', 'a cancelled drag does not break the next open');
  }
});

test('main screen: Home and the bare list become the chat; a thread left for the list opens the drawer; an app is "app"', async () => {
  const w = world({ route: { home: true, view: 'desk', thread: null, desk: 0, app: null } });
  (await layout()).default(w.api);
  w.run(); assert.equal(w.st.newChats, 1, 'Home → a New chat (round 4: Home and New chat are one screen)'); assert.equal(w.st.chats, 0);
  w.st.route = { home: false, view: 'thread', thread: 't9', desk: 1, app: 'chats' }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aiFront, 'chat');
  w.st.route = { home: false, view: 'list', thread: null, desk: 1, app: 'chats' }; w.emit('route', w.st.route); w.run();
  assert.equal(w.st.newChats, 2, 'the bare list becomes a New chat'); assert.equal(w.html.dataset.aaDrawer, 'open', 'and the drawer (the list lives there)');
  w.q('.aa-scrim').dispatchEvent(new FakePointerEvent('click'));
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4, app: 'money' }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aiFront, 'app');
});

/* Round 4 (Miguel, 2 Nov 2026): Home is the empty New chat with no greeting; the Wizard's name in the top bar goes Home
 * from anywhere (an app included), as do the orb's swipe up and the drawer's +; the composer's own voice button is
 * gone (the dock orb under the composer talks), the mic stays, Send shows only with words. */
test('round 4: Home has no greeting: only the skin background, the composer and the orb', async () => {
  const w = world({ route: { home: true, view: 'desk', thread: null, desk: 0, app: null } });
  (await layout()).default(w.api);
  w.run(); assert.equal(w.st.newChats, 1, 'Home = a New chat'); assert.equal(w.html.dataset.aiNew, 'on', 'flagged as Home');
  w.emit('home'); w.run(); assert.equal(w.st.newChats, 2, "the shell's Home lands on a New chat too");
  w.st.route = { home: false, view: 'thread', thread: 't9', desk: 1, app: 'chats' }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aiNew, undefined, 'a thread is not Home');
  w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1, app: 'chats' }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aiNew, 'on', 'a New chat is Home');
  const css = read('web/layouts/ai-apps/layout.css');
  // the real layout.css on what the view drew and on a Chats window's New chat (a skeleton of Chats' markup)
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  const chatsWin = node('div', 'win app-chats', w.device);
  for (const cls of ['ch-newchat', 'nc-classic']) { const c = cascade(node('div', cls, chatsWin), css).display; assert.deepEqual([c?.value, c?.important], ['none', true], `no greeting, no mark, no boxed hint: .${cls}`); }
  assert.ok(!/\.nc-hi \{|\.nc-sub \{|\.nc-mark \{/.test(css), 'no greeting styles left');
  const top = () => cascade(w.q('.aa-top'), css).background;
  assert.deepEqual([top()?.value, top()?.important], ['transparent', true], "Home lets the skin's background through");
  w.st.route = { home: false, view: 'thread', thread: 't9', desk: 1, app: 'chats' }; w.emit('route', w.st.route);
  assert.notEqual(top()?.value, 'transparent', 'a thread keeps its top bar');
  assert.ok(!/:not\(\[data-ai-front="app"\]\) #device[^{]*#dock \{ opacity: 0/.test(css), 'the dock orb is no longer hidden over the chat');
  assert.ok(!/--aa-orb-room/.test(css + read('web/layouts/ai-apps/layout.js')), "round 6: no row of its own for the orb under the composer (it sits inside it)");
});

test("round 4 + 5: the home button (in place of the name) goes Home from an app (and from a thread); so does the drawer's +", async () => {
  const w = world({ route: { home: false, view: 'desk', thread: null, desk: 3, app: 'music' } });
  (await layout()).default(w.api);
  assert.equal(w.html.dataset.aiFront, 'app');
  const mid = w.q('.aa-home');
  assert.equal(mid.tagName, 'BUTTON'); assert.equal(mid.getAttribute('type'), 'button'); assert.equal(mid.getAttribute('aria-label'), 'Home');
  mid.dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.st.newChats, 1, 'Home (a New chat) from inside Music');
  w.st.route = { home: false, view: 'thread', thread: 't9', desk: 1, app: 'chats' }; w.emit('route', w.st.route);
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.html.dataset.aaDrawer, 'open');
  mid.dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.st.newChats, 2, 'from a thread too'); assert.equal(w.html.dataset.aaDrawer, undefined, 'the drawer closes');
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click')); w.q('.aa-new').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.st.newChats, 3, "the drawer's round + is the same Home");
  assert.deepEqual(w.st.swipes, { up: 'new', side: null, down: null }, 'round 5: a swipe up on the orb = a New chat with the keyboard up');
});

test('round 4: the composer: no voice button of its own (the orb talks), the mic stays, Send only with words', async () => {
  const w = world();
  (await layout()).default(w.api);
  const form = new El('form'); form.className = 'ch-compose'; const row2 = new El('div'); row2.className = 'ch-row2'; const send = new El('button'); send.className = 'ch-send';
  form.append(row2); row2.append(send); w.device.append(form);
  const e = w.fire('pointerdown', send, { pointerId: 11 });
  assert.ok(!e.defaultPrevented); assert.deepEqual(w.st.orbDown, [], 'an empty composer never hands a press to the orb');
  const c = w.fire('click', send, { detail: 1 }); assert.ok(!c.defaultPrevented);
  const js = noComments(read('web/layouts/ai-apps/layout.js'));
  assert.ok(!/new PointerEvent|api\.voice\.tap|Talk to /.test(js), 'no forwarding to the orb, no voice label on Send');
  const css = read('web/layouts/ai-apps/layout.css');
  // the real layout.css on the composer inside a Chats window (a skeleton of Chats' markup)
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  const chatsWin = node('div', 'win app-chats', w.device), mic = node('button', 'ch-mic', row2); chatsWin.append(form);
  const shown = n => { const c = cascade(n, css).display; return c?.value === 'none' && c.important ? 'hidden' : 'shown'; };
  assert.equal(shown(send), 'hidden', 'the round Send is hidden with no words');
  form.classList.add('has-text'); assert.equal(shown(send), 'shown', 'Send shows with words'); form.classList.remove('has-text');
  assert.ok(!/:not\(\.has-text\) \.ch-row2 > \.ch-send::before/.test(css), 'no voice-wave mark on an empty Send');
  // round 6 (Miguel): the orb replaces the microphone: the composer's mic gives way and the orb takes its slot; the orb
  // no longer steps aside while typing (it stays in the composer, Send to its right, like ChatGPT's mic + send)
  assert.equal(shown(mic), 'hidden', 'the mic gives way to the orb');
  assert.ok(!/textarea:focus\) #device[^{]*#dock \{ opacity: 0/.test(css), 'the orb stays while typing');
});

test('core hooks: the phone adapter lists chats with Chats\' own actions and acts through Chats; the layout API passes only known actions', () => {
  const appJs = read('web/app.js');
  const fn = appJs.match(/sessionList: (\(\) => window\.WizChatsListModel\.sessionList\([^\n]+\)),\n    sessionAct/)[1];
  const s = (id, extra = {}) => ({ id, title: id.toUpperCase(), status: 'completed', ...extra });
  const LIVE = { ok: true, workGroups: () => ({ working: [s('w')], ready: [s('r'), s('n')], archive: [s('a')] }), isNew: x => x.id === 'n', cardAt: () => '' };
  const CHATS = { threadActions: x => x.id === 'w' ? [] : x.id === 'a' ? ['restore', 'snooze'] : ['snooze', 'stop_watch', 'done'] };
  const out = runWithChatsModel(`(${fn})()`, { LIVE, CHATS, window: { WosChatPins: { has: id => id === 'r' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(out.working[0].actions)), ['pin', 'rename']);
  assert.deepEqual(JSON.parse(JSON.stringify(out.ready.map(r => [r.id, r.pinned, r.unread, r.actions]))), [['r', true, false, ['pin', 'rename', 'unread', 'snooze', 'done']], ['n', false, true, ['pin', 'rename', 'snooze', 'done']]]);
  assert.deepEqual(JSON.parse(JSON.stringify(out.archive[0].actions)), ['pin', 'rename', 'restore', 'snooze']);
  const act = appJs.match(/sessionAct: (\(sid, act\) => \{[\s\S]*?\n    \}),\n    showChats/)[1];
  const calls = [], ctx = { window: { WosChatPins: { toggle: () => true } }, toast: (...a) => calls.push(['toast', a[1]]), showChats: () => ({ id: 'c1' }),
    CHATS: { openRenameSheet: (w, id) => calls.push(['rename', w, id]), threadAct: (w, id, a) => calls.push(['act', w, id, a]) } };
  const run = runWithChatsModel(`(${act})`, ctx);
  run('s1', 'pin'); run('s1', 'rename'); run('s1', 'done'); run('s1', 'unread');
  assert.deepEqual(calls, [['toast', 'Pinned'], ['rename', 'c1', 's1'], ['act', 'c1', 's1', 'done'], ['act', 'c1', 's1', 'unread']]);
  // the adapter's showChats / newChat (app.js), run: the Chats window in front, a New chat in it only when there is one
  const hooks = win => runRecording(`this.h = {\n${between(appJs, '    showChats: () => ', '\n    chatChannelPost:').replace(/\n\s*\/\/[^\n]*$/, '')}\n};`, { showChats: () => win });
  const none = hooks(null), one = hooks({ id: 'c1' });
  assert.equal(none.h.showChats(), false); assert.equal(none.h.newChat(), false); assert.deepEqual(none.calls, []);
  assert.equal(one.h.showChats(), true); assert.equal(one.h.newChat(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(one.calls)), [['CHATS.openChat', 'c1', '__new__']], 'a New chat in the Chats window');
});

test('core hooks: the layout API passes only known session actions, chats / newChat while live, Settings by page id', async () => {
  const f = fixture({ shell: 'desktop' }), acts = [], pages = []; let shown = 0, fresh = 0;
  let api = null; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  Object.assign(f.adapter, { sessionAct: (id, a) => { acts.push([id, a]); return 1; }, showChats: () => ({ id: 'c' + ++shown }), newChat: () => ++fresh, openSettings: p => pages.push(p) });
  f.host.setStandardLayout('ai-apps'); await settle();
  assert.ok(api, 'the AI apps layout got its API');
  const known = ['snooze', 'done', 'unread', 'restore', 'pin', 'rename', 'move', 'markdone'];   // move: issue 1292, markdone: issue 1317
  for (const a of known) assert.equal(api.sessions.act('s1', a), true, a);
  for (const a of ['stop_watch', 'delete', 'constructor', '']) assert.equal(api.sessions.act('s1', a), false, `${a}: never reaches the shell`);
  assert.equal(api.sessions.act('', 'done'), false, 'a thread id is needed');
  assert.deepEqual(acts, known.map(a => ['s1', a]), 'known actions only, through the shell adapter');
  assert.equal(api.sessions.chats(), true); assert.equal(api.sessions.newChat(), true); assert.deepEqual([shown, fresh], [1, 1]);
  api.desk.settings('connections'); api.desk.settings('Bad page!'); api.desk.settings(7); api.desk.settings();
  assert.deepEqual(pages, ['connections', undefined, undefined, undefined], 'a page id, or Settings\' first page');
  f.host.setStandardLayout('classic'); await settle();
  assert.equal(api.sessions.chats(), false); assert.equal(api.sessions.newChat(), false); assert.equal(api.sessions.act('s1', 'done'), false, 'a disposed layout reaches nothing');
  api.desk.settings('look'); assert.deepEqual([shown, fresh, acts.length, pages.length], [1, 1, known.length, 4]);
});

test('core hooks: the workspaces this Wizard first, then the managed ones', () => {
  const host = withSkinHostParts(read('web/core/skin-host.js'));
  // workspaces: this Wizard first, then the managed ones from the devices registry
  const ws = host.match(/list: \(\) => \{\n          if \(!live\(\) \|\| !isDoc\) return \[\];([\s\S]*?)\n        \},\n        refresh/)[1];
  const list = runWithChatsModel(`(() => {${ws}})()`, { window: { WosResources: { state: { devices: { this: { wizard: 'Miguel' }, managed: [{ id: 'g', name: 'Carlos', org: 'Acme' }, null] } } }, WizConfig: { agent: () => 'Oscar', owner: () => 'Miguel' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(list)), [{ id: 'this', name: 'Miguel', org: '', current: true, owner: 'Miguel' }, { id: 'g', name: 'Carlos', org: 'Acme', current: false }]);
});

test('round 2 shapes: rounded like the native apps (measured), icon-only drawer foot, an icon grid for the open apps', async () => {
  // the real phone view, drawn by layout.js, styled by the real layout.css (tests/fixtures/mini-css.mjs)
  const w = world();
  (await layout()).default(w.api);
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  const css = read('web/layouts/ai-apps/layout.css');
  const st = (sel, ...props) => { const el = w.q(sel); assert.ok(el, `drawn: ${sel}`); const c = cascade(el, css); return props.map(p => c[p]?.value ?? '').join(' / '); };
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(cascade(w.q('.aa-tb'), css, { pseudo: '::before' })['border-radius']?.value, '50%', 'top-bar buttons are round discs (ChatGPT)');
  assert.equal(st('.aa-drawer', 'border-radius'), '0 16px 16px 0', 'the drawer\'s end corners (Claude, 16 dp)');
  assert.equal(st('.aa-row', 'border-radius'), '12px', 'row and selection pills (Claude, 11 dp)');
  assert.equal(st('.aa-search', 'height', 'border-radius'), '44px / 22px', 'search is a full pill');
  assert.equal(st('.aa-new', 'width', 'height', 'border-radius'), '56px / 56px / 50%', 'New chat = a big round +');
  assert.equal(st('.aa-set', 'width', 'height', 'border-radius'), '48px / 48px / 50%', 'Settings = a round cog');
  assert.equal(st('.aa-set', 'font-size') || 'icon only', 'icon only'); assert.equal(w.q('.aa-set').textContent, '', 'the drawer foot is icon-only');
  w.q('.aa-find').dispatchEvent(new FakePointerEvent('click'));
  const f = w.q('.aa-q'); f.value = 'mo'; f.dispatchEvent(new FakePointerEvent('input'));
  assert.equal(st('.aa-grid', 'grid-template-columns'), 'repeat(4, minmax(0, 1fr))', 'round 6: four a row, like the iPhone home screen');
  assert.equal(st('.aa-gt', 'width', 'height'), '64px / 64px', 'cells stay >= 44 px targets');
  assert.equal(st('.aa-tile', 'width', 'height', 'border-radius'), '64px / 64px / 15px', 'round 6: big app icons, rounded squares (≈ 23 %, the iPhone\'s)');
  w.q('.aa-cancel').dispatchEvent(new FakePointerEvent('click'));
  // a long press menu and a sheet
  const row = w.q('.aa-chat[data-sid="r2"]');
  row.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 3, clientX: 50, clientY: 300, button: 0 })); w.st.timers.find(t => t.ms === 450).fn();
  assert.equal(st('.aa-pop', 'border-radius'), '18px', 'menus (ChatGPT long-press menu, 16–18 dp)');
  assert.equal(w.qa('.aa-acct, .aa-av, .aa-more').length, 0, 'the avatar letter, the Settings word and "N more open" are gone');
  const card = new El('div'); card.className = 'aa-sh-card'; w.html.append(card);
  assert.equal(cascade(card, css)['border-radius']?.value, '28px 28px 0 0', 'sheets');
  // the shared app sheet (layouts/apps/chrome.css) matches
  const chrome = read('web/layouts/apps/chrome.css');
  w.q('.ah-plus').dispatchEvent(new FakePointerEvent('click'));
  const vc = cascade(w.q('.vc-sheet .vc-card'), chrome);
  assert.deepEqual(['max-height', 'border-radius'].map(k => vc[k]?.value), ['88%', '28px 28px 0 0'], 'the shared app sheet (the view\'s + picker) matches');
});

/* A swipe from the left of a chat is the drawer's alone (Miguel, 2 Nov 2026): it used to also run the thread swipe-back
 * (core/thread-swipe-back.js, touch events on the chat), which left the chat for a New chat under the drawer. Runs the
 * REAL swipe-back built-in beside the layout and feeds both the browser's event order: pointer, then touch; the
 * layout's listeners are on the document (capture), the swipe-back's on the chat, so a stopped touch never gets there. */
test('a swipe from the left of a chat opens the drawer and keeps the chat: the thread swipe-back never also runs', async () => {
  let sbSetup = null;
  globalThis.window = { ...(globalThis.window || {}), WosSkinHost: { builtin: (_n, fn) => { sbSetup = fn; } }, getSelection: () => '' };
  await import(new URL('web/core/thread-swipe-back.js', root).href);
  assert.equal(typeof sbSetup, 'function');
  for (const x0 of [30, 60, 150, 6, 20]) {
    const w = world({ route: { home: false, view: 'thread', thread: 't1', desk: 1, app: 'chats' } });
    const chats = new El('div'), thread = new El('div'), msgs = new El('div');
    thread.setAttribute('data-part', 'thread'); msgs.className = 'ch-msgs'; chats.append(thread); thread.append(msgs); w.device.append(chats);
    (await layout()).default(w.api);
    let backs = 0;
    sbSetup({ part: n => (n === 'thread' ? chats : null), route: () => ({ ...w.st.route }), env: { edgeInset: 24 },
      listen: (el, type, fn) => { el.addEventListener(type, fn); return () => {}; }, frame: fn => fn(0), on() {}, nav: { back: () => { backs++; return true; } } });
    assert.equal(w.html.dataset.aiFront, 'chat');
    const send = (type, x, y) => {
      const pt = { clientX: x, clientY: y, identifier: 0 };
      if (type.startsWith('pointer')) return w.fire(type, msgs, { pointerType: 'touch', pointerId: 31, clientX: x, clientY: y });
      const e = { type, target: msgs, cancelable: true, touches: type === 'touchend' ? [] : [pt], changedTouches: [pt], stopped: false,
        stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } };
      for (const fn of w.doc.__listeners?.[type] || []) fn(e);
      if (!e.stopped) msgs.dispatchEvent(e);
      return e;
    };
    const y = 400; let now = 0; const realNow = performance.now; performance.now = () => now;
    send('pointerdown', x0, y); send('touchstart', x0, y);
    for (let i = 1; i <= 10; i++) { now = i * 30; send('pointermove', x0 + 18 * i, y + i); send('touchmove', x0 + 18 * i, y + i); }
    send('pointerup', x0 + 180, y + 10); send('touchend', x0 + 180, y + 10);
    performance.now = realNow;
    assert.equal(backs, 0, `from x=${x0}: the thread swipe-back did not run (no step back to the list, no New chat)`);
    assert.equal(w.st.newChats, 0, `from x=${x0}: the chat stays`);
    assert.equal(w.html.dataset.aaDrawer, 'open', `from x=${x0}: the drawer opened`);
    assert.deepEqual(w.st.claims, [31], `from x=${x0}: the drawer claimed the finger (the dock swipe and row long-press stand down)`);
  }
  // still the swipe-back's own elsewhere: a vertical scroll is not the drawer's, and code keeps its sideways gesture
  const w = world({ route: { home: false, view: 'thread', thread: 't1', desk: 1, app: 'chats' } });
  (await layout()).default(w.api);
  const pre = new El('pre'); w.device.append(pre);
  const ev = (type, x, y, target) => { const pt = { clientX: x, clientY: y }; const e = { type, target, cancelable: true, touches: [pt], changedTouches: [pt], stopPropagation() { this.stopped = true; }, preventDefault() {} }; for (const fn of w.doc.__listeners?.[type] || []) fn(e); return e; };
  ev('touchstart', 150, 400, pre); assert.equal(ev('touchmove', 250, 402, pre).stopped, undefined, 'a code block keeps its sideways scroll');
  ev('touchstart', 150, 400, w.device); assert.equal(ev('touchmove', 152, 480, w.device).stopped, undefined, 'a vertical scroll is not the drawer\'s');
  assert.equal(w.html.dataset.aaDrawer, undefined);
});

/* Round 5 (Miguel, 2 Nov 2026): Wizard's own sections in place of Recents + View all (the drawer / sidebar IS the chat
 * list; Archive, Working, Ready in the stock Chats order, Ready open, Working and Archive folded, kept per device); a
 * home button in the top bar's middle; the workspace switcher only on Home; the Ready count on ☰ (none on the orb, no
 * moons); a swipe up on the orb = a New chat with the keyboard up. */
test('round 5: the drawer IS the chat list: Archive, Working, Ready sections that fold, kept on this device', async () => {
  const w = world();
  (await layout()).default(w.api);
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  const heads = () => w.qa('.aa-sec').map(h => `${h.textContent}:${h.getAttribute('aria-expanded')}`);
  assert.deepEqual(heads(), ['Working:false', 'Snoozed:false', 'Ready:true', 'Archive:false'], 'the stock Chats order (Archive last: James, 6 Nov 2026), round 13: Snoozed above Ready, Ready open at first');
  assert.ok(w.qa('.aa-sec').every(h => h.tagName === 'BUTTON' && h.classList.contains('aa-lab')), 'the Recents label\'s look, a button');
  assert.equal(w.qa('.aa-lab').filter(h => h.textContent === 'Recents').length, 0, 'no Recents');
  // Archive opens: its rows come from the real archive list (the trusted session hook), with Restore in their menu
  w.q('.aa-sec[data-sec="archive"]').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(heads(), ['Working:false', 'Snoozed:false', 'Ready:true', 'Archive:true']);
  assert.deepEqual(w.qa('.aa-chat').map(b => `${b.dataset.sid}:${b.dataset.kind}`), ['r1:ready', 'r2:ready', 'a1:archive']);
  assert.deepEqual(w.st.store.sections, { archive: true, working: false, snoozed: false, ready: true }, 'remembered on this device (api.storage)');
  w.q('.aa-sec[data-sec="ready"]').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.qa('.aa-chat').map(b => b.dataset.sid), ['a1'], 'Ready folds too');
  const a1 = w.q('.aa-chat[data-sid="a1"]');
  a1.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 9, button: 0 })); w.st.timers.filter(t => t.ms === 450).at(-1).fn();
  assert.deepEqual(w.qa('.aa-pop-i').map(b => b.dataset.act), ['pin', 'rename', 'snooze', 'restore'], 'the same row menu, Restore for an archived chat');
  // a fresh layout on this device reads the stored choice
  const w2 = world(); w2.st.store.sections = { archive: true, working: true, ready: false };
  (await layout()).default(w2.api); w2.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w2.qa('.aa-sec').map(h => h.getAttribute('aria-expanded')), ['true', 'false', 'false', 'true']);
  assert.deepEqual(w2.qa('.aa-chat').map(b => b.dataset.sid), ['w1', 'a1']);
  // Miguel's "Archive on top" tweak is the only way to put Archive first in the phone drawer
  const w3 = world(); w3.html.dataset.tweaks = 'wizard/unified-inbox miguel/archive-top';
  (await layout()).default(w3.api); w3.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w3.qa('.aa-sec').map(h => h.textContent), ['Archive', 'Working', 'Snoozed', 'Ready'], 'archive-top: Archive first');
  const { SECTIONS, sectionsOpen } = await import(new URL('web/layouts/ai-apps/parts.js', root).href);
  assert.deepEqual(SECTIONS.map(x => x[0]), ['working', 'snoozed', 'ready', 'archive']);
  assert.deepEqual(sectionsOpen(null), { archive: false, working: false, snoozed: false, ready: true }, 'Snoozed folded at first');
  assert.deepEqual(sectionsOpen({ ready: 'x', archive: true }), { archive: true, working: false, snoozed: false, ready: true }, 'only booleans are taken');
});

test('round 5: home button in the middle, the switcher on Home only, the Ready count on ☰ (none on the orb), swipe up types', async () => {
  const w = world({ route: { home: false, view: 'thread', thread: 't9', desk: 1, app: 'chats' } });
  (await layout()).default(w.api);
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  w.q('.aa-dws').dispatchEvent(new FakePointerEvent('click')); assert.ok(w.q('.aa-sheet'), 'the drawer header opens the switcher sheet');
  assert.equal(w.html.dataset.aaDrawer, undefined, 'over the page, the drawer closed');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 3, app: 'music' }; w.emit('route', w.st.route);
  assert.equal(w.q('.aa-sheet'), null, 'an app: its sheet closes');
  w.q('.aa-home').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.newChats, 1, 'the home button: Home');
  const css = read('web/layouts/ai-apps/layout.css');
  // the real layout.css on what the view drew and on the shell's dock orb (#dock > #orbBadge, #moons)
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  const dockN = node('div', '', w.device); dockN.id = 'dock';
  for (const id of ['orbBadge', 'moons']) { const n = node('span', '', dockN); n.id = id; const d = cascade(n, css).display; assert.deepEqual([d?.value, d?.important], ['none', true], `no count and no moons on the orb: #${id}`); }
  const home = cascade(w.q('.aa-home'), css);
  assert.deepEqual(['position', 'width', 'height'].map(k => home[k]?.value), ['relative', '48px', '48px'], 'the home button is a 48 px target (>= 44)');
  assert.equal(cascade(w.q('.aa-menu .aa-count'), css).background?.value, 'var(--amber, var(--aa-ink))', 'the Ready count in Chats\' amber');
  assert.ok(!/\.aa-viewall|\.aa-dot \{|\.aa-mid \{/.test(css), 'View all, the bare dot and the name are gone');
  // the dock orb's swipe up: a New chat with the cursor in its composer, focused within the swipe (the keyboard comes up)
  const appJs = read('web/app.js'), host = withSkinHostParts(read('web/core/skin-host.js'));
  const fn = block(appJs, '  function orbSwipeNew() {');
  const swipeNew = win => {
    const calls = [], focused = [], ta = { value: 'hi', focus: o => focused.push(o), setSelectionRange: (a, b) => calls.push([a, b]) };
    const ctx = { sheet: null, closeSheets() {}, pillOvOpen: () => false, closeOverview() {}, showChats: () => win, CHATS: { openChat: (id, t) => calls.push([id, t]) }, winEl: id => ({ querySelector: q => (id === 'c1' && q === '.ch-compose textarea' ? ta : null) }) };
    runWithChatsModel(fn + '; orbSwipeNew();', ctx); return { calls, focused: JSON.stringify(focused) };
  };
  assert.deepEqual(swipeNew({ id: 'c1' }), { calls: [['c1', '__new__'], [2, 2]], focused: '[{"preventScroll":true}]' }, 'a New chat, the cursor at the end of its composer');
  assert.deepEqual(swipeNew(null), { calls: [], focused: '[]' }, 'no Chats window: nothing');
  // the host's swipe map (api.phone.swipes): up may be Home or a New chat, the rest only the stock swipe or nothing
  const swipeMap = m => JSON.parse(JSON.stringify(runRecording(`${between(host, '  const ORB_SWIPE_ACTS = ', ';\n')};\n${block(host, '  function orbSwipeMap(map) {')}\nthis.map = orbSwipeMap;`, {}).map(m)));
  assert.deepEqual(swipeMap({ up: 'new', side: null, down: null }), { up: 'new', side: null, down: null }, 'the view\'s own map');
  assert.deepEqual(swipeMap({ up: 'home', side: 'home', down: 'new' }), { up: 'home', side: null, down: null }, 'only up may go somewhere');
  assert.deepEqual(swipeMap({ up: 'launch', side: 'stock' }), { up: null }, 'an unknown action is nothing; stock is left to the dock');
});

test('round 5 + 7 desktop: no home button in the top row (round 7), the switcher on Home only, the sections, the count on ◫', async () => {
  // the real desktop view (deskWorld): what the top row and the sidebar header hold, in order
  const { w } = deskWorld();
  (await layout()).default(w.api);
  assert.equal(w.qa('.aad-home').length, 0, 'round 7: the top row has no home button (Home = its tab, +, ⌥1)');
  assert.equal(w.qa('.aad-tname, .aad-viewall').length, 0, 'the name in the top row and View all are gone');
  assert.deepEqual(w.q('.aad-top').children.map(e => e.className), ['aad-ctop', 'aad-ptop'], 'round 15: no tab strip; the docked chat\'s title and the app panel\'s header');
  assert.deepEqual(w.q('.aad-sh').children.map(e => e.className.split(' ').at(-1)), ['aad-ws', 'aad-find', 'aad-search', 'aad-cancel', 'aad-sswap', 'aad-tog'], 'round 7: the switcher is the sidebar header; round 16: no ⌂');
  assert.match(w.q('.aad-orbbtn').getAttribute('aria-label'), /drag up for a new chat to type in/);
  const css = read('web/layouts/ai-apps/desktop.css'), js = noComments(read('web/layouts/ai-apps/desktop.js'));
  assert.ok(!/\.aad-home\b|\btHome\b/.test(css + js) && !/aad-tname|aad-viewall/.test(css), 'and no styles or code left for them');
});
test('round 5: notifications in the list: Chats\' own items as plain rows with a small bell, their actions kept', async () => {
  // the layout: a notification row = the same row shape, a bell before the title, no card; its menu = the inbox's actions
  const w = world();
  w.st.sessions.ready.unshift({ id: 'notif:n1', title: 'Card payment due', kind: 'ready', note: true, app: 'money', unread: true, snoozed: false, pinned: false, actions: ['snooze', 'done'] });
  w.st.sessions.ready.push({ id: 'notif:n2', title: 'Backup finished', kind: 'ready', note: true, app: '', unread: false, snoozed: true, pinned: false, actions: ['restore', 'done'] });
  (await layout()).default(w.api);
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  const n1 = w.q('.aa-chat[data-sid="notif:n1"]');
  assert.ok(n1 && n1.classList.contains('aa-row'), 'the same row as a chat');
  assert.deepEqual(n1.children.map(c => c.className.split(' ').pop()), ['aa-bell', 'aa-row-t', 'is-new'], 'a bell before the title, the new dot at the end');
  assert.match(n1.getAttribute('aria-label'), /^Notification: Card payment due, ready, new$/);
  assert.deepEqual(w.qa('.aa-chat').map(b => b.dataset.sid), ['notif:n1', 'r1', 'r2', 'notif:n2'], 'in Ready, Chats\' order (snoozed last)');
  n1.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 12, button: 0 })); w.st.timers.filter(t => t.ms === 450).at(-1).fn();
  assert.deepEqual(w.qa('.aa-pop-i').map(b => b.textContent), ['Snooze', 'Archive']);
  const realNow = Date.now; Date.now = () => realNow() + 2000;
  try {
    w.q('.aa-pop-i[data-act="done"]').dispatchEvent(new FakePointerEvent('click'));
    assert.deepEqual(w.st.acts.at(-1), ['notif:n1', 'done']);
    w.q('.aa-chat[data-sid="notif:n2"]').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.opened.at(-1), 'thread:notif:n2', 'a tap opens it');
  } finally { Date.now = realNow; }
  const phoneCss = read('web/layouts/ai-apps/layout.css'), css = phoneCss + read('web/layouts/ai-apps/desktop.css');
  assert.ok(!/\.aad?-bell[^{]*\{[^}]*(yellow|background)/.test(css), 'no card');
  // round 20 item 6 (Miguel): a notification row stands out, subtly: an amber bell and an amber unread dot, nothing else;
  // the real layout.css / desktop.css on the rows the real views drew
  const AMBER = 'var(--amber, var(--wz-warning))';
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  const bell = w.q('.aa-chat[data-sid="notif:n2"] .aa-bell');
  assert.equal(cascade(bell, phoneCss).color?.value, AMBER, 'phone: an amber bell');
  delete bell.parentNode.dataset.note; assert.equal(cascade(bell, phoneCss).color?.value, 'var(--aa-ink-2)', 'phone: the bell itself in the quiet ink');
  const { w: d } = deskWorld();
  d.st.sessions.ready.unshift({ id: 'notif:n1', title: 'Card payment due', kind: 'ready', note: true, app: 'money', unread: true, snoozed: false, pinned: false, actions: ['snooze', 'done'] });
  d.html.setAttribute('data-shell', 'desktop'); d.html.setAttribute('data-layout', 'ai-apps');
  (await layout()).default(d.api);
  const drow = d.q('.aad-rw[data-sid="notif:n1"]'), dst = k => cascade(drow.querySelector(k), DESK_CSS);
  assert.equal(dst('.aad-bell').color?.value, AMBER, 'desktop: an amber bell'); assert.equal(dst('.aad-st.is-new').background?.value, AMBER, 'and an amber unread dot');
  assert.equal(cascade(d.q('.aad-rw[data-sid="r1"] .aad-st.is-new'), DESK_CSS).background?.value, 'var(--wz-accent, var(--aad-ink))', 'a chat\'s dot stays the accent');
  delete drow.dataset.note; assert.equal(dst('.aad-bell').color?.value, 'var(--aad-ink-2)', 'desktop: the bell itself in the quiet ink');
  d.q('.aad-tog').dispatchEvent(new FakePointerEvent('click')); d.st.timers.length = 0;
  d.q('.aad-rk[data-k="ready"]').dispatchEvent(new FakePointerEvent('pointerenter')); d.st.timers.find(h => h.ms === 300).fn();
  assert.equal(cascade(d.q('.aad-fly-i[data-sid="notif:n1"] .aad-bell'), DESK_CSS).color?.value, AMBER, 'the rail\'s flyout: the amber bell too');
  // the shell side: sessions.list() adds the inbox's items (while a package lists them), open / act go to its handler
  const host = withSkinHostParts(read('web/core/skin-host.js'));
  const src = host.match(/  const NOTE_ID = [\s\S]*?\n  function inboxAct\(action, id\) \{[^\n]*\n/)[0];
  const calls = [], items = [{ id: 'a', title: '**Pay** card', time: 300, read: false, app: 'money', priority: 4 }, { id: 'b', message: 'Backup done\nok', time: 100, read: true }, { id: 'c', title: 'old', time: 50, archived: true }];
  const ctx = { isDoc: true, window: { WosBell: { items: () => items } }, inboxThreads: new Map([['wizard/unified-inbox', { list: true, act: (a, i) => calls.push([a, i]) }]]) };
  runWithChatsModel(src + ';globalThis.withNoteRows = withNoteRows; globalThis.inboxAct = inboxAct;', ctx);
  const rows = JSON.parse(JSON.stringify(ctx.withNoteRows([{ id: 'r9', at: new Date(200000).toISOString() }])));
  assert.deepEqual(rows.map(r => r.id), ['notif:a', 'r9', 'notif:b'], 'new ones among the chats by time, snoozed last, archived left out');
  assert.deepEqual([rows[0].title, rows[0].note, rows[0].unread, rows[0].actions, rows[2].title, rows[2].actions], ['money · Pay card', true, true, ['snooze', 'done'], 'Wizard · Backup done', ['restore', 'done']], 'each row names where it came from');
  ctx.inboxAct('open', 'a'); assert.deepEqual(calls, [['open', 'a']]);
  // One row per app (Miguel, 3 Nov 2026): 2+ waiting from one app fold, newest first; needs-you (4+) never folds;
  // the fold's Archive covers every item in it.
  const marks = []; items.push({ id: 'm1', title: 'Grab', time: 400, app: 'money', appName: 'Money', priority: 3 }, { id: 'm2', title: 'Villa', time: 500, app: 'money', appName: 'Money', priority: 3 }, { id: 'm3', title: 'Apple', time: 450, app: 'money', appName: 'Money', priority: 3 });
  ctx.window.WosBell.mark = (ids, m) => { marks.push([[...ids], { ...m }]); return Promise.resolve(true); };
  const folded = JSON.parse(JSON.stringify(ctx.withNoteRows([])));
  const f = folded.find(r => r.count === 3);
  assert.ok(f && f.id === 'notif:m2' && f.title === 'Money (3) · Villa · Apple · Grab', 'Money is one row: name, count, newest titles');
  assert.ok(folded.some(r => r.id === 'notif:a' && r.count === 1), 'priority 4 keeps its own row');
  runWithChatsModel('globalThis.noteAct = noteAct;', ctx); ctx.noteAct('notif:m2', 'done');
  assert.deepEqual(marks.at(-1), [['m2', 'm3', 'm1'], { 'read': true, archived: true }]);
  // the layout API's sessions.open / act, run: a notification row goes to the inbox's handler, a chat to the shell
  const sess = runRecording(`${between(host, '  const NOTE_ID = ', ';\n')};\nthis.s = {\n${between(block(host, '  function shellApi(a, base) {'), '        open: id => {', '\n        openList:')}\n};`,
    { live: () => true, SESSION_ACTS: ['done'], noteAct: (...a) => { sess.calls.push(['noteAct', ...a]); return true; }, calls: [] });
  sess.s.open('notif:n7'); sess.s.open('t3'); sess.s.open(''); assert.equal(sess.s.act('notif:n7', 'done'), true); assert.equal(sess.s.act('notif:n7', 'rename'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(sess.calls)), [['inboxAct', 'open', 'n7'], ['shell.openThread', 't3'], ['noteAct', 'notif:n7', 'done']], 'open: the inbox\'s own open; act: only the inbox\'s actions');
  // the picked place stays readable in the phone action row (the real layout.css on a skeleton of Chats' notification thread)
  const route = ['div win app-chats', 'div ch-notif-thread', 'div ch-tacts', 'div ch-notif-route', 'div wos-route', 'button'].reduce((p, t) => node(t.split(' ')[0], t.split(' ').slice(1).join(' '), p), w.device);
  route.setAttribute('aria-checked', 'true');
  const picked = cascade(route, phoneCss);
  assert.deepEqual(['background', 'color'].map(k => [picked[k]?.value, picked[k]?.important]), [['var(--wz-accent)', true], ['var(--wz-base)', true]], 'the picked place stays readable in the phone action row');
  ctx.inboxThreads.get('wizard/unified-inbox').list = false;
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.withNoteRows([]))), [], 'none while no package lists the inbox in Chats');
});

/* Round 6 (Miguel, 2 Nov 2026): big icons for real apps only; the orb IS the microphone (inside the composer in the
 * mic's slot, a small mic on it everywhere); a compact spot for the orb in an app's own bottom row; a tidy composer
 * (the model chip a control on the right, never a centred label on its own row; Snooze / Archive never half-hidden). */
test('round 6: the drawer grid lists real apps only (the sheet\'s Apps), never agent apps, connectors, system or in-development apps', async () => {
  const w = world();
  w.api.apps.kinds = () => ({ apps: [{ id: 'mail', name: 'Mail' }, { id: 'money', name: 'Money' }, { id: 'movies', name: 'Movies' }, { id: 'maps', name: 'Maps', system: true }], wiz: [{ id: 'notes', name: 'Notes' }], agents: [], conns: [], dev: [{ id: 'music', name: 'Music' }] });
  (await layout()).default(w.api);
  assert.deepEqual(w.q('.ah-grid').children.map(b => b.dataset.app || (b.classList.contains('ah-tidy') ? 'tidy' : '+')), ['notes', 'maps', '+', 'tidy'], 'round 19 item 4: the open apps not pinned (any kind: they are open), then +; his pins in the dock');
  const { homeApps } = await import(new URL('web/layouts/ai-apps/home.js', root).href);
  assert.deepEqual(homeApps([{ id: 'mail', name: 'Mail' }, { id: 'money', name: 'Money' }, { id: 'notes', name: 'Notes' }, { id: 'music', name: 'Music' }], [{ desk: 1, id: 'wizard', name: 'Chats' }, { desk: 2, id: 'mail', name: 'Mail' }], w.api.apps.kinds(), () => false).rest.map(a => a.id),
    ['money', 'movies'], 'not open: Notes (agent app), Music (in development) and Maps (system) stay out');
  const { realApps } = await import(new URL('web/layouts/apps/chrome.js', root).href);
  assert.deepEqual(realApps([{ id: 'a' }, { id: 'b', connector: true }, { id: 'c', dev: true }, { id: 'd', system: true }], null).map(a => a.id), ['a'], 'without kinds: the flags');
  // (the desktop + = the shared picker with open and pinned apps: 'desktop: a sidebar ...' and 'round 16 item 7: layer membership ...')
  // a logo fills its tile: no plate (the real layout.css / desktop.css on the tiles the real views drew, a logo loaded)
  const css = read('web/layouts/ai-apps/layout.css');
  const p = world(); p.api.apps.logo = id => Promise.resolve(id === 'money' ? '/wizard-os-home/store-data/app-logo/money?v=0123456789abcdef' : null);
  p.html.setAttribute('data-shell', 'phone'); p.html.setAttribute('data-layout', 'ai-apps');
  (await layout()).default(p.api);
  p.q('.aa-menu').dispatchEvent(new FakePointerEvent('click')); p.q('.aa-find').dispatchEvent(new FakePointerEvent('click'));
  const q = p.q('.aa-q'); q.value = 'mo'; q.dispatchEvent(new FakePointerEvent('input')); await settle();
  const tile = p.q('.aa-tile.is-logo'), plain = p.qa('.aa-tile').find(t => !t.classList.contains('is-logo'));
  assert.ok(tile && plain, 'one logo tile, the rest sigils');
  const tc = cascade(tile, css), lc = cascade(tile.querySelector('.aa-logo'), css);
  assert.deepEqual([tc.background?.value, tc['box-shadow']?.value.startsWith('0 1px 3px')], ['none', true], 'a logo fills its tile: no plate');
  assert.notEqual(cascade(plain, css).background?.value, 'none', 'a sigil keeps its tinted tile');
  assert.deepEqual(['width', 'height', 'object-fit'].map(k => lc[k]?.value), ['100%', '100%', 'cover']);
  // the desktop: an app opening (not open yet) shows its icon in the app panel's placeholder
  const { w: d } = await panelDesk({ before: ({ w, store }) => { store.pins = ['movies']; w.api.apps.logo = id => Promise.resolve(id === 'movies' ? '/wizard-os-home/store-data/app-logo/movies?v=0123456789abcdef' : null); } });
  d.q('.aad-vtab.is-closed[data-app="movies"]').dispatchEvent(new FakePointerEvent('click'));   // a pin not open yet: it opens as the panel
  const dtile = d.q('.aad-pload .aad-tile'), before = cascade(dtile, DESK_CSS);
  assert.deepEqual(['width', 'height'].map(k => before[k]?.value), ['52px', '52px'], 'desktop: a 52 px icon');
  assert.notEqual(before.background?.value, 'none', 'its tinted tile until the logo loads');
  await settle(); assert.ok(dtile.classList.contains('is-logo'), 'the logo loaded');
  assert.equal(cascade(dtile, DESK_CSS).background?.value, 'none', 'desktop: a logo is the icon, no plate');
});

test('round 6: the orb moves to the spot it is given (an app\'s row) and back; its own spot reads through the move', async () => {
  const w = world();
  let place = null, home = null;
  w.api.apps.inset = (px, orb, pl) => { home = orb; place = pl; return () => {}; };
  // the real browser: the orb's box includes the move (translate), its size does not (offsetWidth)
  const st = w.html.style;
  w.orbWrap.getBoundingClientRect = () => { const dx = parseFloat(st.getPropertyValue('--vc-orb-dx')) || 0, dy = parseFloat(st.getPropertyValue('--vc-orb-dy')) || 0; return { left: 162 + dx, top: 773 + dy, width: 66, height: 66, x: 162 + dx, y: 773 + dy, right: 228 + dx, bottom: 839 + dy }; };
  w.orbWrap.offsetWidth = 66;
  (await layout()).default(w.api);
  assert.equal(typeof place, 'function', 'the view hears where the app in front wants the orb');
  assert.ok(w.orbWrap.children.some(c => c.className === 'vc-mic'), 'the orb wears a small microphone');
  place({ x: 356, y: 790, d: 44 });
  assert.equal(w.html.dataset.vcOrb, 'row');
  assert.equal(st.getPropertyValue('--vc-orb-dx'), '161px'); assert.equal(st.getPropertyValue('--vc-orb-dy'), '-16px'); assert.equal(st.getPropertyValue('--vc-orb-k'), '0.667');
  assert.deepEqual(home(), { x: 195, y: 806, d: 66 }, 'the bars still go around its own spot');
  // the real chrome.css on the shell's dock orb (#dock > #orbWrap) while it is moved, and on its microphone
  const css = read('web/layouts/apps/chrome.css'), MOVE = ['var(--vc-orb-dx, 0px) var(--vc-orb-dy, 0px)', 'var(--vc-orb-k, 1)'];
  w.orbWrap.id = 'orbWrap'; w.orbWrap.parentNode.id = 'dock';
  const moved = n => { const c = cascade(n, css); return [c.translate?.value, c.scale?.value]; };
  assert.deepEqual(moved(w.orbWrap), MOVE, 'the dock orb is drawn where the move puts it, at its size');
  const mic = w.orbWrap.children.find(c => c.className === 'vc-mic'), micOn = () => cascade(mic, css).opacity?.value ?? '1';
  w.orbWrap.dataset.mode = 'idle'; assert.equal(micOn(), '1');
  w.orbWrap.dataset.mode = 'listening'; assert.equal(micOn(), '0', 'a take shows the orb\'s own state');
  place(null);
  assert.equal(w.html.dataset.vcOrb, undefined); assert.equal(st.getPropertyValue('--vc-orb-dx'), '', 'back to its own spot');
  assert.deepEqual(moved(w.orbWrap), [undefined, undefined], 'no move left on it');
  // the desktop orb moves the same way (the real desktop view and desktop.css)
  let dplace = null;
  const { w: d } = await panelDesk({ before: ({ w }) => { w.api.apps.inset = (px, orb, pl) => { dplace = pl; return () => {}; }; } });
  assert.equal(typeof dplace, 'function');
  const dmoved = () => { const c = cascade(d.q('.aad-orb'), DESK_CSS); return [c.translate?.value, c.scale?.value]; };
  assert.deepEqual(dmoved(), [undefined, undefined]);
  dplace({ x: 900, y: 700, d: 40 }); assert.equal(d.html.dataset.vcOrb, 'row');
  assert.deepEqual(dmoved(), MOVE, 'the desktop orb moves the same way');
});

test('round 6: the composer\'s orb slot is read from the grid\'s real tracks (one line, or words over the controls)', async () => {
  const { gridSlot } = await import(new URL('web/layouts/ai-apps/parts.js', root).href);
  const row = (cols, rows) => ({ ownerDocument: { defaultView: { getComputedStyle: () => ({ gridTemplateColumns: cols, gridTemplateRows: rows, columnGap: '0px', rowGap: 'normal', paddingLeft: '4px', paddingTop: '4px', borderLeftWidth: '0px', borderTopWidth: '0px' }) } },
    getBoundingClientRect: () => ({ left: 12, top: 780, width: 366, height: 52 }) });
  assert.deepEqual(gridSlot(row('44px 203px 67px 44px 0px 0px', '44px'), 3), { x: 12 + 4 + 44 + 203 + 67 + 22, y: 780 + 4 + 22, d: 44 }, 'one line: right of the model chip');
  assert.deepEqual(gridSlot(row('44px 170px 56px 44px 0px 44px', '40px 44px'), 3), { x: 12 + 4 + 44 + 170 + 56 + 22, y: 780 + 4 + 40 + 22, d: 44 }, 'two lines: on the controls\' line, Send to its right');
  assert.equal(gridSlot(row('none', 'none'), 3), null, 'not a grid: no slot');
  // the real phone view: the dock orb moves into the composer's slot (read from its grid), and back during a take
  // (the orb's microphone, micGlyph: 'round 6: the orb moves to the spot it is given ...')
  const had = globalThis.innerWidth; globalThis.innerWidth = 390;
  try {
    const w = world(), st = w.html.style; let voice = 'idle';
    w.orbWrap.getBoundingClientRect = () => { const dx = parseFloat(st.getPropertyValue('--vc-orb-dx')) || 0, dy = parseFloat(st.getPropertyValue('--vc-orb-dy')) || 0; return { left: 162 + dx, top: 773 + dy, width: 66, height: 66, x: 162 + dx, y: 773 + dy, right: 228 + dx, bottom: 839 + dy }; };
    w.orbWrap.offsetWidth = 66; w.api.voice.state = () => ({ state: voice });
    (await layout()).default(w.api);
    const win = node('div', 'win app-chats', w.device), form = node('form', 'ch-compose', win), r2 = Object.assign(node('div', 'ch-row2', form), row('44px 203px 67px 44px 0px 0px', '44px')), ta = node('textarea', '', r2);
    assert.equal(w.html.dataset.aiFront, 'chat');
    w.fire('input', ta);
    assert.equal(w.html.dataset.vcOrb, 'composer', 'the orb sits in the composer');
    assert.deepEqual(['--vc-orb-dx', '--vc-orb-dy', '--vc-orb-k'].map(k => st.getPropertyValue(k)), ['157px', '0px', '0.667'], 'in the mic\'s slot, right of the model chip, at its size');
    voice = 'recording'; w.fire('input', ta);
    assert.equal(w.html.dataset.vcOrb, undefined, 'a take: the orb back in its own spot, among the stock voice controls');
    voice = 'idle'; w.fire('input', ta); assert.equal(w.html.dataset.vcOrb, 'composer');
  } finally { if (had === undefined) delete globalThis.innerWidth; else globalThis.innerWidth = had; }
});

test('round 6: a tidy composer: the model chip is a control on the right (never a centred label), the orb in the mic\'s slot, Snooze / Archive never clipped', () => {
  // each shell's real stylesheet on a Chats composer shaped like the one Chats draws (tests/fixtures/mini-css.mjs)
  for (const [file, shell, slot] of [['web/layouts/ai-apps/layout.css', 'phone', '44px'], ['web/layouts/ai-apps/desktop.css', 'desktop', '40px']]) {
    const css = read(file), doc = createDocument();
    doc.documentElement.setAttribute('data-shell', shell); doc.documentElement.setAttribute('data-layout', 'ai-apps');
    doc.body.innerHTML = '<div class="win app-chats"><div class="dchats"><div class="pane-main"><div class="ch-thread"><div class="ch-msgs"><div class="ch-tacts"></div></div><div class="ch-latest"></div>'
      + '<form class="ch-compose"><div class="ch-row2"><div class="ch-field"><span class="ch-mlabel"></span></div><button class="ch-mic"></button><button class="ch-send"></button></div></form></div></div></div></div>';
    const st = (sel, opts) => { const el = doc.querySelector(sel); assert.ok(el, sel); const c = cascade(el, css, opts); return k => c[k]?.value ?? ''; };
    let r = st('.ch-row2');
    assert.deepEqual([r('display'), r('grid-template-columns'), r('grid-template-areas')], ['grid', `auto minmax(0, 1fr) auto ${slot} auto auto`, '"att field chip orb stop send"'], `${file}: one line: + · words · chip · orb`);
    doc.querySelector('.ch-compose').classList.add('has-text');
    assert.equal(st('.ch-row2')('grid-template-areas'), '"field field field field field field" "att . chip orb stop send"', `${file}: with words: the words on top, the controls under them, chip · orb · Send on the right`);
    assert.equal(st('.ch-field')('display'), 'contents', `${file}: the field's box steps aside, so the chip is a control of the row`);
    r = st('.ch-mlabel'); assert.deepEqual([r('grid-area'), r('position'), r('justify-self')], ['chip', 'static', 'end'], `${file}: the chip in its column on the right`);
    assert.equal(st('.ch-row2', { pseudo: '::after' })('grid-area'), 'orb', `${file}: the orb's slot`);
    assert.equal(st('.ch-mic')('display'), 'none', `${file}: the orb replaces the mic`);
    r = st('.ch-tacts'); assert.deepEqual([r('position'), r('bottom')], ['sticky', '0'], `${file}: Snooze / Archive: a row right above the composer, never half under it`);
    r = st('.ch-latest'); assert.equal(r('position'), 'relative'); assert.equal(r('inset'), 'auto');
    assert.match(r('margin'), /^(?:calc\()?-46px/, `${file}: ↓ Latest just above the composer, never on it`);
  }
});

/* Round 7 (Miguel, 2 Nov 2026, desktop): an app opens as a panel on the RIGHT (about a third) with the chat in the
 * middle (the Orb desktop's thirds), a thread slides in from the left, calm slide + fade, the open app lit in the grid,
 * Esc / ✕ close it; the AI fuel gauge at the top of the sidebar; no home button in the top row. */
test('round 7 + 15 desktop: the app panel and the docked chat are back (Arc), calm transitions, the fuel gauge in the sidebar, the orb in the middle of the main area', async () => {
  const p = await panelDesk(), { w, style } = p, H = w.html.dataset;
  assert.equal(w.q('.aad-strip'), null, 'round 15: no tab strip'); assert.equal(w.q('.aad-tplus'), null, 'no New tab +');
  assert.ok(w.q('.aad-pload'), 'the app panel\'s loading placeholder is drawn'); assert.equal(w.q('.aad-pload').hidden, true, 'hidden until an app loads');
  assert.equal(style(p.gauge)('display'), 'none', 'round 8: one fuel gauge, the sidebar foot\'s (the bar\'s is hidden)'); assert.ok(p.important(p.gauge, 'display'));
  assert.ok(w.q('.aad-foot .aad-fuel'), 'the gauge in the sidebar foot');
  const orb = () => style(w.q('.aad-orb'))('left');
  // an app in front: the panel on the right; its width is what the orb centres against
  p.go({ view: 'desk', desk: 4 });
  assert.equal(H.aadSplit, 'on', 'the app panel'); assert.equal(p.appDesk.dataset.aadRole, 'app');
  assert.equal(w.q('.aad-ptop').hidden, false, 'its header'); assert.equal(w.q('.aad-ptop').parentNode, p.appDesk, 'riding on the app desk');
  assert.equal(style(w.html)('--aad-app-w'), 'var(--aad-pane-app-width)', 'the panel width feeds --aad-app-w');
  assert.equal(orb(), 'calc(var(--aad-side) + var(--aad-chat-w, 0px) + (100vw - var(--aad-side) - var(--aad-chat-w, 0px) - var(--aad-app-w, 0px) - var(--aad-rs)) / 2 - 30px)', 'the orb stays in the middle of the room left between the panels');
  w.q('.aad-pw').dispatchEvent(new FakePointerEvent('click')); assert.equal(H.aadWide, '', 'Wider');
  w.q('.aad-pw').dispatchEvent(new FakePointerEvent('click')); assert.equal(H.aadWide, undefined, 'and back');
  w.q('.aad-px').dispatchEvent(new FakePointerEvent('click')); w.run(); assert.equal(w.st.gone.at(-1), 1, '✕ hides the panel: back to the main Chats desk');
  // a thread docks beside the sidebar; another thread slides in from the left
  p.go({ view: 'thread', thread: 'r1', desk: 1 });
  assert.equal(H.aadChat, 'on', 'the docked chat'); assert.equal(style(w.html)('--aad-chat-w'), 'var(--aad-pane-chat-width)');
  assert.equal(w.q('.aad-ctop').hidden, false, 'its title row');
  w.st.route = { home: false, view: 'thread', thread: 'r2', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(p.chatDesk.dataset.aadAnim, 'thread', 'the next thread animates in');
  assert.match(style(p.thread)('animation'), /^aad-in-left 220ms /, 'a thread from the left, a calm 220 ms');
});
/* Miguel, 2 Nov 2026: apps live on Home (Grid or the Orb scene); every desktop ⌥ key keeps working, with hold-⌥ hints. */
test('Home apps: open first (badged first), then the rest installed, real apps only; app letters avoid the desktop\'s own ⌥ keys', async () => {
  const home = await import('../web/layouts/ai-apps/home.js'), { homeApps, appKeys, APP_LETTERS } = home;
  const apps = [{ id: 'chats', name: 'Chats' }, { id: 'mail', name: 'Mail' }, { id: 'money', name: 'Money' }, { id: 'notes', name: 'Notes' }, { id: 'movies', name: 'Movies' }, { id: 'maps', name: 'Maps', system: true }];
  const kinds = { apps: apps.filter(a => ['mail', 'money', 'movies', 'maps'].includes(a.id)), wiz: [apps[3]], dev: [] };
  const desks = [{ id: 'chats', desk: 0 }, { id: 'mail', desk: 1 }, { id: 'money', desk: 2 }, { id: 'notes', desk: 3 }];
  const { open, rest } = homeApps(apps, desks, kinds, id => id === 'money');
  assert.deepEqual(open.map(a => a.id), ['money', 'chats', 'mail', 'notes'], 'round 12: every desk'); assert.deepEqual(rest.map(a => a.id), ['movies']);
  for (const k of 'CDFGHILNOPRSTVWXZ') assert.ok(!APP_LETTERS.includes(k), `⌥${k} keeps its meaning`);
  const ks = appKeys([{ id: 'mail', name: 'Mail' }, { id: 'money', name: 'Money' }, { id: 'movies', name: 'Movies' }]);
  assert.deepEqual(ks, { mail: 'M', money: 'E', movies: 'A' }, 'the first free letter of the name, else the first free one');
  assert.deepEqual(appKeys([{ id: 'money', name: 'Money' }, { id: 'mail', name: 'Mail' }], { mail: 'M' }), { mail: 'M', money: 'E' }, 'stable: a kept letter stays');
  assert.equal(home.homeStyle, undefined, 'round 7: no Home style any more'); assert.equal(home.HOME_STYLES, undefined);
  const src = read('web/layouts/ai-apps/home.js');
  assert.ok(!/paintSky|starsFor|palettes|homeStyle|ah-scene|ah-sw/.test(src), 'no orb Home scene left in home.js');
});
test('desktop ⌥ keys in the AI apps view (round 21): mnemonic letters, every key on its target, no app letters, no legend', async () => {
  const p = await panelDesk({ before: d => { d.store.pins = []; } }), { w, keys } = p, H = w.html.dataset, k = keys[1];
  let talks = 0; w.api.voice.talk = () => talks++;
  const alt = (code, x = {}) => k.down({ altKey: true, code, ...x });
  assert.equal(alt('KeyS'), true); assert.deepEqual(w.st.settings, [''], '⌥S Settings');
  const n0 = w.st.newChats; assert.equal(alt('KeyN'), true); assert.equal(w.st.newChats, n0 + 1, '⌥N a new chat');
  assert.equal(alt('KeyL'), true); assert.equal(H.aadSide, 'rail', '⌥L folds the sidebar'); alt('KeyL'); assert.equal(H.aadSide, 'open');
  assert.equal(alt('KeyR'), true); assert.equal(H.aadTabs, 'rail', '⌥R folds the apps column'); alt('KeyR'); assert.equal(H.aadTabs, 'open');
  assert.equal(alt('KeyK'), true); assert.equal(w.q('.aad-find').hidden, true, '⌥K search: the field replaces 🔍');
  w.escape();
  assert.equal(alt('KeyT'), true); assert.ok(w.q('.aad-tidyx'), '⌥T Tidy up'); alt('KeyT'); assert.equal(w.q('.aad-tidyx'), null);
  assert.equal(alt('Space'), true); assert.equal(talks, 1, '⌥Space talks (the orb)');
  for (const c of ['KeyV', 'KeyC', 'KeyD']) assert.equal(alt(c), false, `⌥${c.slice(3)} stays the shell's voice key`);
  assert.equal(alt('KeyA'), true); assert.equal(H.vcSheet, 'open', '⌥A the picker');
  assert.equal(alt('ArrowLeft'), false, 'native horizontal word navigation is never consumed, even by a modal'); assert.equal(alt('ArrowRight'), false);
  assert.equal(alt('KeyA'), true); assert.equal(H.vcSheet, undefined);
  assert.equal(alt('KeyG'), true, 'unclaimed ⌥ letters are consumed (nothing acts unseen on a hidden desk)'); assert.equal(alt('Slash'), true);
  assert.equal(typeof k.up, 'function'); k.up({ code: 'AltLeft', altKey: false });
  // the docked chat: ⌥E Archive, ⌥Z Snooze, ⌥X Resolve press its own buttons; ⌥W back to Home
  const pressed = [];
  for (const act of ['done', 'snooze', 'resolve']) { const b = node('button', '', p.thread); b.dataset.chact = act; b.click = () => pressed.push(act); }
  p.go({ view: 'thread', thread: 'r1', desk: 1 });
  for (const c of ['KeyE', 'KeyZ', 'KeyX']) assert.equal(alt(c), true);
  assert.deepEqual(pressed, ['done', 'snooze', 'resolve'], 'keycaps on Snooze / Archive keep their existing letters');
  const n1 = w.st.newChats; assert.equal(alt('KeyW'), true); assert.equal(w.st.newChats, n1 + 1, '⌥W: the docked chat back to Home');
  // the snooze sheet: ⌥Z closes it, nothing else moves
  const sheet = node('div', 'boom-sheet', w.doc.body), x = node('button', '', sheet); x.setAttribute('data-boom-close', ''); let closed = 0; x.click = () => closed++;
  assert.equal(alt('KeyZ'), true); assert.equal(closed, 1, '⌥Z still closes the snooze sheet'); assert.equal(alt('ArrowDown'), true, 'no arrow-to-Someday'); assert.equal(closed, 1);
  sheet.remove();
  // an app in the panel: ⌥W closes it (a pinned one only hides)
  const closes = []; w.api.apps.close = id => closes.push(id);
  p.go({ view: 'desk', desk: 4 }); assert.equal(H.aadSplit, 'on');
  assert.equal(alt('KeyW'), true); assert.deepEqual(closes, ['money'], '⌥W closes the panel\'s app');
  // the hints: the shell's own hold-⌥ overlay draws the view's chips only, a keycap on each target
  assert.equal(p.guides.length, 1, 'one guide'); assert.deepEqual({ ...p.guides[0][1] }, { only: true }, 'the view\'s chips only, no legend');
  p.go({ view: 'thread', thread: '__new__', desk: 1 });
  const chips = p.guides[0][0](), on = key => chips.filter(c => c.key === key).map(c => c.el.className);
  for (const key of ['Space', 'L', 'K', 'N', 'S']) assert.equal(on(key).length, 1, `a keycap for ⌥${key}`);
  assert.ok(w.qa('.aad-vtab').length > 0 && on('1').length === 1, 'the first open app row wears 1');
  assert.ok(!chips.some(c => /^[a-z]$/i.test(c.key) && /aad-vtab/.test(c.el.className)), 'no app letters');
});

test('the Settings cog carries the System count (WosBell.attention through api.desk.attention), phone and desktop, like the stock gear / cog', async () => {
  for (const shell of ['phone', 'desktop']) {
    const w = world({ shell });
    let watch = null, at = { n: 3, label: 'new from Wizard' };
    const desk = { settings: p => w.st.settings.push(p ?? ''), home: () => {}, attention: fn => { watch = fn; return at; } };
    if (shell === 'desktop') Object.assign(w.api, { asset: n => '/wizard-os-home/layouts/ai-apps/' + n, storage: { get: () => null, set() {} }, keys: { on: () => () => {}, guide: () => () => {} },
      orb: { ready: () => new Promise(() => {}), onLevel: () => () => {} }, voice: { state: () => ({ state: 'idle' }), talk() {}, command() {}, on: () => () => {} } });
    w.api.desk = desk; w.api.apps.inset = () => () => {};
    const off = (await layout()).default(w.api);
    const cogs = w.qa(shell === 'phone' ? '.aa-set' : '.aad-set, .aad-rset');
    assert.ok(cogs.length >= 1, shell + ': a cog');
    for (const c of cogs) {
      const n = c.querySelector('.' + (shell === 'phone' ? 'aa' : 'aad') + '-setn');
      assert.ok(n && !n.hidden && n.textContent === '3', shell + ': the count on the cog');
      assert.equal(c.getAttribute('aria-label'), 'Settings, 3 new from Wizard');
    }
    assert.equal(typeof watch, 'function', shell + ': it follows changes');
    watch(null);
    for (const c of cogs) { const n = c.querySelector('.' + (shell === 'phone' ? 'aa' : 'aad') + '-setn'); assert.ok(n.hidden && n.textContent === '', shell + ': none, no number'); assert.equal(c.getAttribute('aria-label'), 'Settings'); }
    if (typeof off === 'function') off();
  }
  // the layout API's desk.attention (the real skin host): WosBell.attention, then each 'wizard:notify-attention'
  const f = fixture({ shell: 'desktop' }), heard = [], ls = {};
  let api = null, at = { n: 3, label: 'new from Wizard' }; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  Object.assign(f.ctx.window, { addEventListener: (t, fn) => (ls[t] ||= []).push(fn), removeEventListener: (t, fn) => { ls[t] = (ls[t] || []).filter(x => x !== fn); } });
  f.ctx.window.WosBell.attention = () => at;
  f.host.setStandardLayout('ai-apps'); await settle();
  const fire = () => { for (const fn of [...(ls['wizard:notify-attention'] || [])]) fn(); };
  assert.deepEqual({ ...api.desk.attention(v => heard.push(v && { ...v })) }, { n: 3, label: 'new from Wizard' }, 'the layout API reads WosBell.attention');
  at = { n: 5000, label: 7 }; fire(); at = null; fire();
  assert.deepEqual(heard, [{ n: 999, label: '7' }, null], 'and follows its change event');
  f.host.setStandardLayout('classic'); await settle();
  assert.equal((ls['wizard:notify-attention'] || []).length, 0, 'released with the layout');
});

/* Round 7 (Miguel, 2 Nov 2026): the switcher is the sidebar / drawer header; the fuel gauge between cog (left) and +
 * (right); Archive quieter; folded tallies; a useful rail (Ready chats with their stock status); a chat docked beside the
 * list (✕ / Esc back to Home); the app panel wider and back (⌥F) with a loading placeholder; a notification opens as a
 * chat; Home is the app grid only (the Grid | Orb choice is gone). */
test('round 7 + 15 desktop: a chat docks beside the sidebar (✕, Esc and ⌥W back Home); counts; the rail in the expanded order', async () => {
  const { w, keys } = deskWorld();
  const stage = new El('div'); stage.id = 'stage'; const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats';
  chatDesk.append(dchats); stage.append(chatDesk); w.html.children[0].append(stage);
  w.st.sessions.ready[0].state = 'needs'; w.st.sessions.ready[1].state = 'done';
  (await layout()).default(w.api);
  // Activity (Channels on for everyone, wizard-ux issue 1258): each folded header carries its count, Ready the pill
  assert.equal(w.q('.aad-sec[data-sec="working"] .aad-sec-m').textContent, '1');
  assert.equal(w.q('.aad-sec[data-sec="archive"] .aad-sec-m').textContent, '1');
  assert.equal(w.q('.aad-sec[data-sec="ready"] .aad-sec-n').textContent, '2', 'Ready: what waits on the owner');
  assert.deepEqual(w.qa('#aad-sec-ready .aad-rw').map(r => r.dataset.sid), ['r1', 'r2'], 'an open section shows its rows');
  // a thread: round 15 (round 7's column) docked beside the sidebar, its title and ✕ over it; Esc / ⌥W / ✕ back Home
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aadChat, 'on', 'the docked column'); assert.equal(w.q('.aad-cx').hidden, false);
  assert.equal(w.q('.aad-tt').textContent, 'Ready one'); assert.equal(chatDesk.dataset.aadRole, 'chat');
  const n0 = w.st.newChats;
  assert.equal(w.escape(), true, 'Esc closes the column'); assert.equal(w.st.newChats, n0 + 1, 'Home = a new chat');
  w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aadChat, undefined, 'Home: no column');
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(keys[1].down({ altKey: true, code: 'KeyW' }), true, '⌥W too'); assert.equal(w.st.newChats, n0 + 2);
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route);
  w.q('.aad-cx').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.newChats, n0 + 3, 'and its ✕');
  // the rail (round 12; round 13: the expanded list's order): Working, then Ready as one list
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.q('.aad-rlist').children.map(n => n.querySelector('.aad-rk-w').textContent + ' ' + n.querySelector('.aad-rk-n').dataset.n), ['Working 1', 'Ready 2'], 'One list = Ready alone on the rail too');
  // round 19 item 1: a rail item opens its first chat in the docked column, the rail staying folded (only ◫ expands)
  w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1 }; w.emit('route', w.st.route);
  w.q('.aad-rk[data-k="ready"]').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.html.dataset.aadSide, 'rail', 'never expands'); assert.equal(w.st.opened.at(-1), 'thread:r1');
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aadChat, 'on', 'the docked chat column beside the folded rail');
  assert.ok(w.q('.aad-rk[data-k="ready"]').classList.contains('is-on'), 'its group marked');
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.html.dataset.aadSide, 'open', 'the toggle is the only thing that expands');
  // the real desktop.css on the section headers the view drew: Archive a step quieter; a folded section's tally drawn
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  const op = sel => cascade(w.q(sel), DESK_CSS).opacity?.value;
  assert.equal(op('.aad-sec[data-sec="archive"] > .aad-sec-w'), '.85', 'Archive a step quieter'); assert.equal(op('.aad-sec[data-sec="archive"] > .aad-sec-c'), '.85');
  assert.equal(op('.aad-sec[data-sec="working"] > .aad-sec-w'), undefined, 'the other headers as they are');
  // (a folded header's count: its .aad-sec-m number, checked above; desktop.css's older .aad-tally is never drawn while
  // Activity is on, desktop.js actOn)
});
test('round 7: a notification opens as a chat (never Home), its route choice in the action row, a bell on its message', async () => {
  const { w } = deskWorld();
  const stage = new El('div'); stage.id = 'stage'; const chatDesk = new El('div'); chatDesk.className = 'wsp';
  const win = new El('div'); win.className = 'win'; const dchats = new El('div'); dchats.className = 'dchats'; const pm = new El('div'); pm.className = 'pane-main';
  const th = new El('div'); th.className = 'ch-thread ch-notif-thread'; const head = new El('div'); head.className = 'ch-head'; const ti = new El('div'); ti.className = 'ti'; const b = new El('b'); b.textContent = 'Card payment due';
  ti.append(b); head.append(ti); th.append(head); pm.append(th); dchats.append(pm); win.append(dchats); chatDesk.append(win); stage.append(chatDesk); w.html.children[0].append(stage);
  (await layout()).default(w.api);
  w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aiFront, 'chat', 'a chat'); assert.equal(w.html.dataset.aadNew, 'false', 'not Home (no see-through)');
  assert.equal(w.html.dataset.aadChat, 'on', 'round 15: docked like a chat'); assert.equal(w.q('.aad-tt').textContent, 'Card payment due', 'its title over the column');
  // phone: the same thread is a chat, not Home
  const p = world({ route: { home: false, view: 'thread', thread: '__new__', desk: 1, app: 'chats' } });
  const pw = new El('div'); pw.className = 'win app-chats'; const pt = new El('div'); pt.className = 'ch-thread ch-notif-thread'; pw.append(pt); p.device.append(pw);
  (await layout()).default(p.api);
  assert.equal(p.html.dataset.aiNew, undefined, 'phone: a notification is not the see-through Home');
  assert.equal(p.q('.ah').hidden, true, 'no Home apps over it');
  // its Badge | Chats choice moves into the thread's own sticky action row, first
  const route = new El('div'); route.className = 'ch-notif-route'; const msgs = new El('div'); msgs.className = 'ch-msgs'; const tacts = new El('div'); tacts.className = 'ch-tacts'; const btn = new El('button');
  tacts.append(btn); msgs.append(route, tacts); th.append(msgs);
  tacts.insertBefore = (n, ref) => { n.remove(); n.parentNode = tacts; tacts.children.splice(tacts.children.indexOf(ref), 0, n); };
  w.emit('render');
  assert.equal(route.parentNode, tacts); assert.equal(tacts.children[0], route, 'first in the action row');
  // each shell's real stylesheet on that thread: Badge | Chats on the action row's first line, a bell on its message only
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  p.html.setAttribute('data-shell', 'phone'); p.html.setAttribute('data-layout', 'ai-apps');
  const pmsgs = node('div', 'ch-msgs', pt), proute = node('div', 'ch-notif-route', node('div', 'ch-tacts', pmsgs));
  for (const [file, thread, row] of [['web/layouts/ai-apps/desktop.css', th, route], ['web/layouts/ai-apps/layout.css', pt, proute]]) {
    const css = read(file), msgs2 = thread.querySelector('.ch-msgs'), note = node('div', 'msg a ch-notif', msgs2), plain = node('div', 'msg a', msgs2);
    assert.equal(cascade(row, css).flex?.value, '1 0 100%', `${file}: Badge | Chats on the action row's first line`);
    const bell = cascade(note, css, { pseudo: '::before' });
    assert.equal(bell.content?.value, '""', `${file}: a bell on that message`); assert.match(bell.mask?.value || '', /^url\("data:image\/svg\+xml/, `${file}: the bell's mark`);
    assert.equal(cascade(plain, css, { pseudo: '::before' }).content, undefined, `${file}: on that message only`);
  }
});
test('round 7 phone: the drawer header is the switcher, cog · gauge · +, tallies; parts: statuses, the gauge copy; core: stiKind on rows', async () => {
  const w = world();
  w.st.sessions.working.push({ id: 'w2', title: 'Two', kind: 'working', actions: [] });
  (await layout()).default(w.api);
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.q('.aa-dh').children[0].className, 'aa-dws', 'the switcher where the name was');
  assert.equal(w.q('.aa-sec[data-sec="working"] .aa-tally').getAttribute('data-n'), '2');
  assert.equal(w.q('.aa-sec[data-sec="working"]').textContent, 'Working', 'the tally is drawn, not read out twice');
  // the real layout.css on the drawer's headers: Archive a step quieter, the others as they are
  const css = read('web/layouts/ai-apps/layout.css');
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  const op = sel => { const n = w.q(sel); assert.ok(n, sel); return cascade(n, css).opacity?.value; };
  assert.equal(op('.aa-sec[data-sec="archive"] > span'), '.85', 'Archive a step quieter'); assert.equal(op('.aa-sec[data-sec="archive"] > .aa-sec-c'), '.85');
  assert.notEqual(op('.aa-sec[data-sec="working"] > span'), '.85');
  const { stateOf, stateGroups, gaugeInto } = await import(new URL('web/layouts/ai-apps/parts.js', root).href);
  assert.equal(stateOf({ state: 'check' }), 'check'); assert.equal(stateOf({ needs: true }), 'needs'); assert.equal(stateOf({ note: true }), 'fyi'); assert.equal(stateOf({ state: 'odd' }), 'none');
  assert.deepEqual(stateGroups([{ id: 'a', state: 'done' }, { id: 'b', state: 'needs' }, { id: 'c' }]).map(g => g.state + ':' + g.rows.map(r => r.id)), ['needs:b', 'done:a', 'none:c']);
  // the gauge copy follows the live one and opens Settings › AI
  const src = new El('button'); src.className = 'mh-gauge'; src.setAttribute('data-s', 'ok'); src.setAttribute('aria-label', 'AI fuel: 60% left'); src.setAttribute('data-go', 'ai');
  src.cloneNode = () => { const c = new El('button'); c.className = src.className; c.attrs = { ...src.attrs }; return c; };
  w.device.append(src);
  const box = new El('div'); box.setAttribute('data-fuel-copy', ''); w.device.append(box); let opened = 0;
  const sig = gaugeInto(w.doc, box, '', () => opened++);
  assert.ok(sig && !box.hidden && box.children[0].classList.contains('vw-gauge') && box.children[0].getAttribute('data-go') === null);
  box.children[0].dispatchEvent(new FakePointerEvent('click')); assert.equal(opened, 1);
  assert.equal(gaugeInto(w.doc, box, sig, () => {}), sig, 'unchanged: no repaint');
  {
    // 4 Nov 2026: with the network Home off (no live gauge) the view draws its own from the AI usage feed, Resources on a click
    const { fuelOf } = await import(new URL('web/layouts/ai-apps/parts.js', root).href);
    const now = new Date().toISOString(), feed = { ai: { providers: [
      { id: 'claude:a', provider: 'claude', providerName: 'Claude', fetchedAt: now, limits: [{ label: 'Weekly', remainingPercent: 62 }, { label: '5 hours', remainingPercent: 90 }] },
      { id: 'chatgpt:b', provider: 'chatgpt', providerName: 'ChatGPT', fetchedAt: now, limits: [{ label: 'Weekly', remainingPercent: 20 }] },
      { id: 'claude:c', provider: 'claude', providerName: 'Claude', status: 'signed_out', limits: [] }] } };
    assert.deepEqual(fuelOf(feed, 'anthropic'), { left: 62, names: ['Claude'], old: false }, 'the default model\'s accounts, weekly limit');
    assert.equal(fuelOf(feed, '').left, 41, 'no default: every plan account');
    assert.equal(fuelOf({ ai: { providers: [] } }, 'claude'), null);
    src.remove?.(); w.device.children = w.device.children.filter(n => n !== src);
    const box2 = new El('div'); w.device.append(box2); const pages = [];
    const sig2 = gaugeInto(w.doc, box2, '', pg => pages.push(pg), () => fuelOf(feed, 'claude'));
    assert.ok(sig2.startsWith('own|62') && !box2.hidden && box2.children[0].classList.contains('vw-gauge'));
    box2.children[0].dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(pages, ['usage']);
    assert.equal(gaugeInto(w.doc, box2, sig2, () => {}, () => null), '', 'nothing readable: hidden'); assert.ok(box2.hidden);
    // Codex P1: the phone foot is hidden at setup, so opening the drawer / sidebar re-arms the usage feed
    const lives = [], usage = { live: n => lives.push(n) };
    const pv = world(); pv.api.aiUsage = usage; (await layout()).default(pv.api);
    assert.equal(lives.length, 1, 'phone: armed at setup');
    pv.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
    assert.equal(lives.length, 2, 'phone: opening the drawer re-arms it'); assert.equal(lives[1], lives[0], 'for the drawer\'s foot');
    const { w: dv } = deskWorld(); dv.api.aiUsage = usage; (await layout()).default(dv.api);
    assert.equal(lives.length, 3, 'desktop: armed at setup');
    dv.q('.aad-tog').dispatchEvent(new FakePointerEvent('click')); dv.q('.aad-rtog').dispatchEvent(new FakePointerEvent('click'));
    assert.equal(lives.length, 5, 'desktop: each fold / unfold of the sidebar re-arms it'); assert.equal(lives[4], lives[2], 'for the sidebar\'s foot');
  }
  // core: Chats hands the adapters its own threadAct / threadActions / stiKind (chats.js's public object, run)
  const own = { threadAct() {}, threadActions() {}, stiKind() {} };
  const pub = runRecording(`this.pub = (function () {\n${block(withParts(read('web/core/chats.js')), '  return { beforeNavigate:')}\n})();`, { ...own }).pub;
  for (const k of Object.keys(own)) assert.equal(pub[k], own[k], `CHATS.${k} is Chats' own`);
  // (both shell adapters' sessionList hands Chats' rows to WizChatsListModel.sessionList: run in 'desktop core hooks' and
  // 'core hooks: the phone adapter ...'); a row needs the owner when its run waits for approval or asks for them
  const needs = runWithChatsModel(`window.WizChatsListModel.sessionList({ ready: [{ id: 'a', status: 'waiting_for_approval' }, { id: 'b', status: 'completed', attention: { state: 'needs_you' } }, { id: 'c', status: 'completed', attention: { state: 'check' } }] }, { live: {}, chats: { stiKind: () => 'none', threadActions: () => [] }, pins: null }).ready.map(r => [r.id, r.needs, r.state])`, { window: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(needs)), [['a', true, 'none'], ['b', true, 'none'], ['c', false, 'none']]);
});
test('round 7: a hold (phone) or a right click (desktop) on a Home app icon offers it for the home screen through the stock Desks sheet', async () => {
  {
    // round 10: a right click on a Home icon opens its quick actions; Add to Home Screen is one of them (when offered)
    const w = deskWorld().w, offered = [], stored = [], closed = [];
    w.api.apps.homeScreen = { can: id => id !== 'maps', offer: id => { offered.push(id); return true; } };
    w.api.apps.get = id => { stored.push(id); return true; }; w.api.apps.close = id => { closed.push(id); return true; };
    (await layout()).default(w.api);
    // round 16: the right column's rows (the All apps grid is gone)
    const e = new FakePointerEvent('contextmenu', { clientX: 400, clientY: 300 }); w.q('.aad-vtab[data-app="mail"]').dispatchEvent(e);
    assert.ok(e.defaultPrevented);
    assert.deepEqual(w.qa('.aad-appmenu .aad-pop-i').map(b => b.dataset.act + ':' + b.textContent), ['unpin:Unpin', 'up:Move up', 'down:Move down', 'open:Open', 'home:Add to Home Screen', 'store:App Store page', 'close:Close'], 'desktop: the quick actions of an open, pinned app');
    assert.equal(w.q('.aad-appmenu .aad-pop-h').textContent, 'Mail');
    w.q('.aad-appmenu .aad-pop-i[data-act="home"]').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(offered, ['mail'], 'the Desks\' own sheet'); assert.equal(w.q('.aad-appmenu'), null);
    w.q('.aad-vtab[data-app="maps"]').dispatchEvent(new FakePointerEvent('contextmenu', { clientX: 10, clientY: 10 }));
    assert.deepEqual(w.qa('.aad-appmenu .aad-pop-i').map(b => b.dataset.act), ['pin', 'up', 'open', 'store', 'close'], 'an app the stock sheet would not offer: no Add to Home Screen; the last open row: Move up only');
    w.q('.aad-appmenu .aad-pop-i[data-act="store"]').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(stored, ['maps'], 'its App Store page');
    w.q('.aad-vtab[data-app="maps"]').dispatchEvent(new FakePointerEvent('contextmenu', { clientX: 10, clientY: 10 }));
    w.q('.aad-appmenu .aad-pop-i[data-act="open"]').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(w.st.gone.at(-1), 6, 'Open = its desk');
  }
  {
    // the phone (round 16 item 7): a hold lifts a pinned icon; let go without moving = its menu (Pin / Unpin, Move, Add to Home Screen, Open, Close)
    const w = world(), offered = [];
    w.api.apps.homeScreen = { can: id => id !== 'maps', offer: id => { offered.push(id); return true; } };
    (await layout()).default(w.api);
    w.st.route = { home: true, view: 'desk', thread: null, desk: 0 }; w.emit('route', w.st.route);
    const money = w.q('.ah-app[data-app="money"]');
    money.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 41, button: 0, clientX: 10, clientY: 10, pointerType: 'touch' }));
    const h = w.st.timers.filter(t => t.ms === 450).at(-1); assert.ok(h, 'the stock 450 ms hold'); h.fn();
    assert.ok(money.classList.contains('is-lift'), 'a pinned icon lifts');
    for (const f of w.doc.__listeners.pointerup || []) f(new FakePointerEvent('pointerup', { pointerId: 41 }));
    if (/function appMenu/.test(read('web/layouts/apps/chrome.js'))) {
      assert.deepEqual(w.qa('.vc-menu .vc-menu-i').map(b => b.textContent), ['Unpin', 'Move up', 'Add to Home Screen', 'Open', 'Close · stays installed'], 'let go without moving: its menu');
      w.qa('.vc-menu .vc-menu-i').find(b => b.textContent === 'Add to Home Screen').dispatchEvent(new FakePointerEvent('click'));
    }
    assert.deepEqual(offered, ['money'], 'the stock sheet (from its menu; a build without the shared menu offers it at once)');
    const go = w.st.gone.length; money.dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.gone.length, go, 'the hold does not also open it');
  }
  // the layout API's homeScreen is the stock sheet on the Desks' own checks (the real skin-host, wizard-ux issue 1674)
  const offeredStock = [], APP = { files: { id: 'files', name: 'Files' }, sys: { id: 'sys', name: 'System', system: true }, web: { id: 'web', name: 'Web' } };
  const D = await layoutApi({ extra: ctx => { ctx.WizHomeScreenApps = { canOffer: a => a.id !== 'web', offer: a => { offeredStock.push(a); return true; } }; ctx.WizCore = { apps: () => ({ APP }) }; } });
  const hs = D.api.apps.homeScreen;
  assert.deepEqual(['files', 'sys', 'web', 'nope'].map(hs.can), [true, false, false, false], 'the Desks\' own checks (no system apps, the sheet\'s canOffer)');
  assert.equal(hs.offer('files'), true); assert.equal(offeredStock.at(-1), APP.files, 'the stock sheet gets the registered app itself, not a copy');
  assert.equal(hs.offer('sys'), false); assert.equal(offeredStock.length, 1, 'a system app is never offered');
  D.host.setLayout('classic'); await settle(); assert.equal(hs.offer('files'), false, 'dead with the layout');
  // the desktop page loads the same sheet (its scripts, run, define the sheet the layout API calls)
  const page = createDocument(); page.body.innerHTML = read('web/desktop.html');
  const srcs = page.querySelectorAll('script[src]').map(n => n.getAttribute('src')), css = page.querySelectorAll('link[rel="stylesheet"]').map(n => n.getAttribute('href'));
  assert.ok(srcs.includes('core/home-screen-policy.js') && srcs.includes('core/home-screen-apps.js') && css.includes('core/home-screen-apps.css'), 'the desktop loads the same sheet');
  const sheetWin = {}; runRecording(read('web/core/home-screen-apps.js'), { window: sheetWin });
  assert.equal(typeof sheetWin.WizHomeScreenApps?.offer, 'function', 'and that script is the sheet');
});

test('desktop app panel: an app\'s title-bar tools (Morning Report\'s ‹ date › PDF) show in the panel\'s header; its own title bar stays laid out (titlebar.shown is true), out of sight', async () => {
  const p = await panelDesk(), { w, style } = p, asked = [];
  let tools = [];
  w.st.renderTools = (frame, slot) => { asked.push(frame); slot.replaceChildren(...tools.map(t => { const b = node('button', 'tool'); b.textContent = t; return b; })); return tools.length > 0; };
  p.go({ view: 'desk', desk: 4 });
  const top = w.q('.aad-ptop'), slot = w.q('.aad-ptop .aad-ptools');
  assert.deepEqual(top.children.map(c => c.className).filter(c => !/aad-modes/.test(c)), ['aad-pti', 'aad-ptn', 'aad-ptools', 'aad-ib aad-pw', 'aad-ib aad-px'], 'round 15: icon, name, the tools, then Wider and ✕ in the app panel\'s header');
  assert.equal(slot.hidden, true, 'no tools yet: the slot is hidden'); assert.ok(asked.includes(p.appWins[0].querySelector('iframe')), 'the shared host renderer is asked for the panel window\'s frame');
  tools = ['‹', 'Today', '›', 'PDF']; w.st.hostChanged(); w.run(); await settle();
  assert.equal(slot.hidden, false, 'a late registration shows up (the host lifecycle)'); assert.deepEqual(slot.children.map(b => b.textContent), ['‹', 'Today', '›', 'PDF']);
  // the app's own title bar stays laid out (display flex), just out of sight and out of reach
  const bar = style(p.appWins[0].querySelector('.wbar'));
  assert.equal(bar('display'), 'flex', 'never display: none (an app would think its tools are gone)');
  assert.deepEqual([bar('visibility'), bar('pointer-events'), bar('position')], ['hidden', 'none', 'absolute']);
  const n = asked.length; p.off(); w.st.hostChanged(); w.run(); await settle();
  assert.equal(asked.length, n, 'released on teardown: no more tools painting');
});

test('round 9 desktop: no veil over the skin\'s background (Home, beside a panel); only panels and the composer have surfaces', async () => {
  const p = await panelDesk(), { w, style } = p;
  node('div', 'ch-newchat', p.msgs);   // Home: the main Chats window holds a new chat
  p.go({ view: 'thread', thread: '__new__', desk: 1 });
  assert.equal(w.html.dataset.aiFront === 'list', false);
  const win = style(p.chatWin);
  assert.deepEqual(['background', 'box-shadow', 'backdrop-filter', '-webkit-backdrop-filter'].map(win), ['none', 'none', 'none', 'none'], 'the new chat\'s window paints nothing');
  assert.ok(p.important(p.chatWin, 'background'), 'over the shell\'s own window surface');
  for (const n of [p.wbody, p.dchats, p.paneMain, p.thread, p.msgs]) assert.equal(style(n)('background'), 'none', `nor ${n.className} inside it`);
  assert.equal(style(w.q('.aad-top'))('background'), 'none', 'the top row: no surface of its own');
  assert.equal(w.q('.aad-back'), null, 'no room beside a docked chat any more');
  // beside an app panel: still no veil on the chat; the panel has its surface
  p.go({ view: 'desk', desk: 4 });
  assert.equal(style(p.chatWin)('background'), 'none', 'the middle beside an app panel paints nothing');
  assert.equal(style(p.appDesk)('background'), 'var(--aad-canvas)', 'the panel is a surface');
  // the stock list (Chats in front as the list) keeps its own window surface
  w.html.dataset.aiFront = 'list'; assert.notEqual(style(p.chatWin)('background'), 'none', 'the stock list keeps a surface');
});

test('round 9 desktop: the sidebar resizable by drag (round 13: the only panel; no chat column, no app panel), keyboard too, kept per device, within limits', async () => {
  const p = await panelDesk(), { w, store } = p;
  const g = id => w.q(`.aad-grip[data-grip="${id}"]`), st = w.html.style;
  assert.equal(g('apps'), null, 'round 10: no apps sidebar, no grip for it');
  assert.equal(g('chat'), null, 'the docked chat keeps its width'); assert.ok(g('app') && g('tabs'), 'round 15: the app panel and the open-apps column resize too');
  for (const id of ['side', 'tabs', 'app']) {
    assert.ok(g(id), id); assert.equal(g(id).getAttribute('role'), 'separator'); assert.equal(g(id).getAttribute('aria-orientation'), 'vertical');
    assert.equal(g(id).getAttribute('tabindex'), '0', 'keyboard-reachable'); assert.match(g(id).title, /double-click: back to default/);
  }
  assert.equal(st.getPropertyValue('--aad-side-w'), '288px', 'the defaults'); assert.equal(st.getPropertyValue('--aad-rs-w'), '');
  // a drag: the sidebar grows to the right
  g('side').dispatchEvent(new FakePointerEvent('pointerdown', { clientX: 288, pointerId: 1 })); assert.equal(w.html.dataset.aadResizing, 'side');
  g('side').dispatchEvent(new FakePointerEvent('pointermove', { clientX: 340 })); assert.equal(st.getPropertyValue('--aad-side-w'), '340px', 'follows the pointer');
  g('side').dispatchEvent(new FakePointerEvent('pointerup', {})); assert.equal(w.html.dataset.aadResizing, undefined);
  assert.equal(store.widths.side, 340, 'kept on this device');
  g('side').dispatchEvent(new FakePointerEvent('keydown', { key: 'ArrowLeft' })); assert.equal(store.widths.side, 324, '← narrows it');
  g('side').dispatchEvent(new FakePointerEvent('keydown', { key: 'ArrowLeft', shiftKey: true })); assert.equal(store.widths.side, 260, '⇧ bigger steps');
  // limits: never past them, whatever the drag
  g('side').dispatchEvent(new FakePointerEvent('pointerdown', { clientX: 340, pointerId: 1 }));
  g('side').dispatchEvent(new FakePointerEvent('pointermove', { clientX: 1300 })); g('side').dispatchEvent(new FakePointerEvent('pointerup', {}));
  assert.equal(st.getPropertyValue('--aad-side-w'), '440px', 'at most 440'); assert.equal(g('side').getAttribute('aria-valuenow'), '440'); assert.equal(g('side').getAttribute('aria-valuemax'), '440');
  for (let i = 0; i < 20; i++) g('side').dispatchEvent(new FakePointerEvent('keydown', { key: 'ArrowLeft' }));
  assert.equal(store.widths.side, 220, 'at least 220');
  // a double click (or Enter) goes back to the default
  g('side').dispatchEvent(new FakePointerEvent('dblclick')); assert.equal(st.getPropertyValue('--aad-side-w'), '288px'); assert.equal('side' in store.widths, false);
  g('side').dispatchEvent(new FakePointerEvent('keydown', { key: 'ArrowLeft' })); g('side').dispatchEvent(new FakePointerEvent('keydown', { key: 'Enter' })); assert.equal('side' in store.widths, false, 'Enter: back to the default');
  // desktop.css on what the view drew (wizard-ux issue 1674)
  const css = read('web/layouts/ai-apps/desktop.css');
  assert.ok(!css.includes('data-aad-apps') && !css.includes('.aad-apps'), 'round 10: no apps sidebar styles left');
  const on = (n, k, opts) => cascade(n, DESK_CSS, opts)[k]?.value ?? '';
  assert.equal(on(w.html, '--aad-side'), 'var(--aad-side-w, 288px)', 'the open sidebar follows the dragged width (288 by default)');
  w.html.dataset.aadTabs = 'rail'; assert.equal(on(w.html, '--aad-rs'), '52px', 'round 15: the open apps on the right fold to a 52 px rail');
  assert.deepEqual([on(g('side'), 'position'), on(g('side'), 'cursor')], ['fixed', 'col-resize'], 'col-resize');
  assert.notEqual(on(g('side'), 'opacity', { pseudo: '::after' }), '.55');
  assert.equal(on(g('side'), 'opacity', { pseudo: '::after', states: [':hover'] }), '.55', 'a hairline on hover');
  g('side').classList.add('is-drag'); assert.equal(on(g('side'), 'opacity', { pseudo: '::after' }), '.55', 'and while dragged'); g('side').classList.remove('is-drag');
  const frame = p.appWins[0].querySelector('iframe');
  assert.notEqual(on(frame, 'pointer-events'), 'none');
  w.html.dataset.aadResizing = 'side'; assert.equal(on(frame, 'pointer-events'), 'none', 'apps never swallow the drag'); assert.ok(p.important(frame, 'pointer-events'));
  delete w.html.dataset.aadResizing;
  // the other grips' limits, as the view sets them on its separators (1440 px wide)
  assert.deepEqual([g('tabs').getAttribute('aria-valuemin'), g('tabs').getAttribute('aria-valuemax'), g('app').getAttribute('aria-valuemin')], ['160', '320', '360'], 'the open apps 160 to 320, the app panel from 360');
  assert.ok(Number(g('app').getAttribute('aria-valuemax')) <= 1400, 'the app panel at most 1400');
});

test('round 10 desktop: a drag is smooth (one write a frame, no page resize, no storage until the release; windows follow by CSS)', async () => {
  const frames = [], ros = [], hadRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(cb) { ros.push(cb); } observe() {} disconnect() {} };
  let p;
  try { p = await panelDesk({ before: d => { d.w.api.frame = fn => { frames.push(fn); return () => { const i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); }; }; } }); } finally { globalThis.ResizeObserver = hadRO; }
  const { w, store } = p;
  const flush = () => { while (frames.length) frames.shift()(16 * (frames.length + 1)); };
  flush();
  let resizes = 0; const had = globalThis.dispatchEvent; globalThis.dispatchEvent = e => { if (e.type === 'resize') resizes++; return true; };
  try {
    const g = w.q('.aad-grip[data-grip="side"]'), st = w.html.style;
    g.dispatchEvent(new FakePointerEvent('pointerdown', { clientX: 288, pointerId: 1 }));
    g.dispatchEvent(new FakePointerEvent('pointermove', { clientX: 300 })); g.dispatchEvent(new FakePointerEvent('pointermove', { clientX: 330 }));
    assert.equal(st.getPropertyValue('--aad-side-w'), '288px', 'nothing written between frames');
    assert.equal(frames.length, 1, 'several moves, one frame');
    flush(); assert.equal(st.getPropertyValue('--aad-side-w'), '330px', 'the latest x, once a frame');
    assert.equal(resizes, 0, 'no page resize while held'); assert.equal('widths' in store, false, 'no storage write while held');
    g.dispatchEvent(new FakePointerEvent('pointermove', { clientX: 352 }));
    g.dispatchEvent(new FakePointerEvent('pointerup', {}));
    assert.equal(st.getPropertyValue('--aad-side-w'), '352px', 'the release applies the last move');
    assert.equal(resizes, 1, 'one resize, on release'); assert.equal(store.widths.side, 352, 'kept on release');
    assert.equal(w.html.dataset.aadResizing, undefined);
  } finally { globalThis.dispatchEvent = had; }
  // desktop.css on what the view drew (wizard-ux issue 1674): a shown lone window follows its desk by CSS (round 11:
  // always, not only while held); while held windows never animate and nothing re-samples a blur
  const win = p.appWins[0], on = (n, k) => cascade(n, DESK_CSS)[k];
  assert.deepEqual([on(win, 'left')?.value, on(win, 'left')?.important], ['8px', true], 'a shown lone window follows its desk by CSS');
  const two = node('div', 'win', p.appDesk); assert.notEqual(on(win, 'left')?.value, '8px', 'not with two windows on the desk'); two.remove();
  assert.notEqual(on(win, 'transition')?.value, 'none');
  w.html.dataset.aadResizing = 'side';
  assert.deepEqual([on(win, 'transition')?.value, on(win, 'transition')?.important], ['none', true], 'windows never animate under the pointer');
  const side = w.q('.aad-side');
  assert.deepEqual([on(side, 'backdrop-filter')?.value, on(side, '-webkit-backdrop-filter')?.value, on(side, 'backdrop-filter')?.important], ['none', 'none', true], 'no blur re-sampled per frame');
  delete w.html.dataset.aadResizing;
  // the app frames keep a fixed width while held, refitted a few times a second (not every frame), freed on release
  p.go({ view: 'desk', desk: 4 }); flush();
  const frame = win.querySelector('iframe'); let fw = 500; frame.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: fw, height: 400, right: fw, bottom: 400 });
  const g = w.q('.aad-grip[data-grip="side"]');
  g.dispatchEvent(new FakePointerEvent('pointerdown', { clientX: 288, pointerId: 2 }));
  assert.equal(frame.style.getPropertyValue('width'), '500px', 'held: the frame keeps its width');
  fw = 520; g.dispatchEvent(new FakePointerEvent('pointermove', { clientX: 300 })); frames.shift()(60);
  assert.equal(frame.style.getPropertyValue('width'), '500px', 'not refitted on every frame');
  // the orb's resize watcher waits for the release, which places it
  const queued = frames.length; for (const cb of ros) cb([]); assert.equal(frames.length, queued, 'the orb waits while a grip is held');
  g.dispatchEvent(new FakePointerEvent('pointermove', { clientX: 310 })); frames.shift()(200);
  assert.equal(frame.style.getPropertyValue('width'), '520px', 'refitted after a while');
  g.dispatchEvent(new FakePointerEvent('pointerup', {})); assert.equal(frame.style.getPropertyValue('width'), '', 'freed on release');
  flush(); assert.ok(ros.length, 'the orb watches the composer');
  for (const cb of ros) cb([]); assert.ok(frames.length > 0, 'after the release a resize places the orb again');
});

test('round 10 phone: on light skins the Home icons are full colour (the app colour plate, a white glyph) with readable names; dark skins untouched', async () => {
  const css = read('web/layouts/ai-apps/layout.css'), w = world();
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  (await layout()).default(w.api);
  const tile = w.q('.ah-app[data-app="money"] .ah-tile'), glyph = tile.querySelector('.sgi'), name = w.q('.ah-app[data-app="money"] .ah-name');
  assert.ok(tile && glyph && name, 'Home drew Money\'s icon with its glyph and name');
  const st = (n, k) => cascade(n, css)[k]?.value ?? '';
  for (const skin of ['paper-light', 'sepia']) {
    w.html.dataset.skin = skin;
    assert.equal(st(tile, 'background'), 'linear-gradient(165deg, color-mix(in oklab, var(--c) 82%, white), var(--c) 55%, color-mix(in oklab, var(--c) 82%, black))', `${skin}: the full-colour plate`);
    assert.equal(st(glyph, 'background'), 'white', `${skin}: a white glyph`); assert.ok(cascade(glyph, css).background.important, 'past the skin\'s grey dimmer');
    assert.ok(st(name, 'text-shadow'), `${skin}: names keep a light halo on photos`);
  }
  w.html.dataset.skin = 'midnight';
  assert.equal(st(tile, 'background'), 'linear-gradient(165deg, color-mix(in oklab, var(--c) 30%, var(--wz-panel, var(--wz-base, var(--bg)))), color-mix(in oklab, var(--c) 12%, var(--wz-panel, var(--wz-base, var(--bg)))))', 'a dark skin keeps the stock quiet plate');
  assert.notEqual(st(glyph, 'background'), 'white', 'and its stock glyph');
  // a logo or a plain tile (Get more) never wears the plate
  tile.classList.add('is-logo'); w.html.dataset.skin = 'paper-light';
  assert.notEqual(st(tile, 'background'), 'linear-gradient(165deg, color-mix(in oklab, var(--c) 82%, white), var(--c) 55%, color-mix(in oklab, var(--c) 82%, black))');
});

test('round 11: Home order = the desks\' order (badged first), no arrangement kept; pages that fit (never one row)', async () => {
  const H = await import('../web/layouts/ai-apps/home.js');
  assert.equal(H.OLD_ORDER_KEY, 'appOrder');
  for (const k of ['orderApps', 'moveTo', 'ORDER_KEY', 'DRAG_FROM', 'EDGE_MS']) assert.equal(k in H, false, `${k} is gone (no rearranging)`);
  const apps = ['mail', 'money', 'music', 'movies', 'news'].map(id => ({ id, name: id }));
  const desks = [{ desk: 0, id: 'wizard' }, { desk: 1, id: 'music' }, { desk: 2, id: 'mail' }, { desk: 3, id: 'money' }];
  const { open, rest } = H.homeApps(apps, desks, null, id => id === 'money');
  assert.deepEqual(open.map(a => a.id), ['money', 'wizard', 'music', 'mail'], 'the desks in their order, the badged one first');
  assert.deepEqual(rest.map(a => a.id), ['movies', 'news'], 'then the apps not open yet');
  assert.deepEqual(H.homeApps(apps, desks, null, () => false).open.map(a => a.id), ['wizard', 'music', 'mail', 'money'], 'exactly the desk order');
  // round 12 (Miguel: "all"): one icon per desk, the Desks view one to one: a second Chats desk, Files, the App Store,
  // Claude (system / connector apps with a desk) with the stock desk names; keyed per desk, so a click opens THAT desk
  const all = [{ id: 'files', name: 'Files', system: true }, { id: 'app-store', name: 'App Store', system: true }, { id: 'claude', name: 'Claude', connector: true }, ...apps];
  const ds = [{ desk: 0, id: 'wizard', name: 'Chats' }, { desk: 1, id: 'files', name: 'Files' }, { desk: 2, id: 'mail', name: 'Mail' }, { desk: 3, id: 'wizard', name: 'Chats' }, { desk: 4, id: 'app-store', name: 'App Store' }, { desk: 5, id: 'claude', name: 'Claude' }];
  const r12 = H.homeApps(all, ds, null, () => false);
  assert.deepEqual(r12.open.map(a => `${a.desk}:${a.name}`), ['0:Chats', '1:Files', '2:Mail', '3:Chats', '4:App Store', '5:Claude'], 'every desk in desk order, the stock names');
  assert.deepEqual(r12.open.map(a => a.key), ['desk:0', 'desk:1', 'desk:2', 'desk:3', 'desk:4', 'desk:5'], 'one cell per desk');
  assert.deepEqual(r12.rest.map(a => a.id), ['money', 'movies', 'music', 'news'], 'then installed apps not open yet');
  // round 14: Chats' count is one inbox: only the first Chats desk carries it (a second is `dupe`: no badge, not first)
  const lit14 = H.homeApps(all, ds, null, id => id === 'wizard').open;
  assert.deepEqual(lit14.map(a => a.desk), [0, 1, 2, 3, 4, 5], 'the first Chats desk badged (already first), the second keeps its desk place');
  assert.deepEqual(lit14.filter(a => a.dupe).map(a => a.desk), [3], 'the second Chats desk is the duplicate');
  assert.deepEqual(H.pageFit(1104, 520, 124, 128), { cols: 7, rows: 4, per: 28 }, '1440 wide: 7 × 4');
  assert.deepEqual(H.pageFit(944, 300, 124, 128), { cols: 7, rows: 2, per: 14 });
  assert.equal(H.pageFit(900, 90, 124, 128).rows, 2, 'never a single row');
  const js = noComments(read('web/layouts/ai-apps/home.js'));
  assert.ok(!/startDrag|moveDrag|is-arranging|appOrder', \[/.test(js), 'no drag code, no order written');
});

/* Round 16 item 7 (Miguel, 3 Nov 2026): one app model on both shells: Pinned, Open, + (the picker). Supersedes round 10's
 * All apps grid and round 11's "no rearranging" on the phone Home. */
test('round 16 item 7: layer membership (pinned / open / picker disjoint; a pinned open app once, in Pinned); the picker excludes open and pinned and groups For people / For agents', async () => {
  const { appLayers, shownIds } = await import('../web/layouts/ai-apps/parts.js');
  const desks = [{ desk: 0, id: 'wizard', name: 'Chats' }, { desk: 1, id: 'mail', name: 'Mail' }, { desk: 2, id: 'maps', name: 'Maps' }, { desk: 3, id: 'money', name: 'Money' }, { desk: 4, id: 'wizard', name: 'Chats' }, { desk: 5, id: 'mail', name: 'Mail' }];
  const L = appLayers(desks, ['music', 'mail'], { main: 0, lit: id => id === 'money', names: { music: 'Music' } });
  assert.deepEqual(L.pinned.map(p => `${p.id}:${p.desk}`), ['music:null', 'mail:1'], 'every pin once, open or not (its first desk)');
  assert.deepEqual(L.open.map(d => `${d.id}:${d.desk}`), ['money:3', 'maps:2', 'wizard:4'], 'the open apps not pinned (never a pinned app again, never Home\'s Chats desk), badged first');
  assert.deepEqual(appLayers(desks, ['music', 'mail'], { main: 0, lit: id => id === 'money', manual: true }).open.map(d => d.id), ['maps', 'money', 'wizard'], 'ordered by hand: the desks\' order');
  const pinIds = new Set(L.pinned.map(p => p.id)), openIds = new Set(L.open.map(d => d.id));
  assert.ok([...pinIds].every(id => !openIds.has(id)), 'Pinned and Open are disjoint');
  assert.deepEqual([...shownIds(L)].sort(), ['mail', 'maps', 'money', 'music', 'wizard'], 'what the picker never repeats');
  // the picker (shared sheet, kinds): For people open, For agents folded (Agent apps, Agents, Connectors), no Already open, + Get more
  // (the kinds grouping lives in the shared sheet where this build carries it; without it: one For people list)
  const grouped = /AGENT_KINDS/.test(read('web/layouts/apps/chrome.js'));
  const { w } = deskWorld();
  w.api.apps.kinds = () => ({ apps: [{ id: 'mail', name: 'Mail' }, { id: 'money', name: 'Money' }, { id: 'movies', name: 'Movies' }, { id: 'maps', name: 'Maps' }, { id: 'music', name: 'Music' }], dev: [{ id: 'paper', name: 'Paper' }], wiz: [{ id: 'notes', name: 'Notes' }, { id: 'bot', name: 'Bot' }], agents: [{ id: 'helper', name: 'Helper' }], conns: [{ id: 'bank', name: 'Bank' }] });
  w.api.apps.openAny = id => { w.st.opened.push('any:' + id); return true; };
  (await layout()).default(w.api);
  w.q('.aad-vall').dispatchEvent(new FakePointerEvent('click'));
  if (!grouped) {
    assert.deepEqual(w.qa('.vc-pick .vc-sec-h > span').map(n => n.textContent), ['For people']); assert.equal(w.q('.vc-pick .vc-fold'), null, 'no Already open row');
    assert.ok(w.q('.vc-pick .vc-list-more .vc-more'), '+ Get more, last'); return;
  }
  assert.deepEqual(w.qa('.vc-pick .vc-fold').map(b => b.className), ['vc-fold vc-fold-agents'], 'no Already open row');
  assert.deepEqual(w.qa('.vc-pick .vc-sec-h > span').map(n => n.textContent), ['For people'], 'one For people section, open');
  assert.deepEqual(w.qa('.vc-pick .vc-list[data-kind="apps"] .vc-app').map(b => b.dataset.app), ['mail', 'maps', 'money', 'movies', 'music', 'paper'], 'desktop search includes open and pinned apps and launcher links');
  const fold = w.q('.vc-pick .vc-fold-agents'); assert.equal(fold.getAttribute('aria-expanded'), 'false', 'For agents folded'); assert.equal(fold.querySelector('.vc-count').textContent, '4', 'Bot, Notes, Helper, Bank, whether open or not');
  fold.dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.qa('.vc-pick .vc-sub-h > span').map(n => n.textContent), ['Agent apps', 'Agents', 'Connectors']);
  assert.ok(w.q('.vc-pick .vc-list-more .vc-more'), '+ Get more, last'); assert.equal(w.q('.vc-pick .vc-store'), null, 'no store text button');
  // the + tile is drawn as a plain plate (chrome.css on the tile the sheet drew)
  const plus = w.q('.vc-pick .vc-more .vc-tile-plus'), chromeCss = read('web/layouts/apps/chrome.css'), pc = cascade(plus, chromeCss);
  assert.match(pc['box-shadow']?.value || '', /^inset 0 0 0 1px /, 'the + tile: a hairline plate'); assert.match(pc.background?.value || '', /^color-mix\(in srgb, var\(--wz-text, var\(--ink\)\) 7%, transparent\)$/, 'a faint ink plate');
  // the same shared sheet opened without the picker options (the Orb / Apps +) keeps its Already open row
  const { viewChrome } = await import('../web/layouts/apps/chrome.js');
  const o = deskWorld().w; o.api.apps.kinds = w.api.apps.kinds; const vc = viewChrome(o.api, { openIds: () => ['mail', 'money'] });
  vc.open();
  const openFold = () => o.qa('.vc-sheet .vc-fold').find(b => !b.classList.contains('vc-fold-agents')) ?? null, openRow = openFold();
  assert.equal(openRow?.querySelector('span')?.textContent, 'Already open', 'the Orb / Apps sheet keeps its Already open row (opt-in picker only)');
  vc.close(); vc.open({ exclude: () => [] }); assert.equal(openFold(), null, 'the picker has none');
});
test('round 16 item 7 + round 19 item 4 phone: Home = the open apps not pinned, +, tidy; the pins in a dock above the composer (8 a page); hold and drag within and between them; the picker from +', async () => {
  const w = world();
  w.api.apps.homeScreen = { can: () => true, offer: () => true };
  (await layout()).default(w.api);
  w.st.route = { home: true, view: 'desk', thread: null, desk: 0 }; w.emit('route', w.st.route);
  const name = b => b.dataset.app ? (b.dataset.group === 'pin' ? '^' : '') + b.dataset.app + (b.querySelector('.ah-run') ? '•' : '') : b.classList.contains('ah-tidy') ? 'tidy' : '+';
  const kids = () => w.q('.ah-grid').children.map(name), dockKids = () => w.qa('.ah-dock .ah-app').map(name);
  // round 19 item 4: the dock = his pins (open ones with the running dot); the grid = the open apps not pinned, +, tidy
  assert.deepEqual(dockKids(), ['^music•', '^mail•', '^money•']);
  assert.deepEqual(kids(), ['notes•', 'maps•', '+', 'tidy'], 'no Open caption, no new-row rule');
  assert.equal(w.q('.ah-cap'), null); assert.equal(w.q('.ah-div'), null); assert.equal(w.qa('.ah-pinb, .ah-app .ah-pin').length, 0, 'no pin badge');
  assert.equal(w.q('.ah-ddots').hidden, true, 'one page: no dots');
  const dockEl = w.q('.ah-dock');
  dockEl.getBoundingClientRect = () => ({ left: 0, top: 500, width: 400, height: 200, right: 400, bottom: 700 });
  const place = () => {
    w.qa('.ah-dock .ah-app').forEach((c, i) => { c.getBoundingClientRect = () => ({ left: i * 90, top: 520, width: 80, height: 90, right: i * 90 + 80, bottom: 610 }); });
    w.qa('.ah-grid .ah-app[data-group="open"]').forEach((c, i) => { c.getBoundingClientRect = () => ({ left: i * 90, top: 100, width: 80, height: 90, right: i * 90 + 80, bottom: 190 }); });
  };
  const doc = n => (...a) => { for (const f of w.doc.__listeners[n] || []) f(...a); };
  const drag = (id, x, y, check) => {
    place(); const c = w.q(`.ah-app[data-app="${id}"]`), r = c.getBoundingClientRect();
    c.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 9, button: 0, clientX: r.left + 40, clientY: r.top + 40, pointerType: 'touch' }));
    w.st.timers.filter(t => t.ms === 450).at(-1).fn();
    doc('pointermove')(new FakePointerEvent('pointermove', { pointerId: 9, clientX: x, clientY: y }));
    check?.(c);
    doc('pointerup')(new FakePointerEvent('pointerup', { pointerId: 9 }));
  };
  // within the dock: Money to the front
  drag('money', 20, 560, c => assert.ok(c.classList.contains('is-lift') && w.q('.ah-app[data-app="music"]').classList.contains('is-drop') && dockEl.classList.contains('is-target'), 'it follows the finger; the spot and the dock marked'));
  assert.deepEqual(w.st.store.pins, ['money', 'music', 'mail'], 'his pin order, kept (the same key as the desktop)');
  assert.deepEqual(dockKids(), ['^money•', '^music•', '^mail•']);
  // grid → dock: Notes dropped before Music = pinned there
  drag('notes', 100, 560);
  assert.deepEqual(w.st.store.pins, ['money', 'notes', 'music', 'mail']); assert.deepEqual(kids(), ['maps•', '+', 'tidy']);
  // dock → grid: Mail dragged out before Maps = unpinned, first in the grid
  drag('mail', 20, 140);
  assert.deepEqual(w.st.store.pins, ['money', 'notes', 'music']); assert.deepEqual(kids(), ['mail•', 'maps•', '+', 'tidy']);
  // within the grid: Maps to the front (his order, kept)
  drag('maps', 20, 140);
  assert.deepEqual(kids(), ['maps•', 'mail•', '+', 'tidy']); assert.deepEqual(w.st.store.homeOpen, ['maps', 'mail']);
  // a hold without moving = the app's menu (no move)
  place(); const m0 = w.q('.ah-app[data-app="maps"]');
  m0.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 9, button: 0, clientX: 40, clientY: 140, pointerType: 'touch' })); w.st.timers.filter(t => t.ms === 450).at(-1).fn();
  doc('pointerup')(new FakePointerEvent('pointerup', { pointerId: 9 }));
  assert.ok(w.q('.vc-menu, .vc-appmenu, [role="menu"]'), 'the hold menu'); assert.deepEqual(kids(), ['maps•', 'mail•', '+', 'tidy']);
  // + = the picker: installed apps neither pinned nor open (a tap right after a drag is swallowed, so later)
  const realNow = Date.now; Date.now = () => realNow() + 2000;
  try { w.q('.ah-plus').dispatchEvent(new FakePointerEvent('click')); } finally { Date.now = realNow; }
  assert.deepEqual(w.qa('.vc-pick .vc-app[data-app]').map(b => b.dataset.app), ['movies']);
  // a pin that is not open: no dot
  w.st.desks = w.st.desks.filter(d => d.id !== 'music'); w.emit('route', { ...w.st.route }); w.emit('render');
  for (const tm of w.st.timers.splice(0)) if (!tm.dead && tm.ms < 1000) tm.fn();
  const music = w.q('.ah-dock .ah-app[data-app="music"]');
  assert.ok(music && !music.querySelector('.ah-run') && !music.classList.contains('is-run'), 'a pin not open: no running dot');
  // nothing else open: the grid is just + (and the tidy line)
  w.st.desks = w.st.desks.filter(d => !['mail', 'maps'].includes(d.id)); w.emit('render');
  assert.deepEqual(kids(), ['+', 'tidy']);
  const css = read('web/layouts/ai-apps/layout.css');
  // layout.css on what Home drew (wizard-ux issue 1674)
  w.html.setAttribute('data-shell', 'phone'); w.html.setAttribute('data-layout', 'ai-apps');
  const PHONE_CSS = [parseCss(css)], ph = (n, k, opts) => { assert.ok(n, 'drawn'); return cascade(n, PHONE_CSS, opts)[k]?.value ?? ''; };
  const dot = w.q('.ah-dock .ah-app .ah-run');
  assert.deepEqual(['position', 'left', 'bottom', 'width', 'height', 'border-radius'].map(k => ph(dot, k)), ['absolute', '50%', '-6px', '4px', '4px', '50%'], 'the running dot, 4 px, centred under the name');
  assert.match(ph(dot, 'background'), /^var\(--aa-ink-2/, 'muted');
  const plate = w.q('.ah-dock');
  assert.equal(ph(plate, 'border-radius'), '30px'); assert.equal(ph(plate, 'background'), 'color-mix(in srgb, var(--wz-panel, var(--wz-base, var(--bg))) 52%, transparent)', 'a subtle glass plate from skin tokens');
  assert.match(ph(plate, 'backdrop-filter'), /^blur/);
  const page = w.q('.ah-dock .ah-dpage');
  assert.deepEqual([ph(page, 'scroll-snap-align'), ph(page, 'grid-template-columns')], ['start', 'repeat(4, minmax(0, 1fr))'], '4 a row, pages snap');
  const chatWin = new El('div'); chatWin.className = 'win app-chats'; const comp = new El('div'); comp.className = 'ch-compose'; comp.append(new El('textarea')); chatWin.append(comp); w.html.children[0].append(chatWin);
  assert.notEqual(ph(plate, 'display'), 'none'); assert.equal(ph(plate, 'display', { states: [':focus'] }), 'none', 'the dock steps away while typing');
  chatWin.remove();
  assert.doesNotMatch(css, /\.ah-div\b|is-open-first|\.ah-cap\b|is-opensec/, 'no divider, chip, caption or smaller open icons');
  const dp = await panelDesk(), vt = dp.w.q('.aad-vtab.is-run'), vs = dp.style(vt, { pseudo: '::before' });
  assert.deepEqual(['width', 'height', 'border-radius', 'background'].map(vs), ['4px', '4px', '50%', 'var(--aad-ink-2)'], 'the desktop column\'s dot: the same 4 px muted dot');
});

test('round 19 item 4 phone: more than 8 pins page the dock sideways (dots); parts: orderOpen, homeDrop, dockPages', async () => {
  const P = await import('../web/layouts/ai-apps/parts.js');
  assert.equal(P.DOCK_PER, 8);
  assert.deepEqual(P.dockPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map(p => p.length), [8, 2]); assert.deepEqual(P.dockPages([]), []);
  const o = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(P.orderOpen(o, ['c', 'a']).map(x => x.id), ['c', 'a', 'b'], 'his order, new ones after'); assert.deepEqual(P.orderOpen(o, null).map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(P.homeDrop(['p', 'q'], ['a', 'b'], { id: 'b', open: true }, { group: 'pin', index: 1 }), { pins: ['p', 'b', 'q'], open: ['a'] }, 'into the dock: pinned there');
  assert.deepEqual(P.homeDrop(['p', 'q'], ['a'], { id: 'p', open: true }, { group: 'open', index: 0 }), { pins: ['q'], open: ['p', 'a'] }, 'out: unpinned, open in the grid');
  assert.deepEqual(P.homeDrop(['p', 'q'], ['a'], { id: 'q', open: false }, { group: 'open', index: 1 }), { pins: ['p'], open: ['a'] }, 'a pin not open dragged out: unpinned');
  const w = world();
  const many = ['mail', 'music', 'money', 'notes', 'maps', 'movies', 'news', 'files', 'photos2', 'health'].map(id => ({ id, name: id }));
  w.api.apps.list = () => many.map(a => ({ ...a })); w.st.store.pins = many.map(a => a.id);
  (await layout()).default(w.api);
  w.st.route = { home: true, view: 'desk', thread: null, desk: 0 }; w.emit('route', w.st.route);
  assert.deepEqual(w.qa('.ah-dpage').map(p => p.children.length), [8, 2], '8 a page');
  assert.equal(w.q('.ah-ddots').hidden, false); assert.equal(w.qa('.ah-ddot').length, 2);
  assert.ok(w.q('.ah-dock').classList.contains('is-paged'));
});

test('round 15: pins (defaults if installed, the owner\'s order, pin / unpin), auto-tidy on a fake clock, 1:1 with the desks', async () => {
  const parts = await import('../web/layouts/ai-apps/parts.js');
  const { pinsFrom, togglePin, tidyPlan, seedUsed, tidyWords, TIDY } = parts;
  assert.deepEqual(pinsFrom(null, ['money', 'wizard-mail', 'wizard-music', 'notes']), ['wizard-music', 'wizard-mail', 'money'], 'defaults: Music, Mail, Messenger, Calendar, Money when installed (wizard- ids too)');
  assert.deepEqual(pinsFrom(['notes', 'gone', 'notes', 'money'], ['money', 'notes']), ['notes', 'money'], 'the owner\'s order; unknown and repeated dropped');
  assert.deepEqual(pinsFrom([], ['money']), [], 'an emptied row stays empty');
  assert.deepEqual(togglePin(['a', 'b'], 'c'), ['a', 'b', 'c'], 'pin appends'); assert.deepEqual(togglePin(['a', 'b'], 'a'), ['b'], 'unpin');
  const H = 3600e3, now = 100 * H;
  const desks = [{ desk: 1, id: 'wizard' }, { desk: 2, id: 'maps' }, { desk: 3, id: 'money' }, { desk: 4, id: 'notes' }, { desk: 5, id: 'movies' }];
  const used = { wizard: 0, maps: now - 30 * H, money: now - 30 * H, notes: now - 2 * H, movies: now - 25 * H };
  const plan = o => tidyPlan(desks, { pins: ['money'], used, now, limit: TIDY['24h'], ...o }).map(d => d.desk);
  assert.deepEqual(plan(), [5, 2], 'unused for 24 h, highest desk first; never pinned (Money), never Chats, never a recent one');
  assert.deepEqual(plan({ keep: [5] }), [2], 'never the one on screen');
  assert.deepEqual(plan({ limit: TIDY['12h'] }), [5, 2]); assert.deepEqual(plan({ limit: TIDY.week }), []); assert.deepEqual(plan({ limit: TIDY.off }), [], 'Off');
  assert.deepEqual(seedUsed({ maps: 5, gone: 1 }, desks.slice(0, 3), now), { wizard: now, maps: 5, money: now }, 'never-seen apps count from now; closed ones forgotten');
  assert.equal(tidyWords(3, '24h'), 'Closed 3 apps you hadn\'t used in 24 hours'); assert.equal(tidyWords(1, 'week'), 'Closed 1 app you hadn\'t used in 1 week');
  // the view: the pinned row (sidebar and rail), a right click Pin / Unpin kept per device; ⌥T All apps; the tidy closes + toast + Undo
  const { w, store, keys } = deskWorld();
  w.st.desks = null; const closed = [];
  let list = [{ desk: 1, id: 'wizard', name: 'Chats' }, { desk: 2, id: 'maps', name: 'Maps' }, { desk: 4, id: 'money', name: 'Money' }, { desk: 5, id: 'movies', name: 'Movies' }];
  w.api.desks.list = () => list; w.api.desks.close = d => { closed.push(d); list = list.filter(x => x.desk !== d); return true; };
  store.used = { maps: Date.now() - 30 * H, movies: Date.now() - 2 * H, money: Date.now() - 40 * H };
  (await layout()).default(w.api);
  const pinsNow = () => w.qa('.aad-vtab.is-pinned').map(b => b.dataset.app);
  assert.ok(pinsNow().includes('money') && pinsNow().includes('mail'), 'the installed defaults pinned (round 16: on top of the right column, open or not)');
  assert.equal(w.q('.aad-vtab.is-pinned[data-app="mail"]').dataset.desk, undefined, 'a pin not open is listed all the same');
  assert.ok(w.q('.aad-vtab.is-pinned[data-app="mail"]').classList.contains('is-closed'));
  const o0 = w.st.opened.length; w.q('.aad-vtab.is-pinned[data-app="mail"]').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.st.opened.at(-1), 'mail', 'a click on a pin not open opens it'); assert.ok(w.st.opened.length > o0);
  assert.ok(w.q('.aad-vtf .aad-vall'), 'All apps: the column\'s last row');
  assert.ok(!pinsNow().includes('maps'), 'Maps is not pinned');
  w.q('.aad-vtab[data-desk="2"]').dispatchEvent(new FakePointerEvent('contextmenu', { clientX: 10, clientY: 10 }));
  w.q('.aad-appmenu .aad-pop-i[data-act="pin"]').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(pinsNow().at(-1), 'maps', 'Pin: at the row\'s end'); assert.equal(store.pins.at(-1), 'maps', 'kept on this device');
  assert.ok(w.q('.aad-vtab[data-desk="2"]').classList.contains('is-pinned'), 'its open tab moves up with the pins');
  w.q('.aad-vtab.is-pinned[data-app="maps"]').dispatchEvent(new FakePointerEvent('contextmenu', { clientX: 10, clientY: 10 }));
  w.q('.aad-appmenu .aad-pop-i[data-act="unpin"]').dispatchEvent(new FakePointerEvent('click'));
  assert.ok(!pinsNow().includes('maps'), 'Unpin');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyA' }), true); assert.equal(w.html.dataset.vcSheet, 'open', '⌥A the picker (round 21)');
  w.escape();
  // the tidy (6 s after load): Maps (30 h) closes, Money is pinned, Movies is recent
  for (const tm of w.st.timers.filter(x => x.ms === 6000)) tm.fn();
  assert.deepEqual(closed, [2], 'only the stale unpinned one');
  assert.equal(w.q('.aad-toast').hidden, false); assert.equal(w.q('.aad-toast-w').textContent, 'Closed 1 app you hadn\'t used in 24 hours');
  const opened = w.st.opened.length; w.q('.aad-toast-u').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.st.opened.at(-1), 'maps', 'Undo opens it again'); assert.ok(w.st.opened.length > opened); assert.equal(w.q('.aad-toast').hidden, true);
  // the setting: Off stops it
  // round 18: the foot's 'Tidy: 24h' line expands in place into the sentence
  assert.equal(w.q('.aad-tidy-w').textContent, 'Tidy: 24h');
  w.q('.aad-tidy').dispatchEvent(new FakePointerEvent('click'));
  const sent = w.q('.aad-vtf .aad-tidyx .aad-tidys');
  assert.equal(sent.textContent, 'Tidy up: close apps you haven\'t used in Off12 hours24 hours1 week. Pinned apps always stay open.');
  const sel = sent.querySelector('select'); assert.equal(sel.value, '24h');
  sel.value = 'off'; sel.dispatchEvent(new FakePointerEvent('change')); assert.equal(store.tidy, 'off');
  assert.match(w.q('.aad-tidy-w').textContent, /Tidy: Off/);
});

test('round 15 desktop: the open apps as vertical tabs on the right (1:1 with the desks), the app panel docked left of them; ✕ = the stock close', async () => {
  const { w, store } = deskWorld();
  w.st.desks = null;
  const closed = [];
  w.api.desks.list = () => [{ desk: 1, id: 'wizard', name: 'Chats' }, { desk: 2, id: 'maps', name: 'Maps' }, { desk: 3, id: 'wizard', name: 'Chats' }, { desk: 4, id: 'money', name: 'Money' }, { desk: 5, id: 'mail', name: 'Mail' }, { desk: 6, id: 'notes', name: 'Notes' }];
  w.api.desks.close = d => { closed.push(d); return true; };
  (await layout()).default(w.api);
  // pins (defaults installed here: music, mail, money): the open ones first in pin order, no ✕; then badged first, then desk order
  const tabs = () => w.qa('.aad-vtab').map(b => (b.classList.contains('is-pinned') ? '^' : '') + b.dataset.desk + ':' + b.dataset.app);
  assert.deepEqual(tabs(), ['^undefined:music', '^5:mail', '^4:money', '2:maps', '3:wizard', '6:notes'], 'round 16: every pin on top in pin order, open or not (Music is not open); then one tab per desk (Home\'s Chats desk aside); a second Chats desk carries no count');
  assert.ok(w.q('.aad-vtab[data-app="music"]').classList.contains('is-closed') && !w.q('.aad-vtab[data-app="music"]').classList.contains('is-run'), 'a pin not open: no running dot');
  assert.ok(w.q('.aad-vtab[data-desk="5"]').classList.contains('is-run'), 'an open pin: its dot');
  assert.ok(w.q('.aad-vtsep'), 'a hairline between the pinned and the others');
  assert.equal(w.q('.aad-vtab[data-desk="5"] .aad-vtx'), null, 'pinned: no ✕ (never closed for you)');
  assert.equal(w.q('.aad-vtab[data-desk="4"] .aad-vtb').textContent, '3', 'the badge on its tab');
  assert.equal(w.q('.aad-vtt').textContent, 'Apps');
  w.q('.aad-vtab[data-desk="2"]').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.st.gone.at(-1), 2, 'a tab opens its desk (the panel)');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 2 }; w.emit('route', w.st.route);
  assert.equal(w.q('.aad-vtab.is-on').dataset.desk, '2');
  const g0 = w.st.newChats; w.q('.aad-vtab[data-desk="2"]').dispatchEvent(new FakePointerEvent('click'));
  assert.ok(w.st.newChats > g0 || w.st.gone.at(-1) === 1, 'the tab in front again: hidden, back Home');
  w.q('.aad-vtab[data-desk="6"] .aad-vtx').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(closed, [6], '✕ = the stock close of that desk');
  w.q('.aad-vtab[data-desk="3"]').dispatchEvent(new FakePointerEvent('auxclick', { button: 1 })); assert.deepEqual(closed, [6, 3], 'a middle click too');
  // folds to a 52 px icon column, kept on this device
  w.q('.aad-vtog').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.html.dataset.aadTabs, 'rail'); assert.equal(store.tabsFolded, true);
  w.q('.aad-vtog').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.html.dataset.aadTabs, 'open');
  // a desk the stock close refuses: the app's own close
  const appClosed = []; w.api.apps.close = id => appClosed.push(id); w.api.desks.close = d => { closed.push(d); return false; };
  w.q('.aad-vtab[data-desk="2"] .aad-vtx').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual([closed.at(-1), appClosed], [2, ['maps']], '✕: the stock close of that desk, else the app\'s');
  // desktop.css on what the view drew (wizard-ux issue 1674)
  const css = read('web/layouts/ai-apps/desktop.css');
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  const on = (n, k) => cascade(n, DESK_CSS)[k]?.value ?? '';
  assert.equal(on(w.html, '--aad-rs'), 'var(--aad-tabs-px, 200px)', '200 px open');
  w.html.dataset.aadTabs = 'rail'; assert.equal(on(w.html, '--aad-rs'), '52px', '52 px folded'); w.html.dataset.aadTabs = 'open';
  assert.ok(!/transition:[^;]*\b(width|left|right|flex)\b/.test(css), 'no layout animation (transforms / colours only)');
  assert.notEqual(on(w.q('.aad-orb'), 'visibility'), 'hidden');
  w.html.dataset.vcSheet = 'open'; assert.deepEqual([on(w.q('.aad-orb'), 'opacity'), on(w.q('.aad-orb'), 'visibility')], ['0', 'hidden'], 'the orb steps aside under the picker'); delete w.html.dataset.vcSheet;
  // the panel docked left of the column, the Chats desk behind it never on its bare list (a new chat there, then the app back)
  const p = await panelDesk();
  const chats0 = p.w.st.newChats; p.go({ view: 'desk', desk: 4 });
  assert.equal(p.appDesk.dataset.aadRole, 'app'); assert.ok(p.w.st.newChats > chats0, 'the Chats desk behind the panel never shows its bare list: a new chat there');
  const chats1 = p.w.st.newChats; p.go({ view: 'desk', desk: 4 }); assert.equal(p.w.st.newChats, chats1, 'once (not again while it is being fixed)');
  const ins = cascade(p.appDesk, DESK_CSS), pv = k => parseFloat(p.w.html.style.getPropertyValue('--aad-pane-' + k));
  const [top, right, bottom, left] = resolveVars(ins.inset?.value, { ...p.w.html.style }).split(' ').map(parseFloat);
  assert.deepEqual([ins['z-index']?.value, ins.inset?.important], ['3', true], 'the panel desk above the chat, placed whatever the shell says');
  assert.deepEqual([top, bottom, right, left + pv('app-width')], [0, 0, pv('dock-width'), pv('dock-x')], 'the panel docked left of the column (its right edge on the column\'s left)');
  assert.ok(pv('dock-width') === 200 && pv('app-width') > 0);
  assert.equal(on(p.w.html, '--aad-app-w'), 'var(--aad-pane-app-width)', 'the docked app width comes from the tested core geometry');
  p.w.html.dataset.aadChat = ''; assert.equal(on(p.w.html, '--aad-chat-w'), 'var(--aad-pane-chat-width)', 'and the docked chat width');
  // the stock close underneath: the layout API's desks.close is the shell's closeDesk for a whole desk index only
  const shut = [], D = await layoutApi({ adapter: { closeDesk: i => { shut.push(i); return true; } } });
  assert.deepEqual([D.api.desks.close(2), D.api.desks.close(-1), D.api.desks.close(1.5), D.api.desks.close('2')], [true, false, false, false]); assert.deepEqual(shut, [2]);
  // the desktop's own closeDesk (desktop-boot.js) closes a real desk with its closeDesktop (its ✕), nothing else
  const deskClosed = [], { adapter: shellAdapter } = desktopBoot({ desktopVars: { ws: [{}, {}, {}] }, closeDesktop: i => { deskClosed.push(i); return true; } });
  const closeDesk = i => shellAdapter.closeDesk(i);
  assert.deepEqual([closeDesk(1), closeDesk(3), closeDesk(-1), closeDesk(0.5)], [true, false, false, false]); assert.deepEqual(deskClosed, [1], 'the desktop\'s own closeDesktop (its ✕)');
});

/* Round 13 item 4 (Miguel): a Snoozed section, Archive · Working · Snoozed · Ready, from the stock snooze state whether or
 * not the snooze-someday tweak files snoozed chats under Ready; folded at first, its count shown; the rail the same. */
test('round 13: Snoozed from the stock snooze state, with and without the snooze-someday tweak; order; the rail matches', async () => {
  for (const f of ['web/desktop/desktop.js', 'web/app.js']) {
    const src = read(f);
    const fn = src.match(/sessionList: (\(\) => window\.WizChatsListModel\.sessionList\([^\n]+\)),\n/)[1];
    const s = (id, extra = {}) => ({ id, title: id.toUpperCase(), status: 'completed', ...extra });
    const z = s('z', { deferred: true, deferredAt: '2026-11-02T10:00:00Z', lastUserAt: '2026-11-02T09:00:00Z' });
    const za = s('za', { deferred: true, deferredAt: '2026-11-02T10:00:00Z', status: 'waiting_for_approval' });
    const woke = s('wk', { deferred: true, deferredAt: '2026-11-02T08:00:00Z', lastUserAt: '2026-11-02T09:00:00Z' });
    const run = G => runWithChatsModel(`(${fn})()`, { LIVE: { ok: true, workGroups: () => G, isNew: () => false, cardAt: () => '' }, CHATS: { threadActions: () => ['snooze', 'done'] }, window: { WosChatPins: { has: () => false } }, Date });
    // stock: the snoozed chats in their own group (G.deferred)
    const stock = run({ working: [s('w')], ready: [s('r'), za], deferred: [z], archive: [s('a')] });
    assert.equal(JSON.stringify(stock.snoozed.map(x => x.id + ':' + x.kind)), '["z:snoozed"]', `${f}: stock`); assert.equal(JSON.stringify(stock.ready.map(x => x.id)), '["r","za"]', `${f}: a snoozed chat that needs an approval stays in Ready`);
    // the tweak on: snoozed rows filed at Ready's bottom: still Snoozed here, never lost
    const tweak = run({ working: [s('w')], ready: [s('r'), woke, z], archive: [s('a')] });
    assert.equal(JSON.stringify(tweak.snoozed.map(x => x.id)), '["z"]', `${f}: the tweak's Ready rows`); assert.equal(JSON.stringify(tweak.ready.map(x => x.id)), '["r","wk"]', `${f}: a chat woken by a reply is Ready`);
  }
  { const t = fixture({ shell: 'desktop' }); await t.mount('miguel/snooze-someday'); assert.ok(t.host.tweakState.includes('miguel/snooze-someday'), 'the tweak exists and loads (the view does not depend on it)'); await t.clear(); }
  const { w, store } = deskWorld();
  w.st.sessions.snoozed = [{ id: 'z1', title: 'Later one', kind: 'snoozed', unread: false, pinned: false, actions: ['restore', 'done'] }, { id: 'z2', title: 'Later two', kind: 'snoozed', unread: false, pinned: false, actions: ['restore'] }];
  (await layout()).default(w.api);
  assert.deepEqual(w.qa('.aad-sec').map(h => `${h.dataset.sec}:${h.getAttribute('aria-expanded')}`), ['working:false', 'ready:true', 'snoozed:false', 'archive:false'], 'Activity (issue 1258): Working, Ready, Recent, then Snoozed and Archived folded at the bottom; an empty Recent is not drawn (issue 1731)');
  assert.equal(w.q('.aad-sec[data-sec="snoozed"] .aad-sec-w').textContent, 'Snoozed');
  assert.equal(w.q('.aad-sec[data-sec="snoozed"] .aad-sec-m').textContent, '2', 'its count when folded');
  w.q('.aad-sec[data-sec="snoozed"]').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.qa('.aad-rw[data-kind="snoozed"]').map(r => r.dataset.sid), ['z1', 'z2']); assert.equal(store.sections.snoozed, true);
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.q('.aad-rlist').children.map(n => n.dataset.k + ':' + n.querySelector('.aad-rk-n').dataset.n + n.querySelector('.aad-rk-w').textContent), ['working:1Working', 'snoozed:2Snoozed', 'ready:2Ready'], 'the rail (round 22): Working, Snoozed, then Ready');
  // the phone's drawer: the same sections
  const p = world(); p.st.sessions.snoozed = w.st.sessions.snoozed;
  (await layout()).default(p.api); p.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(p.qa('.aa-sec').map(h => h.dataset.sec), ['working', 'snoozed', 'ready', 'archive']);
});

/* Round 14 (Miguel, 3 Nov 2026: "perfect"): phone, sidebar and skin fixes (the desktop tab strip is on hold for a new
 * design). Each guard failed on round 13's build. */
test('round 14: the phone Home grid shows Chats\' count once (on the first Chats desk); its cells are kept, not rebuilt, on a repaint', async () => {
  const w = world();
  w.st.desks = [{ desk: 1, id: 'wizard', name: 'Chats' }, { desk: 2, id: 'mail', name: 'Mail' }, { desk: 3, id: 'wizard', name: 'Chats' }];
  (await layout()).default(w.api);
  w.st.route = { home: true, view: 'desk', thread: null, desk: 0 }; w.emit('route', w.st.route);
  // (round 16 item 7: Home's own Chats desk is not an app on the grid; a second one is an open app, with no count)
  const chats = w.qa('.ah-grid .ah-app[data-app="wizard"]');
  assert.equal(chats.length, 1, 'the second Chats desk only'); assert.equal(chats[0].querySelector('.ah-badge').hidden, true, 'no second count');
  const before = w.qa('.ah-grid .ah-app');
  w.emit('render'); w.emit('route', w.st.route);
  const after = w.qa('.ah-grid .ah-app');
  assert.ok(before.length === after.length && before.every((n, i) => n === after[i]), 'the same cells (no logo re-decoded, no sigil-to-logo flash)');
});
test('round 14: the sidebar marks the chat in front without rebuilding; a fold never re-tiles every desk; the hidden desks keep their geometry', async () => {
  const { w } = deskWorld();
  (await layout()).default(w.api);
  const rows = w.qa('.aad-rw');
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route);
  const rows2 = w.qa('.aad-rw');
  assert.ok(rows.length === rows2.length && rows.every((n, i) => n === rows2[i]), 'the same rows');
  assert.ok(w.q('.aad-rw[data-sid="r1"]').classList.contains('is-cur')); assert.equal(w.q('.aad-rw[data-sid="r1"] .aad-row').getAttribute('aria-current'), 'page');
  w.st.route = { home: false, view: 'thread', thread: 'r2', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(w.q('.aad-rw[data-sid="r1"]').classList.contains('is-cur'), false); assert.ok(w.q('.aad-rw[data-sid="r2"]').classList.contains('is-cur'));
  // a fold re-tiles (a page resize) only when a desk tiles several windows
  for (const [wins, want] of [[1, 0], [2, 1]]) {
    const p = await panelDesk({ wins }); p.go({ view: 'desk', desk: 4 }); p.w.run();
    let resizes = 0; const had = globalThis.dispatchEvent; globalThis.dispatchEvent = e => { if (e.type === 'resize') resizes++; return true; };
    try { p.w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click')); p.w.run(); } finally { globalThis.dispatchEvent = had; }
    assert.equal(resizes, want, wins > 1 ? 'a desk tiling two windows: the shell re-tiles' : 'one window a desk: no page resize');
    if (wins > 1) continue;
    // desktop.css on what the view drew: desks out of sight keep their geometry; a long list fades at its ends
    assert.match(p.style(p.w.q('.aad-scroll'))('-webkit-mask-image'), /^linear-gradient\(to bottom, transparent 0, black 10px, /, 'a long list fades under the header and above the foot');
  }
});
// (wizard-ux issue 1742: the pane-geometry rule `[data-aad-pane-side] #stage > .wsp:not([data-aad-role])` out-ranked the
// round 14 hidden-desk rule, so a hidden desk followed --aad-pane-main-x, which moves when the sidebar folds; hidden desks
// now sit on --aad-pane-held-*, the open sidebar's main area)
test('round 14: desks out of sight keep their geometry when the sidebar folds', async () => {
  const p = await panelDesk(); p.go({ view: 'desk', desk: 4 }); p.w.run();
  const hiddenDesk = node('div', 'wsp', p.stage); hiddenDesk.setAttribute('hidden', '');
  const left = () => px(resolveVars(p.style(hiddenDesk)('left'), { ...p.w.html.style }));
  const before = left(); assert.ok(Number.isFinite(before), 'a length');
  p.w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click')); p.w.run();
  assert.equal(p.w.html.dataset.aadSide, 'rail', 'folded');
  assert.equal(left(), before, 'a hidden desk keeps its left edge when the sidebar folds');
});

test('round 14: Archive stays quieter but readable on the light skins (sidebar, rail, phone drawer)', async () => {
  const { w } = deskWorld(); w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps'); w.html.dataset.skin = 'paper-light';
  (await layout()).default(w.api);
  const d = read('web/layouts/ai-apps/desktop.css'), op = (n, css) => cascade(n, css).opacity?.value ?? '1';
  const arch = w.q('.aad-sec[data-sec="archive"]'), ready = w.q('.aad-sec[data-sec="ready"]');
  const label = h => h.children.find(c => c.tagName === 'SPAN' && !/aad-sec-[mn]/.test(c.className));
  assert.ok(label(arch), 'the Archive header drew its word');
  assert.equal(op(label(arch), d), '.85', 'Archive a step quieter (desktop sidebar), still readable');
  assert.equal(op(label(ready), d), '1', 'Ready is not dimmed');
  const p = world(); p.html.setAttribute('data-shell', 'phone'); p.html.setAttribute('data-layout', 'ai-apps'); p.html.dataset.skin = 'paper-light';
  (await layout()).default(p.api); p.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  const css = read('web/layouts/ai-apps/layout.css'), pa = p.q('.aa-sec[data-sec="archive"]');
  assert.equal(op(pa.children.find(c => c.tagName === 'SPAN'), css), '.85', 'the phone drawer\'s Archive too');
  assert.equal(op(pa.querySelector('.aa-sec-c'), css), '.85', 'and its chevron');
  assert.equal(op(p.q('.aa-sec[data-sec="ready"]').children.find(c => c.tagName === 'SPAN'), css), '1');
});
test('round 14: a full-width footer along an app\'s bottom is lifted clear of the orb even when its body covers the probe point (Wisdom\'s page count)', () => {
  const host = withSkinHostParts(read('web/core/skin-host.js'));
  const find = between(host, "    let bar = d.querySelector('[data-wos-inset-bar]');", '    // a list that scrolls under the orb');
  const vw = 390, vh = 788;
  const node = (tagName, rect, parentElement = null, attrs = {}) => ({ tagName, parentElement, attrs, isConnected: true,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }), getClientRects: () => [rect],
    getAttribute: k => (k in attrs ? attrs[k] : null), hasAttribute: k => k in attrs, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: k => { delete attrs[k]; }, matches: () => false });
  const page = ({ footer }) => {
    const body = node('BODY', { left: 0, top: 0, width: vw, height: vh }), main = node('MAIN', { left: 0, top: 0, width: vw, height: vh }, body);   // the reader's body flows to the very bottom
    const foot = node('FOOTER', footer, body), all = [main, foot];
    const d = { body, documentElement: { clientWidth: vw, clientHeight: vh }, elementFromPoint: () => main,
      querySelector: s => (s === '[data-wos-inset-bar]' ? all.find(n => n.hasAttribute('data-wos-inset-bar')) || null : null),
      querySelectorAll: s => (s === 'nav, footer, [role="navigation"], [role="tablist"]' ? [foot] : []) };
    return { d, foot };
  };
  const run = d => { const ctx = { d, fi: 84, f: { getBoundingClientRect: () => ({ left: 0, width: vw }) }, frameOrb: () => null, shownIn: () => true, CONTROLS: 'button' };
    runRecording(`(() => {\n${find}\nglobalThis.found = bar;\n})()`, ctx); return ctx; };
  // Wisdom's reader: the probe point (bottom centre) hits its body, yet its page-count footer runs along the bottom
  const w = page({ footer: { left: 0, top: vh - 40, width: vw, height: 40 } }), c = run(w.d);
  assert.equal(c.found, w.foot, 'the footer is the bar, found by what it is');
  assert.equal(w.foot.getAttribute('data-wos-inset-bar'), '', 'marked for the lift');
  assert.ok(!c.calls.some(([n]) => n === 'bottomBar'), 'looked for before the controls-block fallback (a footer of plain text has no controls)');
  assert.ok(c.calls.some(([n, , b]) => n === 'floatsOver' && b === w.foot), 'and laid out over the orb');
  // a footer that is not along the bottom, or not full width, is not taken: the controls-block fallback runs
  for (const footer of [{ left: 0, top: 300, width: vw, height: 40 }, { left: 0, top: vh - 40, width: 200, height: 40 }]) {
    const x = page({ footer }), cx = run(x.d);
    assert.equal(x.foot.getAttribute('data-wos-inset-bar'), null, 'not a bottom bar'); assert.ok(cx.calls.some(([n]) => n === 'bottomBar'), 'the fallback looks instead');
  }
});

/* Round 16 item 6 (Miguel, 3 Nov 2026): drag to rearrange the right column. */
test('round 16: the moves are pure: vtMove (within / between Pinned and the open apps) and relMoves (the fewest stock desk moves)', async () => {
  const { vtMove, relMoves } = await import('../web/layouts/ai-apps/parts.js');
  assert.deepEqual(vtMove(['a', 'b', 'c'], [5, 6], { id: 'c', desk: 4 }, { group: 'pin', index: 0 }), { pins: ['c', 'a', 'b'], open: [5, 6] }, 'within Pinned');
  assert.deepEqual(vtMove(['a'], [5, 6, 7], { id: 'x', desk: 7 }, { group: 'open', index: 0 }), { pins: ['a'], open: [7, 5, 6] }, 'within the open apps');
  assert.deepEqual(vtMove(['a'], [5, 6], { id: 'x', desk: 6 }, { group: 'pin', index: 1 }), { pins: ['a', 'x'], open: [5] }, 'open → Pinned pins it there');
  assert.deepEqual(vtMove(['a', 'b'], [5], { id: 'a', desk: 2 }, { group: 'open', index: 1 }), { pins: ['b'], open: [5, 2] }, 'Pinned → open unpins it into the list there');
  assert.deepEqual(vtMove(['a', 'b'], [5], { id: 'a', desk: null }, { group: 'open', index: 0 }), { pins: ['b'], open: [5] }, 'a pin not open: unpinned');
  assert.deepEqual(relMoves([0, 1, 2, 3, 4], [3, 1]), { moves: [[1, 3]], order: [0, 2, 3, 1, 4] });
  assert.deepEqual(relMoves([0, 1, 2, 3], [1, 2, 3]).moves, [], 'already in order: nothing moves');
  assert.deepEqual(relMoves([0, 1, 2, 3, 4, 5], [4, 2, 5]), { moves: [[2, 4]], order: [0, 1, 3, 4, 2, 5] }, 'only ever later (never ahead of Home\'s Chats desk)');
});
test('round 16: drag to rearrange the right column: within Pinned, within the open apps (the desks move), open → Pinned, Pinned → open, Esc cancels; Move up / down; his order beats badged first', async () => {
  const { w, store, keys } = deskWorld();
  const ws = ['wizard', 'maps', 'money', 'notes', 'movies', 'mail'], moves = [];
  w.st.desks = null;
  w.api.desks.list = () => ws.map((id, i) => ({ desk: i, id, name: id === 'wizard' ? 'Chats' : id[0].toUpperCase() + id.slice(1) }));
  w.api.desks.move = (f, t) => { ws.splice(t, 0, ws.splice(f, 1)[0]); moves.push([f, t]); return true; };
  w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 0 };
  (await layout()).default(w.api);
  const P = () => w.qa('.aad-vtab').filter(r => r.dataset.group === 'pin').length;
  const T = i => 60 + i * 38 + (i >= P() ? 13 : 0);
  const rects = () => {
    w.qa('.aad-vtab').forEach((r, i) => { r.getBoundingClientRect = () => ({ top: T(i), bottom: T(i) + 36, height: 36, left: 0, right: 180, width: 180 }); });
    const sep = w.q('.aad-vtsep'); if (sep) sep.getBoundingClientRect = () => ({ top: T(P()) - 7, bottom: T(P()) - 6, height: 1, left: 0, right: 180, width: 180 });
  };
  const list = w.q('.aad-vtl');
  const row = app => w.qa('.aad-vtab').find(r => r.dataset.app === app);
  const order = () => w.qa('.aad-vtab').map(r => (r.dataset.group === 'pin' ? '^' : '') + r.dataset.app);
  const drag = (app, y, { esc = false } = {}) => {
    rects(); const r = row(app), b = r.getBoundingClientRect();
    r.dispatchEvent(new FakePointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: b.top + 18 }));
    list.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 1, clientX: 20, clientY: y }));
    assert.ok(r.classList.contains('is-drag') && list.dataset.drag === '', 'it floats');
    assert.equal(w.q('.aad-vtdrop').hidden, false, 'the drop line shows');
    if (esc) assert.equal(w.escape(), true, 'Esc cancels');
    else list.dispatchEvent(new FakePointerEvent('pointerup', { pointerId: 1 }));
    w.run(); rects();
  };
  assert.deepEqual(order(), ['^music', '^mail', '^money', 'maps', 'notes', 'movies'], 'the pins (Music not open), then the open apps');
  // within Pinned
  drag('money', 65);
  assert.deepEqual(store.pins, ['money', 'music', 'mail'], 'within Pinned: the pin order'); assert.deepEqual(moves, [], 'no desk moves');
  // within the open apps: Notes to the top of the list = its desk moves (the stock arrange), his order kept
  drag('notes', 190);
  assert.deepEqual(moves, [[1, 3]], 'one stock desk move'); assert.deepEqual(ws, ['wizard', 'money', 'notes', 'maps', 'movies', 'mail']);
  assert.equal(store.vtManual, true, 'ordered by hand');
  assert.deepEqual(order(), ['^money', '^music', '^mail', 'notes', 'maps', 'movies']);
  // open → Pinned: Movies pinned between Money and Music
  drag('movies', 100);
  assert.deepEqual(store.pins, ['money', 'movies', 'music', 'mail'], 'open → Pinned pins it there');
  assert.deepEqual(order(), ['^money', '^movies', '^music', '^mail', 'notes', 'maps']);
  // Pinned → open: Mail (open) to the end of the open apps: unpinned
  drag('mail', 900);
  assert.deepEqual(store.pins, ['money', 'movies', 'music'], 'Pinned → open unpins it'); assert.deepEqual(order(), ['^money', '^movies', '^music', 'notes', 'maps', 'mail']);
  // Esc cancels: nothing changes, nothing left translated
  const pins0 = [...store.pins], ws0 = [...ws];
  drag('money', 900, { esc: true });
  assert.deepEqual(store.pins, pins0); assert.deepEqual(ws, ws0); assert.ok(w.qa('.aad-vtab').every(r => !r.style.translate), 'every row back in place');
  assert.equal(w.q('.aad-vtdrop').hidden, true);
  // a click right after a drag does not open the row
  // Move up / Move down (right click) within its group
  row('maps').dispatchEvent(new FakePointerEvent('contextmenu', { clientX: 10, clientY: 10 }));
  assert.deepEqual(w.qa('.aad-appmenu .aad-pop-i').map(b => b.dataset.act).slice(0, 3), ['pin', 'up', 'down'], 'Pin, Move up, Move down');
  w.q('.aad-appmenu .aad-pop-i[data-act="up"]').dispatchEvent(new FakePointerEvent('click')); w.run();
  assert.deepEqual(order().slice(3), ['maps', 'notes', 'mail'], 'Move up');
  row('movies').dispatchEvent(new FakePointerEvent('contextmenu', { clientX: 10, clientY: 10 }));
  w.q('.aad-appmenu .aad-pop-i[data-act="down"]').dispatchEvent(new FakePointerEvent('click')); w.run();
  assert.deepEqual(store.pins, ['money', 'music', 'movies'], 'Move down in Pinned');
  // badged first only until he orders: a fresh device with no pins shows Money (badged) first; ordered, desk order
  for (const [manualOn, want] of [[false, ['money', 'maps', 'notes']], [true, ['maps', 'money', 'notes']]]) {
    const x = deskWorld(); x.store.pins = []; if (manualOn) x.store.vtManual = true;
    x.w.st.desks = [{ desk: 0, id: 'wizard', name: 'Chats' }, { desk: 1, id: 'maps', name: 'Maps' }, { desk: 2, id: 'money', name: 'Money' }, { desk: 3, id: 'notes', name: 'Notes' }];
    x.w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 0 };
    (await layout()).default(x.w.api);
    assert.deepEqual(x.w.qa('.aad-vtab').map(r => r.dataset.app), want, manualOn ? 'his order (the badge stays on its row)' : 'badged first by default');
  }
  // the layout hook (the real host) and the stock arrange underneath (desk drag on the bar, ⌥⇧[ ])
  const moved = [], D = await layoutApi({ adapter: { moveDesk: (a, b) => { moved.push([a, b]); return true; } } });
  assert.deepEqual([D.api.desks.move(1, 3), D.api.desks.move(-1, 2), D.api.desks.move(1, 2.5), D.api.desks.move('1', 2)], [true, false, false, false], 'the layout hook'); assert.deepEqual(moved, [[1, 3]]);
  const arranged = [], { adapter: bootAdapter } = desktopBoot({ moveDesk: (a, b) => { arranged.push([a, b]); return true; } }), moveDesk = (a, b) => bootAdapter.moveDesk(a, b);
  assert.deepEqual([moveDesk(0, 2), moveDesk(0.5, 1)], [true, false]); assert.deepEqual(arranged, [[0, 2]], 'the stock arrange (desk drag on the bar, ⌥⇧[ ])');
  // the others slide while one is dragged (translate only): desktop.css on the column the view drew
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  const vtl = w.q('.aad-vtl'), [dragged, other] = w.qa('.aad-vtab'), tr = n => cascade(n, DESK_CSS).transition?.value ?? '';
  vtl.dataset.drag = ''; dragged.classList.add('is-drag');
  assert.match(tr(other), /^translate 150ms/, 'the others slide (translate only)'); assert.doesNotMatch(tr(dragged), /^translate 150ms/, 'the dragged row follows the pointer');
  delete vtl.dataset.drag; assert.doesNotMatch(tr(other), /^translate 150ms/, 'no slide when nothing is dragged');
});


// Codex review (PR #888/#889): api.after caps every timer at 10 s, so an hourly tidy must count to its deadline.
test('auto-tidy runs hourly, not on every 10 s timer beat (api.after is capped)', async () => {
  const realNow = Date.now;
  try {
    for (const shell of ['desktop', 'phone']) {
      const w = shell === 'desktop' ? deskWorld().w : world();
      let tidies = 0; const set = w.api.storage.set; w.api.storage.set = (k, v) => { if (k === 'used') tidies++; return set(k, v); };
      let now = realNow(); Date.now = () => now;
      (await layout()).default(w.api);
      const live = () => w.st.timers.filter(t => !t.dead);
      assert.ok(live().every(t => t.ms <= 10e3), shell + ': no hour-long api.after (it would fire after 10 s)');
      assert.ok(live().some(t => t.ms === 6000) && live().some(t => t.ms === 10e3), shell + ': a first tidy soon after start, then a 10 s beat');
      w.run(); const base = tidies; assert.ok(base >= 1, shell + ': the first tidy');
      for (let i = 0; i < 6; i++) { now += 10e3; w.run(); }
      assert.equal(tidies, base, shell + ': a minute of beats: no tidy');
      assert.ok(live().some(t => t.ms === 10e3), shell + ': the beat re-arms itself');
      now += 3600e3; w.run(); assert.equal(tidies, base + 1, shell + ': the hour is up: one tidy');
      now += 10e3; w.run(); assert.equal(tidies, base + 1, shell + ': and the next beat waits for the next hour');
    }
  } finally { Date.now = realNow; }
});

/* ---------- round 18 (Miguel, 3 Nov 2026) ---------- */
test('round 18 parts: Ready sorts (stock Priority / Newest / Oldest), grouped like the rail, the ⌥↓ step; tidy words and sentence', async () => {
  const P = await import('../web/layouts/ai-apps/parts.js');
  const at = h => new Date(Date.UTC(2026, 10, 3, h)).toISOString();
  const rows = [
    { id: 'c1', title: 'old fyi', state: 'fyi', rank: 3, at: at(1) },
    { id: 'c2', title: 'needs', state: 'needs', rank: 1, at: at(2) },
    { id: 'notif:n1', title: 'urgent note', note: true, needs: true, rank: 1, at: at(5) },
    { id: 'c3', title: 'plain new', state: 'none', rank: 5, at: at(6) },
    { id: 'c4', title: 'approve', state: 'approval', rank: 0, at: at(0) },
    { id: 'notif:n2', title: 'read note', note: true, snoozed: true, rank: 3, at: at(7) },
    { id: 'notif:n3', title: 'fyi note', note: true, rank: 3, at: at(4) },
  ];
  const ids = l => l.map(r => r.id);
  assert.deepEqual(ids(P.readySort(rows, 'priority')), ['c4', 'notif:n1', 'c2', 'notif:n3', 'c1', 'c3', 'notif:n2'], 'Priority: rank, newest first inside; notifications among the chats; read ones last');
  assert.deepEqual(ids(P.readySort(rows, 'newest')), ['c4', 'c3', 'notif:n1', 'notif:n3', 'c2', 'c1', 'notif:n2'], 'Newest: approvals pinned first, then time');
  assert.deepEqual(ids(P.readySort(rows, 'oldest')), ['c4', 'c1', 'c2', 'notif:n3', 'notif:n1', 'c3', 'notif:n2'], 'Oldest: approvals pinned, then time reversed');
  assert.equal(P.sortOf('subject'), 'priority', 'stock By subject reads as Priority here'); assert.equal(P.sortOf('newest'), 'newest');
  assert.deepEqual(P.readyGroups(rows, 'newest').map(g => g.state + ':' + ids(g.rows).join()), ['needs:notif:n1,c2', 'approval:c4', 'fyi:notif:n3,c1', 'deferred:notif:n2', 'none:c3'], 'grouped in the rail\'s order (STATES), the order inside');
  assert.deepEqual(P.readyGroups(rows, 'oldest').map(g => g.state + ':' + ids(g.rows).join()), ['needs:c2,notif:n1', 'approval:c4', 'fyi:c1,notif:n3', 'deferred:notif:n2', 'none:c3']);
  assert.equal(P.readyGroups(rows, 'priority').at(-1).word, 'No status');
  // One list (the default) is the chosen Sort alone, never Needs you hoisted to the top (James, 4 Nov 2026)
  assert.deepEqual(ids(P.readyFlat(rows, 'newest')), ids(P.readySort(rows, 'newest')), 'One list, Newest: newest first');
  assert.deepEqual(ids(P.readyFlat(rows, 'newest', 'none')), ['c4', 'c3', 'notif:n1', 'notif:n3', 'c2', 'c1', 'notif:n2']);
  assert.deepEqual(ids(P.readyFlat(rows, 'oldest', 'none')), ids(P.readySort(rows, 'oldest')), 'One list, Oldest: oldest first');
  assert.deepEqual(ids(P.readyFlat(rows, 'newest', 'status')), P.readyGroups(rows, 'newest').flatMap(g => ids(g.rows)), 'By status: the groups in turn');
  assert.deepEqual(P.readyStep(['a', 'b', 'c'], null, 1), { id: 'a', wrapped: false }, 'from elsewhere: the top');
  assert.deepEqual(P.readyStep(['a', 'b', 'c'], 'x', -1), { id: 'a', wrapped: false });
  assert.deepEqual(P.readyStep(['a', 'b', 'c'], 'b', 1), { id: 'c', wrapped: false });
  assert.deepEqual(P.readyStep(['a', 'b', 'c'], 'c', 1), { id: 'a', wrapped: true }, 'past the end: back to the top');
  assert.deepEqual(P.readyStep(['a', 'b', 'c'], 'a', -1), { id: 'c', wrapped: true });
  assert.equal(P.readyStep([], null, 1), null);
  assert.ok(/needs approval first, then Needs you, Your call, FYI, Done/.test(P.PRIORITY_TIP), 'the Priority rule in words (the tooltip)');
  assert.equal(P.tidyLine('24h'), 'Unused apps close after 24h'); assert.equal(P.tidyLine('week'), 'Unused apps close after 1 week'); assert.equal(P.tidyLine('off'), 'Unused apps stay open');
  assert.equal(P.tidyWords(3, '24h'), 'Closed 3 apps you hadn\'t used in 24 hours');
});

test('round 18 item 3b + 4e desktop (Activity since issue 1258: the one sort, chosen in Settings): ⌥↓ / ⌥↑ walk exactly the drawn Ready, wrapping', async () => {
  const at = h => new Date(Date.UTC(2026, 10, 3, h)).toISOString();
  const row = (id, title, state, h, extra = {}) => ({ id, title, kind: 'ready', state, at: at(h), unread: false, pinned: false, actions: ['snooze', 'done'], ...extra });
  for (const order of ['priority', 'subject', 'newest', 'oldest']) {
    const { w, keys } = deskWorld();
    let saved = order, sets = [];
    w.api.sessions.order = () => saved; w.api.sessions.setOrder = o => { sets.push(o); saved = o; return true; };
    w.st.sessions.ready = [row('c1', 'Old fyi', 'fyi', 1), row('c2', 'Needs me', 'needs', 2), row('notif:n1', 'Urgent note', '', 5, { note: true, needs: true }), row('c3', 'Plain', 'none', 6),
      row('c4', 'Approve', 'approval', 0), row('notif:n3', 'FYI note', '', 4, { note: true }), row('c5', 'Newer fyi', 'fyi', 8), row('notif:n2', 'Read note', '', 7, { note: true, snoozed: true })];
    (await layout()).default(w.api);
    const drawn = w.qa('#aad-sec-ready .aad-rw').map(n => n.dataset.sid);
    assert.equal(drawn.length, 8, order + ': every Ready row drawn');
    assert.equal(w.q('#aad-sec-ready .aad-grp'), null, order + ': Activity draws Ready as one list (Channels do the grouping)');
    assert.ok(w.q('.aad-sech .aad-act-orderb'), 'the one sort always on Ready\'s header');
    const want = globalThis.WizChatsListModel.activitySortOf(order);
    assert.equal(w.q('[data-aad-act-order][aria-checked="true"]').dataset.aadActOrder, want, order + ': the stock choice in Settings (By subject reads as Newest)');
    const alt = code => keys.find(h => h.down({ altKey: true, code, key: code }) === true);
    const seq = [];
    for (let i = 0; i < drawn.length; i++) {
      assert.ok(alt('ArrowDown'), '⌥↓ handled by the view');
      const id = w.st.opened.at(-1).replace(/^thread:/, ''); seq.push(id);
      w.st.route = id.startsWith('notif:') ? { home: false, view: 'thread', thread: '__new__', desk: 1 } : { home: false, view: 'thread', thread: id, desk: 1 };
    }
    assert.deepEqual(seq, drawn, order + ': ⌥↓ = the drawn order, top to bottom');
    alt('ArrowDown'); assert.equal(w.st.opened.at(-1), 'thread:' + drawn[0], order + ': past the end, back to the top');
    assert.equal(w.q('.aad-toast-w').textContent, 'Back to the top of Ready');
    w.st.route = { home: false, view: 'thread', thread: drawn[0], desk: 1 };
    alt('ArrowUp'); assert.equal(w.st.opened.at(-1), 'thread:' + drawn.at(-1), order + ': ⌥↑ from the top wraps to the bottom');
    // the choice goes through the stock Filter's saved order (api.sessions.setOrder)
    const other = want === 'oldest' ? 'newest' : 'oldest';
    w.q(`[data-aad-act-order="${other}"]`).dispatchEvent(new FakePointerEvent('click'));
    assert.deepEqual(sets, [other], 'saved through the stock order (api.sessions.setOrder)');
    const again = w.qa('#aad-sec-ready .aad-rw').map(n => n.dataset.sid);
    w.st.route = { home: true, view: 'desk', thread: null, desk: 1 }; alt('ArrowDown');
    assert.equal(w.st.opened.at(-1).replace(/^thread:/, ''), again[0], 'from Home: the top of the new order');
  }
});

test('round 18 phone: the tidy line under + opens the sentence sheet; the tidy toast has Undo; the drawer sorts Ready by the stock Filter choice', async () => {
  const w = world();
  let saved = 'newest'; const sets = [];
  w.api.sessions.order = () => saved; w.api.sessions.setOrder = o => { sets.push(o); saved = o; return true; };
  const closed = []; w.api.apps.close = id => { closed.push(id); w.st.desks = w.st.desks.filter(d => d.id !== id); return true; };
  w.st.store.used = { notes: Date.now() - 30 * 3600e3, maps: Date.now() - 40 * 3600e3, mail: Date.now() - 50 * 3600e3 };
  (await layout()).default(w.api);
  w.st.route = { home: true, view: 'desk', thread: null, desk: 0 }; w.emit('route', w.st.route);
  const line = w.q('.ah-grid .ah-tidy');
  assert.ok(line, 'the line at Home\'s end'); assert.equal(line.textContent, 'Unused apps close after 24h · Change');
  line.dispatchEvent(new FakePointerEvent('click'));
  const sheet = w.q('.aa-tsheet'); assert.ok(sheet, 'a small sheet');
  assert.equal(sheet.querySelector('.aa-tidys').textContent, 'Tidy up: close apps you haven\'t used in Off12 hours24 hours1 week. Pinned apps always stay open.');
  const sel = sheet.querySelector('select'); sel.value = 'week'; sel.dispatchEvent(new FakePointerEvent('change'));
  assert.equal(w.st.store.tidy, 'week'); assert.equal(line.textContent, 'Unused apps close after 1 week · Change');
  w.st.backs.at(-1)(); assert.equal(w.q('.aa-tsheet'), null, 'Back closes it');
  w.st.store.tidy = '24h';
  for (const tm of w.st.timers.filter(x => x.ms === 6000)) tm.fn();
  assert.deepEqual(closed.sort(), ['maps', 'notes'], 'only unpinned, stale apps (Mail is pinned)');
  assert.equal(w.q('.ah-toast').hidden, false); assert.equal(w.q('.ah-toast-w').textContent, 'Closed 2 apps you hadn\'t used in 24 hours');
  assert.equal(w.q('.ah-toast-u').textContent, 'Undo');
  const n0 = w.st.newChats; w.q('.ah-toast-u').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.st.opened.slice(-2).sort(), ['maps', 'notes'], 'Undo opens them again'); assert.equal(w.st.newChats, n0 + 1, 'and comes back Home');
  // the drawer: Ready in the stock order, notifications among the chats
  const at = h => new Date(Date.UTC(2026, 10, 3, h)).toISOString();
  w.st.sessions.ready = [{ id: 'r1', title: 'A', kind: 'ready', state: 'fyi', at: at(1), actions: [] }, { id: 'notif:x', title: 'N', kind: 'ready', note: true, needs: true, at: at(3), actions: [] }, { id: 'r2', title: 'B', kind: 'ready', state: 'needs', at: at(2), actions: [] }];
  w.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  const ready = () => w.qa('#aa-sec-ready [data-sid]').map(n => n.dataset.sid);
  assert.deepEqual(ready(), ['notif:x', 'r2', 'r1'], 'Newest');
  // This fixture's selector parser splits on whitespace, even inside attribute values.
  const sort = w.qa('.aa-sort').find(n => n.getAttribute('aria-label') === 'Order Ready');
  assert.ok(sort, 'Ready keeps its own control beside Working');
  const workingSort = w.qa('.aa-sort').find(n => n.getAttribute('aria-label') === 'Sort Working');
  assert.ok(workingSort, 'Working has its separate control');
  assert.equal(workingSort.value, 'alphabetical');
  assert.equal(sort.value, 'newest'); assert.match(sort.getAttribute('title'), /^Priority: needs approval first/);
  sort.value = 'oldest'; sort.dispatchEvent(new FakePointerEvent('change'));
  assert.deepEqual(sets, ['oldest']); assert.deepEqual(ready(), ['r1', 'r2', 'notif:x'], 'Oldest');
});

test('round 18 core: Ready\'s order is the stock Chats Filter choice (its key, the box preferences); rows carry the stock Priority rank', async () => {
  // (the stock Priority rank on each row and on notification rows: tests/chats-list-model.test.mjs 'both shell adapters
  // delegate one projection, ...' and 'folded notifications have the same Priority in real core fold and host, ...')
  const f = fixture({ shell: 'desktop' }), prefs = [], events = [];
  let api = null; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  f.ctx.window.WizLive = { putPrefs: p => prefs.push({ ...p }) }; f.ctx.window.dispatchEvent = e => events.push(e.type);
  f.host.setStandardLayout('ai-apps'); await settle();
  assert.ok(api, 'the AI apps layout got its API');
  const chatsKey = vm.runInNewContext(between(withParts(read('web/core/chats.js')), 'const READY_ORDER_KEY = ', ';') + '; READY_ORDER_KEY');
  assert.equal(chatsKey, 'wos.chats.readyOrder.v1', 'Chats\' own key');
  assert.equal(api.sessions.order(), 'newest', 'nothing saved: Newest, as in Chats');
  f.lsMap.set(chatsKey, 'oldest'); assert.equal(api.sessions.order(), 'oldest', 'the view reads what the Chats Filter saved');
  assert.equal(api.sessions.setOrder('priority'), true);
  assert.equal(f.lsMap.get(chatsKey), 'priority', 'saved where Chats saves it');
  assert.deepEqual(prefs, [{ readyOrder: 'priority' }], 'shared with the box preferences'); assert.deepEqual(events, ['wos:prefs'], 'and Chats repaints');
  assert.equal(api.sessions.order(), 'priority');
  assert.equal(api.sessions.setOrder('bogus'), false, 'only the stock choices'); assert.equal(f.lsMap.get(chatsKey), 'priority'); assert.equal(prefs.length, 1);
});

test('round 18 item 3c / round 21 desktop: ⌥A the picker, ⌥K the search, ⌥O workspaces, ⌥1–9 + ⌥0 and ⌥[ ] the right column, ⌥⇧[ ] move a row, ⌥− / ⌥= the panel, ⌥W on Home and ⌥⇧digit inert', async () => {
  const { w, keys, store } = deskWorld();
  w.st.desks = null;
  let list = [{ desk: 1, id: 'wizard', name: 'Chats' }, { desk: 2, id: 'maps', name: 'Maps' }, { desk: 3, id: 'mail', name: 'Mail' }, { desk: 4, id: 'notes', name: 'Notes' }];
  w.api.desks.list = () => list; w.api.desks.move = () => true; w.api.desks.close = () => true;
  store.pins = ['mail', 'money'];
  (await layout()).default(w.api);
  const alt = (code, shift = false) => keys.some(h => h.down({ altKey: true, shiftKey: shift, code, key: code }) === true);
  const rows = () => w.qa('.aad-vtab').map(b => b.dataset.app);
  assert.deepEqual(rows(), ['mail', 'money', 'maps', 'notes']);
  assert.ok(alt('KeyA')); assert.equal(w.html.dataset.vcSheet, 'open', '⌥A = the picker (add an app)');
  assert.ok(alt('KeyK'), 'a modal in front takes every other ⌥ key'); assert.equal(w.q('.aad-search').hidden, true, '… and does nothing with it');
  assert.ok(alt('KeyA')); assert.equal(w.html.dataset.vcSheet, undefined, '⌥A again closes it');
  assert.ok(alt('KeyK')); assert.equal(w.q('.aad-search').hidden, false, '⌥K = the sidebar search');
  for (const k of ['KeyG', 'Slash', 'KeyI', 'Backslash', 'Period', 'Comma', 'KeyJ', 'KeyM', 'KeyQ', 'KeyU', 'KeyY', 'Enter']) assert.ok(alt(k), `⌥${k} is taken and does nothing (no ⌥G letters, no app letters, no ⌥/ guide)`);
  const g0 = w.st.gone.length, o0 = w.st.opened.length;
  assert.ok(alt('Digit1')); assert.equal(w.st.gone.at(-1), 3, '⌥1 = the first row (Mail, desk 3)');
  assert.ok(alt('Digit2')); assert.equal(w.st.opened.at(-1), 'money', '⌥2 = the second row (a pin not open: it opens)');
  assert.ok(alt('Digit3')); assert.equal(w.st.gone.at(-1), 2);
  const g2 = w.st.gone.length; assert.ok(alt('Digit0'), '⌥0 = the tenth row (none here)'); assert.equal(w.st.gone.length, g2);
  const g1 = w.st.gone.length; assert.ok(alt('Digit3', true)); assert.equal(w.st.gone.length, g1, '⌥⇧3 does nothing here');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 2 }; w.emit('route', w.st.route);
  assert.ok(alt('KeyA')); w.emit('render'); assert.equal(w.html.dataset.vcSheet, 'open', 'with an app in front ⌥A\'s picker stays open through a repaint (live: it flashed shut)');
  assert.ok(alt('KeyA')); assert.equal(w.html.dataset.vcSheet, undefined);
  assert.ok(alt('BracketRight')); assert.equal(w.st.gone.at(-1), 4, '⌥] = the next row (Notes)');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; w.emit('route', w.st.route);
  assert.ok(alt('BracketLeft')); assert.equal(w.st.gone.at(-1), 2, '⌥[ = the previous row (Maps)');
  assert.ok(alt('BracketRight')); assert.equal(w.st.gone.at(-1), 3, 'past the last row: back to the first (Mail)');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; w.emit('route', w.st.route);
  assert.ok(alt('BracketRight', true)); assert.ok(alt('BracketLeft', true), '⌥⇧[ ] move the row in front');
  w.st.route = { home: true, view: 'desk', thread: null, desk: 1 }; w.emit('route', w.st.route);
  const c0 = JSON.stringify(w.st.gone); assert.ok(alt('KeyW'), '⌥W on Home is taken'); assert.equal(JSON.stringify(w.st.gone), c0, 'and does nothing (it closed the Chats window behind Home)');
  assert.ok(alt('Minus') && alt('Equal'), '⌥− / ⌥= taken (the app panel\'s width when one shows)');
  assert.ok(g0 >= 0 && o0 >= 0);
});

/* ---------- round 19 (Miguel, 3 Nov 2026) ---------- */
test('round 19 parts: the order inside each group (Newest / Oldest; stock Priority and By subject read as Newest), a rail item\'s chats, the current item, short times', async t => {
  const tz = process.env.TZ; process.env.TZ = 'UTC';
  t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
  const P = await import('../web/layouts/ai-apps/parts.js');
  assert.deepEqual(P.GROUP_ORDERS.map(o => o[1]), ['Newest first', 'Oldest first']);
  for (const [o, want] of [['newest', 'newest'], ['oldest', 'oldest'], ['priority', 'newest'], ['subject', 'newest'], [undefined, 'newest']]) assert.equal(P.groupOrder(o), want);
  const at = h => new Date(Date.UTC(2026, 10, 3, h)).toISOString();
  const s = { snoozed: [{ id: 'z1' }], ready: [{ id: 'n1', state: 'needs', at: at(1) }, { id: 'n2', state: 'needs', at: at(3) }, { id: 'f1', state: 'fyi', at: at(2) }, { id: 'p1', state: 'none', at: at(4) }] };
  const ids = l => l.map(r => r.id);
  assert.deepEqual(ids(P.railRows(s, 'needs', 'newest')), ['n2', 'n1']); assert.deepEqual(ids(P.railRows(s, 'needs', 'oldest')), ['n1', 'n2']);
  assert.deepEqual(ids(P.railRows(s, 'ready', 'newest')), ['p1', 'n2', 'f1', 'n1'], 'One list defaults to Newest across statuses (what ⌥↓ walks)');
  assert.deepEqual(ids(P.railRows(s, 'ready', 'oldest', 'none')), ['n1', 'f1', 'n2', 'p1'], 'One list, Oldest across statuses');
  assert.deepEqual(ids(P.railRows(s, 'ready', 'newest', 'status')), ['n2', 'n1', 'f1', 'p1'], 'By status keeps priority groups, Newest inside each');
  assert.deepEqual(ids(P.railRows(s, 'ready', 'oldest', 'status')), ['n1', 'n2', 'f1', 'p1'], 'By status keeps priority groups, Oldest inside each');
  assert.deepEqual(ids(P.railRows(s, 'snoozed', 'newest')), ['z1']);
  assert.deepEqual(P.railActive(s, 'n1', '', 'newest'), { key: 'needs', i: 1, n: 2 }, 'derived: its status group');
  assert.deepEqual(P.railActive(s, 'n1', 'ready', 'newest'), { key: 'ready', i: 3, n: 4 }, 'the item last clicked while the chat is in it, at its Newest position');
  assert.deepEqual(P.railActive(s, 'p1', 'needs', 'newest'), { key: 'ready', i: 0, n: 4 }, 'a plain chat: Ready, at its Newest position');
  assert.deepEqual(P.railActive(s, 'n1', 'ready', 'oldest', 'list'), { key: 'ready', i: 0, n: 4 }, 'One list position follows Oldest too');
  assert.deepEqual(P.railActive(s, 'n1', 'ready', 'newest', 'groups'), { key: 'needs', i: 1, n: 2 }, 'By status keeps the current status group and its position');
  assert.equal(P.railActive(s, null, 'needs', 'newest'), null, 'Home: nothing current');
  assert.deepEqual(P.railNext(['a', 'b', 'c'], null), { id: 'a', wrapped: false }); assert.deepEqual(P.railNext(['a', 'b', 'c'], 'c'), { id: 'a', wrapped: true });
  const now = Date.UTC(2026, 10, 3, 5); // fixed UTC clock: yesterday afternoon is still less than 24h ago
  assert.equal(P.shortTime(new Date(now - 5 * 60e3).toISOString(), now), '5m'); assert.equal(P.shortTime(new Date(now - 3 * 3600e3).toISOString(), now), '3h');
  assert.equal(P.shortTime(new Date(Date.UTC(2026, 10, 2, 14)).toISOString(), now), '15h');
  assert.equal(P.shortTime(new Date(Date.UTC(2026, 10, 2, 1)).toISOString(), now), 'Mon 2');
  assert.equal(P.shortTime(new Date(Date.UTC(2026, 9, 12, 9)).toISOString(), now), 'Mon 12');
  assert.equal(P.shortTime('', now), '');
});

test('round 19 item 1 desktop: the folded rail used as it is: first, next, wrap, the item marked with its place; the hover flyout (300 ms), a pick, Esc; nothing expands', async () => {
  // Activity (Channels on for everyone, wizard-ux issue 1258): the rail is Working, Snoozed, then Ready as one list.
  const { w, keys } = deskWorld();
  let order = 'newest';
  w.api.sessions.order = () => order; w.api.sessions.setOrder = o => { order = o; return true; };
  const at = h => new Date(Date.UTC(2026, 10, 3, h)).toISOString();
  const row = (id, title, state, h) => ({ id, title, kind: 'ready', state, at: at(h), unread: false, pinned: false, actions: ['snooze', 'done'] });
  w.st.sessions.ready = [row('n1', 'Needs old', 'needs', 1), row('n2', 'Needs mid', 'needs', 2), row('n3', 'Needs new', 'needs', 3), row('f1', 'An fyi', 'fyi', 4), row('p1', 'Plain', 'none', 5)];
  w.st.sessions.snoozed = [{ id: 's1', title: 'Later', kind: 'snoozed', at: at(0), actions: [] }];
  const stage = new El('div'); stage.id = 'stage'; const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats';
  chatDesk.append(dchats); stage.append(chatDesk); w.html.children[0].append(stage);
  (await layout()).default(w.api);
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.html.dataset.aadSide, 'rail');
  assert.deepEqual(w.q('.aad-rlist').children.map(n => n.dataset.k), ['working', 'snoozed', 'ready'], 'One list on the rail');
  const go = id => { w.st.route = id.startsWith('notif:') ? { home: false, view: 'thread', thread: '__new__', desk: 1 } : { home: false, view: 'thread', thread: id, desk: 1 }; w.emit('route', w.st.route); };
  const click = k => { w.q(`.aad-rk[data-k="${k}"]`).dispatchEvent(new FakePointerEvent('click')); const id = w.st.opened.at(-1).replace(/^thread:/, ''); go(id); return id; };
  assert.equal(click('ready'), 'p1', 'its first chat (One list = Newest across statuses)');
  assert.equal(w.html.dataset.aadSide, 'rail', 'the rail stays folded'); assert.equal(w.html.dataset.aadChat, 'on', 'the chat in the docked column');
  const ready = w.q('.aad-rk[data-k="ready"]');
  assert.ok(ready.classList.contains('is-on') && ready.getAttribute('aria-current') === 'true', 'the current item marked');
  assert.equal(w.q('.aad-rk[data-k="ready"] .aad-rk-p').textContent, '1/5', 'its place, under the word'); assert.equal(click('ready'), 'f1');
  assert.equal(w.q('.aad-rk[data-k="ready"] .aad-rk-p').textContent, '2/5');
  assert.deepEqual([click('ready'), click('ready'), click('ready'), click('ready')], ['n3', 'n2', 'n1', 'p1'], 'One list walks Newest, then wraps to the newest chat');
  for (const [sort, want] of [['oldest', ['n1', 'n2', 'n3', 'f1', 'p1']], ['newest', ['p1', 'f1', 'n3', 'n2', 'n1']]]) {
    w.st.setting[1].querySelector(`[data-aad-act-order="${sort}"]`).dispatchEvent(new FakePointerEvent('click'));
    w.st.timers.length = 0; w.q('.aad-rk[data-k="ready"]').dispatchEvent(new FakePointerEvent('pointerenter'));
    w.st.timers.find(h => h.ms === 300 && !h.dead).fn();
    assert.deepEqual(w.qa('.aad-fly-i').map(n => n.dataset.sid), want, `the flyout follows ${sort}`);
    w.q(`.aad-fly-i[data-sid="${want[0]}"]`).dispatchEvent(new FakePointerEvent('click')); go(want[0]);
    assert.equal(w.q('.aad-fly'), null, 'closed after the pick'); assert.equal(w.html.dataset.aadSide, 'rail');
    assert.equal(w.q('.aad-rk[data-k="ready"] .aad-rk-p').textContent, '1/5');
    assert.deepEqual(want.map(() => click('ready')), [...want.slice(1), want[0]], `the rail follows ${sort}, including wrap`);
  }
  assert.equal(click('snoozed'), 's1'); assert.equal(w.q('.aad-rk[data-k="snoozed"] .aad-rk-p'), null, 'one chat: no 1/1');
  // ⌥↓ still walks the whole Ready, in the order the sidebar draws it (Activity: the session list's own order)
  const alt = code => keys.find(h => h.down({ altKey: true, code, key: code }) === true);
  go('n3'); alt('ArrowDown'); assert.equal(w.st.opened.at(-1), 'thread:f1');
  // hover: a flyout after 300 ms listing the item's chats (title, time); Esc closes it (before closing the chat)
  w.st.timers.length = 0;
  w.q('.aad-rk[data-k="ready"]').dispatchEvent(new FakePointerEvent('pointerenter'));
  assert.equal(w.q('.aad-fly'), null, 'not at once');
  const t = w.st.timers.find(h => h.ms === 300); assert.ok(t, 'a 300 ms hover delay'); t.fn();
  assert.equal(w.q('.aad-fly .aad-pop-h').textContent, 'Inbox · 5');
  assert.equal(w.q('.aad-fly-i .aad-fly-t').textContent, 'Plain'); assert.ok(w.q('.aad-fly-i .aad-fly-at'), 'and its time');
  assert.equal(w.escape(), true);
  assert.equal(w.q('.aad-fly'), null, 'Esc closes the flyout'); assert.equal(w.html.dataset.aadChat, 'on', 'and only the flyout');
  // no rail item expands the sidebar; the source never calls the old openSection
  assert.ok(!/openSection\(/.test(noComments(read('web/layouts/ai-apps/desktop.js'))), 'no rail item expands the sidebar');
  assert.ok(!/sessions\.open[^\n]*send|leaveAfterSend/.test(noComments(read('web/layouts/ai-apps/desktop.js'))), 'nothing advances on send');
});

test('round 19 item 2 / round 22 desktop (Activity since issue 1258): one Sort (Newest / Oldest / Needs you first, the stock key) as a drop-down on Ready\'s header, always shown, no Group; Settings follows', async () => {
  const { w } = deskWorld();
  let saved = 'subject'; const sets = [];
  w.api.sessions.order = () => saved; w.api.sessions.setOrder = o => { sets.push(o); saved = o; return true; };
  (await layout()).default(w.api);
  assert.equal(w.st.setting[0], 'ai-apps-order', 'this view\'s group in Settings');
  const node = w.st.setting[1];
  assert.equal(node.children[0].tagName + ':' + node.children[0].textContent, 'H4:AI apps view');
  assert.deepEqual(node.querySelectorAll('[data-aad-act-order]').map(b => b.querySelector('b').textContent + ':' + b.getAttribute('aria-checked')), ['Newest first:true', 'Oldest first:false', 'Needs you first:false'], 'stock By subject reads as Newest');
  assert.equal(node.querySelector('[data-aad-group]'), null, 'no grouping: Channels do the grouping now');
  assert.equal(node.querySelector('[data-aad-sortshown]'), null, 'round 22: no "Show sort control" switch any more'); assert.equal(w.q('.aad-sort'), null, 'no native select anywhere');
  const b = w.q('.aad-sech .aad-act-orderb'); assert.ok(b, 'shown on Ready\'s header from the start'); assert.equal(b.querySelector('.aad-sortb-w').textContent, 'Newest');
  assert.equal(w.q('.aad-sech .aad-groupb'), null, 'no Group drop-down');
  b.dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(w.qa('.aad-sortmenu .aad-pop-h').map(n => n.textContent), ['Sort'], 'the sort menu holds only the order');
  assert.deepEqual(w.qa('.aad-sortmenu .aad-pop-i').map(n => n.textContent + ':' + n.getAttribute('aria-checked')), ['Newest first:true', 'Oldest first:false', 'Needs you first:false']);
  w.q('.aad-sortmenu [data-act-order="oldest"]').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(sets, ['oldest']); assert.equal(w.q('.aad-sortmenu'), null);
  assert.equal(w.q('.aad-act-orderb .aad-sortb-w').textContent, 'Oldest'); assert.equal(w.st.setting[1].querySelector('[data-aad-act-order="oldest"]').getAttribute('aria-checked'), 'true', 'Settings follows');
  w.st.setting[1].querySelector('[data-aad-act-order="priority"]').dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(sets, ['oldest', 'priority']);
  assert.equal(w.q('.aad-act-orderb .aad-sortb-w').textContent, 'Needs you', 'the header follows Settings');
  // desktop.css on the control and the menu the view drew (wizard-ux issue 1674)
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  const ob = w.q('.aad-act-orderb'); assert.ok(ob.classList.contains('aad-sortb'));
  assert.equal(cascade(ob, DESK_CSS).font?.value, '400 0.6875rem / 1 var(--wz-font-ui)', 'the control in the shell\'s font token');
  ob.dispatchEvent(new FakePointerEvent('click'));
  const mi = cascade(w.q('.aad-sortmenu .aad-pop-i'), DESK_CSS);
  assert.deepEqual([mi.height?.value, mi.gap?.value], ['36px', '10px'], 'its menu is the view\'s own menu (the shell type), not a native list');
  // core (the real host): a layout's group in Settings › Chats & app screens, released on teardown
  const regs = [], unregs = [], slotKids = [];
  const D = await layoutApi({ extra: ctx => { ctx.WosSettings = { register: r => { regs.push(r); return () => unregs.push(r.id); } }; } });
  let removed = 0; const group = { parentNode: null, append() {}, remove() { removed++; }, contains: () => false };
  D.api.desk.setting('ai-apps-order', group);
  assert.deepEqual(regs.map(r => [r.id, r.page]), [['layout-ai-apps-order', 'chats']], 'one group on the Chats page');
  regs[0].painted({}, { firstElementChild: { append: n => slotKids.push(n) } }); assert.deepEqual(slotKids, [group], 'its node painted into the group');
  D.host.setLayout('classic'); await settle();
  assert.deepEqual([unregs, removed], [['layout-ai-apps-order'], 1], 'released on teardown');
});

test('round 19 item 3 desktop: a quieter expanded sidebar (small muted normal-weight headers, Ready\'s amber count kept, Archive quietest); rows unchanged', async () => {
  const css = read('web/layouts/ai-apps/desktop.css'), at19 = css.indexOf('/* ---------- round 19'), r19 = css.slice(at19, css.indexOf('/* ---------- round', at19 + 10));
  const p = await panelDesk(), { w, style } = p;
  const sec = style(w.q('.aad-sec[data-sec="ready"]'));
  assert.deepEqual([sec('height'), sec('color'), sec('font')], ['26px', 'var(--aad-ink-3)', '400 0.75rem / 1 var(--wz-font-ui)'], 'section headers 12 px, muted, normal weight');
  assert.equal(style(w.html)('--aad-ink-3'), 'var(--wz-text-muted, var(--ink-3, var(--aad-ink-2)))', 'the muted ink from the skin');
  assert.equal(style(w.q('.aad-sec[data-sec="archive"]'))('font-size'), '0.6875rem', 'Archive the quietest');
  const chev = w.q('.aad-sec[data-sec="ready"] .aad-sec-c'), c = style(chev);
  assert.deepEqual([c('width'), c('height'), c('stroke-width'), c('opacity')], ['12px', '12px', '1.6', '0'], 'no heavy chevron on an open section');
  assert.equal(style(chev, { states: [':hover'] })('opacity'), '.7', 'a hairline chevron on hover');
  assert.equal(style(w.q('.aad-sec[data-sec="working"] .aad-sec-c'))('opacity'), '.7', 'shown while folded');
  assert.equal(style(w.q('.aad-sec[data-sec="ready"] .aad-sec-n'))('font'), '700 0.6875rem / 1 var(--wz-font-ui)', 'Ready keeps its count, smaller');
  // a status sub-header as desktop-sidepaint.js draws it under Ready ('Group Ready by status'; Activity mode draws none)
  const grp = node('div', 'aad-grp'); grp.dataset.state = 'needs'; w.q('#aad-sec-ready').insertBefore(grp, w.q('#aad-sec-ready .aad-rw'));
  assert.deepEqual([style(grp)('color'), style(grp)('font')], ['var(--aad-ink-3)', '400 0.6875rem / 1 var(--wz-font-ui)'], 'status sub-headers 11 px, muted');
  // rows unchanged: no round 19 rule reaches a drawn row or its title
  assert.ok(Object.keys(cascade(grp, r19)).length, 'the round 19 block (it styles the sub-header)');
  for (const sel of ['.aad-rw', '.aad-row', '.aad-row-t']) { const n = w.q(sel); assert.ok(n, 'drawn: ' + sel); assert.deepEqual(Object.keys(cascade(n, r19)), [], 'round 19 leaves ' + sel + ' as it was'); }
});



/* Round 20 (Miguel, 3 Nov 2026): hold-⌥ hints that read at a glance in every state, ⌥. Focus, the open item's keys,
 * quiet notification rows and threads, a flat Ready by default. */
test('round 21: no legend card anywhere: the shell draws only the view\'s keycaps (no desktop chips, no footer line)', async () => {
  const { keyLegend } = await import(new URL('web/layouts/ai-apps/parts.js', root).href);
  assert.equal(keyLegend, undefined, 'no legend helper');
  const desk = read('web/desktop/desktop.js'), host = withSkinHostParts(read('web/core/skin-host.js'));
  assert.doesNotMatch(desk, /keysCard|kh-keys|keyLegend/, 'no legend card in the shell');
  assert.doesNotMatch(host, /legend\(fn\)|keyLegend/, 'no api.keys.legend');
  assert.doesNotMatch(read('web/desktop/desktop.css'), /\.kh-keys/); assert.doesNotMatch(read('web/layouts/ai-apps/desktop.css'), /\.kh-keys/);
  // the real host: a guide given { only: true } makes the shell draw only the layout's chips
  const D = await layoutApi(), target = { tagName: 'BUTTON' };
  const offPlain = D.api.keys.guide(() => [{ el: target, key: 'K' }]);
  assert.equal(D.host.keysOnly, false, 'a plain guide adds to the shell\'s chips');
  const offOnly = D.api.keys.guide(() => [{ el: target, key: 'N', at: 'tr' }], { only: true });
  assert.equal(D.host.keysOnly, true, 'only the view\'s chips'); assert.deepEqual([...D.host.keyChips().map(c => c.key + (c.at || ''))], ['K', 'Ntr']);
  offOnly(); assert.equal(D.host.keysOnly, false, 'released with its guide'); offPlain();
  // the real desktop keys guide: keysOnly = the view's chips at their spots, then nothing else
  const spots = ['tl', 'tr', 'bl', 'right', 'right-up', 'right-dn', 'mid'];
  const box = i => { const left = 100 + (i % 4) * 350, top = 200 + Math.floor(i / 4) * 300; return { left, top, right: left + 200, bottom: top + 100, width: 200, height: 100, x: left, y: top }; };
  let viewChips = [];
  const g = keysGuide({ rect: n => /^aiT\d$/.test(n.id || '') ? box(+n.id.slice(3)) : null,
    window: { getComputedStyle: () => ({ visibility: 'visible' }), WosSkinHost: { get keysOnly() { return viewChips.length > 0; }, keyChips: () => viewChips } } });
  const own = g.show().length; assert.ok(own > 0, 'the shell\'s own chips without a view');
  viewChips = spots.map((at, i) => ({ el: g.add(`<button id="aiT${i}">x</button>`), key: String(i), at }));
  const drawn = g.show();
  assert.deepEqual(drawn.map(c => c.key), spots.map((_, i) => String(i)), 'only the view\'s chips, then nothing else');
  assert.ok(g.document.documentElement.classList.contains('key-hints-on'));
  // each keycap spot where its name says, on its own target (chip 20 x 16)
  const at = {}; for (const c of g.document.querySelectorAll('#keyHints .kh-chip')) { const i = +c.textContent.trim()[0], r = box(i), x = parseFloat(c.style.left), y = parseFloat(c.style.top); at[spots[i]] = { dx: x - r.left, dy: y - r.top, mx: x + 10 - (r.left + 100), my: y + 8 - (r.top + 50) }; }
  const sp = at;
  assert.ok(sp.tl.dx < 0 && sp.tl.dy < 0, 'tl: over the top-left corner'); assert.ok(sp.tr.mx > 80 && sp.tr.dy < 0, 'tr: over the top-right corner');
  assert.ok(sp.bl.dx < 0 && sp.bl.my > 30, 'bl: over the bottom-left corner'); assert.ok(sp.right.mx > 100 && sp.right.my === 0, 'right: just right of it, centred');
  assert.ok(sp['right-up'].mx > 100 && sp['right-up'].my < 0 && sp['right-dn'].mx > 100 && sp['right-dn'].my > 0, 'right-up / right-dn: the two keys right of it');
  assert.deepEqual([sp.mid.mx, sp.mid.my], [0, 0], 'mid: on its middle');
});

test('round 21: hold-⌥ chips per state: a keycap on each visible target, 1–9 and 0 on the right column, [ ] on the neighbours, none on count badges; Home leaves the orb, the composer and ◫', async () => {
  const { w, keys } = deskWorld();
  const guides = [];
  w.api.keys = { on: h => { keys.push(h); return () => {}; }, guide: (g, o) => { guides.push([g, o]); return () => {}; } };
  (await layout()).default(w.api);
  assert.equal(guides.length, 1); assert.deepEqual(guides[0][1], { only: true }, 'only the view\'s chips');
  const raw = () => guides[0][0](), chips = () => raw().map(c => `${c.key}@${String(c.el.className || '').split(' ').filter(x => x !== 'aad-ib' && x !== 'aad-ico')[0]}`);
  const open = chips();
  for (const want of ['Space@aad-orbbtn', 'H@aad-wsn', 'O@aad-wsc', 'L@aad-tog', 'K@aad-find', 'N@aad-new', 'S@aad-set', 'R@aad-vtog', 'A@aad-vti', 'T@aad-tidy-i']) assert.ok(open.includes(want), `open: ${want} in ${open}`);
  const marked = raw().filter(c => /aad-row/.test(c.el.className));
  assert.ok(marked.length >= 1 && marked.every(c => ['↓', '↑'].includes(c.key) && c.at === 'inside-l' && c.el.closest('.aad-rw').dataset.aadKh === c.key), 'the ↓ / ↑ rows are marked so they make room for the keycap');
  assert.ok(!open.some(c => /@aad-(rtog|rnew|rfind|rset)/.test(c)), 'the rail\'s twins are not shown while the sidebar is open');
  const tiles = raw().filter(c => /aad-tile/.test(c.el.className));
  const digits = tiles.filter(c => /^\d$/.test(c.key)).map(c => c.key);
  assert.deepEqual(digits, digits.map((_, i) => String((i + 1) % 10)), 'the right column\'s rows wear 1, 2, 3 … in order'); assert.ok(digits.length >= 2);
  assert.ok(tiles.filter(c => /^\d$/.test(c.key)).every(c => c.at === 'tl') && tiles.filter(c => /^[[\]]$/.test(c.key)).every(c => c.at === 'tr'), 'digits top-left, [ ] top-right');
  assert.deepEqual(tiles.filter(c => c.key === ']').length, 1, '] on the next row'); assert.ok(!raw().some(c => /aad-vtb/.test(c.el.className) || c.el.closest?.('.aad-vtb')), 'no hint on an app\'s count badge');
  assert.ok(!open.some(c => /^(W|F|Z|E|X|B)@/.test(c)), 'nothing to close, widen or act on at Home');
  assert.ok(!open.some(c => /^(V|C|G|\/|I|\\|\.|,|T@aad-vall)/.test(c)), 'no keycap for keys with no target or gone keys');
  // folded: the rail's buttons, no H / O (their header is away)
  keys[1].down({ altKey: true, code: 'KeyL' });
  const rail = chips();
  for (const want of ['L@aad-rtog', 'K@aad-rfind', 'N@aad-rnew', 'S@aad-rset']) assert.ok(rail.includes(want), `rail: ${want}`);
  assert.ok(!rail.some(c => /^(H@aad-wsn|O)@?/.test(c)), 'no H on the (gone) name, no O');
  assert.ok(rail.includes('H@aad-hmid'), 'app keys round: ⌥H in the empty middle of Home, folded or not');
  keys[1].down({ altKey: true, code: 'KeyL' });
  // ⌥H Home: the orb (Space) and ◫ back (H) only
  assert.equal(keys[1].down({ altKey: true, code: 'KeyH' }), true);
  assert.deepEqual(chips(), ['Space@aad-orbbtn', 'H@aad-hback', 'H@aad-hmid'], 'focus: ◫ and the middle wear H');
  assert.ok(raw().find(c => c.el.className === 'aad-hmid').free === true && raw().find(c => c.el.className === 'aad-hmid').at === 'mid', 'the middle spot is known empty (no hit test), centred');
  // desktop.css on what the view drew, while ⌥ is held (wizard-ux issue 1674)
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  const on = (n, k) => { assert.ok(n, 'drawn'); return cascade(n, DESK_CSS)[k]?.value ?? ''; };
  assert.ok(w.html.dataset.aadFocus !== undefined, 'Home (focus)'); assert.equal(on(w.q('.aad-hback'), 'display'), 'grid', 'Home shows one quiet ◫ to come back');
  keys[1].down({ altKey: true, code: 'KeyH' }); w.run(); assert.equal(w.html.dataset.aadFocus, undefined); assert.notEqual(on(w.q('.aad-hback'), 'display'), 'grid', 'and only at Home');
  const badge = w.q('.aad-vtb'), kh = raw().find(c => /aad-row/.test(c.el.className))?.el.closest('.aad-rw'), chip = node('b', 'kh-chip', w.html.children[0]);
  assert.ok(kh?.dataset.aadKh, 'a ↓ / ↑ row marked'); const khTitle = kh.querySelector('.aad-chat');
  const pad0 = on(khTitle, 'padding-left'), op0 = on(badge, 'opacity');
  w.html.classList.add('key-hints-on');
  assert.equal(on(badge, 'opacity'), '.35', 'count badges step back while ⌥ is held'); assert.notEqual(op0, '.35');
  assert.equal(on(khTitle, 'padding-left'), '34px', 'the ↓ / ↑ row makes room: the keycap never touches its title'); assert.notEqual(pad0, '34px');
  assert.deepEqual([on(chip, 'background'), on(chip, 'border-bottom-width')], ['var(--aad-canvas)', '2px'], 'hints are keycaps (skin tokens), unlike the round amber count badges');
});

test('round 20 item 1 / round 21: ⌥H Home folds both sides away, closes the chat and the panel; ⌥H again restores exactly; memory only; Esc keeps it; ⌥` the same', async () => {
  const { w, keys, store } = deskWorld();
  (await layout()).default(w.api);
  // before: sidebar open, apps column open, a custom width
  store.widths = undefined;
  const before = { side: w.html.dataset.aadSide, tabs: w.html.dataset.aadTabs, folded: store.folded, tabsFolded: store.tabsFolded };
  assert.equal(before.side, 'open'); assert.equal(before.tabs, 'open');
  const writes = JSON.stringify(store);
  assert.equal(keys[1].down({ altKey: true, code: 'KeyH' }), true, '⌥H is the view\'s');
  assert.equal(w.html.dataset.aadFocus, '', 'focus on'); assert.equal(w.html.dataset.aadSide, 'rail'); assert.equal(w.html.dataset.aadTabs, 'rail');
  assert.equal(JSON.stringify(store), writes, 'nothing stored: the stash is in memory only');
  w.escape();
  assert.equal(w.html.dataset.aadFocus, '', 'Esc leaves focus (and its stash) alone');
  keys[1].down({ altKey: true, code: 'Backquote' });
  assert.equal(w.html.dataset.aadFocus, undefined, 'back (⌥`, the stock Home key, is the same key quietly)');
  assert.equal(w.html.dataset.aadSide, 'open', 'the sidebar back open'); assert.equal(w.html.dataset.aadTabs, 'open', 'the apps column back open');
  // a folded sidebar before focus stays folded after
  keys[1].down({ altKey: true, code: 'KeyL' }); assert.equal(w.html.dataset.aadSide, 'rail');
  keys[1].down({ altKey: true, code: 'KeyH' }); keys[1].down({ altKey: true, code: 'KeyH' });
  assert.equal(w.html.dataset.aadSide, 'rail', 'exactly as it was: folded stays folded');
  // a side opened by hand at Home ends it (the rails back); ⌥H then hides everything again (a fresh stash)
  keys[1].down({ altKey: true, code: 'KeyH' }); keys[1].down({ altKey: true, code: 'KeyR' });
  assert.equal(w.html.dataset.aadFocus, undefined, 'a side by hand ends it');
  keys[1].down({ altKey: true, code: 'KeyH' }); assert.equal(w.html.dataset.aadFocus, '', '⌥H after that: Home again, not a stale restore');
  w.q('.aad-hback').dispatchEvent(new FakePointerEvent('click')); assert.equal(w.html.dataset.aadFocus, undefined, 'the ◫ at the top left comes back too');
  // Focus hides the side columns (desktop.css on <html>)
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  const v = k => cascade(w.html, DESK_CSS)[k]?.value ?? '';
  keys[1].down({ altKey: true, code: 'KeyH' }); assert.deepEqual([v('--aad-side'), v('--aad-rs')], ['0px', '0px'], 'focus: no sidebar, no apps column');
  keys[1].down({ altKey: true, code: 'KeyH' }); assert.notEqual(v('--aad-side'), '0px');
  // the stash, run on a page with an app in front and a chat docked beside it (wizard-ux issue 1674): ⌥H puts back the
  // chat, the app, wide and the widths; while hidden, the route still naming the app never takes it back as the panel
  const mk = async () => {
    const x = deskWorld(), xw = x.w;
    const stage = new El('div'); stage.id = 'stage';
    const chatDesk = new El('div'); chatDesk.className = 'wsp'; chatDesk.dataset.ws = '1'; const dchats = new El('div'); dchats.className = 'dchats'; dchats.dataset.thread = 'r1'; chatDesk.append(dchats);
    const appDesk = new El('div'); appDesk.className = 'wsp'; appDesk.dataset.ws = '4'; stage.append(chatDesk, appDesk); xw.html.children[0].append(stage);
    // the shell's go: a new chat or a thread lands in the main Chats desk (desk 1) and the route says so (now, or later)
    const m = { x, xw, appDesk, later: null };
    const land = id => { dchats.dataset.thread = id; xw.st.route = { home: false, view: 'thread', thread: id, desk: 1 }; xw.emit('route', xw.st.route); };
    const newChat0 = xw.api.sessions.newChat, open0 = xw.api.sessions.open;
    xw.api.sessions.newChat = (...a) => { const r = newChat0?.(...a); if (m.later) m.later.push(() => land('__new__')); else land('__new__'); return r; };
    xw.api.sessions.open = id => { open0(id); land(id); return true; };
    const go0 = xw.api.nav.goDesk; xw.api.nav.goDesk = d => { const r = go0(d); if (m.goes) { xw.st.route = { home: false, view: 'desk', thread: null, desk: d }; xw.emit('route', xw.st.route); } return r; };
    xw.st.route = { home: false, view: 'desk', thread: null, desk: 4 };
    (await layout()).default(xw.api); xw.emit('route', xw.st.route); xw.run();
    assert.deepEqual([appDesk.dataset.aadRole, xw.html.dataset.aadChat], ['app', 'on'], 'Money in front, Ready one docked beside it');
    return m;
  };
  { // Home hides the panel without leaving its desk first: a route still naming Money before the new chat lands never
    // takes it back as the panel
    const m = await mk(); m.later = [];
    m.x.keys[1].down({ altKey: true, code: 'KeyH' }); assert.notEqual(m.appDesk.dataset.aadRole, 'app', 'the panel hidden');
    m.xw.emit('route', { ...m.xw.st.route }); assert.notEqual(m.appDesk.dataset.aadRole, 'app', 'the route still naming Money does not take it back as the panel');
    for (const f of m.later.splice(0)) f(); m.later = null; m.xw.run(); assert.notEqual(m.appDesk.dataset.aadRole, 'app', 'nor once the new chat lands');
  }
  const M = await mk(), { x, xw, appDesk } = M;
  // ⌥↓ / ⌥↑ step from that docked chat, not from the top of Ready
  assert.ok(x.keys.some(h => h.down({ altKey: true, code: 'ArrowDown', key: 'ArrowDown' }) === true));
  assert.equal(xw.st.opened.at(-1), 'thread:r2', '⌥↓ from the docked chat (r1) opens the next one');
  xw.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; xw.emit('route', xw.st.route); xw.run();
  const xk = x.keys[1];
  xk.down({ altKey: true, code: 'KeyF' }); xw.run(); assert.equal(xw.html.dataset.aadWide, '', 'wide (⌥F)');
  const g = xw.q('.aad-grip[data-grip="side"]'); g.dispatchEvent(new FakePointerEvent('keydown', { key: 'ArrowRight' })); const sideW = xw.html.style.getPropertyValue('--aad-side-w'); assert.equal(sideW, '304px');
  const thread0 = xw.st.opened.at(-1); assert.equal(xw.html.dataset.aadChat, 'on');
  xk.down({ altKey: true, code: 'KeyH' }); xw.run();
  assert.equal(xw.html.dataset.aadFocus, '', 'focus'); assert.notEqual(appDesk.dataset.aadRole, 'app', 'the panel hidden'); assert.equal(xw.html.dataset.aadChat, undefined, 'the chat closed');
  g.dispatchEvent(new FakePointerEvent('keydown', { key: 'ArrowRight' })); assert.equal(xw.html.dataset.aadFocus, '', 'a width nudged while away');
  const opened = xw.st.opened.length, gone = xw.st.gone.length;
  M.goes = true; xk.down({ altKey: true, code: 'KeyH' }); xw.run(); xw.run(); xw.run();
  assert.equal(xw.html.dataset.aadFocus, undefined);
  assert.deepEqual(xw.st.opened.slice(opened), [thread0], 'the chat that was docked opened again');
  assert.ok(xw.st.gone.slice(gone).includes(4), 'the app back on its desk');
  assert.equal(xw.html.dataset.aadWide, '', 'wide again'); assert.equal(xw.html.style.getPropertyValue('--aad-side-w'), sideW, 'the widths as they were');
});

test('round 20 item 9 / round 22 (Activity since issue 1258): Ready is one list in the chosen Sort (each row its time since the last message, no status tags), never status groups', async t => {
  t.mock.method(Date, 'now', () => new Date(2026, 10, 4, 15).getTime());
  const { w, keys } = deskWorld();
  let order = 'newest'; const asked = [];
  w.api.sessions.order = () => order; w.api.sessions.setOrder = o => { order = o; return true; };
  w.st.sessions.ready[0].state = 'fyi'; w.st.sessions.ready[1].state = 'needs';
  w.st.sessions.ready[0].at = new Date(Date.now() - 5 * 60e3).toISOString(); w.st.sessions.ready[1].at = new Date(Date.now() - 3 * 3600e3).toISOString();
  w.st.sessions.ready.push({ id: 'r3', title: 'Plain middle', kind: 'ready', state: 'none', at: new Date(Date.now() - 3600e3).toISOString(), actions: [] });
  // Chats' own session list sorts Activity (core/chats-list-model.js activitySort); the layout draws what it returns.
  const list = w.api.sessions.list;
  w.api.sessions.list = opts => { asked.push(opts); const s = list(opts); s.ready.sort((x, y) => (order === 'oldest' ? 1 : -1) * (Date.parse(x.at) - Date.parse(y.at))); return s; };
  (await layout()).default(w.api);
  assert.ok(asked.every(o => o?.activity === true), 'the sidebar asks Chats for the Activity list');
  assert.equal(w.q('.aad-grp'), null, 'no sub-headers');
  const ready = () => w.qa('.aad-rw[data-kind="ready"]').map(r => r.dataset.sid);
  assert.deepEqual(ready(), ['r1', 'r3', 'r2'], 'Newest: newer FYI and plain chat before older Needs you');
  assert.equal(w.q('.aad-tag'), null, 'round 22: no status tags');
  const times = w.qa('.aad-rw[data-kind="ready"] .aad-time'); assert.equal(times.length, 3, 'round 22: each Ready row shows how long ago');
  assert.deepEqual(times.map(t => t.textContent), ['5m', '1h', '3h'], 'its time since the last message (newest first)');
  for (const [sort, want] of [['oldest', ['r2', 'r3', 'r1']], ['newest', ['r1', 'r3', 'r2']]]) {
    w.q('.aad-act-orderb').dispatchEvent(new FakePointerEvent('click'));
    w.q(`.aad-sortmenu [data-act-order="${sort}"]`).dispatchEvent(new FakePointerEvent('click'));
    assert.deepEqual(ready(), want, `Ready follows ${sort} from the sidebar Sort control`);
    assert.equal(w.q('.aad-grp'), null, 'sorting never adds status groups');
    for (const code of ['ArrowDown', 'ArrowUp']) for (let i = 0; i < want.length; i++) {
      w.st.route = { home: false, view: 'thread', thread: want[i], desk: 1 }; w.emit('route', w.st.route);
      assert.ok(keys.some(h => h.down({ altKey: true, code, key: code }) === true));
      const step = code === 'ArrowDown' ? 1 : -1;
      assert.equal(w.st.opened.at(-1), 'thread:' + want[(i + step + want.length) % want.length], `${sort}: ⌥${code} walks the drawn list, wrapping`);
    }
  }
  { // desktop.css on a drawn row: its time steps aside for the ⋯ on hover, held or focused
    w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
    const rw = w.q('.aad-rw'), tm = rw.querySelector('.aad-time'), vis = (o) => cascade(tm, DESK_CSS, o).visibility?.value ?? '';
    assert.ok(tm, 'a row with its time'); assert.notEqual(vis(), 'hidden');
    assert.equal(vis({ states: [':hover'] }), 'hidden', 'the ⋯ takes its place on hover'); assert.equal(vis({ states: [':focus-within'] }), 'hidden');
    rw.classList.add('is-held'); assert.equal(vis(), 'hidden', 'and while held'); rw.classList.remove('is-held');
  }
  assert.equal(w.q('[data-aad-group]'), null, 'no By status choice in Settings');
});

test('notification stack (Miguel, 4 Nov 2026): one stable newest-first list, the open one expanded in place with its own buttons', async () => {
  const c = withParts(read('web/core/chats.js')), esc = v => String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const items = [{ id: 'n1', title: 'Old', at: 1 }, { id: 'n2', title: 'Middle', at: 2 }, { id: 'n3', title: 'New', at: 3 }];
  const scope = (extra = {}) => ({ esc, clip: (t, n) => String(t).slice(0, n), noteAt: i => i.at * 1000, noteSrcName: () => 'Money', ago: () => '1m', noteTitle: i => i.title, notePlain: String,
    ACT: { done: { icon: '', label: 'Archive' } }, noteRouteQuiet: () => '<div class="route"></div>', noteQuiet: () => true, ...extra });
  const stack = runRecording(`${block(c, '  function noteStackHtml(NV, body, acts) {')}\nthis.html = noteStackHtml;`, scope({ noteSiblings: cur => items.filter(i => i.id !== cur.id) })).html;
  const drawn = open => { const d = createDocument(); d.body.innerHTML = stack({ id: open.id, item: open }, '<div class="bub">words</div>', '<div class="ch-tacts"><button data-chact="done">Archive</button></div>'); return d; };
  for (const open of items) {
    const d = drawn(open);
    assert.deepEqual(d.querySelectorAll('.ch-nstack b').map(b => b.textContent), ['New', 'Middle', 'Old'], `open ${open.title}: the same newest-first list (clicking through never reshuffles)`);
    const cur = d.querySelector('.msg.ch-notif.is-quiet.is-open');
    assert.equal(cur.getAttribute('aria-current'), 'true', 'the open one is marked'); assert.equal(cur.querySelector('.ch-ncard-h b').textContent, open.title);
    assert.ok(cur.querySelector('.bub') && cur.querySelector('[data-chact="done"]'), 'expanded in place with its own buttons');
    assert.equal(d.querySelectorAll('button.ch-ncard').length, 2, 'the rest are one-line cards that open in place');
  }
  // the quiet thread has no second More-from list
  const more = runRecording(`${block(c, '  function noteMoreHtml(NV) {')}\nthis.html = noteMoreHtml;`, scope({ noteSiblings: () => items.slice(1) })).html;
  assert.equal(more({ id: 'n1', item: items[0] }), '', 'no second More-from list');
  // Archive / Snooze in a stack stays and opens the next one (the older neighbour, else the newer)
  const act = (openId, a) => {
    const n = { id: openId, item: items.find(i => i.id === openId), acts: ['resolve', 'snooze', 'done'] };
    const ctx = runRecording(`${block(c, '  function notifAct(wid, a) {')}\nthis.act = notifAct;`, scope({ W: { w1: { id: 'w1' } }, owner: x => x, notifOf: () => n, vib() {}, PHONE: () => false, keepThreadOpen: () => false,
      noteSiblings: cur => items.filter(i => i.id !== cur.id), KIT: { drafts: { get: () => ({ text: '' }), clear() {}, setReply() {} } }, ch: () => ({}), CH: {}, renderChats() {}, H: {}, toast() {}, chatsBack() {},
      window: { WosSkinHost: { inboxAct: (x, id) => ctx.calls.push(['inboxAct', x, id]) } } }));
    assert.equal(ctx.act('w1', a), true);
    return ctx.calls.filter(x => x[0] === 'inboxAct').map(x => x.slice(1).join(' '));
  };
  assert.deepEqual(act('n2', 'done'), ['done n2', 'open n1'], 'Archive on the middle one opens the older neighbour');
  assert.deepEqual(act('n1', 'snooze'), ['snooze n1', 'open n2'], 'the oldest: the newer one');
  // Snooze / Archive on the far side of the open card's buttons, wrapping together
  for (const [f, attrs] of [['desktop.css', 'data-shell="desktop" data-layout="ai-apps"'], ['layout.css', 'data-shell="phone" data-layout="ai-apps"']]) {
    const d = createDocument(); for (const [k, v] of attrs.split(' ').map(x => x.split('='))) d.documentElement.setAttribute(k, v.replace(/"/g, ''));
    const tacts = runRecording(`${block(c, '  function noteTactsHtml(NV, quiet) {')}\nthis.html = noteTactsHtml;`, scope({ noteQuietBtn: (NV, a) => ({ label: a, icon: '', hint: a }), noteActBtn: (NV, a) => ({ label: a, icon: '', hint: a }) })).html;
    d.body.innerHTML = `<div class="ch-thread ch-notif-thread">${tacts({ acts: ['app', 'resolve', 'snooze', 'done'] }, true)}</div>`;
    assert.deepEqual(d.querySelector('.ch-tacts').children.map(n => n.dataset.chact || n.className), ['app', 'resolve', 'ch-tacts-gap', 'snooze', 'done'], 'one spacer before Snooze / Archive');
    const gap = cascade(d.querySelector('.ch-tacts-gap'), read('web/layouts/ai-apps/' + f));
    assert.deepEqual([gap.flex?.value, gap.height?.value], ['1 0 0', '0'], f + ': the spacer pushes them to the far side');
  }
  // no automatic next Ready navigation on the desktop: Archive in the open chat keeps it (tests/ai-apps-view.test.mjs
  // 'desktop open chat stays on the same thread through Ready → Working → Ready and Archive' runs the view)
});

test('round 20 items 7 + 8: a quiet notification thread (source in the header, a thin amber edge, one muted routing line with a menu, Resolve); the open item\'s keys', async () => {
  const c = withParts(read('web/core/chats.js')), esc = v => String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // off unless a view asks (--wos-note-quiet: on in the view's css)
  const quiet = v => runRecording(`${between(c, '  const noteQuiet = ', '\n')}\nthis.q = noteQuiet();`, { getComputedStyle: () => ({ getPropertyValue: () => v }), document: { documentElement: {} } }).q;
  assert.equal(quiet(' on'), true); assert.equal(quiet(''), false, 'off unless a view asks');
  for (const [f, shell] of [['desktop.css', 'desktop'], ['layout.css', 'phone']]) {
    const d = createDocument(), css = read('web/layouts/ai-apps/' + f);
    d.documentElement.setAttribute('data-shell', shell); d.documentElement.setAttribute('data-layout', 'ai-apps');
    assert.equal(cascade(d.documentElement, css)['--wos-note-quiet']?.value, 'on', f + ': the view asks for the quiet thread');
    d.body.innerHTML = '<div class="win app-chats"><div class="dchats"><div class="pane-main"><div class="ch-thread ch-notif-thread"><div class="ch-msgs"><div class="msg a ch-notif is-quiet"><div class="bub">x</div></div><div class="ch-notif-route is-quiet"></div></div></div></div></div></div>';
    const bub = cascade(d.querySelector('.bub'), css);
    assert.equal(bub.background?.value, 'none', f + ': no amber bubble'); assert.ok(bub.background.important);
    assert.match(bub['border-left']?.value || '', /^2px solid var\(--amber/, f + ': a thin amber edge');
    assert.equal(cascade(d.querySelector('.ch-notif-route'), css)['container-type']?.value, 'normal', f + ': the quiet line sizes to its words');
  }
  // one muted routing line: "From Messenger · shows in Chats ▾", its menu = the one shared picker
  const route = (bell, extra = {}) => runRecording(`${between(c, '  const APP_NOTE = ', '\n')}\n${between(c, '  const noteRoute = ', '\n')}\n${block(c, '  function noteRouteQuiet(NV) {')}\nthis.html = noteRouteQuiet;`,
    { esc, window: { WosBell: { chatsAvailable: true, picker: (id, o) => `<button class="pick" data-for="${id}">${o.name}</button>`, ...bell }, WizConfig: { agent: () => 'Oscar' } }, ...extra }).html;
  const d = createDocument();
  d.body.innerHTML = route({ nameOf: () => 'Messenger', route: () => 'chats' })({ id: 'x', item: { app: 'messenger' } });
  const line = d.querySelector('.ch-notif-route.is-quiet[data-part="notify-route"]');
  assert.equal(line.querySelector('.ch-nr-b[data-notify-menu]').textContent, 'From Messenger · shows in Chats', "'From Messenger · shows in Chats ▾'");
  const menu = line.querySelector('.ch-nr-menu[role="menu"]'); assert.ok(menu.hasAttribute('hidden'), 'the menu waits for a tap');
  assert.equal(menu.querySelector('.pick').dataset.for, 'messenger', 'the choices are the one shared picker');
  d.body.innerHTML = route({ nameOf: () => 'Notifications', route: () => 'elsewhere', routeLabel: () => 'Mail' })({ id: 'y', item: { from: 'x' } });
  assert.equal(d.querySelector('.ch-nr-b').textContent, 'From Oscar · goes to Mail', 'Wizard\'s own alerts read as the agent\'s; the shared label says where');
  // the buttons say what they do: the agent's name on the ask, the app's on Open
  const btn = runRecording(`${block(c, '  function noteQuietBtn(NV, a) {')}\nthis.b = noteQuietBtn;`, { window: { WizConfig: { agent: () => 'Oscar' } }, noteActBtn: () => ({ label: 'Snooze' }), NOTE_ASK: '', NOTE_OPEN: '' }).b;
  assert.equal(btn({ item: { appName: 'Money' } }, 'resolve').label, 'Have Oscar handle it', 'the ask names the agent (was the unclear "Resolve")');
  assert.equal(btn({ item: { appName: 'Money' } }, 'app').label, 'Open Money', 'Open names the app');
  assert.equal(btn({ item: {} }, 'snooze').label, 'Snooze');
  // the open item's keys on the desktop: ⌥B where these go, ⌥E / ⌥Z / ⌥X its own buttons
  const p = await panelDesk({ before: d => { d.w.q('#stage .ch-thread').className = 'ch-thread ch-notif-thread'; } }), { w, keys } = p, pressed = [];
  const head = node('div', 'ch-head'), ti = node('div', 'ti', head); node('b', '', ti).textContent = 'Card payment due'; p.thread.insertBefore(head, p.msgs);
  for (const a of ['done', 'snooze', 'resolve']) { const b = node('button', '', p.thread); b.dataset.chact = a; b.click = () => pressed.push(a); }
  const rb = node('button', 'ch-nr-b', p.thread); rb.setAttribute('data-notify-menu', ''); rb.click = () => pressed.push('route');
  p.go({ view: 'thread', thread: '__new__', desk: 1 });
  assert.equal(w.html.dataset.aadChat, 'on', 'the notification is docked like a chat');
  for (const code of ['KeyB', 'KeyE', 'KeyZ', 'KeyX']) assert.equal(keys[1].down({ altKey: true, code }), true);
  assert.deepEqual(pressed, ['route', 'done', 'snooze', 'resolve'], '⌥B: where these go; round 21: ⌥E / ⌥Z / ⌥X the open item\'s own Archive / Snooze / Resolve');
  const { APP_LETTERS } = await import('../web/layouts/ai-apps/home.js'); assert.ok(!APP_LETTERS.includes('B'), 'B is no app letter any more');
});

test('round 21: a modal in front (the app picker, Settings) takes only its own ⌥ key (⌥A, ⌥S) and Esc; its ✕ wears that key', async () => {
  const { w, keys } = deskWorld();
  const guides = [];
  w.api.keys = { on: h => { keys.push(h); return () => {}; }, guide: g => { guides.push(g); return () => {}; } };
  (await layout()).default(w.api);
  const chipKeys = () => guides.at(-1)().map(c => c.key + '@' + String(c.el?.className || ''));
  // the picker open: its ✕ wears A and nothing else does; ⌥⇧A is taken but does not close it
  keys[1].down({ altKey: true, code: 'KeyA' }); assert.equal(w.html.dataset.vcSheet, 'open');
  assert.deepEqual(chipKeys(), ['A@vc-x'], 'the picker\'s ✕ wears ⌥A, nothing else');
  assert.equal(keys[1].down({ altKey: true, shiftKey: true, code: 'KeyA' }), true); assert.equal(w.html.dataset.vcSheet, 'open', '⌥⇧A is not its key');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyS' }), true); assert.deepEqual(w.st.settings, [], 'no Settings over the picker');
  keys[1].down({ altKey: true, code: 'KeyA' }); assert.equal(w.html.dataset.vcSheet, undefined, '⌥A closes it');
  // Settings in front (the shared centred panel): ⌥S closes it, its ✕ wears S, the view's other keys are taken
  const dset = node('div', '', w.html.children[0]); dset.id = 'dsettings'; const stx = node('button', 'st-close', dset); let shut = 0; stx.click = () => { shut++; dset.hidden = true; };
  assert.deepEqual(chipKeys(), ['S@st-close'], 'Settings\' ✕ wears ⌥S, nothing else');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyL' }), true); assert.equal(w.html.dataset.aadSide, 'open', 'the sidebar stays as it is behind Settings');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyA' }), true); assert.equal(w.html.dataset.vcSheet, undefined, 'no picker over Settings');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyS' }), true); assert.equal(shut, 1, 'Settings: ⌥S closes it');
  dset.remove();
  // the picker open: ⌥V (voice) is taken too; ⌥A again closes it
  assert.equal(keys[1].down({ altKey: true, code: 'KeyA' }), true); assert.equal(w.html.dataset.vcSheet, 'open');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyV' }), true, 'voice waits until the picker is closed');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyL' }), true); assert.equal(w.html.dataset.aadSide, 'open', 'the sidebar stays as it is behind it');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyA' }), true); assert.equal(w.html.dataset.vcSheet, undefined);
  // nothing open: the view's keys act, voice is the shell's
  assert.equal(keys[1].down({ altKey: true, code: 'KeyV' }), false, '⌥V: the shell\'s new voice chat');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyL' }), true); assert.equal(w.html.dataset.aadSide, 'rail');
  keys[1].down({ altKey: true, code: 'KeyL' });
});

test('desktop cold Store opens synchronously in the app pane and deferred Home cannot steal it', async () => {
  const { w } = deskWorld();
  const stage = new El('div'); stage.id = 'stage';
  const chat = new El('div'); chat.className = 'wsp'; chat.dataset.ws = '1';
  const dc = new El('div'); dc.className = 'dchats'; chat.append(dc);
  const app = new El('div'); app.className = 'wsp'; app.dataset.ws = '8';
  const win = new El('div'); win.className = 'win focus';
  const frame = new El('iframe'); frame.focus = () => { w.doc.activeElement = frame; };
  frame.contentWindow = { focus() {} }; win.append(frame); app.append(win);
  stage.append(chat, app); w.html.children[0].append(stage);
  w.st.route = { home: true, desk: 1, view: 'home', thread: null };
  let router, opened = 0;
  w.api.apps.routeOpens = h => { router = h; };
  w.api.apps.openDesk = (id, place) => {
    assert.equal(id, 'app-store'); place(8); opened++;
    w.st.desks.push({ desk: 8, id, name: 'Store' });
    w.st.route = { home: false, desk: 8, view: 'desk', thread: null };
    w.emit('route', w.st.route);
  };
  (await layout()).default(w.api);
  let placed = null;
  router.open('app', { id: 'app-store' }, desk => { placed = desk; });
  assert.equal(placed, 8, 'the already-checked open is placed on the app desk, never re-gated');
  assert.equal(opened, 1, 'frame exists before deep-link delivery, not 60ms later');
  assert.equal(app.dataset.aadRole, 'app', 'separate app pane');
  const header = w.q('.aad-ptop');
  assert.equal(header.parentNode, app, 'the header and window share the animated desk on the opening frame');
  assert.equal(app.dataset.aadAnim, 'app');
  assert.equal(header.dataset.aadAnim, undefined, 'no independent header entrance');
  const drafts = w.st.newChats;
  w.run();
  assert.equal(w.st.newChats, drafts, 'the deferred mount-time Home task cannot steal the Store');
  assert.equal(w.doc.activeElement, frame, 'the opened app receives focus');
  // the shell's boot (desktop.js, run): the skin host attached by the boot part, then the views ready, the layout ready,
  // and only then the cold deep link (it waits for the same open router)
  const order = [], gate = () => { let open; const p = new Promise(r => { open = r; }); return { p, open }; }, exp = gate(), lay = gate();
  const realBoot = desktopBoot(); assert.ok(realBoot.adapter, 'the boot part attaches the shell to the skin host at once');
  const shellSrc = readFileSync(new URL('web/desktop/desktop.js', root), 'utf8');
  const bootRun = between(shellSrc, '  const { LINKS } = window.WizCore.desktopParts.boot(', '\n  // First run is the Welcome modal');
  const bootCtx = runRecording('globalThis.__go = async () => {\n' + bootRun + '\n};', { $: () => null, $$: () => [], C: { deeplink: { consume: () => order.push('consume') } },
    window: { WizCore: { desktopParts: { boot: () => { order.push('boot+attach'); return { LINKS: {} }; } } }, WosExperience: { whenReady: () => { order.push('views?'); return exp.p; } }, WosSkinHost: { whenLayoutReady: () => { order.push('layout?'); return lay.p; } } } });
  const ran = bootCtx.__go();
  await settle(); assert.deepEqual(order, ['boot+attach', 'views?'], 'nothing consumed while the views get ready');
  exp.open(); await settle(); assert.deepEqual(order, ['boot+attach', 'views?', 'layout?'], 'nor while the layout loads');
  lay.open(); await ran; assert.deepEqual(order, ['boot+attach', 'views?', 'layout?', 'consume'], 'cold links wait for the same open router');
  // desktop.css on a real app window: frames take the pointer, except while a grip is held
  const p = await panelDesk(), fr = p.appWins[0].querySelector('iframe');
  assert.equal(p.style(fr)('pointer-events'), 'auto', 'an app frame takes the pointer');
  p.w.html.dataset.aadResizing = 'side'; assert.equal(p.style(fr)('pointer-events'), 'none', 'resizing still shields app frames'); assert.ok(p.important(fr, 'pointer-events'));
});

test('round 21 desktop: one left/right model: apps and their links on the right (one window, taken to the page), other links in the same panel, no view beside a thread, an app\'s Reply in the left column with the app kept', async () => {
  const { w } = deskWorld();
  const stage = new El('div'); stage.id = 'stage';
  const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats'; chatDesk.append(dchats);
  const appDesk = new El('div'); appDesk.className = 'wsp'; stage.append(chatDesk, appDesk); w.html.children[0].append(stage);
  let R = null; const paths = [], links = [];
  Object.assign(w.api.apps, { routeOpens: h => { R = h; return () => { R = null; }; }, path: (id, p) => { paths.push([id, p]); return true; }, openLink: (u, t) => { links.push([u, t]); return true; } });
  (await layout()).default(w.api);
  assert.ok(R && typeof R.open === 'function' && typeof R.shows === 'function', 'the view holds the opens');
  const stock = () => assert.fail('the stock way would open another window');
  // a notification's Open (three clicks): the app's own desk each time, taken to the page; never a new desk
  for (let i = 0; i < 3; i++) { assert.equal(R.open('app', Object.freeze({ id: 'money', path: '/money/bills' }), stock), true); w.run(); }
  assert.deepEqual(w.st.gone, [4, 4, 4], 'its desk (Money is desk 4)'); assert.equal(w.st.opened.filter(x => x === 'money').length, 0, 'no second Money');
  assert.deepEqual(paths, [['money', '/money/bills'], ['money', '/money/bills'], ['money', '/money/bills']]);
  // an app that is not open yet gets its desk once (the stock + sheet's way); no page = no path
  assert.equal(R.open('app', { id: 'movies', path: '' }, stock), true); w.run(); assert.deepEqual(w.st.opened, ['movies']); assert.equal(paths.length, 3);
  // a link tapped in a reply: an app's page = that app; a page no app owns = the one link panel
  assert.equal(R.open('link', { url: '/mail/inbox/7', title: 'Mail', app: 'mail' }, stock), true); w.run(); assert.equal(w.st.gone.at(-1), 2); assert.deepEqual(paths.at(-1), ['mail', '/mail/inbox/7']);
  assert.equal(R.open('link', { url: '/reports/q3.html', title: 'Q3', app: '' }, stock), true); assert.deepEqual(links, [['/reports/q3.html', 'Q3']]);
  assert.equal(R.open('beside', { url: '/money/', app: 'money' }, stock), true, 'no review-mode view beside a thread: links open when tapped');
  // Money in front as the panel; its Reply: the main Chats' new chat (the stock go), docked LEFT as a chat; Money stays right
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; w.emit('route', w.st.route); w.run();
  assert.equal(appDesk.dataset.aadRole, 'app', 'Money is the panel'); assert.equal(R.shows(4), true, 'its Reply is admitted there'); assert.equal(R.shows(2), false);
  let went = 0;
  const receipt = R.open('draft', Object.freeze({ from: 'money' }), () => { went++; w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1 }; w.emit('route', w.st.route); return { kind: 'unsent-draft' }; });
  assert.equal(receipt, true); assert.equal(went, 1);
  assert.equal(w.html.dataset.aadChat, 'on', 'the Reply is a chat in the left column'); assert.equal(chatDesk.dataset.aadRole, 'chat');
  assert.equal(appDesk.dataset.aadRole, 'app', 'the app stays on the right'); assert.equal(w.html.dataset.aadSplit, 'on');
  assert.equal(w.html.dataset.aadNew, 'false', 'never the see-through Home'); assert.equal(w.q('.aad-tt').textContent, 'New chat');
  w.emit('render'); assert.equal(w.html.dataset.aadChat, 'on', 'repaints keep it docked');
  // its ✕ closes the column (Home's new chat: no column again); the app stays
  w.q('.aad-cx').dispatchEvent(new FakePointerEvent('click')); w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aadChat, undefined, 'closed: Home again, no column'); assert.equal(appDesk.dataset.aadRole, 'app');
  // an app's chat (openThread): the stock go, a thread docks like any chat
  assert.equal(R.open('thread', { sid: 'r1', from: 'money' }, () => { w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route); return true; }), true);
  assert.equal(w.html.dataset.aadChat, 'on'); assert.equal(w.q('.aad-tt').textContent, 'Ready one');
  // a Reply that could not open still counts as placed (the caller reports the failure), nothing docks for it
  w.q('.aad-cx').dispatchEvent(new FakePointerEvent('click')); w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1 }; w.emit('route', w.st.route);
  assert.equal(R.open('draft', { from: 'money' }, () => { throw new Error('Main Chats unavailable'); }), true); assert.equal(w.html.dataset.aadChat, undefined);
});

/* Miguel, 4 Nov 2026 ("sometimes the chat gets put in this weird view when it's out of focus"): the page (re)loaded with
 * an app in front while the Chats desk still held a thread (an update's reload). The view knew no chat, so that thread was
 * laid out as Home under the panel: as wide as the whole main area (cut off by the panel), no title, and never placed at
 * its latest message, because Chats only places threads it is told are on screen. */
test('a reload with an app in front: the thread the Chats desk holds docks beside it (title, ✕), and counts as on screen', async () => {
  const { w } = deskWorld();
  const stage = new El('div'); stage.id = 'stage';
  // an agent's own Chats desk sits first on the stage (desks reordered); the main Chats desk (1) holds the thread
  const agentDesk = new El('div'); agentDesk.className = 'wsp'; agentDesk.dataset.ws = '7'; const adc = new El('div'); adc.className = 'dchats'; adc.dataset.thread = 'x9'; agentDesk.append(adc);
  const chatDesk = new El('div'); chatDesk.className = 'wsp'; chatDesk.dataset.ws = '1'; const dchats = new El('div'); dchats.className = 'dchats'; dchats.dataset.thread = 'r1'; chatDesk.append(dchats);
  const appDesk = new El('div'); appDesk.className = 'wsp'; appDesk.dataset.ws = '4'; stage.append(agentDesk, chatDesk, appDesk); w.html.children[0].append(stage);
  let R = null; Object.assign(w.api.apps, { routeOpens: h => { R = h; return () => { R = null; }; } });
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 };   // Money in front from the first paint
  (await layout()).default(w.api);
  w.emit('route', w.st.route); w.run();
  assert.equal(appDesk.dataset.aadRole, 'app', 'Money is the panel');
  assert.equal(w.html.dataset.aadChat, 'on', 'the restored thread is the docked column, not Home under the panel');
  assert.equal(chatDesk.dataset.aadRole, 'chat', 'the main Chats desk'); assert.equal(agentDesk.dataset.aadRole, undefined, 'never an agent\'s Chats desk'); assert.equal(w.html.dataset.aadSplit, 'on');
  assert.equal(w.q('.aad-tt').textContent, 'Ready one', 'its title over it (the main desk\'s thread, not the agent\'s)'); assert.equal(w.q('.aad-cx').hidden, false, 'and its ✕');
  assert.equal(R.shows(1), true, 'the docked chat\'s desk is on screen (Chats places its reading spot there)'); assert.equal(R.shows(4), true);
  assert.equal(R.shows(2), false, 'a desk out of sight is not'); assert.equal(R.shows(7), false, 'nor the agent\'s Chats desk');
  w.emit('render'); assert.equal(w.html.dataset.aadChat, 'on', 'repaints keep it docked');
  // its ✕: Home's new chat behind the panel; nothing to adopt any more, nothing shown beside the app
  w.q('.aad-cx').dispatchEvent(new FakePointerEvent('click')); dchats.dataset.thread = '__new__'; w.emit('route', w.st.route);
  assert.equal(w.html.dataset.aadChat, undefined, 'closed stays closed'); assert.equal(R.shows(1), false);
  // a new chat restored behind the app is Home, as before (no column)
  const fresh = deskWorld().w, st2 = new El('div'); st2.id = 'stage';
  const cd2 = new El('div'); cd2.className = 'wsp'; const dc2 = new El('div'); dc2.className = 'dchats'; dc2.dataset.thread = '__new__'; cd2.append(dc2);
  const ad2 = new El('div'); ad2.className = 'wsp'; st2.append(cd2, ad2); fresh.html.children[0].append(st2);
  fresh.st.route = { home: false, view: 'desk', thread: null, desk: 4 };
  (await layout()).default(fresh.api); fresh.emit('route', fresh.st.route); fresh.run();
  assert.equal(fresh.html.dataset.aadChat, undefined); assert.equal(fresh.html.dataset.aadSplit, 'on');
  // the desktop counts the windows of a desk a layout shows beside the current one as visible (Chats' one on-screen check)
  // (run: desktop.js's shownBeside and the Chats host's visible() in desktop-sideview.js)
  const ws = [{ wins: ['c1'] }, { wins: ['m1', 'm2'] }, { wins: [] }, { wins: ['x1'] }], shows = new Set([0, 1, 2]);
  const beside = runRecording(block(withDesktopParts(read('web/desktop/desktop.js')), '    const shownBeside = () =>') + '\nthis.f = shownBeside;', { ws, cur: 1, WosSkinHost: { routeShows: i => shows.has(i) } }).f;
  assert.deepEqual([...beside()], ['c1'], 'the windows of the desks a layout shows beside the current one (not the current, not empty desks)');
  const vars = { homeOpen: false, ws, cur: 1, hud: null };
  const { chatsHost } = desktopPart('sideview', { desktopVars: vars, shownBeside: () => ['c1'], panelWins: () => [] });
  assert.deepEqual([...chatsHost.visible()], ['m1', 'm2', 'c1'], 'Chats counts them as on screen');
  vars.homeOpen = true; assert.deepEqual([...chatsHost.visible()], [], 'nothing at Home');
});

/* James, 12 Nov 2026: the sidebar stays open down to 680 px. A chat docked beside an app panel keeps the old 900 px
 * breakpoint, so the app is never squeezed to nothing between the chat and the open-apps column (Codex review on PR 1313). */
test('desktop at 760 px (one app at a time): a chat keeps its list open beside it; an app is alone, no chat docked beside it', async () => {
  const had = globalThis.innerWidth; globalThis.innerWidth = 760;
  try {
    const { w } = deskWorld();
    const stage = new El('div'); stage.id = 'stage';
    const chatDesk = new El('div'); chatDesk.className = 'wsp'; chatDesk.dataset.ws = '1'; const dchats = new El('div'); dchats.className = 'dchats'; dchats.dataset.thread = 'r1'; chatDesk.append(dchats);
    const appDesk = new El('div'); appDesk.className = 'wsp'; appDesk.dataset.ws = '4'; stage.append(chatDesk, appDesk); w.html.children[0].append(stage);
    (await layout()).default(w.api);
    w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route); w.run();
    assert.equal(w.html.dataset.aadChat, 'on'); assert.equal(w.html.dataset.aadSplit, undefined);
    assert.equal(w.html.dataset.aadSide, 'open', 'a chat alone: open at 760 px');
    w.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; w.emit('route', w.st.route); w.run();
    assert.equal(w.html.dataset.aadChat, undefined, 'no chat docked beside the app'); assert.equal(w.html.dataset.aadSplit, 'on');
    assert.equal(w.html.dataset.aadSide, 'none', 'the app alone');
    assert.ok(parseFloat(w.html.style.getPropertyValue('--aad-pane-app-width')) > 100, 'the app keeps a usable column');
  } finally { if (had === undefined) delete globalThis.innerWidth; else globalThis.innerWidth = had; }
});

/* James, 6 Nov 2026 ("Messenger became unclickable"): an app panel beside the docked chat, a reply sent in the chat (its
 * desk current), then the app tab or the app itself clicked. The tab hid the panel out from under the pointer, and the
 * panel's iframe (a [hidden], unfocused desk to the shell) took no pointer events at all. */
test('after a reply in the docked chat, the app panel beside it stays clickable: its tab brings it forward, never hides it', async () => {
  const { w } = deskWorld();
  const stage = new El('div'); stage.id = 'stage';
  const chatDesk = new El('div'); chatDesk.className = 'wsp'; chatDesk.dataset.ws = '1'; const dchats = new El('div'); dchats.className = 'dchats'; dchats.dataset.thread = 'r1'; chatDesk.append(dchats);
  const appDesk = new El('div'); appDesk.className = 'wsp'; appDesk.dataset.ws = '4'; stage.append(chatDesk, appDesk); w.html.children[0].append(stage);
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 };
  (await layout()).default(w.api);
  w.emit('route', w.st.route); w.run();
  assert.equal(appDesk.dataset.aadRole, 'app'); assert.equal(w.html.dataset.aadChat, 'on'); assert.equal(w.html.dataset.aadSplit, 'on');
  // the chat docked beside it takes the keyboard (its row clicked, a reply typed and sent): the Chats desk is current
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route); w.emit('render'); w.run();
  assert.equal(w.html.dataset.aiFront, 'chat'); assert.equal(w.html.dataset.aadChat, 'on', 'the chat stays open in its column');
  assert.equal(appDesk.dataset.aadRole, 'app', 'the app stays beside it'); assert.equal(w.html.dataset.aadSplit, 'on');
  const tab = w.q('.aad-vtab[data-desk="4"]'); assert.ok(tab.classList.contains('is-on'), 'its tab still lit (the panel)');
  const gone0 = w.st.gone.length, news0 = w.st.newChats;
  tab.dispatchEvent(new FakePointerEvent('click')); w.run();
  assert.deepEqual(w.st.gone.slice(gone0), [4], 'the tab takes its app forward (its desk), not Home');
  assert.equal(w.st.newChats, news0, 'no new chat in place of the reply');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; w.emit('route', w.st.route); w.run();
  assert.equal(appDesk.dataset.aadRole, 'app', 'the panel is still there'); assert.equal(w.html.dataset.aadSplit, 'on');
  assert.equal(w.html.dataset.aadChat, 'on', 'and the chat still open beside it'); assert.equal(w.html.dataset.aiFront, 'app');
  // in front now: the same tab again hides it, as before (round 15)
  const g1 = w.st.gone.length, n1 = w.st.newChats; w.q('.aad-vtab[data-desk="4"]').dispatchEvent(new FakePointerEvent('click')); w.run();
  console.log('QA second', JSON.stringify({ gone: w.st.gone.slice(g1), news: w.st.newChats - n1, role: appDesk.dataset.aadRole, split: w.html.dataset.aadSplit }));
  assert.ok(!w.st.gone.slice(g1).includes(4), 'the tab in front again: hidden (never re-opened)');
  // the panel's iframe is a pointer target while its desk is [hidden] to the shell and its window unfocused
  // (desktop.css of the shell, then the view's, cascaded on an unfocused window in the panel's desk)
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 4 }; w.emit('route', w.st.route); w.run(); assert.equal(appDesk.dataset.aadRole, 'app');
  const pwin = new El('div'); pwin.className = 'win'; const pbody = new El('div'); pbody.className = 'wbody'; const pf = new El('iframe'); pbody.append(pf); pwin.append(pbody); appDesk.append(pwin);
  const shellCss = read('web/desktop/desktop.css'), both = [shellCss, read('web/layouts/ai-apps/desktop.css')].join('\n');
  const pe = sheets => cascade(pf, sheets)['pointer-events'];
  assert.equal(pe(shellCss)?.value, 'none', 'the Classic rule: an unfocused window\'s frame takes no click');
  assert.deepEqual([pe(both)?.value, !!pe(both)?.important], ['auto', false], 'a role pane\'s iframe takes the click (no !important)');
  w.html.dataset.aadResizing = 'app'; assert.equal(pe(both)?.value, 'none', 'the resize guard still wins'); delete w.html.dataset.aadResizing;
});

test('round 21 phone: an app (or its link) opens full screen on its own desk, taken to the page; an app\'s Reply opens the chat and Back returns to the app; other links stay stock', async () => {
  const p = world();
  let R = null; const paths = [];
  Object.assign(p.api.apps, { routeOpens: h => { R = h; return () => { R = null; }; }, path: (id, x) => { paths.push([id, x]); return true; } });
  (await layout()).default(p.api);
  const stock = () => assert.fail('the stock way would stack another window');
  for (let i = 0; i < 3; i++) assert.equal(R.open('app', { id: 'money', path: '/money/bills' }, stock), true);
  assert.deepEqual(p.st.gone, [4, 4, 4]); assert.equal(p.st.opened.length, 0); assert.equal(paths.length, 3);
  assert.equal(R.open('link', { url: '/notes/n/2', title: '', app: 'notes' }, stock), true); assert.equal(p.st.gone.at(-1), 5); assert.deepEqual(paths.at(-1), ['notes', '/notes/n/2']);
  assert.equal(R.open('link', { url: '/reports/q3.html', title: '', app: '' }, () => true), false, 'a page no app owns: the stock page with its own Back');
  assert.equal(R.open('beside', { url: '/money/' }, stock), true, 'nothing opens beside a thread by itself');
  // Reply from Money: the chat, and Back returns to Money
  p.st.route = { home: false, view: 'desk', thread: null, desk: 4, app: 'money' }; p.emit('route', p.st.route);
  assert.equal(R.open('draft', { from: 'money' }, () => { p.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1, app: 'chats' }; p.emit('route', p.st.route); return { kind: 'unsent-draft' }; }), true);
  assert.equal(p.st.backs.length, 1, 'Back is armed'); const n = p.st.gone.length;
  assert.equal(p.html.dataset.aiNew, undefined, 'the Reply is a chat, never the see-through Home (no grid over its bubble)'); assert.equal(p.q('.ah').hidden, true);
  p.emit('render'); assert.equal(p.html.dataset.aiNew, undefined, 'repaints keep it a chat');
  p.st.backs.pop()(); assert.equal(p.st.gone.length, n + 1); assert.equal(p.st.gone.at(-1), 4, 'Back lands on Money');
  // leaving that chat another way gives Back back to the stock order
  R.open('thread', { sid: 'r1', from: 'money' }, () => { p.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1, app: 'chats' }; p.emit('route', p.st.route); return true; });
  assert.equal(p.st.backs.length, 1, 'Back is armed again for the chat it opened (one entry at a time)');
  p.st.route = { home: false, view: 'desk', thread: null, desk: 3, app: 'music' }; p.emit('route', p.st.route);
  assert.equal(p.st.backs.length, 0, 'left the chat: released');
});

test('round 21: the views keep the open model to themselves: the shared chrome never holds it; the stock paths stay in core', async () => {
  for (const f of ['web/layouts/apps/chrome.js'])
    assert.ok(!read(f).includes('routeOpens'), `${f} leaves every open stock`);
  // each AI apps entry (desktop and phone) takes the opens through the layout API (the host drops them with the layout:
  // tests/route-opens.test.mjs 'on: the layout places opens; ... released on teardown')
  for (const w of [deskWorld().w, world()]) {
    const held = [];
    w.api.apps.routeOpens = h => { held.push(h); return () => held.splice(held.indexOf(h), 1); };
    const off = (await layout()).default(w.api);
    assert.equal(held.length, 1, w.api.env.shell + ': the view holds the opens');
    assert.equal(typeof held[0].open, 'function', w.api.env.shell + ': it places them itself');
    off?.();
  }
});

test('round 23 desktop: the folded rail is a tally of marks (spinners, dots, rings), up to 12 then a faint +; counts only in labels', async () => {
  const { w } = deskWorld();
  w.st.sessions.working = Array.from({ length: 15 }, (_, i) => ({ id: 'w' + i, title: 'W' + i, kind: 'working', actions: [] }));
  w.st.sessions.snoozed = [{ id: 's1', title: 'Later', kind: 'snoozed', actions: [] }];
  (await layout()).default(w.api);
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click'));
  const wk = w.qa('.aad-rk[data-k="working"] .aad-d').map(d => d.className.replace('aad-d ', ''));
  assert.deepEqual(wk, ['is-spin'], 'round 23b: Working is one spinner'); assert.equal(w.q('.aad-rk[data-k="working"] .aad-rk-wn').textContent, '15', 'and its number');
  assert.match(w.q('.aad-rk[data-k="working"]').getAttribute('aria-label'), /^Working, 15\./, 'the count stays in its label');
  assert.deepEqual(w.qa('.aad-rk[data-k="snoozed"] .aad-d').map(d => d.className), ['aad-d is-ring'], 'snoozed: a ring');
});

test('AI apps view: Now playing is only small bars on the playing app\'s own icon (no pill, no list, no slot); hover = pause, a click pauses without opening the app; ⌥P on that icon', async () => {
  let watcher = null, watchOpts = null, now = [];
  const media = [], p = await panelDesk({ before: d => { d.w.api.media = { watch: (fn, o) => { watcher = fn; watchOpts = o; return () => {}; }, list: () => now, pause: k => media.push(['pause', k]), play: k => media.push(['play', k]), toggle: () => media.push(['toggle']) }; } }), { w, keys } = p;
  assert.deepEqual({ ...watchOpts }, { passive: true }, 'passive: the view alone never starts watching'); assert.equal(typeof watcher, 'function');
  assert.deepEqual(w.q('#aad-vt').children.map(n => n.className).filter(c => c !== 'aad-vone'), ['aad-vth', 'aad-vtl', 'aad-vtf', 'aad-vtorb'], 'the column is exactly as before Now playing (no pill row, no slot)');
  assert.equal(w.q('.aad-vtnow'), null, 'no pill');
  const row = id => w.q(`.aad-vtab[data-app="${id}"]`);
  assert.ok(row('music'), 'Music\'s open app row');
  // a fresh row never draws bars for something already paused
  watcher(now = [{ appId: 'music', playing: false, key: 'm1' }]);
  assert.equal(row('music').querySelector('.aad-np'), null); assert.equal(row('music').dataset.media, undefined);
  watcher(now = [{ appId: 'music', playing: true, key: 'm1' }]);
  const np = row('music').querySelector('.aad-vti .aad-np');
  assert.ok(np, 'small bars on the playing app\'s own icon'); assert.equal(row('music').dataset.media, 'playing');
  assert.deepEqual([np.tagName, np.getAttribute('tabindex'), np.getAttribute('aria-label')], ['BUTTON', '-1', 'Pause Music']);
  assert.equal(w.qa('.aad-np').length, 1, 'only on that icon');
  const opened = w.st.opened.length, gone = w.st.gone.length, ev = new FakePointerEvent('click', { stopPropagation() { ev.stopped = true; } });
  for (const fn of np.listeners.click) fn(ev);   // (this small DOM does not stop bubbling: the bars' own listener, then check it stopped)
  assert.deepEqual(media, [['pause', 'm1']], 'a click pauses that app'); assert.equal(ev.stopped, true, 'and never reaches the row');
  assert.equal(w.st.opened.length, opened); assert.equal(w.st.gone.length, gone, 'without opening the app');
  const holds = () => w.st.timers.filter(t => !t.dead).length, h0 = holds();
  w.fire('pointerdown', np); assert.equal(holds(), h0, 'pressing the bars never starts a row drag');
  w.fire('pointerdown', row('music').querySelector('.aad-vti')); assert.equal(holds(), h0 + 1, 'the icon itself still does (the hold timer)');
  w.fire('pointerup', row('music')); w.fire('pointercancel', row('music'));
  watcher(now = [{ appId: 'music', playing: false, key: 'm1' }]);
  assert.equal(row('music').dataset.media, 'paused'); assert.equal(np.getAttribute('aria-label'), 'Play Music');
  for (const fn of np.listeners.click) fn(new FakePointerEvent('click')); assert.deepEqual(media.at(-1), ['play', 'm1'], 'paused: play again');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyP' }), true); assert.deepEqual(media.at(-1), ['toggle'], '⌥P pauses / plays what played last');
  watcher(now = [{ appId: 'music', playing: true, key: 'm1' }]);
  const chip = p.guides[0][0]().find(c => c.key === 'P');
  assert.equal(chip?.el, np, 'the ⌥P keycap sits on that app\'s icon (its bars)');
  watcher(now = []); assert.equal(row('music').querySelector('.aad-np'), null, 'nothing playing: no bars');
});

test('AI apps view phone: Now playing = the same small bars on the playing app\'s icon in the dock / grid; a tap on them pauses without opening the app, a press there never lifts the icon; passive and phone Home only', async () => {
  const w = world();
  const media = { list: [], fns: [], calls: [] };
  w.api.media = { watch: (fn, o) => { media.fns.push([fn, o]); fn(media.list); return () => {}; }, pause: k => media.calls.push('pause:' + k), play: k => media.calls.push('play:' + k), list: () => media.list };
  const tell = list => { media.list = list; for (const [fn] of media.fns) fn(list); };
  (await layout()).default(w.api);
  w.st.route = { home: true, view: 'desk', thread: null, desk: 0 }; w.emit('route', w.st.route);
  assert.equal(media.fns.length, 1); assert.deepEqual(media.fns[0][1], { passive: true }, 'passive: the view alone never starts watching');
  assert.equal(w.qa('.ah-np').length, 0, 'nothing plays: nothing drawn');
  tell([{ key: 'k1', appId: 'music', playing: true }]);
  const music = w.q('.ah-dock .ah-app[data-app="music"]'), np = music.querySelector('.ah-np');
  assert.ok(np && np.parentNode === music.querySelector('.ah-ic'), 'the bars sit on that app\'s own icon (in the dock)');
  assert.equal(w.qa('.ah-np').length, 1, 'only there'); assert.equal(music.dataset.media, 'playing'); assert.equal(np.getAttribute('aria-label'), 'Pause Music');
  assert.equal(np.querySelectorAll('.ah-np-b i').length, 3);
  // a tap on the bars pauses it and never opens the app; the rest of the icon opens it as before
  const opened = w.st.gone.length + w.st.opened.length;
  np.dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(media.calls, ['pause:k1']); assert.equal(w.st.gone.length + w.st.opened.length, opened, 'the app did not open');
  // a press on the bars never starts the hold (no lift, no menu)
  const holds = w.st.timers.filter(t => t.ms === 450).length;
  np.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 3, button: 0, clientX: 10, clientY: 10, pointerType: 'touch' }));
  assert.equal(w.st.timers.filter(t => t.ms === 450).length, holds, 'no hold armed from the bars');
  music.querySelector('.ah-tile').dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 4, button: 0, clientX: 10, clientY: 10, pointerType: 'touch' }));
  assert.equal(w.st.timers.filter(t => t.ms === 450).length, holds + 1, 'the rest of the icon still holds / drags');
  for (const f of w.doc.__listeners.pointerup || []) f(new FakePointerEvent('pointerup', { pointerId: 4 }));
  // paused: the same badge says play (the tweak's css fades it), a tap plays again
  tell([{ key: 'k1', appId: 'music', playing: false }]);
  assert.equal(music.dataset.media, 'paused'); assert.equal(music.querySelector('.ah-np'), np); assert.equal(np.getAttribute('aria-label'), 'Play Music');
  np.dispatchEvent(new FakePointerEvent('click')); assert.deepEqual(media.calls, ['pause:k1', 'play:k1']);
  // gone from the list: gone from the icon; a fresh icon never draws bars for something already paused
  tell([]); assert.equal(w.qa('.ah-np').length, 0); assert.equal(music.dataset.media, undefined);
  tell([{ key: 'k2', appId: 'notes', playing: false }]); assert.equal(w.qa('.ah-np').length, 0, 'paused before it was seen: nothing');
  tell([{ key: 'k2', appId: 'notes', playing: true }]);
  assert.ok(w.q('.ah-grid .ah-app[data-app="notes"] .ah-ic .ah-np'), 'an open app in the grid wears them too');
  // (run) a press on the bars never lifts the icon, nor a right button on it; the desktop Home never watches media
  const np2 = w.q('.ah-grid .ah-app[data-app="notes"] .ah-np'), holdN = () => w.st.timers.filter(t => t.ms === 450 && !t.dead).length, h0 = holdN();
  np2.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 77, button: 0, clientX: 5, clientY: 5, pointerType: 'touch' }));
  assert.equal(holdN(), h0, 'a press on the bars never starts the hold');
  const notesIc = w.q('.ah-grid .ah-app[data-app="notes"]');
  notesIc.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 78, button: 2, clientX: 5, clientY: 5, pointerType: 'mouse' })); assert.equal(holdN(), h0, 'nor a right button');
  notesIc.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 79, button: 0, clientX: 5, clientY: 5, pointerType: 'touch' })); assert.equal(holdN(), h0 + 1, 'a press on the icon itself does');
  const dw = deskWorld().w, dwatch = []; dw.api.media = { watch: (fn, o) => { dwatch.push(o); return () => {}; }, pause() {}, play() {} };
  (await layout()).default(dw.api); dw.run(); assert.equal(dwatch.length, 1, 'the phone Home only (the desktop Home grid has no layers; its one watcher is the apps column\'s)');
  assert.doesNotMatch(read('web/layouts/ai-apps/layout.js'), /api\.media|ah-np/, 'inside an app: no new chrome');
});

test('app keys (Miguel, 4 Nov 2026; one ⌥ anchor): the app picked by ⌥ digit or click takes the keyboard; ⌥ + a key it marks presses it (beating the view\'s letter), Wizard\'s keys never reach it, plain keys do nothing; while ⌥ is held its keys wear Wizard\'s keycap inside its frame and a claimed view keycap steps aside', async () => {
  const { w, keys } = deskWorld();
  const guides = [];
  w.api.keys = { on: h => { keys.push(h); return () => {}; }, guide: g => { guides.push(g); return () => {}; } };
  const stage = new El('div'); stage.id = 'stage';
  const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats'; chatDesk.append(dchats);
  const appDesk = new El('div'); appDesk.className = 'wsp'; const win = new El('div'); win.className = 'win'; const frame = new El('iframe'); win.append(frame); appDesk.append(win);
  stage.append(chatDesk, appDesk); w.html.children[0].append(stage);
  // the app's page: Next (j) and Search (k), as WizardApp.keys.list() reports the live ones (an older app's Space / h marks are dropped)
  const clicks = []; const btn = (k, tag = 'button') => { const b = new El(tag); b.setAttribute('data-wz-key', k); b.click = () => clicks.push(k); return b; };
  const next = btn('j'), find = btn('k', 'input'), old = btn('Space'), mine = btn('h'); let fieldFocus = 0; find.focus = () => { fieldFocus++; };
  let claimK = true, listed = 0, focused = 0, claimE = false; const editB = btn('e');
  frame.contentWindow = { focus() { focused++; }, WizardApp: { keys: { list: () => { listed++; return [{ el: next, key: 'j', label: 'Next' }, ...(claimK ? [{ el: find, key: 'k', label: 'Search' }] : []), ...(claimE ? [{ el: editB, key: 'e', label: 'Edit' }] : []), { el: old, key: 'Space', label: '' }, { el: mine, key: 'h', label: '' }]; } } } };
  frame.contentDocument = { readyState: 'complete', URL: 'https://box.example/music/' };
  frame.focus = () => { focused++; w.doc.activeElement = frame; };
  (await layout()).default(w.api);
  const chips = () => guides[0]().map(c => `${c.key}@${String(c.el.className || c.el.tagName).split(' ').filter(x => x !== 'aad-ib' && x !== 'aad-ico')[0]}`);
  assert.ok(chips().includes('H@aad-hmid'), 'Home: ⌥H in the empty middle');
  assert.equal(listed, 0, 'no app in front: no app keys asked for');
  // ⌥ + Music's row digit: Music becomes the panel and its frame takes the keyboard
  const rows = w.qa('.aad-vtab'), i = rows.findIndex(r => r.dataset.app === 'music');
  assert.ok(i >= 0 && i < 10, 'Music has a digit');
  keys[1].down({ altKey: true, code: 'Digit' + ((i + 1) % 10) });
  assert.deepEqual(w.st.gone.at(-1), 3, 'its desk');
  w.st.route = { home: false, view: 'desk', thread: null, desk: 3 }; w.emit('route', w.st.route);
  assert.equal(appDesk.dataset.aadRole, 'app', 'Music is the panel');
  for (let k = 0; k < 4 && !focused; k++) w.run();
  assert.ok(focused >= 1 && w.doc.activeElement === frame, 'the frame has the keyboard: plain keys reach the app');
  const n0 = focused; for (let k = 0; k < 4; k++) w.run(); assert.equal(focused, n0, 'once: no focus loop after it holds');
  // hold ⌥: the app's own keys (app: true marks them for the shell; same keycap), in its frame, beside the view's
  let raw = guides[0](), app = raw.filter(c => c.app);
  assert.deepEqual(app.map(c => [c.key, c.el, c.frame, c.at, c.name]), [['J', next, frame, 'tl', 'Next'], ['K', find, frame, 'tl', 'Search']], 'J and K on Next and Search, the frame named so the shell offsets them; Space / h are not app keys');
  assert.ok(raw.some(c => c.key === 'W' && !c.app), 'the view\'s own ⌥ keycaps stay');
  assert.ok(!raw.some(c => c.key === 'K' && !c.app), 'the app claims k: the view\'s ⌥K keycap (search) steps aside');
  // ⌥J / ⌥K press the app's controls (from the shell or from inside its frame, e.key a Mac symbol), once per press
  const alt = (code, o = {}) => keys.some(h => h.down({ altKey: true, code, key: '∆', ...o }) === true);
  assert.ok(alt('KeyJ')); assert.deepEqual(clicks, ['j'], '⌥J clicks the app\'s j');
  assert.ok(alt('KeyJ', { repeat: true })); assert.deepEqual(clicks, ['j'], 'held: once');
  assert.ok(alt('KeyK', { target: next })); assert.deepEqual([clicks, fieldFocus, w.q('.aad-search').hidden], [['j', 'k'], 1, true], '⌥K with the app claiming k: the app\'s field (focused), not search');
  assert.ok(alt('KeyH')); assert.equal(w.html.dataset.aadFocus, '', 'reserved ⌥H: Wizard\'s Home, never the app\'s h'); alt('KeyH');
  assert.ok(!clicks.includes('h') && !clicks.includes('Space'));
  alt('KeyJ', { shiftKey: true }); assert.equal(clicks.length, 2, '⌥⇧J is not the app\'s j');
  claimK = false;
  assert.ok(alt('KeyK')); assert.equal(w.q('.aad-search').hidden, false, '⌥K with no claim: the view\'s search'); assert.equal(clicks.length, 2);
  raw = guides[0](); assert.ok(raw.some(c => c.key === 'K' && !c.app), 'and its keycap is back');
  claimK = true;
  assert.ok(chips().includes('H@aad-pti'), '⌥H with an app in front: on the panel\'s app icon');
  assert.ok(!chips().includes('H@aad-hmid'), 'the middle is the app\'s now: no middle H');
  assert.equal(keys[1].down({ altKey: true, code: 'KeyH' }), true, '⌥H works with an app in front'); assert.equal(w.html.dataset.aadFocus, '');
  keys[1].down({ altKey: true, code: 'KeyH' });
  // plain keys are never the view's and press nothing (they go on to the app as its own typing)
  for (const k of [{ key: ' ', code: 'Space' }, { key: 'j', code: 'KeyJ' }, { key: 'ArrowRight', code: 'ArrowRight' }, { key: 'Enter', code: 'Enter' }]) for (const h of keys) assert.notEqual(h.down({ ...k, altKey: false }), true, `${k.code} passes through`);
  assert.equal(clicks.length, 2, 'plain j does nothing');
  // a click on the row picks it the same way
  assert.doesNotMatch(read('web/layouts/ai-apps/desktop.css'), /\.kh-chip\.kh-app \{/, 'one keycap style: no outlined app keycaps');
  // (run) a pick with the picker open closes it and gives the frame the keyboard without scrolling the page
  const asked = [], cw0 = focused; frame.focus = o => { asked.push(o); w.doc.activeElement = frame; };
  w.st.route = { home: false, view: 'thread', thread: '__new__', desk: 1 }; w.emit('route', w.st.route); w.run(); w.doc.activeElement = null;
  keys[1].down({ altKey: true, code: 'KeyA' }); assert.equal(w.html.dataset.vcSheet, 'open');
  w.q('.aad-vtab[data-app="music"]').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.html.dataset.vcSheet, undefined, 'the pick closes the picker'); assert.equal(w.st.gone.at(-1), 3);
  w.st.route = { home: false, view: 'desk', thread: null, desk: 3 }; w.emit('route', w.st.route); for (let k = 0; k < 4 && !asked.length; k++) w.run();
  assert.ok(asked.length && asked.every(o => o?.preventScroll === true), 'the frame focused without a scroll'); assert.ok(focused > cw0, 'and its window too');
  // the app's own ⌥ key beats the view's letter, after the composer's accents (⌥E typed into a filled box stays an accent)
  claimE = true; w.st.route = { ...w.st.route }; w.emit('route', w.st.route); w.run(); const c0 = clicks.length;
  w.doc.activeElement = frame;
  assert.equal(keys[1].down({ altKey: true, code: 'KeyE' }), true); assert.deepEqual(clicks.slice(c0), ['e'], 'the app\'s ⌥E, not the view\'s');
  const box = new El('textarea'); box.value = 'caf'; w.doc.activeElement = box;
  assert.notEqual(keys[1].down({ altKey: true, code: 'KeyE' }), true, 'typing: ⌥E is the accent'); assert.deepEqual(clicks.slice(c0), ['e'], 'the app not pressed');
  w.doc.activeElement = frame; claimE = false;
});

test('plain keys belong to the app in front (Miguel, 4 Nov 2026: Space for Music started a voice take): the mouse never parks the keyboard on the orb, a focused orb talks on Enter and on Space only when Tab put it there; a click on the app bar gives the keyboard back to the app', async () => {
  const { w } = deskWorld();
  const talks = []; w.api.voice.talk = () => talks.push('talk');
  const stage = new El('div'); stage.id = 'stage';
  const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats'; chatDesk.append(dchats);
  const appDesk = new El('div'); appDesk.className = 'wsp'; const win = new El('div'); win.className = 'win'; const frame = new El('iframe'); win.append(frame); appDesk.append(win);
  stage.append(chatDesk, appDesk); w.html.children[0].append(stage);
  let focused = 0;
  frame.contentWindow = { focus() {}, WizardApp: { keys: { list: () => [] } } };
  frame.contentDocument = { readyState: 'complete', URL: 'https://box.example/music/' };
  frame.focus = () => { focused++; w.doc.activeElement = frame; };
  (await layout()).default(w.api);
  const orb = w.q('.aad-orbbtn');
  const md = new FakePointerEvent('mousedown', { button: 0 }); orb.dispatchEvent(md);
  assert.equal(md.defaultPrevented, true, 'a click on the orb leaves the keyboard where it was (the app)');
  const key = (k, extra = {}) => { const e = new FakePointerEvent('keydown', { key: k, ...extra }); orb.dispatchEvent(e); return e; };
  assert.equal(key(' ').defaultPrevented, undefined, 'a plain Space on an orb the mouse focused does not talk');
  assert.deepEqual(talks, []);
  key('Enter'); assert.deepEqual(talks, ['talk'], 'Enter on the focused orb talks');
  orb.matches = sel => sel === ':focus-visible';
  key(' '); assert.deepEqual(talks, ['talk', 'talk'], 'Space too once Tab focused it');
  // Music in front: a click on the panel bar (its name, its tools, ⤢) hands the keyboard to Music's frame
  w.st.route = { home: false, view: 'desk', thread: null, desk: 3, app: 'music' }; w.emit('route', w.st.route);
  assert.equal(appDesk.dataset.aadRole, 'app');
  for (let k = 0; k < 4; k++) w.run();
  focused = 0; w.doc.activeElement = null;
  const bar = w.q('.aad-ptop'), down = new FakePointerEvent('mousedown', { button: 0 });
  w.q('.aad-ptn').dispatchEvent(down); assert.equal(down.defaultPrevented, true, 'the bar never takes the keyboard itself');
  w.q('.aad-ptn').dispatchEvent(new FakePointerEvent('click'));
  for (let k = 0; k < 4 && !focused; k++) w.run();
  assert.ok(focused >= 1 && w.doc.activeElement === frame, 'the app has the keyboard again');
  assert.ok(bar);
});

test('round 24c (Miguel, 4 Nov 2026: "just use project") parts: Group By project: one group per title project (WizardOS, Messenger, …), waiting ones first, Other last; the walk and the rail follow it', async () => {
  const P = await import(new URL('web/layouts/ai-apps/parts.js', root).href);
  const at = m => new Date(Date.now() - m * 60e3).toISOString();
  const rows = [
    { id: 'a', title: 'Messenger · Voice notes', state: 'fyi', at: at(5) }, { id: 'b', title: 'WizardOS · Hotkeys', state: 'done', at: at(1) },
    { id: 'c', title: 'WizardOS · Rail', state: 'fyi', at: at(9) }, { id: 'd', title: 'New chat', state: 'fyi', at: at(2) },
    { id: 'e', title: 'AI Wizards · Azad', state: 'needs', at: at(30) }, { id: 'n', title: 'Mail · invoice', note: true, unread: true, at: at(3) }];
  const g = P.projectGroups(rows, 'newest');
  assert.deepEqual(g.map(x => x.word + ':' + x.rows.map(r => r.id).join('')), ['AI Wizards:e', 'WizardOS:bc', 'Messenger:a', 'Notifications:n', 'Other:d']);
  assert.deepEqual(P.projectGroups(rows, 'oldest').find(x => x.word === 'WizardOS').rows.map(r => r.id), ['c', 'b'], 'the chosen order inside each');
  assert.deepEqual(P.readyFlat(rows, 'newest', 'project').map(r => r.id), ['e', 'b', 'c', 'a', 'n', 'd'], 'the walk follows what is drawn');
  assert.deepEqual(P.GROUP_MODES.map(m => m[1]), ['By status', 'By project', 'One list']);
  assert.deepEqual(P.railRows({ ready: rows }, 'proj:WizardOS', 'newest').map(r => r.id), ['b', 'c']);
  assert.deepEqual(P.railActive({ ready: rows }, 'c', null, 'newest', 'projects'), { key: 'proj:WizardOS', i: 1, n: 2 });
  for (const f of ['web/desktop/desktop.js', 'web/app.js']) assert.doesNotMatch(read(f), /attention\?\.subject \|\| ''\)\.trim\(\)/, f + ': one name only, the title\'s project');

  // (The sidebar's Group By project drop-down showed only with Channels off; Activity, on for everyone since
  // wizard-ux issue 1258, draws Ready as one list. The parts stay for the rail model.)
  assert.equal(P.titleInProject({ title: 'WizardOS · Hotkeys' }), 'Hotkeys'); assert.equal(P.titleInProject({ title: 'No project here' }), 'No project here');
  assert.equal(P.titleInProject({ title: 'Mail · x', note: true }), 'Mail · x', 'notifications keep their title');
  assert.equal(P.groupMode('subject'), 'none');
});

test('a remembered rail key cannot hide the current chat marker after switching grouping', async () => {
 const P=await import(new URL('web/layouts/ai-apps/parts.js',root).href);
 const sessions={ready:[{id:'qa-project-current',title:'WizardOS · Rail',state:'needs'}]};
 assert.equal(P.railActive(sessions,'qa-project-current','ready','newest','projects').key,'proj:WizardOS');
 assert.equal(P.railActive(sessions,'qa-project-current','proj:WizardOS','newest','list').key,'ready');
 assert.equal(P.railActive(sessions,'qa-project-current','ready','newest','groups').key,'needs');
 assert.equal(P.railActive(sessions,'qa-project-current','proj:WizardOS','newest','groups').key,'needs');
});


// Activity (Channels on for everyone, wizard-ux issue 1258): the sidebar always draws Ready as one list (mode none).
for (const order of ['newest', 'oldest']) for (const mode of ['none']) test(`shared model: ${order}/${mode} sidebar, rail flyouts and keyboard draw exactly its IDs; phone uses the same Sort`, async () => {
  const P = await import('../web/layouts/ai-apps/parts.js');
  const M = globalThis.WizChatsListModel;
  const at = h => `2026-11-05T${String(h).padStart(2, '0')}:00:00Z`;
  const rows = [
    { id: 'needs', title: 'Alpha · Needs', state: 'needs', at: at(1) },
    { id: 'new', title: 'Beta · New', state: 'done', at: at(9) },
    { id: 'approval', title: 'Alpha · Approval', state: 'approval', at: at(2) },
    { id: 'failed', title: 'Beta · Failed', state: 'failed', at: at(8) },
    { id: 'notif:n', title: 'Mail · Note', note: true, rank: 2, at: at(7) },
    { id: 'tie-b', title: 'Beta · B', state: 'fyi', at: at(6) },
    { id: 'tie-a', title: 'Beta · A', state: 'fyi', at: at(6) },
    { id: 'notif:read', title: 'Read', note: true, snoozed: true, at: at(11) },
  ].map(r => ({ ...r, kind: 'ready', actions: [] }));
  const { w, keys } = deskWorld();
  w.api.sessions.order = () => order;
  w.api.storage.set('groupBy', mode);
  w.api.storage.set('groupReady', mode === 'status');
  const drawn = M.visibleIds(rows, order, mode);
  // Chats' own session list hands Activity its rows already in the chosen order; the layout draws them as given.
  w.st.sessions = { ready: drawn.map(id => rows.find(r => r.id === id)), working: [], snoozed: [], archive: [] };
  (await layout()).default(w.api);
  assert.deepEqual(w.qa('#aad-sec-ready .aad-rw').map(n => n.dataset.sid), drawn, 'sidebar');
  // Walk via the real layout key handler; notifications route through the same row identity.
  let cur = null;
  for (const id of drawn) {
    w.st.route = cur?.startsWith('notif:') ? { home: false, view: 'thread', thread: '__new__', notification: cur.slice(6), desk: 1 } : { home: false, view: 'thread', thread: cur, desk: 1 };
    w.emit('route', w.st.route);
    assert.ok(keys.some(h => h.down({ altKey: true, code: 'ArrowDown' }) === true));
    assert.equal(w.st.opened.at(-1), 'thread:' + id, 'keyboard reaches drawn row');
    cur = id;
  }
  w.q('.aad-tog').dispatchEvent(new FakePointerEvent('click'));
  const groups = mode === 'none' ? [{ state: 'ready' }] : mode === 'project' ? P.projectGroups(rows, order) : P.readyGroups(rows, order);
  for (const g of groups) {
    w.st.timers.length = 0;
    w.q(`.aad-rk[data-k="${g.state}"]`).dispatchEvent(new FakePointerEvent('pointerenter'));
    w.st.timers.find(t => t.ms === 300 && !t.dead).fn();
    assert.deepEqual(w.qa('.aad-fly-i').map(n => n.dataset.sid), P.railRows({ ready: rows }, g.state, order).map(r => r.id), 'flyout');
    assert.equal(w.escape(), true, 'core Back dispatcher closes the flyout');
  }
  const phone = world(); phone.st.sessions = { ready: rows, working: [], snoozed: [], archive: [] }; phone.api.sessions.order = () => order;
  (await layout()).default(phone.api);
  phone.q('.aa-menu').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(phone.qa('.aa-chat').map(n => n.dataset.sid), M.visibleIds(rows, order, 'none'), 'phone drawer Sort');
});

test('desktop AI apps sidebar and rail flyout keep phone hours across midnight with a fixed clock', async t => {
  const now = Date.UTC(2026, 10, 3, 5);
  t.mock.method(Date, 'now', () => now);
  const { w, keys } = deskWorld();
  w.st.sessions.ready = [{ id: 'midnight', title: 'Yesterday afternoon', kind: 'ready', state: 'fyi', at: new Date(now - 15 * 3600e3).toISOString(), actions: [] }];
  w.st.sessions.working = []; w.st.sessions.snoozed = []; w.st.sessions.archive = [];
  (await layout()).default(w.api);
  assert.equal(w.q('.aad-rw[data-sid="midnight"] .aad-time').textContent, '15h');
  keys[1].down({ altKey: true, code: 'KeyL' });
  w.q('.aad-rk[data-k="ready"]').dispatchEvent(new FakePointerEvent('pointerenter'));
  w.st.timers.find(x => x.ms === 300 && !x.dead).fn();
  assert.equal(w.q('.aad-fly-i[data-sid="midnight"] .aad-fly-at').textContent, '15h');
});

test('left Option Space opens one existing picker without voice; release and unrelated modifiers preserve ownership', async () => {
  const { w, keys } = deskWorld(); let voices = 0; w.api.voice.talk = () => voices++;
  (await layout()).default(w.api); const h = keys[1];
  h.down({ code: 'AltLeft', altKey: true });
  assert.equal(h.down({ code: 'Space', altKey: true }), true);
  const sheet = w.q('.vc-sheet'); assert.ok(sheet);
  h.down({ code: 'Space', altKey: true, repeat: true }); h.up({ code: 'AltLeft', altKey: false });
  assert.equal(w.q('.vc-sheet'), sheet); assert.equal(voices, 0);
  w.escape(); h.down({ code: 'AltRight', altKey: true }); h.down({ code: 'Space', altKey: true });
  assert.equal(voices, 1, 'Right Option chord retains its prior web meaning');
  h.up({ code: 'AltRight', altKey: false });
  h.down({ code: 'AltLeft', altKey: true }); h.down({ code: 'Space', altKey: true, ctrlKey: true });
  assert.equal(w.q('.vc-sheet'), null); assert.equal(voices, 1);
});

test('launcher-link Video Editor remains searchable while open, Pin paints/persists and remount keeps Unpin', async () => {
  const mount = async saved => {
    const d = deskWorld(); Object.assign(d.store, saved || {});
    d.w.api.apps.kinds = () => ({ apps: d.w.api.apps.list(), dev: [{ id: 'video-editor', name: 'Video Editor' }] });
    d.w.st.desks.push({ id: 'video-editor', name: 'Video Editor', desk: 9 });
    (await layout()).default(d.w.api); return d;
  };
  const { w, store } = await mount(); w.q('.aad-vall').dispatchEvent(new FakePointerEvent('click'));
  assert.ok(w.q('.vc-app[data-app="video-editor"]'), 'open launcher links still appear in installed search'); w.escape();
  w.q('.aad-vtab[data-app="video-editor"]').dispatchEvent(new FakePointerEvent('contextmenu'));
  w.q('.aad-appmenu [data-act="pin"]').dispatchEvent(new FakePointerEvent('click'));
  assert.ok(store.pins.includes('video-editor')); assert.equal(w.q('.aad-vtab[data-app="video-editor"]').dataset.group, 'pin');
  const reloaded = await mount(store); const tab = reloaded.w.q('.aad-vtab[data-app="video-editor"]'); assert.equal(tab.dataset.group, 'pin');
  tab.dispatchEvent(new FakePointerEvent('contextmenu')); reloaded.w.q('.aad-appmenu [data-act="unpin"]').dispatchEvent(new FakePointerEvent('click'));
  assert.ok(!reloaded.store.pins.includes('video-editor')); assert.equal(reloaded.w.q('.aad-vtab[data-app="video-editor"]').dataset.group, 'open');
});

test('desktop app panel: an app with its companion pane (Video Editor video + Feedback) shows side-by-side CSS columns and a wider panel, never two windows stacked in one box, even when the shell has not re-tiled that desk (James, 6 Nov 2026)', async () => {
  const p = await panelDesk({ wins: 2 }), { w, style } = p, H = w.html.dataset, [app, side] = p.appWins;
  p.appDesk.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1100, height: 900, right: 1100, bottom: 900 });
  p.go({ view: 'desk', desk: 4 });
  assert.equal(p.appDesk.dataset.aadRole, 'app');
  assert.equal(H.aadWide, '', 'an app with its companion opens full width');
  const twoPx = parseFloat(w.html.style['--aad-app-px']);
  const d = style(p.appDesk);
  assert.equal(d('display'), 'flex', 'columns come from CSS, not from a shell re-tile that is skipped while another desk is current'); assert.ok(p.important(p.appDesk, 'display'));
  for (const x of [app, side]) assert.deepEqual([style(x)('position'), style(x)('inset')], ['relative', 'auto'], 'the shell\'s pixel boxes cannot stack the two windows');
  assert.equal(style(app)('flex'), '1 1 0', 'the app takes all the room the companion leaves');
  assert.equal(style(side)('flex'), '0 0 clamp(300px, 30%, 380px)', 'a companion is a narrow side column, not a third of the panel');
  assert.equal(p.appDesk.hasAttribute('data-aad-stack'), false, '1100 px of panel: side by side');
  assert.notEqual(d('flex-direction'), 'column');
  // James, 7 Nov 2026: never a side-by-side split in a narrow window (two columns only from 960 px of panel)
  const narrow = await panelDesk({ wins: 2 }); narrow.go({ view: 'desk', desk: 4 });
  assert.equal(narrow.appDesk.hasAttribute('data-aad-stack'), true, 'the panel width (300 px here) decides stacking');
  assert.equal(narrow.style(narrow.appDesk)('flex-direction'), 'column', 'a narrow panel stacks the app over its companion');
  // the companion closes: back to the side, a single window fills the panel
  side.className = 'win gone'; w.st.hostChanged(); w.run(); await settle();
  assert.equal(H.aadWide, undefined, 'and goes back to the side when the companion closes');
  assert.equal(style(app)('inset'), '0', 'a single window still fills the panel');
  assert.ok(twoPx > parseFloat(w.html.style['--aad-app-px']), `the panel was wider for two columns (${twoPx}px), and returns after`);
  // the owner's own Wider / Back press wins over the automatic one
  side.className = 'win'; w.st.hostChanged(); w.run(); await settle(); assert.equal(H.aadWide, '', 'the companion again: wide');
  w.q('.aad-pw').dispatchEvent(new FakePointerEvent('click')); assert.equal(H.aadWide, undefined, 'Back pressed');
  side.className = 'win gone'; w.st.hostChanged(); w.run(); await settle(); assert.equal(H.aadWide, undefined);
  side.className = 'win'; w.st.hostChanged(); w.run(); await settle();
});

test('desktop open chat stays on the same thread through Ready → Working → Ready and Archive', async () => {
  const { w } = deskWorld();
  const stage = new El('div'); stage.id = 'stage';
  const desk = new El('div'); desk.className = 'wsp';
  const win = new El('div'); win.className = 'win';
  const chats = new El('div'); chats.className = 'dchats';
  const pane = new El('div'); pane.className = 'pane-main';
  const done = new El('button'); done.dataset.chact = 'done';
  pane.append(done); chats.append(pane); win.append(chats); desk.append(win); stage.append(desk); w.doc.body.append(stage);
  w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 };
  const off = (await layout()).default(w.api);
  const original = w.st.sessions.ready.shift(), opens = w.st.opened.length, news = w.st.newChats;
  const held = () => {
    w.emit('render'); w.run();
    assert.equal(w.st.route.thread, 'r1'); assert.equal(w.html.dataset.aadChat, 'on');
    assert.equal(w.st.opened.length, opens, 'no next Ready selection'); assert.equal(w.st.newChats, news, 'no implicit close');
  };
  w.st.sessions.working.push({ ...original, kind: 'working' }); held();
  w.st.sessions.working = w.st.sessions.working.filter(s => s.id !== 'r1');
  w.st.sessions.ready.unshift(original); held();
  w.fire('click', done); w.run(); // previously queued nextAfterAct and selected r2
  w.st.sessions.ready.shift(); w.st.sessions.archive.push({ ...original, kind: 'archive' }); held();
  w.q('.aad-cx').dispatchEvent(new FakePointerEvent('click'));
  assert.equal(w.st.newChats, news + 1, 'manual ✕ still closes');
  off();
});

/* Agent choices in the AI apps sidebar (James, 10 Nov 2026): with more than one agent the sidebar shows All + each agent
 * under the header, riding Chats' own Focus (api.agents.setFocus -> setFocus / winAgent). One agent: no control. */
const agentsWorld = async (agents, focus = { id: '' }) => {
  const w = world({ shell: 'desktop' }), store = {}, keys = [], calls = [];
  Object.assign(w.api, { asset: n => '/wizard-os-home/layouts/ai-apps/' + n, storage: { get: k => k in store ? store[k] : null, set: (k, v) => { store[k] = v; } },
    keys: { on: h => { keys.push(h); return () => {}; }, guide: () => () => {} }, orb: { ready: () => new Promise(() => {}), onLevel: () => () => {} }, voice: { state: () => ({ state: 'idle' }), talk() {}, command() {} },
    desk: { settings() {}, home() {} } });
  w.api.apps.inset = () => () => {};
  const everyone = JSON.parse(JSON.stringify(w.st.sessions));
  w.api.agents = { list: () => [{ id: 'hermes', label: 'Oscar', main: true }], focus: () => ({ id: focus.id, agents }),
    setFocus: id => { calls.push(id); focus.id = id; w.st.sessions = id ? { working: [], ready: [{ id: 'p1', title: 'Philosopher chat', kind: 'ready', unread: false, pinned: false, actions: ['pin', 'rename'] }], archive: [] } : everyone; return true; } };
  const sessionsSeen = [];
  const all = w.api.sessions.list; w.api.sessions.list = o => { sessionsSeen.push(o); return all(); };
  (await layout()).default(w.api);
  return { ...w, calls, sessionsSeen, focus };
};
const TWO = [{ id: 'hermes', label: 'Oscar', colour: '#7aa2ff', private: false, main: true }, { id: 'philosopher', label: 'Philosopher', colour: '#c58bff', private: false, main: false }];

// The All + agent chips under the header showed only with Channels off. Activity (on for everyone since wizard-ux
// issue 1258) lists every agent's chats with no chips: the agents live in the Channels list.
test('agent choices: with a second agent the Activity sidebar draws no agent chips; it lists every agent\'s chats', async () => {
  const w = await agentsWorld(TWO);
  const row = w.q('.aad-agents');
  assert.ok(!row || row.hidden, 'no chips');
  assert.equal(row?.children.length || 0, 0);
  assert.equal(w.calls.length, 0, 'no Focus set by the sidebar');
  assert.ok(w.sessionsSeen.length && w.sessionsSeen.every(o => o?.activity === true), 'the sidebar reads the Activity list');
  assert.match(w.q('.aad-scroll').textContent, /Ready one/, 'the chats are listed');
});

test('agent choices: one agent (or none known) = no control at all', async () => {
  for (const agents of [[TWO[0]], []]) {
    const w = await agentsWorld(agents);
    assert.ok(!w.q('.aad-agents') || w.q('.aad-agents').hidden, 'hidden');
    assert.equal(w.q('.aad-agents')?.children.length || 0, 0);
  }
  // a shell that has no agent Focus (the phone adapter) draws nothing and never throws
  const w = world({ shell: 'desktop' }); Object.assign(w.api, { asset: n => n, storage: { get: () => null, set() {} }, keys: { on: () => () => {}, guide: () => () => {} }, orb: { ready: () => new Promise(() => {}), onLevel: () => () => {} }, voice: { state: () => ({ state: 'idle' }), talk() {}, command() {} }, desk: { settings() {}, home() {} } });
  w.api.apps.inset = () => () => {}; (await layout()).default(w.api);
  assert.ok(!w.q('.aad-agents') || w.q('.aad-agents').hidden);
});

test('agent choices: the shell side reuses Chats\' Focus (no second router) and the layout API exposes it', async () => {
  // the layout API: agents.focus / setFocus go straight to the shell's agentFocusSet (no router of their own)
  const f = fixture({ shell: 'desktop' }), set = [];
  let api = null; f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  Object.assign(f.adapter, { agentFocusSet: id => { set.push(id); return true; }, agentFocus: () => ({ id: 'mia', agents: [{ id: 'mia', label: 'Mia' }] }) });
  f.host.setStandardLayout('ai-apps'); await settle();
  assert.equal(api.agents.setFocus('mia'), true); assert.equal(api.agents.setFocus(null), true); assert.equal(api.agents.setFocus(7), true);
  assert.deepEqual(set, ['mia', '', ''], 'an agent, else All (\'\')');
  assert.equal(api.agents.focus().id, 'mia', 'the Focus Chats has');
  // the desktop shell: picking = openAgentChats (Chats\' Focus on the main window), All = CHATS.setFocus(main, null)
  const boot = read('web/desktop/desktop-boot.js');
  const fn = runRecording(`this.fn = ${between(boot, 'agentFocusSet: id => ', ',\n').replace(/^agentFocusSet: /, '')};`, { findWin: () => ({ id: 'main' }), mainChats: 'main', CHATS: { setFocus: (w, x) => { fn.calls.push(['setFocus', w.id, x]); return true; } }, calls: [] });
  assert.equal(fn.fn('mia'), true); assert.equal(fn.fn(''), true);
  assert.deepEqual(fn.calls.map(c => c.join(' ')), ['openAgentChats mia', 'setFocus main '], 'one router: Chats\' own');
  // Chats\' list for a Focus is its own focusMatches
  const chats = withParts(read('web/core/chats.js'));
  const rows = runRecording(`${block(chats, '  function focusRows(w) {')}\nthis.rows = focusRows;`, { focusOf: w => w.focus, winAgent: () => null, LIVE: { unified: () => [{ id: 'a', agent: 'mia' }, { id: 'b', agent: 'max' }, { id: 'c', agent: 'mia', hidden: true }] }, focusMatches: (w, s) => s.agent === w.focus }).rows;
  assert.deepEqual(rows({ focus: 'mia' }).map(s => s.id), ['a'], 'the list is Chats\' own focusMatches'); assert.equal(rows({ focus: '' }), null, 'no Focus: the plain list');
  // tokens only: the agent choices' css carries no literal colours, and is not a floating panel
  const css = read('web/layouts/ai-apps/desktop.css');
  const agentCss = css.split('\n').filter(l => /\.aad-ag/.test(l)).join('\n');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(agentCss.replace(/\/\*[\s\S]*?\*\//g, '')), 'tokens only, no literal colours');
  assert.ok(!/background:[^;]*transparent[^;]*;[^}]*\.aad-agents/.test(css), 'not a floating panel');
});

/* Regression (10 Nov 2026, forum run 4): agents.focus called `live()`, which only exists further down in skin-host.js
 * (inside the sessions block), so ai-apps threw `ReferenceError: live is not defined` on mount and fell into layout
 * recovery. The unit tests above run the layout against a stub API and never executed skin-host's own scope. This one
 * evaluates the real `agents: Object.freeze({ ... })` block of makeApi() with only the names that block may use
 * (shell, need): any other free identifier is a ReferenceError the moment the method is called. */
const agentsBlock = () => {
  const src = withSkinHostParts(read('web/core/skin-host.js')), at = src.indexOf('agents: Object.freeze({');
  assert.ok(at > 0, 'agents block found');
  let i = src.indexOf('{', at), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(at + 'agents: '.length, j + 2);   // Object.freeze({ ... })
};
const loadAgents = (shell, extra = {}) => new Function('shell', 'need', ...Object.keys(extra), `'use strict'; return (${agentsBlock()});`)(shell, () => ({ openAgent() {} }), ...Object.values(extra));

test('skin-host agents.focus / setFocus run in their own scope (no out-of-scope live(), the run-4 ReferenceError)', () => {
  const picked = [];
  const shell = { agentFocus: () => ({ id: 'philosopher', agents: [{ id: 'hermes', label: 'Oscar', main: true }, { id: 'philosopher', label: 'Philosopher', colour: '#fff', private: false }] }), agentFocusSet: id => { picked.push(id); return true; } };
  const a = loadAgents(shell);
  const f = a.focus();
  assert.equal(f.id, 'philosopher'); assert.deepEqual(f.agents.map(x => x.label), ['Oscar', 'Philosopher']);
  assert.ok(Object.isFrozen(f) && Object.isFrozen(f.agents) && Object.isFrozen(f.agents[0]), 'frozen copies');
  assert.equal(a.setFocus('philosopher'), true); assert.equal(a.setFocus(7), true);
  assert.deepEqual(picked, ['philosopher', ''], 'a non-string means All');
  for (const bare of [null, {}]) {   // no shell yet / a shell with no agent Focus (the phone adapter): empty, false, never throws
    const b = loadAgents(bare);
    assert.deepEqual({ id: b.focus().id, n: b.focus().agents.length }, { id: '', n: 0 }); assert.equal(b.setFocus('philosopher'), false);
  }
  // the guard itself: a free identifier in that block is caught (this is what live() was)
  const broken = new Function('shell', 'need', `'use strict'; return ({ focus: () => live() ? shell.agentFocus() : null });`)(shell, () => ({}));
  assert.throws(() => broken.focus(), ReferenceError);
});

/* A narrower window, one app at a time (James, 12 Nov 2026, the approved mockup: Wizard at half or a third of his screen
 * beside Zoom): from 1100 px today's layout, unchanged; narrower, an app fills the main area with no sidebar and no chat
 * docked beside it, the Apps column is the app bar along the bottom (Chats first, the orb at its centre, All apps last),
 * one click switches Chats <-> an app, and Chats shows the list beside the chat from 680 px (DOCKED_FROM), narrower the
 * list, then the chat alone with a visible Back at the top left (Esc the same; at the list Back goes to the app before). */
test('desktop one app at a time: 1440 unchanged; 900 the bottom app bar, Chats first, one click each; Chats two panes at 720, one with Back at 600', async () => {
  const had = globalThis.innerWidth;
  const run = async width => {
    globalThis.innerWidth = width;
    const { w } = deskWorld();
    // (the shell's desk switch names the new desk in its route at once, as the real one does)
    w.api.nav.goDesk = i => { w.st.gone.push(i); w.st.route = i === 1 ? { home: false, view: 'thread', thread: w.st.route.thread || 'r1', desk: 1 } : { home: false, view: 'desk', thread: null, desk: i }; w.emit('route', w.st.route); };
    const stage = new El('div'); stage.id = 'stage';
    const chatDesk = new El('div'); chatDesk.className = 'wsp'; chatDesk.dataset.ws = '1'; const dchats = new El('div'); dchats.className = 'dchats'; dchats.dataset.thread = 'r1'; chatDesk.append(dchats);
    const appDesk = new El('div'); appDesk.className = 'wsp'; appDesk.dataset.ws = '5'; stage.append(chatDesk, appDesk); w.html.children[0].append(stage);
    (await layout()).default(w.api);
    const H = w.html.dataset, px = k => parseFloat(w.html.style.getPropertyValue(k));
    const d = () => ({ side: H.aadSide, one: H.aadOne, chat: H.aadChat, split: H.aadSplit, wide: H.aadWide, tabs: H.aadTabs, edge: H.aadDockEdge });
    w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route); w.run();
    const ob = [w.q('.aad-cback'), w.q('.aad-oneback')].find(b => b && !b.hidden) || w.q('.aad-oneback'), chat = { ...d(), back: ob ? { hidden: ob.hidden, textContent: ob.textContent } : null, backAt: ob?.parentNode?.className || '' };
    w.st.route = { home: false, view: 'desk', thread: null, desk: 5 }; w.emit('route', w.st.route); w.run();
    const app = { ...d(), appW: px('--aad-pane-app-width'), mainW: px('--aad-pane-main-width'), sideW: px('--aad-pane-side-width'), dockH: px('--aad-pane-dock-height'), dockW: px('--aad-pane-dock-width') };
    return { w, chat, app, d };
  };
  try {
    // 1440: today's layout (the Apps column at the right, the chat docked beside the app, no bar)
    const wide = await run(1440);
    assert.equal(wide.app.one, undefined); assert.equal(wide.app.chat, 'on', '1440: the chat docked beside the app, as before');
    assert.notEqual(wide.app.tabs, 'bar'); assert.equal(wide.app.edge, 'end', '1440: the Apps column at the right');
    assert.equal(wide.w.q('.aad-vone').hidden, true, '1440: no Chats item in the column');
    // 900: one app, the bottom app bar with Chats first
    const n = await run(900), { w } = n;
    assert.equal(n.app.one, 'app'); assert.equal(n.app.side, 'none', 'no sidebar beside the app'); assert.equal(n.app.chat, undefined, 'no chat docked beside it');
    assert.equal(n.app.wide, '', 'the app fills the main area'); assert.equal(n.app.appW, n.app.mainW); assert.equal(n.app.sideW, 0);
    assert.equal(n.app.tabs, 'bar'); assert.equal(n.app.edge, 'bottom', 'the bar along the bottom (ONE.bar)');
    assert.equal(n.app.dockW, 900, 'the bar spans the window'); assert.ok(n.app.dockH > 40 && n.app.dockH <= 80, 'a bar, not a column');
    const vt = w.q('.aad-vt'), kids = vt.children.map(k => k.className);
    assert.ok(kids.indexOf('aad-vone') < kids.indexOf('aad-vtl') && kids.indexOf('aad-vtl') < kids.indexOf('aad-vtf'), 'Chats, then the apps, then All apps');
    assert.equal(w.q('.aad-vone').hidden, false); assert.equal(w.q('.aad-vchats').getAttribute('aria-pressed'), 'false');
    const tabs = w.qa('.aad-vtl .aad-vtab'), notes = tabs.find(t => t.dataset.app === 'notes');
    assert.ok(notes, 'the open apps are in the bar'); assert.ok(tabs.every(t => t.dataset.half === 'l' || t.dataset.half === 'r'), 'each app either side of the orb');
    assert.equal(w.q('.aad-vtl').getAttribute('aria-orientation'), 'horizontal');
    // one click: Chats; one click: Notes again
    w.q('.aad-vchats').dispatchEvent(new FakePointerEvent('click'));
    assert.equal(w.html.dataset.aadOne, 'chats', 'one click shows Chats (the same frame)');
    assert.equal(w.q('.aad-vchats').getAttribute('aria-pressed'), 'true');
    w.st.route = { home: false, view: 'thread', thread: 'r1', desk: 1 }; w.emit('route', w.st.route); w.run();
    const gone = w.st.gone.length;
    w.qa('.aad-vtl .aad-vtab').find(t => t.dataset.app === 'notes').dispatchEvent(new FakePointerEvent('click'));
    assert.equal(w.st.gone.at(-1), 5, 'one click on Notes goes to its desk'); assert.equal(w.st.gone.length, gone + 1);
    w.st.route = { home: false, view: 'desk', thread: null, desk: 5 }; w.emit('route', w.st.route); w.run();
    assert.equal(w.html.dataset.aadOne, 'app');
    // the bar's CSS: placed by the pane geometry's dock box, the orb at its centre, the stage ending at the bar
    w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps'); assert.equal(w.html.dataset.aadTabs, 'bar');
    const bar = (n, k) => { assert.ok(n, 'drawn'); return cascade(n, DESK_CSS)[k]?.value ?? ''; };
    const orders = [w.q('.aad-vchats'), ...w.qa('.aad-vtl .aad-vtab'), w.q('.aad-vall')].map(n => Number(bar(n, 'order') || 0));
    assert.ok(orders[0] < Math.min(...orders.slice(1)) && orders.at(-1) > Math.max(...orders.slice(0, -1)), 'Chats first, All apps last: ' + orders);
    // ux#1552: the orb sized to the bar (44 px), not the wide window's 60 px, centred on the pane geometry's dock box
    const orbEl = w.q('.aad-orb'), vars = { ...cascade(w.html, DESK_CSS) && Object.fromEntries(Object.entries(cascade(w.html, DESK_CSS)).map(([k, v]) => [k, v.value])), ...w.html.style };
    assert.equal(resolveVars(bar(orbEl, 'width'), vars), '44px', 'the bar orb is 44 px'); assert.equal(resolveVars(bar(orbEl, 'height'), vars), '44px');
    const dx = parseFloat(w.html.style.getPropertyValue('--aad-pane-dock-x')), dwid = parseFloat(w.html.style.getPropertyValue('--aad-pane-dock-width'));
    assert.ok(Number.isFinite(dx) && dwid > 0, 'the pane geometry gives the dock box');
    const orbLeft = resolveVars(bar(orbEl, 'left'), vars).match(/^calc\(([\d.]+)px \+ ([\d.]+)px \/ 2 - ([\d.]+)px \/ 2\)$/);
    assert.ok(orbLeft, 'left: ' + resolveVars(bar(orbEl, 'left'), vars)); assert.equal(+orbLeft[1] + orbLeft[2] / 2 - orbLeft[3] / 2, dx + dwid / 2 - 22, 'the orb at the bar\'s centre');
    // 720: Chats with its list beside the chat
    const m = await run(720);
    assert.equal(m.chat.one, 'chats'); assert.equal(m.chat.side, 'open', '720: the list beside the chat'); assert.ok(!m.chat.back || m.chat.back.hidden, 'no Back: the list is beside it');
    assert.equal(m.app.one, 'app'); assert.equal(m.app.tabs, 'bar');
    // 600: the chat alone with Back at the top left; Back / Esc the list; at the list Back stays put
    const s = await run(600);
    assert.equal(s.chat.side, 'none', '600: the chat alone'); assert.equal(s.chat.back.hidden, false, 'a visible Back');
    assert.match(s.chat.back.textContent, /^‹ (Chats|Activity|Channels)$/); assert.match(s.chat.backAt, /aad-(ctop|top)/, 'at the top left of the chat');
    s.w.q('.aad-vchats').dispatchEvent(new FakePointerEvent('click')); s.w.run();   // from the app: Chats as it was, the chat
    assert.equal(s.w.html.dataset.aadOne, 'chats'); assert.equal(s.w.html.dataset.aadSide, 'none'); assert.ok([s.w.q('.aad-cback'), s.w.q('.aad-oneback')].filter(b => b && !b.hidden).length === 1, 'one visible Back');
    assert.equal(s.w.escape(), true, 'Esc is Back'); assert.equal(s.w.html.dataset.aadSide, 'full', 'the list again');
    // at the list Back goes to the app that was in front before Chats (Notes, wizard-ux issues 1314, 1452)
    const left = s.w.st.gone.length;
    assert.equal(s.w.escape(), true, 'at the list'); assert.equal(s.w.st.gone.at(-1), 5, 'Back from the list: the app before'); assert.equal(s.w.st.gone.length, left + 1);
    s.w.st.route = { home: false, view: 'desk', thread: null, desk: 5 }; s.w.emit('route', s.w.st.route); s.w.run();
    assert.equal(s.w.html.dataset.aadOne, 'app');
    s.w.q('.aad-vchats').dispatchEvent(new FakePointerEvent('click')); s.w.run();
    assert.equal(s.w.html.dataset.aadOne, 'chats');
  } finally { if (had === undefined) delete globalThis.innerWidth; else globalThis.innerWidth = had; }
});
