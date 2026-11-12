#!/bin/sh
# Render the shell's nginx config from two settings, then run nginx in the foreground.
#   WIZARD_AGENT_SERVICE_ORIGIN  where the Agent Service answers (default http://wizard-agent-service:8787)
#   WIZARD_SHELL_LISTEN          what nginx listens on (default 8788; alongside mode: 127.0.0.1:<port>)
set -eu
: "${WIZARD_AGENT_SERVICE_ORIGIN:=http://wizard-agent-service:8787}"
: "${WIZARD_SHELL_LISTEN:=8788}"
printf '%s' "$WIZARD_AGENT_SERVICE_ORIGIN" | grep -Eq '^http://[A-Za-z0-9._-]+(:[0-9]{1,5})?$' \
  || { printf 'WIZARD_AGENT_SERVICE_ORIGIN must be an http origin like http://host:port (no TLS inside the box)\n' >&2; exit 2; }
printf '%s' "$WIZARD_SHELL_LISTEN" | grep -Eq '^(127\.0\.0\.1:)?[0-9]{1,5}$' \
  || { printf 'WIZARD_SHELL_LISTEN must be a port or 127.0.0.1:<port>\n' >&2; exit 2; }
# Host network (listening on 127.0.0.1) has no Docker DNS: the service must be an IP literal there.
case "$WIZARD_SHELL_LISTEN" in 127.0.0.1:*)
  printf '%s' "$WIZARD_AGENT_SERVICE_ORIGIN" | grep -Eq '^http://[0-9.]+:[0-9]{1,5}$' \
    || { printf 'on the host network WIZARD_AGENT_SERVICE_ORIGIN must be http://<ip>:<port>\n' >&2; exit 2; } ;;
esac
export WIZARD_AGENT_SERVICE_ORIGIN WIZARD_SHELL_LISTEN
cp /etc/wizard-shell/static.conf /tmp/wizard-static.conf
# Browser owner boundary (wizard-os#133, wizard-app-manager docs/browser-boundary.md). Off unless
# WIZARD_BROWSER_BOUNDARY=1; then WIZARD_SHELL_TOKEN_FILE must hold the shell token (64 lowercase hex), or the shell
# refuses to start rather than serve a page that cannot reach the owner's routes. On, nginx writes the token into
# the shell page (index.html / desktop.html <meta name="wizard-shell-token">) for a real top-level page load only.
old_umask=$(umask); umask 077
if [ "${WIZARD_BROWSER_BOUNDARY:-}" = 1 ]; then
  token=$(tr -d ' \t\r\n' 2>/dev/null < "${WIZARD_SHELL_TOKEN_FILE:-/nonexistent}") || token=
  printf '%s' "$token" | grep -Eqx '[0-9a-f]{64}' \
    || { printf 'WIZARD_BROWSER_BOUNDARY=1 needs WIZARD_SHELL_TOKEN_FILE with the shell token (64 lowercase hex)\n' >&2; exit 2; }
  # A real page load: a top-level navigation (navigate/document), or the same navigation passed on by the shell's own
  # service worker (Chrome sends it as navigate/empty). A frame (navigate/iframe), fetch, worker or warm-up read: none.
  printf 'map "$http_sec_fetch_mode:$http_sec_fetch_dest" $wizard_shell_token { "navigate:document" "%s"; "navigate:empty" "%s"; default ""; }\n' "$token" "$token" > /tmp/wizard-boundary.conf
  cat > /tmp/wizard-boundary-static.conf <<'CONF'
sub_filter '<meta name="wizard-shell-token" content="">' '<meta name="wizard-shell-token" content="$wizard_shell_token">';
sub_filter_once on;
add_header Vary "Sec-Fetch-Mode, Sec-Fetch-Dest" always;
CONF
  unset token
else
  printf 'map "$http_sec_fetch_mode:$http_sec_fetch_dest" $wizard_shell_token { default ""; }\n' > /tmp/wizard-boundary.conf
  : > /tmp/wizard-boundary-static.conf
fi
umask "$old_umask"
cp /etc/wizard-shell/proxy.conf /tmp/wizard-proxy.conf
cp /etc/wizard-shell/proxy-mcp.conf /tmp/wizard-proxy-mcp.conf
# Substitute only these two names; nginx's own $variables stay as they are.
envsubst '${WIZARD_AGENT_SERVICE_ORIGIN} ${WIZARD_SHELL_LISTEN}' < /etc/wizard-shell/nginx.conf.template > /tmp/nginx.conf
nginx -t -q -c /tmp/nginx.conf
exec python3 /etc/wizard-shell/shell-processes.py
