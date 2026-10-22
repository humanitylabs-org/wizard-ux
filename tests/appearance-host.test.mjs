import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/appearance-host.js', import.meta.url), 'utf8');

test('late skin-package stylesheet invalidates cached Appearance scheme without reloading app', async () => {
  const events = new Map(), messages = [], root = { dataset:{ skin:'obsidian-light' } };
  let scheme = 'dark';
  const f = { src:'https://box.test/apps/habits/', isConnected:true, contentDocument:{}, closest:s => s === '.win' ? { classList:{ add() {}, remove() {} } } : null,
    classList:{ add() {}, remove() {} }, contentWindow:{ location:{ origin:'https://box.test', pathname:'/apps/habits/' }, postMessage:m => messages.push(m) } };
  const document = { documentElement:root, readyState:'loading', querySelectorAll:() => [f],
    addEventListener:(name, fn) => events.set('doc:' + name, fn) };
  const window = { WizCore:{ apps:() => ({ APPS:[{ url:f.src, source:'apps.json' }] }) } };
  vm.runInNewContext(source, { window, WizCore:window.WizCore, document, URL, location:{ origin:'https://box.test' },
    getComputedStyle:() => ({ colorScheme:scheme, getPropertyValue:() => '' }),
    addEventListener:(name, fn) => events.set(name, fn), queueMicrotask });
  events.get('message')({ origin:'https://box.test', source:f.contentWindow, data:{ type:'wizard:appearance:ready', version:1 } });
  assert.equal(messages.at(-1).appearance.colorScheme, 'dark');
  scheme = 'light';
  events.get('doc:load')({ target:{ tagName:'LINK', rel:'stylesheet' } });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(messages.at(-1).appearance.colorScheme, 'light');
  assert.equal(messages.length, 2);
  assert.equal(f.src, 'https://box.test/apps/habits/');
});
