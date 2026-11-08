// Before first paint: a hosted Store paints a transparent canvas (the shell owns the backdrop; Appearance v1).
if (window.top !== window) document.documentElement.classList.add('wz-hosted');
