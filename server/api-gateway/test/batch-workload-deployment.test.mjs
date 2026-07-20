import test from "node:test";
import assert from "node:assert/strict";
import { buildBatchDeployment, buildBatchEdgeApplication } from "../dist/services/batch-workload.service.js";

const plan = {
  edgeUnitRef: "unit-a",
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
  assert.equal(resource.metadata.labels["blueedge.io/edge-unit"], "unit-a");
  assert.equal(resource.metadata.labels["blueedge.io/node-group"], "edge-group");
  assert.equal(resource.spec.template.metadata.labels["blueedge.io/edge-unit"], "unit-a");
});

test("renders NodeGroup matchLabels as a real pod nodeSelector", () => {
  const resource = buildBatchDeployment(plan, "bw-default-batch-nginx", {
    metadata: { name: "label-group" },
    spec: { matchLabels: { nodeType: "edge", region: "east" } },
  });

  assert.deepEqual(resource.spec.template.spec.nodeSelector, { nodeType: "edge", region: "east" });
  assert.equal(resource.spec.template.spec.affinity, undefined);
  assert.deepEqual(
    Object.fromEntries(Object.keys(resource.spec.selector.matchLabels).map((key) => [key, resource.spec.template.metadata.labels[key]])),
    resource.spec.selector.matchLabels,
  );
});

test("renders a real KubeEdge EdgeApplication with an embedded Deployment", () => {
  const resource = buildBatchEdgeApplication(plan, "bw-default-batch-nginx", [{
    metadata: { name: "edge-group" },
    spec: { nodes: ["k8s-worker01"] },
  }]);

  assert.equal(resource.apiVersion, "apps.kubeedge.io/v1alpha1");
  assert.equal(resource.kind, "EdgeApplication");
  assert.equal(resource.metadata.name, "batch-nginx");
  assert.equal(resource.metadata.namespace, "default");
  assert.equal(resource.metadata.labels["blueedge.io/managed-by"], "blueedge-batch-workload");
  assert.equal(resource.metadata.labels["blueedge.io/batch-workload-id"], "bw-default-batch-nginx");
  assert.deepEqual(resource.spec.workloadScope.targetNodeGroups, [{ name: "edge-group", overrides: {} }]);
  assert.equal(resource.spec.workloadTemplate.manifests[0].apiVersion, "apps/v1");
  assert.equal(resource.spec.workloadTemplate.manifests[0].kind, "Deployment");
  assert.equal(resource.spec.workloadTemplate.manifests[0].spec.template.spec.containers[0].image, "nginx:1.25-alpine");
  assert.equal(resource.spec.workloadTemplate.manifests[0].spec.template.spec.affinity, undefined);
  assert.equal(resource.spec.workloadTemplate.manifests[0].metadata.labels["blueedge.io/node-group"], undefined);
});

test("preserves imported EdgeApplication manifests and matching NodeGroup overrides", () => {
  const source = {
    apiVersion: "apps.kubeedge.io/v1alpha1",
    kind: "EdgeApplication",
    metadata: { name: "source-name", labels: { source: "yaml" } },
    spec: {
      workloadScope: {
        targetNodeGroups: [{ name: "edge-group", overrides: { replicas: 3 } }],
      },
      workloadTemplate: {
        manifests: [{ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "from-yaml" }, spec: { replicas: 3 } }],
      },
    },
  };
  const resource = buildBatchEdgeApplication(plan, "bw-default-batch-nginx", [{ metadata: { name: "edge-group" } }], source);

  assert.equal(resource.metadata.name, "batch-nginx");
  assert.equal(resource.metadata.labels.source, "yaml");
  assert.deepEqual(resource.spec.workloadScope.targetNodeGroups, [{ name: "edge-group", overrides: { replicas: 3 } }]);
  assert.equal(resource.spec.workloadTemplate.manifests[0].metadata.name, "from-yaml");
  assert.equal(source.metadata.name, "source-name");
});

test("rejects non-EdgeApplication imports", () => {
  assert.throws(
    () => buildBatchEdgeApplication(plan, "bw-default-batch-nginx", [{ metadata: { name: "edge-group" } }], { apiVersion: "apps/v1", kind: "Deployment" }),
    /必须是 apps.kubeedge.io\/v1alpha1 EdgeApplication/,
  );
});
