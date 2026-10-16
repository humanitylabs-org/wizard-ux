/* Review aid, not a second appearance preference. Enabled only by deployment HTML meta. */
(() => {
  if (!document.querySelector('meta[name="wos-frame-preview"]')) return;
  const S = window.WosSkin, F = window.WosSkinFrame;
  if (!S || !F) return;
  document.documentElement.classList.add('sf-preview');
  const bar = document.createElement('aside'); bar.className = 'sf-preview-bar';
  bar.setAttribute('aria-label', 'Private skin comparison');
  bar.innerHTML = `<span>Skin preview</span>${F.choices(S.frame.foundation)}`;
  bar.addEventListener('click', e => { const b = e.target.closest('[data-skinfoundation]'); if (b) S.setFoundation(b.dataset.skinfoundation); });
  addEventListener('wos:skin-frame', () => bar.querySelectorAll('[data-skinfoundation]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.skinfoundation === S.frame.foundation))));
  document.body.appendChild(bar);
})();
