// Exact user-image regression using recorded responses from the installed private route.
// No provider substitute. Private fixture directory is supplied out of tree; never publish its outputs.
// Usage: node tools/qa-screen-picture-translate.cjs PRIVATE_FIXTURE OUT [--metrics-only]
// --metrics-only (exact-layout-diagnostic): only the geometry candidate, both skins, the same fixture/bridge/translation;
// records each painted line's actual browser layout + overlaps and a settled overlay screenshot, and runs only the two
// fit/overlap checks. No baseline, lines-only, Original, taps, Copy or other checks. The receipt is written either way.
//
// Fixture: exact-image.jpg, baseline-screen.html (installed87 page) and two separate recorded pairs from the private
// route: live-read-image.json + live-translate.json (the historical lines-only read, exactly as an older Search
// answers) and live-read-image-geometry.json + live-translate-geometry.json (read-image with geometry: lines + boxes,
// e.g. tools/qa_picture_geometry_probe.py output renamed). Contract: Translate paints the picture's Thai over the
// picture with the original renderer; no text panel opens by itself; a line without a usable box is never placed.
// A missing or box-less geometry recording fails the run: overlay acceptance cannot be claimed without geometry.
const {chromium} = require('./qa-playwright.cjs');
const {outsideTarget, sheetSettled, hitTarget} = require('./qa-screen-hit.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), crypto = require('crypto');
const METRICS_ONLY = process.argv.includes('--metrics-only');
const [fixtureArg, outArg] = process.argv.slice(2).filter(a => a !== '--metrics-only');
const fixture = path.resolve(fixtureArg), out = path.resolve(outArg);
fs.mkdirSync(out, {recursive:true});
const image = fs.readFileSync(path.join(fixture, 'exact-image.jpg'));
assert.equal(crypto.createHash('sha256').update(image).digest('hex'), 'e25f968b5acec4cbf6fefae8d036c8c9a3a1affa259b12c68181a1c5b68ca6c7');
const recorded = (readName, translateName) => {
  const read = JSON.parse(fs.readFileSync(path.join(fixture, readName)));
  const translation = JSON.parse(fs.readFileSync(path.join(fixture, translateName)));
  assert.equal(read.model, 'gemma4-31b');
  assert.equal(read.lines.length, translation.items.length);
  return {read, mapping: Object.fromEntries(read.lines.map((s,i) => [s, translation.items[i]]))};
};
const plain = recorded('live-read-image.json', 'live-translate.json');
assert.ok(!('boxes' in plain.read), 'the historical plain recording is lines-only; geometry belongs in the -geometry pair');
const geometryFile = path.join(fixture, 'live-read-image-geometry.json');
const geometry = fs.existsSync(geometryFile) ? recorded('live-read-image-geometry.json', 'live-translate-geometry.json') : null;
const hasGeometry = !!geometry && Array.isArray(geometry.read.boxes) && geometry.read.boxes.some(Boolean);
if (geometry) assert.ok(Array.isArray(geometry.read.boxes) && geometry.read.boxes.length === geometry.read.lines.length, 'geometry recording has one box (or null) per line');
const current = path.resolve(process.env.SCREEN_PAGE_SOURCE || path.join(__dirname, '../android/app/src/main/assets/assist/screen.html'));
// Accessibility chrome is a synthetic English control, not part of the recorded Thai inference.
const chromeLabels = ['Copy translation', 'Select text', 'Ask Wizard'];
const baseline = path.join(fixture, 'baseline-screen.html');
const record = {mode: METRICS_ONLY ? 'exact-layout-diagnostic' : 'recorded-installed-private-inference-replay, NOT new inference or native device proof',
  page_sha256: crypto.createHash('sha256').update(fs.readFileSync(current)).digest('hex'), geometry: hasGeometry, checks: [], screenshots: []};
const check = (name, ok) => { record.checks.push({name, ok:!!ok}); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
const THAI = /[\u0e00-\u0e7f]/;
// A sheet's 200ms entrance transition must finish before a capture counts.
function sheetCaptureReady() {
  const sheet = document.querySelector('#sheet'), r = sheet.getBoundingClientRect();
  const bounds = [r.left, r.top, r.right, r.bottom];
  const previous = window.__qaSheetBounds;
  const stable = previous && bounds.every((v,i) => Math.abs(v - previous.bounds[i]) < 0.1);
  window.__qaSheetBounds = {bounds, frames: stable ? previous.frames + 1 : 0};
  return sheet.classList.contains('show') && getComputedStyle(sheet).transform === 'none'
    && r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
    && r.right <= innerWidth && r.bottom <= innerHeight && window.__qaSheetBounds.frames >= 3;
}
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const skin of ['nebula','grove']) {
      const context = await browser.newContext({viewport:{width:360,height:780},deviceScaleFactor:3,hasTouch:true,isMobile:true});
      const runs = METRICS_ONLY ? (hasGeometry ? [['candidate', geometry]] : [])
        : [['baseline', plain], ['lines-only', plain], ...(hasGeometry ? [['candidate', geometry]] : [])];
      for (const [version, rec] of runs) {
        const page = await context.newPage(), errors=[];
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(({jpeg,read,mapping,chromeLabels}) => {
          window.__calls = [];
          window.ScreenNative = {shot: () => jpeg, log() {}, close() {}, closeSearch() {}, sheet() {}, search() {},
            copy: text => window.__calls.push({kind:'copy',text}), ask: text => window.__calls.push({kind:'ask',text}),
            picture: id => { window.__calls.push({kind:'picture'}); setTimeout(() => S.pictured(id,read), 25); },
            translate: (id,json,to) => {
              const items = JSON.parse(json); window.__calls.push({kind:'translate',items,to});
              const unknown = items.filter(t => !(t in mapping) && !chromeLabels.includes(t));
              if (unknown.length || to !== 'English') throw new Error('No recorded inference for requested input');
              setTimeout(() => S.translated(id,{items:items.map(t => mapping[t] ?? t),from:items.some(t => /[\u0e00-\u0e7f]/.test(t)) ? 'Thai' : ''}),25);
            }};
        }, {jpeg:image.toString('base64'),read:rec.read,mapping:rec.mapping,chromeLabels});
        await page.goto('file://' + (version === 'baseline' ? baseline : current));
        await page.evaluate(skin => {
          const roles = skin === 'grove' ? {'--wz-panel':'#f5f2e8','--wz-text':'#17291e','--wz-accent':'#245a39','--wz-text-secondary':'#56614f','--wz-border':'#b3bfa9'} : {'--wz-panel':'#120e24','--wz-text':'#f4f1ff','--wz-accent':'#b99bff','--wz-text-secondary':'#a79fc4','--wz-border':'#51436c'};
          Object.entries(roles).forEach(([k,v]) => document.documentElement.style.setProperty(k,v));
        },skin);
        const labels=chromeLabels;
        const blocks=labels.map((t,i) => ({t,x:8+i*115,y:720,w:110,h:22,l:false,wd:t.split(' ').map((s,j,a) => [s,j===a.length-1?'':' '])}));
        await page.evaluate(blocks => S.open({mode:'translate',shot:true,dpr:1,sw:360,sh:780,top:24,bot:24,few:false,blocks}),blocks);
        const tag = version + '-' + skin;
        const shot = async name => { await page.screenshot({path:path.join(out,tag+name+'.png')}); record.screenshots.push(tag+name+'.png'); };
        const waitFor = async predicate => {
          try { await page.waitForFunction(predicate, null, {timeout:10000}); }
          catch(error) {
            fs.writeFileSync(path.join(out,tag+'-failure.json'),JSON.stringify({errors,state:await page.evaluate(()=>S.peek()),calls:await page.evaluate(()=>window.__calls)},null,2));
            await page.screenshot({path:path.join(out,tag+'-failure.png')});
            throw error;
          }
        };
        const peek = () => page.evaluate(() => S.peek());
        const calls = () => page.evaluate(() => window.__calls);
        const settled = () => S.peek().pictureState === 'done' && S.peek().nativeState === 'done';
        if (version === 'baseline') {
          await waitFor(() => /Already\s+in\s+English/.test(S.peek().pill || ''));
          check('baseline '+skin+': false English verdict bypasses vision',!(await calls()).some(c=>c.kind==='picture'));
          await shot('');
        } else if (version === 'lines-only') {
          // The historical recording has no geometry: every line must stay unplaced, honestly reported.
          await waitFor(settled);
          const state = await peek(), thai = state.picRows.filter(q => THAI.test(q.t));
          check('lines-only '+skin+': Thai recovered and translated',thai.length > 0 && thai.every(q => q.tr && !THAI.test(q.tr)));
          check('lines-only '+skin+': no place invented (nothing painted for the picture)',!state.painted.some(e => e.pic) && state.picRows.every(q => q.bi < 0));
          check('lines-only '+skin+': no automatic panel, honest pill',!state.sheet && state.panel === 'sel' && /Thai/.test(state.pill) && /not placed/.test(state.pill) && !/English\s*→/.test(state.pill));
          await page.locator('#tCopy').click();
          check('lines-only '+skin+': unplaced lines remain copyable',(await calls()).some(c => c.kind === 'copy' && thai.every(q => c.text.includes(q.tr))));
          await shot('');
        } else {
          await waitFor(settled);
          let state = await peek();
          const pics = state.painted.filter(e => e.pic), thai = state.picRows.filter(q => THAI.test(q.t));
          fs.writeFileSync(path.join(out,tag+'-overlay.json'),JSON.stringify({painted:state.painted,picRows:state.picRows,pill:state.pill},null,2));
          // Per-caption layout as the browser actually laid it out: does each painted line fit its own box, and does
          // any later painted line cover it?
          const metrics = await page.evaluate(() => [...document.querySelectorAll('#paint > .pt')].map(e => {
            const r = e.getBoundingClientRect(), c = getComputedStyle(e);
            return {b: +e.dataset.b, text: e.textContent, rect: [r.left, r.top, r.right, r.bottom], scrollHeight: e.scrollHeight,
              clientHeight: e.clientHeight, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, styleHeight: e.style.height,
              fontSize: c.fontSize, lineHeight: c.lineHeight, fontFamily: c.fontFamily, padding: c.padding, overflow: c.overflow,
              whiteSpace: c.whiteSpace};
          }));
          const overlaps = [];
          metrics.forEach((m,i) => metrics.slice(i+1).forEach(n => {
            const w = Math.min(m.rect[2],n.rect[2]) - Math.max(m.rect[0],n.rect[0]), h = Math.min(m.rect[3],n.rect[3]) - Math.max(m.rect[1],n.rect[1]);
            if (w > 0.5 && h > 0.5) overlaps.push({under: m.b, over: n.b, w, h});
          }));
          fs.writeFileSync(path.join(out,tag+'-overlay-metrics.json'),JSON.stringify({metrics,overlaps},null,2));
          check('candidate '+skin+': every painted line fits its own box (no clipped wrap)',metrics.length > 0 && metrics.every(m => m.scrollHeight <= m.clientHeight + 1 && m.scrollWidth <= m.clientWidth + 1));
          check('candidate '+skin+': no painted line covers another',overlaps.length === 0);
          if (METRICS_ONLY) { // the layout diagnosis ends here: a settled overlay screenshot, nothing touched
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            await shot('-overlay'); await page.close(); continue;
          }
          check('candidate '+skin+': Thai picture lines painted over the picture',pics.length > 0 && pics.every(e => !THAI.test(e.t)));
          check('candidate '+skin+': every painted line is a recorded translation',pics.every(e => Object.values(rec.mapping).includes(e.t)));
          check('candidate '+skin+': no automatic panel; translation bar shown',!state.sheet && state.panel === 'sel' && state.tbar);
          check('candidate '+skin+': pill Thai → English, never English → English',/Thai/.test(state.pill) && /English/.test(state.pill) && !/English\s*→/.test(state.pill));
          check('candidate '+skin+': painted text is opaque',pics.every(e => /^rgb\(/.test(e.bg)));
          record['unplaced_'+skin] = state.picRows.filter(q => q.bi < 0).length;
          await shot('-overlay');
          await page.locator('#orig').click();
          check('candidate '+skin+': Original reveals the untouched picture',await page.evaluate(() => getComputedStyle(document.getElementById('paint')).display === 'none'));
          await shot('-original');
          await page.locator('#orig').click();
          const first = pics[0];
          if (!first) throw new Error('nothing painted for the picture; interactive checks cannot run');
          await page.touchscreen.tap(first.c[0], first.c[1]);
          await page.waitForFunction(sheetCaptureReady, null, {polling:'raf',timeout:10000});
          state = await peek();
          const row = state.picRows.find(q => q.tr === first.t);
          check('candidate '+skin+': tapping a painted line shows its Thai and English',state.sheet && row && state.sheetText.includes(row.t) && state.sheetText.includes(first.t));
          const bg = await page.locator('#sheet').evaluate(e => getComputedStyle(e).backgroundColor);
          check('candidate '+skin+': sheet fully opaque',!bg.startsWith('rgba'));
          await page.evaluate(() => document.documentElement.style.setProperty('--wz-panel','#203428'));
          check('candidate '+skin+': live role change keeps the pick',(await peek()).sheetText === state.sheetText);
          await page.evaluate(skin => document.documentElement.style.setProperty('--wz-panel',skin==='grove'?'#f5f2e8':'#120e24'),skin);
          await shot('-picked');
          // An outside touch dismisses the sheet, never the app or the overlay: a real tap on the touch layer, clear of
          // the picked sheet (wherever docked), chrome and painted lines; settle-waits fail closed with their errors.
          const settle = (id, want) => page.waitForFunction(sheetSettled, [id, want], {polling:'raf', timeout:5000}).then(() => null, e => String(e).slice(0, 200));
          const diag = {outside: await page.evaluate(outsideTarget), before: {sheets: state.sheets, painted: state.painted.map(e => e.r)}};
          const pt = diag.outside.point;
          if (pt) await page.touchscreen.tap(pt.x, pt.y);
          diag.dismissSettle = pt ? await settle('sheet', false) : 'no clear outside point';
          diag.tbarSettle = pt ? await settle('tbar', true) : 'no clear outside point';
          state = await peek();
          diag.after = {sheets: state.sheets, sheet: state.sheet, tbar: state.tbar, painted: state.painted.map(e => e.r)};
          await shot('-dismissed');
          check('candidate '+skin+': real outside tap dismisses and keeps the overlay',pt && diag.outside.hit === 'layer' && !diag.dismissSettle && !diag.tbarSettle
            && !state.sheet && state.tbar && state.painted.filter(e => e.pic).length === pics.length);
          diag.copyTarget = await page.evaluate(hitTarget, 'tCopy');
          if (diag.copyTarget.ok) await page.touchscreen.tap(diag.copyTarget.x, diag.copyTarget.y);
          fs.writeFileSync(path.join(out,tag+'-touch-diagnostics.json'),JSON.stringify(diag,null,2));
          const copied = (await calls()).filter(c => c.kind === 'copy').pop();
          check('candidate '+skin+': Copy translation (hit-tested) has each recovered line exactly once',
            diag.copyTarget.ok && copied && thai.every(q => copied.text.split('\n').filter(l => l === q.tr).length === state.picRows.filter(r => r.tr === q.tr).length));
        }
        check(version+' '+skin+': no runtime errors',errors.length===0);
        await page.close();
      }
      await context.close();
    }
    if (!hasGeometry) check('geometry recording present (overlay acceptance requires it)', false);
    record.ok=record.checks.length>0 && record.checks.every(c=>c.ok);
    if(!record.ok) process.exitCode=1;
  } catch(error) { record.ok=false; record.error=error.stack; throw error; }
  finally { await browser.close(); fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(record,null,2)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
