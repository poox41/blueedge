import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEdgeUnitConfiguration,
  buildEdgeUnitConfigMapData,
  buildEdgeUnitRuntime,
  bindDeploymentToEdgeUnit,
  deploymentBelongsToEdgeUnit,
  deploymentTargetsEdgeUnit,
  edgeApplicationBelongsToEdgeUnit,
  edgeApplicationTargetsEdgeUnit,
  isExternalEdgeNode,
  nodeTargetsEdgeUnit,
} from "../dist/services/edge-unit.service.js";
import { knownEdgeUnitNames } from "../dist/services/edge-unit-source.service.js";

test("EdgeUnit workload creation injects ownership without forcing NodeGroup scheduling", () => {
  const resource = bindDeploymentToEdgeUnit({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "edge-app", namespace: "default" },
    spec: { template: { metadata: { labels: { app: "edge-app" } }, spec: { nodeSelector: { "blueedge.io/node-role": "edge" }, containers: [{ name: "app", image: "nginx" }] } } },
  }, "unit-a");

  assert.equal(resource.metadata.labels["blueedge.io/edge-unit"], "unit-a");
  assert.equal(resource.metadata.labels["blueedge.io/node-group"], undefined);
  assert.equal(resource.spec.template.metadata.labels["blueedge.io/edge-unit"], "unit-a");
  assert.deepEqual(resource.spec.template.spec.nodeSelector, { "blueedge.io/node-role": "edge" });
  assert.equal(resource.spec.template.spec.affinity, undefined);
});

test("EdgeUnit workload creation preserves an explicitly selected edge node", () => {
  const resource = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "edge-app", namespace: "default", labels: {} },
    spec: { template: { metadata: {}, spec: { nodeName: "edge-02", containers: [{ name: "app", image: "nginx" }] } } },
  };
  assert.equal(bindDeploymentToEdgeUnit(resource, "unit-a").spec.template.spec.nodeName, "edge-02");
});

test("EdgeUnit workload creation defaults scheduler-managed pods to BlueEdge edge nodes", () => {
  const resource = bindDeploymentToEdgeUnit({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "edge-app", namespace: "default" },
    spec: { template: { metadata: { labels: { app: "edge-app" } }, spec: { containers: [{ name: "app", image: "nginx" }] } } },
  }, "unit-a");

  assert.deepEqual(resource.spec.template.spec.nodeSelector, { "blueedge.io/node-role": "edge" });
});

test("EdgeUnit workload creation cannot override the BlueEdge edge-node constraint", () => {
  const resource = bindDeploymentToEdgeUnit({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "edge-app", namespace: "default" },
    spec: { template: { metadata: {}, spec: { nodeSelector: { region: "east", "blueedge.io/node-role": "cloud" }, containers: [{ name: "app", image: "nginx" }] } } },
  }, "unit-a");

  assert.deepEqual(resource.spec.template.spec.nodeSelector, { region: "east", "blueedge.io/node-role": "edge" });
});

test("EdgeUnit workload creation validates the Deployment resource shape", () => {
  assert.throws(() => bindDeploymentToEdgeUnit({ apiVersion: "v1", kind: "Pod" }, "unit-a"), /只支持 apps\/v1 Deployment/);
});

test("EdgeUnit create and update clear legacy nodeGroupRef bindings", () => {
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

  assert.equal(buildEdgeUnitConfigMapData({}, existing).nodeGroupRef, "");
  assert.equal(buildEdgeUnitConfigMapData({ nodeGroupRef: "group-b" }, existing).nodeGroupRef, "");
  assert.equal(buildEdgeUnitConfigMapData({ nodeGroupRef: "" }, existing).nodeGroupRef, "");
});

test("NodeGroups are not exposed as EdgeUnits", () => {
  const configMaps = [{
    metadata: { name: "edgeunit-unit-a", labels: { "blueedge.io/resource": "edgeunit", "blueedge.io/edge-unit": "unit-a" } },
    data: { name: "unit-a", accessType: "dedicated", insightStatus: "unknown", monitorStatus: "unknown" },
  }];
  const warnings = [];

  assert.deepEqual([...knownEdgeUnitNames(configMaps, warnings)], ["unit-a"]);
  assert.equal(knownEdgeUnitNames([], warnings).has("group-a"), false);
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
  assert.equal(deploymentTargetsEdgeUnit(deployment, "unit-a"), true);
  assert.equal(deploymentTargetsEdgeUnit(deployment, "unit-b"), false);
});

test("unowned deployments do not fall back to every EdgeUnit in the cluster", () => {
  const historical = { metadata: { name: "historical", namespace: "default" } };
  const owned = { metadata: { name: "owned", labels: { "blueedge.io/edge-unit": "unit-b" } } };

  assert.equal(deploymentBelongsToEdgeUnit(historical, "unit-a"), false);
  assert.equal(deploymentBelongsToEdgeUnit(owned, "unit-a"), false);
});

test("edge applications use direct edge-unit ownership instead of NodeGroup ownership", () => {
  const directlyOwned = {
    metadata: { name: "edge-app-a", labels: { "blueedge.io/edge-unit": "unit-a" } },
  };
  const nodeGroupOwned = {
    metadata: { name: "edge-app-b" },
    spec: { workloadScope: { targetNodeGroups: [{ name: "group-b" }] } },
  };

  assert.equal(edgeApplicationTargetsEdgeUnit(directlyOwned, "unit-a"), true);
  assert.equal(edgeApplicationTargetsEdgeUnit(directlyOwned, "unit-b"), false);
  assert.equal(edgeApplicationTargetsEdgeUnit(nodeGroupOwned, "unit-b"), false);
  assert.equal(edgeApplicationTargetsEdgeUnit(nodeGroupOwned, "unit-a"), false);
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
  assert.equal(edgeApplicationBelongsToEdgeUnit(orphaned, "unit-a"), false);
  assert.equal(edgeApplicationBelongsToEdgeUnit(anotherExistingGroup, "unit-a"), false);
});

function readyNode(name, edgeUnit = "") {
  return {
    metadata: { name, labels: edgeUnit ? { "blueedge.io/edge-unit": edgeUnit } : {} },
    status: { conditions: [{ type: "Ready", status: "True" }] },
  };
}

function externalReadyNode(name, labels, kubeletVersion = "v1.32.10-kubeedge-v1.23.0") {
  return {
    metadata: { name, labels },
    status: {
      nodeInfo: { kubeletVersion },
      conditions: [{ type: "Ready", status: "True" }],
    },
  };
}

function deployment(name, app, availableReplicas = 1, edgeUnit = "") {
  return {
    metadata: { name, namespace: "default", labels: edgeUnit ? { "blueedge.io/edge-unit": edgeUnit } : {} },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app } },
      template: { metadata: { labels: { app, ...(edgeUnit ? { "blueedge.io/edge-unit": edgeUnit } : {}) } } },
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

function edgeApplication(name, edgeUnit, phase = "Running") {
  return {
    metadata: { name, namespace: "default", labels: edgeUnit ? { "blueedge.io/edge-unit": edgeUnit } : {} },
    spec: { workloadScope: { targetNodeGroups: [{ name: "shared-target-group" }] } },
    status: { phase },
  };
}

test("EdgeUnit ignores unowned cluster resources without relying on NodeGroup", () => {
  const aux = {
    nodes: [readyNode("k8s-laptop-edge")],
    pods: [pod("cluster-pod", "cluster-app", "k8s-laptop-edge")],
    deployments: [deployment("cluster-deployment", "cluster-app")],
    edgeApplications: [edgeApplication("cluster-edge-app", "laptop-edge-group")],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");

  assert.deepEqual(result.nodes, { ready: 0, total: 0 });
  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
  assert.deepEqual(result.applications, { healthy: 0, total: 0 });
});

test("external EdgeUnits discover imported edge nodes from standard role labels", () => {
  const edgeRoleNode = externalReadyNode("external-edge", {
    "node-role.kubernetes.io/edge": "",
  });
  const kubeEdgeAgent = externalReadyNode("external-agent", {
    "node-role.kubernetes.io/agent": "",
  });
  const ordinaryAgent = externalReadyNode("ordinary-agent", {
    "node-role.kubernetes.io/agent": "",
  }, "v1.32.10+k3s1");
  const dedicatedNode = externalReadyNode("dedicated-edge", {
    "node-role.kubernetes.io/edge": "",
    "blueedge.io/edge-unit": "unit-b",
  });
  const aux = {
    nodes: [edgeRoleNode, kubeEdgeAgent, ordinaryAgent, dedicatedNode],
    pods: [
      pod("external-pod", "external-app", "external-edge"),
      pod("dedicated-pod", "dedicated-app", "dedicated-edge"),
    ],
    deployments: [
      deployment("external-deployment", "external-app"),
      deployment("dedicated-deployment", "dedicated-app", 1, "unit-b"),
    ],
    edgeApplications: [],
    accessConfigs: [],
  };

  assert.equal(isExternalEdgeNode(edgeRoleNode), true);
  assert.equal(isExternalEdgeNode(kubeEdgeAgent), true);
  assert.equal(isExternalEdgeNode(ordinaryAgent), false);
  const result = buildEdgeUnitRuntime(aux, "external-unit", { accessType: "external" });
  assert.deepEqual(result.nodes, { ready: 2, total: 2 });
  assert.deepEqual(result.workloads, { healthy: 1, total: 1 });
});

test("dedicated EdgeUnits do not absorb unlabeled external edge nodes", () => {
  const aux = {
    nodes: [externalReadyNode("external-edge", { "node-role.kubernetes.io/edge": "" })],
    pods: [],
    deployments: [],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "dedicated-unit", { accessType: "dedicated" });
  assert.deepEqual(result.nodes, { ready: 0, total: 0 });
});

test("EdgeUnit resolves directly labeled nodes and resources", () => {
  const aux = {
    nodes: [readyNode("k8s-laptop-edge", "unit-a"), readyNode("cloud-node", "unit-b")],
    pods: [
      pod("edge-pod", "edge-app", "k8s-laptop-edge"),
      pod("cloud-pod", "cloud-app", "cloud-node"),
    ],
    deployments: [deployment("edge-deployment", "edge-app", 1, "unit-a"), deployment("cloud-deployment", "cloud-app", 1, "unit-b")],
    edgeApplications: [
      edgeApplication("edge-application", "unit-a"),
      edgeApplication("other-application", "unit-b"),
    ],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "unit-a");

  assert.deepEqual(result.nodes, { ready: 1, total: 1 });
  assert.deepEqual(result.workloads, { healthy: 1, total: 1 });
  assert.deepEqual(result.applications, { healthy: 1, total: 1 });
});

test("EdgeUnit resolves legacy nodes from AccessConfig ownership without NodeGroup binding", () => {
  const aux = {
    nodes: [readyNode("legacy-edge")],
    pods: [],
    deployments: [],
    edgeApplications: [],
    accessConfigs: [{ data: { edgeUnitRef: "unit-a", nodeName: "legacy-edge" } }],
  };

  const result = buildEdgeUnitRuntime(aux, "unit-a");
  assert.deepEqual(result.nodes, { ready: 1, total: 1 });
});

test("EdgeUnits in the same cluster are isolated by direct ownership labels", () => {
  const aux = {
    nodes: [readyNode("edge-a", "unit-a"), readyNode("edge-b", "unit-b")],
    pods: [pod("pod-a", "app-a", "edge-a"), pod("pod-b", "app-b", "edge-b")],
    deployments: [deployment("deployment-a", "app-a", 1, "unit-a"), deployment("deployment-b", "app-b", 1, "unit-b")],
    edgeApplications: [edgeApplication("edge-app-a", "unit-a"), edgeApplication("edge-app-b", "unit-b")],
    accessConfigs: [],
  };
  const unitA = buildEdgeUnitRuntime(aux, "unit-a");
  const unitB = buildEdgeUnitRuntime(aux, "unit-b");

  assert.deepEqual(unitA.nodes, { ready: 1, total: 1 });
  assert.deepEqual(unitA.workloads, { healthy: 1, total: 1 });
  assert.deepEqual(unitA.applications, { healthy: 1, total: 1 });
  assert.deepEqual(unitB.nodes, { ready: 1, total: 1 });
  assert.deepEqual(unitB.workloads, { healthy: 1, total: 1 });
  assert.deepEqual(unitB.applications, { healthy: 1, total: 1 });
});

test("workload totals and health use directly owned nodes and workloads", () => {
  const ownedDeployment = deployment("owned-deployment", "owned-app", 1, "unit-a");
  const aux = {
    nodes: [readyNode("edge-a", "unit-a"), readyNode("cloud-node", "unit-b")],
    pods: [
      pod("edge-pending", "owned-app", "edge-a", { phase: "Pending", ready: false }),
      pod("cloud-ready", "owned-app", "cloud-node"),
    ],
    deployments: [ownedDeployment],
    edgeApplications: [
      edgeApplication("ready-app", "unit-a", "Running"),
      edgeApplication("pending-app", "unit-a", "Pending"),
    ],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "unit-a");

  assert.deepEqual(result.workloads, { healthy: 0, total: 1 });
  assert.deepEqual(result.applications, { healthy: 1, total: 2 });
});

test("deleting pods do not assign an unowned cloud workload to an EdgeUnit", () => {
  const aux = {
    nodes: [readyNode("k8s-laptop-edge", "demo-edge-unit"), readyNode("k8s-master")],
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

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");

  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
});
