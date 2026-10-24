---
name: wizard-spaces
description: "Use when the owner asks for a chat Space or folder."
version: 0.2.0
author: James, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [wizard-os, chats, spaces]
    related_skills: []
---

# Owner-created Chats Spaces

A Space is a named collection of chat threads belonging to one agent. Tap the active agent tab (or
long-press any agent tab) to choose its Spaces. Selecting one replaces that tab’s label; All restores
the agent label. The strip itself contains only All and agents. Subjects still classify threads and power By subject sort; never
turn subjects into Spaces automatically. Creating a Space neither moves threads nor changes privacy.

## When to use

On an explicit request such as “make me a space/workspace/folder/category/project for X”, create a
Space and back-fill related threads. If the owner clearly means a software project or filesystem
folder instead of a chat collection, do that task, not a Space. Never invent Spaces unprompted.
Rename/delete or adjust membership only when requested. Do not create a real Space merely for QA.

## Workflow

1. List the existing Spaces first. If the requested collection already exists, reuse its id; don't
   duplicate it. A request to fill an existing Space id means add to that exact Space, not create.
   Missing `agent` on old Spaces means `hermes` (the main agent). Choose a short faithful owner-facing name, at most 60 characters.
2. Search only the Space’s owning agent’s threads. `search SPACE_ID QUERY` uses the scoped shell
   search API and returns canonical thread ids. Search multiple terms; a truncated result is not exhaustive.
   Search the owner's threads with the installed session/history search tools: titles, subjects,
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
   Space join it automatically. The run’s status instructions include your existing Spaces (names + ids):
   add optional `space` to the final WIZARD_STATUS_V1 only if this thread clearly belongs to one of them.
   The service validates ownership and adds membership without removing other memberships. Omit it
   when uncertain. Never invent a Space or ID.

## Commands

Run the shipped helper from this skill's directory (Node 22+):

```sh
node scripts/wizard-spaces.mjs list
node scripts/wizard-spaces.mjs create --agent hermes 'Wizard OS launch' wizard_real_thread_1 wizard_real_thread_2
node scripts/wizard-spaces.mjs rename SPACE_ID 'Launch'
node scripts/wizard-spaces.mjs search SPACE_ID 'launch release'
node scripts/wizard-spaces.mjs add SPACE_ID --agent hermes wizard_real_thread_3
node scripts/wizard-spaces.mjs remove SPACE_ID wizard_real_thread_2
node scripts/wizard-spaces.mjs delete SPACE_ID
```

`--agent ID` scopes list, creates an agent-owned Space, and rejects edits/search for a foreign-agent Space.
Duplicate names are checked within an agent. Omit `--agent` only when main is intended.
The picker creates an empty Space first, then sends ONE ordinary new-chat message to its owning agent
asking it to fill that id. Add matching existing threads with `add`; the fill thread itself is already a member.

The create output includes `created.id`; keep it for later commands. Names with spaces are one quoted
argument. Pass ids literally from search results; example ids above are placeholders, never execute
those examples as real membership. Deletion removes only the Space, never its threads.

Default transport: `http://127.0.0.1:8923/wizard/v1/ui-preferences`, the existing owner-authorized
loopback route. Set `WIZARD_UI_PREFERENCES_URL` to this installation's existing owner-authorized route
if different. Never invent a credential, weaken auth or write the preferences file directly. If the
service lacks `spaces` or returns 403, stop and report the deployment/authorization blocker. The
helper sends only the `spaces` key, preserving pins and all other preferences. Run one collection edit
at a time: this whole-array read/merge/write contract does not provide same-array compare-and-swap.

Restricted/routed agents: this helper is an owner-authorized preferences client, not a grant. A container
without the installed skill or access to this route cannot perform historical back-fill. Report that gap;
never use host credentials, cross-agent history, a new network bridge or direct file writes as a workaround.
Status-based filing still works server-side for these agents.

Installation: Wizard UX ships this directory under `skills/wizard-spaces`. Copy the whole directory,
including `scripts/`, to the active agent's native skills directory (`$HERMES_HOME/skills`, normally
`~/.hermes/skills`). No host-specific path or secret belongs in the shipped skill.
