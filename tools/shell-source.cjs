// Shell source for text checks (wizard-ux issue 1665): web/app.js and web/desktop/desktop.js call parts in
// web/app-*.js and web/desktop/desktop-*.js (and core/skin-host.js and core/chats.js theirs in core/skin-host-*.js and
// core/chats-*.js). shellSource(root, file) returns a shell's text with every part body put
// back where its call line is, the late-bound hand-overs and the accessor block dropped, and `appVars.x` /
// `desktopVars.x` read as plain `x` again, so a check sees the code exactly as it was before the move. Same recipe as
// tests/fixtures/app-parts.mjs and desktop-parts.mjs (for CommonJS scripts). Any other file comes back unchanged.
'use strict';
const fs = require('node:fs'), path = require('node:path');

const SHELLS = [
  { ns: 'appParts', vars: 'appVars', file: part => `web/app-${part}.js` },
  { ns: 'desktopParts', vars: 'desktopVars', file: part => `web/desktop/desktop-${part}.js` },
  { ns: 'skinHostParts', vars: 'skinHostVars', file: part => `web/core/skin-host-${part}.js`, what: 'file' },
  { ns: 'chatsParts', vars: 'chatVars', file: part => `web/core/chats-${part}.js`, what: 'closure' },
];
const LATE_LINE = /^ {2}let [^\n]*; \/\/ late-bound: [^\n]*\n/m;

function withShellParts(root, src) {
  src = String(src);
  for (const s of SHELLS) {
    const VARS = new RegExp(`^ {2}\\/\\* Values this ${s.what || 'shell'} changes over time[^\\n]*\\n(?: {3}\\*[^\\n]*\\n)* {2}const ${s.vars} = \\{\\n(?: {4}get [^\\n]*\\n)* {2}\\};\\n`, 'm');
    const CALL = new RegExp(`^ {2}(?:const \\{[^\\n]*\\} = )?window\\.WizCore\\.${s.ns}\\.([a-z]+)\\([^\\n]*\\);$`, 'gm');
    const body = part => {
      const text = fs.readFileSync(path.join(root, s.file(part)), 'utf8');
      const head = text.indexOf(`window.WizCore.${s.ns}.${part} = function (`);
      const start = text.indexOf('\n', head) + 1, end = text.lastIndexOf('\n  return { ');
      if (head < 0 || end < start) throw new Error(`${s.file(part)}: part wrapper not found`);
      return text.slice(start, end).replace(LATE_LINE, '')
        .replace(new RegExp(`\\b([\\w$]+): ${s.vars}\\.\\1\\b(?=\\s*[,}])`, 'g'), '$1').replace(new RegExp(`\\b${s.vars}\\.([\\w$]+)`, 'g'), '$1');
    };
    src = src.replace(VARS, '');
    const late = [];
    for (let n = 0; n < 8 && src.match(CALL); n++) {
      for (const m of src.matchAll(CALL)) { const l = (m[0].match(/bindLate: ([a-z]+Late) \}/) || [])[1]; if (l) late.push(l); }
      src = src.replace(CALL, (_, part) => body(part));
    }
    if (late.length) src = src.replace(new RegExp(`^ {2}(?:${late.join('|')})\\(\\{[^\\n]*\\}\\);\\n`, 'gm'), '');
  }
  return src;
}

/** root: the repo root (holds web/); file: a path under it, e.g. 'web/app.js'. */
function shellSource(root, file) { return withShellParts(root, fs.readFileSync(path.join(root, file), 'utf8')); }

module.exports = { shellSource, withShellParts };
