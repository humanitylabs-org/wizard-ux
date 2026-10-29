"""Private agent hat: the supplied company hat with its door filled and a large keyhole cut in its place.

Only pixels inside the door/keyhole box change. The outer silhouette, and so its ink bounds, stays the
supplied mark's, and core/sigils.css sizes both masks with the same rule, so the private hat is exactly
the main hat's size wherever the two appear.

The keyhole is as large as the hat's lower body allows while keeping a solid wall on each side and a
sill underneath: its head is 500 px across (55% of the body's width at that height, ~36% of the canvas),
the stem 240–360 px wide, the whole cut ~36% of the hat's height. Walls and sill stay ≥ 190 px. In tiles
of 24 px and under, core/sigils.css also draws the whole hat family at 80% instead of 62% (one optical
size step shared by main, private and Agents, so they stay the same size as each other): a 16 px tile
then shows a ~2.4 px round head inside ~0.9 px walls, an 18 px window bar ~2.8 px inside ~1.1 px walls. The old 200 px keyhole was under 1 px and
vanished. The round head and closed sill keep it from reading as the main hat's open, pointed door.

    python3 tools/sigils/private_hat.py        (Pillow)
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC, OUT = ROOT / 'web/brand/wizard-mark-white.png', ROOT / 'web/brand/wizard-mark-private.png'
SS = 4  # supersample the cut so its curve stays smooth after the browser scales the mask down

CX = 704                              # the door's axis; the hat body is centred here below y≈1000
DOOR = [(500, 1876), (500, 1570), (706, 1360), (920, 1570), (920, 1876)]  # covers the door and its rim only
HEAD = (1245, 250)                    # keyhole head: centre y, radius  → spans y 995..1495, x 454..954
STEM = (1390, 120, 1676, 180)         # stem trapezoid: top y, top half-width, bottom y, bottom half-width
SILL = 1876 - STEM[2]                 # 200 px of solid hat under the keyhole
BOX = (440, 980, 970, 1876)           # every changed pixel lies inside this box


def main():
    im = Image.open(SRC).convert('RGBA')
    assert im.size == (1394, 1876), im.size
    orig = im.getchannel('A')
    alpha = orig.copy()
    # 1. Fill the door so the hat is one solid body.
    ImageDraw.Draw(alpha).polygon(DOOR, fill=255)
    # Filling the door must not extend the silhouette into the source's transparent bottom row.
    bottom = orig.point(lambda v: 255 if v > 128 else 0).getbbox()[3]
    alpha.paste(orig.crop((0, bottom, im.width, im.height)), (0, bottom))
    # 2. Cut the keyhole, drawn at SS× over its box and scaled down for an anti-aliased edge.
    x0, y0, x1, y1 = BOX
    cut = Image.new('L', ((x1 - x0) * SS, (y1 - y0) * SS), 0)
    s = lambda x, y: ((x - x0) * SS, (y - y0) * SS)
    d = ImageDraw.Draw(cut)
    hy, r = HEAD
    d.ellipse([*s(CX - r, hy - r), *s(CX + r, hy + r)], fill=255)
    ty, tw, by, bw = STEM
    d.polygon([s(CX - tw, ty), s(CX + tw, ty), s(CX + bw, by), s(CX - bw, by)], fill=255)
    cut = cut.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    alpha.paste(ImageChops.subtract(alpha.crop(BOX), cut), BOX[:2])
    # The outer silhouette is the supplied one: same ink bounds, no change outside the box.
    changed = ImageChops.difference(orig, alpha).getbbox()
    assert changed and x0 <= changed[0] and y0 <= changed[1] and changed[2] <= x1 and changed[3] <= y1, changed
    assert alpha.point(lambda v: 255 if v > 128 else 0).getbbox() == orig.point(lambda v: 255 if v > 128 else 0).getbbox()
    out = Image.new('RGBA', im.size, (255, 255, 255, 255))
    out.putalpha(alpha)
    out.save(OUT, optimize=True)
    print('wrote', OUT.relative_to(ROOT), 'changed box', changed, 'keyhole head', 2 * r, 'px, sill', SILL, 'px')


if __name__ == '__main__':
    main()
