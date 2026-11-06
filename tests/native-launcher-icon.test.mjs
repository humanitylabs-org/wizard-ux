import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const res = 'android/app/src/main/res/';
const read = name => readFileSync(join(root, name));
const provenance = JSON.parse(read('docs/brand-provenance.json'));

test('Void native launcher preserves the supplied hat and PWA bytes', () => {
  for (const [name, hash] of Object.entries(provenance.web)) {
    assert.equal(createHash('sha256').update(read(name)).digest('hex'), hash, name);
  }
  assert.equal(provenance.androidLauncher.sourceSha256, provenance.web[provenance.androidLauncher.source]);
  for (const [name, hash] of Object.entries(provenance.androidLauncher.resources)) {
    assert.equal(createHash('sha256').update(read(name)).digest('hex'), hash, name);
  }
  const generator = read('tools/brand/render-pwa-icons.cjs').toString();
  assert.match(generator, /window\.nativeLayer/);
  assert.match(generator, /draw\(S\*72\/108/);
});

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

test('Void adaptive normal, round and Android 13 themed resources resolve from the manifest', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml').toString();
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  for (const name of ['ic_launcher','ic_launcher_round']) {
    for (const dir of ['mipmap-anydpi','mipmap-anydpi-v33']) {
      const xml = read(`${res}${dir}/${name}.xml`).toString();
      assert.match(xml, /<background android:drawable="@mipmap\/ic_launcher_background"/);
      assert.match(xml, /<foreground android:drawable="@mipmap\/ic_launcher_foreground"/);
      if (dir.endsWith('v33')) assert.match(xml, /<monochrome android:drawable="@mipmap\/ic_launcher_monochrome"/);
    }
  }
});
