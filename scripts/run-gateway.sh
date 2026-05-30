#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/server/api-gateway"

GATEWAY_PORT="${GATEWAY_PORT:-7001}"
BFF_PORT="${BFF_PORT:-8080}"
LOCAL_APISERVER_PORT="${LOCAL_APISERVER_PORT:-16443}"
BFF_BASE_URL="${BFF_BASE_URL:-http://127.0.0.1:${BFF_PORT}/api/v1}"
K8S_API_SERVER="${K8S_API_SERVER:-https://127.0.0.1:${LOCAL_APISERVER_PORT}}"
K8S_SKIP_TLS_VERIFY="${K8S_SKIP_TLS_VERIFY:-true}"

if [ ! -d node_modules ]; then
  npm install
fi

PORT="$GATEWAY_PORT" \
BFF_BASE_URL="$BFF_BASE_URL" \
K8S_API_SERVER="$K8S_API_SERVER" \
K8S_SKIP_TLS_VERIFY="$K8S_SKIP_TLS_VERIFY" \
npm run dev
