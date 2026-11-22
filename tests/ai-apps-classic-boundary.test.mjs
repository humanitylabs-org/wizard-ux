import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';
import { fixture } from './fixtures/tweaks.mjs';
import { El, world, layout } from './fixtures/ai-apps-world.mjs';
const settle = () => new Promise(r => setTimeout(r, 15));
const dir = new URL('../web/layouts/ai-apps/', import.meta.url);
const allowed = JSON.parse(withShellParts(withWebParts(readFileSync(new URL('./fixtures/ai-apps-classic-selectors.json', import.meta.url), 'utf8'))));
// Count literal selector sites, including interpolated templates and selectors
// passed through helpers. Exact multiplicity prevents new uses of an old selector.
// The allowlist is empty: desktop placement containers come from WizDesktop.host.placements()
// and phone Chats parts from api.phone.chats(). Do not add entries to fix a failing guard.
function classicLiterals(source) {
  const out = [];
  for (const line of source.split('\n')) {
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      if (/(?:^|[\s>+~,])\.(?:win|wsp|wbar|wtools|dchats|desk)\b|#(?:stage|dsettings)\b|^dsettings$/.test(m[2])) out.push(m[2]);
    }
  }
  return out;
}
// static-rule: an inventory over every AI apps module: none may reach Classic shell markup (the allowlist only shrinks)
test('AI apps has no Classic-only selectors (the migration allowlist is empty)', () => {
  const actual = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
    const found = classicLiterals(withShellParts(withWebParts(readFileSync(new URL(file, dir), 'utf8'))));
    if (found.length) actual[file] = found;
  }
  assert.deepEqual(actual, allowed, 'Remove migrated entries; do not expand the allowlist.');
});
test('boundary guard detects helper scopes, template selectors and repeated dependencies', () => {
  assert.deepEqual(classicLiterals("scope('.win iframe'); root.querySelector(`.wsp[data-desk=\"${id}\"]`); q('.win iframe')"), ['.win iframe', '.wsp[data-desk="${id}"]', '.win iframe']);
  assert.deepEqual(classicLiterals('const k = `desk:${d.desk}`; q(".aad-pane");'), []);
});
test('phone Chats parts reach the layout as shared WizChatsHost surfaces through the skin host', async () => {
  // the phone shell: one shared surface per Chats window (app-agentorb.js chatsSurfaces)
  const app = withShellParts(withWebParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')));
  const W = { a: { app: 'chats' }, b: { app: 'mail' }, c: { app: 'chats' }, d: { app: 'chats' } };
  const surfaces = runRecording(`this.fn = ${between(app, 'chatsSurfaces: ', ',\n').replace(/^chatsSurfaces: /, '')};`, { W, appVars: { W }, CHATS: { surface: id => (id === 'd' ? null : { id }) } }).fn;
  assert.deepEqual(JSON.parse(JSON.stringify(surfaces())), [{ id: 'a' }, { id: 'c' }], 'Chats windows only, each through CHATS.surface');
  // the skin host hands them to the layout as api.phone.chats(), frozen
  const f = fixture({ shell: 'desktop' }); let api = null;   // (the layout API is the same object on both shells)
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  const one = { composer: null, notification: null };
  f.adapter.chatsSurfaces = () => [one, null];
  f.host.setStandardLayout('ai-apps'); await settle();
  assert.ok(api, 'a layout API'); const got = api.phone.chats();
  assert.equal(got.length, 1); assert.equal(got[0], one, 'the shell\'s own surfaces'); assert.ok(Object.isFrozen(got));
  f.adapter.chatsSurfaces = () => 'nope'; assert.equal(api.phone.chats().length, 0, 'anything else: none');
  // the phone layout places a shown notification's route through the shared WizChatsHost
  const w = world({ route: { home: false, view: 'thread', thread: '__new__', desk: 1, app: 'chats' } });
  const pw = new El('div'); pw.className = 'win app-chats'; const pt = new El('div'); pt.className = 'ch-thread ch-notif-thread'; pw.append(pt); w.device.append(pw);
  const placed = [], real = globalThis.WizChatsHost; globalThis.WizChatsHost = { ...real, placeNotificationRoute: n => placed.push(n) };
  try { (await layout()).default(w.api); w.emit('render'); } finally { globalThis.WizChatsHost = real; }
  assert.ok(placed.length > 0 && placed.at(-1) === pt, 'the notification on screen, from api.phone.chats()');
});
