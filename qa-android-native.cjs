// QA for the Wizard OS native app (ai.wizards.os.qa debug build, same code as release) on the Thales emulator.
// Drives the real WebView over its devtools socket (forwarded to 127.0.0.1:9334; raw CDP over Node's built-in
// WebSocket, since WebViews don't support Playwright's browser contexts) and the real hardware Back key via adb.
// Every non-GET request to Hermes/Wizard is failed by CDP Fetch interception: QA never sends or changes read state.
const { execSync } = require('child_process');
const ADB = 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools; export ANDROID_SERIAL=emulator-5554; adb';
const PKG = process.env.WOS_PKG || 'ai.wizards.os.qa';
const sh = c => execSync(`ssh thales '${ADB} ${c}'`, { encoding: 'utf8', timeout: 40000 }).trim();
const top = () => sh('shell dumpsys activity activities | grep -m1 topResumedActivity') || '';
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const writes = [];

async function attach() {
  const pid = sh('shell pidof ' + PKG);
  sh(`forward tcp:9334 localabstract:webview_devtools_remote_${pid}`);
  let page;
  for (let i = 0; i < 20 && !page; i++) {
    try { const l = await (await fetch('http://127.0.0.1:9334/json/list')).json(); page = l.find(x => x.type === 'page' && /wizard-os-home/.test(x.url)); } catch (e) {}
    if (!page) await sleep(700);
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
  return { ws, ev, url: page.url };
}

(async () => {
  if (!top().includes(PKG)) { sh(`shell am start -W -n ${PKG}/ai.wizards.os.MainActivity`); await sleep(9000); }
  const { ws, ev, url } = await attach();
  check('native app loads the Wizard OS shell', /\/wizard-os-home\//.test(url), url);
  await ev(`new Promise(r => { const t = () => window.__wos ? r() : setTimeout(t, 200); t(); })`);
  const info = await ev(`({ ua: navigator.userAgent, nat: document.documentElement.classList.contains('native-app'), hook: typeof window.__wosNativeBack, bridge: window.WizardOSNative ? window.WizardOSNative.platform() : null })`);
  check('runs as the native app (UA tag + native bridge)', /WizardOS-Android\//.test(info.ua) && info.nat && /^android:/.test(info.bridge || ''), info.bridge);
  check('shell exposes the native Back hook', info.hook === 'function');

  // Nested state: the Mizel desk, a real thread open in Chats there, and the inbox sheet over it.
  const opened = await ev(`(async () => { const w = window.__wos; w.closeSheets(); w.goDesk(w.HOME); await new Promise(r => setTimeout(r, 400));
    const s = (w.live.sessions || []).filter(x => !x.hidden && !x.archived)[0]; w.goDesk(w.HOME + 2); if (s) w.openWizardThread(s.id); return !!s; })()`);
  await sleep(1800);
  await ev(`window.__wos.openSheet('inbox')`); await sleep(700);
  const before = await ev(`({ idx: window.__wos.idx, sheet: window.__wos.sheet })`);
  const steps = [];
  for (let i = 0; i < 7; i++) {
    sh('shell input keyevent 4'); await sleep(1100);
    if (!top().includes(PKG)) { steps.push('LEFT APP'); break; }
    steps.push(await ev(`(window.__wos.back.log || []).slice(-1)[0]`));
  }
  check('hardware Back closes the sheet first', steps[0] === 'native:sheet', steps.join(' → '));
  check('hardware Back steps out of the thread, then to Home', (!opened || steps.includes('native:thread')) && steps.includes('native:home'), `started on desk ${before.idx}, thread opened: ${opened}`);
  check('at Home, Back stays put (no exit)', steps[steps.length - 1] === 'native:root');
  check('seven Back presses never leave the app', !steps.includes('LEFT APP') && top().includes(PKG));
  check('ends on the Home desk', await ev(`window.__wos.idx === window.__wos.HOME`));

  // Microphone: the orb gets a live capture track inside the app.
  const mic = await ev(`(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); const t = s.getAudioTracks()[0]; const r = { ok: !!t, state: t && t.readyState }; s.getTracks().forEach(x => x.stop()); return r; } catch (e) { return { ok: false, err: e.name }; } })()`);
  check('microphone works for the orb inside the app', mic.ok && mic.state === 'live', JSON.stringify(mic));
  ws.close();

  // Cold start: Back presses during launch never exit either.
  sh('shell am force-stop ' + PKG); sh(`shell am start -W -n ${PKG}/ai.wizards.os.MainActivity`);
  await sleep(1200); sh('shell input keyevent 4'); await sleep(500); sh('shell input keyevent 4'); await sleep(1200);
  check('Back during a cold launch still stays in the app', top().includes(PKG));
  // Opening a thread asks to mark it read; that PUT is failed above, so read state is untouched.
  check('QA attempted zero sends to Archimedes (/v1/runs)', !writes.some(w => /\/v1\/runs/.test(w)), writes.join(', ') || 'none');
  check('every Hermes/Wizard write was blocked before the server', writes.every(w => /^(PUT|POST|PATCH|DELETE) /.test(w)), `${writes.length} blocked`);
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
