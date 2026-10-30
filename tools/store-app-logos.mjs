// Installed apps' own logos, for the shell's app icons (core/apps.js → core/sigils.js).
// Source: the logo Runtipi keeps for each installed app (<runtipi>/apps/<store>/<id>/metadata/logo.jpg; the App
// Manager writes a wizard.md `icon:` there too). Only apps in the App Manager registry, only real raster/SVG images
// up to 1 MB, never the template/Runtipi placeholder. The version is the image's own hash, so a changed logo shows on
// the next reload while an unchanged one stays cached.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const LOGO_VERSION = /^[0-9a-f]{16}$/;
export const MAX_LOGO = 1024 * 1024;
// sha256 of logos that mean "no logo": the hello-wizard template (wam new) and Runtipi's default-app-logo.jpg.
export const PLACEHOLDER_LOGOS = new Set([
  '59b4d70aa80ab18cd3bcfa0e998d2f1b570bd86c2edac5be588f4a64626675c6',
  '41191af41f7a8e159a11abde437db1ad1f8776fd5388ef806cde74dbef1b9a7e',
]);

// The image type from its bytes (the file is always called logo.jpg; many are PNG).
export function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return '';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  // SVG: an optional XML declaration and a few comments, then <svg (walked, not one regex: no backtracking).
  let head = b.toString('utf8', 0, 512).replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('<?xml')) { const e = head.indexOf('?>'); head = e < 0 ? '' : head.slice(e + 2).trimStart(); }
  for (let i = 0; i < 8 && head.startsWith('<!--'); i++) { const e = head.indexOf('-->'); head = e < 0 ? '' : head.slice(e + 3).trimStart(); }
  return /^<svg[\s>]/i.test(head) ? 'image/svg+xml' : '';
}

export function createAppLogos({ readWam, runtipiRoot, stat = statSync, read = readFileSync, placeholders = PLACEHOLDER_LOGOS }) {
  const cache = new Map();   // id → { key, logo: { body, type, v } | null }
  function load(app) {
    const [id, store] = String(app.urn || '').split(':');
    if (id !== app.id || !ID.test(store || '')) return null;
    const file = join(runtipiRoot, 'apps', store, id, 'metadata', 'logo.jpg');
    let st; try { st = stat(file); } catch (_) { cache.delete(id); return null; }
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    const hit = cache.get(id);
    if (hit && hit.key === key) return hit.logo;
    let logo = null;
    if (st.isFile() && st.size > 0 && st.size <= MAX_LOGO) {
      const body = read(file), type = sniffImage(body), sum = createHash('sha256').update(body).digest('hex');
      if (type && !placeholders.has(sum)) logo = { body, type, v: sum.slice(0, 16) };
    }
    cache.set(id, { key, logo });
    return logo;
  }
  const apps = () => {
    const doc = readWam();
    return (Array.isArray(doc?.apps) ? doc.apps : []).filter(a => ID.test(a?.id || '')).slice(0, 500);
  };
  return {
    // { <app id>: <version> } for every installed app that ships a real logo.
    list() {
      const out = {};
      for (const a of apps()) { const l = load(a); if (l) out[a.id] = l.v; }
      return out;
    },
    get(id) {
      if (!ID.test(id || '')) return null;
      const a = apps().find(x => x.id === id);
      return a ? load(a) : null;
    },
  };
}
