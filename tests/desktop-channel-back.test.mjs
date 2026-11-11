// Back from a thread to its channel on the desktop (wizard-ux issue 1302; James, 11 Nov 2026: "if I open a channel and then
// I click through to a thread there's no way for me to go back to the channel currently so I think on desktop we will
// need a back button. at least when the user opens a chat from a channel"). The AI apps main column: a thread opened from
// the channel's feed shows "‹ # name" at the left of its header, and it is Esc (closeChat: the feed, at its place). A
// thread opened from Activity or the sidebar shows none. The phone (its own Back) is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const js = read('web/layouts/ai-apps/desktop.js'), css = read('web/layouts/ai-apps/desktop.css');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };

function world() {
  const listeners = [], attrs = {};
  const cBack = { hidden: true, textContent: '', title: '', setAttribute: (k, v) => { attrs[k] = v; } };
  const c = { FEED: '__feed__', feedBox: {}, cBack, open: { id: 'apps', name: 'WizardOS Apps' }, chatThread: '__feed__', docked: true, closed: 0,
    api: { listen: (t, type, fn, opts) => listeners.push({ t, type, fn, opts }) } };
  c.feedOn = () => c.open; c.closeChat = () => { c.closed++; return true; };
  vm.createContext(c);
  vm.runInContext(between(js, '  let fromFeed = null;', '  // A channel opened in the sidebar: its feed comes') + `
    this.t = { feedPost, feedBack, paintBack, get fromFeed() { return fromFeed; }, set chat(v) { chatThread = v; } };`, c);
  // chatThread / docked live in the excerpt's own scope as globals of the context
  const clickOn = (attrsOf, extra = {}) => ({ target: { closest: sel => {
    if (sel === '[data-chopen], [data-chreply]') return attrsOf ? { dataset: attrsOf } : null;
    return extra[sel] || null; } } });
  const post = (sid, extra) => listeners.find(l => l.t === c.feedBox).fn(clickOn({ chopen: sid }, extra));
  const reply = sid => listeners.find(l => l.t === c.feedBox).fn(clickOn({ chreply: sid }));
  const back = () => listeners.find(l => l.t === cBack && l.type === 'click').fn();
  const paint = thread => { c.chatThread = thread; c.t.paintBack(); };
  return { c, cBack, attrs, listeners, post, reply, back, paint };
}

test('a post opened from the feed: "‹ # channel" in the header, and it does what Esc does (closeChat)', () => {
  const x = world();
  const cap = x.listeners.find(l => l.t === x.c.feedBox);
  assert.equal(cap.type, 'click'); assert.equal(cap.opts, true, 'captured before the feed opens the thread');
  x.post('s1'); x.paint('s1');
  assert.equal(x.cBack.hidden, false);
  assert.equal(x.cBack.textContent, '‹ # WizardOS Apps');
  assert.equal(x.attrs['aria-label'], 'Back to # WizardOS Apps (Esc)');
  x.back(); assert.equal(x.c.closed, 1, 'the same closeChat Esc runs: the feed again, at its place');
  x.paint('__feed__'); assert.equal(x.cBack.hidden, true, 'on the feed: no Back');
});

test('a post\'s Reply opens with Back too; a link inside a post, or the row sheet, does not count', () => {
  const x = world();
  x.reply('s2'); x.paint('s2'); assert.equal(x.cBack.hidden, false);
  const y = world();
  y.post('s3', { '.ch-post-t a[href]': {} }); y.paint('s3'); assert.equal(y.cBack.hidden, true);
  y.post('s3', { '.ch-sheet': {} }); y.paint('s3'); assert.equal(y.cBack.hidden, true);
});

test('a thread opened from Activity or the sidebar has no Back; another chat spends the post\'s Back', () => {
  const x = world();
  x.paint('a1'); assert.equal(x.cBack.hidden, true, 'never opened from the feed');
  x.post('s1'); x.paint('s1'); assert.equal(x.cBack.hidden, false);
  x.paint('a1'); assert.equal(x.cBack.hidden, true, 'an Activity thread in the column');
  x.paint('s1'); assert.equal(x.cBack.hidden, true, 'the same post later, from Activity: no Back');
  const y = world();
  y.post('s1'); y.paint('s1'); y.c.open = { id: 'other', name: 'Other' }; y.paint('s1');
  assert.equal(y.cBack.hidden, true, 'its channel no longer the one open');
  const z = world(); z.post('s1'); z.c.docked = false; z.paint('s1'); assert.equal(z.cBack.hidden, true, 'not docked: none');
  const n = world(); n.c.open = null; n.post('s1'); n.paint('s1'); assert.equal(n.cBack.hidden, true, 'no feed open: none');
});

test('wiring: the Back sits left of the title, every sidebar open clears it, the header repaints it; tokens only', () => {
  assert.match(js, /const cBack = el\('button', 'aad-cback', \{ type: 'button' \}\); cBack\.hidden = true;\n  cTop\.append\(cBack, tt, cX\);/);
  assert.match(js, /tt\.textContent = docked \? t : ''; tt\.title = t; paintBack\(\);/);
  assert.match(js, /stepAt = s\.id; fromFeed = null; api\.sessions\.open\(s\.id\);/, 'an Activity row');
  assert.match(js, /noteWant = id\.startsWith\('notif:'\); fromFeed = null; api\.sessions\.open\(id\);/, 'the rail');
  assert.match(js, /noteWant = nx\.id\.startsWith\('notif:'\); fromFeed = null; api\.sessions\.open\(nx\.id\);/, '⌥↓ / ⌥↑');
  const rule = css.match(/\.aad-cback \{([^}]+)\}/)[1];
  assert.doesNotMatch(rule.replace(/var\([^)]*\)/g, ''), /#[0-9a-f]{3,8}\b|rgb/i, 'colours from tokens');
  assert.match(css, /\.aad-cback\[hidden\] \{ display: none; \}/);
  assert.doesNotMatch(read('web/layouts/ai-apps/layout.js'), /aad-cback|fromFeed/, 'the phone is unchanged');
});
