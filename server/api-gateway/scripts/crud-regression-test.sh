#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:7001}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [ -z "$ADMIN_PASSWORD" ]; then
  printf 'ADMIN_PASSWORD is required\n' >&2
  exit 1
fi

if [ "${RUN_WRITE_TESTS:-false}" != "true" ]; then
  printf 'SKIP write regression tests. Set RUN_WRITE_TESTS=true to execute.\n'
  exit 0
fi
PREFIX="${REGRESSION_PREFIX:-blueedge-regression}"
EDGE_UNIT_NAME="${PREFIX}-edgeunit"
ACCESS_CONFIG_NAME="${PREFIX}-access-config"
BATCH_TASK_ID=""
TOKEN=""

login() {
  local output
  output="$(curl -sS -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" \
    "$BASE_URL/auth/login")"
  TOKEN="$(printf '%s' "$output" | sed -E 's/.*"token":"([^"]+)".*/\1/')"
  if [ -z "$TOKEN" ] || [ "$TOKEN" = "$output" ]; then
    printf 'FAIL login token missing: %s\n' "$output"
    exit 1
  fi
}

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body" "$BASE_URL$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE_URL$path"
  fi
}

cleanup() {
  if [ -n "$TOKEN" ]; then
    [ -n "$BATCH_TASK_ID" ] && request POST "/blueedge/batch-tasks/$BATCH_TASK_ID/cancel" >/dev/null 2>&1 || true
    [ -n "$BATCH_TASK_ID" ] && request DELETE "/blueedge/batch-tasks/$BATCH_TASK_ID" >/dev/null 2>&1 || true
    request DELETE "/blueedge/access-configs/$ACCESS_CONFIG_NAME" >/dev/null 2>&1 || true
    request DELETE "/blueedge/edge-units/$EDGE_UNIT_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

expect_contains() {
  local label="$1"
  local content="$2"
  local expected="$3"
  if printf '%s' "$content" | grep -Fq "$expected"; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s missing %s: %s\n' "$label" "$expected" "$(printf '%s' "$content" | head -c 300)"
    exit 1
  fi
}

login

edge_body="{\"name\":\"$EDGE_UNIT_NAME\",\"nodeGroupRef\":\"edge-group\",\"clusterName\":\"regression-cluster\",\"accessType\":\"external\",\"kubeEdgeVersion\":\"v1.21.0\",\"insightStatus\":\"unknown\",\"monitorStatus\":\"unknown\",\"description\":\"regression edgeunit\"}"
edge_created="$(request POST /blueedge/edge-units "$edge_body")"
expect_contains "create EdgeUnit ConfigMap" "$edge_created" '"rawRef":{"kind":"EdgeUnitConfigMap"'
expect_contains "get EdgeUnit detail" "$(request GET "/blueedge/edge-units/$EDGE_UNIT_NAME")" '"item":'
expect_contains "delete EdgeUnit ConfigMap" "$(request DELETE "/blueedge/edge-units/$EDGE_UNIT_NAME")" '"edgeunit.delete"'

access_body="{\"name\":\"$ACCESS_CONFIG_NAME\",\"nodeName\":\"${PREFIX}-node\",\"edgeUnitRef\":\"edge-group\",\"architecture\":\"amd64\",\"os\":\"linux\",\"kubeEdgeVersion\":\"v1.21.0\",\"cloudCoreAddress\":\"127.0.0.1:10000\",\"protocol\":\"https\",\"description\":\"regression access config\"}"
access_created="$(request POST /blueedge/access-configs "$access_body")"
expect_contains "create AccessConfig" "$access_created" "\"name\":\"$ACCESS_CONFIG_NAME\""
expect_contains "get AccessConfig detail" "$(request GET "/blueedge/access-configs/$ACCESS_CONFIG_NAME")" '"item":'
expect_contains "delete AccessConfig" "$(request DELETE "/blueedge/access-configs/$ACCESS_CONFIG_NAME")" '"access-config.delete"'

task_body="{\"name\":\"${PREFIX}-batch-task\",\"targetType\":\"deployment\",\"targetRefs\":[\"default/${PREFIX}-noop\"],\"images\":[\"nginx:1.25\"],\"description\":\"planOnly regression task\"}"
task_created="$(request POST /blueedge/batch-tasks/image-preheat "$task_body")"
expect_contains "create BatchTask" "$task_created" '"executionMode":"planOnly"'
BATCH_TASK_ID="$(printf '%s' "$task_created" | sed -E 's/.*"id":"([^"]+)".*/\1/')"
expect_contains "get BatchTask detail" "$(request GET "/blueedge/batch-tasks/$BATCH_TASK_ID")" '"item":'
expect_contains "start BatchTask" "$(request POST "/blueedge/batch-tasks/$BATCH_TASK_ID/start")" '"status":"running"'
expect_contains "cancel BatchTask" "$(request POST "/blueedge/batch-tasks/$BATCH_TASK_ID/cancel")" '"status":"cancelled"'
expect_contains "delete BatchTask" "$(request DELETE "/blueedge/batch-tasks/$BATCH_TASK_ID")" '"warnings"'
BATCH_TASK_ID=""

printf 'PASS write regression tests completed and cleaned up.\n'
