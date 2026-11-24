// chats.js parts (wizard-ux issue 1665): blocks of createChats moved verbatim into web/core/chats-<part>.js and called
// once from where they were: `const { ... } = window.WizCore.chatsParts.<part>({ ... });`. Tests that run a slice of
// chats.js in a vm can put each part's body back in place of its call line, so the slice runs exactly the code it
// ran before the move, in one scope (the part's private names stay reachable, as they were). A part that reads names
// chats.js declares further down gets them late-bound (`let a, b; // late-bound` in the part and `<part>Late({ a })`
// lines in chats.js); in the put-back scope those are the real declarations again, so both are dropped. Values
// chats.js reassigns stay there and a part reads and writes them as `chatVars.<name>` (accessors chats.js declares at
// the top of createChats); put back, those are the plain names again and the accessor block is dropped. A part may
// itself call an earlier part; its body is put back the same way.
import { readFileSync } from 'node:fs';

const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;
const VARS = /^ {2}\/\* Values this closure changes over time[^\n]*\n(?: {3}\*[^\n]*\n)* {2}const chatVars = \{\n(?: {4}get [^\n]*\n)* {2}\};\n/m;
const BIND = /^ {2}[a-z]+Late\(\{[^\n]*\}\);\n/gm;
const CALL = /^ {2}(?:const \{[^\n]*\} = )?window\.WizCore\.chatsParts\.([a-z]+)\([^\n]*\);$/gm;

export function partBody(part) {
  const file = readFileSync(new URL(`../../web/core/chats-${part}.js`, import.meta.url), 'utf8');
  const head = file.indexOf(`window.WizCore.chatsParts.${part} = function (`);
  const start = file.indexOf('\n', head) + 1, end = file.lastIndexOf('\n  return { ');
  if (head < 0 || end < start) throw new Error(`chats-${part}.js: part wrapper not found`);
  return withParts(file.slice(start, end).replace(LATE_LINE, ''))
    .replace(/\b([\w$]+): chatVars\.\1\b/g, '$1').replace(/\bchatVars\.([\w$]+)/g, '$1');
}

export function withParts(src) {
  return src.replace(VARS, '').replace(CALL, (_, part) => partBody(part)).replace(BIND, '');
}
