import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Path-only exemptions: records, never executable/config defaults.
const evidence = [
  /^docs\/evidence\//, /^ops\/evidence\//, /^docs\/acceptance\/[^/]+\/RECEIPT[^/]*$/,
  /^adoptions\/mizel-live\/manifest\.json$/, // Hash/staging/QA receipt, not runtime config.
  /^qa\/receipts\/(chat-scroll-stability|phone-shell-scroll)\.md$/, // Dated QA records.
  /^docs\/qa\/microphone-lock-20261013\.md$/, // Dated QA receipt.
  /^docs\/responsive-remainder-verification\.json$/, // Immutable dated verification receipt.
];
// Split the private identifiers so the detector does not itself introduce a source leak.
const forbidden = [
  new RegExp('/home/' + 'telos(?:/|\\b)'),
  new RegExp('/Users/' + 'thales(?:/|\\b)'),
  new RegExp('/Volumes/' + 'ThalesMedia(?:/|\\b)'),
  new RegExp('tail' + 'c0f369(?:\\\\?\\.)ts(?:\\\\?\\.)net'),
  new RegExp('\\b(?:ssh|scp|rsync)\\s+(?:(?:-[^\\s]+|[A-Za-z]+=[^\\s]+)\\s+)*' + 'thales(?:\\b|:)'),
  new RegExp("[\"']" + 'thales(?:[.]local)?' + "[\"']"),
];
export function violations(file, text) {
  if (evidence.some(pattern => pattern.test(file))) return [];
  return text.split(/\r?\n/).flatMap((line, index) => forbidden.some(pattern => pattern.test(line)) ? [`${file}:${index + 1}: ${line.trim()}`] : []);
}
test('tracked source has no machine-specific paths or hosts', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const found = files.flatMap(file => {
    const buffer = readFileSync(new URL('../' + file, import.meta.url));
    return buffer.includes(0) ? [] : violations(file, buffer.toString('utf8'));
  });
  assert.deepEqual(found, [], 'Machine-specific configuration belongs in env vars:\n' + found.join('\n'));
});
test('portable-path guard detects literals and escaped hostnames, exempts receipts only', () => {
  for (const text of ['/home/' + 'telos/apps/app', '/Users/' + 'thales/project', '/Volumes/' + 'ThalesMedia/QA', 'wizard.tail' + 'c0f369.ts.net', 'wizard\\.tail' + 'c0f369\\.ts\\.net', 'ssh ' + 'thales cmd', 'ssh -o ConnectTimeout=8 ' + 'thales cmd', 'scp -q ' + 'tha' + 'les:/tmp/shot.png ./', JSON.stringify('tha' + 'les'), JSON.stringify('tha' + 'les.local')]) {
    assert.equal(violations('tools/probe.cjs', text).length, 1, text);
    assert.equal(violations('docs/evidence/receipt.json', text).length, 0);
    assert.equal(violations('docs/setup.md', text).length, 1);
  }
});
