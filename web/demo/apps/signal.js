/* Wizard Signal sample: the shipped Signal templates (static/app.js: topbar, feed tabs, filters, post rows, depth
 * markers, sources, settings, add-source sheet) over a disclosed sample timeline. Sources and posts are invented
 * for this preview; nothing is fetched, followed or live. More / Less / Save / Follow / Pause change this page only.
 * Back: sheet → post or channel → tab → feed root (where the shell takes the step). */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = { home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6m-3-3h6', plus: 'M12 5v14M5 12h14', save: 'M6 3h12v18l-6-4-6 4z', me: 'M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', arrow: 'M7 17 17 7M7 7h10v10', close: 'm6 6 12 12M6 18 18 6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2', up: 'M7 10v10H3V10h4zm0 0 5-7h2v7h6l-2 10H7', down: 'M7 14V4H3v10h4zm0 0 5 7h2v-7h6L18 4H7', back: 'm15 18-6-6 6-6', spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', feed: 'M4 7h16M4 12h16M4 17h10' };
  const icon = n => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n] || P.feed}"/></svg>`;
  const platforms = { youtube: 'YouTube', instagram: 'Instagram', x: 'X', rss: 'Reading', discovery: 'Discovery', topic: 'Topic' };

  /* ---------------- disclosed sample timeline ---------------- */
  const SOURCES = [
    { id: 's1', name: 'Lumen Field Notes', platform: 'rss', handle: 'fieldnotes.example', enabled: true },
    { id: 's2', name: 'Quiet Machines', platform: 'youtube', handle: 'quiet-machines (sample)', enabled: true },
    { id: 's3', name: 'Orchard Robotics', platform: 'x', handle: '@orchard_sample', enabled: true },
    { id: 's4', name: 'Paper Atlas', platform: 'instagram', handle: '@paperatlas.sample', enabled: true },
    { id: 's5', name: 'Home servers', platform: 'topic', handle: 'Topic watch (sample)', enabled: true },
  ];
  const I = (id, source, date, text, extra = {}) => ({ id, source, date, text, saved: false, feedback: 0, ...extra });
  const ITEMS = [
    I('p1', 's3', '2026-10-09', 'Small habit that paid off this year: every script I write gets a one-line comment saying what would make me delete it.\n\nHalf of them got deleted. The rest got better.', { why: 'Matches your interest in tools you build for yourself.', likes: 1200 }),
    I('p2', 's1', '2026-10-09', 'Field note: a week of answering messages twice a day instead of as they arrive. Fewer, longer replies. Nobody noticed the delay; I noticed the quiet.', { why: 'Matches: attention and calm work.' }),
    I('p3', 's2', '2026-10-08', '', { title: 'How a small home server stays quiet: fans, airflow and one good shelf', media: 'video', why: 'Matches: home lab, quiet hardware.' }),
    I('p4', 's4', '2026-10-08', 'A neighbourhood walk drawn from memory, then corrected on the way back. The corrections are the interesting part.', { media: 'image', why: 'Matches: maps and making things by hand.' }),
    I('p5', 's5', '2026-10-07', 'Sample topic post: label every cable and port before you need to. The day you need the label is the day you have the least patience.', { topic: 'Home servers', why: 'From your Home servers topic.', tier: 'good', depth: .3 }),
    I('p6', 's1', '2026-10-06', 'Reading list rule: if I wouldn’t reread the summary next month, I don’t save the article this month.', { why: 'Matches: reading habits.', tier: 'good', depth: .45 }),
    I('p7', 's3', '2026-10-05', 'Robot arms are easy to demo and hard to live with. The interesting work is in the boring parts: recovery after a miss, and knowing when to stop.', { why: 'Matches: robotics, reliability.', tier: 'more', depth: .62 }),
    I('p8', 's4', '2026-10-04', 'Index cards on a cork board beat any app for planning a garden. You can see the whole season at once.', { why: 'Loosely matches: planning by hand.', tier: 'more', depth: .78 }),
    I('p9', 's2', '2026-10-02', '', { title: 'Thirty seconds: a fan curve before and after', media: 'video', why: 'Weak match: home lab.', tier: 'dregs', depth: .95 }),
  ];
  const DISCOVER = [
    I('d1', 'disc', '2026-10-09', 'Sample discovery: a short thread on running a small language model on a home box, and why the slowest part was the disk, not the model.', { author: 'tinybox_sample', why: 'Outside your follows; matches local AI.' }),
    I('d2', 'disc', '2026-10-08', 'Sample discovery: “Write the README before the code” held up for a year of side projects. Two that skipped it are the two I abandoned.', { author: 'readme_first_sample', why: 'Outside your follows; matches tools you build.' }),
  ];
  const DISC = { id: 'disc', name: 'Vajra Signal', platform: 'discovery' };
  const srcOf = x => SOURCES.find(s => s.id === x.source) || DISC;
  const nameOf = x => x.author ? '@' + x.author : srcOf(x).name;
  const nfmt = n => n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n);
  const day = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  function avatar(name) { const n = String(name).replace(/^@/, ''); const ini = n.split(/[\s_]+/).map(w => w[0]).slice(0, 2).join('') || '?'; return `<span class="avatar" data-tone="${n.length % 5}">${esc(ini)}</span>`; }

  /* ---------------- view stack (no history entries when hosted) ---------------- */
  let stack = [{ route: 'feed', tab: 'for-you', platform: 'all', source: 'all', post: null }];
  let modal = false;
  const S = () => stack[stack.length - 1];
  function push(patch) { S().y = window.scrollY; stack.push({ ...S(), post: null, ...patch, y: 0 }); render(); window.scrollTo(0, 0); }
  function replace(patch) { Object.assign(S(), patch); render(); }
  function back() {
    if (modal) { closeModal(); return true; }
    if (stack.length < 2) return false;
    stack.pop(); render(); window.scrollTo(0, S().y || 0); return true;
  }

  /* ---------------- templates (shipped markup) ---------------- */
  const nav = () => `<nav class="nav" aria-label="Main navigation">${[['feed', 'home', 'Feed'], ['sources', 'people', 'Sources'], ['saved', 'save', 'Saved'], ['me', 'me', 'You']].map(([r, i, l]) => { const on = S().route === r && !S().post; return `<button class="nav-item${on ? ' selected' : ''}" data-action="nav" data-id="${r}" aria-label="${l}"${on ? ' aria-current="page"' : ''}>${icon(i)}<span>${l}</span></button>`; }).join('')}<button class="compose-nav" data-action="add" aria-label="Add source">${icon('plus')}<span>Add source</span></button></nav>`;
  const brand = () => `<span class="brand"><span class="brand-mark" aria-hidden="true">w.</span><span class="brand-name">Wizard Signal</span></span>`;
  function filters() {
    const s = S();
    return `<div class="feed-tabs" role="tablist" aria-label="Feed order">${[['for-you', 'For you'], ['latest', 'Latest'], ['discover', 'Discover']].map(([id, n]) => `<button role="tab" aria-selected="${s.tab === id}" class="${s.tab === id ? 'active' : ''}" data-action="tab" data-id="${id}"><span>${n}</span></button>`).join('')}</div>
      <div class="signal-filters"><label class="sr-only" for="platform">Platform</label><select id="platform" class="${s.platform !== 'all' ? 'filtered' : ''}"><option value="all">All platforms</option>${['youtube', 'instagram', 'x', 'rss'].map(p => `<option value="${p}" ${s.platform === p ? 'selected' : ''}>${platforms[p]}</option>`).join('')}</select><label class="sr-only" for="channel">Channel</label><select id="channel" class="${s.source !== 'all' ? 'filtered' : ''}"><option value="all">All channels</option>${SOURCES.map(x => `<option value="${x.id}" ${s.source === x.id ? 'selected' : ''}>${esc(x.name)} · ${platforms[x.platform]}</option>`).join('')}</select><span class="source-count">${SOURCES.filter(x => x.enabled).length} sources</span></div>`;
  }
  function media(x) {
    if (x.media === 'video') return `<div class="rich-card"><span class="preview-media sample-media"><b>Sample · no video</b></span><div class="preview-copy"><span class="preview-domain">YouTube (sample)</span><strong class="video-title">${esc(x.title)}</strong></div></div>`;
    if (x.media === 'image') return `<div class="rich-card"><span class="preview-media sample-media"><b>Sample image</b></span></div>`;
    return '';
  }
  function card(x, { detail = false } = {}) {
    const s = S(), src = srcOf(x), forYou = s.tab === 'for-you' && s.route === 'feed' && s.source === 'all', discover = x.source === 'disc';
    const ctx = [x.topic ? 'Topic · ' + x.topic : '', discover ? 'Vajra Signal discovery · sample' : ''].filter(Boolean).join(' · ');
    const band = forYou && !detail && x.depth ? ' depth-' + Math.min(5, Math.max(1, Math.ceil((x.depth - .2) / .8 * 5))) : '';
    const text = x.text || '', long = !detail && text.length > 420, m = media(x);
    const body = x.platform === 'youtube' || src.platform === 'youtube' ? '' : `<button class="post-open" data-action="post" data-id="${x.id}" aria-label="Open post from ${esc(nameOf(x))}"><span class="post-text ${long ? 'clamped' : ''}">${esc(text)}</span></button>`;
    return `<article class="post${detail ? ' detail' : ''}${forYou && x.tier ? ' tier-' + x.tier : ''}${band}" data-item="${x.id}">${ctx ? `<div class="post-context">${icon(x.topic ? 'spark' : 'feed')}<span>${esc(ctx)}</span></div>` : ''}<button class="avatar-button" data-action="channel" data-id="${discover ? '' : src.id}" aria-label="View ${esc(nameOf(x))}">${avatar(nameOf(x))}</button><div class="post-body"><header class="post-head"><button class="name" data-action="channel" data-id="${discover ? '' : src.id}">${esc(nameOf(x))}</button><span class="dot" aria-hidden="true">·</span><time class="meta" datetime="${x.date}">${day(x.date)}</time><span class="platform-line" data-platform="${discover ? 'x' : src.platform}">${discover ? 'X' : platforms[src.platform]}</span></header>${body}${long ? `<button class="preview-more" data-action="post" data-id="${x.id}">Read more</button>` : ''}${m ? `<div class="link-preview"${x.media === 'video' ? ` data-action="post" data-id="${x.id}" role="button" tabindex="0" aria-label="Open ${esc(x.title)}"` : ''}>${m}</div>` : ''}${forYou || detail ? `<p class="curation-note">${esc(x.why)}</p>${x.likes ? `<p class="amp-line">${nfmt(x.likes)} likes · sample figure</p>` : ''}` : ''}<footer class="post-actions"><button class="${x.feedback === 1 ? 'active' : ''}" data-action="more" data-id="${x.id}" aria-label="More like this" aria-pressed="${x.feedback === 1}">${icon('up')}</button><button class="${x.feedback === -1 ? 'active' : ''}" data-action="less" data-id="${x.id}" aria-label="Less like this" aria-pressed="${x.feedback === -1}">${icon('down')}</button><button class="${x.saved ? 'active' : ''}" data-action="save" data-id="${x.id}" aria-label="${x.saved ? 'Unsave' : 'Save'} item" aria-pressed="${x.saved}">${icon('save')}</button><button disabled aria-label="Open original (sample only: there is no original)" title="Sample only">${icon('arrow')}</button>${discover ? `<button data-action="follow" data-id="${x.id}" aria-label="Follow ${esc(nameOf(x))} on this page">${icon('plus')}</button>` : ''}</footer></div></article>`;
  }
  function withMarkers(xs) {
    const label = { good: 'Still good', more: 'Lower signal from here', dregs: 'The dregs: skim or stop' };
    let out = '', prev = 'top';
    for (const x of xs) { if (x.tier && x.tier !== prev && label[x.tier]) { out += `<div class="depth-marker tier-${x.tier}" role="separator"><span>${label[x.tier]}</span></div>`; prev = x.tier; } out += card(x); }
    return out;
  }
  function visible() {
    const s = S();
    if (s.route === 'saved') return [...ITEMS, ...DISCOVER].filter(x => x.saved);
    if (s.tab === 'discover' && s.source === 'all') return DISCOVER;
    let xs = ITEMS.filter(x => (s.source === 'all' || x.source === s.source) && (s.platform === 'all' || srcOf(x).platform === s.platform) && srcOf(x).enabled !== false);
    if (s.tab === 'latest' || s.source !== 'all') xs = [...xs].sort((a, b) => b.date.localeCompare(a.date));
    else xs = xs.filter(x => x.feedback !== -1).concat(xs.filter(x => x.feedback === -1));
    return xs;
  }
  function feed() {
    const s = S(), xs = visible(), forYou = s.tab === 'for-you' && s.route === 'feed' && s.source === 'all';
    const note = s.route === 'feed' && s.source === 'all' ? (s.tab === 'discover'
      ? '<div class="discovery-note"><strong>Vajra Signal · sample</strong><span>In the real app: discoveries beyond your subscriptions. Here: two invented posts.</span></div>'
      : '<div class="discovery-note"><strong>Sample timeline</strong><span>Invented sources and posts for the Wizard OS preview. Nothing here is fetched, followed or live.</span></div>') : '';
    if (!xs.length) return note + `<section class="empty">${icon(s.route === 'saved' ? 'save' : 'feed')}<h2>${s.route === 'saved' ? 'Keep the good ones.' : 'Nothing here.'}</h2><p>${s.route === 'saved' ? 'Save a post to see it here (this page only).' : 'Try All platforms or All channels.'}</p></section>`;
    return note + (forYou ? withMarkers(xs) : xs.map(x => card(x)).join('')) + '<p class="end-note">End of the sample. The rest of the internet can wait.</p>';
  }
  function postDetail(id) {
    const x = [...ITEMS, ...DISCOVER].find(i => i.id === id); if (!x) return '<section class="empty"><h2>Not in this sample.</h2></section>';
    const more = ITEMS.filter(i => i.source === x.source && i.id !== x.id);
    return `${card(x, { detail: true })}<section class="detail-why"><h2>About this post</h2><p>Sample post written for the Wizard OS preview. It is not from ${esc(srcOf(x).name)} or any real account, and opening the original is off.</p></section>${more.length ? `<div class="depth-marker" role="separator"><span>More from ${esc(srcOf(x).name)}</span></div>${more.map(i => card(i)).join('')}` : ''}`;
  }
  function sourcesView() {
    return `<div class="section-intro"><h2>Your sources</h2><p>${SOURCES.length} sample sources · invented for this preview.</p></div><section class="people-list">${SOURCES.map(s => `<div class="signal-source ${s.enabled ? '' : 'paused'}"><div class="person-row"><button class="person-open" data-action="channel" data-id="${s.id}">${avatar(s.name)}<span class="person-copy"><strong>${esc(s.name)}</strong><span>${platforms[s.platform]} · ${esc(s.handle)}</span></span></button><button class="follow ${s.enabled ? 'following' : ''}" data-action="pause" data-id="${s.id}" aria-label="${s.enabled ? 'Pause' : 'Resume'} ${esc(s.name)} on this page">${s.enabled ? (s.platform === 'topic' ? 'Watching' : 'Following') : 'Paused'}</button></div><div class="source-health checking"><span>Sample source · never checked</span></div></div>`).join('')}</section><section class="invite-panel"><h2>Follow a voice or an idea.</h2><p class="note">YouTube · Instagram · X · RSS. Adding sources is off in this sample.</p><button class="primary" data-action="add">Add source…</button></section>`;
  }
  function settings() {
    return `<section class="settings-section"><h2>Appearance</h2><div class="appearance-row"><span><strong>Theme</strong><small>Follows Wizard OS in this preview.</small></span></div></section><section class="settings-section"><h2>Your algorithm</h2><p class="lede">What’s worth your time?</p><p class="note">In the real app, For You re-ranks your sources by these interests. In this sample the order is fixed; More, Less and Save change this page only.</p><p class="interests">Tools you build for yourself · calm work · home lab · robotics that recovers well · maps and making things by hand.</p></section>`;
  }
  function render() {
    const s = S(), detail = !!s.post, channel = s.route === 'feed' && s.source !== 'all' && !detail;
    const title = detail ? 'Post' : channel ? (SOURCES.find(x => x.id === s.source)?.name || 'Channel') : { feed: 'Signal', sources: 'Sources', saved: 'Saved', me: 'You' }[s.route];
    const backBtn = detail || channel ? `<button class="icon-button" data-back aria-label="Back to ${esc(stack.length > 1 ? (stack[stack.length - 2].post ? 'post' : { feed: 'feed', sources: 'sources', saved: 'saved', me: 'settings' }[stack[stack.length - 2].route]) : 'feed')}">${icon('back')}</button>` : '';
    const content = detail ? postDetail(s.post) : s.route === 'sources' ? sourcesView() : s.route === 'me' ? settings() : feed();
    $('#app').innerHTML = `<div class="app-layout"><aside class="sidebar">${brand()}${nav()}</aside><main class="main"><header class="topbar${s.route === 'feed' && !detail && !channel ? ' flush' : ''}">${backBtn}<h1>${esc(title)}</h1><span class="spacer"></span><span class="connection sample"><span></span>Sample feed</span><button class="icon-button" disabled aria-label="Refresh (sample only: nothing to fetch)" title="Sample only">${icon('refresh')}</button></header>${s.route === 'feed' && !detail ? filters() : ''}<div id="content">${content}</div></main></div>`;
    document.title = `${title} · Wizard Signal (sample)`;
    bindSelects();
    if (modal) renderModal();
  }
  function renderModal() {
    $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close"><section class="sheet" role="dialog" aria-modal="true" aria-label="Add source"><div class="sheet-heading"><button class="icon-button" data-action="close" aria-label="Close">${icon('close')}</button></div><h2>Follow a voice or an idea.</h2><p class="note">YouTube · Instagram · X · RSS, or an X topic search. In this sample, adding is off: nothing is followed or fetched.</p><label for="source-url">Link or handle</label><input id="source-url" type="url" placeholder="Paste a link (sample only)" disabled><button class="primary" disabled style="margin-top:18px">Add · sample only</button></section></div>`;
    document.body.classList.add('modal-open');
  }
  function closeModal() { modal = false; $('#modal-root').innerHTML = ''; document.body.classList.remove('modal-open'); }
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }
  function bindSelects() {
    const p = $('#platform'); if (p) p.onchange = () => { stack = [stack[0]]; replace({ platform: p.value, source: 'all' }); };
    const c = $('#channel'); if (c) c.onchange = () => { if (c.value === 'all') { stack = [stack[0]]; render(); } else push({ source: c.value, tab: 'latest' }); };
  }

  /* ---------------- actions ---------------- */
  function act(action, id, el) {
    const x = [...ITEMS, ...DISCOVER].find(i => i.id === id);
    switch (action) {
      case 'nav': if (id === 'feed') { stack = [stack[0]]; Object.assign(stack[0], { post: null }); render(); window.scrollTo(0, stack[0].y || 0); } else { stack = [stack[0], { ...stack[0], route: id, source: 'all', post: null, y: 0 }]; render(); window.scrollTo(0, 0); } return;
      case 'tab': stack = [stack[0]]; replace({ tab: id, source: 'all', post: null }); window.scrollTo(0, 0); return; // a tab is never a Back step
      case 'channel': if (!id) { toast('Discovery authors are samples: nothing to open.'); return; } push({ route: 'feed', source: id, tab: 'latest', platform: 'all' }); return;
      case 'post': if (S().post !== id) push({ post: id }); return;
      case 'add': modal = true; renderModal(); $('.sheet .icon-button')?.focus({ preventScroll: true }); return;
      case 'close': closeModal(); return;
      case 'more': case 'less': { const v = action === 'more' ? 1 : -1; x.feedback = x.feedback === v ? 0 : v; toast(x.feedback === 1 ? 'More like this (this page only).' : x.feedback === -1 ? 'Less like this (this page only).' : 'Reaction cleared.'); break; }
      case 'save': x.saved = !x.saved; toast(x.saved ? 'Saved (this page only).' : 'Removed from Saved.'); break;
      case 'follow': toast(`${nameOf(x)} is a sample author: following is off in this preview.`); return;
      case 'pause': { const s = SOURCES.find(s => s.id === id); s.enabled = !s.enabled; toast(`${s.enabled ? 'Resumed' : 'Paused'} ${s.name} (this page only).`); break; }
      default: return;
    }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { e.preventDefault(); back(); return; }
    const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
    if (el.classList.contains('modal-backdrop') && e.target !== el) return; // taps inside the sheet
    e.preventDefault(); act(el.dataset.action, el.dataset.id, el);
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); act(e.target.dataset.action, e.target.dataset.id, e.target); } });

  window.WzFixture?.init({ back, toast });
  render();
})();
