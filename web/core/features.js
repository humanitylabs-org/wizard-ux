/* Small common action/view registry for voice commands, deep links and both window hosts. Never listed in Settings (James, 25 Oct 2026). */
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
  for (const level of ['day', 'week', 'month']) api.register({ id: level, title: `${level[0].toUpperCase() + level.slice(1)} in review`, icon: '◷', run: (h, o) => h.review(level, o.date) });
  api.register({ id: 'maps', title: 'Maps', icon: '⌖', run: (h, o) => h.maps(o.mode || 'search', o.query || '') });
  api.register({ id: 'command', title: 'Local command', icon: '⚡', mount(root, _host, opts) {
    root.innerHTML = '<form class="shared-command"><label>On-device command<input name="command" placeholder="Open Music, show this week, search maps for…" autocomplete="off"></label><button>Run command</button><p role="status">Commands never send a message to an agent.</p></form>';
    root.querySelector('form').onsubmit = e => { e.preventDefault(); const input = root.querySelector('input'); const result = H.command(input.value,opts.context); root.querySelector('[role=status]').textContent = result ? 'Command handled on this device.' : 'No local command matched. Nothing sent.'; };
  } });
})();
