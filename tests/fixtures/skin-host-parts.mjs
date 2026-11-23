// skin-host.js parts (wizard-ux issue 1665): blocks of core/skin-host.js moved verbatim into
// web/core/skin-host-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.skinHostParts.<part>({ ... });`. Tests that run or read skin-host.js put each
// part's body back in place of its call line, so they see exactly the code (and the one scope) they saw before the
// move. Same recipe as tests/fixtures/app-parts.mjs. Values skin-host.js reassigns stay there and a part reads and
// writes them as `skinHostVars.<name>` (accessors skin-host.js declares at the top of its closure); put back, those
// are the plain names again and the accessor block is dropped. Text without skinHostParts calls comes back unchanged,
// so a test that reads several files may pass each one through.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const CALL = /^ {2}(?:const \{[^\n]*\} = )?window\.WizCore\.skinHostParts\.([a-z]+)\([^\n]*\);$/gm;
const VARS = /^ {2}\/\* Values this file changes over time[^\n]*\n(?: {3}\*[^\n]*\n)* {2}const skinHostVars = \{\n(?: {4}get [^\n]*\n)* {2}\};\n/m;

// root: another checkout's top folder (a test that runs a selected tree, e.g. QA_SETTINGS_SOURCE), so its parts
// come from the same tree as its skin-host.js; this repo's when left out.
export function skinHostPartBody(part, root) {
  const at = root ? new URL(`web/core/skin-host-${part}.js`, pathToFileURL(root.endsWith('/') ? root : root + '/'))
    : new URL(`../../web/core/skin-host-${part}.js`, import.meta.url);
  const file = readFileSync(at, 'utf8');
  const head = file.indexOf(`window.WizCore.skinHostParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`skin-host-${part}.js: part wrapper not found`);
  return withSkinHostParts(file.slice(start, end).replace(LATE_LINE, ''), root)
    .replace(/\b([\w$]+): skinHostVars\.\1\b(?=\s*[,}])/g, '$1').replace(/\bskinHostVars\.([\w$]+)/g, '$1');
}

export function withSkinHostParts(src, root) {
  src = String(src).replace(VARS, '');
  // Drop only the bindLate hand-overs a skinHostParts call names (`bindLate: rowsLate`), never another file's lines.
  const late = [...src.matchAll(CALL)].map(m => (m[0].match(/bindLate: ([a-z]+Late) \}/) || [])[1]).filter(Boolean);
  const out = src.replace(CALL, (_, part) => skinHostPartBody(part, root));
  return late.length ? out.replace(new RegExp(`^ {2}(?:${late.join('|')})\\(\\{[^\\n]*\\}\\);\\n`, 'gm'), '') : out;
}
