# Settings redesign (v2)

Owner request (James, 21 Oct 2026): "Our settings menu is way too convoluted and cluttered with way too many options. Completely redesign the settings menu to make this more manageable", including the two pending pieces: choosing the default Chats and skins suggesting their Chats.

## Problem today

One long scroll (≈2,800 px on a phone) of 11+ equal-weight groups: Unsent & retained, Look, Windows, Voice transcription, Recovered & cancelled recordings, Text selection menu, Wizard, AI usage, Views & actions, plus Assistant / Photos / Microphone / Updates / Own views when available. Recovery inboxes, daily preferences, diagnostics and launchers all sit at the same level, each with paragraphs of explanatory copy. Nothing tells you what needs attention.

## Design

**Root = a short index, never the content.** Phone: drill-down pages. Desktop: two panes (category list left ~280 px, page right) inside the existing Settings window.

Root, top to bottom:

1. **Needs attention** strip, shown only when non-empty. One compact row per item, each opening the page that resolves it:
   - "N messages not sent" → Unsent & recovered
   - "N recordings to recover" → Unsent & recovered
   - "Update ready" → About & updates
   - "Voice unavailable" / "Sign-in needed" → the relevant page
2. Seven category rows. Each row: icon, title, and a **one-line live subtitle showing the current state** (so the root answers most questions without opening anything):

| Row | Subtitle example | Page contains (existing features moved, behaviour unchanged) |
|---|---|---|
| Appearance | Wizard · Nebula | Skin family + colours (`look`), My skin, Borderless apps (`skin-frame`, phone only). "Import skin JSON" moves under a collapsed "Advanced" disclosure. |
| Chats & app screens | Chats: Wizard Chats | **New** default-Chats chooser, **new** skin suggestion, Own app screens (`own-views`). |
| Voice & typing | Voice ready · Mic: default | Voice transcription status (`voice`), Microphone (`microphone`), Text selection menu (`selection`). |
| Phone (Android only) | Everywhere on | Wizard Everywhere, Voice typing & screenshots, side button (`assistant`). |
| Unsent & recovered | Nothing waiting / 2 waiting | Unsent & retained (`unsent`) + Recovered & cancelled recordings (`cancelled`). |
| AI usage | Claude 6% · ChatGPT 12% | `usage` unchanged. |
| About & updates | Connected · up to date | Connection status, Check for updates, OS updates (`updates`), Gestures & help. |

3. A quiet footer line of shortcuts, not a settings group: **Files · Day/Week/Month in review · Maps · Local command** (today's "Views & actions" + Files). These are launchers, so they shrink to small text buttons.

Copy rule: one short subtitle per row; long explanations (e.g. the retry/held paragraph) move into a single "?" info toggle or are cut. No paragraph above the fold on any page.

### Default Chats chooser (new, page "Chats & app screens")

- Source: `GET /wizard/v1/apps` → `slots.chats.default` and `slots.chats.candidates` (also already parsed by `core/chats-view.js`: `WizChatsView.installed()`, `defaultId()`).
- UI: radio list of installed Chats views. Built-in first, labelled "Wizard Chats (built in)". With only the built-in installed, show it selected plus one muted line "Install another Chats from the Store to switch" (link to Store) — no empty chrome.
- Changing it: confirm sheet "Use Mizel Chats for all your chats? You can switch back here any time." → `POST /wizard-os-home/store-install/_slots/chats` `{"default":"<id>"}` (existing privileged owner listener, `GET` reads it). On success re-read the registry and re-render Chats with the new provider; on failure keep the old selection and toast the error. Only Settings may call it.

### Skins suggest their Chats (new, decision #72)

- A skin family may declare `recommends: { chats: "<app id>" }` in its skin metadata (spec `SKINS_AND_VIEWS.md`; add the field to the skin family schema and Mizel's family as the example `mizel-chats`).
- When the active skin recommends a Chats view that is not the current default, show one suggestion card on the Appearance page under the skin picker and on the Chats page: "Mizel goes with Mizel Chats" + **Use it** (same confirm path) / **Not now** (dismiss per skin id, stored in localStorage). If the recommended app isn't installed: **Get it** opens the Store on that app. Never switches automatically.

### Navigation contract

- Phone: page header with ‹ back + title. Android/browser Back: page → root → close Settings (existing Back rules; never exits the app).
- Desktop: selecting a category swaps the right pane; Esc closes Settings; keyboard ↑/↓ moves through categories.
- Deep links: every existing alias (`?view=settings`, `skin`, `usage`, `updates`, `mic`, `own-views`, `features`, unsent focus via `recoverUnsent(id)`) opens the page holding that feature and scrolls/focuses it. Add `chats-default`.
- Feature registry stays: `WosSettings.register()` gains an optional `page` field (`appearance`, `chats`, `voice`, `phone`, `recovery`, `usage`, `about`); unregistered page → "About & updates". Existing feature ids, `html()` and `act()` keep working unchanged so other modules don't break.

### Look

Wizard skin tokens only (`--wz-*`); transparent when hosted; check two skins (Nebula and Mizel Light). Dark default. Row height ≥ 48 px touch targets.

## Acceptance

1. Phone root fits in one screen (412×892) with no scrolling when nothing needs attention; desktop shows two panes.
2. Every option reachable today is reachable in ≤ 2 taps from root, with identical behaviour (existing suites green).
3. Attention strip appears for unsent messages / recovered recordings / update ready, and its row opens the right page.
4. Default Chats chooser lists providers, confirms, POSTs the slot default, and re-renders; built-in-only state shows the Store hint.
5. Mizel skin shows the Mizel Chats suggestion; Not now hides it for that skin; never auto-switches.
6. Back: page → root → closed; app never exits. Deep-link aliases land on the right page.

## What belongs in Settings

Settings configures Wizard itself: look, chats, voice, phone integration, recovery, usage, updates. Anything that is an app or optional (Photos backup, Android Apps, Music, Calendar…) lives in its own app and launcher tile, never as a Settings row or page (James, 24 Oct 2026). A Wizard OS native capability such as photo backup reaches its app through a narrow shell relay (`photos-relay.js`, `android-relay.js`), not through Settings.
