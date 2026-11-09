/* WizardOS updates on a Mac: ask first, show one "Updating" panel, say how it ended.
 *
 * Only on a Wizard whose App Manager says `by_host` (Wizard for Mac: the Mac backs up WizardOS before every
 * update, starts it, and puts the copy back if it fails; try-wizard next/mac/Host/OSUpdates.swift). Jan, 9 Nov 2026:
 * nothing updates WizardOS without the owner unless Settings says Automatic; Automatic only at night, after a 5-minute
 * heads-up. Built from the shell's existing pieces (APP-DESIGN-RULES rule 4: one pop-up, the sheet):
 *
 *   ready     the update banner (.dv-update, like "Interface updated"): top bar on desktop, under the status bar on
 *             the phone. "WizardOS 0.3.x is ready" · Later / Update now. Later hides it for that release.
 *   confirm   a sheet (.wz-sheet + kit/wizard-sheet.js): "Update WizardOS to 0.3.x?" · Cancel / Update now.
 *             Closing it any of the five ways is Cancel.
 *   heads-up  Automatic: a sheet "WizardOS updates in 5 minutes" · Not tonight / Update now, and the banner counts down
 *             with Not tonight while it is closed.
 *   updating  one opaque panel, no buttons: the steps (Backing up · Restarting · Installing · Verifying), how long it
 *             has run, that chats and files are safe. Sending pauses (the draft stays), and the expected outage
 *             notices (Can't reach Wizard, Saved copy, Interface updated) stay hidden until it ends.
 *   result    the banner: "WizardOS updated to 0.3.x" (×), or "The update didn't finish · Wizard went back to how it
 *             was" with Details (a sheet: why, Try again). A device that watched it reloads into the new interface.
 *
 * State comes from the App Manager (core/os-updates.js): host_pending (Update now asked), host_headsup (Automatic's
 * 5 minutes), host_update {id, phase, target, result, reason} (the Mac's progress and result) and installing. While
 * WizardOS restarts nothing answers, so the device that asked keeps its own note (localStorage wos.osu.flow.v1) and
 * the last step it saw.
 *   WosUpdateFlow.card()     the Settings card (core/os-updates.js asks on a Mac)
 *   WosUpdateFlow.confirm()  the confirm sheet (Settings' Update now)
 *   WosUpdateFlow.updating   {target, phase} while updating, else null
 */
(() => {
  'use strict';
  if (window.WosUpdateFlow) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const U = () => window.WosUpdates;
  const st = () => U()?.state || null;
  const mac = () => st()?.by_host === true;
  const OS = 'WizardOS';
  const TAKES = 'Usually 5–15 minutes';
  const FLOW = 'wos.osu.flow.v1', LATER = 'wos.osu.later.v1', SEEN = 'wos.osu.result.v1', HEADS = 'wos.osu.heads.v1';
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  const ACTIVE = ['stopping', 'updating', 'verifying', 'restoring'];
  const WHY = {
    installer: 'The installer stopped with an error.', interrupted: 'The installer stopped before it finished.',
    version: 'The new version didn’t install completely.', window: 'Wizard didn’t answer after the update.',
    timeout: 'It took much longer than it should.', stopped: 'WizardOS stopped during the update.',
    noanswer: 'WizardOS stopped answering during the update.', shutdown: 'WizardOS didn’t shut down cleanly, so nothing was changed.',
    space: 'Your Mac doesn’t have enough free space to keep a copy during the update.',
    copy: 'Your Mac couldn’t save a copy first, so nothing was changed.', current: 'WizardOS is already up to date.',
    running: 'An update was already running.', notstarted: 'The update didn’t start.',
    quit: 'Wizard was quit before the update started, so nothing changed.', other: 'Something went wrong.',
  };
  const toast = (icon, text, ms = 2600) => { const H = window.__wux || window.__wos; try { H?.toast?.(icon, text, ms); } catch (_) {} };
  const desktop = () => !!document.querySelector('#bar .bar-r');

  // ---- state ----
  function flow() {
    const f = ls.get(FLOW);
    if (f && (!f.target || Date.now() - (f.since || 0) > 3 * 3600e3)) { ls.set(FLOW, null); return null; }
    return f;
  }
  const hu = () => st()?.host_update || null;
  const headsUp = () => { const h = st()?.host_headsup; return h && typeof h.at === 'number' && h.at * 1000 > Date.now() - 90e3 ? h : null; };
  let maxStep = 0, stepFor = '';
  function updating() {
    const s = st(); if (!s || !mac()) return null;
    const h = hu(), f = flow();
    let u = null;
    if (h && ACTIVE.includes(h.phase)) u = { target: h.target, phase: h.phase, since: h.at * 1000 };
    else if (s.host_pending) u = { target: s.host_pending.target || s.latest, phase: 'pending' };
    else if (s.installing) u = { target: s.latest, phase: 'updating' };
    if (f) {
      const ended = h && h.phase === 'done' && h.target === f.target && h.at * 1000 >= f.since - 120e3;
      if (ended) { ls.set(FLOW, null); landed(h); return null; }
      if (!U()?.issue && s.installed === f.target && !s.installing && !u) { ls.set(FLOW, null); return null; }
      u = u || { target: f.target, phase: 'pending' };
      u.since = Math.min(u.since || Infinity, f.since);
    }
    if (u && stepFor !== u.target) { stepFor = u.target; maxStep = 0; }
    return u;
  }
  // 0 Backing up · 1 Restarting · 2 Installing · 3 Verifying
  function step(u) {
    const away = !!U()?.issue;
    let n = u.phase === 'verifying' ? 3 : u.phase === 'updating' || st()?.installing ? 2 : away ? 1 : 0;
    if (u.phase === 'restoring') n = maxStep;
    maxStep = Math.max(maxStep, n);
    return maxStep;
  }
  function result() {
    const h = hu();
    if (!h || h.phase !== 'done' || !h.result || ls.get(SEEN) === h.id) return null;
    if (Date.now() - h.at * 1000 > 24 * 3600e3) return null;
    return h;
  }
  // The device that watched the update reloads into the new interface; the result banner greets it there.
  let reloading = false;
  function landed(h) {
    if (h.result !== 'ok' || reloading) return;
    reloading = true;
    setTimeout(() => { try { location.reload(); } catch (_) {} }, 1200);
  }

  // ---- the sheets ----
  let sheet = null;
  function ask({ title, body, yes, no, onYes, onNo }) {
    if (sheet) { try { sheet.close(); } catch (_) {} }
    const d = document.createElement('dialog');
    d.className = 'wz-sheet osu-sheet';
    const id = 'osu-' + Math.random().toString(36).slice(2, 8);
    d.setAttribute('aria-labelledby', id);
    d.innerHTML = `<h2 id="${id}">${esc(title)}</h2>${body}<div class="osu-sheet-act"><button type="button" class="wz-button secondary" data-osu-no>${esc(no)}</button><button type="button" class="wz-button" data-osu-yes>${esc(yes)}</button></div>`;
    document.body.appendChild(d);
    let chose = '';
    d.addEventListener('click', e => {
      if (e.target.closest('[data-osu-yes]')) chose = 'yes'; else if (e.target.closest('[data-osu-no]')) chose = 'no'; else return;
      d.close();
    });
    d.addEventListener('close', () => {
      if (sheet === d) sheet = null;
      d.remove();
      if (chose === 'yes') onYes?.(); else onNo?.(chose === 'no' ? 'no' : 'dismissed');
    });
    sheet = d;
    if (window.WzSheet?.open) window.WzSheet.open(d); else d.showModal();
    return d;
  }
  const p = (t, small) => `<p class="osu-sheet-p">${esc(t)}</p>${small ? `<p class="osu-sheet-note">${esc(small)}</p>` : ''}`;

  function confirm() {
    const s = st(); if (!s || !mac() || updating()) return;
    if (!s.update_available || s.unpinned || !s.latest) { toast('✓', `${OS} is up to date`); return; }
    const t = s.latest;
    ask({ title: `Update ${OS} to ${t}?`,
      body: p(`Wizard restarts and is away for a while (${TAKES.toLowerCase()}). Your chats and files stay as they are, and your Mac backs up WizardOS first, to go back to if anything goes wrong.`,
              'Sending messages pauses until it’s done. You can also update any time in Settings.'),
      yes: 'Update now', no: 'Cancel', onYes: () => start(t) });
  }
  async function start(target) {
    ls.set(FLOW, { target, since: Date.now() }); ls.set(LATER, null);
    maxStep = 0; stepFor = target; render();
    try {
      const d = await U().post({ action: 'apply' });
      if (d && typeof d === 'object' && 'update_available' in d) U().state = d;
      if (!d?.host_pending && !d?.started) { ls.set(FLOW, null); toast('!', d?.note || d?.error || `${OS} is up to date`); }
    } catch (e) { ls.set(FLOW, null); toast('!', e?.message || 'Couldn’t reach the App Manager'); }
    render(); fastPoll();
  }
  function postpone() {
    U().post({ action: 'postpone' }).then(d => { if (d && 'update_available' in d) U().state = d; toast('✓', 'Not tonight · You can update any time in Settings'); })
      .catch(e => toast('!', e?.message || 'Couldn’t reach the App Manager')).finally(render);
  }
  function details(h) {
    ask({ title: `The ${OS} update didn’t finish`,
      body: p(`${WHY[h.reason] || WHY.other} Wizard went back to how it was before the update; your chats and files are unchanged.`,
              'You can try again now or later from Settings.'),
      yes: 'Try again', no: 'Close', onYes: () => { ls.set(SEEN, h.id); U().load(true).then(() => confirm()); } });
  }

  // ---- the banner (same component as "Interface updated") ----
  function banner() {
    if (updating()) return null;
    const r = result(), s0 = st();
    // A newer release is ready: the last update's news is old; say the new one instead.
    if (r && !(s0?.update_available && s0.latest && s0.latest !== r.target)) {
      if (r.result === 'ok') return { key: 'ok' + r.id, text: `${OS} updated to ${r.target}`, x: true };
      if (r.result === 'skipped') return { key: 'sk' + r.id, text: `${OS} wasn’t updated · ${WHY[r.reason] || WHY.other}`, x: true };
      return { key: 'bad' + r.id, text: `${OS} update didn’t finish · Wizard went back to how it was`, go: 'Details', act: 'details', x: true };
    }
    const h = headsUp();
    if (h) {
      const mins = Math.max(1, Math.ceil((h.at * 1000 - Date.now()) / 60e3));
      return { key: 'hu' + h.at, text: `${OS} updates in ${mins} min`, later: 'Not tonight', laterAct: 'postpone', go: 'Update now', act: 'now' };
    }
    const s = st();
    if (!s?.update_available || s.unpinned || !s.latest || s.installing || ls.get(LATER) === s.latest) return null;
    return { key: 'rd' + s.latest, text: s.mode === 'auto' ? `${OS} ${s.latest} installs tonight` : `${OS} ${s.latest} is ready`,
      later: 'Later', laterAct: 'later', go: 'Update now', act: 'confirm' };
  }
  function renderBanner() {
    const b = mac() ? banner() : null;
    let el = document.getElementById('dvOsu');
    if (!b) { el?.remove(); return; }
    const shell = desktop() ? 'desktop' : 'phone';
    if (!el || el.dataset.shell !== shell) {
      el?.remove();
      el = document.createElement('div'); el.id = 'dvOsu'; el.className = 'dv-update'; el.setAttribute('role', 'status');
      el.dataset.shell = shell;
      if (shell === 'desktop') document.querySelector('#bar .bar-r').prepend(el); else document.body.appendChild(el);
      el.addEventListener('click', onBanner);
    }
    const html = `<span class="dv-um">${esc(b.text)}</span>`
      + (b.later ? `<button type="button" class="later" data-osuf="${b.laterAct}">${esc(b.later)}</button>` : '')
      + (b.go ? `<button type="button" data-osuf="${b.act}">${esc(b.go)}</button>` : '')
      + (b.x ? `<button type="button" class="later" data-osuf="x" aria-label="Dismiss">×</button>` : '');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }
  function onBanner(e) {
    const a = e.target.closest('[data-osuf]')?.dataset.osuf; if (!a) return;
    const s = st(), r = result();
    if (a === 'later') { ls.set(LATER, s?.latest || ''); toast('✓', 'Later · You can update any time in Settings'); }
    else if (a === 'confirm') confirm();
    else if (a === 'now') { const h = headsUp(); if (h) start(h.target || s?.latest); }
    else if (a === 'postpone') postpone();
    else if (a === 'details' && r) details(r);
    else if (a === 'x' && r) ls.set(SEEN, r.id);
    render();
  }

  // ---- the heads-up sheet (once per heads-up) ----
  function headsUpSheet() {
    const h = headsUp(); if (!h || updating() || ls.get(HEADS) === h.at) return;
    ls.set(HEADS, h.at);
    const t = h.target || st()?.latest;
    ask({ title: `${OS} updates in 5 minutes`,
      body: p(`Automatic update to ${t}. Wizard restarts and is away for a while (${TAKES.toLowerCase()}); your chats and files stay as they are.`,
              'Sending messages pauses while it updates. Not tonight skips tonight; you can update any time in Settings.'),
      yes: 'Update now', no: 'Not tonight', onYes: () => start(t), onNo: why => { if (why === 'no') postpone(); } });
  }

  // ---- the panel while updating ----
  const STEPS = ['Backing up', 'Restarting', 'Installing', 'Verifying'];
  function renderPanel(u) {
    let el = document.getElementById('wosUpdating');
    const root = document.documentElement;
    if (!u) {
      el?.remove();
      if (root.dataset.wosUpdating) { delete root.dataset.wosUpdating; placeholders(false); }
      return;
    }
    root.dataset.wosUpdating = '1'; placeholders(true);
    if (sheet && !reloading) { /* a ready/confirm sheet left open is stale now */ }
    if (!el) {
      el = document.createElement('div'); el.id = 'wosUpdating'; el.className = 'osu-busy';
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.dataset.shell = desktop() ? 'desktop' : 'phone';
    const n = step(u), back = u.phase === 'restoring';
    const mins = u.since && isFinite(u.since) ? Math.max(0, Math.round((Date.now() - u.since) / 60e3)) : null;
    const ran = mins == null ? '' : mins < 1 ? 'Started just now' : `Started ${mins} min ago`;
    const title = back ? `Putting ${OS} back how it was` : `Updating ${OS} to ${u.target}`;
    const line = back ? 'The update didn’t finish. Your Mac is restoring the backup it made first; your chats and files are safe.'
      : `${TAKES} · Your chats and files are safe`;
    const leave = desktop() ? 'Nothing to do here. Keep reading your chats, or close the Wizard window (⌘W); the update carries on.' : 'Nothing to do here. You can leave this screen; your Mac carries on updating.';
    const steps = back ? '' : `<ol class="osu-steps">${STEPS.map((s, i) => `<li class="${i < n ? 'done' : i === n ? 'now' : 'next'}"><i aria-hidden="true"></i><span>${esc(s)}${i === n ? '…' : ''}</span></li>`).join('')}</ol>`;
    const html = `<b class="osu-busy-t">${esc(title)}</b>${steps}<p class="osu-busy-l">${esc(line)}</p><p class="osu-busy-n">${esc([ran, leave].filter(Boolean).join(' · '))}</p>`;
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }
  // The composer says why it won't send (the draft stays).
  const PAUSED = `Paused while ${OS} updates`;
  function placeholders(on) {
    for (const f of document.querySelectorAll('form[data-chform] textarea, [data-compose]')) {
      if (!('placeholder' in f)) continue;
      if (on) { if (f.dataset.osuPh == null) f.dataset.osuPh = f.placeholder || ''; f.placeholder = PAUSED; }
      else if (f.dataset.osuPh != null) { f.placeholder = f.dataset.osuPh; delete f.dataset.osuPh; }
    }
  }
  const paused = () => document.documentElement.dataset.wosUpdating === '1';
  function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); toast('◌', `${PAUSED} · your draft is kept`); }
  window.addEventListener('submit', e => { if (paused() && e.target.closest?.('form[data-chform], [data-part="composer"]')) stop(e); }, true);
  window.addEventListener('keydown', e => {
    if (!paused() || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (e.target.closest?.('form[data-chform], [data-compose]')) stop(e);
  }, true);
  window.addEventListener('click', e => { if (paused() && e.target.closest?.('.ch-send, form[data-chform] button[type="submit"]')) stop(e); }, true);

  // ---- loop ----
  let fastT = 0;
  function fastPoll() { clearTimeout(fastT); fastT = setTimeout(() => { if (updating() || flow()) U()?.load(true).finally(() => { render(); fastPoll(); }); }, 4000); }
  function render() {
    if (!U() || !st()) return;
    if (!mac()) { renderPanel(null); renderBanner(); return; }
    const u = updating();
    renderPanel(u); renderBanner(); headsUpSheet();
    if (u && !fastT) fastPoll();
    if (!u) fastT = 0;
  }
  window.WosUpdateFlow = {
    confirm, render,
    get updating() { return updating(); },
    card() {
      const s = st(); if (!s) return null;
      // Nothing to tap while it runs: no button, so the words get the card's width.
      if (updating()) { const u = updating(); return { state: 'building', title: `Updating ${OS} to ${u.target}`, line: `${TAKES} · Wizard restarts once`, action: '' }; }
      if (!s.update_available || s.unpinned || !s.latest) return null;
      return { state: 'behind', title: `${OS} ${s.latest} is ready`, line: s.mode === 'auto' ? 'Installs tonight (1–5 am) after a 5-minute heads-up' : `${TAKES} · Wizard restarts once`, action: 'apply', label: 'Update now', disabled: false };
    },
  };
  setInterval(render, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (updating() || flow())) U()?.load(true).finally(render); });
})();
