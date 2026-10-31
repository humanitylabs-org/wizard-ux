/* Miguel's notifications in Chats: one package. It is the shared inbox (wizard/unified-inbox: yellow one-message
 * threads in Ready with Resolve this / Snooze / Done, completed ones under Archive) plus the apps' own items.
 * Installed apps that serve an inbox feed (Wizard OS inbox feed v1) put their "needs you" items (what their badge
 * counts) beside the notifications, wearing the app's mark. Opened, an item shows the app's own buttons: Open (the
 * app, at the item), each action the app declared (an ask goes to Wizard with the item attached, like Resolve this;
 * the rest run in the app), Done (the app's own finishing action when it has one, "done", else "read"), and one quiet
 * "Keep <App> in its app": from then on that app's items stay in the app with its own badge (saved on the box, so every
 * device agrees), with Undo in the toast. Under Archive, "Kept in their apps: <App>, …"; a tap on a name brings it back.
 * Catalog oneOf: this loads instead of wizard/unified-inbox, and that package's switch turns this one off and on.
 * Data and writes go through the host's inbox capability; text is only ever set with textContent. */
import shared from '../../wizard/unified-inbox/tweak.js';

export default function setup(api) {
  const stopShared = shared(api);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  let items = [], kept = [], asked = 0;
  const appItem = id => items.find(i => i.id === id && i.app) || null;
  const finOf = it => it.actions.find(a => a.id === 'done' && !a.ask && !a.input) || it.actions.find(a => a.id === 'read' && !a.ask && !a.input) || null;
  const where = it => it.appName || 'the app';
  const appAct = (it, d) => api.inbox.act(it.id, d.id).then(ok => { if (!ok) api.toast(`Couldn’t do “${d.label}” in ${where(it)}`); });

  // Keep an app's items in the app (chats: false), or bring them back to Chats.
  async function choose(app, name, chats) {
    const ok = await api.inbox.sources.set(app, { chats });
    if (!ok) { api.toast(chats ? `Couldn’t bring ${name} back` : `Couldn’t keep ${name} in its app`); return; }
    if (!chats) api.toast(`${name} stays in its app`, { action: 'Undo', run: () => choose(app, name, true) });
    else api.toast(`${name} is back in Chats`);
    load();
  }

  // An app item's buttons and keys land here first; anything not handled goes on to the shared inbox above.
  api.inbox.feeds({ on: true, keep: true, act(action, id) {
    const it = appItem(id); if (!it) return false;
    if (action === 'app') { if (!api.inbox.open(id)) api.toast(`Couldn’t open ${where(it)} here`); return true; }
    if (action === 'keep') { void choose(it.app, where(it), false); return true; }
    if (action.startsWith('x:')) {
      const d = it.actions.find(a => a.id === action.slice(2)); if (!d) return true;
      if (d.ask) { if (!api.inbox.reply(id, d.ask)) api.toast('Couldn’t start that chat here'); } else appAct(it, d);
      return true;
    }
    if (action === 'done' && finOf(it)) { appAct(it, finOf(it)); return true; }
    return false;
  } });

  // Under Archive, right after "Completed notifications": the apps kept in their apps, each a tap from coming back.
  const line = el('div', 'ai-kept'); line.setAttribute('role', 'group'); line.setAttribute('aria-label', 'Apps kept out of Chats');
  function paint() {
    if (!kept.length) { line.remove(); return; }
    const parts = [el('span', 'ai-kept-t', 'Kept in their apps: ')];
    kept.forEach((r, i) => {
      if (i) parts.push(document.createTextNode(', '));
      const b = el('button', 'ai-kept-app', r.name); b.type = 'button'; b.dataset.aiKept = r.id;
      b.setAttribute('aria-label', `Show ${r.name} in Chats again`); b.title = `Show ${r.name} in Chats again`;
      api.listen(b, 'click', () => { void choose(r.id, r.name, true); });
      parts.push(b);
    });
    line.replaceChildren(...parts);
    api.slot.mount('archive-top', line, 1);
  }
  async function load() {
    const n = ++asked, rows = await api.inbox.sources.list();
    if (n !== asked) return;
    kept = rows.filter(r => !r.chats); paint();
  }
  // Every inbox read also re-reads the choice (no extra request), so a change made on another device shows here.
  api.inbox.watch(next => { items = next; load(); });
  api.on('render', paint); api.on('route', paint);
  load();
  return () => { if (typeof stopShared === 'function') stopShared(); items = []; kept = []; asked++; };
}
