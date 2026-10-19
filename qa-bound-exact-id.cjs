// QA: the Review (bound) view for a reply linking /wizard-os-home/?open=<app id> binds THAT app, never a fuzzy
// name match. James, 19 Oct 2026: a link to outline-streaming-demo bound the older "Outline" (voice-outline) app,
// so Review showed the old UX while the link itself opened the new one.
// Usage (Thales): QA_WEB_DIR=<tree> PW=<playwright module dir> node qa-bound-exact-id.cjs [origin]
const { createRequire } = require('module');
const pw = createRequire((process.env.PW || '/home/telos/node_modules') + '/')('playwright');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || 'https://wizard.tailc0f369.ts.net', WEB = process.env.QA_WEB_DIR;
let pass = 0, fail = 0; const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); };
(async () => {
  const b = await pw.chromium.launch({ headless: true }), ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/*', r => { const q = r.request(), u = new URL(q.url());
    if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    const m = WEB && u.pathname.match(/^\/wizard-os-home\/((?:core\/|desktop\/)?[a-z0-9-]+\.js)$/);
    if (m && fs.existsSync(path.join(WEB, 'web', m[1]))) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(WEB, 'web', m[1])) });
    return r.continue(); });
  const p = await ctx.newPage();
  for (const shell of ['desktop', 'mobile']) {
    await p.goto(ORIGIN + '/wizard-os-home/' + (shell === 'desktop' ? '?shell=desktop' : ''));
    await p.waitForFunction(() => window.WosBoundView && window.WizCore?.apps, null, { timeout: 60000 }); await p.waitForTimeout(3000);
    const r = await p.evaluate(shell => { const A = window.WizCore.apps(shell === 'desktop' ? 'desktop' : 'mobile');
      const t = id => { const el = document.createElement('div'); el.innerHTML = `<div class="ch-msgs"><div class="msg a"><div class="bub"><a href="/wizard-os-home/?open=${id}">Open</a></div></div></div>`;
        return window.WosBoundView.target(el, { findApp: A.findApp, APP: A.APP, appAt: A.appAt, linkTitle: () => 'x' })?.win?.appId || null; };
      return { trial: t('outline-streaming-demo'), old: t('voice-outline'), has: !!A.APP['outline-streaming-demo'] }; }, shell);
    ok(r.has, shell + ': the new Outline is installed', r);
    ok(r.trial === 'outline-streaming-demo', shell + ': Review for ?open=outline-streaming-demo binds that exact app', r);
    ok(r.old === 'voice-outline', shell + ': Review for ?open=voice-outline still binds the old one', r);
  }
  await b.close(); console.log(`bound-exact-id: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
