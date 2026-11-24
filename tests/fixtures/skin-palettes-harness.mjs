// Small runners for the skin/palette tests (wizard-ux issue 1674): the real core/skins.js, Settings and
// experience.js in node:vm with plain stubs. No DOM, no browser.
import fs from 'node:fs';
import vm from 'node:vm';
import { withSettingsParts } from './settings-parts.mjs';

const root = new URL('../../', import.meta.url);
export const read = path => fs.readFileSync(new URL(path, root), 'utf8');

// core/skins.js with a fake <html> and localStorage. `source` may add a test-only entry to the real table.
export function skinsRuntime(saved = {}, source = read('web/core/skins.js')) {
  const store = new Map(Object.entries(saved)), props = new Map(), events = [];
  const documentElement = { dataset: { shell: 'desktop' }, style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) } };
  const context = vm.createContext({
    console, Math, performance: { now: () => 0 }, setTimeout() {}, addEventListener() {},
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, documentElement },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    dispatchEvent: e => events.push(e), CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
  });
  vm.runInContext('window = this', context);
  vm.runInContext(source, context);
  return { S: context.WosSkin, store, documentElement, events };
}

// The real Settings renderer mounted on a fake root, with the WosSkin/WosExperience/WosMySkin the caller gives.
export function settingsView({ shell = 'phone', WosSkin, WosExperience, WosMySkin, page = 'look', document = { activeElement: null }, timer = setTimeout } = {}) {
  const s = { console, URL, setTimeout: timer, CSS: { escape: String }, navigator: { userAgent: 'Desktop' }, document,
    location: { host: 'example.test' }, WizCore: {}, WosSkin, WosExperience, WosMySkin };
  s.window = s;
  vm.runInNewContext(withSettingsParts(read('web/core/settings.js')), s);
  const rootEl = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(rootEl, { shell, live: { ok: true } });
  view.focus(page);
  const act = (feature, attr, value) => view.dispatch({ closest: sel => sel === '[data-settings-feature]' ? { dataset: { settingsFeature: feature } }
    : sel === `[${attr}]` ? { dataset: { [attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : null });
  return { s, root: rootEl, view, act, html: () => rootEl.innerHTML };
}

// The real experience.js over the real tweak catalog and manifests (served from web/), with a fake skin host.
export function experienceRuntime({ mySkin = null } = {}) {
  const storage = new Map(); let active = [];
  const w = { WosSkinHost: { layout: 'classic', personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = Array.from(ids); } },
    WosMySkin: mySkin, WosSkin: { current: 'nebula', familyOf: () => 'wizard' }, addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), {
    window: w, Event, URL, AbortSignal, setTimeout() {},
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }),
  });
  return { E: w.WosExperience, w, storage, active: () => active };
}
