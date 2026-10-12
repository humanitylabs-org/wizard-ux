/* Wizard Topics sample: the shipped Topics templates (web/app.js: edition, sections, cards, topic rows, archive,
 * topic / item / day / follow sheets) over one disclosed sample edition. Topics, items and deep dives are written for
 * this preview: nothing is checked, followed, fetched or reported. Votes, cadence, pause and unfollow change this
 * page only. Back: reasons → sheet stack → Today → (root: the shell takes the step). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const VIEWS = ['today', 'following', 'archive'];
  const S = { view: 'today', stack: [], q: { following: '', archive: '' }, filter: 'all', openReasons: null };
  const GROUP_COL = { 'Hardware': ['#ffbe55', '#ff7a59'], 'Local & private AI': ['#4ff0b0', '#3fe0ff'], 'Agents & tools': ['#3fe0ff', '#8f63ff'], 'Big ideas': ['#ff5ccf', '#8f63ff'], 'One-off follows': ['#9aa3c7', '#6c6496'] };
  const EXAMPLES = ['Quiet fans for a small home server', 'Open-weight models small enough for a home box', 'Garden planning with index cards'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDay = d => new Date(d + 'T12:00:00+07:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  function md(text) {
    const inline = t => esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>');
    const out = []; let list = false;
    for (const raw of String(text).split('\n')) {
      const ln = raw.trimEnd(); let m;
      if ((m = ln.match(/^##\s+(.*)$/))) { if (list) { out.push('</ul>'); list = false; } out.push(`<h2>${inline(m[1])}</h2>`); }
      else if ((m = ln.match(/^\s*-\s+(.*)$/))) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(m[1])}</li>`); }
      else if (!ln.trim()) { if (list) { out.push('</ul>'); list = false; } }
      else { if (list) { out.push('</ul>'); list = false; } out.push(`<p>${inline(ln)}</p>`); }
    }
    if (list) out.push('</ul>');
    return out.join('');
  }

  /* ---------------- one disclosed sample edition ---------------- */
  const TOPICS = [
    { id: 'quiet-hw', short_title: 'Quiet home hardware', group: 'Hardware', status: 'active', cadence: 'daily', last_moved: 'Sample · moved in this edition', item_count: 3, gaps: [],
      why: 'Sample topic: a small server should be heard as little as a fridge.', known_state: 'Sample: slower, larger fans and a shelf with airflow beat clever fan curves.', report_when: ['A part or method that measurably lowers noise', 'A failure story worth learning from'],
      sources: [{ kind: 'forum', label: 'sample-forum.example', ok: true }, { kind: 'blog', label: 'quiet-builds.example', ok: true }] },
    { id: 'local-models', short_title: 'Small local models', group: 'Local & private AI', status: 'active', cadence: 'daily', last_moved: 'Sample · moved in this edition', item_count: 2, gaps: ['feed.example'],
      why: 'Sample topic: models that run on one home box, and what they are good for.', known_state: 'Sample: memory and disk speed decide the experience more than raw size.', report_when: ['A model that fits common home hardware', 'A real measurement, not a leaderboard screenshot'],
      sources: [{ kind: 'releases', label: 'releases.example', ok: true }, { kind: 'feed', label: 'feed.example', ok: false }] },
    { id: 'agent-patterns', short_title: 'Agent tooling patterns', group: 'Agents & tools', status: 'active', cadence: 'weekly', last_moved: 'Sample · quiet this week', item_count: 1, gaps: [],
      why: 'Sample topic: patterns that make tool-using assistants dependable.', known_state: 'Sample: small, checkable steps beat long autonomous runs.', report_when: ['A pattern with a before/after example'],
      sources: [{ kind: 'notes', label: 'patterns.example', ok: true }] },
    { id: 'reading', short_title: 'Reading habits', group: 'Big ideas', status: 'active', cadence: 'weekly', last_moved: '', item_count: 1, gaps: [],
      why: 'Sample topic: ways to read less and keep more.', known_state: '', report_when: ['A habit someone kept for a year'],
      sources: [{ kind: 'essays', label: 'essays.example', ok: null }] },
    { id: 'garden', short_title: 'Garden planning', group: 'One-off follows', status: 'paused', cadence: 'weekly', last_moved: '', item_count: 0, gaps: [],
      why: 'Sample topic, paused.', known_state: '', report_when: [], sources: [{ kind: 'blog', label: 'garden.example', ok: null }] },
  ];
  const DIVE_FAN = `## Sample deep dive
This deep dive was written for the Wizard OS preview. It reads like the real thing but checks nothing.
## What the item says
- Bigger, slower fans move the same air with less noise.
- A shelf with a gap behind it matters more than the fan curve.
## One move
**Measure first:** note the noise at one metre today, then change one thing at a time.`;
  const DIVE_MODEL = `## Sample deep dive
Written for the preview, not researched.
## Why the disk mattered
- Loading a model reads gigabytes at once; a slow disk makes every first answer slow.
- Once loaded, memory, not storage, sets the pace.
## One move
**Keep models on the fastest drive**, and keep only the two you actually use.`;
  const I = (key, topic, day, title, body, host, extra = {}) => ({ key, topic, day, title, body, host, vote: null, reason: null, dive: null, ...extra, topic_title: TOPICS.find(t => t.id === topic).short_title });
  const ITEMS = [
    I('i1', 'quiet-hw', '2026-10-12', 'Sample: a quieter shelf beats a quieter fan', 'An invented write-up comparing three ways to cool a small server: bigger fans, a gap behind the shelf, and a fan curve. The shelf wins.', 'sample-forum.example', { dive: DIVE_FAN }),
    I('i2', 'quiet-hw', '2026-10-12', 'Sample: rubber feet, measured', 'A made-up measurement of vibration noise before and after soft feet. Small, real-feeling difference; still only a sample.', 'quiet-builds.example'),
    I('i3', 'local-models', '2026-10-12', 'Sample: the slow part was the disk', 'An invented note on running a small model at home: first answers were slow because loading read from a slow drive.', 'releases.example', { dive: DIVE_MODEL }),
    I('i4', 'local-models', '2026-10-11', 'Sample: one box, two models, clear roles', 'A sample pattern: keep one small fast model for quick tasks and one larger model for slower, careful ones.', 'releases.example'),
    I('i5', 'agent-patterns', '2026-10-11', 'Sample: write the check before the step', 'An invented pattern note: each tool step states how it will be checked before it runs.', 'patterns.example'),
    I('i6', 'quiet-hw', '2026-10-10', 'Sample: the fridge test', 'A sample rule of thumb: if you can hear the server over the fridge, fix airflow first.', 'sample-forum.example'),
    I('i7', 'reading', '2026-10-10', 'Sample: reread the summary, not the article', 'An invented habit: save only what you would reread as a summary next month.', 'essays.example'),
  ];
  const EDITIONS = [
    { day: '2026-10-12', topics: [{ topic: 'quiet-hw', title: 'Quiet home hardware', progression: 'Sample: airflow keeps winning over fan tricks.', items: ['i1', 'i2'] }, { topic: 'local-models', title: 'Small local models', progression: '', items: ['i3'] }] },
    { day: '2026-10-11', topics: [{ topic: 'local-models', title: 'Small local models', items: ['i4'] }, { topic: 'agent-patterns', title: 'Agent tooling patterns', items: ['i5'] }] },
    { day: '2026-10-10', topics: [{ topic: 'quiet-hw', title: 'Quiet home hardware', items: ['i6'] }, { topic: 'reading', title: 'Reading habits', items: ['i7'] }] },
  ];
  const REASONS = { offtopic: 'Off topic', old: 'Not new to me', shallow: 'Too shallow' };
  const topicById = id => TOPICS.find(t => t.id === id);
  const itemBy = key => ITEMS.find(i => i.key === key);
  const counts = () => ({ active: TOPICS.filter(t => t.status === 'active').length, paused: TOPICS.filter(t => t.status === 'paused').length });

  /* ---------------- render (shipped templates) ---------------- */
  function renderAll() {
    const c = counts();
    $('#meta').innerHTML = `${c.active} followed${c.paused ? ` · ${c.paused} paused` : ''}<br>Sample · read-only`;
    renderToday(); renderFollowing(); renderArchive();
    renderSheet();
  }
  function card(it, opts = {}) {
    const up = it.vote === 'up', down = it.vote === 'down';
    const reasons = reasonsHtml(it);
    return `<article class="card" data-key="${it.key}" data-topic="${it.topic}">
      <div class="src">${opts.topic ? `<span class="topic">${esc(it.topic_title)}</span> ·` : ''}<span>${esc(it.host)}</span>${opts.day ? ` · <span>${fmtDay(it.day)}</span>` : ''}</div>
      <h3><span>${esc(it.title)}</span></h3>
      <p>${esc(it.body)}</p>
      <div class="acts">
        <button data-act="up" class="${up ? 'on-up' : ''}" aria-label="Useful" aria-pressed="${up}">${up ? '▲' : '△'} Useful</button>
        <button data-act="down" class="${down ? 'on-down' : ''}" aria-label="Not useful" aria-pressed="${down}">${down ? '▼' : '▽'}</button>
        <button data-act="dive" class="dive ${it.dive ? 'ready' : ''}">${it.dive ? 'Read deep dive ›' : 'Details ›'}</button>
      </div>${reasons}
    </article>`;
  }
  // Open reasons carry .open so the shell's Back signature sees them close.
  const reasonsHtml = it => S.openReasons === it.key ? `<div class="reasons open">${Object.entries(REASONS).map(([k, v]) => `<button class="chip ${it.reason === k ? 'on' : ''}" data-act="reason" data-r="${k}">${esc(v)}</button>`).join('')}</div>` : '';
  function section(sec) {
    return `<div class="sec"><button class="sec-h" data-act="topic" data-id="${sec.topic}"><span class="name">${esc(sec.title)}</span><span class="go">›</span></button>${sec.progression ? `<p class="prog">${esc(sec.progression)}</p>` : ''}${sec.items.map(k => card(itemBy(k))).join('')}</div>`;
  }
  function editionHTML(ed, kicker) {
    const n = ed.topics.reduce((a, s) => a + s.items.length, 0);
    return `<div class="ed-head"><div class="kicker">${kicker}</div><h2>${fmtDay(ed.day)}</h2><p>${ed.topics.length} of ${counts().active} sample topics moved · ${n} item${n === 1 ? '' : 's'}</p></div>${ed.topics.map(section).join('')}`;
  }
  function renderToday() {
    const ed = EDITIONS[0];
    $('#v-today').innerHTML = editionHTML(ed, 'Sample edition') +
      `<p class="quiet">${Math.max(0, counts().active - ed.topics.length)} topics quiet. Written for the Wizard OS preview: no topic is checked, nothing here is news.</p>` +
      `<div class="earlier"><h4>Earlier sample editions</h4>${EDITIONS.slice(1).map(e => `<button class="day-row" data-act="day" data-day="${e.day}"><span class="d">${fmtDay(e.day)}</span><span class="n">${e.topics.length} topics · ${e.topics.reduce((a, s) => a + s.items.length, 0)} items ›</span></button>`).join('')}</div>`;
  }
  function topicRow(t) {
    const [a, b] = GROUP_COL[t.group] || ['#9aa3c7', '#6c6496'];
    const initials = t.short_title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const moved = t.last_moved ? `<span class="hot">${esc(t.last_moved)}</span> · ${t.item_count} item${t.item_count === 1 ? '' : 's'}` : 'Quiet so far';
    const status = t.status !== 'active' ? `<span class="badge">${t.status}</span>` : t.gaps.length ? `<span class="badge warn">${t.gaps.length} source down</span>` : `<span class="badge">${t.cadence}</span>`;
    return `<button class="trow ${t.status !== 'active' ? 'off' : ''}" data-act="topic" data-id="${t.id}"><span class="ic" style="background:linear-gradient(135deg,${a},${b})">${esc(initials)}</span><span class="tx"><div class="t">${esc(t.short_title)}</div><div class="s">${moved}</div></span>${status}</button>`;
  }
  function renderFollowing() {
    const el = $('#v-following'), q = S.q.following.trim().toLowerCase();
    const hit = t => !q || [t.short_title, t.why, t.group].join(' ').toLowerCase().includes(q);
    const ts = TOPICS.filter(hit), groups = {};
    for (const t of ts.filter(t => t.status === 'active')) (groups[t.group] = groups[t.group] || []).push(t);
    const paused = ts.filter(t => t.status === 'paused'), gone = ts.filter(t => t.status === 'unfollowed');
    const keep = document.activeElement?.id === 'fq';
    el.innerHTML = `<label class="search"><span aria-hidden="true">⌕</span><input id="fq" placeholder="Search ${counts().active} sample topics" value="${esc(S.q.following)}" autocomplete="off" aria-label="Search sample topics"></label>` +
      Object.entries(groups).map(([g, list]) => `<div class="grp-h">${esc(g)} · ${list.length}</div>${list.map(topicRow).join('')}`).join('') +
      (paused.length ? `<div class="grp-h">Paused · ${paused.length}</div>${paused.map(topicRow).join('')}` : '') +
      (gone.length ? `<details ${q ? 'open' : ''}><summary>Unfollowed · ${gone.length}</summary>${gone.map(topicRow).join('')}</details>` : '') +
      (!ts.length ? `<div class="empty">No sample topic matches “${esc(S.q.following)}”.</div>` : '');
    const inp = $('#fq'); inp.addEventListener('input', () => { S.q.following = inp.value; renderFollowing(); });
    if (keep) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  function renderArchive() {
    const el = $('#v-archive'), q = S.q.archive.trim().toLowerCase();
    let its = ITEMS;
    if (S.filter === 'liked') its = its.filter(i => i.vote === 'up');
    if (S.filter === 'dives') its = its.filter(i => i.dive);
    if (q) its = its.filter(i => [i.title, i.body, i.topic_title, i.host].join(' ').toLowerCase().includes(q));
    const keep = document.activeElement?.id === 'aq';
    let html = `<label class="search"><span aria-hidden="true">⌕</span><input id="aq" placeholder="Search ${ITEMS.length} sample items" value="${esc(S.q.archive)}" autocomplete="off" aria-label="Search sample items"></label><div class="reasons">${[['all', 'All'], ['liked', 'Useful'], ['dives', 'Deep dives']].map(([k, v]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}" aria-pressed="${S.filter === k}">${v}</button>`).join('')}</div>`;
    let day = null;
    for (const it of its) { if (it.day !== day) { day = it.day; html += `<div class="grp-h">${fmtDay(day)}</div>`; } html += card(it, { topic: true }); }
    if (!its.length) html += '<div class="empty">Nothing here yet.</div>';
    el.innerHTML = html;
    const inp = $('#aq'); inp.addEventListener('input', () => { S.q.archive = inp.value; renderArchive(); });
    if (keep) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }

  /* ---------------- sheets ---------------- */
  const titleOf = e => !e ? '' : e.type === 'topic' ? topicById(e.id)?.short_title : e.type === 'item' ? 'report' : e.type === 'day' ? fmtDay(e.day) : 'Follow';
  function renderSheet() {
    const top = S.stack[S.stack.length - 1], sheet = $('#sheet'), scrim = $('#scrim');
    if (!top) { sheet.hidden = true; scrim.hidden = true; sheet.innerHTML = ''; sheet.removeAttribute('role'); sheet.removeAttribute('aria-modal'); return; }
    sheet.hidden = false; scrim.hidden = false; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', titleOf(top));
    const below = S.stack[S.stack.length - 2];
    const back = `<div class="grab"></div><div class="sheet-top"><button class="back" data-act="back" aria-label="${below ? `Back to ${esc(titleOf(below))}` : 'Close'}">‹ ${below ? 'Back' : 'Close'}</button></div>`;
    const keepScroll = sheet.dataset.sig === JSON.stringify(top) ? sheet.scrollTop : 0;
    let html = '';
    if (top.type === 'topic') html = topicSheet(top.id);
    else if (top.type === 'item') html = itemSheet(top.key);
    else if (top.type === 'day') { const ed = EDITIONS.find(e => e.day === top.day); html = ed ? editionHTML(ed, 'Sample edition') : '<div class="empty">Edition not found.</div>'; }
    else if (top.type === 'follow') html = followSheet(top.text);
    const ta = $('#fin'), draft = ta ? ta.value : null;
    sheet.innerHTML = back + html;
    sheet.dataset.sig = JSON.stringify(top); sheet.scrollTop = keepScroll;
    const nta = $('#fin'); if (nta && draft !== null) nta.value = draft;
  }
  function topicSheet(id) {
    const t = topicById(id); if (!t) return '<div class="empty">Topic not found.</div>';
    const items = ITEMS.filter(i => i.topic === id);
    const toggle = t.status === 'active' ? '<button class="btn" data-act="status" data-s="paused">Pause</button>' : `<button class="btn" data-act="status" data-s="active">${t.status === 'paused' ? 'Resume' : 'Follow again'}</button>`;
    return `<h2>${esc(t.short_title)}<span class="statuspill ${t.status}">${t.status === 'active' ? 'following' : t.status}</span></h2>
      <div class="sub">${esc(t.group)} · sample topic · never checked</div>
      <div class="ctrls"><div class="seg">${['daily', 'weekly'].map(c => `<button class="${t.cadence === c ? 'on' : ''}" data-act="cadence" data-c="${c}" aria-pressed="${t.cadence === c}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>
        <button class="btn" disabled title="Sample only">Check now · sample only</button>${toggle}${t.status !== 'unfollowed' ? '<button class="btn danger" data-act="status" data-s="unfollowed">Unfollow</button>' : ''}</div>
      <h5>Why you follow it</h5><p class="lead">${esc(t.why)}</p>
      ${t.known_state ? `<h5>What we know so far</h5><p class="lead">${esc(t.known_state)}</p>` : ''}
      ${t.report_when.length ? `<details><summary>What counts as news (${t.report_when.length})</summary><ul class="plain">${t.report_when.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
      <h5>Reported · ${items.length}</h5>
      ${items.length ? items.map(i => card(i, { day: true })).join('') : '<p class="lead">Nothing reported in this sample.</p>'}
      <h5>Sources · ${t.sources.length}${t.gaps.length ? ` · ${t.gaps.length} down (sample)` : ''}</h5>
      ${t.sources.map(s => `<div class="srcrow"><span class="hd ${s.ok === true ? 'ok' : s.ok === false ? 'bad' : ''}"></span><span class="k">${esc(s.kind)}</span><span class="l">${esc(s.label)}</span></div>`).join('')}`;
  }
  function itemSheet(key) {
    const it = itemBy(key); if (!it) return '<div class="empty">Item not found.</div>';
    const dive = it.dive ? `<div class="md">${md(it.dive)}</div>` : '<p class="lead">Deep dives can’t be started in this sample. Two sample items have one ready: look for “Read deep dive”.</p>';
    return `<div class="sub"><button class="topic-link" data-act="topic" data-id="${it.topic}">${esc(it.topic_title)} ›</button> · ${fmtDay(it.day)}</div>
      <h2>${esc(it.title)}</h2>
      <span class="host">${esc(it.host)} · sample, no link</span>
      <p class="lead" style="margin-top:10px">${esc(it.body)}</p>
      <div class="card" style="background:none;border:0;padding:0;cursor:default" data-key="${it.key}" data-topic="${it.topic}"><div class="acts"><button data-act="up" class="${it.vote === 'up' ? 'on-up' : ''}" aria-label="Useful" aria-pressed="${it.vote === 'up'}">${it.vote === 'up' ? '▲' : '△'} Useful</button><button data-act="down" class="${it.vote === 'down' ? 'on-down' : ''}" aria-label="Not useful" aria-pressed="${it.vote === 'down'}">${it.vote === 'down' ? '▼' : '▽'}</button></div>${reasonsHtml(it)}</div>
      <div class="dive-box">${dive}</div>`;
  }
  function followSheet(text) {
    return `<h2>Follow a topic</h2>
      <p class="lead">In the real app you say it like you’d say it to Wizard, and it finds and verifies primary sources. In this sample, following is off.</p>
      <textarea id="fin" class="follow-in" aria-label="Topic to follow (sample only)" placeholder="e.g. Quiet fans for a small home server">${esc(text || '')}</textarea>
      <div class="reasons">${EXAMPLES.map(e => `<button class="chip" data-act="example">${esc(e)}</button>`).join('')}</div>
      <div class="ctrls"><button class="btn primary" disabled>Follow · sample only</button></div>
      <p class="hint">Nothing is set up, searched or sent from this preview.</p>`;
  }

  /* ---------------- actions ---------------- */
  function push(entry) { const top = S.stack[S.stack.length - 1]; if (top && JSON.stringify(top) === JSON.stringify(entry)) return; S.stack.push(entry); S.openReasons = null; renderSheet(); }
  function pop() { S.stack.pop(); renderSheet(); }
  function vote(it, v) { const next = it.vote === v ? null : v; it.vote = next; if (next !== 'down') it.reason = null; S.openReasons = next === 'down' ? it.key : null; renderAll(); }
  function setTopic(id, patch, undo) { const t = topicById(id); const prev = { ...t }; Object.assign(t, patch); renderAll(); if (undo) toast(undo, 'Undo', () => { Object.assign(t, { status: prev.status }); renderAll(); }); }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'), cardEl = e.target.closest('.card[data-key]');
    if (!a) {
      if (cardEl && cardEl.closest('.pane, .sheet') && cardEl.style.cursor !== 'default') { const top = S.stack.at(-1); if (!(top && top.type === 'item' && top.key === cardEl.dataset.key)) push({ type: 'item', key: cardEl.dataset.key }); }
      if (e.target.id === 'scrim') back();
      return;
    }
    if (a.disabled) return;
    const it = cardEl ? itemBy(cardEl.dataset.key) : null, curTopic = S.stack.at(-1)?.type === 'topic' ? S.stack.at(-1).id : null;
    switch (a.dataset.act) {
      case 'back': back(); break;
      case 'topic': push({ type: 'topic', id: a.dataset.id }); break;
      case 'day': push({ type: 'day', day: a.dataset.day }); break;
      case 'up': if (it) vote(it, 'up'); break;
      case 'down': if (it) vote(it, 'down'); break;
      case 'reason': if (it) { it.reason = it.reason === a.dataset.r ? null : a.dataset.r; S.openReasons = null; renderAll(); toast('Thanks (this page only).'); } break;
      case 'dive': if (it) push({ type: 'item', key: it.key }); break;
      case 'filter': S.filter = a.dataset.f; renderArchive(); break;
      case 'cadence': if (curTopic) setTopic(curTopic, { cadence: a.dataset.c }); break;
      case 'status': if (curTopic) { const t = topicById(curTopic), s = a.dataset.s; if (s === 'unfollowed') { pop(); setTopic(curTopic, { status: s }, `Unfollowed ${t.short_title} (this page only)`); } else setTopic(curTopic, { status: s }, s === 'paused' ? `Paused ${t.short_title} (this page only)` : null); } break;
      case 'example': { const ta = $('#fin'); if (ta) { ta.value = a.textContent; ta.focus(); } } break;
    }
  });
  $('#fab').addEventListener('click', () => push({ type: 'follow', text: '' }));

  /* ---------------- views & tabs ---------------- */
  function setView(v) {
    if (!VIEWS.includes(v)) v = 'today';
    S.view = v; document.body.dataset.view = v;
    $('#pager').style.transform = `translateX(${-100 * VIEWS.indexOf(v)}%)`;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $('#viewName').textContent = ' · ' + v[0].toUpperCase() + v.slice(1);
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { if (S.view === b.dataset.view) $('#v-' + S.view).scrollTo({ top: 0, behavior: 'smooth' }); setView(b.dataset.view); }));
  let sx = null, sy = null;
  $('#pager').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('#pager').addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) { const i = VIEWS.indexOf(S.view) + (dx < 0 ? 1 : -1); if (VIEWS[i]) setView(VIEWS[i]); }
  }, { passive: true });

  /* ---------------- toast ---------------- */
  let toastT = null;
  function toast(msg, label, fn) {
    const t = $('#toast'); t.hidden = false;
    t.innerHTML = `<span>${esc(msg)}</span>${label ? `<button>${esc(label)}</button>` : ''}`;
    if (label) t.querySelector('button').onclick = () => { t.hidden = true; fn && fn(); };
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, label ? 6000 : 2600);
  }

  /* ---------------- Back (shipped onBack, minus the root warning the harness owns) ---------------- */
  function back() {
    if (S.openReasons) { S.openReasons = null; renderAll(); return true; }
    if (S.stack.length) { pop(); return true; }
    if (S.view !== 'today') { setView('today'); return true; }
    return false;
  }

  window.WzFixture?.init({ back, toast: m => toast(m) });
  setView('today'); renderAll();
})();
