/* Skins and tweaks are separate choices (Miguel, 30 Oct 2026). A skin is only a look. Every
 * tweak (web/tweaks/<author>/<id>) is one switch, off by default, labelled with its author; a quick
 * button per author turns all of theirs on (or off). Catalog `defaults` are built-in features, not experiments: on for
 * everyone, with an owner off-switch. Saved per device as { mix } in wos.skin-tweaks.v1. A device from before keeps
 * exactly what it ran: the set its color used to bring (with its offs) is written into mix once, then never again.
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
  let retried = false;  // one quiet retry when a slow network made the whole set fail to load
  let catalog = null, slots = null, set = null, owner = null, manifests = new Map(), generation = 0, error = '', busy = false;
  // Tweak files are static per release: read each once per page (a failure is forgotten so the next call retries).
  const files = new Map();
  const fetchOnce = async (url, ms = 6000) => {
    const r = await fetch(new URL(url, document.baseURI), { cache: /[?&]v=/.test(url) ? 'default' : 'no-cache', signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`Could not read ${url} (${r.status})`); return r.json();
  };
  // Release-stamped like every other shell file, so the browser keeps them until the next release.
  const rel = () => document.querySelector?.('meta[name="wos-release"]')?.content || '';
  const read = url => {
    if (/profile\.json$/.test(url)) return fetchOnce(url); // a published profile can change; manifests cannot
    if (/^[0-9a-f]{6,40}$/.test(rel())) url += (url.includes('?') ? '&' : '?') + 'v=' + rel();
    if (!files.has(url)) files.set(url, fetchOnce(url).catch(() => fetchOnce(url, 30000)).catch(e => { files.delete(url); throw e; }));
    return files.get(url).then(v => JSON.parse(JSON.stringify(v)));
  };
  const changed = () => window.dispatchEvent(new Event('wos:experience'));
  const WHO = /^[a-z0-9][a-z0-9-]*$/, STANDARD = 'wizard';
  // The set a color used to bring before the split: only for a device that has no preset saved yet.
  function legacyOwner() {
    const S = window.WosSkin; if (!S) return STANDARD;
    let chosen = null; try { chosen = localStorage.getItem('wos.skin'); } catch (_) {}
    if (!chosen) return STANDARD;
    const fid = S.familyOf?.(chosen), fam = (S.families || []).find(f => f.id === fid);
    return fam?.tweaks && WHO.test(fam.tweaks) ? fam.tweaks : 'none';
  }
  // One preset per device, chosen once (or carried over); 'none' = no set, only what the owner switches on.
  function wornOwner() {
    if (typeof state.preset !== 'string' || !(state.preset === 'none' || WHO.test(state.preset))) {
      // The old per-skin offs were a full list (absence = published defaults); apply() turns them into choices.
      const who = legacyOwner();
      state.preset = who; state.mix = {}; if (Object.hasOwn(state.off, who)) state.carry = [...state.off[who]];
      Store.write(state);
    }
    return state.preset === 'none' ? null : state.preset;
  }
  // The owner's own on/off per tweak, over the preset's published defaults.
  const mixOf = id => state.mix && Object.hasOwn(state.mix, id) ? state.mix[id] : undefined;
  const presetOn = id => !!set?.tweaks.includes(id) && !(set.off || []).includes(id);
  // Ids switched off for this preset: the owner's explicit offs plus the published default-offs he has not touched.
  const offFor = () => [...Object.keys(state.mix || {}).filter(id => state.mix[id] === false), ...(set?.off || []).filter(id => mixOf(id) === undefined)];
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
  // Own-skin recipes are retired (31 Oct 2026): this device's choices are the only tweak state.
  const recipe = () => null;
  // Release-wide defaults are independent of skin. Saved offs and recipe choices keep their meaning across renames.
  const canonical = id => catalog?.aliases?.[id] || id;
  const globalIds = () => catalog?.defaults || [];
  const globalOff = id => (state.defaultsOff || []).includes(id);
  function migrateDefaults() {
    if (state.defaultsMigrated) return;
    const off = new Set(state.defaultsOff || []);
    for (const ids of Object.values(state.off)) for (const id of ids) if (globalIds().includes(canonical(id))) off.add(canonical(id));
    state.defaultsOff = [...off]; state.defaultsMigrated = true; Store.write(state);
  }
  const recipeChoice = (own, id) => {
    if (!own) return undefined;
    if (Object.hasOwn(own.tweaks, id)) return own.tweaks[id];
    for (const [old, current] of Object.entries(catalog?.aliases || {})) if (current === id && Object.hasOwn(own.tweaks, old)) return own.tweaks[old];
    return undefined;
  };
  const enabled = (id, own = recipe()) => globalIds().includes(id) ? !globalOff(id) && recipeChoice(own, id) !== false
    : own ? (recipeChoice(own, id) ?? presetOn(id)) : (mixOf(id) ?? presetOn(id));
  // Packages that fill the same place (two Home maps): the first one listed in a catalog `oneOf` group wins.
  // An explicit off for any member (My skin recipe, a saved off, a release-wide off) turns the whole group off.
  const oneOf = (ids, own = recipe()) => { const out = [...ids]; for (const g of catalog?.oneOf || []) { const off = g.some(id => recipeChoice(own, id) === false || offFor(owner).includes(id) || globalOff(id)), on = g.filter(x => out.includes(x)); for (const id of off ? on : on.slice(1)) out.splice(out.indexOf(id), 1); } return out; };
  const groupOf = id => (catalog?.oneOf || []).find(g => g.includes(id)) || null;
  // One switch per group in Settings: the member this skin's profile lists, else the group's base (listed last: the
  // package the others replace keeps its switch, name and place, whichever member loads).
  const shownInGroup = id => { const g = groupOf(id); if (!g) return true; const present = g.filter(x => manifests.has(x)); return id === (present.find(x => set?.tweaks.includes(x)) || present[present.length - 1]); };
  const groupOn = id => { const own = recipe(); return oneOf([...manifests.keys()].filter(x => enabled(x, own)), own).some(x => groupOf(id).includes(x)); };
  const explicitOff = id => recipeChoice(recipe(), id) === false || offFor(owner).includes(id) || globalOff(id);
  async function setOne(id, on) {
    if (globalIds().includes(id)) {
      const off = new Set(state.defaultsOff || []); on ? off.delete(id) : off.add(id);
      state.defaultsOff = [...off]; Store.write(state);
      return;
    }
    if (!catalog?.tweaks.includes(id)) return;
    const mix = { ...(state.mix || {}) }; if (on === presetOn(id)) delete mix[id]; else mix[id] = on;
    state.mix = mix; Store.write(state);
  }
  const profileReads = new Map();
  function profile(who) {
    if (!profileReads.has(who)) {
      const pending = read(`tweaks/${who}/profile.json`).catch(e => { profileReads.delete(who); throw e; });
      profileReads.set(who, pending);
    }
    return profileReads.get(who);
  }
  let installedP = null;
  function installed() {
    installedP ||= (async () => {
      catalog ||= await read('tweaks/catalog.json');
      for (const who of catalog.profiles || []) void profile(who).catch(() => {});
      return Promise.all(catalog.tweaks.map(async id => ({ id, ...await read(`tweaks/${id}/manifest.json`) })));
    })().then(v => { installedP.settled = true; return v; }, e => { installedP = null; throw e; });
    return installedP.then(list => list.map(m => ({ ...m })));
  }
  // A new skin starts from what this device runs now (the color no longer decides tweaks).
  async function defaults() {
    const list = await installed();
    // What actually runs now, including the worn own skin's choices.
    return Object.fromEntries(list.map(m => [m.id, enabled(m.id, recipe())]));
  }
  // Authors with tweaks here, for the quick buttons: display name from their profile, else the id.
  async function authors() {
    catalog ||= await read('tweaks/catalog.json');
    const names = new Map(await Promise.all((catalog.profiles || []).map(async who => { try { const p = await profile(who); return [who, typeof p.name === 'string' ? p.name : who]; } catch (_) { return [who, who]; } })));
    const out = new Map();
    for (const id of catalog.tweaks) { if (globalIds().includes(id)) continue; const who = id.split('/')[0]; if (!out.has(who)) out.set(who, { id: who, name: names.get(who) || who, ids: [] }); out.get(who).ids.push(id); }
    return [...out.values()];
  }
  async function apply(warm = false) {
    const seq = ++generation; busy = true; error = ''; changed();
    try {
      const who = wornOwner();
      // A legacy layout can boot before this deferred module; the worn family now owns it.
      if (window.WosSkinHost.layout === 'two-orb' && !window.WosSkinHost.tweakState.includes('wizard/two-orbs')) window.WosSkinHost.setLayout('classic');
      catalog ||= await read('tweaks/catalog.json'); slots ||= await read('core/slots.json'); migrateDefaults();
      // A preset pick uses the profile the installed list already warmed; other refreshes re-read it for news.
      const next = who ? await (warm === true && profileReads.has(who) ? profileReads.get(who) : read(`tweaks/${who}/profile.json`)) : null;
      if (seq !== generation) return;
      if (next && (next.id !== who || !Array.isArray(next.tweaks) || next.tweaks.some(id => !ID.test(id) || !catalog.tweaks.includes(id)) || (next.off !== undefined && (!Array.isArray(next.off) || next.off.some(id => !next.tweaks.includes(id)))))) throw new Error('This skin’s tweaks could not be read');
      owner = who; set = next;
      if (Array.isArray(state.carry)) {
        const mix = {}; for (const id of next?.tweaks || []) { const on = !state.carry.includes(id); if (on !== presetOn(id)) mix[id] = on; }
        state.mix = mix; delete state.carry; Store.write(state);
      }
      // Flatten once: what the old set turned on becomes the owner's own switches; from now on everything starts off.
      if (who) {
        const mix = {};
        for (const id of catalog.tweaks) if (!globalIds().includes(id) && (mixOf(id) ?? presetOn(id))) mix[id] = true;
        state.mix = mix; state.preset = 'none'; Store.write(state); owner = null; set = null;
      }
      if (who) profileReads.set(who, Promise.resolve(next));
      // A renamed or merged tweak keeps the device's own switch: an old id's saved on/off moves to its new id once.
      for (const [old, current] of Object.entries(catalog.aliases || {})) if (state.mix && Object.hasOwn(state.mix, old)) {
        const mix = { ...state.mix }; if (!Object.hasOwn(mix, current)) mix[current] = mix[old]; delete mix[old]; state.mix = mix; Store.write(state);
      }
      // 31 Oct 2026 (James): the network Home left the release-wide defaults and is now Miguel's tweak. A device that ran it
      // and already wears Miguel's tweaks keeps it, once; everyone else starts without it and can still switch it on.
      // A device flattening its preset in this same pass takes it from the published profile instead.
      if (!state.machinesHomeMoved) {
        const ran = !who && !globalOff('wizard/machines-home') && !globalOff('miguel/machines-home');
        if (ran && mixOf('miguel/machines-home') === undefined && Object.entries(state.mix || {}).some(([id, on]) => on === true && id.startsWith('miguel/'))) state.mix = { ...state.mix, 'miguel/machines-home': true };
        state.machinesHomeMoved = true; Store.write(state);
      }
      const own = recipe();
      // Every installed tweak is offered, whoever wrote it; the preset only sets which start on.
      const all = [...new Set([...catalog.tweaks, ...globalIds()])];
      manifests = new Map(await Promise.all(all.map(async id => [id, await read(`tweaks/${id}/manifest.json`)])));
      if (seq !== generation) return;
      await window.WosSkinHost.loadTweaks(oneOf(all.filter(id => enabled(id, own)), own), slots, { teamAuthors: catalog.teamAuthors });
    } catch (e) { if (seq === generation) { error = e.message; if (!retried) { retried = true; setTimeout(() => { if (seq === generation) apply(); }, 5000); } } } finally { if (seq === generation) { busy = false; changed(); } }
  }
  const experience = {
    get state() {
      return copy({ owner, busy, error, active: window.WosSkinHost?.tweakState || [],
        tweaks: [...manifests].filter(([id]) => shownInGroup(id)).map(([id, m]) => ({ id, name: m.name, description: m.description || '', author: id.split('/')[0], builtin: globalIds().includes(id), on: groupOf(id) ? groupOn(id) : enabled(id) })) });
    },
    installed, defaults, authors,
    // Replacement groups (catalog `oneOf`): each loads only its first enabled member. Read after installed() settles.
    groups: () => (catalog?.oneOf || []).map(g => [...g]),
    get installedReady() { return !!installedP?.settled; },
    refresh: apply,
    // A color pick never changes tweaks; kept so older callers stay harmless.
    chooseSkin() { if (wornOwner() !== owner) return apply(); return Promise.resolve(); },
    // Quick button: turn on every tweak by this author; if all are on already, turn them off.
    async chooseAuthor(who) {
      if (!WHO.test(who) || !catalog) return;
      const ids = catalog.tweaks.filter(id => id.startsWith(who + '/') && !globalIds().includes(id)); if (!ids.length) return;
      const own = recipe(), on = !ids.every(id => enabled(id, own));
      for (const id of ids) await setOne(id, on);
      return apply();
    },
    // Select all: every tweak shown in Settings on (one per replacement group); tapped again when all are on = all off.
    async setAll(on) {
      const shown = experience.state.tweaks.filter(t => !t.builtin); if (!shown.length) return;
      if (typeof on !== 'boolean') on = !shown.every(t => t.on);
      for (const t of shown) {
        if (on) { for (const m of groupOf(t.id) || [t.id]) if (m === t.id || explicitOff(m)) await setOne(m, true); }
        else await setOne(t.id, false);
      }
      return apply();
    },
    async toggle(id) {
      const item = experience.state.tweaks.find(t => t.id === id); if (!item) return;
      // A oneOf group is one switch: off = this member off (that turns the group off); on = clear every member's off.
      if (item.on) await setOne(id, false);
      else for (const m of groupOf(id) || [id]) if (m === id || explicitOff(m)) await setOne(m, true);
      return apply();
    },
  };
  window.WosExperience = experience;
  window.addEventListener('wos:skin-host-ready', apply);
  window.addEventListener('wos:skin', () => { void experience.chooseSkin(); });
  if (window.WosSkinHost?.personalState.ready) void apply();
  // Pick up the author's newly published tweaks on reopen, keeping the owner's offs by id.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && owner && !busy) void apply(); });
})();
