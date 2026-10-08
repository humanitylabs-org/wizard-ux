// Assistant handoff QA on the Thales emulator: the side-key app's intents reach the running Wizard OS app.
//  - SAY shows the words as a draft with Send/Dismiss, and sends NOTHING on its own.
//  - Back drops the draft (and never leaves the app).
//  - LISTEN opens the orb listening with a live mic.
// Intents are fired with adb exactly as the side-key app would; Hermes/Wizard writes are failed by CDP Fetch.
const { execSync } = require('child_process');
const ADB = 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools; export ANDROID_SERIAL=emulator-5554; adb';
const PKG = process.env.WOS_PKG || 'ai.wizards.os.qa';
const sh = c => execSync(`ssh thales '${ADB} ${c}'`, { encoding: 'utf8', timeout: 40000 }).trim();
const top = () => sh('shell dumpsys activity activities | grep -m1 topResumedActivity') || '';
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const writes = [];
const SAID = 'Remind me to call Miguel tomorrow at 10';

async function attach() {
  const pid = sh('shell pidof ' + PKG);
  sh(`forward tcp:9334 localabstract:webview_devtools_remote_${pid}`);
  let page;
  for (let i = 0; i < 25 && !page; i++) {
    try { const l = await (await fetch('http://127.0.0.1:9334/json/list')).json(); page = l.find(x => x.type === 'page' && /wizard-os-home/.test(x.url)); } catch (e) {}
    if (!page) await sleep(600);
  }
  if (!page) throw new Error('no Wizard OS page in the app WebView');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const wait = new Map();
  const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
    if (d.method === 'Fetch.requestPaused') {
      const r = d.params.request;
      if (r.method !== 'GET' && r.method !== 'HEAD') { writes.push(r.method + ' ' + r.url); send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'BlockedByClient' }); }
      else send('Fetch.continueRequest', { requestId: d.params.requestId });
    }
  };
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/hermes/*' }, { urlPattern: '*/v1/*' }, { urlPattern: '*/wizard/*' }] });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
    return r.result?.result?.value;
  };
  await ev(`new Promise(r => { const t = () => window.__wos ? r() : setTimeout(t, 200); t(); })`);
  return { ws, ev };
}
const fire = (action, text) => execSync(`ssh thales bash /tmp/thales-fire.sh ${action} ${text ? Buffer.from(text).toString('base64') : '-'} ${PKG}`, { encoding: 'utf8', timeout: 40000 }).trim();

(async () => {
  let { ws, ev } = await attach();
  await ev(`(() => { const w = window.__wos; w.closeSheets(); w.goDesk(w.HOME + 1); return w.idx; })()`);
  sh('shell input keyevent 3'); await sleep(1200); // Home key: Wizard OS goes to the background, as when a side-key app is in front
  const out = fire('SAY', SAID);
  check('SAY intent resolves to Wizard OS', !/Error|unable/i.test(out), out.split('\n').slice(-1)[0]);
  await sleep(2500);
  check('Wizard OS comes to the front', top().includes(PKG));
  ws.close(); ({ ws, ev } = await attach());
  const d = await ev(`({ text: document.querySelector('#txText')?.textContent, route: document.querySelector('#txRouteText')?.textContent, shown: document.querySelector('#voice')?.classList.contains('tx'), btns: [...document.querySelectorAll('#txChips [data-handoff]')].map(b => b.textContent), idx: window.__wos.idx, home: window.__wos.HOME, voice: window.__wos.voice })`);
  check('the words appear as a draft on Home', d.shown && d.text === SAID && d.idx === d.home, JSON.stringify({ text: d.text, idx: d.idx }));
  check('draft offers Send and Dismiss (nothing auto-sent)', d.btns.join('|') === 'Send|Dismiss' && /tap Send/.test(d.route || ''), d.btns.join('|'));
  await sleep(2500);
  check('no message sent while the draft waits', !writes.some(w => /\/v1\/runs|\/messages|\/sessions/.test(w)), writes.join(', ') || 'none');
  sh('shell input keyevent 4'); await sleep(1000);
  const after = await ev(`({ btns: document.querySelectorAll('#txChips [data-handoff]').length, log: (window.__wos.back.log || []).slice(-1)[0] })`);
  check('Back drops the draft and stays in the app', after.btns === 0 && after.log === 'native:draft' && top().includes(PKG), after.log);

  fire('LISTEN'); await sleep(2500);
  const v = await ev(`window.__wos.voice`);
  check('LISTEN opens the orb listening', /listen|rec|hear/i.test(v || ''), v);
  sh('shell input keyevent 4'); await sleep(900);
  check('Back stops listening and stays in the app', (await ev(`window.__wos.voice`)) === 'idle' && top().includes(PKG));
  check('QA attempted zero sends to Archimedes', !writes.some(w => /\/v1\/runs/.test(w)), writes.join(', ') || 'none');
  ws.close();
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
