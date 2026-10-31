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

test('a page Settings embeds (.st-embed) follows the skin but never marks the Settings window themed', async () => {
  const events = new Map(), messages = [], root = { dataset:{ skin:'obsidian-light' } }, marks = [];
  const win = { classList:{ add:c => marks.push('+' + c), remove:c => marks.push('-' + c) } };
  // Not a registered app path: the shell's own Settings tab built this frame (Settings › Connections).
  const f = { src:'/wizard-os-home/store-install/_connections/?embed=settings', isConnected:true, contentDocument:{},
    closest:s => s === '.st-embed' ? {} : s === '.win' ? win : null,
    contentWindow:{ location:{ origin:'https://box.test', pathname:'/wizard-os-home/store-install/_connections/' }, postMessage:m => messages.push(m) } };
  const other = { ...f, closest:s => s === '.win' ? win : null, contentWindow:{ ...f.contentWindow, postMessage:m => messages.push({ other:m }) } };
  const document = { documentElement:root, readyState:'loading', querySelectorAll:sel => sel.includes('.st-embed iframe') ? [f, other] : [other],
    addEventListener:(name, fn) => events.set('doc:' + name, fn) };
  const window = { WizCore:{ apps:() => ({ APPS:[{ url:'/apps/habits/', source:'apps.json' }] }) } };
  vm.runInNewContext(source, { window, WizCore:window.WizCore, document, URL, location:{ origin:'https://box.test' },
    getComputedStyle:() => ({ colorScheme:'light', getPropertyValue:() => '' }),
    addEventListener:(name, fn) => events.set(name, fn), queueMicrotask });
  events.get('message')({ origin:'https://box.test', source:f.contentWindow, data:{ type:'wizard:appearance:ready', version:1 } });
  const a = messages.at(-1).appearance;
  assert.equal(a.colorScheme, 'light'); assert.equal(a.skin, 'obsidian-light'); assert.equal(a.tokens.canvas, 'transparent');
  events.get('message')({ origin:'https://box.test', source:f.contentWindow, data:{ type:'wizard:appearance:ack', version:1, revision:a.revision } });
  assert.deepEqual(marks, [], 'the Settings window keeps its own look');
  // The same unregistered page outside Settings still gets nothing.
  const n = messages.length;
  events.get('message')({ origin:'https://box.test', source:other.contentWindow, data:{ type:'wizard:appearance:ready', version:1 } });
  assert.equal(messages.length, n);
});
