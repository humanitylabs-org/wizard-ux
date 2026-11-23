// Notifications Reply on every skin: the Reply bridge, the reply bubble above an empty New chat composer and the
// quote card in the sent thread are core behaviour, not a Miguel-skin feature. James's five skins get a real bubble
// drawn from their own tokens (no hard-coded colours, no fonts), while Miguel's skins keep their flat quote line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { between, block as fn, runRecording } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const chats = withParts(read('web/core/chats.js')), services = read('web/core/app-services.js'), css = read('web/core/chats.css');
const JAMES = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const block = (src, a, b) => { const s = src.indexOf(a), e = src.indexOf(b, s + a.length); assert.ok(s >= 0 && e > s, a); return src.slice(s, e); };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The real chat kit (drafts, KIT.reply) in node:vm, with its own storage.
function kit() {
  const store = new Map();
  const ctx = { location: { origin: 'https://wizard.test', hostname: 'wizard.test', href: 'https://wizard.test/wizard-os-home/' },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx);
  return { KIT: ctx.WosChat, localStorage: ctx.localStorage };
}
// The real Reply path of core Chats (openContextDraft -> refreshReply -> replyBubble, replyCard), on one skin.
function replyOn(skin) {
  const { KIT, localStorage } = kit(), doc = createDocument();
  doc.documentElement.setAttribute('data-skin', skin);
  doc.body.innerHTML = '<div data-chats="w1"><form data-chform><textarea></textarea></form></div>';
  const W = { w1: { id: 'w1', thread: null } };
  const ctx = runRecording([fn(chats, '  function openContextDraft('), between(chats, '  const draftKey = w =>', '\n'), fn(chats, '  function replyBubble(r) {'), fn(chats, '  function replyCard(r) {'), fn(chats, '  function refreshReply(wid) {'),
    'globalThis.api = { openContextDraft, refreshReply, replyCard };'].join('\n'),
  { KIT, localStorage, document: doc, W, SAVED_NEW: /^new(:[a-z0-9]{4,40})?$/, Date, Math, esc, clip: (t, n) => String(t).slice(0, n), winAgent: () => '', chanDraftKey: null,
    elOf: () => doc.querySelector('[data-chats="w1"]'),
    openNewDraft: (wid, slot) => { const all = KIT.drafts.all(); all.new = all[slot]; delete all[slot]; localStorage.setItem('wos.chat.drafts.v1', JSON.stringify(all)); W[wid].thread = '__new__'; } });
  return { ctx, KIT, doc, W };
}
const rule = sel => { const m = css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); assert.ok(m, sel); return m[2]; };

test('the Reply bridge and bubble are not gated on a skin', () => {
  const bridge = block(services, 'openContextDraft(data)', 'openThread(id, opts)');
  const open = block(chats, '  function openContextDraft(', '  function discardDraft(');
  const refresh = block(chats, '  function refreshReply(', '  function refreshCompose(');
  for (const src of [bridge, open, refresh]) {
    assert.doesNotMatch(src, /dataset\.skin|OURS|obsidian|landscapes|\bours\(/);
  }
  // Run the real Reply on every skin: the New chat composer stays empty, the item waits as the draft's reply, and the
  // bubble is drawn above the composer; the sent message reads it back as the quote card.
  const item = { title: 'Disk almost full', message: 'Root volume at 93%.' };
  for (const skin of [...JAMES, 'obsidian', 'obsidian-light', 'landscapes', '']) {
    const r = replyOn(skin);
    const res = r.ctx.api.openContextDraft('w1', 'notifications:n42', item);
    assert.equal(res.kind, 'unsent-draft', skin);
    assert.equal(r.KIT.drafts.get('new').text, '', skin + ': the composer stays empty');
    assert.equal(r.KIT.drafts.get('new').reply.key, 'notifications:n42', skin);
    r.ctx.api.refreshReply('w1');
    const form = r.doc.querySelector('[data-chform]');
    assert.ok(form.classList.contains('has-reply'), skin);
    const bubble = form.querySelector('[data-chreply]');
    assert.ok(bubble, skin + ': the reply bubble');
    assert.equal(bubble.querySelector('b').textContent, 'Disk almost full', skin);
    assert.equal(bubble.querySelector('.ch-reply-x').getAttribute('aria-label'), 'Remove quoted item from this reply', skin);
    const card = createDocument(); card.body.innerHTML = r.ctx.api.replyCard(r.KIT.drafts.get('new').reply);
    assert.equal(card.querySelector('.ch-rq b').textContent, 'Disk almost full', skin + ': the sent message shows the quote card');
  }
  // The thread render puts the bubble in for every skin: any draft carrying an item shows it (New chats of a
  // pinned agent excepted); app-hosted threads (Wisdom passages) use the same bubble.
  const rplLine = between(chats, '    const rpl = ', '\n');
  const rpl = (isNew, TAG) => runRecording(rplLine.replace('const rpl', 'globalThis.rpl') , { isNew, TAG, dkey: 'k', KIT: { drafts: { get: k => ({ reply: { key: k } }) } } }).rpl;
  assert.equal(rpl(false, null).key, 'k');
  assert.equal(rpl(true, null).key, 'k', 'a New chat on the main agent shows its item');
  assert.equal(rpl(false, 'agent').key, 'k', 'a pinned agent\'s thread shows its item');
  assert.equal(rpl(true, 'agent'), null, 'a New chat of a pinned agent carries none');
  // the real thread template (chats-threadpaint.js) draws that item's bubble inside the composer, on every skin
  const paintSrc = read('web/core/chats-threadpaint.js');
  const tplAt = paintSrc.indexOf('    const threadHTML = `'), tpl = paintSrc.slice(tplAt, paintSrc.indexOf('</div>`;\n', tplAt) + 8);
  const thread = item => runRecording(tpl.replace('const threadHTML', 'globalThis.out'), { rpl: item, esc: String, TAG: '', NV: null, s: null,
    isNew: true, msw: '', c: { files: [] }, draft: '', NQ: false, DL: null, privTag: '', chip: '', incognitoAction: '', tacts: '', fail: '', msgs: '',
    replyBubble: x => x ? `<div data-chreply="${x.key}"></div>` : '' }).out;
  const drawn = createDocument(); drawn.body.innerHTML = thread({ key: 'k' });
  assert.ok(drawn.querySelector('form[data-part="composer"] [data-chreply="k"]'), 'the bubble sits in the composer');
  drawn.body.innerHTML = thread(null); assert.equal(drawn.querySelector('[data-chreply]'), null, 'no item: no bubble');
  // a sent message's turn (the real turnHtml with the real replyCard) carries its quote card
  const turn = runRecording([fn(chats, '  function turnHtml(c, tn, last, working, helperStatus, reconnect, tt = true, needs = \'\') {'), fn(chats, '  function replyCard(r) {'), 'globalThis.turn = turnHtml;'].join('\n'),
    { esc, clip: (t, n) => String(t).slice(0, n), md: t => esc(t), userMedia: () => '', timeTag: () => '', quoteBtn: () => '', msgIds: () => '', window: {}, KIT: kit().KIT });
  const sent = createDocument(); sent.body.innerHTML = turn.turn({}, { notes: [], media: [], tools: [], u: { text: 'Is it safe?', at: 5, reply: { key: 'notifications:n42', title: 'Disk almost full', message: 'Root volume at 93%.' } } }, true, false);
  assert.equal(sent.querySelector('.msg.u.has-rq .bub .ch-rq b')?.textContent, 'Disk almost full', 'the sent message shows the quote card');
});

test('core draws a real bubble (rounded, tinted, accent rule) from skin tokens only', () => {
  // the bubble and quote card the real Reply drew, through core chats.css
  const item = { title: 'Disk almost full', message: 'Root volume at 93%.' };
  for (const skin of JAMES) {
    const r = replyOn(skin);
    r.ctx.api.openContextDraft('w1', 'notifications:n42', item); r.ctx.api.refreshReply('w1');
    const bubble = r.doc.querySelector('[data-chreply]');
    const form = r.doc.querySelector('[data-chform]'), compose = r.doc.createElement('div'); compose.className = 'ch-compose';
    form.parentNode.appendChild(compose); compose.appendChild(form); // where the composer sits in the drawn Chats
    const holder = r.doc.createElement('div'); holder.className = 'msg'; holder.innerHTML = r.ctx.api.replyCard(r.KIT.drafts.get('new').reply); r.doc.body.appendChild(holder);
    const card = holder.querySelector('.ch-rq');
    const won = el => cascade(el, css), b = won(bubble), c = won(card);
    assert.ok(bubble.classList.contains('ch-reply'), skin);
    assert.equal(b['border-radius']?.value, '12px', `${skin}: rounded`);
    assert.equal(b.background?.value, 'color-mix(in srgb, var(--violet) 12%, transparent)', `${skin}: tinted with the skin accent`);
    assert.match(b['border-left']?.value || '', /^3px solid var\(--violet-2/, `${skin}: accent rule`);
    assert.equal(c['border-radius']?.value, '10px', `${skin}: the sent quote card is rounded`);
    assert.equal(won(bubble.querySelector('.ch-reply-x')).width?.value, '44px', `${skin}: a 44px remove target`);
    for (const el of [bubble, ...bubble.querySelectorAll('*'), card, ...card.querySelectorAll('*')]) for (const [prop, d] of Object.entries(won(el))) {
      if (!/\.ch-reply|\.ch-rq/.test(d.selector)) continue; // the reply rules themselves
      assert.doesNotMatch(d.value, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${skin} ${el.className} ${prop}: skin tokens, not literal colours`);
      assert.notEqual(prop, 'font-family', `${skin}: no fonts in core reply styles`);
      assert.doesNotMatch(d.selector, /data-skin/, 'no per-skin rules in core');
    }
  }
});

test("James's skins have no rule that hides or flattens the reply bubble", () => {
  for (const f of ['web/core/skins.css', 'web/core/chats.css', 'web/styles.css']) {
    const src = read(f);
    for (const id of JAMES) {
      assert.doesNotMatch(src, new RegExp(`data-skin=["']?${id}["']?\\][^{]*\\.ch-(reply|rq)`), `${f} restyles the reply for ${id}`);
    }
  }
});

test("Miguel's skins keep their flat quote line (square, untinted) over the new core bubble", () => {
  // The real bubble and quote card, in a skeleton of the composer and a sent message, through core chats.css + the skin.
  const r = replyOn('nebula');
  r.ctx.api.openContextDraft('w1', 'notifications:n42', { title: 'Backup finished', message: 'Done in 4m.' });
  const reply = r.KIT.drafts.get('new').reply;
  r.ctx.api.refreshReply('w1');
  const bubble = r.doc.querySelector('[data-chreply]').outerHTML, card = r.ctx.api.replyCard(reply);
  const look = (skin, sheet) => {
    const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin);
    doc.body.innerHTML = `<form class="ch-compose">${bubble}</form><div class="msg u"><div class="bub">${card}</div></div>`;
    const sheets = [css, ...(sheet ? [read(sheet)] : [])].join('\n'); // one text: source order across sheets
    const pick = (el, ...ps) => Object.fromEntries(ps.map(p => [p, cascade(el, sheets)[p]?.value]));
    return { bubble: pick(doc.querySelector('.ch-compose .ch-reply'), 'background', 'border-radius'), card: pick(doc.querySelector('.msg.u .bub .ch-rq'), 'background', 'border-radius') };
  };
  for (const [f, skin] of [['web/skins/obsidian/skin.css', 'obsidian'], ['web/skins/obsidian/skin.css', 'obsidian-light'], ['web/skins/landscapes/skin.css', 'landscapes']]) {
    const got = look(skin, f);
    assert.deepEqual(got.bubble, { background: 'none', 'border-radius': '0' }, `${f} ${skin}: flat quote line above the composer`);
    assert.deepEqual(got.card, { background: 'none', 'border-radius': '0' }, `${f} ${skin}: flat quote line in the sent message`);
  }
  // every other skin keeps the core bubble
  const core = look('nebula');
  assert.equal(core.bubble['border-radius'], '12px');
  assert.equal(core.card['border-radius'], '10px');
});
