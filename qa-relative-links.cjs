// Canonical origin/preview regression entry point. Also discovered by npm test.
require('node:child_process').execFileSync(process.execPath, ['--test', require('node:path').join(__dirname, 'tests/tailnet-preview-origins.test.mjs')], {stdio:'inherit'});
