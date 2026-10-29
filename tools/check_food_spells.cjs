// Food spells: the web twin (web/usuals.js NEW_SPELL) must agree with the native unit-test cases
// (UsualsPolicyTest orderSomethingNewByVoice + foodSpells). Run: node tools/check_food_spells.cjs
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'web/usuals.js'), 'utf8');
const m = src.match(/const NEW_SPELL = [^\n]*;\n  const OPEN_SPELL = [^\n]*;\n  function spell[\s\S]*?\n  }\n/);
if (!m) { console.log('spell block not found'); process.exit(1); }
const spell = new Function(m[0] + '\nreturn spell;')();
const T = fs.readFileSync(path.join(root, 'android/app/src/test/java/ai/wizards/os/usuals/UsualsPolicyTest.java'), 'utf8');
const blocks = [...T.matchAll(/for \(String s : new String\[\]\{([^{}]*)\}\)\s*\n\s*assert(True|False)\(s, UsualsPolicy\.isBrowse/g)];
let n = 0, bad = 0;
for (const [, list, kind] of blocks) {
  for (const x of list.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const t = JSON.parse('"' + x[1] + '"'); n++;
    const isNew = spell(t) === 'new';
    if (isNew !== (kind === 'True')) { bad++; console.log('MISMATCH', kind, JSON.stringify(t), '->', spell(t) || '-'); }
  }
}
for (const t of ['food', 'Food.', 'open food', 'wizard eats']) console.log(JSON.stringify(t), '->', spell(t) || '-');
console.log(`${blocks.length} blocks, ${n} phrases, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
