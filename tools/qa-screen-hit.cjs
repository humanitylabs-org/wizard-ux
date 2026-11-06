// In-page helpers for Screen page QA (passed to page.evaluate / page.waitForFunction; each is self-contained).
// They choose and verify real touch targets; they never change page state.

/**
 * An "outside" point for a real tap: the spot (css px) farthest from every visible sheet, chrome chip, pill, search
 * strip, handle and painted translation (and 16 px in from the screen edge) where elementFromPoint is the touch layer
 * itself. Returns diagnostics with the obstacles it avoided; point null when nothing is at least 24 px clear.
 */
function outsideTarget() {
  const W = innerWidth, H = innerHeight, layer = document.getElementById('layer');
  const shown = el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
  };
  const obstacles = [...document.querySelectorAll('#paint > *, .sheet, #top > *, #sub > *, #sstrip, #toast.show, .hd')].filter(shown).map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.id || el.className, l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  let best = null;
  for (let y = 16; y <= H - 16; y += 8) for (let x = 16; x <= W - 16; x += 8) {
    let d = Math.min(x, y, W - x, H - y);
    for (const o of obstacles) d = Math.min(d, Math.hypot(Math.max(o.l - x, 0, x - o.r), Math.max(o.t - y, 0, y - o.b)));
    if (d < 24 || (best && d <= best.d)) continue;
    if (document.elementFromPoint(x, y) !== layer) continue;
    best = { x, y, d: Math.round(d) };
  }
  const hit = best && document.elementFromPoint(best.x, best.y);
  return { point: best, hit: hit ? hit.id || hit.tagName : null, obstacles, viewport: [W, H] };
}

/**
 * A sheet (#sheet, #tbar, #langs) has finished moving: shown → `show`, transform none, fully on screen; hidden →
 * no `show` and visibility hidden (after its slide-out). Stable bounds for three frames either way.
 */
function sheetSettled([id, want]) {
  const el = document.getElementById(id), r = el.getBoundingClientRect(), s = getComputedStyle(el);
  const key = '__qaSettled_' + id, bounds = [r.left, r.top, r.right, r.bottom], prev = window[key];
  const stable = prev && prev.want === want && bounds.every((v, i) => Math.abs(v - prev.bounds[i]) < 0.1);
  window[key] = { want, bounds, frames: stable ? prev.frames + 1 : 0 };
  const ok = want
    ? el.classList.contains('show') && s.transform === 'none' && s.visibility !== 'hidden' && r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth
    : !el.classList.contains('show') && s.visibility === 'hidden';
  return ok && window[key].frames >= 3;
}

/** Where a real tap on #id lands: its centre (css px) and whether elementFromPoint there is that element or inside it. */
function hitTarget(id) {
  const el = document.getElementById(id), r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2, at = r.width ? document.elementFromPoint(x, y) : null;
  return { id, x, y, rect: [r.left, r.top, r.right, r.bottom], hit: at ? at.id || at.tagName : null, ok: !!(at && el.contains(at) && !el.disabled) };
}

module.exports = { outsideTarget, sheetSettled, hitTarget };
