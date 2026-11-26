/* Welcome: the whole first run, in one centred modal over the shell (Miguel, 29 Oct 2026).
 * It replaces the automatic Setup window, the gesture tour and the install banner on first run:
 *   1. Connect your AI   pick a provider (Claude first, recommended; ChatGPT; Tinfoil) and sign in inside its own app
 *                        page, opened with ?connect=1 so the app goes straight to its sign-in steps. A provider app
 *                        that is not installed yet is installed through the Store's own install path first.
 *   2. Pick a skin      any of the themes, applied live
 *   3. Say hello         the first message; the Chats window opens with it once it is sent
 * Every install method gets the same first run: it opens whenever no AI provider is signed in, and on a brand-new
 * Wizard (Agent Service setup first_run) whose agent already has a provider it starts at step 2. Existing Wizards
 * (first_run false, a provider signed in) never see it; one whose AI is signed out gets only Reconnect your AI
 * (issue 1750). Finishing posts /wizard/v1/setup/seen.
 * Look offers every skin, drawn with the Settings preview cards, over a lighter dim so the real
 * interface shows through. A card sets only that skin (WosSkin.set): skins and tweaks are independent, so it never
 * applies or changes tweaks, and opening the step never switches the skin; an owner who never picks keeps the fresh
 * default, Nebula (Miguel, 30 Oct 2026). The first message opens in the one main Chats window, on its own thread.
 * Name your Wizard (Miguel, 29 Oct 2026) comes first, only while the agent still has the default name: one field,
 * prefilled, Continue keeps it as it is unless edited; the name is saved in the Agent Service settings
 * (WizConfig.agentName) and every later step says it. Skipped or kept, the box stays "Wizard".
 * Both shells call WosWelcome.boot({...}) once their deep link has been consumed.
 * Hooks: app(id) -> installed app record, send(text) -> Promise, openStore(), deeplinked() -> boolean; Say hello's mic
 * (issue 1730): dictate() starts/stops the shell's own dictation into the focused field (false: no voice here),
 * dictateCancel(), voice() -> { state: 'idle'|'listen'|'paused'|'think'|… }. */
(() => {
  'use strict';
  const KEY = 'wos.welcome.v1', OPTIONS = '/wizard/hermes/api/model/options', SETUP = '/wizard/v1/setup', POLL_MS = 3000;
  const PROVIDERS = [
    // Alongside the Claude app adds to Hermes' own Anthropic pool; on a fresh Wizard its sign-in is the Claude Code
    // login, which Hermes reaches as the subscription provider (the app makes it the agent's model).
    { app: 'wizard-claude', name: 'Claude', note: 'Recommended', mark: 'claude', slug: ['anthropic', 'claude-subscription-directsdk-experimental'] },
    { app: 'wizard-chatgpt', name: 'ChatGPT', note: '', mark: 'chatgpt', slug: 'openai-codex' },
    { app: 'wizard-tinfoil', name: 'Tinfoil', note: 'Private', mark: 'tinfoil', slug: 'wizard-tinfoil' },
  ];
  /* Private first (wizard-ux issue 1549, wizard-os DECISIONS #115, switch wizard/private-first-setup, off by default):
   * Tinfoil leads, recommended; signing in to it makes the box's private agent (the Agent Service's part). Claude and
   * ChatGPT follow as optional extras that add a second agent. The Agent Service answers whether it is on
   * (GET /wizard/v1/private-first: its env WIZARD_PRIVATE_FIRST beats the Look file, which a fresh box does not have
   * yet); with no answer (an older Agent Service) the shell's own switch decides. Off: this Welcome is unchanged. */
  const PF_SWITCH = 'wizard/private-first-setup', PF_STATE = '/wizard/v1/private-first', PRIVATE = 'wizard-tinfoil';
  let pf = null, pfSeen = 0;
  const PF_GRACE = 7; // polls (about 20 s) a Tinfoil sign-in may wait for the private agent record
  const pfTweak = () => { try { return String(document.documentElement.getAttribute('data-tweaks') || '').split(' ').includes(PF_SWITCH); } catch (e) { return false; } };
  const privateFirst = () => (pf && typeof pf.on === 'boolean' ? pf.on : pfTweak());
  async function pfRead() {
    try {
      const r = await fetch(PF_STATE, { credentials: 'same-origin', cache: 'no-store', signal: tsig(4000) });
      const j = r.ok ? await r.json() : null;
      pf = j && typeof j === 'object' ? j : null;
    } catch (e) { pf = null; }
    return pf;
  }
  // Switch on: Tinfoil first, then the two extras; off: PROVIDERS as listed.
  const providers = () => (privateFirst() ? PROVIDERS.filter(p => p.app === PRIVATE).concat(PROVIDERS.filter(p => p.app !== PRIVATE)) : PROVIDERS);
  const extraNote = p => `Adds a second agent that uses ${p.name}. Your private agent and its apps stay private.`;
  /* Standard first (wizard-ux issue 1800, on for everyone since James's yes, 25 Nov 2026): Connect
   * your AI asks for Claude or ChatGPT first (the AI the owner already pays for, on the standard agent), with Skip for
   * now, also when the box says private first is on. Then, once, the Private AI step offers Set up private AI / Later /
   * No thanks. Set up private AI asks the Agent Service to opt this box in (POST /wizard/v1/private-first {offer}),
   * then runs the private first sign-in above (Tinfoil, the private agent made the default on a fresh box); Later and
   * No thanks are saved on the box, and Later leaves Settings › Privacy's "Finish setting up private AI", which opens
   * the same step on its own. Reconnect your AI never offers it. */
  const sfFirst = () => !reconnect;
  const STANDARD = ['wizard-claude', 'wizard-chatgpt'];
  // offered: this Welcome shows the Private AI step (decided when it opens); solo: opened for that step alone (Settings).
  // skipped: Skip for now with nothing connected; linked: providers connected in this Welcome.
  let offered = false, solo = false, skipped = false, offerBusy = '', offerError = '';
  const linked = new Set();
  const offerDue = () => sfFirst() && !pf?.private_agent && !pf?.offer;
  async function offerPost(choice) {
    const r = await fetch(PF_STATE, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer: choice }), signal: tsig(8000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || typeof j !== 'object') throw Object.assign(Error('offer ' + r.status), { status: r.status });
    pf = j; return j;
  }
  const brand = () => `<div class="wl-brand"><img src="brand/wizard-mark-white.png" alt=""><span>${OS()}</span></div>`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Product name: WizardOS, always one word (James, 8 Nov 2026; wizard-os#436).
  const OS = () => 'WizardOS';
  const log = s => { window.__welcomeLog = (window.__welcomeLog || []).concat(s).slice(-40); };
  // AbortSignal.timeout is missing on older iOS WebViews (see core/status.js): fall back to a controller and a timer.
  const tsig = ms => { try { if (AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (e) {}
    try { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; } catch (e) { return undefined; } };
  const read = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const write = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  let H = null, el = null, step = 'ai', provider = null, pollT = 0, connected = false, sending = false, booted = false, installing = '', installError = '', sendError = '';
  // The name step: asked = this Welcome starts with it; after = the step it hands over to.
  let asked = false, after = 'ai', saving = false, nameError = '', prefill = '';
  /* Reconnect (wizard-ux issue 1750): an existing Wizard (the box says first_run false, or this device finished the
   * Welcome) whose AI is signed out gets one screen, Reconnect your AI. Once the chosen provider is connected it saves
   * done and closes, back to where the owner was: no name, no Pick a skin, no Say hello. Only boot opens it this way. */
  let reconnect = false;
  const RECONNECT_WORDS = () => `Your AI isn\u2019t connected. Reconnect it so ${agent()} can answer.`;
  // Bring your AI (wizard-ux issue 898, Miguel 4 Nov 2026): an optional step before Say hello, only on a Wizard that has the
  // Importer app. It embeds that app's own screen, like the provider sign-in step, so there is one Importer, two ways in.
  const IMPORTER = 'importer';
  let bringOpen = false;
  const bringOn = () => { try { return isInstalled(IMPORTER); } catch (e) { return false; } };
  const order = () => solo ? ['private'] : (asked ? ['name'] : []).concat(['ai'], offered ? ['private'] : [], ['look'], bringOn() ? ['bring'] : [], ['hello']);
  const signing = () => step === 'ai' || step === 'private'; // a provider's sign-in page can show in either step
  const nextStep = () => { const all = order(), i = all.indexOf(step); return all[Math.min(all.length - 1, i + 1)] || 'hello'; };
  const prevStep = () => { const all = order(), i = all.indexOf(step); return i > 0 ? all[i - 1] : step; };
  const DEFAULT_NAME = 'Wizard', NAME_MAX = 40;
  // Say hello: the words the box shows are the words an empty Send sends (James, 22 Nov 2026; wizard-ux issue 1729).
  // One constant for both, so the placeholder and the default can never drift apart.
  const HELLO = 'Hi! What can you help me with?';
  // Plain text, one line, at most 40 characters (the Agent Service trims the same way).
  const cleanName = v => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  // Only a live answer counts: an offline or cached reading never asks a box that may already have a name.
  const unnamed = () => { const C = window.WizConfig; if (!C?.live || typeof C.agentName !== 'function') return false;
    const n = cleanName(C.raw?.settings?.agent?.name); return !n || n.toLowerCase() === DEFAULT_NAME.toLowerCase(); };

  /* Is there an AI the agent will really use? Not "any provider says authenticated": the virtual Mixture of Agents
   * always does, and the Claude subscription provider does as soon as the Claude Code program exists, signed in or
   * not (a fresh Wizard skipped "Connect your AI" and its first message failed). Those two count only when the owner
   * (or the Claude app after a sign-in) made them the agent's model. slug: that provider (or list) only. */
  const SUB = 'claude-subscription-directsdk-experimental';
  function aiConnected(j, slug) {
    const want = slug ? [].concat(slug) : null, current = String(j?.provider || '');
    return (j?.providers || []).some(p => {
      if (!p || p.authenticated !== true || (want && !want.includes(p.slug))) return false;
      if (p.auth_type === 'virtual' || p.source === 'virtual') return false;
      return p.slug !== SUB || current === SUB;
    });
  }
  // slug: only that provider counts (the one being signed in to); none: any signed-in provider.
  async function aiReady(slug) {
    try {
      const r = await fetch(OPTIONS, { credentials: 'same-origin', cache: 'no-store', signal: tsig(5000) });
      if (!r.ok) return null;
      const j = await r.json();
      return aiConnected(j, slug);
    } catch (e) { return null; }
  }

  async function setupState() {
    try {
      const r = await fetch(SETUP, { credentials: 'same-origin', cache: 'no-store', signal: tsig(4000) });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  // The server's "seen" is what keeps the Welcome away on other browsers and devices: retry it on later launches
  // until the Agent Service acknowledges it.
  const SEEN_PENDING = KEY + '.seen-pending';
  function markSeen() {
    try { localStorage.setItem(SEEN_PENDING, '1'); } catch (e) {}
    return fetch(SETUP + '/seen', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(r => { if (r.ok) { try { localStorage.removeItem(SEEN_PENDING); } catch (e) {} } else log('seen:' + r.status); }, () => log('seen:offline'));
  }
  const seenPending = () => { try { return localStorage.getItem(SEEN_PENDING) === '1'; } catch (e) { return false; } };

  const isInstalled = id => !!H.app(id)?.url;
  // Not installed yet: install it the way the Store does (same endpoint, same release check), then sign in.
  async function install(id) {
    const base = new URL('./', document.baseURI);
    const [installRelease, apps] = await Promise.all([
      import(new URL('store/store-install.js', base).href).then(m => m.installRelease, () => async (r) => { // shells before store-install.js
        const res = await fetch(new URL('store-install/' + encodeURIComponent(r.id), base), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ source: r.source, repo: r.repo, commit: r.commit, operation: 'install' }) });
        let j = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 202) throw Error(j.error || 'Install failed.');
        for (let i = 0; j.state === 'installing' && i < 360; i++) {
          await new Promise(r => setTimeout(r, 1000));
          j = await (await fetch(new URL('store-install/' + encodeURIComponent(r.id), base), { credentials: 'same-origin', cache: 'no-store' })).json().catch(() => ({ state: 'installing' }));
        }
        if (j.state !== 'installed') throw Error(j.error || 'The install did not finish. Try again.');
      }),
      (async () => {
        const out = [];
        for (let offset = 0, i = 0; offset != null && i < 10; i++) {
          const r = await fetch(new URL(`store-data/wizard/v1/index/search?limit=100&offset=${offset}`, base), { credentials: 'same-origin', cache: 'no-store' });
          if (!r.ok) throw Error('The App Store is unavailable.');
          const j = await r.json(); out.push(...(j.apps || [])); offset = j.next_offset;
        }
        return out;
      })(),
    ]);
    // Two listings can share an id (one app, two repos): take the newest version, as the Store's listing shows first.
    const ver = v => String(v || '0').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const newer = (x, y) => { const a = ver(x.version), b = ver(y.version); for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (b[i] || 0) - (a[i] || 0); return 0; };
    const all = apps.filter(x => x.id === id), a = all.filter(x => !x.conflict).sort(newer)[0];
    // The Store asks the owner to choose when two sources list the same app; the first run never guesses for them.
    if (!a) throw Error(all.length ? 'This app has two App Store listings right now. Install it from the Store, or pick another for now.' : 'This AI app is not in the App Store yet.');
    await installRelease({ ...a, operation: 'install' }, { base });
    for (let i = 0; i < 30 && !isInstalled(id); i++) { await window.WizCore?.refreshApps?.(); if (!isInstalled(id)) await new Promise(r => setTimeout(r, 2000)); }
    if (!isInstalled(id)) throw Error('Installed. It is still starting; try again in a moment.');
  }
  const signinUrl = u => { try { const x = new URL(u, location.href); x.searchParams.set('connect', '1'); return x.href; } catch (e) { return u; } };
  // The Importer drops its own title inside the Welcome card, which already says "Bring your AI".
  const embedUrl = u => { try { const x = new URL(u, location.href); x.searchParams.set('embedded', '1'); return x.href; } catch (e) { return u; } };
  const agent = () => { try { return window.WizConfig?.agent?.() || 'Wizard'; } catch (e) { return 'Wizard'; } };
  // Browser owner boundary (wizard-os#133, box switch): the provider sign-in and the Importer are app pages, so they run
  // sandboxed (opaque origin) like any app window; the attribute must be in the markup so the first load is sandboxed.
  // The app id puts the app's saved settings in the frame's name, as an app window gets them (core/browser-boundary.js).
  const sbx = (u, id) => { const B = window.WizBrowserBoundary; return B?.enabled ? ' ' + B.frameAttributes(u, id) : ''; };
  let frameOff = () => {};

  function dots() {
    if (reconnect || solo) return '';
    const all = order(), i = all.indexOf(step);
    return `<div class="wl-dots" aria-hidden="true">${all.map((x, n) => `<i class="${n === i ? 'on' : n < i ? 'done' : ''}"></i>`).join('')}</div>`;
  }

  function paintName() {
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Name your Wizard</h2><p>What do you want to call your agent?</p></header>
      <form class="wl-naming" data-wl-name><input type="text" maxlength="${NAME_MAX}" value="${esc(prefill)}" aria-label="Your agent's name" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done"${saving ? ' disabled' : ''}>
      ${nameError ? `<p class="wl-status err" role="alert">${esc(nameError)}</p>` : ''}<button type="submit" class="wl-primary"${saving ? ' disabled' : ''}>${saving ? 'Saving\u2026' : 'Continue'}</button></form>
      <button type="button" class="wl-skip" data-wl="skip-name"${saving ? ' disabled' : ''}>Skip this step</button>`;
  }
  // Leave the name step for the step this Welcome was opened for.
  function fromName() { step = after; saving = false; nameError = ''; paint(); poll(); }
  async function saveName(value) {
    const name = cleanName(value);
    // Untouched (or emptied): keep the name. Compared with what the field was filled with, never with the live name,
    // so a rename made meanwhile on another device is not written back over.
    if (!name || name === cleanName(prefill)) { log('name:kept'); return fromName(); }
    const mine = el; saving = true; nameError = ''; paint(false);
    try { await window.WizConfig.agentName(name, { from: prefill }); }
    catch (err) {
      if (el !== mine || step !== 'name') return;
      saving = false;
      // Named on another device since this step opened: show that name; Continue keeps it, an edit still saves.
      if (err?.code === 'conflict' && err.current) { prefill = err.current; nameError = `Another device just named your agent ${err.current}. Continue keeps it.`; paint(false); return; }
      nameError = 'That name didn\u2019t save. Try again, or skip this step.'; paint(false);
      const i = el.querySelector('.wl-naming input'); if (i) i.value = name;
      return;
    }
    if (el !== mine || step !== 'name') return;
    log('name:saved'); fromName();
  }

  function paintAI() {
    if (provider) return paintSignin();
    // A new Wizard asks for Claude or ChatGPT first (standard first); Reconnect your AI keeps the box's own order.
    if (!reconnect) return paintStandardAI();
    if (privateFirst()) return paintPrivateAI();
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Reconnect your AI</h2><p>${esc(RECONNECT_WORDS())}</p></header>
      <div class="wl-choices">${PROVIDERS.map(p => `<button type="button" class="wl-choice" data-wl="provider" data-app="${esc(p.app)}"${installing ? ' disabled' : ''}><span class="wl-mark"><img src="brand/apps/${esc(p.mark)}.svg" alt=""></span><span class="wl-name">${esc(p.name)}</span>${installing === p.app ? '<span class="wl-sub">Installing…</span>' : p.note ? `<span class="wl-tag${p.note === 'Recommended' ? '' : ' soft'}">${esc(p.note)}</span>` : ''}</button>`).join('')}</div>
      ${installError ? `<p class="wl-status err" role="alert">${esc(installError)}</p>` : ''}`;
  }
  function paintSignin() {
    const p = PROVIDERS.find(x => x.app === provider), a = H.app(provider);
    return `${brand()}${dots()}<header class="wl-head wl-row"><button type="button" class="wl-back" data-wl="back" aria-label="Back">‹</button><h2 tabindex="-1">Sign in to ${esc(p.name)}</h2></header>
      <div class="wl-frame"><iframe src="${esc(signinUrl(a.url))}"${sbx(signinUrl(a.url), provider)} allow="geolocation 'none'" title="${esc(p.name)} sign-in"></iframe></div>
      <p class="wl-status${connected ? ' ok' : ''}" role="status">${connected ? `${esc(p.name)} is connected.` : `${privateFirst() && reconnect && p.app !== PRIVATE ? esc(extraNote(p)) + ' ' : ''}This continues by itself once you are signed in.`}</p>`;
  }

  // Standard first's Connect your AI: Claude and ChatGPT on the standard agent; Skip for now (no model yet) is allowed.
  function paintStandardAI() {
    const choice = p => { const done = linked.has(p.app);
      return `<button type="button" class="wl-choice" data-wl="provider" data-app="${esc(p.app)}"${installing || done ? ' disabled' : ''}><span class="wl-mark"><img src="brand/apps/${esc(p.mark)}.svg" alt=""></span><span class="wl-name">Sign in with ${esc(p.name)}</span>${done ? '<span class="wl-tag soft">Connected</span>' : installing === p.app ? '<span class="wl-sub">Installing…</span>' : ''}</button>`; };
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Connect your AI</h2><p>Sign in with the AI you already pay for. We recommend at least one; you can add more later.</p></header>
      <div class="wl-choices">${STANDARD.map(id => choice(PROVIDERS.find(p => p.app === id))).join('')}</div>
      ${installError ? `<p class="wl-status err" role="alert">${esc(installError)}</p>` : ''}${linked.size ? '<button type="button" class="wl-primary" data-wl="next">Continue</button>' : '<button type="button" class="wl-skip" data-wl="skip-ai">Skip for now</button>'}`;
  }

  // Standard first's Private AI step (offered once). With nothing connected it leads with private AI as the way to get
  // a model. "Why does this matter?" waits for its page (wizard-ux issue 1801), so it is not drawn yet.
  function paintOffer() {
    if (provider) return paintSignin();
    const none = skipped && !linked.size, busy = !!offerBusy;
    const btn = (choice, label, cls) => `<button type="button" class="${cls}" data-wl="offer" data-offer="${choice}"${busy || installing ? ' disabled' : ''}>${offerBusy === choice || (choice === 'setup' && installing) ? (choice === 'setup' && installing ? 'Installing\u2026' : 'One moment\u2026') : label}</button>`;
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Want a fully private AI?</h2>${none ? `<p class="wl-lead">You haven\u2019t connected an AI yet. Private AI can be how ${esc(agent())} thinks: set it up now and ${esc(agent())} can answer you.</p>` : ''}<p>Private AI runs in sealed hardware. No one except you, not us or any AI company, can see your messages, its answers or your data. Use it alongside your Claude or ChatGPT, or on its own.</p></header>
      ${offerError || installError ? `<p class="wl-status err" role="alert">${esc(offerError || installError)}</p>` : ''}
      ${btn('setup', 'Set up private AI', 'wl-primary')}
      <div class="wl-offer-more">${btn('later', 'Later', 'wl-skip')}${btn('declined', 'No thanks', 'wl-skip')}</div>`;
  }
  // The answer: Set up private AI opts the box in, then signs in to Tinfoil here; Later and No thanks go on.
  async function answer(choice) {
    if (offerBusy || installing || step !== 'private') return;
    const mine = el; offerBusy = choice; offerError = ''; installError = ''; paint(false);
    let ok = true;
    try { await offerPost(choice); log('offer:' + choice); } catch (err) { ok = false; log('offer:' + choice + ':' + (err?.status || 'offline')); }
    if (el !== mine || step !== 'private') return;
    offerBusy = '';
    if (choice === 'setup') {
      if (!ok || !privateFirst()) { offerError = 'Private AI can\u2019t be set up on this Wizard yet. Choose Later to find it in Settings \u203a Privacy.'; paint(false); return; }
      pfSeen = 0; return choose(PRIVATE);
    }
    // Later and No thanks: the box remembers when it can; the Welcome goes on either way.
    offerDone();
  }
  function offerDone() { if (solo) { close(); log('offer:closed'); try { window.WosSettings?.refresh?.(); } catch (e) {} return; } step = nextStep(); provider = null; paint(); }

  // Private first's Connect your AI: Tinfoil, then "Optional: a second agent" with Claude and ChatGPT. Once the private
  // agent is ready the card stays here, so the owner can add a second agent or go on.
  // Reconnect your AI on a box with private first on (a new Wizard always gets standard first's Connect your AI).
  function paintPrivateAI() {
    const choice = (p, lead) => {
      const tag = installing === p.app ? '<span class="wl-sub">Installing…</span>' : lead ? '<span class="wl-tag">Recommended</span>' : '';
      return `<button type="button" class="wl-choice${lead ? '' : ' wl-extra'}" data-wl="provider" data-app="${esc(p.app)}"${installing ? ' disabled' : ''}><span class="wl-mark"><img src="brand/apps/${esc(p.mark)}.svg" alt=""></span><span class="wl-name">${esc(p.name)}${lead ? '<span class="wl-sub">Private</span>' : `<span class="wl-sub">${esc(extraNote(p))}</span>`}</span>${tag}</button>`;
    };
    const [lead, ...extras] = providers();
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Reconnect your AI</h2><p>${esc(RECONNECT_WORDS())}</p></header>
      <div class="wl-choices">${choice(lead, true)}</div>
      <p class="wl-extras-h">Optional: a second agent</p>
      <div class="wl-choices wl-extras">${extras.map(p => choice(p, false)).join('')}</div>
      ${installError ? `<p class="wl-status err" role="alert">${esc(installError)}</p>` : ''}`;
  }

  // The same preview cards as Settings › Look (core/settings.js skinCard + core/skins.css .skp): every color, any author.
  const pvars = k => { const t = k.t || {}; return [['bg', t.bg || k.bg], ['ink', t.ink], ['ac', t.violet || k.accent], ['ac2', t['violet-2']], ['pk', t.pink], ['cy', t.cyan], ['dock', t['sk-dock']], ['dl', t['sk-dock-line']]]
    .filter(([, v]) => v).map(([n, v]) => `--p-${n}:${esc(v)}`).join(';'); };
  const card = (k, cur) => `<button type="button" class="skp-card" data-wl="palette" data-id="${esc(k.id)}" aria-pressed="${k.id === cur}" aria-label="${esc(k.name)}"><span class="skp-mini" data-skp="${esc(k.id)}" style="${pvars(k)}" aria-hidden="true"><i class="skp-a"></i><i class="skp-a skp-a2"></i><i class="skp-u"></i><i class="skp-dock"><i class="skp-orb"></i></i></span><span class="skp-nm">${esc(k.name)}</span></button>`;
  function paintLook() {
    const S = window.WosSkin;
    if (!S?.list?.length) return paintHello();
    const cur = S.current, list = S.list;
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Pick a skin</h2><p>You can change it any time in Settings.</p></header>
      <div class="st-root wl-skp"><div class="skp" role="group" aria-label="Skins">${list.map(k => card(k, cur)).join('')}</div></div>
      <button type="button" class="wl-primary" data-wl="next">Continue</button>`;
  }

  function paintBring() {
    if (bringOpen) {
      const a = H.app(IMPORTER);
      return `${brand()}${dots()}<header class="wl-head wl-row"><button type="button" class="wl-back" data-wl="back" aria-label="Back">‹</button><h2 tabindex="-1">Bring your AI</h2></header>
        <div class="wl-frame wl-embed"><iframe src="${esc(embedUrl(a?.url || ''))}"${sbx(embedUrl(a?.url || ''), IMPORTER)} allow="geolocation 'none'" title="Importer"></iframe></div>
        <button type="button" class="wl-primary" data-wl="next">Continue</button>`;
    }
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Bring your AI</h2><p>Optional. Used ChatGPT, Claude or another agent? Bring your memories, chats and skills so ${esc(agent())} knows you from day one.</p></header>
      <button type="button" class="wl-primary" data-wl="bring">Bring my AI</button>
      <button type="button" class="wl-skip" data-wl="next">Not now</button>`;
  }

  function paintHello() {
    const mic = !!H?.dictate;
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Say hello</h2><p>${mic ? `Type or speak your first message to ${esc(agent())}.` : `Send your first message to ${esc(agent())}.`}</p></header>
      <form class="wl-hello" data-wl-form><div class="wl-say"><textarea rows="3" placeholder="${esc(HELLO)}" aria-label="First message"></textarea>${mic ? `<button type="button" class="wl-mic" data-wl="mic" aria-pressed="false" aria-label="Speak your first message" title="Speak your first message"${sending ? ' disabled' : ''}>${MIC_SVG}</button>` : ''}</div>
      ${mic ? `<p class="wl-voice${voiceMsg.err ? ' err' : ''}" role="status" aria-live="polite">${esc(voiceMsg.text)}</p>` : ''}
      ${sendError ? `<p class="wl-status err" role="alert">${esc(sendError)}</p>` : ''}<button type="submit" class="wl-primary"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Send'}</button></form>`;
  }

  /* Say hello by voice (wizard-ux issue 1730, James 22 Nov 2026: "there's no microphone button or orb they can use here").
   * One recorder: the mic hands the box to the shell's own dictation (H.dictate: the phone's startVoice('dictation'),
   * which takes the Android app's native mic when there is one, or the desktop's dictate()), the same take the orb and
   * the dictate key make. Tap to start, tap again to stop: the shell's transcriber types the words into the box, and
   * the owner sees them before Send. The shell's own recording pill sits under this card, so the card says what is
   * happening, and says so plainly when the microphone can't start (typing and Send keep working). The box is never
   * repainted while a take is open: the shell's dictation writes into that exact element. */
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18v4"/></svg>';
  const VOICE_MSG = {
    listen: 'Listening… tap the mic again when you are done.',
    think: 'Writing down what you said…',
    mic: 'The microphone could not start. Allow microphone access for WizardOS, or type your message.',
    none: 'Voice isn\u2019t set up on this Wizard yet. Type your message instead.',
    empty: 'No words came through: voice may not be working right now. Tap the mic to try again, or type your message.',
  };
  let voiceMsg = { text: '', err: false }, take = null;
  const voiceState = () => { try { const s = H?.voice?.(); return s && typeof s.state === 'string' ? s.state : 'idle'; } catch (e) { return 'idle'; } };
  function voiceShow(key) {
    voiceMsg = key ? { text: VOICE_MSG[key], err: key === 'mic' || key === 'none' || key === 'empty' } : { text: '', err: false };
    const m = el?.querySelector('.wl-voice'); if (m) { m.textContent = voiceMsg.text; m.classList.toggle('err', voiceMsg.err); }
  }
  function micPaint(on, busy) {
    const b = el?.querySelector('.wl-mic'), send = el?.querySelector('.wl-hello [type=submit]');
    if (b) { b.setAttribute('aria-pressed', String(!!on)); b.classList.toggle('on', !!on); b.classList.toggle('busy', !!busy); b.disabled = !!busy || sending;
      const l = on ? 'Stop and write it in the box' : 'Speak your first message'; b.setAttribute('aria-label', l); b.title = l; }
    if (send) send.disabled = !!(on || busy) || sending; // the words land in the box first; Send waits for them
  }
  function micTap() {
    if (!el || step !== 'hello' || sending || !H?.dictate) return;
    const box = el.querySelector('textarea'); if (!box) return;
    if (take) { // a second tap stops the take; the shell transcribes it into the box
      if (take.stopped || voiceState() === 'think') return;
      let r = false; try { r = H.dictate(); } catch (e) { console.error(e); }
      if (r !== false) { take.stopped = true; log('mic:stop'); } else log('mic:stop-wait'); // still opening: tap again
      return;
    }
    // The shell's dictation writes into the focused field: the box keeps (or takes) focus.
    if (document.activeElement !== box) box.focus({ preventScroll: true });
    voiceShow('');
    // No transcriber on this box (the same check that hides the desktop mic): say so instead of recording for nothing.
    try { if (window.WizConfig?.has && !window.WizConfig.has('voice')) { log('mic:no-voice'); voiceShow('none'); return; } } catch (e) {}
    let r = false; try { r = H.dictate(); } catch (e) { console.error(e); }
    if (r === false) { log('mic:none'); voiceShow('none'); return; }
    const mine = take = { t0: Date.now(), seen: new Set(), stopped: false, before: box.value, box };
    log('mic:start'); micPaint(true, false); voiceShow('listen');
    const watch = () => {
      if (take !== mine) return;
      const s = voiceState();
      if (s !== 'idle') {
        mine.seen.add(s);
        if (s === 'think') { micPaint(false, true); voiceShow('think'); } else { micPaint(true, false); voiceShow('listen'); }
        mine.timer = setTimeout(watch, 150); return;
      }
      // Idle: give the shell a moment to open the mic before calling it a failure.
      if (!mine.seen.size && !mine.stopped && Date.now() - mine.t0 < 1500) { mine.timer = setTimeout(watch, 150); return; }
      take = null; micPaint(false, false);
      if (!el || !mine.box.isConnected) return;
      const changed = mine.box.value !== mine.before;
      log('mic:end:' + [...mine.seen].join('+') + (changed ? ':words' : ''));
      if (changed) { voiceShow(''); mine.box.focus({ preventScroll: true }); return; }
      voiceShow(mine.seen.has('think') || mine.stopped ? 'empty' : 'mic');
    };
    mine.timer = setTimeout(watch, 150);
  }
  // Leaving Say hello (Back, close) with a take open: the take is cancelled, never typed into a box that is gone.
  function micDrop() {
    if (!take) return;
    const t = take; take = null; clearTimeout(t.timer);
    if (voiceState() !== 'idle' && voiceState() !== 'think') { try { H?.dictateCancel?.(); } catch (e) {} }
    log('mic:drop');
  }

  function paint(focus = true) {
    if (!el) return;
    const card = el.querySelector('.wl-card');
    card.classList.toggle('wide', (signing() && !!provider) || (step === 'bring' && bringOpen));
    el.classList.toggle('wl-peek', step === 'look');
    card.innerHTML = step === 'name' ? paintName() : step === 'ai' ? paintAI() : step === 'private' ? paintOffer() : step === 'look' ? paintLook() : step === 'bring' && bringOn() ? paintBring() : paintHello();
    // Escape inside the provider's own page (same origin) still steps back; a cross-origin page keeps the Back button.
    const fr = card.querySelector('.wl-frame iframe');
    frameOff(); frameOff = () => {};
    const B = window.WizBrowserBoundary;
    if (fr && B?.enabled && fr.hasAttribute('sandbox')) {
      // Sandboxed: the shell never reads the page. Esc comes over the boundary channel instead (core/browser-boundary.js).
      // The page is an installed app's own page, so it is attached as that app's window (core/app-services.js): its
      // calls to its own backend, saved settings and IndexedDB go through the shell as in any app window. Without that
      // an opaque sign-in page's fetch goes out with Origin null and no cookie, and signing in never finishes.
      const id = signing() ? provider : IMPORTER, url = H?.app?.(id)?.url, here = () => !!el && fr.isConnected && card.contains(fr);
      const offApp = url && window.WizAppServices?.attach?.(fr, { appId: id, path: url, isFront: here, isVisible: here, back: () => { if (!here()) return false; back(); return true; } });
      const detach = B.attach(fr), stop = B.onInput((f, ev) => { if (f === fr && fr.isConnected && ev.kind === 'key' && ev.type === 'keydown' && ev.key === 'Escape') back(); });
      frameOff = () => { stop(); if (typeof offApp === 'function') offApp(); detach(); };
    } else if (fr) fr.addEventListener('load', () => { try { fr.contentDocument.addEventListener('keydown', e => { if (e.key === 'Escape') { if (window.WosBack?.escape) return window.WosBack.escape(e); e.preventDefault(); back(); } }, true); } catch (e) {} });
    // The name field takes focus with a mouse and keyboard; on a phone the keyboard waits for a tap on the field.
    const fine = (() => { try { return matchMedia('(pointer: fine)').matches; } catch (e) { return false; } })();
    if (focus) requestAnimationFrame(() => { const nm = fine && card.querySelector('.wl-naming input:not([disabled])');
      if (nm) { nm.focus({ preventScroll: true }); nm.select?.(); return; }
      (card.querySelector('textarea') || card.querySelector('h2'))?.focus({ preventScroll: true }); });
  }

  function poll() {
    clearTimeout(pollT);
    if (!el || !signing() || !provider) return; // only while signing in to a chosen provider
    const mine = el, chosen = provider, at = step; // a reply for an earlier choice (Back, then another provider) is ignored
    pollT = setTimeout(async () => {
      let ok = await aiReady(PROVIDERS.find(x => x.app === chosen)?.slug);
      // Private first: Tinfoil is done once the Agent Service has the private agent (its record decides, not the
      // provider sign-in alone). A box that is not fresh never gets a default private agent recorded (wizard-agent-service
      // server/private-first.mjs), so a sign-in seen for PF_GRACE polls without one goes on; an older Agent Service
      // (no answer) keeps the sign-in rule.
      const priv = privateFirst() && chosen === PRIVATE;
      if (priv && el === mine) {
        const s = await pfRead();
        if (s?.private_agent) ok = true;
        else if (s && ok === true) { pfSeen++; ok = pfSeen >= PF_GRACE ? true : null; }
      }
      if (!el || el !== mine || step !== at || provider !== chosen) return;
      if (ok === true) {
        // The shell read its model list before this sign-in: refresh it now, so the first message (and the chat's model
        // chip) uses the AI just signed in, not an empty list cached at boot (desktop, wizard-ux#1811).
        const M = window.WosModels; if (M?.load) M.load(true).then(() => window.dispatchEvent?.(new Event('wos:models'))).catch(() => {});
        // Reconnect: this Wizard is set up already, so connected is the end; it closes by itself a moment later.
        if (reconnect) { connected = true; write('done'); log('reconnected'); paint(false); setTimeout(() => { if (el === mine && step === 'ai' && provider === chosen) close(); }, 1200); return; }
        connected = true; if (!solo) write('ai'); linked.add(chosen); log('connected'); paint(false);
        // Standard first's Set up private AI: the private agent is ready, so the Welcome goes on (Settings: it closes).
        if (at === 'private') { setTimeout(() => { if (el === mine && step === at && provider === chosen) offerDone(); }, 1200); return; }

        setTimeout(() => { if (el && step === 'ai' && provider === chosen) { step = nextStep(); provider = null; paint(); } }, 1200); // Back cancels it
        return;
      }
      poll();
    }, POLL_MS);
  }

  function open(at = 'ai', opts = {}) {
    if (el) return;
    reconnect = !!opts.reconnect && at === 'ai';
    // Standard first: the Private AI step on its own (Settings › Privacy), or once after Connect your AI. A box whose AI
    // was connected before the Welcome (a Mac's setup) starts at it instead of the skin.
    solo = at === 'private';
    offered = solo || offerDue(); skipped = false; offerBusy = ''; offerError = ''; linked.clear();
    if (at === 'look' && offered) at = 'private';
    asked = !reconnect && !solo && unnamed(); after = at; saving = false; nameError = ''; prefill = agent();
    step = asked ? 'name' : at; provider = null; connected = false; sending = false; installing = ''; installError = ''; sendError = ''; bringOpen = false;
    el = document.createElement('div');
    el.className = 'wl-overlay'; el.id = 'wosWelcome';
    el.innerHTML = `<div class="wl-card" role="dialog" aria-modal="true" aria-label="${reconnect ? 'Reconnect your AI' : solo ? 'Private AI' : 'Welcome'}"></div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add('wl-open');
    try { window.WizardPwaInstall?.hold(true); } catch (e) {}
    el.addEventListener('click', onClick);
    // The mic never takes focus from the box: the shell's dictation writes into the focused field.
    el.addEventListener('mousedown', e => { if (e.target.closest?.('.wl-mic')) e.preventDefault(); });
    el.addEventListener('submit', onSubmit);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.matches('textarea')) { e.preventDefault(); el.querySelector('form')?.requestSubmit(); }
      if (e.key === 'Tab') { // keep focus inside the card
        const f = [...el.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,iframe,[tabindex]:not([tabindex="-1"])')];
        if (f.length) { const i = f.indexOf(document.activeElement); const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length; e.preventDefault(); f[n].focus(); }
      }
      e.stopPropagation(); // the shell's own shortcuts wait until the welcome is done (desktop onKey also stands down)
    });
    paint(); poll(); log('open:' + at + (asked ? ':name' : '') + (reconnect ? ':reconnect' : '') + (offered ? ':offer' : ''));
    // Opened from Settings or the Setup tile: read the private first answer if boot did not, then repaint Connect your AI.
    if (!pf && (at === 'ai' || solo)) { const mine = el; pfRead().then(s => { if (!s || el !== mine) return;
      if (!solo && !offered && order().indexOf(step) <= order().indexOf('ai') && offerDue()) offered = true; // still before the offer
      if ((step === 'ai' || step === 'private') && !provider) paint(false); }); }
  }

  function close() {
    clearTimeout(pollT);
    micDrop(); voiceMsg = { text: '', err: false };
    frameOff(); frameOff = () => {};
    if (!el) return;
    el.remove(); el = null;
    document.documentElement.classList.remove('wl-open');
    try { window.WizardPwaInstall?.hold(false); } catch (e) {}
  }

  // Sign in to one provider (installed first when it is not), in the step showing it.
  function choose(id) {
    installError = '';
    const at = step;
    if (isInstalled(id)) { provider = id; connected = false; paint(); poll(); return; }
    installing = id; paint(false);
    const mine = el; // a Welcome closed and reopened meanwhile (or another install) must not be taken over
    install(id).then(() => { if (el !== mine || installing !== id) return; installing = ''; if (step === at) { provider = id; connected = false; paint(); poll(); } },
      err => { if (el !== mine || installing !== id) return; installing = ''; installError = err?.message || 'Install failed.'; paint(false); });
  }

  function onClick(e) {
    const t = e.target.closest('[data-wl]'); if (!t) return;
    const act = t.dataset.wl;
    if (act === 'provider') { pfSeen = 0; choose(t.dataset.app); }
    else if (act === 'skip-ai' && step === 'ai') { skipped = !linked.size; log('ai:skipped'); step = nextStep(); provider = null; paint(); }
    else if (act === 'offer' && step === 'private') answer(t.dataset.offer);
    else if (act === 'back' && step === 'bring') { bringOpen = false; paint(); }
    else if (act === 'back') { clearTimeout(pollT); provider = null; paint(); }
    else if (act === 'store') { close(); H.openStore?.(); }
    else if (act === 'palette') { window.WosSkin?.set(t.dataset.id); paint(false); }
    else if (act === 'next') { step = nextStep(); bringOpen = false; log('step:' + step); paint(); }
    else if (act === 'bring' && step === 'bring') { bringOpen = true; log('bring:open'); paint(); }
    else if (act === 'skip-name' && step === 'name' && !saving) { log('name:skipped'); fromName(); }
    else if (act === 'mic') micTap();
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (step === 'name') { if (!saving) saveName(el.querySelector('.wl-naming input')?.value); return; }
    if (sending || take) return; // a take still open: its words land in the box first
    // An empty or blank box sends the words it shows; typed words go as typed. Send is never a dead tap here.
    const text = el.querySelector('textarea')?.value.trim() || HELLO;
    sending = true; sendError = ''; paint(false);
    let item = null;
    try { item = await H.send(text); } catch (err) { console.error(err); }
    sending = false;
    // Finish only once the message is safely queued: a failed save keeps the words here and the Welcome on screen.
    if (!item) { sendError = 'That didn\u2019t send. Try again.'; paint(false); const t = el?.querySelector('textarea'); if (t) t.value = text; return; }
    write('done'); markSeen(); close(); log('sent');
  }

  // Back (phone back gesture / desktop Esc): leave the provider's sign-in, then step back; at the start, close.
  function back() {
    if (!el) return '';
    if (sending) return 'welcome'; // a send settles in a moment; an install keeps going in the background if Back closes
    if (saving) return 'welcome'; // the name is being saved; it settles in a moment
    if (signing() && provider) { clearTimeout(pollT); provider = null; paint(); return 'welcome'; }
    if (step === 'private' && !solo) { step = prevStep(); paint(); return 'welcome'; }
    if (step === 'bring' && bringOpen) { bringOpen = false; paint(); return 'welcome'; }
    if (step === 'hello' || step === 'bring') { if (step === 'hello') { micDrop(); voiceMsg = { text: '', err: false }; } step = prevStep(); bringOpen = false; paint(); return 'welcome'; }
    if (asked && step === after && !saving) { clearTimeout(pollT); step = 'name'; paint(); return 'welcome'; } // back to the name
    close(); log('back:close'); return 'welcome';
  }

  // The owner already started something (a tap, a key, a recording) before the reads came back: never cover it.
  // The Welcome then waits for the next launch, like the Setup launcher it replaces.
  let acted = false;
  const act = () => { acted = true; };
  /* Standard first on a deep-linked first launch (issue 1800): a Mac's setup connects ChatGPT or Claude itself and opens
   * the first chat with ?session= (try-wizard issue 171), which keeps the Welcome away. While the box is still in its
   * first run with the AI connected and the offer unanswered, the Private AI step opens on its own over that chat, once;
   * Later or No thanks closes it back to the chat. The owner acting first leaves it for the next launch's Welcome. */
  async function deepOffer(h) {
    const [ok, setup] = await Promise.all([aiReady(), setupState()]);
    if (ok !== true || setup?.first_run !== true) { log('deeplink:none:' + ok + ':' + setup?.first_run); return; }
    await pfRead();
    if (el || acted || h.busy?.() || !offerDue()) { log('deeplink:no-offer'); return; }
    log('deeplink:offer'); open('private');
  }
  function boot(h) {
    if (booted || !h) return; booted = true; H = h;
    try { addEventListener('pointerdown', act, true); addEventListener('keydown', act, true); } catch (e) {}
    setTimeout(async () => {
      if (seenPending()) markSeen();
      if (h.deeplinked?.()) { log('deeplink'); if (typeof deepOffer === 'function') deepOffer(h); return; }
      let [ok, setup] = await Promise.all([aiReady(), setupState(), Promise.race([Promise.resolve(window.WizCore?.appsLoaded?.()).catch(() => {}), new Promise(r => setTimeout(r, 5000))]),
        Promise.race([Promise.resolve(window.WizConfig?.ready).catch(() => {}), new Promise(r => setTimeout(r, 5000))])]); // never wait forever on the app list or the settings
      // Private first: a private agent already made counts as connected (its provider may not be the main agent's).
      // Read before the tap/key listeners go, so the owner acting meanwhile still keeps the Welcome away.
      // (typeof: tests vm-slice boot() on its own.)
      if (ok === false && typeof pfRead === 'function' && (await pfRead())?.private_agent && privateFirst()) { ok = true; log('boot:private'); }
      // Standard first (issue 1800): whether the Private AI offer is still open is the box's answer, read before opening.
      else if (ok === true && typeof pfRead === 'function') await pfRead();
      const state = read();
      log('boot:' + ok + ':' + state + ':' + (setup?.first_run === true));
      try { removeEventListener('pointerdown', act, true); removeEventListener('keydown', act, true); } catch (e) {}
      if ((ok === false || ok === true) && (acted || h.busy?.() || h.deeplinked?.())) { log('boot:busy'); return; }
      // A Wizard that is not new only needs its AI back (issue 1750). The box decides (a reset box says first_run true
      // again, whatever this browser remembers); this device having finished counts only when the box gives no answer.
      const existing = typeof setup?.first_run === 'boolean' ? !setup.first_run : state === 'done';
      if (ok === false) return open('ai', { reconnect: existing });
      if (ok === true && state !== 'done' && !existing && (state === 'ai' || setup?.first_run === true)) return open('look');
    }, 0);
  }

  // The first thread exists on the agent a moment after the message is saved. Open it only once the agent knows it
  // (or its first run has started), so the window never lands on a "thread is no longer here" placeholder.
  // The owner moving on (a tap or a key elsewhere) cancels it: a late open must never pull them back to Chats.
  async function whenThreadExists(sid, open, ms = 90000) {
    const end = Date.now() + ms;
    let moved = false; const move = () => { moved = true; };
    setTimeout(() => { try { addEventListener('pointerdown', move, true); addEventListener('keydown', move, true); } catch (e) {} }, 0);
    const stop = () => { try { removeEventListener('pointerdown', move, true); removeEventListener('keydown', move, true); } catch (e) {} };
    try { return await waitThread(sid, open, end, () => moved); } finally { stop(); }
  }
  async function waitThread(sid, open, end, moved) {
    while (Date.now() < end) {
      if (moved()) { log('thread:moved'); return; }
      try {
        const r = await fetch(`/wizard/hermes/api/sessions/${encodeURIComponent(sid)}/messages`, { credentials: 'same-origin', cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        if ((j?.data || []).length) { log('thread:open'); return open(sid); }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1000));
    }
    log('thread:timeout');
  }

  /* Settings › Privacy (standard first, issue 1800): after Later, one row, "Finish setting up private AI", which opens
   * the Private AI step on its own. A minimal row for now; the full Privacy page (wizard-ux issue 1801) builds on it.
   * The box's answer is read when Settings asks, at most once a minute (sooner after a miss). */
  let pfAt = 0, pfAsking = false;
  const finishDue = () => {
    if (!pfAsking && Date.now() - pfAt > (pf ? 60000 : 15000)) { pfAsking = true; pfRead().then(() => { pfAt = Date.now(); pfAsking = false; try { window.WosSettings?.refresh?.(); } catch (e) {} }); }
    return pf?.offer === 'later' && !pf?.private_agent;
  };
  try {
    window.WosSettings?.register?.({ id: 'private-ai-finish', page: 'privacy', aliases: ['privacy', 'private-ai'], available: finishDue,
      html: () => `<div class="st-group"><button type="button" class="st-row wz-row" data-private-ai-finish><span class="st-tx"><b>Finish setting up private AI</b><small>Private AI runs in sealed hardware: only you can see your messages and data.</small></span><span class="st-go">›</span></button></div>`,
      // Another device may have finished it (or said No thanks) meanwhile: ask the box again before opening.
      act(ctx, t) { if (!t?.closest?.('[data-private-ai-finish]') || !H) return false;
        pfRead().then(s => { pfAt = Date.now(); if (s?.offer === 'later' && !s?.private_agent) open('private'); else try { window.WosSettings?.refresh?.(); } catch (e) {} });
        return true; } });
  } catch (e) { console.error(e); }

  window.WosWelcome = { whenThreadExists, aiConnected, boot, back, open: (at) => open(at || 'ai'), close, get active() { return !!el; }, get log() { return window.__welcomeLog || []; } };
})();
