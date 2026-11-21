/* Wizard UX phone shell › edge to edge: the camera cutout, the status bar height and how a hosted app's frame
 * clears the camera in immersive full screen. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.edge = function ({ $$, device }) {
  /* Edge to edge (James, 10 Oct): in immersive full screen the window reaches the very top of the glass, under
   * the camera too. The native shell reports the camera cutout height; shell-drawn windows pad their content by
   * it, and hosted apps get it as --wos-cutout on their <html> so their own top controls can clear the camera. */
  var cutTop = 0; try { cutTop = +window.WizardOSNative?.cutoutTop?.() || 0; } catch (e) {}
  function shareCutout() {
    const v = device.classList.contains("immersive") ? (cutTop || 0) : 0;
    device.style.setProperty('--cut-t', v + 'px');
    $$('iframe.appframe').forEach(f => { try { const d = f.contentDocument; if (d && d.documentElement) d.documentElement.style.setProperty('--wos-cutout', (f.closest('.win.full') ? v : 0) + 'px'); } catch (e) {} });
  }
  window.__wosCutout = px => { cutTop = Math.max(0, px | 0); shareCutout(); };
  /* Status bar (James, 10 Oct: "like Telegram"): the native shell draws this page under the status bar so the
   * background reaches the top of the glass, and reports the bar's height; --safe-t keeps content below it. */
  function setNatTop(px) { document.documentElement.style.setProperty('--nat-t', Math.max(0, px | 0) + 'px'); }
  try { setNatTop(+window.WizardOSNative?.insetTop?.() || 0); } catch (e) {}
  window.__wosTop = setNatTop;
  /* A hosted app either clears the camera itself (its CSS reads --wos-cutout) or the shell moves it below the camera
   * and paints the strip above in the app's own background colour. */
  function frameEdge(f) {
    const we = f.closest('.win'); if (!we) return;
    let own = false, bg = '', top = '';
    try {
      const d = f.contentDocument;
      own = !!d.querySelector('meta[name="wizard-os-edge"][content="cover"]');
      if (!own) for (const sh of d.styleSheets) { let t = ''; try { t = Array.from(sh.cssRules, r => r.cssText).join(''); } catch (e) {} if (t.includes('--wos-cutout')) { own = true; break; } }
      const pick = el => { const c = el && d.defaultView.getComputedStyle(el).backgroundColor; return c && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c) ? c : ''; };
      bg = pick(d.body) || pick(d.documentElement);
      // The opaque colour actually painted along the app's top edge (a full-width header or page wrapper), so a
      // heading drawn above the app can continue it. Art without a colour yields nothing; the heading keeps its default.
      const vw = d.documentElement.clientWidth;
      for (let n = d.elementFromPoint(vw / 2, 1); n && n !== d.documentElement && !top; n = n.parentElement) {
        if (n.getBoundingClientRect().width < vw * .9) continue;
        if (n.tagName === 'IMG') {   // full-width hero art: average its top rows (same-origin images only; a tainted canvas throws)
          if (!n.complete || !n.naturalWidth) continue;
          try {
            // Sample what is on screen, not the source file: the visible top 12px under object-fit/position, through the
            // image's CSS filter, then under any full-width shade the app layers above it (first colour of its gradient).
            const cs = d.defaultView.getComputedStyle(n), r = n.getBoundingClientRect(), nw = n.naturalWidth, nh = n.naturalHeight;
            const cv = d.createElement('canvas'); cv.width = 8; cv.height = 1;
            const x = cv.getContext('2d'), band = Math.min(12, r.height);
            let sx = 0, sy = 0, sw = nw, sh = band * nh / r.height;
            if (cs.objectFit === 'cover') {
              const k = Math.max(r.width / nw, r.height / nh), [px, py] = cs.objectPosition.split(' ').map(p => p.endsWith('%') ? parseFloat(p) / 100 : .5);
              sx = (nw * k - r.width) * px / k; sy = (nh * k - r.height) * py / k; sw = r.width / k; sh = band / k;
            }
            if (cs.filter && cs.filter !== 'none') x.filter = cs.filter;
            x.drawImage(n, sx, sy, sw, Math.max(1, sh), 0, 0, 8, 1); x.filter = 'none';
            for (let s = n.nextElementSibling; s; s = s.nextElementSibling) {
              const sr = s.getBoundingClientRect(); if (sr.top > r.top + 1 || sr.width < r.width * .9) continue;
              const ss = d.defaultView.getComputedStyle(s), sg = /^linear-gradient\((?:to bottom, |180deg, )?(rgba?\([^)]*\))/.exec(ss.backgroundImage);
              for (const c of [ss.backgroundColor, sg && sg[1]]) if (c && c !== 'rgba(0, 0, 0, 0)') { x.fillStyle = c; x.fillRect(0, 0, 8, 1); }
            }
            const px = x.getImageData(0, 0, 8, 1).data, s = [0, 0, 0];
            for (let i = 0; i < 32; i += 4) for (let k = 0; k < 3; k++) s[k] += px[i + k];
            top = `rgb(${s.map(v => Math.round(v / 8)).join(', ')})`;
          } catch (e) {}
          continue;
        }
        const c = pick(n), g = /^linear-gradient\((?:to bottom, |180deg, )?(rgb\([^)]*\))/.exec(d.defaultView.getComputedStyle(n).backgroundImage);
        if (g) top = g[1]; else if (c && c.startsWith('rgb(')) top = c;
      }
      // Re-sample after in-app navigation and whenever an image finishes loading (routes render their hero art late).
      const v = d.defaultView; if (!v.__wosTopWatch) {
        let t = 0; const again = () => { clearTimeout(t); t = setTimeout(() => { if (f.isConnected) frameEdge(f); }, 150); };
        v.__wosTopWatch = 1; ['hashchange', 'popstate'].forEach(e => v.addEventListener(e, again));
        d.addEventListener('load', e => { if (e.target.tagName === 'IMG') again(); }, true);
      }
    } catch (e) {}
    we.classList.toggle('edge-own', own);
    // The heading shows `top`, else `bg`: say when that colour is light so its title takes a dark ink (skin-frame.css).
    let light = false;
    if (top || bg) try {
      // Computed colours can use sRGB, display-p3 or oklch coordinates, not just legacy RGB notation.
      // Reuse the browser's canvas conversion to sRGB instead of parsing coordinates.
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const x = cv.getContext('2d', { willReadFrequently: true });
      x.fillStyle = top || bg; x.fillRect(0, 0, 1, 1);
      let rgb = x.getImageData(0, 0, 1, 1).data;
      if (rgb[3] < 255) {
        // Text-bearing headings must be opaque. Flatten translucent app paint over
        // the phone frame's existing dark fallback, then paint exactly what we measured.
        const alpha = rgb[3] / 255;
        rgb = [15, 16, 20].map((base, i) => Math.round(rgb[i] * alpha + base * (1 - alpha)));
        const opaque = '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
        if (top) top = opaque; else bg = opaque;
      }
      const lin = c => (c /= 255) <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      light = .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2]) > .18;
    } catch (e) {} // Inaccessible or unmeasurable apps retain light ink on the dark fallback.
    we.classList.toggle('edge-light', light);
    if (bg) we.style.setProperty('--frame-bg', bg); else we.style.removeProperty('--frame-bg');
    if (top) we.style.setProperty('--frame-top', top); else we.style.removeProperty('--frame-top');
  }
  return { frameEdge, shareCutout };
};
