#!/usr/bin/env python3
"""Build the Wizard OS Home prototype's review data from real Hermes thread metadata.

Read-only against state.db. Emits data.js with Oct 1-8 (Bangkok) threads grouped by
project, plus short first-user / first-assistant excerpts for the transcript level.
"""
import datetime, json, re, sqlite3, sys
from pathlib import Path

TZ = datetime.timezone(datetime.timedelta(hours=7))
OUT = Path(__file__).resolve().parent.parent / "web" / "data.js"
START = datetime.datetime(2026, 9, 14, tzinfo=TZ)
EXCERPT_FROM = datetime.datetime(2026, 10, 1, tzinfo=TZ)
END = datetime.datetime(2026, 10, 9, tzinfo=TZ)

EXCLUDE = re.compile(r"vault|secret|equity|stripe|coupon|unfollow|kyc|apify|redacted|token|password|credential|visa", re.I)

PROJECTS = [
    ("wizard-os", "Wizard OS", r"wizard ?os|launcher|\bvm\b|space agent|agent zero|container|grapheneos|omar|triomarch|cli vs mcp|qvac|beelink|wizard one|headscale|x project|dot and compare|plugins|desktop architecture"),
    ("mizel", "Mizel.ai", r"mizel|jev|granola"),
    ("clips", "TSR & Clips", r"clip|shorts|podcast|tsr|video editing|mckenna|tuk-tuk|storyboard|remix|direct-to-viewer|film"),
    ("signal", "Wizard Signal", r"signal|venkatesh|youtube creator|dhh|newsletter|reddit|post|article|0xmovez|feed|bio|instagram|homebrew"),
    ("wizard-app", "Wizard app", r"wizard|archimedes|thread|recording|screenshot|viewport|approval|sending|desktop package|update flow|helm|transcription chunk|prompts|chat history|default model"),
    ("music", "Music", r"suno|track|blade runner"),
    ("wisdom", "Wisdom & practice", r"meditation|philosoph|jung|diamond|past life|reflection|wisdom|myth|dapel|taft|brown|syntropic|cannabis|childhood|core idea|profiles of the future|player of games|decisions|lessons"),
    ("business", "Business & team", r"funding|jan\b|miguel|schramko|license|credits|patron|provider|agency|ownership|manufacturing|partnership|polis|ai profitability|paper trading"),
    ("infra", "Infrastructure", r"connector|opus|migrate|domains|memories|tailscale|email|routing|502|firecrawl|socialdata"),
]
CALL = re.compile(r"meeting|transcript|conversation|call\b|transcribe", re.I)
PEOPLE = {
    "Miguel": r"miguel", "Jan": r"\bjan\b", "Robert": r"robert", "Venkatesh Rao": r"venkatesh",
    "DHH": r"dhh", "James Schramko": r"schramko", "Jonathan": r"jonathan", "Thales": r"thales",
    "Terence McKenna": r"mckenna",
}


def clean(text, n):
    if not text:
        return ""
    text = re.sub(r"<memory-context>.*?</memory-context>", "", text, flags=re.S)
    text = re.sub(r"\[WIZARD_FILES_V1\].*?\[/WIZARD_FILES_V1\]", "", text, flags=re.S)
    text = re.sub(r"\[Browser dogfooding policy.*", "", text, flags=re.S)
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"[#*_`>|]+", "", text)
    text = re.sub(r"https?://\S+", "[link]", text)
    text = re.sub(r"\b[A-Za-z0-9_\-]{32,}\b", "…", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > n:
        text = text[:n].rsplit(" ", 1)[0] + "…"
    return text


def project_of(title):
    for key, _name, pat in PROJECTS:
        if re.search(pat, title, re.I):
            return key
    return "life"


def main():
    db = sqlite3.connect("file:/home/telos/.hermes/state.db?mode=ro", uri=True)
    rows = db.execute(
        """select id, started_at, title, source, message_count from sessions
           where started_at>=? and started_at<? and title is not null and coalesce(hidden,0)=0
             and source in ('api_server','telegram') and parent_session_id is null
           order by started_at""",
        (START.timestamp(), END.timestamp()),
    ).fetchall()
    threads = []
    for sid, ts, title, source, count in rows:
        if EXCLUDE.search(title) or (count or 0) < 4:
            continue
        msgs = []
        if ts >= EXCERPT_FROM.timestamp():
            msgs = db.execute(
                """select role, content from messages where session_id=? and role in ('user','assistant')
                   and content is not null and length(trim(content))>0 order by id limit 6""",
                (sid,),
            ).fetchall()
        first_user = next((m[1] for m in msgs if m[0] == "user"), "")
        first_asst = next((m[1] for m in msgs if m[0] == "assistant"), "")
        if EXCLUDE.search(first_user[:400]):
            first_user = ""
        d = datetime.datetime.fromtimestamp(ts, TZ)
        people = [p for p, pat in PEOPLE.items() if re.search(pat, title + " " + first_user[:600], re.I)]
        threads.append({
            "id": sid[-10:],
            "t": d.strftime("%H:%M"),
            "day": d.strftime("%Y-%m-%d"),
            "title": title,
            "src": "Telegram" if source == "telegram" else "Wizard",
            "n": count,
            "p": project_of(title),
            "call": bool(CALL.search(title)),
            "people": people,
            "u": clean(first_user, 340),
            "a": clean(first_asst, 340),
        })
    data = {
        "generated": datetime.datetime.now(TZ).isoformat(timespec="minutes"),
        "projects": {k: n for k, n, _ in PROJECTS} | {"life": "Life & curiosity"},
        "threads": threads,
    }
    OUT.write_text("window.WIZ_DATA=" + json.dumps(data, ensure_ascii=False) + ";\n")
    print(f"wrote {OUT} threads={len(threads)}", file=sys.stderr)
    from collections import Counter
    print(Counter((t["day"], t["p"]) for t in threads), file=sys.stderr)


if __name__ == "__main__":
    main()
