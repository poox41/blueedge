#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${BLUEEDGE_IMAGE_TAG:-latest}"
OUT="${1:-$ROOT_DIR/deploy/blueedge-images-${TAG}.tar}"

docker save \
  "blueedge-frontend:${TAG}" \
  "blueedge-api-gateway:${TAG}" \
  "blueedge-bff:${TAG}" \
  -o "$OUT"

echo "Saved images to $OUT"
