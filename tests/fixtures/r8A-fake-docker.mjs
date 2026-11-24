// A fake `docker` for running a workflow's real run: scripts (wizard-ux issue 1674: tests run the code). fakeDocker()
// puts a `docker` on PATH that records every call in calls.json; `docker build -t <tag> <ctx>` remembers the tag (the
// context must hold a Dockerfile); `docker run -d -p <ip>:<host>:<container> <tag>` refuses an image that was never
// built, then serves `policy` as the Content-Security-Policy on <ip>:<host> (a stand-in for the image's nginx, which
// the caller renders with the real entrypoint) until stop(). The container port is recorded for the caller to check.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DOCKER = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const dir = process.env.FAKE_DOCKER_DIR, log = path.join(dir, 'calls.json');
const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
const argv = process.argv.slice(2); calls.push(argv); fs.writeFileSync(log, JSON.stringify(calls));
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
if (argv[0] === 'build') {
  const ctx = argv[argv.length - 1];
  if (!fs.existsSync(path.join(ctx, 'Dockerfile'))) { console.error('no Dockerfile in ' + ctx); process.exit(1); }
  fs.writeFileSync(path.join(dir, 'image'), arg('-t') || '');
} else if (argv[0] === 'run') {
  const image = argv[argv.length - 1], built = fs.existsSync(path.join(dir, 'image')) ? fs.readFileSync(path.join(dir, 'image'), 'utf8') : '';
  if (image !== built) { console.error('Unable to find image ' + image); process.exit(125); }
  const [ip, port, inner] = (arg('-p') || '').split(':');
  fs.writeFileSync(path.join(dir, 'container-port'), inner || '');
  const policy = fs.readFileSync(path.join(dir, 'policy'), 'utf8');
  const server = "require('http').createServer((q, r) => { r.writeHead(200, { 'content-security-policy': process.env.P }); r.end('ok'); }).listen(+process.env.PORT, process.env.IP)";
  const child = spawn(process.execPath, ['-e', server], { env: { P: policy, PORT: port, IP: ip }, detached: true, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'pid'), String(child.pid)); child.unref();
} else if (argv[0] === 'logs') console.log('fake logs');
`;

export function fakeDocker(policy) {
  const dir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'r8A-docker-'));
  writeFileSync(path.join(dir, 'docker'), DOCKER, { mode: 0o755 });
  writeFileSync(path.join(dir, 'policy'), policy);
  const read = f => existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : null;
  return {
    env: { PATH: `${dir}:${process.env.PATH}`, FAKE_DOCKER_DIR: dir },
    calls: () => JSON.parse(read('calls.json') || '[]'),
    containerPort: () => read('container-port'),
    stop() { const pid = read('pid'); if (pid) try { process.kill(+pid); } catch {} rmSync(dir, { recursive: true, force: true }); },
  };
}
