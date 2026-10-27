#!/usr/bin/env python3
"""Real shared Settings UI, two skins × phone/desktop, with an explicit WAM API fixture."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright


HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/core/base.css"><link rel="stylesheet" href="/core/skins.css"><link rel="stylesheet" href="/skins/sepia/skin.css"><link rel="stylesheet" href="/core/settings.css">
<style>body{margin:0;background:var(--bg,#151519);color:var(--ink,#eee);font-family:system-ui}#settings{height:100vh}</style>
<script src="/core/skins.js" defer></script><script>window.WizCore={};</script><script src="/core/settings.js"></script><script src="/core/os-updates.js"></script>
</head><body><main id="settings"></main></body></html>'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    web = Path(__file__).resolve().parents[1] / "web"
    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/release-qa.html":
                self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(HTML.encode())
            else:
                super().do_GET()
        def log_message(self, format, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(web)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            for skin in ("nebula", "sepia"):
                for shell, width, height in (("phone", 390, 844), ("desktop", 1280, 900)):
                    state = {"developer": False, "posts": []}
                    page = browser.new_page(viewport={"width": width, "height": height})
                    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
                    def api(route):
                        if route.request.method == "POST":
                            doc = route.request.post_data_json
                            state["posts"].append(doc)
                            state["developer"] = doc.get("developer_mode", state["developer"])
                        route.fulfill(json={"developer_mode": state["developer"], "mode": "ask", "chosen": True,
                            "channel": "main", "installed": "12345678", "latest": "abcdef12", "update_available": False,
                            "checked": True, "release": {"name": "Developer release", "base": "abcdef12", "behind": 0,
                            "new": [], "building": False, "failed": None, "staging": {"image": "qa:staged"},
                            "held": [{"title": "Feature waiting for go"}], "resolver_merges": []}})
                    page.route("**/store-install/_updates", api)
                    page.route("**/my-release.json", lambda route: route.fulfill(json={"name": "Developer release", "base": {"ref": "abcdef12", "label": "Main abcdef12"}, "build": "12345678", "changes": [{"sha": "1" * 40, "title": "Proposed change", "status": "proposed", "pr": "https://github.com/example/wizard-ux/pull/1"}, {"sha": "2" * 40, "title": "Owner change", "status": "mine"}]}))
                    page.goto(f"http://127.0.0.1:{server.server_port}/release-qa.html")
                    page.wait_for_function("window.WosUpdates?.state")
                    page.evaluate("""({skin,shell})=>{
                      document.documentElement.dataset.shell=shell; WosSkin.set(skin);
                      window.qaSettings=WosSettings.mount(document.querySelector('#settings'), {shell, toast(){}, visible:()=>true});
                      qaSettings.focus('about');
                    }""", {"skin": skin, "shell": shell})
                    assert page.locator('[data-st-page="release"]').count() == 0
                    assert page.locator('[data-osu-release]').count() == 0
                    toggle = page.locator('[data-osu="developer"]')
                    assert toggle.get_attribute("aria-checked") == "false"
                    page.screenshot(path=str(a.out / f"{skin}-{shell}-off.png"), full_page=True)
                    toggle.click()
                    page.wait_for_function("window.WosUpdates?.developer === true && window.WosUpdates?.mine")
                    page.evaluate("qaSettings.focus('release')")
                    page.locator('[data-osu="mine"]').click()
                    assert page.locator('[data-osu="ch-main"]').count() == 1
                    assert page.get_by_text("Feature waiting for go", exact=True).count() == 1
                    assert page.locator('.rl-chip').all_text_contents() == ["Proposed", "Mine"]
                    page.screenshot(path=str(a.out / f"{skin}-{shell}-on.png"), full_page=True)
                    # Nested Back returns to Settings; it must not leave the page.
                    before = page.url
                    page.locator('[data-st-back]').click()
                    assert page.url == before
                    page.evaluate("qaSettings.focus('release')")
                    page.locator('[data-osu="developer"]').click()
                    page.wait_for_function("window.WosUpdates?.developer === false")
                    assert page.locator('[data-st-page="release"]').count() == 0
                    assert page.locator('[data-osu-release]').count() == 0
                    assert state["posts"] == [{"developer_mode": True}, {"developer_mode": False}]
                    assert not errors, errors
                    results.append({"skin": skin, "shell": shell, "pass": True, "back_keeps_page": True})
                    page.close()
            browser.close()
    finally:
        server.shutdown()
    (a.out / "browser-result.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results))


if __name__ == "__main__":
    main()
