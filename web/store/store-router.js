/* Shared Connection Router rows: Store install, Models and connections, and app setup.
 * The Router decides readiness. A model swap still requires an explicit, named approval. */
const API = new URL('../store-data/router/v1/', import.meta.url).href;
const strip = s => String(s || '').replace(/^Wizard\s+/i, '');
export const nice = s => { const t = String(s || '').replace(/[-_]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/\bai\b/gi, 'AI') : ''; };

export async function routerNeeds(app) {
  try {
    const r = await fetch(API + 'needs/' + encodeURIComponent(app), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.models)) return { data: j };
    return { error: r.status === 501 ? 'outdated' : r.status === 403 ? 'unknown' : 'unavailable', status: r.status };
  } catch (_) { return { error: 'unavailable' }; }
}

export async function routerApprove({ app, feature, provider, model }) {
  const r = await fetch(API + 'approve', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ app, feature, provider, model }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || (r.status === 501 ? 'Connection Router needs updating.' : `Approval failed (${r.status}).`));
  return j;
}

export function providerName(data, id, storeApps = []) {
  return strip(storeApps.find(p => p.id === id)?.name || (data.providers || []).find(p => p.id === id)?.name || nice(String(id || '').replace(/^wizard-/, '')));
}
function targetFor(id, data, storeApps, isInstalled) {
  if (!id) return null;
  const p = (data.providers || []).find(p => p.id === id), a = storeApps.find(a => a.id === id);
  return { id, name: providerName(data, id, storeApps), installed: !!p || !!(a && isInstalled?.(a)), status: p?.status };
}
// Prefer declared routes/recommendations, then tested-model providers and the existing Store family lookup.
export function connectTarget(feature, data, storeApps = [], isInstalled) {
  const providers = data.providers || [];
  const declared = feature.route?.provider || feature.recommend || feature.provider;
  if (declared) return targetFor(declared, data, storeApps, isInstalled);
  const lists = providers.find(p => (p.models || []).some(m => m.id === feature.tested_on));
  if (lists) return targetFor(lists.id, data, storeApps, isInstalled);
  const fam = String(feature.tested_on || '').toLowerCase().split(/[^a-z0-9]+/)[0];
  if (fam.length >= 3) {
    const has = x => `${x.id} ${x.name || ''}`.toLowerCase().includes(fam);
    const match = providers.find(has) || storeApps.find(a => (a.provides || []).includes('ai-connection') && has(a));
    if (match) return targetFor(match.id, data, storeApps, isInstalled);
  }
  // A signed-out provider may have no model inventory yet. Reuse an app's service
  // recommendation only when the registry declares the required model/privacy capability.
  const shared = (data.services || []).map(s => s.recommend).filter(Boolean).find(id => {
    const a = storeApps.find(a => a.id === id);
    return a?.provides?.includes('ai-connection') && (!feature.private_data || a.private === true);
  });
  return targetFor(shared, data, storeApps, isInstalled);
}
export function setupTarget(data, ctx = {}) {
  const needs = [...(data.services || []), ...(data.models || [])].filter(n => n.status !== 'ready' && n.required !== false);
  for (const need of needs) {
    const target = connectTarget(need, data, ctx.storeApps, ctx.isInstalled);
    if (target) return { need, target };
  }
  return { need: needs[0], target: null };
}
const another = (n, esc) => `<button type="button" class="mc-btn alt" data-mc-another="${esc(n.slot || n.feature)}">Use another for this</button>`;
const connect = (n, target, esc) => `<button type="button" class="mc-btn alt" data-mc-connect="${esc(target?.id || '')}" data-mc-installed="${target?.installed ? 1 : 0}">${target ? (target.installed ? 'Connect ' : 'Set up ') + esc(target.name) : 'Choose a provider'}</button>`;
const svg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
function icon(n) {
  const key = n.slot || n.feature;
  return key.includes('transcri') ? svg('<path d="M4 9v6m4-10v14m4-11v8m4-10v12m4-8v4"/>')
    : key.includes('live') ? svg('<path d="M5 6h14M5 12h10M5 18h7"/><circle cx="19" cy="18" r="2"/>')
    : svg('<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6m-6 4h3"/>');
}
function row(n, body, acts, ctx) {
  const esc = ctx.esc, ok = n.status === 'ready', key = n.slot || n.feature;
  return `<details class="mc-row" data-mc-${n.slot ? 'slot' : 'feature'}="${esc(key)}">
    <summary class="mc-head"><span class="mc-icon">${icon(n)}</span><span class="mc-name">${esc(nice(key))}</span>${n.required === false ? '<small class="mc-optional">Optional</small>' : ''}<span class="mc-state ${ok ? 'ready' : 'off'}" aria-label="${ok ? 'Ready' : 'Not ready'}">${ok ? svg('<path d="m6 12 4 4 8-8"/>') : '<span class="mc-dot"></span>'}</span></summary>
    <div class="mc-detail">${n.purpose ? `<p class="mc-line">${esc(n.purpose)}</p>` : ''}${body}${acts.length ? `<div class="mc-acts">${acts.join('')}</div>` : ''}</div></details>`;
}
function featureRow(app, f, data, ctx) {
  const esc = ctx.esc, target = connectTarget(f, data, ctx.storeApps, ctx.isInstalled), acts = [];
  const model = f.route?.model || f.tested_on;
  const provider = f.route?.provider;
  const label = (data.providers || []).flatMap(p => p.models || []).find(m => m.id === model)?.label || model;
  let body = model ? `<p class="mc-line">${f.status === 'ready' ? 'Using' : 'Model:'} ${esc(label)}${provider ? ' · ' + esc(providerName(data, provider, ctx.storeApps)) : ''}${f.swap === 'never' ? ' · tested model only' : ''}</p>` : '';
  if (f.route?.chosen === 'owner-swap') body += '<p class="mc-line">Approved replacement model.</p>';
  if (f.status === 'ready' && f.route?.chosen === 'owner-swap') {
    const tested = (data.providers || []).find(p => p.status === 'connected' && (p.models || []).some(m => m.id === f.tested_on));
    if (tested) acts.push(`<button type="button" class="mc-btn alt" data-mc-approve="${esc(f.feature)}" data-mc-provider="${esc(tested.id)}" data-mc-model="${esc(f.tested_on)}">Use tested ${esc(f.tested_on)}</button>`);
    else acts.push(connect(f, connectTarget({ ...f, route: null }, data, ctx.storeApps, ctx.isInstalled), esc));
  }
  if (f.status !== 'ready') {
    if (!f.route && f.offered && f.swap !== 'never') {
      acts.push(`<button type="button" class="mc-btn alt" data-mc-approve="${esc(f.feature)}" data-mc-provider="${esc(f.offered.provider)}" data-mc-model="${esc(f.offered.model)}">Approve swap to ${esc(f.offered.model)}</button>`);
      body += `<p class="mc-line">${esc(providerName(data, f.offered.provider, ctx.storeApps))} offers this replacement. Results may differ.</p>`;
    } else acts.push(connect(f, target, esc));
  }
  if (f.status !== 'ready' || f.swap !== 'never') acts.push(another(f, esc));
  return row(f, body, acts, ctx);
}
export function serviceRow(s, ctx, data = {}) {
  const esc = ctx.esc, ok = s.status === 'ready', target = connectTarget(s, data, ctx.storeApps, ctx.isInstalled);
  const body = ok ? `<p class="mc-line">${esc(providerName(data, s.provider, ctx.storeApps))}</p>` : s.status === 'blocked' ? '<p class="mc-line">A private provider is required.</p>' : '';
  return row(s, body, [...(!ok ? [connect(s, target, esc)] : []), another(s, esc)], ctx);
}
export function routerRows(app, data, ctx) {
  return [...(data.services || []).map(s => serviceRow(s, ctx, data)), ...(data.models || []).map(f => featureRow(app, f, data, ctx))].join('');
}
export const hasNeeds = data => !!data && ((data.models || []).length + (data.services || []).length) > 0;
export const pending = data => [...(data?.models || []), ...(data?.services || [])].filter(f => f.status !== 'ready').length;
