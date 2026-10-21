// Wispr Flow (and other dictation apps) paste with ⌘V then restore the clipboard. Chrome's default paste
// re-reads the clipboard after the event, so long takes arrived as beforeinput with nothing inserted.
// The composer must insert the text from the paste event's own clipboardData.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = src.indexOf("root.addEventListener('paste'");
const body = src.slice(start, src.indexOf('addFiles(id, named);', start));

test('composer text paste is inserted from the event snapshot, not left to the browser', () => {
  assert.ok(start > 0, 'composer paste handler exists');
  assert.match(body, /getData\('text\/plain'\)/, 'reads the event snapshot');
  assert.match(body, /if \(!text\) \{[\s\S]*?return;\s*\}/, 'empty text paste falls through to the browser');
  assert.match(body, /ta\.value === before\) toast\(/, 'an empty paste that lands nothing tells the owner instead of failing silently');
  assert.match(body, /⌃⌘V/, 'names the Mac re-paste shortcut');
  assert.match(body, /e\.preventDefault\(\);[\s\S]*execCommand\('insertText'/, 'cancels the default and inserts itself');
  assert.match(body, /setRangeText\(text/, 'has a fallback insert');
  assert.ok(body.indexOf("getData('text/plain')") < body.lastIndexOf('e.preventDefault()'), 'file pastes still upload');
});

test('empty dictation paste recovers the take from the clipboard, never the restored old clipboard', () => {
  assert.match(body, /navigator\.clipboard\.readText\(\)/, 'reads the clipboard after an empty paste');
  assert.match(body, /t !== stale/, 'skips the clipboard that was there before the take');
  assert.match(body, /Date\.now\(\) - t0 < 2500/, 'bounded retry window');
  assert.match(src, /focusin[^\n]*ch-compose textarea[^\n]*clipBase/, 'baseline taken when the composer gains focus');
});
