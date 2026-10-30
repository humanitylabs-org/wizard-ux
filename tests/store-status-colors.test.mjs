import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/store/store.js');
const action = src.slice(src.indexOf('  function action('), src.indexOf('  const row ='));
const render = (state, {busy = false, installed = false, open = false, detail = false, reason = '', architecture = 'amd64'} = {}) =>
  Function('status', 'S', 'architectureReason', 'esc', 'key', 'isInstalled', 'canOpen', 'openId', `${action}; return action({id:'fixture'}, 'big', ${detail});`)(
    () => state, {busy: new Set(busy ? ['fixture'] : []), architecture}, () => reason, x => x, () => 'fixture', () => installed, () => open, () => 'fixture');
test('Store semantics preserve action precedence, hooks and compatibility while colouring each status', () => {
  for (const [state, options, cls, label] of [
    ['get', {}, '', 'Get'], ['installed', {installed:true,open:true}, 'open', 'Open'],
    ['installed', {installed:true}, 'have', '✓ Installed'], ['update', {}, 'upd', 'Update'],
    ['switch', {}, 'upd', 'Switch release'],
    ['unknown', {}, 'wait', 'Status unavailable'], ['update', {busy:true}, 'wait', 'Installing…'],
    ['get', {reason:'arm64 only'}, 'wait', 'Not compatible'],
    ['get', {reason:'unknown host',architecture:''}, 'wait', 'Compatibility unavailable'],
  ]) {
    const html = render(state, options);
    assert.ok(html.includes(`class="get ${cls ? cls + ' ' : ''}big"`), html);
    assert.ok(html.includes(label), html);
    if (['wait','warn','have'].includes(cls)) assert.doesNotMatch(html, /data-get|data-open/);
  }
  // A source conflict is a status (the "Source conflict" badge beside the name), never a pill that looks tappable.
  const conflict = render('conflict');
  assert.doesNotMatch(conflict, /class="get|data-get|data-open|<button/);
  assert.doesNotMatch(conflict, /Resolve/);
});
test('an openable installed app keeps its Installed state beside Open on the detail screen', () => {
  const html = render('installed', {installed:true, open:true, detail:true});
  assert.match(html, /class="install-actions"/);
  assert.match(html, /class="get have big"[^>]*>✓ Installed<\/span>/);
  assert.match(html, /class="get open big"[^>]*data-open="fixture"[^>]*>Open<\/button>/);
  assert.ok(html.indexOf('✓ Installed') < html.indexOf('>Open<'));
  assert.match(src, /\$\{action\(a, 'big', true\)\}/, 'the detail renderer requests both controls');
});
test('a fresh installed-app snapshot exposes Open before the parent registry finishes refreshing', () => {
  const declaration = src.match(/^  const canOpen = a => .*;$/m)?.[0];
  assert.ok(declaration, 'canOpen declaration');
  const result = Function('S', 'framed', 'parent', 'openId', 'a', `${declaration}; return canOpen(a);`)(
    {snapshot:{shell:[{id:'fixture',url:'/fixture/'}]}}, true, {WizCanOpen:() => false}, () => 'fixture', {id:'fixture'});
  assert.equal(result, true);
});
test('new status colour rules use tokens, not literal white or fixed washes', () => {
  const css = read('web/store/store.css');
  const rules = css.slice(css.indexOf('/* One colour per meaning:'), css.indexOf('/* list layer */'));
  assert.match(css, /\.install-actions\s*\{[^}]*gap:\s*6px[^}]*\}/, 'detail actions use a compact phone-width gap');
  assert.match(css, /\.install-actions \.get\.big\s*\{[^}]*box-sizing:\s*border-box/, 'detail actions fit beside each other at phone width');
  assert.match(rules, /--wz-on-accent/);
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(css, /\.get\.open, \.get\.big \{ color:/, 'later rule must not override semantic foregrounds');
});
