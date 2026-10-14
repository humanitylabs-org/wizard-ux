#!/bin/zsh
# Thales-only A/B: baseline daily tree vs ⌥-digit plus-slot candidate.
R=/Volumes/ThalesMedia/WizardUX/qa-plus-digit
export PATH=/opt/homebrew/bin:$PATH
export PLAYWRIGHT_PATH=/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright
for t in base cand; do
  echo "== $t"
  cd "$R/$t" || exit 2
  QA_WEB_DIR="$PWD" QA_OUT="$PWD/out" node qa-dynamic-desktops.cjs > "$R/$t.log" 2>&1
  echo "exit $?"
  grep -c '^PASS' "$R/$t.log"
  tail -6 "$R/$t.log"
done
