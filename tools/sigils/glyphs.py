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

HAT_D = "M128 408 L232 150 C244 120 246 100 230 80 C228 77 232 74 236 76 C270 92 284 120 296 150 L384 408 Z"
def hat(): return P(HAT_D)
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

@glyph('wizard', 'The mother mark: the hat, with its door joined to the ground line.')
def g_wizard():
    return D(hat(), P("M226 412 V346 A30 30 0 0 1 286 346 V412 Z"))

@glyph('chats', 'A speech bubble with the hat cut out of it: you talking to your Wizard.')
def g_chats():
    bubble = U(rrect(88, 104, 336, 248, 84), P("M138 316 C136 360 122 392 102 414 C160 408 214 384 246 344 Z"))
    return D(bubble, hat_at(258, 314, 176))

@glyph('signal', 'A disc with signal radiating from one point: your feed, not noise.')
def g_signal():
    disc = circle(256, 256, 152)
    rings = U(stroke(circle(166, 346, 128), 28), stroke(circle(166, 346, 206), 28))
    return D(disc, I(rings, disc), circle(166, 346, 42))

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
    return D(book, flame, rrect(249, 330, 14, 90, 2))

@glyph('music', 'An eighth note whose flag is the curl of the hat\u2019s hook.')
def g_music():
    head = R(P("M140 368 a66 50 0 1 0 132 0 a66 50 0 1 0 -132 0 Z"), -22, 206, 368)
    stem = rrect(242, 110, 32, 262, 6)
    flag = P("M242 110 C300 112 352 150 356 214 C358 246 344 270 324 288 C334 254 334 222 316 200 C300 180 278 176 274 176 L274 130 Z")
    return U(head, stem, flag)

@glyph('track', 'A record in the crosshairs: hunting down the track.')
def g_track():
    disc = circle(256, 256, 156)
    ticks = U(rrect(242, 80, 28, 92, 14), rrect(242, 340, 28, 92, 14), rrect(80, 242, 92, 28, 14), rrect(340, 242, 92, 28, 14))
    groove = I(stroke(circle(256, 256, 96), 16), disc)
    return D(disc, ticks, groove, circle(256, 256, 26))

@glyph('bag', 'A bag with a spark punched through: the agent does the finding.')
def g_bag():
    handle = stroke("M196 196 V170 A60 60 0 0 1 316 170 V196", 34)
    body = rrect(124, 184, 264, 228, 36)
    return D(U(handle, body), spark(256, 300, 66, 0.12))

@glyph('mic', 'A microphone whose capsule is cut with three lines: record, transcribe, outline.')
def g_mic():
    cap = rrect(180, 84, 152, 240, 76)
    yoke = stroke("M128 252 A128 128 0 0 0 384 252", 32)
    stem = rrect(240, 372, 32, 40, 0)
    base = rrect(176, 400, 160, 30, 15)
    lines = U(rrect(214, 152, 84, 26, 13), rrect(214, 198, 84, 26, 13), rrect(214, 244, 52, 26, 13))
    return D(U(cap, yoke, stem, base), lines)

@glyph('eye', 'A watching eye cut into a sphere: a question about the world that keeps looking.')
def g_eye():
    return U(D(circle(256, 256, 156), P("M80 256 Q256 120 432 256 Q256 392 80 256 Z")), circle(256, 256, 46))

@glyph('projects', 'A board with three lanes hanging from the top, each at a different stage.')
def g_projects():
    board = rrect(96, 104, 320, 304, 64)
    lanes = U(rrect(140, 156, 64, 204, 22), rrect(224, 156, 64, 144, 22), rrect(308, 156, 64, 84, 22))
    return D(board, lanes)

@glyph('calendar', 'A calendar page with today punched out.')
def g_calendar():
    body = rrect(96, 128, 320, 284, 56)
    tabs = U(rrect(162, 84, 40, 88, 20), rrect(310, 84, 40, 88, 20))
    gap = U(rrect(150, 72, 64, 116, 32), rrect(298, 72, 64, 116, 32))
    page = D(body, gap, rrect(96, 206, 320, 22, 0))
    return D(U(page, tabs), rrect(282, 278, 80, 80, 20))

@glyph('cine', 'A clapperboard with play cut into the slate: your watch queue.')
def g_cine():
    slate = rrect(104, 212, 304, 200, 40)
    bar = R(rrect(104, 132, 304, 60, 18), -11, 104, 192)
    stripes = U(*[R(rrect(x, 100, 30, 120, 0), 28, x + 15, 160) for x in (168, 248, 328)])
    bar = D(bar, I(stripes, bar))
    play = P("M226 262 L326 312 L226 362 Z")
    return U(D(slate, play), bar)

@glyph('social', 'Two wizards, the smaller one cut free of the larger: a network of people.')
def g_social():
    door = lambda: P("M226 416 V340 A30 30 0 0 1 286 340 V416 Z")
    big = T(D(hat(), door()), 0.8, 9.2, 81.6)
    small_shape = T(hat(), 0.58, 181.52, 171.36)
    small = T(D(hat(), door()), 0.58, 181.52, 171.36)
    halo = stroke(small_shape, 30)
    return U(D(big, halo), small)

@glyph('files', 'A folder with the Wizard door cut into its base: your stuff lives in the Wizard\u2019s house.')
def g_files():
    folder = P("M156 120 H218 Q232 120 242 132 L266 160 H356 Q388 160 388 192 V376 Q388 408 356 408 H156 Q124 408 124 376 V152 Q124 120 156 120 Z")
    return D(folder, P("M222 416 V336 A34 34 0 0 1 290 336 V416 Z"))

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

@glyph('usuals', 'A bowl and chopsticks with a heart cut in: your regular order.')
def g_usuals():
    bowl = P("M92 236 H420 C420 328 348 392 256 392 C164 392 92 328 92 236 Z")
    foot = rrect(200, 380, 112, 34, 12)
    sticks = U(stroke("M282 226 L366 96", 24), stroke("M314 226 L410 116", 24))
    heart = P("M256 360 C214 330 186 306 186 278 C186 258 202 244 220 244 C236 244 248 254 256 266 C264 254 276 244 292 244 C310 244 326 258 326 278 C326 306 298 330 256 360 Z")
    return D(U(bowl, foot, sticks), heart)

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

@glyph('inbox', 'A drop with an arrow cut through: things land here for you.')
def g_inbox():
    drop = P("M256 72 L355.5 264.6 A112 112 0 1 1 156.5 264.6 Z")
    return D(drop, P("M240 236 H272 V318 H304 L256 374 L208 318 H240 Z"))

# Library extras from the sigil board (for apps we will build: Drop, Secret Drop, Mail, Link, Recall, App Store)
@glyph('secret', 'A drop with a keyhole: secrets go in, nobody else gets the key.')
def g_secret():
    drop = P("M256 72 L355.5 264.6 A112 112 0 1 1 156.5 264.6 Z")
    return D(drop, circle(256, 300, 28), P("M244 310 L268 310 L280 372 L232 372 Z"))

@glyph('mail', 'An envelope whose flap is the hat turned upside down.')
def g_mail():
    env = rrect(104, 156, 304, 216, 28)
    flap = T(hat(), 1.0, 0, 0).transform(1, 0, 0, -0.52, 0, 156 + 0.52 * 408)
    return D(env, flap)

@glyph('link', 'Two rings locked together: phone and box, paired.')
def g_link():
    a = stroke(circle(190, 256, 100), 40); b = stroke(circle(322, 256, 100), 40)
    # a passes over b at the top crossing, b over a at the bottom
    top = I(circle(256, 160, 46), b)
    bot = I(circle(256, 352, 46), a)
    gap_b = I(stroke(circle(190, 256, 100), 80), circle(256, 172, 60))
    gap_a = I(stroke(circle(322, 256, 100), 80), circle(256, 340, 60))
    return U(D(b, gap_b), D(a, gap_a), I(a, circle(256,172,60)), I(b, circle(256,340,60)))

@glyph('recall', 'A crystal ball on its stand with a glint cut out: ask it what you already know.')
def g_recall():
    ball = circle(256, 220, 132)
    glint = stroke("M178 202 A82 82 0 0 1 240 140", 24)
    stand = P("M180 372 H332 L360 412 H152 Z")
    return U(D(ball, glint), stand)

@glyph('apps', 'Four tiles, one of them is a hat: where the Wizard gets new powers.')
def g_apps():
    tiles = U(rrect(112, 112, 124, 124, 30), rrect(112, 276, 124, 124, 30), rrect(276, 276, 124, 124, 30))
    return U(tiles, T(hat(), 0.375, 242, 83))


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
    door = P("M218 404 V320 A38 38 0 0 1 294 320 V404 Z")
    return D(U(body, stroke(body, 24)), door)

@glyph('letter', 'Placeholder ring for apps without a sigil yet.')
def g_letter():
    return D(circle(256, 256, 156), circle(256, 256, 120))

# ---------- normalise + emit ----------
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
