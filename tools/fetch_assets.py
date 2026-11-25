#!/usr/bin/env python3
"""Download the CC0 Poly Haven assets used by the kitchen into assets/.

Everything here is CC0 (https://polyhaven.com/license). Re-run any time; files
that already exist with the right size are skipped.

    python3 tools/fetch_assets.py            # models + textures + hdri
    python3 tools/fetch_assets.py --dry-run  # report sizes only
    python3 tools/fetch_assets.py --force    # re-download everything

Afterwards: sh tools/compress_models.sh (meshopt geometry) and python3 tools/make_lite.py (standard-detail textures).
"""
import json, os, sys, urllib.request, argparse

API = "https://api.polyhaven.com"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")

# id -> resolution. Task-irrelevant objects (distractors, appliances, decor)
# are photoscans; task objects are built procedurally in src/scene/props.js so
# their sub-parts (lids, slices, spread maps) are individually addressable.
MODELS = {
    # food distractors (several are deliberately "sandwich-adjacent")
    "food_apple_01": "1k", "bananas": "1k", "lemon": "1k", "yellow_onion": "1k",
    "food_avocado_01": "1k", "croissant": "1k", "hamburger_buns": "1k",
    "food_kiwi_01": "1k", "food_lime_01": "1k", "sweet_potato": "1k",
    "food_pomegranate_01": "1k",
    "food_pears_asian_01": "1k", "food_ginger_01": "1k", "food_lychee_01": "1k", "carrot_cake": "1k",
    # kitchenware distractors
    "wooden_cutting_board": "1k", "wooden_bowl_01": "1k", "wooden_spoon": "1k",
    "jug_01": "1k", "tea_set_01": "1k", "vintage_electric_kettle": "1k",
    "wine_bottles_01": "1k", "wicker_basket_01": "1k", "multi_cleaner_bottle": "1k",
    "ceramic_vase_01": "1k", "pot_enamel_01": "1k", "brass_pan_01": "1k",
    "wooden_bowl_02": "1k", "carved_wooden_plate": "1k", "russian_food_cans_01": "1k",
    # decor / appliances
    "potted_plant_04": "1k", "potted_plant_01": "1k", "wall_clock": "1k",
    "bar_chair_round_01": "1k",
    # the rest of the room (src/scene/room.js): breakfast table, sideboard, pictures, plants, odds and ends
    "wooden_table_02": "1k", "painted_wooden_chair_01": "1k", "modern_ceiling_lamp_01": "1k",
    "hanging_picture_frame_01": "1k", "hanging_picture_frame_02": "1k",
    "standing_picture_frame_01": "1k", "potted_plant_02": "1k", "wicker_basket_02": "1k",
    "wooden_broom": "1k", "book_encyclopedia_set_01": "1k", "ceramic_vase_02": "1k", "ceramic_vase_04": "1k",
}
# large pieces seen across the room keep 1k textures in the standard-detail set (tools/make_lite.py)
FURNITURE = ["wooden_table_02", "painted_wooden_chair_01", "hanging_picture_frame_01", "hanging_picture_frame_02"]
TEXTURES = {  # id -> (res, maps)
    "herringbone_parquet": ("2k", ["diff", "nor_gl", "rough"]),
    "white_plaster_02": ("1k", ["diff", "nor_gl", "rough"]),
    "white_oak_veneer": ("1k", ["diff", "nor_gl", "rough"]),
    "rough_linen": ("1k", ["diff", "nor_gl", "rough"]),
}
HDRIS = {"lythwood_room": "1k"}


FORCE = False
UA = {"User-Agent": "sandwichestime-asset-fetch/1.0 (research; CC0 assets)"}


def _open(url, timeout):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)


def get_json(url):
    with _open(url, 60) as r:
        return json.load(r)


def download(url, dest, size=None, dry=False):
    if os.path.exists(dest) and not FORCE:      # geometry is recompressed after download, so sizes no longer match the originals
        return 0
    if dry:
        return size or 0
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with _open(url, 120) as r, open(dest + ".part", "wb") as f:
        f.write(r.read())
    os.replace(dest + ".part", dest)
    return os.path.getsize(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="re-download files that already exist")
    a = ap.parse_args()
    global FORCE
    FORCE = a.force
    manifest = {"license": "CC0 1.0 — Poly Haven (polyhaven.com)", "models": {}, "textures": {}, "hdri": {}}
    total = 0
    for mid, res in MODELS.items():
        files = get_json(f"{API}/files/{mid}")["gltf"][res]["gltf"]
        main_name = os.path.basename(files["url"])
        total += download(files["url"], os.path.join(ROOT, "models", mid, main_name), files.get("size"), a.dry_run)
        sz = files.get("size", 0)
        for rel, info in files.get("include", {}).items():
            total += download(info["url"], os.path.join(ROOT, "models", mid, rel), info.get("size"), a.dry_run)
            sz += info.get("size", 0)
        info = get_json(f"{API}/info/{mid}")
        manifest["models"][mid] = {"file": f"models/{mid}/{main_name}", "name": info.get("name"),
                                   "authors": list(info.get("authors", {}).keys()), "bytes": sz}
        print(f"model {mid:28s} {sz/1e6:6.2f} MB")
    for tid, (res, maps) in TEXTURES.items():
        files = get_json(f"{API}/files/{tid}")
        out = {}
        for m in maps:
            key = {"diff": "Diffuse", "nor_gl": "nor_gl", "rough": "Rough"}[m]
            f = files[key][res]["jpg"]
            dest = os.path.join(ROOT, "textures", tid, f"{tid}_{m}_{res}.jpg")
            total += download(f["url"], dest, f.get("size"), a.dry_run)
            out[m] = f"textures/{tid}/{tid}_{m}_{res}.jpg"
        manifest["textures"][tid] = out
        print(f"texture {tid}")
    for hid, res in HDRIS.items():
        f = get_json(f"{API}/files/{hid}")["hdri"][res]["hdr"]
        dest = os.path.join(ROOT, "hdri", f"{hid}_{res}.hdr")
        total += download(f["url"], dest, f.get("size"), a.dry_run)
        manifest["hdri"][hid] = f"hdri/{hid}_{res}.hdr"
        print(f"hdri {hid}")
    if not a.dry_run:
        with open(os.path.join(ROOT, "manifest.json"), "w") as fh:
            json.dump(manifest, fh, indent=1)
    print(f"downloaded {total/1e6:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
