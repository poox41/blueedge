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
NODE_GROUP_NAME="${REGRESSION_NODE_GROUP:-edge-group}"
EDGE_UNIT_NAME="${PREFIX}-edgeunit"
ACCESS_CONFIG_NAME="${PREFIX}-access-config"
BATCH_TASK_ID=""
BATCH_WORKLOAD_ID=""
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
    [ -n "$BATCH_WORKLOAD_ID" ] && request DELETE "/blueedge/workloads/batch/$BATCH_WORKLOAD_ID" >/dev/null 2>&1 || true
    request DELETE "/blueedge/access-configs/$ACCESS_CONFIG_NAME" >/dev/null 2>&1 || true
    request DELETE "/blueedge/edge-units/$EDGE_UNIT_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

expect_contains() {
  local label="$1"
  local content="$2"
  local expected="$3"
  if printf '%s' "$content" | grep -Fq -- "$expected"; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s missing %s: %s\n' "$label" "$expected" "$(printf '%s' "$content" | head -c 300)"
    exit 1
  fi
}

login

edge_body="{\"name\":\"$EDGE_UNIT_NAME\",\"nodeGroupRef\":\"$NODE_GROUP_NAME\",\"clusterName\":\"regression-cluster\",\"accessType\":\"external\",\"kubeEdgeVersion\":\"v1.21.0\",\"insightStatus\":\"unknown\",\"monitorStatus\":\"unknown\",\"description\":\"regression edgeunit\"}"
edge_created="$(request POST /blueedge/edge-units "$edge_body")"
expect_contains "create EdgeUnit ConfigMap" "$edge_created" '"rawRef":{"kind":"EdgeUnitConfigMap"'
expect_contains "get EdgeUnit detail" "$(request GET "/blueedge/edge-units/$EDGE_UNIT_NAME")" '"item":'
expect_contains "delete EdgeUnit ConfigMap" "$(request DELETE "/blueedge/edge-units/$EDGE_UNIT_NAME")" '"edgeunit.delete"'

access_body="{\"name\":\"$ACCESS_CONFIG_NAME\",\"nodeName\":\"${PREFIX}-node\",\"edgeUnitRef\":\"$NODE_GROUP_NAME\",\"architecture\":\"amd64\",\"os\":\"linux\",\"kubeEdgeVersion\":\"v1.21.0\",\"cloudCoreAddress\":\"127.0.0.1:10000\",\"protocol\":\"https\",\"driver\":\"systemd\",\"criAddress\":\"/run/containerd/containerd.sock\",\"labels\":{\"blueedge.io/test\":\"create\"},\"description\":\"regression access config\"}"
access_created="$(request POST /blueedge/access-configs "$access_body")"
expect_contains "create AccessConfig" "$access_created" "\"name\":\"$ACCESS_CONFIG_NAME\""
expect_contains "persist AccessConfig driver" "$access_created" '"driver":"systemd"'
expect_contains "persist AccessConfig criAddress" "$access_created" '"criAddress":"/run/containerd/containerd.sock"'
access_update="{\"edgeUnitRef\":\"$NODE_GROUP_NAME\",\"nodeName\":\"${PREFIX}-node\",\"architecture\":\"amd64\",\"os\":\"linux\",\"kubeEdgeVersion\":\"v1.21.0\",\"cloudCoreAddress\":\"127.0.0.1:10000\",\"protocol\":\"https\",\"driver\":\"cgroups\",\"criAddress\":\"/var/run/dockershim.sock\",\"labels\":{\"blueedge.io/test\":\"update\"},\"description\":\"regression access config\"}"
request PUT "/blueedge/access-configs/$ACCESS_CONFIG_NAME" "$access_update" >/dev/null
access_detail="$(request GET "/blueedge/access-configs/$ACCESS_CONFIG_NAME")"
expect_contains "get AccessConfig updated driver" "$access_detail" '"driver":"cgroups"'
expect_contains "get AccessConfig updated criAddress" "$access_detail" '"criAddress":"/var/run/dockershim.sock"'
expect_contains "get AccessConfig updated labels" "$access_detail" '"blueedge.io/test":"update"'
install_command="$(request GET "/blueedge/access-configs/$ACCESS_CONFIG_NAME/install-command")"
expect_contains "install command prepares keadm" "$install_command" 'keadm-v1.21.0-linux-amd64.tar.gz'
expect_contains "install command uses criAddress" "$install_command" '--remote-runtime-endpoint=unix:///var/run/dockershim.sock'
expect_contains "install command uses driver" "$install_command" '--cgroupdriver=cgroupfs'
expect_contains "delete AccessConfig" "$(request DELETE "/blueedge/access-configs/$ACCESS_CONFIG_NAME")" '"access-config.delete"'

if [ "${RUN_REAL_IMAGE_PREHEAT_TESTS:-false}" = "true" ]; then
  if [ -z "${IMAGE_PREHEAT_NODE:-}" ]; then
    printf 'IMAGE_PREHEAT_NODE is required when RUN_REAL_IMAGE_PREHEAT_TESTS=true\n' >&2
    exit 1
  fi
  task_body="{\"name\":\"${PREFIX}-image-preheat\",\"targetType\":\"node\",\"targetRefs\":[\"$IMAGE_PREHEAT_NODE\"],\"images\":[\"nginx:1.25\"],\"failureRateThreshold\":10,\"resourceChecks\":[\"CPU\",\"内存\",\"磁盘\"],\"description\":\"real ImagePrePullJob regression task\"}"
  task_created="$(request POST /blueedge/batch-tasks/image-preheat "$task_body")"
  expect_contains "create real ImagePrePullJob" "$task_created" '"executionMode":"imagePrePullJob"'
  BATCH_TASK_ID="$(printf '%s' "$task_created" | sed -E 's/.*"id":"([^"]+)".*/\1/')"
  expect_contains "get ImagePrePullJob detail" "$(request GET "/blueedge/batch-tasks/$BATCH_TASK_ID")" '"rawRef":{"kind":"ImagePrePullJob"'
  expect_contains "get ImagePrePullJob audit" "$(request GET "/blueedge/batch-tasks/$BATCH_TASK_ID/audit")" '"action":"create ImagePrePullJob"'
  expect_contains "delete ImagePrePullJob" "$(request DELETE "/blueedge/batch-tasks/$BATCH_TASK_ID")" '"warnings"'
  BATCH_TASK_ID=""
else
  printf 'SKIP real ImagePrePullJob regression. Set RUN_REAL_IMAGE_PREHEAT_TESTS=true and IMAGE_PREHEAT_NODE to execute an actual image pull.\n'
fi

workload_body="{\"name\":\"${PREFIX}-batch-workload\",\"targetType\":\"deployment\",\"targetRefs\":[\"$NODE_GROUP_NAME\"],\"image\":\"nginx:1.25\",\"failurePolicy\":\"continue\",\"description\":\"plan schema regression\",\"plan\":{\"namespace\":\"default\",\"name\":\"${PREFIX}-deployment\",\"targetGroups\":[\"$NODE_GROUP_NAME\"],\"replicas\":2,\"workloadType\":\"Deployment\",\"podTemplate\":{\"containers\":[{\"name\":\"main\",\"image\":\"nginx:1.25\",\"imagePullPolicy\":\"IfNotPresent\",\"command\":[\"/bin/sh\"],\"args\":[\"-c\",\"echo-ready\"],\"env\":[{\"name\":\"MODE\",\"value\":\"regression\"}],\"resources\":{\"requests\":{\"cpu\":\"100m\",\"memory\":\"128Mi\"},\"limits\":{\"cpu\":\"500m\",\"memory\":\"256Mi\"}}},{\"name\":\"sidecar\",\"image\":\"busybox:1.36\"}]}}}"
workload_created="$(request POST /blueedge/workloads/batch "$workload_body")"
BATCH_WORKLOAD_ID="$(printf '%s' "$workload_created" | sed -E 's/.*"id":"([^"]+)".*/\1/')"
expect_contains "BatchWorkload plan persisted" "$workload_created" '"replicas":2'
expect_contains "BatchWorkload multi-container persisted" "$workload_created" '"name":"sidecar"'
expect_contains "BatchWorkload env persisted" "$workload_created" '"name":"MODE","value":"regression"'
expect_contains "BatchWorkload resources persisted" "$workload_created" '"cpu":"100m"'
workload_detail="$(request GET "/blueedge/workloads/batch/$BATCH_WORKLOAD_ID")"
expect_contains "BatchWorkload detail returns command" "$workload_detail" '"command":["/bin/sh"]'
expect_contains "BatchWorkload detail returns args" "$workload_detail" '"args":["-c","echo-ready"]'
request POST "/blueedge/batch-tasks/$BATCH_WORKLOAD_ID/cancel" >/dev/null
expect_contains "delete BatchWorkload plan and Deployments" "$(request DELETE "/blueedge/workloads/batch/$BATCH_WORKLOAD_ID")" 'managed Deployments deleted'
BATCH_WORKLOAD_ID=""

printf 'PASS write regression tests completed and cleaned up.\n'
