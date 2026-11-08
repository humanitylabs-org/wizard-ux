// Before first paint: a hosted Agents app paints a transparent canvas (the shell owns the backdrop).
if (parent !== window) document.documentElement.classList.add('wz-hosted');
