// skin-host.js parts (wizard-ux issue 1665): blocks of core/skin-host.js moved verbatim into
// web/core/skin-host-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.skinHostParts.<part>({ ... });`. Tests that run or read skin-host.js put each
// part's body back in place of its call line, so they see exactly the code (and the one scope) they saw before the
// move. Same recipe as tests/fixtures/app-parts.mjs. Text without skinHostParts calls comes back unchanged, so a
// test that reads several files may pass each one through.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const CALL = /^ {2}const \{[^\n]*\} = window\.WizCore\.skinHostParts\.([a-z]+)\([^\n]*\);$/gm;

export function skinHostPartBody(part) {
  const file = readFileSync(new URL(`../../web/core/skin-host-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.skinHostParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`skin-host-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '');
}

export function withSkinHostParts(src) {
  src = String(src);
  // Drop only the bindLate hand-overs a skinHostParts call names (`bindLate: rowsLate`), never another file's lines.
  const late = [...src.matchAll(CALL)].map(m => (m[0].match(/bindLate: ([a-z]+Late) \}/) || [])[1]).filter(Boolean);
  const out = src.replace(CALL, (_, part) => skinHostPartBody(part));
  return late.length ? out.replace(new RegExp(`^ {2}(?:${late.join('|')})\\(\\{[^\\n]*\\}\\);\\n`, 'gm'), '') : out;
}
