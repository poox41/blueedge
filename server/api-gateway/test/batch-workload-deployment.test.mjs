import test from "node:test";
import assert from "node:assert/strict";
import { buildBatchDeployment } from "../dist/services/batch-workload.service.js";

const plan = {
  namespace: "default",
  name: "batch-nginx",
  targetGroups: ["edge-group"],
  replicas: 2,
  workloadType: "Deployment",
  podTemplate: {
    containers: [{
      name: "nginx",
      image: "nginx:1.25-alpine",
      imagePullPolicy: "IfNotPresent",
      resources: { requests: { cpu: "100m", memory: "64Mi" } },
      healthChecks: { startup: true, readiness: true, liveness: true },
    }],
  },
  strategy: { type: "RollingUpdate", maxUnavailable: "25%", maxSurge: "25%" },
};

test("renders a real apps/v1 Deployment pinned to explicit NodeGroup nodes", () => {
  const resource = buildBatchDeployment(plan, "bw-default-batch-nginx", {
    metadata: { name: "edge-group" },
    spec: { nodes: ["k8s-worker01"] },
  });

  assert.equal(resource.apiVersion, "apps/v1");
  assert.equal(resource.kind, "Deployment");
  assert.equal(resource.metadata.namespace, "default");
  assert.equal(resource.spec.replicas, 2);
  assert.deepEqual(
    resource.spec.template.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms[0].matchExpressions[0],
    { key: "kubernetes.io/hostname", operator: "In", values: ["k8s-worker01"] },
  );
  assert.equal(resource.spec.template.spec.containers[0].image, "nginx:1.25-alpine");
  assert.deepEqual(resource.spec.template.spec.containers[0].resources.requests, { cpu: "100m", memory: "64Mi" });
  assert.deepEqual(resource.spec.template.spec.containers[0].readinessProbe.exec.command, ["/bin/sh", "-c", "test -e /proc/1"]);
  assert.equal(resource.metadata.labels["blueedge.io/managed-by"], "blueedge-batch-workload");
});

test("renders NodeGroup matchLabels as a real pod nodeSelector", () => {
  const resource = buildBatchDeployment(plan, "bw-default-batch-nginx", {
    metadata: { name: "label-group" },
    spec: { matchLabels: { nodeType: "edge", region: "east" } },
  });

  assert.deepEqual(resource.spec.template.spec.nodeSelector, { nodeType: "edge", region: "east" });
  assert.equal(resource.spec.template.spec.affinity, undefined);
  assert.deepEqual(resource.spec.selector.matchLabels, resource.spec.template.metadata.labels);
});
