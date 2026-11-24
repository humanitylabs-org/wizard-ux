// live.js parts (wizard-ux issue 1665): blocks of live.js moved verbatim into
// web/live-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.liveParts.<part>({ ... });`. Tests that run or read live.js put each
// part's body back in place of its call line, so they see exactly the code (and the one scope) they saw before the
// move. Same recipe as tests/fixtures/chats-parts.mjs.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const BIND = /^ {2}[a-z]+Late\(\{[^\n]*\}\);\n/gm;
const CALL = /^ {2}const \{[^\n]*\} = window\.WizCore\.liveParts\.([a-z]+)\([^\n]*\);$/gm;

export function livePartBody(part) {
  const file = readFileSync(new URL(`../../web/live-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.liveParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`live-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '');
}

export function withLiveParts(src) {
  return String(src).replace(CALL, (_, part) => livePartBody(part)).replace(BIND, '');
}
