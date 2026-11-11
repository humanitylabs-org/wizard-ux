// WosMorph (web/core/dom-morph.js) on a tiny fake DOM: enough HTML parsing and node moves to repaint a channel feed.
// Issue 1287: an agent post's header button and its words block share a key (data-chopen); a repaint must keep
// exactly one words block per post, not insert a copy beside the old one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/dom-morph.js', import.meta.url), 'utf8');

class Node {
  constructor(type, name) { this.nodeType = type; this.nodeName = name; this.parentNode = null; this.childNodes = []; this.attrs = new Map(); this.nodeValue = null; }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.childNodes.find(c => c.nodeType === 1) || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.root === true; }
  remove() { if (this.parentNode) { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
  insertBefore(n, ref) { n.remove(); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); n.parentNode = this; return n; }
  appendChild(n) { return this.insertBefore(n, null); }
  clone() { const c = new Node(this.nodeType, this.nodeName); c.nodeValue = this.nodeValue; c.attrs = new Map(this.attrs); for (const k of this.childNodes) c.appendChild(k.clone()); return c; }
  qsa(cls, out = []) { for (const k of this.childNodes) { if (k.nodeType === 1 && (k.getAttribute('class') || '').split(' ').includes(cls)) out.push(k); k.qsa(cls, out); } return out; }
}
function parse(html) {
  const frag = new Node(11, '#document-fragment'); let cur = frag;
  for (const [, close, tag, attrs, text] of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) { const t = new Node(3, '#text'); t.nodeValue = text; cur.appendChild(t); continue; }
    if (close) { cur = cur.parentNode; continue; }
    const el = new Node(1, tag.toUpperCase());
    for (const [, n, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(n, v);
    cur.appendChild(el); if (!/^(img|br|input)$/i.test(tag)) cur = el;
  }
  return frag;
}
function load() {
  const document = { createElement: () => { const t = {}; Object.defineProperty(t, 'innerHTML', { set(h) { t.content = parse(h); } }); return t; }, importNode: n => n.clone() };
  const ctx = { document }; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx); return ctx.WosMorph;
}
const post = (id, words, t) => `<div class="ch-post by-agent" data-morph-key="post:${id}"><span class="ch-post-me"></span><div class="ch-post-c"><button type="button" class="ch-post-b" data-chopen="${id}"><span class="ch-post-h"><b>Wizard</b><time>${t}</time></span></button><div class="ch-post-tb" data-chopen="${id}"><span class="ch-post-t"><strong>${words}</strong></span></div><span class="ch-post-rr"><button type="button" class="ch-post-reply" data-chreply="${id}">Reply</button></span></div></div>`;
const own = (id, t) => `<div class="ch-post" data-morph-key="post:${id}"><div class="ch-post-c"><button type="button" class="ch-post-b" data-chopen="${id}"><span class="ch-post-t">mine</span></button><button type="button" class="ch-post-r" data-chopen="${id}"><time>${t}</time></button></div></div>`;
const feed = t => `<div class="ch-feed" data-part="feed">${post('a', 'Bold point.', t)}${own('b', t)}${post('c', 'New on main', t)}</div>`;

test('issue 1287: repainting a channel feed keeps one words block per agent post (shared data-chopen key)', () => {
  const M = load(), root = new Node(1, '#root'); root.root = true;
  const live = parse(feed('1m')).firstElementChild; root.appendChild(live);
  const tbA = live.qsa('ch-post-tb')[0], replyLine = live.qsa('ch-post-r')[0];
  for (const t of ['2m', '3m', '4m']) assert.equal(M.morph(live, feed(t)), true);
  const tbs = live.qsa('ch-post-tb');
  assert.equal(tbs.length, 2, 'one words block for each of the two agent posts, never a second copy');
  assert.equal(live.qsa('ch-post-b').length, 3);
  assert.equal(live.qsa('ch-post-r').length, 1, 'the owner post keeps one reply line');
  assert.equal(tbs[0], tbA, 'the words block is kept and patched in place, not replaced');
  assert.equal(live.qsa('ch-post-r')[0], replyLine, 'a second same-key button is matched too, not rebuilt');
  assert.equal(live.qsa('ch-post-h')[0].childNodes[1].childNodes[0].nodeValue, '4m', 'the time still updates');
  // Order inside a post is unchanged: header button, words, reply.
  assert.deepEqual(live.qsa('ch-post-c')[0].childNodes.map(n => n.getAttribute('class')), ['ch-post-b', 'ch-post-tb', 'ch-post-rr']);
});

test('issue 1287: a post that loses its words block on repaint drops it; one that gains it gets one', () => {
  const M = load(), root = new Node(1, '#root'); root.root = true;
  const live = parse(feed('1m')).firstElementChild; root.appendChild(live);
  const bare = `<div class="ch-feed" data-part="feed">${post('a', 'Bold point.', '2m').replace(/<div class="ch-post-tb"[^]*?<\/div>/, '')}</div>`;
  M.morph(live, bare);
  assert.equal(live.qsa('ch-post-tb').length, 0);
  assert.equal(live.qsa('ch-post').length, 1, 'gone posts are removed');
  M.morph(live, feed('3m'));
  assert.equal(live.qsa('ch-post-tb').length, 2);
  M.morph(live, feed('4m'));
  assert.equal(live.qsa('ch-post-tb').length, 2);
});
