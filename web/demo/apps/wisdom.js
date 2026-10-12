/* Wisdom sample: the shipped Wisdom render templates (static/wisdom.js) over a small, read-only sample library.
 * Opens on a reading (Meditations, George Long's public-domain translation). Back: reader → library → (root:
 * the shell takes the step). Star, Done, Archive, ratings and text size change this page only: nothing is fetched,
 * sent or stored. Other chapters are short sample prose written for this preview, labelled as such. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const root = document.documentElement;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = { star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z', check: 'm5 12 4 4L19 6', archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4', undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5.2-5.2', up: 'M7 10v10H3V10h4zm0 0 5-7h2v7h6l-2 10H7', down: 'M7 14V4H3v10h4zm0 0 5 7h2v-7h6L18 4H7' };
  const icon = n => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
  const art = n => `assets/${n}.jpg`;

  /* ---------------- sample library ---------------- */
  const LONG = 'Marcus Aurelius, Meditations, tr. George Long (1862). Public domain; lightly abridged for this sample.';
  const OWN = 'Sample prose written for the Wizard OS preview. Not a quotation, not a retrieved source.';
  const THINKERS = {
    marcus: { id: 'marcus', name: 'Marcus Aurelius' },
    smith: { id: 'smith', name: 'Adam Smith', portrait: art('adam-smith') },
    spinoza: { id: 'spinoza', name: 'Baruch Spinoza', portrait: art('baruch-spinoza') },
    russell: { id: 'russell', name: 'Bertrand Russell', portrait: art('bertrand-russell') },
    korzybski: { id: 'korzybski', name: 'Alfred Korzybski', portrait: art('alfred-korzybski') },
    ava: { id: 'ava', name: 'Avalokiteśvara', portrait: art('avalokiteshvara') },
    mirror: { id: 'mirror', name: 'Black Mirror', portrait: art('black-mirror') },
  };
  const COLLECTIONS = [
    { id: 'meditations', form: 'book', kind: 'Classic · Stoic', title: 'Meditations', thinkers: ['marcus'], entries: ['med-1', 'med-2', 'med-3'], fresh: true, reading: true, by: 'Public domain',
      bio: 'Notes an emperor wrote to himself on campaign: how to meet the day, where to find quiet, what is worth wanting.' },
    { id: 'wealth', form: 'book', kind: 'Economics', title: 'The Wealth of Nations', thinkers: ['smith'], entries: ['smith-1'], portrait: art('adam-smith'), fresh: true, by: 'Sample',
      bio: 'Where prosperity comes from: divided work, exchange, and the long reach of ordinary self-interest.' },
    { id: 'ethics', form: 'book', kind: 'Philosophy', title: 'Ethics', thinkers: ['spinoza'], entries: ['spinoza-1'], portrait: art('baruch-spinoza'), by: 'Sample',
      bio: 'A geometry of the mind: what emotions are, and how understanding them loosens their grip.' },
    { id: 'mirror', form: 'book', kind: 'TV series', title: 'Black Mirror', thinkers: ['mirror'], entries: ['mirror-1'], portrait: art('black-mirror'), fresh: true, by: 'Sample',
      bio: 'Short essays on screens, attention and the futures they quietly propose.' },
    { id: 'russell', form: 'thinker', kind: 'Philosophy', title: 'Bertrand Russell', thinkers: ['russell'], entries: ['russell-1'], portrait: art('bertrand-russell'), fresh: true, by: 'Sample',
      bio: 'Logic, doubt and the uses of not being sure.' },
    { id: 'korzybski', form: 'thinker', kind: 'General semantics', title: 'Alfred Korzybski', thinkers: ['korzybski'], entries: ['korz-1'], portrait: art('alfred-korzybski'), by: 'Sample',
      bio: 'Words are maps. A short course in not confusing them with the ground.' },
    { id: 'compassion', form: 'theme', kind: 'Myth and archetype', title: 'The bodhisattva of compassion', thinkers: ['ava'], entries: ['ava-1'], portrait: art('avalokiteshvara'), fresh: true, by: 'Sample',
      bio: 'One figure, many forms: what the thousand arms are for.' },
  ];
  const ENTRIES = {
    'med-1': { thinker: 'marcus', title: 'Begin the morning', minutes: 4, source: LONG,
      deck: 'Expect difficult people, and remember they are kin: we are made for co-operation, like hands and feet.',
      epigraph: { label: 'Book II · 1', text: 'Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial.' },
      body: `## Book II · 1

All these things happen to them by reason of their ignorance of what is good and evil. But I who have seen the nature of the good that it is beautiful, and of the bad that it is ugly, and the nature of him who does wrong, that it is akin to me, not only of the same blood or seed, but that it participates in the same intelligence and the same portion of the divinity, I can neither be injured by any of them, for no one can fix on me what is ugly, nor can I be angry with my kinsman, nor hate him.

:: For we are made for co-operation, like feet, like hands, like eyelids, like the rows of the upper and lower teeth.

To act against one another then is contrary to nature; and it is acting against one another to be vexed and to turn away.

## Book II · 5

Every moment think steadily as a Roman and a man to do what thou hast in hand with perfect and simple dignity, and feeling of affection, and freedom, and justice; and to give thyself relief from all other thoughts.

And thou wilt give thyself relief, if thou doest every act of thy life as if it were the last, laying aside all carelessness and passionate aversion from the commands of reason, and all hypocrisy, and self-love, and discontent with the portion which has been given to thee.

Thou seest how few the things are, the which if a man lays hold of, he is able to live a life which flows in quiet.` },
    'med-2': { thinker: 'marcus', title: 'A retreat into thyself', minutes: 3, source: LONG,
      deck: 'Not a house in the country or a shore: the quietest place a person can go is their own mind, well ordered.',
      body: `## Book IV · 3

Men seek retreats for themselves, houses in the country, sea-shores, and mountains; and thou too art wont to desire such things very much. But this is altogether a mark of the most common sort of men, for it is in thy power whenever thou shalt choose to retire into thyself.

For nowhere either with more quiet or more freedom from trouble does a man retire than into his own soul, particularly when he has within him such thoughts that by looking into them he is immediately in perfect tranquillity; and I affirm that tranquillity is nothing else than the good ordering of the mind.

Constantly then give to thyself this retreat, and renew thyself; and let thy principles be brief and fundamental, which, as soon as thou shalt recur to them, will be sufficient to cleanse the soul completely, and to send thee back free from all discontent with the things to which thou returnest.

:: The universe is transformation: life is opinion.` },
    'med-3': { thinker: 'marcus', title: 'The wrestler, not the dancer', minutes: 3, source: LONG,
      deck: 'Living well is less a performance than a readiness: stand firm for what comes suddenly.',
      body: `## Book VII · 61

The art of life is more like the wrestler's art than the dancer's, in respect of this, that it should stand ready and firm to meet onsets which are sudden and unexpected.

## Book IV · 17

Do not act as if thou wert going to live ten thousand years. Death hangs over thee. While thou livest, while it is in thy power, be good.

## Book VIII · 47

:: If thou art pained by any external thing, it is not this thing that disturbs thee, but thy own judgement about it.

And it is in thy power to wipe out this judgement now.` },
    'smith-1': { thinker: 'smith', title: 'The pin factory', minutes: 2, source: OWN, art: art('adam-smith'),
      deck: 'One worker alone makes a handful of pins a day. Ten, each doing one step, make thousands.',
      body: `## The example

Smith opens with something small on purpose: a workshop making pins. One person doing every step, drawing the wire, cutting, pointing, fitting the head, might struggle to finish twenty in a day. Split the job into its steps and give each to someone who does only that, and the same small room turns out pins by the tens of thousands.

## Why it matters

The gain is not effort but arrangement. Practice makes each step quicker, no time is lost switching tasks, and a narrow task invites a better tool. Prosperity, in this telling, starts with how work is divided and traded, not with gold in a vault.` },
    'spinoza-1': { thinker: 'spinoza', title: 'Understanding the passions', minutes: 2, source: 'Quotation: Spinoza, Ethics V, Prop. 3, tr. R. H. M. Elwes (1883), public domain. Commentary is sample prose written for this preview.', art: art('baruch-spinoza'),
      deck: 'An emotion we understand clearly stops ruling us. Spinoza’s quiet remedy.',
      body: `## Part V, Proposition 3

> An emotion, which is a passion, ceases to be a passion, as soon as we form a clear and distinct idea thereof.

## Sample commentary

Spinoza does not ask us to suppress feeling. He asks us to see it whole: where it came from, what it is about, what it actually needs. A fear we can trace loses its fog. Understanding, for him, is not cold; it is the one kind of freedom open to a creature made of causes.` },
    'russell-1': { thinker: 'russell', title: 'The value of doubt', minutes: 2, source: OWN, art: art('bertrand-russell'),
      deck: 'Philosophy rarely settles questions. Its gift is the widened mind that keeps them open.',
      body: `## Sample prose

Russell was candid that philosophy answers few of its questions for good. What it offers instead is a habit: holding a question long enough that familiar things look strange again.

A person who never doubts lives inside the opinions of their time and place. A little doubt, kept honestly, lets the world grow larger than those opinions. The value lies less in any answer than in the size of the mind the asking leaves behind.` },
    'korz-1': { thinker: 'korzybski', title: 'The map is not the territory', minutes: 2, source: OWN, art: art('alfred-korzybski'),
      deck: 'Every word is a map, useful exactly as far as it matches the ground it describes.',
      body: `## Sample prose

Korzybski’s phrase is short because it has to be remembered under pressure: the map is not the territory. A label, a diagram, a summary, a memory, each leaves things out, and must.

Trouble starts when we argue with the map instead of looking at the ground. The cure is small and practical: ask what a word points to, notice what it omits, and expect any description to be revised by the next look.` },
    'ava-1': { thinker: 'ava', title: 'A thousand arms', minutes: 2, source: OWN, art: art('avalokiteshvara'),
      deck: 'Why the figure of compassion is shown with so many hands, and an eye in each palm.',
      body: `## Sample prose

In many traditions Avalokiteśvara is shown with a thousand arms, an eye in each palm. The image answers a simple question: what would it take to actually help everyone who calls?

Seeing and acting are joined in every hand. Compassion here is not a mood but a practice of attention: notice precisely, then reach. The many arms are less a marvel than an instruction.` },
    'mirror-1': { thinker: 'mirror', title: 'The screen that looks back', minutes: 2, source: OWN, art: art('black-mirror'),
      deck: 'An essay on the dark glass of a switched-off phone, and what it shows us before it lights up.',
      body: `## Sample prose

Before a screen wakes, it is a dark mirror: for a moment it shows the face of the person holding it. Then the glow takes over and the reflection is gone.

The series takes that moment seriously. Its question is rarely whether a device is clever, but what it asks of the people who live with it: what they stop noticing, what they start performing, what they let it remember on their behalf.` },
  };
  for (const [id, e] of Object.entries(ENTRIES)) Object.assign(e, { id, read: false, saved: false, archived: false, rating: 0 });
  const thinker = e => THINKERS[e.thinker];
  const colById = id => COLLECTIONS.find(c => c.id === id);
  const colOf = (e, cid) => { const c = cid && colById(cid); return c && c.entries.includes(e.id) ? c : COLLECTIONS.find(c => c.entries.includes(e.id)); };
  const chapNo = (e, c) => c ? c.entries.indexOf(e.id) + 1 : 0;
  const artOf = e => e.art || thinker(e).portrait || '';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const dotted = (...xs) => xs.filter(Boolean).join(' · ');
  const FORMS = { book: 'Book', thinker: 'Thinker', theme: 'Theme' };
  const readCount = c => c.entries.filter(id => ENTRIES[id].read).length;
  const minutes = c => c.entries.reduce((a, id) => a + ENTRIES[id].minutes, 0);
  const nextOf = c => ENTRIES[c.entries.find(id => !ENTRIES[id].read) || c.entries[0]];
  const img = (src, cls, alt = '') => src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" decoding="async">` : `<span class="${cls} wb-noart" aria-hidden="true"></span>`;
  const initials = n => esc(n.split(/\s+/).map(w => w[0]).slice(0, 2).join(''));
  const colArt = (c, cls) => c.portrait ? img(c.portrait, cls, c.title) : `<span class="${cls} wb-initial">${initials(c.title)}</span>`;

  /* ---------------- routes (in-page stack; no history entries) ---------------- */
  let stack = [{ kind: 'home' }, { kind: 'read', id: 'med-1', col: 'meditations' }];
  let size = 1, query = '';
  const go = (path, cls = '', extra = '') => `href="#/${esc(path)}" data-go="${esc(path)}" class="${cls}"${extra}`;
  const link = (path, html, cls = '', extra = '') => `<a ${go(path, cls, extra)}>${html}</a>`;
  const readPath = (e, c) => `read/${e.id}${c ? '/' + c.id : ''}`;
  const top = () => stack[stack.length - 1];
  function parse(path) { const [kind, id, col] = path.split('/'); return { kind: kind || 'home', id, col }; }
  function navigate(path, { replace = false } = {}) {
    top().y = window.scrollY;
    const next = parse(path);
    if (replace) stack[stack.length - 1] = next; else stack.push(next);
    render(); window.scrollTo(0, 0);
  }
  function back() {
    if (stack.length < 2) return false;
    stack.pop(); render(); window.scrollTo(0, top().y || 0);
    return true;
  }

  /* ---------------- templates (shipped markup) ---------------- */
  function colCover(c, { form = true, lit = false } = {}) {
    const n = readCount(c);
    return link('collection/' + c.id, `<span class="wb-cover-art">${colArt(c, 'wb-portrait')}${form ? `<span class="wb-cover-form">${esc(FORMS[c.form])}</span>` : ''}<span class="wb-cover-copy"><small>${esc(c.kind)}</small><strong>${esc(c.title)}</strong></span></span><span class="wb-cover-meta">${dotted(plural(c.entries.length, 'chapter'), n ? `${n} read` : '')}</span>${c.fresh ? '<span class="wb-cover-new">New</span>' : ''}`, 'wb-cover' + (lit ? ' lit' : ''));
  }
  function hero() {
    const c = colById('meditations'), e = ENTRIES[c.entries[0]];
    return `<section class="wb-hero-wrap">${link(readPath(e, c), `${img(artOf(e), 'wb-hero-art')}<span class="wb-hero-shade"></span><span class="wb-hero-copy"><small>Sample collection · ${esc(thinker(e).name)}</small><strong>${esc(e.title)}</strong><span class="wb-hero-deck">${esc(e.deck)}</span><span class="wb-hero-foot"><span class="wb-pill">Read · ${e.minutes} min</span><span>${plural(c.entries.length, 'chapter')}</span></span></span>`, 'wb-hero')}</section>`;
  }
  function reading() {
    const list = COLLECTIONS.filter(c => c.reading);
    if (!list.length) return '';
    return `<section class="wb-reading" aria-label="Currently reading"><div class="wb-head"><h2>Currently reading</h2><span>Sample</span></div><ol class="wb-reading-list">${list.map(c => {
      const e = nextOf(c), n = chapNo(e, c), done = readCount(c), pct = Math.round(100 * done / c.entries.length);
      return `<li>${link(readPath(e, c), `<span class="wb-reading-art">${colArt(c, 'wb-portrait')}</span><span class="wb-reading-copy"><small>${esc(FORMS[c.form])} · ${esc(c.title)}</small><strong>Chapter ${n} of ${c.entries.length}</strong><span class="wb-reading-next">${esc(e.title)}</span><span class="wb-reading-bar" aria-label="${done} of ${c.entries.length} chapters read"><span style="width:${pct}%"></span></span></span><span class="wb-reading-go" aria-hidden="true">›</span>`, 'wb-reading-row')}</li>`;
    }).join('')}</ol></section>`;
  }
  function suggested() {
    const list = COLLECTIONS.filter(c => !c.reading);
    return `<section class="wb-shelf-wrap wb-suggested" aria-label="Suggested"><div class="wb-head"><h2>Suggested</h2>${link('browse', `Browse all ${COLLECTIONS.length} ›`, 'wb-head-link')}</div><div class="wb-shelf">${list.map((c, i) => colCover(c, { lit: i === 0 })).join('')}</div></section>`;
  }
  const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function search(q) {
    const terms = fold(q).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
    if (!terms.length) return null;
    const hit = text => terms.every(t => fold(text).includes(t));
    const cols = COLLECTIONS.filter(c => hit([c.title, c.kind, FORMS[c.form], c.bio, c.thinkers.map(t => THINKERS[t].name).join(' ')].join(' ')));
    const chs = Object.values(ENTRIES).filter(e => hit([e.title, e.deck, thinker(e).name].join(' ')));
    return { cols, chs };
  }
  function results() {
    const q = query.trim(), r = search(q); if (!r) return '';
    const colRow = c => link('collection/' + c.id, `<span class="wb-res-art">${colArt(c, 'wb-portrait')}</span><span class="wb-res-copy"><small>${esc(FORMS[c.form])} · ${esc(c.kind)}</small><strong>${esc(c.title)}</strong><span>${plural(c.entries.length, 'chapter')}</span></span>`, 'wb-res wb-res-col');
    const chRow = e => { const c = colOf(e); return link(readPath(e, c), `<span class="wb-res-art wb-res-ch">${img(artOf(e), 'wb-portrait')}</span><span class="wb-res-copy"><small>${esc(dotted(c.title, 'Chapter ' + chapNo(e, c)))}</small><strong>${esc(e.title)}</strong><span>${esc(e.deck)}</span></span>`, 'wb-res wb-res-chap'); };
    const none = !r.cols.length && !r.chs.length;
    return `<div class="wb-results" aria-live="polite">${none ? `<p class="wb-quiet-note">Nothing in this sample on “${esc(q)}”.</p>` : ''}${r.cols.length ? `<h3 class="wb-res-h">Collections</h3>${r.cols.map(colRow).join('')}` : ''}${r.chs.length ? `<h3 class="wb-res-h">Chapters <span>${r.chs.length}</span></h3>${r.chs.map(chRow).join('')}` : ''}</div>`;
  }
  function searchBox() {
    return `<section class="wb-search" aria-label="Search"><div class="wb-head"><h2>Search</h2><span>This sample only</span></div><div class="wb-search-field">${icon('search')}<input type="search" id="wb-q" enterkeyhint="search" autocomplete="off" placeholder="Search by topic, theme or thinker" aria-label="Search the sample library" value="${esc(query)}"></div><div id="wb-results">${results()}</div></section>`;
  }
  function picks() {
    const list = ['smith-1', 'spinoza-1', 'ava-1', 'mirror-1'].map(id => ENTRIES[id]);
    return `<section class="wb-picks-wrap" aria-label="Sample picks"><div class="wb-head"><h2>Sample picks</h2><span>A mix of minds</span></div><div class="wb-picks">${list.map(e => link(readPath(e, colOf(e)), `${img(artOf(e), 'wb-pick-art')}<span class="wb-pick-copy"><small>${esc(thinker(e).name)}</small><strong>${esc(e.title)}</strong><span>${e.minutes} min</span></span>`, 'wb-pick')).join('')}</div></section>`;
  }
  const VIEWS = { 'to-read': 'To read', starred: 'Starred', archived: 'Archived', all: 'All' };
  const matches = (e, v) => v === 'starred' ? e.saved : v === 'archived' ? e.archived : v === 'all' ? true : !e.archived;
  function viewTabs(view) {
    const list = Object.values(ENTRIES);
    return `<nav class="wisdom-views" aria-label="Wisdom library views">${Object.entries(VIEWS).map(([id, name]) => link('library/' + id, `${name} <span>${list.filter(e => matches(e, id)).length}</span>`, view === id ? 'selected' : '', view === id ? ' aria-current="page"' : '')).join('')}</nav>`;
  }
  function entryActions(e) {
    return `<div class="wisdom-card-actions"><button class="wisdom-action" data-entry="${e.id}" data-field="saved" aria-pressed="${e.saved}" aria-label="${e.saved ? 'Unstar' : 'Star'} ${esc(e.title)}">${icon('star')}<span>${e.saved ? 'Starred' : 'Star'}</span></button>${e.archived ? `<button class="wisdom-action" data-entry="${e.id}" data-field="archived" aria-label="Restore ${esc(e.title)}">${icon('undo')}<span>Restore</span></button>` : `<button class="wisdom-action" data-entry="${e.id}" data-field="done" aria-label="Done reading ${esc(e.title)}">${icon('check')}<span>Done</span></button><button class="wisdom-action" data-entry="${e.id}" data-field="archived" aria-label="Archive ${esc(e.title)}">${icon('archive')}<span>Archive</span></button>`}</div>`;
  }
  const status = e => `${e.saved ? ' · ★ Starred' : ''}${e.archived ? ' · Archived' : e.read ? ' · Read' : ''}`;
  function row(e) {
    const c = colOf(e), t = thinker(e);
    return `<article class="wisdom-row wisdom-card wb-row ${e.read ? 'is-read' : ''}" data-wisdom-id="${e.id}"><div class="wisdom-card-main">${link(readPath(e, c), `<span class="wisdom-row-title">${esc(e.title)}</span>`, 'wisdom-title-link')}<div class="wisdom-pubrow">${link('collection/' + c.id, `<span class="wisdom-byline-name">${esc(t.name)}</span>`, 'wisdom-byline')}<span class="wb-dot">·</span><span class="wb-chap">Chapter ${chapNo(e, c)}</span></div>${link(readPath(e, c), `<p class="wisdom-description">${esc(e.deck)}</p>`, 'wisdom-preview-link')}<div class="wisdom-card-foot"><span class="wisdom-meta">${e.minutes} min${status(e)}</span>${entryActions(e)}</div></div>${link(readPath(e, c), img(artOf(e), 'wb-thumb') , 'wb-thumb-link', ' tabindex="-1" aria-hidden="true"')}</article>`;
  }
  function library(view) {
    const list = Object.values(ENTRIES).filter(e => matches(e, view));
    const empty = view === 'starred' ? 'Star a chapter to keep it here.' : view === 'archived' ? 'Finished chapters stay here. Done marks a chapter finished; Archive puts it aside.' : 'You’re caught up.';
    return `<section class="wisdom-library"><div class="wisdom-section-label"><h2>${VIEWS[view]}</h2></div>${list.map(row).join('') || `<p class="wisdom-empty">${empty}</p>`}</section>`;
  }
  const backRound = (label = 'Back') => `<button class="wb-round" data-back aria-label="${esc(label)}">‹</button>`;
  function browse() {
    const group = (form, title) => { const list = COLLECTIONS.filter(c => c.form === form); return list.length ? `<section class="wb-all-group" data-form="${form}"><div class="wb-head"><h2>${title}</h2><span>${list.length}</span></div><div class="wb-all-grid">${list.map(c => colCover(c, { form: false })).join('')}</div></section>` : ''; };
    return `<section class="wb-all-thinkers wb-browse"><header class="wb-all-top">${backRound()}<h1>Browse</h1></header>${group('book', 'Books')}${group('thinker', 'Thinkers')}${group('theme', 'Themes')}<p class="wb-browse-foot wb-head-link">${COLLECTIONS.length} sample collections · read-only</p></section>`;
  }
  function collection(id) {
    const c = colById(id); if (!c) return missing();
    const start = nextOf(c), done = readCount(c);
    const toc = c.entries.map(eid => { const e = ENTRIES[eid], next = start.id === e.id; return `<li class="${e.read ? 'is-read' : ''} ${next ? 'is-next' : ''}">${link(readPath(e, c), `<span class="wb-ep-art">${img(artOf(e), 'wb-toc-art')}${e.read ? '<span class="wb-ep-done">✓</span>' : ''}</span><span class="wb-toc-copy"><small>${dotted('Chapter ' + chapNo(e, c), e.minutes + ' min')}${next ? ' · <b>Next</b>' : ''}</small><strong>${esc(e.title)}</strong><span>${esc(e.deck)}</span></span>`)}</li>`; }).join('');
    const cta = link(readPath(start, c), `${done ? 'Continue' : 'Start'} · Chapter ${chapNo(start, c)} →`, 'wb-primary');
    return `<section class="wisdom-thinker wb-book wb-collection"><header class="wb-book-hero">${colArt(c, 'wb-book-portrait')}<span class="wb-hero-shade"></span><div class="wb-book-top">${backRound()}</div><div class="wb-book-copy"><small><span class="wb-form-tag">${esc(FORMS[c.form])}</span> ${esc(c.kind)} · ${esc(c.by)}</small><h1>${esc(c.title)}</h1><div class="wb-book-stats">${[plural(c.entries.length, 'chapter'), minutes(c) + ' min', done ? done + ' read' : ''].filter(Boolean).map(x => `<span>${x}</span>`).join('')}</div><p>${esc(c.bio)}</p><div class="wb-book-cta">${cta}</div></div></header><section class="wb-season"><div class="wb-season-head"><h2>Chapters</h2><span>${plural(c.entries.length, 'chapter')}</span></div><ol class="wb-toc">${toc}</ol></section><p class="wb-book-source">${esc(c.id === 'meditations' ? LONG : 'Sample collection for the Wizard OS preview.')}</p></section>`;
  }
  function inline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>'); }
  function markdown(text) {
    return text.trim().split(/\n\s*\n/).map(b => {
      b = b.trim(); const h = b.match(/^## (.+)$/);
      if (h) return `<h2>${inline(h[1])}</h2>`;
      if (b.startsWith('> ')) return `<blockquote>${inline(b.replace(/^> ?/gm, ''))}</blockquote>`;
      if (b.startsWith(':: ')) return `<p class="wb-keyline">${inline(b.slice(3))}</p>`;
      return `<p>${inline(b)}</p>`;
    }).join('');
  }
  function reader(id, cid) {
    const e = ENTRIES[id]; if (!e) return missing();
    const t = thinker(e), c = colOf(e, cid), i = c.entries.indexOf(e.id), next = ENTRIES[c.entries[i + 1]];
    const count = `Chapter ${i + 1} of ${c.entries.length}`;
    const epigraph = e.epigraph ? `<section class="wb-slide wb-epigraph"><div><span class="wb-label">${esc(e.epigraph.label)}</span><blockquote>${inline(e.epigraph.text)}</blockquote><span class="wb-attrib">— ${esc(t.name)}</span></div></section>` : '';
    const end = next ? link(readPath(next, c), `${img(artOf(next), 'wb-next-art')}<span class="wb-hero-shade"></span><span class="wb-next-copy"><small>${esc(dotted('Next', 'Chapter ' + (i + 2)))}</small><strong>${esc(next.title)}</strong><span class="wb-primary">Keep reading →</span></span>`, 'wb-next', ' data-replace="1"')
      : `<button class="wb-back-quiet" data-back>Back to the library</button>`;
    const rate = `<div class="wb-rate" role="group" aria-label="Rate this chapter"><span class="wb-rate-q">How was it?</span><div class="wb-rate-btns"><button class="wb-thumb-btn ${e.rating === 1 ? 'on' : ''}" data-rate="${e.id}" data-value="1" aria-pressed="${e.rating === 1}" aria-label="Thumbs up">${icon('up')}</button><button class="wb-thumb-btn ${e.rating === -1 ? 'on' : ''}" data-rate="${e.id}" data-value="-1" aria-pressed="${e.rating === -1}" aria-label="Thumbs down">${icon('down')}</button></div></div>`;
    const quiet = `<div class="wb-end-quiet"><button class="wb-quiet ${e.saved ? 'on' : ''}" data-entry="${e.id}" data-field="saved" aria-pressed="${e.saved}" aria-label="${e.saved ? 'Unstar' : 'Star'} ${esc(e.title)}">${icon('star')}<span>${e.saved ? 'Starred' : 'Star'}</span></button></div>`;
    return `<article class="wisdom-reader wb-reader" data-read="${e.id}" data-size="${size}"><header class="wb-top">${backRound('Back to the library')}<div class="wb-top-title"><strong>${esc(t.name)}</strong><span>${esc(dotted(count, e.title))}</span></div><div class="wisdom-size" role="group" aria-label="Text size"><button class="wb-round" data-size="-1" aria-label="Smaller text" ${size <= 0 ? 'disabled' : ''}>A−</button><button class="wb-round" data-size="1" aria-label="Larger text" ${size >= 3 ? 'disabled' : ''}>A+</button></div></header><div class="wb-stage"><div class="wb-track"><section class="wb-slide wb-opener">${img(artOf(e), 'wb-opener-art')}<span class="wb-hero-shade"></span><div class="wb-opener-copy"><small>${esc(dotted(c.title, count))}</small><span class="wb-sample-tag">Sample</span><h1>${esc(e.title)}</h1><p>${esc(e.deck)}</p><span class="wb-swipe">${e.minutes} min · Swipe to begin <b>→</b></span></div></section>${epigraph}<div class="wb-flow wisdom-body">${markdown(e.body)}<span class="wb-sentinel"></span></div><section class="wb-slide wb-end"><div class="wb-end-head"><small>${esc(dotted('✓ Finished', count))}</small><h2>${esc(e.title)}</h2></div>${rate}${end}${quiet}<p class="wisdom-provenance">${esc(e.source)}</p></section></div></div><footer class="wb-foot"><div class="wb-bar"><span></span></div><div class="wb-foot-row"><span class="wb-count" aria-live="polite"></span><span class="wb-left"></span></div></footer></article>`;
  }
  function missing() { return `<div class="wisdom-notice"><h2>That read isn’t in this sample</h2><button class="wb-back-quiet" data-back>Back to the library</button></div>`; }
  function home() {
    return `<div class="wisdom-home wb-home"><h1 class="sr-only">Wisdom library</h1>${hero()}${reading()}${suggested()}${searchBox()}${picks()}<div class="wb-library-links">${viewTabs('to-read')}</div><p class="wb-sample-note">Sample library for the Wizard OS preview. Meditations is George Long’s public-domain translation; the other chapters are short sample prose written for this preview. Nothing here is fetched, personal or saved.</p></div>`;
  }
  function view(r) {
    if (r.kind === 'read') return reader(r.id, r.col);
    if (r.kind === 'browse') return browse();
    if (r.kind === 'collection') return collection(r.id);
    if (r.kind === 'library') { const v = VIEWS[r.id] ? r.id : 'to-read'; return `<h1 class="sr-only">Library · ${VIEWS[v]}</h1>${viewTabs(v)}<div class="wisdom-home">${library(v)}</div>`; }
    return home();
  }

  /* ---------------- render + bind ---------------- */
  function render() {
    const r = top();
    root.classList.toggle('wb-open', r.kind === 'read');
    $('#app').innerHTML = `<div class="w-layout"><main class="w-main" id="content">${view(r)}</main></div>`;
    document.title = r.kind === 'read' ? `${ENTRIES[r.id]?.title || 'Reading'} · Wisdom (sample)` : 'Wisdom · Sample';
    document.querySelectorAll('#app img').forEach(i => { i.onerror = () => { i.style.display = 'none'; }; });
    bindSearch();
    if (r.kind === 'read') { page = 0; readingProgress = 0; layout(false); watchStage(); }
  }
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }
  function bindSearch() {
    const q = $('#wb-q'); if (!q) return;
    q.oninput = () => { query = q.value; $('#wb-results').innerHTML = results(); };
    q.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); q.blur(); } };
  }
  function react(e, field) {
    if (field === 'saved') { e.saved = !e.saved; toast(e.saved ? 'Starred (this page only).' : 'Star removed.'); }
    else if (field === 'done') { e.read = e.archived = true; toast('Finished and archived (this page only).'); }
    else if (field === 'archived') { e.archived = !e.archived; toast(e.archived ? 'Archived (this page only).' : 'Restored to To read.'); }
    const y = window.scrollY, keep = top().kind === 'read' ? page : null;
    render(); window.scrollTo(0, y); if (keep !== null) goPage(keep, false);
  }
  document.addEventListener('click', ev => {
    const a = ev.target.closest('[data-go]');
    if (a) { ev.preventDefault(); if (suppressClick) return; navigate(a.dataset.go, { replace: !!a.dataset.replace }); return; }
    if (ev.target.closest('[data-back]')) { ev.preventDefault(); back(); return; }
    const en = ev.target.closest('[data-entry]');
    if (en) { react(ENTRIES[en.dataset.entry], en.dataset.field); return; }
    const rt = ev.target.closest('[data-rate]');
    if (rt) { const e = ENTRIES[rt.dataset.rate], v = +rt.dataset.value; e.rating = e.rating === v ? 0 : v; toast(e.rating > 0 ? 'Noted. More like this (sample only).' : e.rating < 0 ? 'Noted. Less like this (sample only).' : 'Rating cleared.'); react(e, ''); return; }
    const sz = ev.target.closest('[data-size]');
    if (sz && !sz.disabled) { size = Math.max(0, Math.min(3, size + +sz.dataset.size)); const r = reader$(); if (r) { r.dataset.size = size; r.querySelector('[data-size="-1"]').disabled = size <= 0; r.querySelector('[data-size="1"]').disabled = size >= 3; layout(true); } }
  });

  /* ---------------- paged reader (shipped layout(): one CSS column per page) ---------------- */
  let page = 0, pages = 1, readingProgress = 0, pageW = 0, pageH = 0, textFrom = 0, textPages = 1, suppressClick = false, ro = null;
  const reader$ = () => document.querySelector('.wb-reader');
  function layout(keep) {
    const r = reader$(); if (!r) return;
    const stage = r.querySelector('.wb-stage'), flow = r.querySelector('.wb-flow');
    const W = stage.clientWidth, H = stage.clientHeight; if (W < 60 || H < 60) return; // parked or not laid out yet: the observer retries
    // Resizes must not re-bookmark rounded pages: that compounds drift across fullscreen transitions.
    const frac = keep ? readingProgress : null;
    pageW = W; pageH = H;
    const PAD = W > 760 ? Math.round((W - 660) / 2) : Math.max(24, Math.round(W * .075));
    const T = r.querySelector('.wb-top').offsetHeight + 6, B = r.querySelector('.wb-foot').offsetHeight + 18;
    flow.style.cssText = `width:${W}px;height:${H}px;padding:${T}px ${PAD}px ${B}px;column-width:${W - 2 * PAD}px;column-gap:${2 * PAD}px;column-fill:auto`;
    const s = flow.querySelector('.wb-sentinel'), left = s.getBoundingClientRect().left - flow.getBoundingClientRect().left;
    textPages = Math.max(1, Math.floor(left / W) + 1);
    flow.style.width = (textPages * W) + 'px'; flow.style.columnCount = textPages;
    r.querySelectorAll('.wb-slide').forEach(x => { x.style.width = W + 'px'; x.style.height = H + 'px'; });
    textFrom = r.querySelectorAll('.wb-track>.wb-slide:not(.wb-end)').length;
    pages = textFrom + textPages + 1;
    if (frac !== null) page = Math.round(frac * (pages - 1));
    goPage(page, false, true);
  }
  function goPage(n, animate = true, fromLayout = false) {
    const r = reader$(); if (!r || !pageW) return;
    const track = r.querySelector('.wb-track');
    page = Math.max(0, Math.min(pages - 1, n));
    if (!fromLayout) readingProgress = pages > 1 ? page / (pages - 1) : 0;
    track.style.transition = animate ? 'transform .34s cubic-bezier(.2,.8,.2,1)' : 'none';
    track.style.transform = `translate3d(${-page * pageW}px,0,0)`;
    r.querySelector('.wb-count').textContent = `${page + 1} / ${pages}`;
    r.querySelector('.wb-bar>span').style.transform = `scaleX(${pages > 1 ? page / (pages - 1) : 1})`;
    const e = ENTRIES[r.dataset.read], t = Math.min(textPages, Math.max(0, page - textFrom + 1));
    r.querySelector('.wb-left').textContent = page >= pages - 1 ? 'Finished' : page < textFrom ? `${e.minutes} min read` : `${Math.max(1, Math.ceil(e.minutes * (1 - t / textPages)))} min left`;
    r.dataset.at = page === 0 ? 'opener' : page >= pages - 1 ? 'end' : 'text';
    if (page >= pages - 1) e.read = true; // local only
  }
  function step(d) {
    const r = reader$(); if (!r) return;
    if (d > 0 && page >= pages - 1) { const n = r.querySelector('.wb-next'); if (n) navigate(n.dataset.go, { replace: true }); return; }
    goPage(page + d);
  }
  function watchStage() {
    const stage = reader$()?.querySelector('.wb-stage'); if (!stage) return;
    if (!ro && 'ResizeObserver' in window) ro = new ResizeObserver(() => { const s = reader$()?.querySelector('.wb-stage'); if (s && (s.clientWidth !== pageW || s.clientHeight !== pageH)) layout(true); });
    if (ro) { ro.disconnect(); ro.observe(stage); }
    let d = null;
    stage.addEventListener('pointerdown', e => { if (e.target.closest('a,button,input')) return; d = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    stage.addEventListener('pointerup', e => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y; d = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); step(dx < 0 ? 1 : -1); return; }
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && !e.target.closest('.wb-end')) step(e.clientX > stage.clientWidth * .35 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => { d = null; });
  }
  document.addEventListener('keydown', e => {
    if (!reader$() || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
  });
  addEventListener('resize', () => { clearTimeout(layout.t); layout.t = setTimeout(() => layout(true), 120); });

  window.WzFixture?.init({ back, toast });
  render();
})();
