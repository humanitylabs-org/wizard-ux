import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8');
function fixture() {
  const opened = [], location = new URL('https://wizard.example/wizard-os-home/');
  const child = {location: new URL('/messenger/', location), document: {}, addEventListener(){}, postMessage(){}};
  const frame = {tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener(){}, removeEventListener(){}};
  const window = {WizCore: {apps: () => ({APPS: [{id: 'messenger', kind: 'wizard', url: '/messenger/'}]})}, dispatchEvent(){}, WizConfig: {},
    WosChat: {viewer: {open(items, i) { opened.push({urls: items.map(x => x.url), i}); return true; }}}};
  vm.runInNewContext(source, {window, location, URL, addEventListener(){}, setInterval(){}, setTimeout, clearTimeout, document: {hidden: false, readyState: 'loading', addEventListener(){}}, CustomEvent: class{}, navigator: {}});
  window.WizAppServices.attach(frame, {appId: 'messenger', path: '/messenger/', isVisible: () => true});
  return {service: window.WizAppServices.connect(child, {}), opened};
}
test('the photo the owner tapped stays selected when an off-origin entry before it is dropped', () => {
  const f = fixture();
  assert.equal(f.service.media.view([{url: 'https://evil.example/a.jpg'}, {url: 'b.jpg'}, {url: 'c.jpg'}], 1), true);
  assert.deepEqual([...f.opened[0].urls], ['https://wizard.example/messenger/b.jpg', 'https://wizard.example/messenger/c.jpg']);
  assert.equal(f.opened[0].i, 0);
});
test('a dropped tapped entry falls to the next safe item, and plain lists keep their index', () => {
  const f = fixture();
  f.service.media.view([{url: 'a.jpg'}, {url: 'https://evil.example/x.jpg'}, {url: 'c.jpg'}], 1);
  assert.equal(f.opened[0].urls[f.opened[0].i], 'https://wizard.example/messenger/c.jpg');
  f.service.media.view([{url: 'a.jpg'}, {url: 'b.jpg'}, {url: 'c.jpg'}], 2);
  assert.equal(f.opened[1].i, 2);
  assert.equal(f.service.media.view([{url: 'https://evil.example/x.jpg'}], 0), false);
  f.service.media.view([{url: 'a.jpg'}, {url: 'b.jpg'}], 9);
  assert.equal(f.opened[2].i, 1, 'an index past the end opens the last item, as before');
});
