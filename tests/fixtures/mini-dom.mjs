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
    this.parentNode = null; this.ownerDocument = doc; this.listeners = {}; this.style = {}; this._value = null;
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get nextElementSibling() { const s = this.parentNode?.children || []; return s[s.indexOf(this) + 1] || null; }
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

// --- selectors ---
function splitTop(s, sep) { const out = []; let d = 0, q = '', cur = ''; for (const c of s) { if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; if (!q && !d && sep.test(c)) { out.push(cur); cur = ''; continue; } cur += c; } out.push(cur); return out; }
function simple(el, s) {
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([^\]=~^$*|]+)(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:not\(((?:[^()]|\([^()]*\))*)\)|:([\w-]+)(?:\(([^)]*)\))?/y;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i; const m = re.exec(s); if (!m) throw new Error(`mini-dom: unsupported selector ${s}`); i = re.lastIndex;
    if (m[1] && m[1] !== '*' && el.localName !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) { const k = m[4].trim(), v = el.getAttribute(k); if (v == null) return false; const want = m[6] ?? m[7] ?? m[8];
      if (m[5] === '=' && v !== want) return false; if (m[5] === '~=' && !v.split(/\s+/).includes(want)) return false;
      if (m[5] === '^=' && !v.startsWith(want)) return false; if (m[5] === '$=' && !v.endsWith(want)) return false; if (m[5] === '*=' && !v.includes(want)) return false; }
    if (m[9] != null && matches(el, m[9])) return false;
    if (m[10]) { const p = m[10]; if (p === 'disabled' && !el.disabled) return false; if (p === 'checked' && !el.hasAttribute('checked')) return false;
      if (p === 'first-child' && el.parentNode?.children[0] !== el) return false; if (p === 'last-child' && el.parentNode?.children.at(-1) !== el) return false; }
  }
  return true;
}
function compound(el, parts, scope) {
  const last = parts.at(-1); if (!simple(el, last.sel)) return false;
  if (parts.length === 1) return true;
  const rest = parts.slice(0, -1);
  if (last.comb === '>') { const p = el.parentNode; return !!p && p.nodeType === 1 && p !== scope?.parentNode && compound(p, rest, scope); }
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) { if (compound(p, rest, scope)) return true; if (p === scope) break; }
  return false;
}
export function matches(el, sel, scope) {
  return splitTop(sel, /,/).some(one => {
    const tokens = splitTop(one.trim().replace(/\s*>\s*/g, ' > '), /\s/).filter(Boolean), parts = []; let comb = ' ';
    for (const t of tokens) { if (t === '>') { comb = '>'; continue; } parts.push({ sel: t, comb }); comb = ' '; }
    return parts.length && compound(el, parts, scope);
  });
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
