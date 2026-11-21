// desktop.js parts (wizard-ux issue 1665): blocks of desktop/desktop.js (the desktop shell) moved verbatim into
// web/desktop/desktop-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.desktopParts.<part>({ ... });` (or a bare call when the part returns nothing).
// Tests that run or read desktop.js put each part's body back in place of its call line, so they see exactly the
// code (and the one scope) they saw before the move. Same recipe as tests/fixtures/app-parts.mjs. Text without
// desktopParts calls comes back unchanged, so a test that reads several shells may pass each one through.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const CALL = /^ {2}(?:const \{[^\n]*\} = )?window\.WizCore\.desktopParts\.([a-z]+)\([^\n]*\);$/gm;

export function desktopPartBody(part) {
  const file = readFileSync(new URL(`../../web/desktop/desktop-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.desktopParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`desktop-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '');
}

export function withDesktopParts(src) {
  src = String(src);
  // Drop only the bindLate hand-overs a desktopParts call names (`bindLate: cogLate`), never another file's lines.
  const late = [...src.matchAll(CALL)].map(m => (m[0].match(/bindLate: ([a-z]+Late) \}/) || [])[1]).filter(Boolean);
  const out = src.replace(CALL, (_, part) => desktopPartBody(part));
  return late.length ? out.replace(new RegExp(`^ {2}(?:${late.join('|')})\\(\\{[^\\n]*\\}\\);\\n`, 'gm'), '') : out;
}
