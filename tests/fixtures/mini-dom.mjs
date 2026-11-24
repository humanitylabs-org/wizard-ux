// A very small HTML DOM for node:test, so a test can run a module that renders markup and then read and press what
// it drew (wizard-ux issue 1674: tests run the code). No dependencies: it parses the markup the shell writes
// (elements, attributes, text), answers simple selectors (tag, #id, .class, [attr], [attr="v"], :not(...),
// descendant and child combinators, comma lists), and bubbles events. It is not a browser: no layout, no CSS.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = s => s.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: '\u00a0' }[k]));
const encode = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class Text {
  constructor(data, doc) { this.nodeType = 3; this.data = data; this.parentNode = null; this.ownerDocument = doc; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  remove() { this.parentNode?.removeChild(this); }
}

class Element {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.localName = tag.toLowerCase(); this.attrs = new Map(); this.childNodes = [];
    this.parentNode = null; this.ownerDocument = doc; this.listeners = {}; this.style = styleObject(this); this._value = null;
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get nextElementSibling() { const s = this.parentNode?.children || []; return s[s.indexOf(this) + 1] || null; }
  get nextSibling() { const s = this.parentNode?.childNodes || []; const i = s.indexOf(this); return i < 0 ? null : s[i + 1] || null; }
  get previousSibling() { const s = this.parentNode?.childNodes || []; const i = s.indexOf(this); return i < 1 ? null : s[i - 1]; }
  get content() { return this.localName === 'meta' ? this.getAttribute('content') : undefined; }
  get previousElementSibling() { const s = this.parentNode?.children || []; return s[s.indexOf(this) - 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument?.documentElement || n === this.ownerDocument; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  toggleAttribute(k, on) { on = on ?? !this.attrs.has(k); if (on) this.attrs.set(k, ''); else this.attrs.delete(k); return on; }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const el = this, list = () => el.className.split(/\s+/).filter(Boolean), set = l => el.setAttribute('class', l.join(' '));
    return { contains: c => list().includes(c), add: (...c) => set([...new Set([...list(), ...c])]), remove: (...c) => set(list().filter(x => !c.includes(x))),
      toggle: (c, on) => { const has = list().includes(c); on = on ?? !has; if (on && !has) set([...list(), c]); if (!on && has) set(list().filter(x => x !== c)); return on; } };
  }
  get dataset() {
    const el = this, key = k => 'data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    return new Proxy({}, { get: (_, k) => typeof k === 'string' ? el.getAttribute(key(k)) ?? undefined : undefined,
      set: (_, k, v) => { el.setAttribute(key(k), v); return true; }, deleteProperty: (_, k) => { el.removeAttribute(key(k)); return true; },
      has: (_, k) => el.hasAttribute(key(k)) });
  }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { this.toggleAttribute('disabled', !!v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get value() { return this._value ?? (this.localName === 'textarea' ? this.textContent : this.getAttribute('value') ?? ''); }
  set value(v) { this._value = String(v); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '') this.appendChild(new Text(String(v), this.ownerDocument)); }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) { for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; for (const n of parse(String(html), this.ownerDocument)) this.appendChild(n); }
  get outerHTML() { return serialize(this); }
  appendChild(n) { if (n.isFragment) { for (const c of [...n.childNodes]) this.appendChild(c); return n; } n.parentNode?.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Text(n, this.ownerDocument) : n); }
  prepend(...ns) { for (const n of ns.reverse()) this.insertBefore(typeof n === 'string' ? new Text(n, this.ownerDocument) : n, this.childNodes[0] || null); }
  insertBefore(n, ref) { n.parentNode?.removeChild(n); const i = ref ? this.childNodes.indexOf(ref) : -1; n.parentNode = this; if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { this.parentNode?.removeChild(this); }
  replaceWith(n) { const p = this.parentNode; if (p) { p.insertBefore(n, this); p.removeChild(this); } }
  insertAdjacentHTML(where, html) {
    const nodes = parse(String(html), this.ownerDocument);
    if (where === 'beforeend') for (const n of nodes) this.appendChild(n);
    else if (where === 'afterbegin') for (const n of nodes.reverse()) this.insertBefore(n, this.childNodes[0] || null);
    else if (where === 'beforebegin') for (const n of nodes) this.parentNode.insertBefore(n, this);
    else if (where === 'afterend') { const next = this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; for (const n of nodes) this.parentNode.insertBefore(n, next); }
  }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  descendants() { const out = []; const walk = e => { for (const c of e.children) { out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel) { return this.descendants().filter(e => matches(e, sel, this)); }
  querySelector(sel) { return this.descendants().find(e => matches(e, sel, this)) || null; }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (matches(e, sel)) return e; return null; }
  addEventListener(t, f, o) { (this.listeners[t] ||= []).push({ f, capture: o === true || !!o?.capture }); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(l => l.f !== f); }
  dispatchEvent(e) {
    const path = []; for (let n = this; n; n = n.parentNode) path.push(n);
    if (this.ownerDocument?.defaultView && path.at(-1) === this.ownerDocument) path.push(this.ownerDocument.defaultView);
    e.target ||= this; let stop = false; e.stopPropagation = () => { stop = true; }; e.stopImmediatePropagation = () => { stop = true; };
    e.preventDefault = () => { e.defaultPrevented = true; };
    for (const n of [...path].reverse()) { for (const l of n.listeners?.[e.type] || []) if (l.capture) l.f.call(n, e); if (stop) return !e.defaultPrevented; }
    for (const n of path) { e.currentTarget = n; for (const l of n.listeners?.[e.type] || []) if (!l.capture) l.f.call(n, e); if (stop || !e.bubbles) break; }
    return !e.defaultPrevented;
  }
  click() { return this.dispatchEvent({ type: 'click', bubbles: true, detail: 1 }); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  scrollIntoView() {}
}

function serialize(n) {
  if (n.nodeType === 3) return encode(n.data).replace(/&quot;/g, '"');
  const attrs = [...n.attrs].map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${encode(v)}"`)).join('');
  return VOID.has(n.localName) ? `<${n.localName}${attrs}>` : `<${n.localName}${attrs}>${n.childNodes.map(serialize).join('')}</${n.localName}>`;
}

export function parse(html, doc) {
  const root = new Element('#root', doc), stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack.at(-1);
    if (m[1]) { const t = m[1].toLowerCase(); const i = stack.map(e => e.localName).lastIndexOf(t); if (i > 0) stack.length = i; continue; }
    if (m[2]) {
      const el = new Element(m[2], doc);
      for (const a of m[3].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
      top.appendChild(el);
      if (!VOID.has(el.localName) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] && !/^<!--/.test(m[0])) top.appendChild(new Text(decode(m[5]), doc));
  }
  const out = [...root.childNodes]; for (const n of out) n.parentNode = null; return out;
}

// element.style: a plain object of the properties set, plus the CSSStyleDeclaration methods (not enumerable);
// getPropertyValue also reads the element's style attribute, as a browser does.
function styleObject(el) {
  const st = {};
  Object.defineProperties(st, {
    setProperty: { writable: true, configurable: true, value(k, v) { st[k] = String(v); } },
    removeProperty: { writable: true, configurable: true, value(k) { const v = st[k]; delete st[k]; return v ?? ''; } },
    getPropertyValue: { writable: true, configurable: true, value(k) {
      if (k in st) return st[k];
      const d = String(el.getAttribute?.('style') || '').split(';').map(x => x.split(/:(.*)/s)).find(([n]) => n.trim() === k); // the style attribute
      return d?.[1]?.trim() ?? '';
    } },
  });
  return st;
}

// --- selectors ---
function splitTop(s, sep) { const out = []; let d = 0, q = '', cur = ''; for (const c of s) { if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; if (!q && !d && sep.test(c)) { out.push(cur); cur = ''; continue; } cur += c; } out.push(cur); return out; }
const tagOf = el => (el.localName || String(el.tagName || '').toLowerCase());
const attrOf = (el, k) => (el.getAttribute ? el.getAttribute(k) : null);
const kidsOf = el => (el?.children ? [...el.children].filter(n => n && (n.nodeType === undefined || n.nodeType === 1)) : []);
const isEl = n => !!n && (n.nodeType === 1 || (n.nodeType === undefined && !!n.tagName));
const hasClass = (el, c) => (el.classList?.contains ? el.classList.contains(c) : String(attrOf(el, 'class') || '').split(/\s+/).includes(c));
// state: a set of pseudo-classes the caller says are on (':hover', ':focus-visible', ...); others are off.
let STATE = null;
export function withState(states, fn) { const was = STATE; STATE = new Set(states || []); try { return fn(); } finally { STATE = was; } }
// Selector text is parsed once per distinct string (pure), then matched against many elements.
const SIMPLE = new Map(), PARTS = new Map();
function simpleTokens(s) {
  let toks = SIMPLE.get(s);
  if (toks) return toks;
  toks = [];
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([^\]=~^$*|]+)(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*))\s*(i)?)?\]|:(not|is|where|has)\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)|:([\w-]+)(?:\(([^)]*)\))?/y;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i; const m = re.exec(s); if (!m) { toks.push(null); break; } i = re.lastIndex; // null: unsupported, thrown when reached
    toks.push(m);
  }
  SIMPLE.set(s, toks);
  return toks;
}
function simple(el, s) {
  for (const m of simpleTokens(s)) {
    if (!m) throw new Error(`mini-dom: unsupported selector ${s}`);
    if (m[1] && m[1] !== '*' && tagOf(el) !== m[1].toLowerCase()) return false;
    if (m[2] && attrOf(el, 'id') !== m[2]) return false;
    if (m[3] && !hasClass(el, m[3])) return false;
    if (m[4]) { const k = m[4].trim(); let v = attrOf(el, k); if (v == null) return false; let want = m[6] ?? m[7] ?? m[8];
      if (m[9] && want != null) { v = v.toLowerCase(); want = want.toLowerCase(); }
      if (m[5] === '=' && v !== want) return false; if (m[5] === '~=' && !v.split(/\s+/).includes(want)) return false;
      if (m[5] === '^=' && !v.startsWith(want)) return false; if (m[5] === '$=' && !v.endsWith(want)) return false; if (m[5] === '*=' && !v.includes(want)) return false;
      if (m[5] === '|=' && v !== want && !v.startsWith(want + '-')) return false; }
    if (m[10]) {
      const arg = m[11];
      if (m[10] === 'not' && matches(el, arg)) return false;
      if ((m[10] === 'is' || m[10] === 'where') && !matches(el, arg)) return false;
      if (m[10] === 'has') { const rel = arg.trim().startsWith('>'); const sel = rel ? arg.trim().slice(1) : arg;
        const pool = rel ? kidsOf(el) : (function all(e) { return kidsOf(e).flatMap(c => [c, ...all(c)]); })(el);
        if (!pool.some(n => matches(n, sel))) return false; }
    }
    if (m[12]) { const p = m[12], sib = kidsOf(el.parentNode);
      if (p === 'disabled') { if (!(el.disabled || el.hasAttribute?.('disabled'))) return false; }
      else if (p === 'checked') { if (!(el.checked || el.hasAttribute?.('checked'))) return false; }
      else if (p === 'first-child') { if (sib[0] !== el) return false; }
      else if (p === 'last-child') { if (sib.at(-1) !== el) return false; }
      else if (p === 'only-child') { if (sib.length !== 1) return false; }
      else if (p === 'empty') { if (kidsOf(el).length || String(el.textContent || '').length) return false; }
      else if (p === 'root') { if (tagOf(el) !== 'html') return false; }
      else if (p === 'nth-child') { const n = sib.indexOf(el) + 1, a = (m[13] || '').trim();
        if (a === 'odd' ? n % 2 !== 1 : a === 'even' ? n % 2 !== 0 : /^\d+$/.test(a) ? n !== +a : true) return false; }
      else if (!(STATE && STATE.has(':' + p))) return false; // :hover, :focus, :focus-visible, :active ... off unless asked
    }
  }
  return true;
}
function compound(el, parts, scope) {
  const last = parts.at(-1); if (!simple(el, last.sel)) return false;
  if (parts.length === 1) return true;
  const rest = parts.slice(0, -1), up = n => (isEl(n?.parentNode) ? n.parentNode : null);
  if (last.comb === '>') { const p = up(el); return !!p && compound(p, rest, scope); }
  if (last.comb === '+' || last.comb === '~') {
    const sib = kidsOf(el.parentNode), at = sib.indexOf(el);
    const pool = last.comb === '+' ? sib.slice(Math.max(0, at - 1), at) : sib.slice(0, at);
    return pool.some(n => compound(n, rest, scope));
  }
  for (let p = up(el); p; p = up(p)) { if (compound(p, rest, scope)) return true; if (p === scope) break; }
  return false;
}
export function splitSelectors(sel) { return splitTop(sel, /,/).map(x => x.trim()).filter(Boolean); }
function selectorParts(sel) {
  let all = PARTS.get(sel);
  if (all) return all;
  all = splitSelectors(sel).map(one => {
    const tokens = splitTop(one.replace(/\s*([>+~])\s*(?![^(]*\))(?![^[]*\])/g, ' $1 '), /\s/).filter(Boolean), parts = []; let comb = ' ';
    for (const t of tokens) { if (t === '>' || t === '+' || t === '~') { comb = t; continue; } parts.push({ sel: t, comb }); comb = ' '; }
    return parts;
  });
  PARTS.set(sel, all);
  return all;
}
export function matches(el, sel, scope) {
  return selectorParts(String(sel)).some(parts => parts.length && compound(el, parts, scope));
}

export function createDocument({ url = 'https://box.test/wizard-os-home/' } = {}) {
  const doc = { nodeType: 9, listeners: {}, baseURI: url, activeElement: null, hidden: false };
  doc.createElement = tag => new Element(tag, doc);
  doc.createTextNode = data => new Text(String(data), doc);
  doc.createDocumentFragment = () => { const f = new Element('#fragment', doc); f.isFragment = true; return f; };
  doc.documentElement = new Element('html', doc); doc.documentElement.parentNode = doc;
  doc.head = new Element('head', doc); doc.body = new Element('body', doc);
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.querySelector = s => doc.documentElement.querySelector(s); doc.querySelectorAll = s => doc.documentElement.querySelectorAll(s);
  doc.getElementById = id => doc.documentElement.querySelector(`#${id}`);
  doc.addEventListener = (t, f, o) => (doc.listeners[t] ||= []).push({ f, capture: o === true || !!o?.capture });
  doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter(l => l.f !== f); };
  return doc;
}
