/* Apps in Chats: installed apps that serve an inbox feed (Wizard OS inbox feed v1) put their "needs you" items (what
 * their badge counts) beside the notifications in Chats › Ready, as yellow rows wearing the app's mark. Opened, an item
 * shows the app's own buttons: Open (the app, at the item), each action the app declared (an ask goes to Wizard with
 * the item attached, like Resolve this; the rest run in the app), and Done, which is the app's own finishing action
 * when it has one ("done", else "read"), else the inbox's Done. Snooze / Resolve this / Restore stay with the
 * notifications package (wizard/unified-inbox), which this works with.
 * Settings › Notifications: one switch per app with a feed, "Show in Chats". Off = its items stay in the app with
 * its own badge (no row, no count here). The choice is saved on the box, so every device agrees.
 * Data and writes go through the host's inbox capability; text is only ever set with textContent. */
export default function setup(api) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  let items = [];
  const appItem = id => items.find(i => i.id === id && i.app) || null;
  const finOf = it => it.actions.find(a => a.id === 'done' && !a.ask && !a.input) || it.actions.find(a => a.id === 'read' && !a.ask && !a.input) || null;
  const where = it => it.appName || 'the app';
  const appAct = (it, d) => api.inbox.act(it.id, d.id).then(ok => { if (!ok) api.toast(`Couldn’t do “${d.label}” in ${where(it)}`); });

  // An app item's buttons and keys land here first; anything not handled goes on to the notifications package.
  api.inbox.feeds({ on: true, act(action, id) {
    const it = appItem(id); if (!it) return false;
    if (action === 'app') { if (!api.inbox.open(id)) api.toast(`Couldn’t open ${where(it)} here`); return true; }
    if (action.startsWith('x:')) {
      const d = it.actions.find(a => a.id === action.slice(2)); if (!d) return true;
      if (d.ask) { if (!api.inbox.reply(id, d.ask)) api.toast('Couldn’t start that chat here'); } else appAct(it, d);
      return true;
    }
    if (action === 'done' && finOf(it)) { appAct(it, finOf(it)); return true; }
    return false;
  } });

  // Settings › Notifications: which apps show in Chats.
  const box = el('div', 'st-group ai-sources'), rowsBox = el('div', 'ai-rows');
  box.append(el('h4', null, 'Show in Chats'), rowsBox, el('p', 'st-note', 'Apps you switch off keep their items and badge in the app.'));
  const busy = new Set();
  let rows = [], asked = 0;
  function row(r) {
    const b = el('button', 'st-row ai-row'); b.type = 'button'; b.dataset.aiApp = r.id;
    b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!r.chats)); b.setAttribute('aria-label', `Show ${r.name} in Chats`);
    if (busy.has(r.id)) b.disabled = true;
    const ic = el('span', 'st-ic ai-ic'); if (r.icon) ic.append(r.icon);
    const tx = el('span', 'st-tx'); tx.append(el('b', null, r.name));
    const sw = el('span', 'sw' + (r.chats ? ' on' : '')); sw.setAttribute('aria-hidden', 'true'); sw.append(el('i'));
    b.append(ic, tx, sw);
    api.listen(b, 'click', () => toggle(r.id));
    return b;
  }
  function paint() {
    rowsBox.replaceChildren(...(rows.length ? rows.map(row) : [el('div', 'st-empty', 'No apps with items for Chats yet.')]));
  }
  async function load() {
    const n = ++asked, next = await api.inbox.sources.list();
    if (n !== asked) return;
    rows = next; paint();
  }
  async function toggle(id) {
    const r = rows.find(x => x.id === id); if (!r || busy.has(id)) return;
    const want = !r.chats;
    busy.add(id); rows = rows.map(x => x.id === id ? { ...x, chats: want } : x); paint();
    const ok = await api.inbox.sources.set(id, { chats: want });
    busy.delete(id);
    if (!ok) { rows = rows.map(x => x.id === id ? { ...x, chats: !want } : x); api.toast(`Couldn’t save that for ${r.name}`); }
    paint(); load();
  }
  paint();
  api.settings.section('apps-in-chats', 'notifications', box);
  // Every inbox read also re-reads the choice, so a newly found feed or a change made on another device shows here.
  api.inbox.watch(next => { items = next; if (!busy.size) load(); });
  load();
  return () => { items = []; rows = []; busy.clear(); asked++; };
}
