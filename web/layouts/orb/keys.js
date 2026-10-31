/* Hold ⌥ for app letters (Orbs view, Miguel, 31 Oct 2026). Each floating app gets a key: ⌥ + a letter of its name
 * that the desktop doesn't already use with ⌥; when those run out, ⌥⇧ + a letter of its name. Assignments are
 * stable: an app keeps the key it had (kept per device) as long as it is still free, new apps take what is left. */
// Every ⌥ letter the desktop binds (desktop/desktop.js onKey; tests/orb-layout.test.mjs keeps this in step), and the
// ⌥⇧ letters it binds too (⌥⇧W reopens a closed window; ⌥V, ⌥I, ⌥F, ⌥W also fire with ⇧ held).
export const ALT_TAKEN = Object.freeze([...'ACDFGILMNOPRSTVWXZ']);
export const SHIFT_TAKEN = Object.freeze([...'FIVW']);
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
/** apps: [{ id, name }], saved: { id: key }. Returns { id: key } where key is 'B' (⌥B) or '⇧B' (⌥⇧B). */
export function assignKeys(apps, saved = {}) {
  const free = new Set([...LETTERS.filter(l => !ALT_TAKEN.includes(l)), ...LETTERS.filter(l => !SHIFT_TAKEN.includes(l)).map(l => '⇧' + l)]);
  const out = {};
  for (const a of apps) { const k = saved?.[a.id]; if (typeof k === 'string' && free.has(k)) { out[a.id] = k; free.delete(k); } }
  for (const shiftOk of [false, true]) for (const a of apps) {
    if (out[a.id]) continue;
    const letters = [...String(a.name || a.id).toUpperCase()].filter(c => c >= 'A' && c <= 'Z');
    const pick = letters.map(l => (shiftOk ? '⇧' : '') + l).find(k => free.has(k));
    if (pick) { out[a.id] = pick; free.delete(pick); }
  }
  for (const a of apps) if (!out[a.id]) { const k = [...free][0]; if (k) { out[a.id] = k; free.delete(k); } }   // a name with no free letter
  return out;
}
/** The key a keydown means ('B' / '⇧B'), or null. */
export const keyOf = e => /^Key[A-Z]$/.test(e.code || '') ? (e.shiftKey ? '⇧' : '') + e.code.slice(3) : null;
