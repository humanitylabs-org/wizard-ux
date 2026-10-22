// Assistant handoff QA on the Thales emulator: the side-key app's intents reach the running Wizard OS app.
//  - SAY sends the words by itself, exactly like talking to the orb (no draft, no Send tap) — James, 0.6.0.
//  - Back afterwards never leaves the app.
//  - LISTEN opens the orb listening with a live mic.
// Intents are fired with adb exactly as the side-key app would; Hermes/Wizard writes are failed by CDP Fetch.
const { execSync } = require('child_process');
const ADB = 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools; export ANDROID_SERIAL=emulator-5554; adb';
const PKG = process.env.WOS_PKG || 'ai.wizards.os.qa';
const sh = c => execSync(`ssh ${require('./tools/qa-paths.cjs').buildHost()} '${ADB} ${c}'`, { encoding: 'utf8', timeout: 40000 }).trim();
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
const fire = (action, text) => execSync(`ssh ${require('./tools/qa-paths.cjs').buildHost()} bash /tmp/thales-fire.sh ${action} ${text ? Buffer.from(text).toString('base64') : '-'} ${PKG}`, { encoding: 'utf8', timeout: 40000 }).trim();

(async () => {
  let { ws, ev } = await attach();
  await ev(`(() => { const w = window.__wos; w.closeSheets(); w.goDesk(w.HOME + 1); return w.idx; })()`);
  sh('shell input keyevent 3'); await sleep(1200); // Home key: Wizard OS goes to the background, as when a side-key app is in front
  const out = fire('SAY', SAID);
  check('SAY intent resolves to Wizard OS', !/Error|unable/i.test(out), out.split('\n').slice(-1)[0]);
  await sleep(2500);
  check('Wizard OS comes to the front', top().includes(PKG));
  ws.close(); ({ ws, ev } = await attach());
  await sleep(3000);
  const runs = writes.filter(w => /\/v1\/runs|\/sessions/.test(w));
  check('the words are sent by themselves (no draft, no Send tap)', runs.length >= 1, writes.join(', ') || 'none');
  const d = await ev(`({ btns: document.querySelectorAll('#txChips [data-handoff]').length, log: (window.__wos.back?.log || window.__backLog || []).slice(-3) })`);
  check('no Send/Dismiss draft is shown', d.btns === 0, JSON.stringify(d));
  sh('shell input keyevent 4'); await sleep(1000);
  check('Back stays in the app', top().includes(PKG));
  const sent = writes.length;

  fire('LISTEN'); await sleep(2500);
  const v = await ev(`window.__wos.voice`);
  check('LISTEN opens the orb listening', /listen|rec|hear/i.test(v || ''), v);
  sh('shell input keyevent 4'); await sleep(900);
  check('Back stops listening and stays in the app', (await ev(`window.__wos.voice`)) === 'idle' && top().includes(PKG));
  check('LISTEN alone sends nothing more', writes.filter(w => /\/v1\/runs/.test(w)).length === writes.slice(0, sent).filter(w => /\/v1\/runs/.test(w)).length, writes.slice(sent).join(', ') || 'none');
  ws.close();
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
