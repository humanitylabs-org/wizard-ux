'use strict';
// Geometry only: assertions measure the rendered row, not the implementation's saved place.
const DOC = process.env.DOC === '1';
const context = { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' + (DOC ? ' WizardOS-DocScroll' : '') };
const geometry = nb => `(()=>{const n=${nb};const doc=!!n.closest('.wos-doc-thread');const sc=doc?document.scrollingElement:n;const top=doc?n.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom:n.getBoundingClientRect().top;return {n,doc,sc,top}})()`;
module.exports = { DOC, context, geometry };
