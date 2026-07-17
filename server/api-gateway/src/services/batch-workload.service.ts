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
import { bindDeploymentToEdgeUnitNodeGroup, resolveEdgeUnitNodeGroup } from "./edge-unit.service.js";

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

async function listNodeGroups() {
  const data = await getK8sJson("/apis/apps.kubeedge.io/v1alpha1/nodegroups");
  return itemsOf(data);
}

async function validateTargets(plan: BatchWorkloadPlan) {
  await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(plan.namespace)}`);
  const [groups, nodesData] = await Promise.all([listNodeGroups(), getK8sJson("/api/v1/nodes")]);
  const groupsByName = new Map(groups.map((group: any) => [String(metadataOf(group).name), group]));
  const nodes = itemsOf(nodesData);
  const selected = plan.targetGroups.map((name) => {
    const group = groupsByName.get(name);
    if (!group) throw new Error(`NodeGroup ${name} not found`);
    const explicit = Array.isArray(group?.spec?.nodes) ? group.spec.nodes.map(String).filter(Boolean) : [];
    const matchLabels = stringRecord(group?.spec?.matchLabels);
    const matched = explicit.length
      ? nodes.filter((node) => explicit.includes(String(metadataOf(node).name)))
      : nodes.filter((node) => Object.entries(matchLabels).every(([key, value]) => labelsOf(node)[key] === value));
    if (matched.length === 0) throw new Error(`NodeGroup ${name} 未匹配到任何真实节点`);
    return group;
  });
  return selected;
}

async function bindPlanToEdgeUnit(plan: BatchWorkloadPlan): Promise<BatchWorkloadPlan> {
  if (!plan.edgeUnitRef) return plan;
  const { nodeGroupRef } = await resolveEdgeUnitNodeGroup(plan.edgeUnitRef);
  if (plan.targetGroups.some((name) => name !== nodeGroupRef)) {
    throw new Error(`EdgeUnit ${plan.edgeUnitRef} 只能部署到绑定的 NodeGroup ${nodeGroupRef}`);
  }
  return { ...plan, targetGroups: [nodeGroupRef] };
}

function controlMatches(resource: any, id: string) {
  const data = dataOf(resource);
  return data.type === "batchWorkload" && (data.id === id || metadataOf(resource).name === id || metadataOf(resource).name === controlConfigMapName(id));
}

async function listControls() {
  const items = await listByResourceLabel(batchTaskResourceValue);
  return items.filter((item) => dataOf(item).type === "batchWorkload" && dataOf(item).executionMode === "deployment");
}

async function findControl(id: string) {
  return (await listControls()).find((item) => controlMatches(item, id)) || null;
}

async function listManagedDeployments() {
  const selector = encodeURIComponent(`${managedByLabel}=${managedByValue}`);
  return itemsOf(await getK8sJson(`/apis/apps/v1/deployments?labelSelector=${selector}`));
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

function controlPlan(control: any): BatchWorkloadPlan | null {
  return parseJson<BatchWorkloadPlan | null>(dataOf(control).planJson, null);
}

function workloadView(control: any, deployments: any[]) {
  const data = dataOf(control);
  const plan = controlPlan(control);
  const id = data.id || labelsOf(control)[batchTaskNameLabel] || metadataOf(control).name;
  const instances = deployments.filter((item) => labelsOf(item)[workloadIdLabel] === id).map((item) => {
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
    };
  });
  const failedCount = instances.filter((item) => item.status === "failed").length;
  const successCount = instances.filter((item) => item.status === "succeeded").length;
  const status = instances.length === 0 ? "pending" : failedCount > 0 ? (successCount > 0 ? "partialSuccess" : "failed") : successCount === instances.length ? "succeeded" : "running";
  const liveTargetGroups = [...new Set(instances.map((item) => item.nodeGroup).filter(Boolean))];
  const liveImages = [...new Set(instances.flatMap((item) => item.image.split(", ")).filter(Boolean))];
  return {
    id,
    name: data.name || plan?.name || id,
    type: "batchWorkload",
    status,
    namespace: plan?.namespace || data.namespace || "default",
    targetType: "deployment",
    targetRefs: liveTargetGroups.length ? liveTargetGroups : plan?.targetGroups || parseJson<string[]>(data.targetRefs, []),
    targetGroups: liveTargetGroups.length ? liveTargetGroups : plan?.targetGroups || [],
    image: liveImages.join(", ") || plan?.podTemplate.containers.map((container) => container.image).join(", ") || data.image || "",
    description: data.description || "",
    createdAt: data.createdAt || metadataOf(control).creationTimestamp || "",
    executionMode: "deployment",
    progress: instances.length ? Math.round((successCount + failedCount) / instances.length * 100) : 0,
    totalTargets: instances.length,
    successCount,
    failedCount,
    plan,
    workloads: instances,
    rawRef: { kind: "ConfigMap", namespace: blueedgeNamespace(), name: metadataOf(control).name },
  };
}

function controlResource(id: string, body: any, plan: BatchWorkloadPlan, deploymentNames: string[]) {
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
      targetType: "deployment",
      targetRefs: JSON.stringify(plan.targetGroups),
      image: plan.podTemplate.containers.map((container) => container.image).join(", "),
      description: readStringField(body, "description"),
      createdAt: now,
      executionMode: "deployment",
      planJson: JSON.stringify(plan),
      deploymentsJson: JSON.stringify(deploymentNames),
      eventsJson: "[]",
      auditJson: JSON.stringify([{ time: now, actor: "blueedge-api-gateway", action: "create", result: "success", message: `创建 ${deploymentNames.length} 个真实 Deployment` }]),
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
      totalTargets: String(deploymentNames.length),
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

export async function listBatchWorkloads(edgeUnitRef = "") {
  const [controls, deployments] = await Promise.all([listControls(), listManagedDeployments()]);
  let items = controls.map((control) => workloadView(control, deployments));
  if (edgeUnitRef) {
    let nodeGroupRef = "";
    try { ({ nodeGroupRef } = await resolveEdgeUnitNodeGroup(edgeUnitRef)); }
    catch (error) {
      if (error instanceof Error && /未绑定 NodeGroup/.test(error.message)) return { items: [] };
      throw error;
    }
    items = items.filter((item) => item.plan?.edgeUnitRef === edgeUnitRef || item.targetGroups.includes(nodeGroupRef));
  }
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
  const deployments = await createDeployments(plan, id, groups).catch((error) => { throw error; });
  try {
    const control = await createConfigMap(controlResource(id, body, plan, deployments.map((item) => metadataOf(item).name)));
    return { status: 201, body: { item: workloadView(control, deployments) } };
  } catch (error) {
    await Promise.allSettled(deployments.map((item) => requestK8sJson(deploymentPath(plan.namespace, metadataOf(item).name), { method: "DELETE" })));
    throw error;
  }
}

async function detail(id: string) {
  const control = await findControl(id);
  if (!control) return null;
  const plan = controlPlan(control);
  const selector = encodeURIComponent(`${workloadIdLabel}=${dataOf(control).id}`);
  const deployments = plan ? itemsOf(await getK8sJson(`${deploymentPath(plan.namespace)}?labelSelector=${selector}`)) : [];
  return { control, plan, deployments, item: workloadView(control, deployments) };
}

export async function getBatchWorkload(id: string) {
  const found = await detail(id);
  if (!found) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const definitions = found.deployments.map(cleanDeployment);
  const yamlText = definitions.map((deployment) => yaml.dump(deployment, { noRefs: true, lineWidth: -1 })).join("---\n");
  return { status: 200, body: { item: { ...found.item, definitions, yaml: yamlText } } };
}

export async function updateBatchWorkloadMetadata(id: string, body: any) {
  const found = await detail(id);
  if (!found) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (description.length > 500) return { status: 400, body: { message: "描述不能超过 500 个字符" } };
  found.control.data.description = description;
  await updateConfigMap(metadataOf(found.control).name, found.control);
  return getBatchWorkload(id);
}

export async function getBatchWorkloadEvents(id: string) {
  const found = await detail(id);
  if (!found) return { status: 404, body: { message: `BatchWorkload ${id} not found` } };
  const warnings: EdgeUnitWarning[] = [];
  const namespace = found.plan?.namespace || "default";
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
  const resources = [{ resource: found.control, kind: "ConfigMap" }, ...found.deployments.map((resource) => ({ resource, kind: "Deployment" }))];
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
  const existingGroups = new Set(found.deployments.map((item) => String(item?.metadata?.annotations?.["blueedge.io/target-group-name"] || "")));
  const newGroups = patchPlan.targetGroups.filter((name) => !existingGroups.has(name));
  if (!newGroups.length) return { status: 409, body: { message: "所选 NodeGroup 已存在对应 Deployment" } };
  patchPlan.targetGroups = newGroups;
  let groups: any[];
  try { groups = await validateTargets(patchPlan); }
  catch (error) { return { status: 400, body: { message: error instanceof Error ? error.message : "目标校验失败" } }; }
  const created = await createDeployments(patchPlan, id, groups);
  const mergedPlan: BatchWorkloadPlan = { ...found.plan, targetGroups: [...new Set([...found.plan.targetGroups, ...newGroups])] };
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
        const { nodeGroupRef, nodeGroup } = await resolveEdgeUnitNodeGroup(found.plan.edgeUnitRef);
        document = bindDeploymentToEdgeUnitNodeGroup(document, found.plan.edgeUnitRef, nodeGroupRef, nodeGroup);
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
  await Promise.all(found.deployments.map((deployment) => requestK8sJson(deploymentPath(found.plan!.namespace, metadataOf(deployment).name), { method: "DELETE" })));
  await removeConfigMap(metadataOf(found.control).name);
  return { status: 200, body: { message: `BatchWorkload ${id} and ${found.deployments.length} managed Deployments deleted` } };
}
