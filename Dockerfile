# Wizard Shell: existing phone/desktop web UX plus same-origin API pass-through.
# Android/Mac native bridge sources and packaging remain unchanged.
FROM nginx:1.28-alpine
COPY web /usr/share/nginx/wizard-ux
COPY packaging/nginx.conf.template /etc/wizard-shell/nginx.conf.template
COPY packaging/entrypoint.sh /usr/local/bin/wizard-shell-entrypoint
ENV WIZARD_AGENT_SERVICE_ORIGIN=http://wizard-agent-service:8787
USER 101:101
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s CMD wget -qO- http://127.0.0.1:8788/shell-health >/dev/null || exit 1
ENTRYPOINT ["/bin/sh", "/usr/local/bin/wizard-shell-entrypoint"]
