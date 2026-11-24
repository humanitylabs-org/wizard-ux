/* Wizard UX core: Chats › approvals in a thread: the Approve / Deny card bound to the prompt it shows, choosing an
 * answer, and repainting a thread around a field being typed in. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.approvals = function ({ ch, esc, KIT, LIVE, renderThreadNow, toast, W }) {
  /* Controls are bound to the displayed identity, never to whichever prompt arrives next. */
  function approvalHtml(c, s) {
    const ap = c.approval;
    if (!ap || !s || ap.runId !== s.runId) return '';
    if (ap.resolved) return `<div class="appr done">${esc(ap.stale ? 'No longer waiting · already answered or expired' : ap.kind === 'unknown' ? 'Recovery acknowledged · execution interrupted' : ap.kind === 'clarify' ? 'Answer sent' : KIT.choiceReceipt(ap.resolved))}</div>`;
    const buttons = ap.kind === 'clarify' ? [...ap.choices, { value: '__answer', label: 'Send answer' }] : ap.choices;
    return `<div class="appr" role="group" aria-label="Run control"><b>${ap.kind === 'unknown' ? 'Needs recovery' : ap.kind === 'clarify' ? 'Answer needed' : 'Needs your approval'}</b><pre>${esc(ap.action)}</pre>
      ${ap.kind === 'clarify' ? `<input data-clarify-answer aria-label="Clarification answer" value="${esc(ap.answer || '')}" maxlength="16384">` : ''}
      <div class="appr-b${buttons.length > 2 ? ' many' : ''}">${buttons.map(ch => `<button type="button" data-approve="${esc(ch.value)}" data-control-key="${esc(ap.key)}" class="${/^(deny|reject)$/.test(ch.value) ? 'no' : ''}" ${ap.pending ? 'disabled' : ''}>${ap.pending === ch.value ? 'Sending…' : esc(ch.label)}</button>`).join('')}</div>
      ${ap.error ? `<small class="err">${esc(ap.error)}</small>` : '<small>Only the displayed request will be answered.</small>'}</div>`;
  }
  async function loadApproval(w, s) {
    const c = ch(w.id), sid = w.thread, nav = c.readNav;
    const current = () => W[w.id] === w && w.thread === sid && c.readNav === nav;
    if (!s || !['waiting_for_approval', 'unknown', 'running'].includes(s.status) || !s.runId) { if (c.approval && !c.approval.resolved) c.approval = null; return false; }
    if (c.approval?.runId === s.runId && Date.now() - c.approval.at < 3000) return false;
    try {
      const run = await LIVE.run(s.runId);
      if (!current()) return false;
      const prev = c.approval;
      let ap;
      if (run.status === 'unknown') {
        const caps = await LIVE.runCapabilities(s.runId).catch(() => ({}));
        if (!current()) return false;
        ap = { kind: 'unknown', requestId: run.admission_id, generation: run.execution_generation,
          action: 'Hermes restarted before this execution could be confirmed. Some work may already have happened. Acknowledge the uncertain outcome to release queued replies without repeating this turn.',
          choices: caps.features?.run_unknown_resolution === true && typeof run.admission_id === 'string' && Number.isSafeInteger(run.execution_generation) ? [{ value: 'resolve', label: 'Acknowledge interrupted execution' }] : [] };
      } else ap = Array.isArray(run.pending_controls) ? run.pending_controls.map(KIT.normalizeApproval).find(Boolean) : KIT.normalizeApproval(run.approval);
      if (ap) {
        ap.key = JSON.stringify([s.runId, ap.kind, ap.requestId, ap.generation]);
        if (prev?.key === ap.key) Object.assign(ap, { pending: prev.pending, error: prev.error, answer: prev.answer });
        // An answered control stays answered: a runtime snapshot that still lists it (lagging poll, stale queue
        // payload) must never re-offer it, or every tap 409s and the same card comes straight back (James, 23 Oct).
        const settled = c.settled?.get(ap.key);
        if (settled) Object.assign(ap, { resolved: settled.resolved, stale: settled.stale, pending: '' });
      }
      c.approval = ap ? { ...ap, runId: s.runId, at: Date.now() } : null;
      return JSON.stringify(prev && { k: prev.key, a: prev.action, c: prev.choices, r: prev.resolved }) !== JSON.stringify(c.approval && { k: c.approval.key, a: c.approval.action, c: c.approval.choices, r: c.approval.resolved });
    } catch { return false; }
  }
  function settle(c, key, resolved, stale = false) {
    const m = c.settled || (c.settled = new Map()); m.delete(key); m.set(key, { resolved, stale });
    while (m.size > 50) m.delete(m.keys().next().value);
  }
  async function chooseApproval(wid, choice, key, answer) {
    const w = W[wid], c = ch(wid), ap = c.approval;
    if (!w || !ap || ap.pending || ap.resolved || ap.key !== key || !(ap.choices.some(x => x.value === choice) || ap.kind === 'clarify' && choice === '__answer')) return;
    const sid = w.thread, nav = c.readNav;
    const owns = () => W[wid] === w && w.thread === sid && c.readNav === nav && c.approval?.key === key;
    if (ap.kind === 'clarify') { ap.answer = choice === '__answer' ? answer : choice; if (!ap.answer?.trim()) return; }
    if (ap.kind === 'unknown' && !window.confirm('Mark this lost execution interrupted and release queued replies? It will not be replayed.')) return;
    ap.pending = choice; ap.error = ''; renderThreadNow(w);
    try {
      if (ap.kind === 'unknown') await LIVE.resolveUnknown(ap.runId, ap.requestId, ap.generation);
      else if (ap.kind === 'clarify') await LIVE.clarify(ap.runId, ap.answer, ap.requestId, ap.generation);
      else await LIVE.approve(ap.runId, choice, ap.requestId, ap.generation);
      settle(c, key, ap.kind === 'approval' ? choice : 'closed');
      if (owns()) c.approval.resolved = ap.kind === 'approval' ? choice : 'closed';
    } catch (e) {
      if (owns()) {
        if ([404, 409, 410].includes(e.status)) {
          // The runtime says this exact control is no longer pending: retire its key so a reload can't re-offer it.
          settle(c, key, 'closed', true);
          c.approval = null;
          await loadApproval(w, LIVE.session(sid));
          const next = c.approval;
          if (W[wid] === w && w.thread === sid && c.readNav === nav && next && !next.resolved && next.key !== key) toast('·', 'This control changed. Check the current prompt before responding.', 3000);
        } else c.approval.error = 'Couldn’t send. Check the connection and try again.';
      }
    }
    if (owns()) c.approval.pending = '';
    if (W[wid] === w && w.thread === sid && c.readNav === nav) renderThreadNow(w);
    LIVE.refresh();
  }
  /* Replace el's contents with html while `keep` (a field inside el) stays attached: every ancestor of keep takes the
   * fresh attributes and children, and keep takes the fresh field's place. Returns false (caller falls back to
   * innerHTML) when the fresh markup has no matching field. */
  function rebuildAround(el, html, keep) {
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    const fresh = tpl.content.querySelector('.ch-compose textarea'); if (!fresh || !el.contains(keep)) return false;
    const oldPath = [], newPath = [];
    for (let n = keep; n && n !== el; n = n.parentNode) oldPath.unshift(n);
    for (let n = fresh; n && n !== tpl.content; n = n.parentNode) newPath.unshift(n);
    if (oldPath.length !== newPath.length || oldPath.some((n, i) => n.nodeName !== newPath[i].nodeName)) return false;
    keep.placeholder = fresh.placeholder;
    let oldParent = el, newParent = tpl.content;
    oldPath.forEach((o, i) => {
      const f = newPath[i];
      for (const c of [...oldParent.childNodes]) if (c !== o) c.remove();
      const kids = [...newParent.childNodes], at = kids.indexOf(f);
      o.before(...kids.slice(0, at)); o.after(...kids.slice(at + 1));
      if (o !== keep) {
        for (const a of [...o.attributes]) if (!f.hasAttribute(a.name)) o.removeAttribute(a.name);
        for (const a of [...f.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
      }
      oldParent = o; newParent = f;
    });
    return true;
  }
  return { approvalHtml, chooseApproval, loadApproval, rebuildAround };
};
