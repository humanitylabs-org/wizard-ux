import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/store/store.js');
const action = src.slice(src.indexOf('  function action('), src.indexOf('  const row ='));
const render = (state, {busy = false, installed = false, open = false, reason = '', architecture = 'amd64'} = {}) =>
  Function('status', 'S', 'architectureReason', 'esc', 'key', 'isInstalled', 'canOpen', 'openId', `${action}; return action({id:'fixture'}, 'big');`)(
    () => state, {busy: new Set(busy ? ['fixture'] : []), architecture}, () => reason, x => x, () => 'fixture', () => installed, () => open, () => 'fixture');
test('Store semantics preserve action precedence, hooks and compatibility while colouring each status', () => {
  for (const [state, options, cls, label] of [
    ['get', {}, '', 'Get'], ['installed', {installed:true,open:true}, 'open', 'Open'],
    ['installed', {installed:true}, 'have', '✓ Installed'], ['update', {}, 'upd', 'Update'],
    ['switch', {}, 'upd', 'Switch release'], ['conflict', {}, 'warn', 'Resolve conflict'],
    ['unknown', {}, 'wait', 'Status unavailable'], ['update', {busy:true}, 'wait', 'Installing…'],
    ['get', {reason:'arm64 only'}, 'wait', 'Not compatible'],
    ['get', {reason:'unknown host',architecture:''}, 'wait', 'Compatibility unavailable'],
  ]) {
    const html = render(state, options);
    assert.ok(html.includes(`class="get ${cls ? cls + ' ' : ''}big"`), html);
    assert.ok(html.includes(label), html);
    if (['wait','warn','have'].includes(cls)) assert.doesNotMatch(html, /data-get|data-open/);
  }
});
test('new status colour rules use tokens, not literal white or fixed washes', () => {
  const css = read('web/store/store.css');
  const rules = css.slice(css.indexOf('/* One colour per meaning:'), css.indexOf('/* list layer */'));
  assert.match(rules, /--wz-on-accent/);
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(css, /\.get\.open, \.get\.big \{ color:/, 'later rule must not override semantic foregrounds');
});
