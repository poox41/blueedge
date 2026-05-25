#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/upstream/kubeedge-dashboard/modules/api"

: "${KUBE_APISERVER:?Please set KUBE_APISERVER, e.g. https://127.0.0.1:6443}"
SKIP_TLS="${APISERVER_SKIP_TLS_VERIFY:-true}"

if [ ! -d "$API_DIR" ]; then
  echo "Missing $API_DIR. Run scripts/init-upstream.sh first."
  exit 1
fi

cd "$API_DIR"
go run main.go --apiserver-host="$KUBE_APISERVER" --apiserver-skip-tls-verify="$SKIP_TLS"
