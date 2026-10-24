#!/bin/sh
# Stamps every local script and stylesheet link in the shell's HTML pages with a hash of that file's bytes:
#   <script src="core/notif-bell.js">  ->  <script src="core/notif-bell.js?v=3f9c2a1b7d">
# Each release then asks for its own copy of every file, so a phone can never start a new shell against an old
# cached module (Robert's iPhone, 24 Oct 2026: a cached notif-bell.js without WosBell.paint stopped Wizard at boot).
# Run at image build time on the copied web/ tree (see Dockerfile); git keeps the plain links. POSIX sh + busybox.
#   usage: stamp-assets.sh <web-root>
set -eu
root="${1:?usage: stamp-assets.sh <web-root>}"
cd "$root"
find . -name '*.html' -type f | while IFS= read -r page; do
  dir=$(dirname "$page")
  # Local .js/.css links only: relative paths or the shell's own /wizard-os-home/ prefix, not yet stamped.
  grep -oE '(src|href)="[A-Za-z0-9._/-]+\.(js|css)"' "$page" | sed -E 's/^(src|href)="//; s/"$//' | sort -u | while IFS= read -r ref; do
    case "$ref" in
      //*|*://*) continue ;;
      /wizard-os-home/*) file="./${ref#/wizard-os-home/}" ;;
      /*) continue ;;
      *) file="$dir/$ref" ;;
    esac
    # Owner-generated data (data.js, summaries.js) changes at runtime: leave it unstamped.
    case "$ref" in data.js|summaries.js|*/data.js|*/summaries.js) continue ;; esac
    [ -f "$file" ] || continue
    v=$(sha1sum "$file" | cut -c1-10)
    sed -i "s|=\"$ref\"|=\"$ref?v=$v\"|g" "$page"
  done
done
