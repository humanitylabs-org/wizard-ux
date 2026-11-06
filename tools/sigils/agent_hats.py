"""Agents app mark: two supplied company hats, layered, to say "more than one agent".

Writes two alpha masks on one shared 2174×1876 canvas, so core/sigils.css can stack them with a single
mask size and they stay registered at every size:

    wizard-mark-agents-front.png  the supplied hat, pixel for pixel, standing on the right (main agent; CSS paints it purple)
    wizard-mark-agents-back.png   the same hat at 84%, solid (no door, no keyhole), standing on the same
                                  ground line to the left (private agent; CSS paints it green), with a
                                  100 px knockout gap wherever it passes behind the front hat; ~83% of it
                                  stays visible, tip and right slope included, so it reads as a hat

The canvas is exactly as tall as the supplied mark, so under the shared 62% rule the front hat has the
main hat's ink height; the pair is ~16% wider than tall (72% of the glyph box at 62% height). No private keyhole appears anywhere in this mark.

    python3 tools/sigils/agent_hats.py         (Pillow)
"""
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'web/brand/wizard-mark-white.png'
OUT_FRONT, OUT_BACK = ROOT / 'web/brand/wizard-mark-agents-front.png', ROOT / 'web/brand/wizard-mark-agents-back.png'

HAT_W, HAT_H = 1394, 1876
DOOR = [(500, 1876), (500, 1570), (706, 1360), (920, 1570), (920, 1876)]  # same door fill as private_hat.py
BACK_SCALE = 0.84                     # back hat: 1171×1576, base on the ground line, left edge at x=0
FRONT_X = 780                         # front hat's left edge; its brim overlaps only the back hat's lower right
GAP = 100                             # knockout around the front hat, in canvas px (≈1 px at a 48 px tile)
W, H = FRONT_X + HAT_W, HAT_H         # 2174×1876


def placed(alpha, x, y):
    """`alpha` pasted onto a blank canvas at (x, y); anything off-canvas is clipped, never wrapped."""
    out = Image.new('L', (W, H), 0)
    out.paste(alpha, (x, y))
    return out


def dilate(alpha, r, steps=32):
    """Grow a solid shape by r: union of copies shifted round a circle (error under 1 px at r=100)."""
    out = alpha.copy()
    for k in range(steps):
        t = 2 * math.pi * k / steps
        out = ImageChops.lighter(out, placed(alpha, round(r * math.cos(t)), round(r * math.sin(t))))
    return out


def save(alpha, path):
    im = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    im.putalpha(alpha)
    im.save(path, optimize=True)


def main():
    src = Image.open(SRC).convert('RGBA')
    assert src.size == (HAT_W, HAT_H), src.size
    hat = src.getchannel('A')
    solid = hat.copy()
    ImageDraw.Draw(solid).polygon(DOOR, fill=255)

    front = placed(hat, FRONT_X, 0)
    bw, bh = round(HAT_W * BACK_SCALE), round(HAT_H * BACK_SCALE)
    back = placed(solid.resize((bw, bh), Image.Resampling.LANCZOS), 0, H - bh)
    back = ImageChops.subtract(back, dilate(placed(solid, FRONT_X, 0), GAP))

    # The front hat is the supplied mark untouched; the back hat still shows most of its silhouette.
    assert front.crop((FRONT_X, 0, W, H)).tobytes() == hat.tobytes()
    seen = sum(back.point(lambda v: 1 if v > 128 else 0).getdata())
    full = sum(placed(solid.resize((bw, bh), Image.Resampling.LANCZOS), 0, H - bh).point(lambda v: 1 if v > 128 else 0).getdata())
    assert seen > 0.75 * full, (seen, full)
    save(front, OUT_FRONT)
    save(back, OUT_BACK)
    print('wrote', OUT_FRONT.relative_to(ROOT), OUT_BACK.relative_to(ROOT), f'canvas {W}x{H}', f'back visible {seen / full:.0%}')


if __name__ == '__main__':
    main()
