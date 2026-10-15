"""Adapt the supplied alpha mask: fill the door, cut a keyhole; keep outer pixels unchanged."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[2]
im = Image.open(root / 'web/brand/wizard-mark-white.png').convert('RGBA')
assert im.size == (1394, 1876)
alpha = im.getchannel('A')
d = ImageDraw.Draw(alpha)
# This interior polygon covers only the door and its immediate opaque surround.
d.polygon([(500, 1876), (500, 1570), (706, 1360), (920, 1570), (920, 1876)], fill=255)
d.ellipse((606, 1460, 806, 1660), fill=0)
d.polygon([(668, 1620), (744, 1620), (784, 1804), (628, 1804)], fill=0)
im = Image.new('RGBA', im.size, (255, 255, 255, 255))
im.putalpha(alpha)
im.save(root / 'web/brand/wizard-mark-private.png', optimize=True)
