import { gatewayRequest } from "@/api/request";
import type {
  AccessConfigDetailResponse,
  AccessConfigInstallCommandResponse,
  AccessConfigListResponse,
  AccessConfigWarning,
} from "@/api/adapters/access-config.adapter";
import type { BatchTaskAuditRecord, BatchTaskDetailResponse, BatchTaskEvent, BatchTaskListResponse } from "@/api/adapters/batch-task.adapter";
import type { DeviceModelSummaryListResponse, DeviceModelSummaryResponse } from "@/api/adapters/device-model-summary.adapter";
import type { DeviceSummaryListResponse, DeviceSummaryResponse } from "@/api/adapters/device-summary.adapter";
import type { DeviceConfigPayload } from "@/lib/device-config";
import type { EdgeAppSummaryResponse } from "@/api/adapters/edgeapp-summary.adapter";
import type { EdgeUnitDetailResponse, EdgeUnitListResponse, EdgeUnitView, EdgeUnitWarning } from "@/api/adapters/edge-unit.adapter";
import type { IncrementalSyncStatus } from "@/api/adapters/edge-unit.adapter";
import type { NodeGroupSummaryResponse } from "@/api/adapters/nodegroup-summary.adapter";
import type { NodeSummaryResponse } from "@/api/adapters/node-summary.adapter";
import type { ObservabilityKind, ObservabilityLogsResponse, ObservabilitySummaryResponse } from "@/api/adapters/observability.adapter";
import type { PodSummaryResponse } from "@/api/adapters/pod-summary.adapter";
import type { PersistentVolumeSummaryListResponse, PersistentVolumeSummaryResponse } from "@/api/adapters/pv-summary.adapter";
import type { PersistentVolumeClaimSummaryListResponse, PersistentVolumeClaimSummaryResponse } from "@/api/adapters/pvc-summary.adapter";
import type { StorageClassListResponse } from "@/api/adapters/storage-class.adapter";

export interface EdgeUnitCreatePayload {
  name: string;
  clusterName?: string;
  accessType?: "external" | "dedicated" | "unknown";
  kubeEdgeVersion?: string;
  insightStatus?: "installed" | "notInstalled" | "unknown";
  monitorStatus?: "installed" | "notInstalled" | "unknown";
  description?: string;
  nodeScale?: "小型" | "中型" | "大型";
  mqttEnabled?: boolean;
  protocols?: string[];
  accessAddresses?: string[];
  ports?: {
    websocket: string;
    quic: string;
    https: string;
    cloudStream: string;
    tunnel: string;
  };
  uninstallPolicy?: "保留相关命名空间" | "删除相关命名空间";
}

export type EdgeUnitUpdatePayload = Omit<EdgeUnitCreatePayload, "name">;

export interface EdgeUnitOperation {
  id: string;
  type: "create" | "delete";
  edgeUnitName: string;
  status: "pending" | "running" | "succeeded" | "failed";
  stage: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
}

async function waitForEdgeUnitOperation<T>(operation: EdgeUnitOperation, onProgress?: (operation: EdgeUnitOperation) => void): Promise<T> {
  const deadline = Date.now() + 12 * 60 * 1000;
  let current = operation;
  while (["pending", "running"].includes(current.status)) {
    onProgress?.(current);
    if (Date.now() >= deadline) throw new Error(`任务仍在后台执行，可通过任务 ID ${current.id} 继续查询`);
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const response = await gatewayRequest<{ operation: EdgeUnitOperation }>(`/blueedge/edge-unit-operations/${encodeURIComponent(current.id)}`);
    current = response.data.operation;
  }
  onProgress?.(current);
  if (current.status === "failed") throw new Error(current.message || "边缘单元操作失败");
  return current.result as T;
}

export async function enableCloudCoreIncrementalSync(edgeUnitName: string): Promise<IncrementalSyncStatus> {
  const response = await gatewayRequest<{ item: IncrementalSyncStatus }>(`/blueedge/edge-units/${encodeURIComponent(edgeUnitName)}/incremental-sync`, { method: "PUT" });
  return response.data.item;
}

export interface EdgeUnitResourceRef {
  namespace: string;
  name: string;
}

export interface EdgeUnitResourceScope {
  edgeUnit: EdgeUnitView;
  nodeNames: string[];
  deployments: EdgeUnitResourceRef[];
  edgeApplications: EdgeUnitResourceRef[];
}

export interface EdgeUnitResourceScopeResponse {
  item: EdgeUnitResourceScope;
  warnings?: EdgeUnitWarning[];
}

export interface AccessConfigPayload {
  name?: string;
  edgeUnitRef: string;
  nodeName?: string;
  cloudCoreAddress: string;
  protocol?: string;
  driver?: "systemd" | "cgroups";
  criAddress?: string;
  registry?: string;
  description?: string;
  labels?: Record<string, string>;
}

export type AccessConfigUpdatePayload = Omit<AccessConfigPayload, "name">;

export interface BatchWorkloadPlanContainer {
  name: string;
  image: string;
  imagePullPolicy?: "Always" | "IfNotPresent" | "Never";
  command?: string[];
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
  lifecycle?: { postStart?: string; preStop?: string };
  healthChecks?: { startup?: boolean; readiness?: boolean; liveness?: boolean };
  securityContext?: {
    privileged?: boolean;
    runAsUser?: number;
    runAsGroup?: number;
    readOnlyRootFilesystem?: boolean;
    allowPrivilegeEscalation?: boolean;
  };
  volumes?: Array<{ name: string; type: string; mountPath: string; source?: string }>;
}

export interface BatchWorkloadPlan {
  edgeUnitRef?: string;
  namespace: string;
  name: string;
  targetGroups: string[];
  replicas: number;
  workloadType: "Deployment";
  metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
  podTemplate: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    containers: BatchWorkloadPlanContainer[];
    network?: { type: "none" | "portmap" | "host"; ports?: Array<{ containerName: string; containerPort: number; hostPort?: number }> };
    terminationGracePeriodSeconds?: number;
  };
  strategy?: {
    type: "RollingUpdate" | "Recreate";
    maxUnavailable?: string;
    maxSurge?: string;
    revisionHistoryLimit?: number;
    minReadySeconds?: number;
    progressDeadlineSeconds?: number;
  };
}

export interface BatchTaskPayload {
  edgeUnitRef?: string;
  name: string;
  targetType: "node" | "nodeGroup" | "edgeUnit" | "deployment" | "edgeapplication";
  targetRefs: string[];
  labelSelector?: Record<string, string>;
  targetVersion?: string;
  image?: string;
  images?: string[];
  concurrency?: number;
  failurePolicy?: "continue" | "stop";
  timeoutSeconds?: number;
  retryCount?: number;
  failureRateThreshold?: number;
  resourceChecks?: string[];
  userConfirm?: boolean;
  credentialNamespace?: string;
  credentialName?: string;
  description?: string;
  targets?: Array<Record<string, unknown>>;
  plan?: BatchWorkloadPlan;
  edgeApplication?: Record<string, unknown>;
}

export interface BatchWorkloadEvent {
  name: string;
  namespace: string;
  type: "Normal" | "Warning" | string;
  reason: string;
  message: string;
  component: string;
  object: string;
  time: string;
}

export interface BatchWorkloadAuditItem {
  action: string;
  result: "success" | "failed";
  actor: string;
  method: string;
  sourceIP: string;
  time: string;
}

export interface ProductOverview {
  nodes: { total: number; ready: number; edge: number };
  workloads: { deployments: number; running: number };
  devices: { total: number; online: number };
  rules: { total: number };
}

export interface ConnectedClusterSummary {
  name: string;
  current: true;
  kubernetesVersion: string;
  nodeCount: number;
  source: "kubeadm-config";
}

export interface ClusterMetrics {
  timestamp?: string;
  cpu: {
    usedMillicores: number;
    capacityMillicores: number;
    percent: number;
  };
  memory: {
    usedBytes: number;
    capacityBytes: number;
    percent: number;
  };
  source: string;
}

export interface ClusterMetricsHistory {
  items: ClusterMetrics[];
  source: string;
  stale?: boolean;
}

export interface ClusterEvent {
  name: string;
  namespace: string;
  type: string;
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    name: string;
  };
  count: number;
  lastTimestamp: string;
}

export interface RuleDeliverySummary {
  successMessages: number;
  failMessages: number;
  totalMessages: number;
  errors: string[];
  source: "Rule.status";
  completeHistory: false;
  warning: string;
}

export interface RuleAuditRecord {
  manager: string;
  operation: string;
  apiVersion: string;
  subresource: string;
  time: string;
}

export interface RuleAuditResponse {
  items: RuleAuditRecord[];
  source: "metadata.managedFields";
  completeAuditLog: false;
  warning: string;
}

export interface RuleEventsResponse {
  items: ClusterEvent[];
  source: "core/v1 Event";
}

export interface DeploymentRevision {
  revision: number;
  current: boolean;
  replicaSetName: string;
  createdAt: string;
  images: string[];
  replicas: number;
  availableReplicas: number;
  yaml: unknown;
}

export interface DeploymentAuditRecord {
  manager: string;
  operation: string;
  apiVersion: string;
  subresource: string;
  time: string;
}

export interface DeploymentExecResult {
  pod: string;
  container: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function getProductOverview(): Promise<ProductOverview> {
  const res = await gatewayRequest<ProductOverview>("/overview");
  return res.data;
}

export async function listConnectedClusters(): Promise<{ items: ConnectedClusterSummary[] }> {
  const res = await gatewayRequest<{ items: ConnectedClusterSummary[] }>("/blueedge/clusters");
  return res.data;
}

export async function listEdgeUnits(): Promise<EdgeUnitListResponse> {
  const res = await gatewayRequest<EdgeUnitListResponse>("/blueedge/edge-units");
  return res.data;
}

export async function getEdgeUnit(name: string): Promise<EdgeUnitDetailResponse> {
  const res = await gatewayRequest<EdgeUnitDetailResponse>(`/blueedge/edge-units/${encodeURIComponent(name)}`);
  return res.data;
}

export async function getEdgeUnitResources(name: string): Promise<EdgeUnitResourceScopeResponse> {
  const res = await gatewayRequest<EdgeUnitResourceScopeResponse>(`/blueedge/edge-units/${encodeURIComponent(name)}/resources`);
  return res.data;
}

export async function createEdgeUnit(payload: EdgeUnitCreatePayload, onProgress?: (operation: EdgeUnitOperation) => void): Promise<EdgeUnitDetailResponse> {
  const res = await gatewayRequest<{ operation: EdgeUnitOperation }, EdgeUnitCreatePayload>("/blueedge/edge-units", {
    method: "POST",
    body: payload,
  });
  return waitForEdgeUnitOperation<EdgeUnitDetailResponse>(res.data.operation, onProgress);
}

export async function updateEdgeUnit(name: string, payload: EdgeUnitUpdatePayload): Promise<EdgeUnitDetailResponse> {
  const res = await gatewayRequest<EdgeUnitDetailResponse, EdgeUnitUpdatePayload>(`/blueedge/edge-units/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: payload,
  });
  return res.data;
}

export async function deleteEdgeUnit(name: string, onProgress?: (operation: EdgeUnitOperation) => void): Promise<{ warnings?: EdgeUnitWarning[] }> {
  const res = await gatewayRequest<{ operation: EdgeUnitOperation }>(`/blueedge/edge-units/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return waitForEdgeUnitOperation<{ warnings?: EdgeUnitWarning[] }>(res.data.operation, onProgress);
}

export async function listAccessConfigs(): Promise<AccessConfigListResponse> {
  const res = await gatewayRequest<AccessConfigListResponse>("/blueedge/access-configs");
  return res.data;
}

export async function getAccessConfig(name: string): Promise<AccessConfigDetailResponse> {
  const res = await gatewayRequest<AccessConfigDetailResponse>(`/blueedge/access-configs/${encodeURIComponent(name)}`);
  return res.data;
}

export async function createAccessConfig(payload: AccessConfigPayload): Promise<AccessConfigDetailResponse> {
  const res = await gatewayRequest<AccessConfigDetailResponse, AccessConfigPayload>("/blueedge/access-configs", {
    method: "POST",
    body: payload,
  });
  return res.data;
}

export async function updateAccessConfig(name: string, payload: AccessConfigUpdatePayload): Promise<AccessConfigDetailResponse> {
  const res = await gatewayRequest<AccessConfigDetailResponse, AccessConfigUpdatePayload>(`/blueedge/access-configs/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: payload,
  });
  return res.data;
}

export async function deleteAccessConfig(name: string): Promise<{ warnings?: AccessConfigWarning[] }> {
  const res = await gatewayRequest<{ warnings?: AccessConfigWarning[] }>(`/blueedge/access-configs/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return res.data;
}

export async function getAccessConfigInstallCommand(name: string, nodeName = ""): Promise<AccessConfigInstallCommandResponse> {
  const res = await gatewayRequest<AccessConfigInstallCommandResponse>(`/blueedge/access-configs/${encodeURIComponent(name)}/install-command?nodeName=${encodeURIComponent(nodeName)}`);
  return res.data;
}

export async function downloadAccessConfig(name: string): Promise<string> {
  const res = await gatewayRequest<string>(`/blueedge/access-configs/${encodeURIComponent(name)}/download`);
  return res.data;
}

export async function listBatchTasks(): Promise<BatchTaskListResponse> {
  const res = await gatewayRequest<BatchTaskListResponse>("/blueedge/batch-tasks");
  return res.data;
}

export async function getBatchTask(id: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse>(`/blueedge/batch-tasks/${encodeURIComponent(id)}`);
  return res.data;
}

export async function createNodeUpgradeTask(payload: BatchTaskPayload): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse, BatchTaskPayload>("/blueedge/batch-tasks/upgrade", {
    method: "POST",
    body: payload,
  });
  return res.data;
}

export async function createImagePreheatTask(payload: BatchTaskPayload): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse, BatchTaskPayload>("/blueedge/batch-tasks/image-preheat", {
    method: "POST",
    body: payload,
  });
  return res.data;
}

export async function startBatchTask(id: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse>(`/blueedge/batch-tasks/${encodeURIComponent(id)}/start`, {
    method: "POST",
  });
  return res.data;
}

export async function cancelBatchTask(id: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse>(`/blueedge/batch-tasks/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  return res.data;
}

export async function retryBatchTask(id: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse>(`/blueedge/batch-tasks/${encodeURIComponent(id)}/retry`, { method: "POST" });
  return res.data;
}

export async function rollbackBatchTask(id: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse>(`/blueedge/batch-tasks/${encodeURIComponent(id)}/rollback`, { method: "POST" });
  return res.data;
}

export async function getBatchTaskEvents(id: string): Promise<{ items: BatchTaskEvent[] }> {
  const res = await gatewayRequest<{ items: BatchTaskEvent[] }>(`/blueedge/batch-tasks/${encodeURIComponent(id)}/events`);
  return res.data;
}

export async function getBatchTaskAudit(id: string): Promise<{ items: BatchTaskAuditRecord[] }> {
  const res = await gatewayRequest<{ items: BatchTaskAuditRecord[] }>(`/blueedge/batch-tasks/${encodeURIComponent(id)}/audit`);
  return res.data;
}

export async function deleteBatchTask(id: string): Promise<{ warnings?: Array<{ source: string; message: string }> }> {
  const res = await gatewayRequest<{ warnings?: Array<{ source: string; message: string }> }>(`/blueedge/batch-tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.data;
}

export async function createBatchWorkloadTask(payload: BatchTaskPayload): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse, BatchTaskPayload>("/blueedge/workloads/batch", {
    method: "POST",
    body: payload,
  });
  return res.data;
}

export async function listBatchWorkloads(edgeUnitRef?: string): Promise<BatchTaskListResponse> {
  const res = await gatewayRequest<BatchTaskListResponse>("/blueedge/workloads/batch", { params: { edgeUnitRef } });
  return res.data;
}

export async function getBatchWorkloadTask(taskId: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}`);
  return res.data;
}

export async function updateBatchWorkloadMetadata(taskId: string, payload: { description: string }): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse, { description: string }>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}`, { method: "PATCH", body: payload });
  return res.data;
}

export async function getBatchWorkloadEvents(taskId: string): Promise<{ items: BatchWorkloadEvent[]; summary: { total: number; warning: number } }> {
  const res = await gatewayRequest<{ items: BatchWorkloadEvent[]; summary: { total: number; warning: number } }>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}/events`);
  return res.data;
}

export async function getBatchWorkloadAudit(taskId: string): Promise<{ items: BatchWorkloadAuditItem[]; warning?: string }> {
  const res = await gatewayRequest<{ items: BatchWorkloadAuditItem[]; warning?: string }>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}/audit`);
  return res.data;
}

export async function addBatchWorkloadDeployments(taskId: string, plan: BatchWorkloadPlan): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse, { plan: BatchWorkloadPlan }>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}/deployments`, { method: "POST", body: { plan } });
  return res.data;
}

export async function updateBatchWorkloadYaml(taskId: string, yaml: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse, { yaml: string }>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}/yaml`, { method: "PUT", body: { yaml } });
  return res.data;
}

export async function deleteBatchWorkload(taskId: string): Promise<{ message: string }> {
  const res = await gatewayRequest<{ message: string }>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  return res.data;
}

export async function deleteBatchWorkloadDeployment(taskId: string, deploymentName: string): Promise<{ message: string }> {
  const res = await gatewayRequest<{ message: string }>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}/deployments/${encodeURIComponent(deploymentName)}`, { method: "DELETE" });
  return res.data;
}

export async function getNodeSummary(name: string): Promise<NodeSummaryResponse> {
  const res = await gatewayRequest<NodeSummaryResponse>(`/blueedge/nodes/${encodeURIComponent(name)}/summary`);
  return res.data;
}

export async function getNodeGroupSummary(name: string): Promise<NodeGroupSummaryResponse> {
  const res = await gatewayRequest<NodeGroupSummaryResponse>(`/blueedge/nodegroups/${encodeURIComponent(name)}/summary`);
  return res.data;
}

export async function getEdgeAppSummary(namespace: string, name: string): Promise<EdgeAppSummaryResponse> {
  const res = await gatewayRequest<EdgeAppSummaryResponse>(`/blueedge/edgeapps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/summary`);
  return res.data;
}

export async function getPodSummary(namespace: string, name: string, options: { tailLines?: number; container?: string } = {}): Promise<PodSummaryResponse> {
  const res = await gatewayRequest<PodSummaryResponse>(`/blueedge/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/summary`, {
    params: {
      tailLines: options.tailLines,
      container: options.container,
    },
  });
  return res.data;
}

export async function listDeviceModelSummaries(namespace?: string): Promise<DeviceModelSummaryListResponse> {
  const res = await gatewayRequest<DeviceModelSummaryListResponse>("/blueedge/devicemodels/summary", {
    params: { namespace },
  });
  return res.data;
}

export async function getDeviceModelSummary(namespace: string, name: string): Promise<DeviceModelSummaryResponse> {
  const res = await gatewayRequest<DeviceModelSummaryResponse>(`/blueedge/devicemodels/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/summary`);
  return res.data;
}

export async function listDeviceSummaries(options: { namespace?: string; nodeName?: string; edgeUnit?: string; deviceModel?: string } = {}): Promise<DeviceSummaryListResponse> {
  const res = await gatewayRequest<DeviceSummaryListResponse>("/blueedge/devices/summary", {
    params: options,
  });
  return res.data;
}

export async function getDeviceSummary(namespace: string, name: string): Promise<DeviceSummaryResponse> {
  const res = await gatewayRequest<DeviceSummaryResponse>(`/blueedge/devices/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/summary`);
  return res.data;
}

export async function createDeviceConfig(payload: DeviceConfigPayload): Promise<DeviceSummaryResponse> {
  const res = await gatewayRequest<DeviceSummaryResponse, DeviceConfigPayload>("/blueedge/devices", {
    method: "POST",
    body: payload,
  });
  return res.data;
}

export async function updateDeviceConfig(namespace: string, name: string, payload: DeviceConfigPayload): Promise<DeviceSummaryResponse> {
  const res = await gatewayRequest<DeviceSummaryResponse, DeviceConfigPayload>(`/blueedge/devices/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: payload,
  });
  return res.data;
}

export async function deleteDeviceConfig(namespace: string, name: string): Promise<void> {
  await gatewayRequest(`/blueedge/devices/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function getResourceObservability(
  kind: ObservabilityKind,
  namespace: string,
  name: string,
  options: { includeMetrics?: boolean; includeEvents?: boolean; includeLogs?: boolean; container?: string; tailLines?: number; sinceSeconds?: number; previous?: boolean } = {},
): Promise<ObservabilitySummaryResponse> {
  const res = await gatewayRequest<ObservabilitySummaryResponse>(`/blueedge/observability/resources/${encodeURIComponent(kind)}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}`, {
    params: options,
  });
  return res.data;
}

export async function getResourceLogs(
  kind: ObservabilityKind,
  namespace: string,
  name: string,
  options: { pod?: string; container?: string; tailLines?: number; sinceSeconds?: number; previous?: boolean } = {},
  requestOptions: { signal?: AbortSignal } = {},
): Promise<ObservabilityLogsResponse> {
  const res = await gatewayRequest<ObservabilityLogsResponse>(`/blueedge/observability/resources/${encodeURIComponent(kind)}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}/logs`, {
    params: options,
    signal: requestOptions.signal,
  });
  return res.data;
}

export async function listDeploymentRevisions(namespace: string, name: string): Promise<{ items: DeploymentRevision[]; currentRevision: number; source: string }> {
  const res = await gatewayRequest<{ items: DeploymentRevision[]; currentRevision: number; source: string }>(`/blueedge/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/revisions`);
  return res.data;
}

export async function rollbackDeploymentRevision(namespace: string, name: string, revision: number): Promise<void> {
  await gatewayRequest(`/blueedge/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/revisions/${revision}/rollback`, {
    method: "POST",
  });
}

export async function runDeploymentAction(namespace: string, name: string, action: "start" | "stop" | "restart"): Promise<void> {
  await gatewayRequest(`/blueedge/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/actions/${action}`, {
    method: "POST",
  });
}

export async function getDeploymentAudit(namespace: string, name: string): Promise<{ items: DeploymentAuditRecord[]; source: string; completeAuditLog: false; warning: string }> {
  const res = await gatewayRequest<{ items: DeploymentAuditRecord[]; source: string; completeAuditLog: false; warning: string }>(`/blueedge/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/audit`);
  return res.data;
}

export async function executeDeploymentCommand(namespace: string, name: string, payload: { pod: string; container: string; command: string }): Promise<DeploymentExecResult> {
  const res = await gatewayRequest<{ item: DeploymentExecResult }, typeof payload>(`/blueedge/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/exec`, {
    method: "POST",
    body: payload,
  });
  return res.data.item;
}

export async function listStorageClasses(): Promise<StorageClassListResponse> {
  const res = await gatewayRequest<StorageClassListResponse>("/blueedge/storage/classes");
  return res.data;
}

export async function listPersistentVolumeSummaries(): Promise<PersistentVolumeSummaryListResponse> {
  const res = await gatewayRequest<PersistentVolumeSummaryListResponse>("/blueedge/storage/persistentvolumes/summary");
  return res.data;
}

export async function getPersistentVolumeSummary(name: string): Promise<PersistentVolumeSummaryResponse> {
  const res = await gatewayRequest<PersistentVolumeSummaryResponse>(`/blueedge/storage/persistentvolumes/${encodeURIComponent(name)}/summary`);
  return res.data;
}

export async function listPersistentVolumeClaimSummaries(namespace?: string): Promise<PersistentVolumeClaimSummaryListResponse> {
  const res = await gatewayRequest<PersistentVolumeClaimSummaryListResponse>("/blueedge/storage/persistentvolumeclaims/summary", {
    params: { namespace },
  });
  return res.data;
}

export async function getPersistentVolumeClaimSummary(namespace: string, name: string): Promise<PersistentVolumeClaimSummaryResponse> {
  const res = await gatewayRequest<PersistentVolumeClaimSummaryResponse>(`/blueedge/storage/persistentvolumeclaims/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/summary`);
  return res.data;
}

export async function getClusterMetrics(): Promise<ClusterMetrics> {
  const res = await gatewayRequest<ClusterMetrics>("/metrics/cluster");
  return res.data;
}

export async function getClusterMetricsHistory(): Promise<ClusterMetricsHistory> {
  const res = await gatewayRequest<ClusterMetricsHistory>("/metrics/cluster/history");
  return res.data;
}

export async function listClusterEvents(namespace?: string): Promise<ClusterEvent[]> {
  const res = await gatewayRequest<{ items?: ClusterEvent[] }>("/events", {
    params: { namespace },
  });
  return Array.isArray(res.data.items) ? res.data.items : [];
}

export async function getRuleDelivery(namespace: string, name: string): Promise<RuleDeliverySummary> {
  const res = await gatewayRequest<RuleDeliverySummary>(`/blueedge/rules/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/delivery`);
  return res.data;
}

export async function getRuleEvents(namespace: string, name: string): Promise<RuleEventsResponse> {
  const res = await gatewayRequest<RuleEventsResponse>(`/blueedge/rules/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/events`);
  return res.data;
}

export async function getRuleAudit(namespace: string, name: string): Promise<RuleAuditResponse> {
  const res = await gatewayRequest<RuleAuditResponse>(`/blueedge/rules/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/audit`);
  return res.data;
}

export async function getPodLogs(namespace: string, name: string, tailLines = 200): Promise<string> {
  const res = await gatewayRequest<string>(`/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs`, {
    params: { tailLines },
  });
  return res.data;
}
