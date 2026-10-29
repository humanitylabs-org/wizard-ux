# Settings redesign acceptance

Implements `SETTINGS-REDESIGN.md`. Scope: source and a draft PR only; no merge or deployment.

## Result

- Phone root is an index, not a hidden long form. It fits 412×892 without scrolling when attention is empty. Android alone gets Phone.
- Desktop uses a 280px category pane and a selected-page pane at 1440×900. Category arrow keys swap the page; Esc closes.
- Feature ids, aliases and action handlers remain intact. Optional `register({ page })` groups new features; invalid explicit pages and unmapped features fall back to About & updates.
- Attention links use existing unsent, recovered, update, voice and sign-in state. Shared recording custody is deduplicated in the waiting subtitle.
- Chats choices require confirmation, owner-listener POST, exact-slot GET readback, registry refresh and verified selection before existing Chats windows rerender. Errors keep the old choice and show a toast. Both desktop list and thread panes remain usable.
- Mizel's family recommends `mizel-chats`; both relevant pages offer Use it or Get it. Not now persists by family and recommendation. No skin auto-switches Chats. Store opens as a normal app window, not a chat review/feedback desk.
- Settings styles derive Wizard appearance tokens from the shell's live skin variables. No palette values changed; owner palette guards pass. All visible Appearance controls and root categories measure at least 48px in both skins.
- Import is under Advanced; recovery explanations are behind an info disclosure. Launchers are quiet footer buttons. Phone Back goes page → root → closed without replacing or leaving the app document.

## Verified

All checks below pass with no skipped unit tests.

| Suite | Passed | Failed |
|---|---:|---:|
| `node --test tests/*.test.mjs` | 496 | 0 |
| `qa-settings-redesign` | 89 | 0 |
| `qa-chat-polish` | 87 | 0 |
| `qa-empty-voice` via custody harness | 40 | 0 |
| `qa-responsive-parity` | 92 | 0 |
| `qa-voice-recovery` via custody harness | 52 | 0 |
| `qa-skin-palettes` | 28 | 0 |
| `qa-my-skin-script` | 34 | 0 |
| `qa-own-views` | 26 | 0 |
| `qa-chats-view-slot` | 22 | 0 |

New Settings QA covers acceptance 1–6 on phone 412×892 touch and desktop 1440×900, using real skin picker interactions for Nebula and Mizel Light. It exercises built-in-only, an installed second provider, cancellation, successful POST/readback/rerender, failed POST, Get it, Not now persistence, attention, legacy aliases, keyboard navigation and browser Back. Subpixel dimensions are rounded to 0.001 CSS pixels to avoid floating-point representations of an exact 48px target.

The origin proxies Agent Service reads only. Its optional installed-app route enables the existing Wisdom appearance test; it strips the gateway prefix, forwards GET/HEAD only, and omits owner cookies/authorization. A new unit test verifies the read fence, including blocking the privileged Chats path. Browser suites intercept all mutations, including the Chats POST. The final origin counter was zero refused requests: every attempted browser mutation was caught before the origin, and none reached a live service.

Voice/update state and the additional Chats app are explicit QA fixtures. The second provider uses the existing fixture module with an isolated test id. Private-agent UI checks use an explicit fixture if this server has only its main agent. Own-view QA uses companion service modules for its local fixture server, not a live install.

## Existing assertion changes

- `tests/responsive-features.test.mjs`: route the synthetic feature to About before asserting both mounted bodies; route Android controls to Phone before checking disabled bridge gating. Registry/action/parity assertions remain.
- `qa-responsive-parity.cjs`: visit the owning pages before checking controls; tap Phone rather than using an unsupported assistant deep link; explicitly assert phone Escape's new page → root step before closing; retain Help/Files return, live generated reviews, skin sync, private scope, recovery, cancellation and reload checks. Use a 21-second cancellation fixture because recordings below 20 seconds are intentionally discarded. Guard init-script storage in opaque hosted frames.
- `qa-chat-polish.cjs`: select Voice before asserting its card and wait for data; assert today's agent-identity titlebar plus exact thread heading instead of obsolete titlebar text; use body-search's own fetch counter so unrelated thread refreshes do not masquerade as refetches; navigate out of cold-start Home and refocus the list between list-key actions; use current Alt+Down from the composer. Offline fixtures now actually abort service and diagnosis reads, instead of returning successful fake responses while the context says offline. The unmodified baseline already had seven failures in these unrelated assumptions; no product changes were made to conceal them.
- `qa-empty-voice.cjs`: return to the actual phone desk after cold reload before real Dismiss taps; custody/bytes/retry assertions are unchanged. Both this module and `qa-voice-recovery.cjs` now document their required harness invocation; running the export alone is not a test run.
- `qa-skin-palettes.cjs`: strengthen card/colour hit-target assertions from 44px to 48px. Palette identity and persistence assertions are unchanged.
- `qa-my-skin-script`, `qa-own-views`, `qa-chats-view-slot`: assertions unchanged.

## Reproduction and private evidence

Run the QA origin on an unused port in 9450–9470. Set `WIZARD_UX_FALLBACK_WEB` to generated shell data if the worktree has no `data.js`. For the existing Wisdom test, explicitly set `QA_READ_APP_PREFIX=/wisdom/` and `QA_READ_APP_PORT` to that installation's loopback app port. Never expose a general write proxy.

On the browser worker, set `QA_PLAYWRIGHT`, `QA_CHROME`, `CHROMIUM`, `TMPDIR`, `WIZARD_ORIGIN` and each suite's evidence variable to that worker's paths. Keep source, profiles and evidence on its external work volume. In particular:

```sh
QA_SHOTS="$EVIDENCE/settings" node qa-settings-redesign.cjs "$QA_URL"
QA_EMPTY_ONLY=1 QA_OUT="$EVIDENCE/empty" node qa-voice-custody-callers.cjs
QA_RECOVERY_ONLY=1 QA_OUT="$EVIDENCE/recovery" node qa-voice-custody-callers.cjs
QA_SOURCE="$PWD" QA_OUT="$EVIDENCE/parity" node qa-responsive-parity.cjs "$QA_URL"
QA_APP_VIEWS_MODULE="$SERVICE_SOURCE/server/app-views.mjs" QA_PORT=9453 QA_OUT="$EVIDENCE/own" node qa-own-views.cjs
```

The three skin/slot suites use **QA_SHOTS**, not QA_OUT. Stop QA servers and tunnels after collecting receipts. Screenshots remain private because the shell behind Settings can contain owner data; they are not committed. Evidence file names include:

- `phone-nebula-root.png`
- `phone-obsidian-light-appearance.png`
- `phone-obsidian-light-chats-suggestion.png`
- `desktop-nebula-root.png`
- `desktop-obsidian-light-root.png`
- `results.json`

## Follow-up / deviations

No product-design deviation. The quiet footer naturally wraps on phone to preserve touch targets. Only this repository was edited. Companion `wizard-os/spec/SKINS_AND_VIEWS.md` still needs the optional family field `recommends: { chats: "<app id>" }` documented; per scope, that spec change is not included here. No automatic selection, installation, merge or deployment occurred.
