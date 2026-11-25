// Which secret the shell's Runtipi loopback tools sign `sub=cli` tokens with (wizard-app-manager#839).
// Runtipi 4.12 signs CLI tokens with a private key in its runtipi_auth volume (/data/.secrets/cli-secret). The App
// Manager (wam/runtipi_key.py) keeps a private copy of that key in ~/.wizard-os/runtipi-cli-key (0600) and removes it
// when the backend has no such key (older than 4.12) or it can't read it. Use that copy when it is a valid key only this user can read; JWT_SECRET from ~/runtipi/.env otherwise.
import { readFileSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const KEY = /^[a-f0-9]{64}$/;
export function keyFile(env = process.env) {
  return env.WIZARD_RUNTIPI_CLI_KEY_FILE || join(env.WIZARD_OS_HOME || join(homedir(), '.wizard-os'), 'runtipi-cli-key');
}
export function cliKey(path = keyFile()) {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || (st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid())) return null;
    const key = readFileSync(path, 'utf8').trim();
    return KEY.test(key) ? key : null;
  } catch { return null; }
}
// The secret for one token: the 4.12 CLI key when the App Manager left one, else the .env JWT_SECRET (may be undefined).
export function cliSecret(runtipiEnv, path = keyFile()) {
  return cliKey(path) || runtipiEnv?.JWT_SECRET;
}
