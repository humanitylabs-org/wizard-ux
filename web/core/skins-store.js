/* Settings > Look: owner folders and the verified, service-backed Nostr Store.
 * No relay, Blossom, secret-key or durable approval state belongs in this page. */
(() => {
  'use strict';
  const API = '/wizard/v1/skins', states = new WeakMap();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = ctx => { if (!states.has(ctx)) states.set(ctx, { view: 'default', mine: null, store: null, detail: null, form: null, identity: undefined, busy: false, message: '', generation: 0 }); return states.get(ctx); };
  document.addEventListener?.('error', e => {
    const image = e.target;
    if (image.matches?.('.ls-author img')) { const fallback = document.createElement('span'); fallback.className = 'ls-avatar'; fallback.textContent = '◉'; fallback.setAttribute('aria-hidden', 'true'); image.replaceWith(fallback); }
    if (image.matches?.('img.ls-preview')) { const fallback = document.createElement('span'); fallback.className = 'ls-preview ls-swatch'; fallback.setAttribute('aria-label', 'Preview unavailable — colour swatch'); for (let n = 0; n < 3; n++) fallback.appendChild(document.createElement('i')); image.replaceWith(fallback); }
  }, true);
  async function request(path = '', body, method = 'POST') {
    const r = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wizard' }, body: JSON.stringify(body) }) });
    const j = await r.json();
    if (!r.ok) throw Error(j.detail || j.error || `Skin request failed (${r.status})`);
    return j;
  }
  const readMine = async s => { s.mine = await request(); return s.mine; };
  async function readStore(s, refresh = false) {
    s.store = await request('/store' + (refresh ? '?refresh=1' : ''));
    // No remote CSS URLs. Derive colour-only swatches from verified bytes.
    const missing = s.store.items.filter(i => !previewURL(i.preview));
    for (let n = 0; n < missing.length; n += 4) await Promise.all(missing.slice(n, n + 4).map(async i => {
      try {
        const css = await cssBlob(i.files.find(f => f.name === 'skin.css'));
        i._colours = [...css.matchAll(/--(?:bg|ink|violet-2)\s*:\s*([^;}!]+)/g)].map(m => m[1].trim()).filter(v => /^#[a-f0-9]{3,8}$/i.test(v)).slice(0, 3);
      } catch (_) { /* Offline: keep the neutral swatch. */ }
    }));
  }
  const bridge = () => window.WizCore?.bridge;
  // Desktop/Mac deliberately cannot publish yet, even when a bridge exists.
  const phoneSigner = () => document.documentElement.dataset.shell !== 'desktop' && !!window.WizardNative?.postMessage;
  async function identity(s) {
    s.identity = null;
    if (phoneSigner()) { try { s.identity = await bridge().call('identity.info'); } catch (_) {} }
  }
  function stop(s) { s.generation++; s.cancelTry?.(); s.cancelTry = null; s.trying = false; }
  async function run(ctx, fn) {
    const s = state(ctx); if (s.busy) return;
    s.busy = true; s.message = ''; ctx.render();
    try { await fn(s); } catch (e) { s.message = String(e.message || e); }
    finally { s.busy = false; ctx.render(); }
  }
  async function enter(ctx) {
    const s = state(ctx); await identity(s); ctx.render();
  }
  function navigate(ctx, view) {
    const s = state(ctx); stop(s); s.form = null; s.detail = null; s.view = view; s.message = ''; ctx.render();
    if (view === 'mine') run(ctx, async () => { await Promise.all([readMine(s), identity(s)]); });
    if (view === 'store') run(ctx, async () => { await readStore(s); });
  }
  function leave(ctx) { const s = state(ctx); stop(s); s.view = 'default'; s.form = null; s.detail = null; }
  function back(ctx) {
    const s = state(ctx);
    if (s.busy) { stop(s); s.form = null; s.detail = null; s.view = 'default'; ctx.render(); return true; }
    if (s.form) { s.form = null; s.message = ''; ctx.render(); return true; }
    if (s.detail) { stop(s); s.detail = null; s.message = ''; ctx.render(); return true; }
    if (s.view !== 'default') { navigate(ctx, 'default'); return true; }
    return false;
  }
  function sorted(store) {
    const order = store?.featured || [];
    const rank = item => { const i = order.indexOf(item.a); return i < 0 ? (item.featured ? order.length : Infinity) : i; };
    return [...(store?.items || [])].sort((a, b) => rank(a) - rank(b) || b.updated_at - a.updated_at);
  }
  const date = n => Number.isFinite(n) ? new Date(n * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown';
  const short = s => s ? `${s.slice(0, 12)}…${s.slice(-8)}` : 'Unknown author';
  // Preview blobs are verified by our service; never embed a publisher-supplied remote URL.
  const previewURL = url => /^\/wizard\/v1\/skins\/store\/blob\/[a-f0-9]{64}$/.test(url || '') ? url : '';
  const pictureURL = url => { try { const u = new URL(url); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  function picture(item) {
    const url = previewURL(item.preview);
    return url ? `<img class="ls-preview" src="${esc(url)}" alt="${esc(item.name)} preview" loading="lazy">` : `<span class="ls-preview ls-swatch" aria-label="Colour swatch preview">${[0, 1, 2].map(n => `<i${item._colours?.[n] ? ` style="background:${esc(item._colours[n])}"` : ''}></i>`).join('')}</span>`;
  }
  function author(item) {
    const pic = pictureURL(item.author?.picture);
    return `<span class="ls-author">${pic ? `<img src="${esc(pic)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<span class="ls-avatar" aria-hidden="true">◉</span>'}<span>${esc(item.author?.name || 'Unknown author')}<small>${esc(short(item.npub))}</small></span></span>`;
  }
  const stats = item => `<small class="ls-stats">First published ${esc(date(item.published_at))}<br>Updated ${esc(date(item.updated_at))} · ${esc(item.forks || 0)} forks</small>`;
  function sheet(s) {
    const f = s.form; if (!f) return '';
    const title = f.type === 'publish' ? 'Publish my skin' : f.type === 'report' ? 'Report skin' : 'New skin';
    return `<div class="st-confirm-scrim"><section class="st-confirm sc-sheet" role="dialog" aria-modal="true" aria-label="${title}"><h3>${title}</h3><fieldset ${s.busy ? 'disabled' : ''}>${f.type === 'report' ? '<label>Reason<textarea data-ls-field="reason" maxlength="1000" rows="3">' + esc(f.reason) + '</textarea></label>' : `<label>Name<input data-ls-field="name" maxlength="48" value="${esc(f.name)}"></label>${f.type === 'publish' ? `<label>Summary<textarea data-ls-field="summary" maxlength="140" rows="2">${esc(f.summary)}</textarea></label><p>Publishing makes this skin public. It can be copied and mirrored forever.</p><p class="st-note">CSS only. Your local skin script is never published.</p>` : ''}`}</fieldset><p role="status">${esc(s.message)}</p><div class="st-actions"><button data-ls="cancel" ${s.busy ? 'disabled' : ''}>Cancel</button><button data-ls="submit" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Working…' : f.type === 'publish' ? 'Publish' : f.type === 'report' ? 'Send report' : 'Create skin'}</button></div></section></div>`;
  }
  function mine(s) {
    if (!s.mine) return '<div class="st-empty">My skins unavailable. Try Refresh.</div>';
    return `<div class="st-actions"><button data-ls="new">New skin</button><button data-ls="refresh">Refresh</button></div><button class="st-row" data-ls="active" data-ls-id="" aria-pressed="${s.mine.active === null}"><span class="st-tx"><b>None</b><small>Default, exactly as made</small></span>${s.mine.active === null ? '✓' : ''}</button>${s.mine.skins.map(k => {
      const parent = k.forked_from && (s.store?.items?.find(i => i.a === k.forked_from.a)?.name || k.forked_from.a?.split(':').slice(2).join(':') || 'another skin');
      return `<article class="ls-mine"><button class="st-row" data-ls="active" data-ls-id="${esc(k.id)}" aria-pressed="${s.mine.active === k.id}"><span class="st-tx"><b>${esc(k.name)}</b>${parent ? `<small>forked from ${esc(parent)}</small>` : ''}<small>${k.published ? 'Published' : 'Not published'}${k.has_script ? ' · local script' : ''}</small></span>${s.mine.active === k.id ? '✓' : ''}</button><div class="st-actions">${s.identity?.none ? '<button data-ls="setup">Create your Wizard ID</button>' : `<button data-ls="publish" data-ls-id="${esc(k.id)}" ${s.identity?.pubkey ? '' : 'disabled'}>${s.identity?.pubkey ? 'Publish my skin' : 'Publish from your phone'}</button>`}</div></article>`;
    }).join('')}`;
  }
  function store(s) {
    if (s.detail) {
      const i = s.detail;
      return `<button class="ls-back" data-ls="detail-back">‹ Store</button><article class="ls-detail">${picture(i)}<h3>${esc(i.name)}</h3>${author(i)}<p>${esc(i.summary)}</p>${stats(i)}<div class="st-actions"><button data-ls="try">${s.trying ? 'Try on again' : 'Try on'}</button>${s.trying ? '<button data-ls="cancel-try">Cancel try on</button>' : ''}<button data-ls="add">Add to my skins</button><button data-ls="report">Report</button></div><p class="st-note">Try on is temporary. Leaving this view or reloading restores your own look.</p></article>`;
    }
    const items = sorted(s.store);
    return `<div class="st-actions"><button data-ls="refresh">Refresh</button></div>${s.store?.relays?.some(r => !r.ok) ? '<p class="st-note">Some relays are unavailable. Showing verified cached skins.</p>' : ''}<div class="ls-grid">${items.map(i => `<button class="ls-card" data-ls="detail" data-ls-a="${esc(i.a)}">${picture(i)}<span class="ls-card-body">${i.featured || s.store.featured.includes(i.a) ? '<small class="ls-featured">Featured</small>' : ''}<b>${esc(i.name)}</b>${author(i)}${stats(i)}</span></button>`).join('')}</div>${!items.length ? '<div class="st-empty">No skins available. Try Refresh.</div>' : ''}`;
  }
  function html(ctx, defaultHtml) {
    const s = state(ctx);
    return `<div class="st-group ls-look" data-look-level="${s.detail ? 'detail' : s.view}" aria-busy="${s.busy}"><h4>Look</h4><nav class="ls-tabs" aria-label="Look levels">${[['default', 'Default'], ['mine', 'My skins'], ['store', 'Store']].map(([id, label]) => `<button data-ls="nav" data-ls-view="${id}" aria-pressed="${s.view === id}" ${s.busy ? 'disabled' : ''}>${label}</button>`).join('')}</nav>${s.form ? '' : `<p class="ls-status" role="status">${esc(s.busy ? 'Working…' : s.message)}</p>`}${s.view === 'default' ? defaultHtml : s.view === 'mine' ? mine(s) : store(s)}${sheet(s)}</div>`;
  }
  async function cssBlob(file) {
    if (!/^[a-f0-9]{64}$/.test(file?.sha256 || '')) throw Error('No verified stylesheet in this listing');
    const r = await fetch(`${API}/store/blob/${file.sha256}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok || !(r.headers.get('Content-Type') || '').startsWith('text/css')) throw Error('Verified skin CSS is unavailable');
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > 65536) throw Error('Skin CSS exceeds 64 KB');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (hash !== file.sha256) throw Error('Skin CSS hash mismatch');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  async function tryOn(ctx, s) {
    stop(s); const generation = s.generation, item = s.detail;
    const css = await cssBlob(item.files.find(f => f.name === 'skin.css'));
    if (generation !== s.generation || s.detail !== item) return;
    s.cancelTry = window.WosMySkin.tryOn(css); s.trying = true;
  }
  // A fresh sandbox contains ONLY a fixed home + canned thread. Never capture the owner's shell.
  async function capture(css) {
    if (!phoneSigner()) return null;
    const frame = document.createElement('iframe'); frame.className = 'ls-demo'; frame.title = 'Public skin preview — fixed demo, no owner data';
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.srcdoc = '<!doctype html><html data-skin="nebula" data-shell="phone"><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\' \"self\""></head><body><main class="device"><section class="home"><div class="home-time">09:41</div><p class="home-date">A little room to think</p><div class="now-card">Home · Your day, at a glance</div></section><section class="win"><h3>A quiet moment</h3><div class="ch-msgs"><div class="msg user"><div class="bub">Let’s make room for a good day.</div></div><div class="msg assistant"><div class="bub">One small step. What matters most today?</div></div></div></section><div class="dock">Home · Chats · Apps</div></main></body></html>';
    const stage = document.createElement('dialog');
    // The browser top layer escapes owner-page stacking/opacity. An opaque,
    // explicitly styled full-viewport backdrop prevents owner pixels leaking
    // even if local CSS hides/repositions the demo iframe.
    for (const [k, v] of Object.entries({ all: 'initial', display: 'block', position: 'fixed', inset: '0', margin: '0', padding: '0', border: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none', opacity: '1', visibility: 'visible', transform: 'none', filter: 'none', 'clip-path': 'none', 'mask-image': 'none', 'mix-blend-mode': 'normal', background: '#05030c', overflow: 'hidden' })) stage.style.setProperty(k, v, 'important');
    const loaded = new Promise(resolve => { frame.onload = resolve; });
    stage.appendChild(frame); document.body.appendChild(stage);
    try {
      stage.showModal();
      let timeout; try { await Promise.race([loaded, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Demo scene did not load')), 3000); })]); } finally { clearTimeout(timeout); }
      const d = frame.contentDocument, base = d.createElement('style');
      base.textContent = 'html{--bg:#05030c;--ink:#f3efff;--ink-2:#b9b0d8;--violet-2:#b99bff;--glass-2:rgba(28,19,58,.72);--line-2:rgba(205,190,255,.24);--sk-win:rgba(12,8,26,.82);--sk-time-a:#fff;--sk-time-b:#b8a6ff;--sk-dock:rgba(8,5,18,.94);font:16px system-ui;background:var(--bg);color:var(--ink)}*{box-sizing:border-box}body{margin:0}.device{padding:20px;min-height:360px;background:var(--bg)}.home-time{font-size:44px;color:var(--sk-time-b)}.home-date{color:var(--ink-2)}.now-card,.win{padding:14px;margin:12px 0;border:1px solid var(--line-2);border-radius:16px;background:var(--sk-win)}h3{margin:0 0 10px}.bub{padding:10px;margin:6px 0;border-radius:12px;background:var(--glass-2)}.user{text-align:right}.dock{padding:10px;background:var(--sk-dock);border-radius:14px;text-align:center}'; d.head.appendChild(base);
      const style = d.createElement('style'); style.textContent = css; d.head.appendChild(style);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = frame.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return null;
      const result = await bridge().call('view.capture', { rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
      return typeof result?.webp_b64 === 'string' ? result.webp_b64 : null;
    } catch (_) { return null; } finally { stage.close(); stage.remove(); }
  }
  async function publish(ctx, s, f) {
    await identity(s);
    if (!s.identity?.pubkey) throw Error(s.identity?.none ? 'Create your Wizard ID before publishing' : 'Publish from your phone');
    const generation = s.generation, id = encodeURIComponent(f.id);
    const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    // Inactive folders have no CSS read endpoint. Pack once to obtain their verified blob;
    // then pack again only when native capture supplied a preview. No publish happens yet.
    let packed = await request(`/${id}/pack`, { summary: f.summary, ...(f.skin.published?.slug ? { slug: f.skin.published.slug } : slug ? { slug } : {}) });
    let preview = null;
    try { const tag = packed.unsigned.tags.find(t => t[0] === 'file' && t[1] === 'skin.css'); preview = await capture(await cssBlob({ sha256: tag?.[2] })); } catch (_) {}
    if (generation !== s.generation || s.form !== f) return;
    if (preview) packed = await request(`/${id}/pack`, { summary: f.summary, slug: packed.slug, preview_webp_b64: preview });
    if (generation !== s.generation || s.form !== f) return;
    const event = { ...packed.unsigned, pubkey: s.identity.pubkey, tags: packed.unsigned.tags.map(t => t[0] === 'name' ? ['name', f.name] : t[0] === 'alt' ? ['alt', `Wizard OS skin: ${f.name}`] : t) };
    let signed;
    try { signed = await bridge().call('identity.sign', { event }); }
    catch (error) { throw Error(`Signing failed: ${error.message || error}. Nothing was published.`); }
    if (signed?.denied) throw Error('Signature denied. Nothing was published.');
    if (generation !== s.generation || s.form !== f) return;
    if (!signed?.sig || !signed?.id || signed.pubkey !== event.pubkey) throw Error('No signed event returned. Nothing was published.');
    const result = await request(`/${id}/publish`, { event: signed });
    await readMine(s);
    if (!s.mine.skins.some(k => k.id === f.id && k.published?.event_id === result.event_id)) throw Error('Publish sent, but its saved state is not yet confirmed. Refresh before publishing again.');
    s.form = null; s.message = result.relays?.some(r => !r.ok) ? 'Published. Some relays could not be reached.' : 'Published';
  }
  function act(ctx, el) {
    const b = el.closest('[data-ls]'); if (!b) return false;
    const s = state(ctx), action = b.dataset.ls; if (s.busy) return true;
    if (action === 'nav') navigate(ctx, b.dataset.lsView);
    else if (action === 'detail-back') back(ctx);
    else if (action === 'detail') { stop(s); s.detail = s.store.items.find(i => i.a === b.dataset.lsA); s.message = ''; ctx.render(); }
    else if (action === 'cancel-try') { stop(s); ctx.render(); }
    else if (action === 'cancel') back(ctx);
    else if (action === 'new' || action === 'report' || action === 'publish') {
      const k = s.mine?.skins.find(k => k.id === b.dataset.lsId);
      s.form = action === 'new' ? { type: 'new', name: '' } : action === 'report' ? { type: 'report', a: s.detail.a, reason: '' } : { type: 'publish', id: k.id, name: k.name, summary: k.summary || '', skin: k };
      s.message = ''; ctx.render(); ctx.root.querySelector('[data-ls-field]')?.focus();
    } else run(ctx, async () => {
      if (action === 'refresh') { if (s.view === 'mine') await Promise.all([readMine(s), identity(s)]); else await readStore(s, true); }
      if (action === 'try') await tryOn(ctx, s);
      if (action === 'setup') { await bridge().call('identity.setup'); await identity(s); }
      if (action === 'active') { const id = b.dataset.lsId || null; await request('/active', { id }, 'PUT'); await readMine(s); if (s.mine.active !== id) throw Error('Active skin was not confirmed'); await window.WosMySkin.refresh(); }
      if (action === 'add') { const result = await request('/store/add', { a: s.detail.a }); await readMine(s); if (s.mine.active !== result.id) throw Error('Added skin was not confirmed active'); stop(s); await window.WosMySkin.refresh(); s.view = 'mine'; s.detail = null; s.message = 'Added to My skins and made active'; }
      if (action === 'submit') {
        const f = s.form;
        if (f.type !== 'report' && !f.name.trim()) throw Error('Enter a name');
        if (f.type === 'publish') return publish(ctx, s, f);
        if (f.type === 'report') { if (!f.reason.trim()) throw Error('Enter a reason'); const result = await request('/store/report', { a: f.a, reason: f.reason }); if (!result.ok) throw Error('Report not confirmed'); s.message = 'Report sent'; }
        else { const result = await request('', { name: f.name }); await readMine(s); if (!s.mine.skins.some(k => k.id === result.id)) throw Error('New skin was not confirmed'); s.message = 'Skin created. Ask your agent to change it.'; }
        s.form = null;
      }
    });
    return true;
  }
  function input(ctx, el) { const s = state(ctx); if (s.form && el.dataset.lsField) s.form[el.dataset.lsField] = el.value; }
  window.WosSkinStore = { html, act, input, enter, leave, back, deferRefresh: ctx => !!state(ctx).form, _test: { sorted, previewURL, short } };
})();
