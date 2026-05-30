#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${1:-root@14.103.163.121}"
REMOTE_DIR="${REMOTE_DIR:-/opt/blueedge}"
ARCHIVE="/tmp/blueedge-src.tar.gz"

tar \
  --exclude ".git" \
  --exclude "**/node_modules" \
  --exclude "**/dist" \
  --exclude "**/.env" \
  --exclude ".DS_Store" \
  -czf "$ARCHIVE" \
  -C "$ROOT_DIR" .

ssh "$REMOTE" "mkdir -p '$REMOTE_DIR'"
scp "$ARCHIVE" "$REMOTE:$REMOTE_DIR/blueedge-src.tar.gz"

ssh "$REMOTE" "
  set -euo pipefail
  cd '$REMOTE_DIR'
  tar -xzf blueedge-src.tar.gz
  if [ ! -f .env ]; then
    cp deploy/.env.example .env
    echo 'Created $REMOTE_DIR/.env from template. Edit it with real secrets, then rerun this script.'
    exit 2
  fi
  docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
  docker compose --env-file .env -f deploy/docker-compose.yml ps
"
