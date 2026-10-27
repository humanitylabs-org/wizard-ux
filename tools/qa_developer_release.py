#!/usr/bin/env python3
"""Real phone/desktop shells; fixture WAM API, no replacement Back handler.

Default acceptance: Nebula and Light × phone and desktop. --skin/--shell permit
short focused diagnostics. Screenshots and per-case results survive a later failure.
"""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--skin", choices=("nebula", "obsidian-light"))
    ap.add_argument("--shell", choices=("phone", "desktop"))
    a = ap.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    web = Path(__file__).resolve().parents[1] / "web"
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            return super().translate_path(path.replace("/wizard-os-home/", "/", 1))
        def log_message(self, format, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(web)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            for skin in ((a.skin,) if a.skin else ("nebula", "obsidian-light")):
                for shell, width, height in (("phone", 390, 844), ("desktop", 1280, 900)):
                    if a.shell and a.shell != shell:
                        continue
                    state = {"developer": False, "posts": []}
                    context = browser.new_context(viewport={"width": width, "height": height},
                        is_mobile=shell == "phone", has_touch=shell == "phone", service_workers="block",
                        **({"user_agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"} if shell == "phone" else {}))
                    context.add_init_script(f"localStorage.setItem('wos.coached','true');localStorage.setItem('wos.skin',{json.dumps(skin)});")
                    page = context.new_page()
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
                    # No private data or external service is consulted by these real shells.
                    page.route("**/wizard/**", lambda route: route.fulfill(json={"bootstrap": 1, "settings": {}, "apps": [], "sessions": [], "agents": []}))
                    page.goto(f"http://127.0.0.1:{server.server_port}/wizard-os-home/?shell={shell}")
                    page.wait_for_function("(window.__wos || window.__wux)?.openSettings && window.WosUpdates?.state")
                    page.wait_for_function("([shell,skin]) => document.documentElement.dataset.shell === shell && WosSkin.current === skin", arg=[shell, skin])
                    page.evaluate("(window.__wos || window.__wux).openSettings('about')")
                    root = page.locator('#settingsBody')
                    assert root.locator('[data-st-page="release"]').count() == 0
                    assert root.locator('[data-osu-release]').count() == 0
                    toggle = root.locator('[data-osu="developer"]')
                    assert toggle.get_attribute("aria-checked") == "false"
                    toggle.scroll_into_view_if_needed()
                    page.screenshot(path=str(a.out / f"{skin}-{shell}-off.png"))
                    toggle.click()
                    page.wait_for_function("window.WosUpdates?.developer === true && window.WosUpdates?.mine")
                    page.evaluate("(window.__wos || window.__wux).openSettings('release')")
                    root.locator('[data-osu="mine"]').click()
                    assert root.locator('[data-osu="ch-main"]').count() == 1
                    assert page.get_by_text("Feature waiting for go", exact=True).count() == 1
                    assert root.locator('.rl-chip').all_text_contents() == ["Proposed", "Mine"]
                    back = root.get_by_role("button", name="Back to Settings", exact=True)
                    back.scroll_into_view_if_needed()
                    assert back.is_visible()
                    box = back.bounding_box()
                    assert box["width"] >= 44 and box["height"] >= 44, box
                    page.screenshot(path=str(a.out / f"{skin}-{shell}-on.png"))
                    before = page.url
                    page.evaluate("window.qaDocument = document; window.qaBackDocument = document")
                    def at_settings_root():
                        page.wait_for_function("document.querySelector('#settingsBody').dataset.settingsPage === ''")
                        assert root.locator('.st-title').is_visible()
                        assert root.locator('[data-osu-release]').count() == 0
                        assert page.url == before
                        assert page.evaluate("document === window.qaDocument")
                    # A real visible pointer/touch target, never a forced/evaluated click.
                    back.click()
                    at_settings_root()
                    # Real browser history dispatches the production shell's popstate path.
                    root.locator('[data-st-page="release"]').click()
                    page.wait_for_function("document.querySelector('#settingsBody').dataset.settingsPage === 'release'")
                    page.evaluate("history.back()")
                    at_settings_root()
                    native_back = shell == "phone"
                    if native_back:
                        root.locator('[data-st-page="release"]').click()
                        page.evaluate("__wosNativeBack()")
                        at_settings_root()
                    page.screenshot(path=str(a.out / f"{skin}-{shell}-back.png"))
                    # Turning developer mode off removes the entry and release body again.
                    root.locator('[data-st-page="release"]').click()
                    root.locator('[data-osu="developer"]').click()
                    page.wait_for_function("window.WosUpdates?.developer === false")
                    assert root.locator('[data-st-page="release"]').count() == 0
                    assert root.locator('[data-osu-release]').count() == 0
                    assert state["posts"] == [{"developer_mode": True}, {"developer_mode": False}]
                    assert not errors, errors
                    results.append({"skin": skin, "shell": shell, "pass": True, "visible_back": True,
                        "browser_back_to_settings": True, "native_bridge_back_to_settings": native_back,
                        "same_document": True, "api": "fixture", "shell_code": "production"})
                    (a.out / "browser-result.json").write_text(json.dumps(results, indent=2) + "\n")
                    context.close()
            browser.close()
    finally:
        server.shutdown()
        (a.out / "browser-result.json").write_text(json.dumps(results, indent=2) + "\n")
    expected = (1 if a.skin else 2) * (1 if a.shell else 2)
    assert len(results) == expected, results
    print(json.dumps(results))


if __name__ == "__main__":
    main()
