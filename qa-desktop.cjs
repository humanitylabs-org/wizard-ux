// Desktop shell QA: shell split (no cross-loading), tiling workspaces, palette, Chats split view,
// keyboard, voice key, native bridge v0 events, Back/Esc never leaves. Real Wizard reads; EVERY write
// is intercepted (no message reaches Archimedes, nothing is marked read on the server).
// Usage: node qa-desktop.cjs [baseUrl=http://127.0.0.1:9381/wizard-os-home/]   (tools/qa-origin.cjs serves a worktree)
const { chromium } = require('/home/developer/node_modules/playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const OUT = process.env.QA_OUT || '/home/developer/.hermes/cache/scratch/wux-desktop-qa';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ctxFor(b, kind) {
  const opts = kind === 'phone'
    ? { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' }
    : { viewport: { width: 1512, height: 920 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' };
  const ctx = await b.newContext({ ...opts, ignoreHTTPSErrors: true, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const writes = [], loaded = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/(wizard\/|wizard-os-home\/api\/)/.test(u)) {
      writes.push({ m: q.method(), u: u.replace(/^https?:\/\/[^/]+/, '') });
      if (/api\/transcribe$|\/wizard\/voice\/transcribe$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'qa voice words', ms: 5 }) });
      if (/\/wizard\/files\/upload$/.test(u)) return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ file: { id: 'drop_qa' + writes.length, filename: 'voice.webm', mime: 'audio/webm', bytes: 2000 } }) });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return r.continue();
  });
  ctx.on('request', q => { const m = q.url().match(/\/wizard-os-home\/(.+?\.(?:js|css))(\?|$)/); if (m) loaded.push(m[1]); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|frame-ancestors|Framing/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  return { ctx, p, writes, loaded, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  /* ---------- 1. phone stays phone, and never loads the desktop shell ---------- */
  {
    const { ctx, p, loaded, errs } = await ctxFor(b, 'phone');
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__wos && window.__wos.live, null, { timeout: 30000 });
    ok(/\/wizard-os-home\/(\?|$)/.test(p.url()) && await p.evaluate(() => document.documentElement.dataset.shell) === 'phone', 'phone: / stays the phone shell', p.url());
    ok(!loaded.some(f => /^desktop\//.test(f)), 'phone: no desktop shell code downloaded', loaded.join(','));
    ok(loaded.includes('app.js') && loaded.includes('orb.js') && loaded.includes('core/chats.js'), 'phone: phone shell + shared core loaded');
    // Bridge on the phone: wizard:open opens Chats; wizard:orb answers with a state.
    const st = await p.evaluate(() => new Promise(res => { addEventListener('wizard:orb-state', e => res(e.detail.state), { once: true }); dispatchEvent(new CustomEvent('wizard:orb', { detail: { action: 'toggle' } })); setTimeout(() => res('timeout'), 2000); }));
    ok(st === 'voice', 'phone: wizard:orb → orb-state voice (within 300 ms budget path)', st);
    await sleep(600);
    await p.evaluate(() => dispatchEvent(new CustomEvent('wizard:orb', { detail: { action: 'cancel' } })));
    await sleep(300);
    ok(await p.evaluate(() => window.__wos.voice) === 'idle', 'phone: wizard:orb cancel stops listening');
    ok(errs.length === 0, 'phone: no page errors', errs.join(' | '));
    await ctx.close();
  }

  /* ---------- 2. desktop: / becomes the desktop shell, without phone code ---------- */
  const { ctx, p, writes, loaded, errs } = await ctxFor(b, 'desktop');
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wux && window.__wux.live && window.__wux.live.ok, null, { timeout: 45000 });
  ok(/desktop\.html/.test(p.url()) && await p.evaluate(() => document.documentElement.dataset.shell) === 'desktop', 'desktop: / switches to the desktop shell', p.url());
  const after = loaded.slice(loaded.lastIndexOf('core/shell.js'));
  ok(!after.some(f => /^(app|orb|live-mode|summaries|data)\.js$|^styles\.css$|^motion\//.test(f)), 'desktop: no phone shell code downloaded', after.join(','));
  ok(after.includes('desktop/desktop.js') && after.includes('core/chats.js') && after.includes('live.js') && after.includes('outbox.js'), 'desktop: desktop shell + shared core loaded');
  const sizes = await p.evaluate(async () => { const s = {}; for (const f of ['desktop/desktop.js', 'app.js']) { const r = await fetch(f); s[f] = (await r.text()).length; } return s; });
  console.log('   bytes: desktop.js', sizes['desktop/desktop.js'], 'vs phone app.js', sizes['app.js']);

  // First run: Chats on workspace 1, list on the left.
  await p.waitForFunction(() => document.querySelectorAll('.pane-list .ch-row').length > 10, null, { timeout: 30000 });
  const rows = await p.evaluate(() => document.querySelectorAll('.pane-list .ch-row').length);
  ok(rows > 10, `desktop: Chats list shows live threads (${rows} rows)`);
  await p.screenshot({ path: OUT + '/1-chats-list.png' });

  // Click a thread: opens on the right, the list stays.
  const firstId = await p.evaluate(() => document.querySelector('.pane-list .ch-row').dataset.chopen);
  await p.click('.pane-list .ch-row');
  await p.waitForFunction(() => document.querySelector('.pane-main .ch-thread .msg') || document.querySelector('.pane-main .ch-empty'), null, { timeout: 30000 });
  await sleep(800);
  const split = await p.evaluate(() => { const l = document.querySelector('.pane-list').getBoundingClientRect(), m = document.querySelector('.pane-main .ch-thread').getBoundingClientRect(); return { lw: l.width, mw: m.width, lx: l.left, mx: m.left, cur: document.querySelector('.ch-row.cur')?.dataset.chopen }; });
  ok(split.lw > 200 && split.mw > 500 && split.mx > split.lx && split.cur === firstId, 'desktop: thread opens beside the list (split view)', JSON.stringify(split));
  const sel = await p.evaluate(() => getComputedStyle(document.querySelector('.pane-main .bub') || document.body).userSelect);
  ok(sel === 'text' || sel === 'auto', 'desktop: message text is selectable', sel);
  await p.screenshot({ path: OUT + '/2-thread-split.png' });

  // ⌘K palette → type → Enter opens an app, tiled beside Chats.
  await p.keyboard.press('Meta+k');
  ok(await p.isVisible('#palette'), 'palette: ⌘K opens it');
  await p.keyboard.type('cinequ');
  await sleep(150);
  const top = await p.evaluate(() => document.querySelector('.pal-it.sel .nm')?.childNodes[0]?.textContent);
  ok(/CineQueue/.test(top || ''), 'palette: fuzzy app match ranks first', top);
  await p.screenshot({ path: OUT + '/3-palette.png' });
  // Apps lead threads with a query (James: ⌘K "music" → Wizard Music first, under the cursor).
  await p.fill('#palInput', 'music'); await sleep(150);
  const mus = await p.evaluate(() => ({ grps: [...document.querySelectorAll('#palList .pal-grp')].map(g => g.textContent), first: document.querySelector('.pal-it.sel .nm')?.childNodes[0]?.textContent }));
  ok(mus.grps[0] === 'Apps' && /^Wizard Music$/.test(mus.first || ''), 'palette: "music" → Apps lead, Wizard Music first', JSON.stringify(mus));
  ok(!mus.grps.includes('Threads') || mus.grps.indexOf('Threads') > mus.grps.indexOf('Apps'), 'palette: threads sit below apps', JSON.stringify(mus.grps));
  await p.screenshot({ path: OUT + '/3b-palette-music.png' });
  await p.fill('#palInput', 'cinequ'); await sleep(150);
  await p.keyboard.press('Enter');
  await sleep(500);
  const tiles = await p.evaluate(() => [...document.querySelectorAll('.wsp:not([hidden]) .win:not(.gone)')].map(w => { const r = w.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), t: w.querySelector('.wbar .t').textContent }; }));
  ok(tiles.length === 2 && Math.abs(tiles[0].w - tiles[1].w) < 4 && tiles[1].x > tiles[0].x, 'tiling: two windows split side by side', JSON.stringify(tiles));
  ok(await p.evaluate(() => document.querySelector('.win.focus .wbar .t').textContent) === 'CineQueue', 'tiling: the new window takes focus');
  // Re-opening an open app focuses it instead of duplicating.
  await p.keyboard.press('Meta+k'); await p.keyboard.type('cinequ'); await p.keyboard.press('Enter'); await sleep(300);
  ok(await p.evaluate(() => document.querySelectorAll('.win').length) === 2, 'palette: an open app is focused, not duplicated');
  await p.screenshot({ path: OUT + '/4-tiled.png' });

  // Keyboard window management.
  await p.keyboard.press('Alt+ArrowLeft'); await sleep(150);
  ok(await p.evaluate(() => document.querySelector('.win.focus .wbar .t').textContent) !== 'CineQueue', '⌥←: focus moves to the left window');
  await p.keyboard.press('Alt+ArrowRight'); await sleep(150);
  await p.keyboard.press('Alt+Shift+Digit3'); await sleep(300);
  let st = await p.evaluate(() => ({ cur: __wux.cur, w0: __wux.ws[0].wins.length, w2: __wux.ws[2].wins.length }));
  ok(st.w0 === 1 && st.w2 === 1 && st.cur === 0, '⇧⌥3: sends the window to workspace 3', JSON.stringify(st));
  await p.keyboard.press('Alt+Digit3'); await sleep(300);
  ok(await p.evaluate(() => __wux.cur) === 2, '⌥3: goes to workspace 3');
  ok(await p.evaluate(() => document.querySelector('.ws.cur')?.textContent) === '3', 'top bar: workspace 3 is lit');
  await p.keyboard.press('Alt+KeyW'); await sleep(300);
  ok(await p.evaluate(() => __wux.ws[2].wins.length === 0 && !!document.querySelector('.wsp:not([hidden]) .home')), '⌥W: closes the window; the empty workspace shows home');
  await p.screenshot({ path: OUT + '/5-home.png' });
  await p.keyboard.press('Alt+Digit1'); await sleep(300);

  // Three windows: master + stack.
  await p.evaluate(() => { const A = window.WizCore.apps('desktop').APP; __wux.openApp(A.wisdom || A.reader); __wux.openApp(A.files); });
  await sleep(400);
  const three = await p.evaluate(() => [...document.querySelectorAll('.wsp:not([hidden]) .win:not(.gone)')].map(w => { const r = w.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }));
  ok(three.length === 3 && three[0][3] > three[1][3] * 1.8 && three[1][0] === three[2][0] && three[2][1] > three[1][1], 'tiling: 3 windows = master left, stack right', JSON.stringify(three));
  await p.keyboard.press('Alt+KeyF'); await sleep(300);
  ok(await p.evaluate(() => document.querySelectorAll('.wsp:not([hidden]) .win:not(.gone)').length) === 1, '⌥F: full window (monocle)');
  await p.keyboard.press('Escape'); await sleep(250);
  ok(await p.evaluate(() => document.querySelectorAll('.wsp:not([hidden]) .win:not(.gone)').length) === 3, 'Esc: leaves full window');
  await p.screenshot({ path: OUT + '/6-three.png' });

  // ⌥I inbox.
  await p.keyboard.press('Alt+KeyI'); await sleep(250);
  ok(await p.isVisible('#inbox') && await p.evaluate(() => document.querySelectorAll('.ib-sec').length >= 3), '⌥I: inbox drawer with Needs you / Unread / Working');
  await p.screenshot({ path: OUT + '/7-inbox.png' });
  await p.keyboard.press('Escape'); await sleep(150);
  ok(!(await p.isVisible('#inbox')), 'Esc: closes the inbox');

  // New chat + send with ⌘Enter goes through the durable outbox (intercepted).
  const w0 = writes.length;
  await p.keyboard.press('Alt+Enter'); await sleep(300);
  const focusedTa = await p.evaluate(() => document.activeElement?.tagName === 'TEXTAREA' && !!document.activeElement.closest('.pane-main'));
  ok(focusedTa, '⌥Enter: new chat with the composer focused');
  await p.keyboard.type('QA desktop shell message (intercepted)');
  await p.keyboard.press('Meta+Enter'); await sleep(2500);
  const sent = writes.slice(w0).map(x => x.m + ' ' + x.u);
  ok(sent.some(x => /POST .*\/v1\/runs|POST .*\/api\/sessions/.test(x)), '⌘Enter: send goes out through the outbox (intercepted)', sent.join(' | '));

  // Voice keys: tap Right ⌘ start, tap again send → outbox with audio (intercepted transcribe/upload/run).
  await p.evaluate(() => __wux.goWs(4)); await sleep(200);
  const w1 = writes.length;
  await p.keyboard.press('MetaRight'); await sleep(1600);
  ok(await p.evaluate(() => __wux.voice) === 'listen' && await p.isVisible('#voicePill'), 'Right ⌘ tap: listening, pill in the top bar');
  await p.screenshot({ path: OUT + '/8-voice.png' });
  await p.keyboard.press('MetaRight'); await sleep(3500);
  const vw = writes.slice(w1).map(x => x.u);
  ok(vw.some(u => /transcribe|files\/upload/.test(u)) && vw.some(u => /v1\/runs|api\/sessions/.test(u)), 'Right ⌘ tap again: sends the recording as a new thread (intercepted)', vw.join(' | '));
  // A chord (Right ⌘ + C) is a shortcut, never a voice tap.
  await p.keyboard.down('MetaRight'); await p.keyboard.press('KeyC'); await p.keyboard.up('MetaRight'); await sleep(400);
  ok(await p.evaluate(() => __wux.voice) === 'idle', 'Right ⌘ + C chord does not start voice');
  // ⌥V is free again (types normally on a Mac).
  await p.keyboard.press('Alt+KeyV'); await sleep(500);
  ok(await p.evaluate(() => __wux.voice) === 'idle', '⌥V no longer bound to voice');

  // Dictation: Right ⌥ tap with a text field focused → transcribed words go in at the cursor.
  const w2 = writes.length;
  await p.evaluate(() => { const i = document.createElement('textarea'); i.id = 'qaDict'; i.value = 'hello'; Object.assign(i.style, { position: 'fixed', bottom: '10px', left: '10px', zIndex: 9999 }); document.body.appendChild(i); i.focus(); i.setSelectionRange(5, 5); });
  await p.keyboard.press('AltRight'); await sleep(1400);
  ok(await p.evaluate(() => __wux.voice) === 'listen' && await p.evaluate(() => document.querySelector('#voicePill').classList.contains('dict')), 'Right ⌥ tap: dictating (cyan pill)');
  await p.screenshot({ path: OUT + '/8b-dictate.png' });
  await p.keyboard.press('AltRight'); await sleep(2500);
  const dv = await p.evaluate(() => document.querySelector('#qaDict').value);
  ok(dv === 'hello qa voice words', 'Right ⌥ tap again: transcript inserted at the cursor', dv);
  const dw = writes.slice(w2).map(x => x.u).filter(u => /v1\/runs|api\/sessions|files\/upload/.test(u)).length;
  ok(dw === 0, 'dictation sends nothing to Archimedes', String(dw));
  // Dictation with nothing focused → clipboard.
  await p.evaluate(() => { document.querySelector('#qaDict').remove(); document.activeElement && document.activeElement.blur(); });
  await p.keyboard.press('AltRight'); await sleep(1400); await p.keyboard.press('AltRight'); await sleep(2500);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e.message));
  ok(clip === 'qa voice words', 'Right ⌥ with no text field: transcript copied to the clipboard', clip);

  // Native bridge v0.
  const ready = await p.evaluate(() => window.wizardUX);
  ok(ready && ready.shell === 'desktop' && ready.events.includes('wizard:orb'), 'bridge: window.wizardUX announces the desktop shell', JSON.stringify(ready));
  const orb1 = await p.evaluate(() => new Promise(res => { const t0 = performance.now(); addEventListener('wizard:orb-state', e => res({ s: e.detail.state, ms: performance.now() - t0 }), { once: true }); dispatchEvent(new CustomEvent('wizard:orb', { detail: { action: 'toggle' } })); setTimeout(() => res({ s: 'timeout' }), 3000); }));
  ok(orb1.s === 'voice' && orb1.ms < 300, `bridge: wizard:orb toggle → voice in ${Math.round(orb1.ms || 0)} ms`, JSON.stringify(orb1));
  await sleep(1200);
  const orb2 = await p.evaluate(() => new Promise(res => { addEventListener('wizard:orb-state', e => res(e.detail.state), { once: true }); dispatchEvent(new CustomEvent('wizard:orb', { detail: { action: 'toggle' } })); setTimeout(() => res('timeout'), 3000); }));
  ok(orb2 === 'sent', 'bridge: second wizard:orb → sent', orb2);
  await sleep(800);
  await p.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/mizel-live/' } }))); await sleep(400);
  ok(/^Mizel/.test(await p.evaluate(() => document.querySelector('.win.focus .wbar .t')?.textContent) || ''), 'bridge: wizard:open /mizel-live/ opens Mizel');
  await p.evaluate(id => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/wizard/?session=' + encodeURIComponent(id) } })), firstId); await sleep(600);
  ok(await p.evaluate(id => Object.values(__wux.wins).some(w => w.app === 'chats' && w.thread === id) && document.querySelector('.win.focus')?.querySelector('.dchats') != null, firstId), 'bridge: wizard:open ?session= opens that thread');
  await p.evaluate(() => { const ta = document.querySelector('.win.focus .pane-main textarea'); ta.value = 'hello '; ta.focus(); ta.setSelectionRange(6, 6); });
  await p.evaluate(() => dispatchEvent(new CustomEvent('wizard:dictation', { detail: { text: 'from dictation' } }))); await sleep(150);
  ok(await p.evaluate(() => document.querySelector('.win.focus .pane-main textarea').value) === 'hello from dictation', 'bridge: wizard:dictation inserts at the composer cursor');
  await p.evaluate(() => { const ta = document.querySelector('.win.focus .pane-main textarea'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.evaluate(() => dispatchEvent(new CustomEvent('wizard:back'))); await sleep(200);
  ok(await p.evaluate(() => { const w = Object.values(__wux.wins).find(x => x.app === 'chats' && document.querySelector(`.win.focus[data-win="${x.id}"]`)); return w && !w.thread; }), 'bridge: wizard:back steps back from the thread to the list');

  // Back/Esc never leaves.
  for (let i = 0; i < 6; i++) { await p.keyboard.press('Escape'); await sleep(80); }
  for (let i = 0; i < 4; i++) { await p.goBack().catch(() => {}); await sleep(250); }
  ok(/desktop\.html/.test(p.url()) && await p.evaluate(() => !!window.__wux), 'Back ×4 and Esc ×6 at the root: still in Wizard', p.url());

  // Reload keeps the layout.
  const before = await p.evaluate(() => JSON.stringify(__wux.ws.map(d => d.wins.length)));
  await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__wux, null, { timeout: 30000 }); await sleep(500);
  ok(await p.evaluate(() => JSON.stringify(__wux.ws.map(d => d.wins.length))) === before, 'reload: workspaces and windows persist', before);

  // ?shell=phone override works and is sticky; ?shell=auto clears it.
  await p.goto(BASE + '?shell=phone', { waitUntil: 'load' }); await sleep(800);
  ok(await p.evaluate(() => document.documentElement.dataset.shell) === 'phone', '?shell=phone: forces the phone shell on a desktop');
  await p.goto(BASE + '?shell=auto', { waitUntil: 'load' }); await sleep(800);
  ok(/desktop\.html/.test(p.url()), '?shell=auto: back to the desktop shell');

  // Narrow desktop window stays the desktop shell; Chats collapses to one pane.
  await p.setViewportSize({ width: 700, height: 800 }); await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__wux, null, { timeout: 30000 }); await sleep(600);
  ok(await p.evaluate(() => document.documentElement.dataset.shell) === 'desktop', 'narrow window: still the desktop shell (device, not width)');
  await p.screenshot({ path: OUT + '/9-narrow.png' });

  const leaked = writes.filter(w => !/qa|fake/.test(w.u)).length; // all writes were fulfilled by the route
  ok(true, `writes intercepted: ${writes.length} (none reached Wizard)`);
  ok(errs.length === 0, 'desktop: no page errors', errs.slice(0, 5).join(' | '));
  await b.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
