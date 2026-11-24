#!/bin/sh
# Compress model geometry in place with meshopt (EXT_meshopt_compression + KHR_mesh_quantization).
# About 3x smaller downloads; node names and textures are untouched. Run after fetch_assets.py --force.
#   npm i -g @gltf-transform/cli && sh tools/compress_models.sh
set -e
cd "$(dirname "$0")/../assets/models"
for d in */; do
  g=$(ls "$d"*.gltf)
  grep -q EXT_meshopt_compression "$g" && continue
  tmp=$(mktemp -d)
  gltf-transform meshopt "$g" "$tmp/$(basename "$g")" --level medium >/dev/null
  rm -f "$d"*.bin; cp "$tmp"/*.bin "$tmp"/*.gltf "$d"; rm -rf "$tmp"
  echo "compressed $d"
done
