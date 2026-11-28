'use strict';
// A browser QA box's PATCH /wizard/v1/ui-preferences for the phone Apps panel's lists (wizard-ux#2047), as the Agent
// Service applies them (server/ui-preferences.mjs): add / remove one app id; move one Favorite before the first of
// `items` still listed, else right after the first of `after`, else last. Returns false for an operation the box refuses.
const ID = v => typeof v === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(v);
function applyPanelOps(prefs, ops) {
  const next = { ...prefs };
  for (const o of ops || []) {
    if (!['appFavorites', 'appRecentHidden'].includes(o.key) || !ID(o.item)) return false;
    const had = Array.isArray(next[o.key]) ? next[o.key] : [], rest = had.filter(x => x !== o.item);
    if (o.op === 'remove') next[o.key] = rest;
    else if (o.op === 'add') next[o.key] = had.includes(o.item) ? had : had.concat(o.item);
    else if (o.op === 'move' && had.includes(o.item)) {
      const f = (o.items || []).find(x => rest.includes(x)), p = (o.after || []).find(x => rest.includes(x));
      const at = f ? rest.indexOf(f) : p ? rest.indexOf(p) + 1 : rest.length;
      next[o.key] = [...rest.slice(0, at), o.item, ...rest.slice(at)];
    } else if (o.op !== 'move') return false;
  }
  return next;
}
module.exports = { applyPanelOps };
