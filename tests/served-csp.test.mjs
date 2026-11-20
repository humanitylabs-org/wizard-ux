// The policy the shell really serves (wizard-ux#1565 item 4). tools/served-csp.mjs checks the Content-Security-Policy
// header of a running shell image in CI (.github/workflows/served-csp.yml); these tests pin the checker itself: the
// 4 Nov policy (before Troubleshooter's direct line) fails it, the current static.conf + nginx map passes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cspProblems, renderStatic, SAMPLE_HOST } from '../tools/served-csp.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const template = read('packaging/nginx.conf.template');
// packaging/static.conf as of 3a96a944 (4 Nov 2026): what James's box still served on 17 Nov (wizard-troubleshooter#37).
const NOV4 = `add_header Content-Security-Policy "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data: https://derp1.tailscale.com/generate_204; media-src 'self' blob:; frame-src 'self' blob:; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'" always;`;

test('the 4 Nov policy fails: it blocks Troubleshooter’s direct line', () => {
  const problems = cspProblems(renderStatic(NOV4, template));
  assert.ok(problems.some(p => /frame-src does not allow Troubleshooter's direct line/.test(p)), problems.join('\n'));
  assert.ok(problems.some(p => /connect-src does not allow/.test(p)));
});

test('this release’s policy passes on its Tailscale name and lets in only its own :9691', () => {
  const policy = renderStatic(read('packaging/static.conf'), template);
  assert.deepEqual(cspProblems(policy), []);
  assert.match(policy, new RegExp(`frame-src [^;]*https://${SAMPLE_HOST.replaceAll('.', '\\.')}:9691`));
  assert.doesNotMatch(policy, /\*\.ts\.net/, 'never another tailnet name');
});

test('the checker rejects a wildcard tailnet line, an open frame-src and a missing header', () => {
  const wide = renderStatic(read('packaging/static.conf'), template).replaceAll(`https://${SAMPLE_HOST}:9691`, 'https://*.ts.net:9691');
  assert.ok(cspProblems(wide).some(p => /another tailnet name/.test(p)));
  assert.ok(cspProblems("frame-src *; connect-src *; object-src 'none'; frame-ancestors 'self'").some(p => /any host/.test(p)));
  assert.deepEqual(cspProblems(''), ['no Content-Security-Policy header was served']);
});

test('the served check runs on the built image in CI, not on static.conf alone', () => {
  const wf = read('.github/workflows/served-csp.yml');
  assert.match(wf, /docker build/);
  assert.match(wf, /docker run[^\n]*wizard-shell-csp/);
  assert.match(wf, /node tools\/served-csp\.mjs --url http:\/\/127\.0\.0\.1:18788\//);
});
