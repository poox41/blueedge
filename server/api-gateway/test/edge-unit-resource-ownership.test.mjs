import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEdgeUnitConfiguration,
  buildEdgeUnitConfigMapData,
  buildEdgeUnitRuntime,
  bindDeploymentToEdgeUnit,
  cloudCoreRuntimeStatus,
  deploymentBelongsToEdgeUnit,
  deploymentTargetsEdgeUnit,
  edgeApplicationBelongsToEdgeUnit,
  edgeApplicationTargetsEdgeUnit,
  findEdgeUnitClusterConflict,
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

test("one connected cluster can only be bound to one EdgeUnit", () => {
  const configMaps = [
    { metadata: { name: "edgeunit-unit-a" }, data: { name: "unit-a", clusterName: "kubernetes" } },
    { metadata: { name: "edgeunit-unit-b" }, data: { name: "unit-b", clusterName: "other" } },
  ];

  assert.equal(findEdgeUnitClusterConflict(configMaps, "kubernetes"), "unit-a");
  assert.equal(findEdgeUnitClusterConflict(configMaps, "kubernetes", "unit-a"), null);
  assert.equal(findEdgeUnitClusterConflict(configMaps, "new-cluster"), null);
  assert.equal(findEdgeUnitClusterConflict(configMaps, ""), null);
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

test("EdgeUnit status follows CloudCore readiness instead of edge node readiness", () => {
  const cloudCoreDeployment = {
    metadata: { name: "cloudcore", namespace: "kubeedge", labels: { kubeedge: "cloudcore" } },
    spec: { replicas: 1, template: { spec: { containers: [{ name: "cloudcore" }] } } },
    status: { availableReplicas: 1, readyReplicas: 1 },
  };
  const aux = {
    nodes: [
      externalReadyNode("edge-ready", { "node-role.kubernetes.io/edge": "" }),
      { ...externalReadyNode("edge-offline", { "node-role.kubernetes.io/edge": "" }), status: { conditions: [{ type: "Ready", status: "False" }] } },
    ],
    pods: [],
    deployments: [cloudCoreDeployment],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "unit-a");
  assert.equal(result.status, "running");
  assert.deepEqual(result.nodes, { ready: 1, total: 2 });
});

test("EdgeUnit status is abnormal only when an observed CloudCore workload is not ready", () => {
  const unavailable = {
    metadata: { name: "cloudcore", namespace: "kubeedge" },
    spec: { replicas: 1, template: { spec: { containers: [{ name: "cloudcore" }] } } },
    status: { availableReplicas: 0, readyReplicas: 0 },
  };
  assert.equal(cloudCoreRuntimeStatus([unavailable], []), "abnormal");
  assert.equal(cloudCoreRuntimeStatus([], []), "unknown");
});

test("EdgeUnit includes cluster EdgeApplications without relying on BlueEdge ownership labels", () => {
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
  assert.deepEqual(result.applications, { healthy: 1, total: 1 });
});

test("EdgeUnits discover all cluster edge nodes from standard KubeEdge role labels", () => {
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
  assert.deepEqual(result.nodes, { ready: 3, total: 3 });
  assert.deepEqual(result.workloads, { healthy: 2, total: 2 });
});

test("dedicated EdgeUnits also count standard KubeEdge nodes in their cluster", () => {
  const aux = {
    nodes: [externalReadyNode("external-edge", { "node-role.kubernetes.io/edge": "" })],
    pods: [],
    deployments: [],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "dedicated-unit", { accessType: "dedicated" });
  assert.deepEqual(result.nodes, { ready: 1, total: 1 });
});

test("EdgeUnit resolves directly labeled nodes and resources", () => {
  const aux = {
    nodes: [externalReadyNode("k8s-laptop-edge", { "node-role.kubernetes.io/edge": "", "blueedge.io/edge-unit": "unit-a" }), readyNode("cloud-node", "unit-b")],
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
  assert.deepEqual(result.applications, { healthy: 2, total: 2 });
});

test("EdgeUnit resolves legacy nodes from AccessConfig ownership without NodeGroup binding", () => {
  const aux = {
    nodes: [externalReadyNode("legacy-edge", { "node-role.kubernetes.io/edge": "" })],
    pods: [],
    deployments: [],
    edgeApplications: [],
    accessConfigs: [{ data: { edgeUnitRef: "unit-a", nodeName: "legacy-edge" } }],
  };

  const result = buildEdgeUnitRuntime(aux, "unit-a");
  assert.deepEqual(result.nodes, { ready: 1, total: 1 });
});

test("EdgeApplication totals follow the connected cluster instead of ownership labels", () => {
  const aux = {
    nodes: [
      externalReadyNode("edge-a", { "node-role.kubernetes.io/edge": "", "blueedge.io/edge-unit": "unit-a" }),
      externalReadyNode("edge-b", { "node-role.kubernetes.io/edge": "", "blueedge.io/edge-unit": "unit-b" }),
    ],
    pods: [pod("pod-a", "app-a", "edge-a"), pod("pod-b", "app-b", "edge-b")],
    deployments: [deployment("deployment-a", "app-a", 1, "unit-a"), deployment("deployment-b", "app-b", 1, "unit-b")],
    edgeApplications: [edgeApplication("edge-app-a", "unit-a"), edgeApplication("edge-app-b", "unit-b")],
    accessConfigs: [],
  };
  const unitA = buildEdgeUnitRuntime(aux, "unit-a");
  const unitB = buildEdgeUnitRuntime(aux, "unit-b");

  assert.deepEqual(unitA.nodes, { ready: 2, total: 2 });
  assert.deepEqual(unitA.workloads, { healthy: 2, total: 2 });
  assert.deepEqual(unitA.applications, { healthy: 2, total: 2 });
  assert.deepEqual(unitB.nodes, { ready: 2, total: 2 });
  assert.deepEqual(unitB.workloads, { healthy: 2, total: 2 });
  assert.deepEqual(unitB.applications, { healthy: 2, total: 2 });
});

test("overview application totals use the same real edge NodeGroup scope as the batch workload list", () => {
  const valid = edgeApplication("valid-edge-app", "unit-a");
  const missing = edgeApplication("missing-group-app", "unit-a");
  missing.spec.workloadScope.targetNodeGroups = [{ name: "missing-group" }];
  const cloud = edgeApplication("cloud-group-app", "unit-a");
  cloud.spec.workloadScope.targetNodeGroups = [{ name: "cloud-group" }];
  const aux = {
    nodes: [
      externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "" }),
      readyNode("k8s-master"),
    ],
    nodeGroups: [
      { metadata: { name: "shared-target-group" }, spec: { nodes: ["edge-01"] } },
      { metadata: { name: "cloud-group" }, spec: { nodes: ["k8s-master"] } },
    ],
    pods: [],
    deployments: [],
    edgeApplications: [valid, missing, cloud],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "unit-a");
  assert.deepEqual(result.applications, { healthy: 1, total: 1 });
});

test("workload totals and health use directly owned nodes and workloads", () => {
  const ownedDeployment = deployment("owned-deployment", "owned-app", 1, "unit-a");
  const aux = {
    nodes: [externalReadyNode("edge-a", { "node-role.kubernetes.io/edge": "", "blueedge.io/edge-unit": "unit-a" }), readyNode("cloud-node", "unit-b")],
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

test("a currently cloud-scheduled Deployment is not rescued by a stale terminating edge Pod", () => {
  const aux = {
    nodes: [externalReadyNode("k8s-laptop-edge", { "node-role.kubernetes.io/edge": "", "blueedge.io/edge-unit": "demo-edge-unit" }), readyNode("k8s-master")],
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

test("a pending replacement keeps its Deployment in edge workload totals through the terminating edge Pod", () => {
  const aux = {
    nodes: [externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "" }), readyNode("k8s-master")],
    pods: [
      pod("replacement-pending", "edge-app", "", { phase: "Pending", ready: false }),
      pod("edge-terminating", "edge-app", "edge-01", { phase: "Running", deletionTimestamp: "2026-07-22T01:00:00Z" }),
    ],
    deployments: [deployment("edge-app", "edge-app", 0)],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");
  assert.deepEqual(result.workloads, { healthy: 0, total: 1 });
});

test("a generic Linux nodeSelector does not turn cloud system Deployments into edge workloads", () => {
  const systemDeployment = deployment("metrics-server", "metrics-server", 1);
  systemDeployment.spec.template.spec = { nodeSelector: { "kubernetes.io/os": "linux" } };
  const aux = {
    nodes: [
      externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "", "kubernetes.io/os": "linux" }),
      { ...readyNode("k8s-master"), metadata: { name: "k8s-master", labels: { "kubernetes.io/os": "linux", "node-role.kubernetes.io/control-plane": "" } } },
    ],
    pods: [pod("metrics-server-pod", "metrics-server", "k8s-master")],
    deployments: [systemDeployment],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");
  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
});

test("mixed cloud and edge nodeAffinity candidates do not classify an unscheduled Deployment as edge-only", () => {
  const resource = deployment("mixed-affinity", "mixed-affinity", 0);
  resource.spec.template.spec = {
    affinity: {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [{
            matchExpressions: [{
              key: "kubernetes.io/hostname",
              operator: "In",
              values: ["edge-01", "k8s-master"],
            }],
          }],
        },
      },
    },
  };
  const aux = {
    nodes: [
      externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "", "kubernetes.io/hostname": "edge-01" }),
      { ...readyNode("k8s-master"), metadata: { name: "k8s-master", labels: { "kubernetes.io/hostname": "k8s-master" } } },
    ],
    pods: [],
    deployments: [resource],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");
  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
});

test("all conditions in a nodeAffinity term must match before an unscheduled Deployment is classified as edge", () => {
  const resource = deployment("contradictory-affinity", "contradictory-affinity", 0);
  resource.spec.template.spec = {
    affinity: {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [{
            matchExpressions: [
              { key: "kubernetes.io/hostname", operator: "In", values: ["edge-01"] },
              { key: "workload-zone", operator: "In", values: ["cloud"] },
            ],
          }],
        },
      },
    },
  };
  const aux = {
    nodes: [externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "", "kubernetes.io/hostname": "edge-01", "workload-zone": "edge" })],
    pods: [],
    deployments: [resource],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");
  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
});

test("overlapping legacy selectors do not assign another Deployment's edge Pod", () => {
  const cloudDeployment = deployment("my-workload", "my-app", 1);
  const edgeDeployment = deployment("aaa", "my-app", 0);
  const cloudPod = pod("my-workload-rs-pod", "my-app", "k8s-master");
  cloudPod.metadata.ownerReferences = [{ kind: "ReplicaSet", name: "my-workload-68f7d9" }];
  const edgePod = pod("aaa-rs-pod", "my-app", "edge-01", { phase: "Pending", ready: false });
  edgePod.metadata.ownerReferences = [{ kind: "ReplicaSet", name: "aaa-5ddf6" }];
  const aux = {
    nodes: [externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "" }), readyNode("k8s-master")],
    pods: [cloudPod, edgePod],
    deployments: [cloudDeployment, edgeDeployment],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");
  assert.deepEqual(result.workloads, { healthy: 0, total: 1 });
});

test("a longer Deployment name does not make its edge Pod belong to a shorter cloud Deployment", () => {
  const cloudDeployment = deployment("ov-model", "ov-model", 1);
  const edgeDeployment = deployment("ov-model-blueedge-import", "ov-model", 1);
  const cloudPod = pod("ov-model-cloud", "ov-model", "k8s-master");
  cloudPod.metadata.ownerReferences = [{ kind: "ReplicaSet", name: "ov-model-fc97bf764" }];
  const edgePod = pod("ov-model-import-edge", "ov-model", "edge-01");
  edgePod.metadata.ownerReferences = [{ kind: "ReplicaSet", name: "ov-model-blueedge-import-5cb476bbd7" }];
  const aux = {
    nodes: [externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "" }), readyNode("k8s-master")],
    pods: [cloudPod, edgePod],
    deployments: [cloudDeployment, edgeDeployment],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");
  assert.deepEqual(result.workloads, { healthy: 1, total: 1 });
});

test("a completed edge Pod does not keep a currently cloud-running Deployment in edge workloads", () => {
  const resource = deployment("ov-model", "ov-model", 1);
  const completedEdgePod = pod("ov-model-old", "ov-model", "edge-01", { phase: "Succeeded", ready: false });
  completedEdgePod.metadata.ownerReferences = [{ kind: "ReplicaSet", name: "ov-model-oldrs" }];
  const runningCloudPod = pod("ov-model-current", "ov-model", "k8s-master");
  runningCloudPod.metadata.ownerReferences = [{ kind: "ReplicaSet", name: "ov-model-currentrs" }];
  const aux = {
    nodes: [externalReadyNode("edge-01", { "node-role.kubernetes.io/edge": "" }), readyNode("k8s-master")],
    pods: [completedEdgePod, runningCloudPod],
    deployments: [resource],
    edgeApplications: [],
    accessConfigs: [],
  };

  const result = buildEdgeUnitRuntime(aux, "demo-edge-unit");
  assert.deepEqual(result.workloads, { healthy: 0, total: 0 });
});
