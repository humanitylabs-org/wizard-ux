// Small slicing helpers for wizard-ux issue 1674 (run q1): cut one property's value out of an object literal so a test
// can RUN it (runRecording / vm) instead of matching its text. Whitespace and line breaks inside the value are free.
// prop(src, 'closeDesk') -> the source of the value after `closeDesk:` up to the top-level `,` or `}` that ends it.
export function prop(src, name, from = 0) {
  const re = new RegExp(`(^|[\\s,{])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'g');
  re.lastIndex = from;
  const m = re.exec(src);
  if (!m) throw new Error(`no ${name}: in the source`);
  let i = m.index + m[0].length, d = 0, q = '';
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { if (!d) break; d--; }
    else if (c === ',' && !d) break;
  }
  return src.slice(start, i).trim();
}
