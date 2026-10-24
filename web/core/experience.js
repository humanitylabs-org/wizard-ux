/* A skin brings its author's tweaks (James, 24 Oct 2026): picking any palette of Miguel's skin turns on Miguel's
 * tweaks; picking another skin drops them. The owner can switch individual tweaks off, remembered per skin, so
 * coming back to that skin keeps those choices. Tweaks stay separate packages (web/tweaks/<owner>/<tweak>); the
 * skin family only names which published set it carries (`tweaks: '<owner>'` in core/skins.js).
 * Device storage is isolated here until Agent Service offers an owner profile route. */
(() => {
  'use strict';
  const KEY = 'wos.skin-tweaks.v1', ID = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
  const Store = {
    read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.version === 1 && v.off && typeof v.off === 'object' ? v : null; } catch (_) { return null; } },
    write(value) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (_) {} },
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  let state = Store.read() || { version: 1, off: {} };
  let catalog = null, slots = null, set = null, owner = null, manifests = new Map(), generation = 0, error = '', busy = false;
  const read = async url => {
    const r = await fetch(new URL(url, document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Could not read ${url} (${r.status})`); return r.json();
  };
  const changed = () => window.dispatchEvent(new Event('wos:experience'));
  // The tweak set the worn skin carries: its family's `tweaks` owner id, or none.
  function wornOwner() {
    const S = window.WosSkin; if (!S) return null;
    const fid = S.familyOf?.(S.current), fam = (S.families || []).find(f => f.id === fid);
    return fam?.tweaks && /^[a-z0-9][a-z0-9-]*$/.test(fam.tweaks) ? fam.tweaks : null;
  }
  // Absence means the published defaults; an explicit [] is the owner's deliberate choice.
  const offFor = who => who && Object.hasOwn(state.off, who) ? state.off[who] : (who === owner ? set?.off || [] : []);
  // Move the legacy Layout choice into the Wizard tweak once, even if another skin is worn now.
  try {
    if (localStorage.getItem('wos.layout') === 'two-orb' && !localStorage.getItem('wos.two-orbs.migrated.v1')) {
      if (!Object.hasOwn(state.off, 'wizard')) { state.off.wizard = ['wizard/app-borders']; Store.write(state); }
      localStorage.setItem('wos.two-orbs.migrated.v1', 'true');
    }
  } catch (_) {}
  // Preserve a deliberate old framed choice once; explicit offs after this migration always win.
  try {
    if (!localStorage.getItem('wos.app-borders.migrated.v1')) {
      const saved = JSON.parse(localStorage.getItem('wos.skin.composition.v1') || 'null');
      const off = new Set(state.off.wizard || ['wizard/two-orbs']);
      if (saved?.frame?.foundation !== 'framed') off.add('wizard/app-borders');
      else off.delete('wizard/app-borders');
      state.off.wizard = [...off]; Store.write(state);
      localStorage.setItem('wos.app-borders.migrated.v1', 'true');
    }
  } catch (_) {}
  async function apply() {
    const seq = ++generation; busy = true; error = ''; changed();
    try {
      const who = wornOwner();
      // A legacy layout can boot before this deferred module; the worn family now owns it.
      if (window.WosSkinHost.layout === 'two-orb' && !window.WosSkinHost.tweakState.includes('wizard/two-orbs')) window.WosSkinHost.setLayout('classic');
      catalog ||= await read('tweaks/catalog.json'); slots ||= await read('core/slots.json');
      const next = who ? await read(`tweaks/${who}/profile.json`) : null;
      if (seq !== generation) return;
      if (next && (next.id !== who || !Array.isArray(next.tweaks) || next.tweaks.some(id => !ID.test(id) || !catalog.tweaks.includes(id)) || (next.off !== undefined && (!Array.isArray(next.off) || next.off.some(id => !next.tweaks.includes(id)))))) throw new Error('This skin’s tweaks could not be read');
      owner = who; set = next;
      const all = next ? next.tweaks : [];
      manifests = new Map(await Promise.all(all.map(async id => [id, await read(`tweaks/${id}/manifest.json`)])));
      if (seq !== generation) return;
      await window.WosSkinHost.loadTweaks(all.filter(id => !offFor(who).includes(id)), slots, { teamAuthors: catalog.teamAuthors });
    } catch (e) { if (seq === generation) error = e.message; } finally { if (seq === generation) { busy = false; changed(); } }
  }
  const experience = {
    get state() {
      return copy({ owner, busy, error, active: window.WosSkinHost?.tweakState || [],
        tweaks: [...manifests].map(([id, m]) => ({ id, name: m.name, description: m.description || '', on: !offFor(owner).includes(id) })) });
    },
    refresh: apply,
    // Settings calls this after a skin pick; other skin changes arrive as `wos:skin`.
    chooseSkin() { if (wornOwner() !== owner || (!set && owner)) return apply(); return Promise.resolve(); },
    async toggle(id) {
      if (!owner || !set?.tweaks.includes(id)) return;
      const off = new Set(offFor(owner)); off.has(id) ? off.delete(id) : off.add(id);
      state.off[owner] = [...off]; Store.write(state); await apply();
    },
  };
  window.WosExperience = experience;
  window.addEventListener('wos:skin-host-ready', apply);
  window.addEventListener('wos:skin', () => { void experience.chooseSkin(); });
  if (window.WosSkinHost?.personalState.ready) void apply();
  // Pick up the author's newly published tweaks on reopen, keeping the owner's offs by id.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && owner && !busy) void apply(); });
})();
