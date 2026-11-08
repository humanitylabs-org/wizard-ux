#!/usr/bin/env python3
"""Record one geometry read of an authorized private image through the existing private Search route.

For the parent/Hermes only, on the box that serves the private Search. One read-image?geometry=1 request and one
translate request (same configured model/provider; no retry, no fallback, nothing else contacted). Writes the replay
fixture for tools/qa-screen-picture-translate.cjs plus a boxes overlay (SVG) for visual review, all mode 0600 in a
private directory outside any git checkout. Prints counts only, never recovered text.

  python3 tools/qa_picture_geometry_probe.py --image PRIVATE/exact-image.jpg --out PRIVATE_FIXTURE_DIR \
      [--origin http://127.0.0.1:9191] [--sha256 HEX]

Exit 3: the serving Search predates the geometry extension (no "boxes"); deploy that Search first.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import re
import urllib.request
from urllib.parse import urlsplit


def inside_git(p: Path) -> bool:
    return subprocess.run(['git', '-C', str(p), 'rev-parse', '--is-inside-work-tree'], capture_output=True).returncode == 0


def validate_origin(origin: str) -> str:
    """Exact loopback origin only: http://127.0.0.1:PORT or http://localhost:PORT; no userinfo, path, query or fragment."""
    if not isinstance(origin, str) or not re.fullmatch(r'http://(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})', origin):
        raise ValueError('origin must be exactly http://127.0.0.1:PORT or http://localhost:PORT')
    u = urlsplit(origin)
    if (u.scheme != 'http' or u.username is not None or u.password is not None or '@' in u.netloc
            or u.hostname not in ('127.0.0.1', 'localhost') or u.netloc != f'{u.hostname}:{u.port}'
            or u.path or u.query or u.fragment or not 1 <= u.port <= 65535):
        raise ValueError('origin must be exactly http://127.0.0.1:PORT or http://localhost:PORT')
    return origin


def post(url: str, body: bytes, mime: str) -> dict:
    req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': mime})
    with urllib.request.urlopen(req, timeout=120) as r:  # nosec B310 loopback private Search
        return json.load(r)


def write(p: Path, data: bytes):
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--image', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--origin', default='http://127.0.0.1:9191')
    ap.add_argument('--sha256')
    ap.add_argument('--mime', default='image/jpeg', choices=['image/jpeg', 'image/png', 'image/webp'])
    a = ap.parse_args()
    try:  # before any filesystem, image or network access
        a.origin = validate_origin(a.origin)
    except ValueError as error:
        raise SystemExit(f'loopback private Search only: {error}')
    out = a.out.resolve()
    near = next(p for p in (out, *out.parents) if p.exists())
    assert not inside_git(near), 'refusing to write private model output inside a git checkout'
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    img = a.image.read_bytes()
    digest = hashlib.sha256(img).hexdigest()
    assert not a.sha256 or digest == a.sha256, 'image is not the authorized one'
    health = json.load(urllib.request.urlopen(a.origin + '/wizard-search/api/health', timeout=15))  # nosec B310
    read = post(a.origin + '/wizard-search/api/read-image?geometry=1', img, a.mime)
    lines, boxes = read.get('lines'), read.get('boxes')
    assert isinstance(lines, list) and all(isinstance(t, str) for t in lines), 'read-image reply has no lines'
    if not isinstance(boxes, list):
        print(json.dumps({'ok': False, 'reason': 'route lacks geometry', 'revision': health.get('revision')}))
        sys.exit(3)
    assert len(boxes) == len(lines), 'boxes must match lines one for one'
    items = []
    for start in range(0, len(lines), 150):  # translate takes up to 150 items per request
        chunk = lines[start:start + 150]
        tr = post(a.origin + '/wizard-search/api/translate', json.dumps({'items': chunk, 'to': 'English'}).encode(), 'application/json') if chunk else {'items': []}
        assert isinstance(tr.get('items'), list) and len(tr['items']) == len(chunk), 'translation count mismatch'
        items += tr['items']
    write(out / 'live-read-image.json', json.dumps(read, ensure_ascii=False, indent=2).encode())
    write(out / 'live-translate.json', json.dumps({'to': 'English', 'items': items}, ensure_ascii=False, indent=2).encode())
    # Boxes over the image (fractions → viewBox 0..1000), numbered by line, for the reviewer's eyes only.
    rects = ''.join(f'<rect x="{b[0]*1000:.1f}" y="{b[1]*1000:.1f}" width="{(b[2]-b[0])*1000:.1f}" height="{(b[3]-b[1])*1000:.1f}" '
                    f'fill="none" stroke="#f0f" stroke-width="2" vector-effect="non-scaling-stroke"/>'
                    f'<text x="{b[0]*1000:.1f}" y="{b[1]*1000 - 2:.1f}" font-size="14" fill="#f0f">{i}</text>'
                    for i, b in enumerate(boxes) if b)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" width="540" height="1170">'
           f'<image href="data:{a.mime};base64,{base64.b64encode(img).decode()}" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none"/>{rects}</svg>')
    write(out / 'geometry-boxes.svg', svg.encode())
    print(json.dumps({'ok': True, 'revision': health.get('revision'), 'model': read.get('model'), 'ms': read.get('ms'),
                      'image_sha256': digest, 'lines': len(lines), 'boxes': sum(1 for b in boxes if b), 'out': str(out)}))


if __name__ == '__main__':
    main()
