#!/usr/bin/env bash
set -euo pipefail

PHASE="${PHASE:-}"
BASE_URL="${BASE_URL:-http://127.0.0.1:7001}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [ -z "$ADMIN_PASSWORD" ]; then
  printf 'ADMIN_PASSWORD is required\n' >&2
  exit 1
fi
PREFIX="${PERSISTENCE_PREFIX:-blueedge-persistence-test-}"
EDGE_UNIT_NAME="${PREFIX}edgeunit"
ACCESS_CONFIG_NAME="${PREFIX}access-config"
BATCH_TASK_NAME="${PREFIX}batch-workload"
NODE_GROUP_REF="${PERSISTENCE_NODE_GROUP_REF:-edge-group}"
TOKEN=""

usage() {
  cat <<'EOF'
Usage:
  RUN_WRITE_TESTS=true PHASE=create  bash scripts/persistence-regression-test.sh
  PHASE=verify                       bash scripts/persistence-regression-test.sh
  RUN_WRITE_TESTS=true PHASE=cleanup bash scripts/persistence-regression-test.sh

Create phase writes only BlueEdge metadata ConfigMaps with prefix blueedge-persistence-test-.
It does not create or modify NodeGroup, Node, or Deployment resources.
EOF
}

if [ "$PHASE" != "create" ] && [ "$PHASE" != "verify" ] && [ "$PHASE" != "cleanup" ]; then
  usage
  exit 1
fi

if { [ "$PHASE" = "create" ] || [ "$PHASE" = "cleanup" ]; } && [ "${RUN_WRITE_TESTS:-false}" != "true" ]; then
  printf 'SKIP %s requires RUN_WRITE_TESTS=true.\n' "$PHASE"
  exit 0
fi

login() {
  local output
  output="$(curl -sS -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" \
    "$BASE_URL/auth/login")"
  TOKEN="$(printf '%s' "$output" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token||""))')"
  if [ -z "$TOKEN" ]; then
    printf 'FAIL login token missing.\n'
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

expect_named_item() {
  local label="$1"
  local content="$2"
  local name="$3"
  if printf '%s' "$content" | NAME="$name" node -e '
    let source="";
    process.stdin.on("data", chunk => source += chunk).on("end", () => {
      const body = JSON.parse(source);
      const items = Array.isArray(body.items) ? body.items : body.item ? [body.item] : [];
      if (!items.some(item => item?.name === process.env.NAME || item?.id === process.env.NAME)) process.exit(1);
    });
  '; then
    printf 'PASS %s exists: %s\n' "$label" "$name"
  else
    printf 'FAIL %s missing: %s\n' "$label" "$name"
    exit 1
  fi
}

batch_task_id() {
  request GET /blueedge/batch-tasks | NAME="$BATCH_TASK_NAME" node -e '
    let source="";
    process.stdin.on("data", chunk => source += chunk).on("end", () => {
      const body = JSON.parse(source);
      const item = (body.items || []).find(current => current?.name === process.env.NAME);
      process.stdout.write(item?.id || "");
    });
  '
}

verify_all() {
  expect_named_item "EdgeUnit ConfigMap" "$(request GET /blueedge/edge-units)" "$EDGE_UNIT_NAME"
  expect_named_item "AccessConfig ConfigMap" "$(request GET /blueedge/access-configs)" "$ACCESS_CONFIG_NAME"
  expect_named_item "planOnly BatchTask ConfigMap" "$(request GET /blueedge/batch-tasks)" "$BATCH_TASK_NAME"
}

login

if [ "$PHASE" = "create" ]; then
  edge_body="{\"name\":\"$EDGE_UNIT_NAME\",\"nodeGroupRef\":\"$NODE_GROUP_REF\",\"clusterName\":\"persistence-regression\",\"accessType\":\"external\",\"kubeEdgeVersion\":\"v1.21.0\",\"insightStatus\":\"unknown\",\"monitorStatus\":\"unknown\",\"description\":\"persistence regression EdgeUnit\"}"
  request POST /blueedge/edge-units "$edge_body" >/dev/null

  access_body="{\"name\":\"$ACCESS_CONFIG_NAME\",\"nodeName\":\"${PREFIX}node-placeholder\",\"edgeUnitRef\":\"$EDGE_UNIT_NAME\",\"architecture\":\"amd64\",\"os\":\"linux\",\"kubeEdgeVersion\":\"v1.21.0\",\"cloudCoreAddress\":\"127.0.0.1:10000\",\"protocol\":\"https\",\"description\":\"persistence regression AccessConfig\"}"
  request POST /blueedge/access-configs "$access_body" >/dev/null

  task_body="{\"name\":\"$BATCH_TASK_NAME\",\"targetType\":\"deployment\",\"targetRefs\":[\"default/${PREFIX}deployment-placeholder\"],\"image\":\"nginx:1.25\",\"failurePolicy\":\"continue\",\"description\":\"planOnly persistence regression\",\"targets\":[{\"namespace\":\"default\",\"executionMode\":\"planOnly\"}]}"
  request POST /blueedge/workloads/batch "$task_body" >/dev/null

  verify_all
  printf '\nCREATE PHASE COMPLETE. Restart api-gateway now, then run:\n'
  printf '  PHASE=verify bash scripts/persistence-regression-test.sh\n'
  printf 'After verification, clean up with:\n'
  printf '  RUN_WRITE_TESTS=true PHASE=cleanup bash scripts/persistence-regression-test.sh\n'
  exit 0
fi

if [ "$PHASE" = "verify" ]; then
  verify_all
  printf 'PASS all three ConfigMap-backed resources survived the Gateway restart.\n'
  exit 0
fi

task_id="$(batch_task_id)"
if [ -n "$task_id" ]; then
  request DELETE "/blueedge/batch-tasks/$task_id" >/dev/null
fi
request DELETE "/blueedge/access-configs/$ACCESS_CONFIG_NAME" >/dev/null 2>&1 || true
request DELETE "/blueedge/edge-units/$EDGE_UNIT_NAME" >/dev/null 2>&1 || true

if [ -n "$(batch_task_id)" ]; then
  printf 'FAIL BatchTask cleanup incomplete.\n'
  exit 1
fi
printf 'PASS persistence regression resources cleaned up.\n'
