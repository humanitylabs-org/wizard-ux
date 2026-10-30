import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A launcher link (launcher.json) whose URL is one of the agent's Pages must open in the Pages window. In a plain app
// frame the sandboxed, opaque-origin page is unreadable, so the frame watcher showed "can't show in a window".
for (const [shell, file] of [['desktop', '../web/desktop/desktop.js'], ['phone', '../web/app.js']]) {
  test(`${shell}: a launcher tile pointing at /pages/<slug>/ opens the Pages window`, () => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const open = src.slice(src.indexOf('function openApp('), src.indexOf('function openApp(') + 2500);
    const route = open.indexOf('window.WosPages?.match(a.url)');
    assert.ok(route > 0, 'openApp routes page URLs through WosPages.match');
    assert.ok(route < open.indexOf("a.kind === 'chats'"), 'before any frame/chats handling');
    assert.match(open.slice(route, route + 400), /app:\s*'pages',\s*appId:\s*'pages',\s*pageSlug/);
  });
}
