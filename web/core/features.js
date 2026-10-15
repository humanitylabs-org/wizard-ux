/* Small common action/view registry. Register once; Settings, deep links and both window hosts see it. */
(() => {
  'use strict';
  const entries = new Map(); let H;
  const esc = s => window.WizCore.esc(s);
  const api = window.WosFeatures = {
    register(f) { if (!f.id || entries.has(f.id)) throw Error('Unique feature id required'); entries.set(f.id, f); window.WosSettings.refresh?.(); return () => entries.delete(f.id); },
    install(host) { H = host; },
    has: id => entries.has(id),
    open(id, opts = {}) { const f = entries.get(id); if (!f || !H || f.available && !f.available()) return false; if (f.run) f.run(H, opts); else H.openFeature(id, {...opts,context:opts.context || H.context?.()}); return true; },
    mount(id, root, opts = {}) { const f = entries.get(id); if (!f) return; return f.mount?.(root, H, opts); },
    get entries() { return [...entries.values()]; }
  };
  window.WosSettings.register({ id: 'features', aliases: ['features'], html() { return `<div class="st-group"><h4>Views & actions</h4>${api.entries.filter(f => !f.available || f.available()).map(f => `<button class="st-row" data-feature-open="${esc(f.id)}"><span class="st-ic">${esc(f.icon || '◇')}</span><span class="st-tx"><b>${esc(f.title || f.id)}</b></span><span class="st-go">›</span></button>`).join('')}</div>`; }, act(_ctx, el) { const b = el.closest('[data-feature-open]'); return !!b && api.open(b.dataset.featureOpen); } });
  for (const level of ['day', 'week', 'month']) api.register({ id: level, title: `${level[0].toUpperCase() + level.slice(1)} in review`, icon: '◷', run: (h, o) => h.review(level, o.date) });
  api.register({ id: 'maps', title: 'Maps', icon: '⌖', run: (h, o) => h.maps(o.mode || 'search', o.query || '') });
  api.register({ id: 'command', title: 'Local command', icon: '⚡', mount(root, _host, opts) {
    root.innerHTML = '<form class="shared-command"><label>On-device command<input name="command" placeholder="Open Music, show this week, search maps for…" autocomplete="off"></label><button>Run command</button><p role="status">Commands never send a message to an agent.</p></form>';
    root.querySelector('form').onsubmit = e => { e.preventDefault(); const input = root.querySelector('input'); const result = H.command(input.value,opts.context); root.querySelector('[role=status]').textContent = result ? 'Command handled on this device.' : 'No local command matched. Nothing sent.'; };
  } });
})();
