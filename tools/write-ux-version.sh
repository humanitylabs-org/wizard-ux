#!/bin/sh
# Writes web/ux-version.txt = git tree id of web/ at HEAD. The shell polls it (web/device.js checkWeb) and shows
# "Wizard OS update ready · Reload" when it changes. Run by .git/hooks post-commit/post-merge/post-checkout/
# post-rewrite (tools/install-hooks.sh, which passes the hook name as $1); safe to run by hand. Gitignored, so
# writing it never dirties the tree.
# Also: a commit made by an agent thread records that thread (HERMES_SESSION_ID) as a git note, and
# web/ux-changes.json (tools/write-ux-changes.py) lists which threads made each update, so the banner can
# link to them.
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ "$1" = post-commit ] && [ -n "$HERMES_SESSION_ID" ]; then
  git -C "$top" notes --ref=wizard-thread add -f -m "$HERMES_SESSION_ID" HEAD >/dev/null 2>&1
fi
v=$(git -C "$top" rev-parse HEAD:web 2>/dev/null) || exit 0
f="$top/web/ux-version.txt"
changes() { [ -f "$top/tools/write-ux-changes.py" ] && command -v python3 >/dev/null 2>&1 && (cd "$top" && python3 tools/write-ux-changes.py >/dev/null 2>&1 &); }
if [ "$(cat "$f" 2>/dev/null)" = "$v" ]; then
  [ -f "$top/web/ux-changes.json" ] || changes
  exit 0
fi
# The change list first, so it is on disk by the time a client sees the new version.
[ -f "$top/tools/write-ux-changes.py" ] && command -v python3 >/dev/null 2>&1 && (cd "$top" && timeout 20 python3 tools/write-ux-changes.py >/dev/null 2>&1)
printf '%s\n' "$v" > "$f.tmp" && mv "$f.tmp" "$f"
exit 0
