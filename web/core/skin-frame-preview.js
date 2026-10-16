/* Review aid, not a second appearance preference. Enabled only by deployment HTML meta. */
(() => {
  if (!document.querySelector('meta[name="wos-frame-preview"]')) return;
  const S = window.WosSkin, F = window.WosSkinFrame;
  if (!S || !F) return;
  document.documentElement.classList.add('sf-preview');
  const bar = document.createElement('details'); bar.className = 'sf-preview-bar';
  bar.setAttribute('aria-label', 'Private skin comparison');
  const returnURL = document.querySelector('meta[name="wos-frame-preview-return"]')?.content;
  bar.innerHTML = `<summary>Private preview</summary><div class="sf-preview-panel"><p>Skin foundation · read-only preview</p>${F.choices(S.frame.foundation)}</div>`;
  if (returnURL) {
    const url = new URL(returnURL, location.href);
    if (url.protocol === 'https:') { const a = document.createElement('a'); a.href = url.href; a.textContent = 'Return to daily Wizard ↗'; bar.querySelector('.sf-preview-panel').appendChild(a); }
  }
  bar.addEventListener('click', e => { const b = e.target.closest('[data-skinfoundation]'); if (b) S.setFoundation(b.dataset.skinfoundation); });
  addEventListener('wos:skin-frame', () => bar.querySelectorAll('[data-skinfoundation]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.skinfoundation === S.frame.foundation))));
  document.body.appendChild(bar);
})();
