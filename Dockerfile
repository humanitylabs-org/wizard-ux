# Wizard shell: the phone and desktop Wizard UX (web/), served by nginx, with every API path passed to the
# Wizard Agent Service (its own container and app). Android/Mac native wrappers load this same surface.
FROM nginx:1.28-alpine
# Read-only registry-backed PWA manifests, supervised with nginx.
RUN apk add --no-cache python3
COPY packaging/app-install.py packaging/shell-processes.py /etc/wizard-shell/
COPY web /usr/share/nginx/wizard-ux
# Stamp each script/stylesheet link with its file's hash so a phone never mixes cached files from two releases.
COPY tools/stamp-assets.sh /tmp/stamp-assets.sh
RUN sh /tmp/stamp-assets.sh /usr/share/nginx/wizard-ux && rm /tmp/stamp-assets.sh
# data.js / summaries.js are owner-generated (git- and docker-ignored) but index.html and desktop.html load them.
# Ship empty placeholders so a fresh box answers JavaScript instead of an HTML 404; never overwrite a real one.
RUN for f in /usr/share/nginx/wizard-ux/data.js /usr/share/nginx/wizard-ux/summaries.js; do [ -e "$f" ] || printf '// owner-generated at runtime; empty on a fresh box\n' > "$f"; done
COPY packaging/nginx.conf.template packaging/static.conf packaging/proxy.conf packaging/proxy-mcp.conf /etc/wizard-shell/
COPY packaging/entrypoint.sh /usr/local/bin/wizard-shell-entrypoint
COPY packaging/health.sh /usr/local/bin/wizard-shell-health
ENV WIZARD_AGENT_SERVICE_ORIGIN=http://wizard-agent-service:8787 WIZARD_SHELL_LISTEN=8788
USER 101:101
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s CMD ["/bin/sh", "/usr/local/bin/wizard-shell-health"]
ENTRYPOINT ["/bin/sh", "/usr/local/bin/wizard-shell-entrypoint"]
