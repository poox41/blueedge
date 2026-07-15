#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:7001}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [ -z "$ADMIN_PASSWORD" ]; then
  printf 'ADMIN_PASSWORD is required\n' >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
TOKEN=""

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'PASS %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf 'FAIL %s\n' "$1"
}

skip() {
  SKIP_COUNT=$((SKIP_COUNT + 1))
  printf 'SKIP %s\n' "$1"
}

request() {
  local method="$1"
  local path="$2"
  local output status
  output="$(mktemp)"
  status="$(curl -sS -o "$output" -w '%{http_code}' -X "$method" \
    ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
    "$BASE_URL$path" || true)"
  printf '%s\n%s\n' "$status" "$output"
}

check_status() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected="${4:-200}"
  local result status output
  result="$(request "$method" "$path")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  if [ "$status" = "$expected" ]; then
    pass "$name $method $path -> $status"
  else
    fail "$name $method $path -> $status $(head -c 200 "$output")"
  fi
  rm -f "$output"
}

check_optional_detail() {
  local name="$1"
  local method="$2"
  local path="$3"
  local result status output
  result="$(request "$method" "$path")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  if [ "$status" = "200" ]; then
    pass "$name $method $path -> $status"
  elif [ "$status" = "404" ]; then
    skip "$name $method $path -> $status"
  else
    fail "$name $method $path -> $status $(head -c 200 "$output")"
  fi
  rm -f "$output"
}

check_contains() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected="$4"
  local result status output
  result="$(request "$method" "$path")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  if [ "$status" != "200" ]; then
    fail "$name $method $path -> $status $(head -c 200 "$output")"
  elif grep -Fq "$expected" "$output"; then
    pass "$name $method $path contains $expected"
  else
    fail "$name $method $path missing $expected $(head -c 200 "$output")"
  fi
  rm -f "$output"
}

check_optional_contains() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected="$4"
  local result status output
  result="$(request "$method" "$path")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  if [ "$status" = "404" ]; then
    skip "$name $method $path -> $status"
  elif [ "$status" != "200" ]; then
    fail "$name $method $path -> $status $(head -c 200 "$output")"
  elif grep -Fq "$expected" "$output"; then
    pass "$name $method $path contains $expected"
  else
    fail "$name $method $path missing $expected $(head -c 200 "$output")"
  fi
  rm -f "$output"
}

check_optional_json_fields() {
  local name="$1"
  local path="$2"
  shift 2
  local result status output fields
  result="$(request GET "$path")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  fields="$(printf '%s\n' "$@" | paste -sd, -)"
  if [ "$status" = "404" ]; then
    skip "$name GET $path -> $status"
  elif [ "$status" != "200" ]; then
    fail "$name GET $path -> $status $(head -c 200 "$output")"
  elif node -e '
    const fs = require("fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const fields = process.argv.slice(2);
    for (const field of fields) {
      if (field === "warnings") {
        if (payload.warnings !== undefined && !Array.isArray(payload.warnings)) process.exit(1);
        continue;
      }
      let value = payload;
      for (const part of field.split(".")) {
        if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(value, part)) process.exit(1);
        value = value[part];
      }
    }
  ' "$output" "$@"; then
    pass "$name GET $path fields $fields"
  else
    fail "$name GET $path invalid fields $fields $(head -c 200 "$output")"
  fi
  rm -f "$output"
}

check_json_fields_or_503() {
  local name="$1"
  local path="$2"
  shift 2
  local result status output
  result="$(request GET "$path")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  if [ "$status" = "503" ] && grep -Fq '"message"' "$output"; then
    pass "$name GET $path -> 503 contract fallback"
  elif [ "$status" != "200" ]; then
    fail "$name GET $path -> $status $(head -c 200 "$output")"
  elif node -e '
    const fs = require("fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const field of process.argv.slice(2)) {
      let value = payload;
      for (const part of field.split(".")) {
        if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(value, part)) process.exit(1);
        value = value[part];
      }
    }
  ' "$output" "$@"; then
    pass "$name GET $path fields $(printf '%s,' "$@")"
  else
    fail "$name GET $path invalid JSON fields $(head -c 200 "$output")"
  fi
  rm -f "$output"
}

check_text_response() {
  local name="$1"
  local path="$2"
  local result status output content_type
  result="$(request GET "$path")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  content_type="$(curl -sSI ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$BASE_URL$path" | tr -d '\r' | sed -n 's/^content-type: //Ip' | head -1)"
  if [ "$status" = "200" ] && printf '%s' "$content_type" | grep -Fqi 'text/plain'; then
    pass "$name GET $path -> text/plain"
  else
    fail "$name GET $path -> $status content-type=$content_type $(head -c 200 "$output")"
  fi
  rm -f "$output"
}

discover_edgeapp() {
  local result status output selection
  result="$(request GET "/bff/edgeapplication")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  if [ "$status" = "200" ]; then
    selection="$(node -e '
      const fs = require("fs");
      const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data?.items) ? payload.data.items : [];
      const item = items[0];
      if (item) process.stdout.write(`${item.metadata?.namespace || item.namespace || "default"}/${item.metadata?.name || item.name || ""}`);
    ' "$output")"
    printf '%s' "$selection"
  fi
  rm -f "$output"
}

discover_deployment() {
  local result status output selection
  result="$(request GET "/bff/deployment")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '2p')"
  if [ "$status" = "200" ]; then
    selection="$(node -e '
      const fs = require("fs");
      const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data?.items) ? payload.data.items : Array.isArray(payload.data) ? payload.data : [];
      const item = items[0];
      if (item) process.stdout.write(`${item.metadata?.namespace || item.namespace || "default"}/${item.metadata?.name || item.name || ""}`);
    ' "$output")"
    printf '%s' "$selection"
  fi
  rm -f "$output"
}

login_output="$(mktemp)"
login_status="$(curl -sS -o "$login_output" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/auth/login" || true)"
if [ "$login_status" != "200" ]; then
  fail "login POST /auth/login -> $login_status $(head -c 200 "$login_output")"
  rm -f "$login_output"
  printf 'Summary: pass=%s fail=%s skip=%s\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
  exit 1
fi
TOKEN="$(sed -E 's/.*"token":"([^"]+)".*/\1/' "$login_output")"
rm -f "$login_output"
if [ -z "$TOKEN" ]; then
  fail "login token missing"
  printf 'Summary: pass=%s fail=%s skip=%s\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
  exit 1
fi
pass "login POST /auth/login -> 200"

check_status "health" GET "/healthz"
check_status "edge-units list" GET "/blueedge/edge-units"
check_contains "edge-units list structure" GET "/blueedge/edge-units" '"items":['
check_optional_detail "edge-units detail" GET "/blueedge/edge-units/edge-demo"
check_optional_contains "edge-units detail structure" GET "/blueedge/edge-units/edge-demo" '"item":'
check_status "access-configs list" GET "/blueedge/access-configs"
check_contains "access-configs list structure" GET "/blueedge/access-configs" '"items":['
check_status "batch-tasks list" GET "/blueedge/batch-tasks"
check_contains "batch-tasks list structure" GET "/blueedge/batch-tasks" '"items":['
check_optional_detail "node summary" GET "/blueedge/nodes/k8s-worker01/summary"
check_optional_json_fields "node summary structure" "/blueedge/nodes/k8s-worker01/summary" "item.name" "item.metrics.available" "item.pods.total" "warnings"
check_optional_detail "nodegroup summary" GET "/blueedge/nodegroups/edge-group/summary"
check_optional_json_fields "nodegroup summary structure" "/blueedge/nodegroups/edge-group/summary" "item.name" "item.nodes.total" "item.matchedNodes" "warnings"
check_optional_detail "pod summary" GET "/blueedge/pods/default/cloudflared-tunnel-967c446b-dmjpb/summary"
check_optional_json_fields "pod summary structure" "/blueedge/pods/default/cloudflared-tunnel-967c446b-dmjpb/summary?tailLines=5" "item.name" "item.metrics.available" "item.events" "item.recentLogs.available" "warnings"
edgeapp_ref="${EDGEAPP_NAMESPACE:-}/${EDGEAPP_NAME:-}"
if [ "$edgeapp_ref" = "/" ]; then
  edgeapp_ref="$(discover_edgeapp)"
fi
if [ -n "$edgeapp_ref" ] && [ "$edgeapp_ref" != "/" ]; then
  check_optional_json_fields "edgeapp summary structure" "/blueedge/edgeapps/$edgeapp_ref/summary" "item.name" "item.status" "item.targetNodeGroups" "warnings"
else
  skip "edgeapp summary structure no test resource"
fi
deployment_ref="${DEPLOYMENT_NAMESPACE:-}/${DEPLOYMENT_NAME:-}"
if [ "$deployment_ref" = "/" ]; then
  deployment_ref="$(discover_deployment)"
fi
if [ -n "$deployment_ref" ] && [ "$deployment_ref" != "/" ]; then
  check_optional_json_fields "deployment revisions structure" "/blueedge/deployments/$deployment_ref/revisions" "items" "currentRevision" "source"
  check_optional_json_fields "deployment audit structure" "/blueedge/deployments/$deployment_ref/audit" "items" "source" "completeAuditLog" "warning"
else
  skip "deployment revisions structure no test resource"
  skip "deployment audit structure no test resource"
fi
check_status "pv summary list" GET "/blueedge/storage/persistentvolumes/summary"
check_status "pvc summary list" GET "/blueedge/storage/persistentvolumeclaims/summary"
check_status "devicemodel summary list" GET "/blueedge/devicemodels/summary"
check_status "device summary list" GET "/blueedge/devices/summary"
check_contains "connected cluster list" GET "/blueedge/clusters" '"current":true'
check_optional_detail "observability node" GET "/blueedge/observability/resources/node/_/k8s-worker01"
check_optional_detail "observability pod logs" GET "/blueedge/observability/resources/pod/default/cloudflared-tunnel-967c446b-dmjpb/logs?tailLines=5"
check_status "bff nodegroup proxy" GET "/bff/nodegroup"
check_json_fields_or_503 "cluster metrics" "/metrics/cluster" "timestamp" "cpu" "memory" "source"
check_json_fields_or_503 "cluster metrics history" "/metrics/cluster/history" "items" "source"
check_json_fields_or_503 "node metrics" "/metrics/nodes" "items"
check_json_fields_or_503 "pod metrics" "/metrics/pods?namespace=default" "items"
check_json_fields_or_503 "events" "/events?namespace=default" "items"
check_json_fields_or_503 "legacy pod list" "/workloads/pods?namespace=default" "items"
check_text_response "legacy pod logs" "/workloads/pods/default/cloudflared-tunnel-967c446b-dmjpb/logs?tailLines=5"
check_json_fields_or_503 "legacy pv list" "/storage/persistentvolumes" "items"
check_json_fields_or_503 "legacy pvc list" "/storage/persistentvolumeclaims?namespace=default" "items"
check_json_fields_or_503 "legacy overview" "/overview" "nodes" "workloads" "devices" "rules"

printf 'Summary: pass=%s fail=%s skip=%s\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
