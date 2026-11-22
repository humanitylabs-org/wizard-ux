// Fresh boxes: index.html and desktop.html load data.js and summaries.js, owner-generated payloads that are
// git- and docker-ignored. The image must still answer them with (empty) JavaScript, not nginx's HTML 404,
// or every load logs "Refused to execute script ... MIME type ('text/html')".
// Builds the image's file tree from the real Dockerfile (tests/fixtures/r8A-dockerfile.mjs: real COPY with
// .dockerignore, real RUN lines including tools/stamp-assets.sh, read-only tree after USER drops root).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildImage } from './fixtures/r8A-dockerfile.mjs';

const WEB = 'usr/share/nginx/wizard-ux/';

test('every docker-ignored script the shell loads gets an empty placeholder in the image', () => {
  const owner = 'window.WOS_DATA = { mine: true };\n';
  const img = buildImage({ seed: { [WEB + 'summaries.js']: owner } }); // a RUN after USER 101 throws: read-only tree
  try {
    for (const page of ['index.html', 'desktop.html']) {
      const scripts = [...img.read(WEB + page).matchAll(/<script src="([^"]+)"/g)].map(m => m[1].replace(/\?v=[0-9a-f]+$/, ''));
      assert.ok(scripts.length > 5, page);
      for (const s of scripts.filter(s => !/^(https?:)?\/\//.test(s)))
        assert.ok(img.exists(WEB + s.replace(/^\/wizard-os-home\//, '')), `${page} loads ${s}: the image must answer it with a file`);
    }
    // A fresh box: the placeholder is there and is JavaScript that runs.
    assert.ok(img.exists(WEB + 'data.js'), 'data.js placeholder');
    assert.doesNotThrow(() => vm.runInNewContext(img.read(WEB + 'data.js'), {}), 'data.js placeholder is valid JavaScript');
    // Placeholders never overwrite an owner's generated file.
    assert.equal(img.read(WEB + 'summaries.js'), owner);
  } finally { img.done(); }
});
