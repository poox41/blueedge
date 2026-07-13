import { gatewayRequest } from "@/api/request";
import type {
  AccessConfigDetailResponse,
  AccessConfigInstallCommandResponse,
  AccessConfigListResponse,
  AccessConfigWarning,
} from "@/api/adapters/access-config.adapter";
import type { BatchTaskDetailResponse, BatchTaskListResponse } from "@/api/adapters/batch-task.adapter";
import type { DeviceModelSummaryListResponse, DeviceModelSummaryResponse } from "@/api/adapters/device-model-summary.adapter";
import type { DeviceSummaryListResponse, DeviceSummaryResponse } from "@/api/adapters/device-summary.adapter";
import type { EdgeAppSummaryResponse } from "@/api/adapters/edgeapp-summary.adapter";
import type { EdgeUnitDetailResponse, EdgeUnitListResponse, EdgeUnitWarning } from "@/api/adapters/edge-unit.adapter";
import type { NodeGroupSummaryResponse } from "@/api/adapters/nodegroup-summary.adapter";
import type { NodeSummaryResponse } from "@/api/adapters/node-summary.adapter";
import type { ObservabilityKind, ObservabilityLogsResponse, ObservabilitySummaryResponse } from "@/api/adapters/observability.adapter";
import type { PodSummaryResponse } from "@/api/adapters/pod-summary.adapter";
import type { PersistentVolumeSummaryListResponse, PersistentVolumeSummaryResponse } from "@/api/adapters/pv-summary.adapter";
import type { PersistentVolumeClaimSummaryListResponse, PersistentVolumeClaimSummaryResponse } from "@/api/adapters/pvc-summary.adapter";
import type { StorageClassListResponse } from "@/api/adapters/storage-class.adapter";

export interface EdgeUnitCreatePayload {
  name: string;
  nodeGroupRef: string;
  clusterName?: string;
  accessType?: "external" | "dedicated" | "unknown";
  kubeEdgeVersion?: string;
  insightStatus?: "installed" | "notInstalled" | "unknown";
  monitorStatus?: "installed" | "notInstalled" | "unknown";
  description?: string;
}

export type EdgeUnitUpdatePayload = Omit<EdgeUnitCreatePayload, "name" | "nodeGroupRef">;

export interface AccessConfigPayload {
  name?: string;
  edgeUnitRef: string;
  nodeName?: string;
  architecture: "amd64" | "arm64" | "arm";
  os?: string;
  kubeEdgeVersion: string;
  cloudCoreAddress: string;
  protocol?: string;
  registry?: string;
  description?: string;
}

export type AccessConfigUpdatePayload = Omit<AccessConfigPayload, "name">;

export interface BatchTaskPayload {
  name: string;
  targetType: "node" | "nodeGroup" | "edgeUnit" | "deployment";
  targetRefs: string[];
  targetVersion?: string;
  image?: string;
  images?: string[];
  concurrency?: number;
  failurePolicy?: "continue" | "stop";
  timeoutSeconds?: number;
  retryCount?: number;
  description?: string;
  targets?: Array<Record<string, unknown>>;
}

export interface ProductOverview {
  nodes: { total: number; ready: number; edge: number };
  workloads: { deployments: number; running: number };
  devices: { total: number; online: number };
  rules: { total: number };
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

export async function getProductOverview(): Promise<ProductOverview> {
  const res = await gatewayRequest<ProductOverview>("/overview");
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

export async function createEdgeUnit(payload: EdgeUnitCreatePayload): Promise<EdgeUnitDetailResponse> {
  const res = await gatewayRequest<EdgeUnitDetailResponse, EdgeUnitCreatePayload>("/blueedge/edge-units", {
    method: "POST",
    body: payload,
  });
  return res.data;
}

export async function updateEdgeUnit(name: string, payload: EdgeUnitUpdatePayload): Promise<EdgeUnitDetailResponse> {
  const res = await gatewayRequest<EdgeUnitDetailResponse, EdgeUnitUpdatePayload>(`/blueedge/edge-units/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: payload,
  });
  return res.data;
}

export async function deleteEdgeUnit(name: string): Promise<{ warnings?: EdgeUnitWarning[] }> {
  const res = await gatewayRequest<{ warnings?: EdgeUnitWarning[] }>(`/blueedge/edge-units/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return res.data;
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

export async function getAccessConfigInstallCommand(name: string): Promise<AccessConfigInstallCommandResponse> {
  const res = await gatewayRequest<AccessConfigInstallCommandResponse>(`/blueedge/access-configs/${encodeURIComponent(name)}/install-command`);
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

export async function getBatchWorkloadTask(taskId: string): Promise<BatchTaskDetailResponse> {
  const res = await gatewayRequest<BatchTaskDetailResponse>(`/blueedge/workloads/batch/${encodeURIComponent(taskId)}`);
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
): Promise<ObservabilityLogsResponse> {
  const res = await gatewayRequest<ObservabilityLogsResponse>(`/blueedge/observability/resources/${encodeURIComponent(kind)}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}/logs`, {
    params: options,
  });
  return res.data;
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

export async function getPodLogs(namespace: string, name: string, tailLines = 200): Promise<string> {
  const res = await gatewayRequest<string>(`/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs`, {
    params: { tailLines },
  });
  return res.data;
}
