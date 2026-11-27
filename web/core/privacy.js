/* Settings › Privacy (wizard-ux issue 1801; spec "Private mode as an opt-in", sections 3-6 and 8.4), on for everyone
 * (James said yes at show-and-tell, 27 Nov 2026: the switch `wizard/private-mode` is removed). The Agent Service does the
 * work (wizard-agent-service issue 626, server/private-mode.mjs); this module is the screens on top of it:
 *   GET  /wizard/v1/private-mode          { on, mode: off|setting_up|on, next_step: agent|apps|context|default|done,
 *                                           private_agent, moved_apps, context, default_agent }
 *   POST /wizard/v1/private-mode/{agent,apps,context,default,off}   one step each, so leaving keeps what is done
 *   GET  /wizard/v1/privacy-check         { apps: [{ app_id, label, personal_data, standard_only, agents, lines,
 *                                           private_only, moved }], agents: [{ id, label, privacy, company }] }
 * Settings › Privacy (registered once, both shells): the Private mode row (Off / On, or Finish setting up private AI),
 * the Privacy check (each app holding personal data -> the agent using it -> whose servers that model runs on; Move to
 * private / Move to standard while private mode is on, Set up private AI while it is off) and Why it matters.
 * The switch-over sheet: 1 sign in to Tinfoil (its own app's sign-in page), 2 create the private agent, 3 the Privacy
 * check with personal-data apps ticked, 4 Bring your context along, 5 Start new chats on private AI, 6 Done. Each
 * screen is one Service step, and reopening starts at the box's next_step. Back and an outside tap close the sheet.
 * Also opened from the model picker's Private group (setupDue), the Welcome's "Why does this matter?" and a trusted
 * app's 'wizard:app-route' { action: 'private-mode' } (the Tinfoil app, the install sheet).
 * The box's answers are read when Settings › Privacy or the sheet asks, never at page load.
 *   WosPrivacy.on() (always true; kept for callers such as the Store) / setupDue() / open(screen?) / close() / back() /
 *   isOpen / state / check */
(() => {
  'use strict';
  if (window.WosPrivacy) return;
  const STATE = '/wizard/v1/private-mode', CHECK = '/wizard/v1/privacy-check', PF = '/wizard/v1/private-first';
  const TINFOIL = 'wizard-tinfoil', TINFOIL_URL = '/wizard-tinfoil/', TINFOIL_STATUS = '/wizard-tinfoil/api/status';
  const ASK = 'Why would I want private AI?';
  const VIDEO = ''; // aiwizards.com video: drawn once the content exists
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const on = () => true;
  const tsig = ms => { try { if (AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (e) {} return undefined; };
  const P = { st: null, chk: null, pf: null, tin: null, at: 0, reading: null };
  async function getJson(url) {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: tsig(6000) });
    const j = await r.json().catch(() => null);
    return r.ok && j && typeof j === 'object' ? j : null;
  }
  async function post(step, body = {}) {
    const r = await fetch(`${STATE}/${step}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: tsig(30000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw Object.assign(new Error(j?.error || 'status ' + r.status), { status: r.status, code: j?.error });
    if (j.state) P.st = j.state;
    return j;
  }
  async function tinfoilReady() {
    try { const r = await fetch(TINFOIL_STATUS, { credentials: 'same-origin', cache: 'no-store', signal: tsig(4000) }); if (!r.ok) return r.status === 404 ? 'missing' : false;
      const j = await r.json().catch(() => null); return j?.provider === 'tinfoil' && j?.credentialStored === true; } catch (e) { return false; }
  }
  // The box's answers, read when Settings or the sheet asks (at most every 15 s unless forced).
  function read(force) {
    if (P.reading) return P.reading;
    // An older box without private mode answers `on: false`: asked again sooner, in case it was just updated.
    if (!force && P.st && Date.now() - P.at < (P.st.on ? 15000 : 3000)) return Promise.resolve(P.st);
    P.reading = (async () => {
      const [st, chk, pf] = await Promise.all([getJson(STATE).catch(() => null), getJson(CHECK).catch(() => null), getJson(PF).catch(() => null)]);
      P.st = st; P.chk = chk; P.pf = pf; P.at = Date.now();
      return st;
    })().finally(() => { P.reading = null; repaint(); });
    return P.reading;
  }
  const ready = () => P.st?.on === true;
  const mode = () => P.st?.mode || 'off';
  // Later in the Welcome (wizard-ux#1800) counts as put off, like a setup left halfway.
  const unfinished = () => mode() === 'setting_up' || (mode() === 'off' && P.pf?.offer === 'later' && !P.pf?.private_agent);
  const agentOf = id => (P.chk?.agents || []).find(a => a.id === id) || null;
  const stdAgent = () => agentOf(P.st?.standard_agent || 'hermes') || (P.chk?.agents || []).find(a => a.privacy !== 'private') || null;
  const product = company => ({ Anthropic: 'Claude', OpenAI: 'ChatGPT', Google: 'Gemini' }[company] || company || 'Your AI');
  const RECORDS = { Anthropic: 'https://claude.ai/settings/data-privacy-controls', OpenAI: 'https://chatgpt.com/#settings/DataControls', Google: 'https://myactivity.google.com/product/gemini' };
  const HOLDS = [[/mail|email|gmail/, 'your email'], [/note/, 'your notes'], [/messenger|message|telegram|whatsapp|signal/, 'your messages'], [/calendar/, 'your calendar'], [/photo|picture/, 'your pictures'],
    [/contact/, 'your contacts'], [/money|monarch|bank|finance/, 'your finances'], [/record/, 'your recordings'], [/health/, 'your health data']];
  const holds = a => { const k = `${a.app_id} ${a.label}`.toLowerCase(); return (HOLDS.find(([re]) => re.test(k)) || [0, 'what it holds'])[1]; };
  const personal = () => (P.chk?.apps || []).filter(a => a.personal_data);
  const labelOf = id => (P.chk?.apps || []).find(a => a.app_id === id)?.label || id;

  /* ---- Settings › Privacy ---- */
  function rowHtml() {
    if (!P.st) return `<div class="st-row wz-row static" data-pm-row="loading"><span class="st-tx"><b>Private mode</b><small>Checking this Wizard…</small></span></div>`;
    if (!ready()) return `<div class="st-row wz-row static" data-pm-row="unavailable"><span class="st-tx"><b>Private mode</b><small>Not available on this Wizard yet. Update it in About & updates.</small></span></div>`;
    if (mode() === 'on') {
      const priv = agentOf(P.st.private_agent);
      return `<button type="button" class="st-row wz-row" data-pm-row="on"><span class="st-tx"><b>Private mode</b><small>${esc(P.st.default_agent === P.st.private_agent ? `New chats start on ${priv?.label || 'your private agent'}. Tap to turn it off.` : 'Your private agent has its apps. Tap to turn it off.')}</small></span><span class="st-val">On</span><span class="st-go">›</span></button>`;
    }
    if (unfinished()) return `<button type="button" class="st-row wz-row" data-pm-row="finish"><span class="st-tx"><b>Finish setting up private AI</b><small>Private AI runs in sealed hardware: only you can see your messages and data.</small></span><span class="st-go">›</span></button>`;
    return `<button type="button" class="st-row wz-row" data-pm-row="off"><span class="st-tx"><b>Private mode</b><small>Apps with personal data use a private AI that only you can see.</small></span><span class="st-val">Off</span><span class="st-go">›</span></button>`;
  }
  // One renderer for the Privacy check: the Settings page (moves) and step 3 of the sheet (ticks).
  function checkRows(kind, ticked) {
    if (!P.chk) return `<p class="pm-note" data-pm-check="loading">${ready() ? 'Reading your apps…' : ''}</p>`;
    const apps = personal();
    if (!apps.length) return `<p class="pm-note" data-pm-check="empty">No app on this Wizard says it holds personal data.</p>`;
    const busyId = S.busy.startsWith('move:') ? S.busy.slice(5) : '';
    return apps.map(a => {
      const line = a.lines?.length ? a.lines.join(' · ') : `${a.label} → no agent uses it yet`;
      if (kind === 'tick') {
        if (a.standard_only) return '';
        const done = a.private_only, t = done || ticked.has(a.app_id);
        const company = (a.agents || []).find(x => x.privacy !== 'private')?.company;
        const sub = done ? 'Already private.' : `${product(company)} can read ${holds(a)} today. Move to private.`;
        return `<button type="button" class="ar-agent ar-tick pm-app${t ? ' on' : ''}" role="checkbox" aria-checked="${t}" data-pm-tick="${esc(a.app_id)}"${done || S.busy ? ' disabled' : ''}><span class="tx"><b>${esc(a.label)}</b><small>${esc(sub)}</small><small class="pm-line">${esc(line)}</small></span><span class="cb"></span></button>`;
      }
      const btn = mode() !== 'on' || a.standard_only ? '' : a.private_only
        ? `<button type="button" class="pm-mv" data-pm-move="back:${esc(a.app_id)}"${S.busy ? ' disabled' : ''}>${busyId === a.app_id ? 'Moving…' : 'Move to standard'}</button>`
        : `<button type="button" class="pm-mv" data-pm-move="move:${esc(a.app_id)}"${S.busy ? ' disabled' : ''}>${busyId === a.app_id ? 'Moving…' : 'Move to private'}</button>`;
      return `<div class="st-row wz-row static pm-app" data-pm-app="${esc(a.app_id)}"><span class="st-tx"><b>${esc(a.label)}</b><small>${esc(line)}</small></span>${btn}</div>`;
    }).join('');
  }
  function pageHtml() {
    if (Date.now() - P.at > (ready() ? 15000 : 3000) && !P.reading) read();
    const check = ready() ? `<div class="st-group" data-pm-checkgroup><h4>Privacy check</h4><p class="pm-note">Each app that holds personal data, the agent that uses it, and whose servers that AI runs on.</p>${checkRows('move')}${S.note && !S.open ? `<p class="pm-note${S.note.startsWith('!') ? ' bad' : ''}" role="status">${esc(S.note.replace(/^!/, ''))}</p>` : ''}${mode() !== 'on' && !unfinished() ? `<button type="button" class="st-row wz-row" data-pm-setup><span class="st-tx"><b>Set up private AI</b></span><span class="st-go">›</span></button>` : ''}</div>` : '';
    return `<div class="st-group" data-pm-group><h4>Private AI</h4>${rowHtml()}<button type="button" class="st-row wz-row" data-pm-why><span class="st-tx"><b>Why it matters</b></span><span class="st-go">›</span></button></div>${check}`;
  }
  async function moveOne(spec) {
    const [kind, id] = spec.split(':'); if (!id || S.busy) return;
    S.busy = 'move:' + id; S.note = ''; repaint();
    try { await post('apps', kind === 'back' ? { back: [id] } : { move: [id] }); S.note = `${labelOf(id)} ${kind === 'back' ? 'is back on your standard agent' : 'now uses only your private agent'}.`; }
    catch (e) { S.note = `!${labelOf(id)} didn’t move: ${e.message}`; }
    S.busy = ''; await read(true); window.WosAgents?.load?.(true);
  }

  /* ---- the sheet ---- */
  const STEPS = ['signin', 'agent', 'check', 'context', 'default', 'done'];
  const S = { el: null, html: '', open: false, screen: '', busy: '', note: '', ticked: null, grant: true, makeDefault: true, poll: 0, from: '' };
  const head = (t, sub) => `<div class="ar-head"><b tabindex="-1">${esc(t)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const dots = () => { const i = STEPS.indexOf(S.screen); return i < 0 ? '' : `<div class="pm-dots" aria-hidden="true">${STEPS.map((x, n) => `<i class="${n === i ? 'on' : n < i ? 'done' : ''}"></i>`).join('')}</div>`; };
  const acts = (primary, label, ghost = '') => `<div class="ar-acts">${ghost}${primary ? `<button type="button" class="ar-btn" data-pm-go="${primary}"${S.busy ? ' disabled' : ''}>${esc(S.busy ? 'One moment…' : label)}</button>` : ''}</div>`;
  const note = () => S.note ? `<p class="ar-note ${S.note.startsWith('!') ? 'bad' : 'ok'}" role="status">${esc(S.note.replace(/^!/, ''))}</p>` : '';
  const sbx = u => { const B = window.WizBrowserBoundary; return B?.enabled ? ' ' + B.frameAttributes(u, TINFOIL) : ''; };
  function screenHtml() {
    const std = stdAgent(), stdName = product(std?.company);
    switch (S.screen) {
      case 'loading': return head('Private AI', 'Checking this Wizard…');
      case 'unavailable': return head('Private AI', 'Private mode isn’t available on this Wizard yet. Update it in Settings › About & updates.') + acts('', '', '<button type="button" class="ar-btn" data-pm-close>Close</button>');
      case 'signin': {
        const url = TINFOIL_URL + '?connect=1';
        const body = S.tin === 'missing' ? `<p class="ar-note">Private AI runs on Tinfoil. Get the Tinfoil app from the App Store, then come back here.</p><div class="ar-acts"><button type="button" class="ar-btn" data-pm-store>Get Tinfoil</button></div>`
          : S.tin === true ? '<p class="ar-note ok" role="status">Tinfoil is connected.</p>'
          : `<div class="pm-frame"><iframe src="${esc(url)}"${sbx(url)} allow="geolocation 'none'" title="Tinfoil sign-in"></iframe></div><p class="ar-note" role="status">This continues by itself once you are signed in.</p>`;
        return dots() + head('Sign in to private AI', 'Private AI runs on Tinfoil, in sealed hardware: nobody else, not us and not Tinfoil, can read your messages.') + body + note() + (S.tin === true ? acts('agent', 'Continue') : '');
      }
      case 'agent': return dots() + head('Create your private agent', 'It runs only on Tinfoil, with no fallback to another AI. Its chats are sealed: your standard agent can never read them.') + note() + acts('agent', 'Create private agent');
      case 'check': {
        const rows = checkRows('tick', S.ticked || new Set()), n = (S.ticked || new Set()).size;
        return dots() + head('Privacy check', 'These apps hold personal data. The ticked ones move to your private agent; nothing is reconnected.') + `<div class="ar-list" role="group" aria-label="Apps to move">${rows}</div>` + note() + acts('apps', n ? `Move ${n} ${n === 1 ? 'app' : 'apps'}` : 'Continue');
      }
      case 'context': return dots() + head('Bring your context along', 'So your private agent knows what you’ve already told your Wizard.')
        + `<div class="ar-list"><button type="button" class="ar-agent ar-tick${S.grant ? ' on' : ''}" role="checkbox" aria-checked="${S.grant}" data-pm-grant><span class="tx"><b>Let it read your standard chats and memory</b><small>One way: your private agent can read them, nothing private ever goes back.</small></span><span class="cb"></span></button></div>` + note() + acts('context', 'Continue');
      case 'default': return dots() + head('Main chat', 'Where a new chat starts.')
        + `<div class="ar-list"><button type="button" class="ar-agent ar-tick${S.makeDefault ? ' on' : ''}" role="checkbox" aria-checked="${S.makeDefault}" data-pm-default><span class="tx"><b>Start new chats on private AI</b><small>${esc(`Private AI is a bit less capable than ${stdName === 'Your AI' ? 'Claude' : stdName} for hard problems. You can still pick ${stdName === 'Your AI' ? 'Claude' : stdName} in any chat.`)}</small></span><span class="cb"></span></button></div>` + note() + acts('default', 'Continue');
      case 'done': {
        const moved = (P.st?.moved_apps || []).map(labelOf), company = std?.company, link = RECORDS[company];
        return dots() + head('Private mode is on', P.st?.default_agent === P.st?.private_agent ? 'New chats start on your private agent.' : 'New chats stay on your standard agent.')
          + `<p class="ar-note" data-pm-moved>${moved.length ? `Moved to private AI: ${esc(moved.join(', '))}.` : 'No apps moved. You can move them any time in the Privacy check.'}</p>`
          + `<p class="ar-note" data-pm-honest>${esc(`What ${stdName === 'Your AI' ? 'your standard AI' : stdName} already saw stays in your standard agent’s memory and chats, and in ${company || 'that company'}’s records.`)}</p>`
          + `<div class="pm-links"><button type="button" class="pm-link" data-pm-agents>Your standard agent’s chats and memory</button>${link ? `<a class="pm-link" href="${esc(link)}" target="_blank" rel="noopener">${esc(company)}’s records</a>` : ''}</div>`
          + acts('', '', '<button type="button" class="ar-btn" data-pm-close>Done</button>');
      }
      case 'off': return head('Turn off private mode?', 'Your apps go back to your standard agent and new chats start there again. Your private agent and its chats are kept, sealed.') + note()
        + `<div class="ar-acts"><button type="button" class="ar-btn ghost" data-pm-close>Keep it on</button><button type="button" class="ar-btn" data-pm-go="off"${S.busy ? ' disabled' : ''}>${S.busy ? 'One moment…' : 'Turn off'}</button></div>`;
      case 'why': return head('Why private AI matters')
        + '<p class="ar-note">When you use Claude or ChatGPT, your messages, its answers and what your apps share go to that company’s servers, where they can be kept and reviewed.</p>'
        + '<p class="ar-note">Private AI runs in sealed hardware: no one except you, not us, not Tinfoil and not any AI company, can see what you send or what it answers.</p>'
        + '<p class="ar-note">Use it for your email, notes and messages, and keep Claude or ChatGPT for hard problems. You choose per app and per chat.</p>'
        + (VIDEO ? `<a class="pm-link" href="${esc(VIDEO)}" target="_blank" rel="noopener">Watch the video</a>` : '')
        + `<div class="ar-acts"><button type="button" class="ar-btn ghost" data-pm-close>Close</button><button type="button" class="ar-btn" data-pm-ask>Ask my Wizard</button></div>`;
    }
    return '';
  }
  function paint() {
    if (!S.el) return;
    const html = `<div class="ar-card pm-card" role="dialog" aria-modal="true" aria-label="Private AI" data-pm-screen="${esc(S.screen)}"><button type="button" class="pm-x" data-pm-close aria-label="Close">×</button>${screenHtml()}</div>`;
    // Only a changed screen is redrawn: the Tinfoil sign-in frame must never reload under the owner's fingers.
    if (S.html !== html) { S.html = html; S.el.innerHTML = html; }
  }
  function repaint() { paint(); try { window.WosSettings?.refresh?.(); } catch (e) {} }
  const firstTicks = () => new Set(personal().filter(a => !a.standard_only && !a.private_only).map(a => a.app_id));
  // Where the box's next step puts the sheet (a sheet left halfway resumes there; nothing is done twice).
  function screenFor(st) {
    if (!st?.on) return 'unavailable';
    const next = st.mode === 'on' ? 'done' : st.next_step;
    return next === 'agent' ? (S.tin === true ? 'agent' : 'signin') : next === 'apps' ? 'check' : next === 'context' ? 'context' : next === 'default' ? 'default' : 'done';
  }
  function go(screen) {
    clearInterval(S.poll); S.poll = 0; S.screen = screen; S.note = '';
    if (screen === 'check') S.ticked = firstTicks();
    if (screen === 'signin' && S.tin !== true) S.poll = setInterval(async () => {
      if (!S.open || S.screen !== 'signin') { clearInterval(S.poll); return; }
      const t = await tinfoilReady(); if (t === S.tin) return;
      S.tin = t; paint();
      if (t === true) { clearInterval(S.poll); setTimeout(() => { if (S.open && S.screen === 'signin') go('agent'); }, 900); }
    }, 2500);
    paint();
    requestAnimationFrame(() => S.el?.querySelector('.ar-head b')?.focus?.({ preventScroll: true }));
  }
  async function open(at = '') {
    S.from = at;
    if (!S.el) { S.el = document.createElement('div'); S.el.className = 'aroute pm-sheet'; S.el.dataset.privacySheet = ''; document.body.appendChild(S.el); }
    S.open = true; S.busy = ''; S.note = ''; S.screen = at === 'why' ? 'why' : 'loading'; paint();
    requestAnimationFrame(() => S.el?.classList.add('open'));
    if (at === 'why') { read(); return true; }
    const [st, tin] = await Promise.all([read(true), tinfoilReady()]);
    if (!S.open) return true;
    S.tin = tin;
    go(at === 'off' && st?.mode === 'on' ? 'off' : screenFor(st));
    return true;
  }
  function close() {
    if (!S.el) return false;
    clearInterval(S.poll); S.poll = 0; S.el.remove(); S.el = null; S.html = ''; S.open = false; S.screen = ''; S.note = '';
    read(true); return true;
  }
  const fail = (what, e) => { S.busy = ''; S.note = `!${what}: ${e?.code === 'private_mode_off' ? 'private mode is off on this Wizard' : e?.message || 'try again'}`; paint(); };
  async function step(which) {
    if (S.busy) return;
    S.busy = which; S.note = ''; paint();
    try {
      if (which === 'agent') { await post('agent', {}); S.busy = ''; await read(true); go('check'); }
      else if (which === 'apps') { await post('apps', { move: [...(S.ticked || [])] }); S.busy = ''; await read(true); go('context'); }
      else if (which === 'context') { await post('context', { grant: S.grant }); S.busy = ''; go('default'); }
      else if (which === 'default') { await post('default', { private: S.makeDefault }); S.busy = ''; await read(true); window.WosAgents?.load?.(true); go('done'); }
      else if (which === 'off') { await post('off', {}); S.busy = ''; await read(true); window.WosAgents?.load?.(true); close(); S.note = 'Private mode is off. Your apps are back on your standard agent.'; repaint(); }
    } catch (e) { fail({ agent: 'Couldn’t create the private agent', apps: 'Couldn’t move the apps', context: 'Couldn’t save that', default: 'Couldn’t save that', off: 'Couldn’t turn it off' }[which], e); }
  }
  function ask() {
    const ok = !!window.WosSkinHost?.textDraft?.(ASK);
    close();
    if (!ok) { S.note = '!Open Chats to ask your Wizard: ' + ASK; repaint(); }
  }
  // Capture, like the app settings sheet: its buttons never reach the shell's own handlers.
  document.addEventListener('click', e => {
    const t = e.target?.closest?.('[data-pm-row], [data-pm-why], [data-pm-setup], [data-pm-move], .pm-sheet');
    if (!t) return;
    if (t.classList.contains('pm-sheet')) { if (e.target === t) { e.stopPropagation(); close(); } else sheetTap(e); return; }
    e.stopPropagation(); e.preventDefault();
    if (t.dataset.pmRow != null) { const r = t.dataset.pmRow; if (r === 'on') open('off'); else if (r === 'off' || r === 'finish') open('setup'); return; }
    if (t.dataset.pmWhy != null) { open('why'); return; }
    if (t.dataset.pmSetup != null) { open('setup'); return; }
    if (t.dataset.pmMove != null) moveOne(t.dataset.pmMove);
  }, true);
  function sheetTap(e) {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.tagName === 'A') return; // links open where they say
    e.stopPropagation();
    if (t.dataset.pmClose != null) { close(); return; }
    if (t.dataset.pmGo) { step(t.dataset.pmGo); return; }
    if (t.dataset.pmTick) { const id = t.dataset.pmTick; if (!S.ticked) S.ticked = new Set(); S.ticked.has(id) ? S.ticked.delete(id) : S.ticked.add(id); paint(); return; }
    if (t.dataset.pmGrant != null) { S.grant = !S.grant; paint(); return; }
    if (t.dataset.pmDefault != null) { S.makeDefault = !S.makeDefault; paint(); return; }
    if (t.dataset.pmStore != null) { window.WizOpenApp?.('app-store', '/wizard-os-home/store/index.html?app=' + TINFOIL + '&open=1'); return; }
    if (t.dataset.pmAgents != null) { const id = P.st?.standard_agent || 'hermes'; close(); window.WosAppRoute?.openAgents?.(id); return; }
    if (t.dataset.pmAsk != null) ask();
  }
  try {
    window.WosSettings?.register?.({ id: 'private-mode', page: 'privacy', aliases: ['private-mode', 'privacy-check', 'private-ai'], html: pageHtml, act: () => false });
  } catch (e) { console.error(e); }
  window.WosPrivacy = {
    on, open, close, back: () => close() ? 'privacy' : '', read,
    // The model picker's Private group: Set up private AI while there is no private agent yet.
    setupDue() { if (P.st?.on === false) return false; const AG = window.WosAgents; return !!AG?.ready && !AG.others?.().some(a => AG.isPrivate(a)); },
    get isOpen() { return S.open; }, get state() { return P.st; }, get check() { return P.chk; }, get screen() { return S.screen; },
  };
})();
