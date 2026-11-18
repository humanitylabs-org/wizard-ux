// Issue 1594: a desktop opening /wizard-os-home/ must reach desktop.html before the browser starts fetching the phone
// shell's files (a cancelled read is never kept, so they were fetched again on every open). core/shell.js remembers
// the device's page in a cookie; the shell's nginx sends a remembered desktop straight to desktop.html.
// Real-browser proof (stamped image, 5 opens): main re-fetched 1-3 phone files per reopen, this change 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shellJs = fs.readFileSync(new URL('../web/core/shell.js', import.meta.url), 'utf8');
const nginx = fs.readFileSync(new URL('../packaging/nginx.conf.template', import.meta.url), 'utf8');

function runShell({ page = 'phone', search = '', ua = 'Mozilla/5.0 (X11; Linux x86_64)', touch = false, single, protocol = 'https:', stored } = {}) {
  const cookies = [], store = new Map(stored ? [['wux.shell', stored]] : []);
  let moved = null;
  const document = {
    documentElement: { dataset: { shell: page }, style: {} },
    set cookie(v) { cookies.push(v); }, get cookie() { return ''; },
  };
  const window = { stop() {}, WizHomeScreenPolicy: single ? { mode: true } : undefined };
  const ctx = vm.createContext({
    window, document, navigator: { userAgent: ua }, URL, URLSearchParams,
    location: { search, hash: '', protocol, pathname: '/wizard-os-home/' + (page === 'desktop' ? 'desktop.html' : ''),
      href: 'https://box.example/wizard-os-home/' + search, replace(u) { moved = u; } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    matchMedia: q => ({ matches: touch ? /coarse/.test(q) : /fine|hover/.test(q) }),
  });
  vm.runInContext(shellJs, ctx);
  return { cookies, moved, shell: window.WIZ_SHELL };
}

test('a desktop remembers its page in a cookie scoped to the shell, before it moves', () => {
  const r = runShell();
  assert.equal(r.shell, 'desktop');
  assert.match(r.moved, /desktop\.html$/);
  assert.equal(r.cookies.length, 1);
  assert.match(r.cookies[0], /^wux_shell=desktop; Path=\/wizard-os-home\/; Max-Age=\d+; SameSite=Lax; Secure$/);
});

test('a phone and the ?shell=phone override remember the phone page, so nginx never moves them', () => {
  assert.match(runShell({ touch: true, ua: 'Mozilla/5.0 (Linux; Android 14) Mobile' }).cookies[0], /^wux_shell=phone;/);
  assert.match(runShell({ page: 'desktop', search: '?shell=phone' }).cookies[0], /^wux_shell=phone;/);
  assert.doesNotMatch(runShell({ protocol: 'http:' }).cookies[0], /Secure/);
});

test('a pinned-app session (always the phone page) leaves the device choice alone', () => {
  assert.deepEqual(runShell({ single: true, stored: 'desktop' }).cookies, []);
});

test('nginx sends only a remembered desktop asking for the plain phone page to desktop.html', () => {
  assert.match(nginx, /map \$args \$wizard_shell_args \{ default 0; "~\(\?:\^\|&\)\(\?:shell\|app-session\)\(\?:\[=&\]\|\$\)" 1; \}/);
  assert.match(nginx, /map "\$cookie_wux_shell\|\$request_method\|\$uri\|\$wizard_shell_args" \$wizard_desktop_page \{/);
  assert.match(nginx, /"~\^desktop\\\|\(\?:GET\|HEAD\)\\\|\/wizard-os-home\/\(\?:index\\\.html\)\?\\\|0\$" "\/wizard-os-home\/desktop\.html";/);
  assert.match(nginx, /"~\^desktop\\\|\(\?:GET\|HEAD\)\\\|\/wizard-ux\/\(\?:index\\\.html\)\?\\\|0\$" "\/wizard-ux\/desktop\.html";/);
  // Server level, before any location: deep links (?session=, ?open=) and the hash travel with it.
  const server = nginx.slice(nginx.indexOf('  server {'));
  assert.ok(server.indexOf('if ($wizard_desktop_page) { return 302 $wizard_desktop_page$is_args$args; }') < server.indexOf('location '));
});

test('the map keys behave like nginx will match them', () => {
  const rx = [...nginx.matchAll(/"~(\^desktop[^"]+)" "([^"]+)";/g)].map(m => [new RegExp(m[1].replace(/\\\\/g, '\\')), m[2]]);
  const args = s => (/(?:^|&)(?:shell|app-session)(?:[=&]|$)/.test(s) ? 1 : 0);
  const page = (cookie, uri, a = '', method = 'GET') => rx.find(([r]) => r.test(`${cookie}|${method}|${uri}|${args(a)}`))?.[1] || '';
  assert.equal(page('desktop', '/wizard-os-home/'), '/wizard-os-home/desktop.html');
  assert.equal(page('desktop', '/wizard-os-home/index.html', 'session=abc'), '/wizard-os-home/desktop.html');
  assert.equal(page('desktop', '/wizard-ux/'), '/wizard-ux/desktop.html');
  assert.equal(page('desktop', '/wizard-os-home/', 'shell=phone'), '');
  assert.equal(page('desktop', '/wizard-os-home/', 'app-session=notes'), '');
  assert.equal(page('desktop', '/wizard-os-home/desktop.html'), '');
  assert.equal(page('desktop', '/wizard-os-home/', '', 'POST'), '');
  assert.equal(page('phone', '/wizard-os-home/'), '');
  assert.equal(page('', '/wizard-os-home/'), '');
});
