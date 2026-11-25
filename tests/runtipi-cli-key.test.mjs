// wizard-app-manager#839: the shell's Runtipi loopback tools sign with Runtipi 4.12's CLI key when the App Manager
// left a private copy, and with the .env JWT_SECRET otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { cliKey, cliSecret, keyFile } from '../tools/runtipi-cli-key.mjs';
import { readConfig, createResourceReader } from '../tools/system-resources.mjs';

const KEY = 'ab'.repeat(32);
const dir = () => mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'cli-key-'));
const put = (path, text, mode = 0o600) => { writeFileSync(path, text); chmodSync(path, mode); return path; };

test('the key file lives in the wizard home', () => {
  assert.equal(keyFile({ WIZARD_OS_HOME: '/x/home' }), '/x/home/runtipi-cli-key');
  assert.equal(keyFile({ WIZARD_RUNTIPI_CLI_KEY_FILE: '/k', WIZARD_OS_HOME: '/x' }), '/k');
});

test('a private valid copy wins over JWT_SECRET', () => {
  const p = put(join(dir(), 'runtipi-cli-key'), KEY + '\n');
  assert.equal(cliKey(p), KEY);
  assert.equal(cliSecret({ JWT_SECRET: 'old' }, p), KEY);
});

test('no copy, a readable-by-others copy, junk or a symlink: JWT_SECRET', () => {
  const d = dir();
  assert.equal(cliSecret({ JWT_SECRET: 'old' }, join(d, 'missing')), 'old');
  assert.equal(cliSecret({ JWT_SECRET: 'old' }, put(join(d, 'wide'), KEY, 0o644)), 'old');
  assert.equal(cliSecret({ JWT_SECRET: 'old' }, put(join(d, 'junk'), 'not-a-key')), 'old');
  const real = put(join(d, 'real'), KEY); symlinkSync(real, join(d, 'link'));
  assert.equal(cliSecret({ JWT_SECRET: 'old' }, join(d, 'link')), 'old');
  assert.equal(cliSecret({}, join(d, 'missing')), undefined);
});

test('system-resources signs each reading with the key present at that moment', async () => {
  const d = dir(), env = put(join(d, '.env'), 'INTERNAL_IP=127.0.0.1\nNGINX_PORT=80\nJWT_SECRET=old\n', 0o664);
  const keyPath = join(d, 'runtipi-cli-key');
  const prev = process.env.WIZARD_RUNTIPI_CLI_KEY_FILE;
  process.env.WIZARD_RUNTIPI_CLI_KEY_FILE = keyPath;
  try {
    const cfg = readConfig(env), seen = [];
    const fetchImpl = async (url, { headers }) => { seen.push(headers.Authorization.slice(7)); return { ok: true, text: async () => '{"cpuLoad":1}' }; };
    const read = createResourceReader({ ...cfg, fetchImpl });
    await read();
    put(keyPath, KEY);
    await read();
    const signedWith = (tok, s) => { const [h, p, sig] = tok.split('.'); return createHmac('sha256', s).update(`${h}.${p}`).digest('base64url') === sig; };
    assert.ok(signedWith(seen[0], 'old'));
    assert.ok(signedWith(seen[1], KEY));
  } finally {
    if (prev === undefined) delete process.env.WIZARD_RUNTIPI_CLI_KEY_FILE; else process.env.WIZARD_RUNTIPI_CLI_KEY_FILE = prev;
  }
});
