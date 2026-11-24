// desktop.js parts (wizard-ux issue 1665): blocks of desktop/desktop.js (the desktop shell) moved verbatim into
// web/desktop/desktop-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.desktopParts.<part>({ ... });` (or a bare call when the part returns nothing).
// Tests that run or read desktop.js put each part's body back in place of its call line, so they see exactly the
// code (and the one scope) they saw before the move. Same recipe as tests/fixtures/app-parts.mjs. Text without
// desktopParts calls comes back unchanged, so a test that reads several shells may pass each one through.
// Values desktop.js reassigns stay there and a part reads and writes them as `desktopVars.<name>` (get/set accessors desktop.js
// declares at the top of its scope); put back, those are the plain names again and the accessor block is dropped. A
// part may itself call an earlier part; its body is put back the same way.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const VARS = /^ {2}\/\* Values this shell changes over time[^\n]*\n(?: {3}\*[^\n]*\n)* {2}const desktopVars = \{\n(?: {4}get [^\n]*\n)* {2}\};\n/m;
const CALL = /^ {2}(?:const \{[^\n]*\} = )?window\.WizCore\.desktopParts\.([a-z]+)\([^\n]*\);$/gm;

function rawBody(part) {
  const file = readFileSync(new URL(`../../web/desktop/desktop-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.desktopParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`desktop-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '')
    .replace(/\b([\w$]+): desktopVars\.\1\b(?=\s*[,}])/g, '$1').replace(/\bdesktopVars\.([\w$]+)/g, '$1');
}

export function desktopPartBody(part) {
  return withDesktopParts(rawBody(part));
}

export function withDesktopParts(src) {
  src = String(src).replace(VARS, '');
  // Put every part back (parts inside parts too), then drop only the bindLate hand-overs those calls named
  // (`bindLate: homeLate`), never another file's lines.
  const late = [];
  for (let n = 0; n < 8 && CALL.test(src); n++) {
    CALL.lastIndex = 0;
    for (const m of src.matchAll(CALL)) { const l = (m[0].match(/bindLate: ([a-z]+Late) \}/) || [])[1]; if (l) late.push(l); }
    src = src.replace(CALL, (_, part) => rawBody(part));
  }
  CALL.lastIndex = 0;
  return late.length ? src.replace(new RegExp(`^ {2}(?:${late.join('|')})\\(\\{[^\\n]*\\}\\);\\n`, 'gm'), '') : src;
}
