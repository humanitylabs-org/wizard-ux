// Miguel's skins (Dark, Light, Landscapes): no chat pins, and the phone list's bottom room is a real spacer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
for (const [file, pre] of [['web/skins/obsidian/skin.css', 'html[data-skin^="obsidian"]'], ['web/skins/landscapes/skin.css', 'html[data-skin="landscapes"]']]) {
  const css = read(file)
  test(`${file}: pin button and Pin action hidden`, () => {
    assert.ok(css.includes(`${pre} .ch-pin-toggle, ${pre} .ch-sheet [data-rspin] { display: none; }`))
    assert.ok(css.includes(`${pre} .ch-row-wrap > .ch-row { padding-right: 8px; }`))
  })
  test(`${file}: list bottom room is a flex spacer, not scroll padding`, () => {
    assert.match(css, /\.win\.solo\.app-chats \.ch-list \.ch-scroll::after \{ content: ""; display: block; order: 99; flex: 0 0 calc\(var\(--pill-top\) \+ 66px\); \}/)
    assert.doesNotMatch(css, /\.win\.solo\.app-chats \.ch-list \.ch-scroll \{ padding-bottom: calc\(var\(--pill-top\)/)
  })
}
test('core keeps pins for every other skin', () => {
  assert.match(read('web/core/chats.css'), /\.ch-pin-toggle \{ position: absolute;/)
})
