import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Regression (#614): on phone an opened yellow notification scrolled only to the scroller's edge, which runs under the
// dock (~90px) and the New chat button, so Done / Reply / Resolve this were hidden. The item must keep a bottom scroll
// margin that clears both, on phone only (desktop has no dock over the list).
const css = readFileSync(new URL('../web/tweaks/miguel/unified-inbox/tweak.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../web/tweaks/miguel/unified-inbox/tweak.js', import.meta.url), 'utf8');
test('an opened notification scrolls clear of the phone dock and New chat button', () => {
  const rule = css.match(/html:not\(\[data-shell="desktop"\]\) \.ui-item \{([^}]*)\}/);
  assert.ok(rule, 'phone-only .ui-item rule present');
  const m = rule[1].match(/scroll-margin-bottom:\s*(\d+)px/);
  assert.ok(m && Number(m[1]) >= 150, 'bottom scroll margin clears dock (~90px) + New chat button (~56px)');
  assert.match(js, /scrollIntoView\(\{ block: 'nearest'/, 'opening an item scrolls it into view (the margin applies to this scroll)');
});
