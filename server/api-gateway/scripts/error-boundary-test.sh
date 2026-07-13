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

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'PASS %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf 'FAIL %s\n' "$1"
}

request() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local data="${4:-}"
  local output status content_type
  output="$(mktemp)"
  status="$(curl -sS -o "$output" -w '%{http_code}' -X "$method" \
    ${token:+-H "Authorization: Bearer $token"} \
    ${data:+-H "Content-Type: application/json" -d "$data"} \
    "$BASE_URL$path" || true)"
  content_type="$(curl -sSI -X "$method" \
    ${token:+-H "Authorization: Bearer $token"} \
    "$BASE_URL$path" | tr -d '\r' | sed -n 's/^content-type: //Ip' | head -1)"
  printf '%s\n%s\n%s\n' "$status" "$content_type" "$output"
}

login_output="$(mktemp)"
login_status="$(curl -sS -o "$login_output" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/auth/login" || true)"
TOKEN="$(node -e 'const fs=require("fs");const body=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(body.token||"")' "$login_output")"
rm -f "$login_output"
if [ "$login_status" = "200" ] && [ -n "$TOKEN" ]; then
  pass "login success contract"
else
  fail "login success contract status=$login_status"
fi

for path in "/not-exist" "/blueedge/not-exist"; do
  result="$(request GET "$path" "$TOKEN")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  content_type="$(printf '%s' "$result" | sed -n '2p')"
  output="$(printf '%s' "$result" | sed -n '3p')"
  if [ "$status" = "404" ] && printf '%s' "$content_type" | grep -Fqi 'application/json' && \
    node -e 'const fs=require("fs"),b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(b.code!=="ROUTE_NOT_FOUND"||b.message!=="Route not found"||b.path!==process.argv[2])process.exit(1)' "$output" "$path"; then
    pass "local JSON 404 $path"
  else
    fail "local JSON 404 $path status=$status content-type=$content_type body=$(head -c 160 "$output")"
  fi
  rm -f "$output"
done

for token_case in "" "invalid"; do
  result="$(request GET "/overview" "$token_case")"
  status="$(printf '%s' "$result" | sed -n '1p')"
  output="$(printf '%s' "$result" | sed -n '3p')"
  if [ "$status" = "401" ] && grep -Fq '"message":"unauthorized"' "$output"; then
    pass "protected route rejects ${token_case:-missing} token"
  else
    fail "protected route auth contract ${token_case:-missing} status=$status"
  fi
  rm -f "$output"
done

result="$(request POST "/auth/login" "" "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"bad\"}")"
status="$(printf '%s' "$result" | sed -n '1p')"
output="$(printf '%s' "$result" | sed -n '3p')"
if [ "$status" = "401" ] && grep -Fq '"message":"账号或密码错误"' "$output"; then
  pass "bad login contract"
else
  fail "bad login contract status=$status"
fi
rm -f "$output"

result="$(request GET "/blueedge/edge-units/codex-missing-resource" "$TOKEN")"
status="$(printf '%s' "$result" | sed -n '1p')"
output="$(printf '%s' "$result" | sed -n '3p')"
if [ "$status" = "404" ] && ! grep -Fq 'ROUTE_NOT_FOUND' "$output"; then
  pass "business resource 404 remains service response"
else
  fail "business resource 404 status=$status body=$(head -c 160 "$output")"
fi
rm -f "$output"

result="$(request GET "/bff/not-exist" "$TOKEN")"
status="$(printf '%s' "$result" | sed -n '1p')"
content_type="$(printf '%s' "$result" | sed -n '2p')"
output="$(printf '%s' "$result" | sed -n '3p')"
if [ "$status" = "404" ] && ! grep -Fq 'ROUTE_NOT_FOUND' "$output"; then
  pass "BFF upstream 404 remains proxied content-type=$content_type"
else
  fail "BFF upstream 404 status=$status body=$(head -c 160 "$output")"
fi
rm -f "$output"

if node --input-type=module -e '
  import { errorMiddleware } from "./dist/middleware/error.middleware.js";
  const response = {
    headersSent: false,
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  errorMiddleware(new Error("sensitive internal detail"), { method: "GET", originalUrl: "/unit-test" }, response, () => {});
  if (response.statusCode !== 500) process.exit(1);
  if (response.payload?.message !== "Internal server error" || response.payload?.code !== "INTERNAL_SERVER_ERROR") process.exit(1);
  if (JSON.stringify(response.payload).includes("sensitive") || Object.hasOwn(response.payload, "stack")) process.exit(1);
'; then
  pass "global error middleware hides internal details"
else
  fail "global error middleware contract"
fi

printf 'Summary: pass=%s fail=%s\n' "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
