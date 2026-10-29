import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

test('Miguel keeps Machines available but does not replace Home by default', () => {
  const profile = JSON.parse(read('../web/tweaks/miguel/profile.json'));
  const catalog = JSON.parse(read('../web/tweaks/catalog.json'));
  assert.ok(!profile.tweaks.includes('miguel/machines-home'));
  assert.ok(catalog.tweaks.includes('miguel/machines-home'));
  assert.ok(fs.existsSync(new URL('../web/tweaks/miguel/machines-home/manifest.json', import.meta.url)));
});

test('phone Home exposes exact actionable threads through the existing thread opener', () => {
  const src = read('../web/app.js');
  assert.match(src, /const RD = LIVE && LIVE\.ok \? \(LIVE\.workGroups\(\)\.ready \|\| \[\]\)/, 'Home reuses the Chats Ready section');
  assert.match(src, /const homeThreads = \[\.\.\.L\.needs, \.\.\.RD\]/, 'direct rows combine needs-attention with that Ready section');
  assert.match(src, /class="home-thread" data-thread="\$\{esc\(s\.id\)\}"/);
  assert.match(src, /closest\('\.home \[data-thread\]'\)[^]*openWizardThread\(thread\.dataset\.thread\)/);
});

test('phone and desktop share weather, resources, alerts and standard desktop navigation', () => {
  const phone = read('../web/app.js'), desktop = read('../web/desktop/desktop.js'), resources = read('../web/core/resources.js');
  for (const src of [phone, desktop]) assert.match(src, /window\.WosWeather\?\.home\(\)/);
  assert.doesNotMatch(desktop, /if \(mine\(\)\) return mineHomeHtml\(\)/);
  assert.match(desktop, /data-thread="\$\{esc\(s\.id\)\}"/);
  assert.match(desktop, /const G = LIVE\?\.ok \? LIVE\.workGroups\(\)/, 'desktop reuses the same Chats Ready/Working source as phone');
  assert.match(desktop, /actionable = \[\.\.\.L\.needs, \.\.\.ready\]/, 'desktop direct rows include attention and Ready without duplicating state logic');
  assert.match(desktop, /window\.WosResources\?\.home\(\)/);
  assert.match(resources, /function homeBarsHtml\(\)[^]*systemAlert\(\)[^]*healthAlert\(\)/,
    'styled resource bars retain system and health alerts');
  assert.match(resources, /alerts=systemAlert\(\)\+healthAlert\(\),sig=\[[^]*alerts[^]*\.join\('\|'\)/,
    'resource repaint signature includes alert state so live health changes cannot leave stale Home alerts');
});