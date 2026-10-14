// Run identical suites against immutable baseline and candidate assets; preserve exits and logs.
// Execute ONLY on Thales. node tools/qa-dictation-ab.cjs /Volumes/ThalesMedia/wizard-ux/in-app-dictation
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = process.argv[2]; if (!root?.startsWith('/Volumes/ThalesMedia/')) throw Error('Thales media path required');
const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence, { recursive: true });
const reports = [];
for (const suite of ['qa-voice-seal.cjs', 'qa-hold-command.cjs', 'qa-immersive.cjs', 'qa-awake.cjs']) {
  for (const label of ['base', 'candidate']) {
    const command = [ '-r', path.join(__dirname, 'qa-playwright-thales.cjs'), path.join(root, 'candidate', suite) ];
    const env = { ...process.env, QA_WEB_DIR: path.join(root, label), PLAYWRIGHT_PATH: 'playwright-core', QA_SUITE: suite };
    const p = spawnSync(process.execPath, command, { env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    const log = (p.stdout || '') + (p.stderr || '') + (p.error ? '\n' + p.error.stack : '');
    const filename = path.join(evidence, (process.env.QA_EVIDENCE_TAG ? process.env.QA_EVIDENCE_TAG + '-' : '') + label + '-' + suite.replace('.cjs', ''));
    fs.writeFileSync(filename + '.log', log); fs.writeFileSync(filename + '.exit', String(p.status ?? 124) + '\n');
    const summary = [...log.matchAll(/(\d+) passed, (\d+) failed/g)].at(-1);
    const fraction = [...log.matchAll(/(\d+)\/(\d+) passed/g)].at(-1);
    const counts = summary ? [+summary[1], +summary[2]] : fraction ? [+fraction[1], +fraction[2] - +fraction[1]] : [null, null];
    reports.push({ label, suite, synthetic: env.QA_SYNTHETIC_REGRESSION === '1', command: [process.execPath, ...command], web: env.QA_WEB_DIR, exit: p.status ?? 124, signal: p.signal, passed: counts[0], failed: counts[1], failures: log.split('\n').filter(x => /^FAIL/.test(x)), log: filename + '.log' });
    console.log(JSON.stringify(reports.at(-1)));
    fs.writeFileSync(path.join(evidence, (process.env.QA_EVIDENCE_TAG ? process.env.QA_EVIDENCE_TAG + '-' : '') + 'regression-ab.json'), JSON.stringify(reports, null, 2));
  }
}
process.exitCode = reports.some(r => r.label === 'candidate' && r.exit !== 0) ? 1 : 0;
