import crypto from "node:crypto";
import * as yaml from "js-yaml";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import {
  batchTaskResourceValue,
  blueedgeNamespace,
  blueedgeResourceLabel,
  create as createConfigMap,
  ensureNamespace,
  listByResourceLabel,
  remove as removeConfigMap,
  update as updateConfigMap,
} from "../repositories/blueedge-configmap.repository.js";
import type { BatchWorkloadPlan, BatchWorkloadPlanContainer } from "../types/batch-task.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import { dataOf, getResourceEvents, itemsOf, labelsOf, metadataOf } from "../utils/kubernetes.js";
import { readStringArrayField, readStringField } from "../utils/validation.js";
import { bindDeploymentToEdgeUnit, isExternalEdgeNode } from "./edge-unit.service.js";
import {
  edgeApplicationTargetsOnlyMatchingNodes,
  matchedNodesForNodeGroup,
} from "./edge-application-placement.service.js";

const batchTaskNameLabel = "blueedge.io/batch-task";
const batchTaskTypeLabel = "blueedge.io/task-type";
const managedByLabel = "blueedge.io/managed-by";
const workloadIdLabel = "blueedge.io/batch-workload-id";
const targetGroupLabel = "blueedge.io/target-group";
const managedByValue = "blueedge-batch-workload";

function dnsLabel(value: string, fallback = "workload") {
  const normalized = value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return (normalized || fallback).slice(0, 63).replace(/[^a-z0-9]+$/g, "") || fallback;
}

function compactName(...parts: string[]) {
  const value = dnsLabel(parts.filter(Boolean).join("-"));
  if (value.length <= 54) return value;
  const hash = crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
  return `${value.slice(0, 45).replace(/[^a-z0-9]+$/g, "")}-${hash}`;
}

function batchWorkloadId(namespace: string, name: string) {
  return compactName("bw", namespace, name);
}

function controlConfigMapName(id: string) {
  return compactName("batch-workload", id);
}

function deploymentPath(namespace: string, name?: string) {
  const base = `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

function edgeApplicationPath(namespace?: string, name?: string) {
  const base = namespace
    ? `/apis/apps.kubeedge.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/edgeapplications`
    : "/apis/apps.kubeedge.io/v1alpha1/edgeapplications";
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function normalizeContainer(value: any, index: number): BatchWorkloadPlanContainer {
  const name = String(value?.name || `container-${index + 1}`).trim();
  const image = String(value?.image || "").trim();
  if (!name || !image) throw new Error(`第 ${index + 1} 个容器缺少名称或镜像`);
  const imagePullPolicy = ["Always", "IfNotPresent", "Never"].includes(String(value?.imagePullPolicy))
    ? value.imagePullPolicy
    : "IfNotPresent";
  return {
    name,
    image,
    imagePullPolicy,
    command: Array.isArray(value?.command) ? value.command.map(String).filter(Boolean) : [],
    args: Array.isArray(value?.args) ? value.args.map(String) : [],
    env: Array.isArray(value?.env) ? value.env.filter((item: any) => item?.name).map((item: any) => ({ name: String(item.name), value: String(item.value ?? "") })) : [],
    resources: value?.resources && typeof value.resources === "object" ? value.resources : {},
    lifecycle: value?.lifecycle && typeof value.lifecycle === "object" ? value.lifecycle : {},
    healthChecks: value?.healthChecks && typeof value.healthChecks === "object" ? value.healthChecks : {},
    securityContext: value?.securityContext && typeof value.securityContext === "object" ? value.securityContext : {},
    volumes: Array.isArray(value?.volumes) ? value.volumes.map((item: any) => ({ name: String(item?.name || ""), type: String(item?.type || "emptyDir"), mountPath: String(item?.mountPath || ""), source: String(item?.source || "") })).filter((item: any) => item.name && item.mountPath) : [],
  };
}

function normalizePlan(body: any): BatchWorkloadPlan {
  const source = body?.plan && typeof body.plan === "object" ? body.plan : body;
  const namespace = String(source?.namespace || body?.namespace || "default").trim();
  const name = String(source?.name || body?.name || "").trim();
  const targetGroups: string[] = Array.isArray(source?.targetGroups)
    ? source.targetGroups.map(String).map((item: string) => item.trim()).filter(Boolean)
    : readStringArrayField(body, "targetRefs");
  const replicas = Math.floor(Number(source?.replicas ?? 1));
  const containers = Array.isArray(source?.podTemplate?.containers) ? source.podTemplate.containers.map(normalizeContainer) : [];
  if (!namespace || !name) throw new Error("namespace and name are required");
  if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(name) || name.length > 63) throw new Error("名称必须是合法的 Kubernetes DNS 名称且不超过 63 个字符");
  if (!Number.isInteger(replicas) || replicas < 1) throw new Error("replicas must be a positive integer");
  if (containers.length === 0) throw new Error("至少配置一个容器");
  return {
    ...(String(source?.edgeUnitRef || body?.edgeUnitRef || "").trim() ? { edgeUnitRef: String(source?.edgeUnitRef || body?.edgeUnitRef).trim() } : {}),
    namespace,
    name,
    targetGroups: [...new Set(targetGroups)],
    replicas,
    workloadType: "Deployment",
    metadata: { labels: stringRecord(source?.metadata?.labels), annotations: stringRecord(source?.metadata?.annotations) },
    podTemplate: {
      labels: stringRecord(source?.podTemplate?.labels),
      annotations: stringRecord(source?.podTemplate?.annotations),
      containers,
      ...(source?.podTemplate?.network && typeof source.podTemplate.network === "object" ? { network: source.podTemplate.network } : {}),
      terminationGracePeriodSeconds: Math.max(0, Math.floor(Number(source?.podTemplate?.terminationGracePeriodSeconds ?? 30))),
    },
    strategy: {
      type: source?.strategy?.type === "Recreate" ? "Recreate" : "RollingUpdate",
      maxUnavailable: String(source?.strategy?.maxUnavailable || "25%"),
      maxSurge: String(source?.strategy?.maxSurge || "25%"),
      revisionHistoryLimit: Math.max(0, Math.floor(Number(source?.strategy?.revisionHistoryLimit ?? 10))),
      minReadySeconds: Math.max(0, Math.floor(Number(source?.strategy?.minReadySeconds ?? 0))),
      progressDeadlineSeconds: Math.max(1, Math.floor(Number(source?.strategy?.progressDeadlineSeconds ?? 600))),
    },
  };
}

function volumeDefinition(volume: { name: string; type: string; source?: string }) {
  if (volume.type === "hostPath") return { name: volume.name, hostPath: { path: volume.source || `/tmp/${volume.name}`, type: "DirectoryOrCreate" } };
  if (volume.type === "pvc") return { name: volume.name, persistentVolumeClaim: { claimName: volume.source } };
  if (volume.type === "configMap") return { name: volume.name, configMap: { name: volume.source } };
  if (volume.type === "secret") return { name: volume.name, secret: { secretName: volume.source } };
  return { name: volume.name, emptyDir: {} };
}

function execHandler(command: string | undefined) {
  return command?.trim() ? { exec: { command: ["/bin/sh", "-c", command.trim()] } } : undefined;
}

function deploymentContainer(container: BatchWorkloadPlanContainer, network: BatchWorkloadPlan["podTemplate"]["network"]) {
  const ports = network?.type === "portmap"
    ? (network.ports || []).filter((item) => item.containerName === container.name).map((item) => ({ containerPort: item.containerPort, ...(item.hostPort ? { hostPort: item.hostPort } : {}) }))
    : [];
  const lifecycle = {
    ...(execHandler(container.lifecycle?.postStart) ? { postStart: execHandler(container.lifecycle?.postStart) } : {}),
    ...(execHandler(container.lifecycle?.preStop) ? { preStop: execHandler(container.lifecycle?.preStop) } : {}),
  };
  const processProbe = { exec: { command: ["/bin/sh", "-c", "test -e /proc/1"] }, periodSeconds: 10, timeoutSeconds: 2 };
  return {
    name: dnsLabel(container.name, "container"),
    image: container.image,
    imagePullPolicy: container.imagePullPolicy || "IfNotPresent",
    ...(container.command?.length ? { command: container.command } : {}),
    ...(container.args?.length ? { args: container.args } : {}),
    ...(container.env?.length ? { env: container.env } : {}),
    ...(container.resources && Object.keys(container.resources).length ? { resources: container.resources } : {}),
    ...(Object.keys(lifecycle).length ? { lifecycle } : {}),
    ...(container.healthChecks?.startup ? { startupProbe: { ...processProbe, periodSeconds: 5, failureThreshold: 30 } } : {}),
    ...(container.healthChecks?.readiness ? { readinessProbe: { ...processProbe, initialDelaySeconds: 3, failureThreshold: 3 } } : {}),
    ...(container.healthChecks?.liveness ? { livenessProbe: { ...processProbe, initialDelaySeconds: 15, failureThreshold: 3 } } : {}),
    ...(container.securityContext && Object.keys(container.securityContext).length ? { securityContext: container.securityContext } : {}),
    ...(container.volumes?.length ? { volumeMounts: container.volumes.map((item) => ({ name: dnsLabel(item.name, "volume"), mountPath: item.mountPath })) } : {}),
    ...(ports.length ? { ports } : {}),
  };
}

export function buildBatchDeployment(plan: BatchWorkloadPlan, id: string, targetGroup: any) {
  const groupName = String(metadataOf(targetGroup).name || targetGroup?.name || "");
  const explicitNodes = Array.isArray(targetGroup?.spec?.nodes) ? targetGroup.spec.nodes.map(String).filter(Boolean) : [];
  const matchLabels = stringRecord(targetGroup?.spec?.matchLabels);
  const instanceName = compactName(plan.name, groupName);
  const selectorLabels = {
    "app.kubernetes.io/name": dnsLabel(plan.name),
    "app.kubernetes.io/instance": compactName(id, groupName),
    [workloadIdLabel]: id,
    [targetGroupLabel]: dnsLabel(groupName),
  };
  const allVolumes = new Map<string, any>();
  plan.podTemplate.containers.flatMap((container) => container.volumes || []).forEach((volume) => {
    allVolumes.set(dnsLabel(volume.name, "volume"), volumeDefinition({ ...volume, name: dnsLabel(volume.name, "volume") }));
  });
  const scheduling = explicitNodes.length
    ? { affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: "kubernetes.io/hostname", operator: "In", values: explicitNodes }] }] } } } }
    : Object.keys(matchLabels).length ? { nodeSelector: matchLabels } : {};
  const strategy = plan.strategy?.type === "Recreate"
    ? { type: "Recreate" }
    : { type: "RollingUpdate", rollingUpdate: { maxUnavailable: plan.strategy?.maxUnavailable || "25%", maxSurge: plan.strategy?.maxSurge || "25%" } };
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: instanceName,
      namespace: plan.namespace,
      labels: {
        ...(plan.metadata?.labels || {}),
        ...selectorLabels,
        [managedByLabel]: managedByValue,
        "blueedge.io/node-group": groupName,
        ...(plan.edgeUnitRef ? { "blueedge.io/edge-unit": plan.edgeUnitRef } : {}),
      },
      annotations: { ...(plan.metadata?.annotations || {}), "blueedge.io/batch-workload-name": plan.name, "blueedge.io/target-group-name": groupName },
    },
    spec: {
      replicas: plan.replicas,
      selector: { matchLabels: selectorLabels },
      strategy,
      revisionHistoryLimit: plan.strategy?.revisionHistoryLimit ?? 10,
      minReadySeconds: plan.strategy?.minReadySeconds ?? 0,
      progressDeadlineSeconds: plan.strategy?.progressDeadlineSeconds ?? 600,
      template: {
        metadata: {
          labels: {
            ...(plan.podTemplate.labels || {}),
            ...selectorLabels,
            "blueedge.io/node-group": groupName,
            ...(plan.edgeUnitRef ? { "blueedge.io/edge-unit": plan.edgeUnitRef } : {}),
          },
          annotations: plan.podTemplate.annotations || {},
        },
        spec: {
          ...scheduling,
          ...(plan.podTemplate.network?.type === "host" ? { hostNetwork: true, dnsPolicy: "ClusterFirstWithHostNet" } : {}),
          terminationGracePeriodSeconds: plan.podTemplate.terminationGracePeriodSeconds ?? 30,
          containers: plan.podTemplate.containers.map((container) => deploymentContainer(container, plan.podTemplate.network)),
          ...(allVolumes.size ? { volumes: [...allVolumes.values()] } : {}),
        },
      },
    },
  };
}

function buildBatchWorkloadManifest(plan: BatchWorkloadPlan, id: string, targetGroup: any) {
  const resource: any = buildBatchDeployment(plan, id, targetGroup);
  resource.metadata.name = plan.name;
  delete resource.metadata.labels[targetGroupLabel];
  delete resource.metadata.labels["blueedge.io/node-group"];
  delete resource.metadata.annotations["blueedge.io/target-group-name"];
  delete resource.spec.selector.matchLabels[targetGroupLabel];
  delete resource.spec.template.metadata.labels[targetGroupLabel];
  delete resource.spec.template.metadata.labels["blueedge.io/node-group"];
  delete resource.spec.template.spec.affinity;
  delete resource.spec.template.spec.nodeSelector;
  return resource;
}

export function buildBatchEdgeApplication(
  plan: BatchWorkloadPlan,
  id: string,
  targetGroups: any[],
  source?: any,
) {
  if (targetGroups.length === 0) throw new Error("至少选择一个 NodeGroup");
  const next = source && typeof source === "object" && !Array.isArray(source)
    ? structuredClone(source)
    : {
        apiVersion: "apps.kubeedge.io/v1alpha1",
        kind: "EdgeApplication",
        metadata: { name: plan.name, namespace: plan.namespace },
        spec: {
          workloadTemplate: {
            manifests: [buildBatchWorkloadManifest(plan, id, targetGroups[0])],
          },
        },
      };

  if (next.apiVersion !== "apps.kubeedge.io/v1alpha1" || next.kind !== "EdgeApplication") {
    throw new Error("批量工作负载 YAML 必须是 apps.kubeedge.io/v1alpha1 EdgeApplication");
  }
  const manifests = next?.spec?.workloadTemplate?.manifests;
  if (!Array.isArray(manifests) || manifests.length === 0) {
    throw new Error("EdgeApplication spec.workloadTemplate.manifests 不能为空");
  }

  next.metadata = {
    ...(next.metadata || {}),
    name: plan.name,
    namespace: plan.namespace,
    labels: {
      ...(next.metadata?.labels || {}),
      [managedByLabel]: managedByValue,
      [workloadIdLabel]: id,
      ...(plan.edgeUnitRef ? { "blueedge.io/edge-unit": plan.edgeUnitRef } : {}),
    },
  };
  next.spec = {
    ...(next.spec || {}),
    workloadScope: {
      ...(next.spec?.workloadScope || {}),
      targetNodeGroups: plan.targetGroups.map((name) => {
        const existing = Array.isArray(next.spec?.workloadScope?.targetNodeGroups)
          ? next.spec.workloadScope.targetNodeGroups.find((item: any) => String(item?.name || "") === name)
          : null;
        return { ...(existing || {}), name, overrides: existing?.overrides || {} };
      }),
    },
    workloadTemplate: {
      ...(next.spec?.workloadTemplate || {}),
      manifests,
    },
  };
  return next;
}

async function listNodeGroups() {
  const data = await getK8sJson("/apis/apps.kubeedge.io/v1alpha1/nodegroups");
  return itemsOf(data);
}

export function edgeApplicationTargetsOnlyEdgeNodes(resource: any, groupsByName: Map<string, any>, nodes: any[]): boolean {
  return edgeApplicationTargetsOnlyMatchingNodes(resource, groupsByName, nodes, isExternalEdgeNode);
}

async function validateTargets(plan: BatchWorkloadPlan) {
  await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(plan.namespace)}`);
  const [groups, nodesData] = await Promise.all([listNodeGroups(), getK8sJson("/api/v1/nodes")]);
  const groupsByName = new Map(groups.map((group: any) => [String(metadataOf(group).name), group]));
  const nodes = itemsOf(nodesData);
  const selected = plan.targetGroups.map((name) => {
    const group = groupsByName.get(name);
    if (!group) throw new Error(`NodeGroup ${name} not found`);
    const matched = matchedNodesForNodeGroup(group, nodes);
    if (matched.length === 0) throw new Error(`NodeGroup ${name} 未匹配到任何真实节点`);
    if (matched.some((node) => !isExternalEdgeNode(node))) throw new Error(`NodeGroup ${name} 包含非边缘节点`);
    return group;
  });
  return selected;
}

async function bindPlanToEdgeUnit(plan: BatchWorkloadPlan): Promise<BatchWorkloadPlan> {
  return plan;
}

function controlMatches(resource: any, id: string) {
  const data = dataOf(resource);
  return data.type === "batchWorkload" && (data.id === id || metadataOf(resource).name === id || metadataOf(resource).name === controlConfigMapName(id));
}

async function listControls() {
  const items = await listByResourceLabel(batchTaskResourceValue);
  return items.filter((item) => dataOf(item).type === "batchWorkload" && ["deployment", "edgeapplication"].includes(dataOf(item).executionMode));
}

async function findControl(id: string) {
  return (await listControls()).find((item) => controlMatches(item, id)) || null;
}

async function listManagedDeployments() {
  const selector = encodeURIComponent(`${managedByLabel}=${managedByValue}`);
  return itemsOf(await getK8sJson(`/apis/apps/v1/deployments?labelSelector=${selector}`));
}

async function listManagedEdgeApplications() {
  return itemsOf(await getK8sJson(edgeApplicationPath()));
}

function nativeEdgeApplicationRef(control: any): string {
  return dataOf(control).nativeEdgeApplicationRef || "";
}

function edgeApplicationRef(resource: any): string {
  const metadata = metadataOf(resource);
  return `${String(metadata.namespace || "default")}/${String(metadata.name || "")}`;
}

function planFromEdgeApplication(resource: any, edgeUnitRef = ""): BatchWorkloadPlan {
  const metadata = metadataOf(resource);
  const manifest = edgeApplicationManifests(resource).find((item) => item?.kind === "Deployment") || edgeApplicationManifests(resource)[0] || {};
  const containers = Array.isArray(manifest?.spec?.template?.spec?.containers) ? manifest.spec.template.spec.containers : [];
  return {
    ...(edgeUnitRef ? { edgeUnitRef } : {}),
    namespace: String(metadata.namespace || "default"),
    name: String(metadata.name || ""),
    targetGroups: edgeApplicationTargetGroups(resource),
    replicas: Number(manifest?.spec?.replicas ?? 1),
    workloadType: "Deployment",
    metadata: { labels: {}, annotations: {} },
    podTemplate: {
      labels: {},
      annotations: {},
      containers: containers.map((container: any, index: number) => ({
        name: String(container?.name || `container-${index + 1}`),
        image: String(container?.image || ""),
        imagePullPolicy: ["Always", "Never"].includes(String(container?.imagePullPolicy)) ? container.imagePullPolicy : "IfNotPresent",
        command: Array.isArray(container?.command) ? container.command.map(String) : [],
        args: Array.isArray(container?.args) ? container.args.map(String) : [],
        env: Array.isArray(container?.env) ? container.env : [],
        resources: container?.resources || {},
        lifecycle: container?.lifecycle || {},
        healthChecks: {},
        securityContext: container?.securityContext || {},
        volumes: [],
      })),
      terminationGracePeriodSeconds: Number(manifest?.spec?.template?.spec?.terminationGracePeriodSeconds ?? 30),
    },
    strategy: { type: "RollingUpdate", maxUnavailable: "25%", maxSurge: "25%" },
  };
}

function syntheticEdgeApplicationControl(resource: any, edgeUnitRef = "") {
  const metadata = metadataOf(resource);
  const id = batchWorkloadId(String(metadata.namespace || "default"), String(metadata.name || ""));
  const plan = planFromEdgeApplication(resource, edgeUnitRef);
  return {
    metadata: { name: id, namespace: blueedgeNamespace(), creationTimestamp: metadata.creationTimestamp },
    data: {
      id,
      name: String(metadata.name || id),
      namespace: String(metadata.namespace || "default"),
      type: "batchWorkload",
      executionMode: "edgeapplication",
      nativeEdgeApplicationRef: edgeApplicationRef(resource),
      description: String(metadata.annotations?.["blueedge.io/description"] || ""),
      createdAt: String(metadata.creationTimestamp || ""),
      planJson: JSON.stringify(plan),
    },
  };
}

function deploymentStatus(item: any) {
  const desired = Number(item?.spec?.replicas ?? 1);
  const ready = Number(item?.status?.readyReplicas ?? 0);
  const available = Number(item?.status?.availableReplicas ?? 0);
  const failed = Array.isArray(item?.status?.conditions) && item.status.conditions.some((condition: any) => condition?.type === "Progressing" && condition?.status === "False");
  if (failed) return "failed";
  if (ready >= desired && available >= desired) return "succeeded";
  return "running";
}

function cleanDeployment(resource: any) {
  const copy = structuredClone(resource);
  delete copy.apiVersion;
  delete copy.kind;
  if (copy?.metadata) {
    delete copy.metadata.managedFields;
    delete copy.metadata.resourceVersion;
    delete copy.metadata.uid;
    delete copy.metadata.generation;
    delete copy.metadata.creationTimestamp;
  }
  delete copy.status;
  return { apiVersion: "apps/v1", kind: "Deployment", ...copy };
}

function cleanEdgeApplication(resource: any) {
  const copy = structuredClone(resource);
  if (copy?.metadata) {
    delete copy.metadata.managedFields;
    delete copy.metadata.resourceVersion;
    delete copy.metadata.uid;
    delete copy.metadata.generation;
    delete copy.metadata.creationTimestamp;
  }
  delete copy.status;
  return copy;
}

function edgeApplicationManifests(resource: any): any[] {
  return Array.isArray(resource?.spec?.workloadTemplate?.manifests)
    ? resource.spec.workloadTemplate.manifests
    : [];
}

function edgeApplicationTargetGroups(resource: any): string[] {
  const groups = resource?.spec?.workloadScope?.targetNodeGroups;
  return Array.isArray(groups) ? groups.map((item: any) => String(item?.name || "")).filter(Boolean) : [];
}

function edgeApplicationStatus(resource: any) {
  const value = String(resource?.status?.phase || resource?.status?.status || resource?.status?.state || "").toLowerCase();
  if (["failed", "error", "abnormal"].includes(value)) return "failed";
  if (["ready", "running", "success", "succeeded", "available"].includes(value)) return "succeeded";
  const workloadStatus = Array.isArray(resource?.status?.workloadStatus) ? resource.status.workloadStatus : [];
  if (workloadStatus.some((item: any) => String(item?.conditions || "").toLowerCase() === "available")) return "succeeded";
  if (workloadStatus.some((item: any) => ["failed", "error"].includes(String(item?.conditions || "").toLowerCase()))) return "failed";
  return "running";
}

function controlPlan(control: any): BatchWorkloadPlan | null {
  return parseJson<BatchWorkloadPlan | null>(dataOf(control).planJson, null);
}

function workloadView(control: any, deployments: any[], edgeApplications: any[] = [], existingNodeGroups?: Set<string>) {
  const data = dataOf(control);
  const plan = controlPlan(control);
  const id = data.id || labelsOf(control)[batchTaskNameLabel] || metadataOf(control).name;
  const edgeApplicationMode = data.executionMode === "edgeapplication";
  const nativeRef = nativeEdgeApplicationRef(control);
  const instances = edgeApplicationMode
    ? edgeApplications.filter((item) => nativeRef ? edgeApplicationRef(item) === nativeRef : labelsOf(item)[workloadIdLabel] === id).map((item) => {
        const manifests = edgeApplicationManifests(item);
        const deployment = manifests.find((manifest) => manifest?.kind === "Deployment") || manifests[0] || {};
        const desired = Number(deployment?.spec?.replicas ?? plan?.replicas ?? 1);
        const containers = Array.isArray(deployment?.spec?.template?.spec?.containers) ? deployment.spec.template.spec.containers : [];
        const status = edgeApplicationStatus(item);
        const targetGroups = edgeApplicationTargetGroups(item);
        const missingNodeGroups = existingNodeGroups
          ? targetGroups.filter((name) => !existingNodeGroups.has(name))
          : [];
        return {
          name: String(metadataOf(item).name || ""),
          namespace: String(metadataOf(item).namespace || plan?.namespace || "default"),
          nodeGroup: targetGroups.join(", "),
          targetGroups,
          missingNodeGroups,
          nodeGroupExists: missingNodeGroups.length === 0,
          replicas: desired,
          readyReplicas: status === "succeeded" ? desired : 0,
          status: missingNodeGroups.length > 0 ? "failed" : status,
          image: containers.map((container: any) => String(container?.image || "")).filter(Boolean).join(", "),
          createdAt: String(metadataOf(item).creationTimestamp || ""),
          uid: String(metadataOf(item).uid || ""),
          resourceKind: "EdgeApplication",
        };
      })
    : deployments.filter((item) => labelsOf(item)[workloadIdLabel] === id).map((item) => {
    const desired = Number(item?.spec?.replicas ?? 1);
    const ready = Number(item?.status?.readyReplicas ?? 0);
    const containers = Array.isArray(item?.spec?.template?.spec?.containers) ? item.spec.template.spec.containers : [];
    return {
      name: String(metadataOf(item).name || ""),
      namespace: String(metadataOf(item).namespace || plan?.namespace || "default"),
      nodeGroup: String(item?.metadata?.annotations?.["blueedge.io/target-group-name"] || labelsOf(item)[targetGroupLabel] || ""),
      replicas: desired,
      readyReplicas: ready,
      status: deploymentStatus(item),
      image: containers.map((container: any) => String(container?.image || "")).filter(Boolean).join(", "),
      createdAt: String(metadataOf(item).creationTimestamp || ""),
      uid: String(metadataOf(item).uid || ""),
      resourceKind: "Deployment",
    };
  });
  const targetCount = edgeApplicationMode ? (plan?.targetGroups.length || edgeApplications.flatMap(edgeApplicationTargetGroups).length) : instances.length;
  const failedCount = edgeApplicationMode
    ? (instances.some((item) => item.status === "failed") ? targetCount : 0)
    : instances.filter((item) => item.status === "failed").length;
  const successCount = edgeApplicationMode
    ? (instances.length > 0 && instances.every((item) => item.status === "succeeded") ? targetCount : 0)
    : instances.filter((item) => item.status === "succeeded").length;
  const status = instances.length === 0 ? "pending" : failedCount > 0 ? (successCount > 0 ? "partialSuccess" : "failed") : successCount === targetCount ? "succeeded" : "running";
  const liveTargetGroups = edgeApplicationMode
    ? [...new Set(edgeApplications.flatMap(edgeApplicationTargetGroups))]
    : [...new Set(instances.map((item) => item.nodeGroup).filter(Boolean))];
  const liveImages = [...new Set(instances.flatMap((item) => item.image.split(", ")).filter(Boolean))];
  const missingNodeGroups = edgeApplicationMode && existingNodeGroups
    ? liveTargetGroups.filter((name) => !existingNodeGroups.has(name))
    : [];
  const effectiveStatus = missingNodeGroups.length > 0 ? "failed" : status;
  return {
    id,
    name: data.name || plan?.name || id,
    type: "batchWorkload",
    status: effectiveStatus,
    namespace: plan?.namespace || data.namespace || "default",
    targetType: edgeApplicationMode ? "edgeapplication" : "deployment",
    targetRefs: liveTargetGroups.length ? liveTargetGroups : plan?.targetGroups || parseJson<string[]>(data.targetRefs, []),
    targetGroups: liveTargetGroups.length ? liveTargetGroups : plan?.targetGroups || [],
    missingNodeGroups,
    image: liveImages.join(", ") || plan?.podTemplate.containers.map((container) => container.image).join(", ") || data.image || "",
    description: data.description || "",
    createdAt: data.createdAt || metadataOf(control).creationTimestamp || "",
    executionMode: edgeApplicationMode ? "edgeapplication" : "deployment",
    progress: instances.length ? Math.round((successCount + failedCount) / instances.length * 100) : 0,
    totalTargets: targetCount,
    successCount,
    failedCount,
    plan,
    workloads: instances,
    rawRef: edgeApplicationMode && instances[0]
      ? { kind: "EdgeApplication", namespace: instances[0].namespace, name: instances[0].name }
      : { kind: "ConfigMap", namespace: blueedgeNamespace(), name: metadataOf(control).name },
  };
}

function controlResource(id: string, body: any, plan: BatchWorkloadPlan, edgeApplicationNames: string[]) {
  const now = new Date().toISOString();
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: controlConfigMapName(id),
      namespace: blueedgeNamespace(),
      labels: { [blueedgeResourceLabel]: batchTaskResourceValue, [batchTaskNameLabel]: id, [batchTaskTypeLabel]: "batchWorkload" },
    },
    data: {
      id,
      name: plan.name,
      namespace: plan.namespace,
      type: "batchWorkload",
      status: "running",
      targetType: "edgeapplication",
      targetRefs: JSON.stringify(plan.targetGroups),
      image: plan.podTemplate.containers.map((container) => container.image).join(", "),
      description: readStringField(body, "description"),
      createdAt: now,
      executionMode: "edgeapplication",
      planJson: JSON.stringify(plan),
      edgeApplicationsJson: JSON.stringify(edgeApplicationNames),
      eventsJson: "[]",
      auditJson: JSON.stringify([{ time: now, actor: "blueedge-api-gateway", action: "create", result: "success", message: `创建 ${edgeApplicationNames.length} 个真实 EdgeApplication` }]),
      stepsJson: "[]",
      resultsJson: "[]",
      errorsJson: "[]",
      concurrency: "1",
      failurePolicy: "continue",
      timeoutSeconds: "0",
      retryCount: "0",
      failureRateThreshold: "0",
      resourceChecksJson: "[]",
      userConfirm: "false",
      progress: "0",
      totalTargets: String(plan.targetGroups.length),
      successCount: "0",
      failedCount: "0",
      targetsJson: "[]",
      targetVersion: "",
      startedAt: now,
      finishedAt: "",
      credentialNamespace: "",
      credentialName: "",
    },
  };
}

async function createDeployments(plan: BatchWorkloadPlan, id: string, groups: any[]) {
  const created: any[] = [];
  try {
    for (const group of groups) {
      const resource = buildBatchDeployment(plan, id, group);
      created.push(await requestK8sJson(deploymentPath(plan.namespace), { method: "POST", body: resource }));
    }
    return created;
  } catch (error) {
    await Promise.allSettled(created.map((item) => requestK8sJson(deploymentPath(plan.namespace, metadataOf(item).name), { method: "DELETE" })));
    throw error;
  }
}

async function createEdgeApplication(plan: BatchWorkloadPlan, id: string, groups: any[], source?: any) {
  const resource = buildBatchEdgeApplication(plan, id, groups, source);
  return requestK8sJson(edgeApplicationPath(plan.namespace), { method: "POST", body: resource });
}

export async function listBatchWorkloads(edgeUnitRef = "") {
  const [controls, deployments, allEdgeApplications, nodeGroups, nodesData] = await Promise.all([
    listControls(),
    listManagedDeployments(),
    listManagedEdgeApplications().catch(() => []),
    listNodeGroups().catch(() => []),
    getK8sJson("/api/v1/nodes").catch(() => ({ items: [] })),
  ]);
  const existingNodeGroups = new Set(nodeGroups.map((group) => String(metadataOf(group).name || "")).filter(Boolean));
  const groupsByName = new Map(nodeGroups.map((group) => [String(metadataOf(group).name || ""), group]));
  const nodes = itemsOf(nodesData);
  const edgeApplications = allEdgeApplications.filter((item) => edgeApplicationTargetsOnlyEdgeNodes(item, groupsByName, nodes));
  const edgeApplicationControls = controls.filter((control) => {
    if (dataOf(control).executionMode !== "edgeapplication") return false;
    const id = dataOf(control).id;
    return edgeApplications.some((item) => labelsOf(item)[workloadIdLabel] === id);
  });
  const controlledRefs = new Set(edgeApplicationControls.flatMap((control) => {
    const id = dataOf(control).id;
    return edgeApplications.filter((item) => labelsOf(item)[workloadIdLabel] === id).map(edgeApplicationRef);
  }));
  const nativeControls = edgeApplications
    .filter((item) => !controlledRefs.has(edgeApplicationRef(item)))
    .map((item) => syntheticEdgeApplicationControl(item, edgeUnitRef));
  let items = [
    ...edgeApplicationControls.map((control) => workloadView(control, deployments, edgeApplications, existingNodeGroups)),
    ...nativeControls.map((control) => workloadView(control, [], edgeApplications, existingNodeGroups)),
  ];
  // The selected EdgeUnit already identifies the connected cluster. Do not
  // hide cluster EdgeApplications because an older control record has no
  // edgeUnitRef (or retains a historical name).
  return { items: items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
}

export async function createBatchWorkload(body: any) {
  let plan: BatchWorkloadPlan;
  try { plan = await bindPlanToEdgeUnit(normalizePlan(body)); } catch (error) { return { status: 400, body: { message: error instanceof Error ? error.message : "Invalid BatchWorkload payload" } }; }
  const id = batchWorkloadId(plan.namespace, plan.name);
  if (await findControl(id)) return { status: 409, body: { message: `批量工作负载 ${plan.namespace}/${plan.name} 已存在` } };
  let groups: any[];
  try { groups = plan.targetGroups.length > 0 ? await validateTargets(plan) : []; } catch (error) { return { status: 400, body: { message: error instanceof Error ? error.message : "目标校验失败" } }; }
  await ensureNamespace();
  let edgeApplication: any;
  try {
    edgeApplication = await createEdgeApplication(plan, id, groups, body?.edgeApplication);
  } catch (error) {
    return { status: 409, body: { message: error instanceof Error ? error.message : "EdgeApplication 创建失败" } };
  }
  try {
    const control = await createConfigMap(controlResource(id, body, plan, [String(metadataOf(edgeApplication).name)]));
    return { status: 201, body: { item: workloadView(control, [], [edgeApplication]) } };
  } catch (error) {
    await requestK8sJson(edgeApplicationPath(plan.namespace, metadataOf(edgeApplication).name), { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

async function detail(id: string) {
  let control = await findControl(id);
  let nativeEdgeApplication: any | null = null;
  if (!control) {
    const allEdgeApplications = await listManagedEdgeApplications().catch(() => []);
    nativeEdgeApplication = allEdgeApplications.find((item) => batchWorkloadId(String(metadataOf(item).namespace || "default"), String(metadataOf(item).name || "")) === id) || null;
    if (!nativeEdgeApplication) return null;
    control = syntheticEdgeApplicationControl(nativeEdgeApplication);
  }
  const plan = controlPlan(control);
  const selector = encodeURIComponent(`${workloadIdLabel}=${dataOf(control).id}`);
  const edgeApplicationMode = dataOf(control).executionMode === "edgeapplication";
  const deployments = plan && !edgeApplicationMode ? itemsOf(await getK8sJson(`${deploymentPath(plan.namespace)}?labelSelector=${selector}`)) : [];
  const edgeApplications = nativeEdgeApplication
    ? [nativeEdgeApplication]
    : plan && edgeApplicationMode ? itemsOf(await getK8sJson(`${edgeApplicationPath(plan.namespace)}?labelSelector=${selector}`)) : [];
  const nodeGroups = edgeApplicationMode ? await listNodeGroups().catch(() => []) : [];
  const existingNodeGroups = new Set(nodeGroups.map((group) => String(metadataOf(group).name || "")).filter(Boolean));
  return { control, plan, deployments, edgeApplications, native: Boolean(nativeEdgeApplication), item: workloadView(control, deployments, edgeApplications, existingNodeGroups) };
}

export async function getBatchWorkload(id: string) {
  const found = await detail(id);
  if (!found) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const edgeApplicationMode = dataOf(found.control).executionMode === "edgeapplication";
  const definitions = edgeApplicationMode
    ? found.edgeApplications.flatMap(edgeApplicationManifests)
    : found.deployments.map(cleanDeployment);
  const yamlResources = edgeApplicationMode ? found.edgeApplications.map(cleanEdgeApplication) : definitions;
  const yamlText = yamlResources.map((resource) => yaml.dump(resource, { noRefs: true, lineWidth: -1 })).join("---\n");
  return { status: 200, body: { item: { ...found.item, definitions, yaml: yamlText } } };
}

export async function updateBatchWorkloadMetadata(id: string, body: any) {
  const found = await detail(id);
  if (!found) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (description.length > 500) return { status: 400, body: { message: "描述不能超过 500 个字符" } };
  if (found.native) {
    const resource = structuredClone(found.edgeApplications[0]);
    resource.metadata = resource.metadata || {};
    resource.metadata.annotations = { ...(resource.metadata.annotations || {}), "blueedge.io/description": description };
    await requestK8sJson(edgeApplicationPath(found.plan?.namespace || "default", metadataOf(resource).name), { method: "PUT", body: resource });
  } else {
    found.control.data.description = description;
    await updateConfigMap(metadataOf(found.control).name, found.control);
  }
  return getBatchWorkload(id);
}

export async function getBatchWorkloadEvents(id: string) {
  const found = await detail(id);
  if (!found) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const warnings: EdgeUnitWarning[] = [];
  const namespace = found.plan?.namespace || "default";
  if (dataOf(found.control).executionMode === "edgeapplication") {
    const edgeApplicationRows = await Promise.all(found.edgeApplications.map(async (resource) => {
      const name = String(metadataOf(resource).name);
      const events = await getResourceEvents(namespace, "EdgeApplication", name, warnings);
      return events.map((event) => ({ ...event, component: "EdgeApplication", object: name, time: event.lastTimestamp }));
    }));
    const manifests = found.edgeApplications.flatMap(edgeApplicationManifests);
    const deploymentNames = new Set(manifests.filter((manifest) => manifest?.kind === "Deployment").map((manifest) => String(manifest?.metadata?.name || "")).filter(Boolean));
    const selectorLabels = manifests.flatMap((manifest) => Object.entries(manifest?.spec?.selector?.matchLabels || {}));
    const matchesWorkload = (resource: any) => {
      const name = String(metadataOf(resource).name || "");
      const labels = labelsOf(resource);
      return labels[workloadIdLabel] === id
        || [...deploymentNames].some((deploymentName) => name === deploymentName || name.startsWith(`${deploymentName}-`))
        || selectorLabels.some(([key, value]) => labels[key] === String(value));
    };
    const [allDeployments, allPods] = await Promise.all([
      getK8sJson(deploymentPath(namespace)).then(itemsOf).catch((error) => {
        warnings.push({ source: "batch-workload-deployments", message: error instanceof Error ? error.message : "Deployments API is unavailable" });
        return [];
      }),
      getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`).then(itemsOf).catch((error) => {
        warnings.push({ source: "batch-workload-pods", message: error instanceof Error ? error.message : "Pods API is unavailable" });
        return [];
      }),
    ]);
    const deployments = allDeployments.filter(matchesWorkload);
    const pods = allPods.filter(matchesWorkload);
    const deploymentRows = await Promise.all(deployments.map(async (deployment) => {
      const name = String(metadataOf(deployment).name);
      const events = await getResourceEvents(namespace, "Deployment", name, warnings);
      return events.map((event) => ({ ...event, component: "Deployment", object: name, time: event.lastTimestamp }));
    }));
    const podRows = await Promise.all(pods.map(async (pod) => {
      const name = String(metadataOf(pod).name);
      const events = await getResourceEvents(namespace, "Pod", name, warnings);
      return events.map((event) => ({ ...event, component: "Pod", object: name, time: event.lastTimestamp }));
    }));
    const rows = [...edgeApplicationRows, ...deploymentRows, ...podRows].flat().sort((a, b) => String(b.time).localeCompare(String(a.time)));
    return { status: 200, body: { items: rows, summary: { total: rows.length, warning: rows.filter((item) => item.type === "Warning").length }, ...(warnings.length ? { warnings } : {}) } };
  }
  const selector = encodeURIComponent(`${workloadIdLabel}=${id}`);
  const pods = itemsOf(await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${selector}`).catch((error) => {
    warnings.push({ source: "batch-workload-pods", message: error instanceof Error ? error.message : "Pods API is unavailable" });
    return null;
  }));
  const deploymentRows = await Promise.all(found.deployments.map(async (deployment) => {
    const name = String(metadataOf(deployment).name);
    const events = await getResourceEvents(namespace, "Deployment", name, warnings);
    return events.map((event) => ({ ...event, component: "Deployment", object: name, time: event.lastTimestamp }));
  }));
  const podRows = await Promise.all(pods.map(async (pod) => {
    const name = String(metadataOf(pod).name);
    const events = await getResourceEvents(namespace, "Pod", name, warnings);
    return events.map((event) => ({ ...event, component: "Pod", object: name, time: event.lastTimestamp }));
  }));
  const rows = [...deploymentRows, ...podRows].flat().sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return { status: 200, body: { items: rows, summary: { total: rows.length, warning: rows.filter((item) => item.type === "Warning").length }, ...(warnings.length ? { warnings } : {}) } };
}

export async function getBatchWorkloadAudit(id: string) {
  const found = await detail(id);
  if (!found) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const resources = [
    ...(!found.native ? [{ resource: found.control, kind: "ConfigMap" }] : []),
    ...found.deployments.map((resource) => ({ resource, kind: "Deployment" })),
    ...found.edgeApplications.map((resource) => ({ resource, kind: "EdgeApplication" })),
  ];
  const items = resources.flatMap(({ resource, kind }) => {
    const fields = Array.isArray(resource?.metadata?.managedFields) ? resource.metadata.managedFields : [];
    return fields.map((field: any) => ({
      action: `${String(field?.operation || "Update")} ${kind}/${String(metadataOf(resource).name || "")}`,
      result: "success",
      actor: String(field?.manager || "unknown"),
      method: String(field?.operation || "Update").toUpperCase(),
      sourceIP: "未提供",
      time: String(field?.time || metadataOf(resource).creationTimestamp || ""),
    }));
  }).sort((a, b) => b.time.localeCompare(a.time));
  return { status: 200, body: { items, completeAuditLog: false, warning: "当前集群未开放 Kubernetes Audit 日志；此处展示真实 metadata.managedFields，不包含访问者 IP。" } };
}

export async function addBatchWorkloadDeployments(id: string, body: any) {
  const found = await detail(id);
  if (!found || !found.plan) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  let patchPlan: BatchWorkloadPlan;
  try {
    patchPlan = await bindPlanToEdgeUnit(normalizePlan({ ...body, plan: { ...found.plan, ...(body?.plan || {}), namespace: found.plan.namespace, name: found.plan.name } }));
  } catch (error) { return { status: 400, body: { message: error instanceof Error ? error.message : "Invalid deployment payload" } }; }
  if (dataOf(found.control).executionMode === "edgeapplication") {
    const edgeApplication = found.edgeApplications[0];
    if (!edgeApplication) return { status: 409, body: { message: "受管 EdgeApplication 不存在，无法追加目标节点组" } };
    const existingGroups = new Set(edgeApplicationTargetGroups(edgeApplication));
    const newGroups = patchPlan.targetGroups.filter((name) => !existingGroups.has(name));
    if (!newGroups.length) return { status: 409, body: { message: "所选 NodeGroup 已存在于 EdgeApplication" } };
    const targetPlan = { ...patchPlan, targetGroups: newGroups };
    try { await validateTargets(targetPlan); }
    catch (error) { return { status: 400, body: { message: error instanceof Error ? error.message : "目标校验失败" } }; }
    const mergedPlan: BatchWorkloadPlan = { ...patchPlan, targetGroups: [...new Set([...found.plan.targetGroups, ...newGroups])] };
    const document = buildBatchEdgeApplication(mergedPlan, id, await validateTargets(mergedPlan), edgeApplication);
    document.metadata.resourceVersion = metadataOf(edgeApplication).resourceVersion;
    try {
      await requestK8sJson(edgeApplicationPath(found.plan.namespace, metadataOf(edgeApplication).name), { method: "PUT", body: document });
      found.control.data.planJson = JSON.stringify(mergedPlan);
      found.control.data.targetRefs = JSON.stringify(mergedPlan.targetGroups);
      await updateConfigMap(metadataOf(found.control).name, found.control);
      return getBatchWorkload(id);
    } catch (error) {
      return { status: 409, body: { message: error instanceof Error ? error.message : "EdgeApplication 目标节点组更新失败" } };
    }
  }
  const existingGroups = new Set(found.deployments.map((item) => String(item?.metadata?.annotations?.["blueedge.io/target-group-name"] || "")));
  const newGroups = patchPlan.targetGroups.filter((name) => !existingGroups.has(name));
  if (!newGroups.length) return { status: 409, body: { message: "所选 NodeGroup 已存在对应 Deployment" } };
  patchPlan.targetGroups = newGroups;
  let groups: any[];
  try { groups = await validateTargets(patchPlan); }
  catch (error) { return { status: 400, body: { message: error instanceof Error ? error.message : "目标校验失败" } }; }
  const created = await createDeployments(patchPlan, id, groups);
  const mergedPlan: BatchWorkloadPlan = { ...patchPlan, targetGroups: [...new Set([...found.plan.targetGroups, ...newGroups])] };
  found.control.data.planJson = JSON.stringify(mergedPlan);
  found.control.data.targetRefs = JSON.stringify(mergedPlan.targetGroups);
  found.control.data.deploymentsJson = JSON.stringify([...found.deployments.map((item) => metadataOf(item).name), ...created.map((item) => metadataOf(item).name)]);
  try { await updateConfigMap(metadataOf(found.control).name, found.control); }
  catch (error) {
    await Promise.allSettled(created.map((item) => requestK8sJson(deploymentPath(found.plan!.namespace, metadataOf(item).name), { method: "DELETE" })));
    throw error;
  }
  return getBatchWorkload(id);
}

export async function updateBatchWorkloadYaml(id: string, yamlText: string) {
  const found = await detail(id);
  if (!found || !found.plan) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const documents: any[] = [];
  try { yaml.loadAll(yamlText, (document) => { if (document) documents.push(document); }); }
  catch (error) { return { status: 400, body: { message: error instanceof Error ? error.message : "YAML 解析失败" } }; }
  if (found.native) {
    if (documents.length !== 1 || documents[0]?.apiVersion !== "apps.kubeedge.io/v1alpha1" || documents[0]?.kind !== "EdgeApplication") {
      return { status: 400, body: { message: "YAML 必须且只能包含一个 apps.kubeedge.io/v1alpha1 EdgeApplication" } };
    }
    const existing = found.edgeApplications[0];
    const document = documents[0];
    if (String(document?.metadata?.name || "") !== String(metadataOf(existing).name)) {
      return { status: 400, body: { message: "编辑 YAML 不能重命名 EdgeApplication" } };
    }
    document.metadata.namespace = String(metadataOf(existing).namespace || "default");
    document.metadata.resourceVersion = metadataOf(existing).resourceVersion;
    try {
      await requestK8sJson(edgeApplicationPath(document.metadata.namespace, document.metadata.name), { method: "PUT", body: document });
      return getBatchWorkload(id);
    } catch (error) {
      return { status: 409, body: { message: error instanceof Error ? error.message : "EdgeApplication YAML 更新失败" } };
    }
  }
  if (dataOf(found.control).executionMode === "edgeapplication") {
    if (documents.length !== 1 || documents[0]?.apiVersion !== "apps.kubeedge.io/v1alpha1" || documents[0]?.kind !== "EdgeApplication") {
      return { status: 400, body: { message: "YAML 必须且只能包含一个 apps.kubeedge.io/v1alpha1 EdgeApplication" } };
    }
    const existing = found.edgeApplications[0];
    if (!existing) return { status: 409, body: { message: "受管 EdgeApplication 不存在，无法更新 YAML" } };
    const document = documents[0];
    if (String(document?.metadata?.name || "") !== String(metadataOf(existing).name)) {
      return { status: 400, body: { message: "编辑 YAML 不能重命名 EdgeApplication" } };
    }
    const targetGroups = edgeApplicationTargetGroups(document);
    if (!targetGroups.length) return { status: 400, body: { message: "EdgeApplication 至少需要一个 targetNodeGroup" } };
    const nextPlan: BatchWorkloadPlan = { ...found.plan, targetGroups };
    try {
      const groups = await validateTargets(nextPlan);
      const next = buildBatchEdgeApplication(nextPlan, id, groups, document);
      next.metadata.resourceVersion = metadataOf(existing).resourceVersion;
      await requestK8sJson(edgeApplicationPath(found.plan.namespace, metadataOf(existing).name), { method: "PUT", body: next });
      found.control.data.planJson = JSON.stringify(nextPlan);
      found.control.data.targetRefs = JSON.stringify(targetGroups);
      await updateConfigMap(metadataOf(found.control).name, found.control);
      return getBatchWorkload(id);
    } catch (error) {
      return { status: 409, body: { message: error instanceof Error ? error.message : "EdgeApplication YAML 更新失败" } };
    }
  }
  if (!documents.length || documents.some((document) => document?.apiVersion !== "apps/v1" || document?.kind !== "Deployment")) {
    return { status: 400, body: { message: "YAML 只能包含 apps/v1 Deployment" } };
  }
  const existingByName = new Map(found.deployments.map((item) => [String(metadataOf(item).name), item]));
  if (documents.some((document) => !existingByName.has(String(document?.metadata?.name || "")))) {
    return { status: 400, body: { message: "编辑 YAML 不能新增或重命名 Deployment，请使用“新增部署”" } };
  }
  try {
    for (const sourceDocument of documents) {
      let document = sourceDocument;
      const name = String(document.metadata.name);
      const existing = existingByName.get(name);
      document.metadata.namespace = found.plan.namespace;
      document.metadata.resourceVersion = metadataOf(existing).resourceVersion;
      document.metadata.labels = { ...(metadataOf(existing).labels || {}), ...(document.metadata.labels || {}), [managedByLabel]: managedByValue, [workloadIdLabel]: id };
      document.metadata.annotations = { ...(metadataOf(existing).annotations || {}), ...(document.metadata.annotations || {}) };
      document.spec.template = document.spec.template || {};
      document.spec.template.metadata = document.spec.template.metadata || {};
      document.spec.template.metadata.labels = { ...(existing?.spec?.template?.metadata?.labels || {}), ...(document.spec.template.metadata.labels || {}), [workloadIdLabel]: id };
      if (found.plan.edgeUnitRef) {
        document = bindDeploymentToEdgeUnit(document, found.plan.edgeUnitRef);
        document.metadata.resourceVersion = metadataOf(existing).resourceVersion;
      }
      await requestK8sJson(deploymentPath(found.plan.namespace, name), { method: "PUT", body: document });
    }
    return getBatchWorkload(id);
  } catch (error) {
    return { status: 409, body: { message: error instanceof Error ? error.message : "Deployment YAML 更新失败" } };
  }
}

export async function deleteBatchWorkloadDeployment(id: string, deploymentName: string) {
  const found = await detail(id);
  if (!found || !found.plan) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  if (dataOf(found.control).executionMode === "edgeapplication") {
    return { status: 400, body: { message: "EdgeApplication 模式不支持单独删除内嵌 Deployment，请编辑 EdgeApplication YAML 或删除整个批量工作负载" } };
  }
  const deployment = found.deployments.find((item) => metadataOf(item).name === deploymentName);
  if (!deployment) return { status: 404, body: { message: `Deployment ${deploymentName} not found in BatchWorkload ${id}` } };
  await requestK8sJson(deploymentPath(found.plan.namespace, deploymentName), { method: "DELETE" });
  const removedGroup = String(deployment?.metadata?.annotations?.["blueedge.io/target-group-name"] || "");
  found.plan.targetGroups = found.plan.targetGroups.filter((name) => name !== removedGroup);
  found.control.data.planJson = JSON.stringify(found.plan);
  found.control.data.targetRefs = JSON.stringify(found.plan.targetGroups);
  found.control.data.deploymentsJson = JSON.stringify(found.deployments.filter((item) => metadataOf(item).name !== deploymentName).map((item) => metadataOf(item).name));
  await updateConfigMap(metadataOf(found.control).name, found.control);
  return { status: 200, body: { message: `Deployment ${deploymentName} deleted` } };
}

export async function deleteBatchWorkload(id: string) {
  const found = await detail(id);
  if (!found || !found.plan) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  if (found.native) {
    const resource = found.edgeApplications[0];
    await requestK8sJson(edgeApplicationPath(String(metadataOf(resource).namespace || "default"), metadataOf(resource).name), { method: "DELETE" });
    return { status: 200, body: { message: `EdgeApplication ${edgeApplicationRef(resource)} deleted` } };
  }
  if (dataOf(found.control).executionMode === "edgeapplication") {
    await Promise.all(found.edgeApplications.map((resource) => requestK8sJson(edgeApplicationPath(found.plan!.namespace, metadataOf(resource).name), { method: "DELETE" })));
    await removeConfigMap(metadataOf(found.control).name);
    return { status: 200, body: { message: `BatchWorkload ${id} and ${found.edgeApplications.length} managed EdgeApplication deleted` } };
  }
  await Promise.all(found.deployments.map((deployment) => requestK8sJson(deploymentPath(found.plan!.namespace, metadataOf(deployment).name), { method: "DELETE" })));
  await removeConfigMap(metadataOf(found.control).name);
  return { status: 200, body: { message: `BatchWorkload ${id} and ${found.deployments.length} managed Deployments deleted` } };
}
