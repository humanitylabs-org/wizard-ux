// Reproducible CSS-only Store seeds from the shipped palette tables/packages.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
const root = fileURLToPath(new URL('../', import.meta.url));
export function seeds() {
  const source = readFileSync(path.join(root, 'web/core/skins.js'), 'utf8');
  const table = source.slice(source.indexOf('const SKINS = [') + 'const SKINS = '.length, source.indexOf('\n  // Each skin\'s own display face'));
  const skins = vm.runInNewContext(table, { T: o => o });
  const core = readFileSync(path.join(root, 'web/core/skins.css'), 'utf8');
  return Array.from(skins).filter(s => s.id !== 'nebula').map(s => {
    if (s.pkg?.js) return { id: s.id, skipped: 'Requires skin.js' + (s.id === 'landscapes' ? ' and wallpaper image assets' : '') };
    const pattern = new RegExp(`html\\[data-skin=["']${s.id}["']\\]`, 'g');
    const own = [...core.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].includes(`html[data-skin="${s.id}"]`)).map(m => m[0].slice(m[0].includes('*/') ? m[0].lastIndexOf('*/') + 2 : 0).replace(pattern, 'html[data-skin]')).join('\n');
    const pkg = s.pkg?.css ? readFileSync(path.join(root, 'web/skins', s.pkg.dir || s.id, 'skin.css'), 'utf8').replace(pattern, 'html[data-skin]') : '';
    const css = `/* ${s.name}: CSS-only palette on top of Nebula. Animated canvas scenery is not exported. */\nhtml[data-skin] {\n${Object.entries(s.t).map(([k,v]) => `  --${k}: ${v} !important;`).join('\n')}\n  --sk-space: 0 !important;\n  --sk-orb: hue-rotate(${s.orb[0]}deg) saturate(${s.orb[1]}) brightness(${s.orb[2]}) !important;\n}\nhtml[data-skin] body, html[data-skin] .device { background: var(--bg); color: var(--ink); }\nhtml[data-skin] .skin-bg { visibility: hidden; }\nhtml[data-skin] .win { background: var(--sk-win); color: var(--ink); }\nhtml[data-skin] :is(.sheet, .wmenu, .pk-card, .ov-card, .dv-sheet, .ch-sheet-b, .ch-fcard, .wx-fcard, .ls-panel) { background: var(--glass-2); color: var(--ink); }\n${own}\n${pkg}\n`;
    return { id: s.id, css, metadata: { name: s.name, summary: s.who, base: 'nebula' } };
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const s of seeds()) {
    if (s.skipped) { console.log(`SKIP ${s.id}: ${s.skipped}`); continue; }
    const dir = path.join(root, 'seed/skins', s.id); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'skin.css'), s.css); writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(s.metadata, null, 2) + '\n');
    console.log(`SEED ${s.id}: ${Buffer.byteLength(s.css)} bytes`);
  }
}
