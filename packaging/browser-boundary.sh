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
  # Optional, distinct: the Troubleshooter (host recovery listener) checks this one itself, so recovery keeps working
  # with the Agent Service down and the recovery listener never holds the shell token.
  WIZARD_RECOVERY_TOKEN=
  if [ -n "${WIZARD_RECOVERY_TOKEN_FILE:-}" ]; then
    [ -r "$WIZARD_RECOVERY_TOKEN_FILE" ] || { printf 'WIZARD_RECOVERY_TOKEN_FILE is not readable\n' >&2; exit 2; }
    WIZARD_RECOVERY_TOKEN=$(tr -d '\n' < "$WIZARD_RECOVERY_TOKEN_FILE")
    printf '%s' "$WIZARD_RECOVERY_TOKEN" | grep -Eq '^[a-f0-9]{64}$' && [ "$WIZARD_RECOVERY_TOKEN" != "$WIZARD_SHELL_TOKEN" ] \
      || { printf 'Recovery token must be 32 random bytes in lowercase hex, distinct from the shell token\n' >&2; exit 2; }
  fi
  export WIZARD_SHELL_TOKEN WIZARD_RECOVERY_TOKEN
  envsubst '${WIZARD_SHELL_TOKEN} ${WIZARD_RECOVERY_TOKEN}' < "$WIZARD_BOUNDARY_CONFIG_ROOT/browser-boundary-document.conf.template" > /tmp/wizard-boundary-document.conf
  unset WIZARD_SHELL_TOKEN WIZARD_RECOVERY_TOKEN
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
