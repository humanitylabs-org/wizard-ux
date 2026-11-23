// pB helpers (wizard-ux issue 1674, run pB): cut one whole statement out of a big shell file so a test can RUN it.
// stmt(src, marker) starts at the line holding `marker` and takes as many following lines as it needs to make
// complete statements (it parses each candidate), so a reflow of the statement over several lines still slices.
// A line that only continues the statement (`? a`, `&& b`, `.then(...)`) is taken with it.
// It throws when the marker is missing or no complete statement starts there.
import vm from 'node:vm';

const parses = code => { try { new vm.Script(`(async function () {\n${code}\n})`); return true; } catch { return false; } };

const CONTINUES = /^\s*(?:\?\??|:|\.(?!\.\.)|,|&&|\|\||[-+*/%]|\)|\]|\}\))(?!\/)/;

export function stmt(src, marker, { maxLines = 60 } = {}) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`stmt: missing ${marker}`);
  const lines = src.split('\n');
  const at = src.slice(0, i).split('\n').length - 1;
  for (let back = 0; back <= 6 && at - back >= 0; back++) {
    for (let n = 1; n <= maxLines && at - back + n <= lines.length; n++) {
      const code = lines.slice(at - back, at - back + n).join('\n');
      if (!parses(code)) continue;
      // A complete statement can still go on: the next line continues the expression (`? ...`, `&& ...`, `.then(...)`).
      let end = at - back + n;
      while (end < lines.length && CONTINUES.test(lines[end])) {
        let m = end + 1; while (m <= Math.min(lines.length, end + maxLines) && !parses(lines.slice(at - back, m).join('\n'))) m++;
        if (m > Math.min(lines.length, end + maxLines)) break; end = m;
      }
      return lines.slice(at - back, end).join('\n');
    }
  }
  throw new Error(`stmt: no complete statement at ${marker}`);
}

// An event whose target answers closest(sel) from a map of selector -> element (anything else: null).
export function tap(map) {
  return { target: { closest: sel => (sel in map ? map[sel] : null) }, preventDefault() {}, stopPropagation() {} };
}

// vm values to plain data (vm-realm arrays fail deepEqual against literals).
export const plain = v => JSON.parse(JSON.stringify(v));
