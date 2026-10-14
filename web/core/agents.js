/* Wizard OS — agents (Agents MVP, Lane B). Shared by both shells and the Agents app.
 *
 * One Wizard can run several agents. Each agent has its own harness (Hermes first), model provider, permissions
 * and its own chats. The Agent Service owns the truth:
 *   GET  /wizard/v1/agents                 → { agents: [{ id, label, harness, privacy, appearance:{glyph,hue},
 *                                              model:{provider,model,allowed_models,fallback}, permissions,
 *                                              status, status_detail, is_default }] }
 *   GET  /wizard/v1/agent-options          → { harnesses, providers:[{id,label,confidential,models}], presets,
 *                                              wizard_apps, agent_apps, outside_tools }
 *   POST /wizard/v1/agents, GET/PATCH /wizard/v1/agents/<id>, POST /wizard/v1/agents/<id>/start|stop
 * Threads and runs take agent=<id>; a thread carries agent:{id,label,privacy,appearance} from server metadata.
 *
 * The default agent (is_default, normally id "hermes") is the Wizard's main agent: its chats are the ordinary
 * Chats window, unchanged. Every other agent's chats live in a Chats window pinned to that agent (w.agent) and
 * never mix with the main list.
 *
 *   WosAgents.load(force)        → Promise<agents[]> (404/absent API → [] and available=false)
 *   WosAgents.list / ready / available / error
 *   WosAgents.get(id), defaultId(), isOther(id), others()
 *   WosAgents.colour(a), glyph(a), sigil(a, cls), lock(), badge(a, opts)
 *   WosAgents.modelOptions(a)    → picker options limited to the agent's allowed_models
 *   WosAgents.modelName(a, model), providerLabel(id)
 *   WosAgents.loadOptions(force) → Promise<agent-options>
 *   WosAgents.onChange(fn)
 */
(() => {
  'use strict';
  if (window.WosAgents) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
  const listeners = new Set();
  const A = {
    list: [], ready: false, available: false, error: '', at: 0, loading: null, options: null, optionsAt: 0,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { for (const fn of listeners) { try { fn(A); } catch (e) { console.error(e); } } },
    load(force) {
      if (A.loading) return A.loading;
      if (!force && A.ready && Date.now() - A.at < 30e3) return Promise.resolve(A.list);
      A.loading = fetch('/wizard/v1/agents', { cache: 'no-store', credentials: 'same-origin' })
        .then(async r => {
          if (r.status === 404) { A.available = false; return []; }
          if (!r.ok) throw Object.assign(new Error(`Agents unavailable (${r.status})`), { status: r.status });
          A.available = true;
          const j = await r.json();
          return (Array.isArray(j?.agents) ? j.agents : []).map(clean).filter(Boolean);
        })
        .then(list => { const before = JSON.stringify(A.list); A.list = list; A.ready = true; A.error = ''; A.at = Date.now(); if (JSON.stringify(list) !== before) A.emit(); return list; })
        .catch(e => { A.error = String(e.message || e); A.ready = true; A.emit(); return A.list; })
        .finally(() => { A.loading = null; });
      return A.loading;
    },
    loadOptions(force) {
      if (!force && A.options && Date.now() - A.optionsAt < 60e3) return Promise.resolve(A.options);
      return fetch('/wizard/v1/agent-options', { cache: 'no-store', credentials: 'same-origin' })
        .then(r => { if (!r.ok) throw Object.assign(new Error(`Agent options unavailable (${r.status})`), { status: r.status }); return r.json(); })
        .then(j => { A.options = j && typeof j === 'object' ? j : {}; A.optionsAt = Date.now(); return A.options; });
    },
    get(id) { return A.list.find(a => a.id === id) || null; },
    defaultId() { return (A.list.find(a => a.is_default) || {}).id || 'hermes'; },
    // A non-default agent: its threads, sends and models never go through the main agent's route.
    isOther(id) { return !!id && id !== A.defaultId(); },
    others() { return A.list.filter(a => !a.is_default); },
    colour(a) { const h = Number(a?.appearance?.hue); return Number.isFinite(h) ? `hsl(${Math.round(((h % 360) + 360) % 360)} 72% 62%)` : '#b99bff'; },
    glyph(a) {
      const g = String(a?.appearance?.glyph || '');
      if (g === 'lock' || g === 'secret') return 'secret';
      if (window.WizSigil?.has?.(g)) return g;
      return a?.is_default ? 'wizard' : '';
    },
    sigil(a, cls = 'ag-sig') {
      const g = A.glyph(a), c = A.colour(a);
      if (window.WizSigil) return window.WizSigil.chip('span', cls, g || initial(a), c);
      return `<span class="${cls} sgt" style="--c:${c}">${esc(initial(a))}</span>`;
    },
    lock() { return '<svg class="ag-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>'; },
    isPrivate(a) { return a?.privacy === 'private'; },
    // The persistent "which agent is this" strip for Chats (list and thread, phone and desktop).
    badge(a, { where = 'list', model = '' } = {}) {
      if (!a) return '';
      const priv = A.isPrivate(a);
      const sub = [priv ? 'Private agent' : a.is_default ? 'Main agent' : 'Agent', model || A.modelName(a, a.model?.model)].filter(Boolean).join(' · ');
      return `<div class="ch-agent${priv ? ' private' : ''} ${where}" style="--ag:${A.colour(a)}" data-chagent="${esc(a.id)}" role="note" aria-label="${esc(`You are talking to ${a.label}${priv ? ', a private agent' : ''}`)}">`
        + `${A.sigil(a, 'ag-sig')}<span class="ag-t"><b>${esc(a.label)}</b><small>${esc(sub)}</small></span>${priv ? `<span class="ag-priv">${A.lock()}<span>Private</span></span>` : ''}</div>`;
    },
    providerLabel(id) {
      const p = (A.options?.providers || []).find(x => x.id === id);
      if (id === 'host') return 'Your Wizard’s setup'; // the main agent runs the host Hermes configuration
      return p?.label || (id === 'tinfoil' ? 'Tinfoil' : String(id || ''));
    },
    modelName(a, model) {
      if (!model) return '';
      const p = (A.options?.providers || []).find(x => x.id === a?.model?.provider);
      const m = (p?.models || []).map(v => typeof v === 'string' ? { id: v } : v || {}).find(v => (v.id || v.value || v.model) === model);
      if (m?.label || m?.name) return m.label || m.name;
      if (window.WosModels?.find?.(model)) return window.WosModels.name(model);
      return friendly(model);
    },
    // The model picker in an agent's chats: only that agent's allowed models, on its own provider.
    modelOptions(a) {
      if (!a?.model) return [];
      const allowed = Array.isArray(a.model.allowed_models) && a.model.allowed_models.length ? a.model.allowed_models : [a.model.model].filter(Boolean);
      return allowed.map(m => ({ value: m, provider: a.model.provider, agent: a.id, name: A.modelName(a, m), description: A.providerLabel(a.model.provider) + (a.model.fallback === false ? ' · no fallback' : ''), isGlobalDefault: m === a.model.model }));
    },
    allows(a, model) { return A.modelOptions(a).some(o => o.value === model); },
    route(a, model) {
      if (!a?.model) return null;
      const m = model && A.allows(a, model) ? model : a.model.model;
      return m ? { model: m, provider: a.model.provider, agent: a.id } : null;
    },
    friendly, esc,
  };
  function initial(a) { return String(a?.label || a?.id || '?').trim().charAt(0).toUpperCase() || '?'; }
  function friendly(model) {
    const m = String(model || '');
    const g = /^glm-(\d+)-(\d+)$/i.exec(m); if (g) return `GLM ${g[1]}.${g[2]}`;
    return m.replace(/[-_]+/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  function clean(a) {
    if (!a || typeof a !== 'object' || !ID.test(String(a.id || ''))) return null;
    const model = a.model && typeof a.model === 'object' ? a.model : {};
    return {
      id: a.id, label: String(a.label || a.id).slice(0, 60), harness: String(a.harness || 'hermes'),
      privacy: a.privacy === 'private' ? 'private' : 'standard',
      appearance: { glyph: String(a.appearance?.glyph || ''), hue: Number.isFinite(Number(a.appearance?.hue)) ? Number(a.appearance.hue) : null },
      model: { provider: String(model.provider || ''), model: String(model.model || ''), allowed_models: Array.isArray(model.allowed_models) ? model.allowed_models.map(String) : [], fallback: model.fallback !== false },
      permissions: a.permissions && typeof a.permissions === 'object' ? a.permissions : {},
      status: ['running', 'stopped', 'starting', 'error'].includes(a.status) ? a.status : 'stopped',
      status_detail: String(a.status_detail || ''), is_default: a.is_default === true,
    };
  }
  window.WosAgents = A;
  // The shells refresh the list in the background; the Agents app loads it on demand.
  if (document.documentElement.dataset.leaving) return;
  if (!/\/agents\//.test(location.pathname)) {
    A.load();
    A.loadOptions().catch(() => {});
    setInterval(() => { if (!document.hidden) A.load(true); }, 30e3);
  }
})();
