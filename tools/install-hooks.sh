#!/bin/sh
# Installs the hooks that keep web/ux-version.txt and web/ux-changes.json current (shared by every worktree of
# this repo). Each hook passes its own name, so post-commit can note which agent thread made the commit.
d=$(git rev-parse --git-common-dir) || exit 1
for h in post-commit post-merge post-checkout post-rewrite; do
  printf '#!/bin/sh\nexec sh "$(git rev-parse --show-toplevel)/tools/write-ux-version.sh" %s "$@"\n' "$h" > "$d/hooks/$h"
  chmod +x "$d/hooks/$h"
done
# Amend/rebase keep the thread note on the rewritten commit.
git config notes.rewriteRef refs/notes/wizard-thread
sh "$(git rev-parse --show-toplevel)/tools/write-ux-version.sh"
echo "hooks installed in $d/hooks"
