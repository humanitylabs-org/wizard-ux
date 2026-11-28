'use strict';
// wizard-ux issue 2064 in a real browser: one reply card for Needs you and the summary. With wizard/reply-card on, a long
// needs-you reply opens with one card: the Needs you dot, its full summary (300 characters, wrapped, never cut with …),
// one Mark done, and Show more / Show less that opens and folds the full reply (with its reply buttons) below the card.
// The thread's bottom row has no second Mark done. A done reply's card says Done and has no Mark done; a short needs-you
// reply (no summary) keeps today's Needs you line. Main (Archimedes) and routed (host profile, container, restricted)
// threads. Phone 412x915 and desktop 1440x900 (Classic), Nebula + Grove. Synthetic transport only; writes in memory.
// QA_SWITCH=off runs the same threads with the switch off (today's strip + summary, and no card); QA_OUT=<dir> keeps shots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://reply-card.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'reply-card-evidence');
const ON = process.env.QA_SWITCH !== 'off';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
// The full status ask (300 characters) and the chat list's 140-character clip of it, as the Agent Service serves them.
const ASK = ('The launch plan is ready and the venue holds the 14th for us until Friday noon. Reply book to confirm the venue, '
  + 'or pick another date below, and I will send the invitations to the forty people on the guest list the same afternoon.').slice(0, 300);
const clip140 = s => { const cut = s.slice(0, 139), sp = cut.lastIndexOf(' '); return `${(sp > 84 ? cut.slice(0, sp) : cut).trimEnd()}…`; };
const DONE_ASK = 'The press notes are finished and saved in your Notes app, ready to send to the three editors whenever you like.';
const para = n => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}: the launch needs a date, a venue and a short list of people to invite before we can print anything at all.`).join('\n\n');
const GROUP = `[WIZARD_BUTTONS_V1]${JSON.stringify({ group: 'Venue', buttons: [{ id: 'book', label: 'Book the 14th' }, { id: 'later', label: 'Another date' }] })}[/WIZARD_BUTTONS_V1]`;
const AGENTS = [{ id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
for (const [id, label] of [['host', 'Host ops'], ['container', 'Box'], ['restricted', 'Locked']]) AGENTS.push({ id, label, harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: id[0], hue: 120 }, model: { provider: 'anthropic', model: 'claude-opus-4' } });
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_assistant_at: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: false, preview: s.preview || 'Done.', ...(s.attention ? { wizard_attention: s.attention } : {}) });
const needsRow = (id, title) => ({ id, title, at: now - 390e3, attention: { state: 'needs_you', ask: clip140(ASK) }, preview: clip140(ASK) });
const ROWS = [needsRow('qa-n1', 'Launch plan'),
  { id: 'qa-d1', title: 'Press notes', at: now - 290e3, attention: { state: 'done', ask: DONE_ASK }, preview: DONE_ASK },
  { id: 'qa-s1', title: 'Quick question', at: now - 190e3, attention: { state: 'needs_you', ask: 'Pick a colour' }, preview: 'Pick a colour' }].map(shape);
const ROUTED = { host: [needsRow('qa-h1', 'Host launch')].map(shape), container: [needsRow('qa-k1', 'Box launch')].map(shape), restricted: [needsRow('qa-x1', 'Locked launch')].map(shape) };
const ALL = [...ROWS, ...Object.values(ROUTED).flat()];
const t0 = now / 1000 - 400;
const MSGS = {
  needs: [{ id: 11, role: 'user', content: 'Where are we with the launch?', timestamp: t0 }, { id: 12, role: 'assistant', content: para(8) + '\n\n' + GROUP + '\n\nReply book to confirm.', wizard_ask: ASK, wizard_state: 'needs_you', timestamp: t0 + 10 }],
  done: [{ id: 21, role: 'user', content: 'Write the press notes', timestamp: t0 }, { id: 22, role: 'assistant', content: para(8), wizard_ask: DONE_ASK, wizard_state: 'done', timestamp: t0 + 10 }],
  short: [{ id: 31, role: 'user', content: 'Which colour?', timestamp: t0 }, { id: 32, role: 'assistant', content: 'Red or blue? Pick a colour.', wizard_ask: 'Pick a colour', wizard_state: 'needs_you', timestamp: t0 + 10 }],
};
const SCEN = { 'qa-n1': 'needs', 'qa-d1': 'done', 'qa-s1': 'short', 'qa-h1': 'needs', 'qa-k1': 'needs', 'qa-x1': 'needs' };
const cases = (process.env.QA_CASES || 'phone,classic').split(','), skins = (process.env.QA_SKINS || 'nebula,grove').split(',');
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of skins) for (const sid of (process.env.QA_THREADS || Object.keys(SCEN).join(',')).split(',')) {
      const phone = shell === 'phone', stem = `${ON ? 'on' : 'off'}-${shell}-${skin}-${sid}`, entry = { stem, errors: [], writes: [], got: {} }; report.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', reducedMotion: 'reduce',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        // Today's short answer view (miguel/reply-summary) is on in both runs, so the off run shows the summary as it is now.
        const mix = { 'wizard/desktop-chats': true, 'miguel/reply-summary': true, ...(ON ? { 'wizard/reply-card': true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        let seen = { initializedAt: 1, threads: {} };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push(method + ' ' + p);
            if (method === 'PUT' && p === '/wizard/thread-seen') { const next = q.postDataJSON(); seen = next?.threads ? next : seen; return r.fulfill({ json: { ok: true, state: seen } }); }
            return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: seen } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROUTED[u.searchParams.get('agent')] || ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ALL.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: MSGS[SCEN[s.id]] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await vis(`[data-chopen="${sid}"]`).click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-msgs .msg.a')].some(n => n.getClientRects().length), null, { timeout: 15000 });
        await nap(1500);
        // What the owner sees in the open thread: how often the summary's words show, the visible Mark done buttons,
        // whether the full reply and its buttons are on screen, and whether the card's summary is cut or overflows.
        const look = () => page.evaluate(({ ask, done }) => {
          const th = [...document.querySelectorAll('.ch-thread')].find(n => n.getClientRects().length && n.querySelector('.ch-msgs'));
          const shown = n => !!n && n.getClientRects().length > 0 && !n.closest('[hidden]');
          const head = (done ? 'The press notes are finished' : 'The launch plan is ready');
          const texts = [...th.querySelectorAll('.ch-msgs *')].filter(n => shown(n) && [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.includes(head)));
          const card = [...th.querySelectorAll('.ch-rcard')].find(shown), sum = card?.querySelector('.ch-rcard-sum');
          const cs = sum ? getComputedStyle(sum) : null, r = sum?.getBoundingClientRect(), lh = cs ? parseFloat(cs.lineHeight) || 20 : 0;
          const more = card ? [...card.querySelectorAll('[data-reply-summary]')].find(shown) : null;
          return { summaryShown: texts.length, summaryText: sum ? sum.textContent.trim() : '', cut: sum ? (sum.scrollWidth > sum.clientWidth + 1 || sum.scrollHeight > sum.clientHeight + 1 || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') : null,
            lines: sum ? Math.round(r.height / lh) : 0, inside: card ? (() => { const a = card.getBoundingClientRect(), b = card.closest('.ch-msgs').getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5; })() : null,
            state: card?.querySelector('.ch-rcard-st')?.textContent.trim() || '', markDone: [...th.querySelectorAll('[data-chmarkdone]')].filter(shown).length,
            needsLine: [...th.querySelectorAll('.ch-needs-line')].filter(shown).length, full: [...th.querySelectorAll('.msg.a .rdet')].some(shown),
            buttons: [...th.querySelectorAll('.ch-rb-btn')].filter(shown).map(b => b.textContent.trim()), more: more ? more.textContent.trim() : '', expanded: more?.getAttribute('aria-expanded') || '',
            copy: [...th.querySelectorAll('[data-mcopy]')].filter(shown).length, tacts: [...th.querySelectorAll('.ch-tacts [data-chact]')].filter(shown).length };
        }, { ask: ASK, done: SCEN[sid] === 'done' });
        const opened = await look(); entry.got.opened = opened;
        await page.screenshot({ path: path.join(out, `${stem}-opened.png`), fullPage: false });
        if (!ON) { entry.ok = true; continue; }
        if (SCEN[sid] === 'short') {
          // No summary: today's Needs you line and reply, no card.
          assert.equal(opened.summaryText, '', `${stem}: no card without a summary`);
          assert.equal(opened.needsLine, 1, `${stem}: the Needs you line stays`);
        } else {
          assert.equal(opened.summaryShown, 1, `${stem}: the summary shows once (${opened.summaryShown})`);
          assert.equal(opened.summaryText, SCEN[sid] === 'done' ? DONE_ASK : ASK, `${stem}: the full summary`);
          assert.ok(!opened.summaryText.endsWith('…'), `${stem}: never cut with …`);
          assert.equal(opened.cut, false, `${stem}: the summary wraps, nothing hidden`);
          assert.equal(opened.inside, true, `${stem}: the card fits the thread`);
          assert.equal(opened.needsLine, 0, `${stem}: no separate Needs you strip`);
          assert.equal(opened.full, false, `${stem}: collapsed by default`);
          assert.deepEqual(opened.buttons, [], `${stem}: reply buttons are in the folded reply`);
          assert.equal(opened.more, 'Show more', `${stem}: Show more`);
          assert.ok(opened.copy >= 1, `${stem}: Copy stays`);
          if (SCEN[sid] === 'needs') {
            assert.equal(opened.state, 'Needs you'); assert.equal(opened.markDone, 1, `${stem}: exactly one Mark done (${opened.markDone})`);
            if (phone) assert.ok(opened.lines >= 3, `${stem}: 300 characters wrap over several lines (${opened.lines})`);
          } else { assert.equal(opened.state, 'Done'); assert.equal(opened.markDone, 0, `${stem}: a done reply has no Mark done`); }
          await vis('.ch-rcard [data-reply-summary]').click(); await nap(400);
          const more = await look(); entry.got.more = more;
          await page.screenshot({ path: path.join(out, `${stem}-more.png`), fullPage: false });
          assert.equal(more.full, true, `${stem}: Show more opens the full reply`); assert.equal(more.more, 'Show less'); assert.equal(more.expanded, 'true');
          assert.equal(more.summaryShown, 1, `${stem}: still one summary`);
          if (SCEN[sid] === 'needs') { assert.deepEqual(more.buttons, ['Book the 14th', 'Another date'], `${stem}: reply buttons in the full reply`); assert.equal(more.markDone, 1); }
          await vis('.ch-rcard [data-reply-summary]').click(); await nap(400);
          const less = await look(); entry.got.less = less;
          assert.equal(less.full, false, `${stem}: Show less folds it back`); assert.equal(less.more, 'Show more');
          if (SCEN[sid] === 'needs') {
            await vis('.ch-rcard [data-chmarkdone]').click(); await nap(500);
            const after = await look(); entry.got.markedDone = after;
            assert.equal(after.markDone, 0, `${stem}: Mark done clears it`); assert.equal(after.state, '', `${stem}: no Needs you once done`); assert.equal(after.summaryShown, 1);
            await page.screenshot({ path: path.join(out, `${stem}-marked-done.png`), fullPage: false });
          }
        }
        entry.ok = true;
        assert.equal(entry.writes.filter(w => !w.startsWith('PUT /wizard/thread-seen') && !w.startsWith('PUT /wizard/v1/ui-preferences') && !w.startsWith('PATCH /wizard/v1/ui-preferences')).length, 0, 'only seen marks are written: ' + entry.writes.join(', '));
        assert.deepEqual(entry.errors, []);
      } finally { await context.close(); }
    }
  } finally {
    await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const e of report) console.log(e.stem, e.ok ? 'OK' : 'FAIL', JSON.stringify(e.got.opened));
  }
})().catch(e => { console.error(e); process.exit(1); });
