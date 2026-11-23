// The phone dock's real paint code (web/app-desks.js paintOrbApp + renderDots), run in node:vm with a fake dock and
// fake desks, so tests read the dock an owner sees (wizard-ux issue 1674: tests run the code).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { between } from './source-slice.mjs';

const desks = readFileSync(new URL('../../web/app-desks.js', import.meta.url), 'utf8');

export function phoneDock({ count = 5, idx = 2, filled = [] } = {}) {
  const els = {}, made = [];
  const node = id => (els[id] ||= { id, className: '', innerHTML: '', hidden: false, attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(n) { this.kids.push(n); els[n.id] = n; } });
  const ctx = {
    appVars: { idx, desks: Array.from({ length: count }, (_, i) => ({ wins: filled.includes(i) ? ['w'] : [], home: i === 0 })) },
    $: sel => node(sel.replace(/^#/, '')), document: { getElementById: id => els[id] || null, createElement: tag => { const n = { tag, className: '', innerHTML: '', hidden: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }; made.push(n); return n; } },
    window: { WizSigil: { orb() {} } }, deskSigil: i => `<span class="dsg">${i}</span>`, deskName: i => `Desk ${i}`, isReviewDesk: () => false,
    atPickerEnd: () => false, esc: String };
  vm.createContext(ctx);
  vm.runInContext(`${between(desks, '  let orbAppHtml = null;', '  /* Dots: tap = jump to that desk.')}\nthis.renderDots = renderDots;`, ctx);
  return { ctx, els, made, render: () => ctx.renderDots() };
}
