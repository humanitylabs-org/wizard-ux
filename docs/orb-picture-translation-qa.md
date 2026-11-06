# Orb picture translation: painted over the picture

## What the owner asked for

“It used to just overlay the translation on the image. Please keep the behavior how it was.” Translate screen keeps
its original Google-Lens look: English painted over the foreign words in their own place, in the colours sampled from
the screenshot, with Original, Copy translation, Select text, Ask Wizard and the language pill. No text panel opens by
itself.

## History (why this was needed)

- Installed87 (`a1e00daf`) painted only text the app reports through accessibility. Picture text (`read-image`) only
  ever went to the Select-text “Picture text” list. When Telegram reported English chrome, Translate said “Already in
  English” and never looked at the photo.
- Release89 (`0c0cc524`, `cdfd788d`) read the photo, but put the recovered Thai and its English into a large automatic
  sheet, and named the chrome's language too (“English → English”). That was a new UI, not the original one.
- The read-image route returned lines only, so nothing knew where a picture line was. Painting it in place needs that
  place from the same private vision read. It can't be guessed.

## REUSE / EXTEND / NEW

- REUSE, unchanged: the Translate renderer in `assets/assist/screen.html` (`paint`, `textArea`, `colors`, `paintedAt`,
  `pickTranslated`, `markPicked`), Original (`body.orig #paint`), the translation bar (Copy translation · Select text ·
  Ask Wizard), language picker, sheet docking, outside-tap and Back handling, the Select-text “Picture text” list, the
  stroke finder `textPieces`, private `/api/translate`.
- EXTEND `screen.html`: picture lines that have a believable place join `st.blocks` as `pic` blocks, so `st.tr` and
  `paint()` handle them exactly like accessibility text. App text and picture text are read in parallel and gated per
  run/target. The source languages count only replies that changed something, and the target language is never one.
- EXTEND `ScreenMode.picture`: it asks `read-image?geometry=1` and still passes the reply through to the page verbatim.
  No other native change.
- EXTEND Search `read_image` (separate Search source, `server.py`): with `?geometry=1` the same configured vision model
  (`gemma4-31b` by default; same provider, no fallback added) is also asked for each line's box. It returns `lines`
  (unchanged strings) plus a parallel `boxes` array of `[l, t, r, b]` image fractions or `null`. Without the flag the
  prompt, token budget and reply are exactly as before, so installed builds are unaffected.
- NEW: none in product. QA: `tools/qa_picture_geometry_probe.py` records one authorized geometry read for replay.

## Placement rules (never guessed)

A picture line is painted only when all of these hold:

1. Its box is four finite numbers in 0..1 with right > left and bottom > top. Search validates the box and `screen.html`
   validates it again. A `boxes` list that doesn't match `lines` one for one is ignored completely.
2. Scaled through `sw/sh`, `dpr` and the window offset, it is line-sized and mostly on screen: at least 4 px, at most
   20 % of the screen height and 30 % of its area, and at least 60 % visible.
3. With the screenshot pixels loaded, `textPieces` finds text strokes there. The box is then tightened to those
   strokes and padded by 22 % of their height above and below, exactly as `alignWords` pads a placed word. The sampled
   colours come from the real background, sparse Thai marks above and below the line stay covered, and the text gets
   the same size as painted app text. If there are no strokes, it is not placed.
4. The app hasn't already reported it: the exact same text as an accessibility block, or 50 % or more of its box
   covered by the app's own word rects. The same words in two places stay two lines. Read twice in one place, they
   count once. When two different readings claim one place, the first keeps it.

A line that fails any of these is still translated, and it is included in Copy translation and Ask Wizard in reading
order. It is never drawn. The pill says “· N not placed” and a short toast explains this. An older Search that sends no
`boxes` gives this honest result for every line.

## Verification

- `node --test tests/screen-picture-translation.test.mjs` (19 cases, model-free, synthetic geometry) runs the shipped
  page through `S.open`. It covers: overlay placement and scaling (dpr, offset); malformed, absent and older-Search
  geometry; app/picture overlap dedupe; repeats; replies arriving in either order with no target-as-source; French +
  Thai; Original; tapping a painted line, outside tap and Back; Select text using the one read; target change during a
  read (one upload); stale replies; error/retry; no screenshot; image-only screens; ink tightening/rejection on
  synthetic pixels; sparse combining marks above and below a picture line (every ink pixel must be under the painted
  translation); Appearance roles. It fails 16/18 against the release89 panel page and 18/18 against installed87.
  Against the unpadded r1 page (`43165e80…`), the combining-mark case and the tightening case fail.
- `tools/qa-screen-page.cjs` (browser, synthetic canvas): the existing Lens checks plus a scenario where the Thai dish
  exists only in the picture. The dish is painted over its own letters in sampled colours, with no panel and a Thai →
  English pill; Original, tap, outside tap and Copy are checked. The outside tap is a real touch at a point that
  `tools/qa-screen-hit.cjs` hit-tests on the touch layer, clear of sheets, chrome and paint, after the sheet settles.
  Copy is tapped only once its button hit-tests. Screenshots `08`, `08b`, `08c` (picked) and `08d` (dismissed) need
  human visual review; `08-picture-touch-diagnostics.json` keeps the bounds, the chosen point and where r1's blind
  (200,760) tap lands.
- `tools/qa-screen-picture-translate.cjs PRIVATE_FIXTURE OUT` (private exact-image replay, two Appearance role sets):
  baseline87 still shows its false verdict. Two separate recordings are read: the historical lines-only
  `live-read-image.json` + `live-translate.json` (asserted box-less) must paint nothing for the picture and report “not
  placed”. The geometry pair `live-read-image-geometry.json` + `live-translate-geometry.json` must paint the recovered
  English over the photo, with no panel, Original, a hit-tested outside tap, opaque sheet and Copy each line once. A
  missing or box-less geometry pair fails the run on purpose. Recorded inference is not new inference, and a browser
  replay is not native-device proof. The parent recorded the geometry pair by running
  `read_image(geometry=True)` from Search source `cb5e8888…` in the installed Search container with its unchanged
  configuration: 9 lines, 8 boxes, all three Thai captions boxed, 5494 ms. `tools/qa_picture_geometry_probe.py`
  re-records the same files over live HTTP once the extension is deployed.
- `tools/qa_orb_screen.py APK PKG` (native emulator lane; forum: API35 google_apis x86_64 under the inherited canonical
  lease, 220 GiB free before boot, owned emulator/forward/reverse/fixture server cleaned in `finally`). It keeps every
  earlier check and adds a picture-only Chrome canvas scene. The real production bridge asks `read-image?geometry=1`
  of a fixture server whose boxes are computed from where Chrome draws the canvas, labelled synthetic, not inference.
  The checks: English painted in place over the Thai, no automatic panel, a Thai → English pill, Original, a
  hit-tested outside tap, Copy, and Back. `<job>/receipt.json` lists every check by name and the mode.
  `--picture-only` runs the same real set-up, then only this scene, the crash check and cleanup; the default runs all
  64 check sites. The emulator takes a spare recommended console/ADB pair (5554..5584/5555..5585, via
  `qa_android_connect.choose_emulator_port`), never a fixed port.
  `tools/test_qa_orb_screen_static.py` is its browser-free contract test, not native evidence.
- Search: `python3 -m unittest tests.test_consolidation tests.test_search`. It checks that the default reply/prompt is
  unchanged, that geometry uses the same model with validated boxes, and that only `geometry=1` turns it on.

## Appearance

`screen.html` maps Appearance v1 roles (`--wz-accent`, `--wz-text`, `--wz-text-secondary`, `--wz-panel`,
`--wz-border`) with the standalone dark fallbacks. Release89 used `--wz-ink`/`--wz-line`, which aren't roles. The hint
and the selected chip are opaque now. Painted text uses opaque sampled colours. `ScreenMode` doesn't inject the worn
skin, so on the phone the page shows the dark fallback. Native skin transport isn't claimed.

## Fixed finding, admitted by the parent (needs a rebuilt APK and visual re-review)

The Thai below-vowel left visible under the painted picture-only line in synthetic r1 capture `08-picture-overlay.png`
(painted to 371 screen px, line drawn to 384.8 px) is covered by padding the stroke-tightened box like `alignWords`.
The `qa-screen-page.cjs` coverage check is tightened to the line's full height within 3 css px.

## Release custody

- Product files: `assets/assist/screen.html`, `everywhere/ScreenMode.java` (one line), and the Search `server.py`
  extension, which is separate source and a separate deploy.
- The version isn't bumped here. Code 89 / 0.10.25 is published and 88 is reserved (#839). The parent assigns the next
  free code above 89. `tools/qa_orb_translate_packet.py` asserts code 89 / name 0.10.25 / baseline 87 and must be
  pointed at the new code and the 89 baseline before it can admit this candidate.
- Order: deploy the Search extension first (otherwise phones get lines only, honestly unplaced). Then record the
  geometry fixture with the probe, then run the replay, the page QA and the native packet on forum. Screenshots need
  visual acceptance before publication.
