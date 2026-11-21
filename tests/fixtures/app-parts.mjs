// app.js parts (wizard-ux issue 1665): blocks of app.js (the phone shell) moved verbatim into
// web/app-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.appParts.<part>({ ... });`. Tests that run or read app.js put each
// part's body back in place of its call line, so they see exactly the code (and the one scope) they saw before the
// move. Same recipe as tests/fixtures/chats-parts.mjs. Text without appParts calls comes back unchanged, so a test
// that reads several shells may pass each one through.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const CALL = /^ {2}const \{[^\n]*\} = window\.WizCore\.appParts\.([a-z]+)\([^\n]*\);$/gm;

export function appPartBody(part) {
  const file = readFileSync(new URL(`../../web/app-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.appParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`app-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '');
}

export function withAppParts(src) {
  src = String(src);
  // Drop only the bindLate hand-overs an appParts call names (`bindLate: homeLate`), never another file's lines.
  const late = [...src.matchAll(CALL)].map(m => (m[0].match(/bindLate: ([a-z]+Late) \}/) || [])[1]).filter(Boolean);
  const out = src.replace(CALL, (_, part) => appPartBody(part));
  return late.length ? out.replace(new RegExp(`^ {2}(?:${late.join('|')})\\(\\{[^\\n]*\\}\\);\\n`, 'gm'), '') : out;
}
