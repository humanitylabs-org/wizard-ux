'use strict';
// Static census of every network path literal the shell can issue under web/.
// tests/fixtures/proof-request-inventory.json must classify each one; the
// request-inventory test fails when a path appears here and is not classified.
const fs = require('node:fs'), path = require('node:path');
// Discovery does NOT depend on a list of known API prefixes: any quoted/template literal that starts with
// /<segment>/ is a candidate request target, except existing static files served locally from /wizard-os-home/.
const API = /(['"`])(\/[a-z][a-z0-9_-]*\/(?:\$\{[^}]*\}|[^'"`\s?#$])*)/g;
// No extension/prefix exclusions: generated static assets need a catalogue too.
const APP = /\bapi\.data\.read\.app\(\s*(['"])([a-z0-9-]+)\1\s*,\s*(['"])([a-z0-9_./-]+)\3\s*\)/g;
const FETCH = /\bfetch\(\s*(['"])([a-z0-9_][a-z0-9_./-]*)\1/g;
const SHELL_URL = /\burl\(\s*(['"])([a-z0-9_][a-z0-9_./-]*)\1/g;
const STORE = /(['"`])(?:\.\.\/)?(store-(?:data|install)\/(?:\$\{[^}]*\}|[^'"`\s?#$])*)/g;
function normalise(p) {
 return p.replace(/\$\{[^}]*\}/g, '{}').replace(/([^/])\{\}$/, '$1').replace(/\/+$/, '');
}
function scan(root) {
 const found = new Map();
 let tracked = new Set();
 try { tracked = new Set(require('node:child_process').execFileSync('git', ['-C', root, 'ls-files', '-z', '--', 'web'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0')); } catch (_) { /* isolated scanner fixtures have no Git tree */ }
 function add(target, rel) {
  const p = normalise(target);
  if (p === '/wizard-os-home') return;
  if (p.startsWith('/wizard-os-home/')) {
   const file = path.resolve(root, 'web', p.slice('/wizard-os-home/'.length));
   // Existing shell assets are covered by staticResponse; absent/generated files are not.
   if (file.startsWith(path.resolve(root, 'web') + path.sep) && tracked.has('web/' + p.slice('/wizard-os-home/'.length))) return;
  }
  if (!found.has(p)) found.set(p, rel);
 }
 (function visit(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
   const file = path.join(dir, name);
   if (fs.statSync(file).isDirectory()) { visit(file); continue; }
   if (!/\.(?:js|mjs)$/.test(name) || name === 'offline-session-config.js') continue;
   const rel = path.relative(root, file).split(path.sep).join('/'), text = fs.readFileSync(file, 'utf8');
   for (const m of text.matchAll(API)) add(m[2], rel);
   for (const m of text.matchAll(STORE)) add('/wizard-os-home/' + m[2], rel);
   // skin-host constructs /<app>/api/<path> from these two literal arguments.
   for (const m of text.matchAll(APP)) add('/' + m[2] + '/api/' + m[4], rel);
   for (const m of text.matchAll(FETCH)) add('/wizard-os-home/' + m[2], rel);
   // web-update's url helper is shell-rooted; other modules may own a different base.
   if (rel === 'web/core/web-update.js') for (const m of text.matchAll(SHELL_URL)) add('/wizard-os-home/' + m[2], rel);
  }
 })(path.join(root, 'web'));
 found.set('/{app}/ready.json', 'web/core/chats-view.js'); // declared as prefix + 'ready.json'
 return found;
}
module.exports = { scan, normalise };
