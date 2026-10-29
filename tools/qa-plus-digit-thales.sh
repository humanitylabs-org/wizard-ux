#!/bin/zsh
# Worker A/B: baseline tree vs option-digit plus-slot candidate.
: "${WIZARD_WORK_ROOT:?Set WIZARD_WORK_ROOT to the worker work volume}"
R="$WIZARD_WORK_ROOT/WizardUX/qa-plus-digit"
# Install playwright/playwright-core in each checkout, or set QA_PLAYWRIGHT.
for t in base cand; do
  echo "== $t"
  cd "$R/$t" || exit 2
  QA_WEB_DIR="$PWD" QA_OUT="$PWD/out" node qa-dynamic-desktops.cjs > "$R/$t.log" 2>&1
  echo "exit $?"
  grep -c '^PASS' "$R/$t.log"
  tail -6 "$R/$t.log"
done
