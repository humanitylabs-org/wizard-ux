import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

// ux#1477 / ux#1540 (Jan): hovering a message time shows the full date and time in the owner's zone
// (WizConfig.timeZone, #635), but the label after it always said "Bangkok". An owner in Ljubljana saw their own
// local time labelled Bangkok. The full stamp now names the zone it is formatted in.
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let zone = 'Europe/Ljubljana';
const ctx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {}, WizConfig: { timeZone: () => zone, agent: () => 'Fixture' } };
ctx.window = ctx; modelContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx);
const KIT = ctx.WosChat;
const AT = Date.parse('2026-11-16T11:36:00Z');
const ZONES = [['Europe/Ljubljana', '12:36 Ljubljana'], ['America/New_York', '06:36 New York'], ['UTC', '11:36 UTC'],
  ['America/Argentina/Buenos_Aires', '08:36 Buenos Aires'], ['Asia/Bangkok', '18:36 Bangkok']];

test('the full message time names the owner zone, never a fixed Bangkok', () => {
  for (const [z, end] of ZONES) {
    zone = z;
    const full = KIT.time.full(AT);
    assert.ok(full.endsWith(end), `${z}: ${full}`);
    if (z !== 'Asia/Bangkok') assert.doesNotMatch(full, /Bangkok/, z);
  }
  zone = 'Europe/Ljubljana';
  assert.match(KIT.time.full(AT), /^Monday,? 16 November 2026,? (at )?12:36 Ljubljana$/);
  assert.equal(KIT.time.full(NaN), '');
});

// Agent chat parity (AGENTS.md; wizard-agent-service qa/agent-parity/features.json "message-time-zone"): the same
// history in a main thread and in host-profile, container and restricted routed threads shows the same time tooltip,
// named after the owner's zone, for every non-Bangkok zone above.
const ROUTES = { main: ['wizard_1793157258294_34b4a71ae61a', ''], 'host-profile': ['20261028_101500_ab12cd', 'qa-host-profile'],
  container: ['agent-research:20261028_101501_ef34', 'agent-research'], restricted: ['restricted.vault_20261028-101502', 'restricted.vault'] };
const chats = withParts(read('web/core/chats.js'));
const line = start => { const a = chats.indexOf(start); assert.ok(a >= 0, start); return chats.slice(a, chats.indexOf('\n', a) + 1); };
const slice = (start, end) => { const a = chats.indexOf(start), b = chats.indexOf(end, a); assert.ok(a >= 0 && b > a, `${start} .. ${end}`); return chats.slice(a, b); };
function turnHtml(tn) {
  const c = { getComputedStyle: () => ({ getPropertyValue: () => '' }), document: { documentElement: {} }, window: { WizConfig: { agent: () => 'Fixture' } },
    KIT, esc: KIT.esc, md: KIT.md, PW: null, replyCard: () => '', msgIds: () => '', quoteBtn: () => '',
    userMedia: () => '', mediaBlock: () => '', clip: s => s, CHECK_SVG: '', COPY_SVG: '', SHARE_SVG: '', noteHtml: () => '', runContextHtml: () => '' };
  modelContext(c);
  vm.runInContext(`${['  const regenOn = ', '  const summaryOn = ', '  const SUMMARY_WORDS = ', '  const summaryOf = ', '  const summaryStartsOpen = ', '  const leadText = ', '  const COG_SVG = ', '  const CHEV_SVG = ', '  const timeTag = '].map(line).join('')}${slice('  function turnHtml(', '  const turnAt = ')}this.turnHtml = turnHtml;`, c);
  return c.turnHtml({ texts: [] }, tn, true, false, null, null);
}
const titles = html => [...html.matchAll(/<time title="([^"]*)">/g)].map(m => m[1]);

test('parity: main and routed threads (host-profile, container, restricted) name the owner zone on every message time', () => {
  for (const [z, end] of ZONES) {
    zone = z;
    const seen = new Map();
    for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
      // Each route keeps the time shape its runtime sends: Hermes rows carry seconds, a container agent's
      // history an ISO created_at, a restricted route milliseconds. All must land on the same owner-zone label.
      const when = { main: { timestamp: AT / 1000 }, 'host-profile': { timestamp: AT / 1000 },
        container: { created_at: new Date(AT).toISOString() }, restricted: { timestamp: AT } }[kind];
      const history = [{ role: 'user', ...when, content: 'What time is it?' }, { role: 'assistant', ...when, content: 'Lunch time.' }]
        .map(r => ({ ...r, session_id: sid, ...(agent ? { agent } : {}) }));
      const html = turnHtml(KIT.parseRows(history).at(-1));
      const t = titles(html);
      assert.equal(t.length, 2, `${kind} ${z}: your message and the reply both carry a time`);
      for (const title of t) {
        assert.ok(title.endsWith(end), `${kind} ${z}: ${title}`);
        if (z !== 'Asia/Bangkok') assert.doesNotMatch(title, /Bangkok/, `${kind} ${z}`);
      }
      seen.set(kind, html);
    }
    assert.equal(new Set(seen.values()).size, 1, `${z}: byte-identical turn for every runtime kind`);
  }
});
