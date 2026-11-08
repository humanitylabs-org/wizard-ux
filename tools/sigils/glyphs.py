"""Wizard OS app sigils: one silhouette, one bite.
Every glyph is built from primitives with boolean path ops (skia-pathops), normalised onto a
512 grid and emitted as a single compound path, so the browser renders it with one <path>."""
import json, math, sys
import pathops
from pathops import Path, PathOp, LineCap, LineJoin
from fontTools.svgLib.path import parse_path
from fontTools.pens.svgPathPen import SVGPathPen

# ---------- primitives ----------
def P(d):
    p = Path(); parse_path(d, p.getPen()); return p

def circle(cx, cy, r):
    return P(f"M{cx-r} {cy} a{r} {r} 0 1 0 {2*r} 0 a{r} {r} 0 1 0 {-2*r} 0 Z")

def rrect(x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    return P(f"M{x+r} {y} H{x+w-r} A{r} {r} 0 0 1 {x+w} {y+r} V{y+h-r} A{r} {r} 0 0 1 {x+w-r} {y+h} H{x+r} A{r} {r} 0 0 1 {x} {y+h-r} V{y+r} A{r} {r} 0 0 1 {x+r} {y} Z")

def poly(*pts):
    return P("M" + " L".join(f"{x} {y}" for x, y in pts) + " Z")

def stroke(d_or_path, w, cap='round', join='round'):
    p = P(d_or_path) if isinstance(d_or_path, str) else Path(d_or_path)
    caps = {'round': LineCap.ROUND_CAP, 'butt': LineCap.BUTT_CAP, 'square': LineCap.SQUARE_CAP}
    joins = {'round': LineJoin.ROUND_JOIN, 'miter': LineJoin.MITER_JOIN, 'bevel': LineJoin.BEVEL_JOIN}
    p.stroke(w, caps[cap], joins[join], 4)
    p.convertConicsToQuads()
    return p

def U(*ps):
    out = ps[0]
    for p in ps[1:]: out = pathops.op(out, p, PathOp.UNION)
    return out

def D(a, *bs):
    for b in bs: a = pathops.op(a, b, PathOp.DIFFERENCE)
    return a

def I(a, b): return pathops.op(a, b, PathOp.INTERSECTION)

def T(p, s=1, tx=0, ty=0, sx=None, sy=None):
    sx = s if sx is None else sx; sy = s if sy is None else sy
    return p.transform(sx, 0, 0, sy, tx, ty)

def R(p, deg, cx, cy):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    # translate(cx,cy) rotate translate(-cx,-cy)
    return p.transform(c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy)

def bounds(p): return p.bounds  # (xmin, ymin, xmax, ymax)

HAT_SRC = "M154.8 364.7C177.3 300.0 220.4 174.9 222.3 168.8C228.1 150.2 231.2 127.4 229.6 114.3C228.0 101.3 224.9 94.3 217.8 87.6C212.3 82.4 211.4 80.9 212.5 78.2C214.2 74.3 222.5 74.5 232.2 78.7C245.6 84.5 258.3 99.2 271.1 123.7C284.9 150.1 297.7 185.7 354.4 354.7L372.3 408.0L328.3 408.0L284.4 408.0L284.2 381.7C284.0 351.7 283.8 350.7 276.6 343.6C273.7 340.7 258.7 329.9 257.6 329.9C256.7 329.9 244.7 338.2 241.2 341.3C231.1 350.2 230.8 351.2 230.8 382.5L230.8 408.0L185.3 408.0L139.7 408.0L154.8 364.7Z"  # newest WizardOS hat (Oct 16 slides, Oct 21 lockup), traced; door is a notch at the base
HAT_DOOR_BOX = (226.8, 325.9, 288.3)  # x0, y0 (above the arch apex), x1; the bottom is the base line y=408
HAT_WIDEN = 1.12   # Robert, 30 Oct 2026: every hat is drawn 12% wider than the logo, like the Wizard tile
def _widen(p): return T(p, 1, 256 - 256 * HAT_WIDEN, 0, sx=HAT_WIDEN, sy=1)
def hat_door():
    x0, y0, x1 = HAT_DOOR_BOX
    return _widen(D(P(f"M{x0} {y0} H{x1} V408 H{x0} Z"), P(HAT_SRC)))
def hat(): return U(_widen(P(HAT_SRC)), hat_door())
def door_at(cx, base_y, height):
    """The logo's own door (as widened), `height` tall, centred on cx, standing on base_y. Every door uses this."""
    d = hat_door(); x0, y0, x1, y1 = d.bounds; s = height / (y1 - y0)
    return T(d, s, cx - s * (x0 + x1) / 2, base_y - s * y1)
def taper(pts, half):
    """A Mail-style line: width follows `half` (half-width at each point), round ends, so 4-20-4 gives a line that
    swells in the middle and fades to soft points. The only kind of thin line the set uses."""
    out = None
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        L = math.hypot(x1 - x0, y1 - y0); nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        h0, h1 = half[i], half[i + 1]
        q = poly((x0 + nx * h0, y0 + ny * h0), (x1 + nx * h1, y1 + ny * h1), (x1 - nx * h1, y1 - ny * h1), (x0 - nx * h0, y0 - ny * h0))
        out = q if out is None else U(out, q)
    for (x, y), h in zip(pts, half): out = U(out, circle(x, y, h))
    return out
def bez(p0, p1, p2, p3, n=14):
    """Points along a cubic, for tapering a curved line."""
    pts = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        pts.append(tuple(u**3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t**3 * d for a, b, c, d in zip(p0, p1, p2, p3)))
    return pts
def hat_at(cx, base_y, height):
    """Hat scaled to `height`, centred on cx, base sitting on base_y."""
    s = height / (408 - 75)
    return T(hat(), s, cx - 256 * s, base_y - 408 * s)

def spark(cx, cy, r, k=0.12):
    q = r * k
    return P(f"M{cx} {cy-r} Q{cx+q} {cy-q} {cx+r} {cy} Q{cx+q} {cy+q} {cx} {cy+r} Q{cx-q} {cy+q} {cx-r} {cy} Q{cx-q} {cy-q} {cx} {cy-r} Z")

# ---------- glyphs ----------
G = {}
def glyph(name, desc, scale=1.0, dy=0):
    def deco(fn):
        G[name] = dict(fn=fn, desc=desc, scale=scale, dy=dy); return fn
    return deco

@glyph('pages', 'A page with its corner folded over and one line of writing: what your agent makes.')
def g_pages():
    # A clean dog-ear: the corner is cut on the diagonal, and the folded flap sits inside it, cut free of the page.
    page = D(rrect(150, 88, 230, 336, 28), poly((230, 28), (520, 28), (520, 318)))
    flap = poly((290, 88), (380, 178), (290, 178))
    page = D(page, U(flap, stroke(flap, 28)))
    return U(D(page, taper([(206, 312), (265, 312), (324, 312)], [5, 15, 5])), flap)

@glyph('pages-stack', 'Two pages, the front one cut free of the one behind: what your agent makes.')
def g_pages_stack():
    back, front = rrect(196, 72, 216, 288, 34), rrect(100, 152, 216, 288, 34)
    return U(D(back, U(front, stroke(front, 36))), front)

@glyph('pages-chart', 'A page with three rising bars cut out: the reports and dashboards your agent makes.')
def g_pages_chart():
    page = rrect(116, 80, 280, 352, 48)
    return D(page, rrect(170, 300, 44, 82, 14), rrect(234, 242, 44, 140, 14), rrect(298, 170, 44, 212, 14))

@glyph('wizard', 'The mother mark: the hat, with its door joined to the ground line.')
def g_wizard():
    return _widen(P(HAT_SRC))

@glyph('chats', 'A speech bubble with the hat cut out of it: you talking to your Wizard.')
def g_chats():
    bubble = U(rrect(84, 80, 344, 284, 96), P("M140 328 C138 370 124 400 104 422 C162 416 214 392 246 356 Z"))
    s = 216 / 333   # big enough that the hat and its door still read in a 22 px dock icon
    place = lambda p: T(p, s, 256 - 256 * s, 336 - 408 * s)
    return U(D(bubble, place(hat())), place(hat_door()))


@glyph('search', 'A lens with a spark in it: search that answers.')
def g_search():
    lens = U(circle(224, 224, 128), stroke("M300 300 L396 396", 70))
    return D(lens, spark(224, 224, 74, 0.13))

@glyph('wisdom', 'An open book with a flame burning at the spine: deep reading.')
def g_wisdom():
    L = P("M256 172 C214 136 152 124 92 132 L92 376 C152 368 214 380 256 408 Z")
    Rr = P("M256 172 C298 136 360 124 420 132 L420 376 C360 368 298 380 256 408 Z")
    book = U(L, Rr)
    flame = P("M256 186 C274 222 304 248 304 290 C304 322 282 344 256 344 C230 344 208 322 208 290 C208 256 240 236 256 186 Z")
    return D(book, flame, taper([(256, 332), (256, 376), (256, 420)], [4, 9, 9]))   # spine: a taper, not a slot

@glyph('track', 'A record in the crosshairs: hunting down the track.')
def g_track():
    disc = circle(256, 256, 156)
    ticks = U(rrect(242, 80, 28, 92, 14), rrect(242, 340, 28, 92, 14), rrect(80, 242, 92, 28, 14), rrect(340, 242, 92, 28, 14))
    groove = I(stroke(circle(256, 256, 96), 16), disc)
    return D(disc, ticks, groove, circle(256, 256, 26))


@glyph('mic', 'A microphone whose capsule is cut with three lines: record, transcribe, outline.')
def g_mic():
    cap = rrect(180, 84, 152, 240, 76)
    yoke = stroke("M128 252 A128 128 0 0 0 384 252", 32)
    stem = rrect(240, 372, 32, 40, 0)
    base = rrect(176, 400, 160, 30, 15)
    lines = U(rrect(214, 152, 84, 26, 13), rrect(214, 198, 84, 26, 13), rrect(214, 244, 52, 26, 13))
    return D(U(cap, yoke, stem, base), lines)


@glyph('projects', 'A board with three lanes hanging from the top, each at a different stage.')
def g_projects():
    board = rrect(96, 104, 320, 304, 64)
    lanes = U(rrect(140, 156, 64, 204, 22), rrect(224, 156, 64, 144, 22), rrect(308, 156, 64, 84, 22))
    return D(board, lanes)

@glyph('calendar', 'A calendar page hanging from its two rings: your days.')
def g_calendar():
    body = rrect(96, 128, 320, 284, 56)
    tabs = U(rrect(162, 84, 40, 88, 20), rrect(310, 84, 40, 88, 20))
    gap = U(rrect(150, 72, 64, 116, 32), rrect(298, 72, 64, 116, 32))
    # Robert, 30 Oct 2026: no box; the header line is a Mail-style taper, not a cut band.
    return U(D(body, gap, taper([(136, 222), (256, 222), (376, 222)], [5, 15, 5])), tabs)

@glyph('cine', 'A clapperboard with play cut into the slate: your watch queue.')
def g_cine():
    slate = rrect(104, 212, 304, 200, 40)
    bar = R(rrect(104, 132, 304, 60, 18), -11, 104, 192)
    stripes = U(*[R(rrect(x, 100, 30, 120, 0), 28, x + 15, 160) for x in (168, 248, 328)])
    bar = D(bar, I(stripes, bar))
    play = P("M226 262 L326 312 L226 362 Z")
    return U(D(slate, play), bar)


@glyph('files', 'A folder with the Wizard door cut into its base: your stuff lives in the Wizard\u2019s house.')
def g_files():
    # Landscape like a real folder (Robert, 30 Oct 2026: "not as tall"): 320 wide, 244 tall.
    folder = P("M128 136 H204 Q218 136 228 148 L252 172 H384 Q416 172 416 204 V348 Q416 380 384 380 H128 Q96 380 96 348 V168 Q96 136 128 136 Z")
    return D(folder, door_at(256, 388, 93))   # the logo's door, as tall as the old one
@glyph('iching', 'A casting coin with its square hole: cast and read.')
def g_iching():
    coin = circle(256, 256, 156)
    yang = lambda y: rrect(150, y, 212, 38, 12)
    yin = lambda y: U(rrect(150, y, 90, 38, 12), rrect(272, y, 90, 38, 12))
    return D(coin, yang(176), yin(237), yang(298))

@glyph('console', 'A terminal window with its prompt cut out.')
def g_console():
    win = rrect(88, 112, 336, 288, 52)
    prompt = U(stroke("M156 206 L214 256 L156 306", 38, 'round', 'round'), rrect(238, 286, 104, 38, 19))
    return D(win, prompt)

@glyph('android', 'The Android head with its eyes cut out: your phone\u2019s own apps.')
def g_android():
    head = P("M104 340 A152 152 0 0 1 408 340 Z")
    ant = U(stroke("M178 222 L142 158", 24), stroke("M334 222 L370 158", 24))
    return D(U(head, ant), circle(198, 284, 22), circle(314, 284, 22))

@glyph('usuals', 'A bowl with chopsticks resting in it: your regular order.')
def g_usuals():
    bowl = P("M92 236 H420 C420 328 348 392 256 392 C164 392 92 328 92 236 Z")
    foot = rrect(200, 380, 112, 34, 12)
    sticks = U(stroke("M282 226 L366 96", 24), stroke("M314 226 L410 116", 24))
    return U(bowl, foot, sticks)   # Robert, 30 Oct 2026: no heart

@glyph('side', 'A phone with the orb cut into it and its side key raised: talk from anywhere.')
def g_side():
    phone = rrect(156, 80, 200, 352, 44)
    key = rrect(368, 164, 22, 84, 11)
    return U(D(phone, circle(256, 300, 52), rrect(226, 108, 60, 14, 7)), key)

@glyph('day', 'A sun setting through the horizon: what we did yesterday.')
def g_day():
    sun = circle(256, 248, 156)
    slits = U(*[rrect(80, y, 352, h, 0) for y, h in ((300, 18), (336, 22), (374, 26))])
    return D(sun, slits)

@glyph('week', 'Seven days cut into one wheel: the week, one level up.')
def g_week():
    disc = circle(256, 256, 156)
    cuts = U(*[R(rrect(249, 60, 14, 196, 0), i * 360 / 7, 256, 256) for i in range(7)])
    return D(disc, cuts, circle(256, 256, 44))

@glyph('month', 'A crescent moon with a star in its bite: the arc of the last four weeks.')
def g_month():
    moon = D(circle(232, 262, 162), circle(320, 206, 136))
    return U(moon, spark(330, 196, 62, 0.15))

@glyph('meditate', 'A seated figure with light cut into the heart: resting as radiant awareness.')
def g_meditate():
    head = circle(256, 132, 48)
    body = P("M232 196 H280 C316 196 330 230 338 272 C344 302 360 318 398 326 C432 334 436 376 404 394 C380 406 132 406 108 394 C76 376 80 334 114 326 C152 318 168 302 174 272 C182 230 196 196 232 196 Z")
    return D(U(head, body), circle(256, 276, 26))





@glyph('apps', 'Four tiles, one of them is a hat: where the Wizard gets new powers.')
def g_apps():
    tiles = U(rrect(112, 112, 124, 124, 30), rrect(112, 276, 124, 124, 30), rrect(276, 276, 124, 124, 30))
    # Hat a touch bigger (Robert, 30 Oct 2026): 0.375 -> 0.41, same centre and ground line as the tiles.
    return U(tiles, T(hat(), 0.41, 338 - 0.41 * 256, 236 - 0.41 * 408))


@glyph('image', 'A photo frame with a mountain and sun bitten out: image search.')
def g_image():
    frame = rrect(92, 116, 328, 280, 54)
    hills = P("M92 372 L196 250 L262 324 L304 284 L420 392 L420 420 L92 420 Z")
    return D(frame, I(hills, rrect(120, 140, 272, 232, 30)), circle(318, 196, 34))

@glyph('bolt', 'A bolt cut out of a disc: run it through the fast router.')
def g_bolt():
    return D(circle(256, 256, 156), P("M282 132 L176 280 H246 L226 384 L336 228 H264 Z"))

@glyph('pin', 'A map pin with its hole: you are here.')
def g_pin():
    body = U(circle(256, 214, 128), P("M146 280 L256 424 L366 280 Z"))
    return D(body, circle(256, 210, 52))

@glyph('home', 'A house with a pitched roof and an arched door cut out: the home desk.')
def g_home():
    body = U(poly((256, 92), (432, 244), (400, 244), (400, 404), (112, 404), (112, 244), (80, 244)),
             rrect(332, 116, 44, 96, 8))
    door = door_at(256, 404, 112)   # the logo's door
    return D(U(body, stroke(body, 24)), door)

# Installed Wizard apps that still showed a letter (Oct 2026).
@glyph('bell', 'A bell with a flared lip and its clapper hanging free: your Wizard tells you when something is done.')
def g_bell():
    body = P("M256 98 C318 98 354 146 356 208 L360 278 C362 318 382 342 412 360 C426 368 426 390 408 390 "
             "H104 C86 390 86 368 100 360 C130 342 150 318 152 278 L156 208 C158 146 194 98 256 98 Z")
    knob = circle(256, 88, 26)
    clapper = P("M212 412 H300 A44 44 0 0 1 212 412 Z")
    return U(body, knob, clapper)

@glyph('coffee', 'A coffee cup with two curls of steam rising: your morning briefing.')
def g_coffee():
    cup = P("M104 228 H364 V292 C364 362 310 412 234 412 C158 412 104 362 104 292 Z")
    handle = stroke(circle(372, 290, 46), 30)
    rise = lambda x: taper(bez((x, 200), (x - 26, 168), (x + 24, 142), (x, 96)), [18, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5])
    return U(cup, handle, rise(196), rise(276))   # Robert, 30 Oct 2026: no rim band; steam tapers like Mail's line

@glyph('globe', 'A globe with its meridian and latitudes cut out: the shared browser.')
def g_globe():
    disc = circle(256, 256, 156)
    cuts = U(stroke(P("M256 100 C196 160 196 352 256 412 C316 352 316 160 256 100 Z"), 22),
             rrect(96, 245, 320, 22, 0), I(rrect(96, 170, 320, 20, 0), disc), I(rrect(96, 322, 320, 20, 0), disc))
    return D(disc, cuts)

@glyph('wave', 'A sound wave turning into a line of text: speech to text.')
def g_wave():
    bars = U(*[rrect(x - 17, 256 - h / 2, 34, h, 17) for x, h in ((116, 96), (180, 196), (244, 280), (308, 168), (372, 92))])
    return bars

@glyph('hub', 'One centre with three spokes to its apps: the service that routes your Wizard.')
def g_hub():
    pts = [(256 + 150 * math.sin(math.radians(a)), 256 - 150 * math.cos(math.radians(a))) for a in (0, 120, 240)]
    nodes = U(*[circle(x, y, 54) for x, y in pts])
    spokes = U(*[stroke(f"M256 256 L{x} {y}", 48) for x, y in pts])
    return D(U(nodes, spokes, circle(256, 256, 70)), circle(256, 256, 28))

@glyph('spark', 'A four-point spark cut out of a disc: an AI subscription plugged in.')
def g_spark():
    return D(circle(256, 256, 156), spark(256, 256, 112, 0.14))

@glyph('burst', 'A burst of rays round an open centre: an AI subscription plugged in.')
def g_burst():
    rays = U(*[R(rrect(234, 84 + (i % 2) * 22, 44, 150 - (i % 2) * 22, 22), i * 360 / 8, 256, 256) for i in range(8)])
    return D(U(rays, circle(256, 256, 76)), circle(256, 256, 30))

@glyph('shield', 'A shield with a keyhole cut out: private AI, sealed in an enclave.')
def g_shield():
    shield = P("M256 72 L404 124 V236 C404 330 344 404 256 440 C168 404 108 330 108 236 V124 Z")
    return D(shield, circle(256, 228, 40), P("M240 244 L272 244 L288 336 L224 336 Z"))

@glyph('cloud', 'A plain cloud: your Cloudflare accounts (a generic cloud, not Cloudflare\'s mark).')
def g_cloud():
    return P("M166 220A70 70 0 1 0 166 360H348A78 78 0 0 0 348 204A96 96 0 0 0 166 220Z")

@glyph('scope', 'A rifle scope reticle with its centre dot: the daily scan that picks targets.')
def g_scope():
    ring = stroke(circle(256, 256, 132), 40)
    ticks = U(rrect(242, 92, 28, 110, 14), rrect(242, 310, 28, 110, 14), rrect(92, 242, 110, 28, 14), rrect(310, 242, 110, 28, 14))
    return U(ring, ticks, circle(256, 256, 30))

@glyph('heart', 'A heart with a pulse line cut through it: your health, read from your devices.')
def g_heart():
    heart = P("M256 412 C200 368 92 300 92 196 C92 140 134 100 186 100 C218 100 242 116 256 142 C270 116 294 100 326 100 C378 100 420 140 420 196 C420 300 312 368 256 412 Z")
    pulse = stroke("M70 246 H178 L212 196 L252 300 L290 222 L310 246 H442", 28)
    return D(heart, pulse)

@glyph('card', 'A payment card with its stripe and chip cut out: the benefits each card still owes you.')
def g_card():
    card = rrect(114, 164, 284, 184, 34)
    stripe = rrect(60, 200, 392, 34, 0)
    chip = rrect(148, 270, 62, 44, 11)
    return D(card, stripe, chip)

@glyph('tag', 'A price tag with its eyelet punched out: things you sell and buy second-hand.')
def g_tag():
    # Upright tag (point up, eyelet near the point), then turned 45 degrees like a tag hanging on a string.
    body = P("M256 72 L352 168 V408 A32 32 0 0 1 320 440 H192 A32 32 0 0 1 160 408 V168 Z")
    body = U(body, stroke(body, 28))
    return R(D(body, circle(256, 176, 34)), 45, 256, 256)

@glyph('dollar', 'A dollar sign cut through a coin: what you spent, what you own.')
def g_dollar():
    coin = circle(256, 256, 170)
    s_curve = stroke("M318 196 C306 168 282 158 256 158 C222 158 196 176 196 206 C196 238 226 248 256 256 C288 264 318 274 318 306 C318 336 290 354 256 354 C226 354 200 342 192 314", 36)
    bar = U(rrect(238, 118, 36, 46, 12), rrect(238, 348, 36, 46, 12))
    return D(coin, U(s_curve, bar))

@glyph('podcast', 'A broadcast disc with a microphone cut out of it: shows that talk to you.')
def g_podcast():
    disc = circle(256, 256, 160)
    capsule = rrect(212, 128, 88, 150, 44)
    yoke = stroke("M170 232 A86 86 0 0 0 342 232", 28)
    stem = rrect(242, 316, 28, 50, 0)
    base = rrect(196, 356, 120, 28, 14)
    return D(disc, U(capsule, yoke, stem, base))

@glyph('clip', 'A film frame with play cut out: a video to edit.')
def g_clip():
    frame = rrect(88, 132, 336, 248, 52)
    return D(frame, poly((220, 196), (220, 316), (324, 256)))

@glyph('wrench', 'A wrench with its jaw open: fix your Wizard.')
def g_wrench():
    head = circle(184, 184, 100)
    handle = stroke("M210 210 L384 384", 66)
    jaw = R(rrect(150, 60, 68, 150, 0), -45, 184, 184)
    return D(U(head, handle), jaw, circle(184, 184, 34))

@glyph('gauge', 'A dial with its needle cut out: how your box is doing.')
def g_gauge():
    dial = P("M96 330 A160 160 0 0 1 416 330 L416 352 C416 370 402 384 384 384 H128 C110 384 96 370 96 352 Z")
    needle = U(stroke("M256 330 L330 222", 34), circle(256, 330, 34))
    ticks = U(*[R(rrect(248, 186, 16, 40, 8), a, 256, 330) for a in (-60, -30, 0, 30, 60)])
    return D(dial, needle, ticks)

@glyph('news', 'A folded newspaper with its headline and picture cut out: the day\u2019s stories, picked for you.')
def g_news():
    sheet = rrect(152, 108, 264, 300, 40)
    back = rrect(96, 196, 96, 212, 34)
    seam = stroke('M152 210V368', 30, cap='round')          # the fold between the back page and the front one
    return D(U(D(back, rrect(140, 150, 300, 300, 52)), sheet), rrect(196, 156, 176, 44, 14), rrect(196, 236, 80, 124, 14), rrect(300, 236, 72, 28, 10), rrect(300, 286, 72, 28, 10), rrect(300, 336, 72, 24, 10))

@glyph('letter', 'Placeholder ring for apps without a sigil yet.')
def g_letter():
    return D(circle(256, 256, 156), circle(256, 256, 120))

@glyph('notes', 'A page with a pencil cut in from its corner: you write here, and it keeps.')
def g_notes():
    page = rrect(124, 92, 264, 328, 44)
    x0, y0, x1, y1, w = 430, 70, 214, 286, 58          # pencil: end (off the corner) -> tip
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy); ux, uy = dx / L, dy / L; nx, ny = -uy, ux
    bx, by, h = x1 - ux * w * 1.25, y1 - uy * w * 1.25, w / 2
    body = poly((x0 + nx * h, y0 + ny * h), (bx + nx * h, by + ny * h), (bx - nx * h, by - ny * h), (x0 - nx * h, y0 - ny * h))
    tip = poly((bx + nx * h, by + ny * h), (x1, y1), (bx - nx * h, by - ny * h))
    return D(page, U(body, tip))

@glyph('profile', 'A disc with a wizard cut out, hat over a bust running off the edge: who you are, as friends see you.')
def g_profile():
    disc = circle(256, 256, 176)
    # Three big shapes so it still reads at 24 px: the hat, one bust (head and shoulders joined), and a wide band
    # of disc between them. The shoulders run past the disc, so it is a person, never a pawn on a base.
    # Robert, 30 Oct 2026: the hat sits on the head, no gap; person and hat are one cut-out.
    hat_ = U(hat_at(256, 236, 112), rrect(176, 224, 160, 28, 14))   # brim rests on the crown of the head
    bust = U(circle(256, 284, 46), P("M118 480 C124 372 188 326 256 326 C324 326 388 372 394 480 Z"))
    return D(disc, U(hat_, bust))

# Launch set (Robert, 29 Oct 2026): apps on a stock Wizard that still showed a letter.
@glyph('recorder', 'A microphone with its words already landing beside it: record and transcribe live.')
def g_recorder():
    cap = rrect(112, 92, 128, 216, 64)
    yoke = stroke("M92 236 A84 84 0 0 0 260 236", 26)
    stem = rrect(163, 318, 26, 50, 0)
    base = rrect(120, 362, 112, 30, 15)
    lines = U(rrect(290, 142, 132, 34, 17), rrect(290, 210, 104, 34, 17), rrect(290, 278, 64, 34, 17))
    return U(cap, yoke, stem, base, lines)

@glyph('foot', 'A big footprint with a check cut into the sole: Sasquatch keeps track of what you pay for.', scale=1.12)
def g_foot():
    # Sasquatch's own app icon: a tall sole, wider at the ball, four toes in an arc, and its chevron cut in.
    sole = P("M170 236 C170 196 206 176 256 176 C306 176 342 196 342 236 C342 296 324 336 316 380 "
             "C310 414 288 436 256 436 C224 436 202 414 196 380 C188 336 170 296 170 236 Z")
    toes = U(circle(178, 140, 25), circle(232, 112, 33), circle(292, 114, 27), circle(342, 140, 20))
    chevron = stroke("M212 300 L256 344 L300 300", 34)
    return U(D(sole, chevron), toes)

@glyph('tasks', 'A solid box with a check knocked out of it: what is next, and what got done.', scale=0.9)
def g_tasks():
    return D(rrect(104, 104, 304, 304, 76), taper([(172, 262), (232, 322), (346, 196)], [17, 27, 15]))

@glyph('tasks-check', 'A bold check that swells and fades like the Mail line: what got done.')
def g_tasks_check():
    return taper([(110, 270), (210, 368), (404, 150)], [22, 44, 18])

SHELF_LEAN = 21   # degrees: the top corner reaches past the upright's edge, so the knockout leaves it touching

@glyph('shelf', 'Books on a shelf, one leaning on an upright one: your saved knowledge, ready to pull down.')
def g_shelf():
    # Robert, 30 Oct 2026: the leaning book rests against a book standing straight; no spine bands.
    a = rrect(248, 112, 78, 300, 18)            # upright, tall
    b = rrect(340, 158, 78, 254, 18)            # upright
    # Tip the left book on its bottom-right corner until its top corner reaches into the upright, then cut a thin
    # knockout round the upright: the corner ends flush against it, so it reads as resting there.
    lean = R(rrect(96, 166, 78, 246, 18), SHELF_LEAN, 174, 412)
    lean = D(lean, U(a, stroke(a, 16)), rrect(60, 406, 400, 60, 0))
    shelf = rrect(80, 406, 352, 30, 15)
    return U(lean, a, b, shelf)

@glyph('setup', 'A gear with the Wizard door at its centre: setting up your Wizard.')
def g_setup():
    teeth = U(*[R(rrect(230, 70, 52, 70, 14), i * 45, 256, 256) for i in range(8)])
    gear = U(circle(256, 256, 138), teeth)
    return D(gear, door_at(256, 316, 104))   # the logo's door (Robert, 30 Oct 2026)

@glyph('router', 'One line branching to three ends: which model or service each job goes to.')
def g_router():
    paths = U(stroke("M128 256 C230 256 262 140 384 140", 34), stroke("M128 256 H384", 34), stroke("M128 256 C230 256 262 372 384 372", 34))
    nodes = U(circle(128, 256, 52), circle(388, 140, 40), circle(388, 256, 40), circle(388, 372, 40))
    return D(U(paths, nodes), circle(128, 256, 20))

@glyph('bank', 'A bank front with a coin in its pediment: your accounts, read safely.')
def g_bank():
    roof = poly((256, 80), (430, 176), (82, 176))
    beam = rrect(96, 182, 320, 30, 8)
    cols = U(*[rrect(x, 226, 46, 138, 10) for x in (116, 192, 274, 350)])
    base = rrect(82, 376, 348, 40, 12)
    return D(U(roof, beam, cols, base), circle(256, 142, 22))

# ---------- normalise + emit ----------
# First batch (Robert, 8-12 Oct 2026): the approved sheet, ported outline-for-outline from its masks.
from first_batch import FIRST_BATCH, PARTS, AUTHORITY_BITE_BOX

SIGNAL_TILT = -12   # degrees; negative turns the bowl counterclockwise on screen

@glyph('signal', 'A satellite dish on its stand, its feed reaching for the sky: your signal, pulled in.')
def g_signal():
    # The approved dish (first batch), its bowl tilted back 12 degrees on the stand so the lower lip clears the
    # base (Robert, 30 Oct 2026).
    base = P("M237.9 265.4 Q240 262 242.1 265.4 L329.8 407.2 Q334 414 326.0 414.0 L154.0 414.0 Q146 414 150.2 407.2 Z")
    dish = U(P("M355.3 315.3 A132 132 0 0 1 168.7 128.7 Z"), P("M232.0 214.0 L338.4 145.6 L270.0 252.0 Z"), circle(338.4, 145.6, 34))
    return U(base, R(dish, SIGNAL_TILT, 240, 262))
@glyph('eye', 'An eye cut into a sphere, its corners clear of the edge: a question about the world that keeps looking.')
def g_eye(): return P(FIRST_BATCH['topics'])

@glyph('social', 'A disc with three circuit traces rising into it, each ending in a node: your people, connected.')
def g_social(): return P(FIRST_BATCH['social'])

@glyph('bag', 'A tapered shopping bag with a gem cut into it: the agent does the finding.')
def g_bag(): return P(FIRST_BATCH['shopping'])

@glyph('secret', 'A drop with a short keyhole: secrets go in, nobody else gets the key.')
def g_secret(): return P(FIRST_BATCH['secret-drop'])

@glyph('inbox', 'A drop with an arrow cut through: things land here for you.')
def g_inbox(): return P(FIRST_BATCH['drop'])

@glyph('mail', 'A solid envelope with a deep tapered V: mail, not Gmail.')
def g_mail(): return P(FIRST_BATCH['mail'])

@glyph('music', 'Over-ear headphones: your music.')
def g_music():
    # The approved headphones, with the cups' outer sides rounded so they read as headphones, not earmuffs
    # (Robert, 30 Oct 2026).
    band = P("M116 300 V226 A140 140 0 0 1 396 226 V300 H358 V226 A102 102 0 0 0 154 226 V300 Z")
    left = P("M150 262 H178 A24 24 0 0 1 202 286 V398 A24 24 0 0 1 178 422 H150 A58 80 0 0 1 150 262 Z")
    right = P("M362 262 H334 A24 24 0 0 0 310 286 V398 A24 24 0 0 0 334 422 H362 A58 80 0 0 0 362 262 Z")
    return U(band, left, right)
@glyph('recall', 'A crystal ball on its stand, a glint on its shoulder: see what is coming.')
def g_recall():
    stand, ball, glare = P(PARTS['recall-stand']), P(PARTS['recall-ball']), P(PARTS['recall-glare'])
    # Robert, 30 Oct 2026: a bigger glint (1.35x), pulled in so it keeps its clearance from the ball's edge.
    bx, by, br = 256, 212, 138
    far = lambda p: max(math.hypot(x - bx, y - by) for x, y in p.points)
    gx0, gy0, gx1, gy1 = glare.bounds; cx, cy = (gx0 + gx1) / 2, (gy0 + gy1) / 2
    big = T(glare, 1.35, cx - 1.35 * cx, cy - 1.35 * cy)
    push = far(big) - far(glare); dx, dy = bx - cx, by - cy; L = math.hypot(dx, dy)
    big = T(big, 1, push * dx / L, push * dy / L)
    return U(D(ball, big), stand)

@glyph('camera', 'A video camera with circuit traces in its body: your meetings, recorded and summarised.')
def g_camera(): return P(FIRST_BATCH['meetings'])

@glyph('seal', 'A scalloped seal with the Wizard hat cut out: what your Wizard is allowed to do.')
def g_seal():
    x0, y0, x1, y1 = AUTHORITY_BITE_BOX
    return D(P(PARTS['authority-seal']), hat_at((x0 + x1) / 2, y1, y1 - y0))   # the (wider) house hat

@glyph('voice', 'A disc with a spoken wave cut through it: your Wizard listens and talks back.')
def g_voice():
    wave = stroke("M150 256 Q176.5 176 203 256 T256 256 T309 256 T362 256", 32)
    return D(circle(256, 256, 156), wave)



def fmt(p):
    pen = SVGPathPen(None, ntos=lambda v: str(int(round(v))))
    p.draw(pen)
    return pen.getCommands()

def normalise(p, scale=1.0, dy=0, target=318):
    x0, y0, x1, y1 = bounds(p)
    w, h = x1 - x0, y1 - y0
    # optical size: geometric mean of the box, capped by the longest side
    s = min(target / math.sqrt(w * h), 372 / max(w, h)) * scale
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return T(p, s, 256 - cx * s, 256 - cy * s + dy)

def build():
    out = {}
    for name, g in G.items():
        p = g['fn']()
        p = pathops.simplify(p)
        p = normalise(p, g['scale'], g['dy'])
        out[name] = dict(d=fmt(p), desc=g['desc'])
    return out

if __name__ == '__main__':
    lib = build()
    json.dump(lib, open(sys.argv[1] if len(sys.argv) > 1 else 'sigils.json', 'w'), indent=1)
    for k, v in lib.items(): print(f"{k:10s} {len(v['d']):6d}")
    print('total', sum(len(v['d']) for v in lib.values()))
