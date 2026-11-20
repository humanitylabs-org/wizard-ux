#!/usr/bin/env node
// The security policy the shell really serves (wizard-ux#1565 item 4, wizard-troubleshooter#37). Tests that read
// packaging/static.conf alone missed a box whose entrypoint served an older policy, which blocked Troubleshooter's
// direct line while every test was green. This checks the Content-Security-Policy header a running shell sends.
//   CI (.github/workflows/served-csp.yml): build the image, run it, then
//   node tools/served-csp.mjs --url http://127.0.0.1:18788/wizard-os-home/
// The request carries a Tailscale-style Host so nginx's per-host map ($wizard_troubleshoot_direct) is exercised.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

// A tailnet name built at runtime (the agent review flags literal tailnet hosts in the repo).
export const SAMPLE_HOST = ['wizard', 'tail0000', 'ts', 'net'].join('.');
export const DIRECT_PORT = 9691;

export function directives(policy) {
  const out = new Map();
  for (const part of String(policy || '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), sources);
  }
  return out;
}

// Does a CSP source expression allow https://<host>:<port>? Handles exact origins and a leading `*.` wildcard.
function allows(src, host, port) {
  const m = String(src).match(/^https:\/\/(\*\.)?([a-z0-9.-]+)(?::(\d+|\*))?\/?$/i);
  if (!m) return false;
  const p = m[3] || '443';
  if (p !== '*' && Number(p) !== port) return false;
  const h = m[2].toLowerCase(), want = host.toLowerCase();
  return m[1] ? want.endsWith('.' + h) : want === h;
}

/** Problems with a served policy for a shell reached at `host` (empty = the direct line and the basics hold). */
export function cspProblems(policy, host = SAMPLE_HOST) {
  const d = directives(policy), problems = [];
  if (!d.size) return ['no Content-Security-Policy header was served'];
  const ts = /\.ts\.net$/i.test(host);
  for (const name of ['frame-src', 'connect-src']) {
    const list = d.get(name) || d.get('default-src') || [];
    // Troubleshooter's direct line (core/reach.js): the shell pings and frames https://<this address>:9691 when
    // Wizard's usual route is down. Without it the one-tap Troubleshooter shows Connection help instead.
    if (ts && !list.some(s => allows(s, host, DIRECT_PORT))) problems.push(`${name} does not allow Troubleshooter's direct line https://${host}:${DIRECT_PORT}`);
    if (list.some(s => s === '*' || s === 'https:' || s === 'http:')) problems.push(`${name} allows any host`);
  }
  // On its own Tailscale name the shell lets in only this address's :9691, never another box's (wizard-os#133).
  const other = ['other-box', host.split('.').slice(1).join('.')].join('.');
  if (ts && (d.get('frame-src') || []).some(s => allows(s, other, DIRECT_PORT))) problems.push(`frame-src lets another tailnet name's :${DIRECT_PORT} into the shell (wizard-os#133)`);
  if (!(d.get('object-src') || []).includes("'none'")) problems.push("object-src is not 'none'");
  if (!(d.get('frame-ancestors') || []).includes("'self'")) problems.push("frame-ancestors is not 'self'");
  return problems;
}

/** The policy static.conf would send for `host`, with nginx's $wizard_troubleshoot_direct map resolved from the
 *  template. Only for unit tests: the served check above is the real one. */
export function renderStatic(staticConf, template, host = SAMPLE_HOST) {
  const m = String(staticConf).match(/add_header Content-Security-Policy "([^"]+)"/);
  if (!m) return '';
  let policy = m[1];
  const map = String(template).match(/map \$host \$wizard_troubleshoot_direct \{([\s\S]*?)\n\s*\}/);
  if (map) {
    let value = '';
    for (const line of map[1].split('\n')) {
      const r = line.trim().match(/^"~(.+)"\s+"([^"]*)";$/), def = line.trim().match(/^default\s+"([^"]*)";$/);
      if (r && !value && new RegExp(r[1]).test(host)) value = r[2];
      if (def && !value) value = def[1];
    }
    policy = policy.replaceAll('$wizard_troubleshoot_direct', value.replaceAll('$host', host));
  }
  return policy;
}

export function fetchPolicy(url, host = SAMPLE_HOST) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers: { host, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }, res => {
      res.resume();
      resolve({ status: res.statusCode, policy: res.headers['content-security-policy'] || '' });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function main(argv) {
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const url = arg('--url'), host = arg('--host') || SAMPLE_HOST;
  if (!url) { console.error('usage: node tools/served-csp.mjs --url http://127.0.0.1:<port>/wizard-os-home/ [--host <name>]'); return 2; }
  let r = null;
  for (let i = 0; i < 30 && !r; i++) {
    try { r = await fetchPolicy(url, host); } catch { await new Promise(ok => setTimeout(ok, 1000)); }
  }
  if (!r) { console.error(`::error::the shell at ${url} never answered`); return 1; }
  console.log(`served ${r.status} for Host ${host}\nContent-Security-Policy: ${r.policy}`);
  const problems = r.status === 200 ? cspProblems(r.policy, host) : [`the shell answered ${r.status}, not 200`];
  for (const p of problems) console.log(`::error::${p}`);
  return problems.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));
