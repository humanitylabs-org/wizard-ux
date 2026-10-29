import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf("    let ex = document.getElementById('exitFull');"), source.indexOf('    const W_ = host.clientWidth'));
function harness() {
  let button, exits = 0;
  const ctx = { full: false, MOD: 'Ctrl+', ws: [{ mono: true }], cur: 0, toggleMono: () => { exits++; ctx.ws[0].mono = false; },
    document: { getElementById: () => button, createElement: () => ({ setAttribute(k,v) { this[k]=v; }, addEventListener(_k,fn) { this.click=fn; } }), body: { appendChild: b => button=b } } };
  vm.createContext(ctx); return { ctx, render(full) { ctx.full=full; vm.runInContext('{'+block+'}',ctx);return button; }, exits: () => exits };
}
test('visible fullscreen exit is created once, hidden off-mode, and has an accessible name', () => {
  const h=harness(), b=h.render(false);assert.equal(b.hidden,true);assert.equal(b.type,'button');assert.equal(b['aria-label'],'Exit full screen');
  assert.equal(h.render(true),b);assert.equal(b.hidden,false);assert.match(b.title,/Esc/);assert.equal(h.render(false).hidden,true);
});
test('exit button uses mono toggle only while fullscreen is active', () => {
  const h=harness(), b=h.render(true);b.click();assert.equal(h.exits(),1);b.click();assert.equal(h.exits(),1);
});
