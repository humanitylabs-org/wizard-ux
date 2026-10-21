'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const repoRoot = path.resolve(__dirname, '..');
function required(name) {
  if (!process.env[name]?.trim()) throw new Error(`Set ${name} before running this QA tool`);
  return process.env[name];
}
function workRoot() {
  const root = path.resolve(process.env.WIZARD_WORK_ROOT || path.join(process.env.TMPDIR || os.tmpdir(), 'wizard-work'));
  fs.mkdirSync(root, { recursive: true });
  return root;
}
function workPath(...parts) {
  const target = path.join(workRoot(), ...parts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}
function hermesPath(...parts) { return path.join(process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'), ...parts); }
// qa-origin serves the shell under /wizard-os-home/; server.py serves it at / on 9271.
function origin() { return new URL(process.env.WIZARD_ORIGIN || 'http://127.0.0.1:9371').origin; }
function buildHost() {
  const host = required('WIZARD_BUILD_HOST');
  if (!/^[a-zA-Z0-9_@.:-]+$/.test(host) || host.startsWith('-')) throw new Error('WIZARD_BUILD_HOST must be an SSH host (not shell syntax)');
  return host;
}
function inWorkRoot(target) {
  if (!target) return false;
  const rel = path.relative(workRoot(), path.resolve(target));
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
}
module.exports = { repoRoot, required, workRoot, workPath, hermesPath, origin, buildHost, inWorkRoot };
