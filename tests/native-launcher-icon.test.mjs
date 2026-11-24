import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const res = 'android/app/src/main/res/';
const read = name => readFileSync(join(root, name));
const provenance = JSON.parse(read('docs/brand-provenance.json'));

// static-rule: the shipped hat, PWA and launcher bytes must agree with the recorded brand provenance (asset hashes)
test('Void native launcher preserves the supplied hat and PWA bytes', () => {
  for (const [name, hash] of Object.entries(provenance.web)) {
    assert.equal(createHash('sha256').update(read(name)).digest('hex'), hash, name);
  }
  assert.equal(provenance.androidLauncher.sourceSha256, provenance.web[provenance.androidLauncher.source]);
  for (const [name, hash] of Object.entries(provenance.androidLauncher.resources)) {
    assert.equal(createHash('sha256').update(read(name)).digest('hex'), hash, name);
  }
});

// static-rule: an inventory of the launcher PNGs: every density and layer exists at its exact pixel size
test('Void launcher includes all five native density fallbacks and adaptive layers', () => {
  for (const [density, scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]) {
    for (const [name, dp] of [['ic_launcher',48],['ic_launcher_round',48],['ic_launcher_foreground',108],['ic_launcher_background',108],['ic_launcher_monochrome',108]]) {
      const png = read(`${res}mipmap-${density}/${name}.png`);
      assert.equal(png.subarray(1,4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), dp * scale);
      assert.equal(png.readUInt32BE(20), dp * scale);
    }
  }
});

// Resolve the launcher the way Android does: the manifest's @mipmap names -> the adaptive XML (anydpi, v33) -> its
// layers -> a PNG in every density.
const xml = text => { const d = createDocument(); d.body.innerHTML = text.replace(/<\?xml[^>]*\?>/, ''); return d.body; };
const mipmap = ref => { const m = /^@mipmap\/([\w]+)$/.exec(ref || ''); assert.ok(m, `a mipmap reference: ${ref}`); return m[1]; };
test('Void adaptive normal, round and Android 13 themed resources resolve from the manifest', () => {
  const app = xml(read('android/app/src/main/AndroidManifest.xml').toString()).querySelector('application');
  const icons = ['android:icon', 'android:roundIcon'].map(k => mipmap(app.getAttribute(k.toLowerCase()))); // an HTML parse: names lowercased
  assert.deepEqual(icons, ['ic_launcher', 'ic_launcher_round']);
  for (const name of icons) {
    for (const dir of ['mipmap-anydpi', 'mipmap-anydpi-v33']) {
      const icon = xml(read(`${res}${dir}/${name}.xml`).toString()).querySelector('adaptive-icon');
      assert.ok(icon, `${dir}/${name}: an adaptive icon`);
      const layers = Object.fromEntries(['background', 'foreground', 'monochrome'].map(k => [k, icon.querySelector(k)?.getAttribute('android:drawable') || null]));
      assert.equal(mipmap(layers.background), 'ic_launcher_background'); assert.equal(mipmap(layers.foreground), 'ic_launcher_foreground');
      if (dir.endsWith('v33')) assert.equal(mipmap(layers.monochrome), 'ic_launcher_monochrome', 'Android 13 themed icon');
      for (const ref of Object.values(layers).filter(Boolean)) for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'])
        assert.ok(existsSync(join(root, `${res}mipmap-${density}/${mipmap(ref)}.png`)), `${ref} in ${density}`);
    }
  }
});
