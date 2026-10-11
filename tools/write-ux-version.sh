#!/bin/sh
# Writes web/ux-version.txt = git tree id of web/ at HEAD. The shell polls it (web/device.js checkWeb) and shows
# "Wizard OS was updated · Reload" when it changes. Run by .git/hooks post-commit/post-merge/post-checkout/
# post-rewrite (tools/install-hooks.sh); safe to run by hand. Gitignored, so writing it never dirties the tree.
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
v=$(git -C "$top" rev-parse HEAD:web 2>/dev/null) || exit 0
f="$top/web/ux-version.txt"
[ "$(cat "$f" 2>/dev/null)" = "$v" ] && exit 0
printf '%s\n' "$v" > "$f.tmp" && mv "$f.tmp" "$f"
