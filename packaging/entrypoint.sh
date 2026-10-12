#!/bin/sh
set -eu
case "$WIZARD_AGENT_SERVICE_ORIGIN" in http://*|https://*) ;; *) printf 'Invalid Agent Service origin\n' >&2; exit 2;; esac
# Only substitute the upstream origin; nginx variables stay intact.
envsubst '${WIZARD_AGENT_SERVICE_ORIGIN}' < /etc/wizard-shell/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
