// The phone bar's pinned slot is box-synchronized (live-work.js prefsFields phoneSlot, wizard-ux#1929): a stale device and
// two devices editing at the same moment must keep each other's edits (AGENTS.md two-device rule), with and without
// Agent Service item operations, and every device shows what the box holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { stale, simultaneous, liveDevice, tick } from './two-devices.mjs'

const KEY = 'wos.phone.slot.v1'
const done = dev => dev.prefOps([])

for (const patch of [true, false]) for (const [name, run] of [['stale device', stale], ['simultaneous edits', simultaneous]]) {
  const svc = patch ? 'service with item operations' : 'older service (PUT only)'
  test(`Phone slot, ${name}, ${svc}: one device's pin and the other's Ready order both survive`, async () => {
    const box = await run({ patch, initial: { phoneSlot: '', readyOrder: 'newest', compact: true },
      first: async a => { await a.putPrefs({ phoneSlot: 'wizard-calendar' }); await done(a) },
      second: async b => { await b.putPrefs({ readyOrder: 'oldest' }); await done(b) } })
    assert.equal(box.state.phoneSlot, 'wizard-calendar', 'pin kept')
    assert.equal(box.state.readyOrder, 'oldest', "the other device's edit kept")
    assert.equal(box.state.compact, true, 'untouched preference kept')
  })
  test(`Phone slot, ${name}, ${svc}: both devices pin; the box holds one of them and every device converges`, async () => {
    const box = await run({ patch, initial: { phoneSlot: '', readyOrder: 'newest' },
      first: async a => { await a.putPrefs({ phoneSlot: 'wizard-calendar' }); await done(a) },
      second: async b => { await b.putPrefs({ phoneSlot: 'telegram' }); await done(b) } })
    assert.ok(['wizard-calendar', 'telegram'].includes(box.state.phoneSlot), 'one of the two edits, never a revert to the stale value')
    assert.equal(box.state.readyOrder, 'newest')
    const fresh = liveDevice(box); await tick(); await fresh.pullPrefs(); await tick()
    assert.equal(fresh.store.get(KEY), box.state.phoneSlot, 'a third device shows what the box holds')
  })
}

test('Phone slot: a reset on one device reaches another; a box without the key leaves the device copy alone', async () => {
  const box = await stale({ initial: { phoneSlot: 'wizard-calendar' }, first: async x => { await x.putPrefs({ phoneSlot: '' }); await done(x) }, second: async () => {} })
  const other = liveDevice(box, { [KEY]: 'wizard-calendar' }); await tick(); await other.pullPrefs(); await tick()
  assert.equal(other.store.get(KEY), '', 'the reset (Messenger again) reaches the other device')
  const old = await stale({ initial: { readyOrder: 'newest' }, first: async () => {}, second: async () => {} })
  const kept = liveDevice(old, { [KEY]: 'telegram' }); await tick(); await kept.pullPrefs(); await tick()
  assert.equal(kept.store.get(KEY), 'telegram', 'an older box without phoneSlot keeps the device pin')
})
