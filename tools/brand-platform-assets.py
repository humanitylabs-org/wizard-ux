#!/usr/bin/env python3
"""Derive Android platform padding from checked-in supplied rasters only."""
from pathlib import Path
from PIL import Image
import hashlib, json
R = Path(__file__).resolve().parents[1]
res = R / 'android/app/src/main/res'
mark = Image.open(R / 'web/brand/wizard-mark-white.png').convert('RGBA')
square = Image.open(R / 'web/icon-512.png').convert('RGBA')
def contain_canvas(size, bound):
    image = mark.copy(); image.thumbnail((bound, bound), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size))
    canvas.alpha_composite(image, ((size-image.width)//2, (size-image.height)//2))
    return canvas
for density, scale in [('mdpi',1),('hdpi',1.5),('xhdpi',2),('xxhdpi',3),('xxxhdpi',4)]:
    folder = res / ('mipmap-'+density); folder.mkdir(parents=True, exist_ok=True)
    square.resize((int(48*scale), int(48*scale)), Image.Resampling.LANCZOS).save(folder/'ic_launcher.png')
    contain_canvas(int(108*scale), int(54*scale)).save(folder/'ic_launcher_foreground.png')
folder = res/'drawable-nodpi'; folder.mkdir(exist_ok=True)
contain_canvas(288, 144).save(folder/'wizard_splash.png')
contain_canvas(96, 72).save(folder/'ic_wizard_notification.png')
mark.save(folder/'wizard_mark_white.png')
print(json.dumps({str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(res.rglob('*.png'))}, indent=2))
