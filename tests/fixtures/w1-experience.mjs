// The real Settings › Look switch list (web/core/experience.js) on a fresh device (wizard-ux issue 1674: tests run the
// code that lists a switch, not its manifest text). It reads the shipped catalog and manifests from web/ through a
// fake fetch; WosSkinHost only records which tweaks it was told to load. installed() is what the shell lists (every
// catalog tweak with its manifest: name, author, issues...), state.tweaks what Settings › Look offers, active() what runs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

// mix: the device's own switches; preset: an author's published set the device wears (tweaks/<who>/profile.json).
export function freshDevice({ channel = 'latest', mix = null, preset = null, shell = 'phone' } = {}) {
  const storage = new Map([['wos.skin', 'obsidian']]);
  if (mix || preset) storage.set('wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: preset || 'none', mix: mix || {}, machinesHomeMoved: true, miguelLayoutMoved: true }));
  if (channel) storage.set('wos.channel.v1', channel);
  const listeners = {}; let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = [...ids]; }, setStandardLayout() {}, layouts: [] },
    addEventListener: (k, f) => { (listeners[k] ||= []).push(f); }, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, clearTimeout, Event, CustomEvent: class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } }, URL, AbortSignal,
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {}, documentElement: { dataset: { shell } } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + new URL(url).pathname.split('/wizard-os-home/')[1])) }) });
  const E = window.WosExperience;
  return {
    E, storage, active: () => [...active],
    // the shell's listing of one switch (its manifest as installed() returns it) and its Look row after a refresh
    async listing(id) { const m = (await E.installed()).find(x => x.id === id) || null; await E.refresh(); const row = E.state.tweaks.find(t => t.id === id) || null; return { manifest: m ? JSON.parse(JSON.stringify(m)) : null, row: row ? JSON.parse(JSON.stringify(row)) : null, running: active.includes(id) }; },
  };
}
