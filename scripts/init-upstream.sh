#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="$ROOT_DIR/upstream/kubeedge-dashboard"

if [ -d "$UPSTREAM_DIR/.git" ]; then
  echo "upstream/kubeedge-dashboard already exists."
  exit 0
fi

git submodule add https://github.com/kubeedge/dashboard.git upstream/kubeedge-dashboard

echo "KubeEdge Dashboard upstream added as submodule."
echo "Next: git add .gitmodules upstream/kubeedge-dashboard && git commit -m 'chore: add kubeedge dashboard upstream'"
