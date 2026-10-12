# Shell · Skin · App — proposed appearance contract

Status: isolated executable preview. This is a proposal, not an approved platform standard or live app migration.

## The three layers

**Shell = how you move.** It owns the orb, desks, swipe navigation, tile/window arrangement, fullscreen entry, window chrome and the outer Back stack. Another shell may use a sidebar, a single pane or a different workspace paradigm. An app should run inside all of them unchanged.

**Skin = how the system looks and feels.** It supplies semantic colors, backgrounds, surface treatments, type roles, corner shapes, control appearance and motion preferences. A skin can dress compatible shell elements, but does not introduce another navigation model. Switching navigation models means switching the shell.

**App = what you do.** It owns its information layout, reader/player/feed interactions, content and app state. Wisdom owns its editorial serif, reading measure and pacing. Music owns its player; Signal owns its feed. App-specific typography remains first-class.

The layering is shell + selected skin + app, rather than an app importing the shell's implementation. Each shell resolves the same skin contract and sends a normalized appearance context to the app.

## What this preview actually implements

- Yesterday's six skins dress the existing Wizard windowed shell.
- A small host adapter reads the resolved skin and sends appearance to registered preview frames.
- Four frozen sample app views consume semantic CSS properties through one framework-neutral client.
- Appearance has window / immersive / standalone modes. Window backgrounds can be transparent; fullscreen reading gets a stable opaque reader surface.
- Original / Unified compares the same sample content with native app colors or the shared palette.
- Appearance changes arrive without reloading the app document. Fonts, scroll and local interaction state can survive because the app DOM is not replaced.
- A second minimal host on the architecture page loads the same Wisdom document with the same client. That is a bounded demonstration of shell independence, not a replacement shell release.
- Staging has a fixture-only backend with no connection to production data, agent tools, microphone or writes.

Prototype scope: same-origin registered frames, color roles, presentation mode and comparison state. Production cross-origin installation, durable per-owner skin settings, packaged components, font-role negotiation and app-store conformance are the next implementation steps.

## Appearance v1

The host sends a typed message:

```json
{"type":"wizard:appearance","appearance":{"version":1,"revision":12,"skin":"nebula","colorScheme":"dark","presentation":"window","comparison":"unified","tokens":{"canvas":"#05030c","surface":"rgba(18,12,38,.58)","surface-raised":"#211a30","text":"#f3efff","text-secondary":"#b9b0d8","text-muted":"#a59abf","border":"rgba(205,190,255,.24)","accent":"#b99bff","accent-soft":"rgba(143,99,255,.16)","on-accent":"#160b32","reader-surface":"#0e0919"}}}
```

The app adapter writes `--wz-*` properties and dispatches `wizard:theme`. App CSS references their meaning, e.g. `color: var(--wz-text)` and `background: var(--wz-surface)`. App code never checks whether it is inside the orb shell, a sidebar shell or a future shell.

The app announces `wizard:appearance:ready` after loading. The host replies with the current context and the app acknowledges the applied revision. Newly opened apps get the current skin, and already-open apps get later revisions. Stale revisions are ignored. Theme changes are event-driven, not polling.

`presentation` describes the host environment; it does not tell the app its layout. A reader can use the opaque `reader-surface` in immersive mode, while a windowed library can use transparent canvas + system surfaces. The host also needs to supply safe-area/inset and available-size signals in the production contract; CSS container queries handle the app's own layout.

## Typography without flattening identity

Use separate roles: `font-ui`, `font-reading`, `font-display`, `font-mono`. The skin can supply defaults and an app can declare which roles it accepts. Wisdom's reading and display roles are app-owned by default; its small controls can adopt the common UI role. A skin change should never quietly overwrite all descendants' font-family.

Content-owned things stay content-owned: album covers, publication portraits, charts and status meanings. An app can retain a restrained identity accent, resolved against each skin for legibility. This preview deliberately tests stronger palette inheritance first so James can judge whether Wisdom still feels right.

## Shared package and app recipe

Proposed `@wizard/ui` package (or equivalent static files) contains:

1. A versioned appearance schema and small host/client adapters.
2. Semantic token CSS with standalone defaults.
3. Framework-neutral primitive classes for controls, search fields, tabs, menus, panels and empty/loading states; optional framework bindings sit above those.
4. A conformance fixture that mounts a new app under light/dark skins, small/large containers and window/fullscreen modes.

A new app starts from a template importing the client + primitives. Its manifest declares appearance version, supported type roles and host integration capabilities. Its `wizard.md` describes the same interface to the app-builder agent. Specific manifest fields remain proposed; they are not an already-approved extension to wizard.md.

Apps do not need all shared controls. They do need the semantic roles wherever they draw system-like backgrounds, labels and controls. Colors for content visualization remain deliberate exceptions.

## Container and origin boundaries

CSS does not cross an iframe boundary. Sharing a stylesheet alone gives common defaults but does not tell an already-open app which skin is active. The runtime adapter is the small missing link.

Production App Manager knows the installed app's origin and allowed shell origin. Each side sends to an exact target origin and verifies source window + origin + schema. Only appearance values pass across this connection; it grants no API, filesystem, microphone or agent permission. Installation/pairing supplies trust, not an arbitrary query parameter or a claimed app ID.

Use a finite token schema with validated color/length/type values. Avoid arbitrary HTML, script or remote stylesheet URLs in a theme payload. Theme assets can be packaged and served through the existing trusted app/skin distribution route.

Old or third-party apps can still open in themed chrome. Full interior reskinning requires adoption of the client/token contract; the shell should not reach into unknown DOM and guess at its styling.

## State, updates and Back

Appearance updates must not remount an app, reset its scroll or stop playback. Theme preference is owner/system configuration, persisted outside app storage and reapplied on connect. The current preview persists the skin on its isolated origin only; box-level theme.json persistence is future work.

App Back first closes its own overlay or nested view and reports handled / at-root. The shell then exits fullscreen or changes workspace; a single Back never exits Wizard. A future asynchronous cross-origin Back RPC needs a bounded response and one action per request. The preview uses the existing honest same-origin `__wizardCloseOverlay` hook as compatibility glue, not as the proposed portable contract.

Pin the appearance version and shared package version. Retain standalone defaults if the host is older or absent. Prefer compatible additions and explicit capabilities over app forks tied to each shell release.

## Recommended adoption sequence

1. Judge this preview's colors and Wisdom reading experience.
2. Lock the smallest v1 semantic surface/color contract and appearance transport.
3. Integrate theme resolution in the shell and persist owner selection.
4. Migrate these representative apps, preserving their workflows and fonts.
5. Add the app template + checker to the existing app-builder lane after approval; don't create a parallel builder.
6. Migrate the remaining apps individually. Files needs its fuller UI makeover on this foundation.

The release check is an experience: switch skins with multiple apps open, preserve reading/player state, reload and reopen, then use nested and root Back. Same app document in two hosts proves shell independence. Contrast, focus and touch targets must pass in both light and dark modes.
