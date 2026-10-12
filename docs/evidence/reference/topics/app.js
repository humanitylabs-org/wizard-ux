/* Wizard Topics — the topics James follows: today's edition, what's followed, the archive, follow / deep dive. */
(() => {
  'use strict'
  const $ = (s, r = document) => r.querySelector(s)
  const BASE = location.pathname.replace(/[^/]*$/, '')
  const VIEWS = ['today', 'following', 'archive']
  const S = { data: null, view: 'today', stack: [], warnAt: 0, dives: {}, jobState: {}, q: { following: '', archive: '' }, filter: 'all', openReasons: null }
  const GROUP_COL = {
    'Agents & Hermes': ['#3fe0ff', '#8f63ff'], 'Local & private AI': ['#4ff0b0', '#3fe0ff'], 'Wizard product': ['#b99bff', '#ff5ccf'],
    Hardware: ['#ffbe55', '#ff7a59'], Business: ['#ffd36e', '#4ff0b0'], 'Big ideas': ['#ff5ccf', '#8f63ff'], 'One-off follows': ['#9aa3c7', '#6c6496']
  }
  const EXAMPLES = ['Claude Code releases that change agent workflows', 'Bangkok AI events and meetups', 'Open-weight models small enough for a home box']

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const bkkToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
  const fmtDay = (d) => new Date(d + 'T12:00:00+07:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })
  function ago (iso) {
    if (!iso) return ''
    const s = (Date.now() - new Date(iso).getTime()) / 1000
    if (s < 90) return 'just now'
    if (s < 3600) return Math.round(s / 60) + 'm ago'
    if (s < 86400) return Math.round(s / 3600) + 'h ago'
    const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + 'd ago'
  }
  function md (text) {
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    const out = []; let list = null
    const close = () => { if (list) { out.push(`</${list}>`); list = null } }
    for (const raw of String(text || '').split('\n')) {
      const ln = raw.trimEnd()
      let m
      if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) { close(); out.push(`<h${m[1].length < 3 ? 2 : 3}>${inline(m[2])}</h${m[1].length < 3 ? 2 : 3}>`) } else if ((m = ln.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul' } out.push(`<li>${inline(m[1])}</li>`) } else if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol' } out.push(`<li>${inline(m[1])}</li>`) } else if (!ln.trim()) close()
      else { close(); out.push(`<p>${inline(ln)}</p>`) }
    }
    close(); return out.join('')
  }

  // ---------- data ----------
  const api = async (path, body) => {
    const r = await fetch(BASE + 'api/' + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || r.status)
    return j
  }
  const topicById = (id) => S.data?.topics.find((t) => t.id === id)
  const itemBy = (key, topic) => S.data?.items.find((i) => i.key === key && (!topic || i.topic === topic))
  const activeJobs = () => (S.data?.jobs || []).filter((j) => j.status === 'queued' || j.status === 'running')

  let pollT = null
  async function load () {
    clearTimeout(pollT)
    try {
      const d = await api('state')
      const prev = S.jobState; S.jobState = {}
      for (const j of d.jobs) {
        S.jobState[j.id] = j.status
        if (prev[j.id] && prev[j.id] !== j.status && (j.status === 'done' || j.status === 'failed')) onJobFinished(j, d)
      }
      S.data = d; renderAll()
    } catch (err) {
      if (!S.data) $('#v-today').innerHTML = `<div class="empty">Couldn't load topics: ${esc(err.message)}</div>`
    }
    pollT = setTimeout(() => { if (document.visibilityState === 'visible') load(); else pollT = setTimeout(load, 5000) }, activeJobs().length ? 4000 : 45000)
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load() })

  function onJobFinished (j, d) {
    if (j.kind === 'dive' && j.status === 'done') {
      delete S.dives[j.key]
      toast('Deep dive ready', 'Open', () => { const it = d.items.find((i) => i.key === j.key); if (it) push({ type: 'item', key: it.key, topic: it.topic }) })
    } else if (j.kind === 'follow' && j.status === 'done') {
      const id = j.result?.id
      toast(`${j.result?.action === 'extended' ? 'Extended' : 'Now following'} ${j.result?.short_title || id}`, 'Open', () => push({ type: 'topic', id }))
    } else if (j.kind === 'check' && j.status === 'done') {
      const n = j.result?.new || 0
      toast(n ? `${j.label}: ${n} new` : `${j.label}: nothing new`, n ? 'Open' : '', () => push({ type: 'topic', id: j.topic }))
    } else if (j.status === 'failed') {
      toast(`${j.kind === 'follow' ? 'Follow' : j.kind === 'dive' ? 'Deep dive' : 'Check'} failed: ${String(j.error || '').slice(0, 80)}`)
    }
  }

  // ---------- render ----------
  function renderAll () {
    if (!S.data) return
    const c = S.data.counts
    const ed = S.data.editions[0]
    $('#meta').innerHTML = `${c.active} followed${c.paused ? ` · ${c.paused} paused` : ''}<br>$${S.data.cost_week.toFixed(2)} this week`
    renderJobs(); renderToday(); renderFollowing(); renderArchive()
    if (S.stack.length) renderSheet()
    void ed
  }

  function renderJobs () {
    const js = activeJobs()
    const box = $('#jobs'); box.hidden = !js.length; document.body.classList.toggle('has-jobs', !!js.length)
    const verb = { follow: 'Setting up', dive: 'Deep dive', check: 'Checking' }
    box.innerHTML = js.slice(0, 2).map((j) => `<div class="job"><span class="spin"></span><span>${verb[j.kind]}</span><b>${esc(j.label)}</b></div>`).join('')
  }

  function card (it, opts = {}) {
    const up = it.vote === 'up'; const down = it.vote === 'down'
    const diving = (S.data.jobs || []).some((j) => j.kind === 'dive' && j.key === it.key && (j.status === 'queued' || j.status === 'running'))
    const reasons = S.openReasons === it.key + ':' + it.topic
      ? `<div class="reasons">${Object.entries(S.data.reasons).filter(([k]) => k !== 'more').map(([k, v]) => `<button class="chip ${it.reason === k ? 'on' : ''}" data-act="reason" data-r="${k}">${esc(v)}</button>`).join('')}</div>`
      : ''
    return `<article class="card" data-key="${it.key}" data-topic="${it.topic}">
      <div class="src">${opts.topic ? `<span class="topic">${esc(it.topic_title)}</span> ·` : ''}<span>${esc(it.host)}</span>${opts.day ? ` · <span>${fmtDay(it.day)}</span>` : ''}</div>
      <h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      <p>${esc(it.body)}</p>
      <div class="acts">
        <button data-act="up" class="${up ? 'on-up' : ''}" aria-label="Useful">${up ? '▲' : '△'} Useful</button>
        <button data-act="down" class="${down ? 'on-down' : ''}" aria-label="Not useful">${down ? '▼' : '▽'}</button>
        <button data-act="dive" class="dive ${it.dive ? 'ready' : ''}">${it.dive ? 'Read deep dive ›' : diving ? '<span class="spin"></span> Diving…' : 'Deep dive ›'}</button>
      </div>${reasons}
    </article>`
  }

  function section (sec, items) {
    const t = topicById(sec.topic)
    return `<div class="sec">
      <button class="sec-h" data-act="topic" data-id="${sec.topic}"><span class="name">${esc(sec.title)}</span><span class="go">›</span></button>
      ${sec.progression ? `<p class="prog">${esc(sec.progression)}</p>` : ''}
      ${items.map((it) => card(it)).join('')}
    </div>`
  }
  const edItems = (sec) => sec.items.map((k) => { const [key, topic] = k.split(':'); return itemBy(key, topic) }).filter(Boolean)

  function editionHTML (ed, kicker) {
    const active = S.data.counts.active
    return `<div class="ed-head"><div class="kicker">${kicker}</div><h2>${fmtDay(ed.day)}</h2>
      <p>${ed.topics.length} of ${active} topics moved · ${ed.count} item${ed.count === 1 ? '' : 's'}</p></div>
      ${ed.topics.map((sec) => section(sec, edItems(sec))).join('')}`
  }

  function renderToday () {
    const eds = S.data.editions
    const el = $('#v-today')
    if (!eds.length) { el.innerHTML = '<div class="empty">Nothing has moved yet. The first edition lands at 08:00 Bangkok.</div>'; return }
    const ed = eds[0]; const isToday = ed.day === bkkToday()
    el.innerHTML = editionHTML(ed, isToday ? "Today's edition" : 'Latest edition') +
      `<p class="quiet">${Math.max(0, S.data.counts.active - ed.topics.length)} topics quiet${isToday ? '' : ' · next edition 08:00 Bangkok'}.</p>` +
      (eds.length > 1 ? `<div class="earlier"><h4>Earlier editions</h4>${eds.slice(1, 10).map((e) => `<button class="day-row" data-act="day" data-day="${e.day}"><span class="d">${fmtDay(e.day)}</span><span class="n">${e.topics.length} topics · ${e.count} items ›</span></button>`).join('')}</div>` : '')
  }

  function topicRow (t) {
    const [a, b] = GROUP_COL[t.group] || ['#9aa3c7', '#6c6496']
    const initials = t.short_title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    const moved = t.last_moved ? `<span class="${(Date.now() - new Date(t.last_moved)) < 36e5 * 30 ? 'hot' : ''}">Moved ${ago(t.last_moved)}</span> · ${t.item_count} item${t.item_count === 1 ? '' : 's'}` : 'Quiet so far'
    const status = t.status !== 'active' ? `<span class="badge">${t.status}</span>` : t.gaps.length ? `<span class="badge warn">${t.gaps.length} source${t.gaps.length > 1 ? 's' : ''} down</span>` : `<span class="badge">${t.cadence}</span>`
    return `<button class="trow ${t.status !== 'active' ? 'off' : ''}" data-act="topic" data-id="${t.id}">
      <span class="ic" style="background:linear-gradient(135deg,${a},${b})">${esc(initials || '◇')}</span>
      <span class="tx"><div class="t">${esc(t.short_title)}</div><div class="s">${moved}</div></span>${status}</button>`
  }

  function renderFollowing () {
    const el = $('#v-following')
    const q = S.q.following.trim().toLowerCase()
    const hit = (t) => !q || [t.short_title, t.title, t.why, t.group].join(' ').toLowerCase().includes(q)
    const ts = S.data.topics.filter(hit)
    const groups = {}
    for (const t of ts.filter((t) => t.status === 'active')) (groups[t.group] = groups[t.group] || []).push(t)
    const paused = ts.filter((t) => t.status === 'paused'); const gone = ts.filter((t) => t.status === 'unfollowed')
    const keep = document.activeElement?.id === 'fq'
    el.innerHTML = `<label class="search"><span>⌕</span><input id="fq" placeholder="Search ${S.data.counts.active} topics" value="${esc(S.q.following)}" autocomplete="off"></label>` +
      Object.entries(groups).map(([g, list]) => `<div class="grp-h">${esc(g)} · ${list.length}</div>${list.map(topicRow).join('')}`).join('') +
      (paused.length ? `<div class="grp-h">Paused · ${paused.length}</div>${paused.map(topicRow).join('')}` : '') +
      (gone.length ? `<details ${q ? 'open' : ''}><summary>Unfollowed · ${gone.length}</summary>${gone.map(topicRow).join('')}</details>` : '') +
      (!ts.length ? `<div class="empty">No topic matches “${esc(S.q.following)}”.<br><br><button class="btn primary" data-act="follow" data-text="${esc(S.q.following)}">Follow “${esc(S.q.following)}”</button></div>` : '')
    const inp = $('#fq'); inp.addEventListener('input', () => { S.q.following = inp.value; renderFollowing() })
    if (keep) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
  }

  function renderArchive () {
    const el = $('#v-archive')
    const q = S.q.archive.trim().toLowerCase()
    let its = S.data.items
    if (S.filter === 'liked') its = its.filter((i) => i.vote === 'up')
    if (S.filter === 'dives') its = its.filter((i) => i.dive)
    if (q) its = its.filter((i) => [i.title, i.body, i.topic_title, i.host].join(' ').toLowerCase().includes(q))
    const keep = document.activeElement?.id === 'aq'
    let html = `<label class="search"><span>⌕</span><input id="aq" placeholder="Search ${S.data.items.length} reported items" value="${esc(S.q.archive)}" autocomplete="off"></label>
      <div class="reasons">${[['all', 'All'], ['liked', 'Useful'], ['dives', 'Deep dives']].map(([k, v]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${v}</button>`).join('')}</div>`
    let day = null
    for (const it of its) {
      if (it.day !== day) { day = it.day; html += `<div class="grp-h">${fmtDay(day)}</div>` }
      html += card(it, { topic: true })
    }
    if (!its.length) html += '<div class="empty">Nothing here yet.</div>'
    el.innerHTML = html
    const inp = $('#aq'); inp.addEventListener('input', () => { S.q.archive = inp.value; renderArchive() })
    if (keep) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
  }

  // ---------- sheets ----------
  function renderSheet () {
    const top = S.stack[S.stack.length - 1]
    const sheet = $('#sheet'); const scrim = $('#scrim')
    if (!top) { sheet.hidden = true; scrim.hidden = true; sheet.innerHTML = ''; return }
    sheet.hidden = false; scrim.hidden = false
    const back = `<div class="grab"></div><div class="sheet-top"><button class="back" data-act="back">‹ ${S.stack.length > 1 ? 'Back' : 'Close'}</button></div>`
    const keepScroll = sheet.dataset.sig === JSON.stringify(top) ? sheet.scrollTop : 0
    let html = ''
    if (top.type === 'topic') html = topicSheet(top.id)
    else if (top.type === 'item') html = itemSheet(top.key, top.topic)
    else if (top.type === 'day') { const ed = S.data.editions.find((e) => e.day === top.day); html = ed ? editionHTML(ed, 'Edition') : '<div class="empty">Edition not found.</div>' } else if (top.type === 'follow') html = followSheet(top.text)
    const ta = $('#fin'); const draft = ta ? ta.value : null; const focused = document.activeElement === ta
    sheet.innerHTML = back + html
    sheet.dataset.sig = JSON.stringify(top); sheet.scrollTop = keepScroll
    const nta = $('#fin')
    if (nta) { if (draft !== null) nta.value = draft; if (focused || (top.type === 'follow' && !draft)) setTimeout(() => nta.focus(), 60) }
  }

  function topicSheet (id) {
    const t = topicById(id)
    if (!t) return '<div class="empty">Topic not found.</div>'
    const items = S.data.items.filter((i) => i.topic === id)
    const checking = activeJobs().some((j) => j.kind === 'check' && j.topic === id)
    const toggle = t.status === 'active' ? '<button class="btn" data-act="status" data-s="paused">Pause</button>' : '<button class="btn" data-act="status" data-s="active">' + (t.status === 'paused' ? 'Resume' : 'Follow again') + '</button>'
    return `<h2>${esc(t.short_title)}<span class="statuspill ${t.status}">${t.status === 'active' ? 'following' : t.status}</span></h2>
      <div class="sub">${esc(t.group)} · checked ${ago(t.last_checked) || 'not yet'}${t.last_moved ? ` · moved ${ago(t.last_moved)}` : ''}${t.up || t.down ? ` · ${t.up} useful, ${t.down} not` : ''}</div>
      <div class="ctrls">
        <div class="seg">${['daily', 'weekly'].map((c) => `<button class="${t.cadence === c ? 'on' : ''}" data-act="cadence" data-c="${c}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>
        <button class="btn" data-act="check" ${checking || t.status !== 'active' ? 'disabled' : ''}>${checking ? '<span class="spin" style="display:inline-block;vertical-align:-2px"></span> Checking' : 'Check now'}</button>
        ${toggle}${t.status !== 'unfollowed' ? '<button class="btn danger" data-act="status" data-s="unfollowed">Unfollow</button>' : ''}
      </div>
      <h5>Why you follow it</h5><p class="lead">${esc(t.why)}</p>
      ${t.known_state ? `<h5>What we know so far</h5><p class="lead">${esc(t.known_state)}</p>` : ''}
      ${t.report_when.length ? `<details><summary>What counts as news (${t.report_when.length})</summary><ul class="plain">${t.report_when.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
      <h5>Reported · ${items.length}</h5>
      ${items.length ? items.slice(0, 30).map((i) => card(i, { day: true })).join('') : '<p class="lead">Nothing reported yet. It surfaces here the day something real moves.</p>'}
      <h5>Sources · ${t.sources.length}${t.gaps.length ? ` · ${t.gaps.length} down` : ''}</h5>
      ${t.sources.map((s) => `<div class="srcrow"><span class="hd ${s.ok === true ? 'ok' : s.ok === false ? 'bad' : ''}"></span><span class="k">${esc(s.kind)}</span><span class="l">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)}</span></div>`).join('')}`
  }

  function itemSheet (key, topic) {
    const it = itemBy(key, topic)
    if (!it) return '<div class="empty">Item not found.</div>'
    const job = (S.data.jobs || []).find((j) => j.kind === 'dive' && j.key === key && (j.status === 'queued' || j.status === 'running'))
    const failed = (S.data.jobs || []).find((j) => j.kind === 'dive' && j.key === key)
    let dive
    if (it.dive) {
      if (S.dives[key]) dive = `<div class="md">${md(S.dives[key])}</div>`
      else { dive = '<div class="wait"><span class="spin"></span> Loading…</div>'; api('dive/' + key).then((r) => { S.dives[key] = r.markdown; renderSheet() }).catch(() => {}) }
    } else if (job) dive = '<div class="wait"><span class="spin"></span> Reading the primary source and checking it against our projects. About two minutes; you can leave this open or come back.</div>'
    else dive = `${failed && failed.status === 'failed' ? `<p class="hint" style="color:var(--red)">Last attempt failed: ${esc(String(failed.error || '').slice(0, 140))}</p>` : ''}<p class="lead" style="margin-bottom:10px">Opens the primary source, checks it against our projects, and recommends one move.</p><button class="btn primary" data-act="dive">Deep dive</button>`
    return `<div class="sub"><button class="topic" style="color:var(--violet-2);font-weight:600" data-act="topic" data-id="${it.topic}">${esc(it.topic_title)} ›</button> · ${fmtDay(it.day)}</div>
      <h2>${esc(it.title)}</h2>
      <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.host)} ↗</a>
      <p class="lead" style="margin-top:10px">${esc(it.body)}</p>
      ${card(it).replace(/^[\s\S]*?<div class="acts">/, '<div class="card" style="background:none;border:0;padding:0;cursor:default" data-key="' + it.key + '" data-topic="' + it.topic + '"><div class="acts">').replace(/<button data-act="dive"[\s\S]*?<\/button>/, '')}
      <div class="dive-box">${dive}</div>`
  }

  function followSheet (text) {
    const fjobs = (S.data.jobs || []).filter((j) => j.kind === 'follow').slice(0, 6)
    const st = { queued: 'Queued', running: 'Finding primary sources and verifying them…', done: '', failed: 'Failed' }
    return `<h2>Follow a topic</h2>
      <p class="lead">Say it like you'd say it to me. I'll find the primary sources, verify each one, and it joins the 08:00 edition.</p>
      <textarea id="fin" class="follow-in" placeholder="e.g. Apple's next Mac Studio, and memory prices that affect it">${esc(text || '')}</textarea>
      <div class="reasons">${EXAMPLES.map((e) => `<button class="chip" data-act="example">${esc(e)}</button>`).join('')}</div>
      <div class="ctrls"><button class="btn primary" data-act="submit-follow">Follow</button></div>
      <p class="hint">Takes a few minutes. If it overlaps something you already follow, I extend that topic instead.</p>
      ${fjobs.length ? `<h5>Recent</h5>${fjobs.map((j) => `<div class="jobrow" ${j.status === 'done' && j.result?.id ? `data-act="topic" data-id="${esc(j.result.id)}" style="cursor:pointer"` : ''}>
        ${j.status === 'queued' || j.status === 'running' ? '<span class="spin"></span>' : j.status === 'done' ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">!</span>'}
        <div class="tx"><div>${esc(j.label)}</div><div class="s ${j.status === 'failed' ? 'err' : ''}">${j.status === 'done' ? `${j.result?.action === 'extended' ? 'Extended' : 'Following'} ${esc(j.result?.short_title || '')} ›` : j.status === 'failed' ? esc(String(j.error || '').slice(0, 120)) : st[j.status]}</div></div>
        ${j.status === 'failed' ? `<button class="chip" data-act="retry-follow" data-text="${esc(j.label)}">Retry</button>` : ''}</div>`).join('')}` : ''}`
  }

  // ---------- actions ----------
  function push (entry) {
    const top = S.stack[S.stack.length - 1]
    if (top && JSON.stringify(top) === JSON.stringify(entry)) return
    S.stack.push(entry); renderSheet(); armGuards()
  }
  function pop () { S.stack.pop(); renderSheet() }

  async function vote (it, v) {
    const next = it.vote === v ? null : v
    it.vote = next; if (next !== 'down') it.reason = null
    S.openReasons = next === 'down' ? it.key + ':' + it.topic : null
    renderAll()
    try { await api('feedback', { topic: it.topic, key: it.key, vote: next, title: it.title, url: it.url }) } catch (e) { toast('Not saved: ' + e.message) }
  }
  async function reason (it, r) {
    it.reason = it.reason === r ? null : r; S.openReasons = null; renderAll()
    toast('Thanks — the editor uses this tomorrow')
    try { await api('feedback', { topic: it.topic, key: it.key, vote: 'down', reason: it.reason, title: it.title, url: it.url }) } catch (e) { toast('Not saved: ' + e.message) }
  }
  async function startDive (it) {
    try {
      const j = await api('jobs', { kind: 'dive', item: it })
      upsertJob(j); push({ type: 'item', key: it.key, topic: it.topic }); renderAll(); load()
    } catch (e) { toast('Could not start: ' + e.message) }
  }
  function upsertJob (j) { const js = S.data.jobs; const i = js.findIndex((x) => x.id === j.id); if (i >= 0) js[i] = j; else js.unshift(j); S.jobState[j.id] = j.status }
  async function setTopic (id, body, undo) {
    try {
      const t = await api('topic/' + id, body)
      const i = S.data.topics.findIndex((x) => x.id === id); if (i >= 0) S.data.topics[i] = t
      S.data.counts = { active: 0, paused: 0, unfollowed: 0 }; for (const x of S.data.topics) S.data.counts[x.status]++
      renderAll()
      if (undo) toast(undo.msg, 'Undo', () => setTopic(id, undo.body))
    } catch (e) { toast('Not saved: ' + e.message) }
  }
  async function follow (text) {
    text = (text || '').trim()
    if (text.length < 3) { toast('Say what to follow'); return }
    try {
      const j = await api('jobs', { kind: 'follow', text }); upsertJob(j)
      const ta = $('#fin'); if (ta) ta.value = ''
      renderAll(); load(); toast('On it — setting up “' + text.slice(0, 40) + '”')
    } catch (e) { toast('Could not start: ' + e.message) }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')
    const cardEl = e.target.closest('.card[data-key]')
    if (!a) {
      if (cardEl && !e.target.closest('a') && cardEl.closest('.pane, .sheet') && !cardEl.closest('.dive-box')) {
        const top = S.stack[S.stack.length - 1]
        if (!(top && top.type === 'item' && top.key === cardEl.dataset.key)) push({ type: 'item', key: cardEl.dataset.key, topic: cardEl.dataset.topic })
      }
      if (e.target.id === 'scrim') { history.back() }
      return
    }
    const act = a.dataset.act
    const it = cardEl ? itemBy(cardEl.dataset.key, cardEl.dataset.topic) : (S.stack.at(-1)?.type === 'item' ? itemBy(S.stack.at(-1).key, S.stack.at(-1).topic) : null)
    const curTopic = S.stack.at(-1)?.type === 'topic' ? S.stack.at(-1).id : null
    switch (act) {
      case 'back': history.back(); break
      case 'topic': push({ type: 'topic', id: a.dataset.id }); break
      case 'day': push({ type: 'day', day: a.dataset.day }); break
      case 'up': if (it) vote(it, 'up'); break
      case 'down': if (it) vote(it, 'down'); break
      case 'reason': if (it) reason(it, a.dataset.r); break
      case 'dive': if (it) { if (it.dive) push({ type: 'item', key: it.key, topic: it.topic }); else startDive(it) } break
      case 'filter': S.filter = a.dataset.f; renderArchive(); break
      case 'cadence': if (curTopic) setTopic(curTopic, { cadence: a.dataset.c }); break
      case 'status': if (curTopic) {
        const t = topicById(curTopic); const prev = t.status; const s = a.dataset.s
        if (s === 'unfollowed') { history.back(); setTopic(curTopic, { status: s }, { msg: `Unfollowed ${t.short_title}`, body: { status: prev } }) } else setTopic(curTopic, { status: s }, s === 'paused' ? { msg: `Paused ${t.short_title}`, body: { status: prev } } : null)
      } break
      case 'check': if (curTopic) api('jobs', { kind: 'check', topic: curTopic }).then((j) => { upsertJob(j); renderAll(); load(); toast('Checking now — results land here, not in the thread') }).catch((er) => toast(er.message)); break
      case 'follow': push({ type: 'follow', text: a.dataset.text || '' }); break
      case 'example': { const ta = $('#fin'); if (ta) { ta.value = a.textContent; ta.focus() } } break
      case 'submit-follow': follow($('#fin')?.value); break
      case 'retry-follow': follow(a.dataset.text); break
    }
  })
  $('#fab').addEventListener('click', () => push({ type: 'follow', text: '' }))

  // ---------- views & tabs ----------
  function setView (v, opts = {}) {
    if (v === 'watching') v = 'following'
    if (!VIEWS.includes(v)) v = 'today'
    S.view = v; document.body.dataset.view = v
    $('#pager').style.transform = `translateX(${-100 * VIEWS.indexOf(v)}%)`
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)))
    if (!opts.silent) { const u = new URL(location.href); u.searchParams.set('view', v); ['topic', 'item', 'follow'].forEach((k) => u.searchParams.delete(k)); history.replaceState(history.state, '', u) }
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    if (S.view === b.dataset.view) $('#v-' + S.view).scrollTo({ top: 0, behavior: 'smooth' })
    setView(b.dataset.view)
  }))
  // horizontal swipe between tabs
  let sx = null; let sy = null
  $('#pager').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }, { passive: true })
  $('#pager').addEventListener('touchend', (e) => {
    if (sx === null) return
    const dx = e.changedTouches[0].clientX - sx; const dy = e.changedTouches[0].clientY - sy; sx = null
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) { const i = VIEWS.indexOf(S.view) + (dx < 0 ? 1 : -1); if (VIEWS[i]) setView(VIEWS[i]) }
  }, { passive: true })

  // ---------- toast ----------
  let toastT = null
  function toast (msg, label, fn) {
    const t = $('#toast'); t.hidden = false
    t.innerHTML = `<span>${esc(msg)}</span>${label ? `<button>${esc(label)}</button>` : ''}`
    if (label) t.querySelector('button').onclick = () => { t.hidden = true; fn && fn() }
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true }, label ? 6000 : 2600)
  }

  // ---------- Back: CloseWatcher + history guard, double-back floor at root ----------
  let watcher = null
  function armWatcher () {
    if (!('CloseWatcher' in window)) return
    try { watcher?.destroy() } catch {}
    try { watcher = new CloseWatcher(); watcher.onclose = () => { watcher = null; onBack() } } catch { watcher = null }
  }
  function armGuards () {
    if (!history.state || !history.state.wzGuard) history.pushState({ wzGuard: 1 }, '', location.href)
    if (!watcher) armWatcher()
  }
  function onBack () {
    if (S.openReasons) { S.openReasons = null; renderAll(); return true }
    if (S.stack.length) { pop(); return true }
    if (S.view !== 'today') { setView('today'); return true }
    const now = Date.now()
    if (now - S.warnAt < 2000) { S.warnAt = 0; return false }
    S.warnAt = now; toast('Press back again to exit'); return true
  }
  window.__wzBack = onBack
  window.addEventListener('popstate', () => {
    const stay = onBack()
    if (stay) history.pushState({ wzGuard: 1 }, '', location.href)
    else history.back()
  })
  document.addEventListener('pointerdown', () => { if (!watcher) armWatcher() }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !('CloseWatcher' in window)) onBack() })

  // ---------- boot ----------
  async function boot () {
    const q = new URLSearchParams(location.search)
    history.replaceState({ wzRoot: 1 }, '', location.href)
    setView(q.get('view') || 'today', { silent: true })
    await load()
    if (q.get('topic') && topicById(q.get('topic'))) S.stack.push({ type: 'topic', id: q.get('topic') })
    else if (q.get('item')) { const it = itemBy(q.get('item')); if (it) S.stack.push({ type: 'item', key: it.key, topic: it.topic }) } else if (q.get('follow') !== null) S.stack.push({ type: 'follow', text: q.get('follow') || '' })
    renderSheet(); armGuards()
  }
  boot()
})()
