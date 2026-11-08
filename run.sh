#!/bin/sh
export QA_PLAYWRIGHT=/srv/work/provider-signin-browser/node_modules/playwright QA_CHROME=/home/james/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome QA_TREE=/srv/work/chat-pin-routed-0909 TMPDIR=/srv/work/chat-pin-routed-0909/tmp
mkdir -p /srv/work/chat-pin-routed-0909/tmp
for i in 1 2 3; do QA_OUT=/srv/work/chat-pin-routed-0909/out$i node qa-chat-pin-menu.cjs > /srv/work/chat-pin-routed-0909/run$i.log 2>&1 || { tail -30 /srv/work/chat-pin-routed-0909/run$i.log; exit 1; }; tail -1 /srv/work/chat-pin-routed-0909/run$i.log; done
