#!/usr/bin/env python3
"""Build the low-memory asset set for phones: assets/lite/ mirrors the texture
paths under assets/ at reduced resolution (models 512 px, room textures 1k).
Geometry (.gltf/.bin) is shared with the full set. Re-run after fetch_assets.py.

    pip install pillow && python3 tools/make_lite.py
"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
OUT = os.path.join(ROOT, "lite")
total = 0
for sub, cap in (("models", 512), ("textures", 1024)):
    for d, _, files in os.walk(os.path.join(ROOT, sub)):
        for f in files:
            if not f.lower().endswith((".jpg", ".jpeg", ".png")): continue
            src = os.path.join(d, f); dst = os.path.join(OUT, os.path.relpath(src, ROOT))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            im = Image.open(src)
            if max(im.size) > cap: im = im.resize([max(1, round(s * cap / max(im.size))) for s in im.size], Image.LANCZOS)
            if f.lower().endswith(".png"): im.save(dst, optimize=True)
            else: im.convert("RGB").save(dst, quality=82, optimize=True)
            total += os.path.getsize(dst)
print(f"lite set: {total / 1e6:.1f} MB in {OUT}")
