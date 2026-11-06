'use strict';
// Browser-free oracles shared by the queued viewer continuation and unit tests.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
function decodePNG(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height, channels, compressed = [];
  for (let at = 8; at < buf.length;) {
    const n = buf.readUInt32BE(at), kind = buf.toString('ascii', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + n); at += n + 12;
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); assert([2, 6].includes(data[9])); channels = data[9] === 6 ? 4 : 3; assert.equal(data[12], 0); }
    if (kind === 'IDAT') compressed.push(data);
  }
  const raw = zlib.inflateSync(Buffer.concat(compressed)), stride = width * channels, rows = Buffer.alloc(height * stride), rgba = Buffer.alloc(width * height * 4);
  assert.equal(raw.length, height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[y * stride + x - channels] : 0, b = y ? rows[(y - 1) * stride + x] : 0, c = y && x >= channels ? rows[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c), predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      rows[y * stride + x] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) { rows.copy(rgba, i * 4, i * channels, i * channels + 3); rgba[i * 4 + 3] = channels === 4 ? rows[i * channels + 3] : 255; }
  return { width, height, rgba };
}
function compare(a, b, roi = { x: 0, y: 0, width: a.width, height: a.height }) {
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  assert(roi.width > 0 && roi.height > 0 && roi.x >= 0 && roi.y >= 0 && roi.x + roi.width <= a.width && roi.y + roi.height <= a.height);
  let changed = 0, bounds = null; const examples = [];
  for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) {
    const i = (y * a.width + x) * 4;
    if (a.rgba.subarray(i, i + 4).equals(b.rgba.subarray(i, i + 4))) continue;
    changed++; if (!bounds) bounds = { left: x, top: y, right: x, bottom: y };
    bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y); bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
    if (examples.length < 8) examples.push({ x, y, a: [...a.rgba.subarray(i, i + 4)], b: [...b.rgba.subarray(i, i + 4)] });
  }
  return { changed, bounds, examples, roi };
}
function interiorROI(meta) {
  // Exclude rounded exterior, border/padding, text ranges and real controls.
  const inset = Math.ceil(Math.max(2, ...meta.radii, ...meta.borders, ...meta.padding)) + 2;
  for (let y = inset; y + 8 <= meta.height - inset; y += 2) for (let x = inset; x + 24 <= meta.width - inset; x += 2) {
    const r = { x, y, width: 24, height: 8 };
    if (!meta.exclusions.some(b => x < b.right + 2 && x + r.width > b.left - 2 && y < b.bottom + 2 && y + r.height > b.top - 2)) return r;
  }
  throw Error('No nonempty background-only panel interior');
}
function longMetrics(g) {
  assert(g.state.open && g.state.long && g.state.scale === 1, 'long-reading state must remain open/unzoomed');
  const minY = Math.min(0, g.stage.height - g.natural.height * g.stage.width / g.natural.width);
  return { minY, remaining: g.state.y - minY, footerBottom: g.image.bottom, stageBottom: g.stage.bottom };
}
function pageBudget(g) { const m = longMetrics(g); return Math.ceil(m.remaining / (g.stage.height * .85)) + 2; }
module.exports = { decodePNG, compare, interiorROI, longMetrics, pageBudget };
