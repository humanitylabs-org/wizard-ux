// Frozen baseline: origin/main dafb1ad7, before slices 5+6. Do not regenerate from
// the candidate: that would make a deleted grammar pass its own comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, norm, compareShard } from './fixtures/voice-table-equivalence.mjs';
// The equivalence proof runs in three parts, one per file (this one and voice-utterance-table-2/-3), in parallel.
test('every pre-refactor voice table alternative routes to the identical action (part 1 of 3)',async t=>{
  t.diagnostic(JSON.stringify(await compareShard(0,3)));
});
test('registry voice_names: first installed wins, duplicate is refused with one warning',async()=>{
  const f=await fixture(false),warnings=[];f.c.console={warn:(...x)=>warnings.push(x)};
  const first={id:'first',voice_names:['Same name']},second={id:'second',voice_names:['same name']};
  for(let i=0;i<2;i++)assert.equal(f.c.WosAppVoice.aliases([first,second],norm).get('same name'),first);
  assert.equal(warnings.length,1);assert.match(warnings[0].join(' '),/second.*first/);
  f.registry.APP.calendar.voice_names=['my planner'];
  assert.equal(f.registry.appByName('my planner').id,'calendar');
  assert.equal(f.registry.findApp('my planner').id,'calendar');
});
