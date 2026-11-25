#!/bin/sh
# Compress model geometry in place with meshopt (EXT_meshopt_compression + KHR_mesh_quantization).
# About 3x smaller downloads; node names and textures are untouched. Run after fetch_assets.py --force.
#   npm i -g @gltf-transform/cli && sh tools/compress_models.sh
# The heaviest room furniture, which is only ever seen from across the room, is thinned first (name:ratio).
SIMPLIFY="potted_plant_01:0.3 potted_plant_02:0.35 book_encyclopedia_set_01:0.25 wicker_basket_02:0.5"
set -e
cd "$(dirname "$0")/../assets/models"
for d in */; do
  g=$(ls "$d"*.gltf)
  grep -q EXT_meshopt_compression "$g" && continue
  tmp=$(mktemp -d); src="$g"
  for s in $SIMPLIFY; do
    if [ "${s%%:*}/" = "$d" ]; then
      gltf-transform weld "$g" "$tmp/w.gltf" >/dev/null
      gltf-transform simplify "$tmp/w.gltf" "$tmp/s.gltf" --ratio "${s##*:}" --error 0.002 >/dev/null
      src="$tmp/s.gltf"; rm -f "$tmp"/w.gltf "$tmp"/w.bin 2>/dev/null || true
    fi
  done
  gltf-transform meshopt "$src" "$tmp/$(basename "$g")" --level medium >/dev/null
  rm -f "$tmp"/s.gltf "$tmp"/s.bin "$tmp"/w.bin 2>/dev/null || true
  rm -f "$d"*.bin; cp "$tmp"/*.bin "$tmp"/*.gltf "$d"; rm -rf "$tmp"
  echo "compressed $d"
done
