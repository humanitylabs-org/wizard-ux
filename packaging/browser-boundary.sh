#!/bin/sh
# Sourced by entrypoint.sh. No secret is put in env sent upstream or in web assets.
# Config root override is for isolated packaging tests, not an owner path.
: "${WIZARD_BOUNDARY_CONFIG_ROOT:=/etc/wizard-shell}"
: > /tmp/wizard-boundary-locations.conf
if [ "${WIZARD_BROWSER_BOUNDARY:-0}" = 1 ]; then
  [ -n "${WIZARD_SHELL_TOKEN_FILE:-}" ] && [ -r "$WIZARD_SHELL_TOKEN_FILE" ] \
    || { printf 'Browser boundary requires readable WIZARD_SHELL_TOKEN_FILE\n' >&2; exit 2; }
  WIZARD_SHELL_TOKEN=$(tr -d '\n' < "$WIZARD_SHELL_TOKEN_FILE")
  printf '%s' "$WIZARD_SHELL_TOKEN" | grep -Eq '^[a-f0-9]{64}$' \
    || { printf 'Shell token must be 32 random bytes encoded as lowercase hex\n' >&2; exit 2; }
  export WIZARD_SHELL_TOKEN
  envsubst '${WIZARD_SHELL_TOKEN}' < "$WIZARD_BOUNDARY_CONFIG_ROOT/browser-boundary-document.conf.template" > /tmp/wizard-boundary-document.conf
  unset WIZARD_SHELL_TOKEN
  # The only credential-bearing responses. Document Fetch Metadata is forbidden
  # to JS fetch(), an iframe, a worker and a script element. Unrecognized aliases
  # remain static and carry no secret (and therefore cannot call owner APIs).
  for prefix in wizard-os-home wizard-ux; do
    for page in '' index.html desktop.html; do
      file=${page:-index.html}
      printf 'location = /%s/%s { root /usr/share/nginx/wizard-ux; try_files /%s =404; include /tmp/wizard-boundary-document.conf; }\n' "$prefix" "$page" "$file" >> /tmp/wizard-boundary-locations.conf
    done
  done
fi
