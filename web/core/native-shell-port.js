/* window.WizardOSNative / window.WizardOSDevice in the Android app's MAIN document only (wizard-os issue 387).
 *
 * The Android app used to inject two Java objects into EVERY frame (addJavascriptInterface), so a hosted app frame
 * could call native features directly. Newer APKs inject nothing callable: they offer window.wizardShellPort
 * (AndroidX addWebMessageListener), whose native receiver answers only the main frame, on the persisted owner origin,
 * with the shell document on top, from the reply proxy bound to the current document (android/.../shellport/).
 *
 * This file rebuilds the old method names for the shell itself, so the rest of the shell keeps working unchanged:
 *  - cached reads (sideButton(), unsent(), recActive(), recLevel(), …) answer synchronously from the last state the
 *    native side pushed (after every command, on resume, on native changes, and every ~120 ms while recording);
 *  - actions (haptic, keepAwake, recPause, …) are posted and return nothing, as before;
 *  - fresh results (recStart, recStop, recRead, usualsRun, micRoute, …) return a Promise: callers `await` them,
 *    which also works with an older APK's synchronous Java object.
 * It installs only in the top document; hosted frames get nothing from it (opaque frames cannot reach it at all).
 *
 * window.WosNativeShell.status: 'browser' (not the Android app), 'legacy' (an older APK with all-frame Java objects),
 * 'pending', 'ok' (main-document port bound) or 'unsupported' (Android app without a usable port). With the browser
 * boundary on, native mode must reach 'ok' before any app frame opens: safeForAppFrames() is the gate.
 */
(() => {
  'use strict';
  if (window.WosNativeShell) return;
  let isTop = false; try { isTop = window.top === window; } catch (_) { isTop = false; }
  const android = /WizardOS-Android\//.test(navigator.userAgent || '');
  const legacy = !!(window.WizardOSNative || window.WizardOSDevice); // older APK: Java objects in every frame
  const port = isTop ? window.wizardShellPort : null;
  let status = !android ? 'browser' : legacy ? 'legacy' : port && typeof port.postMessage === 'function' ? 'pending' : 'unsupported';
  let resolveReady; const ready = new Promise(r => { resolveReady = r; });
  if (status !== 'pending') resolveReady(status === 'browser');
  const shell = Object.freeze({
    get status() { return status; },
    ready,
    /** Native mode may create app frames only after this main-document handshake; legacy/unsupported never. */
    safeForAppFrames() { return status === 'browser' || status === 'ok'; },
  });
  Object.defineProperty(window, 'WosNativeShell', { value: shell, configurable: false, writable: false });
  if (status !== 'pending') return;

  // Exact mirror of ShellPortPolicy (tests/native-shell-port.test.mjs checks the two tables match).
  // s string|null, i int, l integer, b boolean.
  const NATIVE = {
    openInBrowser: 's', download: 's', changeServer: '', platform: '', usuals: '', usualsTeach: 's', usualsRun: 's',
    usualsMatch: 's', usualsSave: 'sss', usualsKeepName: 's', usualsDelete: 's', usualsCancel: '', sideButton: '',
    setupSideButton: '', sideButtonSettings: '', everywhere: '', setEverywhere: 'b', voiceTypingSettings: '',
    appVoice: 'sl', unsent: '', retryUnsent: 's', deleteUnsent: 's', appUnsent: 'is', keepAwake: 'b', immersive: 'b',
    cutoutTop: '', insetTop: '', shareText: 'ss', shareFile: 'sss', selection: 'i', haptic: 'i',
  };
  const DEVICE = {
    version: '', recHandoffVersion: '', recHandoffBegin: 'ss', recStartBorrowed: 'ss', recHandoffEnd: 's',
    recHandoffEvents: '', recStart: 's', recPause: 'b', recLevel: '', micRoute: '', micPolicy: '', setMicPolicy: 's',
    recActive: '', recStop: 's', recCancel: 's', recClaim: 's', recRead: 'si', captureJournal: '', recDone: 's',
    recPending: '', cancelledList: '', cancelledRead: 'si', cancelledDelete: 's', clip: 's', shareMeta: 's',
    shareRead: 'sii', shareDone: 's', watchRun: 'sss', replyNotes: '', clearThread: 's', notifications: '',
    updateCheck: '', updateInstall: '', updateState: '',
  };
  const FRESH = new Set(['usualsTeach', 'usualsRun', 'usualsMatch', 'usualsSave', 'recHandoffBegin', 'recStartBorrowed',
    'recHandoffEnd', 'recStart', 'micRoute', 'setMicPolicy', 'recStop', 'recClaim', 'recRead', 'cancelledRead',
    'shareMeta', 'shareRead', 'clearThread']);
  // Cached reads: answered from the pushed state. Values before the first state are the empty answers.
  const CACHED = {
    native: { platform: 'android:', sideButton: 'null', everywhere: 'null', unsent: '[]', usuals: '{}', cutoutTop: 0, insetTop: 0 },
    device: { version: 1, recHandoffVersion: 1, recActive: 'null', recLevel: 0, micPolicy: 'null', captureJournal: 'null',
      recPending: '[]', cancelledList: '[]', recHandoffEvents: '{}', replyNotes: '[]', notifications: '{}', updateState: 'null' },
  };
  const state = { native: { ...CACHED.native }, device: { ...CACHED.device } };
  const pending = new Map();
  let seq = 0;
  const fetched = new Map(); // id → {meta, blob}: a native take stopped and read for app.js, until recDone

  const coerce = (t, v) => t === 's' ? (v == null ? null : String(v))
    : t === 'b' ? !!v
    : t === 'i' ? Math.max(-2147483648, Math.min(2147483647, Math.trunc(Number(v)) || 0))
    : Math.trunc(Number(v)) || 0;

  function post(msg) { try { port.postMessage(JSON.stringify(msg)); return true; } catch (_) { return false; } }
  // Calls wait for this document's handshake: native refuses (and never answers) a document it has not bound.
  let resolveBound; let bound = new Promise(r => { resolveBound = r; });
  async function call(target, method, args, timeout = 150000) {
    if (status !== 'ok' && !(await Promise.race([bound, new Promise(r => setTimeout(() => r(false), 15000))]))) throw new Error('Wizard app unavailable');
    const id = 'ns-' + (++seq) + '-' + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error('Wizard app did not answer')); }, timeout);
      pending.set(id, { resolve, reject, t });
      if (!post({ v: 1, id, target, method, args })) { clearTimeout(t); pending.delete(id); reject(new Error('Wizard app unavailable')); }
    });
  }

  const hooks = {
    __wosSideButton: arg => { let v = null; try { v = JSON.parse(arg); } catch (_) {} window.__wosSideButton?.(v); },
    __wosUnsent: () => window.__wosUnsent?.(),
    __wosEverywhere: () => window.__wosEverywhere?.(),
    __wosUsuals: () => window.__wosUsuals?.(),
    __wosCutout: arg => window.__wosCutout?.(Number(arg) || 0),
    __wosTop: arg => window.__wosTop?.(Number(arg) || 0),
    'WosDevice.event': arg => { let a = null; try { a = JSON.parse(arg); } catch (_) {} if (Array.isArray(a) && window.WosDevice?.event) window.WosDevice.event(String(a[0]), a[1]); },
  };
  const run = (name, arg) => { try { hooks[name]?.(arg); } catch (e) { console.warn('[native-shell]', name, e); } };

  function applyState(next, quiet) {
    if (!next || typeof next !== 'object') return;
    const before = { ...state.native };
    for (const k of Object.keys(CACHED.native)) if (next.native && k in next.native) state.native[k] = next.native[k];
    for (const k of Object.keys(CACHED.device)) if (next.device && k in next.device) state.device[k] = next.device[k];
    if (quiet) return;
    // A change pushed from native refreshes the same UI the old evaluateJavascript hooks refreshed.
    if (before.sideButton !== state.native.sideButton) run('__wosSideButton', state.native.sideButton);
    if (before.unsent !== state.native.unsent) run('__wosUnsent');
    if (before.everywhere !== state.native.everywhere) run('__wosEverywhere');
    if (before.usuals !== state.native.usuals) run('__wosUsuals');
  }

  function onMessage(ev) {
    let m; try { m = JSON.parse(typeof ev === 'string' ? ev : ev?.data); } catch (_) { return; }
    if (!m || m.v !== 1) return;
    if (m.type === 'rebind') { rebind(); return; }
    if (m.type === 'state') { applyState(m.state); return; }
    if (m.type === 'hook') { applyState(m.state, true); if (Object.prototype.hasOwnProperty.call(hooks, m.hook)) run(m.hook, m.arg); return; }
    const w = pending.get(m.id); if (!w) return;
    pending.delete(m.id); clearTimeout(w.t);
    if (m.state) applyState(m.state);
    if (m.ok) w.resolve(m.result); else w.reject(new Error(String(m.error || 'Wizard app error')));
  }
  if (typeof port.addEventListener === 'function') port.addEventListener('message', onMessage); else port.onmessage = onMessage;

  function build(target, table) {
    const api = {};
    for (const [name, sig] of Object.entries(table)) {
      if (Object.prototype.hasOwnProperty.call(CACHED[target], name)) { api[name] = () => state[target][name]; continue; }
      api[name] = (...raw) => {
        const args = [...sig].map((t, i) => coerce(t, raw[i]));
        if (FRESH.has(name)) return call(target, name, args);
        call(target, name, args).catch(e => console.warn('[native-shell]', name, e.message));
        return name === 'clip' ? true : undefined;
      };
    }
    return api;
  }
  const nativeApi = build('native', NATIVE);
  const deviceApi = build('device', DEVICE);

  /* The async recorder surface app.js already uses for the Wizard Shell (core/device-recording.js): fetch(id) stops
   * (or claims an already-stopped take) and reads its bytes; then recStop(id) answers synchronously with the meta. */
  async function readAll(method, id, expected) {
    const parts = []; let off = 0, size = 0;
    for (let k = 0; k < 4000 && off >= 0; k++) {
      const c = JSON.parse(await call('device', method, [id, off], 30000) || 'null');
      if (!c || typeof c.b64 !== 'string' || !Number.isInteger(c.next)) throw new Error('Incomplete recording read · original kept on this phone');
      const bin = atob(c.b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      if (!u.length || (c.next !== -1 && c.next !== off + u.length)) throw new Error('Invalid recording chunk · original kept on this phone');
      parts.push(u); size += u.length; off = c.next;
    }
    if (off !== -1 || (Number(expected) > 0 && size !== Number(expected))) throw new Error('Incomplete recording · original kept on this phone');
    return new Blob(parts, { type: 'audio/aac' });
  }
  const stopFresh = deviceApi.recStop;
  Object.assign(deviceApi, {
    async: true,
    recStop(id) { const f = fetched.get(id); return f ? JSON.stringify(f.meta) : stopFresh(id); },
    recDone(id) { fetched.delete(id); call('device', 'recDone', [coerce('s', id)]).catch(() => {}); },
    async fetch(id) {
      id = String(id);
      let active = null; try { active = JSON.parse(state.device.recActive); } catch (_) {}
      let meta = null;
      if (active?.id === id) meta = JSON.parse(await call('device', 'recStop', [id], 30000) || 'null'); // stops + claims, as before
      else {
        // An already-stopped take is read WITHOUT claiming (claiming hides it from recPending after a reload).
        try { meta = (JSON.parse(await call('device', 'recPending', [], 15000) || '[]') || []).find(t => t?.id === id) || null; } catch (_) { meta = null; }
        if (!meta) meta = JSON.parse(await call('device', 'recClaim', [id], 30000) || 'null'); // claimed earlier in this process
      }
      if (!meta?.id) throw new Error('Nothing recorded');
      fetched.set(id, { meta, blob: await readAll('recRead', id, meta.bytes) });
    },
    fetched: id => fetched.get(id) || null,
    readAll,
  });

  const define = (name, api) => Object.defineProperty(window, name, { value: Object.freeze(api), configurable: false, writable: false });
  define('WizardOSNative', nativeApi);
  define('WizardOSDevice', deviceApi);

  // Handshake: native binds this document's reply proxy, then answers with its command table and state.
  let tries = 0;
  function hello() {
    const id = 'ns-hello-' + (++tries);
    const t = setTimeout(() => { pending.delete(id); if (status === 'pending') { if (tries < 8) hello(); else { status = 'unsupported'; resolveReady(false); } } }, 1500);
    pending.set(id, {
      t,
      resolve: r => {
        applyState(r?.state, true);
        const first = status === 'pending' && !rebinding;
        status = 'ok'; rebinding = false; resolveReady(true); resolveBound(true);
        if (!first) return; // a re-bind after a late navigation callback: the shell already booted on this state
        // Everything that read the empty answers while the handshake ran re-reads now.
        for (const [n, v] of [['__wosSideButton', state.native.sideButton], ['__wosUnsent'], ['__wosEverywhere'], ['__wosUsuals'],
          ['__wosCutout', String(state.native.cutoutTop)], ['__wosTop', String(state.native.insetTop)]]) run(n, v);
        window.dispatchEvent(new Event('wos-native-ready'));
        window.dispatchEvent(new Event('wos-native-resume'));
      },
      reject: () => { status = 'unsupported'; resolveReady(false); },
    });
    if (!post({ v: 1, id, method: 'hello' })) { clearTimeout(t); pending.delete(id); status = 'unsupported'; resolveReady(false); }
  }
  /* Native voided this document's binding (a navigation callback arrived after our hello). Calls in flight may or
   * may not have run, so they fail instead of being sent twice; the handshake runs again. */
  let rebinding = false;
  function rebind() {
    if (status !== 'ok' && status !== 'pending') return;
    rebinding = status === 'ok' || rebinding;
    status = 'pending';
    bound = new Promise(r => { resolveBound = r; });
    for (const [id, w] of [...pending]) { if (id.startsWith('ns-hello-')) continue; pending.delete(id); clearTimeout(w.t); w.reject(new Error('Wizard app reconnected')); }
    for (const [id, w] of [...pending]) { if (id.startsWith('ns-hello-')) { pending.delete(id); clearTimeout(w.t); } }
    tries = 0; hello();
  }
  hello();
  // Back from another app, or the page became visible again: the native side pushes fresh state on resume too.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && status === 'ok') call('native', 'platform', []).catch(() => {}); });
})();
