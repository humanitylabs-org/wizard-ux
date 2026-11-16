#!/usr/bin/env node
// Static per-shell load inventory: which code files (JS/CSS) each shell requests at boot, with raw and
// gzip bytes. Reads only files: the entry HTML, the layout registry in core/skin-host.js and the layout
// modules' static imports / api.asset() names. No network, no owner data.
//   node tools/shell-load-inventory.mjs [webDir=web] [--json]
// Shells: phone (index.html, stock phone), desktop-classic (desktop.html, Classic), desktop-ai-apps
// (desktop.html wearing AI apps). The Orb and Apps views went in wizard-ux issue 1338.
// Not counted: owner-generated data.js / summaries.js, icons/manifest, skins, app frames, API reads.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2), asJson = args.includes('--json');
const web = path.resolve(args.find(a => !a.startsWith('--')) || 'web');
const read = rel => fs.readFileSync(path.join(web, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(web, rel)) && fs.statSync(path.join(web, rel)).isFile();
const RUNTIME = new Set(['data.js', 'summaries.js']);

function entryAssets(html) {
  const out = [];
  for (const m of read(html).matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase(), attrs = m[2];
    if (tag === 'script') {
      const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1]; if (!src) continue;
      out.push({ file: src.replace(/^\/wizard-os-home\//, ''), kind: /type="module"/.test(attrs) ? 'module' : 'script' });
    } else if (/rel="(?:stylesheet|modulepreload)"/.test(attrs)) {
      const href = /\bhref="([^"]+)"/.exec(attrs)?.[1]; if (href) out.push({ file: href.replace(/^\/wizard-os-home\//, ''), kind: 'css' });
    }
  }
  return out.filter(a => !RUNTIME.has(a.file));
}
// Static ES imports (import x from '…', import '…', export … from '…') and literal api.asset('name').
// Assets a module mounts itself count only on the shell that runs it: phone.js on the phone, desktop.js on the desktop.
function moduleDeps(rel, shell) {
  const src = read(rel), dir = path.posix.dirname(rel), deps = [], base = path.posix.basename(rel);
  const runs = !(base === 'phone.js' && shell !== 'phone') && !(base === 'desktop.js' && shell !== 'desktop');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // chrome.js loads its own sheet beside itself: new URL('chrome.css', import.meta.url)
  for (const m of code.matchAll(/new URL\('([^']+\.css)', import\.meta\.url\)/g)) deps.push({ file: path.posix.join(dir, m[1]), kind: 'css' });
  for (const m of code.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g)) deps.push({ file: path.posix.normalize(path.posix.join(dir, m[1])), kind: 'module' });
  if (runs) for (const m of code.matchAll(/api\.asset\('([^']+)'\)/g)) deps.push({ file: path.posix.join(dir, m[1]), kind: m[1].endsWith('.css') ? 'css' : 'asset' });
  return deps;
}
// A stylesheet's local @import url("…") / @import "…" is another request the shell makes.
function cssDeps(rel) {
  const dir = path.posix.dirname(rel), code = read(rel).replace(/\/\*[\s\S]*?\*\//g, ''), deps = [];
  for (const m of code.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?/gi)) {
    if (/^(?:[a-z]+:)?\/\//i.test(m[1])) continue;
    deps.push({ file: path.posix.normalize(path.posix.join(dir, m[1])), kind: 'css' });
  }
  return deps;
}
// The host's per-shell entry for a layout: files: { <shell>: { css, js } }, else layout.css / layout.js.
function layoutEntry(id, shell) {
  const host = read('core/skin-host.js');
  const line = host.split('\n').find(l => l.includes(`id: '${id}'`) && l.includes('Object.freeze({'));
  if (!line) return null;
  const shells = /shells: Object\.freeze\(\[([^\]]*)\]\)/.exec(line)?.[1];
  if (shells && !shells.includes(`'${shell}'`)) return null;
  const per = new RegExp(`${shell}: Object\\.freeze\\(\\{ css: '([^']*)', js: '([^']+)' \\}\\)`).exec(line);
  const css = per ? per[1] : 'layout.css', js = per ? per[2] : 'layout.js';
  return [...(css ? [{ file: `layouts/${id}/${css}`, kind: 'css' }] : []), { file: `layouts/${id}/${js}`, kind: 'module' }];
}
function closure(seeds, shell) {
  const seen = new Map(), queue = [...seeds];
  while (queue.length) {
    const a = queue.shift(); if (seen.has(a.file + '|' + a.kind)) continue;
    seen.set(a.file + '|' + a.kind, a);
    if (a.kind === 'module' && exists(a.file)) queue.push(...moduleDeps(a.file, shell));
    if (a.kind === 'css' && exists(a.file)) queue.push(...cssDeps(a.file));
  }
  return [...seen.values()];
}
function measure(name, html, layout, shell) {
  const base = entryAssets(html);
  const classic = new Set(base.filter(a => a.kind === 'script').map(a => a.file));
  const seeds = [...base, ...(layout ? layoutEntry(layout, shell) || [] : [])];
  const files = closure(seeds, shell).map(a => {
    const ok = exists(a.file), b = ok ? fs.readFileSync(path.join(web, a.file)) : Buffer.alloc(0);
    // a module import of a file the page already ran as a classic script is a second request (separate module map)
    return { ...a, missing: !ok, bytes: b.length, gzip: ok ? zlib.gzipSync(b, { level: 9 }).length : 0, dupOfClassic: a.kind === 'module' && classic.has(a.file) };
  });
  const sum = (list, k) => list.reduce((t, f) => t + f[k], 0);
  const lay = files.filter(f => f.file.startsWith('layouts/'));
  return { shell: name, entry: html, layout: layout || 'classic', requests: files.length, bytes: sum(files, 'bytes'), gzip: sum(files, 'gzip'),
    layoutRequests: lay.length, layoutBytes: sum(lay, 'bytes'), layoutGzip: sum(lay, 'gzip'),
    js: files.filter(f => f.kind !== 'css').length, css: files.filter(f => f.kind === 'css').length,
    dupModules: files.filter(f => f.dupOfClassic).map(f => f.file), missing: files.filter(f => f.missing).map(f => f.file),
    layoutFiles: lay.map(f => ({ file: f.file, bytes: f.bytes })), files: files.map(f => f.file) };
}
const SHELLS = [['phone', 'index.html', null, 'phone'], ['desktop-classic', 'desktop.html', null, 'desktop'], ['desktop-ai-apps', 'desktop.html', 'ai-apps', 'desktop']];
const rows = SHELLS.map(s => measure(...s));
if (asJson) process.stdout.write(JSON.stringify({ web, rows }, null, 2) + '\n');
else {
  const kb = n => (n / 1024).toFixed(1);
  console.log('shell'.padEnd(17), 'req', ' KiB raw', ' KiB gz', '| layout req', 'KiB raw', 'KiB gz', '| dup modules');
  for (const r of rows) console.log(r.shell.padEnd(17), String(r.requests).padStart(3), kb(r.bytes).padStart(8), kb(r.gzip).padStart(7), '|', String(r.layoutRequests).padStart(10), kb(r.layoutBytes).padStart(7), kb(r.layoutGzip).padStart(6), '|', r.dupModules.join(' ') || '-');
}
export { measure, layoutEntry };
