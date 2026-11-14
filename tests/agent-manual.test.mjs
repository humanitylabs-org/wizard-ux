// The agent's Wizard interface manual (skill/SKILL.md) stays complete and current with the interface.
// Jan, 13 Nov 2026: the agent must know every screen, Settings page and row, and feature switch, after every update.
// Fix a failure by editing skill/help.json (owner-facing words) and running: node tools/build-agent-manual.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, HELP_FILE, SKILL_FILE, SIZE_BUDGET, REGENERATE, SETTINGS_MODULES, CONTENT_MODULES, NOT_RENDERED } from '../tools/build-agent-manual.mjs';

const root = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const built = build(root);

test('every Settings page, section, row and control, feature switch and screen has a help line', async () => {
  const { missing, data } = await built;
  assert.ok(data.pages.length >= 10, `only ${data.pages.length} Settings pages rendered; the fixture in tools/build-agent-manual.mjs broke`);
  assert.ok(data.switches.length > 0 && data.screens.length > 0);
  assert.deepEqual(data.failed, {}, `Settings modules failed to load in the manual's fixture (tools/build-agent-manual.mjs): ${JSON.stringify(data.failed)}`);
  assert.equal(missing.length, 0, `The agent's interface manual has no help line for:\n- ${missing.join('\n- ')}\nAdd them to ${HELP_FILE} (short owner-facing words: what it is, when you'd use it, conditions), then run ${REGENERATE}.`);
});

test('every file that adds a Settings section is drawn by the manual (or says why not)', () => {
  const files = [];
  const walk = dir => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk('web');
  const registering = files.filter(f => !f.startsWith('web/tweaks/')).filter(f => { const t = read(f); return /WosSettings/.test(t) && /\.register\(\s*\{\s*id\b/.test(t) || f === 'web/core/settings.js'; }).map(f => f.slice(4));
  const known = new Set([...SETTINGS_MODULES, ...CONTENT_MODULES, ...Object.keys(NOT_RENDERED)]);
  const unknown = registering.filter(f => !known.has(f));
  assert.deepEqual(unknown, [], `These files add Settings sections the agent's manual doesn't draw: ${unknown.join(', ')}. Add them to SETTINGS_MODULES in tools/build-agent-manual.mjs (or NOT_RENDERED with the reason), add help lines to ${HELP_FILE}, then run ${REGENERATE}.`);
});

test('no help line is left for something the interface no longer shows', async () => {
  const { data, help } = await built;
  const stale = [];
  const ids = new Set(data.pages.map(p => p.id));
  for (const k of Object.keys(help.pages)) if (!ids.has(k)) stale.push(`pages.${k}`);
  const sections = new Map(data.features.map(f => [f.id, new Set()]));
  for (const p of data.pages) for (const s of p.sections) for (const c of s.controls) sections.get(s.id)?.add(c.label);
  for (const [k, v] of Object.entries(help.sections)) {
    if (!sections.has(k)) { stale.push(`sections["${k}"]`); continue; }
    for (const c of Object.keys(v.controls || {})) if (!sections.get(k).has(c)) stale.push(`sections["${k}"].controls["${c}"]`);
  }
  const sw = new Set(data.switches.map(t => t.id)); for (const k of Object.keys(help.switches)) if (!sw.has(k)) stale.push(`switches["${k}"]`);
  const sc = new Set(data.screens); for (const k of Object.keys(help.screens)) if (!sc.has(k)) stale.push(`screens["${k}"]`);
  for (const k of help.screenOrder || []) if (!sc.has(k)) stale.push(`screenOrder "${k}"`);
  assert.deepEqual(stale, [], `${HELP_FILE} has words for things the interface no longer shows (renamed or removed); update or remove them, then run ${REGENERATE}:\n- ${stale.join('\n- ')}`);
});

test('skill/SKILL.md is the generator output for this commit', async () => {
  const { text } = await built;
  const committed = fs.existsSync(path.join(root, SKILL_FILE)) ? read(SKILL_FILE) : '';
  assert.ok(committed === text, `${SKILL_FILE} is out of date with the interface code or ${HELP_FILE}. Run: ${REGENERATE} and commit ${SKILL_FILE}.`);
});

test('the manual fits the size the agent loads at once', async () => {
  const { text } = await built;
  assert.ok(Buffer.byteLength(text) < SIZE_BUDGET, `${SKILL_FILE} is ${Buffer.byteLength(text)} bytes; keep it under ${SIZE_BUDGET} (the agent loads the whole file): shorten lines in ${HELP_FILE}.`);
});

test('wizard.md ships the manual as the agent skill (name and description, as the App Manager requires)', () => {
  const fm = read('wizard.md').match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.match(fm, /^skill: skill\/SKILL\.md$/m, 'wizard.md must declare `skill: skill/SKILL.md` so the App Manager installs the manual for the agent');
  const head = read(SKILL_FILE).match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.match(head, /^name: wizard-interface$/m);
  // Quoted, so the front matter is valid YAML (the description contains ': ').
  const quoted = head.match(/^description: (.*)$/m)[1];
  assert.match(quoted, /^".*"$/);
  const description = JSON.parse(quoted);
  assert.match(description, /Use when the owner asks what something in Wizard is, where a setting or screen is, or how to do something in Wizard on the phone or computer/);
  // The agent's skill index shows only the first 57 characters of a description: they must say what it is for.
  assert.match(description.slice(0, 57), /Wizard setting or screen/);
});
