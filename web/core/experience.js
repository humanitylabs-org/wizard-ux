/* Owner experience persistence boundary. No profile route exists beside /wizard/v1/my-skin yet;
 * device storage is deliberately isolated here, not scattered through Settings or tweak packages.
 * A future owner Files transport can replace Store without changing inheritance or the loader. */
(() => {
  'use strict';
  const LABEL = 'Experience'; // provisional human-facing name: change it in this one place
  const KEY = 'wos.experience.v1', ID = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
  const Store = {
    read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.version === 1 && v.mine && Array.isArray(v.mine.tweaks) ? v : null; } catch (_) { return null; } },
    write(value) { localStorage.setItem(KEY, JSON.stringify(value)); },
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  let state = Store.read() || { version: 1, mine: { skin: window.WosSkin?.current || 'nebula', tweaks: [], flags: {} }, base: null, overrides: {} };
  let catalog = null, slots = null, profile = null, manifests = new Map(), generation = 0, error = '', busy = false;
  const read = async url => {
    const r = await fetch(new URL(url, document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Could not read ${url} (${r.status})`); return r.json();
  };
  const changed = () => window.dispatchEvent(new Event('wos:experience'));
  function resolved() {
    const source = profile || state.mine;
    return { ...source, skin: state.base && state.skinOverride || source.skin, tweaks: source.tweaks.filter(id => ID.test(id) && state.overrides[id] !== false) };
  }
  async function apply() {
    const seq = ++generation; busy = true; error = ''; changed();
    try {
      catalog ||= await read('tweaks/catalog.json'); slots ||= await read('core/slots.json');
      const base = state.base;
      const next = base ? await read(`tweaks/${base}/profile.json`) : null;
      if (seq !== generation) return;
      if (next && (next.id !== base || !Array.isArray(next.tweaks) || next.tweaks.some(id => !catalog.tweaks.includes(id)))) throw new Error('Invalid published experience');
      profile = next;
      const current = resolved();
      if (next && window.WosSkin.current !== current.skin) window.WosSkin.set(current.skin);
      const ids = current.tweaks.filter(id => catalog.tweaks.includes(id));
      manifests = new Map(await Promise.all((profile || state.mine).tweaks.filter(id => catalog.tweaks.includes(id)).map(async id => [id, await read(`tweaks/${id}/manifest.json`)])));
      if (seq !== generation) return;
      await window.WosSkinHost.loadTweaks(ids, slots, { teamAuthors: catalog.teamAuthors });
    } catch (e) { if (seq === generation) error = e.message; } finally { if (seq === generation) { busy = false; changed(); } }
  }
  function save() { Store.write(state); }
  const experience = {
    LABEL,
    get state() { return copy({ ...state, profile, busy, error, active: window.WosSkinHost?.tweakState || [], tweaks: [...manifests].map(([id, m]) => ({ id, name: m.name, on: state.overrides[id] !== false })) }); },
    refresh: apply,
    chooseSkin(id) { if (state.base) state.skinOverride = id; else state.mine.skin = id; save(); },
    async tryProfile(id = 'miguel') {
      if (id !== 'miguel') throw new Error('Unknown published experience');
      if (!state.base) { state.mine.skin = window.WosSkin.current; state.mineOverrides = copy(state.overrides); }
      state.base = id; state.skinOverride = null; state.overrides = {}; save(); await apply();
    },
    async backToMine() {
      state.base = null; state.skinOverride = null; state.overrides = state.mineOverrides || {}; profile = null; save(); window.WosSkin.set(state.mine.skin); await apply();
    },
    async fork() {
      state.mine = { ...copy(resolved()), skin: window.WosSkin.current }; state.skinOverride = null; state.base = null; state.overrides = {}; profile = null; save(); await apply();
    },
    async toggle(id) {
      if (!(profile || state.mine).tweaks.includes(id)) return;
      state.overrides[id] = state.overrides[id] === false; save(); await apply();
    },
  };
  window.WosExperience = experience;
  window.addEventListener('wos:skin-host-ready', apply);
  if (window.WosSkinHost?.personalState.ready) void apply();
  // Follow the publisher on reopen / returning to the tab, preserving disabled overrides by id.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.base && !busy) void apply(); });
})();
