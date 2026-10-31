/* App letters in the Orbs view (Miguel, 31 Oct 2026, v7). Hold the LEFT ⌥ (Option / Alt) for a moment with no other
 * key and every floating app shows one bare letter; while it is held, that letter opens the app (it wins over the
 * desktop's ⌥ keys only then; a quick ⌥V / ⌥C keeps its usual meaning). One plain letter per app, never ⇧: the first
 * free letter of its name, else any free letter. Stable: an app keeps the letter it had (kept per device) while it is
 * still free; new apps take what is left. Past 26 apps the rest get none. */
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
/** apps: [{ id, name }], saved: { id: letter }. Returns { id: letter }. */
export function assignKeys(apps, saved = {}) {
  const free = new Set(LETTERS), out = {};
  for (const a of apps) { const k = saved?.[a.id]; if (typeof k === 'string' && free.has(k)) { out[a.id] = k; free.delete(k); } }
  for (const a of apps) {
    if (out[a.id]) continue;
    const pick = [...String(a.name || a.id).toUpperCase()].find(c => free.has(c));
    if (pick) { out[a.id] = pick; free.delete(pick); }
  }
  for (const a of apps) if (!out[a.id]) { const k = [...free][0]; if (k) { out[a.id] = k; free.delete(k); } }
  return out;
}
/** The letter a keydown means ('B'), or null. */
export const keyOf = e => /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3) : null;
/** Only the physical LEFT ⌥ arms the letters (Right ⌥ is the Mac app's dictation key). */
export const isLeftAlt = e => e.code === 'AltLeft';
export const HOLD_MS = 300;
