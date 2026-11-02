'use strict';
// Synthetic test view for the Notifications data path; not the migrated Notifications app UI (card 2).
const list = document.querySelector('#items'), status = document.querySelector('#status');
const say = text => { status.textContent = text; };
function row(item) {
  const li = document.createElement('li'); li.dataset.id = item.id; li.dataset.read = String(item.read);
  const title = document.createElement('strong'); title.textContent = item.title;
  const state = document.createElement('span'); state.className = 'state'; state.textContent = item.read ? 'Read' : 'Unread';
  li.append(title, ' ', state);
  if (!item.read) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wz-button'; b.textContent = 'Mark read';
    b.addEventListener('pointerdown', () => b.classList.add('pressed'));   // same-frame tap feedback
    b.addEventListener('click', () => markRead(item, b, state));
    li.append(' ', b);
  }
  return li;
}
async function load() {
  const result = await WizardApp.data.call({ operation: 'notifications.list', args: { limit: 20, cursor: null } });
  list.replaceChildren(...result.items.map(row));
  say('Loaded ' + result.items.length + ' notifications');
}
async function markRead(item, button, state) {
  button.disabled = true; state.textContent = 'Saving…';
  const operationKey = crypto.randomUUID();
  try {
    const saved = await WizardApp.data.call({ operation: 'notifications.mark_read', args: { id: item.id, expectedRevision: item.revision }, operationKey });
    item.read = saved.read; item.revision = saved.revision;
    state.textContent = 'Read'; button.remove(); button.closest('li')?.setAttribute('data-read', 'true');
    say('Saved: ' + item.id);
  } catch (e) {
    // Never claim a save we cannot prove; an unknown outcome is reconciled by its key.
    if (e.code === 'outcome_unknown') {
      const s = await WizardApp.data.status({ operation: 'notifications.mark_read', operationKey }).catch(x => ({ status: x.code }));
      say('Outcome ' + s.status + ' for ' + item.id);
    } else say('Not saved (' + e.code + ')');
    state.textContent = item.read ? 'Read' : 'Unread'; button.disabled = false; button.classList.remove('pressed');
  }
}
window.qaReload = () => load().catch(e => say('Unavailable: ' + e.code));
if (window.WizBoundaryClient?.ready) window.qaReload(); else addEventListener('wizard:boundary:connected', window.qaReload, { once: true });
