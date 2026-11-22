import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withWebParts } from './fixtures/web-parts.mjs';
import { closingPart } from '../web/layouts/ai-apps/desktop-closing.js';
const read = p => withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i); assert.ok(j > i, b); return src.slice(i, j + b.length); };

test('AI apps pane: only the common desk slides; its title/window/body/frame never ease independently', () => {
 const css = read('web/layouts/ai-apps/desktop.css');
 const scoped = 'html[data-shell="desktop"][data-layout="ai-apps"] #stage > .wsp[data-aad-role="app"]';
 const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.split('{'));
 for (const suffix of [' > .aad-ptop', ' > .win', ' > .win > :is(.wbar, .wbody)', ' > .win > .wbody > iframe']) {
  const rule = rules.find(([selector]) => selector.split(',\n').some(s => s.trim() === scoped + suffix));
  assert.ok(rule, 'explicit child motion contract: ' + suffix);
  const transitions = rule[1].match(/transition:\s*([^;]+)/)?.[1];
  assert.ok(transitions, suffix);
  assert.doesNotMatch(transitions, /\b(all|transform|translate|left|right|width|inset)\b/, 'no independent positional transition');
 }
 assert.doesNotMatch(css, /\.aad-ptop\[data-aad-anim="app"\]\s*\{\s*animation:/, 'no separate title animation');
 assert.match(css, /prefers-reduced-motion: reduce[^}]*#stage > \.wsp[^}]*animation: none !important/s);
});

// The real hide/wide code (layouts/ai-apps/desktop-closing.js) with small stand-ins for the layout it is handed.
function closing({ reduced = false, one = false } = {}) {
 const node = name => ({ name, attrs: {}, children: [], title: '', setAttribute(k, v) { this.attrs[k] = v; }, replaceChildren() {} });
 const motions = [], flips = [], after = [];
 const pane = { id: 'notes', desk: 2, el: { getBoundingClientRect: () => ({ width: 600 }), animate: (frames, o) => { const m = { frames, o, cancelled: false, cancel() { this.cancelled = true; } }; motions.push(m); return m; } } };
 const aadVars = { pane, closing: null, exitMotion: null, wide: false, chatThread: null };
 const api = { after: (ms, fn) => { after.push(fn); return () => {}; }, frame: fn => fn(), listen() {}, nav: { goDesk() {} }, sessions: { newChat() {} } };
 const part = closingPart({ aadVars, anim() {}, api, cX: node('cX'), doneLoading() {}, DRAFT: {}, FEED: {}, feedBack: () => false, feedGone() {}, icon: n => n,
  flip: (els, fn) => { flips.push(els); fn(); }, focusFrame() {}, mainChats: () => null, one: () => one, oneSplit: () => false, paintSide() {}, paintSplit() {}, panes: { get: () => ({}) },
  peekable: () => false, pTop: node('pTop'), pW: node('pW'), pX: node('pX'), reduced: () => reduced, retileSoon() {}, root: { dataset: {} }, wantAppFocus() {} });
 part.bindLate({ here: () => ({ app: 'other' }), paintTop() {} });
 return { part, aadVars, pane, motions, flips, after };
}

test('AI apps pane: hiding slides the common desk out alone, and Wider moves only that desk', () => {
 const c = closing();
 assert.equal(c.part.hidePanel(), true);
 assert.equal(c.motions.length, 1, 'one exit motion, on the pane desk itself');
 assert.deepEqual(c.motions[0].frames.map(f => f.translate), ['0px 0px', '480px 0px']);
 assert.equal(c.aadVars.exitMotion, c.motions[0]);
 c.after.shift()();
 assert.equal(c.aadVars.pane, null); assert.equal(c.motions[0].cancelled, true, 'the finished motion is let go');
 assert.equal(c.aadVars.exitMotion, null);
 for (const opts of [{ reduced: true }, { one: true }]) { const r = closing(opts); r.part.hidePanel(); assert.equal(r.motions.length, 0, JSON.stringify(opts)); assert.equal(r.aadVars.pane, null); }
 const w = closing(); w.part.setWide(true);
 assert.deepEqual(w.flips, [[w.pane.el]], 'no nested FLIP of the header beside its desk');
});

test('AI apps pane: the header lives on the pane desk, and teardown gives it back and cancels the exit motion', () => {
 const split = read('web/layouts/ai-apps/desktop-split.js'), desk = read('web/layouts/ai-apps/desktop.js');
 const host = between(split, '    const headerHost = ', 'headerHost.append(pTop);');
 const tear = between(desk, '    closing?.(); closing = null; exitMotion?.cancel?.()', 'top.append(pTop);');
 const el = name => ({ name, kids: [], append(n) { if (n.parentNode) n.parentNode.kids.splice(n.parentNode.kids.indexOf(n), 1); n.parentNode = this; this.kids.push(n); } });
 const top = el('top'), paneEl = el('pane'), pTop = { parentNode: null };
 const ctx = vm.createContext({ top, pTop, aadVars: { pane: { el: paneEl } }, closing: null, exitMotion: null });
 vm.runInContext(`this.paint = () => {\n${host}\n}; this.teardown = () => {\n${tear}\n};`, ctx);
 ctx.paint();
 assert.equal(pTop.parentNode, paneEl, 'the app header moves into the one pane that slides');
 ctx.aadVars.pane = null; ctx.paint();
 assert.equal(pTop.parentNode, top);
 ctx.aadVars.pane = { el: paneEl }; ctx.paint();
 let closed = 0; const motion = { cancelled: 0, cancel() { this.cancelled++; } };
 ctx.closing = () => closed++; ctx.exitMotion = motion;
 ctx.teardown();
 assert.equal(closed, 1); assert.equal(motion.cancelled, 1, 'the parent exit animation is cancelled with its timer');
 assert.equal(ctx.exitMotion, null);
 assert.equal(pTop.parentNode, top, 'teardown restores Classic ownership of the header');
});

test('AI apps pane: an app opening marks only its desk to animate, never its header', () => {
 const desk = read('web/layouts/ai-apps/desktop.js');
 const src = between(desk, '  let animOff = null, animOn = [];', 'animOn = []; animOff = null; });\n  }');
 const n = name => ({ name, dataset: {} });
 const paneEl = n('pane'), chat = n('chat'), cTop = n('cTop'), pTop = n('pTop'), timers = [];
 const ctx = vm.createContext({ pane: { el: paneEl }, cTop, pTop, chatsEl: () => chat, api: { after: (ms, fn) => { timers.push(fn); return () => {}; } } });
 vm.runInContext(src + '\nthis.anim = anim;', ctx);
 ctx.anim('app');
 assert.equal(paneEl.dataset.aadAnim, 'app'); assert.equal(pTop.dataset.aadAnim, undefined); assert.equal(chat.dataset.aadAnim, undefined);
 ctx.anim('dock');
 assert.equal(paneEl.dataset.aadAnim, undefined, 'the previous mark is cleared'); assert.equal(chat.dataset.aadAnim, 'dock'); assert.equal(cTop.dataset.aadAnim, 'dock');
 timers.at(-1)();
 assert.equal(chat.dataset.aadAnim, undefined);
});
