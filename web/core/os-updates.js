/* WizardOS · Settings → About & updates: one update card, Automatic / Ask me, release channel; the Home pop-up.
 *
 * Two kinds of update, two names (Miguel, 27 Oct 2026). "WizardOS" is only the box (App Manager, Agent Service,
 * apps): a 10–20 minute install that waits for a quiet moment, like a macOS update. The screens you use are the
 * "Interface": a new one is already on the box and only needs a Reload, so its notice never says "WizardOS".
 *
 * The box updates the one documented way: the App Manager reruns the installer (`os.sh | bash -s start`) onto the
 * release the box's channel names. Automatic does that overnight, skipping while a chat run is active (Install now
 * is the "now" escape); Ask me never installs by itself and waits for a tap on Install. The always-automatic
 * experiment (wizard-app-manager#465) was reverted (wizard-app-manager#483, James: "Automatic, Ask Me"): only an
 * App Manager that still reports `always_auto: true` gets no choice, because it would not keep Ask me.
 * Channels keep their ids (stable / latest) but are shown as "For everyone" and "For testers": every merge to main
 * reaches For testers; a For testers release moves to For everyone after about 3 days with no release blocker.
 * New work ships behind off-by-default feature switches, which testers turn on in Settings › Appearance ("Try new
 * features") or in the WizardOS Tracker app: one shared state (look.json `tweaks`).
 *
 * Same path as the Store's Get: `../store-install/_updates` is the App Manager's owner-only listener behind
 * Tailscale Serve (owner login, the shell's own Origin, JSON + X-Wizard-Store). No token reaches the browser.
 *   GET                       {mode, chosen, always_auto (only the 0.3.107 App Manager: updates always automatic),
 *                              installed, latest, update_available, unpinned, checked, installing,
 *                              interrupted (the last update was cut short, e.g. by a reboot; it is retried),
 *                              quick (the release only swaps the interface image in place: about 2 minutes, not
 *                              the 10–20 minute installer; App Managers without it never send it)}
 *   POST {"mode":"auto"|"ask"} the owner's choice (kept across installer reruns)
 *   POST {"channel":"stable"|"latest"} release channel (DECISIONS #75): stable = "For everyone" (default),
 *                              latest = "For testers". GET then also returns {channel, stable};
 *                              `latest` is this box's channel release, and what Automatic installs (#458).
 *                              An App Manager without channels returns no `channel`, so the picker stays hidden.
 *   POST {"action":"apply"}    start the update now
 * An unavailable route is reported in About; no install/policy controls are enabled without a valid response.
 *
 * One card, same look in every state; only the words change. Nothing to do = no card:
 *   behind    "WizardOS update" · Automatic: "Installs tonight when it’s quiet" · Install now
 *                                Ask me:    "Takes 10–20 minutes" · Install
 *   building  "Updating WizardOS…" · "Takes 10–20 minutes · Wizard reconnects by itself" · Install (disabled)
 *             (quick: "Takes about 2 minutes" in both; the new interface then offers its own Reload)
 *   failed    "WizardOS update didn’t finish" · "Tries again tonight" (Ask me: "Takes 10–20 minutes") · Try again
 *   reload    the interface changed under this page (core/web-update.js) → "Interface updated" · Reload
 *
 *   WosUpdates.card()       → {state, title, line, action, label, disabled} or null
 *   WosUpdates.cardHtml()   → the card's markup ('' when there is nothing to do); Settings puts it on top
 *   WosUpdates.html()       → the About & updates group, including loading/unavailable status
 *   WosUpdates.act(el, ctx) → handles a [data-osu] tap; true if handled
 *   WosUpdates.load(force)  → refresh the status (cached 60 s here; the App Manager caches stable ~10 min)
 *   WosUpdates.popup()      → show / hide the Home pop-up now
 *
 * Wizard for Mac (App Manager `by_host`: the Mac saves a copy of WizardOS before every update and starts it):
 * core/os-update-flow.js owns the notices (the top-bar update banner, the confirm and heads-up sheets, one
 * "Updating WizardOS" panel, the result). Here the card says "WizardOS x is ready" / "Updating WizardOS…", Update now
 * opens that flow's confirm sheet, and the Home pop-up stays away. Other boxes are unchanged.
 *
 * Updates that wait for running work (App Manager `waits_for_work`: always on a Mac, elsewhere the off-by-default
 * switch wizard/os-update-waits, read by the App Manager): Install can answer `waiting` with what Wizard is working on;
 * the flow's sheet names it and offers Update when it finishes / Update anyway, and while that request waits the card
 * says so, with Options. Without `waits_for_work` the card is as before (a `waiting` answer still gets the sheet).
 *
 * Home pop-up: when the card says Update, Try again or Reload, Home shows the same words and the same button in a
 * small card clear of the dock, with a ×. × hides it for that exact state (keyed by the release or the web build)
 * until something new arrives. It replaces the old "Interface updated · Reload" banner (core/web-update.js asks
 * ownsReload() and stays away while the pop-up has the reload, or after its ×), so only one notice shows.
 */
(() => {
  'use strict';
  if (window.WosUpdates) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API = new URL('../store-install/_updates', document.currentScript?.src || location.href).href;
  const FRESH = 60e3;
  let st = null, at = 0, inflight = null, busy = '', off = false, issue = '';

  // Product name: WizardOS, always one word (James, 8 Nov 2026; wizard-os#436).
  const OS = () => 'WizardOS';
  const valid = d => d && typeof d === 'object' && ['auto', 'ask'].includes(d.mode) && 'update_available' in d;
  // Updates install by themselves on Automatic, and always on the one App Manager (0.3.107) that says always_auto.
  const isAuto = () => st?.always_auto === true || st?.mode === 'auto';
  const mac = () => st?.by_host === true;
  const waits = () => mac() || st?.waits_for_work === true;
  const CHANNEL_NAME = { stable: 'For everyone', latest: 'For testers' };
  function changed() { try { window.WosSettings?.refresh(); } catch (_) {} try { popup(); } catch (_) {} }
  // A status check that brings nothing new must not redraw Settings: a redraw resets its scroll, and a Mac's Wizard
  // checks every few seconds while it updates (core/os-update-flow.js).
  let lastSig = '';
  function changedIfNew() {
    const sig = JSON.stringify([st, issue, off]);
    if (sig === lastSig) { try { popup(); } catch (_) {} return; }
    lastSig = sig; changed();
  }

  /* ---- Apps (wizard-ux#1191, behind the off-by-default switch wizard/app-updates-list) ----
   * Every installed app: installed version, latest Store version and a plain status, read from the same Runtipi
   * list the App Manager's app updater reads (`wam app-updates` candidates): the Store's
   * `../store-data/api/apps/installed` (id, name, status, version, ignoredVersion, latestVersion). Read only; never
   * a copy of its own. Holds, failed versions (with the plain reason), rollbacks, the last run and the app
   * Automatic / Ask mode come from the App Manager's own app-update state, `../store-install/_app-updates`
   * (owner only, same switch; an older App Manager answers 404 and the list stays as above). Fetched only while
   * the switch is on. Only once that state has answered, each row also gets its buttons, all POSTs to the same
   * route: Update now (ready, or held with a newer version) and Retry (failed) send {action:"apply", app}, which
   * the App Manager runs in the background and which overrides a hold or a past failure, never a system app;
   * Hold / Unhold send {hold}/{unhold}; the Automatic / Ask me choice sends {mode}. A button reads Starting… /
   * Holding… while it waits, then the row says what happened (or the App Manager's own words when it refused),
   * and the list is read again from GET. Switch off: no buttons and no POST. */
  const APPS_ID = 'wizard/app-updates-list';
  const APPS_API = new URL('../store-data/api/apps/installed', document.currentScript?.src || location.href).href;
  const STORE_SLUG = 'wizardapps';   // wizard-app-manager cli.STORE: app updates only move this store's apps
  // wizard-app-manager app_updates.SYSTEM_APPS: these move with the WizardOS release, never one by one.
  const WITH_OS = new Set(['hermes-agent', 'wizard-ux', 'wizard-agent-service', 'wizard-shell']);
  const AU_API = new URL('../store-install/_app-updates', document.currentScript?.src || location.href).href;
  const AU_WAIT = 4000;   // ms the optional App Manager state may take before the list paints without it
  let apps = null, appsAt = 0, appsBusy = null, appsIssue = '', au = null;
  let appAct = '', appMsg = {};   // the app button waiting for the App Manager; {id: {ok, text, at}} after it answered
  const APP_MSG_FOR = 120e3;      // how long a row keeps saying what its button did
  function appsOn() { try { return String(document.documentElement?.dataset?.tweaks || '').split(' ').includes(APPS_ID); } catch (_) { return false; } }
  const num = v => (typeof v === 'number' || (typeof v === 'string' && /^\d{1,9}$/.test(v))) ? Number(v) : null;
  // One row per installed app of the Wizard store. Same comparison as the App Manager's candidates(): latest > have.
  const BUG_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]{0,9}$/;
  function appRows(doc, mgr) {
    const out = [], m = mgr && typeof mgr === 'object' ? mgr : {};
    const held = new Set(Array.isArray(m.holds) ? m.holds : []);
    const failed = m.failed && typeof m.failed === 'object' ? m.failed : {};
    const rolled = new Set(Array.isArray(m.last?.rolled_back) ? m.last.rolled_back : []);
    const fresh = new Set(Array.isArray(m.last?.updated) ? m.last.updated : []);
    const notes = m.notes && typeof m.notes === 'object' && !Array.isArray(m.notes) ? m.notes : null;
    for (const x of Array.isArray(doc?.installed) ? doc.installed : []) {
      const id = x?.info?.id; if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) continue;
      const urn = typeof x.info.urn === 'string' ? x.info.urn : '';
      if (urn && urn.split(':')[1] !== STORE_SLUG) continue;
      const have = num(x.app?.version), latest = num(x.metadata?.latestVersion), run = String(x.app?.status || '');
      let state = 'unknown', label = 'Couldn’t check';
      if (have != null && latest != null) {
        if (latest <= have) { state = 'current'; label = 'Up to date'; }
        else if (WITH_OS.has(id)) { state = 'with-os'; label = `Updates with ${OS()}`; }
        else if (num(x.app?.ignoredVersion) === latest) { state = 'skipped'; label = 'This version skipped'; }
        else if (failed[id] && num(failed[id].to) === latest) { state = 'failed'; label = rolled.has(id) ? 'Rolled back' : 'Update failed'; }
        else { state = 'ready'; label = 'Update ready'; }
      }
      // A hold is standing policy: show it even while the app is up to date (Codex P2), never over a failure.
      if (held.has(id) && ['ready', 'current', 'unknown'].includes(state)) { state = 'held'; label = 'Held'; }
      if (/^(updating|installing|starting|stopping|restarting)$/.test(run)) { state = 'busy'; label = run === 'updating' ? 'Updating…' : `${run[0].toUpperCase()}${run.slice(1)}…`; }
      const ver = have == null ? 'Version unavailable' : latest != null && latest > have ? `Version ${have} · latest ${latest}` : `Version ${have}`;
      const why = state === 'failed' ? String(failed[id].reason || '').slice(0, 300) : '';
      // The bug the App Manager filed or found for this failed version (wizard-app-manager#524), only a plain GitHub
      // issue link. An App Manager without `bug`, or with bug reports switched off, gives no link.
      const bug = state === 'failed' && typeof failed[id].bug === 'string' && BUG_URL.test(failed[id].bug) ? failed[id].bug : '';
      // One line of What's new for the version waiting (Update ready, or held with a newer one) or the version the
      // last run just installed: the App Manager's `notes` (wizard.md whats_new in the Store's copy), only when it
      // is about exactly that version. An App Manager without `notes` says nothing rather than "no notes".
      let news = '';
      const nv = notes ? (state === 'ready' || (state === 'held' && latest != null && have != null && latest > have) ? latest
        : fresh.has(id) && (state === 'current' || (state === 'held' && have != null && latest != null && latest <= have)) ? have : null) : null;
      if (nv != null) {
        const n = notes[id], text = n && typeof n === 'object' && num(n.version) === nv && typeof n.text === 'string' ? n.text.trim().slice(0, 140) : '';
        news = text ? `What’s new in ${nv}: ${text}` : 'What’s new: no notes';
      }
      out.push({ id, name: String(x.info.name || id).slice(0, 80), have, latest, state, label, ver, why, bug, news, held: held.has(id) });
    }
    const rank = { failed: 0, ready: 1, busy: 2, held: 3, unknown: 4, skipped: 5, 'with-os': 6, current: 7 };
    return out.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
  }
  function loadApps(force) {
    if (!appsOn()) return Promise.resolve(apps);
    if (!force && appsAt && Date.now() - appsAt < FRESH) return Promise.resolve(apps);
    if (appsBusy) return appsBusy;
    appsBusy = (async () => {
      try {
        // The App Manager state is optional: bounded, so a slow or hung answer never holds up the list (Codex P2).
        const mgr = fetch(AU_API, { credentials: 'same-origin', cache: 'no-store' })
          .then(m => m.ok ? m.json() : null).catch(() => null);
        const r = await fetch(APPS_API, { credentials: 'same-origin', cache: 'no-store' });
        const d = r.ok ? await r.json().catch(() => null) : null;
        const md = await Promise.race([mgr, new Promise(ok => setTimeout(() => ok(null), AU_WAIT))]);
        au = md && typeof md === 'object' && ['auto', 'ask'].includes(md.app_mode) ? md : null;
        if (d && Array.isArray(d.installed)) { apps = appRows(d, au); appsIssue = ''; }
        else appsIssue = 'Couldn’t read the installed apps.';
      } catch (_) { appsIssue = 'Couldn’t reach the installed apps.'; }
      appsAt = Date.now(); appsBusy = null; changed(); return apps;
    })();
    return appsBusy;
  }
  function appsHtml() {
    if (!appsOn()) return '';
    // One read per minute at most, failed or not: a failed read must not refetch on every repaint.
    if (!appsAt || Date.now() - appsAt > FRESH) void loadApps();
    const head = '<span class="osu-lbl">Apps</span>';
    if (!apps) return `<div class="osu-sec" data-osu-apps>${head}<p class="st-note" role="status">${esc(appsIssue || 'Checking apps…')}</p></div>`;
    const rows = apps.map(a => {
      const m = appMsg[a.id] && Date.now() - appMsg[a.id].at < APP_MSG_FOR ? appMsg[a.id] : null;
      const said = m ? `<span data-osu-app-msg="${m.ok ? 'done' : 'failed'}" role="status">${esc(m.text)}</span>` : '';
      const acts = appButtons(a).map(([key, text]) => `<button type="button" data-osu="${key}:${esc(a.id)}"${appAct ? ' disabled' : ''}${appAct === `${key}:${a.id}` ? ' aria-busy="true"' : ''}>${esc(appAct === `${key}:${a.id}` ? PENDING[key] : text)}</button>`).join('');
      return `<div class="st-row static" data-osu-app="${esc(a.id)}" data-osu-app-state="${a.state}"><span class="st-tx"><b>${esc(a.name)}</b><span>${esc(a.ver)}</span>${a.news ? `<span data-osu-app-news>${esc(a.news)}</span>` : ''}${a.why ? `<span data-osu-app-why>${esc(`Version ${a.latest}: ${a.why}`)}</span>` : ''}${a.bug ? `<a data-osu-app-bug href="${esc(a.bug)}" target="_blank" rel="noopener noreferrer">Bug report</a>` : ''}${said}</span><span class="st-val">${esc(a.label)}</span>${acts ? `<span class="osu-app-acts">${acts}</span>` : ''}</div>`;
    }).join('');
    const note = appsIssue ? `<p class="st-note" role="status">${esc(appsIssue)} Showing the last check.</p>` : '';
    const at = typeof au?.last?.at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(au.last.at) ? au.last.at.slice(0, 16).replace('T', ' ') + ' UTC' : '';
    // The app Automatic / Ask me switch (`wam app-updates --auto/--ask`): only with the App Manager's state.
    const mode = au ? `<span class="osu-lbl" data-osu-app-modes-lbl>App updates</span><div class="st-seg" role="radiogroup" aria-label="App updates" data-osu-app-modes>${[['auto', 'Automatic'], ['ask', 'Ask me']].map(([k, t]) => `<button type="button" data-osu="app-mode:${k}" role="radio" aria-checked="${au.app_mode === k}"${appAct ? ' disabled' : ''}>${esc(t)}</button>`).join('')}</div>` : '';
    const mgr = au ? `${mode}<p class="st-hint" data-osu-app-mode>App updates: ${au.app_mode === 'auto' ? 'Automatic, overnight' : 'Ask me'}${at ? ` · last run ${esc(at)}` : ' · not run yet'}</p>` : '';
    return `<div class="osu-sec" data-osu-apps>${head}${note}${rows || '<p class="st-hint">No apps installed from the App Store yet.</p>'}${mgr}<p class="st-hint">Installed version and the App Store’s latest, from the App Manager.</p></div>`;
  }
  // The buttons a row gets. None without the App Manager's state (an older App Manager has no route to send them to),
  // none for system apps (they move with the WizardOS release) or while Runtipi is already busy with the app.
  const PENDING = { 'app-apply': 'Starting…', 'app-retry': 'Starting…', 'app-hold': 'Holding…', 'app-unhold': 'Unholding…' };
  function appButtons(a) {
    if (!au || a.state === 'with-os' || a.state === 'busy') return [];
    const out = [];
    if (a.state === 'failed') out.push(['app-retry', 'Retry']);
    else if (a.state === 'ready' || (a.state === 'held' && a.have != null && a.latest != null && a.latest > a.have)) out.push(['app-apply', 'Update now']);
    out.push(a.held ? ['app-unhold', 'Unhold'] : ['app-hold', 'Hold']);
    return out;
  }
  async function postApps(body) {
    const r = await fetch(AU_API, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && (body.action !== 'apply' || d?.started === true), status: r.status, d: d && typeof d === 'object' ? d : {} };
  }
  // Read the rows again from GET after a POST: wait out a read already on its way (it may predate the POST).
  const reloadApps = () => (appsBusy || Promise.resolve()).then(() => loadApps(true));
  // A tap on an app button. True when it was one (handled even while the server update controls are unavailable).
  function appTap(what, ctx) {
    const [key, arg] = what.split(':');
    if (!appsOn() || !au || appAct) return true;
    let body, done;
    if (key === 'app-mode') {
      if (!['auto', 'ask'].includes(arg) || arg === au.app_mode) return true;
      body = { mode: arg }; done = arg === 'auto' ? 'App updates: Automatic' : 'App updates: Ask me';
    } else {
      const a = (apps || []).find(x => x.id === arg);
      if (!a || !appButtons(a).some(([k]) => k === key)) return true;
      if (key === 'app-apply' || key === 'app-retry') { body = { action: 'apply', app: a.id }; done = `Update started · ${a.name}`; }
      else if (key === 'app-hold') { body = { hold: a.id }; done = 'Held: updates skip this app until you unhold it'; }
      else if (key === 'app-unhold') { body = { unhold: a.id }; done = 'Hold removed'; }
      else return true;
    }
    appAct = what; ctx?.render?.(); ctx?.haptic?.(8);
    const id = key === 'app-mode' ? '' : arg;
    postApps(body).then(({ ok, status, d }) => {
      if (!ok) throw new Error(String(d.note || d.error || `The App Manager said ${status}`).slice(0, 200));
      if (key === 'app-mode') au = { ...au, app_mode: arg };
      if (id) appMsg[id] = { ok: true, text: done, at: Date.now() };
      ctx?.toast?.('✓', done, 2200);
    }).catch(e => {
      const text = e?.message || 'Couldn’t reach the App Manager';
      if (id) appMsg[id] = { ok: false, text, at: Date.now() };
      ctx?.toast?.('!', text, 2600);
    }).finally(() => {
      appAct = ''; changed();
      // Read the rows again from GET; an update starts in the background, so look once more a moment later.
      void reloadApps().then(() => { if (body.action === 'apply') setTimeout(() => void loadApps(true), 1500); });
    });
    return true;
  }

  function load(force) {
    if (off && !force) return Promise.resolve(st);
    if (!force && st && Date.now() - at < FRESH) return Promise.resolve(st);
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        // A time limit: a request on a dead connection must fail, or `inflight` never settles and the update status
        // (and the Mac's Updating panel) freezes on the last answer.
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const limit = ctl ? setTimeout(() => ctl.abort(), 20e3) : 0;
        const r = await fetch(API, { credentials: 'same-origin', cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) })
          .finally(() => { if (limit) clearTimeout(limit); });
        const d = r.ok ? await r.json().catch(() => null) : null;
        if (valid(d)) {
          st = d; off = false; issue = '';
          // core/experience.js: For everyone keeps feature switches off; tell it the channel this box is on.
          // Persist first: experience.js is deferred and reads wos.channel.v1 when it starts, so the channel holds even
          // if this answer lands before its wos:channel listener exists.
          if (['stable', 'latest'].includes(d.channel)) try { localStorage.setItem('wos.channel.v1', d.channel); } catch (_) {}
          if (['stable', 'latest'].includes(d.channel)) try { window.dispatchEvent(new CustomEvent('wos:channel', { detail: { channel: d.channel } })); } catch (_) {}
        }
        else { off = true; issue = r.status === 404 ? 'Update controls are not available on this Wizard.' : r.status === 401 || r.status === 403 ? 'Sign in as this Wizard’s owner to manage server updates.' : 'Could not check server updates.'; }
      } catch (_) { off = true; issue = 'Could not reach server updates.'; }
      at = Date.now(); inflight = null; changedIfNew(); return st;
    })();
    return inflight;
  }
  async function post(body) {
    const r = await fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.note) throw new Error(d.error || `The App Manager said ${r.status}`);
    return d;
  }

  // The one card. Same shape for every state; null when there is nothing to do.
  function card() {
    // The interface: already on the box, a Reload away. Never called WizardOS.
    if (window.WizWebUpdate?.pending) {
      const s = window.WizWebUpdate.reloadStatus?.() || {};
      const c = { state: 'reload', title: 'Interface updated', line: 'Reload to see the changes', action: 'reload', label: 'Reload' };
      return { ...c, line: s.reason || c.line, label: s.rescuing ? 'Saving…' : s.checking ? 'Getting ready…' : s.going ? 'Reloading…' : s.armed ? 'Cancel waiting reload' : c.label, disabled: !!(s.rescuing || s.checking || s.going) };
    }
    if (!st || issue) return null;
    if (mac()) return window.WosUpdateFlow?.card?.() ?? null;
    const auto = isAuto();
    const takes = st.quick === true ? 'Takes about 2 minutes' : 'Takes 10–20 minutes';
    if (st.installing) return { state: 'building', title: `Updating ${OS()}…`, line: st.quick === true ? takes : `${takes} · Wizard reconnects by itself`, action: 'apply', label: auto ? 'Install now' : 'Install', disabled: true };
    if (st.unpinned || !st.update_available) return null;
    // "Update when it finishes" is waiting for Wizard's work (core/os-update-flow.js): Options asks again.
    if (waits() && st.when_idle && window.WosUpdateFlow) return { state: 'waiting', title: `${OS()} update waiting`, line: 'Updates when Wizard finishes', action: 'waitopts', label: 'Options', disabled: !!busy };
    // WizardOS: the box itself. Automatic waits for a quiet night; the button is the "now" escape, like macOS.
    const start = busy === 'apply' ? 'Starting…' : '';
    if (st.interrupted) return { state: 'failed', title: `${OS()} update didn’t finish`, line: auto ? 'Tries again tonight' : takes, action: 'apply', label: start || 'Try again', disabled: !!busy };
    return { state: 'behind', title: `${OS()} update`, line: auto ? 'Installs tonight when it’s quiet' : takes, action: 'apply', label: start || (auto ? 'Install now' : 'Install'), disabled: !!busy };
  }
  function cardHtml() {
    const c = card(); if (!c) return '';
    return `<div class="osu-card" data-osu-card="${c.state}"${mac() ? ' data-osu-stack' : ''} role="status"><div class="osu-tx"><b data-osu-title>${esc(c.title)}</b><span>${esc(c.line)}</span></div>${c.action ? `<button type="button" class="osu-go" data-osu="${c.action}" ${c.disabled ? 'disabled' : ''}>${esc(c.label)}</button>` : ''}${c.state === 'reload' ? window.WizWebUpdate?.rescueHtml?.('osu') || '' : ''}</div>`;
  }
  const seg = (name, items) => `<div class="st-seg" role="radiogroup" aria-label="${esc(name)}">${items.map(([key, text, on]) => `<button type="button" data-osu="${key}" role="radio" aria-checked="${on}" ${busy ? 'disabled' : ''}>${esc(text)}</button>`).join('')}</div>`;
  // Always retain the installed server version, including when an update card is present.
  function quietHead() {
    if (!st) return '';
    const have = st.installed ? `${OS()} (server) ${st.installed}` : `${OS()} (server) · version unavailable`;
    const sub = issue ? 'Last checked · previously verified' : st.unpinned ? 'Updated by hand · not on a release' : card() ? 'Installed on your Wizard' : !st.checked ? 'Couldn’t check for updates' : 'Up to date';
    return `<div class="st-row static osu-head" data-settings-version="server"><span class="st-tx"><b data-osu-title>${esc(have)}</b></span><span class="st-val">${esc(sub)}</span></div>`;
  }
  function html() {
    // The Apps list reads its own source, so it shows even when the server update controls can't be reached.
    if (!st || issue) {
      if (!off && !inflight) load();
      return `<div class="st-group" data-osu-group><h4>${OS()} (server)</h4><p class="st-note" role="status">${esc(issue || 'Checking server updates…')}</p>${issue ? `${quietHead()}${st?.installing ? `<p class="st-note" role="status" data-osu-last-progress>Last checked: Updating ${esc(OS())}… Connection lost; latest progress unverified.</p>` : ''}<p class="st-hint">The current server version and update preference could not be verified.${st ? ' The information above was previously verified, not a live update.' : ' No update preference was changed by this check.'}</p><button type="button" class="st-wide wz-button secondary" data-osu="retry" ${inflight ? 'disabled aria-busy="true"' : ''}>${inflight ? 'Checking…' : 'Try again'}</button>` : ''}${appsHtml()}</div>`;
    }
    if (Date.now() - at > FRESH) load();
    const auto = isAuto();
    const ch = ['stable', 'latest'].includes(st.channel) ? st.channel : '';
    const channel = ch ? `<div class="osu-sec"><span class="osu-lbl">Channel</span>${seg('Release channel', [['ch-latest', CHANNEL_NAME.latest, ch === 'latest'], ['ch-stable', CHANNEL_NAME.stable, ch === 'stable']])}<p class="st-hint">${ch === 'stable' ? 'Releases testers have used for about 3 days.' : `Every new release as soon as it’s out. Try new features in Appearance.`}</p></div>` : '';
    // Automatic / Ask me (wizard-app-manager#483). The 0.3.107 App Manager (always_auto) would not keep Ask me: no choice there.
    const choice = st.always_auto === true ? '' : seg('Updates', [['auto', 'Automatic', auto], ['ask', 'Ask me', !auto]]);
    const install = `<div class="osu-sec" data-osu-auto><span class="osu-lbl">Updates</span>${choice}<p class="st-hint">${mac() ? (auto ? 'Install by themselves at night (1–5 am), after a 5-minute heads-up you can stop. Never during a chat.' : 'Nothing installs until you tap Update now. You’ll see when an update is ready.') : auto ? 'Install by themselves overnight, never during a chat.' : 'Nothing installs until you tap Install.'}</p></div>`;
    return `<div class="st-group" data-osu-group>${cardHtml()}${quietHead()}${install}${channel}${appsHtml()}</div>`;
  }
  function pick(chan, ctx) {
    if (!['stable', 'latest'].includes(chan) || chan === st.channel) return true;
    busy = 'ch'; ctx?.render?.(); ctx?.haptic?.(8);
    post({ channel: chan }).then(d => {
      st = valid(d) ? d : { ...st, channel: chan };
      try { window.dispatchEvent(new CustomEvent('wos:channel', { detail: { channel: st.channel || chan } })); } catch (_) {}
      ctx?.toast?.('✓', `Channel: ${CHANNEL_NAME[chan]}`, 2200);
      at = Date.now();
    }).catch(e => ctx?.toast?.('!', e.message || 'Couldn’t reach the App Manager', 2600))
      .finally(() => { busy = ''; changed(); });
    return true;
  }
  // Reload through the shell's guarded reload (waits for a recording, saves first) when it is there.
  function reload() {
    const W = window.WizWebUpdate;
    if (typeof W?.reload === 'function') { W.reload('tap'); return; }
    location.reload();
  }
  function act(el, ctx) {
    const b = el.closest('[data-osu]'); if (!b) return false;
    const what = b.dataset.osu;
    if (what === 'rescue-save' || what === 'rescue-discard') { void window.WizWebUpdate?.rescue?.(what.slice(7)); return true; }
    if (what === 'reload') { ctx?.haptic?.(8); reload(); return true; }
    if (what === 'retry') { if (!inflight) { off = false; void load(true); ctx?.render?.(); } return true; }
    if (what.startsWith('app-')) return appTap(what, ctx);   // the Apps list works even without the server controls
    if (busy || !st || issue) return true;
    if (what.startsWith('ch-')) return pick(what.slice(3), ctx);
    if (what === 'ask' && st.always_auto === true) return true;   // that App Manager would answer Automatic anyway
    if ((what === 'auto' || what === 'ask') && what === (isAuto() ? 'auto' : 'ask') && (st.chosen || st.always_auto === true)) return true;
    if (what === 'apply' && card()?.disabled) return true;
    if (what === 'apply' && mac() && window.WosUpdateFlow) { window.WosUpdateFlow.confirm(); return true; }
    if (what === 'waitopts') { window.WosUpdateFlow?.options?.(); return true; }
    if (what === 'apply') { apply({}, ctx); return true; }
    busy = what; ctx?.render?.(); ctx?.haptic?.(8);
    post({ mode: what }).then(d => {
      st = valid(d) ? d : { ...st, mode: what, chosen: true };
      ctx?.toast?.('✓', st.mode === 'ask' ? 'Updates: Ask me' : 'Updates: Automatic', 1800);
      at = Date.now();
    }).catch(e => ctx?.toast?.('!', e.message || 'Couldn’t reach the App Manager', 2600))
      .finally(() => { busy = ''; changed(); });
    return true;
  }
  const shellCtx = () => { const H = window.__wos || window.__wux; return { toast: (...a) => { try { H?.toast?.(...a); } catch (_) {} } }; };
  // Install / Try again (and the flow's Update anyway on a box that isn't a Mac: extra = { anyway: true }).
  function apply(extra = {}, ctx = shellCtx()) {
    if (busy || !st) return;
    busy = 'apply'; ctx?.render?.(); ctx?.haptic?.(8);
    post({ action: 'apply', ...extra }).then(d => { applied(d, ctx); at = Date.now(); })
      .catch(e => ctx?.toast?.('!', e.message || 'Couldn’t reach the App Manager', 2600))
      .finally(() => { busy = ''; changed(); setTimeout(() => load(true), 1500); });
  }
  // What the App Manager said to an apply. `waiting`: Wizard is working on something the update would stop. Never a
  // silent no-op or "Already up to date": the flow's sheet names the work, or a plain line does.
  function applied(d, ctx = shellCtx()) {
    if (d?.started) { const quick = d.quick === true || (d.quick !== false && st?.quick === true); st = { ...st, installing: true, quick }; ctx?.toast?.('↻', `Updating ${OS()} · takes ${quick ? 'about 2 minutes' : '10–20 minutes'}`, 3200); return; }
    if (d?.waiting) {
      if (valid(d)) st = d;
      if (window.WosUpdateFlow?.waiting) { window.WosUpdateFlow.waiting(st?.latest, d); return; }
      const names = (Array.isArray(d.waiting_for) ? d.waiting_for : []).map(w => String(w?.name || '')).filter(Boolean);
      ctx?.toast?.('!', `Wizard is still working${names.length ? ' on ' + names.slice(0, 2).join(', ') : ''} · update when it’s done`, 3200); return;
    }
    ctx?.toast?.('!', d?.note || d?.error || 'Already up to date', 2600);
  }
  /* ---- Home pop-up ---- */
  const POP_STATES = ['behind', 'reload', 'failed'], DISMISS = 'wos.osu.dismissed';
  const store = { get() { try { return window.localStorage.getItem(DISMISS) || ''; } catch (_) { return ''; } }, set(v) { try { window.localStorage.setItem(DISMISS, v); } catch (_) {} } };
  // One key per state worth telling: a new release or a new web build each count as new.
  function popKey(c) {
    if (!c || !POP_STATES.includes(c.state)) return '';
    if (c.state === 'reload') return 'reload:' + (window.WizWebUpdate?.version || 'web');
    return c.state + ':' + (st?.latest || '');
  }
  // Home in view, nothing over it: phone desk 0 with no windows and no sheet; desktop Home or an empty desk, no Settings.
  function homeInView() {
    if (typeof document === 'undefined' || document.hidden || document.querySelector?.('.mz-intro, .rs-sheet, .wos-burst, .tour.on')) return false;
    const P = window.__wos, D = window.__wux;
    // Desktop: any overlay (Settings, the palette, Inbox, the keys sheet, Usage) hides it; it never sits above a modal.
    if (D) return !!(D.homeOpen || !D.ws?.[D.cur]?.wins?.length) && !document.querySelector?.('.dsettings:not([hidden]), #palette:not([hidden]), #keys:not([hidden]), #inbox:not([hidden]), .usage-ov:not([hidden])');
    if (P) return P.idx === 0 && !P.sheet && !P.desks?.[0]?.wins?.length;
    return false;
  }
  function ownsReload() { const c = card(); if (c?.state !== 'reload') return false; const k = popKey(c); return k === store.get() || popShown === k; }
  let popEl = null, popShown = '', popTimer = 0;
  const popCtx = () => { const H = window.__wos || window.__wux; return { toast: (...a) => H?.toast?.(...a), haptic: n => { try { navigator.vibrate?.(n); } catch (_) {} }, render: () => popup(), root: popEl }; };
  // Phone: sit just above the dock (measured, so any skin's pill or orb stays clear); desktop: bottom right (CSS).
  function place() {
    if (!popEl || window.__wux) return;
    const dock = document.querySelector('#dock, .dock'), r = dock?.getBoundingClientRect?.();
    const vh = window.innerHeight || 0, top = r && r.height ? Math.min(r.top, vh) : vh - 140;
    popEl.style.bottom = Math.max(16, vh - top + 12) + 'px';
  }
  function popup() {
    if (typeof document === 'undefined' || !document.body) return;
    if (mac()) { if (popEl) { popEl.remove(); popEl = null; } popShown = ''; clearInterval(popTimer); popTimer = 0; return; }   // core/os-update-flow.js
    const c = card(), k = popKey(c), show = !!k && k !== store.get() && homeInView();
    const was = popShown; popShown = show ? k : '';
    if (!show) { if (popEl) { popEl.remove(); popEl = null; } }
    else {
      if (!popEl) {
        popEl = document.createElement('div'); popEl.className = 'osu-pop'; popEl.setAttribute('role', 'status'); popEl.setAttribute('aria-live', 'polite');
        popEl.dataset.shell = window.__wux ? 'desktop' : 'phone';
        popEl.addEventListener('click', e => {
          const x = e.target.closest('[data-osu-dismiss]');
          if (x) { store.set(popEl?.dataset.key || ''); popup(); return; }
          if (e.target.closest('[data-osu]')) act(e.target, popCtx(), e);
          popup();
        });
        document.body.appendChild(popEl);
      }
      const armed = c.state === 'reload' && window.WizWebUpdate?.armed;
      const html = `<div class="osu-pop-tx"><b>${esc(c.title)}</b><span>${esc(c.line)}</span></div><button type="button" class="osu-pop-go" data-osu="${c.action}" ${c.disabled ? 'disabled' : ''}>${esc(c.label)}</button><button type="button" class="osu-pop-x" data-osu-dismiss aria-label="Dismiss">×</button>${c.state === 'reload' ? window.WizWebUpdate?.rescueHtml?.('osu') || '' : ''}`;
      if (popEl.dataset.key !== k || popEl.dataset.html !== html) { popEl.innerHTML = html; popEl.dataset.key = k; popEl.dataset.html = html; popEl.dataset.state = c.state; }
      place();
    }
    // The old "Interface updated" banner steps aside while the pop-up has the reload (and after its ×).
    if (was !== popShown) { try { window.WizWebUpdate?.render?.(); } catch (_) {} }
    // Home comes and goes without telling this module; while there is something to say, look again every second.
    clearInterval(popTimer); popTimer = 0;
    if (k && k !== store.get() && typeof setInterval === 'function') { popTimer = setInterval(popup, 1000); popTimer?.unref?.(); }
  }
  window.WosUpdates = { html, act, load, card, cardHtml, popup, popKey, ownsReload, homeInView, appRows, loadApps, post, changed, apply, applied,
    get state() { return st; }, get issue() { return issue; }, set state(d) { if (valid(d)) { st = d; at = Date.now(); } } };
  // Turning wizard/app-updates-list on or off repaints Settings (and reads the apps the first time).
  try { window.addEventListener?.('wos:tweak-choice', () => changed()); } catch (_) {}
  window.WosSettings?.register({ id: 'updates', aliases: ['updates'], available: () => true, html: () => html(), act: (ctx, el) => act(el, ctx) });
  load();
  // Look again by itself so Home hears about a new release without a reload: every minute while an update runs,
  // otherwise every 10 minutes (the App Manager caches stable ~10 min), and whenever the page comes back into view.
  const IDLE = 10 * FRESH;
  // A Mac's Wizard looks every minute (the heads-up is 5 minutes; core/os-update-flow.js polls faster while updating).
  // An update waiting for Wizard's work looks every minute too, so the card and the 6-hour ask follow it.
  const tick = () => { if (!st || document.hidden) return; if (st.installing || mac() || (waits() && st.when_idle) || Date.now() - at >= IDLE) load(true); };
  const timer = typeof setInterval === 'function' ? setInterval(tick, FRESH) : 0;
  timer?.unref?.();
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden && st && Date.now() - at >= FRESH) load(true); });
})();
