'use strict';
// Side button opens the Agent chat (wizard-ux issue 1528, switch wizard/assist-agent-note) in a real browser: the phone
// shell (412x915) with a stand-in Android bridge (window.WizardOSNative records what the shell copies to the app), and
// the REAL Messenger page (QA_MESSENGER=<wizard-messenger checkout>/static) at /messenger/ on a synthetic API that keeps
// Agent chat notes the way agent_chat.py does. Nothing reads or writes a real box.
//   QA_SWITCH=on (default): the shell tells the app the switch is on; the press (MainActivity's {action:'agent-note'}
//     handoff) opens Messenger at its Agent chat with the text field and the mic ready, still open 2 s later with no
//     Back taken; a typed note is saved there, gets a ✓ once the agent picks it up, gets no reply, and no Wizard chat is
//     created; Back then steps inside Messenger; pressed twice with Messenger already open: one window, Agent chat.
//     Without Messenger the press says where the Agent chat is and listens as before.
//   QA_W / QA_H: viewport (default 412x915); QA_MOBILE=0: no touch.
//   QA_SWITCH=off: the shell tells the app the switch is off (so the button keeps the orb); nothing opens Messenger.
//   QA_EXPECT=broken (QA_WEB=<main worktree>/web): main has no agent-note handoff (it answers false).
// Screens in QA_OUT: <switch>-*.png.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://assist-agent-note.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'assist-agent-note-evidence');
const mstatic = process.env.QA_MESSENGER; if (!mstatic || !fs.existsSync(path.join(mstatic, 'unified.js'))) throw new Error('QA_MESSENGER=<wizard-messenger>/static is needed');
const SWITCH = process.env.QA_SWITCH || 'on', EXPECT = process.env.QA_EXPECT || 'fixed', ID = 'wizard/assist-agent-note';
fs.mkdirSync(out, { recursive: true });
const MESSENGER = { id: 'messenger', name: 'Messenger', url: '/messenger/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
const nap = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now();

function agentBox() {
  const box = { seq: 0, read_at: 0, reports_read_at: 0, entries: [] };
  const state = () => ({ entries: box.entries, unread: 0, urgent: false, reports_unread: 0, sweep_open: false, read_at: box.read_at,
    agent: { woken: true, checked: box.entries.some(e => e.seen) } });
  return { box, state,
    owner(p, body) {
      if (p === '' && body) box.entries.push({ id: 'n' + ++box.seq, kind: 'note', by: 'owner', text: body.text, at: Date.now() + box.seq, seen: null });
      if (p === '/read') box.read_at = Math.max(0, ...box.entries.map(e => e.at));
      return state();
    },
    ack(text) { const e = box.entries.find(x => x.text === text); e.seen = { at: Date.now(), by: 'Oscar' }; } };
}

async function run(browser, { label, on, apps }) {
  const entry = { label, errors: [], wizardWrites: [], native: [] };
  const box = agentBox();
  const context = await browser.newContext({ viewport: { width: +(process.env.QA_W || 412), height: +(process.env.QA_H || 915) }, isMobile: process.env.QA_MOBILE !== '0', hasTouch: process.env.QA_MOBILE !== '0', serviceWorkers: 'block', colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
  try {
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(() => { if (window === top) return; const log = (top.__frameEvents ||= []); for (const ev of ['popstate', 'hashchange']) addEventListener(ev, () => log.push(ev + ' ' + location.pathname + location.hash), true); });
    await context.addInitScript(({ on, apps }) => {
      if (window !== top) return;
      window.__native = [];
      window.WizardOSNative = { assistNoteSwitch: v => window.__native.push(v) };
      localStorage.setItem('wux.apps.v1', JSON.stringify(apps));
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wos.channel.v1': 'latest',
        'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: on ? { 'wizard/assist-agent-note': true } : {} }) })) localStorage.setItem(k, v);
    }, { on, apps });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
      if (u.origin !== origin) return r.abort();
      if (p.startsWith('/messenger/')) {
        const sub = p.slice('/messenger/'.length);
        const ok = result => r.fulfill({ json: { ok: true, result } });
        if (sub === 'api/view/session') return ok({ authenticated: true, csrf_token: 'fixture' });
        if (sub === 'api/view/switches') return r.fulfill({ json: { contract: 'wizard.app-switches/1', switches: [] } });
        if (sub === 'api/status') return ok({ state: 'ready', account_configured: true });
        if (sub === 'api/identity') return ok({ identity: { account_id: '11'.repeat(32), npub: 'npub1qa', display_name: 'Owner' } });
        if (sub.startsWith('api/unified/agent-chat')) {
          const body = method === 'POST' ? JSON.parse(q.postData() || '{}') : null;
          return ok(method === 'POST' ? box.owner(sub.slice('api/unified/agent-chat'.length), body) : box.state());
        }
        if (sub === 'api/unified/people') return ok({ people: [], seq: 5 });
        if (sub === 'api/unified/groups') return ok({ groups: [], seq: 5 });
        if (sub.startsWith('api/unified/updates')) { await nap(20000).catch(() => {}); return ok({ seq: 5 }).catch(() => {}); }
        if (sub.startsWith('api/')) return ok({});
        const file = path.join(mstatic, sub || 'index.html');
        if (!file.startsWith(path.resolve(mstatic)) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
        return r.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      }
      if (!['GET', 'HEAD'].includes(method)) {
        if (/^\/wizard\/hermes\/(api\/sessions|v1\/runs)/.test(p)) { entry.wizardWrites.push(method + ' ' + p); return r.fulfill({ status: 405, json: {} }); }
        if (p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
        if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
      }
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p.startsWith(prefix)) {
        const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
        return r.fulfill({ status: 404, body: 'No synthetic static asset' });
      }
      if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: { agent: { name: 'Wizard QA' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } } });
      if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps } });
      if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
    await page.goto(origin + prefix + 'index.html?phone');
    await page.waitForFunction(() => window.__wos && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
    await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
    await nap(5600); // the shell's switch settle (an off is copied to the app only then)
    entry.switchOn = await page.evaluate(id => (document.documentElement.dataset.tweaks || '').split(' ').includes(id), ID);
    entry.native = await page.evaluate(() => window.__native);
    const frame = () => page.frames().find(f => f.url().startsWith(origin + '/messenger/'));
    if (EXPECT === 'broken') {
      entry.handoff = await page.evaluate(() => window.__wosHandoff({ action: 'agent-note' }));
      await nap(1500);
      entry.messengerOpened = !!frame();
      await page.screenshot({ path: path.join(out, label + '-main.png') });
      return entry;
    }
    assert.equal(entry.switchOn, on, 'switch state as asked');
    assert.equal(entry.native.at(-1), on, 'the Android app ends up with the switch as it is: ' + JSON.stringify(entry.native));
    if (!on) {
      // Off: the Android app keeps today's orb and never sends agent-note. The shell's own listening (today's press
      // when Wizard is in front) for the Before picture.
      entry.listen = await page.evaluate(() => window.__wosHandoff({ action: 'listen' }));
      await nap(1200);
      entry.voice = await page.evaluate(() => window.__wos.voice);
      entry.messengerOpened = !!frame();
      assert.equal(entry.messengerOpened, false);
      await page.screenshot({ path: path.join(out, label + '-press.png') });
      await page.evaluate(() => window.__wos.cancelVoice?.(true));
      return entry;
    }
    entry.handoff = await page.evaluate(() => window.__wosHandoff({ action: 'agent-note' }));
    assert.equal(entry.handoff, true);
    if (!apps.some(a => a.id === 'messenger')) {
      await page.locator('.toast, #toast').filter({ hasText: 'Messenger' }).first().waitFor({ timeout: 8000 }).catch(() => {});
      entry.toast = await page.evaluate(() => document.body.innerText.match(/[^\n]*Agent chat is in Messenger[^\n]*/)?.[0] || '');
      entry.voice = await page.evaluate(() => window.__wos.voice);
      await page.screenshot({ path: path.join(out, label + '-press.png') });
      assert.match(entry.toast, /Messenger/, 'says where the Agent chat is');
      assert.notEqual(entry.voice, 'idle', 'and listens as before');
      await page.evaluate(() => window.__wos.cancelVoice?.(true));
      return entry;
    }
    // On, with Messenger: its Agent chat, text field and mic ready, and it stays open (a stray Back-like pop while a
    // window opened at a link loads closed it on some machines: the tester's first receipt).
    const agentOpen = async (stage) => {
      await page.waitForFunction(o => [...document.querySelectorAll('iframe')].some(f => (f.contentWindow?.location.href || '').startsWith(o + '/messenger/')), origin, { timeout: 15000 });
      const m = frame();
      await m.locator('#unified-inbox .u-thread-head.u-agent-head').waitFor({ timeout: 20000 });
      await nap(2000);
      const still = frame(); assert.ok(still, stage + ': Messenger is still open 2 s later');
      assert.equal(await still.locator('#unified-inbox .u-thread-head.u-agent-head').count(), 1, stage + ': still on the Agent chat');
      const back = await page.evaluate(() => window.__backLog || []);
      assert.ok(!back.some(b => /review-close|^home$|native:/.test(b)), stage + ': no Back was taken: ' + JSON.stringify(back));
      return still;
    };
    const m = await agentOpen('cold');
    entry.frameHash = await m.evaluate(() => location.hash);
    entry.head = (await m.locator('#unified-inbox .u-thread-head').innerText()).replace(/\s+/g, ' ');
    entry.field = await m.locator('.u-ac-field').isVisible();
    entry.mic = await m.getByRole('button', { name: 'Record a voice note' }).isVisible();
    await page.screenshot({ path: path.join(out, label + '-press.png') });
    assert.ok(entry.field, 'a text note can be typed at once');
    assert.ok(entry.mic, 'a voice note is one tap away');
    await m.locator('.u-ac-field').fill('Add dentist Tuesday 10:00 to my calendar');
    await m.getByRole('button', { name: 'Save note' }).click();
    const note = m.locator('.u-row.outgoing', { hasText: 'Add dentist Tuesday' });
    await note.waitFor({ timeout: 5000 });
    box.ack('Add dentist Tuesday 10:00 to my calendar');
    await note.locator('.u-reactions .u-ac-tick').waitFor({ timeout: 12000 });
    entry.tick = true;
    entry.replies = await m.locator('.u-row.incoming').count();
    entry.notes = box.box.entries.map(e => e.text);
    await page.screenshot({ path: path.join(out, label + '-noted.png') });
    assert.equal(entry.replies, 0, 'the note gets no reply');
    assert.deepEqual(entry.notes, ['Add dentist Tuesday 10:00 to my calendar'], 'the note is kept by Messenger');
    assert.deepEqual(entry.wizardWrites, [], 'no Wizard chat is created');
    // Back from the Agent chat is Messenger's own step (to its chat list), never a closed window; the next Back is
    // the shell's again (the marker for the link's own pop is gone).
    entry.back1 = await page.evaluate(() => window.__wosNativeBack());
    await nap(600);
    entry.afterBack1 = { open: !!frame(), list: frame() ? await frame().locator('.u-agent-row[data-mode="chat"]').count() : 0 };
    assert.equal(entry.back1, 'hosted', 'Back steps inside Messenger');
    assert.ok(entry.afterBack1.open && entry.afterBack1.list === 1, 'Messenger shows its chat list');
    // Warm: Messenger already open on its list, pressed twice in a row.
    await page.evaluate(() => { window.__backLog = []; window.__wosHandoff({ action: 'agent-note' }); window.__wosHandoff({ action: 'agent-note' }); });
    await agentOpen('warm, twice');
    entry.frameEvents = await page.evaluate(() => window.__frameEvents || []);
    entry.windows = await page.evaluate(() => Object.values(window.__wos.wins).filter(w => w.appId === 'messenger').length);
    assert.equal(entry.windows, 1, 'one Messenger window');
    return entry;
  } finally {
    entry.errors = entry.errors.filter(e => !/ResizeObserver/.test(e));
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  const report = { web, switch: SWITCH, expect: EXPECT, cases: [] };
  try {
    const on = SWITCH === 'on';
    report.cases.push(await run(browser, { label: SWITCH + (EXPECT === 'broken' ? '-main' : ''), on, apps: [MESSENGER] }));
    if (on && EXPECT !== 'broken') report.cases.push(await run(browser, { label: 'on-no-messenger', on, apps: [] }));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, `report-${SWITCH}${EXPECT === 'broken' ? '-main' : ''}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(e => { console.error(e); process.exit(1); });
