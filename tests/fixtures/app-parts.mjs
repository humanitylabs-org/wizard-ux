// app.js parts (wizard-ux issue 1665): blocks of app.js (the phone shell) moved verbatim into
// web/app-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.appParts.<part>({ ... });`. Tests that run or read app.js put each
// part's body back in place of its call line, so they see exactly the code (and the one scope) they saw before the
// move. Same recipe as tests/fixtures/chats-parts.mjs. Text without appParts calls comes back unchanged, so a test
// that reads several shells may pass each one through.
// Values app.js reassigns stay there and a part reads and writes them as `appVars.<name>` (get/set accessors app.js
// declares at the top of its scope); put back, those are the plain names again and the accessor block is dropped. A
// part may itself call an earlier part; its body is put back the same way.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const VARS = /^ {2}\/\* Values this shell changes over time[^\n]*\n(?: {3}\*[^\n]*\n)* {2}const appVars = \{\n(?: {4}get [^\n]*\n)* {2}\};\n/m;
const CALL = /^ {2}(?:const \{[^\n]*\} = )?window\.WizCore\.appParts\.([a-z]+)\([^\n]*\);$/gm;

function rawBody(part) {
  const file = readFileSync(new URL(`../../web/app-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.appParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`app-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '')
    .replace(/\b([\w$]+): appVars\.\1\b(?=\s*[,}])/g, '$1').replace(/\bappVars\.([\w$]+)/g, '$1');
}

export function appPartBody(part) {
  return withAppParts(rawBody(part));
}

export function withAppParts(src) {
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
