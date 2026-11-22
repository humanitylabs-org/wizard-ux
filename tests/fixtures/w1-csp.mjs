// The Content-Security-Policy each shell server really sends (wizard-ux issue 1674: tests read the served header,
// not the config text): the image's nginx (rendered by the real entrypoint, tests/fixtures/w1-nginx.mjs), the local
// QA origin (tools/qa-origin.cjs) and the dev server (server.py), each started and asked for the shell page.
// parseCsp() turns a header into { directive: [sources] }.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nginxShell } from './w1-nginx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const parseCsp = header => Object.fromEntries(String(header).split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));

export function nginxCsp({ host = 'box.example', uri = '/wizard-os-home/' } = {}) {
  const shell = nginxShell();
  try {
    const r = shell.request({ uri, host });
    const all = r.header('content-security-policy');
    if (all.length !== 1) throw new Error(`nginx sent ${all.length} CSP headers`);
    return all[0];
  } finally { shell.done(); }
}

const freePort = async () => { const s = http.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p; };

async function served(cmd, args, env, url, ready) {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let out = '';
    await new Promise((resolve, reject) => {
      child.stdout.on('data', d => { out += d; if (ready.test(out)) resolve(); });
      child.on('exit', code => reject(new Error(`${cmd} exited ${code}`)));
    });
    const res = await fetch(url);
    await res.arrayBuffer();
    return res.headers.get('content-security-policy');
  } finally { child.kill(); if (child.exitCode === null) await once(child, 'exit'); }
}

export async function qaOriginCsp() {
  const port = await freePort();
  return served(process.execPath, [path.join(ROOT, 'tools/qa-origin.cjs'), String(port)], {}, `http://127.0.0.1:${port}/wizard-os-home/index.html`, /qa-origin http/);
}

export async function serverPyCsp({ origin = '' } = {}) {
  const port = await freePort();
  return served('python3', ['-u', path.join(ROOT, 'server.py')], { WIZARD_OS_HOME_PORT: String(port), WIZARD_ORIGIN: origin }, `http://127.0.0.1:${port}/index.html`, /wizard-os-home on/);
}
