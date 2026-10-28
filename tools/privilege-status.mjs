// Fixed read-only App Manager API projection. Same client settings as the unprivileged wam CLI.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readCapped} from './store-index-views.mjs';
export function managerSettings(home = process.env.WIZARD_OS_HOME || join(homedir(), '.wizard-os')) {
  const doc = JSON.parse(readFileSync(join(home, 'client.json'), 'utf8'));
  if (typeof doc.url !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/?$/.test(doc.url)) throw Error('manager unavailable');
  const u = new URL(doc.url); if (Number(u.port) < 1 || Number(u.port) > 65535) throw Error('manager unavailable');
  const token = readFileSync(join(home, 'agent-token'), 'utf8').trim();
  if (token.length < 32 || /[\r\n]/.test(token)) throw Error('manager unavailable');
  return {origin:u.origin, token};
}
export function privilegeMetadata(doc) {
  if (typeof doc?.enabled !== 'boolean' || typeof doc?.server_access?.active !== 'boolean') throw Error('invalid manager status');
  const a = doc.server_access;
  return {enabled:doc.enabled, return_pending:doc.return_pending === true, server_access:{active:a.active, available:a.available !== false && !a.error,
    severity:a.active ? 'red' : 'ok', expires_at:typeof a.expires_at === 'string' && a.expires_at.length < 80 ? a.expires_at : null,
    // Presence, not arbitrary paths or internal helper errors, is the UI contract.
    drift:Array.isArray(a.drift) && a.drift.length ? ['changed'] : []}};
}
export async function readPrivilegeStatus({fetchImpl = fetch, settings = managerSettings} = {}) {
  const {origin,token} = settings();
  const r = await fetchImpl(origin + '/api/status', {headers:{Authorization:'Bearer ' + token},redirect:'error',signal:AbortSignal.timeout(8000)});
  if (!r.ok) throw Error('manager unavailable');
  return privilegeMetadata(JSON.parse((await readCapped(r, 65536)).toString('utf8')));
}
