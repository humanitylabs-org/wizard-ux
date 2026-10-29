// James, 25 Oct 2026: "Give me a way to dismiss the morning pop-up" — a missed routine must not sit pinned on Ready
// all evening. The Morning card carries a × that hides it until Morning's day rolls over, without ticking any step.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8')
const fn = name => { const i = src.indexOf(`  function ${name}() {`); assert.ok(i > 0, name); return src.slice(i, src.indexOf('\n  }\n', i) + 4) }

function card(data) {
  const sb = { MORNING: { data }, morningInstalled: () => true, esc: s => String(s) }
  vm.runInNewContext(fn('morningCard') + ';globalThis.out = morningCard();', sb)
  return sb.out
}

test('an unfinished Morning card has a dismiss button beside the open button', () => {
  const html = card({ day: '2026-10-25', done: 0, total: 4, next_label: 'Workout', hidden: false })
  assert.match(html, /data-chmorning /)
  assert.match(html, /<button type="button" class="ch-morning-x" data-chmorninghide aria-label="Hide Morning until tomorrow"/)
  assert.doesNotMatch(html, /<button[^>]*data-chmorning [^]*<button[^>]*data-chmorninghide[^]*<\/button><\/button>/, 'no nested buttons')
})

test('a hidden day shows no card even with steps left', () => {
  assert.equal(card({ day: '2026-10-25', done: 1, total: 4, next_label: 'Meditate', hidden: true }), '')
})

test('the dismiss tap is handled before the open tap and posts to Morning without touching steps', () => {
  const h = src.indexOf("closest('[data-chmorninghide]')"), o = src.indexOf("closest('[data-chmorning]')")
  assert.ok(h > 0 && h < o)
  const hide = fn('morningHide')
  assert.match(hide, /\/morning\/api\/hide/)
  assert.doesNotMatch(hide, /api\/step/)
  assert.match(src, /hidden: !!d\.hidden/, 'status carries the hidden flag')
})

// James, 25 Oct 2026: "when I hit it, it should automatically return me to the previous screen ... on any build when
// I'm dismissing something, archiving something". Apps get one shared call for that; the Chats card remembers its source.
test('apps can return to the previous screen after a finishing action, through the shell Back', () => {
  const client = readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8')
  const svc = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  assert.match(client, /back: \(\) => \{ try \{ return service\?\.nav\?\.back\?\.\(\) === true/)
  assert.match(svc, /back\(\) \{ check\(\); if \(st\.isVisible\?\.\(\) !== true/, 'hidden apps cannot navigate the owner')
  assert.match(svc, /isVisible, (?:isFront, )?back, readingStorage \}/)
  assert.match(app, /back: \(\) => \{ if \(desks\[idx\]\.focus !== w\.id\) return false; const did = backStep\(w\.id\)/)
  assert.match(src, /H\.openApp\?\.\('morning', e\.target\)/, 'the Morning card opens Morning with Chats as where it came from')
})
