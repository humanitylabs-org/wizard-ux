// A small GLSL ES 1.0 fragment-shader runner for node (wizard-ux issue 1674: tests run the code, not read it).
// There is no GPU on the test machines, so the orb's real fragment shader (web/orb.js FRAG) is translated to JS and
// drawn one pixel at a time on the CPU: float/int/bool, vec2/3/4 with component-wise maths and swizzles, user
// functions, if/for/return, and the built-ins the shader uses. `probe` reports a local's value at its declaration.
//   const s = shader(FRAG); s.pixel([x, y], { res: [64, 64], core: 1, ... }, { probe: ['stars'] }) -> { color, probes }
const TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'void']);
const map = (f, ...a) => {
  const n = Math.max(...a.map(x => Array.isArray(x) ? x.length : 0));
  return n ? Array.from({ length: n }, (_, i) => f(...a.map(x => Array.isArray(x) ? x[i] : x))) : f(...a);
};
const vec = (n, args) => { const flat = args.flat(); return flat.length === 1 ? Array(n).fill(flat[0]) : flat.slice(0, n); };
const len = v => Array.isArray(v) ? Math.hypot(...v) : Math.abs(v);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export const RT = {
  add: (a, b) => map((x, y) => x + y, a, b), sub: (a, b) => map((x, y) => x - y, a, b),
  mul: (a, b) => map((x, y) => x * y, a, b), div: (a, b) => map((x, y) => x / y, a, b), neg: a => map(x => -x, a),
  sw: (v, k) => { const i = [...k].map(c => 'xyzwrgba'.indexOf(c) % 4); return i.length === 1 ? v[i[0]] : i.map(j => v[j]); },
  vec2: (...a) => vec(2, a), vec3: (...a) => vec(3, a), vec4: (...a) => vec(4, a), float: x => +x, int: x => Math.trunc(x),
  sin: a => map(Math.sin, a), cos: a => map(Math.cos, a), exp: a => map(Math.exp, a), log: a => map(Math.log, a),
  abs: a => map(Math.abs, a), floor: a => map(Math.floor, a), sqrt: a => map(Math.sqrt, a),
  fract: a => map(x => x - Math.floor(x), a), pow: (a, b) => map(Math.pow, a, b),
  max: (a, b) => map(Math.max, a, b), min: (a, b) => map(Math.min, a, b),
  clamp: (x, a, b) => map((v, lo, hi) => Math.min(Math.max(v, lo), hi), x, a, b),
  mix: (a, b, t) => map((x, y, s) => x * (1 - s) + y * s, a, b, t),
  step: (e, x) => map((a, b) => b < a ? 0 : 1, e, x), smoothstep: (a, b, x) => map(smooth, a, b, x),
  length: len, dot: (a, b) => a.reduce((s, x, i) => s + x * b[i], 0), normalize: v => { const l = len(v); return v.map(x => x / l); },
  atan: (y, x) => x === undefined ? map(Math.atan, y) : map(Math.atan2, y, x),
};

function tokens(src) {
  const out = [], re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(\d+\.\d*|\.\d+|\d+)|([A-Za-z_]\w*)|(\+\+|--|[+\-*/]=|==|!=|<=|>=|&&|\|\||[-+*/<>=!(){}[\];,.?:])/y;
  for (let m; re.lastIndex < src.length;) {
    const at = re.lastIndex; m = re.exec(src); if (!m) throw new Error('glsl: cannot read ' + src.slice(at, at + 20));
    if (m[1]) out.push({ t: 'num', v: m[1] }); else if (m[2]) out.push({ t: 'id', v: m[2] }); else if (m[3]) out.push({ t: 'op', v: m[3] });
  }
  return out;
}

export function translate(src, { probe = [] } = {}) {
  const tk = tokens(src); let i = 0;
  const peek = (o = 0) => tk[i + o] || { t: 'eof', v: '' };
  const next = () => tk[i++];
  const eat = v => { const t = next(); if (!t || t.v !== v) throw new Error(`glsl: expected ${v} at ${t?.v}`); return t; };
  const BIN = { '||': [1, '||'], '&&': [2, '&&'], '==': [3, '==='], '!=': [3, '!=='], '<': [4], '>': [4], '<=': [4], '>=': [4], '+': [5, 'add'], '-': [5, 'sub'], '*': [6, 'mul'], '/': [6, 'div'] };
  const expr = (min = 0) => {
    let left = unary();
    for (;;) {
      const t = peek(); const b = t.t === 'op' && BIN[t.v]; if (!b || b[0] <= min) break; next();
      const right = expr(b[0]);
      left = b[1] && /^[a-z]/.test(b[1]) ? `$.${b[1]}(${left}, ${right})` : `(${left} ${b[1] || t.v} ${right})`;
    }
    return left;
  };
  const unary = () => {
    const t = peek();
    if (t.v === '-') { next(); return `$.neg(${unary()})`; }
    if (t.v === '+') { next(); return unary(); }
    if (t.v === '!') { next(); return `!(${unary()})`; }
    return postfix(primary());
  };
  const primary = () => {
    const t = next();
    if (t.t === 'num') return String(parseFloat(t.v));
    if (t.v === '(') { const e = expr(); eat(')'); return `(${e})`; }
    if (t.t === 'id') {
      if (peek().v === '(') { next(); const args = []; while (peek().v !== ')') { args.push(expr()); if (peek().v === ',') next(); } eat(')');
        return (t.v in RT ? `$.${t.v}` : t.v) + `(${args.join(', ')})`; }
      if (t.v === 'true' || t.v === 'false') return t.v;
      return t.v.startsWith('gl_') ? `$io.${t.v}` : t.v;
    }
    throw new Error('glsl: unexpected ' + t.v);
  };
  const postfix = e => { while (peek().v === '.') { next(); e = `$.sw(${e}, '${next().v}')`; } return e; };
  const ASSIGN = { '=': null, '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div' };
  const simple = () => { // assignment, ++/-- or a bare expression
    const t = peek();
    if (t.t === 'id' && peek(1).t === 'op' && peek(1).v in ASSIGN) {
      next(); const op = next().v, e = expr(); const target = t.v.startsWith('gl_') ? `$io.${t.v}` : t.v;
      return ASSIGN[op] ? `${target} = $.${ASSIGN[op]}(${target}, ${e})` : `${target} = ${e}`;
    }
    if (t.t === 'id' && (peek(1).v === '++' || peek(1).v === '--')) { next(); return t.v + next().v; }
    return expr();
  };
  const decl = () => { // after the type: a = e, b, c = e
    const parts = [], probes = [];
    for (;;) { const name = next().v; let init = '';
      if (peek().v === '=') { next(); init = ' = ' + expr(); }
      parts.push(name + init); if (probe.includes(name)) probes.push(`$probe(${JSON.stringify(name)}, ${name});`);
      if (peek().v !== ',') break; next(); }
    return `let ${parts.join(', ')};${probes.join('')}`;
  };
  const stmt = () => {
    const t = peek();
    if (t.v === '{') { next(); const body = []; while (peek().v !== '}') body.push(stmt()); next(); return `{ ${body.join('\n')} }`; }
    if (t.v === 'if') { next(); eat('('); const c = expr(); eat(')'); const a = stmt(); if (peek().v === 'else') { next(); return `if (${c}) ${a} else ${stmt()}`; } return `if (${c}) ${a}`; }
    if (t.v === 'for') { next(); eat('('); next(); const init = decl(); eat(';'); const c = expr(); eat(';'); const s = simple(); eat(')'); return `for (${init.replace(/;$/, '')}; ${c}; ${s}) ${stmt()}`; }
    if (t.v === 'return') { next(); const e = peek().v === ';' ? '' : expr(); eat(';'); return `return ${e};`; }
    if (TYPES.has(t.v) && peek(1).t === 'id') { next(); const d = decl(); eat(';'); return d; }
    const s = simple(); eat(';'); return s + ';';
  };
  const out = [];
  while (i < tk.length) {
    const t = peek();
    if (t.v === 'precision' || t.v === 'uniform' || t.v === 'attribute' || t.v === 'varying') { while (next().v !== ';'); continue; }
    if (TYPES.has(t.v) && peek(1).t === 'id' && peek(2).v === '(') {
      next(); const name = next().v; eat('('); const params = [];
      while (peek().v !== ')') { const p = next(); if (TYPES.has(p.v) || p.v === 'in') continue; if (p.v === ',') continue; params.push(p.v); }
      eat(')'); out.push(`function ${name}(${params.join(', ')}) ${stmt()}`); continue;
    }
    throw new Error('glsl: unexpected top-level ' + t.v);
  }
  return out.join('\n');
}

export function shader(src, opts = {}) {
  const uniforms = [...src.matchAll(/uniform\s+\w+\s+([^;]+);/g)].flatMap(m => m[1].split(',').map(s => s.trim()));
  const js = translate(src, opts);
  const make = new Function('$', '$io', '$probe', '$u', `const {${uniforms.join(', ')}} = $u;\n${js}\nmain();`);
  return {
    js,
    pixel(coord, u, { probe } = {}) {
      const io = { gl_FragCoord: [coord[0] + .5, coord[1] + .5, 0, 1], gl_FragColor: null }, probes = {};
      make(RT, io, (k, v) => { probes[k] = v; }, u);
      return { color: io.gl_FragColor, probes };
    },
  };
}
