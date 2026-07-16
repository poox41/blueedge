import assert from "node:assert/strict";
import test from "node:test";
import {
  deploymentBelongsToEdgeUnit,
  deploymentTargetsEdgeUnit,
  edgeApplicationBelongsToEdgeUnit,
  edgeApplicationTargetsEdgeUnit,
  nodeTargetsEdgeUnit,
} from "../dist/services/edge-unit.service.js";

test("direct edge-unit labels isolate nodes and deployments", () => {
  const node = { metadata: { name: "edge-01", labels: { "blueedge.io/edge-unit": "unit-a" } } };
  const deployment = {
    metadata: { name: "app-a", namespace: "default" },
    spec: { template: { metadata: { labels: { "blueedge.io/edge-unit": "unit-a" } } } },
  };

  assert.equal(nodeTargetsEdgeUnit(node, "unit-a"), true);
  assert.equal(nodeTargetsEdgeUnit(node, "unit-b"), false);
  assert.equal(deploymentTargetsEdgeUnit(deployment, "unit-a", ""), true);
  assert.equal(deploymentTargetsEdgeUnit(deployment, "unit-b", ""), false);
});

test("unowned historical deployments remain visible until ownership is assigned", () => {
  const historical = { metadata: { name: "historical", namespace: "default" } };
  const owned = { metadata: { name: "owned", labels: { "blueedge.io/edge-unit": "unit-b" } } };

  assert.equal(deploymentBelongsToEdgeUnit(historical, "unit-a", "group-a"), true);
  assert.equal(deploymentBelongsToEdgeUnit(owned, "unit-a", "group-a"), false);
});

test("edge applications support direct edge-unit ownership and legacy NodeGroup ownership", () => {
  const directlyOwned = {
    metadata: { name: "edge-app-a", labels: { "blueedge.io/edge-unit": "unit-a" } },
  };
  const nodeGroupOwned = {
    metadata: { name: "edge-app-b" },
    spec: { workloadScope: { targetNodeGroups: [{ name: "group-b" }] } },
  };

  assert.equal(edgeApplicationTargetsEdgeUnit(directlyOwned, "unit-a", ""), true);
  assert.equal(edgeApplicationTargetsEdgeUnit(directlyOwned, "unit-b", ""), false);
  assert.equal(edgeApplicationTargetsEdgeUnit(nodeGroupOwned, "unit-b", "group-b"), true);
  assert.equal(edgeApplicationTargetsEdgeUnit(nodeGroupOwned, "unit-a", "group-a"), false);
});

test("edge applications with an orphaned legacy NodeGroup remain visible", () => {
  const orphaned = {
    metadata: { name: "legacy-app" },
    spec: { workloadScope: { targetNodeGroups: [{ name: "removed-group" }] } },
  };
  const anotherExistingGroup = {
    metadata: { name: "other-app" },
    spec: { workloadScope: { targetNodeGroups: [{ name: "group-b" }] } },
  };
  const knownGroups = new Set(["group-a", "group-b"]);

  assert.equal(edgeApplicationBelongsToEdgeUnit(orphaned, "unit-a", "group-a", knownGroups), true);
  assert.equal(edgeApplicationBelongsToEdgeUnit(anotherExistingGroup, "unit-a", "group-a", knownGroups), false);
});
