/* Failure-only connectivity diagnosis, independent of Agent Service/Hermes.
 * No healthy polling: consumers call failure() only while a read/send is failing.
 */
(() => {
  'use strict';
  const order = ['gateway', 'signin', 'shell', 'agent-service', 'hermes'];
  // Browser onLine is only a scheduling hint, never evidence of absent internet.
  let epoch = 0;
  const result = (layer, message, short) => ({ layer, message, short, action: 'troubleshoot' });
  const RECONNECTING = 'Reconnecting…';
  const pending = result('checking', 'Checking the connection to Wizard. Messages are kept on this device while we retry.', RECONNECTING);
  let cached = null, cachedAt = 0, work = null, failureAt = -Infinity;
  async function request(url, options = {}, json = false) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => { const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal }); return json ? { response, body: response.ok ? await response.json() : null } : response; })(),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(Object.assign(new Error('Diagnosis timed out'), { code: 'diagnosis_timeout' })); controller.abort(); }, 4000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function probe(observedPing) {
    let ping;
    try { ping = observedPing || await request('/troubleshoot/api/ping'); }
    catch (_) {
      // Success is positive evidence; failure (including CSP blocking) is unknown.
      const net = await internetProbe();
      const ts = /\.ts\.net$/i.test(String(location.hostname || ''));
      return result(ts ? 'tailscale' : 'unreachable', connectionHelp(net.ok, ts), 'Can’t reach Wizard · retrying');
    }
    // An HTTP error proves the server is reachable; never blame the device/VPN.
    if (!ping.ok) return result('gateway', `Wizard’s gateway answered (${ping.status}), but Troubleshooter isn’t available. Messages are kept while we retry.`, RECONNECTING);
    try {
      const { response, body } = await request('/troubleshoot/api/status', {}, true);
      if (!response.ok || !Array.isArray(body.checks)) throw new Error('Invalid status');
      rememberDirect(body);
      // Repair-chat engine probes (reply-claude/chatgpt/tinfoil) say whether Troubleshooter's own AI can answer;
      // they never explain why Wizard is unreachable, so the connection pill must not blame them (James, 27 Oct).
      const relevant = check => !check.ok && !check.skipped && !String(check.id || '').startsWith('reply-');
      const failed = body.checks.filter(relevant).sort((a, b) => {
        const rank = id => order.includes(id) ? order.indexOf(id) : order.length;
        return rank(a.id) - rank(b.id);
      })[0];
      if (failed) {
        const labels = { gateway: 'Wizard’s gateway isn’t responding.', signin: 'Wizard sign-in needs attention.', shell: 'Wizard’s shell isn’t responding.', 'agent-service': 'Wizard’s Agent Service isn’t answering right now.', hermes: 'Your agent (Hermes) isn’t answering right now.' };
        const message = labels[failed.id], selfHeals = ['agent-service', 'hermes'].includes(failed.id);
        // While we are retrying, the one-line pill says what is happening (reconnecting), not an alarm; the
        // unfolded line names the layer. Only sign-in asks the owner to act (James, 27 Oct).
        const short = failed.id === 'signin' ? 'Sign-in needs attention · retrying' : RECONNECTING;
        return result(failed.id, message ? message + (selfHeals ? ' It usually comes back on its own within a minute; messages wait and send afterwards. Open Troubleshooter if it doesn’t.' : ' Open Troubleshooter to check it.') : `${failed.label || failed.id}: ${failed.detail || 'Needs attention'}`, short);
      }
      if (body.overall === 'down') return result('wizard', body.summary || 'Wizard reports a problem. Open Troubleshooter to check it.', RECONNECTING);
    } catch (e) {
      if (e?.code === 'diagnosis_timeout') return result('busy', 'Your Wizard is busy and answering slowly. Messages are kept on this device and send by themselves.', RECONNECTING);
      return result('diagnosis', 'Wizard’s gateway is reachable, but its health report isn’t available. Open Troubleshooter to check it. Messages are kept while we retry.', RECONNECTING); }
    // Healthy probes prove reachability, not why a separate read/send failed or
    // whether anything was admitted. The shared result stays request-neutral;
    // label('send') alone words it as a saved message (PR689 review).
    return result('send', 'Wizard’s connection checks passed. Retrying automatically; these checks don’t show whether the request went through.', 'Wizard reachable · retrying');
  }
  /** The one short line for a failing request. operation is 'send' (a saved outbound message, count of them) or
   *  'read'. Only a confirmed-healthy diagnosis differs: a send names the unsent message instead of the connection,
   *  a read stays neutral. Any real outage, or no diagnosis yet, keeps its connection wording for both. */
  function label(operation, { count = 1, diagnosis } = {}) {
    // Graceful restart (switch wizard/graceful-restart): a send that hit the restart is saved, not refused.
    if (!diagnosis && operation === 'send' && restartState()) return count > 1 ? `${count} messages saved · send after Wizard restarts` : 'Saved · sends after Wizard restarts';
    const d = diagnosis || window.WizReach.failure();
    if (operation === 'send' && d.layer === 'send') return count > 1 ? `${count} messages not sent · retrying` : 'Message not sent · retrying';
    return d.short;
  }
  function publish(value, generation) {
    if (generation !== epoch) return value;
    const changed = JSON.stringify(value) !== JSON.stringify(cached);
    cached = value; cachedAt = Date.now();
    if (changed) window.dispatchEvent(new Event('wizreachchange'));
    return value;
  }
  function diagnose(maxAge = 10000, observedPing) {
    if (work && maxAge !== 0) return work;
    if (cached && Date.now() - cachedAt < maxAge) return Promise.resolve(cached);
    const generation = ++epoch;
    const next = probe(observedPing).then(value => publish(value, generation)).finally(() => { if (work === next) work = null; });
    work = next; return next;
  }
  /* The three checks the offline pop-up shows (core/status.js), run only while something is already failing:
   *   internet   one tiny request to Tailscale's own connectivity check (a 204 with no body; this device already
   *              talks to Tailscale). The only cross-site request the shell makes; CSP allows exactly this URL.
   *   tailscale  does Wizard's address answer at all (any HTTP answer counts)?
   *   wizard     is Wizard healthy once reached (its own status report, the same diagnosis as above)?
   * Each is { state: 'ok'|'slow'|'bad'|'wait'|'skip', ms, detail }. A slow answer is timed, never a speed test:
   * no megabytes on the connections this exists for. */
  const INTERNET = 'https://derp1.tailscale.com/generate_204', SLOW_MS = 1500;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  async function timed(run) {
    const t = now();
    try { const r = await run(); return { ok: true, ms: Math.round(now() - t), r }; }
    catch (_) { return { ok: false, ms: Math.round(now() - t) }; }
  }
  const secs = ms => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  const slowLink = () => ['slow-2g', '2g'].includes(navigator.connection?.effectiveType);
  const connectionHelp = (internet, ts) => (internet ? 'Internet works, but we can’t reach your Wizard. ' : 'Can’t reach your Wizard. Check this device’s internet connection. ')
    + (ts ? 'Open the Tailscale app and check it’s connected and signed in to the same account as your Wizard. Check that the computer running your Wizard is on. ' : 'Check that the computer running your Wizard is on. ')
    + 'Messages stay saved on this device and send when the connection returns.';
  async function internetProbe() {
    return timed(async () => {
      // Cross-origin no-cors + redirect=error/manual is a Fetch network error even
      // for a nonredirecting 204. CSP still confines this credential-free request.
      const r = await request(INTERNET, { mode: 'no-cors', credentials: 'omit', redirect: 'follow' });
      if (!r.ok && r.type !== 'opaque') throw Error('Public check not confirmed');
      return r;
    });
  }
  async function checks() {
    // Only publish observations from the latest check. A newer focus/network/read check supersedes this one.
    const generation = ++epoch;
    const [net, ping] = await Promise.all([
      internetProbe(), timed(() => request('/troubleshoot/api/ping')),
    ]);
    const ts = /\.ts\.net$/i.test(String(location.hostname || ''));
    const out = { tailnet: ts, hostReachable: ping.ok };
    const speed = r => (r.ms > SLOW_MS || slowLink()) ? { state: 'slow', ms: r.ms, detail: `Slow · ${secs(r.ms)}` } : { state: 'ok', ms: r.ms, detail: `Working · ${secs(r.ms)}` };
    out.internet = net.ok ? speed(net) : { state: 'skip', ms: 0, detail: 'Unknown · public check didn’t answer' };
    if (ping.ok) {
      out.tailscale = { ...speed(ping), detail: `Wizard’s address answered · ${secs(ping.ms)}` };
      const d = await probe(ping.r);
      publish(d, generation);
      out.wizard = d.layer === 'send' ? { state: 'ok', ms: 0, detail: 'Healthy' } : d.layer === 'busy' ? { state: 'slow', ms: 0, detail: 'Busy · answering slowly', layer: 'busy' } : { state: 'bad', ms: 0, detail: d.message, layer: d.layer };
      out.help = d.message;
    } else {
      out.tailscale = { state: 'bad', ms: 0, detail: ts ? 'Not confirmed · check Tailscale' : 'Can’t reach your Wizard’s address' };
      out.wizard = { state: 'wait', ms: 0, detail: 'Waiting for the connection' };
      out.help = connectionHelp(net.ok, ts);
      publish(result(ts ? 'tailscale' : 'unreachable', out.help, 'Can’t reach Wizard · retrying'), generation);
    }
    out.stale = generation !== epoch;
    return out;
  }
  /* Direct line: Troubleshooter's own HTTPS port on this same Wizard address (Tailscale Serve → Troubleshooter's
   * process, nothing else), for when the gateway route, the shell backend, the Agent Service or Hermes is stuck.
   * The address comes from Troubleshooter's own status report when we last saw it, else the standard port 9691. */
  const DIRECT_KEY = 'wz.troubleshoot.direct';
  function directBase() {
    try { const u = new URL(localStorage.getItem(DIRECT_KEY) || ''); if (u.protocol === 'https:' && u.hostname === location.hostname && u.pathname === '/troubleshoot/') return { base: `${u.origin}/troubleshoot/`, confirmed: true }; } catch (_) {}
    if (/\.ts\.net$/i.test(String(location.hostname || ''))) return { base: `https://${location.hostname}:9691/troubleshoot/`, confirmed: false };
    return { base: '', confirmed: false };
  }
  function directUrl(target) {
    const { base } = directBase();
    return base && base + (typeof target === 'string' && target.startsWith('/troubleshoot/') ? target.slice(14) : '');
  }
  let openedAt = -Infinity;
  function rememberDirect(body) { try { if (typeof body?.direct === 'string') localStorage.setItem(DIRECT_KEY, body.direct); } catch (_) {} }
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Browser owner boundary (wizard-os#133, core/browser-boundary.js): with the box switch on, the repair page runs
  // sandboxed like every app page (it shows repair chat output), so the shell can't read it; it proves it loaded by
  // answering on the boundary channel instead. Off (the default): exactly as before.
  const boundary = () => (window.WizBrowserBoundary?.enabled ? window.WizBrowserBoundary : null);
  // Local entry is part of the cached shell, not a second app or a remote preflight.
  function recoveryHtml() {
    return `<section class="wz-recovery" data-recovery><details open><summary>Connection help</summary><div class="wz-recovery-help"><h2>Can’t reach your Wizard?</h2><p data-recovery-message>Check this device’s internet connection. On a Tailscale address, open the Tailscale app and check it’s connected. Your saved chats stay on this device.</p><ul class="wz-list" data-recovery-rows><li class="wz-row">Internet · Not checked</li><li class="wz-row">Your Wizard’s connection · Not checked</li><li class="wz-row">Wizard · Not checked</li></ul><button type="button" class="wz-button" data-recovery-check>Check again</button><p data-recovery-remote>Repair buttons and repair chat need a connection to your Wizard. Local connection help is available here.</p><p data-recovery-direct hidden><a class="wz-button" data-recovery-direct-link target="_blank" rel="noopener">Open Troubleshooter directly</a> It has its own line to your Wizard, so it works even when Wizard itself is stuck.</p></div></details><iframe class="appframe" data-own-app="troubleshooter" title="Troubleshooter" hidden${boundary() ? ' ' + boundary().frameAttributes('/troubleshoot/') : ''} allow="clipboard-read; clipboard-write" referrerpolicy="same-origin"></iframe></section>`;
  }
  const recoveries = new Set(), retaps = new Set();
  function mountRecovery(root, url) {
    if (!root || root._recovery) return;
    // Provider reconnect links carry their sign-in workflow in this query. Keep it through local-first checks.
    const target = typeof url === 'string' && /^\/troubleshoot\/(?:[?#]|$)/.test(url) ? url : '/troubleshoot/';
    root._recovery = true;
    const frame = root.querySelector('iframe'), details = root.querySelector('details'), button = root.querySelector('[data-recovery-check]');
    const direct = root.querySelector('[data-recovery-direct]'), directLink = root.querySelector('[data-recovery-direct-link]');
    let serial = 0, timer, loadTimer, remoteReady = false, remoteLoading = false, last, stale = 0;
    const connected = () => root.isConnected;
    const remoteMessage = text => { root.querySelector('[data-recovery-remote]').textContent = text; };
    // The way out when the repair page can't load in this window: its direct line, one tap away.
    // On the phone, a tap on Open Troubleshooter that can't load here goes straight to the direct line, once its
    // address has been confirmed by Troubleshooter itself; otherwise the button is offered.
    const desktop = () => { try { return document.documentElement.dataset.shell === 'desktop'; } catch (_) { return false; } };
    const offerDirect = () => {
      const url = directUrl(target); if (!url || remoteReady || !connected()) return;
      directLink.href = url; if (!desktop()) directLink.removeAttribute?.('target');
      direct.hidden = false; details.open = true;
      if (!desktop() && directBase().confirmed && Date.now() - openedAt < 20000) { openedAt = -Infinity; location.assign(url); }
    };
    const failed = text => { clearTimeout(loadTimer); remoteLoading = false; frame.hidden = true; remoteReady = false; root.classList.remove('repair-ready'); details.open = true; remoteMessage(text); offerDirect(); };
    const showRepair = () => {
      remoteReady = true; frame.hidden = false; root.classList.add('repair-ready'); details.open = false; direct.hidden = true;
      if (last?.wizard?.state === 'ok') clearTimeout(timer);
      remoteMessage('Connected. The repair home and repair chat are below.');
    };
    const sealed = !!boundary() && frame.hasAttribute('sandbox');
    let readyTimer;
    if (sealed) {
      boundary().attach(frame);
      // The repair page's own answer on this load's channel is the proof (an error page never answers).
      frame.addEventListener('wizard:boundary-ready', () => {
        if (!connected() || !frame.getAttribute('src')) return;
        remoteLoading = false; clearTimeout(loadTimer); clearTimeout(readyTimer);
        showRepair();
      });
    }
    frame.addEventListener('load', () => {
      if (!frame.getAttribute('src')) return; // initial about:blank is not a failed repair-page load
      if (sealed) {
        // Every load is a new document that must answer again (the channel was just renewed), also after the page
        // once answered: a reload or in-frame step that lands on an error page never answers. 8 s, then local help.
        if (boundary().ready(frame)) return;
        clearTimeout(readyTimer);
        readyTimer = setTimeout(() => { if (connected() && !boundary().ready(frame)) failed('The repair page didn’t load. Local connection help is still available.'); }, 8000);
        return;
      }
      remoteLoading = false; clearTimeout(loadTimer);
      try {
        const doc = frame.contentDocument;
        // The loaded document itself is the proof; it never waits on the connection checks.
        if (!connected() || !doc || !/\/troubleshoot\//.test(doc.location.pathname) || !doc.querySelector('header h1')) throw Error('Repair page unavailable');
        showRepair();
      } catch (_) { failed('The repair page didn’t load. Local connection help is still available.'); }
    });
    // Load the repair page straight away, alongside the checks: a tap on Open Troubleshooter shows it as soon as
    // its own route answers, however long Wizard's health checks take (8 Nov 2026: they kept restarting while
    // Wizard was stuck, so the page never opened). Anything slower than 8 s offers the direct line.
    function loadRepair() {
      if (!connected() || remoteReady || remoteLoading) return;
      remoteLoading = true; clearTimeout(loadTimer);
      loadTimer = setTimeout(() => { if (remoteLoading && !remoteReady) offerDirect(); }, 8000);
      request(target, { method: 'HEAD' }).then(r => {
        if (!connected()) { remoteLoading = false; return; }
        if (!r.ok) throw Error('Repair page unavailable');
        frame.src = target;
      }).catch(() => failed('The repair page isn’t answering on Wizard’s usual address.'));
    }
    async function run() {
      if (!connected()) { clearTimeout(timer); recoveries.delete(run); return; }
      const id = ++serial; clearTimeout(timer); button.disabled = true; button.textContent = 'Checking…';
      const c = await checks();
      if (!connected() || id !== serial) return;
      // A newer check superseded this one: retry a few times, then show what we have instead of spinning forever.
      if (c.stale && ++stale < 3) { timer = setTimeout(run, 0); return; }
      stale = 0; last = c; button.disabled = false; button.textContent = 'Check again';
      root.querySelector('[data-recovery-message]').textContent = c.help;
      root.querySelector('[data-recovery-rows]').innerHTML = [['internet', 'Internet'], ['tailscale', c.tailnet ? 'Tailscale / private connection' : 'Your Wizard’s connection'], ['wizard', 'Wizard']].map(([key, title]) => `<li class="wz-row" data-recovery-row="${key}"><span class="wz-main"><b>${esc(title)}</b><small>${esc(c[key].detail)}</small></span></li>`).join('');
      // A host HTTP error is not proof the repair page loaded. Keep help visible until its actual document loads.
      if (c.hostReachable) loadRepair();
      // A repair page that already loaded stays: a later failed probe never hides working repair controls.
      if (!c.hostReachable && !remoteReady) failed('Repair buttons and repair chat need a connection to your Wizard. Local connection help is available here.');
      if (c.wizard.state === 'ok') window.WizLive?.refresh?.();
      // Only the open failing recovery window polls; healthy checks stop. Outbox retains sole retry ownership.
      if (c.wizard.state !== 'ok' || !remoteReady) timer = setTimeout(run, 15000);
    }
    button.addEventListener('click', run);
    recoveries.add(run);
    // A fresh Open Troubleshooter tap that reuses this already-open window reruns the fallback at once: an offered
    // direct line is followed (phone, confirmed address) and a failed repair page is tried again.
    retaps.add(function retap() {
      if (!connected()) { retaps.delete(retap); return; }
      if (remoteReady) return;
      if (!direct.hidden) offerDirect();
      loadRepair();
    });
    // Mount and paint the ordinary window before any diagnostic work starts.
    requestAnimationFrame(() => setTimeout(() => { loadRepair(); run(); }, 0));
  }
  if (typeof addEventListener === 'function') {
    for (const event of ['online', 'offline', 'focus', 'visibilitychange']) addEventListener(event, () => {
      ++epoch; cachedAt = 0; work = null;
      if (!document.hidden) for (const run of recoveries) run();
      if (!recoveries.size && cached && cached.layer !== 'send') diagnose(0);
    });
  }
  // ↻ on the Troubleshooter window: reload the repair page where it is. A sandboxed page can't be read or told to
  // reload by the shell, so it is loaded again from its address.
  function reloadRepair(frame) {
    if (!frame || frame.hidden) return;
    try { frame.contentWindow.location.reload(); } catch (_) { const src = frame.getAttribute('src'); if (src) frame.src = src; }
  }
  /* Graceful Agent Service restart (wizard-ux issue 1362, switch wizard/graceful-restart, off by default; the box
   * side is wizard-agent-service docs/graceful-restart.md). The only healthy polling here, and only while the switch
   * is on: /wizard/health carries `restart` while a restarter holds new sends until running chats finish. That read
   * never renews the restarter's lease (GET /wizard/v1/restart would), so a crashed restarter still loses its hold.
   * The owner's choice when it is overdue goes back as POST /wizard/v1/restart: wait_s (wait longer) or now. */
  const RESTART_SWITCH = 'wizard/graceful-restart', RESTART_GRACE = 3 * 60000;
  const restartOn = () => { try { return String(document.documentElement.dataset.tweaks || '').split(' ').includes(RESTART_SWITCH); } catch (_) { return false; } };
  let restart = null, restartDownAt = 0, restartTimer = 0, restartAsk = '', restartPolledAt = 0;
  const restartPick = h => ({ phase: ['waiting', 'ready', 'overdue'].includes(h.phase) ? h.phase : 'waiting',
    active: Number.isFinite(h.active) ? h.active : null, held: Number(h.held) || 0, oldest: Number(h.oldest_active_s) || 0,
    waitUntil: typeof h.wait_until === 'string' ? h.wait_until : '', now: h.restart_now === true });
  /** The restart the shell knows of, or null (switch off, none, or gone for longer than a restart takes). While the
   *  service is down right after a hold, phase is 'restarting'. */
  function restartState() {
    if (!restartOn() || !restart) return null;
    if (restartDownAt) {
      if (Date.now() - restartDownAt > RESTART_GRACE) { restart = null; restartDownAt = 0; return null; }
      return { ...restart, phase: 'restarting' };
    }
    return restart;
  }
  function restartChanged() {
    window.dispatchEvent?.(new Event('wizreachchange'));
    try { window.WosOutbox?.paintNotice?.(); } catch (_) {}
  }
  function restartSet(next, downAt) {
    const before = JSON.stringify([restart, restartDownAt > 0]);
    restart = next; restartDownAt = downAt;
    if (JSON.stringify([restart, restartDownAt > 0]) !== before) restartChanged();
  }
  async function restartPoll() {
    clearTimeout(restartTimer); restartTimer = 0; restartPolledAt = Date.now();
    if (!restartOn()) { if (restart) restartSet(null, 0); return; }
    if (!document.hidden) {
      try {
        const { response, body } = await request('/wizard/health', {}, true);
        if (!response.ok || !body) throw new Error('health ' + response.status);
        const h = body.restart;
        restartSet(h && h.holding === true ? restartPick(h) : null, 0);
      } catch (_) {
        // Down right after a hold: the restart itself. Without a hold seen first, a failing read is the ordinary
        // connection story (failure() below), never a restart.
        if (restart && !restartDownAt) restartSet(restart, Date.now());
      }
    }
    // Windows and composers open and close between polls: repaint the note where it belongs now.
    if (restart) try { window.WosOutbox?.paintNotice?.(); } catch (_) {}
    if (restartOn()) restartTimer = setTimeout(restartPoll, restart ? 5000 : 30000);
  }
  async function restartChoose(choice) {
    if (!restartOn() || !restart || restartAsk) return false;
    restartAsk = choice; restartChanged();
    try {
      const response = await fetch('/wizard/v1/restart', { method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choice === 'now' ? { now: true } : { wait_s: 600 }) });
      if (response.ok) { const body = await response.json().catch(() => null); if (body?.holding) restartSet(restartPick(body), 0); }
      return response.ok;
    } catch (_) { return false; }
    finally { restartAsk = ''; restartChanged(); void restartPoll(); }
  }
  // Names of the chats still running, from the shell's own list (health carries counts only, never thread ids).
  function restartRunning() {
    try {
      const rows = window.WizLive?.unified?.() || [];
      return rows.filter(s => s && !s.archived && ['running', 'stopping'].includes(s.status)).map(s => String(s.title || 'Untitled chat'));
    } catch (_) { return []; }
  }
  function restartNoticeHtml() {
    const st = restartState();
    if (!st) return '';
    const n = st.held;
    const saved = n ? ` · ${n === 1 ? '1 message' : n + ' messages'} saved, sent after the restart` : ' · new messages are saved and sent after the restart';
    if (st.phase === 'restarting') return `<b>Wizard is restarting</b><span>Messages are saved and send by themselves.</span>`;
    if (st.now) return `<b>Restarting now</b><span>Chats still running are stopped; your messages are saved.</span>`;
    if (st.phase !== 'overdue') return `<b>Restarting when chats finish</b><span>${esc(saved.slice(3))}</span>`;
    const names = restartRunning(), count = st.active ?? names.length;
    const list = names.slice(0, 3).map(t => `“${esc(t)}”`).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');
    const busy = restartAsk ? ' disabled' : '';
    return `<b>Wizard wants to restart</b><span>${count === 1 ? '1 chat is' : `${count || 'Some'} chats are`} still running${list ? ': ' + list : ''}.</span>`
      + `<span class="rs-acts"><button type="button" data-restart-choice="wait"${busy}>Wait longer</button><button type="button" data-restart-choice="now"${busy}>Restart now</button></span>`;
  }
  /** Called by the outbox's notice painter with the visible composer/voice-dock hosts. */
  function paintRestart(hosts) {
    if (!document.body) return;
    const html = restartNoticeHtml();
    for (const el of document.querySelectorAll('[data-restart-notice]')) if (!html || !hosts.includes(el.parentElement)) el.remove();
    if (!html) return;
    for (const host of hosts) {
      let el = host.querySelector('[data-restart-notice]');
      if (!el) {
        el = document.createElement('div'); el.dataset.restartNotice = ''; el.className = 'ch-restart-notice';
        el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
        el.addEventListener('click', e => { const b = e.target.closest?.('[data-restart-choice]'); if (b && !b.disabled) void restartChoose(b.dataset.restartChoice); });
        host.appendChild(el);
      }
      if (el.innerHTML !== html) el.innerHTML = html;
    }
  }
  window.addEventListener?.('wos:tweak-choice', () => { setTimeout(() => { void restartPoll(); }, 0); });
  globalThis.document?.addEventListener?.('visibilitychange', () => { if (!document.hidden && restartOn()) void restartPoll(); });
  if (restartOn()) void restartPoll();
  window.WizReach = {
    diagnose,
    reloadRepair,
    recoveryHtml,
    mountRecovery,
    checks,
    label,
    directUrl,
    restart: restartState,
    restartChoose,
    paintRestart,
    failure() {
      // A send or read that fails while the Agent Service restarts says so calmly, without a connection hunt.
      // A failure during a known hold is most likely the restart itself: look now instead of at the next poll.
      if (restartState() && !restartDownAt && Date.now() - restartPolledAt > 2000) void restartPoll();
      if (restartState()?.phase === 'restarting') return result('restarting', 'Wizard is restarting its Agent Service. Messages are saved on this device and send by themselves when it is back.', 'Restarting · messages saved');
      if (Date.now() - failureAt >= 15000) { failureAt = Date.now(); diagnose(); }
      return cached || pending;
    },
    // Troubleshooter is an ordinary built-in app: open it in a shell window like any other app. Leaving the shell
    // for the bare page is only the last resort, when the shell can't open windows at all.
    open() {
      openedAt = Date.now();
      // Windows mounted before this tap; a window this tap mounts runs its own first load after paint.
      const reused = [...retaps];
      try { if (window.WizOpenApp?.('troubleshooter')) { for (const retap of reused) try { retap(); } catch (_) {} return true; } } catch (e) {}
      if (document.documentElement.dataset.shell === 'desktop') window.open('/troubleshoot/', '_blank', 'noopener');
      else location.assign('/troubleshoot/');
      return true;
    },
  };
})();
