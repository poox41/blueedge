import test from "node:test";
import assert from "node:assert/strict";
import { buildImagePrePullJobView } from "../dist/services/batch-task.service.js";

function job(status = {}) {
  return {
    apiVersion: "operations.kubeedge.io/v1alpha2",
    kind: "ImagePrePullJob",
    metadata: {
      name: "preheat-demo",
      creationTimestamp: "2026-07-15T08:00:00Z",
      annotations: {
        "blueedge.io/description": "real image prepull",
        "blueedge.io/target-nodes": JSON.stringify(["edge-a", "edge-b"]),
      },
    },
    spec: {
      imagePrePullTemplate: {
        images: ["nginx:1.25", "busybox:1.36"],
        labelSelector: { matchLabels: { site: "factory-a" } },
        checkItems: ["cpu", "mem", "disk"],
        failureTolerate: "0.1",
        concurrency: 2,
        timeoutSeconds: 600,
        retryTimes: 3,
        imageSecrets: "default/harbor-auth",
      },
    },
    status,
  };
}

test("maps ImagePrePullJob spec and pending targets to the batch task view", () => {
  const view = buildImagePrePullJobView(job({ phase: "Init" }));
  assert.equal(view.type, "imagePreheat");
  assert.equal(view.executionMode, "imagePrePullJob");
  assert.equal(view.status, "initializing");
  assert.deepEqual(view.targetRefs, ["edge-a", "edge-b"]);
  assert.equal(view.image, "nginx:1.25, busybox:1.36");
  assert.deepEqual(view.resourceChecks, ["CPU", "内存", "磁盘"]);
  assert.equal(view.credentialNamespace, "default");
  assert.equal(view.credentialName, "harbor-auth");
  assert.equal(view.targetResults.length, 2);
});

test("maps ImagePrePullJob node and image status without fabricating execution", () => {
  const view = buildImagePrePullJobView(job({
    phase: "Failure",
    nodeStatus: [
      {
        nodeName: "edge-a",
        phase: "Successful",
        imageStatus: [{ image: "nginx:1.25", status: "True" }],
        actionFlow: [{ action: "Pull", status: "True", time: "2026-07-15T08:01:00Z" }],
      },
      {
        nodeName: "edge-b",
        phase: "Failure",
        reason: "disk pressure",
        imageStatus: [{ image: "nginx:1.25", status: "False", reason: "disk pressure" }],
        actionFlow: [{ action: "Check", status: "False", reason: "disk pressure", time: "2026-07-15T08:01:30Z" }],
      },
    ],
  }));
  assert.equal(view.status, "partialSuccess");
  assert.equal(view.successCount, 1);
  assert.equal(view.failedCount, 1);
  assert.equal(view.progress, 100);
  assert.equal(view.events[1].type, "Warning");
  assert.deepEqual(view.errors, [{ target: "edge-b", message: "disk pressure" }]);
});
