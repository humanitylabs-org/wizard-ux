// Status spinners keep turning under Reduce Motion (Robert, 24 Oct 2026: "The loading icon in Working doesn't spin";
// 25 Oct: the "Updating Wizard OS" loading icon doesn't move).
// styles.css stops every animation for prefers-reduced-motion with `*` + !important (duration .01ms, one iteration),
// which froze the Working row spinner even though chats.css asks for a slower 3 s turn there. A loading indicator is
// status, not decoration: its reduced-motion rule must out-rank the global kill switch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const styles = read('web/styles.css')

const reducedBlocks = css => [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\})\s*\}/g)].map(m => m[1])
const ruleFor = (css, selector) => reducedBlocks(css).map(b => {
  const i = b.indexOf(selector + ' {'); return i < 0 ? null : b.slice(i, b.indexOf('}', i) + 1)
}).find(Boolean)

test('the global reduced-motion kill switch still exists (this test guards the exception, not the rule)', () => {
  assert.match(styles, /\*, \*::before, \*::after \{ animation-duration: \.01ms !important; animation-iteration-count: 1 !important;/)
})

for (const [file, selector, dur] of [
  ['web/core/chats.css', '.ch-row .emo.sti .spin', '3s'], // Working row
  ['web/core/chats.css', '.ch-head .emo.sti .spin, .ch-row .emo.sti .spin', '3s'], // Working row / thread header
  ['web/core/chats.css', '.ch-spin', '2.4s'], // Chats list "Updating…"
  ['web/core/attach-chip.css', '.ch-attspin', '2.4s'], // photo uploading in the composer (shared attachment chip)
  ['web/core/polish.css', '.wx-spin', '2.4s'], // "Reconnecting to Wizard" banner, message search
]) {
  test(`${selector}: reduced motion slows the spinner instead of freezing it`, () => {
    const rule = ruleFor(read(file), selector)
    assert.ok(rule, `no reduced-motion rule for ${selector} in ${file}`)
    assert.match(rule, new RegExp(`animation-duration: ${dur.replace('.', '\\.')} !important`))
    assert.match(rule, /animation-iteration-count: infinite !important/)
  })
}

// The tapped-Update overlay ("Updating Wizard OS..."): the burst around it is decoration and still drops out under
// Reduce Motion, but its ring is the only sign the reload is still on its way, so it keeps turning, slower.
test('.wos-burst .wb-core: the "Updating Wizard OS" ring keeps turning under reduced motion', () => {
  const rule = ruleFor(read('web/core/update-banner.css'), '.wos-burst .wb-core')
  assert.ok(rule, 'no reduced-motion rule for the update overlay ring')
  assert.match(rule, /animation: wb-spin 2\.4s linear infinite !important/)
})
