// Build the shell image's file tree from the real Dockerfile without Docker (wizard-ux issue 1674: tests run the
// code). buildImage() walks the Dockerfile in order: COPY copies from this checkout into a sandbox root, honouring
// .dockerignore (the `name`, `name*` and `**/name` patterns it uses); RUN runs the real shell line in sh with every
// absolute image path (/usr/, /etc/, /tmp/) moved into the sandbox; ENV/ARG set the build env; `apk add` is skipped
// (the base image's packages are the host's here). After `USER` drops root, the image tree is made read-only, so a RUN
// that still writes into it fails the build the way a non-root RUN fails in Docker. `seed` puts files in the sandbox
// before the build (an owner file already in place). Returns { root, file(p), exists(p), read(p), done() }.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function ignorer(text) {
  const pats = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const glob = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  const rules = pats.map(p => p.startsWith('**/') ? { any: glob(p.slice(3)) } : { top: glob(p) });
  return rel => rules.some(r => r.any ? r.any.test(path.basename(rel)) : r.top.test(rel) || r.top.test(rel.split('/')[0]));
}

function chmodTree(p, writable) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const n of readdirSync(p)) chmodTree(path.join(p, n), writable); chmodSync(p, writable ? 0o755 : 0o555); }
  else chmodSync(p, writable ? 0o644 : 0o444);
}

export function buildImage({ dockerfile = readFileSync(path.join(REPO, 'Dockerfile'), 'utf8'), seed = {}, args = {} } = {}) {
  const root = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'r8A-image-'));
  const at = p => path.join(root, p);
  const ignored = ignorer(existsSync(path.join(REPO, '.dockerignore')) ? readFileSync(path.join(REPO, '.dockerignore'), 'utf8') : '');
  for (const [p, body] of Object.entries(seed)) { mkdirSync(path.dirname(at(p)), { recursive: true }); writeFileSync(at(p), body); }
  const env = { PATH: process.env.PATH }, log = [];
  let unprivileged = false;
  const move = s => s.replace(/(^|[\s"'=>])\/(usr|etc|tmp)\//g, (_, pre, dir) => `${pre}${root}/${dir}/`);
  const lines = dockerfile.replace(/\\\n/g, ' ').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const line of lines) {
    const [, op, rest] = /^(\w+)\s+([\s\S]*)$/.exec(line);
    if (op === 'FROM' || op === 'EXPOSE' || op === 'HEALTHCHECK' || op === 'ENTRYPOINT' || op === 'CMD') continue;
    if (op === 'ENV') { for (const m of rest.matchAll(/(\w+)=(\S*)/g)) env[m[1]] = m[2]; continue; }
    if (op === 'ARG') { const [k, v = ''] = rest.split('='); env[k] = args[k] ?? v; continue; }
    if (op === 'USER') { unprivileged = !/^(0|root)(:|$)/.test(rest); if (unprivileged) chmodTree(at('usr'), false); log.push(['USER', rest]); continue; }
    if (op === 'COPY') {
      const parts = rest.split(/\s+/), dest = parts.pop();
      for (const src of parts) {
        const to = dest.endsWith('/') ? at(path.join(dest, path.basename(src))) : at(dest);
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(path.join(REPO, src), to, { recursive: true, filter: s => { const rel = path.relative(REPO, s); return !rel || !ignored(rel); } });
      }
      log.push(['COPY', rest]); continue;
    }
    if (op === 'RUN') {
      if (/^apk add\b/.test(rest)) { log.push(['RUN skipped', rest]); continue; }
      const r = spawnSync('sh', ['-e', '-c', move(rest)], { env, encoding: 'utf8' });
      log.push(['RUN', rest, r.status]);
      if (r.status !== 0) { if (unprivileged) chmodTree(at('usr'), true); throw new Error(`RUN failed (${r.status}): ${rest}\n${r.stderr}`); }
      continue;
    }
    throw new Error('buildImage: unknown Dockerfile instruction ' + op);
  }
  if (unprivileged) chmodTree(at('usr'), true);
  return { root, log, file: at, exists: p => existsSync(at(p)), read: p => readFileSync(at(p), 'utf8'), done: () => rmSync(root, { recursive: true, force: true }) };
}
