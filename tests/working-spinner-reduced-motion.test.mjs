// Status spinners keep turning under Reduce Motion (Robert, 24 Oct 2026: "The loading icon in Working doesn't spin";
// 25 Oct: the "Updating WizardOS" loading icon doesn't move).
// styles.css stops every animation for prefers-reduced-motion with `*` + !important (duration .01ms, one iteration),
// which froze the Working row spinner even though chats.css asks for a slower 3 s turn there. A loading indicator is
// status, not decoration: its reduced-motion rule must out-rank the global kill switch. Each test runs the real
// stylesheets through a small cascade (tests/fixtures/mini-css.mjs) on the spinner's markup and reads what it gets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDocument } from './fixtures/mini-dom.mjs'
import { cascade, parseCss } from './fixtures/mini-css.mjs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const styles = parseCss(read('web/styles.css'))
const reduced = m => /prefers-reduced-motion: reduce/.test(m)
// The element `pick` finds inside `html`, with what the cascade gives it (reduced motion on or off).
function spinner(html, pick, sheet, reduce = true) {
  const doc = createDocument(); doc.body.innerHTML = html
  const el = doc.body.querySelector(pick); assert.ok(el, pick)
  return cascade(el, [styles, parseCss(read(sheet))], { media: reduce ? reduced : () => false })
}

test('the global reduced-motion kill switch still exists (this test guards the exception, not the rule)', () => {
  const doc = createDocument(); doc.body.innerHTML = '<div class="anything"><span class="bounce"></span></div>'
  for (const pseudo of ['', '::before', '::after']) {
    const won = cascade(doc.body.querySelector('.bounce'), styles, { media: reduced, pseudo })
    assert.equal(won['animation-duration']?.value, '.01ms', pseudo || 'element')
    assert.equal(won['animation-duration']?.important, true, 'out-ranks ordinary rules')
    assert.equal(won['animation-iteration-count']?.value, '1', pseudo || 'element')
  }
  const calm = cascade(doc.body.querySelector('.bounce'), styles, { media: () => false })
  assert.equal(calm['animation-duration'], undefined, 'without Reduce Motion nothing is stopped')
})

for (const [file, html, pick, dur, what] of [
  ['web/core/chats.css', '<div class="ch-row"><span class="emo sti"><i class="spin"></i></span></div>', '.spin', '3s', 'Working row'],
  ['web/core/chats.css', '<div class="ch-head"><span class="emo sti"><i class="spin"></i></span></div>', '.spin', '3s', 'thread header'],
  ['web/core/chats.css', '<div class="ch-list"><i class="ch-spin"></i></div>', '.ch-spin', '2.4s', 'Chats list "Updating…"'],
  ['web/core/attach-chip.css', '<div class="ch-att"><i class="ch-attspin"></i></div>', '.ch-attspin', '2.4s', 'photo uploading in the composer'],
  ['web/core/polish.css', '<div class="wx-banner"><i class="wx-spin"></i></div>', '.wx-spin', '2.4s', '"Reconnecting to Wizard" banner, message search'],
]) {
  test(`${what}: reduced motion slows the spinner instead of freezing it`, () => {
    const won = spinner(html, pick, file)
    assert.equal(won['animation-duration']?.value, dur, `${pick} in ${file} turns every ${dur}`)
    assert.equal(won['animation-duration']?.important, true)
    assert.equal(won['animation-iteration-count']?.value, 'infinite', 'and never stops')
  })
}

// The tapped-Update overlay ("Updating WizardOS..."): the burst around it is decoration and still drops out under
// Reduce Motion, but its ring is the only sign the reload is still on its way, so it keeps turning, slower.
test('.wos-burst .wb-core: the "Updating WizardOS" ring keeps turning under reduced motion', () => {
  const won = spinner('<div class="wos-burst"><i class="wb-core"></i></div>', '.wb-core', 'web/core/update-banner.css')
  assert.equal(won.animation?.value, 'wb-spin 2.4s linear infinite')
  assert.equal(won.animation?.important, true)
})
