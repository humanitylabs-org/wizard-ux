// Miguel's skins (Dark, Light, Landscapes): pins follow the shared default, and the phone list's bottom room is a real spacer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
for (const [file, pre] of [['web/skins/obsidian/skin.css', 'html[data-skin^="obsidian"]'], ['web/skins/landscapes/skin.css', 'html[data-skin^="landscapes"]']]) {
  const css = read(file)
  test(`${file}: the skin itself never hides pins (the shared default and the Show pin buttons tweak decide)`, () => {
    assert.doesNotMatch(css, /ch-pin-toggle[^}]*display: none/)
  })
  test(`${file}: list bottom room is a flex spacer, not scroll padding`, () => {
    assert.match(css, /\.win\.solo\.app-chats \.ch-list \.ch-scroll::after \{ content: ""; display: block; order: 99; flex: 0 0 calc\(var\(--pill-top\) \+ 66px\); \}/)
    assert.doesNotMatch(css, /\.win\.solo\.app-chats \.ch-list \.ch-scroll \{ padding-bottom: calc\(var\(--pill-top\)/)
  })
}
test('core keeps the pin button styling for the Show pin buttons tweak', () => {
  assert.match(read('web/core/chats.css'), /\.ch-pin-toggle \{ position: absolute;/)
})
