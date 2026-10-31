/* My Changes · clickable DEMO (wizard-os PR #316 "Friendly sharing", James 31 Oct 2026). Synthetic data only.
 *
 * Two pieces, both clearly marked DEMO, neither touches the box, GitHub or any agent:
 *  1. A change card at the top of each thread where the owner asked for a change: where it stands
 *     (asked → built → on GitHub → staged / live on this box / only on your skin / undone) and the one next step.
 *     After a change lands, the card offers Undo / Keep / Share with everyone (#316).
 *  2. Settings › My Changes: Mine / Testers / Everyone, the same changes from the other side.
 *
 *   WosChangeCard.banner(session) → card HTML for that thread, or ''   (chats.js thread slot, like WosBoomerang)
 *   WosChangeCard.act(el)         → handles a tap inside a card
 * State is this device's localStorage ('wos.changes.demo.v1'); Reset demo puts it back.
 */
(() => {
  'use strict';
  const KEY = 'wos.changes.demo.v1';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = () => window.__wos || window.__wux;
  const toast = (i, t, ms) => host()?.toast?.(i, t, ms);
  const PR = n => `https://github.com/humanitylabs-org/wizard-ux/pull/${n}`;
  // Where a change can end up. Each thread shows its path; the last reached step is where it stands.
  const STEPS = { asked: 'Asked', built: 'Built', github: 'On GitHub', staged: 'Staged', live: 'Live on this box', skin: 'Only on your skin', undone: 'Undone' };
  const SEED = [
    { id: 'orb', thread: 'wizard_change_orb', title: 'Bigger orb on Home', who: 'mine', kind: 'tweak', at: 'skin',
      path: ['asked', 'built', 'skin'], note: 'A tweak on your skin. Nobody else sees it.', next: 'Keep it, share it with everyone, or undo it.', offer: true },
    { id: 'tweaks', thread: 'wizard_change_tweaks', title: 'Select all for tweaks', who: 'mine', kind: 'feature', at: 'staged', pr: 768,
      path: ['asked', 'built', 'github', 'staged'], note: 'Waiting on staging for you to try.', next: 'Open the staging link and try it. Then say Keep or Undo.' },
    { id: 'draft', thread: 'wizard_change_draft', title: 'Chats keeps my unsent draft', who: 'mine', kind: 'fix', at: 'live', pr: 751,
      path: ['asked', 'built', 'github', 'live'], note: 'Live on this box since this morning.', next: 'Nothing to do. Undo if anything looks wrong.', offer: true },
    { id: 'calendar', thread: 'wizard_change_calendar', title: 'Dark calendar', who: 'mine', kind: 'tweak', at: 'undone',
      path: ['asked', 'built', 'skin', 'undone'], note: 'You undid this yesterday.', next: 'Ask again any time to bring it back.' },
    { id: 'reply', thread: 'wizard_change_reply', title: 'Reply to selected words', who: 'mine', kind: 'feature', at: 'built',
      path: ['asked', 'built'], note: 'Built. Your Wizard is checking it before it goes to GitHub.', next: 'Nothing to do yet. You’ll get a staging link.' },
    { id: 'landscapes', title: 'Landscape pictures at night', who: 'testers', by: 'Miguel', kind: 'tweak', at: 'skin', path: ['asked', 'built', 'skin'], note: 'Miguel is trying it on his skin.', next: 'Try it on yours, or wait until it’s shared.' },
    { id: 'notes-swipe', title: 'Swipe a note to archive', who: 'testers', by: 'Novaire', kind: 'feature', at: 'staged', pr: 774, path: ['asked', 'built', 'github', 'staged'], note: 'Novaire is testing it on staging.', next: 'Try it on staging if you like.' },
    { id: 'quiet-hours', title: 'Quiet hours for notifications', who: 'everyone', by: 'James', kind: 'feature', at: 'live', pr: 755, path: ['asked', 'built', 'github', 'live'], note: 'On every Wizard.', next: 'Nothing to do.' },
  ];
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v?.version === 1 && Array.isArray(v.items)) return v; } catch (e) {} return { version: 1, items: SEED.map(x => ({ ...x })) }; };
  let S = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const byThread = sid => S.items.find(x => x.thread && x.thread === sid);
  const byId = id => S.items.find(x => x.id === id);

  const DEMO = '<span class="cc-demo" title="Synthetic example. Nothing here changes your Wizard.">Demo</span>';
  function stepper(it) {
    const shown = it.path.slice(); // each change shows only its own path
    return `<ol class="cc-steps" aria-label="Where this change stands">${shown.map((k, i) => `<li class="${i < shown.length - 1 ? 'done' : 'now'}${k === 'undone' ? ' undone' : ''}"><span>${esc(k === 'github' && it.pr ? `On GitHub #${it.pr}` : STEPS[k])}</span></li>`).join('')}</ol>`;
  }
  function actions(it, compact) {
    const a = [];
    if (it.pr) a.push(`<a class="cc-btn ghost" href="${PR(it.pr)}" target="_blank" rel="noopener noreferrer">View on GitHub</a>`);
    if (it.at === 'staged') a.push('<button type="button" class="cc-btn" data-cc="try">Try on staging</button>');
    if (it.offer && it.at !== 'undone') a.push('<button type="button" class="cc-btn ghost" data-cc="undo">Undo</button>', '<button type="button" class="cc-btn ghost" data-cc="keep">Keep</button>', '<button type="button" class="cc-btn" data-cc="share">Share with everyone</button>');
    if (it.at === 'undone') a.push('<button type="button" class="cc-btn ghost" data-cc="redo">Bring it back</button>');
    if (compact && it.who !== 'mine' && it.at === 'skin') a.push('<button type="button" class="cc-btn" data-cc="try-skin">Try on my skin</button>');
    return a.length ? `<div class="cc-acts">${a.join('')}</div>` : '';
  }
  function card(it, where) {
    const label = it.at === 'undone' ? 'Undone' : STEPS[it.at];
    return `<section class="cc-card cc-${esc(it.at)}" data-cc-id="${esc(it.id)}" data-cc-where="${where}" role="group" aria-label="Your change: ${esc(it.title)}">
      <header class="cc-h"><span class="cc-kicker">${where === 'thread' ? 'Your change' : it.who === 'mine' ? esc(it.kind) : esc(it.by || '')}</span>${DEMO}<b class="cc-state">${esc(label)}</b></header>
      <div class="cc-title">${esc(it.title)}</div>${stepper(it)}
      <p class="cc-note">${esc(it.note)}</p><p class="cc-next"><b>Next:</b> ${esc(it.next)}</p>${actions(it, where !== 'thread')}</section>`;
  }
  function banner(s) { const it = s && byThread(s.id); return it ? card(it, 'thread') : ''; }

  function act(el) {
    const b = el.closest?.('[data-cc]'); if (!b) return false;
    const box = b.closest('[data-cc-id]'), it = box && byId(box.dataset.ccId); if (!it) return false;
    const what = b.dataset.cc;
    if (what === 'undo') Object.assign(it, { at: 'undone', path: it.path.filter(k => k !== 'undone').concat('undone'), note: 'Undone just now. Your Wizard put it back the way it was.', next: 'Ask again any time to bring it back.', offer: false, was: { at: it.at, note: it.note, next: it.next, offer: it.offer } });
    else if (what === 'redo' && it.was) { Object.assign(it, it.was, { path: it.path.filter(k => k !== 'undone') }); delete it.was; }
    else if (what === 'redo') Object.assign(it, { at: 'skin', path: ['asked', 'built', 'skin'], note: 'Back on your skin.', next: 'Keep it, share it with everyone, or undo it.', offer: true });
    else if (what === 'keep') Object.assign(it, { offer: false, note: it.at === 'skin' ? 'Kept on your skin.' : 'Kept on this box.', next: 'Nothing to do. Share it later from Settings › My Changes.' });
    else if (what === 'share') Object.assign(it, { offer: false, who: 'everyone', by: 'You', at: 'github', pr: it.pr || 790, path: it.path.filter(k => !['skin', 'live'].includes(k)).concat(['github']), note: 'Sent for review so everyone can get it.', next: 'Nothing to do. You’ll see it here when it ships.' });
    else if (what === 'try') { toast('↗', 'Demo: this would open the staging link', 2200); return true; }
    else if (what === 'try-skin') { toast('✓', 'Demo: this would turn it on for your skin only', 2200); return true; }
    else return false;
    save(); toast('✓', 'Demo only · nothing changed on your Wizard', 1800);
    window.dispatchEvent(new CustomEvent('wos:changes-demo'));
    return true;
  }

  /* Settings › My Changes */
  let tab = 'mine';
  const TABS = [['mine', 'Mine'], ['testers', 'Testers'], ['everyone', 'Everyone']];
  function page() {
    const list = S.items.filter(x => x.who === tab);
    const intro = { mine: 'Changes you asked your Wizard for, and where each one stands.', testers: 'Changes other testers are trying. Try one on your skin first.', everyone: 'Changes shared with every Wizard.' }[tab];
    return `<div class="st-group cc-page" data-cc-page><h4>My Changes ${DEMO}</h4><p class="st-note">Clickable demo of wizard-os #316 with made-up changes. Nothing here changes your Wizard.</p>
      <div class="cc-tabs" role="tablist">${TABS.map(([id, l]) => `<button type="button" role="tab" data-cc-tab="${id}" aria-selected="${tab === id}">${l}<small>${S.items.filter(x => x.who === id).length}</small></button>`).join('')}</div>
      <p class="st-hint">${esc(intro)}</p>${list.map(it => card(it, 'settings')).join('') || '<p class="st-hint">Nothing here yet.</p>'}
      <button type="button" class="st-row" data-cc-reset><span class="st-tx"><b>Reset demo</b><small>Puts the made-up changes back</small></span></button></div>`;
  }
  function pageAct(ctx, el) {
    const t = el.closest('[data-cc-tab]'); if (t) { tab = t.dataset.ccTab; ctx.render?.(); return true; }
    if (el.closest('[data-cc-reset]')) { S = { version: 1, items: SEED.map(x => ({ ...x })) }; save(); ctx.render?.(); window.dispatchEvent(new CustomEvent('wos:changes-demo')); return true; }
    if (act(el)) { ctx.render?.(); return true; }
    return false;
  }
  window.WosChangeCard = { banner, act, page, get state() { return JSON.parse(JSON.stringify(S)); } };
  const reg = () => { try { window.WosSettings?.register({ id: 'my-changes-demo', aliases: ['my-changes'], page: 'my-changes', html: page, act: pageAct, subtitle: () => 'Demo' }); } catch (e) {} };
  if (window.WosSettings) reg(); else document.addEventListener('DOMContentLoaded', reg, { once: true });
})();
