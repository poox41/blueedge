import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBffProxyStatus } from "../dist/clients/bff-client.js";

test("normalizes Kubernetes plain-text NotFound responses from an upstream 500", () => {
  assert.equal(
    normalizeBffProxyStatus(500, Buffer.from('configmaps "missing-config" not found'), "text/plain; charset=utf-8"),
    404,
  );
  assert.equal(
    normalizeBffProxyStatus(500, Buffer.from('secrets "missing-secret" not found\n'), "text/plain"),
    404,
  );
});

test("normalizes Kubernetes Status JSON NotFound responses from an upstream 500", () => {
  const body = Buffer.from(JSON.stringify({
    kind: "Status",
    apiVersion: "v1",
    status: "Failure",
    reason: "NotFound",
    code: 404,
  }));

  assert.equal(normalizeBffProxyStatus(500, body, "application/json"), 404);
});

test("preserves unrelated upstream errors and existing response statuses", () => {
  assert.equal(normalizeBffProxyStatus(500, Buffer.from("database connection failed"), "text/plain"), 500);
  assert.equal(
    normalizeBffProxyStatus(500, Buffer.from('{"message":"record not found"}'), "application/json"),
    500,
  );
  assert.equal(normalizeBffProxyStatus(404, Buffer.from('configmaps "missing" not found'), "text/plain"), 404);
});
