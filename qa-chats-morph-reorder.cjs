// Ready reorders (Oldest, a thread moving to the top or bottom) must never leave a stale row beside its replacement.
// James, 23 Oct 2026: "the sort by oldest is not working … they're out of order" (a 16m row stuck second under Oldest).
// Usage: QA_TREE=<repo> node qa-chats-morph-reorder.cjs
const fs = require('fs'), path = require('path');
const TREE = process.env.QA_TREE || __dirname;
const { chromium } = require(path.join(TREE, 'tools/qa-playwright.cjs'));
const row = id => `<div class="ch-row-wrap"><button data-chopen="${id}">${id}</button><button class="pin" data-chpin="${id}">p</button></div>`;
const list = ids => `<div class="ch-list" data-part="list"><section data-sec="ready">${ids.map(row).join('')}</section></div>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<div id="host"></div>');
  await p.addScriptTag({ content: fs.readFileSync(path.join(TREE, 'web/core/dom-morph.js'), 'utf8') });
  const cases = [
    [['F', 'Q', 'U', 'C', 'P', 'A'], ['F', 'A', 'Q', 'U', 'C', 'P']], // newest moved
    [['A', 'F', 'Q', 'U'], ['F', 'Q', 'U', 'A']],                     // Newest -> Oldest flip
    [['F', 'Q', 'U'], ['F', 'X', 'Q', 'U']],                          // new row inserted
    [['F', 'Q', 'U'], ['F', 'U']],                                    // row removed
  ];
  let fail = 0;
  for (const [a, z] of cases) {
    const got = await p.evaluate(([a, z]) => {
      const host = document.getElementById('host'); host.innerHTML = a; const root = host.firstElementChild;
      window.WosMorph.morph(root, z);
      return { order: [...root.querySelectorAll('[data-chopen]')].map(n => n.dataset.chopen), wraps: [...root.querySelectorAll('.ch-row-wrap')].map(w => w.querySelectorAll('[data-chopen]').length), html: root.innerHTML === new DOMParser().parseFromString(z, 'text/html').body.firstElementChild.innerHTML };
    }, [list(a), list(z)]);
    const ok = got.order.join() === z.join() && got.wraps.every(n => n === 1) && got.html;
    if (!ok) fail++;
    console.log(ok ? 'PASS' : 'FAIL', a.join(''), '->', z.join(''), JSON.stringify(got));
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
