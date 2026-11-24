const QA_ROOT = require('node:path').resolve(__dirname, '../..'); // repo root (this script lives in qa/scripts/)
// Canonical origin/preview regression entry point. Also discovered by npm test.
require('node:child_process').execFileSync(process.execPath, ['--test', require('node:path').join(QA_ROOT, 'tests/tailnet-preview-origins.test.mjs')], {stdio:'inherit'});
