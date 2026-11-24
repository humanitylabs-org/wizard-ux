#!/bin/sh
# A real Wizard box in Docker for the browser owner boundary's hostile-app check (wizard-os#133).
#   tools/boundary-box.sh up on|off <shell image> <agent service image> [port]   start it (boundary on or off)
#   tools/boundary-box.sh log                                                     the box's request log (JSON lines)
#   tools/boundary-box.sh hermes                                                  what reached the agent harness
#   tools/boundary-box.sh down                                                    remove it
# The shell image (this repo's Dockerfile) and the Agent Service image are the real ones, with the same switch and
# token file `wam browser-boundary on` gives them. A stand-in for Tailscale Serve puts the shell and an app
# (tests/fixtures/boundary-box/hostile) on one origin and adds the owner's login to every request, and a stand-in agent
# harness answers the Agent Service. The Agent Service runs with WIZARD_AUTH_MODE=none: every caller is the owner by
# network path, which is exactly what an app page could exploit; only the boundary stands in its way.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
fx="$here/tests/fixtures/boundary-box"
net=wizbb
names="wizbb-front wizbb-hostile wizbb-shell wizbb-as wizbb-hermes"
case "${1:-}" in
  up)
    mode=${2:?on or off}; shell=${3:?shell image}; svc=${4:?agent service image}; port=${5:-18133}
    "$0" down >/dev/null 2>&1 || true
    work=$(mktemp -d); mkdir -p "$work/state"; chmod 777 "$work/state"
    cp "$fx/apps.json" "$work/state/apps.json"
    python3 -c 'import secrets; print(secrets.token_hex(32))' > "$work/shell-token"; chmod 644 "$work/shell-token"
    on=0; [ "$mode" = on ] && on=1
    docker network create "$net" >/dev/null
    docker run -d --name wizbb-hermes --network "$net" --network-alias hermes \
      -v "$fx/fake-hermes.mjs:/fake-hermes.mjs:ro" --entrypoint node "$svc" /fake-hermes.mjs >/dev/null
    docker run -d --name wizbb-as --network "$net" --network-alias wizard-agent-service \
      -v "$work/state:/state" -v "$work/shell-token:/run/wizard/shell-token:ro" \
      -e WIZARD_HERMES_API_KEY=boundary-box -e HERMES_ORIGIN=http://hermes:8642 -e WIZARD_AUTH_MODE=none \
      -e WIZARD_BROWSER_BOUNDARY=$on -e WIZARD_SHELL_TOKEN_FILE=/run/wizard/shell-token \
      -e WIZARD_APPS_JSON_PATH=/state/apps.json "$svc" >/dev/null
    docker run -d --name wizbb-shell --network "$net" --network-alias shell \
      -v "$work/shell-token:/run/wizard/shell-token:ro" \
      -e WIZARD_BROWSER_BOUNDARY=$on -e WIZARD_SHELL_TOKEN_FILE=/run/wizard/shell-token "$shell" >/dev/null
    docker run -d --name wizbb-hostile --network "$net" --network-alias hostile \
      -v "$fx/hostile:/usr/share/nginx/html/hostile:ro" nginx:1.28-alpine >/dev/null
    docker run -d --name wizbb-front --network "$net" -p "127.0.0.1:$port:8080" \
      -v "$fx/front.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.28-alpine >/dev/null
    i=0
    until curl -fsS "http://127.0.0.1:$port/shell-health" >/dev/null 2>&1 && curl -sS -o /dev/null "http://127.0.0.1:$port/wizard/health" 2>/dev/null \
      && [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/wizard/health")" != 502 ]; do
      i=$((i + 1)); [ $i -gt 60 ] && { echo "box did not start" >&2; for n in $names; do docker logs --tail 20 "$n" >&2 || true; done; exit 1; }
      sleep 1
    done
    printf '%s\n' "$work/shell-token" > "${TMPDIR:-/tmp}/wizbb-token-path"
    echo "box up: http://127.0.0.1:$port (boundary $mode)"
    ;;
  log) docker exec wizbb-front cat /var/log/nginx/probe.log ;;
  hermes) docker logs wizbb-hermes 2>/dev/null ;;
  down)
    for n in $names; do docker rm -f "$n" >/dev/null 2>&1 || true; done
    docker network rm "$net" >/dev/null 2>&1 || true
    ;;
  *) sed -n '2,6p' "$0"; exit 2 ;;
esac
