// QA: chat links are origin-independent (relative paths), and links to this Wizard's other names
// (settings network.base_url and network.aliases, via WizConfig.homeHosts) fold back to paths so they open in place.
// Neutral example hosts: nothing about a real box is built in.
// Usage: node qa-relative-links.cjs   (pure: loads web/core/chat-kit.js in a fake window; no network)
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const src = fs.readFileSync(path.join(__dirname, 'web/core/chat-kit.js'), 'utf8');

const BASE_HOST = 'wizard.example.ts.net', OLD = 'old-name.example.com', ALIAS = 'wizard-private.example.ts.net';
function load(host, homeHosts = []) {
  const store = {};
  const win = {
    location: { hostname: host, origin: `https://${host}`, port: '', href: `https://${host}/wizard-os-home/` },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    WizConfig: { homeHosts: () => homeHosts },
    WizCore: {}, navigator: {}, document: { addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {}, setAttribute() {} }), body: { appendChild() {} } },
    addEventListener() {}, setTimeout, clearTimeout, URL, Intl, Date, Math, JSON, console,
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(src, win);
  return win.WosChat;
}

for (const host of [BASE_HOST, 'localhost']) {
  const K = load(host, [BASE_HOST, OLD, ALIAS]);
  const md = s => K.md(s);
  // Relative links render as live links (they open on whatever address this device uses).
  ok(/href="\/cinequeue\/"/.test(md('[CineQueue](/cinequeue/)')), `${host}: relative path is a link`);
  // Old custom-domain links fold to paths, so pre-migration messages open in place.
  ok(/href="\/reports\/wizard-os\/"/.test(md('[dl](https://old-name.example.com/reports/wizard-os/)')), `${host}: older name folds to a path`);
  ok(/href="\/reports\/x\/"/.test(md('[x](https://wizard-private.example.ts.net/reports/x/)')), `${host}: bootstrap alias folds to a path`);
  ok(/href="\/apps\/\?a=1#b"/.test(md(`[a](https://${host}/apps/?a=1#b)`)), `${host}: own absolute host folds to a path, query+hash kept`);
  // Thread links and private media keep their in-place handling through the old domain.
  ok(/data-session="abc_1"/.test(md('[t](https://old-name.example.com/wizard/?session=abc_1)')), `${host}: old-domain thread link opens in place`);
  ok(/data-mlink="\/wizard\/attachments\/0123456789abcdef0123456789abcdef"/.test(md('[f](https://old-name.example.com/wizard/attachments/0123456789abcdef0123456789abcdef)')), `${host}: old-domain attachment stays private media`);
  // Foreign hosts stay external and absolute.
  ok(/href="https:\/\/example\.com\/x"/.test(md('[e](https://example.com/x)')), `${host}: external link untouched`);
  ok(/href="https:\/\/old-name\.example\.com\.evil\.test\/"/.test(md('[e](https://old-name.example.com.evil.test/)')), `${host}: lookalike host is not folded`);
  // Unsafe relative forms are refused.
  ok(!/href="\/\/evil/.test(md('[e](//evil.test/x)')), `${host}: protocol-relative refused`);
  ok(!/href="javascript/.test(md('[e](javascript:alert(1))')), `${host}: javascript: refused`);
  ok(!/href="\/\\/.test(md('[e](/\\evil.test)')), `${host}: backslash host trick refused`);
  // isHomeUrl recognises the old domain for in-place opening.
  ok(K.isHomeUrl(new URL('https://old-name.example.com/cinequeue/')), `${host}: isHomeUrl(old domain)`);
  ok(!K.isHomeUrl(new URL('https://example.com/')), `${host}: isHomeUrl(foreign) false`);
  // Images: old-domain absolute image becomes a same-origin path; foreign images stay blocked.
  ok(K.imagesOf({ image_urls: ['https://old-name.example.com/reports/a.png'] }, '').includes('/reports/a.png'), `${host}: old-domain image folds to path`);
  ok(!K.imagesOf({ image_urls: ['https://example.com/a.png'] }, '').length, `${host}: foreign image blocked`);
}
// A Wizard with no older names folds nothing but its own host (no name is built into the shell).
{
  const K = load(BASE_HOST, []);
  ok(/href="https:\/\/old-name\.example\.com\/x\/"/.test(K.md('[o](https://old-name.example.com/x/)')), 'no aliases: another host stays absolute');
  ok(/href="\/x\/"/.test(K.md(`[o](https://${BASE_HOST}/x/)`)), 'no aliases: own host still folds');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
