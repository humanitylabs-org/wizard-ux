/* Shared Incognito adapter for Chats. No durable drafts/outbox/history/state API is accepted here. */
(() => {
  'use strict';
  window.WizCore = window.WizCore || {};
  window.WizCore.incognitoChats = function ({ win, elOf, paint, grow, toast, kit = window.WosChat, fetchImpl = fetch, confirm = text => window.confirm(text) }) {
    const open = new Map();
    const alive = (wid, s) => open.get(wid) === s;
    const request = async (s, path, method = 'GET', body, signal = s.abort.signal) => {
      const r = await fetchImpl(s.base + path, { method, credentials: 'same-origin', cache: 'no-store', signal,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
      if (!r.ok) throw Object.assign(new Error('Incognito unavailable'), { status: r.status });
      return r.json();
    };
    const destroyRemote = s => s.base && fetchImpl(s.base, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', keepalive: true }).catch(() => {});
    function close(wid, force = false) {
      const s = open.get(wid); if (!s) return true;
      if (!force && !confirm('End incognito chat? It will be erased.')) return false;
      open.delete(wid); clearInterval(s.lease); s.abort.abort();
      // Wipe DOM before dropping strings. No copy is moved to Chats, draft storage, or the normal composer.
      const el = elOf(wid); if (el?.querySelector('[data-incog-thread]')) el.replaceChildren();
      s.draft = ''; s.messages.length = 0; s.output = ''; void destroyRemote(s); return true;
    }
    async function start(wid, agent) {
      if (!agent || agent.privacy !== 'private' || open.has(wid)) return;
      const s = { agent, draft: '', messages: [], output: '', working: true, starting: true, sent: false, error: '', abort: new AbortController(), base: '' };
      open.set(wid, s); paint(wid);
      try {
        const route = `/wizard/v1/agents/${encodeURIComponent(agent.id)}/incognito`;
        const response = await fetchImpl(route, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!response.ok) throw new Error('Unavailable');
        const result = await response.json();
        if (!/^incog_[a-f0-9]{32}$/.test(result.session_id || '')) throw new Error('Unavailable');
        s.base = route + '/' + result.session_id;
        if (!alive(wid, s)) { void destroyRemote(s); return; }
        s.starting = false; s.working = false;
        s.lease = setInterval(async () => {
          // Closing a window, shell navigation, or removed view must not leave a renewed invisible session.
          if (!win(wid) || !elOf(wid)?.querySelector('[data-incog-thread]')) { close(wid, true); return; }
          try { await request(s, '/lease', 'POST', {}); }
          catch { if (alive(wid, s)) { close(wid, true); paint(wid); toast('!', 'Incognito ended · nothing was saved', 3000); } }
        }, 20_000);
      } catch { if (alive(wid, s)) { s.starting = false; s.working = false; s.error = 'Incognito couldn’t start. Nothing was sent. Close this chat and try again.'; } }
      if (alive(wid, s)) paint(wid);
    }
    function render(wid, el) {
      const s = open.get(wid); if (!s || !el) return false;
      const esc = kit.esc;
      // Use Chats' Markdown renderer with remote images disabled: an answer cannot send text to a third party.
      const bubble = m => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}"><div class="bub">${kit.md(m.text).replace(/<img\b[^>]*>/gi, '')}</div></div>`;
      const old = el.querySelector('[data-incog-field]'), focused = !!old && old === document.activeElement;
      const selection = old ? [old.selectionStart, old.selectionEnd] : null;
      el.innerHTML = `<div class="ch-thread ch-incognito" data-incog-thread>
        <div class="ch-head"><button type="button" class="ch-back" data-incog-close aria-label="End Incognito chat">‹</button><div class="ti"><b>Incognito</b><span class="ch-privtag">Private · temporary</span></div>${!s.sent ? '<label class="pbtn ch-incog-toggle"><input type="checkbox" role="switch" data-incog-off aria-label="Incognito" checked>Incognito</label>' : ''}<button type="button" class="pbtn" data-incog-close>Close</button></div>
        <div class="ch-incog-note" role="note"><b>This chat is never saved.</b><span>Closing or leaving discards it. Text only — no attachments, voice, reminders, app changes or memory edits.</span></div>
        <div class="ch-msgs">${s.messages.map(bubble).join('')}${s.output ? bubble({ role: 'assistant', text: s.output }) : ''}${s.working ? '<p class="ch-empty" role="status">' + (s.starting ? 'Opening Incognito…' : 'Replying…') + '</p>' : ''}${s.error ? `<p class="ch-empty" role="alert">${esc(s.error)}</p>` : ''}</div>
        <form class="ch-compose" data-incog-form><div class="ch-row2"><div class="ch-field"><textarea data-incog-field rows="1" placeholder="Message ${esc(s.agent.label || 'Private agent')}" aria-label="Incognito message" autocomplete="off" autocorrect="off" spellcheck="false" ${s.starting || s.error ? 'disabled' : ''}>${esc(s.draft)}</textarea></div><button type="submit" class="ch-send" aria-label="Send Incognito message" ${s.working || s.error ? 'disabled' : ''}>↑</button></div></form></div>`;
      const field = el.querySelector('[data-incog-field]'); grow(field);
      if (focused && !field.disabled) { field.focus({ preventScroll: true }); field.setSelectionRange(...selection); }
      const box = el.querySelector('.ch-msgs'); box.scrollTop = box.scrollHeight;
      return true;
    }
    async function send(wid, text) {
      const s = open.get(wid); text = String(text || '').trim();
      if (!s || s.working || s.error || !text) return false;
      s.draft = ''; s.sent = true; s.working = true; s.error = ''; s.messages.push({ role: 'user', text }); paint(wid);
      try {
        const admitted = await request(s, '/v1/runs', 'POST', { input: text });
        if (!alive(wid, s)) return false;
        const run = admitted.run_id || admitted.id;
        if (!/^[A-Za-z0-9._:-]{1,200}$/.test(run || '')) throw new Error('Unavailable');
        // Same run surface as ordinary Chats, held only in this Map. Never retry an ambiguous send.
        while (alive(wid, s)) {
          const result = await request(s, '/v1/runs/' + encodeURIComponent(run));
          if (!alive(wid, s)) return false;
          s.output = typeof result.output === 'string' ? result.output : '';
          if (['completed', 'failed', 'cancelled', 'interrupted', 'expired'].includes(result.status)) {
            if (s.output) s.messages.push({ role: 'assistant', text: s.output });
            s.output = ''; s.working = false;
            if (result.status !== 'completed') s.error = 'The reply stopped. Close this chat to discard it.';
            paint(wid); return true;
          }
          paint(wid);
          await new Promise(resolve => { const timer = setTimeout(resolve, 600); s.abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
        }
      } catch { if (alive(wid, s)) { s.working = false; s.error = 'The connection was lost. This message will not be retried or saved. Close this chat to discard it.'; paint(wid); } }
      return false;
    }
    function input(wid, field) { const s = open.get(wid); if (!s) return false; s.draft = field.value; grow(field); return true; }
    const leave = () => { for (const wid of [...open.keys()]) { close(wid, true); paint(wid); } };
    addEventListener('pagehide', leave);
    addEventListener('pageshow', e => { if (e.persisted) leave(); });
    // BFCache must not revive the private DOM; a page reload starts ordinary Chats.
    addEventListener('beforeunload', leave);
    function beforeNavigate(ids = []) {
      const leaving = [...open.keys()].filter(id => !ids.includes(id));
      if (!leaving.length) return true;
      if (!confirm('End incognito chat? It will be erased.')) return false;
      for (const id of leaving) { close(id, true); paint(id); }
      return true;
    }
    return { active: wid => open.has(wid), start, close, beforeNavigate, render, send, input,
      draft: wid => open.get(wid)?.draft || '', endAll: leave };
  };
})();
