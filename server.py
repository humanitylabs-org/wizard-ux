#!/usr/bin/env python3
"""Wizard OS Home prototype server.

Serves the static prototype and two small endpoints:
  POST /api/transcribe  -> Wizard Voice Core (wizard-stt, Tinfoil-attested Voxtral)
  POST /api/route       -> DeepSeek V4.1 Flash via the local Tinfoil proxy; returns a command JSON

Loopback only. Same-origin POSTs only. No state is written; agent-route requests are never delivered.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "web"
PORT = int(os.environ.get("WIZARD_OS_HOME_PORT", "9271"))
STT_URL = os.environ.get("WIZARD_STT_URL", "http://127.0.0.1:8864/v1/audio/transcriptions")
LLM_URL = os.environ.get("TINFOIL_PROXY_URL", "http://127.0.0.1:3301/v1/chat/completions")
ROUTER_MODEL = os.environ.get("WIZARD_OS_ROUTER_MODEL", "deepseek-v4-1-flash")
ALLOWED_ORIGINS = {"https://wizard.tailc0f369.ts.net", "http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT}
MAX_AUDIO = 24 * 1024 * 1024


def _tinfoil_key() -> str:
    key = os.environ.get("TINFOIL_API_KEY", "")
    if key:
        return key
    env = Path.home() / ".hermes" / ".env"
    try:
        for line in env.read_text().splitlines():
            if line.startswith("TINFOIL_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


ROUTER_SYSTEM = """You are the command router inside Wizard OS, a voice-first phone shell.
Classify ONE spoken utterance and reply with ONLY one compact JSON object, no prose.

If it is a direct phone/UI command, reply {"route":"command","action":ACTION,...args}. Actions:
- open_app {"app": name}            open a Wizard app or Android app by name
- open_view {"view": "day"|"week"|"month"|"inbox"|"apps", "date": "YYYY-MM-DD" optional}
- zoom {"dir": "in"|"out"}
- desk {"to": "next"|"prev"|"home"|1-5}
- maps_directions {"destination": text}
- maps_search {"query": text}
- play_music {"query": text}
- clear_desk {}
- close_window {}                    close the window in front
- fullscreen {"on": true|false}     make the window in front fill the screen, or tile it again
- move_window {"to": "next"|"prev"|1-5}
- search {"query": text}
If it needs reasoning, memory, writing, research, decisions, or a conversation with the agent, reply {"route":"agent","summary": short restatement}.
If it opens an app AND asks for follow-up work inside it ("open CineQueue and add Dune"), reply
{"route":"command","action":"open_app","app":name,"then_agent": the follow-up as a short request}.

Known Wizard apps: %s.
Known Android apps: Maps, Camera, Phone, Messages, Spotify, Chrome, Grab, LINE, Telegram, Settings.
Today is %s (Asia/Bangkok). Resolve "yesterday", weekdays, and "last week" to dates when asked for a day view.
The user lives in Bangkok. Speech-to-text often mangles local names: map near-misses to the real place
(e.g. "Iconium"/"icon siam" -> "ICONSIAM", "Suvarnapoom" -> "Suvarnabhumi Airport"). Return the corrected name.
"""


class Handler(SimpleHTTPRequestHandler):
    server_version = "WizardOSHome/0.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):  # quiet, but keep errors visible in journal
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; "
            "form-action 'self'; frame-ancestors 'none'",
        )
        self.send_header("Permissions-Policy", "microphone=(self)")
        super().end_headers()

    # Static only: no directory listings, no dotfiles.
    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_GET(self):
        if "/." in self.path:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if self.path.split("?")[0] == "/api/health":
            return self._json(200, {"ok": True, "router_model": ROUTER_MODEL})
        return super().do_GET()

    def do_POST(self):
        origin = self.headers.get("Origin", "")
        if origin not in ALLOWED_ORIGINS:
            return self._json(403, {"error": "origin"})
        path = self.path.split("?")[0]
        if path == "/api/transcribe":
            return self._transcribe()
        if path == "/api/route":
            return self._route()
        return self._json(404, {"error": "not found"})

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > limit:
            return None
        return self.rfile.read(n)

    def _transcribe(self):
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return self._json(400, {"error": "multipart required"})
        body = self._body(MAX_AUDIO)
        if body is None:
            return self._json(413, {"error": "audio missing or too large"})
        t0 = time.monotonic()
        req = urllib.request.Request(STT_URL, data=body, method="POST", headers={"Content-Type": ctype})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode("utf-8", "replace")
            return self._json(e.code if e.code in (400, 413, 422) else 502, {"error": detail})
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)[:200]})
        return self._json(200, {
            "text": data.get("text", ""),
            "model": data.get("model"),
            "ms": int((time.monotonic() - t0) * 1000),
        })

    def _route(self):
        body = self._body(8192)
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "json"})
        text = str(payload.get("text", ""))[:600].strip()
        apps = [str(a)[:40] for a in (payload.get("apps") or [])][:60]
        force = payload.get("force") == "command"
        if not text:
            return self._json(400, {"error": "empty"})
        key = _tinfoil_key()
        if not key:
            return self._json(503, {"error": "router unavailable"})
        today = time.strftime("%Y-%m-%d (%A)", time.gmtime(time.time() + 7 * 3600))
        system = ROUTER_SYSTEM % (", ".join(apps) or "Wizard", today)
        if force:
            system += "\nThe user held the orb for COMMAND mode: prefer a command; use agent only if no command fits."
        view = payload.get("view") if isinstance(payload.get("view"), dict) else None
        if view and not force:
            vname = str(view.get("name", ""))[:80].replace("\n", " ")
            vkind = str(view.get("kind", ""))[:40].replace("\n", " ")
            system += (
                f"\n\nCONTEXT: the window in front is {vname!r} ({vkind}). The user may be talking TO that window."
                "\nReply {\"route\":\"view\"} when the utterance continues or answers what is on that window:"
                " confirmations and refusals (\"yes\", \"go ahead\", \"do it\", \"no, wait\"), corrections,"
                " follow-ups that use \"this\", \"that\", \"it\", or refer to its topic, and replies to a question it asked."
                "\nKeep {\"route\":\"command\"} for phone/UI commands (open/close apps, desks, maps, music, zoom)."
                "\nUse {\"route\":\"agent\"} only for a NEW request clearly unrelated to that window."
                "\nExamples with a chat thread in front: \"Yes go ahead with that\" -> view; \"Make the headline shorter\" -> view;"
                " \"Open CineQueue\" -> command; \"What's the weather tomorrow\" -> agent."
            )
        req_body = {
            "model": ROUTER_MODEL,
            "temperature": 0,
            "max_tokens": 400,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}],
        }
        t0 = time.monotonic()
        req = urllib.request.Request(
            LLM_URL,
            data=json.dumps(req_body).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            content = data["choices"][0]["message"].get("content") or ""
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)[:200]})
        ms = int((time.monotonic() - t0) * 1000)
        m = re.search(r"\{.*\}", content, re.S)
        try:
            cmd = json.loads(m.group(0)) if m else {}
        except json.JSONDecodeError:
            cmd = {}
        if cmd.get("route") == "view" and not (view and not force):
            cmd = {"route": "agent", "summary": text}
        if cmd.get("route") not in ("command", "agent", "view"):
            cmd = {"route": "agent", "summary": text}
        return self._json(200, {"cmd": cmd, "ms": ms, "model": ROUTER_MODEL})


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"wizard-os-home on 127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
