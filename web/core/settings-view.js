/* Wizard UX core: Settings › the Settings view itself (mount: the page list, rendering a page, Back, focus and
 * dispatch), deep links into a page (route, with the one deferred System link and cancelWait) and the shared focus
 * trap. Moved verbatim out of core/settings.js (wizard-ux issue 1665: split the giant front-end files, no behaviour
 * change). settings.js calls this once, where the code used to be, with the closure names it reads, and keeps the
 * functions it returns under their old names. Loaded before settings.js everywhere that loads it.
 * The body below keeps settings.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.settingsParts = window.WizCore.settingsParts || {};
window.WizCore.settingsParts.view = function ({ attention, cardHtml, chatsHost, chatsName, esc, featurePages, features, filled, mounts, pageOf, PAGES, subtitle }) {
  function mount(root, adapter) {
    root.classList.add('st-root'); root.dataset.settingsRoot = '';
    const ctx = { ...adapter, root }, api = { render, focus, back, destroy, dispatch, context: ctx, get page() { return page; } };
    let skinImportMessage = '', page = '', confirm = null, wanted = '';
    // Search box (try-wizard issue 94, on for everyone): `query` filters the category list to the pages
    // that mention it and marks every place it appears on the open page; `searchScrolled` keeps background repaints
    // from scrolling again once the first hit was brought into view.
    let query = '', searchScrolled = '', searchPage = '';
    const desktop = adapter.shell === 'desktop';
    const effectivePage = () => page || (desktop ? (filled('overview')() ? 'overview' : 'appearance') : '');
    // A search pick (below) shows a page beside the list without opening it, so a narrow window keeps the list.
    const openPage = () => (!page && searchPage) || effectivePage();
    ctx.render = () => render(true);
    ctx.paintUsage = () => { const g = root.querySelector('[data-usage]'); if (g) g.outerHTML = window.WosUsage.html(); paintSubtitles(); };
    function paintSubtitles() {
      root.querySelectorAll?.('[data-st-subtitle]').forEach(el => { el.textContent = subtitle(el.dataset.stSubtitle, ctx); });
    }
    function render(force = false) {
      // Background polls must not replace an active form under a keystroke.
      // Explicit feature actions render via ctx.render; skin changes use tokens.
      if (force !== true && [...features.values()].some(f => pageOf(f) === openPage() && f.deferRefresh?.(ctx))) return;
      if (adapter.visible && !adapter.visible()) return;
      const top = root.scrollTop, paneTop = root.querySelector('.st-page')?.scrollTop || 0, indexTop = root.querySelector('.st-index')?.scrollTop || 0, active = root.contains(document.activeElement) ? document.activeElement : null;
      const attrs = active ? [...active.attributes].filter(a => a.name.startsWith('data-')) : [];
      const record = active?.closest('[data-ubid]')?.dataset.ubid;
      const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
      const shown = PAGES.filter(p => !p.available || p.available(ctx));
      // A page whose availability is still being checked (a cold deep link) opens once it turns out available.
      if (wanted && !page && shown.some(p => p.id === wanted)) page = wanted;
      if (wanted && (page === wanted || !PAGES.find(p => p.id === wanted)?.pending?.())) wanted = '';
      if (page && !shown.some(p => p.id === page)) { if (PAGES.find(p => p.id === page)?.pending?.()) wanted = page; page = ''; }
      if (searchPage && !shown.some(p => p.id === searchPage)) searchPage = '';
      const q = query.trim();
      const hits = q ? searchHits(shown, q) : null;
      const pages = hits ? shown.filter(p => hits.has(p.id)) : shown;
      const selected = openPage();
      const heading = PAGES.find(p => p.id === selected)?.title || '';
      const items = attention(ctx);
      const attentionHtml = items.length ? `<div class="st-attention" aria-label="Needs attention">${items.map(i => `<button data-st-attention="${esc(i.feature)}">${esc(i.title)}<span aria-hidden="true">›</span></button>`).join('')}</div>` : '';
      // Desktop shows About & updates beside the list with the card on it, so the list does not repeat it.
      const card = hits || (desktop && selected === 'about') ? '' : cardHtml();
      const nav = pages.map((p, i) => (p.group && p.group !== pages[i - 1]?.group && pages.some(q => q.group && q.group !== p.group) ? `<h4 class="st-navgroup">${esc(p.group)}</h4>` : '') + `<button class="st-category" data-st-page="${p.id}" aria-current="${p.id === selected ? 'page' : 'false'}"><span class="st-tx"><b>${p.title}</b></span><span class="st-val" data-st-subtitle="${p.id}">${esc(subtitle(p.id, ctx))}</span><span class="st-go" aria-hidden="true">›</span></button>`).join('');
      const fs = [...features.values()].filter(f => pageOf(f) === selected && (!ctx.skinDraft || f.id === 'look') && (!f.available || f.available(ctx)));
      // About & updates leads with the update card and its choices; the connection rows follow.
      if (selected === 'about') fs.sort((x, y) => (y.id === 'updates') - (x.id === 'updates'));
      const content = fs.map(f => `<section data-settings-feature="${esc(f.id)}">${f.html(ctx)}</section>`).join('');
      root.dataset.settingsPage = page;
      root.dataset.settingsNested = ctx.skinDraft ? 'true' : 'false';
      const html = `<div class="st-inner ${desktop ? 'st-desktop' : 'st-phone'} ${page ? 'st-in-page' : ''}"><div class="st-index"><h3 class="st-title" tabindex="-1">Settings</h3>${searchBox()}${card}${hits ? '' : attentionHtml}<nav aria-label="Settings categories">${nav}${hits && !pages.length ? `<p class="st-search-none" role="status">No settings mention “${esc(q)}”</p>` : ''}</nav></div><div class="st-page" ${selected ? '' : 'hidden'}><header class="st-page-head"><button data-st-back aria-label="${ctx.skinDraft ? 'Back to Look' : 'Back to Settings'}">‹</button><h3 tabindex="-1">${ctx.skinDraft ? 'New skin' : heading}</h3></header>${content}</div></div>${confirm ? `<div class="st-confirm-scrim"><section class="st-confirm" role="alertdialog" aria-modal="true" aria-labelledby="st-confirm-title"><h3 id="st-confirm-title">Use ${esc(chatsName(confirm.id))} for all your chats?</h3><p>You can switch back here any time.</p><div class="st-actions"><button data-chats-cancel ${ctx.chatsBusy ? 'disabled' : ''}>Cancel</button><button data-chats-confirm ${ctx.chatsBusy ? 'disabled' : ''}>${ctx.chatsBusy ? 'Switching…' : 'Use ' + esc(chatsName(confirm.id))}</button></div></section></div>` : ''}`;
      // A background refresh that changes nothing leaves the page alone: rewriting identical markup made Settings blink
      // and sent the desktop's own-scrolling category list back to the top (several modules refresh on timers).
      // The skin-import status line lives outside the markup, so it is written on the skip path too.
      if (force !== true && html === root.__stHtml && root.firstElementChild) { const s = root.querySelector('[data-skinimport-status]'); if (s) s.textContent = skinImportMessage; return; }
      root.__stHtml = html;
      root.innerHTML = html;
      for (const f of fs) if (f.painted) { try { f.painted(ctx, root.querySelector(`[data-settings-feature="${CSS.escape(f.id)}"]`)); } catch (e) { console.error(e); } }
      root.scrollTop = top;
      const pane = root.querySelector('.st-page'); if (pane) pane.scrollTop = paneTop;
      const index = root.querySelector('.st-index'); if (index) index.scrollTop = indexTop;
      const importStatus = root.querySelector('[data-skinimport-status]'); if (importStatus) importStatus.textContent = skinImportMessage;
      // After the scroll positions are put back, so the jump to the first hit isn't undone.
      if (hits) markHits(q, selected);
      if (attrs.length) { const scope = record ? root.querySelector(`[data-ubid="${CSS.escape(record)}"]`) : root; const sel = attrs.map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join(''); const target = scope?.querySelector(sel); target?.focus({ preventScroll: true }); if (target && selection) target.setSelectionRange(...selection); }
      const U = window.WosUsage;
      if (U && !U.loading && (!U.snap || Date.now() - U.at > 60000)) U.load().then(ctx.paintUsage);
    }
    function searchBox() {
      return `<div class="st-search" role="search"><input type="search" data-st-search="" placeholder="Search settings" aria-label="Search settings" autocomplete="off" spellcheck="false" value="${esc(query)}"></div>`;
    }
    // The words a page shows: its title, its subtitle and every feature on it, as plain text (inert template, so
    // nothing in the markup loads or runs).
    function pageText(p) {
      const fs = [...features.values()].filter(f => pageOf(f) === p.id && (!f.available || f.available(ctx)));
      let html = '';
      for (const f of fs) { try { html += ' ' + f.html(ctx); } catch (_) {} }
      const t = document.createElement('template'); t.innerHTML = html;
      t.content.querySelectorAll('script, style, template').forEach(n => n.remove());
      return `${p.title} ${subtitle(p.id, ctx)} ${t.content.textContent}`;
    }
    function searchHits(pages, q) {
      const needle = q.toLowerCase(), out = new Set();
      for (const p of pages) { try { if (pageText(p).toLowerCase().includes(needle)) out.add(p.id); } catch (_) {} }
      return out;
    }
    // Wrap each case-insensitive match in the category titles and on the open page in <mark class="st-hit">, then
    // bring the page's first one into view (once per page and query).
    function markHits(q, selected) {
      const needle = q.toLowerCase(), first = [];
      const wrap = scope => {
        if (!scope) return;
        const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement?.closest('script, style, textarea, select, option, mark, [data-st-search]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
        for (const node of nodes) {
          const text = node.nodeValue, low = text.toLowerCase();
          let at = low.indexOf(needle); if (at < 0) continue;
          const frag = document.createDocumentFragment(); let from = 0;
          while (at >= 0) {
            if (at > from) frag.append(text.slice(from, at));
            const m = document.createElement('mark'); m.className = 'st-hit'; m.textContent = text.slice(at, at + needle.length); frag.append(m);
            if (scope.classList.contains('st-page')) first.push(m);
            from = at + needle.length; at = low.indexOf(needle, from);
          }
          if (from < text.length) frag.append(text.slice(from));
          node.replaceWith(frag);
        }
      };
      root.querySelectorAll('.st-category .st-tx').forEach(wrap);
      const pane = root.querySelector('.st-page:not([hidden])'); wrap(pane);
      const key = selected + '\n' + needle;
      // The first mark someone can see (words inside a closed or hidden part are marked but not scrolled to).
      const lead = first.find(m => m.getClientRects?.().length) || first[0];
      if (lead) lead.classList.add('st-hit-first');
      if (lead && searchScrolled !== key) { searchScrolled = key; lead.scrollIntoView?.({ block: 'center' }); }
    }
    function search(value) {
      const before = openPage();
      query = String(value || ''); searchScrolled = '';
      const q = query.trim();
      searchPage = '';
      // Desktop shows a page beside the list: when that page doesn't mention the words, show the first one that does.
      // Without a page picked yet the pick stays a search pick, so a narrow window keeps its list (and the box) open.
      if (q && desktop) {
        const shown = PAGES.filter(p => !p.available || p.available(ctx)), hits = searchHits(shown, q);
        const next = shown.find(p => hits.has(p.id))?.id;
        // Compare with the page that shows without a search pick: an earlier pick never counts as "already open".
        if (next && !hits.has(effectivePage())) { if (page) page = next; else searchPage = next; }
      }
      if (openPage() !== before) {
        for (const f of features.values()) if (pageOf(f) === before) f.leave?.(ctx);
        for (const f of features.values()) if (pageOf(f) === openPage()) f.enter?.(ctx);
      }
      render(true);
    }
    function focus(id) {
      for (const f of features.values()) if (pageOf(f) === openPage()) f.leave?.(ctx);
      const f = features.get(id) || [...features.values()].find(f => f.aliases?.includes(id));
      wanted = ''; searchPage = '';
      page = f ? pageOf(f) : featurePages[id] || (id === 'updates' ? 'about' : PAGES.some(p => p.id === id) ? id : '');
      for (const f of features.values()) if (pageOf(f) === openPage()) f.enter?.(ctx);
      confirm = null; render(); root.scrollTop = 0;
      const pane = root.querySelector('.st-page'); if (pane) pane.scrollTop = 0;
      // Searching: a page opened from the filtered list starts at its first hit, not at the top.
      if (!id || !f) root.querySelector('.st-page mark.st-hit-first')?.scrollIntoView?.({ block: 'center' });
      const g = id ? root.querySelector(`[data-settings-feature="${CSS.escape(f?.id || id)}"]`) : null;
      g?.scrollIntoView?.({ block: 'nearest' });
      (g?.querySelector('button:not(:disabled)') || root.querySelector(page ? '.st-page-head h3' : '.st-title'))?.focus({ preventScroll: true });
    }
    function back() {
      const inBox = document.activeElement?.matches?.('[data-st-search]') && root.contains(document.activeElement);
      // Search: Esc/Back in the box, or at the list, clears the words first (a page goes back to the list, words kept).
      if (query && inBox) { search(''); root.querySelector('[data-st-search]')?.focus({ preventScroll: true }); return true; }
      for (const f of features.values()) if (pageOf(f) === openPage() && f.back?.(ctx)) return true;
      if (confirm) { if (!ctx.chatsBusy) { confirm = null; render(); root.querySelector('[data-chats-choice][aria-checked="true"]')?.focus(); } return true; }
      if (query && !page) { search(''); root.querySelector('[data-st-search]')?.focus({ preventScroll: true }); return true; }
      if (!page) return false;
      const previous = page; focus(); root.querySelector(`[data-st-page="${previous}"]`)?.focus({ preventScroll: true }); return true;
    }
    function openStore(id) { ctx.openStore?.(id); }
    function askChats(id) {
      if (ctx.chatsBusy || id === chatsHost()?.defaultId() || !chatsHost()?.installed().some(a => a.id === id)) return;
      confirm = { id }; render(); root.querySelector('[data-chats-cancel]')?.focus();
    }
    async function useChats() {
      if (!confirm || ctx.chatsBusy) return;
      const id = confirm.id; ctx.chatsBusy = true; render();
      try {
        const url = '/wizard-os-home/store-install/_slots/chats';
        const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ default: id }) });
        if (!response.ok) { let message = 'Could not change Chats'; try { message = (await response.json()).error || message; } catch (_) {} throw Error(message); }
        const check = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if (!check.ok || (await check.json()).default !== id) throw Error('The App Manager has not confirmed this Chats choice. Try again.');
        await window.WizCore.refreshApps();
        if (chatsHost()?.defaultId() !== id) throw Error('The app list has not confirmed this Chats choice. Try again.');
        ctx.chatsChanged?.(id);
        ctx.toast?.('✓', 'Using ' + chatsName(id), 2200);
      } catch (error) { ctx.toast?.('!', String(error.message || error), 3200); }
      finally { ctx.chatsBusy = false; confirm = null; render(); root.querySelector('[data-chats-choice][aria-checked="true"]')?.focus({ preventScroll: true }); }
    }
    function dispatch(el, event) {
      if (el.classList?.contains('st-confirm-scrim')) return back();
      if (el.closest('[data-chats-confirm]')) { useChats(); return true; }
      if (el.closest('[data-chats-cancel]')) { back(); return true; }
      if (confirm) return false;
      const nav = el.closest('[data-st-page]'), att = el.closest('[data-st-attention]');
      if (nav || att) { focus(nav ? nav.dataset.stPage : att.dataset.stAttention); return true; }
      if (el.closest('[data-st-back]')) return back();
      const choose = el.closest('[data-chats-choice]'); if (choose) { askChats(choose.dataset.chatsChoice); return true; }
      if (el.closest('[data-chats-store]')) { openStore(); return true; }
      const id = el.closest('[data-settings-feature]')?.dataset.settingsFeature, f = features.get(id);
      return !!f?.act?.(ctx, el, event);
    }
    const click = e => dispatch(e.target, e);
    // An IME composes text in the box: wait for compositionend, or a repaint would replace the box mid-word.
    const searchInput = e => { if (!e.isComposing && e.target.matches?.('[data-st-search]')) search(e.target.value); };
    const searchComposed = e => { if (e.target.matches?.('[data-st-search]')) search(e.target.value); };
    const featureInput = e => { const id = e.target.closest('[data-settings-feature]')?.dataset.settingsFeature; features.get(id)?.input?.(ctx, e.target); };
    const change = async e => {
      featureInput(e);
      const input = e.target.closest('[data-skinfile]'); if (!input) return;
      const file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 8192) throw new Error('Skin JSON must be 8 KB or smaller');
        const definition = JSON.parse(await file.text());
        if (!root.isConnected) return;
        window.WosSkin.compose(definition);
        skinImportMessage = 'Skin composition applied on this device.'; render();
      } catch (error) {
        skinImportMessage = `Not applied: ${error.message}`;
        const status = root.querySelector('[data-skinimport-status]'); if (status) status.textContent = skinImportMessage;
      } finally { input.value = ''; }
    };
    const key = e => {
      if (e.target.matches?.('[data-st-search]')) {
        if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); search(''); return; }
        if (e.key === 'Enter') { const first = root.querySelector('[data-st-page]'); if (first && query.trim()) { e.preventDefault(); focus(first.dataset.stPage); } return; }
        return;
      }
      const choice = e.target.closest?.('[data-chat-after]');
      if (choice && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const choices = [...choice.closest('[role="radiogroup"]').querySelectorAll('[data-chat-after]')];
        const at = choices.indexOf(choice), next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : (at + (['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1) + choices.length) % choices.length;
        choices[next].focus(); choices[next].click(); return;
      }
      const dialog = root.querySelector('[data-settings-feature] [aria-modal="true"]');
      if (dialog) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); } else trap(e, dialog); return; }
      if (confirm) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); } else trap(e, root.querySelector('.st-confirm')); return; }
      const category = e.target.closest('[data-st-page]');
      if (category && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault(); const buttons = [...root.querySelectorAll('[data-st-page]')], at = buttons.indexOf(category), n = (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        const id = buttons[n].dataset.stPage; focus(id); root.querySelector(`[data-st-page="${id}"]`)?.focus(); return;
      }
      const radio = e.target.closest('[data-chats-choice]');
      if (radio && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); const buttons = [...root.querySelectorAll('[data-chats-choice]')], at = buttons.indexOf(radio), delta = ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 1;
        buttons[(at + delta + buttons.length) % buttons.length].focus(); return;
      }
      const b = e.target.closest('[data-skinpick], [data-skinfamily], [data-ownskin], [data-newskin]');
      if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const grid = b.closest('[role="group"]'); if (!grid) return;
      e.preventDefault(); const buttons = [...grid.querySelectorAll('button')], at = buttons.indexOf(b);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[n].focus();
    };
    const unsubscribe = ctx.live?.onChange?.(() => render());
    const appsChanged = () => render();
    window.addEventListener?.('wos:prefs', appsChanged); window.addEventListener?.('wizard:apps', appsChanged); window.addEventListener?.('wizard:notify-route', appsChanged); window.addEventListener?.('wizard:notify-attention', appsChanged);
    function destroy() { for (const f of features.values()) f.leave?.(ctx); root.removeEventListener('input', featureInput); if (typeof unsubscribe === 'function') unsubscribe(); window.removeEventListener?.('wos:prefs', appsChanged); window.removeEventListener?.('wizard:apps', appsChanged); window.removeEventListener?.('wizard:notify-route', appsChanged); window.removeEventListener?.('wizard:notify-attention', appsChanged); root.removeEventListener('input', searchInput); root.removeEventListener('compositionend', searchComposed); mounts.delete(api); root.removeEventListener('click', click); root.removeEventListener('keydown', key); root.removeEventListener('change', change); }
    root.addEventListener('input', searchInput); root.addEventListener('compositionend', searchComposed); root.addEventListener('input', featureInput); root.addEventListener('click', click); root.addEventListener('keydown', key); root.addEventListener('change', change); mounts.add(api); render(); return api;
  }
  // One deferred System link at a time: a newer link, Back, or anything the user does first cancels the wait.
  let waiting = null;
  const STOPS = ['popstate', 'hashchange', 'pointerdown', 'keydown'];
  function cancelWait() { if (!waiting) return; clearInterval(waiting); waiting = null; for (const t of STOPS) window.removeEventListener?.(t, cancelWait, true); }
  function route(view, open) {
    cancelWait();
    if (view === 'settings') { open(); return true; }
    const f = [...features.values()].find(f => f.aliases?.includes(view));
    // System pages filled by a package (?view=network etc.) open once something is on them.
    if (!f && !features.has(view)) {
      const sys = PAGES.find(p => p.group === 'System' && p.id === view); if (!sys) return false;
      // A link can arrive before the package fills the page: wait for it (up to 10 s), then open.
      if (sys.available()) open(view);
      else { let n = 0; waiting = setInterval(() => { if (sys.available()) { cancelWait(); open(view); } else if (++n >= 40) cancelWait(); }, 250);
        for (const t of STOPS) window.addEventListener?.(t, cancelWait, true); }
      return true;
    }
    open(f?.id || view); return true;
  }
  // Shared focus containment. Existing shell Back guards own history; never add a second guard here.
  function trap(event, panel) {
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]')].filter(e => e.getClientRects().length);
    if (!controls.length) return;
    const at = controls.indexOf(document.activeElement);
    if (at < 0 || (!event.shiftKey && at === controls.length - 1) || (event.shiftKey && at === 0)) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus(); }
  }
  return { cancelWait, mount, route, trap };
};
