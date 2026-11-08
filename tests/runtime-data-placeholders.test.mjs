// Fresh boxes: index.html and desktop.html load data.js and summaries.js, owner-generated payloads that are
// git- and docker-ignored. The image must still answer them with (empty) JavaScript, not nginx's HTML 404,
// or every load logs "Refused to execute script ... MIME type ('text/html')".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ignored = read('.dockerignore').split('\n').map(l => l.trim()).filter(l => l.startsWith('**/')).map(l => l.slice(3));

test('every docker-ignored script the shell loads gets an empty placeholder in the image', () => {
  const dockerfile = read('Dockerfile');
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const scripts = [...read(page).matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    const runtime = scripts.filter(s => ignored.includes(s));
    assert.deepEqual(runtime.sort(), ['data.js', 'summaries.js'], page);
    for (const s of runtime) assert.match(dockerfile, new RegExp(`\\b${s.replace('.', '\\.')}\\b`), `Dockerfile must create ${s}`);
  }
  // Placeholders never overwrite an owner's generated file and are created before dropping root.
  assert.match(dockerfile, /\[ -e "\$f" \] \|\| /);
  assert.ok(dockerfile.indexOf('data.js') < dockerfile.indexOf('USER 101:101'));
});
