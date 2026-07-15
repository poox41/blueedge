import assert from "node:assert/strict";
import test from "node:test";
import { ruleAuditView, ruleDeliverySummary } from "../dist/services/rule-operations.service.js";

test("uses real Rule status counters without inventing delivery records", () => {
  const result = ruleDeliverySummary({
    status: { successMessages: 7, failMessages: 2, errors: ["mqtt unavailable"] },
  });
  assert.equal(result.successMessages, 7);
  assert.equal(result.failMessages, 2);
  assert.equal(result.totalMessages, 9);
  assert.deepEqual(result.errors, ["mqtt unavailable"]);
  assert.equal(result.completeHistory, false);
  assert.equal(result.source, "Rule.status");
});

test("maps and sorts the real managedFields audit trail", () => {
  const result = ruleAuditView({
    metadata: {
      managedFields: [
        { manager: "old-manager", operation: "Apply", apiVersion: "v1", time: "2026-01-01T00:00:00Z" },
        { manager: "new-manager", operation: "Update", apiVersion: "v1", subresource: "status", time: "2026-02-01T00:00:00Z" },
      ],
    },
  });
  assert.deepEqual(result.items.map((item) => item.manager), ["new-manager", "old-manager"]);
  assert.equal(result.items[0].subresource, "status");
  assert.equal(result.completeAuditLog, false);
  assert.equal(result.source, "metadata.managedFields");
});
