// The policy the shell really serves (wizard-ux#1565 item 4). tools/served-csp.mjs checks the Content-Security-Policy
// header of a running shell image in CI (.github/workflows/served-csp.yml); these tests pin the checker itself: the
// 4 Nov policy (before Troubleshooter's direct line) fails it, the current static.conf + nginx map passes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cspProblems, renderStatic, SAMPLE_HOST } from '../tools/served-csp.mjs';
import { readWorkflow, expr } from './fixtures/w1-workflow.mjs';
import { render } from './fixtures/w1-nginx.mjs';
import { nginxCsp } from './fixtures/w1-csp.mjs';
import { fakeDocker } from './fixtures/r8A-fake-docker.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));

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

// Runs the workflow's real run: scripts in order (a fake docker builds this checkout's context and serves, on the port
// the workflow publishes, the policy the image's nginx sends: the real entrypoint rendered by tests/fixtures/w1-nginx.mjs),
// so the served check really talks HTTP to "the image", and fails when the image serves the 4 Nov policy.
async function runWorkflow(policy) {
  const wf = readWorkflow(new URL('../.github/workflows/served-csp.yml', import.meta.url)), job = wf.jobs['served-csp'];
  const docker = fakeDocker(policy), results = [];
  try {
    let failed = false;
    for (const s of job.steps.filter(s => s.run)) {
      // expr() has no status functions: put this run's status in (Actions' failure() / success() / always()).
      const status = { failure: failed, success: !failed, always: true };
      if (s.if != null && !expr(String(s.if).replace(/\b(failure|success|always)\(\)/g, (_, f) => String(status[f])), {})) continue;
      const r = await new Promise(res => {
        const c = spawn('bash', ['-e', '-c', s.run], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...docker.env } });
        let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
        c.on('exit', status => res({ name: s.name, status, out }));
      });
      results.push(r); if (r.status) failed = true;
    }
    return { results, calls: docker.calls(), containerPort: docker.containerPort() };
  } finally { docker.stop(); }
}

test('the served check runs on the built image in CI, not on static.conf alone', async () => {
  const listen = render(); let port;
  try { port = /listen\s+(\S+);/.exec(readFileSync(listen.conf, 'utf8'))[1]; } finally { listen.done(); }
  const good = await runWorkflow(nginxCsp({ host: SAMPLE_HOST }));
  assert.deepEqual(good.results.map(r => r.status), [0, 0], good.results.map(r => r.out).join('\n'));
  const build = good.calls.find(c => c[0] === 'build'), run = good.calls.find(c => c[0] === 'run');
  assert.ok(build && run && good.calls.indexOf(build) < good.calls.indexOf(run), 'the image is built, then started');
  assert.equal(good.containerPort, port.split(':').pop(), 'the workflow publishes the port the image\'s nginx listens on');
  assert.match(good.results[1].out, /Content-Security-Policy: .*frame-src/, 'the check read the policy over HTTP');
  const old = await runWorkflow(renderStatic(NOV4, template));
  assert.notEqual(old.results[1].status, 0, 'an image serving the 4 Nov policy fails the job');
  assert.match(old.results[1].out, /frame-src does not allow Troubleshooter's direct line/);
  assert.equal(old.results.at(-1).name, 'Shell log', 'a failure prints the shell log');
});
