// Miguel's skins (Dark, Light, Landscapes): row pins stay opt-in and the menu Pin stays available.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
for (const [file, pre] of [['web/skins/obsidian/skin.css', 'html[data-skin^="obsidian"]'], ['web/skins/landscapes/skin.css', 'html[data-skin^="landscapes"]']]) {
  const css = read(file)
  test(`${file}: row pins are opt-in and the menu Pin stays available`, () => {
    assert.doesNotMatch(css, /ch-pin-toggle[^}]*display: none/)
    assert.doesNotMatch(css, /pin-action[^}]*display:\s*none/)
    assert.match(read('web/core/chats.js'), /data-part="pin-action" data-rspin/)
  })
}
test('core keeps the row pin available to opt-in skins and tweaks', () => {
  assert.match(read('web/core/chats.css'), /\.ch-pin-toggle \{ position: absolute;/)
})
