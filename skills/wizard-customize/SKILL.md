---
name: wizard-customize
description: "Use when the owner asks to change Wizard's look or layout."
version: 0.1.0
author: Wizard OS
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [wizard-os, skins, appearance, customization, ui-preferences]
    related_skills: [wizard-spaces]
---

# Customize Wizard (look, layout, settings)

The owner says "make my accent orange", "use a warmer palette", "make the chat list denser" or "hide
the Day view". Make the change through the supported customization surfaces below, never by editing
the shell. Everything here survives a shell update, because none of it lives in the shell.

## Rules

1. Never edit shell source: no `web/`, `index.html`, `desktop.html`, the served UX directory, a skin
   package, `settings.json` or `ui-preferences.json` on disk. A change there is lost at the next update
   and can break every device.
2. One request = one `change` call. The helper records the exact previous state first, applies the
   change, reads it back from the shell's own routes, and rolls back if the read-back fails.
3. "Undo that" = one `undo` call. It restores exactly the previous look and layout. It refuses when
   the owner (or another change) edited the same thing since; show the owner what changed and ask
   before `--force`. It always refuses when the owner wears a different skin than the change was made
   on, even with `--force`: ask them to wear that skin again first.
4. Look changes apply to the owner's **own skin** (Settings › Look › My skin). Layout preferences do
   not need one. If a look change finds none worn, the helper stops with that message; ask the owner to wear their own skin (any base is fine) and retry.
   Do not switch skins for them.
5. Never approve a script. `skin.js` always starts off; only the owner's tap on **Turn on** in
   Settings › Look runs it.
6. Use the colour tokens below, never hard-coded colours on shell classes, so the change works on
   every base skin. Check it on two skins when you can (the owner's base and one other).

## What to use for each request

| Request | Supported surface | Helper call |
|---|---|---|
| Accent colour ("orange", "#2f80ed") | Own skin `skin.css`, `accent` block setting the `--violet`/`--violet-2` tokens | `change --accent orange` |
| Palette / warmer / cooler / font / spacing | Own skin `skin.css`, a named block of token overrides on `:root` | `change --css-block palette=FILE` |
| Denser chat list ("compact", "titles only") | Box-wide UI preference `compact` | `change --pref compact=true` |
| "Hide the Day view" / group chats by status | UI preference `chatLayout` (`day` = Ready/Yesterday/Past week, `status` = Working/Ready/Archive) | `change --pref chatLayout='"status"'` |
| Ready order | UI preference `readyOrder` (`newest`, `oldest`, `priority`, `subject`) | `change --pref readyOrder='"priority"'` |
| Auto-archive age | UI preference `archiveAfterDays` (0, 1, 3, 7, 14, 30) | `change --pref archiveAfterDays=14` |
| Behaviour (hooks, extra controls) | Own skin `skin.js` with the skin hook API; off until the owner taps Turn on | `change --script FILE` |
| Chat Spaces / folders | Not this skill | use `wizard-spaces` |
| Pick a different built-in skin | Owner's tap in Settings › Look | tell the owner where it is |

Several parts of one request go in **one** call so one undo reverts all of it:
`change --label "orange accent, compact chats" --accent orange --pref compact=true`.

Useful tokens (every skin defines them): `--bg`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-2`,
`--glass`, `--glass-2`, `--violet` (accent), `--violet-2`, `--pink`, `--cyan`, `--amber`, `--green`,
`--red`. Override them on `:root` with `!important`, because skins set them inline while blending.
Plain CSS only: no `@import`, no `url()` to another origin; the Agent Service drops anything else and
the helper then reports the block as not served.

## Helper

`scripts/wizard-customize.mjs` (Node 18+, no dependencies):

```
node scripts/wizard-customize.mjs status            # worn own skin, its blocks, current preferences, last change
node scripts/wizard-customize.mjs change [--label TEXT] [--accent COLOUR] [--css-block NAME=FILE|-]...
                                         [--remove-block NAME]... [--pref KEY=JSON]... [--script FILE | --remove-script]
node scripts/wizard-customize.mjs undo [--force]    # one step back
node scripts/wizard-customize.mjs history
```

- Edits only its own marked blocks in `skin.css` (`/* wizard-customize:NAME */ … /* /wizard-customize:NAME */`).
  Everything the owner wrote outside them is kept byte for byte.
- Environment: `WIZARD_URL` (default `http://127.0.0.1:8923`, the Agent Service on the box) and
  `WIZARD_FILES_ROOT` (the owner's Files root). Look changes need `WIZARD_FILES_ROOT`: the helper reads the
  raw `Skins/<skin>/skin.css`, because the API serves a sanitised copy without comments, and writing that
  back would lose the owner's text. Writes go through the owner API, or into `Skins/` when the agent is not
  the owner principal. Layout preferences need only `WIZARD_URL`. Without the Files root, use the Files
  app tools on the path `status` prints.
- History lives in `$HERMES_HOME/wizard-customize/history.json` (last 50 changes, previous state included).

## Workflow

1. `status`. Note the worn own skin and current values.
2. Map the request with the table. Ask only when it is genuinely ambiguous ("warmer" needs no question:
   pick warm hues for `--violet`, `--pink`, `--amber`).
3. `change …` with a short `--label` in the owner's words. Read the JSON: `ok`, `blocks`, `preferences`.
4. Tell the owner what changed and that "undo that" reverts it. Devices pick the look up on their next
   load (Reload, or reopen the app); preferences sync within a minute.
5. "Undo that" → `undo`; report what was restored.

## Recovery

- Broken look: open Wizard with `?myskin=off` (for example `https://<wizard>/wizard-os-home/?myskin=off`)
  to show the base skin for that load, then `undo` or `change --remove-block NAME`.
- Broken `skin.js`: the shell switches it off on the first error, names the file (`Skins/<skin>/skin.js`)
  and the reason in a notice and in Settings › Look, and it stays off after reload. Fix or `undo` the file;
  the owner turns the new version on.
- Nothing else in the shell needs repair: removing the blocks (or emptying `skin.css`) restores the base
  skin exactly.

## Install

Wizard UX ships this directory under `skills/wizard-customize`. Copy the whole directory, including
`scripts/`, to the active agent's native skills directory (`$HERMES_HOME/skills`, normally
`~/.hermes/skills`). No host-specific path or secret belongs in the shipped skill.
