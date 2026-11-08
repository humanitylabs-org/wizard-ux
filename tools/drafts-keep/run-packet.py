#!/usr/bin/env python3
"""Parent-admitted QA-only packet. No image build, load, export, or activation."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import struct
import subprocess
import zlib

ROOT = Path(__file__).resolve().parent

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def verify_packet(expected):
    manifest_path = ROOT / 'packet.json'
    assert sha(manifest_path) == expected, 'packet.json seal mismatch'
    m = json.loads(manifest_path.read_text())
    assert m['qa_only'] is True and m['synthetic_only'] is True
    for rel, expected_hash in m['sha256'].items():
        p = ROOT / rel
        assert not p.is_symlink() and p.resolve().is_relative_to(ROOT), rel
        assert p.is_file() and sha(p) == expected_hash, 'missing or changed: ' + rel
    tool = Path(m['toolchain']['playwright_package'])
    assert sha(tool) == m['toolchain']['package_sha256'], 'Playwright drift'
    assert subprocess.check_output(['node','--version'], text=True).strip() == m['toolchain']['node_version']
    return m

# Decode screenshot pixels with stdlib, avoiding unpinned worker-side image packages.
def png_pixels(path):
    b = path.read_bytes()
    assert b[:8] == b'\x89PNG\r\n\x1a\n'
    p = 8
    w = h = color = 0
    data = bytearray()
    while p < len(b):
        n = struct.unpack('>I', b[p:p+4])[0]
        kind, body = b[p+4:p+8], b[p+8:p+8+n]
        assert zlib.crc32(kind+body) & 0xffffffff == struct.unpack('>I', b[p+8+n:p+12+n])[0]
        if kind == b'IHDR':
            w,h,depth,color,compression,filtering,interlace = struct.unpack('>IIBBBBB',body)
            assert depth == 8 and color in (2,6) and compression == filtering == interlace == 0
        if kind == b'IDAT':
            data.extend(body)
        p += n+12
    channels = 4 if color == 6 else 3
    stride = w*channels
    raw = zlib.decompress(data)
    assert len(raw) == (stride+1)*h
    prev = bytearray(stride)
    rows = bytearray()
    for y in range(h):
        off = y*(stride+1)
        f, row = raw[off], bytearray(raw[off+1:off+1+stride])
        assert f in range(5)
        for x in range(stride):
            a = row[x-channels] if x>=channels else 0
            c = prev[x-channels] if x>=channels else 0
            up = prev[x]
            guess = a+up-c
            pa,pb,pc = abs(guess-a),abs(guess-up),abs(guess-c)
            paeth = a if pa<=pb and pa<=pc else up if pb<=pc else c
            add = (0,a,up,(a+up)//2,paeth)[f]
            row[x] = (row[x]+add)&255
        rows.extend(row)
        prev = row
    return w,h,channels,bytes(rows)

def verify_pixels(evidence, pairs):
    assert len(pairs) == 12, 'incomplete opacity matrix including negative controls'
    checks = []
    for pair in pairs:
        a,b = png_pixels(evidence/pair['a']),png_pixels(evidence/pair['b'])
        assert a[:3] == b[:3]
        changed = sum(a[3][i:i+a[2]] != b[3][i:i+a[2]] for i in range(0,len(a[3]),a[2]))
        assert (changed == 0) == pair['expectEqual'], pair
        checks.append({**pair,'changed_pixels':changed})
    return checks

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--manifest-sha',required=True)
    p.add_argument('--verify-only',action='store_true')
    args=p.parse_args()
    m=verify_packet(args.manifest_sha)
    if args.verify_only:
        print(json.dumps({'verified':True,'files':len(m['sha256']),'qa_only':True}))
        return
    e=ROOT/'evidence'
    assert not e.exists(), 'fresh packet only; preserve prior failures'
    e.mkdir()
    env={**os.environ,'DRAFTS_KEEP_ROOT':str(ROOT),'QA_PLAYWRIGHT':str(Path(m['toolchain']['playwright_package']).parent)}
    try:
        subprocess.run(['node','browser.cjs'],cwd=ROOT,env=env,check=True,timeout=360)
        browser=json.loads((e/'browser-result.json').read_text())
        assert browser['pass'] is True
        checks=verify_pixels(e,browser['pixelPairs'])
        with (e/'wisdom-tests.log').open('w') as log:
            subprocess.run(['nice','-n','19','node','--test','qa/request-draft.test.mjs'],cwd=ROOT/'wisdom',stdout=log,stderr=subprocess.STDOUT,check=True,timeout=60)
        verify_packet(args.manifest_sha)
        receipt={'pass':True,'qa_only':True,'images_built_or_loaded':False,'source':{k:m[k] for k in ['shell_sha','shell_web_tree','shell_live_baseline','wisdom_sha']},'pixel_checks':checks,'browser':browser,'requires_parent_screenshot_inspection':True,'wisdom_activation':'Separate normal Wisdom release lifecycle on the VPS; no forum image artifact.'}
        (e/'packet-result.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps({'pass':True,'qa_only':True,'receipt':str(e/'packet-result.json')}))
    except BaseException as error:
        (e/'packet-failure.json').write_text(json.dumps({'pass':False,'error':str(error),'qa_only':True})+'\n')
        raise

if __name__ == '__main__':
    main()
