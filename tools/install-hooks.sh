#!/bin/sh
# Installs the hooks that keep web/ux-version.txt current (shared by every worktree of this repo).
d=$(git rev-parse --git-common-dir) || exit 1
for h in post-commit post-merge post-checkout post-rewrite; do
  printf '#!/bin/sh\nexec sh "$(git rev-parse --show-toplevel)/tools/write-ux-version.sh"\n' > "$d/hooks/$h"
  chmod +x "$d/hooks/$h"
done
sh "$(git rev-parse --show-toplevel)/tools/write-ux-version.sh"
echo "hooks installed in $d/hooks"
