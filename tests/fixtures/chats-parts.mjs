// chats.js parts (wizard-ux issue 1665): blocks of createChats moved verbatim into web/core/chats-<part>.js and called
// once from where they were: `const { ... } = window.WizCore.chatsParts.<part>({ ... });`. Tests that run a slice of
// chats.js in a vm can put each part's body back in place of its call line, so the slice runs exactly the code it
// ran before the move, in one scope (the part's private names stay reachable, as they were).
import { readFileSync } from 'node:fs';

const CALL = /^ {2}const \{[^\n]*\} = window\.WizCore\.chatsParts\.([a-z]+)\([^\n]*\);$/gm;

export function partBody(part) {
  const file = readFileSync(new URL(`../../web/core/chats-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.chatsParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`chats-${part}.js: part wrapper not found`);
  return file.slice(start, end);
}

export function withParts(src) {
  return src.replace(CALL, (_, part) => partBody(part));
}
