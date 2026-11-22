// Part of the voice-table equivalence proof (tests/voice-utterance-table.test.mjs), run as its own file so the parts
// run in parallel.
import test from 'node:test';
import { compareShard } from './fixtures/voice-table-equivalence.mjs';
test('every pre-refactor voice table alternative routes to the identical action (part 3 of 3)',async t=>{
  t.diagnostic(JSON.stringify(await compareShard(2,3)));
});
