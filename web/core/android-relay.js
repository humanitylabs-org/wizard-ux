/* Android Apps relay: the shell's narrow door between the Android Apps view (a hosted frame) and WizardOS native.
 *
 * Hosted frames never see native interfaces. WizardOS (0.8.9+) gives the SHELL a message port,
 * window.wizardAppsPort (AndroidX addWebMessageListener, private origin, main frame only). This relay accepts
 *   {type:'wizard-os:android', id, method, params}
 * only from a frame that is (1) one of the shell's own app iframes, (2) same origin, (3) at /android-apps/, and only
 * for the allowlisted methods. Answers go back to that frame as {type:'wizard-os:android', id, ok, result|error};
 * native pushes (install status, resume) go to every Android Apps frame as {type:'wizard-os:android-push', ...}.
 * Without the port (older WizardOS, a browser), every call answers {ok:false, error:'no-bridge'} so the view can say
 * "Update WizardOS to use Android Apps".
 */
(() => {
  'use strict';
  const T = 'wizard-os:android', PUSH = 'wizard-os:android-push';
  const METHODS = new Set(['list', 'icon', 'launch', 'openPlay', 'appInfo', 'uninstall', 'install', 'status']);
  const PATH = /^\/android-apps(\/|$)/;
  const pending = new Map(); // native id → {win, id}
  let seq = 0, listening = false;
  const log = m => { window.__androidRelayLog = (window.__androidRelayLog || []).concat(m).slice(-40); };

  const port = () => window.wizardAppsPort && typeof window.wizardAppsPort.postMessage === 'function' ? window.wizardAppsPort : null;

  // The sending window must be the content window of one of the shell's own app iframes, at /android-apps/.
  function frameOk(win, origin) {
    if (!win || win === window || origin !== location.origin) return false;
    const f = [...document.querySelectorAll('iframe.appframe')].find(x => x.contentWindow === win);
    if (!f) return false;
    try { return PATH.test(win.location.pathname); } catch (e) { return false; }
  }
  function frames() {
    return [...document.querySelectorAll('iframe.appframe')].map(f => f.contentWindow).filter(w => { try { return w && PATH.test(w.location.pathname); } catch (e) { return false; } });
  }
  function reply(win, id, ok, x) { try { win.postMessage(ok ? { type: T, id, ok: true, result: x } : { type: T, id, ok: false, error: x }, location.origin); } catch (e) {} }

  function onNative(ev) {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m) return;
    if (m.type) { frames().forEach(w => { try { w.postMessage({ type: PUSH, push: m }, location.origin); } catch (e) {} }); return; }
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    reply(p.win, p.id, !!m.ok, m.ok ? m.result : (m.error || 'failed'));
  }
  function listen(pt) {
    if (listening) return;
    listening = true;
    // AndroidX ports deliver replies through onmessage (and addEventListener on newer WebViews).
    if (typeof pt.addEventListener === 'function') pt.addEventListener('message', onNative); else pt.onmessage = onNative;
  }

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.type !== T) return;
    if (!frameOk(ev.source, ev.origin)) { log('refused:frame'); return; }
    const id = String(d.id || '').slice(0, 64);
    if (!METHODS.has(d.method)) { log('refused:method:' + d.method); return reply(ev.source, id, false, 'unknown method'); }
    const pt = port();
    if (!pt) { log('no-bridge:' + d.method); return reply(ev.source, id, false, 'no-bridge'); }
    listen(pt);
    const nid = 'r' + (++seq);
    pending.set(nid, { win: ev.source, id });
    setTimeout(() => { if (pending.delete(nid)) reply(ev.source, id, false, 'timeout'); }, 20000);
    const params = d.params && typeof d.params === 'object' ? d.params : {};
    log('call:' + d.method);
    try { pt.postMessage(JSON.stringify({ id: nid, method: d.method, params })); }
    catch (e) { pending.delete(nid); reply(ev.source, id, false, 'no-bridge'); }
  });
  // The installed APK still names its legacy methods. The frozen adapter holds
  // that schema; this relay admits only the app host's registered owner/document.
  function legacySpec(source, appId) {
    const frame = [...document.querySelectorAll('iframe.appframe, iframe[data-own-app]')].find(f => f.contentWindow === source);
    if (!frame || !window.WizAppServices?.authorized(frame) || source.location.origin !== location.origin) throw new Error('Legacy device call refused');
    const path = new URL(frame.src, location.href).pathname;
    const spec = window.WizDeviceLegacy?.find(s => s.appId === appId && s.path === path && source.location.pathname === path);
    if (!spec) throw new Error('Legacy device call refused');
    return spec;
  }
  function resume() {
    for (const f of document.querySelectorAll('iframe.appframe, iframe[data-own-app]')) if (window.WizAppServices?.authorized(f)) {
      f.contentWindow.postMessage({type:'wizard-os:device-resume'}, location.origin);
    }
  }
  /* Clear chat notifications (wizard-ux issue 1276, switch wizard/clear-chat-notifications, off by default). While the
   * switch is on, the WizardOS Android app runs a notification listener (Android's Notification access) and clears a
   * chat app's own tray notification once Messenger says that chat was read (WizardApp.notifications.chatRead, served
   * by core/app-services.js). The shell turns the listener on and off with the switch, and while it is on without
   * access, shows one bar with Allow (opens Android's page). Off: nothing here runs and the listener stays disabled. */
  const CHAT_SWITCH = 'wizard/clear-chat-notifications', CHAT_RATE = 30;
  let chatWas = null, chatHidden = false, chatCalls = [], chatSettled = false;
  const chatOn = () => { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(CHAT_SWITCH); } catch (_) { return false; } };
  const chatNative = () => { const n = window.WizardOSNative; return n && typeof n.chatNotifyState === 'function' ? n : null; };
  function chatState(n) { try { return JSON.parse(n.chatNotifyState() || '{}') || {}; } catch (_) { return {}; } }
  function chatBar(show) {
    let bar = document.getElementById('wosChatNotify');
    if (!show) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'wosChatNotify'; bar.className = 'dv-update wos-chat-notify'; bar.setAttribute('role', 'status');
      const text = document.createElement('span'); text.className = 'dv-um';
      text.textContent = 'Clear chat notifications needs Android\u2019s Notification access. Wizard looks only at chat apps\u2019 notification titles, to clear the one for a chat you read in Messenger, and keeps nothing.';
      const allow = document.createElement('button'); allow.type = 'button'; allow.dataset.chatNotify = 'allow'; allow.textContent = 'Allow';
      const later = document.createElement('button'); later.type = 'button'; later.dataset.chatNotify = 'later'; later.className = 'later'; later.setAttribute('aria-label', 'Later'); later.textContent = '\u00d7';
      bar.append(text, allow, later);
      bar.addEventListener('click', e => {
        const b = e.target.closest?.('[data-chat-notify]'); if (!b) return;
        if (b.dataset.chatNotify === 'allow') { try { chatNative()?.chatNotifyAccess(); } catch (_) {} }
        chatHidden = true; chatBar(false);
      });
      document.body.appendChild(bar);
    }
    bar.hidden = false;
  }
  function chatSync() {
    const n = chatNative(); if (!n) return;
    const on = chatOn();
    // Switches are painted onto the page a little after load: an off is applied once they have settled, so a start
    // never turns the listener off and on again.
    if (!on && !chatSettled) return;
    if (on !== chatWas) { chatWas = on; try { n.chatNotifySwitch(on); } catch (_) {} if (on) chatHidden = false; }
    chatBar(on && !chatHidden && chatState(n).access === false);
  }
  function chatRead(data) {
    const n = chatNative(); if (!n || !chatOn() || !data || typeof data !== 'object') return false;
    const network = typeof data.network === 'string' ? data.network : '';
    const names = Array.isArray(data.names) ? data.names.filter(x => typeof x === 'string' && x.trim() && x.length <= 200).slice(0, 8) : [];
    if (!/^[a-z0-9_-]{1,32}$/.test(network) || !names.length) return false;
    const now = Date.now(); chatCalls = chatCalls.filter(t => now - t < 60000);
    if (chatCalls.length >= CHAT_RATE) return false;
    chatCalls.push(now);
    try { n.chatNotifyRead(JSON.stringify({ network, names })); return true; } catch (_) { return false; }
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => chatSync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  window.addEventListener('wos:experience', () => { chatSettled = true; chatSync(); });
  setTimeout(() => { chatSettled = true; chatSync(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) chatSync(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => chatSync()); else chatSync();

  /* Camera and Attach on the side-button corner orb (wizard-os issue 655, on for everyone). Android apps 0.10.49 to
   * 0.10.65 still wait to be told it is on (they kept a copy of the old switch wizard/assist-attach), so the main page
   * tells them; newer ones have no such call. */
  try { const n = window.WizardOSNative; if (n && typeof n.assistAttachSwitch === 'function') n.assistAttachSwitch(true); } catch (_) {}

  /* Side button opens the Agent chat (wizard-ux issue 1528, switch wizard/assist-agent-note, off by default). The
   * corner orb decides at the button press, before any shell page runs, so the shell copies this switch to the Android
   * app too (assist/AssistNote). An off is applied only once the switches have settled, as above. */
  const NOTE_SWITCH = 'wizard/assist-agent-note';
  let noteWas = null;
  function noteSync() {
    const n = window.WizardOSNative; if (!n || typeof n.assistNoteSwitch !== 'function') return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(NOTE_SWITCH); } catch (_) {}
    if (!on && !chatSettled) return;
    if (on === noteWas) return;
    noteWas = on; try { n.assistNoteSwitch(on); } catch (_) {}
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => noteSync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  window.addEventListener('wos:experience', () => { chatSettled = true; noteSync(); });
  setTimeout(() => { chatSettled = true; noteSync(); }, 5000);
  noteSync();

  /* App windows (wizard-os issue 650, on for everyone). In the Android app, a link to a Wizard app (a chat link, a link
   * inside another app, a notification's Open) opens that app's own Android window: the one its home-screen icon
   * opens, pinned or not. Back at the app's start returns to where the link was. Links to Wizard's own pages (home,
   * chats, threads) stay in the main window. Android apps 0.10.50 to 0.10.64 still wait to be told it is on (they
   * kept a copy of the old switch wizard/app-windows), so the main page tells them; newer ones have no such call. */
  try { const n = window.WizardOSNative; if (n && typeof n.appWindowsSwitch === 'function' && !window.WizHomeScreenPolicy?.mode) n.appWindowsSwitch(true); } catch (_) {}

  /* Phone notifications per app (wizard-ux issue 1567, switch wizard/phone-app-notifications, off by default). The
   * Android app reads the Notifications app and posts each new item under its own app, on an Android channel per app.
   * The main page copies the switch there with the installed apps' names (the channels' names); off once settled. */
  const NOTIFY_SWITCH = 'wizard/phone-app-notifications';
  let notifyWas = null;
  function notifyNames() {
    const out = {};
    try { for (const a of window.WizCore?.apps?.('mobile')?.APPS || []) if (a && /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(a.id || '')) && a.name) out[a.id] = String(a.name).slice(0, 40); } catch (_) {}
    return JSON.stringify(out);
  }
  function notifySync() {
    const n = window.WizardOSNative; if (!n || typeof n.appNotifySwitch !== 'function' || window.WizHomeScreenPolicy?.mode) return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(NOTIFY_SWITCH); } catch (_) {}
    if (!on && !chatSettled) return;
    const names = on ? notifyNames() : '', key = on + '|' + names;
    if (key === notifyWas) return;
    notifyWas = key; try { n.appNotifySwitch(on, names); } catch (_) {}
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => notifySync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  /* Box-to-phone push (wizard-ux issue 1618, switch wizard/phone-push, off by default). On top of the switch above, the
   * Android app keeps one line to this Wizard's Notifications app open (over Tailscale, no Google) and reads each new
   * item at once, also while the phone is locked. The main page copies the switch there; off once settled. */
  // Off is only sent once the page's switches have surely settled (5 s): the first wos:experience can come before this
  // device's own switches are applied, and an early off would stop and restart the phone's line on every open.
  const PUSH_SWITCH = 'wizard/phone-push';
  let pushWas = null, pushSettled = false;
  function pushSync() {
    const n = window.WizardOSNative; if (!n || typeof n.appPushSwitch !== 'function' || window.WizHomeScreenPolicy?.mode) return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(PUSH_SWITCH); } catch (_) {}
    if (!on && !pushSettled) return;
    if (on === pushWas) return;
    pushWas = on; try { n.appPushSwitch(on); } catch (_) {}
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => pushSync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  window.addEventListener('wos:experience', () => { chatSettled = true; notifySync(); pushSync(); });
  setTimeout(() => { chatSettled = true; pushSettled = true; notifySync(); pushSync(); }, 5000);
  notifySync();
  pushSync();
  /* Location for the apps that ask for it (wizard-ux issue 1629, switch wizard/app-location, off by default). The shell
   * decides which app frame may ask (core/apps.js frameAllow); the Android app then shows Android's own location
   * prompt and answers only for this Wizard's address, and only while the switch is on. The main page copies the switch
   * to the Android app (an app window's page never sees the shell's switches); off is applied once settled. */
  const LOCATION_SWITCH = 'wizard/app-location';
  let locationWas = null;
  function locationSync() {
    const n = window.WizardOSNative; if (!n || typeof n.appLocationSwitch !== 'function' || window.WizHomeScreenPolicy?.mode) return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(LOCATION_SWITCH); } catch (_) {}
    if (!on && !chatSettled) return;
    if (on === locationWas) return;
    locationWas = on; try { n.appLocationSwitch(on); } catch (_) {}
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => locationSync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  window.addEventListener('wos:experience', () => { chatSettled = true; locationSync(); });
  setTimeout(() => { chatSettled = true; locationSync(); }, 5000);
  locationSync();
  /* Instant home-screen apps (wizard-ux issue 1830, switch wizard/pin-instant-open, off by default). A home-screen app
   * window is a new Android window with its own page, so the Android app does the work (PinInstant): skip Connecting
   * when Wizard was just reached, show the app's last screen at once, keep app files on the phone. The main page copies
   * the switch there; off once settled. */
  const PIN_SWITCH = 'wizard/pin-instant-open';
  let pinWas = null;
  function pinSync() {
    const n = window.WizardOSNative; if (!n || typeof n.pinInstantSwitch !== 'function' || window.WizHomeScreenPolicy?.mode) return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(PIN_SWITCH); } catch (_) {}
    if (!on && !chatSettled) return;
    if (on === pinWas) return;
    pinWas = on; try { n.pinInstantSwitch(on); } catch (_) {}
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => pinSync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  window.addEventListener('wos:experience', () => { chatSettled = true; pinSync(); });
  setTimeout(() => { chatSettled = true; pinSync(); }, 5000);
  pinSync();
  /* One UI-style icon count (wizard-ux issue 1669, switch wizard/phone-badge-look, off by default). The Messenger
   * home-screen icon's count is drawn by the Android app (badge/BadgeLook): exact digits up to 999 in a ringless
   * orange-red badge at the tile's corner. The main page copies the switch there; off once settled. */
  const BADGE_SWITCH = 'wizard/phone-badge-look';
  let badgeWas = null;
  function badgeSync() {
    const n = window.WizardOSNative; if (!n || typeof n.badgeLookSwitch !== 'function' || window.WizHomeScreenPolicy?.mode) return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(BADGE_SWITCH); } catch (_) {}
    if (!on && !chatSettled) return;
    if (on === badgeWas) return;
    badgeWas = on; try { n.badgeLookSwitch(on); } catch (_) {}
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => badgeSync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  window.addEventListener('wos:experience', () => { chatSettled = true; badgeSync(); });
  setTimeout(() => { chatSettled = true; badgeSync(); }, 5000);
  badgeSync();
  /* Recovery mode (wizard-ux issue 1775, switch wizard/phone-recovery-mode, off by default). When a start of the Android
   * app froze or never finished, the next start opens with the shell only (meeting recording and uploads paused) and a
   * native card: Check for update, Send diagnostics, Start normally. That is decided before any page loads, so the main
   * page copies the switch to the Android app; off once settled. */
  const RECOVERY_SWITCH = 'wizard/phone-recovery-mode';
  let recoveryWas = null;
  function recoverySync() {
    const n = window.WizardOSNative; if (!n || typeof n.recoveryModeSwitch !== 'function' || window.WizHomeScreenPolicy?.mode) return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(RECOVERY_SWITCH); } catch (_) {}
    if (!on && !chatSettled) return;
    if (on === recoveryWas) return;
    recoveryWas = on; try { n.recoveryModeSwitch(on); } catch (_) {}
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => recoverySync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
  }
  window.addEventListener('wos:experience', () => { chatSettled = true; recoverySync(); });
  setTimeout(() => { chatSettled = true; recoverySync(); }, 5000);
  recoverySync();
  // The installed Wizard app a page of this Wizard belongs to (the longest app address it lies under), or the app a
  // shell link names (…/wizard-os-home/?open=<id>). Wizard's own pages and anything else: null.
  function appOfLink(u) {
    const P = window.WizHomeScreenPolicy, reg = window.WizCore?.apps?.('mobile'), DL = window.WizCore?.deeplink;
    if (!P || !reg || !u || u.origin !== location.origin) return null;
    const ok = a => !!a && a.kind === 'wizard' && typeof a.url === 'string' && !!a.url && !P.isShell(a.url) && P.within(a.url, a.url);
    if (P.isShell(u.href)) { const id = DL?.isOwn?.(u) ? DL.parse(u.href)?.open : ''; const a = id ? reg.APP?.[id] : null; return ok(a) ? { app: a, path: '' } : null; }
    let best = null;
    for (const a of reg.APPS || []) if (ok(a) && P.within(u.href, a.url) && (!best || a.url.length > best.url.length)) best = a;
    return best ? { app: best, path: u.pathname + u.search + u.hash } : null;
  }
  // Open an app's own window (path: a page inside it, '' = where it was). True when the Android app opened it.
  function openAppWindow(id, path = '') {
    const n = window.WizardOSNative, P = window.WizHomeScreenPolicy;
    if (!n || typeof n.openAppWindow !== 'function' || !P) return false;
    const a = window.WizCore?.apps?.('mobile')?.APP?.[id];
    if (!a || a.kind !== 'wizard' || !a.url || P.isShell(a.url)) return false;
    let rel = '';
    if (path) {
      let u; try { u = new URL(path, location.href); } catch (_) { return false; }
      if (u.origin !== location.origin || !P.within(u.href, a.url)) return false;
      rel = u.pathname + u.search + u.hash;
    }
    if (P.mode && P.id === a.id) return false; // already this app's window: the link stays in it
    try { return n.openAppWindow(a.id, rel, P.displayName(a) || '') === true; } catch (_) { return false; }
  }
  // A tapped link (core/links.js): true when it opened an app's own window.
  function appLink(href) {
    if (typeof window.WizardOSNative?.openAppWindow !== 'function') return false;
    let u; try { u = new URL(href, location.href); } catch (_) { return false; }
    const hit = appOfLink(u); return !!hit && openAppWindow(hit.app.id, hit.path);
  }

  window.WizAndroidRelay = { METHODS, frameOk, available: () => !!port(), resume, chatRead, openAppWindow, appLink,
    legacy(source, appId, method, args = []) {
      const spec = legacySpec(source, appId);
      if (!spec.methods.includes(method) || !Array.isArray(args) || args.length > 3 || args.some(x => x !== null && !['string', 'number', 'boolean'].includes(typeof x))) throw new Error('Unknown legacy device method');
      const native = window.WizardOSNative;
      if (typeof native?.[method] !== 'function') throw new Error('no-bridge');
      return native[method](...args);
    },
    legacyAvailable(source, appId, method) {
      try { const spec = legacySpec(source, appId); return method === spec.probe && typeof window.WizardOSNative?.[method] === 'function'; }
      catch (_) { return false; }
    }
  };
})();
