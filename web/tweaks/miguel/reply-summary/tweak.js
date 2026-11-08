// The view itself is CSS (--wos-reply-summary: on); the host removes it on teardown and Chats repaints without it.
// Its two options sit under its switch in Settings › Look, box-wide (api.replies; the reply's ⚙ sets the same length):
// "Short answers start collapsed" (on by default) and "Short answer length" (Two sentences by default).
export default function setup(api) {
  const R = api.replies; R.use();
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const wrap = el('div', 'rs-opts');
  const row = el('button', 'st-row tw-row'), tx = el('span', 'st-tx'), sw = el('span', 'sw'), note = el('small');
  row.type = 'button'; row.setAttribute('role', 'switch'); row.setAttribute('data-rsum-start', '');
  sw.setAttribute('aria-hidden', 'true'); sw.append(el('i'));
  tx.append(el('b', '', 'Short answers start collapsed'), note); row.append(tx, sw);
  const group = el('div', 'st-chats-options'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', 'Short answer length');
  const choices = R.lengths.map(l => {
    const b = el('button', 'st-row wz-row'), dot = el('span'), t = el('span', 'st-tx');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-rsum-length', l.id); dot.setAttribute('aria-hidden', 'true');
    t.append(el('b', '', l.name), el('small', '', l.hint)); b.append(dot, t); group.append(b);
    api.listen(b, 'click', () => { R.set({ length: l.id }); paint(); });
    return [l.id, b, dot];
  });
  wrap.append(row, el('h5', '', 'Short answer length'), group, el('p', 'st-hint', 'Applies to new replies; earlier ones keep theirs.'));
  function paint() {
    const s = R.summary(), on = s.start !== 'expanded';
    row.setAttribute('aria-checked', String(on)); sw.className = on ? 'sw on' : 'sw';
    note.textContent = on ? 'Long replies show their short answer; tap it for the full reply' : 'Long replies open in full; Show less folds them to the short answer';
    for (const [id, b, dot] of choices) { b.setAttribute('aria-checked', String(id === s.length)); dot.textContent = id === s.length ? '◉' : '○'; }
  }
  api.listen(row, 'click', () => { R.set({ start: R.summary().start === 'expanded' ? 'collapsed' : 'expanded' }); paint(); });
  api.listen(window, 'wos:prefs', paint);
  paint();
  api.settings.section('reply-summary', 'look', wrap);
  return () => {};
}
