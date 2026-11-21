// layouts/ai-apps/desktop.js parts (wizard-ux issue 1665): blocks of desktop(api) moved verbatim into the modules
// web/layouts/ai-apps/desktop-<part>.js (`export function <part>Part({ ... })`), imported by desktop.js and called
// once from where they were: `const { ... } = <part>Part({ ... });`. Tests that run or read desktop.js put each part's
// body back in place of its call line (and drop the part imports), so they see exactly the code, and the one scope,
// they saw before the move. A part that reads names desktop.js declares further down gets them late-bound
// (`let a, b; // late-bound` in the part and `<part>Late({ a })` lines in desktop.js); put back, those are the real
// declarations again, so both are dropped. Values desktop.js reassigns stay there and a part reads and writes them as
// `aadVars.<name>` (accessors desktop.js declares at the top of desktop(api)); put back, those are the plain names
// again and the accessor block is dropped. Text without part calls comes back unchanged, so a test that reads several
// files may pass each one through.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const IMPORT = /^import \{ ([a-z]+)Part \} from '\.\/desktop-\1\.js';\n/gm;
const CALL = /^ {2}(?:const \{[^\n]*\} = )?([a-z]+)Part\(\{[^\n]*\}\);$/gm;
const VARS = /^ {2}\/\* Values this view changes over time[^\n]*\n(?: {3}\*[^\n]*\n)* {2}const aadVars = \{\n(?: {4}get [^\n]*\n)* {2}\};\n/m;

// root: another checkout's top folder, so its parts come from the same tree as its desktop.js; this repo's when left out.
export function aadPartBody(part, root) {
  const at = root ? new URL(`web/layouts/ai-apps/desktop-${part}.js`, pathToFileURL(root.endsWith('/') ? root : root + '/'))
    : new URL(`../../web/layouts/ai-apps/desktop-${part}.js`, import.meta.url);
  const file = readFileSync(at, 'utf8');
  const head = file.indexOf(`export function ${part}Part({`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`desktop-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '')
    .replace(/\b([\w$]+): aadVars\.\1\b(?=\s*[,}])/g, '$1').replace(/\baadVars\.([\w$]+)/g, '$1');
}

export function withAadParts(src, root) {
  src = String(src);
  const parts = new Set([...src.matchAll(IMPORT)].map(m => m[1]));
  if (!parts.size) return src;
  src = src.replace(IMPORT, '').replace(VARS, '');
  const late = [];
  const out = src.replace(CALL, (line, part) => {
    if (!parts.has(part)) return line;
    const m = line.match(/bindLate: ([a-z]+Late) \}/); if (m) late.push(m[1]);
    return aadPartBody(part, root);
  });
  return late.length ? out.replace(new RegExp(`^ {2}(?:${late.join('|')})\\(\\{[^\\n]*\\}\\);\\n`, 'gm'), '') : out;
}
