"""Build web/core/sigils.css + web/core/sigils.js from the glyph library.

Sigils: one solid silhouette, one bite of negative space, one colour per app.
    python3 -m venv .venv && .venv/bin/pip install skia-pathops fonttools
    .venv/bin/python tools/sigils/build.py
Outputs are committed, so the shell needs no build step at runtime.

Colour: every app gets one hue at the same perceived lightness (OKLCH), so no tile shouts over
another. `HOUSE` is the default set for the Wizard OS apps; an owner overrides one in
launcher.json with `"icon": "<glyph name>"` and `"colors": ["#hex"]`.
"""
import json, math, os, sys, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import glyphs  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

# ---------- colour ----------
def oklch_to_lin(L, C, h):
    a = C * math.cos(math.radians(h)); b = C * math.sin(math.radians(h))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)

def hexof(L, C, h):
    while C > 0 and not all(-1e-4 <= c <= 1 + 1e-4 for c in oklch_to_lin(L, C, h)): C -= 0.002
    enc = lambda c: round(255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))
    return '#%02X%02X%02X' % tuple(enc(min(max(c, 0), 1)) for c in oklch_to_lin(L, C, h))

L_MAIN, C_MAIN = 0.79, 0.18
def tone(h, c=None):
    c = C_MAIN if c is None else c
    # yellows and greens read darker at equal L; blues read brighter
    L = L_MAIN + (0.06 if 70 <= h <= 135 else 0) - (0.02 if 235 <= h <= 285 else 0)
    return hexof(L, c, h)

# id: (glyph, hue, chroma or None for vivid). The vivid apps sit ~24° apart round the wheel;
# the quiet ones (system, legacy, tools) keep their hue at low chroma.
HOUSE = {
    'calendar':      ('calendar', 8,   None),
    'mizel':         ('mic',      30,  None),
    'shopping':      ('bag',      55,  None),
    'wisdom':        ('wisdom',   78,  None),
    'cinequeue':     ('cine',     100, None),
    'trackhunt':     ('track',    128, None),
    'android-apps':  ('android',  150, None),
    'topics':        ('eye',      178, None),
    'messenger':     ('chats',    191, None),
    'wizard-signal': ('signal',   205, None),
    'meditation':    ('meditate', 218, None),
    'files':         ('files',    232, None),
    'wizard-search': ('search',   256, None),
    'projects':      ('projects', 276, None),
    'wizard':        ('hat',      296, None),
    'social':        ('social',   322, None),
    'wizard-music':  ('music',    344, None),
    'iching':        ('iching',   75,  0.06),
    'console':       ('console',  250, 0.025),
    'legacy-wizard': ('wizard',   296, 0.05),
    'v-day':         ('day',      48,  None),
    'v-week':        ('week',     310, None),
    'v-month':       ('month',    262, 0.08),
    'v-inbox':       ('inbox',    166, None),
    'usuals':        ('usuals',   42,  None),
    'side-button':   ('side',     300, 0.07),
    'maps':          ('pin',      114, None),
    'app-store':     ('apps',     284, None),
    'system':        ('gauge',    200, 0.07),
    'notifications': ('bell',     70,  None),
    'morning-report':('coffee',   46,  None),
    'wizard-calendar':('calendar', 8,  None),
    'secret-drop':   ('secret',   190, None),
    'browser':       ('globe',    220, None),
    'transcriber':   ('wave',     330, None),
    'wizard-chatgpt':('spark',    160, None),
    'wizard-claude': ('burst',    32,  None),
    'wizard-agent-service': ('hub', 250, 0.09),
    'wizard-tinfoil':('shield',   228, 0.04),
    'wizard-cloudflare':('cloud', 62,  None),
    'wizard-shopping':('bag',     55,  None),
    'sniper':        ('scope',    4,   0.12),
    'card-benefits': ('card',     145, None),
    'money':         ('dollar',   152, 0.13),
    'profiles':      ('profile',  296, None),
    'defleur-video': ('clip',     268, None),
    'troubleshooter':('wrench',   186, 0.08),
    'wizard-ux':     ('wizard',   280, 0.09),
    # Agents (the app): two layered hats drawn from brand masks in style.css; its tile glass is a quiet periwinkle,
    # neither the main agent's purple nor the private agent's green, so both hats read on it.
    'agents':        ('agents',   270, 0.10),
}
# Brand-mask sigils: drawn from web/brand/*.png in style.css, not from glyphs.py.
#   hat          supplied company hat (Chats, main agent)
#   hat-private  tools/sigils/private_hat.py: the hat with a keyhole for its door
#   agents       tools/sigils/agent_hats.py: two layered hats, private green behind main purple
MASKS = ('hat', 'hat-private', 'agents')
# Real products wear their own brand mark (web/brand/apps/<mark>.svg; sources in tools/sigils/README.md, "Brand marks").
# html() adds `sgb sgb-<mark>` next to the house glyph; a skin opts in by styling .sgb-<mark> (Miguel's skins do, in
# web/skins/*/skin.css), so any other skin still shows the house glyph unchanged.
BRAND = {
    'wizard-cloudflare': 'cloudflare',
    'wizard-claude':     'claude',
    'wizard-chatgpt':    'chatgpt',
    'wizard-tinfoil':    'tinfoil',
    'hermes-agent':      'hermes',
    'hermes-frontend-3': 'hermes',
}
# Apps with no sigil yet get their initial on a hue picked from their id.
FALLBACK_HUES = [20, 66, 112, 158, 196, 230, 268, 300, 334]

def mask_url(d):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="{d}"/></svg>'
    return "url('data:image/svg+xml," + urllib.parse.quote(svg, safe=' /:=,.-') + "')"

def main():
    lib = glyphs.build()
    css = ['/* Wizard OS sigils: generated by tools/sigils/build.py; edit glyphs.py, then rebuild. */']
    for name, g in lib.items():
        css.append(f'.sg-{name}{{--sg:{mask_url(g["d"])}}}')
    out_css = os.path.join(ROOT, 'web', 'core', 'sigils.css')
    style = open(os.path.join(HERE, 'style.css')).read()
    open(out_css, 'w').write(style.rstrip() + '\n\n' + '\n'.join(css) + '\n')

    house = {k: [g, tone(h, c)] for k, (g, h, c) in HOUSE.items()}
    for k, (g, _, _) in HOUSE.items():
        assert g in lib or g in MASKS, (k, g)
    js = open(os.path.join(HERE, 'sigils.template.js')).read()
    js = js.replace('/*NAMES*/', json.dumps(sorted(lib.keys())))
    js = js.replace('/*HOUSE*/', json.dumps(house, separators=(',', ':')))
    js = js.replace('/*BRAND*/', json.dumps(BRAND, separators=(',', ':')))
    for k, m in BRAND.items():
        assert os.path.exists(os.path.join(ROOT, 'web', 'brand', 'apps', m + '.svg')), (k, m)
    js = js.replace('/*FALLBACK*/', json.dumps([tone(h) for h in FALLBACK_HUES]))
    open(os.path.join(ROOT, 'web', 'core', 'sigils.js'), 'w').write(js)
    json.dump({k: dict(d=v['d'], desc=v['desc']) for k, v in lib.items()},
              open(os.path.join(HERE, 'sigils.json'), 'w'), indent=1)
    print('glyphs', len(lib), 'css', os.path.getsize(out_css), 'bytes')
    for k, v in house.items(): print(f'  {k:14s} {v[0]:9s} {v[1]}')

if __name__ == '__main__':
    main()
