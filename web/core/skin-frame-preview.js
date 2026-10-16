/* Preview starts borderless; comparison lives in Settings, never over an app. */
(() => {
  if (!document.querySelector('meta[name="wos-frame-preview"]')) return;
  document.documentElement.classList.add('sf-preview');
  // Update the previous preview's materialized built-in defaults, once. Keep
  // explicit Standard choices and imported custom compositions unchanged.
  const S = window.WosSkin, key = 'wos.frame-preview-padding.v2';
  try {
    if (!localStorage.getItem(key)) {
      const f = JSON.parse(localStorage.getItem('wos.skin.composition.v1') || 'null')?.frame;
      if (f?.foundation === 'borderless' && f.border === 0 && f.radius === 0 && [0, 16].includes(f.gutter) && f.padding === undefined && f.gap === 8)
        S.setFoundation('borderless');
      localStorage.setItem(key, '1');
    }
  } catch (_) { /* Storage denied: fresh foundation still has internal padding. */ }
})();
