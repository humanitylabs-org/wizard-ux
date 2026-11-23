// ux#1509: an app's picture stand-in (`placeholder`, the copy its bubble already shows) reaches Wizard's media viewer,
// so a tapped picture shows at once instead of a black stage. It passes the same address check as the picture itself.
// Same-origin window: app-services.js media.view. The sandboxed window path is in browser-boundary-services.test.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
const source = withServicesParts(readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8'));
function fixture() {
  const opened = [], location = new URL('https://wizard.example/wizard-os-home/');
  const child = {location: new URL('/messenger/', location), document: {}, addEventListener(){}, postMessage(){}};
  const frame = {tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener(){}, removeEventListener(){}};
  const window = {WizCore: {apps: () => ({APPS: [{id: 'messenger', kind: 'wizard', url: '/messenger/'}]})}, dispatchEvent(){}, WizConfig: {},
    WosChat: {viewer: {open(items, i) { opened.push({items: JSON.parse(JSON.stringify(items)), i}); return true; }}}};
  vm.runInNewContext(source, {window, location, URL, addEventListener(){}, setInterval(){}, setTimeout, clearTimeout, document: {hidden: false, readyState: 'loading', addEventListener(){}}, CustomEvent: class{}, navigator: {}});
  window.WizAppServices.attach(frame, {appId: 'messenger', path: '/messenger/', isVisible: () => true});
  return {service: window.WizAppServices.connect(child, {}), opened};
}
test('a picture keeps its own-origin stand-in; the viewer gets it as placeholder', () => {
  const f = fixture();
  assert.equal(f.service.media.view([
    {url: 'media/1', placeholder: 'media/1?size=thumb', name: 'Ann'},
    {url: 'media/2', placeholder: 'blob:https://wizard.example/5b3c', name: 'Bo'},
  ], 0), true);
  assert.deepEqual(f.opened[0].items.map(x => [x.url, x.placeholder]), [
    ['https://wizard.example/messenger/media/1', 'https://wizard.example/messenger/media/1?size=thumb'],
    ['https://wizard.example/messenger/media/2', 'blob:https://wizard.example/5b3c']]);
});
test('a stand-in from another site, a bad address, bytes, or on a video is left out; the picture still opens', () => {
  const f = fixture();
  f.service.media.view([
    {url: 'a.jpg', placeholder: 'https://evil.example/a.jpg'},
    {url: 'b.jpg', placeholder: 'javascript:alert(1)'},
    {url: 'c.jpg', placeholderBlob: {}},
    {url: 'd.jpg', placeholder: ''},
    {url: 'e.mp4', kind: 'video', placeholder: 'e.jpg'},
    {url: 'f.jpg', placeholder: 'f.jpg'},
  ], 0);
  assert.equal(f.opened[0].items.length, 6);
  for (const it of f.opened[0].items) assert.equal('placeholder' in it, false, it.url);
});
test('items without a stand-in are exactly as before', () => {
  const f = fixture();
  f.service.media.view([{url: 'a.jpg', name: 'A'}], 0);
  assert.deepEqual(f.opened[0].items, [{url: 'https://wizard.example/messenger/a.jpg', kind: 'image', name: 'A', mime: 'image/jpeg'}]);
});
// wizard-messenger issue 348: a sharper copy the app already holds (`preview`) rides beside the stand-in, on the same
// address check; it never rides alone, on a video, from another site, or when it is the picture or the stand-in.
test('a preview beside a stand-in reaches the viewer; alone, foreign or duplicate it is left out', () => {
  const f = fixture();
  f.service.media.view([
    {url: 'media/1', placeholder: 'media/1?kind=thumb', preview: 'blob:https://wizard.example/view-1'},
    {url: 'media/2', preview: 'blob:https://wizard.example/view-2'},
    {url: 'media/3', placeholder: 'media/3?kind=thumb', preview: 'https://evil.example/3.jpg'},
    {url: 'media/4', placeholder: 'media/4?kind=thumb', preview: 'media/4'},
    {url: 'media/5', placeholder: 'media/5?kind=thumb', preview: 'media/5?kind=thumb'},
    {url: 'e.mp4', kind: 'video', placeholder: 'e.jpg', preview: 'e2.jpg'},
  ], 0);
  assert.deepEqual(f.opened[0].items.map(x => x.preview), ['blob:https://wizard.example/view-1', undefined, undefined, undefined, undefined, undefined]);
  assert.equal(f.opened[0].items[0].placeholder, 'https://wizard.example/messenger/media/1?kind=thumb');
});
