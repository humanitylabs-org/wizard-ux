// Working spinners keep turning under Reduce Motion (Robert, 24 Oct 2026: "The loading icon in Working doesn't spin").
// styles.css stops every animation for prefers-reduced-motion with `*` + !important (duration .01ms, one iteration),
// which froze the Working row spinner even though chats.css asks for a slower 3 s turn there. A loading indicator is
// status, not decoration: its reduced-motion rule must out-rank the global kill switch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const chats = read('web/core/chats.css')
const styles = read('web/styles.css')

const reducedBlocks = css => [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\})\s*\}/g)].map(m => m[1])
const ruleFor = (css, selector) => reducedBlocks(css).map(b => {
  const i = b.indexOf(selector + ' {'); return i < 0 ? null : b.slice(i, b.indexOf('}', i) + 1)
}).find(Boolean)

test('the global reduced-motion kill switch still exists (this test guards the exception, not the rule)', () => {
  assert.match(styles, /\*, \*::before, \*::after \{ animation-duration: \.01ms !important; animation-iteration-count: 1 !important;/)
})

for (const [selector, dur] of [['.ch-row .emo.sti .spin', '3s'], ['.ch-head .emo.sti .spin, .ch-row .emo.sti .spin', '3s'], ['.ch-spin', '2.4s']]) {
  test(`${selector}: reduced motion slows the spinner instead of freezing it`, () => {
    const rule = ruleFor(chats, selector)
    assert.ok(rule, `no reduced-motion rule for ${selector}`)
    assert.match(rule, new RegExp(`animation-duration: ${dur.replace('.', '\\.')} !important`))
    assert.match(rule, /animation-iteration-count: infinite !important/)
  })
}
