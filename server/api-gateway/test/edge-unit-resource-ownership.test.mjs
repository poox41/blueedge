import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEdgeUnitConfiguration,
  buildEdgeUnitConfigMapData,
  buildEdgeUnitRuntime,
  bindDeploymentToEdgeUnitNodeGroup,
  deploymentBelongsToEdgeUnit,
  deploymentTargetsEdgeUnit,
  edgeApplicationBelongsToEdgeUnit,
  edgeApplicationTargetsEdgeUnit,
  nodeTargetsEdgeUnit,
} from "../dist/services/edge-unit.service.js";

test("EdgeUnit workload creation injects ownership and explicit NodeGroup scheduling", () => {
  const resource = bindDeploymentToEdgeUnitNodeGroup({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "edge-app", namespace: "default" },
    spec: { template: { metadata: { labels: { app: "edge-app" } }, spec: { containers: [{ name: "app", image: "nginx" }] } } },
  }, "unit-a", "group-a", { metadata: { name: "group-a" }, spec: { nodes: ["edge-01"] } });

  assert.equal(resource.metadata.labels["blueedge.io/edge-unit"], "unit-a");
  assert.equal(resource.metadata.labels["blueedge.io/node-group"], "group-a");
  assert.equal(resource.spec.template.metadata.labels["blueedge.io/edge-unit"], "unit-a");
  assert.deepEqual(
    resource.spec.template.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms[0].matchExpressions[0],
    { key: "kubernetes.io/hostname", operator: "In", values: ["edge-01"] },
  );
});

test("EdgeUnit workload creation rejects scheduling outside the bound NodeGroup", () => {
  const resource = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "edge-app", namespace: "default" },
    spec: { template: { spec: { nodeName: "cloud-01", containers: [{ name: "app", image: "nginx" }] } } },
  };
  assert.throws(
    () => bindDeploymentToEdgeUnitNodeGroup(resource, "unit-a", "group-a", { metadata: { name: "group-a" }, spec: { nodes: ["edge-01"] } }),
    /不属于 NodeGroup group-a/,
  );
});

test("EdgeUnit workload creation merges NodeGroup matchLabels and rejects conflicts", () => {
  const resource = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "edge-app", namespace: "default" },
    spec: { template: { spec: { nodeSelector: { region: "east" }, containers: [{ name: "app", image: "nginx" }] } } },
  };
  const group = { metadata: { name: "group-a" }, spec: { matchLabels: { nodeType: "edge", region: "east" } } };
  assert.deepEqual(bindDeploymentToEdgeUnitNodeGroup(resource, "unit-a", "group-a", group).spec.template.spec.nodeSelector, { region: "east", nodeType: "edge" });
  assert.throws(
    () => bindDeploymentToEdgeUnitNodeGroup({ ...resource, spec: { template: { spec: { ...resource.spec.template.spec, nodeSelector: { region: "west" } } } } }, "unit-a", "group-a", group),
    /冲突/,
  );
});

test("EdgeUnit update can bind and explicitly unbind nodeGroupRef", () => {
  const existing = {
    name: "unit-a",
    nodeGroupRef: "group-a",
    clusterName: "kubernetes",
    accessType: "dedicated",
    kubeEdgeVersion: "v1.21.0",
    insightStatus: "unknown",
    monitorStatus: "unknown",
    description: "",
  };

  assert.equal(buildEdgeUnitConfigMapData({}, existing).nodeGroupRef, "group-a");
  assert.equal(buildEdgeUnitConfigMapData({ nodeGroupRef: "group-b" }, existing).nodeGroupRef, "group-b");
  assert.equal(buildEdgeUnitConfigMapData({ nodeGroupRef: "" }, existing).nodeGroupRef, "");
});

test("EdgeUnit editable configuration survives ConfigMap serialization and reload", () => {
  const data = buildEdgeUnitConfigMapData({
    name: "unit-a",
    clusterName: "kubernetes",
    accessType: "dedicated",
    kubeEdgeVersion: "v1.21.0",
    insightStatus: "unknown",
    monitorStatus: "unknown",
    nodeScale: "中型",
    mqttEnabled: true,
    protocols: ["WebSocket", "QUIC"],
    accessAddresses: ["10.6.222.21", "edge.example.com"],
    ports: {
      websocket: "31000",
      quic: "31001",
      https: "31002",
      cloudStream: "31003",
      tunnel: "31004",
    },
    uninstallPolicy: "删除相关命名空间",
  });

  assert.deepEqual(buildEdgeUnitConfiguration(data), {
    nodeScale: "中型",
    mqttEnabled: true,
    protocols: ["WebSocket", "QUIC"],
    accessAddresses: ["10.6.222.21", "edge.example.com"],
    ports: {
      websocket: "31000",
      quic: "31001",
      https: "31002",
      cloudStream: "31003",
      tunnel: "31004",
    },
    uninstallPolicy: "删除相关命名空间",
  });

  const updated = buildEdgeUnitConfigMapData({ mqttEnabled: false, nodeScale: "大型" }, data);
  assert.equal(updated.mqttEnabled, "false");
  assert.equal(updated.nodeScale, "大型");
  assert.equal(updated.ports, data.ports);
  assert.deepEqual(buildEdgeUnitConfiguration(updated).ports, buildEdgeUnitConfiguration(data).ports);
});

test("EdgeUnit editable configuration rejects invalid ports and enum values", () => {
  assert.throws(() => buildEdgeUnitConfigMapData({ nodeScale: "超大型" }), /nodeScale/);
  assert.throws(() => buildEdgeUnitConfigMapData({ ports: {
    websocket: "70000",
    quic: "30001",
    https: "30002",
    cloudStream: "30003",
    tunnel: "30004",
  } }), /ports.websocket/);
});

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

test("unowned deployments do not fall back to every EdgeUnit in the cluster", () => {
  const historical = { metadata: { name: "historical", namespace: "default" } };
  const owned = { metadata: { name: "owned", labels: { "blueedge.io/edge-unit": "unit-b" } } };

  assert.equal(deploymentBelongsToEdgeUnit(historical, "unit-a", "group-a"), false);
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

test("edge applications with an orphaned legacy NodeGroup do not pollute another EdgeUnit", () => {
  const orphaned = {
    metadata: { name: "legacy-app" },
    spec: { workloadScope: { targetNodeGroups: [{ name: "removed-group" }] } },
  };
  const anotherExistingGroup = {
    metadata: { name: "other-app" },
    spec: { workloadScope: { targetNodeGroups: [{ name: "group-b" }] } },
  };
  const knownGroups = new Set(["group-a", "group-b"]);

  assert.equal(edgeApplicationBelongsToEdgeUnit(orphaned, "unit-a", "group-a", knownGroups), false);
  assert.equal(edgeApplicationBelongsToEdgeUnit(anotherExistingGroup, "unit-a", "group-a", knownGroups), false);
});

function readyNode(name) {
  return {
    metadata: { name },
    status: { conditions: [{ type: "Ready", status: "True" }] },
  };
}

function deployment(name, app, availableReplicas = 1) {
  return {
    metadata: { name, namespace: "default" },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app } },
      template: { metadata: { labels: { app } } },
    },
    status: { availableReplicas },
  };
}

function pod(name, app, nodeName, { phase = "Running", ready = true, deletionTimestamp } = {}) {
  return {
    metadata: { name, namespace: "default", labels: { app }, ...(deletionTimestamp ? { deletionTimestamp } : {}) },
    spec: { nodeName },
    status: {
      phase,
      conditions: [{ type: "Ready", status: ready ? "True" : "False" }],
    },
  };
}

function edgeApplication(name, nodeGroupName, phase = "Running") {
  return {
    metadata: { name, namespace: "default" },
    spec: { workloadScope: { targetNodeGroups: [{ name: nodeGroupName }] } },
    status: { phase },
  };
}

test("EdgeUnit without nodeGroupRef has zero nodes, workloads and applications", () => {
  const aux = {
    nodes: [readyNode("k8s-laptop-edge")],
    pods: [pod("cluster-pod", "cluster-app", "k8s-laptop-edge")],
    deployments: [deployment("cluster-deployment", "cluster-app")],
    edgeApplications: [edgeApplication("cluster-edge-app", "laptop-edge-group")],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(null, aux, "demo-edge-unit", "", new Set(["laptop-edge-group"]));

  assert.deepEqual(result.nodes, { ready: 0, total: 0 });
  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
  assert.deepEqual(result.applications, { healthy: 0, total: 0 });
});

test("EdgeUnit bound to laptop-edge-group resolves k8s-laptop-edge and its resources", () => {
  const group = { metadata: { name: "laptop-edge-group" }, spec: { nodes: ["k8s-laptop-edge"] } };
  const aux = {
    nodes: [readyNode("k8s-laptop-edge"), readyNode("cloud-node")],
    pods: [
      pod("edge-pod", "edge-app", "k8s-laptop-edge"),
      pod("cloud-pod", "cloud-app", "cloud-node"),
    ],
    deployments: [deployment("edge-deployment", "edge-app"), deployment("cloud-deployment", "cloud-app")],
    edgeApplications: [
      edgeApplication("edge-application", "laptop-edge-group"),
      edgeApplication("other-application", "other-group"),
    ],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(group, aux, "unit-a", "laptop-edge-group", new Set(["laptop-edge-group", "other-group"]));

  assert.deepEqual(result.nodes, { ready: 1, total: 1 });
  assert.deepEqual(result.workloads, { healthy: 1, total: 1 });
  assert.deepEqual(result.applications, { healthy: 1, total: 1 });
});

test("EdgeUnits in the same cluster do not share NodeGroup resources", () => {
  const groupA = { metadata: { name: "group-a" }, spec: { nodes: ["edge-a"] } };
  const groupB = { metadata: { name: "group-b" }, spec: { nodes: ["edge-b"] } };
  const aux = {
    nodes: [readyNode("edge-a"), readyNode("edge-b")],
    pods: [pod("pod-a", "app-a", "edge-a"), pod("pod-b", "app-b", "edge-b")],
    deployments: [deployment("deployment-a", "app-a"), deployment("deployment-b", "app-b")],
    edgeApplications: [edgeApplication("edge-app-a", "group-a"), edgeApplication("edge-app-b", "group-b")],
    accessConfigs: [],
  };
  const knownGroups = new Set(["group-a", "group-b"]);

  const unitA = buildEdgeUnitRuntime(groupA, aux, "unit-a", "group-a", knownGroups);
  const unitB = buildEdgeUnitRuntime(groupB, aux, "unit-b", "group-b", knownGroups);

  assert.deepEqual(unitA.nodes, { ready: 1, total: 1 });
  assert.deepEqual(unitA.workloads, { healthy: 1, total: 1 });
  assert.deepEqual(unitA.applications, { healthy: 1, total: 1 });
  assert.deepEqual(unitB.nodes, { ready: 1, total: 1 });
  assert.deepEqual(unitB.workloads, { healthy: 1, total: 1 });
  assert.deepEqual(unitB.applications, { healthy: 1, total: 1 });
});

test("workload total includes NodeGroup-owned workloads while healthy only counts ready pods on that NodeGroup", () => {
  const group = { metadata: { name: "group-a" }, spec: { nodes: ["edge-a"] } };
  const ownedDeployment = deployment("owned-deployment", "owned-app");
  ownedDeployment.metadata.labels = { "blueedge.io/nodegroup": "group-a" };
  const aux = {
    nodes: [readyNode("edge-a"), readyNode("cloud-node")],
    pods: [
      pod("edge-pending", "owned-app", "edge-a", { phase: "Pending", ready: false }),
      pod("cloud-ready", "owned-app", "cloud-node"),
    ],
    deployments: [ownedDeployment],
    edgeApplications: [
      edgeApplication("ready-app", "group-a", "Running"),
      edgeApplication("pending-app", "group-a", "Pending"),
    ],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(group, aux, "unit-a", "group-a", new Set(["group-a"]));

  assert.deepEqual(result.workloads, { healthy: 0, total: 1 });
  assert.deepEqual(result.applications, { healthy: 1, total: 2 });
});

test("deleting pods do not assign a cloud workload to an edge NodeGroup", () => {
  const group = { metadata: { name: "laptop-edge-group" }, spec: { nodes: ["k8s-laptop-edge"] } };
  const aux = {
    nodes: [readyNode("k8s-laptop-edge"), readyNode("k8s-master")],
    pods: [
      pod("cloud-ready", "dap-predict-proxy", "k8s-master"),
      pod("edge-stale", "dap-predict-proxy", "k8s-laptop-edge", {
        phase: "Pending",
        ready: false,
        deletionTimestamp: "2026-06-04T12:19:24Z",
      }),
    ],
    deployments: [deployment("dap-predict-proxy", "dap-predict-proxy")],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(group, aux, "demo-edge-unit", "laptop-edge-group", new Set(["laptop-edge-group"]));

  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
});
