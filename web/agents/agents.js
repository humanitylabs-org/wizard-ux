/* Agents — Wizard OS system app (Agents MVP, Lane B). Its own app, reached from Home and from System; never part
 * of Apps or the App Store.
 *
 * Screens (state only; Back walks them through the shared WizardApp facade, never out of Wizard):
 *   list            every agent: sigil, name, harness, model provider · model, Private/Standard, status
 *   new (3 steps)   Harness → Model provider → Permissions (a preset, then adjust)  → Create
 *   detail          edit any time: model, outside tools, files, Wizard apps, agent apps (tools/connectors), other agents
 *   sheets          pickers and confirmations, above any screen
 *
 * Data: the Agent Service contract (core/agents.js header). Writes are PATCH/POST to /wizard/v1/agents…; the server
 * enforces every rule (private = confidential provider, no fallback, no outside tools). The UI explains them and
 * never offers a downgrade of a private agent. */
(() => {
  'use strict';
  const AG = window.WosAgents, APP = window.WizardApp;
  const $ = id => document.getElementById(id);
  const esc = AG.esc;
  const framed = parent !== window;
  const root = $('app');
  const ORIGIN = location.origin;
  const S = { view: { name: 'list' }, stack: [], sheet: null, draft: null, busy: false, opts: null, optsErr: '', saving: new Set() };
  const LOCK = AG.lock();
  const CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';
  const BACK = '<button type="button" class="ag-back" data-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>';
  const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  // Other agents: how much of the OTHER agents' chats this agent may see (Agent Service OTHER_AGENTS_LEVELS).
  const OTHERS = { none: 'None', titles: 'Titles', search: 'Search', read: 'Read' };
  const FILES = [['none', 'None', 'No files at all'], ['own', 'Own folder', 'Only its own folder'], ['shared-read', 'Read shared', 'Can read your shared files'], ['shared-write', 'Read & write', 'Can read and change your shared files']];

  /* ---------------- data ---------------- */
  const list = (v, f) => Array.isArray(v) ? v.map(f).filter(Boolean) : [];
  function options() {
    const o = S.opts || {};
    const model = m => typeof m === 'string' ? { id: m, label: AG.friendly(m) } : m && (m.id || m.value) ? { id: String(m.id || m.value), label: String(m.label || m.name || AG.friendly(m.id || m.value)) } : null;
    return {
      harnesses: list(o.harnesses, h => h && h.id ? { id: String(h.id), label: String(h.label || h.id), description: String(h.description || '') } : null),
      providers: list(o.providers, p => p && p.id ? { id: String(p.id), label: AG.cleanProvider(String(p.label || p.id)), confidential: p.confidential === true, description: String(p.description || ''), models: list(p.models, model) } : null),
      presets: list(o.presets, p => typeof p === 'string' ? { id: p, label: p[0].toUpperCase() + p.slice(1), description: '', permissions: null } : p && p.id ? { id: String(p.id), label: String(p.label || p.id), description: String(p.description || p.summary || ''), permissions: p.permissions && typeof p.permissions === 'object' ? p.permissions : null, requires_confidential: p.requires_confidential === true || p.privacy === 'private' || p.id === 'private' } : null),
      wizard_apps: list(o.wizard_apps, a => a && a.id ? { id: String(a.id), label: String(a.label || a.name || a.id), description: String(a.description || a.summary || a.desc || ''), icon: a.icon || '', colors: a.colors || [] } : null),
      // kind: 'tool' | 'connector' when the server says so; otherwise every agent app is just an agent app.
      agent_apps: list(o.agent_apps, a => a && a.id ? { id: String(a.id), label: String(a.label || a.name || a.id), description: String(a.description || a.summary || ''), kind: ['tool', 'connector'].includes(a.kind) ? a.kind : 'app' } : null),
      outside_tools: list(o.outside_tools, t => typeof t === 'string' ? { id: t, label: AG.friendly(t), description: '' } : t && t.id ? { id: String(t.id), label: String(t.label || t.id), description: String(t.description || '') } : null),
      other_agents: Array.isArray(o.other_agents) && o.other_agents.length ? list(o.other_agents, x => typeof x === 'string' ? { id: x, label: OTHERS[x] || AG.friendly(x) } : x && x.id ? { id: String(x.id), label: String(x.label || OTHERS[x.id] || x.id) } : null) : [{ id: 'none', label: 'None' }],
    };
  }
  const provider = id => options().providers.find(p => p.id === id) || null;
  const harness = id => options().harnesses.find(h => h.id === id) || { id, label: id === 'hermes' ? 'Hermes' : AG.friendly(id) };
  const preset = id => options().presets.find(p => p.id === id) || { id, label: id ? id[0].toUpperCase() + id.slice(1) : 'Custom', description: '' };
  async function api(path, init = {}) {
    const r = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
    let j = null; try { j = await r.json(); } catch (_) {}
    if (!r.ok) {
      const e = j && (j.error || j.message || j.detail);
      const human = v => /^[a-z0-9_]+$/.test(v) ? (v[0].toUpperCase() + v.slice(1)).replace(/_/g, ' ') : v;
      const check = j && typeof j.check === 'string' ? j.check : '';
      const msg = typeof e === 'string' ? human(e) + (check ? ` (${check})` : '') : e && (e.message || e.check) ? [e.message, e.check && `(${e.check})`].filter(Boolean).join(' ') : `Request failed (${r.status})`;
      throw Object.assign(new Error(msg), { status: r.status, body: j });
    }
    return j || {};
  }
  async function loadAll(force) {
    const [agents] = await Promise.all([
      AG.load(force),
      AG.loadOptions(force).then(o => { S.opts = o; S.optsErr = ''; }, e => { S.optsErr = String(e.message || e); }),
    ]);
    return agents;
  }

  /* ---------------- navigation (Back = one step; root stays) ---------------- */
  function go(view) { S.stack.push(S.view); S.view = view; render(); scrollTo(0, 0); }
  function back() {
    if (S.sheet) { closeSheet(); return true; }
    if (S.view.name === 'new' && S.view.step > 0) { S.view = { ...S.view, step: S.view.step - 1 }; render(); return true; }
    if (!S.stack.length) return false;
    S.view = S.stack.pop(); render(); return true;
  }
  APP.back.register({ canGoBack: () => !!S.sheet || S.stack.length > 0 || (S.view.name === 'new' && S.view.step > 0), back });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && back()) { e.preventDefault(); e.stopPropagation(); } });

  /* ---------------- bits ---------------- */
  const sigil = (a, cls = 'ag-sig') => AG.sigil(a, cls);
  const statusHtml = a => `<span class="st ${esc(a.status)}"><i></i>${esc({ running: 'Running', stopped: 'Stopped', starting: 'Starting…', error: 'Error' }[a.status] || a.status)}</span>`;
  const privBadge = a => a.privacy === 'private' ? `<span class="ag-badge priv">${LOCK}Private</span>` : `<span class="ag-badge">Standard</span>`;
  // A stopped agent that apps route through: their work is waiting on it.
  const waiting = a => { if (!['stopped', 'error'].includes(a.status)) return ''; const n = AG.bindings.filter(b => b.agent === a.id).length; return n ? `<span class="ag-badge held" data-waiting>${n} app${n === 1 ? '' : 's'} waiting</span>` : ''; };
  const providerLine = a => [AG.providerLabel(a.model.provider), AG.modelName(a, a.model.model)].filter(Boolean).join(' · ');
  function toast(text, bad) {
    const t = $('toast'); t.textContent = text; t.classList.toggle('bad', !!bad); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, bad ? 4200 : 1600);
  }
  function openChats(a, fresh) {
    if (framed) parent.postMessage({ type: 'wizard:open-agent-chats', id: a.id, ...(fresh ? { thread: '__new__' } : {}) }, ORIGIN);
    else location.href = `../?agent=${encodeURIComponent(a.id)}`;
  }

  /* ---------------- list ---------------- */
  function listHtml() {
    const agents = AG.list;
    let body;
    if (!AG.ready) body = '<div class="ag-loading">Loading agents…</div>';
    else if (!AG.available && !agents.length) body = `<div class="ag-err"><b>Agents aren’t on this Wizard yet.</b><br>The Agent Service here doesn’t offer agents. Your main agent keeps working as usual in Chats.</div>`;
    else if (AG.error && !agents.length) body = `<div class="ag-err">${esc(AG.error)} · <button type="button" class="ag-link" data-reload>Try again</button></div>`;
    else body = `<div class="ag-list">${agents.map(a => `<button type="button" class="ag-row" data-open="${esc(a.id)}" style="--ag:${AG.colour(a)}">${sigil(a)}
        <span class="tx"><b>${esc(a.label)}</b><small>${esc(harness(a.harness).label)} · ${esc(providerLine(a) || 'No model')}</small>
        <span class="ag-badges">${privBadge(a)}${a.is_default ? '<span class="ag-badge main">Main agent</span>' : ''}${statusHtml(a)}${waiting(a)}</span></span>${CHEV}</button>`).join('')}</div>`;
    return `<header class="ag-top"><h1>Agents</h1></header>
      <p class="ag-lede">Each agent has its own harness, model provider, permissions and chats.</p>
      ${body}
      ${routingHtml()}
      <p class="ag-note">Apps are apps, agents are agents: add Wizard apps and agent apps to an agent from its page.${framed ? ' · <button type="button" class="ag-link" data-system>Your system</button>' : ''}</p>
      ${AG.available ? `<button type="button" class="ag-btn ag-fab" data-new>${PLUS}New agent</button>` : ''}`;
  }

  /* ---------------- app → agent binding ("Sends its work to") ---------------- */
  // An app that makes work for an agent (recaps, reports, automations) routes it through one agent the owner picks.
  // Default: the main agent. A private agent needs no extra warning; a bound agent that is stopped holds the work
  // and says so, because it never falls back to another agent.
  const heldLine = (b, who) => b.held === 'missing' ? `The agent ${b.label} sends its work to isn’t on this Wizard. Its work can’t be delivered until you pick one.`
    : `${who} is ${b.held === 'error' ? 'not working' : 'stopped'}. Work from ${b.label} waits until it runs again; it never goes to another agent.`;
  function routeRow(b, { agentPage } = {}) {
    const t = b.target;
    return `<div class="ag-route${b.held ? ' held' : ''}" data-route-row="${esc(b.app_id)}"><span class="tx"><b>${esc(b.label)}</b>${b.purpose ? `<small>${esc(b.purpose)}</small>` : ''}</span>
      <button type="button" class="ag-routebtn" data-route="${esc(b.app_id)}" aria-label="${esc(b.label)} sends its work to ${esc(t ? t.label : 'no agent')}. Change" style="--ag:${t ? AG.colour(t) : '#ff6b86'}">
        ${agentPage ? '' : '<span class="lbl">Sends its work to</span>'}${t ? sigil(t, 'ag-sig xs') : ''}<b>${esc(t ? t.label : 'No agent')}</b>${t && t.privacy === 'private' ? LOCK : ''}<svg class="dd" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
      ${b.held ? `<p class="ag-note bad" data-held="${esc(b.app_id)}">${esc(heldLine(b, t ? t.label : ''))}</p>` : ''}</div>`;
  }
  function routingHtml() {
    if (!AG.ready || !AG.bindingsAvailable) return '';
    const rows = AG.bindings.map(b => AG.binding(b.app_id)).filter(Boolean);
    return `<div class="ag-sec">App routing<small>Where each app sends its work</small></div>
      <div class="ag-card ag-routes">${rows.map(b => routeRow(b)).join('') || '<div class="ag-empty-line">No installed app sends work to an agent yet.</div>'}</div>`;
  }
  function boundHtml(a) {
    if (!AG.bindingsAvailable && !a.bound_apps.length) return '';
    const ids = new Set([...AG.bindings.filter(b => b.agent === a.id).map(b => b.app_id), ...a.bound_apps.map(x => x.id)]);
    const rows = [...ids].map(id => AG.binding(id) || { ...a.bound_apps.find(x => x.id === id), app_id: id, agent: a.id, target: a, held: ['stopped', 'error'].includes(a.status) ? a.status : '' });
    return `<div class="ag-sec">Apps that send work here</div>
      <div class="ag-card ag-routes" data-bound-apps>${rows.map(b => routeRow(b, { agentPage: true })).join('') || `<div class="ag-empty-line">${a.is_default ? 'Apps that make work for an agent route here unless you pick another.' : 'None yet. In an app’s settings, pick this agent under “Sends its work to”.'}</div>`}</div>`;
  }
  async function setRoute(appId, agentId) {
    const b = AG.binding(appId); if (!b || agentId === b.agent) { closeSheet(); return; }
    S.saving.add('route:' + appId); render();
    try { await AG.setBinding(appId, agentId); const t = AG.get(agentId); closeSheet(); toast(`${b.label} → ${t ? t.label : agentId}`); }
    catch (e) { toast(`Not changed · ${e.message}`, true); }
    finally { S.saving.delete('route:' + appId); render(); }
  }

  /* ---------------- new agent: Harness → Model provider → Permissions ---------------- */
  const STEPS = ['Harness', 'Model provider', 'Permissions'];
  function startNew() {
    const o = options();
    S.draft = { label: '', harness: o.harnesses[0]?.id || 'hermes', provider: '', model: '', preset: '', perms: null };
    go({ name: 'new', step: 0 });
  }
  function applyPreset(d, id) {
    const o = options(), p = preset(id);
    const base = p.permissions || (id === 'private'
      ? { outside_tools: [], files: 'own', wizard_apps: [], agent_apps: [], other_agents: 'none' }
      : { outside_tools: o.outside_tools.map(t => t.id), files: 'shared-read', wizard_apps: [], agent_apps: [], other_agents: 'none' });
    d.preset = id;
    d.perms = { outside_tools: [...(base.outside_tools || [])], files: base.files || 'own', wizard_apps: [...(base.wizard_apps || [])], agent_apps: [...(base.agent_apps || [])], other_agents: base.other_agents || 'none' };
  }
  function stepOk(d, step) {
    if (step === 0) return !!d.label.trim() && !!d.harness;
    if (step === 1) return !!d.provider && !!d.model;
    if (step === 2) return !!d.preset && !privateBlocked(d);
    return false;
  }
  const privateBlocked = d => d.preset === 'private' && !provider(d.provider)?.confidential;
  function newHtml() {
    const d = S.draft, step = S.view.step, o = options();
    const steps = `<div class="ag-steps" aria-label="Step ${step + 1} of 3">${STEPS.map((s, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
    let body = '';
    if (S.optsErr && !o.providers.length) body = `<div class="ag-err">${esc(S.optsErr)}</div>`;
    else if (step === 0) {
      body = `<label class="ag-label" for="agName">Name</label><input id="agName" class="ag-input" maxlength="40" autocomplete="off" placeholder="e.g. Private" value="${esc(d.label)}">
        <div class="ag-sec">Harness</div>
        ${o.harnesses.map(h => choice('harness', h.id, d.harness === h.id, h.label, h.description || 'Runs the agent: its tools, memory and skills, in its own container.')).join('')}`;
    } else if (step === 1) {
      const p = provider(d.provider);
      body = `<p class="ag-lede">Where ${esc(d.label || 'this agent')}’s thinking runs. A confidential provider can’t read what it processes.</p>
        ${o.providers.map(x => choice('provider', x.id, d.provider === x.id, x.label, x.description || (x.confidential ? 'Confidential: encrypted, attested hardware' : 'Public model provider'), x.confidential ? `<span class="ag-badge priv" style="--ag:hsl(160 72% 62%)">${LOCK}Confidential</span>` : '')).join('')}
        ${p ? `<div class="ag-sec">Model</div><div class="ag-models" role="radiogroup" aria-label="Model">${p.models.map(m => `<button type="button" class="ag-chip" role="radio" aria-checked="${d.model === m.id}" data-pick="model" data-v="${esc(m.id)}">${esc(m.label)}</button>`).join('') || '<span class="ag-empty-line">This provider has no models yet.</span>'}</div>
          <p class="ag-note">${p.confidential ? 'No fallback: if this model is down, the agent waits. It never switches to a public provider.' : 'Your Wizard may fall back to another model if this one is down.'}</p>` : ''}`;
    } else {
      if (!d.preset) applyPreset(d, provider(d.provider)?.confidential ? 'private' : 'standard');
      const presets = o.presets.length ? o.presets : [{ id: 'private', label: 'Private', description: '' }, { id: 'standard', label: 'Standard', description: '' }];
      body = `<p class="ag-lede">Start from a preset, then adjust. You can change these any time.</p>
        ${presets.map(p => choice('preset', p.id, d.preset === p.id, p.label, p.description || (p.id === 'private' ? 'Nothing leaves your Wizard: no outside tools, its own folder only, no apps.' : 'Hermes defaults. Add the apps you want.'), p.id === 'private' ? `<span class="ag-badge priv" style="--ag:hsl(160 72% 62%)">${LOCK}</span>` : '')).join('')}
        ${privateBlocked(d) ? `<p class="ag-note bad">Private needs a confidential model provider. Go back and pick ${esc(o.providers.filter(p => p.confidential).map(p => p.label).join(' or ') || 'a confidential provider')}.</p>` : ''}
        ${permsHtml(d.perms, { privacy: d.preset === 'private' ? 'private' : 'standard', editable: true, draft: true })}`;
    }
    const ok = stepOk(d, step);
    const next = step < 2 ? `<button type="button" class="ag-btn" data-next ${ok ? '' : 'disabled'}>Next</button>` : `<button type="button" class="ag-btn" data-create ${ok && !S.busy ? '' : 'disabled'}>${S.busy ? 'Creating…' : 'Create agent'}</button>`;
    return `<header class="ag-top">${BACK}<h1 class="sm">New agent</h1></header>${steps}${body}
      <div class="ag-flow-foot"><div class="in${step === 0 ? ' one' : ''}">${step > 0 ? '<button type="button" class="ag-btn ghost" data-back>Back</button>' : ''}${next}</div></div>`;
  }
  function choice(kind, v, on, label, sub, extra = '') {
    return `<button type="button" class="ag-choice" role="radio" aria-checked="${on}" data-pick="${kind}" data-v="${esc(v)}"><span class="tx"><b>${esc(label)}${extra}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="rd"></span></button>`;
  }
  async function create() {
    const d = S.draft; if (!stepOk(d, 2) || S.busy) return;
    S.busy = true; render();
    const body = { label: d.label.trim(), harness: d.harness, model: { provider: d.provider, model: d.model }, permissions: { preset: d.preset, ...d.perms },
      appearance: d.preset === 'private' ? { glyph: 'lock', hue: 160 } : { glyph: '', hue: [270, 200, 30, 330, 100][AG.list.length % 5] } };
    try {
      const j = await api('/wizard/v1/agents', { method: 'POST', headers: { 'Idempotency-Key': d.key || (d.key = crypto.randomUUID()) }, body: JSON.stringify(body) });
      await AG.load(true);
      const id = j.agent?.id || j.id;
      S.busy = false; S.draft = null;
      toast(`${body.label} created`);
      S.stack = []; S.view = { name: 'list' };
      if (id && AG.get(id)) go({ name: 'detail', id }); else render();
    } catch (e) { S.busy = false; render(); toast(`Couldn’t create the agent · ${e.message}`, true); }
  }

  /* ---------------- permissions (shared by the flow and the detail page) ---------------- */
  function permsHtml(p, { privacy, editable, draft, appsEditable = editable }) {
    const o = options(); p = p || {};
    const tools = Array.isArray(p.outside_tools) ? p.outside_tools : [];
    const dis = editable ? '' : 'disabled';
    const appRow = (a, kind) => {
      const meta = (kind === 'wizard' ? o.wizard_apps : o.agent_apps).find(x => x.id === a) || { id: a, label: AG.friendly(a), description: '', kind: 'app' };
      const ic = window.WizSigil ? window.WizSigil.box('span', 'ic', { id: meta.id, name: meta.label, icon: meta.icon, colors: meta.colors }) : '';
      return `<div class="ag-item" data-app-item="${esc(a)}">${ic}<span class="tx"><b>${esc(meta.label)}</b><small>${esc(kind === 'wizard' ? 'Wizard app' : meta.kind === 'tool' ? 'Tool' : meta.kind === 'connector' ? 'Connector' : 'Agent app')}${meta.description ? ' · ' + esc(meta.description) : ''}</small></span>${appsEditable ? `<button type="button" class="ag-x" data-remove="${kind}" data-v="${esc(a)}" aria-label="Remove ${esc(meta.label)}">✕</button>` : ''}</div>`;
    };
    const wa = Array.isArray(p.wizard_apps) ? p.wizard_apps : [], aa = Array.isArray(p.agent_apps) ? p.agent_apps : [];
    return `<div class="ag-sec">Outside tools<small>${tools.length ? `${tools.length} on` : 'All off'}</small></div>
      <div class="ag-card">${o.outside_tools.map(t => `<div class="ag-tog"><span class="tx"><b>${esc(t.label)}</b>${t.description ? `<small>${esc(t.description)}</small>` : ''}</span><button type="button" class="sw" role="switch" aria-checked="${tools.includes(t.id)}" aria-label="${esc(t.label)}" data-tool="${esc(t.id)}" ${dis}></button></div>`).join('') || '<div class="ag-empty-line">No outside tools on this Wizard.</div>'}
      <p class="ag-note${privacy === 'private' ? ' warn' : ''}">${privacy === 'private' ? 'Outside tools send content to public services. A private agent keeps them off.' : 'Outside tools send what the agent is working on to public services.'}</p></div>
      <div class="ag-sec">Files</div>
      <div class="ag-seg" role="radiogroup" aria-label="Files" style="--n:${FILES.length}">${FILES.map(([v, l]) => `<button type="button" role="radio" aria-checked="${p.files === v}" data-files="${v}" ${dis}>${l}</button>`).join('')}</div>
      <p class="ag-note">${esc((FILES.find(f => f[0] === p.files) || [])[2] || '')}</p>
      <div class="ag-sec">Wizard apps<small>${wa.length}</small></div>
      <div class="ag-card" data-wizard-apps>${wa.map(a => appRow(a, 'wizard')).join('') || '<div class="ag-empty-line">No Wizard apps.</div>'}
        ${appsEditable ? `<button type="button" class="ag-add" data-add="wizard">${PLUS.replace('<svg', '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"')}Add Wizard app</button>` : ''}</div>
      <div class="ag-sec">Agent apps<small>tools &amp; connectors · ${aa.length}</small></div>
      <div class="ag-card" data-agent-apps>${aa.map(a => appRow(a, 'agent')).join('') || '<div class="ag-empty-line">No agent apps, tools or connectors.</div>'}
        ${appsEditable ? `<button type="button" class="ag-add" data-add="agent">${PLUS.replace('<svg', '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"')}Add agent app</button><button type="button" class="ag-add" data-add="tool">${PLUS.replace('<svg', '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"')}Add tool or connector</button>` : ''}</div>
      <div class="ag-sec">Other agents</div>
      <div class="ag-seg" role="radiogroup" aria-label="Other agents" style="--n:${o.other_agents.length}">${o.other_agents.map(x => `<button type="button" role="radio" aria-checked="${(p.other_agents || 'none') === x.id}" data-others="${esc(x.id)}" ${dis}>${esc(x.label)}</button>`).join('')}</div>
      ${draft ? '' : `<p class="ag-note">${privacy === 'private' ? 'Sealed: no other agent can read this agent’s chats, memory or files, whatever its own setting says.' : 'Private agents are never readable, whatever this says.'}</p>`}`;
  }

  /* ---------------- detail ---------------- */
  function detailHtml() {
    const a = AG.get(S.view.id);
    if (!a) return `<header class="ag-top">${BACK}<h1 class="sm">Agent</h1></header><div class="ag-err">This agent isn’t on this Wizard any more.</div>`;
    const p = provider(a.model.provider), editable = !a.is_default;
    const running = a.status === 'running' || a.status === 'starting';
    const allowed = a.model.allowed_models.length ? a.model.allowed_models : [a.model.model].filter(Boolean);
    return `<header class="ag-top">${BACK}<h1 class="sm">Agent</h1></header>
      <section class="ag-hero" style="--ag:${AG.colour(a)}">${sigil(a, 'ag-sig lg')}<span class="tx"><b>${esc(a.label)}</b>
        <span class="ag-badges">${privBadge(a)}${a.is_default ? '<span class="ag-badge main">Main agent</span>' : ''}${statusHtml(a)}</span></span>
        ${editable ? `<button type="button" class="ag-back" data-rename aria-label="Rename ${esc(a.label)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button>` : ''}</section>
      ${a.status === 'error' && a.status_detail ? `<p class="ag-note bad">${esc(a.status_detail)}</p>` : ''}
      <div class="ag-hero-acts"><button type="button" class="ag-btn" data-chats>Open chats</button>${editable ? `<button type="button" class="ag-btn ghost" data-${running ? 'stop' : 'start'} ${S.saving.has('run') ? 'disabled' : ''}>${running ? 'Stop' : 'Start'}</button>` : ''}</div>
      ${boundHtml(a)}
      <div class="ag-sec">Harness</div>
      <div class="ag-card"><div class="ag-kv"><span>Harness</span><b>${esc(harness(a.harness).label)}</b></div></div>
      <div class="ag-sec">Model provider</div>
      <div class="ag-card"><div class="ag-kv"><span>Provider</span><b data-provider-line>${esc(AG.providerLabel(a.model.provider) || '—')}${p?.confidential ? ' · Confidential' : ''}</b></div>
        <div class="ag-kv"><span>Model</span><b>${esc(AG.modelName(a, a.model.model) || '—')}</b></div>
        <div class="ag-kv"><span>Allowed in chats</span><b>${esc(allowed.map(m => AG.modelName(a, m)).join(', ') || '—')}</b></div>
        <div class="ag-kv"><span>Fallback</span><b>${a.model.fallback ? 'On' : 'Off'}</b></div>
        ${editable && (p?.models?.length || 0) > 1 ? '<button type="button" class="ag-add" data-model>Change model</button>' : ''}
        ${a.privacy === 'private' ? '<p class="ag-note">A private agent keeps a confidential provider with no fallback. Its chats can only use the models above.</p>' : ''}</div>
      <div class="ag-sec">Permissions<small>Preset: ${esc(preset(a.permissions.preset).label)}</small></div>
      ${editable ? '' : '<p class="ag-note">The main agent runs your Wizard’s own setup. Its other permissions are managed there; pick its apps here.</p>'}
      ${permsHtml(a.permissions, { privacy: a.privacy, editable, appsEditable: true })}`;
  }
  async function patch(a, body, label = 'Saved') {
    const key = JSON.stringify(Object.keys(body));
    S.saving.add(key);
    try { await api(`/wizard/v1/agents/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify(body) }); await AG.load(true); toast(label); }
    catch (e) { await AG.load(true).catch(() => {}); toast(`Not saved · ${e.message}`, true); }
    finally { S.saving.delete(key); render(); }
  }
  // An edit to the permissions: the draft in the flow, else the agent (PATCH; the server has the last word).
  function editPerms(fn, msg) {
    if (S.view.name === 'new') { fn(S.draft.perms); render(); return; }
    const a = AG.get(S.view.id); if (!a) return;
    const p = JSON.parse(JSON.stringify(a.permissions || {}));
    fn(p);
    // The main agent: only which apps it can use is set here (#58); the rest is its Wizard's own setup.
    const body = a.is_default ? { wizard_apps: p.wizard_apps || [], agent_apps: p.agent_apps || [] } : p;
    if (a.is_default && ['outside_tools', 'files', 'other_agents'].some(k => JSON.stringify(p[k]) !== JSON.stringify(a.permissions[k]))) return;
    Object.assign(a.permissions, p); render(); // shown now; reverted by the reload if the server refuses
    patch(a, { permissions: body }, msg);
  }
  async function runAction(a, act) {
    S.saving.add('run'); render();
    try { await api(`/wizard/v1/agents/${encodeURIComponent(a.id)}/${act}`, { method: 'POST' }); await AG.load(true); toast(act === 'start' ? `${a.label} is starting` : `${a.label} stopped`); }
    catch (e) { toast(`Couldn’t ${act} ${a.label} · ${e.message}`, true); }
    finally { S.saving.delete('run'); render(); }
  }

  /* ---------------- sheets ---------------- */
  let sheetHold = null;
  function openSheet(sh) { S.sheet = sh; sheetHold?.release(); sheetHold = APP.back.push(() => { closeSheet(); return true; }); render(); }
  function closeSheet() { S.sheet = null; sheetHold?.release(); sheetHold = null; render(); }
  function sheetHtml() {
    const sh = S.sheet; if (!sh) return '';
    const o = options();
    let inner = '';
    const cur = S.view.name === 'new' ? S.draft.perms : AG.get(S.view.id)?.permissions || {};
    if (sh.type === 'add') {
      const have = new Set(sh.kind === 'wizard' ? cur.wizard_apps || [] : cur.agent_apps || []);
      const typed = o.agent_apps.some(x => x.kind !== 'app'); // the server names tools/connectors; else one pool
      const pool = sh.kind === 'wizard' ? o.wizard_apps : typed ? o.agent_apps.filter(x => sh.kind === 'tool' ? x.kind !== 'app' : x.kind === 'app') : o.agent_apps;
      const left = pool.filter(x => !have.has(x.id));
      const title = sh.kind === 'wizard' ? 'Add Wizard app' : sh.kind === 'tool' ? 'Add tool or connector' : 'Add agent app';
      const note = sh.kind === 'wizard' ? 'Wizard apps have their own screen. The agent can use them for you.' : sh.kind === 'tool' ? 'Tools and connectors give the agent one capability or one account.' : 'Agent apps run on your Wizard with no screen of their own.';
      inner = `<h2>${title}</h2><p class="ag-note">${note}${S.view.name !== 'new' && AG.get(S.view.id)?.privacy === 'private' ? ' A private agent sends what it reads to these apps; they run on your Wizard.' : ''}</p>
        <div style="margin-top:12px">${left.map(x => `<button type="button" class="ag-choice" data-addpick="${esc(x.id)}"><span class="tx"><b>${esc(x.label)}</b>${x.description ? `<small>${esc(x.description)}</small>` : ''}</span><span class="rd"></span></button>`).join('') || `<div class="ag-empty-line">${pool.length ? 'All of them are added already.' : 'Nothing to add yet. Get more from the App Store.'}</div>`}</div>
        <div class="acts" style="grid-template-columns:1fr"><button type="button" class="ag-btn ghost" data-sheetclose>Close</button></div>`;
    } else if (sh.type === 'tool-confirm') {
      inner = `<h2>Turn on ${esc(sh.label)}?</h2><p class="ag-note warn">${esc(sh.agent)} is private. ${esc(sh.label)} sends what it works on to a public service, outside your Wizard.</p>
        <div class="acts"><button type="button" class="ag-btn ghost" data-sheetclose>Keep off</button><button type="button" class="ag-btn danger" data-toolyes="${esc(sh.tool)}">Turn on</button></div>`;
    } else if (sh.type === 'rename') {
      inner = `<h2>Rename</h2><input id="agRename" class="ag-input" maxlength="40" value="${esc(sh.value)}" style="margin-top:10px">
        <div class="acts"><button type="button" class="ag-btn ghost" data-sheetclose>Cancel</button><button type="button" class="ag-btn" data-renameok>Save</button></div>`;
    } else if (sh.type === 'route') {
      const b = AG.binding(sh.app);
      const busy = S.saving.has('route:' + sh.app);
      inner = `<h2>${esc(b ? b.label : sh.app)}</h2><p class="ag-note">${esc(b?.purpose || 'Work from this app goes to one agent.')}</p>
        <div class="ag-label" style="margin-top:14px">Sends its work to</div>
        <div role="radiogroup" aria-label="Sends its work to">${AG.list.map(x => `<button type="button" class="ag-choice" role="radio" aria-checked="${b?.agent === x.id}" data-routepick="${esc(x.id)}" style="--ag:${AG.colour(x)}" ${busy ? 'disabled' : ''}>${sigil(x, 'ag-sig sm')}<span class="tx"><b>${esc(x.label)}${x.privacy === 'private' ? `<span class="ag-badge priv">${LOCK}Private</span>` : ''}${x.is_default ? '<span class="ag-badge main">Main agent</span>' : ''}</b><small>${statusHtml(x)}</small></span><span class="rd"></span></button>`).join('')}</div>
        ${b?.held ? `<p class="ag-note bad">${esc(heldLine(b, b.target ? b.target.label : ''))}</p>` : ''}
        <p class="ag-note">${b?.is_default ? 'Default: your main agent. ' : ''}The app never picks an agent itself.</p>
        <div class="acts" style="grid-template-columns:1fr"><button type="button" class="ag-btn ghost" data-sheetclose>Close</button></div>`;
    } else if (sh.type === 'model') {
      const a = AG.get(S.view.id), p = provider(a?.model.provider);
      inner = `<h2>Model</h2><p class="ag-note">${esc(p?.label || '')} only${a?.privacy === 'private' ? ': a private agent never changes provider here' : ''}.</p>
        <div style="margin-top:12px">${(p?.models || []).map(m => `<button type="button" class="ag-choice" role="radio" aria-checked="${a.model.model === m.id}" data-modelpick="${esc(m.id)}"><span class="tx"><b>${esc(m.label)}</b></span><span class="rd"></span></button>`).join('')}</div>
        <div class="acts" style="grid-template-columns:1fr"><button type="button" class="ag-btn ghost" data-sheetclose>Close</button></div>`;
    }
    return `<div class="ag-sheet" data-sheetbg><div class="card" role="dialog" aria-modal="true">${inner}</div></div>`;
  }

  /* ---------------- render + events ---------------- */
  function render() {
    const focusName = document.activeElement?.id === 'agName';
    const v = S.view;
    root.innerHTML = (v.name === 'new' ? newHtml() : v.name === 'detail' ? detailHtml() : listHtml()) + sheetHtml();
    document.documentElement.dataset.view = v.name + (v.name === 'new' ? '-' + v.step : '');
    if (focusName) { const i = $('agName'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
    if (S.sheet?.type === 'rename') $('agRename')?.focus();
  }
  root.addEventListener('input', e => {
    if (e.target.id === 'agName') { S.draft.label = e.target.value; const n = root.querySelector('[data-next]'); if (n) n.disabled = !stepOk(S.draft, 0); }
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'agName' && stepOk(S.draft, 0)) { e.preventDefault(); S.view = { ...S.view, step: 1 }; render(); }
    if (e.key === 'Enter' && e.target.id === 'agRename') root.querySelector('[data-renameok]')?.click();
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('button, [data-sheetbg]'); if (!t) return;
    const d = t.dataset;
    if ('sheetbg' in d) { if (e.target === t) closeSheet(); return; }
    if ('back' in d) { back(); return; }
    if ('sheetclose' in d) { closeSheet(); return; }
    if ('reload' in d) { loadAll(true).then(render); return; }
    if ('system' in d) { parent.postMessage({ type: 'wizard:open-app', id: 'system' }, ORIGIN); return; }
    if ('new' in d) { startNew(); return; }
    if (d.open) { go({ name: 'detail', id: d.open }); return; }
    if (d.route) { openSheet({ type: 'route', app: d.route }); return; }
    if (d.routepick) { setRoute(S.sheet?.app, d.routepick); return; }
    // flow
    if (d.pick && S.view.name === 'new') {
      const dr = S.draft;
      if (d.pick === 'harness') dr.harness = d.v;
      if (d.pick === 'provider' && dr.provider !== d.v) { dr.provider = d.v; const p = provider(d.v); dr.model = p?.models.length === 1 ? p.models[0].id : ''; dr.preset = ''; }
      if (d.pick === 'model') dr.model = d.v;
      if (d.pick === 'preset') applyPreset(dr, d.v);
      render(); return;
    }
    if ('next' in d) { if (stepOk(S.draft, S.view.step)) { S.view = { ...S.view, step: S.view.step + 1 }; render(); scrollTo(0, 0); } return; }
    if ('create' in d) { create(); return; }
    // permissions (flow or detail)
    if (d.tool) {
      const id = d.tool, on = t.getAttribute('aria-checked') !== 'true';
      const a = S.view.name === 'detail' ? AG.get(S.view.id) : null;
      const label = options().outside_tools.find(x => x.id === id)?.label || id;
      if (on && a?.privacy === 'private') { openSheet({ type: 'tool-confirm', tool: id, label, agent: a.label }); return; }
      editPerms(p => { const s = new Set(p.outside_tools || []); on ? s.add(id) : s.delete(id); p.outside_tools = [...s]; }, on ? `${label} on` : `${label} off`);
      return;
    }
    if (d.toolyes) { const id = d.toolyes; closeSheet(); editPerms(p => { const s = new Set(p.outside_tools || []); s.add(id); p.outside_tools = [...s]; }, 'Turned on'); return; }
    if (d.files) { editPerms(p => { p.files = d.files; }, 'Files updated'); return; }
    if (d.others) { editPerms(p => { p.other_agents = d.others; }, 'Saved'); return; }
    if (d.add) { openSheet({ type: 'add', kind: d.add }); return; }
    if (d.addpick) {
      const kind = S.sheet?.kind; const field = kind === 'wizard' ? 'wizard_apps' : 'agent_apps';
      const o = options(), label = (kind === 'wizard' ? o.wizard_apps : o.agent_apps).find(x => x.id === d.addpick)?.label || d.addpick;
      closeSheet(); editPerms(p => { p[field] = [...new Set([...(p[field] || []), d.addpick])]; }, `${label} added`); return;
    }
    if (d.remove) { const field = d.remove === 'wizard' ? 'wizard_apps' : 'agent_apps'; editPerms(p => { p[field] = (p[field] || []).filter(x => x !== d.v); }, 'Removed'); return; }
    // detail
    const a = S.view.name === 'detail' ? AG.get(S.view.id) : null;
    if (!a) return;
    if ('chats' in d) { openChats(a); return; }
    if ('start' in d) { runAction(a, 'start'); return; }
    if ('stop' in d) { runAction(a, 'stop'); return; }
    if ('rename' in d) { openSheet({ type: 'rename', value: a.label }); return; }
    if ('renameok' in d) { const v = ($('agRename')?.value || '').trim(); if (!v) return; closeSheet(); a.label = v; render(); patch(a, { label: v }, 'Renamed'); return; }
    if ('model' in d) { openSheet({ type: 'model' }); return; }
    if (d.modelpick) { const m = d.modelpick; closeSheet(); if (m !== a.model.model) patch(a, { model: { provider: a.model.provider, model: m } }, `Model: ${AG.modelName(a, m)}`); return; }
  });
  AG.onChange(() => { if (!S.sheet || S.sheet.type !== 'rename') render(); });
  // A starting agent: look again until it settles.
  setInterval(() => { if (!document.hidden && AG.list.some(a => a.status === 'starting')) AG.load(true); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) AG.load(true).then(() => AG.loadBindings(true)); });
  // The shell's app settings sheet → Agents: show that agent's page (sent until the app is up).
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== ORIGIN || e.source !== parent || !d) return;
    if (d.type === 'wizard:bindings-changed') { AG.load(true).then(() => AG.loadBindings(true)); return; }
    if (d.type !== 'wizard:agents-show' || typeof d.id !== 'string') return;
    if (S.view.name === 'detail' && S.view.id === d.id) return;
    if (AG.get(d.id)) { S.sheet = null; go({ name: 'detail', id: d.id }); }
  });
  // Deep link inside the app: ?agent=<id> opens its page, ?new=1 the flow.
  const q = new URLSearchParams(location.search);
  APP.ready({ name: 'Agents' });
  render();
  loadAll(true).then(() => AG.loadBindings(true)).then(() => {
    const id = q.get('agent'); if (id && AG.get(id)) go({ name: 'detail', id }); else if (q.get('new') === '1' && AG.available) startNew(); else render();
  });
  window.__agents = { state: () => ({ view: S.view, stack: S.stack.length, sheet: S.sheet?.type || '', agents: AG.list.map(a => a.id), draft: S.draft, bindings: AG.bindings.map(b => ({ app: b.app_id, agent: b.agent })) }), back };
})();
