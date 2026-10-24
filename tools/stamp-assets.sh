#!/bin/sh
# Gives every shell file a release-specific URL, so a phone can never start one release's shell against another
# release's cached modules (Robert's iPhone, 24 Oct 2026: a cached notif-bell.js without WosBell.paint stopped
# Wizard at boot). One release-wide token (hash of every file under web/) is added as ?v=<token> to:
#   - every local <script src> / <link href> .js/.css in each HTML page,
#   - every relative static or literal dynamic ES module import in each .js file (import ... from './x.js'),
#   - a <meta name="wos-release"> in each page, which core/skin-host.js appends to skin/layout files it loads.
# A release-wide token (not per-file hashes) also covers a module whose own bytes are unchanged but whose
# dependency changed. Run at image build time on the copied web/ tree (see Dockerfile); git keeps plain links.
# POSIX sh + busybox.   usage: stamp-assets.sh <web-root>
set -eu
root="${1:?usage: stamp-assets.sh <web-root>}"
cd "$root"
# Owner-generated data (data.js, summaries.js) changes at runtime: never part of the token, never stamped.
v=$(find . -type f ! -name data.js ! -name summaries.js | LC_ALL=C sort | xargs sha1sum | sha1sum | cut -c1-12)
find . -name '*.html' -type f | while IFS= read -r page; do
  grep -q 'name="wos-release"' "$page" || sed -i.bak "s|<meta charset=\"utf-8\">|<meta charset=\"utf-8\"><meta name=\"wos-release\" content=\"$v\">|" "$page"
  # Relative links or the shell's own /wizard-os-home/ prefix only; other absolute paths and data files stay plain.
  sed -i.bak -E \
    -e "s#((src|href)=\"(/wizard-os-home/)?[A-Za-z0-9._][A-Za-z0-9._/-]*\.(js|css))\"#\1?v=$v\"#g" \
    -e "s#((src|href)=\"([A-Za-z0-9._/-]*/)?(data|summaries)\.js)\?v=$v\"#\1\"#g" \
    "$page"
  rm -f "$page.bak"
done
find . -name '*.js' -type f ! -name data.js ! -name summaries.js | while IFS= read -r f; do
  grep -qE "(from|import)[[:space:]]*\(?[[:space:]]*['\"]\.\.?/" "$f" || continue
  sed -i.bak -E "s#((from|import)[[:space:]]*\(?[[:space:]]*(['\"])\.\.?/[A-Za-z0-9._/-]+\.js)(['\"])#\1?v=$v\4#g" "$f"
  rm -f "$f.bak"
done
