# Android thin shell

Proposed by Miguel, 22 Oct 2026. Strong suggestion — feel free to push back on any line.

## The rule

Everything is web unless native gives a real device benefit. The Android app should almost never need an
update; features change by updating the web shell and apps on the Wizard. Native code is a small, stable set
of **device capabilities**. Web code builds every **feature** on top of them.

A capability is something a web page on Android cannot do, or cannot do reliably:

| Capability | Why native |
|---|---|
| Shell WebView, Back, insets, keep-awake, haptics | Hosting the web shell itself |
| Connect / change Wizard (origin), reach screen | Must work before any web page loads |
| Background microphone (foreground service) | A page's mic stops when the screen locks or the app is backgrounded |
| Camera / photo library access and background upload | Background jobs survive the app being closed |
| Share into Wizard / share out | Android share sheet |
| Notifications (post, tap-to-open, reply watch) | Arrive when the app is closed |
| Overlay window (floating orb), side-button assist, accessibility | System windows a page cannot open |
| Self-update | Installs the next APK |

A feature is anything with its own screens, words, rules or app-specific logic: Food/usuals, Mizel's
meeting flow, the orb's look and behaviour, the Apps catalogue, recording lists and recovery UI,
screen-mode actions. Features live in `web/` (or in their own Wizard app) and call capabilities.

## Rules for new work

1. New features ship as web. A PR that adds feature logic or feature words to `android/` needs a sentence
   on why web cannot do it.
2. Bridge methods are generic and versioned (`device.mic.start(opts)`, not `usualsTeach`). Feature names do
   not appear in bridge method names.
3. Native UI is limited to what must show before or without the web shell (connect, reach, permission
   prompts, the overlay host). Its look comes from web wherever possible.
4. Moving a feature to web: ship the web version first, keep the native one until the web one matches it
   on device, then delete the native one in a later APK. Nobody loses a working feature mid-move.

## Inventory (main @ 6d0ea0f, 22 Oct 2026)

19,831 Java lines, 102 `@JavascriptInterface` methods, 1,686 lines of bundled web assets.

| Area | Lines | Verdict |
|---|---|---|
| root (`MainActivity`, Origin, Reach, selection, home-screen pins) | 2,256 | **Keep**, shrink `MainActivity` as feature bridges leave |
| `update/` | 916 | **Keep** (capability) |
| `device/` | 572 | **Keep**, becomes the one generic bridge |
| `audio/`, `recording/` | 2,209 | **Keep the recorder** (mic service, capture journal, mic ownership). Move recording lists, cancelled/unsent UI rules to web |
| `share/` | 1,906 | **Keep** share-in queue/upload; review for UI that can move to web |
| `notify/` | 299 | **Keep** (capability) |
| `photos/` | 721 | **Keep** background backup worker; move `PhotosActivity` settings screen to web |
| `everywhere/` | 3,708 | **Split**: keep overlay window, accessibility and keyboard services; move orb drawing, screen-mode actions (search, translate, ask) and outbox UI rules to web |
| `assist/` | 1,741 | **Split**: keep the assist/recognition service hosts; the surface page and its logic become web |
| `mizel/` | 2,702 | **Split**: keep the meeting mic service and PCM frames; move meeting protocol, journal rules, sync and upload policy to web/Mizel app |
| `apps/` | 957 | **Split**: keep the package installer capability; catalogue and policy come from the Wizard |
| `usuals/` (Food) | 1,844 | **Move to web** via a generic accessibility-automation capability, or retire |
| bundled assets (`assets/assist/*`) | 1,686 | **Load from the Wizard**: `orb.js` and `wizard-motion.*` are byte-identical copies of `web/` today |

## Order

1. Connect to any Wizard (#219) — the app stops being tied to one owner.
2. Android CI compile + unit tests (#316) — every thinning PR gets real compile proof.
3. Overlay surfaces load their pages from the Wizard instead of bundled copies (orb, surface, screen mode).
4. Food/usuals to web on a generic automation capability.
5. Apps catalogue from the Wizard; native keeps only install/uninstall.
6. Mizel protocol and upload policy to web; native keeps the meeting recorder.
7. Recording lists, cancelled/unsent and photo settings screens to web.
8. One generic, versioned device bridge replaces the feature-named methods.

## Thin enough to install broadly

Assess functionality, separability and modularity, not lines of code. The previous ~6,000-line target
was an arbitrary estimate, not an architectural requirement; it is withdrawn.

- Every native module has a documented device benefit that web cannot supply reliably. Keep native
  safety checks, lifecycle management and offline recovery even when they require substantial code.
- Feature screens, wording, workflows and non-device business rules can change through web updates
  without rebuilding the APK. Verify representative changes, rather than imposing a waiting period.
- Device capabilities have narrow, documented, versioned interfaces. Web apps can be replaced independently;
  capability discovery and graceful fallback keep older clients and newer web components compatible.
- Modules can be tested and changed independently. A feature's implementation does not leak into unrelated
  capabilities or require coordinated releases across the app.
- Native permission, origin, signer and payment-consent boundaries remain enforced on the device; moving
  policy to web must not weaken them or regress background/offline behaviour.
- Connect screen works for any Wizard; Alongside users can install the same APK. Switching preserves
  owner isolation and never carries another Wizard's pending work or credentials across.

Java line and bridge-method counts in CI are diagnostic inventory only, never acceptance gates. A larger
well-separated capability layer is preferable to a smaller tightly coupled app.
