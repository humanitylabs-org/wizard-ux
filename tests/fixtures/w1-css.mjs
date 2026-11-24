// tests/fixtures/mini-css.mjs for stylesheets that scope rules with an attribute word match ([data-tweaks~="id"]):
// mini-dom's selector splitter reads that `~` as a sibling combinator. This hands the cascade the same selector
// spelled with exact / prefix / suffix / infix matches on space-separated words (what ~= means for these lists), inside
// :is(), so specificity is unchanged (:is counts its one attribute selector).
import { cascade as baseCascade, styleOf as baseStyleOf } from './mini-css.mjs';

export const wordMatch = css => String(css).replace(/\[([\w-]+)~=(?:"([^"]*)"|'([^']*)')\]/g, (_, k, a, b) => {
  const v = a ?? b; return `:is([${k}="${v}"],[${k}^="${v} "],[${k}$=" ${v}"],[${k}*=" ${v} "])`;
});
const prep = sheets => (Array.isArray(sheets) ? sheets : [sheets]).map(s => (typeof s === 'string' ? wordMatch(s) : s));
export const cascade = (el, sheets, opts) => baseCascade(el, prep(sheets), opts);
export const styleOf = (el, sheets, prop, opts) => baseStyleOf(el, prep(sheets), prop, opts);
