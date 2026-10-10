"""Showcase page for the sigil set: hero grid, true-size test, and the rule. Reads the built sigils."""
import json, os, re, sys, html
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
lib = json.load(open(os.path.join(ROOT, 'tools', 'sigils', 'sigils.json')))
js = open(os.path.join(ROOT, 'web', 'core', 'sigils.js')).read()
HOUSE = json.loads(re.search(r'const HOUSE = (\{.*?\});', js).group(1))
css = open(os.path.join(ROOT, 'web', 'core', 'sigils.css')).read()

NAMES = {'wizard': 'Chats', 'wizard-signal': 'Signal', 'wizard-search': 'Search', 'wisdom': 'Wisdom', 'wizard-music': 'Music',
         'shopping': 'Shopping', 'mizel': 'Mizel', 'topics': 'Topics', 'projects': 'Projects', 'calendar': 'Calendar',
         'trackhunt': 'TrackHunt', 'cinequeue': 'CineQueue', 'social': 'Social', 'files': 'Files', 'iching': 'I Ching',
         'console': 'Console', 'legacy-wizard': 'Legacy', 'android-apps': 'Android', 'v-day': 'Day', 'v-week': 'Week',
         'v-month': 'Month', 'v-inbox': 'Inbox', 'usuals': 'Usuals', 'side-button': 'Side button', 'maps': 'Maps'}
ORDER = ['wizard', 'wizard-signal', 'wizard-search', 'wisdom', 'wizard-music', 'shopping', 'mizel', 'topics', 'projects',
         'calendar', 'trackhunt', 'cinequeue', 'social', 'files', 'iching', 'console', 'legacy-wizard', 'android-apps',
         'v-day', 'v-week', 'v-month', 'v-inbox', 'usuals', 'side-button']

def tile(app, size, cls=''):
    g, c = HOUSE[app]
    return f'<span class="sgt {cls}" style="--c:{c};width:{size}px;height:{size}px;border-radius:{size*.32:.1f}px"><i class="sgi sg-{g}"></i></span>'

hero = ''.join(f'<figure>{tile(a, 96, "big")}<figcaption>{NAMES[a]}</figcaption></figure>' for a in ORDER)
cards = ''.join(
    f'<div class="card">{tile(a, 64)}<div><div class="nm">{NAMES[a]} <code>{HOUSE[a][1]}</code></div><p>{html.escape(lib[HOUSE[a][0]]["desc"])}</p></div></div>'
    for a in ORDER)
sizes = ''.join(f'<div class="sz"><span>{s}px</span>' + ''.join(tile(a, s, 'flat') for a in ORDER) + '</div>' for s in (20, 24, 32, 44, 58))
bare = ''.join(f'<span class="bare" style="--c:{HOUSE[a][1]}"><i class="sgi sg-{HOUSE[a][0]}"></i></span>' for a in ORDER)

page = f'''<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta name=color-scheme content=dark><meta name=robots content="noindex,nofollow"><title>Wizard OS · app sigils</title>
<style>
{css}
:root{{--bg:#08070c;--card:#110e18;--line:#221e2d;--t:#ece8f6;--m:#9a93ae}}
*{{box-sizing:border-box}}html,body{{margin:0;background:var(--bg);color:var(--t);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}}
body{{max-width:1100px;margin:0 auto;padding:28px 18px 80px}}
.eyebrow{{color:var(--m);font-size:12px;letter-spacing:.16em;text-transform:uppercase}}
h1{{font-size:clamp(34px,6vw,60px);line-height:1.02;margin:.2em 0 .3em;font-weight:680;letter-spacing:-.025em}}
h2{{font-size:20px;margin:56px 0 8px;letter-spacing:-.01em}}
p{{color:#c9c3d9;line-height:1.55;margin:.3em 0}}.lede{{font-size:17px;max-width:680px}}
.hero{{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:26px 8px;margin:34px 0 0}}
figure{{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}}figcaption{{font-size:12.5px;color:#cfc8e2}}
.sgt.big{{animation:sgRise 520ms cubic-bezier(.2,.9,.2,1.1) both}}
.hero figure:nth-child(n){{animation-delay:calc(var(--n,0)*20ms)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;margin-top:14px}}
.card{{display:flex;gap:16px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px}}
.card .nm{{font-weight:650;margin-bottom:3px}}.card code{{color:var(--m);font-size:12px;margin-left:6px;font-weight:500}}.card p{{font-size:13.5px}}
.sz{{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}}.sz>span:first-child{{width:46px;font-size:12px;color:var(--m)}}
.sgt.flat::before{{display:none}}
.bare{{display:inline-block;width:40px;height:40px;margin:6px}}.bare .sgi{{width:100%;height:100%;filter:none}}
.rule{{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;margin-top:14px}}
.rule div{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}}.rule b{{display:block;margin-bottom:4px}}
.phone{{width:360px;max-width:100%;margin:22px auto 0;border-radius:44px;padding:46px 18px 22px;background:radial-gradient(120% 60% at 50% 0%,#1d1338 0%,#0b0912 62%);border:1px solid #2a2440;box-shadow:0 30px 80px #000a}}
.pg{{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 4px}}.pg figcaption{{font-size:11px}}
foot{{display:block;margin-top:60px;color:var(--m);font-size:12px}}
</style></head><body>
<div class=eyebrow>Wizard OS · App icons · v1</div>
<h1>One silhouette.<br>One bite. One colour.</h1>
<p class=lede>Every app in Wizard now wears a sigil: a single solid shape with its second meaning cut out of it. Each app has its own hue, set at the same perceived brightness so none shouts over another. The tile stays dark glass, and the glyph lights it.</p>
<div class=hero>{hero}</div>
<h2>The rule</h2>
<div class=rule>
<div><b>Silhouette</b><p>One solid shape on a 512 grid, sized by its optical area so a disc and a tall mic look the same weight.</p></div>
<div><b>Bite</b><p>The second meaning, cut out as negative space: the hat in Chats, the flame in Wisdom, the spark in Shopping, the door in Files.</p></div>
<div><b>Colour</b><p>One hue per app, spaced round the wheel at equal OKLCH lightness. System tools (Console, I Ching, Legacy) stay muted.</p></div>
<div><b>Tile</b><p>Dark glass tinted by the app's hue, a soft bloom behind the glyph, a sheen across the top. The glyph carries the colour.</p></div>
</div>
<h2>On the phone</h2>
<div class=phone><div class=pg>{''.join(f'<figure>{tile(a, 58)}<figcaption>{NAMES[a]}</figcaption></figure>' for a in ORDER[:20])}</div></div>
<h2>Every sigil</h2>
<div class=grid>{cards}</div>
<h2>Size test</h2>
<p>True pixel sizes. The title bar uses 18–22px, the palette 24px, search rows 40px, the launcher 58px.</p>
{sizes}
<h2>Bare glyphs</h2>
<p>Untiled, for favicons, the menu bar and notification icons.</p>
<div>{bare}</div>
<foot>Generated from <code>tools/sigils/glyphs.py</code> in wizard-ux (feature/app-sigils). Shapes are boolean path ops (skia-pathops) compiled to one path per glyph.</foot>
</body></html>'''
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'sigils', 'showcase.html')
open(out, 'w').write(page)
print(out, len(page))
