// Wizard OS system health: the owner's health checks (disk, memory, services, backups…) shown in Home → Resources.
//
// The checks themselves are produced by whatever watchdog the install runs; this adapter only reads its latest
// result file and passes an allowlisted, clipped shape to the shell. Nothing here runs a check or names a machine.
// File: WIZARD_SYSTEM_HEALTH_FILE (JSON: {generated_at, items:[{key,label,status,value,detail}]}). Unset or missing
// file → {available:false}, so installs without a watchdog simply show no Health section.
import {readFile} from 'node:fs/promises';

export const HEALTH_PATH = () => process.env.WIZARD_SYSTEM_HEALTH_FILE || '';
// A watchdog that runs every few minutes is stale after an hour; the shell labels it instead of trusting old greens.
export const STALE_MS = 60 * 60 * 1000;
const STATUS = new Set(['ok', 'warn', 'error']);
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function cleanHealth(raw, now = Date.now()) {
  const j = raw && typeof raw === 'object' ? raw : {};
  const at = Date.parse(j.generated_at || j.generatedAt || '');
  const checks = [];
  for (const it of Array.isArray(j.items) ? j.items : []) {
    if (!it || typeof it !== 'object') continue;
    const key = clip(it.key, 48).toLowerCase();
    if (!KEY_RE.test(key) || checks.some(c => c.key === key)) continue;
    checks.push({
      key,
      label: clip(it.label, 40) || key,
      status: STATUS.has(it.status) ? it.status : 'warn',
      value: clip(it.value, 40),
      detail: clip(it.detail, 300),
    });
    if (checks.length >= 24) break;
  }
  const counts = {ok: 0, warn: 0, error: 0};
  for (const c of checks) counts[c.status]++;
  return {
    available: true,
    checkedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
    stale: !Number.isFinite(at) || now - at > STALE_MS,
    status: counts.error ? 'error' : counts.warn ? 'warn' : 'ok',
    counts,
    checks,
  };
}

export function createHealthReader({path = HEALTH_PATH(), now = Date.now} = {}) {
  return async () => {
    if (!path) return {available: false, checks: []};
    let text;
    try { text = await readFile(path, 'utf8'); }
    catch (e) { if (e?.code === 'ENOENT') return {available: false, checks: []}; throw new Error('Health unavailable'); }
    if (text.length > 262144) throw new Error('Health file too large');
    return cleanHealth(JSON.parse(text), now());
  };
}
