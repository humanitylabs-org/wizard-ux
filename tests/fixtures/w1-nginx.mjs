// Serve a request through the shell's real nginx config (wizard-ux issue 1674: tests run the config, they do not
// read it as text). render() runs the real packaging/entrypoint.sh in a sandbox (paths moved into a temp dir, nginx
// and the process supervisor stubbed), so the generated /tmp/*.conf files are exactly what the image writes.
// shell(rendered).request({ method, uri, args, cookies, headers, host, upstream }) then walks that config the way
// nginx does for the directives the shell uses: http-level `map`s, server `set` / `if` / `return`, location choice
// (= exact, ^~ prefix, regex in order, longest prefix, nested locations), `rewrite ... break`, `limit_except`,
// `alias` / `root` / `try_files` / `index` against web/, `proxy_pass`, `proxy_hide_header`, and `add_header`
// inheritance (a level with its own add_header drops the outer ones). Not a full nginx: an unknown directive in a
// path the request takes throws, so a config change the simulator cannot follow fails loudly instead of passing.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packaging');

export function render(env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'w1-nginx-'));
  const etc = path.join(dir, 'etc'), run = path.join(dir, 'run'), bin = path.join(dir, 'bin');
  for (const d of [etc, run, bin]) mkdirSync(d);
  for (const f of ['nginx.conf.template', 'static.conf', 'proxy.conf', 'proxy-mcp.conf']) copyFileSync(path.join(PKG, f), path.join(etc, f));
  writeFileSync(path.join(bin, 'nginx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'python3'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const script = readFileSync(path.join(PKG, 'entrypoint.sh'), 'utf8').split('/tmp/').join(`${run}/`).split('/etc/wizard-shell/').join(`${etc}/`); // /tmp first: the temp dir itself may sit under /tmp
  const out = spawnSync('sh', ['-c', script], { env: { PATH: `${bin}:${process.env.PATH}`, ...env }, encoding: 'utf8' });
  const files = p => path.join(run, p.replace(/^\/tmp\//, ''));
  return { dir, run, status: out.status, stderr: out.stderr, conf: path.join(run, 'nginx.conf'), files, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function tokens(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '{' || c === '}' || c === ';') { out.push({ p: c }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && (src[j + 1] === c || src[j + 1] === '\\')) { s += src[j + 1]; j += 2; continue; } s += src[j++]; }
      out.push({ w: s, q: true }); i = j + 1; continue;
    }
    let j = i; while (j < src.length && !/[\s{};]/.test(src[j])) j++;
    // a word may hold ${name} (envsubst leftovers, nginx ${var}); keep the braces in the word
    while (src[j] === '{' && src[j - 1] === '$') { j = src.indexOf('}', j) + 1; while (j < src.length && !/[\s{};]/.test(src[j])) j++; }
    out.push({ w: src.slice(i, j) }); i = j;
  }
  return out;
}

export function parse(src, includeOf = () => null) {
  const t = tokens(src); let k = 0;
  function list(top) {
    const items = [];
    while (k < t.length) {
      if (t[k].p === '}') { if (top) throw new Error('nginx: stray }'); k++; return items; }
      const args = [];
      while (k < t.length && !t[k].p) args.push(t[k++].w);
      const end = t[k++];
      const d = { name: args[0], args: args.slice(1) };
      if (end?.p === '{') d.children = list(false);
      if (d.name === 'include' && !d.children) { const inc = includeOf(d.args[0]); if (inc != null) { items.push(...parse(inc, includeOf)); continue; } }
      items.push(d);
    }
    return items;
  }
  return list(true);
}

export function shell(rendered, { web = path.join(ROOT, 'web') } = {}) {
  const includeOf = p => { const f = rendered.files(p); return p.startsWith('/tmp/') && existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const tree = parse(readFileSync(rendered.conf, 'utf8'), includeOf);
  const http = tree.find(d => d.name === 'http').children;
  const server = http.find(d => d.name === 'server').children;
  const maps = new Map();
  for (const d of http.filter(d => d.name === 'map')) maps.set(d.args[1].slice(1), { src: d.args[0], entries: d.children });

  function request({ method = 'GET', uri = '/', args = '', cookies = {}, headers = {}, host = 'box.example', remote = '127.0.0.1', upstream = { status: 200, headers: [] } } = {}) {
    const vars = {};
    const builtin = name => {
      if (name in vars) return vars[name];
      if (name === 'uri') return uri; if (name === 'args' || name === 'query_string') return args; if (name === 'is_args') return args ? '?' : '';
      if (name === 'request_uri') return uri + (args ? `?${args}` : ''); if (name === 'request_method') return method;
      if (name === 'host') return host; if (name === 'remote_addr') return remote; if (name === 'scheme') return 'http';
      if (name === 'status') return String(vars.status ?? 200);
      if (name.startsWith('cookie_')) return cookies[name.slice(7)] ?? '';
      if (name.startsWith('arg_')) return new URLSearchParams(args).get(name.slice(4)) ?? '';
      if (name.startsWith('http_')) { const h = Object.entries(headers).find(([k]) => k.toLowerCase().replace(/-/g, '_') === name.slice(5)); return h ? h[1] : ''; }
      if (maps.has(name)) return mapValue(name);
      throw new Error(`nginx sim: unknown variable $${name}`);
    };
    const value = s => String(s).replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => builtin(a || b));
    function mapValue(name) {
      const { src, entries } = maps.get(name); const input = value(src);
      let def = '';
      for (const e of entries) { if (e.name === 'default') def = e.args[0]; else if (!e.name.startsWith('~') && e.name === input) return value(e.args[0]); }
      if (entries.some(e => e.name === '' && input === '')) return value(entries.find(e => e.name === '').args[0]);
      for (const e of entries) if (e.name.startsWith('~')) { const ci = e.name.startsWith('~*'); if (new RegExp(e.name.slice(ci ? 2 : 1), ci ? 'i' : '').test(input)) return value(e.args[0]); }
      return value(def);
    }
    const truth = cond => { // the args of `if ( ... )`
      const c = cond.join(' ').replace(/^\(\s*|\s*\)$/g, '');
      let m;
      if ((m = /^(\$\w+)\s*(=|!=)\s*(.*)$/.exec(c))) { const v = value(m[1]); return m[2] === '=' ? v === m[3] : v !== m[3]; }
      if ((m = /^(\$\w+)\s*(~\*?|!~)\s*(.*)$/.exec(c))) { const r = new RegExp(m[3], m[2] === '~*' ? 'i' : ''); return m[2] === '!~' ? !r.test(value(m[1])) : r.test(value(m[1])); }
      if ((m = /^(\$\w+)$/.exec(c))) { const v = value(m[1]); return v !== '' && v !== '0'; }
      throw new Error(`nginx sim: cannot read if (${c})`);
    };
    const res = { status: 0, headers: [], hidden: [], location: null, proxy: null, file: null, body: null };
    const finish = (code, text) => { res.status = Number(code); if (code >= 300 && code < 400) res.redirect = value(text); else if (text != null) res.body = value(text); return true; };
    // rewrite phase of one level: set / if / return / rewrite; returns true once a return ran
    function rewrite(items) {
      for (const d of items) {
        if (d.name === 'set') vars[d.args[0].slice(1)] = value(d.args[1]);
        else if (d.name === 'if') { if (truth(d.args) && rewrite(d.children)) return true; }
        else if (d.name === 'return') return finish(d.args[0], d.args[1]);
        else if (d.name === 'rewrite') { const m = new RegExp(d.args[0]).exec(uri); if (m) { uri = d.args[1].replace(/\$(\d)/g, (_, n) => m[n] || ''); } }
      }
      return false;
    }
    function pick(items) { // the chain of locations nginx ends in, outermost first
      const locs = items.filter(d => d.name === 'location');
      const exact = locs.find(l => l.args[0] === '=' && l.args[1] === uri); if (exact) return [exact];
      let best = null;
      for (const l of locs) {
        const [mod, pre] = l.args.length > 1 ? l.args : ['', l.args[0]];
        if ((mod === '' || mod === '^~') && uri.startsWith(pre) && (!best || pre.length > best.pre.length)) best = { l, pre, stop: mod === '^~' };
      }
      const inner = best && best.l.children.some(d => d.name === 'location') ? pick(best.l.children) : [];
      if (best?.stop) return [best.l, ...inner];
      if (inner.length && /^~/.test(inner[0].args[0])) return [best.l, ...inner];
      for (const l of locs.filter(l => /^~/.test(l.args[0]))) if (new RegExp(l.args[1], l.args[0] === '~*' ? 'i' : '').test(uri)) return [l];
      return best ? [best.l, ...inner] : [];
    }
    const HANDLED = new Set(['location', 'set', 'if', 'return', 'rewrite', 'add_header', 'proxy_pass', 'proxy_hide_header', 'alias', 'root', 'try_files', 'index', 'limit_except',
      'default_type', 'proxy_http_version', 'proxy_set_header', 'proxy_buffering', 'proxy_request_buffering', 'proxy_cache', 'proxy_read_timeout', 'proxy_send_timeout', 'sub_filter', 'sub_filter_once']);
    const headerSets = [http.filter(d => d.name === 'add_header'), server.filter(d => d.name === 'add_header')];
    if (!rewrite(server)) {
      const chain = pick(server);
      res.location = chain.map(l => l.args.join(' '));
      const all = chain.flatMap(l => l.children.filter(d => d.name !== 'location'));
      for (const d of all) if (!HANDLED.has(d.name)) throw new Error(`nginx sim: unsupported directive ${d.name}`);
      for (const l of chain) headerSets.push(l.children.filter(d => d.name === 'add_header'));
      const limit = all.find(d => d.name === 'limit_except');
      let done = false;
      if (limit && !limit.args.includes(method) && !(method === 'HEAD' && limit.args.includes('GET'))) done = finish(403);
      for (const l of chain) if (!done) done = rewrite(l.children);
      if (!done) {
        const last = (n) => [...all].reverse().find(d => d.name === n);
        const proxy = last('proxy_pass'), alias = last('alias'), root = last('root');
        res.hidden = all.filter(d => d.name === 'proxy_hide_header').map(d => d.args[0].toLowerCase());
        if (proxy) {
          res.proxy = value(proxy.args[0]); if (!/\$request_uri/.test(proxy.args[0])) res.proxy += uri + (args ? `?${args}` : '');
          vars.status = upstream.status; res.status = upstream.status;
          res.headers.push(...upstream.headers.filter(([k]) => !res.hidden.includes(k.toLowerCase())));
        } else if (alias || root) {
          const base = (alias || root).args[0].replace('/usr/share/nginx/wizard-ux/', `${web}/`).replace('/usr/share/nginx/wizard-ux', web);
          const pre = chain.find(l => l.children.includes(alias))?.args.slice(-1)[0] || '';
          const tf = last('try_files');
          let rel = alias ? uri.slice(pre.length) : uri;
          if (tf) rel = tf.args[0].replace('$uri', uri);
          let f = alias ? path.join(base, rel) : path.join(base, rel);
          if ((existsSync(f) && statSync(f).isDirectory()) || rel === '' || rel.endsWith('/')) { const idx = last('index'); f = path.join(f, idx ? idx.args[0] : 'index.html'); }
          res.file = f; res.status = existsSync(f) && statSync(f).isFile() ? 200 : 404; vars.status = res.status;
        } else res.status = 404;
      }
    }
    const own = [...headerSets].reverse().find(s => s.length) || [];
    for (const h of own) if (h.args.includes('always') || [200, 201, 204, 206, 301, 302, 303, 304, 307, 308].includes(res.status)) res.headers.push([h.args[0], value(h.args[1])]);
    res.header = name => res.headers.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v);
    return res;
  }
  return { request, tree };
}

// One call: render the image's config with `env`, return { request, done }.
export function nginxShell(env = {}) {
  const r = render(env);
  if (r.status !== 0) { r.done(); throw new Error(`entrypoint.sh failed: ${r.stderr}`); }
  const s = shell(r);
  return { ...s, rendered: r, done: r.done };
}
