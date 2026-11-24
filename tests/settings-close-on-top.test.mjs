import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { between } from './fixtures/source-slice.mjs';

// The Settings X must stay tappable whatever a skin does to the body below it (a fade mask, a transform or a
// filter puts the scrolling body on its own layer, which then paints over an unlayered X and swallows the tap).
const read = p => readFileSync(new URL(`../web/${p}`, import.meta.url), 'utf8');
const layered = st => /^(absolute|relative|fixed|sticky)$/.test(st.position || '') && +st['z-index'] >= 1;

test('Settings close button sits on its own layer above the settings body (phone and desktop)', () => {
  // phone: the Settings sheet as index.html draws it, styled by the phone and Settings CSS
  const html = read('index.html'), phone = createDocument();
  phone.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '');
  const x = phone.querySelector('#settings > .st-close'); assert.ok(x, 'the phone sheet has its X');
  const ps = styles(x, [read('core/settings.css'), read('styles.css')]);
  assert.equal(ps.position, 'absolute'); assert.ok(layered(ps), JSON.stringify(ps));
  // desktop: the Settings surface the desktop shell builds (desktop-palopen.js), styled by its CSS
  const src = read('desktop/desktop-palopen.js'), desk = createDocument();
  const make = between(src, "  const setEl = document.createElement('section');", '  document.body.appendChild(setEl);');
  const setEl = vm.runInNewContext(`${make}\nsetEl`, { document: desk });
  desk.body.appendChild(setEl);
  const dx = desk.querySelector('.dsettings > .st-close'); assert.ok(dx, 'the desktop surface has its X');
  const ds = styles(dx, [read('desktop/desktop.css'), read('core/settings.css')]);
  assert.equal(ds.position, 'relative'); assert.ok(layered(ds), JSON.stringify(ds));
});
