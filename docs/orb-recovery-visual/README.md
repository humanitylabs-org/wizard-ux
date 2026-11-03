# Archived renderer comparison

These are unmodified crops from the already-completed forum browser receipt `heavy_c24cd09476fa45d3ad68921b2f4f7bea`, `/srv/work/orb-diagnostic-834fad68/evidence/browser`.
No new browser campaign, native/physical-device proof, or reproduction of the Samsung white/cyan field trigger is claimed.
The main release packet uses the exact tested repaired renderer bytes (`f96084ec83778e8271f7a92b9ebb946ca4b4de8d06c3df70458e6d1a626ddbf4`).

| Archived state | Published renderer | Reviewed repaired renderer |
|---|---|---|
| Idle (same initial appearance) | ![published idle](published-64-idle-idle.png) | ![repaired idle](candidate-64-idle-idle.png) |
| After restore sequence (different fixture-stage labels; not a pixel-match assertion) | ![published restored](published-64-restore-1-restored.png) | ![repaired final](candidate-64-restore-1-final.png) |

Idle images show the same purple spiral with bright white core; the restore crops show cyan-blue spirals. These pictures alone do not prove renderer lifecycle behavior; use the archived instrumented checks. The actual signed native compositor images still require parent inspection after admission. No skin, color, geometry or layout changes were introduced.

## SHA256

- `candidate-64-idle-idle.png`: `c809370aaeaac6dc1a15affb803d5281e888ed3b7ec427ff5d572677322cba46`
- `candidate-64-restore-1-final.png`: `dfdef10621078e0740986f85aaeb38fb6783a7c61654eea2f517d1df9d864d0f`
- `published-64-idle-idle.png`: `290018d2002f7faa345476affc3186f05bee4c025c552456b2529bd726d7204f`
- `published-64-restore-1-restored.png`: `5e0f7be576fa3368578d222eee67ddd476d7a526d6b8c07654db74732fd82f96`
