/* Wizard OS — "Routes through": which agent an installed app sends its work to (App → agent binding, wizard-os
 * spec/AGENTS.md). Shared by both shells; the Agents app has the same picker in its own sheets.
 *
 * Only apps that declare agent_binding have a route. Their window bar carries a small route button (the agent's
 * sigil; a red dot when that agent is stopped and the work is waiting). It opens the app's settings sheet:
 * the app, what it sends, and "Routes through: [agent]". Default = the main agent. A private agent needs no extra
 * warning; a bound agent that is stopped says so plainly, because its work waits and never goes elsewhere.
 *
 *   WosAppRoute.slot(appId)            window-bar markup (empty until the binding is known; repainted on change)
 *   WosAppRoute.open(appId, { name })  the settings sheet
 *   WosAppRoute.isOpen() / back()      Back closes the sheet first (true when it did)
 *   WosAppRoute.init({ openAgents })   shell hook: open the Agents app (optionally at an agent)
 */
(() => {
  'use strict';
  const AG = window.WosAgents;
  if (!AG || window.WosAppRoute) return;
  const esc = AG.esc;
  const HOOK = { openAgents: null };
  let el = null, cur = null, busy = '', note = '';

  const heldText = (b, app) => {
    const who = b.target ? b.target.label : 'The agent it routes through';
    if (b.held === 'missing') return `${who} isn’t on this Wizard any more. Work from ${app} can’t be delivered until you pick an agent.`;
    return `${who} is ${b.held === 'error' ? 'not working' : 'stopped'}. Work from ${app} waits until it runs again. It never goes to another agent.`;
  };
  const statusWord = a => ({ running: 'Running', starting: 'Starting…', stopped: 'Stopped', error: 'Not working' }[a.status] || a.status);

  function slotInner(appId) {
    const b = AG.binding(appId); if (!b) return '';
    const name = b.target ? b.target.label : 'no agent';
    const label = `Routes through ${name}${b.held ? ` (${b.held === 'missing' ? 'missing' : 'stopped'})` : ''}`;
    return `<button type="button" class="wb wroute${b.held ? ' held' : ''}" data-wact="route" data-route-open="${esc(appId)}" aria-label="${esc(label)}" title="${esc(label)}">`
      + `<svg class="wr-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h12M13 7l5 5-5 5"/></svg>${b.target ? AG.sigil(b.target, 'wr-sig') : '<span class="wr-sig wr-none">?</span>'}</button>`;
  }
  function slot(appId) { return appId ? `<span class="wroute-slot" data-route-slot="${esc(appId)}">${slotInner(appId)}</span>` : ''; }
  function paint() {
    for (const s of document.querySelectorAll('[data-route-slot]')) { const h = slotInner(s.dataset.routeSlot); if (s.innerHTML !== h) s.innerHTML = h; }
    if (el && cur) render();
  }

  function render() {
    const b = AG.binding(cur.appId);
    const app = (b && b.label) || cur.name || cur.appId;
    let body;
    if (!b) body = `<p class="ar-note">${esc(app)} doesn’t send work to an agent.</p>`;
    else {
      const rows = AG.list.map(a => {
        const on = a.id === b.agent;
        const sub = [a.privacy === 'private' ? 'Private' : a.is_default ? 'Main agent' : 'Agent', statusWord(a)].join(' · ');
        return `<button type="button" class="ar-agent${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-route-pick="${esc(a.id)}" style="--ag:${AG.colour(a)}" ${busy ? 'disabled' : ''}>`
          + `${AG.sigil(a, 'ar-sig')}<span class="tx"><b>${esc(a.label)}${a.privacy === 'private' ? `<span class="ar-lock">${AG.lock()}</span>` : ''}</b><small class="st-${esc(a.status)}">${esc(sub)}</small></span><span class="rd"></span></button>`;
      }).join('');
      body = `<div class="ar-sec">Routes through</div><div class="ar-list" role="radiogroup" aria-label="Routes through">${rows || '<p class="ar-note">No agents yet.</p>'}</div>
        ${b.held ? `<p class="ar-note bad" data-route-held>${esc(heldText(b, app))}</p>` : ''}
        ${note ? `<p class="ar-note ${note.startsWith('!') ? 'bad' : 'ok'}" role="status">${esc(note.replace(/^!/, ''))}</p>` : ''}`;
    }
    el.innerHTML = `<div class="ar-card" role="dialog" aria-modal="true" aria-label="${esc(app)} settings">
      <div class="ar-head"><b>${esc(app)}</b><small>${esc((b && b.purpose) || 'Work from this app goes to one agent.')}</small></div>
      ${body}
      <p class="ar-foot">${b && b.is_default ? 'Default: your main agent. ' : ''}Change it any time. The app never picks an agent itself.</p>
      <div class="ar-acts">${HOOK.openAgents ? '<button type="button" class="ar-btn ghost" data-route-agents>Agents</button>' : ''}<button type="button" class="ar-btn" data-route-close>Done</button></div></div>`;
  }
  function open(appId, o = {}) {
    if (!appId) return false;
    cur = { appId, name: o.name || '' }; note = ''; busy = '';
    if (!el) { el = document.createElement('div'); el.className = 'aroute'; el.dataset.routeSheet = ''; document.body.appendChild(el); }
    render(); requestAnimationFrame(() => el && el.classList.add('open'));
    Promise.all([AG.load(true), AG.loadBindings(true)]).then(() => { if (el && cur) render(); });
    return true;
  }
  function close() { if (!el) return false; el.remove(); el = null; cur = null; return true; }
  async function pick(agentId) {
    const b = cur && AG.binding(cur.appId); if (!b || busy || agentId === b.agent) return;
    busy = agentId; note = ''; render();
    try { const v = await AG.setBinding(cur.appId, agentId); const a = AG.get(v?.agent || agentId); note = `${b.label} now routes through ${a ? a.label : agentId}.`; }
    catch (e) { note = `!Not changed · ${e.message}`; }
    busy = ''; if (el) render(); paint();
    // Open System / Agents windows show the same routes: tell them to look again.
    for (const f of document.querySelectorAll('iframe')) { try { f.contentWindow?.postMessage({ type: 'wizard:bindings-changed' }, location.origin); } catch (_) {} }
  }
  // Capture: the window bar's own handlers (double-tap to fill, drag) never see a route tap.
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-route-open], [data-route-pick], [data-route-close], [data-route-agents], .aroute');
    if (!t) return;
    if (t.dataset.routeOpen != null) { e.stopPropagation(); e.preventDefault(); open(t.dataset.routeOpen); return; }
    if (t.dataset.routePick != null) { e.stopPropagation(); pick(t.dataset.routePick); return; }
    if (t.dataset.routeClose != null) { e.stopPropagation(); close(); return; }
    if (t.dataset.routeAgents != null) { e.stopPropagation(); const id = AG.binding(cur?.appId)?.agent; close(); HOOK.openAgents?.(id); return; }
    if (t.classList.contains('aroute') && e.target === t) { e.stopPropagation(); close(); }
  }, true);
  document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('[data-route-open]')) e.stopPropagation(); }, true);
  AG.onChange(paint);
  window.WosAppRoute = { slot, paint, open, close, isOpen: () => !!el, back: close, init(o = {}) { if (typeof o.openAgents === 'function') HOOK.openAgents = o.openAgents; }, get current() { return cur && { ...cur }; } };
})();
