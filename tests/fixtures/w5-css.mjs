// Small helpers around tests/fixtures/mini-css.mjs (wizard-ux issue 1674: tests run the code, CSS included).
//  - mini-dom splits a selector at every `~`, so `[data-tweaks~="x"]` (a tweak's or skin's switch) cannot be
//    matched as written; wordAttrs() spells each `[a~="v"]` as the same test on whole words with ^= / $= / *= / =.
//  - cascade() over several sheets restarts source order per sheet; sheets() joins them into one text so a later
//    sheet wins a tie, as in a page that links them in that order.
import { cascade as miniCascade } from './mini-css.mjs';

export function wordAttrs(css) {
  return String(css).replace(/\[([\w-]+)~=\s*(?:"([^"]*)"|'([^']*)')\s*\]/g, (_, a, d, s) => {
    const v = d ?? s;
    return `:is([${a}="${v}"], [${a}^="${v} "], [${a}$=" ${v}"], [${a}*=" ${v} "])`;
  });
}

export const sheets = list => wordAttrs((Array.isArray(list) ? list : [list]).join('\n'));

// The winning declarations on `el` from these sheets (in this order), values only: { prop: value }.
export function styles(el, list, opts) {
  return Object.fromEntries(Object.entries(miniCascade(el, sheets(list), opts)).map(([k, v]) => [k, v.value]));
}
