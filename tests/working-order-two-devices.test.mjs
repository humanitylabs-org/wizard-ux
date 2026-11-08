// Working order is box-synchronized (live.js PREFS workingOrder): a stale device and two devices editing at the same
// moment must keep each other's edits (AGENTS.md two-device rule), with and without Agent Service item operations.
import test from 'node:test'
import assert from 'node:assert/strict'
import { stale, simultaneous, liveDevice, tick } from './two-devices.mjs'

const KEY = 'wos.chats.workingOrder.v1'
const done = dev => dev.prefOps([])

for (const patch of [true, false]) for (const [name, run] of [['stale device', stale], ['simultaneous edits', simultaneous]]) {
  const svc = patch ? 'service with item operations' : 'older service (PUT only)'
  test(`Working order, ${name}, ${svc}: one device's Working order and the other's Ready order both survive`, async () => {
    const box = await run({ patch, initial: { workingOrder: 'alphabetical', readyOrder: 'newest', compact: true },
      first: async a => { await a.putPrefs({ workingOrder: 'oldest' }); await done(a) },
      second: async b => { await b.putPrefs({ readyOrder: 'oldest' }); await done(b) } })
    assert.equal(box.state.workingOrder, 'oldest', 'Working order edit kept')
    assert.equal(box.state.readyOrder, 'oldest', "the other device's Ready order edit kept")
    assert.equal(box.state.compact, true, 'untouched preference kept')
  })
  test(`Working order, ${name}, ${svc}: both devices pick a Working order; the box holds one valid choice and every device converges`, async () => {
    const box = await run({ patch, initial: { workingOrder: 'alphabetical', readyOrder: 'newest' },
      first: async a => { await a.putPrefs({ workingOrder: 'newest' }); await done(a) },
      second: async b => { await b.putPrefs({ workingOrder: 'oldest' }); await done(b) } })
    assert.ok(['newest', 'oldest'].includes(box.state.workingOrder), 'one of the two edits, never a revert to the stale value')
    assert.equal(box.state.readyOrder, 'newest')
    const fresh = liveDevice(box); await tick(); await fresh.pullPrefs(); await tick()
    assert.equal(fresh.store.get(KEY), box.state.workingOrder, 'a third device shows what the box holds')
  })
}
