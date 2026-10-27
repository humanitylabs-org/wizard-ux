/* Notifications in Chats (unified inbox trial): every unread notification sits at the top of Ready as a yellow
 * thread holding one message. Tap it to read it. Done clears it and no chat is ever started. Reply opens a new chat
 * with the notification attached (the Notifications Reply path), and it clears once that chat is sent. Resolve this
 * sends that chat straight away, asking the agent to stop this kind of notification or fix what causes it.
 * Data and writes go through the host's inbox capability; text is only ever set with textContent. */
const RESOLVE = 'Resolve this notification: either stop sending notifications like this one, or fix whatever keeps causing it. Your call which. Tell me briefly what you did.';
const BELL = 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0';
const LINK = /(https:\/\/[^\s<>()[\]`"']+[^\s<>()[\]`"'.,;:!?])/;

export default function setup(api) {
  const box = document.createElement('div');
  box.className = 'ui-inbox'; box.setAttribute('role', 'list'); box.setAttribute('aria-label', 'Notifications');
  const open = new Set();
  let items = [];

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const icon = () => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', BELL); s.append(p); return s;
  };
  const titleOf = it => it.title || String(it.message || '').split('\n').find(l => l.trim()) || 'Notification';
  const plain = t => String(t || '').replace(/\[([^\]\n]+)\]\((https?:[^\s)]+)\)/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
  const ago = sec => {
    const m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
    return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
  };
  // The full message: paragraphs as written, https links tappable (opened outside Wizard).
  const body = it => {
    const p = el('p', 'ui-msg');
    for (const part of String(it.message || '').split(LINK)) {
      if (!part) continue;
      if (LINK.test(part) && part.startsWith('https://')) { const a = el('a', null, part); a.href = part; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); }
      else p.append(document.createTextNode(part));
    }
    return p;
  };
  const act = (label, kind, fn) => { const b = el('button', 'ui-act ' + kind, label); b.type = 'button'; api.listen(b, 'click', e => { e.stopPropagation(); fn(); }); return b; };

  function row(it) {
    const wrap = el('div', 'ui-item' + (open.has(it.id) ? ' open' : '')); wrap.setAttribute('role', 'listitem'); wrap.dataset.uiId = it.id;
    const head = el('button', 'ch-row unread ui-row'); head.type = 'button';
    head.setAttribute('aria-expanded', String(open.has(it.id)));
    const mark = el('span', 'emo ui-ic'); mark.append(icon());
    const bd = el('span', 'bd'), tp = el('span', 'tp');
    tp.append(el('b', null, plain(titleOf(it))), el('time', null, ago(it.time)));
    bd.append(tp, el('span', 'pv', (it.source === 'cron' ? 'Scheduled job · ' : '') + plain(it.message).slice(0, 160)));
    head.append(mark, bd);
    api.listen(head, 'click', () => {
      if (open.has(it.id)) { open.delete(it.id); paint(); return; }
      open.add(it.id); paint();
      // Bring the whole message and its buttons into view (they can open under the phone's dock).
      api.frame(() => { for (const n of box.children) if (n.dataset.uiId === it.id) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
    });
    wrap.append(head);
    if (open.has(it.id)) {
      const panel = el('div', 'ui-open');
      const acts = el('div', 'ui-acts');
      acts.append(
        act('Done', 'done', () => { open.delete(it.id); api.inbox.done(it.id); }),
        act('Reply', 'reply', () => { if (!api.inbox.reply(it.id)) api.toast('Couldn’t open a reply here'); }),
        act('Resolve this', 'resolve', () => { open.delete(it.id); if (!api.inbox.reply(it.id, RESOLVE)) api.toast('Couldn’t start that chat here'); }),
      );
      panel.append(body(it), acts);
      wrap.append(panel);
    }
    return wrap;
  }
  function paint() {
    for (const id of [...open]) if (!items.some(i => i.id === id)) open.delete(id);
    box.replaceChildren(...items.map(row));
    box.hidden = !items.length;
    sync();
  }
  function sync() { if (items.length) api.slot.mount('ready-top', box); else box.remove(); }

  api.inbox.watch(next => { items = next; paint(); });
  // A reply (or Resolve this) that was actually sent finishes the notification: it lives on as that chat.
  api.on('sent', p => { const k = String(p?.reply || ''); if (k.startsWith('notifications:')) api.inbox.done(k.slice(14)); });
  api.on('render', sync); api.on('route', sync);
  return () => { open.clear(); };
}
