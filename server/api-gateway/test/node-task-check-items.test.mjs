import test from "node:test";
import assert from "node:assert/strict";
import { nodeTaskCheckItems, nodeTaskStatus } from "../dist/services/batch-task.service.js";

test("maps platform resource-check labels to KubeEdge TaskManager values", () => {
  assert.deepEqual(nodeTaskCheckItems(["CPU", "内存", "磁盘"]), ["cpu", "mem", "disk"]);
});

test("maps KubeEdge action-flow boolean strings to terminal step statuses", () => {
  assert.equal(nodeTaskStatus("True"), "succeeded");
  assert.equal(nodeTaskStatus("False"), "failed");
  assert.equal(nodeTaskStatus("InProgress"), "running");
});
