#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:7001}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
PHASE="${PHASE:-all}"
NAMESPACE="${DEVICE_TEST_NAMESPACE:-kubeedge}"
MODEL="${DEVICE_TEST_MODEL:-e2e-temperature-model}"
DEVICE="${DEVICE_TEST_NAME:-e2e-temperature-device}"
NODE="${DEVICE_TEST_NODE:-k8s-laptop-edge}"
TOKEN=""

if [ "${RUN_WRITE_TESTS:-false}" != "true" ]; then
  printf 'SKIP device write regression. Set RUN_WRITE_TESTS=true to execute.\n'
  exit 0
fi
if [ -z "$ADMIN_PASSWORD" ]; then
  printf 'ADMIN_PASSWORD is required\n' >&2
  exit 1
fi

login() {
  local output
  output="$(curl -sS -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE_URL/auth/login")"
  TOKEN="$(printf '%s' "$output" | jq -r '.token // empty')"
  [ -n "$TOKEN" ] || { printf 'FAIL login token missing\n' >&2; exit 1; }
}

request() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body" "$BASE_URL$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE_URL$path"
  fi
}

expect() {
  local label="$1" value="$2"
  if [ "$value" = "true" ]; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label" >&2; exit 1; fi
}

create_device() {
  local access_yaml twin_yaml body response
  access_yaml=$'protocol: ModbusTCP\nhost: 192.168.1.100\nport: 502\nslaveId: 1\ntimeout: 3000'
  twin_yaml=$'collect:\n  register: HoldingRegister\n  address: 0\n  quantity: 1\n  slaveId: 1\nreport:\n  topic: device/temperature\n  qos: 0'
  body="$(jq -n --arg name "$DEVICE" --arg namespace "$NAMESPACE" --arg model "$MODEL" --arg node "$NODE" --arg access "$access_yaml" --arg twin "$twin_yaml" '{name:$name,namespace:$namespace,deviceModelRef:$model,nodeName:$node,protocol:"ModbusTCP",description:"BlueEdge Device persistence regression",labels:{"blueedge.io/test":"device-persistence"},accessConfigYaml:$access,properties:[{propertyName:"temperature",desiredValue:"25",collectIntervalSeconds:10,reportIntervalSeconds:60,accessConfigYaml:$twin}]}')"
  response="$(request POST /blueedge/devices "$body")"
  expect "create Device" "$(printf '%s' "$response" | jq -r '.item.name == $name' --arg name "$DEVICE")"
  expect "create extension ConfigMap" "$(printf '%s' "$response" | jq -r '.item.extension.storage == "configMap"')"
}

verify_device() {
  local response
  response="$(request GET "/blueedge/devices/$NAMESPACE/$DEVICE/summary")"
  expect "detail returns Device" "$(printf '%s' "$response" | jq -r '.item.name == $name' --arg name "$DEVICE")"
  expect "detail returns access YAML" "$(printf '%s' "$response" | jq -r '.item.extension.accessConfigYaml | contains("protocol: ModbusTCP")')"
  expect "detail returns Twin YAML" "$(printf '%s' "$response" | jq -r '.item.extension.twinAccessConfigs.temperature | contains("HoldingRegister")')"
  expect "CRD stores protocol config" "$(printf '%s' "$response" | jq -r '.item.raw.spec.protocol.configData.host == "192.168.1.100"')"
  expect "CRD stores Twin cycles" "$(printf '%s' "$response" | jq -r '.item.raw.spec.properties[0].collectCycle == 10 and .item.raw.spec.properties[0].reportCycle == 60')"
}

cleanup_device() {
  request DELETE "/blueedge/devices/$NAMESPACE/$DEVICE" >/dev/null || true
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE_URL/blueedge/devices/$NAMESPACE/$DEVICE/summary")"
  expect "delete Device" "$([ "$status" = "404" ] && printf true || printf false)"
}

login
case "$PHASE" in
  create) create_device ;;
  verify) verify_device ;;
  cleanup) cleanup_device ;;
  all) create_device; verify_device; cleanup_device ;;
  *) printf 'Unknown PHASE=%s\n' "$PHASE" >&2; exit 1 ;;
esac
