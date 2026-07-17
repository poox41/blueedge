#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/upstream/kubeedge-dashboard/modules/api"
RUNTIME_DIR="${BLUEEDGE_RUNTIME_DIR:-/tmp/blueedge-dev-stack}"

SSH_HOST="${SSH_HOST:-root@14.103.163.121}"
REMOTE_APISERVER_HOST="${REMOTE_APISERVER_HOST:-192.168.16.52}"
REMOTE_APISERVER_PORT="${REMOTE_APISERVER_PORT:-6443}"
LOCAL_APISERVER_PORT="${LOCAL_APISERVER_PORT:-16443}"

BFF_PORT="${BFF_PORT:-8080}"
GATEWAY_PORT="${GATEWAY_PORT:-7001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-2026@bluedot}"
JWT_SECRET="${JWT_SECRET:-blueedge-dev-secret}"
K8S_TOKEN="${K8S_TOKEN:-}"

BFF_BASE_URL="http://127.0.0.1:${BFF_PORT}/api/v1"
KUBE_APISERVER="https://127.0.0.1:${LOCAL_APISERVER_PORT}"

mkdir -p "$RUNTIME_DIR"

pid_file() {
  echo "$RUNTIME_DIR/$1.pid"
}

log_file() {
  echo "$RUNTIME_DIR/$1.log"
}

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local name="$1"
  local port="$2"
  local retry="${3:-30}"

  for _ in $(seq 1 "$retry"); do
    if is_port_listening "$port"; then
      echo "OK: $name is listening on $port"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: $name did not start on port $port"
  return 1
}

ensure_node_modules() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing npm dependencies in $dir ..."
    (cd "$dir" && npm install)
  fi
}

start_tunnel() {
  if is_port_listening "$LOCAL_APISERVER_PORT"; then
    echo "SKIP: local apiserver tunnel already listens on 127.0.0.1:$LOCAL_APISERVER_PORT"
    return
  fi

  echo "Starting SSH tunnel:"
  echo "  127.0.0.1:$LOCAL_APISERVER_PORT -> $REMOTE_APISERVER_HOST:$REMOTE_APISERVER_PORT via $SSH_HOST"
  echo "  Enter SSH password if prompted."

  # Ignore user-level SSH forwarding rules (for example RemoteForward 7897),
  # otherwise an unrelated occupied remote port can abort this K8s tunnel.
  ssh -F /dev/null -f -N \
    -L "${LOCAL_APISERVER_PORT}:${REMOTE_APISERVER_HOST}:${REMOTE_APISERVER_PORT}" \
    -o ExitOnForwardFailure=yes \
    "$SSH_HOST"

  wait_for_port "SSH tunnel" "$LOCAL_APISERVER_PORT" 10
}

start_bff() {
  if is_port_listening "$BFF_PORT"; then
    echo "SKIP: official BFF already listens on 127.0.0.1:$BFF_PORT"
    return
  fi

  if [ ! -d "$API_DIR" ]; then
    echo "ERROR: missing $API_DIR. Run ./scripts/init-upstream.sh first."
    exit 1
  fi

  echo "Starting official BFF on 127.0.0.1:$BFF_PORT ..."
  (
    cd "$API_DIR"
    nohup go run main.go \
      --apiserver-host="$KUBE_APISERVER" \
      --apiserver-skip-tls-verify=true \
      --insecure-port="$BFF_PORT" \
      </dev/null \
      >"$(log_file bff)" 2>&1 &
    echo $! >"$(pid_file bff)"
  )

  wait_for_port "official BFF" "$BFF_PORT" 30
}

start_gateway() {
  if is_port_listening "$GATEWAY_PORT"; then
    echo "SKIP: api-gateway already listens on 127.0.0.1:$GATEWAY_PORT"
    return
  fi

  ensure_node_modules "$ROOT_DIR/server/api-gateway"

  echo "Starting api-gateway on 127.0.0.1:$GATEWAY_PORT ..."
  (
    cd "$ROOT_DIR/server/api-gateway"
    nohup env \
      PORT="$GATEWAY_PORT" \
      ADMIN_USERNAME="$ADMIN_USERNAME" \
      ADMIN_PASSWORD="$ADMIN_PASSWORD" \
      JWT_SECRET="$JWT_SECRET" \
      BFF_BASE_URL="$BFF_BASE_URL" \
      K8S_API_SERVER="$KUBE_APISERVER" \
      K8S_SKIP_TLS_VERIFY="true" \
      K8S_TOKEN="$K8S_TOKEN" \
      npm run dev \
      </dev/null \
      >"$(log_file gateway)" 2>&1 &
    echo $! >"$(pid_file gateway)"
  )

  wait_for_port "api-gateway" "$GATEWAY_PORT" 30
}

start_frontend() {
  if is_port_listening "$FRONTEND_PORT"; then
    echo "SKIP: frontend already listens on 127.0.0.1:$FRONTEND_PORT"
    return
  fi

  ensure_node_modules "$ROOT_DIR/frontend"

  echo "Starting frontend on 127.0.0.1:$FRONTEND_PORT ..."
  (
    cd "$ROOT_DIR/frontend"
    nohup env \
      VITE_BFF_BASE_URL="/product-api/bff" \
      VITE_GATEWAY_BASE_URL="/product-api" \
      VITE_GATEWAY_PROXY_TARGET="http://127.0.0.1:$GATEWAY_PORT" \
      npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
      </dev/null \
      >"$(log_file frontend)" 2>&1 &
    echo $! >"$(pid_file frontend)"
  )

  wait_for_port "frontend" "$FRONTEND_PORT" 30
}

stop_one() {
  local name="$1"
  local file
  file="$(pid_file "$name")"

  if [ ! -f "$file" ]; then
    echo "SKIP: no pid file for $name"
    return
  fi

  local pid
  pid="$(cat "$file")"
  if kill "$pid" >/dev/null 2>&1; then
    echo "Stopped $name pid $pid"
  else
    echo "SKIP: $name pid $pid is not running"
  fi
  rm -f "$file"
}

status_one() {
  local name="$1"
  local port="$2"
  if is_port_listening "$port"; then
    echo "RUNNING: $name on port $port"
  else
    echo "STOPPED: $name on port $port"
  fi
}

start_all() {
  start_tunnel
  start_bff
  start_gateway
  start_frontend

  echo
  echo "BlueEdge dev stack is ready."
  echo "Frontend:    http://localhost:$FRONTEND_PORT/"
  echo "Gateway:     http://127.0.0.1:$GATEWAY_PORT"
  echo "BFF:         http://127.0.0.1:$BFF_PORT/api/v1"
  echo "Kube API:    $KUBE_APISERVER -> $REMOTE_APISERVER_HOST:$REMOTE_APISERVER_PORT"
  echo "Logs:        $RUNTIME_DIR"
  echo
  echo "Login:"
  echo "  username: $ADMIN_USERNAME"
  echo "  password: $ADMIN_PASSWORD"
}

stop_all() {
  stop_one frontend
  stop_one gateway
  stop_one bff
  echo
  echo "Note: SSH tunnel is not stopped by pid file because ssh -f backgrounds itself."
  echo "If needed, close it manually with:"
  echo "  pkill -f 'ssh -F /dev/null -f -N -L ${LOCAL_APISERVER_PORT}:${REMOTE_APISERVER_HOST}:${REMOTE_APISERVER_PORT} ${SSH_HOST}'"
}

status_all() {
  status_one "SSH tunnel" "$LOCAL_APISERVER_PORT"
  status_one "official BFF" "$BFF_PORT"
  status_one "api-gateway" "$GATEWAY_PORT"
  status_one "frontend" "$FRONTEND_PORT"
  echo "Logs: $RUNTIME_DIR"
}

case "${1:-start}" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  status)
    status_all
    ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
