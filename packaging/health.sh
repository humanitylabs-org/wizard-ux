#!/bin/sh
# Container health: the shell's own page only, so the shell stays up while the Agent Service restarts.
port="${WIZARD_SHELL_LISTEN:-8788}"; port="${port##*:}"
exec wget -qO- "http://127.0.0.1:${port}/shell-health" >/dev/null
