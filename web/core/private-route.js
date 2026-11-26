/* Wizard UX core: private routing, the shell half (wizard-ux issue 1804, switch wizard/private-routing, off by default;
 * the Agent Service half, which decides, is wizard-agent-service issue 629). In private mode /wizard/v1/route names the
 * agent each orb take is for. The outbox (web/outbox.js, routeChoice/applyChoice) puts the take on that agent with the
 * owner's exact words; this part makes it feel like talking to that agent:
 *   - the new thread opens in front (no relay, no "asking…" step);
 *   - a chip at the top of the thread says where it went and why ("Philosopher · Claude Fable 5 · you named it");
 *   - tapping the chip lists the agents (Private first); choosing one moves the request there: same words, a new
 *     thread on that agent, the old thread stopped and removed when it has no reply yet, and one correction on the
 *     Sent log row (POST /wizard/v1/sent/<id>/correct {agent}).
 * The chip's record (thread -> agent, model, why, Sent id, words) is kept on this device only (wos.private-route.v1).
 * Switch off: nothing paints, nothing opens, and the outbox never applies an answer.
 *   WosPrivateRoute.on()            -> the switch is on
 *   WosPrivateRoute.answer(j)       -> { cmd, sent_id } when a route answer names an agent and the switch is on, else null
 *   WosPrivateRoute.chipHtml(sid)   -> the chip for that thread, or ''
 *   WosPrivateRoute.record(sid) / remember(sid, rec) / move(sid, agentId) / openSheet(sid) / closeSheet()
 */
(() => {
  'use strict';
  if (window.WosPrivateRoute) return;
  const ID = 'wizard/private-routing', KEY = 'wos.private-route.v1', KEEP = 40;
  const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,40}$/, SID = /^(?!\.{1,2}$)[A-Za-z0-9._:-]{1,180}$/;
  const WHY = { name: 'you named it', private_label: 'personal data', thread: 'this thread', default: 'default', moved: 'you moved it' };
  const J = { 'Content-Type': 'application/json' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const on = () => { try { return (document.documentElement.dataset.tweaks || '').split(/\s+/).includes(ID); } catch (_) { return false; } };
  const AG = () => window.WosAgents;
  function all() { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
  function save(v) {
    const keep = Object.entries(v).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, KEEP);
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep))); } catch (_) {}
  }
  function record(sid) { const r = SID.test(String(sid || '')) ? all()[sid] : null; return r && AGENT_ID.test(String(r.agent || '')) ? r : null; }
  function remember(sid, r) {
    if (!SID.test(String(sid || '')) || !r || !AGENT_ID.test(String(r.agent || ''))) return;
    const v = all();
    v[sid] = { agent: r.agent, model: String(r.model || '').slice(0, 80), provider: String(r.provider || '').slice(0, 80), why: WHY[r.why] ? r.why : 'default', sent: String(r.sent || '').slice(0, 80), words: String(r.words || '').slice(0, 4000), at: r.at || Date.now(), ...(r.moved ? { moved: true } : {}) };
    save(v);
  }
  function answer(j) {
    if (!on()) return null;
    const c = j?.cmd;
    return c && c.route === 'agent' && typeof c.agent_id === 'string' && AGENT_ID.test(c.agent_id) ? { cmd: c, sent_id: typeof j.sent_id === 'string' ? j.sent_id : '' } : null;
  }
  function agentLabel(id) { const a = AG()?.get?.(id); return a ? a.label : id; }
  // The model's own name as the picker shows it (Claude Fable 5), from the provider it runs on.
  function modelLabel(id, model, provider) {
    if (!model) return '';
    const M = window.WosModels, a = AG()?.get?.(id), p = provider || a?.model?.provider || '';
    let n = '';
    try {
      // A private model shows its own name and version, as in the picker's Private group (glm-5-3 -> GLM 5.3).
      if (AG()?.isPrivate?.(a) || M?.isPrivateRoute?.(p)) { const v = M?.privateName?.(model); n = v ? [v.name, v.version].filter(Boolean).join(' ') : ''; }
      else n = M?.name?.(model, p) || '';
    } catch (_) {}
    if (n && n !== model) return n;
    return AG()?.modelName?.(a, model) || model;
  }
  function chipHtml(sid) {
    if (!on()) return '';
    const r = record(sid); if (!r) return '';
    const a = AG()?.get?.(r.agent), priv = !!a && AG().isPrivate?.(a);
    const parts = [agentLabel(r.agent), modelLabel(r.agent, r.model, r.provider), WHY[r.why] || WHY.default].filter(Boolean);
    return `<div class="wpr-chip-row" data-morph-key="wpr:${esc(sid)}"><button type="button" class="wpr-chip${priv ? ' priv' : ''}" data-wprchip="${esc(sid)}" aria-haspopup="dialog" aria-label="${esc('Sent to ' + parts.join(', ') + '. Tap to send it to a different agent')}">`
      + `${a ? AG().sigil(a, 'wpr-sig') : ''}<span class="wpr-t">${parts.map((p, i) => i ? `<span class="wpr-sep" aria-hidden="true">·</span><span>${esc(p)}</span>` : `<b>${esc(p)}</b>`).join('')}</span></button></div>`;
  }
  // The agents the request can move to: the picker's list (visible agents), Private group first, oldest first.
  function choices() {
    const A = AG(); if (!A?.visible) return [];
    const list = A.visible().filter(a => a.role !== 'recovery');
    const age = a => Number(a.created_at) || 0;
    return [...list.filter(a => A.isPrivate(a)).sort((x, y) => age(x) - age(y)), ...list.filter(a => !A.isPrivate(a)).sort((x, y) => (y.is_default - x.is_default) || age(x) - age(y))];
  }
  let sheet = null, busy = false;
  function closeSheet() { if (!sheet) return false; sheet.remove(); sheet = null; return true; }
  function openSheet(sid) {
    closeSheet();
    const r = record(sid); if (!r || !on()) return false;
    const A = AG(), list = choices();
    const row = a => `<button type="button" class="wpr-opt${a.id === r.agent ? ' cur' : ''}" data-wprmove="${esc(a.id)}"${a.id === r.agent ? ' aria-current="true" disabled' : ''}>${A.sigil(a, 'wpr-sig')}`
      + `<span class="wpr-on"><b>${esc(a.label)}</b><small>${esc([A.isPrivate(a) ? 'Private agent' : a.is_default ? 'Main agent' : 'Agent', A.modelName(a, a.model?.model)].filter(Boolean).join(' · '))}</small></span>`
      + `${a.id === r.agent ? '<i class="wpr-ck" aria-hidden="true">✓</i>' : ''}</button>`;
    const priv = list.filter(a => A.isPrivate(a)), std = list.filter(a => !A.isPrivate(a));
    const grp = (name, rows, cls) => rows.length ? `<div class="wpr-grp${cls}" role="group" aria-label="${esc(name)}"><div class="wpr-gh">${cls ? A.lock() : ''}<span>${esc(name)}</span></div>${rows.map(row).join('')}</div>` : '';
    sheet = document.createElement('div');
    sheet.className = 'wpr-sheet'; sheet.dataset.wprsheet = sid;
    sheet.innerHTML = `<div class="wpr-scrim" data-wprclose></div><div class="wpr-panel" role="dialog" aria-modal="true" aria-labelledby="wprTitle">`
      + `<div class="wpr-head"><b id="wprTitle">Send it to a different agent</b><button type="button" class="wpr-x" data-wprclose aria-label="Close">✕</button></div>`
      + `<p class="wpr-said">“${esc(String(r.words || '').slice(0, 160))}”</p>${grp('Private', priv, ' priv')}${grp('Agents', std, '')}</div>`;
    document.body.append(sheet);
    sheet.querySelector('.wpr-opt:not([disabled])')?.focus?.({ preventScroll: true });
    return true;
  }
  const toast = (i, t, ms) => { try { (window.__wos?.toast || window.__wux?.toast)?.(i, t, ms); } catch (_) {} };
  function openThread(sid) {
    try { return !!window.WizCore?.deeplink?.route?.(location.pathname + '?session=' + encodeURIComponent(sid)); } catch (_) { return false; }
  }
  const scoped = (path, agent) => agent && AG()?.isOther?.(agent) ? path + (path.includes('?') ? '&' : '?') + 'agent=' + encodeURIComponent(agent) : path;
  async function replied(sid, agent) {
    try {
      const r = await fetch(scoped(`/wizard/hermes/api/sessions/${encodeURIComponent(sid)}/messages`, agent), { cache: 'no-store', credentials: 'same-origin' });
      if (r.status === 404) return false;
      if (!r.ok) return true; // unknown: keep it
      const j = await r.json(), rows = Array.isArray(j) ? j : j.data || j.messages || [];
      return rows.some(m => m?.role === 'assistant' && String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).trim());
    } catch (_) { return true; }
  }
  // Move: same words, a new thread on the chosen agent; the old one goes when it has no reply yet; one correction.
  async function move(sid, to) {
    const r = record(sid), A = AG(), a = A?.get?.(to), OB = window.WosOutbox;
    if (!on() || !r || !a || !OB || busy || to === r.agent) return null;
    busy = true;
    try {
      const other = A.isOther(a.id);
      const it = await OB.enqueue({ kind: 'new', text: r.words, source: 'orb', agent: other ? a.id : '', instructions: '' });
      if (!it?.sessionId || it.state === 'failed') { toast('!', it?.error || 'Couldn’t send it there · try again', 2600); return null; }
      remember(it.sessionId, { agent: a.id, model: it.model, provider: it.provider, why: 'moved', sent: r.sent, words: r.words, moved: true });
      closeSheet();
      openThread(it.sessionId);
      // The old thread: stopped and removed while nothing has answered in it.
      (async () => {
        try { await window.WizLive?.cancelSend?.(sid); } catch (_) {}
        if (!(await replied(sid, r.agent))) {
          try { await fetch(scoped(`/wizard/hermes/api/sessions/${encodeURIComponent(sid)}`, r.agent), { method: 'PATCH', credentials: 'same-origin', headers: J, body: JSON.stringify({ archived: true }) }); } catch (_) {}
          const v = all(); delete v[sid]; save(v);
          try { window.WizLive?.refresh?.(); } catch (_) {}
        }
      })();
      if (r.sent && /^sent_[a-z0-9]{6,64}$/i.test(r.sent)) {
        fetch(`/wizard/v1/sent/${encodeURIComponent(r.sent)}/correct`, { method: 'POST', credentials: 'same-origin', headers: J, body: JSON.stringify({ agent: a.id }) }).catch(() => {});
      }
      return it;
    } finally { busy = false; }
  }
  document.addEventListener('click', e => {
    const t = e.target?.closest?.('[data-wprchip], [data-wprmove], [data-wprclose]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t.dataset.wprchip !== undefined) openSheet(t.dataset.wprchip);
    else if (t.dataset.wprclose !== undefined) closeSheet();
    else if (sheet) move(sheet.dataset.wprsheet, t.dataset.wprmove);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet) { e.preventDefault(); e.stopPropagation(); closeSheet(); } }, true);
  // A take the outbox put on its agent (it.privateRoute): remember it and open its thread in front.
  window.WosOutbox?.onNew?.(it => {
    const p = it?.privateRoute;
    if (!p || !on() || !it.sessionId) return;
    remember(it.sessionId, p);
    setTimeout(() => openThread(it.sessionId), 0);
  });
  window.WosPrivateRoute = { on, answer, chipHtml, record, remember, move, openSheet, closeSheet, WHY };
})();
