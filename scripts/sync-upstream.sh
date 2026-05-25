#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="$ROOT_DIR/upstream/kubeedge-dashboard"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  echo "Missing upstream submodule. Run scripts/init-upstream.sh first."
  exit 1
fi

cd "$UPSTREAM_DIR"
git fetch origin
git checkout main
git pull origin main

cd "$ROOT_DIR"
git add upstream/kubeedge-dashboard

echo "Upstream synced. Review changes, run tests, then commit the new submodule pointer."
