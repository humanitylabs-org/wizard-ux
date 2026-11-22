// Miguel's skins (Dark, Light, Landscapes): row pins stay opt-in and the menu Pin stays available.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDocument } from './fixtures/mini-dom.mjs'
import { cascade } from './fixtures/mini-css.mjs'
import { rowSheet } from './fixtures/row-sheet-harness.mjs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const core = read('web/core/chats.css')
// A Chats row with its pin toggle (skeleton of web/core/chats-rows.js markup) on a skin; the winning declarations.
const toggle = (skin, sheets) => {
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin)
  doc.body.innerHTML = '<div class="ch-list"><div class="ch-row-wrap"><button class="ch-row" data-chopen="t1"></button><button class="ch-pin-toggle" aria-pressed="false"></button></div></div>'
  return cascade(doc.querySelector('.ch-pin-toggle'), sheets.join('\n')) // one text: source order across sheets
}
for (const [file, skin] of [['web/skins/obsidian/skin.css', 'obsidian'], ['web/skins/landscapes/skin.css', 'landscapes']]) {
  const css = read(file)
  test(`${file}: row pins are opt-in and the menu Pin stays available`, () => {
    assert.doesNotMatch(css, /ch-pin-toggle[^}]*display: none/)
    assert.doesNotMatch(css, /pin-action[^}]*display:\s*none/)
    // the row toggle stays hidden on this skin (core default), nothing forces it on
    assert.equal(toggle(skin, [core, css]).display.value, 'none')
    // the row menu (the real openRowSheet) still offers Pin and Unpin
    const sheet = rowSheet({ pinned: ['t2'], rows: { t1: { id: 't1', title: 'Plans' }, t2: { id: 't2', title: 'Old' } } })
    sheet.open('t1')
    assert.ok(sheet.buttons().some(b => /data-part="pin-action" data-rspin/.test(b.attrs) && b.label === 'Pin'))
    sheet.open('t2')
    assert.ok(sheet.buttons().some(b => /data-rspin/.test(b.attrs) && b.label === 'Unpin'))
  })
}
test('core keeps the row pin available to opt-in skins and tweaks', () => {
  const base = toggle('nebula', [core])
  assert.equal(base.position.value, 'absolute')
  assert.equal(base.display.value, 'none', 'off by default')
  // a skin that opts in (Sepia) shows the same core toggle
  const sepia = toggle('sepia', [core, read('web/skins/sepia/skin.css')])
  assert.equal(sepia.display.value, 'grid')
  assert.equal(sepia.position.value, 'absolute')
})
