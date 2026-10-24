---
name: wizard-spaces
description: "Use when the owner asks for a chat Space or folder."
version: 0.1.0
author: James, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [wizard-os, chats, spaces]
    related_skills: []
---

# Owner-created Chats Spaces

A Space is a named collection of existing chat threads. It appears after All and the agents in the
Chats Focus strip on every device. Subjects still classify threads and power By subject sort; never
turn subjects into Spaces automatically. Creating a Space neither moves threads nor changes privacy.

## When to use

On an explicit request such as “make me a space/workspace/folder/category/project for X”, create a
Space and back-fill related threads. If the owner clearly means a software project or filesystem
folder instead of a chat collection, do that task, not a Space. Never invent Spaces unprompted.
Rename/delete or adjust membership only when requested. Do not create a real Space merely for QA.

## Workflow

1. List the existing Spaces first. If the requested collection already exists, reuse its id; don't
   duplicate it. Choose a short faithful owner-facing name, at most 60 characters.
2. Search the owner's threads with the installed session/history search tools: titles, subjects,
   then recent content for ambiguous candidates. Use multiple related terms for X, not just literal
   title matching. Read enough recent turns to judge membership; exclude unrelated same-word hits.
   Respect the current agent's private-history boundary: don't retrieve inaccessible agents' content
   or leak private titles. Use only real canonical thread IDs returned by search/list, not run IDs,
   fabricated ids or internal session ids that have not been mapped to the shell thread id.
3. Create the Space with the related thread ids, or add ids to the existing requested Space. The
   helper deduplicates ids and verifies the exact saved collection by GET after PUT. Up to 50 Spaces,
   500 threads per Space. Leave uncertain threads out and explain any retrieval limitation.
4. Report the Space name, how many existing threads you actually added and a few thread titles.
   Don't claim exhaustive back-fill if search was incomplete. New chats started while focused on this
   Space join it automatically. Add future existing threads only when the owner requests it.

## Commands

Run the shipped helper from this skill's directory (Node 22+):

```sh
node scripts/wizard-spaces.mjs list
node scripts/wizard-spaces.mjs create 'Wizard OS launch' wizard_real_thread_1 wizard_real_thread_2
node scripts/wizard-spaces.mjs rename SPACE_ID 'Launch'
node scripts/wizard-spaces.mjs add SPACE_ID wizard_real_thread_3
node scripts/wizard-spaces.mjs remove SPACE_ID wizard_real_thread_2
node scripts/wizard-spaces.mjs delete SPACE_ID
```

The create output includes `created.id`; keep it for later commands. Names with spaces are one quoted
argument. Pass ids literally from search results; example ids above are placeholders, never execute
those examples as real membership. Deletion removes only the Space, never its threads.

Default transport: `http://127.0.0.1:8923/wizard/v1/ui-preferences`, the existing owner-authorized
loopback route. Set `WIZARD_UI_PREFERENCES_URL` to this installation's existing owner-authorized route
if different. Never invent a credential, weaken auth or write the preferences file directly. If the
service lacks `spaces` or returns 403, stop and report the deployment/authorization blocker. The
helper sends only the `spaces` key, preserving pins and all other preferences. Run one collection edit
at a time: this whole-array read/merge/write contract does not provide same-array compare-and-swap.

Installation: Wizard UX ships this directory under `skills/wizard-spaces`. Copy the whole directory,
including `scripts/`, to the active agent's native skills directory (`$HERMES_HOME/skills`, normally
`~/.hermes/skills`). No host-specific path or secret belongs in the shipped skill.
