// The real core/settings.js (its parts put back in place) in a vm, mounted into a mini-dom root, for tests that
// check what Settings shows: the page list, a page's rows, the System pages a package fills.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withSettingsParts } from './settings-parts.mjs';
import { createDocument } from './mini-dom.mjs';

let src;
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

export function settingsWorld({ shell = 'phone', adapter = {}, scope = {} } = {}) {
  const doc = createDocument();
  const proto = Object.getPrototypeOf(doc.body);
  if (!('attributes' in proto)) Object.defineProperty(proto, 'attributes', { get() { return [...this.attrs].map(([name, value]) => ({ name, value })); } });
  const s = { console, Map, Set, Date, String, URL, CSS: { escape: String }, setTimeout, clearTimeout, document: doc, navigator: { userAgent: 'Desktop' },
    location: { host: 'box.test', href: 'https://box.test/wizard-os-home/index.html', origin: 'https://box.test' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval: () => 0, clearInterval() {}, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), ...scope };
  s.window = s; s.addEventListener = () => {}; s.removeEventListener = () => {};
  s.WizCore = { refreshApps: async () => {}, ...(scope.WizCore || {}) };
  s.WizChatsHost = s.WizChatsHost || { defaultId: () => 'wizard-chats', installed: () => [] };
  vm.runInNewContext((src ??= withSettingsParts(read('web/core/settings.js'))), s);
  const root = doc.createElement('div'); doc.body.append(root);
  const view = s.WosSettings.mount(root, { shell, live: { ok: true, onChange: () => () => {} }, helpSub: 'Help', ...adapter });
  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    s, W: s.WosSettings, doc, root, view, text,
    pages: () => root.querySelectorAll('[data-st-page]').map(b => b.dataset.stPage),
    groups: () => root.querySelectorAll('.st-navgroup').map(text),
    open(page) { const b = root.querySelector(`[data-st-page="${page}"]`); if (!b) throw new Error('no page ' + page); b.click(); return root; },
  };
}
