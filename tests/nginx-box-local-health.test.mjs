import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// Rehearsal finding (wizard-os 389, KVM alongside box, boundary on): `wizard doctor` probes
// http://127.0.0.1:8796/wizard/health and got 401 shell_token_required. The Agent Service lets box-local health probes
// through only without browser or proxy marks, but the shell's shared proxy settings ADD X-Forwarded-For with the
// caller's address. /wizard/health now passes the header on only when the caller sent one (Tailscale Serve always
// does, so tailnet requests stay refused). Real nginx proof (bt389 image + echo upstream): bare probe -> no XFF;
// Serve-like probe -> its XFF and Tailscale-User-Login kept; other paths -> XFF 127.0.0.1 as before.
const conf = readFileSync(new URL('../packaging/nginx.conf.template', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../packaging/entrypoint.sh', import.meta.url), 'utf8');
const proxy = readFileSync(new URL('../packaging/proxy.conf', import.meta.url), 'utf8');

test('/wizard/health has its own location with the health proxy settings', () => {
  const loc = conf.match(/location = \/wizard\/health \{([^}]*)\}/);
  assert.ok(loc, 'exact location present');
  assert.match(loc[1], /proxy_pass \$wizard_api\$request_uri;/);
  assert.match(loc[1], /include \/tmp\/wizard-proxy-health\.conf;/);
  assert.ok(conf.indexOf('location = /wizard/health') < conf.indexOf('location / {'), 'before the catch-all');
});

test('the health proxy settings equal the shared ones except X-Forwarded-For is passed through, never added', () => {
  const line = entry.split('\n').find(l => l.includes('/tmp/wizard-proxy-health.conf'));
  assert.ok(line, 'entrypoint writes it');
  const sed = line.match(/^sed '([^']+)'/)[1];
  const out = execFileSync('sed', [sed], { input: proxy, encoding: 'utf8' });
  const a = proxy.split('\n'), b = out.split('\n');
  assert.equal(a.length, b.length);
  const diff = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y);
  assert.deepEqual(diff, [['proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;', 'proxy_set_header X-Forwarded-For $http_x_forwarded_for;']]);
});
