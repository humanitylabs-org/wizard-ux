/* Notifications in Chats (unified inbox): a notification is a yellow thread with one message.
 * Unread ones sit at the top of Ready; tapping one opens it in the chat window like any thread, with Done, Snooze and
 * Resolve this where a thread keeps them (same keys), and the message box: sending starts a real chat with the
 * notification attached and finishes it. Snoozed = read and kept: quiet rows at the bottom of Ready. Done = archived:
 * "Completed notifications" under Archive, where one can be opened and restored.
 * Data and writes go through the host's inbox capability; text is only ever set with textContent. */
const RESOLVE = 'Resolve this notification: either stop sending notifications like this one, or fix whatever keeps causing it. Your call which. Tell me briefly what you did.';
const BELL = 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0';
const DONE_SHOWN = 30;

export default function setup(api) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const icon = () => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', BELL); s.append(p); return s;
  };
  const titleOf = it => it.title || String(it.message || '').split('\n').find(l => l.trim()) || 'Notification';
  const plain = t => String(t || '').replace(/\[([^\]\n]+)\]\((https?:[^\s)]+)\)/g, '$1').replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim();
  const ago = sec => {
    const m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
    return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
  };
  const open = id => { if (!api.inbox.reply(id)) api.toast('Couldn’t open that notification here'); };

  // One row, the same shape as a thread row.
  function row(it, kind) {
    const b = el('button', 'ch-row ui-row' + (kind === 'new' ? ' unread' : '')); b.type = 'button'; b.dataset.uiId = it.id; b.dataset.chnotif = it.id;
    const mark = el('span', 'emo ui-ic'); mark.append(icon());
    const bd = el('span', 'bd'), tp = el('span', 'tp');
    tp.append(el('b', null, plain(titleOf(it))), el('time', null, ago(it.time)));
    const pv = el('span', 'pv');
    if (kind === 'snoozed') pv.append(el('em', 'att ui-snz', 'Snoozed:'), document.createTextNode(' '));
    pv.append(document.createTextNode((it.source === 'cron' ? 'Scheduled job · ' : '') + plain(it.message).slice(0, 160)));
    bd.append(tp, pv); b.append(mark, bd);
    api.listen(b, 'click', () => open(it.id));
    const wrap = el('div', 'ui-item ' + kind); wrap.setAttribute('role', 'listitem'); wrap.append(b);
    return wrap;
  }
  const list = (cls, label) => { const n = el('div', 'ui-inbox ' + cls); n.setAttribute('role', 'list'); n.setAttribute('aria-label', label); return n; };
  const fresh = list('new', 'Notifications'), later = list('snoozed', 'Snoozed notifications');
  const done = el('div', 'ui-done'), doneBtn = el('button', 'ui-done-btn'), doneList = list('done', 'Completed notifications');
  doneBtn.type = 'button'; done.append(doneBtn, doneList);
  fresh.hidden = later.hidden = done.hidden = true;
  let items = [], showDone = false;
  api.listen(doneBtn, 'click', () => { showDone = !showDone; paint(); });

  function paint() {
    const unread = items.filter(i => !i.read && !i.archived), snoozed = items.filter(i => i.read && !i.archived), past = items.filter(i => i.archived);
    fresh.replaceChildren(...unread.map(i => row(i, 'new')));
    later.replaceChildren(...snoozed.map(i => row(i, 'snoozed')));
    doneBtn.textContent = (showDone ? 'Hide' : 'Completed notifications') + ` · ${past.length}`;
    doneBtn.setAttribute('aria-expanded', String(showDone));
    doneList.replaceChildren(...(showDone ? past.slice(0, DONE_SHOWN).map(i => row(i, 'done')) : []));
    fresh.hidden = !unread.length; later.hidden = !snoozed.length; done.hidden = !past.length;
    sync();
  }
  function sync() {
    for (const [node, slot] of [[fresh, 'ready-top'], [later, 'ready-end'], [done, 'archive-top']]) {
      if (node.hidden) node.remove(); else api.slot.mount(slot, node);
    }
  }

  api.inbox.watch(next => { items = next; paint(); });
  // Done / Snooze / Restore / Resolve this in the chat window (buttons and keys) land here.
  api.inbox.threads({ act(action, id) {
    if (action === 'done') api.inbox.done(id);
    else if (action === 'snooze') api.inbox.set(id, { read: true });
    else if (action === 'restore') api.inbox.set(id, { archived: false, read: false });
    else if (action === 'resolve' && !api.inbox.reply(id, RESOLVE)) api.toast('Couldn’t start that chat here');
  } });
  // A reply (or Resolve this) that was actually sent finishes the notification: it lives on as that chat.
  api.on('sent', p => { const k = String(p?.reply || ''); if (k.startsWith('notifications:')) api.inbox.done(k.slice(14)); });
  api.on('render', sync); api.on('route', sync);
  return () => { showDone = false; };
}
