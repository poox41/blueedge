#!/usr/bin/env bash
set -euo pipefail

BFF_BASE_URL="${BFF_BASE_URL:-http://127.0.0.1:8080/api/v1}"
TOKEN="${TOKEN:-}"
AUTH_HEADER=()

if [ -n "$TOKEN" ]; then
  AUTH_HEADER=(-H "Authorization: Bearer $TOKEN")
fi

paths=(
  "/node"
  "/deployment"
  "/service"
  "/devicemodel"
  "/device"
  "/ruleendpoint"
  "/rule"
)

for path in "${paths[@]}"; do
  echo "Checking $BFF_BASE_URL$path"
  curl -fsS "${AUTH_HEADER[@]}" "$BFF_BASE_URL$path" >/dev/null
  echo "OK $path"
done

echo "Contract smoke test passed."
