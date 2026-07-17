import assert from "node:assert/strict";
import test from "node:test";
import { mergeResourceDetails } from "../dist/services/edge-unit-source.service.js";

function summary(namespace, name) {
  return { namespace, name, availableReplicas: 0 };
}

function detail(namespace, name, labels = {}) {
  return {
    metadata: { namespace, name, labels },
    spec: { replicas: 1 },
  };
}

test("resource detail merge keeps Kubernetes resources beyond the BFF first page", () => {
  const summaries = Array.from({ length: 20 }, (_, index) => summary("default", `app-${index + 1}`));
  const details = [
    ...Array.from({ length: 20 }, (_, index) => detail("default", `app-${index + 1}`)),
    detail("default", "yyyy", { "blueedge.io/edge-unit": "demo-edge-unit" }),
  ];
  const warnings = [];

  const merged = mergeResourceDetails(summaries, { items: details }, warnings, "deployment.detail");

  assert.equal(merged.length, 21);
  assert.equal(merged.find((item) => item.metadata?.name === "yyyy")?.metadata.labels["blueedge.io/edge-unit"], "demo-edge-unit");
  assert.deepEqual(warnings, []);
});

test("resource detail merge preserves BFF summaries when Kubernetes details are unavailable", () => {
  const summaries = [summary("default", "app-1")];
  const warnings = [];

  assert.deepEqual(mergeResourceDetails(summaries, null, warnings, "deployment.detail"), summaries);
  assert.deepEqual(warnings, [{ source: "deployment.detail", message: "Kubernetes resource details unavailable; summary data was used instead" }]);
});
