// settings.js parts (wizard-ux issue 1665): blocks of core/settings.js moved verbatim into
// web/core/settings-<part>.js and called once from where they were:
// `const { ... } = window.WizCore.settingsParts.<part>({ ... });`. Tests that run or read settings.js put each
// part's body back in place of its call line, so they see exactly the code (and the one scope) they saw before the
// move. Same recipe as tests/fixtures/chats-parts.mjs.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const BIND = /^ {2}[a-z]+Late\(\{[^\n]*\}\);\n/gm;
const CALL = /^ {2}const \{[^\n]*\} = window\.WizCore\.settingsParts\.([a-z]+)\([^\n]*\);$/gm;

export function settingsPartBody(part) {
  const file = readFileSync(new URL(`../../web/core/settings-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.settingsParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`settings-${part}.js: part wrapper not found`);
  return file.slice(start, end).replace(LATE_LINE, '');
}

export function withSettingsParts(src) {
  return String(src).replace(CALL, (_, part) => settingsPartBody(part)).replace(BIND, '');
}
