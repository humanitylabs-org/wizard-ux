// Parses AndroidManifest.xml (or any small XML file) into its elements, so manifest tests read the declared
// attributes the way Android does instead of matching the file's text (wizard-ux issue 1674).
// manifest(text?) -> [{ tag, attrs, depth, parent }] in document order; defaults to the app's AndroidManifest.xml.
import { readFileSync } from 'node:fs';

const MANIFEST = new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url);

export function parseXml(text) {
  const out = []; const stack = [];
  const body = text.split(/<!--[\s\S]*?-->/).join(' ');
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(body))) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (!open || open.tag !== tag) throw new Error(`unbalanced </${tag}>`);
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
    const el = { tag, attrs, depth: stack.length, parent: stack[stack.length - 1] || null };
    out.push(el);
    if (!selfClose) stack.push(el);
  }
  if (stack.length) throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
  return out;
}

export function manifest(text = readFileSync(MANIFEST, 'utf8')) { return parseXml(text); }
