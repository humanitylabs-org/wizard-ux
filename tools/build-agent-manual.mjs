#!/usr/bin/env node
/* The agent's Wizard interface manual: skill/SKILL.md, generated from the interface code and skill/help.json.
 *
 *   node tools/build-agent-manual.mjs           write skill/SKILL.md
 *   node tools/build-agent-manual.mjs --check   exit 1 when skill/SKILL.md is stale or a help line is missing
 *
 * What it reads (no new dependencies, nothing from the network):
 *   - Settings: web/core/settings.js and every module that registers on it, run in a node vm with fixed fixture
 *     answers (owner, For testers channel, an Android phone and a desktop), so the pages, groups and rows are the
 *     ones the real Settings code draws, not a copy.
 *   - Feature switches: web/tweaks/catalog.json + each web/tweaks/<author>/<id>/manifest.json (name, description).
 *   - Screens: the ?view= names in web/core/deeplink.js, the Chats sections, the desktop layouts in web/layouts/.
 *   - Help lines: skill/help.json (hand-written, owner-facing). The App Manager copies skill/SKILL.md (wizard.md
 *     `skill:`) into the agent's skills, so the agent can say where things are and what they do.
 * tests/agent-manual.test.mjs fails when something on screen has no help line, or SKILL.md is not regenerated. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HELP_FILE = 'skill/help.json';
export const SKILL_FILE = 'skill/SKILL.md';
export const SIZE_BUDGET = 30000;
export const REGENERATE = 'node tools/build-agent-manual.mjs';

/* Every file that registers a Settings section. A new WosSettings.register in a file not listed here (or in
 * NOT_RENDERED with a reason) fails tests/agent-manual.test.mjs, so a new section can't stay out of the manual. */
export const SETTINGS_MODULES = ['core/settings.js', 'core/os-updates.js', 'core/box-source.js', 'core/disk-status.js',
  'core/downloads.js', 'core/incognito-chat.js', 'core/own-views.js', 'core/schedules.js', 'core/workspace-sync.js',
  'core/workspaces.js'];
// Modules that draw the words of a section another module registers (Voice & typing, Unsent & recovered).
export const CONTENT_MODULES = ['core/voice-status.js', 'core/mic.js', 'core/sel-menu.js', 'core/cancelled.js'];
// Files that register Settings sections the fixture does not draw, with why. (A tweak's own options under web/tweaks/
// are documented with its feature switch.)
export const NOT_RENDERED = {
  'core/skin-host.js': 'the options a switched-on tweak or desktop view adds for itself; documented with that switch or view',
};

const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
// Plain text of a rendered fragment. Tags are removed until none are left (a stripped tag can't leave a new one
// behind), then each entity is decoded once in a single pass, so '&amp;lt;' reads '&lt;', never '<'.
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = s => {
  let text = String(s), prev;
  do { prev = text; text = text.replace(/<[^<>]*>/g, ''); } while (text !== prev);
  return text.replace(/[<>]/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, e => ENTITIES[e]).replace(/\s+/g, ' ').trim();
};
// Version numbers and counts come from the fixture, not the interface: one key whatever the box runs.
export const normalize = s => decode(s).replace(/\b\d+(?:\.\d+)+(?:[-.][\w.]+)?\b/g, '{version}').replace(/\b\d+\b/g, '{n}');

function tweaks(root) {
  const catalog = JSON.parse(read(root, 'web/tweaks/catalog.json'));
  const manifests = catalog.tweaks.map(id => ({ id, ...JSON.parse(read(root, `web/tweaks/${id}/manifest.json`)) }));
  return { catalog, manifests };
}

/* One fixture Wizard: everything a page needs to be shown answers, the way an owner's box on For testers would. */
async function renderSettings(root, { shell, android }) {
  const { catalog, manifests } = tweaks(root);
  const store = new Map();
  const fixtures = {
    '/store-install/_updates': { mode: 'auto', chosen: true, installed: '0.3.15', latest: '0.3.15', checked: true, update_available: false, channel: 'latest' },
    '/store-install/_disk': { line: 'Disk encrypted', level: 'ok' },
    '/store-install/_connections/': {},
    '/wizard/v1/schedules': { schedules: [] },
    '/store-install/_app-updates': { app_mode: 'auto', apps: [] },
    '/store-data/api/apps/installed': [],
    '/wizard/voice/status': { ready: true, name: 'Your speech-to-text service', provider: 'fixture', model: '', attested: false },
  };
  const fetch = async (url, opts = {}) => {
    const p = new URL(String(url), 'https://fixture.invalid/wizard-os-home/').pathname.replace(/^\/wizard-os-home/, '');
    const hit = Object.keys(fixtures).find(k => p === k || p.endsWith(k));
    if (!hit || (opts.method && opts.method !== 'GET')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => fixtures[hit], text: async () => JSON.stringify(fixtures[hit]) };
  };
  const node = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, setAttribute() {}, append() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], remove() {} });
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} }, URL, Map, Set, Date, String, JSON, Math, Promise, Error, Object, Array, Number, Boolean, RegExp, Symbol,
    CSS: { escape: String }, setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: f => setTimeout(f, 0), queueMicrotask, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    AbortSignal: { timeout: () => undefined }, MutationObserver: class { observe() {} disconnect() {} },
    navigator: { userAgent: android ? 'Mozilla/5.0 (Linux; Android 14) WizardOS' : 'Mozilla/5.0 (Macintosh)', platform: android ? 'Linux' : 'MacIntel', onLine: true },
    location: { host: 'wizard.invalid', href: 'https://wizard.invalid/wizard-os-home/', origin: 'https://wizard.invalid' },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    fetch, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  s.window = s; s.globalThis = s; s.self = s;
  s.document = { activeElement: null, baseURI: 'https://wizard.invalid/wizard-os-home/', visibilityState: 'visible', documentElement: { dataset: { shell }, lang: 'en' },
    body: null, currentScript: { src: 'https://wizard.invalid/wizard-os-home/core/x.js' }, querySelector: () => null, querySelectorAll: () => [], createElement: node, addEventListener() {}, removeEventListener() {} };
  s.WizCore = { voiceStatus: { card: () => '', state: { ready: true } }, refreshApps: async () => {}, bridge: { call: async () => ({}) }, apps: () => ({ list: () => [], on() {} }) };
  s.WizBrand = { html: 'W' }; s.WizConfig = { agent: () => 'Wizard', chatAfterAction: () => 'stay', setChatAfterAction: async () => 'owner' };
  s.WizWebUpdate = { firstObservedVersion: '0'.repeat(40) };
  s.WizChatsHost = { defaultId: () => 'wizard-chats', installed: () => [{ id: 'wizard-chats', name: 'Wizard Chats' }] };
  s.WizChatsListModel = { WORKING_SORTS: [['alphabetical', 'A to Z'], ['newest', 'Newest first']] };
  s.WosBell = { routes: () => [], picker: () => '', describe: () => '', intro: () => null, groups: () => [], chatsAvailable: true };
  s.WosResources = { bars() {}, lowest: () => null };
  // A skin with dark/light twins and pictures, so Mode and Background are drawn too.
  const skins = [{ id: 'nebula', name: 'Dark' }, { id: 'nebula-light', name: 'Light' }, { id: 'landscapes', name: 'Pictures dark' }, { id: 'landscapes-light', name: 'Pictures light' }];
  s.WosSkin = { current: 'nebula', list: skins, families: [{ id: 'wizard', name: 'Wizard', palettes: skins.map(k => k.id) }], familyOf: () => 'wizard', lastIn: () => 'nebula',
    twin: id => skins.find(k => k.id === (id.endsWith('-light') ? id.slice(0, -6) : id + '-light')), setWallpaper() {}, wallpaper: 'plain', wallpapers: [], wallpaperThumb: () => '',
    setGlass() {}, glass: null, skinGlass: 0.8, glassRange: { min: 0.4, max: 1 } };
  s.WosMySkin = { active: null, recipes: [], previews: [], on() {} };
  const view = id => manifests.find(m => m.id === id)?.view || '';
  s.WosExperience = {
    state: { shell, channel: 'latest', busy: false, error: '', locked: false, tweaks: manifests.map(m => ({ id: m.id, name: m.name, description: m.description || '', author: m.id.split('/')[0], builtin: (catalog.defaults || []).includes(m.id), view: view(m.id), layout: m.layout || '', on: false, ...(Array.isArray(m.shells) ? { shells: m.shells } : {}) })) },
    installed: async () => [], defaults: async () => ({}), authors: async () => [], groups: () => [],
    // experience.js desktopViews: Desks (classic) and the built-in AI apps layout, desktop only.
    desktopViews: shell === 'desktop' ? [{ id: 'classic', name: 'Desks' }, { id: 'ai-apps', name: 'AI apps' }] : [], desktopView: 'ai-apps',
  };
  s.WosAgents = { list: [{ id: 'private', privacy: 'private', incognito_available: true }] };
  s.WosMic = { available: () => true, html: () => '', act() {} };
  s.WosSelMenu = { html: () => '' }; s.WosCancelled = { html: () => '', list: () => [] };
  s.WosOrbSwitcher = { available: android, settingsRow: () => '<div class="st-group"><button class="st-row wz-row" data-orbsw-open><span class="st-tx"><b>Orb switcher</b></span></button></div>' };
  if (android) {
    s.WizardOSNative = { platform: () => 'Android', everywhere: () => JSON.stringify({ enabled: true, overlay: true }), setEverywhere() {}, voiceTypingSettings() {}, changeServer() {}, unsent: () => '[]' };
    s.wizardDevicePort = {}; s.wizardDownloadsPort = {};
    s.WizardOSDevice = { micPolicy: () => JSON.stringify({ policy: { mode: 'phone' }, inputs: [] }), setMicPolicy: () => '{}' };
    s.WosDevice = { settingsState: () => ({ installed: '0.10.0', notificationsAllowed: true, updateDescription: 'Up to date' }) };
  }
  s.WizPhoneConnect = { create: () => ({ status: 'ok', on: true, view: { step: 'serving', phones: [] }, refresh() {}, attach() {}, back: () => false }) };
  const ctx = vm.createContext(s);
  const loaded = [], failed = {};
  for (const m of [...CONTENT_MODULES, ...SETTINGS_MODULES]) {
    try { vm.runInContext(read(root, 'web/' + m), ctx, { filename: m }); loaded.push(m); } catch (e) { failed[m] = e.message; }
  }
  for (let i = 0; i < 6; i++) await tick();
  const S = s.WosSettings;
  // System pages that only an installed app fills (nothing in this repo registers there): show them empty.
  for (const p of S.systemPages) if (!S.features.some(f => f.page === p)) S.register({ id: `probe:${p}`, page: p, html: () => '' });
  const el = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, isConnected: true };
  const mounted = S.mount(el, { shell, live: { ok: true, onChange: () => () => {} }, helpSub: 'Gestures, keys and the practice tour', barMics: () => ({ get: () => false, set() {} }), sideReady: () => false });
  for (let i = 0; i < 6; i++) await tick();
  mounted.render(true);
  const pages = [...el.innerHTML.matchAll(/data-st-page="([^"]+)"[^>]*><span class="st-tx"><b>([^<]*)<\/b>/g)].map(m => ({ id: m[1], title: decode(m[2]) }));
  const groupOf = id => S.systemPages.includes(id) ? 'System' : '';
  const out = [];
  for (const p of pages) {
    mounted.focus(p.id); for (let i = 0; i < 3; i++) await tick(); mounted.render(true);
    const body = el.innerHTML.slice(el.innerHTML.indexOf('<header class="st-page-head">'));
    const sections = [...body.matchAll(/<section data-settings-feature="([^"]+)">([\s\S]*?)<\/section>(?=<section data-settings-feature=|<\/div><\/div>|$)/g)]
      .filter(m => !m[1].startsWith('probe:')).map(m => ({ id: m[1], controls: controls(m[2]) }));
    out.push({ ...p, group: groupOf(p.id), sections });
  }
  return { pages: out, features: S.features.filter(f => !f.id.startsWith('probe:')), loaded, failed };
}

/* The words an owner sees as names of things: group headings, row titles, segmented choices, buttons, disclosures. */
export function controls(html) {
  const seen = new Set(), out = [];
  const add = (kind, raw) => { const label = normalize(raw); if (!/[A-Za-z]/.test(label) || label.length > 80 || seen.has(label)) return; seen.add(label); out.push({ kind, label }); };
  for (const m of html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)) add('group', m[1].replace(/<span>[\s\S]*?<\/span>/g, ''));
  for (const m of html.matchAll(/<span class="osu-lbl">([^<]+)<\/span>/g)) add('group', m[1]);
  for (const m of html.matchAll(/class="(?:st-row|tw-row)[^"]*"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?<span class="st-tx[^"]*"><b[^>]*>([\s\S]*?)<\/b>/g)) add('row', m[1]);
  for (const m of html.matchAll(/<button[^>]*role="radio"[^>]*>([^<]+)<\/button>/g)) add('choice', m[1]);
  for (const m of html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)) add('choice', m[1]);
  for (const m of html.matchAll(/<summary[^>]*>([^<]+)<\/summary>/g)) add('more', m[1]);
  for (const m of html.matchAll(/<button(?![^>]*role="radio")[^>]*>([^<]+)<\/button>/g)) add('button', m[1]);
  return out;
}

export function switches(root) {
  const { catalog, manifests } = tweaks(root);
  const builtin = new Set(catalog.defaults || []);
  return manifests.map(m => ({ id: m.id, name: m.name, description: m.description || '', author: m.id.split('/')[0],
    kind: builtin.has(m.id) ? 'setting' : (typeof m.view === 'string' && m.view.trim()) ? 'view' : 'switch', shells: m.shells || null }));
}

export function screens(root) {
  const dl = read(root, 'web/core/deeplink.js');
  const list = (name) => JSON.parse(dl.match(new RegExp(`const ${name} = new Set\\((\\[[^\\]]*\\])\\)`))[1].replace(/'/g, '"'));
  const layouts = fs.readdirSync(path.join(root, 'web/layouts')).filter(d => fs.statSync(path.join(root, 'web/layouts', d)).isDirectory());
  // Chats sections: the ones a link can open, and the ones the Chats list draws (By day has them all).
  const day = [...read(root, 'web/core/chats.js').match(/const SECTIONS_DAY = (\[[^;]*\]);/)[1].matchAll(/\['([a-zA-Z]+)', '/g)].map(m => m[1]);
  const sections = [...new Set([...day, ...list('SECTIONS')])];
  return [...list('VIEWS').map(id => `view:${id}`), ...sections.map(id => `chats:${id}`), ...layouts.map(id => `layout:${id}`)];
}

export async function collect(root = ROOT) {
  const desktop = await renderSettings(root, { shell: 'desktop', android: false });
  const phone = await renderSettings(root, { shell: 'phone', android: true });
  // One page list: desktop's order, then pages only the phone has; sections and controls are the union.
  const pages = [];
  for (const p of [...desktop.pages, ...phone.pages]) {
    let page = pages.find(x => x.id === p.id);
    if (!page) pages.push(page = { id: p.id, title: p.title, group: p.group, sections: [], shells: [] });
    page.shells.push(desktop.pages.includes(p) ? 'desktop' : 'phone');
    for (const sec of p.sections) {
      let mine = page.sections.find(x => x.id === sec.id);
      if (!mine) page.sections.push(mine = { id: sec.id, controls: [] });
      for (const c of sec.controls) if (!mine.controls.some(x => x.label === c.label)) mine.controls.push(c);
    }
  }
  // A feature switch's own row is documented once, with the switch (Feature switches below), not as a Look control.
  const names = new Set(switches(root).map(t => t.name));
  for (const p of pages) for (const s of p.sections) s.controls = s.controls.filter(c => !names.has(c.label));
  const features = new Map();
  for (const f of [...desktop.features, ...phone.features]) features.set(f.id, f);
  return { pages, features: [...features.values()], failed: { ...desktop.failed, ...phone.failed }, switches: switches(root), screens: screens(root) };
}

export function loadHelp(root = ROOT) { return JSON.parse(read(root, HELP_FILE)); }

/* Everything the interface shows that has no help line, as plain sentences naming the key to add. */
export function missing(data, help) {
  const out = [];
  for (const p of data.pages) {
    if (!help.pages?.[p.id]?.help) out.push(`Settings page "${p.title}": add pages.${p.id}.help`);
    for (const s of p.sections) {
      const h = help.sections?.[s.id];
      if (!h?.help) { out.push(`Settings section "${s.id}" on ${p.title}: add sections["${s.id}"].help`); continue; }
      for (const c of s.controls) if (!(c.label in (h.controls || {}))) out.push(`Settings › ${p.title}: ${c.kind} "${c.label}" (section ${s.id}): add sections["${s.id}"].controls["${c.label}"]`);
    }
  }
  for (const f of data.features) if (!help.sections?.[f.id]?.help) out.push(`Settings section "${f.id}" (page ${f.page}, not drawn by the fixture): add sections["${f.id}"].help`);
  for (const t of data.switches) if (!help.switches?.[t.id]?.where) out.push(`Feature switch "${t.name}" (${t.id}): add switches["${t.id}"].where`);
  for (const id of data.screens) if (!help.screens?.[id]?.help) out.push(`Screen ${id}: add screens["${id}"].help`);
  return [...new Set(out)];
}

const stop = t => t && !/[.!?]$/.test(t) ? t + '.' : t;
const line = (...parts) => parts.filter(Boolean).map(stop).join(' ').replace(/\.\.$/, '.');
const where = sc => [sc.desktop && `Desktop: ${sc.desktop}`, sc.phone && `Phone: ${sc.phone}`, sc.when && `(${sc.when})`];
export function render(data, help) {
  const h = help, o = [];
  // JSON string = a valid double-quoted YAML scalar (the description contains ': ').
  o.push('---', 'name: wizard-interface', `description: ${JSON.stringify(h.description)}`, '---', '');
  o.push(...h.intro, '');
  o.push('## Screens', '');
  for (const id of h.screenOrder || data.screens) {
    const sc = h.screens[id]; if (!sc) continue;
    o.push(`- **${sc.name}**: ${line(sc.help, ...where(sc))}`);
  }
  for (const extra of h.extraScreens || []) o.push(`- **${extra.name}**: ${line(extra.help, ...where(extra))}`);
  o.push('', '## Settings', '', ...h.settingsIntro, '');
  for (const p of data.pages) {
    const ph = h.pages[p.id] || {};
    o.push(`### ${p.group ? 'System › ' : ''}${p.title}`, line(ph.help, ph.when && `(${ph.when})`));
    const secs = p.sections.filter(s => !h.sections[s.id]?.hidden);
    for (const s of secs) {
      const sh = h.sections[s.id] || {};
      // A control set to null is named in its section's line already; only the ones with words of their own get a line.
      const rows = s.controls.map(c => [c.label, sh.controls?.[c.label]]).filter(([, t]) => t);
      o.push(`- ${line(sh.help, sh.when && `(${sh.when})`)}`);
      for (const [label, t] of rows) o.push(`  - ${label}: ${t}`);
    }
    // Sections this fixture can't draw (they need a real box or phone) still get their line.
    for (const f of data.features.filter(f => f.page === p.id && !secs.some(s => s.id === f.id) && !h.sections[f.id]?.hidden)) {
      const sh = h.sections[f.id] || {}; o.push(`- ${line(sh.help, sh.when && `(${sh.when})`)}`);
    }
    o.push('');
  }
  o.push('## Feature switches (Settings › Appearance › Try new features)', '', ...h.switchesIntro, '');
  const kinds = { switch: data.switches.filter(t => t.kind === 'switch'), setting: data.switches.filter(t => t.kind !== 'switch') };
  // The path of a tester switch is the section's own (Settings › Appearance › Try new features › <name>): said once.
  const tryPath = t => `Settings › Appearance › Try new features › ${t.name}`;
  for (const t of [...kinds.switch].sort((a, b) => a.name.localeCompare(b.name))) {
    const sh = h.switches[t.id] || {};
    o.push(`- **${t.name}**: ${line(sh.help || t.description, sh.where !== tryPath(t) && `Where: ${sh.where}`, sh.when && `(${sh.when})`)}`);
  }
  o.push('', 'Switches that are ordinary settings or views, not tester switches:');
  for (const t of kinds.setting) { const sh = h.switches[t.id] || {}; o.push(`- **${t.name}**: ${line(sh.help || t.description, `Where: ${sh.where}`, sh.when && `(${sh.when})`)}`); }
  o.push('', '## How do I…', '');
  for (const [q, a] of Object.entries(h.howTo || {})) o.push(`- **${q}** ${a}`);
  return o.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export async function build(root = ROOT) {
  const data = await collect(root), help = loadHelp(root);
  return { data, help, text: render(data, help), missing: missing(data, help) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { data, text, missing: gaps } = await build();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(data, null, 1)); process.exit(0); }
  if (gaps.length) console.error(`Help lines missing in ${HELP_FILE}:\n- ${gaps.join('\n- ')}`);
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(path.join(ROOT, SKILL_FILE)) ? read(ROOT, SKILL_FILE) : '';
    if (now !== text) console.error(`${SKILL_FILE} is out of date: run ${REGENERATE}`);
    process.exit(gaps.length || now !== text ? 1 : 0);
  }
  fs.mkdirSync(path.join(ROOT, path.dirname(SKILL_FILE)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, SKILL_FILE), text);
  console.log(`${SKILL_FILE}: ${Buffer.byteLength(text)} bytes${gaps.length ? `, ${gaps.length} help lines missing` : ''}`);
}
