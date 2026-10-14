// QA targets come from the environment, never from source: every QA script that names the Wizard under test
// reads WIZARD_QA_ORIGIN (browser + Python tools) and falls back to a neutral example host. See docs/qa-targets.md.
// Usage: node qa-tailnet-defaults.cjs   (pure: reads files; no network)
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function ok(v, n) { console.log((v ? 'PASS ' : 'FAIL ') + n); v ? pass++ : fail++; }
const PRIVATE = /wizard0{2}1\.com|tailc0f36[9]/i; // the owner's private names (spelled so this file never contains them)
const qaJs = fs.readdirSync(__dirname).filter(x => /^qa.*\.(cjs|mjs)$/.test(x))
  .concat(fs.readdirSync(path.join(__dirname, 'tools')).filter(x => /\.(cjs|mjs)$/.test(x)).map(x => 'tools/' + x));
for (const name of qaJs) {
  const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
  ok(!PRIVATE.test(text), name + ': no private host');
  if (/^const QA_ORIGIN\b/m.test(text)) {
    ok(/^const QA_ORIGIN = \(process\.env\.WIZARD_QA_ORIGIN \|\| 'https:\/\/wizard\.example\.ts\.net'\)/m.test(text), name + ': QA_ORIGIN from WIZARD_QA_ORIGIN, example default');
  }
}
for (const name of fs.readdirSync(path.join(__dirname, 'tools')).filter(x => /^qa.*\.py$/.test(x))) {
  const text = fs.readFileSync(path.join(__dirname, 'tools', name), 'utf8');
  ok(!PRIVATE.test(text), 'tools/' + name + ': no private host');
  if (/^QA_ORIGIN\b/m.test(text)) ok(text.includes("QA_ORIGIN = os.environ.get('WIZARD_QA_ORIGIN', 'https://wizard.example.ts.net')"), 'tools/' + name + ': QA_ORIGIN from WIZARD_QA_ORIGIN');
}
const parity = fs.readFileSync(path.join(__dirname, 'tools/qa_native_parity.py'), 'utf8');
ok(parity.includes("'ping -c 1 -W 2 ' + QA_HOST"), 'native parity reachability probe uses the configured host');
ok(fs.readFileSync(path.join(__dirname, 'qa-relative-links.cjs'), 'utf8').includes("OLD = 'old-name.example.com'"), 'older-name compatibility fixtures use example hosts');
ok(fs.readFileSync(path.join(__dirname, 'tools/qa_carry.py'), 'utf8').includes('QA_LEGACY_HOST'), 'origin-move fixtures use the configured older name');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
