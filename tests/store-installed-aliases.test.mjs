import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInstalled, releaseState, mergeConflicts, exactInstall} from '../web/store/store-status.js';
import {installedOnlyApps} from '../web/store/store-source.js';
const C = c => c.repeat(40);
// Real shapes from the live Wizard: staged/local ids and mirrored repositories that the Store showed as Get or as a second app.
const wam = [
  {id:'search-preview', repo:'local/search-preview', commit:C('0'), version:'0.3.3', source:'local'},
  {id:'food', repo:'humanitylabs-org/food', commit:C('3'), version:'0.1.0-alpha.2', source:'owner-private'},
  {id:'notes', repo:'local/notes', commit:C('c'), version:'0.1.0', source:'local'},
  {id:'wizard-chatgpt', repo:'humanitylabs-org/chatgpt-connection', commit:C('7'), version:'0.3.0', source:'owner-private'},
  {id:'wizard-mail', repo:'defleur-agents/wizard-mail', commit:C('3'), version:'0.5.0-private.1', source:'owner-private'},
  {id:'movies-next', app_id:'movies', repo:'humanitylabs-org/movies', commit:C('1'), version:'0.3.0'},
  {id:'mizel', commit:C('8'), version:'0.2.0', source:'standard'},
];
const shell = [{id:'search-preview', url:'/wizard-search/'}, {id:'console', url:'/console/'}, {id:'photos', url:'/photos/'}, {id:'movies', url:'/movies/'}];
const snap = {wam, shell, complete:true};
const cat = [
  {id:'wizard-search', repo:'humanitylabs-org/wizard-search', commit:C('5'), version:'0.3.1'},
  {id:'usuals', repo:'humanitylabs-org/wizard-food-app', commit:C('4'), version:'0.1.0-alpha.1'},
  {id:'wizard-notes', repo:'humanitylabs-org/wizard-notes', commit:C('d'), version:'0.1.0-alpha.4'},
  {id:'wizard-chatgpt', repo:'oscarhenrycollins/chatgpt-connection', commit:C('9'), version:'0.2.19'},
  {id:'wizard-mail', repo:'oscarhenrycollins/wizard-mail', commit:C('b'), version:'0.4.3'},
  {id:'movies', repo:'humanitylabs-org/movies', commit:C('2'), version:'0.3.0'},
  {id:'console', repo:'humanitylabs-org/vps-terminal', commit:C('6'), version:'0.1.0-alpha.1'},
  {id:'photos', repo:'humanitylabs-org/wizard-photos-app', commit:C('e'), version:'0.1.0-alpha.1'},
];
test('apps installed under a staging or earlier id are installed, never Get', () => {
  const want = {'wizard-search':'search-preview', usuals:'food', 'wizard-notes':'notes', 'wizard-chatgpt':'wizard-chatgpt', 'wizard-mail':'wizard-mail', movies:'movies-next', console:'console', photos:'photos'};
  for (const a of cat) {
    const i = resolveInstalled(a, snap, []);
    assert.equal(i?.id, want[a.id], a.id);
    assert.equal(releaseState(a, i, false, true), 'installed', a.id);
    assert.equal(releaseState({...a}, i, false, true) === 'get', false);
  }
});
test('installed copies are never listed as a second app next to their catalog entry', () => {
  assert.deepEqual(installedOnlyApps(cat, wam).map(x => x.id), ['mizel']);
});
test('an installed-only entry without a repository resolves to itself, not a conflict', () => {
  const [m] = installedOnlyApps(cat, wam);
  const i = resolveInstalled(m, snap, []);
  assert.equal(i.id, 'mizel'); assert.equal(releaseState(m, i, false, true), 'installed');
});
test('mirrored repositories merge into one non-conflicting row; unrelated repositories still conflict', () => {
  const rows = [{id:'profiles', repo:'oscarhenrycollins/profiles', conflict:true}, {id:'profiles', repo:'humanitylabs-org/profiles', conflict:true}];
  const [one] = mergeConflicts(rows, () => null); assert.equal(one.conflict, false);
  const other = [{id:'wisdom', repo:'humanitylabs-org/wisdom', conflict:true}, {id:'wisdom', repo:'humanitylabs-org/wisdom-history', conflict:true}];
  assert.equal(mergeConflicts(other, () => null)[0].conflict, true);
});
test('aliases are exact: an unrelated repository with a reviewed id is still a conflict', () => {
  const foreign = {id:'wizard-search', repo:'someone/else', commit:C('5')};
  assert.equal(resolveInstalled(foreign, snap, []).conflict, true);
  assert.equal(exactInstall(cat[0], resolveInstalled(cat[0], snap, [])), true);
});
