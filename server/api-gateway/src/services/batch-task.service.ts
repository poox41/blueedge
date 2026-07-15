import crypto from "node:crypto";
import {
  batchTaskResourceValue,
  blueedgeNamespace,
  blueedgeResourceLabel,
  create,
  ensureNamespace,
  listByResourceLabel,
  remove,
  update,
} from "../repositories/blueedge-configmap.repository.js";
import {
  cloudTaskManagerEnabled,
  createNodeUpgradeJob,
  deleteNodeUpgradeJob,
  getNodeUpgradeJob,
  listNodeUpgradeJobs,
} from "../repositories/node-upgrade-job.repository.js";
import {
  createImagePrePullJob,
  deleteImagePrePullJob,
  getImagePrePullJob,
  getImagePullSecret,
  listImagePrePullJobs,
} from "../repositories/image-prepull-job.repository.js";
import type { BatchTaskAuditRecord, BatchTaskEvent, BatchTaskType, BatchWorkloadPlan, BatchWorkloadPlanContainer } from "../types/batch-task.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  dataOf,
  labelsOf,
  metadataOf,
  nodeNameOf,
  isNodeReady,
} from "../utils/kubernetes.js";
import {
  parseJsonField,
  readNumberField,
  readStringArrayField,
  readStringField,
} from "../utils/validation.js";
import {
  collectEdgeUnitSources,
  collectNodeGroupDetails,
  getEdgeUnitNodes,
  knownEdgeUnitNames,
  nodeNames,
} from "./edge-unit-source.service.js";

const batchTaskNameLabel = "blueedge.io/batch-task";
const batchTaskTypeLabel = "blueedge.io/task-type";
const batchTaskStatuses = new Set(["initializing", "pending", "running", "partialSuccess", "succeeded", "failed", "cancelled"]);
const batchTaskTypes = new Set(["nodeUpgrade", "imagePreheat", "batchWorkload"]);
const batchTaskTargetTypes = new Set(["node", "nodeGroup", "edgeUnit", "deployment"]);
const batchTaskFailurePolicies = new Set(["continue", "stop"]);

function batchTaskResourceName(id: string): string {
  return `batch-task-${id}`;
}

function newBatchTaskId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function batchTaskMatches(configMap: any, id: string): boolean {
  const data = dataOf(configMap);
  const labels = labelsOf(configMap);
  const metadata = metadataOf(configMap);
  return data.id === id || labels[batchTaskNameLabel] === id || metadata.name === batchTaskResourceName(id);
}

function isValidBatchTaskConfigMap(configMap: any, warnings: EdgeUnitWarning[]): boolean {
  const data = dataOf(configMap);
  if (data.id && data.name && data.type && data.status && batchTaskTypes.has(data.type) && batchTaskStatuses.has(data.status)) return true;
  warnings.push({
    source: "batch-task.configmap",
    message: `Invalid BatchTask ConfigMap ${metadataOf(configMap).namespace || blueedgeNamespace()}/${metadataOf(configMap).name || "-"}: missing or invalid required data fields`,
  });
  return false;
}

async function getBatchTaskConfigMaps(warnings: EdgeUnitWarning[]): Promise<any[]> {
  return listByResourceLabel(batchTaskResourceValue).catch((error) => {
    warnings.push({ source: "batch-task.configmap", message: error instanceof Error ? error.message : "BatchTask ConfigMap list unavailable" });
    return [];
  });
}

async function findBatchTaskConfigMap(id: string, warnings: EdgeUnitWarning[]): Promise<any | null> {
  const configMaps = await getBatchTaskConfigMaps(warnings);
  return configMaps.find((item) => batchTaskMatches(item, id)) || null;
}

function batchTaskTargetRefs(body: any): string[] {
  const refs = readStringArrayField(body, "targetRefs");
  if (refs.length > 0) return refs;
  const selectedNodes = readStringArrayField(body, "selectedNodes");
  if (selectedNodes.length > 0) return selectedNodes;
  const targets = Array.isArray(body?.targets) ? body.targets : [];
  return targets
    .map((item: any) => item?.name || item?.nodeGroupRef || item?.namespace || "")
    .map((item: any) => String(item).trim())
    .filter(Boolean);
}

function buildBatchTaskSteps(type: string, status: string) {
  const steps = type === "nodeUpgrade"
    ? [["validateTargets", "前置检查"], ["prepareUpgrade", "镜像下载"], ["executeUpgrade", "分批升级"], ["verifyNodes", "健康验证"]]
    : type === "imagePreheat"
      ? [["validateTargets", "前置检查"], ["prepareImages", "镜像解析"], ["createPreheatPlan", "生成预热计划"], ["verifyImages", "镜像校验"]]
      : [["validateTargets", "前置检查"], ["renderWorkloads", "渲染工作负载"], ["createExecutionPlan", "生成执行计划"], ["verifyWorkloads", "校验工作负载"]];
  return steps.map(([name, displayName], index) => ({
    name,
    displayName,
    status: status === "running" && index === 0 ? "running" : "pending",
    message: status === "running" && index === 0 ? "planOnly: execution plan generated; no real node operation is running" : "",
    startedAt: status === "running" && index === 0 ? new Date().toISOString() : null,
    finishedAt: null,
  }));
}

function buildBatchTaskResults(targetRefs: string[], targets: any[] = []) {
  const refs = targetRefs.length > 0 ? targetRefs : targets.map((item) => item?.name || item?.nodeGroupRef || item?.namespace || "target");
  return refs.map((ref) => ({
    target: String(ref),
    status: "pending",
    message: "planOnly: waiting for manual execution integration",
    currentVersion: "",
    targetVersion: "",
    startedAt: null,
    finishedAt: null,
  }));
}

function appendJsonItem<T>(json: string | undefined, item: T): string {
  return JSON.stringify([...parseJsonField<T[]>(json, []), item]);
}

function taskEvent(reason: string, message: string, type: "Normal" | "Warning" = "Normal"): BatchTaskEvent {
  return { time: new Date().toISOString(), type, reason, message };
}

function auditRecord(action: string, message: string): BatchTaskAuditRecord {
  return { time: new Date().toISOString(), actor: "dashboard-user", action, result: "success", message };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(objectValue(value)).map(([key, item]) => [key.trim(), String(item).trim()]).filter(([key]) => key));
}

function keyValueListMap(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.map(objectValue).map((item) => [stringValue(item.key), stringValue(item.value)]).filter(([key]) => key));
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeBatchWorkloadContainer(value: unknown, index: number): BatchWorkloadPlanContainer {
  const item = objectValue(value);
  const name = stringValue(item.name, `container-${index + 1}`);
  const image = stringValue(item.image);
  if (!name || !image || /\s/.test(image)) throw new Error(`plan.podTemplate.containers[${index}] requires a valid name and image`);
  const envSource = Array.isArray(item.env) ? item.env : Array.isArray(item.envs) ? item.envs : [];
  const env = envSource.map(objectValue).map((entry) => ({ name: stringValue(entry.name || entry.key), value: stringValue(entry.value) })).filter((entry) => entry.name);
  const resources = objectValue(item.resources);
  const requests = objectValue(resources.requests);
  const limits = objectValue(resources.limits);
  const volumes = Array.isArray(item.volumes)
    ? item.volumes.map(objectValue).map((entry) => ({ name: stringValue(entry.name), type: stringValue(entry.type), mountPath: stringValue(entry.mountPath), source: stringValue(entry.source) })).filter((entry) => entry.name && entry.type && entry.mountPath)
    : [];
  const imagePullPolicy = stringValue(item.imagePullPolicy || item.pullPolicy);
  if (imagePullPolicy && !["Always", "IfNotPresent", "Never"].includes(imagePullPolicy)) throw new Error(`plan.podTemplate.containers[${index}].imagePullPolicy is invalid`);
  return {
    name,
    image,
    ...(imagePullPolicy ? { imagePullPolicy: imagePullPolicy as BatchWorkloadPlanContainer["imagePullPolicy"] } : {}),
    ...(stringList(item.command).length ? { command: stringList(item.command) } : {}),
    ...(stringList(item.args).length ? { args: stringList(item.args) } : {}),
    ...(env.length ? { env } : {}),
    resources: {
      requests: {
        ...(stringValue(requests.cpu || item.cpuRequest) ? { cpu: stringValue(requests.cpu || item.cpuRequest) } : {}),
        ...(stringValue(requests.memory || item.memoryRequest) ? { memory: stringValue(requests.memory || item.memoryRequest) } : {}),
      },
      limits: {
        ...(stringValue(limits.cpu || item.cpuLimit) ? { cpu: stringValue(limits.cpu || item.cpuLimit) } : {}),
        ...(stringValue(limits.memory || item.memoryLimit) ? { memory: stringValue(limits.memory || item.memoryLimit) } : {}),
      },
    },
    lifecycle: {
      ...(stringValue(objectValue(item.lifecycle).postStart || item.lifecyclePostStart) ? { postStart: stringValue(objectValue(item.lifecycle).postStart || item.lifecyclePostStart) } : {}),
      ...(stringValue(objectValue(item.lifecycle).preStop || item.lifecyclePreStop) ? { preStop: stringValue(objectValue(item.lifecycle).preStop || item.lifecyclePreStop) } : {}),
    },
    healthChecks: {
      startup: Boolean(objectValue(item.healthChecks).startup ?? item.startupProbe),
      readiness: Boolean(objectValue(item.healthChecks).readiness ?? item.readinessProbe),
      liveness: Boolean(objectValue(item.healthChecks).liveness ?? item.livenessProbe),
    },
    securityContext: {
      privileged: Boolean(objectValue(item.securityContext).privileged ?? item.privileged),
      runAsUser: nonNegativeInteger(objectValue(item.securityContext).runAsUser ?? item.runAsUser),
      runAsGroup: nonNegativeInteger(objectValue(item.securityContext).runAsGroup ?? item.runAsGroup),
      readOnlyRootFilesystem: Boolean(objectValue(item.securityContext).readOnlyRootFilesystem ?? item.readOnlyRootFilesystem),
      allowPrivilegeEscalation: Boolean(objectValue(item.securityContext).allowPrivilegeEscalation ?? item.allowPrivilegeEscalation),
    },
    ...(volumes.length ? { volumes } : {}),
  };
}

function normalizeBatchWorkloadPlan(body: unknown, name: string, targetRefs: string[]): BatchWorkloadPlan {
  const bodyValue = objectValue(body);
  const targets = Array.isArray(bodyValue.targets) ? bodyValue.targets : [];
  const legacy = objectValue(targets[0]);
  const source = Object.keys(objectValue(bodyValue.plan)).length ? objectValue(bodyValue.plan) : legacy;
  const podTemplate = objectValue(source.podTemplate);
  const containersSource = Array.isArray(podTemplate.containers)
    ? podTemplate.containers
    : Array.isArray(source.containers)
      ? source.containers
      : [{ name: "container-1", image: stringValue(source.image || bodyValue.image) }];
  const containers = containersSource.map(normalizeBatchWorkloadContainer);
  if (containers.length === 0) throw new Error("plan.podTemplate.containers is required");
  const namespace = stringValue(source.namespace, "default");
  const targetGroups = Array.isArray(source.targetGroups) ? source.targetGroups.map(String).map((item) => item.trim()).filter(Boolean) : targetRefs;
  if (!targetGroups.length) throw new Error("plan.targetGroups is required");
  const metadata = objectValue(source.metadata);
  const podMetadata = objectValue(podTemplate.metadata);
  const network = objectValue(podTemplate.network || source.network);
  const networkType = stringValue(network.type || source.networkType, "none");
  if (!["none", "portmap", "host"].includes(networkType)) throw new Error("plan.podTemplate.network.type is invalid");
  const portsSource = Array.isArray(network.ports) ? network.ports : Array.isArray(source.ports) ? source.ports : [];
  const ports = portsSource.map(objectValue).map((port) => ({
    containerName: stringValue(port.containerName),
    containerPort: positiveInteger(port.containerPort, 0),
    ...(positiveInteger(port.hostPort, 0) ? { hostPort: positiveInteger(port.hostPort, 0) } : {}),
  })).filter((port) => port.containerName && port.containerPort > 0);
  const strategySource = objectValue(source.strategy);
  const strategyType = stringValue(strategySource.type || source.strategy, "RollingUpdate");
  if (!["RollingUpdate", "Recreate"].includes(strategyType)) throw new Error("plan.strategy.type is invalid");
  return {
    namespace,
    name: stringValue(source.name, name),
    targetGroups,
    replicas: positiveInteger(source.replicas, 1),
    workloadType: "Deployment",
    metadata: {
      labels: Object.keys(stringMap(metadata.labels)).length ? stringMap(metadata.labels) : keyValueListMap(source.workloadLabels),
      annotations: Object.keys(stringMap(metadata.annotations)).length ? stringMap(metadata.annotations) : keyValueListMap(source.workloadAnnotations),
    },
    podTemplate: {
      labels: Object.keys(stringMap(podMetadata.labels)).length ? stringMap(podMetadata.labels) : keyValueListMap(source.podLabels),
      annotations: Object.keys(stringMap(podMetadata.annotations)).length ? stringMap(podMetadata.annotations) : keyValueListMap(source.podAnnotations),
      containers,
      network: { type: networkType as "none" | "portmap" | "host", ...(ports.length ? { ports } : {}) },
      terminationGracePeriodSeconds: nonNegativeInteger(podTemplate.terminationGracePeriodSeconds ?? source.terminationGracePeriodSeconds, 30),
    },
    strategy: {
      type: strategyType as "RollingUpdate" | "Recreate",
      ...(stringValue(strategySource.maxUnavailable || source.maxUnavailable) ? { maxUnavailable: stringValue(strategySource.maxUnavailable || source.maxUnavailable) } : {}),
      ...(stringValue(strategySource.maxSurge || source.maxSurge) ? { maxSurge: stringValue(strategySource.maxSurge || source.maxSurge) } : {}),
      revisionHistoryLimit: nonNegativeInteger(strategySource.revisionHistoryLimit ?? source.revisionHistoryLimit, 10),
      minReadySeconds: nonNegativeInteger(strategySource.minReadySeconds ?? source.minReadySeconds),
      progressDeadlineSeconds: positiveInteger(strategySource.progressDeadlineSeconds ?? source.progressDeadlineSeconds, 600),
    },
  };
}

function normalizeBatchTaskPayload(body: any, type: string, existingData: Record<string, string> = {}) {
  const now = new Date().toISOString();
  const id = readStringField(body, "id") || existingData.id || newBatchTaskId(type === "batchWorkload" ? "batch-workload" : "batch-task");
  const name = readStringField(body, "name") || existingData.name || "";
  const targetType = readStringField(body, "targetType") || existingData.targetType || (type === "batchWorkload" ? "deployment" : "nodeGroup");
  const targetRefs = batchTaskTargetRefs(body);
  const persistedTargetRefs = parseJsonField<string[]>(existingData.targetRefs, []);
  const plan = type === "batchWorkload" ? normalizeBatchWorkloadPlan(body, name, targetRefs.length ? targetRefs : persistedTargetRefs) : null;
  const images = readStringArrayField(body, "images");
  const image = images.length > 0 ? images.join(", ") : readStringField(body, "image") || plan?.podTemplate.containers[0]?.image || existingData.image || "";
  const status = readStringField(body, "status") || existingData.status || "pending";
  const failurePolicy = readStringField(body, "failurePolicy") || existingData.failurePolicy || "continue";
  const concurrency = Math.max(1, Math.floor(readNumberField(body, "concurrency", Number(existingData.concurrency || 1))));
  const timeoutSeconds = Math.max(0, Math.floor(readNumberField(body, "timeoutSeconds", Number(existingData.timeoutSeconds || 0))));
  const retryCount = Math.max(0, Math.floor(readNumberField(body, "retryCount", Number(existingData.retryCount || 0))));
  const failureRateThreshold = Math.max(0, Math.min(100, readNumberField(body, "failureRateThreshold", Number(existingData.failureRateThreshold || 0))));
  const resourceChecks = readStringArrayField(body, "resourceChecks");
  const refs = targetRefs.length > 0 ? targetRefs : persistedTargetRefs;
  const targets = Array.isArray(body?.targets) ? body.targets : parseJsonField(existingData.targetsJson, []);
  const totalTargets = refs.length || targets.length || Number(existingData.totalTargets || 0);

  if (!name) throw new Error("name is required");
  if (!batchTaskTypes.has(type)) throw new Error("type is invalid");
  if (!batchTaskStatuses.has(status)) throw new Error("status is invalid");
  if (!batchTaskTargetTypes.has(targetType)) throw new Error("targetType is invalid");
  if (!batchTaskFailurePolicies.has(failurePolicy)) throw new Error("failurePolicy must be continue or stop");
  if (refs.length === 0 && targets.length === 0) throw new Error("targetRefs or targets are required");
  if (type === "nodeUpgrade" && !(readStringField(body, "targetVersion") || existingData.targetVersion)) throw new Error("targetVersion is required");
  if (type === "imagePreheat" && images.length === 0 && !image) throw new Error("images are required");
  if (type === "imagePreheat" && image.split(",").some((item) => item.trim() && /\s/.test(item.trim()))) throw new Error("image name must not include spaces");

  return {
    id,
    name,
    type,
    status,
    targetType,
    targetRefs: JSON.stringify(refs),
    image,
    targetVersion: readStringField(body, "targetVersion") || existingData.targetVersion || "",
    concurrency: String(concurrency),
    failurePolicy,
    timeoutSeconds: String(timeoutSeconds),
    retryCount: String(retryCount),
    failureRateThreshold: String(failureRateThreshold),
    resourceChecksJson: JSON.stringify(resourceChecks.length ? resourceChecks : parseJsonField(existingData.resourceChecksJson, [])),
    userConfirm: String(Boolean(body?.userConfirm ?? (existingData.userConfirm === "true"))),
    credentialNamespace: readStringField(body, "credentialNamespace") || existingData.credentialNamespace || "",
    credentialName: readStringField(body, "credentialName") || existingData.credentialName || "",
    progress: existingData.progress || "0",
    totalTargets: String(totalTargets),
    successCount: existingData.successCount || "0",
    failedCount: existingData.failedCount || "0",
    description: readStringField(body, "description") ?? existingData.description ?? "",
    createdAt: existingData.createdAt || now,
    startedAt: existingData.startedAt || "",
    finishedAt: existingData.finishedAt || "",
    executionMode: "planOnly",
    stepsJson: existingData.stepsJson || JSON.stringify(buildBatchTaskSteps(type, "pending")),
    resultsJson: existingData.resultsJson || JSON.stringify(buildBatchTaskResults(refs, targets)),
    errorsJson: existingData.errorsJson || "[]",
    eventsJson: existingData.eventsJson || JSON.stringify([taskEvent("TaskCreated", "批量任务已创建，等待执行")]),
    auditJson: existingData.auditJson || JSON.stringify([auditRecord("create", "创建批量任务")]),
    targetsJson: JSON.stringify(targets),
    planJson: plan ? JSON.stringify(plan) : existingData.planJson || "",
  };
}

function buildBatchTaskConfigMap(data: Record<string, string>, existing?: any) {
  const existingMetadata = metadataOf(existing);
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      ...(existingMetadata.resourceVersion ? { resourceVersion: existingMetadata.resourceVersion } : {}),
      name: existingMetadata.name || batchTaskResourceName(data.id),
      namespace: blueedgeNamespace(),
      labels: {
        ...(existingMetadata.labels || {}),
        [blueedgeResourceLabel]: batchTaskResourceValue,
        [batchTaskNameLabel]: data.id,
        [batchTaskTypeLabel]: data.type,
      },
    },
    data,
  };
}

function buildBatchTaskView(configMap: any) {
  const metadata = metadataOf(configMap);
  const data = dataOf(configMap);
  const targetRefs = parseJsonField<string[]>(data.targetRefs, []);
  const targets = parseJsonField<any[]>(data.targetsJson, []);
  const plan = parseJsonField<BatchWorkloadPlan | null>(data.planJson, null);
  return {
    id: data.id,
    name: data.name,
    type: data.type,
    status: data.status,
    targetType: data.targetType,
    targetRefs,
    targetVersion: data.targetVersion || "",
    image: data.image || "",
    concurrency: Number(data.concurrency || 1),
    failurePolicy: data.failurePolicy || "continue",
    timeoutSeconds: Number(data.timeoutSeconds || 0),
    retryCount: Number(data.retryCount || 0),
    failureRateThreshold: Number(data.failureRateThreshold || 0),
    resourceChecks: parseJsonField<string[]>(data.resourceChecksJson, []),
    userConfirm: data.userConfirm === "true",
    credentialNamespace: data.credentialNamespace || "",
    credentialName: data.credentialName || "",
    progress: Number(data.progress || 0),
    totalTargets: Number(data.totalTargets || targetRefs.length || targets.length || 0),
    successCount: Number(data.successCount || 0),
    failedCount: Number(data.failedCount || 0),
    executionMode: data.executionMode || "planOnly",
    createdAt: data.createdAt || metadata.creationTimestamp || "",
    startedAt: data.startedAt || null,
    finishedAt: data.finishedAt || null,
    description: data.description || "",
    steps: parseJsonField<any[]>(data.stepsJson, []),
    targetResults: parseJsonField<any[]>(data.resultsJson, []),
    errors: parseJsonField<any[]>(data.errorsJson, []),
    events: parseJsonField<BatchTaskEvent[]>(data.eventsJson, []),
    auditRecords: parseJsonField<BatchTaskAuditRecord[]>(data.auditJson, []),
    targets,
    plan,
    rawRef: {
      kind: "ConfigMap",
      namespace: metadata.namespace || blueedgeNamespace(),
      name: metadata.name || "",
    },
  };
}

function nodeUpgradeStatus(phase: string): string {
  const value = phase.toLowerCase();
  if (value === "init") return "initializing";
  if (value === "inprogress") return "running";
  if (value === "completed") return "succeeded";
  if (value === "failure") return "failed";
  return "pending";
}

export function nodeTaskStatus(phase: string): string {
  const value = phase.toLowerCase();
  if (value === "inprogress") return "running";
  if (["true", "success", "successful"].includes(value)) return "succeeded";
  if (["false", "failure", "failed"].includes(value)) return "failed";
  return "pending";
}

function nodeUpgradeActionDisplayName(action: string): string {
  return ({ WaitingConfirmation: "等待确认", Check: "前置检查", BackUp: "节点备份", Upgrade: "节点升级", RollBack: "任务回滚" } as Record<string, string>)[action] || action;
}

function conditionTaskStatus(status: string): string {
  const value = status.toLowerCase();
  if (value === "true" || value === "success" || value === "successful") return "succeeded";
  if (value === "false" || value === "failure" || value === "failed") return "failed";
  return "running";
}

function imagePrePullJobStatus(phase: string, successCount: number, failedCount: number): string {
  const value = phase.toLowerCase();
  if (value === "init") return "initializing";
  if (value === "inprogress") return "running";
  if (value === "completed") return failedCount > 0 ? "partialSuccess" : "succeeded";
  if (value === "failure") return successCount > 0 ? "partialSuccess" : "failed";
  return "pending";
}

function imagePrePullCheckItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({ cpu: "CPU", mem: "内存", memory: "内存", disk: "磁盘" }[String(item).toLowerCase()] || String(item)));
}

export function nodeTaskCheckItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({ CPU: "cpu", "内存": "mem", "磁盘": "disk" }[String(item)] || String(item).toLowerCase()));
}

export function buildImagePrePullJobView(job: any) {
  const metadata = metadataOf(job);
  const template = job?.spec?.imagePrePullTemplate || {};
  const status = job?.status || {};
  const nodeStatuses = Array.isArray(status.nodeStatus) ? status.nodeStatus : [];
  const annotatedTargets = parseJsonField<string[]>(metadata.annotations?.["blueedge.io/target-nodes"], []);
  const specTargets = Array.isArray(template.nodeNames) ? template.nodeNames.map(String) : [];
  const statusTargets = nodeStatuses.map((item: any) => String(item.nodeName || "")).filter(Boolean);
  const targetRefs = specTargets.length ? specTargets : annotatedTargets.length ? annotatedTargets : statusTargets;
  const images = Array.isArray(template.images) ? template.images.map(String) : [];
  const targetResults = (nodeStatuses.length ? nodeStatuses : targetRefs.map((nodeName: string) => ({ nodeName, phase: "Pending", imageStatus: [], actionFlow: [] })))
    .map((item: any) => {
      const imageStatuses = Array.isArray(item.imageStatus) ? item.imageStatus : [];
      const actionFlow = Array.isArray(item.actionFlow) ? item.actionFlow : [];
      const failedImages = imageStatuses.filter((image: any) => conditionTaskStatus(String(image.status || "")) === "failed");
      const summary = imageStatuses.length
        ? imageStatuses.map((image: any) => `${String(image.image || "-")}: ${conditionTaskStatus(String(image.status || "")) === "succeeded" ? "成功" : conditionTaskStatus(String(image.status || "")) === "failed" ? "失败" : "执行中"}`).join("；")
        : "等待 KubeEdge TaskManager 接收镜像预热任务";
      return {
        target: String(item.nodeName || ""),
        status: nodeTaskStatus(String(item.phase || "")),
        message: String(item.reason || failedImages[0]?.reason || summary),
        currentVersion: String(images.length),
        targetVersion: images.join(", "),
        startedAt: actionFlow[0]?.time || null,
        finishedAt: ["successful", "failure"].includes(String(item.phase || "").toLowerCase()) ? actionFlow.at(-1)?.time || null : null,
        images: imageStatuses,
      };
    });
  const successCount = targetResults.filter((item: any) => item.status === "succeeded").length;
  const failedCount = targetResults.filter((item: any) => item.status === "failed").length;
  const completedCount = successCount + failedCount;
  const actionFlow = nodeStatuses.flatMap((item: any) => (Array.isArray(item.actionFlow) ? item.actionFlow.map((action: any) => ({ ...action, nodeName: item.nodeName })) : []));
  const events = actionFlow.map((item: any) => ({
    time: String(item.time || metadata.creationTimestamp || ""),
    type: conditionTaskStatus(String(item.status || "")) === "failed" ? "Warning" : "Normal",
    reason: String(item.action || "ImagePrePull"),
    message: `${String(item.nodeName || "-")}: ${String(item.reason || item.status || "")}`,
  }));
  const credential = String(template.imageSecrets || "");
  const credentialSeparator = credential.indexOf("/");
  const phase = imagePrePullJobStatus(String(status.phase || ""), successCount, failedCount);
  const fallbackSteps = [
    { name: "Check", displayName: "前置检查", status: phase === "pending" || phase === "initializing" ? "pending" : "running", message: String(status.reason || ""), startedAt: null, finishedAt: null },
    { name: "Pull", displayName: "镜像拉取", status: "pending", message: "", startedAt: null, finishedAt: null },
  ];
  return {
    id: metadata.name,
    name: metadata.name,
    type: "imagePreheat",
    status: phase,
    targetType: specTargets.length ? "node" : "nodeGroup",
    targetRefs,
    targetVersion: "",
    image: images.join(", "),
    concurrency: Number(template.concurrency || 1),
    failurePolicy: "continue",
    timeoutSeconds: Number(template.timeoutSeconds || 300),
    retryCount: Number(template.retryTimes || 0),
    failureRateThreshold: Math.round(Number(template.failureTolerate || 0.1) * 100),
    resourceChecks: imagePrePullCheckItems(template.checkItems),
    userConfirm: false,
    credentialNamespace: credentialSeparator > 0 ? credential.slice(0, credentialSeparator) : "",
    credentialName: credentialSeparator > 0 ? credential.slice(credentialSeparator + 1) : "",
    progress: targetRefs.length ? Math.round(completedCount / targetRefs.length * 100) : 0,
    totalTargets: targetRefs.length,
    successCount,
    failedCount,
    executionMode: "imagePrePullJob",
    createdAt: metadata.creationTimestamp || "",
    startedAt: actionFlow[0]?.time || null,
    finishedAt: ["succeeded", "failed", "partialSuccess"].includes(phase) ? actionFlow.at(-1)?.time || null : null,
    description: metadata.annotations?.["blueedge.io/description"] || "",
    steps: actionFlow.length
      ? actionFlow.map((item: any) => ({ name: String(item.action || "ImagePrePull"), displayName: `${String(item.nodeName || "-")} · ${String(item.action || "ImagePrePull")}`, status: conditionTaskStatus(String(item.status || "")), message: String(item.reason || ""), startedAt: item.time || null, finishedAt: conditionTaskStatus(String(item.status || "")) === "running" ? null : item.time || null }))
      : fallbackSteps,
    targetResults,
    errors: targetResults.filter((item: any) => item.status === "failed").map((item: any) => ({ target: item.target, message: item.message })),
    events,
    auditRecords: [{ time: metadata.creationTimestamp || "", actor: "dashboard-user", action: "create ImagePrePullJob", result: "success", message: "已向 KubeEdge 提交真实镜像预热任务" }],
    targets: [],
    plan: null,
    rawRef: { kind: "ImagePrePullJob", name: metadata.name },
  };
}

function buildNodeUpgradeJobView(job: any) {
  const metadata = metadataOf(job);
  const spec = job?.spec || {};
  const status = job?.status || {};
  const nodeStatuses = Array.isArray(status.nodeStatus) ? status.nodeStatus : [];
  const targetRefs = Array.isArray(spec.nodeNames) ? spec.nodeNames.map(String) : [];
  const targetResults = nodeStatuses.length
    ? nodeStatuses.map((item: any) => ({
        target: String(item.nodeName || ""),
        status: nodeTaskStatus(String(item.phase || "")),
        message: String(item.reason || ""),
        currentVersion: String(item.currentVersion || ""),
        targetVersion: String(spec.version || ""),
        startedAt: Array.isArray(item.actionFlow) ? item.actionFlow[0]?.time || null : null,
        finishedAt: Array.isArray(item.actionFlow) ? item.actionFlow.at(-1)?.time || null : null,
      }))
    : targetRefs.map((target: string) => ({ target, status: "pending", message: "等待 KubeEdge TaskManager 接收任务", currentVersion: "", targetVersion: String(spec.version || ""), startedAt: null, finishedAt: null }));
  const actionFlow = nodeStatuses.flatMap((item: any) => Array.isArray(item.actionFlow) ? item.actionFlow : []);
  const events = actionFlow.map((item: any) => ({
    time: String(item.time || metadata.creationTimestamp || ""),
    type: String(item.status || "").toLowerCase() === "failure" ? "Warning" : "Normal",
    reason: String(item.action || "NodeUpgrade"),
    message: String(item.reason || item.status || ""),
  }));
  const successCount = targetResults.filter((item: any) => item.status === "succeeded").length;
  const failedCount = targetResults.filter((item: any) => item.status === "failed").length;
  const completedCount = successCount + failedCount;
  const phase = nodeUpgradeStatus(String(status.phase || ""));
  return {
    id: metadata.name,
    name: metadata.name,
    type: "nodeUpgrade",
    status: phase,
    targetType: targetRefs.length ? "node" : "nodeGroup",
    targetRefs,
    targetVersion: String(spec.version || ""),
    image: String(spec.image || "kubeedge/installation-package"),
    concurrency: Number(spec.concurrency || 1),
    failurePolicy: "continue",
    timeoutSeconds: Number(spec.timeoutSeconds || 300),
    retryCount: Number(metadata.annotations?.["blueedge.io/retry-count"] || 0),
    failureRateThreshold: Math.round(Number(spec.failureTolerate || 0.1) * 100),
    resourceChecks: Array.isArray(spec.checkItems) ? spec.checkItems : [],
    userConfirm: Boolean(spec.requireConfirmation),
    progress: targetResults.length ? Math.round(completedCount / targetResults.length * 100) : 0,
    totalTargets: targetResults.length || targetRefs.length,
    successCount,
    failedCount,
    executionMode: "nodeUpgradeJob",
    createdAt: metadata.creationTimestamp || "",
    startedAt: actionFlow[0]?.time || null,
    finishedAt: phase === "succeeded" || phase === "failed" ? actionFlow.at(-1)?.time || null : null,
    description: metadata.annotations?.["blueedge.io/description"] || "",
    steps: actionFlow.map((item: any) => {
      const action = String(item.action || "NodeUpgrade");
      return { name: action, displayName: nodeUpgradeActionDisplayName(action), status: nodeTaskStatus(String(item.status || "")), message: String(item.reason || ""), startedAt: item.time || null, finishedAt: item.time || null };
    }),
    targetResults,
    errors: targetResults.filter((item: any) => item.status === "failed").map((item: any) => ({ target: item.target, message: item.message })),
    events,
    auditRecords: [{ time: metadata.creationTimestamp || "", actor: "dashboard-user", action: "create NodeUpgradeJob", result: "success", message: "已向 KubeEdge 提交真实节点升级任务" }],
    targets: [],
    plan: null,
    rawRef: { kind: "NodeUpgradeJob", name: metadata.name },
  };
}

async function createRealNodeUpgradeTask(body: any) {
  const warnings: EdgeUnitWarning[] = [];
  const name = readStringField(body, "name");
  const requestedNodeNames = readStringField(body, "targetType") === "node" ? batchTaskTargetRefs(body) : [];
  const labelSelector = objectValue(body?.labelSelector);
  const version = readStringField(body, "targetVersion");
  if (!name || !version || (requestedNodeNames.length === 0 && Object.keys(labelSelector).length === 0)) return { status: 400, body: { message: "name, targetVersion and targetRefs or labelSelector are required" } };
  if (!await cloudTaskManagerEnabled()) {
    return { status: 503, body: { message: "KubeEdge CloudCore TaskManager 未启用，拒绝创建无法执行的 NodeUpgradeJob；请先设置 modules.taskManager.enable=true 并重启 CloudCore" } };
  }
  const nodes = await getEdgeUnitNodes(warnings);
  const nodeMap = new Map(nodes.map((node) => [nodeNameOf(node), node]));
  const missing = requestedNodeNames.filter((item) => !nodeMap.has(item));
  if (missing.length) return { status: 400, body: { message: `Node not found: ${missing.join(", ")}` } };
  const selectorEntries = Object.entries(labelSelector).map(([key, value]) => [key, String(value)] as const);
  const selectedNodeNames = requestedNodeNames.length
    ? requestedNodeNames
    : nodes.filter((node) => selectorEntries.every(([key, value]) => labelsOf(node)[key] === value)).map(nodeNameOf);
  if (!selectedNodeNames.length) return { status: 400, body: { message: "标签选择器未匹配到任何节点" } };
  const notReady = selectedNodeNames.filter((item) => !isNodeReady(nodeMap.get(item)));
  if (notReady.length) return { status: 409, body: { message: `目标边缘节点未就绪，不能执行真实升级: ${notReady.join(", ")}` } };
  const resourceChecks = nodeTaskCheckItems(readStringArrayField(body, "resourceChecks"));
  const failureRate = Math.max(0, Math.min(100, readNumberField(body, "failureRateThreshold", 10))) / 100;
  try {
    const created = await createNodeUpgradeJob({
      apiVersion: "operations.kubeedge.io/v1alpha2",
      kind: "NodeUpgradeJob",
      metadata: { name, annotations: { "blueedge.io/description": readStringField(body, "description") || "", "blueedge.io/created-by": "blueedge-api-gateway" } },
      spec: {
        version,
        ...(requestedNodeNames.length ? { nodeNames: requestedNodeNames } : { labelSelector: { matchLabels: Object.fromEntries(selectorEntries) } }),
        image: readStringField(body, "image") || "kubeedge/installation-package",
        concurrency: Math.max(1, Math.floor(readNumberField(body, "concurrency", 1))),
        failureTolerate: String(failureRate),
        timeoutSeconds: Math.max(1, Math.floor(readNumberField(body, "timeoutSeconds", 300))),
        requireConfirmation: Boolean(body?.userConfirm),
        ...(resourceChecks.length ? { checkItems: resourceChecks } : {}),
      },
    });
    return { status: 201, body: { item: buildNodeUpgradeJobView(created), ...(warnings.length ? { warnings } : {}) } };
  } catch (error) {
    return { status: 502, body: { message: error instanceof Error ? error.message : "NodeUpgradeJob create failed", ...(warnings.length ? { warnings } : {}) } };
  }
}

async function createRealImagePreheatTask(body: any) {
  const warnings: EdgeUnitWarning[] = [];
  const name = readStringField(body, "name");
  const images = readStringArrayField(body, "images");
  const requestedNodeNames = readStringField(body, "targetType") === "node" ? batchTaskTargetRefs(body) : [];
  const labelSelector = objectValue(body?.labelSelector);
  if (!name || images.length === 0 || (requestedNodeNames.length === 0 && Object.keys(labelSelector).length === 0)) {
    return { status: 400, body: { message: "name, images and targetRefs or labelSelector are required" } };
  }
  if (images.some((image) => /\s/.test(image))) return { status: 400, body: { message: "image name must not include spaces" } };
  if (!await cloudTaskManagerEnabled()) {
    return { status: 503, body: { message: "KubeEdge CloudCore TaskManager 未启用，拒绝创建无法执行的 ImagePrePullJob；请先启用 CloudCore 和目标 EdgeCore 的 modules.taskManager.enable" } };
  }

  const nodes = await getEdgeUnitNodes(warnings);
  const nodeMap = new Map(nodes.map((node) => [nodeNameOf(node), node]));
  const missing = requestedNodeNames.filter((item) => !nodeMap.has(item));
  if (missing.length) return { status: 400, body: { message: `Node not found: ${missing.join(", ")}` } };
  const selectorEntries = Object.entries(labelSelector).map(([key, value]) => [key, String(value)] as const);
  const selectedNodeNames = requestedNodeNames.length
    ? requestedNodeNames
    : nodes.filter((node) => selectorEntries.every(([key, value]) => labelsOf(node)[key] === value)).map(nodeNameOf);
  if (!selectedNodeNames.length) return { status: 400, body: { message: "标签选择器未匹配到任何节点" } };
  const notReady = selectedNodeNames.filter((item) => !isNodeReady(nodeMap.get(item)));
  if (notReady.length) return { status: 409, body: { message: `目标边缘节点未就绪，不能执行真实镜像预热: ${notReady.join(", ")}` } };

  const credentialNamespace = readStringField(body, "credentialNamespace");
  const credentialName = readStringField(body, "credentialName");
  if (Boolean(credentialNamespace) !== Boolean(credentialName)) return { status: 400, body: { message: "镜像凭证的命名空间和 Secret 必须同时选择" } };
  if (credentialNamespace && credentialName) {
    const secret = await getImagePullSecret(credentialNamespace, credentialName);
    if (!secret) return { status: 400, body: { message: `镜像凭证不存在: ${credentialNamespace}/${credentialName}` } };
    if (!["kubernetes.io/dockerconfigjson", "kubernetes.io/dockercfg"].includes(String(secret.type || ""))) {
      return { status: 400, body: { message: `Secret ${credentialNamespace}/${credentialName} 不是镜像仓库凭证` } };
    }
  }

  const resourceChecks = nodeTaskCheckItems(readStringArrayField(body, "resourceChecks"));
  const failureRate = Math.max(0, Math.min(100, readNumberField(body, "failureRateThreshold", 10))) / 100;
  const template = {
    images,
    ...(requestedNodeNames.length ? { nodeNames: requestedNodeNames } : { labelSelector: { matchLabels: Object.fromEntries(selectorEntries) } }),
    ...(resourceChecks.length ? { checkItems: resourceChecks } : {}),
    failureTolerate: String(failureRate),
    concurrency: Math.max(1, Math.floor(readNumberField(body, "concurrency", 1))),
    timeoutSeconds: Math.max(1, Math.floor(readNumberField(body, "timeoutSeconds", 300))),
    retryTimes: Math.max(0, Math.floor(readNumberField(body, "retryCount", 0))),
    ...(credentialNamespace && credentialName ? { imageSecrets: `${credentialNamespace}/${credentialName}` } : {}),
  };
  try {
    const created = await createImagePrePullJob({
      apiVersion: "operations.kubeedge.io/v1alpha2",
      kind: "ImagePrePullJob",
      metadata: {
        name,
        annotations: {
          "blueedge.io/description": readStringField(body, "description") || "",
          "blueedge.io/created-by": "blueedge-api-gateway",
          "blueedge.io/target-nodes": JSON.stringify(selectedNodeNames),
        },
      },
      spec: { imagePrePullTemplate: template },
    });
    return { status: 201, body: { item: buildImagePrePullJobView(created), ...(warnings.length ? { warnings } : {}) } };
  } catch (error) {
    return { status: 502, body: { message: error instanceof Error ? error.message : "ImagePrePullJob create failed", ...(warnings.length ? { warnings } : {}) } };
  }
}

async function validateBatchTaskTargets(targetType: string, targetRefs: string[], warnings: EdgeUnitWarning[]) {
  if (targetType === "deployment") return;
  if (targetRefs.length === 0) throw new Error("targetRefs are required");

  if (targetType === "node") {
    const nodes = await getEdgeUnitNodes(warnings);
    const names = nodeNames(nodes);
    const missing = targetRefs.filter((name) => !names.has(name));
    if (missing.length > 0) throw new Error(`Node not found: ${missing.join(", ")}`);
    return;
  }

  if (targetType === "nodeGroup") {
    const { nodeGroupByName, nodeGroupError } = await collectNodeGroupDetails(warnings);
    if (nodeGroupError) throw nodeGroupError;
    const missing = targetRefs.filter((name) => !nodeGroupByName.has(name));
    if (missing.length > 0) throw new Error(`NodeGroup not found: ${missing.join(", ")}`);
    return;
  }

  if (targetType === "edgeUnit") {
    const { edgeUnitConfigMaps, nodeGroupByName, nodeGroupError } = await collectEdgeUnitSources(warnings, { includeNodeGroups: true });
    if (nodeGroupError) throw nodeGroupError;
    const names = knownEdgeUnitNames(edgeUnitConfigMaps, nodeGroupByName, warnings);
    const missing = targetRefs.filter((name) => !names.has(name));
    if (missing.length > 0) throw new Error(`EdgeUnit not found: ${missing.join(", ")}`);
  }
}

export { batchTaskTargetRefs };

export async function listBatchTasks() {
  const warnings: EdgeUnitWarning[] = [];
  const [configMaps, upgradeJobs, imagePrePullJobs] = await Promise.all([
    getBatchTaskConfigMaps(warnings),
    listNodeUpgradeJobs().catch((error) => { warnings.push({ source: "node-upgrade-job", message: error instanceof Error ? error.message : "NodeUpgradeJob list unavailable" }); return []; }),
    listImagePrePullJobs().catch((error) => { warnings.push({ source: "image-prepull-job", message: error instanceof Error ? error.message : "ImagePrePullJob list unavailable" }); return []; }),
  ]);
  const items = [
    ...upgradeJobs.map(buildNodeUpgradeJobView),
    ...imagePrePullJobs.map(buildImagePrePullJobView),
    ...configMaps
    .filter((item) => isValidBatchTaskConfigMap(item, warnings))
    .map(buildBatchTaskView)
    .filter((item) => item.type !== "nodeUpgrade" && item.type !== "imagePreheat"),
  ]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { items, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function listBatchTaskViewsForSummary(warnings: EdgeUnitWarning[]) {
  const configMaps = await getBatchTaskConfigMaps(warnings).catch(() => []);
  return configMaps
    .filter((item) => isValidBatchTaskConfigMap(item, warnings))
    .map(buildBatchTaskView);
}

export async function getBatchTask(id: string) {
  const warnings: EdgeUnitWarning[] = [];
  const upgradeJob = await getNodeUpgradeJob(id).catch((error) => { warnings.push({ source: "node-upgrade-job", message: error instanceof Error ? error.message : "NodeUpgradeJob unavailable" }); return null; });
  if (upgradeJob) return { status: 200, body: { item: buildNodeUpgradeJobView(upgradeJob), ...(warnings.length > 0 ? { warnings } : {}) } };
  const imagePrePullJob = await getImagePrePullJob(id).catch((error) => { warnings.push({ source: "image-prepull-job", message: error instanceof Error ? error.message : "ImagePrePullJob unavailable" }); return null; });
  if (imagePrePullJob) return { status: 200, body: { item: buildImagePrePullJobView(imagePrePullJob), ...(warnings.length > 0 ? { warnings } : {}) } };
  const configMap = await findBatchTaskConfigMap(id, warnings);
  if (!configMap || !isValidBatchTaskConfigMap(configMap, warnings)) {
    return { status: 404, body: { message: `BatchTask ${id} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const item = buildBatchTaskView(configMap);
  if (item.type === "nodeUpgrade") {
    const nodes = await getEdgeUnitNodes(warnings).catch(() => []);
    const versions = new Map(nodes.map((node) => [nodeNameOf(node), String(node?.status?.nodeInfo?.kubeletVersion || node?.kubeletVersion || "")]));
    item.targetResults = item.targetResults.map((result: any) => ({
      ...result,
      currentVersion: result.currentVersion || versions.get(result.target) || "",
      targetVersion: result.targetVersion || item.targetVersion,
    }));
  }
  return { status: 200, body: { item, ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function getBatchTaskEvents(id: string) {
  const result = await getBatchTask(id);
  if (result.status !== 200 || !("item" in result.body)) return result;
  return { status: 200, body: { items: result.body.item.events || [], ...(result.body.warnings ? { warnings: result.body.warnings } : {}) } };
}

export async function getBatchTaskAudit(id: string) {
  const result = await getBatchTask(id);
  if (result.status !== 200 || !("item" in result.body)) return result;
  return { status: 200, body: { items: result.body.item.auditRecords || [], ...(result.body.warnings ? { warnings: result.body.warnings } : {}) } };
}

export async function createBatchTask(body: any, type: BatchTaskType) {
  if (type === "nodeUpgrade") return createRealNodeUpgradeTask(body);
  if (type === "imagePreheat") return createRealImagePreheatTask(body);
  const warnings: EdgeUnitWarning[] = [];
  let data;
  try {
    data = normalizeBatchTaskPayload(body, type);
    await validateBatchTaskTargets(data.targetType, parseJsonField<string[]>(data.targetRefs, []), warnings);
  } catch (error) {
    return { status: 400, body: { message: error instanceof Error ? error.message : "Invalid BatchTask payload", ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  await ensureNamespace();
  const created = await create(buildBatchTaskConfigMap(data));
  return { status: 201, body: { item: buildBatchTaskView(created), ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function startBatchTask(id: string) {
  const warnings: EdgeUnitWarning[] = [];
  if (await getImagePrePullJob(id).catch(() => null)) {
    return { status: 409, body: { message: "ImagePrePullJob 创建后由 KubeEdge 自动执行，无需再次启动" } };
  }
  const existing = await findBatchTaskConfigMap(id, warnings);
  if (!existing || !isValidBatchTaskConfigMap(existing, warnings)) {
    return { status: 404, body: { message: `BatchTask ${id} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const existingData = dataOf(existing);
  if (existingData.status !== "pending") {
    return { status: 409, body: { message: `BatchTask ${id} can only start from pending status`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  const targetRefs = parseJsonField<string[]>(existingData.targetRefs, []);
  const targets = parseJsonField<any[]>(existingData.targetsJson, []);
  const data = {
    ...existingData,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    executionMode: "planOnly",
    progress: "0",
    stepsJson: JSON.stringify(buildBatchTaskSteps(existingData.type, "running")),
    resultsJson: JSON.stringify(buildBatchTaskResults(targetRefs, targets)),
    errorsJson: existingData.errorsJson || "[]",
    eventsJson: appendJsonItem(existingData.eventsJson, taskEvent("PlanGenerated", "任务执行计划已生成；planOnly 模式未执行真实节点操作")),
    auditJson: appendJsonItem(existingData.auditJson, auditRecord("start", "生成任务执行计划")),
  };
  const updated = await update(metadataOf(existing).name, buildBatchTaskConfigMap(data, existing));
  return {
    status: 200,
    body: {
      item: buildBatchTaskView(updated),
      warnings: [
        ...warnings,
        { source: "batch-task.execution", message: "executionMode=planOnly; no real node upgrade, image preheat or workload rollout was executed" },
      ],
    },
  };
}

export async function cancelBatchTask(id: string) {
  const warnings: EdgeUnitWarning[] = [];
  const existing = await findBatchTaskConfigMap(id, warnings);
  if (!existing || !isValidBatchTaskConfigMap(existing, warnings)) {
    return { status: 404, body: { message: `BatchTask ${id} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const existingData = dataOf(existing);
  if (!["pending", "running"].includes(existingData.status)) {
    return { status: 409, body: { message: `BatchTask ${id} cannot be cancelled from ${existingData.status}`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const data = {
    ...existingData,
    status: "cancelled",
    finishedAt: new Date().toISOString(),
    progress: existingData.progress || "0",
    eventsJson: appendJsonItem(existingData.eventsJson, taskEvent("TaskCancelled", "任务已取消")),
    auditJson: appendJsonItem(existingData.auditJson, auditRecord("cancel", "取消批量任务")),
  };
  const updated = await update(metadataOf(existing).name, buildBatchTaskConfigMap(data, existing));
  return { status: 200, body: { item: buildBatchTaskView(updated), ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function retryBatchTask(id: string) {
  const warnings: EdgeUnitWarning[] = [];
  if (await getImagePrePullJob(id).catch(() => null)) {
    return { status: 409, body: { message: "ImagePrePullJob 的失败重试由 spec.imagePrePullTemplate.retryTimes 控制，不能手动重试同一资源" } };
  }
  const existing = await findBatchTaskConfigMap(id, warnings);
  if (!existing || !isValidBatchTaskConfigMap(existing, warnings)) return { status: 404, body: { message: `BatchTask ${id} not found` } };
  const existingData = dataOf(existing);
  if (!["failed", "partialSuccess", "cancelled"].includes(existingData.status)) {
    return { status: 409, body: { message: `BatchTask ${id} cannot retry from ${existingData.status}` } };
  }
  const retryCount = Number(existingData.retryCount || 0) + 1;
  const data = {
    ...existingData,
    status: "running",
    retryCount: String(retryCount),
    startedAt: new Date().toISOString(),
    finishedAt: "",
    progress: "0",
    stepsJson: JSON.stringify(buildBatchTaskSteps(existingData.type, "running")),
    eventsJson: appendJsonItem(existingData.eventsJson, taskEvent("TaskRetried", `第 ${retryCount} 次失败重试指令已下发`)),
    auditJson: appendJsonItem(existingData.auditJson, auditRecord("retry", `执行第 ${retryCount} 次失败重试`)),
  };
  const updated = await update(metadataOf(existing).name, buildBatchTaskConfigMap(data, existing));
  return { status: 200, body: { item: buildBatchTaskView(updated), warnings: [...warnings, { source: "batch-task.execution", message: "planOnly retry recorded; no real node operation was executed" }] } };
}

export async function rollbackBatchTask(id: string) {
  const warnings: EdgeUnitWarning[] = [];
  if (await getImagePrePullJob(id).catch(() => null)) {
    return { status: 409, body: { message: "镜像预热不会修改节点软件版本，不支持回滚；如需停止请删除任务资源" } };
  }
  const existing = await findBatchTaskConfigMap(id, warnings);
  if (!existing || !isValidBatchTaskConfigMap(existing, warnings)) return { status: 404, body: { message: `BatchTask ${id} not found` } };
  const existingData = dataOf(existing);
  if (!["running", "partialSuccess", "succeeded", "failed"].includes(existingData.status)) {
    return { status: 409, body: { message: `BatchTask ${id} cannot rollback from ${existingData.status}` } };
  }
  const data = {
    ...existingData,
    status: "cancelled",
    finishedAt: new Date().toISOString(),
    eventsJson: appendJsonItem(existingData.eventsJson, taskEvent("TaskRollback", "回滚任务指令已记录；planOnly 模式未操作节点", "Warning")),
    auditJson: appendJsonItem(existingData.auditJson, auditRecord("rollback", "记录任务回滚指令")),
  };
  const updated = await update(metadataOf(existing).name, buildBatchTaskConfigMap(data, existing));
  return { status: 200, body: { item: buildBatchTaskView(updated), warnings: [...warnings, { source: "batch-task.execution", message: "planOnly rollback recorded; no real node operation was executed" }] } };
}

export async function deleteBatchTask(id: string) {
  const warnings: EdgeUnitWarning[] = [];
  const upgradeJob = await getNodeUpgradeJob(id).catch(() => null);
  if (upgradeJob) {
    await deleteNodeUpgradeJob(id);
    return { status: 200, body: { warnings } };
  }
  const imagePrePullJob = await getImagePrePullJob(id).catch(() => null);
  if (imagePrePullJob) {
    await deleteImagePrePullJob(id);
    return { status: 200, body: { warnings } };
  }
  const existing = await findBatchTaskConfigMap(id, warnings);
  if (!existing) {
    return { status: 404, body: { message: `BatchTask ${id} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const existingData = dataOf(existing);
  if (existingData.status === "running") {
    return { status: 409, body: { message: "running BatchTask cannot be deleted; cancel it first", ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  await remove(metadataOf(existing).name);
  return { status: 200, body: { warnings } };
}

export async function getBatchWorkloadTask(taskId: string) {
  const warnings: EdgeUnitWarning[] = [];
  const configMap = await findBatchTaskConfigMap(taskId, warnings);
  if (!configMap || !isValidBatchTaskConfigMap(configMap, warnings) || dataOf(configMap).type !== "batchWorkload") {
    return { status: 404, body: { message: `BatchWorkloadTask ${taskId} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  return { status: 200, body: { item: buildBatchTaskView(configMap), ...(warnings.length > 0 ? { warnings } : {}) } };
}
