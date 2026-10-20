/* Connection Router owner view for the Store: the install sheet and each app's "Models and connections".
 * wizard-os DECISIONS #65 / spec/CONNECTION_ROUTER.md. The Router decides; this only shows its answer and proposes.
 * A model swap happens only when the owner taps the button that names the replacement (POST approve, install scope). */
const API = '../store-data/router/v1/';
const strip = s => String(s || '').replace(/^Wizard\s+/i, '');
export const nice = s => { const t = String(s || '').replace(/[-_]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/\bai\b/gi, 'AI') : ''; };
const TIER = { frontier: 'Frontier', standard: 'Standard', fast: 'Fast' };

export async function routerNeeds(app) {
  try {
    const r = await fetch(API + 'needs/' + encodeURIComponent(app), { credentials: 'same-origin', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.models)) return { data: j };
    return { error: r.status === 501 ? 'outdated' : r.status === 403 ? 'unknown' : 'unavailable', status: r.status };
  } catch (_) { return { error: 'unavailable' }; }
}

export async function routerApprove({ app, feature, provider, model }) {
  const r = await fetch(API + 'approve', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ app, feature, provider, model }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || (r.status === 501 ? 'This Wizard’s Connection Router needs updating.' : `Approval failed (${r.status}).`));
  return j;
}

// Which provider to connect for a feature: the installed provider that lists the tested model, else the provider app
// (installed, then in the Store) whose name carries the model family ("claude-…" → Claude, "gpt-…" → ChatGPT).
export function connectTarget(feature, data, storeApps = []) {
  const providers = data.providers || [];
  const lists = providers.find(p => (p.models || []).some(m => m.id === feature.tested_on));
  if (lists) return { id: lists.id, name: strip(lists.name), installed: true, status: lists.status };
  const fam = String(feature.tested_on || '').toLowerCase().split(/[^a-z0-9]+/)[0];
  if (!fam || fam.length < 3) return null;
  const has = x => `${x.id} ${x.name || ''}`.toLowerCase().includes(fam);
  const mine = providers.find(has);
  if (mine) return { id: mine.id, name: strip(mine.name), installed: true, status: mine.status };
  const store = storeApps.find(a => (a.provides || []).includes('ai-connection') && has(a));
  return store ? { id: store.id, name: strip(store.name), installed: false } : null;
}

const providerName = (data, id) => strip((data.providers || []).find(p => p.id === id)?.name || id);

// One feature row: what it was tested on, how it runs now, and at most two owner actions.
function featureRow(app, f, data, ctx) {
  const esc = ctx.esc, target = connectTarget(f, data, ctx.storeApps);
  const strict = f.swap === 'never', route = f.route;
  const acts = [];
  const connect = (label) => target
    ? `<button type="button" class="mc-btn" data-mc-connect="${esc(target.id)}" data-mc-installed="${target.installed ? 1 : 0}">${esc(label || 'Connect ' + target.name)}</button>`
    : `<button type="button" class="mc-btn" data-mc-connect="" data-mc-installed="0">Connect a provider</button>`;
  let state, now = '', warn = '';
  if (f.status === 'ready') {
    state = ['ready', route?.chosen === 'owner-swap' ? 'Ready · approved swap' : 'Ready'];
    now = `Using <b>${esc(route.model)}</b> via ${esc(providerName(data, route.provider))}`;
    if (route.chosen === 'owner-swap') {
      warn = 'Results may differ from what the developer tested.';
      const tested = (data.providers || []).find(p => p.status === 'connected' && (p.models || []).some(m => m.id === f.tested_on));
      if (tested) acts.push(`<button type="button" class="mc-btn" data-mc-approve="${esc(f.feature)}" data-mc-provider="${esc(tested.id)}" data-mc-model="${esc(f.tested_on)}">Use tested ${esc(f.tested_on)}</button>`);
      else acts.push(connect());
    }
  } else if (route) {
    // A chosen route broke (signed out, expired, model gone). The Router never switches on its own.
    state = ['off', 'Needs attention'];
    now = `Routed to <b>${esc(route.model)}</b> via ${esc(providerName(data, route.provider))}: ${esc(f.error?.message || 'unavailable')}`;
    acts.push(`<button type="button" class="mc-btn" data-mc-connect="${esc(route.provider)}" data-mc-installed="1">Reconnect ${esc(providerName(data, route.provider))}</button>`);
  } else if (strict) {
    state = ['off', 'Off until connected'];
    now = `Only runs on ${esc(f.tested_on)}. The rest of the app works.`;
    acts.push(connect());
  } else {
    state = ['needs', f.offered ? 'Your choice' : 'Needs a provider'];
    now = f.offered ? `No provider here serves ${esc(f.tested_on)}.` : 'No connected provider can run this yet.';
    acts.push(connect());
    if (f.offered) {
      acts.push(`<button type="button" class="mc-btn alt" data-mc-approve="${esc(f.feature)}" data-mc-provider="${esc(f.offered.provider)}" data-mc-model="${esc(f.offered.model)}">Approve swap to ${esc(f.offered.model)}</button>`);
      warn = `${esc(f.offered.model)} via ${esc(providerName(data, f.offered.provider))}${f.offered.standing_in ? ` · ${esc(TIER[f.offered.tier] || f.offered.tier)} stand-in` : ''}. Results may differ from what the developer tested.`;
    }
  }
  const busy = ctx.busy?.has(app + '/' + f.feature);
  return `<div class="mc-row" data-mc-feature="${esc(f.feature)}">
    <div class="mc-head"><b>${esc(nice(f.feature))}</b><span class="mc-state ${state[0]}">${esc(state[1])}</span></div>
    <p class="mc-line">Tested on <b>${esc(f.tested_on)}</b>${f.tier ? ` · ${esc(TIER[f.tier] || f.tier)}` : ''}${strict ? ' · tested model only' : ''}</p>
    ${now ? `<p class="mc-line">${now}</p>` : ''}${warn ? `<p class="mc-warn">${warn}</p>` : ''}
    ${acts.length ? `<div class="mc-acts"${busy ? ' aria-busy="true"' : ''}>${busy ? '<span class="mc-wait">Saving…</span>' : acts.join('')}</div>` : ''}
  </div>`;
}

function serviceRow(s, ctx) {
  const esc = ctx.esc, ok = s.status === 'ready';
  return `<div class="mc-row"><div class="mc-head"><b>${esc(nice(s.slot))}</b><span class="mc-state ${ok ? 'ready' : 'off'}">${ok ? 'Ready' : 'Missing'}</span></div>
    <p class="mc-line">${ok ? `Served by ${esc(strip(s.provider))}` : `Needs an app that provides ${esc(nice(s.slot).toLowerCase())}${s.recommend ? ` (recommended: ${esc(strip(s.recommend))})` : ''}.`}</p></div>`;
}

// The rows shared by the install sheet and the per-app section.
export function routerRows(app, data, ctx) {
  return [...(data.models || []).map(f => featureRow(app, f, data, ctx)), ...(data.services || []).map(s => serviceRow(s, ctx))].join('');
}

export const hasNeeds = data => !!data && ((data.models || []).length + (data.services || []).length) > 0;
export const pending = data => (data?.models || []).filter(f => f.status !== 'ready').length;
