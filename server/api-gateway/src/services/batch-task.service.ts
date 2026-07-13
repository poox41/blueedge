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
import type { BatchTaskType } from "../types/batch-task.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  dataOf,
  labelsOf,
  metadataOf,
  nodeNameOf,
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
  const names = type === "nodeUpgrade"
    ? ["validateTargets", "checkResources", "prepareUpgrade", "executeUpgrade", "verifyNodes"]
    : type === "imagePreheat"
      ? ["validateTargets", "checkResources", "prepareImages", "createPreheatPlan", "verifyImages"]
      : ["validateTargets", "renderWorkloads", "createExecutionPlan", "applyWorkloads", "verifyWorkloads"];
  return names.map((name, index) => ({
    name,
    status: status === "running" && index === 0 ? "running" : "pending",
    message: status === "running" && index === 0 ? "planOnly: execution plan generated; no real node operation is running" : "",
  }));
}

function buildBatchTaskResults(targetRefs: string[], targets: any[] = []) {
  const refs = targetRefs.length > 0 ? targetRefs : targets.map((item) => item?.name || item?.nodeGroupRef || item?.namespace || "target");
  return refs.map((ref) => ({
    target: String(ref),
    status: "pending",
    message: "planOnly: waiting for manual execution integration",
  }));
}

function normalizeBatchTaskPayload(body: any, type: string, existingData: Record<string, string> = {}) {
  const now = new Date().toISOString();
  const id = readStringField(body, "id") || existingData.id || newBatchTaskId(type === "batchWorkload" ? "batch-workload" : "batch-task");
  const name = readStringField(body, "name") || existingData.name || "";
  const targetType = readStringField(body, "targetType") || existingData.targetType || (type === "batchWorkload" ? "deployment" : "nodeGroup");
  const targetRefs = batchTaskTargetRefs(body);
  const persistedTargetRefs = parseJsonField<string[]>(existingData.targetRefs, []);
  const images = readStringArrayField(body, "images");
  const image = images.length > 0 ? images.join(", ") : readStringField(body, "image") || existingData.image || "";
  const status = readStringField(body, "status") || existingData.status || "pending";
  const failurePolicy = readStringField(body, "failurePolicy") || existingData.failurePolicy || "continue";
  const concurrency = Math.max(1, Math.floor(readNumberField(body, "concurrency", Number(existingData.concurrency || 1))));
  const timeoutSeconds = Math.max(0, Math.floor(readNumberField(body, "timeoutSeconds", Number(existingData.timeoutSeconds || 0))));
  const retryCount = Math.max(0, Math.floor(readNumberField(body, "retryCount", Number(existingData.retryCount || 0))));
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
    targetsJson: JSON.stringify(targets),
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
    progress: Number(data.progress || 0),
    totalTargets: Number(data.totalTargets || targetRefs.length || targets.length || 0),
    successCount: Number(data.successCount || 0),
    failedCount: Number(data.failedCount || 0),
    executionMode: data.executionMode || "planOnly",
    createdAt: data.createdAt || metadata.creationTimestamp || "",
    startedAt: data.startedAt || null,
    finishedAt: data.finishedAt || null,
    description: data.description || "",
    steps: parseJsonField(data.stepsJson, []),
    targetResults: parseJsonField(data.resultsJson, []),
    errors: parseJsonField(data.errorsJson, []),
    targets,
    rawRef: {
      kind: "ConfigMap",
      namespace: metadata.namespace || blueedgeNamespace(),
      name: metadata.name || "",
    },
  };
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
  const configMaps = await getBatchTaskConfigMaps(warnings);
  const items = configMaps
    .filter((item) => isValidBatchTaskConfigMap(item, warnings))
    .map(buildBatchTaskView)
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
  const configMap = await findBatchTaskConfigMap(id, warnings);
  if (!configMap || !isValidBatchTaskConfigMap(configMap, warnings)) {
    return { status: 404, body: { message: `BatchTask ${id} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  return { status: 200, body: { item: buildBatchTaskView(configMap), ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function createBatchTask(body: any, type: BatchTaskType) {
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
  };
  const updated = await update(metadataOf(existing).name, buildBatchTaskConfigMap(data, existing));
  return { status: 200, body: { item: buildBatchTaskView(updated), ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function deleteBatchTask(id: string) {
  const warnings: EdgeUnitWarning[] = [];
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
