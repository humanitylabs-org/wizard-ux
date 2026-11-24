// The real core/experience.js (Settings › Look's switch list) in a vm on the real web/tweaks catalog: which switches a
// device lists, which are on by default, which a profile (quick button) turns on, and what it loads.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

export async function lookBox({ channel = 'latest', saved = null, skin = 'nebula', shell = 'phone' } = {}) {
  const storage = new Map([['wos.skin', skin]]);
  if (saved) storage.set('wos.skin-tweaks.v1', JSON.stringify(saved));
  if (channel) storage.set('wos.channel.v1', channel);
  let active = [];
  const window = { WosSkin: { current: skin, families: [], familyOf: () => 'wizard' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = [...ids]; }, setStandardLayout() {}, layouts: [] },
    addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, clearTimeout, Event, URL, AbortSignal,
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {}, documentElement: { dataset: { shell } } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + new URL(url).pathname.split('/wizard-os-home/')[1])) }) });
  const E = window.WosExperience; await E.refresh();
  return { E, storage, active: () => [...active], row: id => { const t = E.state.tweaks.find(x => x.id === id); return t ? JSON.parse(JSON.stringify(t)) : null; } };
}
