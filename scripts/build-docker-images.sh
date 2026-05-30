#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${BLUEEDGE_IMAGE_TAG:-latest}"
PLATFORM="${BLUEEDGE_PLATFORM:-linux/amd64}"

docker build \
  --platform "$PLATFORM" \
  -t "blueedge-frontend:${TAG}" \
  -f "$ROOT_DIR/frontend/Dockerfile" \
  "$ROOT_DIR"

docker build \
  --platform "$PLATFORM" \
  -t "blueedge-api-gateway:${TAG}" \
  "$ROOT_DIR/server/api-gateway"

docker build \
  --platform "$PLATFORM" \
  -t "blueedge-bff:${TAG}" \
  -f "$ROOT_DIR/deploy/bff.Dockerfile" \
  "$ROOT_DIR"

echo "Built images:"
echo "  blueedge-frontend:${TAG}"
echo "  blueedge-api-gateway:${TAG}"
echo "  blueedge-bff:${TAG}"
echo "Platform: $PLATFORM"
