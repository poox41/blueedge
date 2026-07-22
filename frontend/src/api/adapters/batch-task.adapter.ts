import type { BatchWorkloadPlan } from "@/api/services/product";

export type BatchTaskApiStatus =
  | "initializing"
  | "pending"
  | "running"
  | "partialSuccess"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BatchTaskApiType = "nodeUpgrade" | "imagePreheat" | "batchWorkload";

export interface BatchTaskApiItem {
  id: string;
  name: string;
  type: BatchTaskApiType;
  status: BatchTaskApiStatus;
  targetType: "node" | "nodeGroup" | "edgeUnit" | "deployment" | "edgeapplication";
  targetRefs: string[];
  targetVersion?: string;
  image?: string;
  concurrency?: number;
  failurePolicy?: "continue" | "stop";
  timeoutSeconds?: number;
  retryCount?: number;
  failureRateThreshold?: number;
  resourceChecks?: string[];
  userConfirm?: boolean;
  credentialNamespace?: string;
  credentialName?: string;
  progress?: number;
  totalTargets?: number;
  successCount?: number;
  failedCount?: number;
  executionMode?: "planOnly" | string;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  description?: string;
  steps?: Array<{ name: string; displayName?: string; status: string; message?: string; startedAt?: string | null; finishedAt?: string | null }>;
  targetResults?: Array<{ target: string; status: string; message?: string; currentVersion?: string; targetVersion?: string; startedAt?: string | null; finishedAt?: string | null }>;
  errors?: Array<{ target?: string; message: string } | string>;
  events?: BatchTaskEvent[];
  auditRecords?: BatchTaskAuditRecord[];
  targets?: Array<{ namespace?: string; image?: string; [key: string]: unknown }>;
  plan?: BatchWorkloadPlan | null;
  namespace?: string;
  targetGroups?: string[];
  missingNodeGroups?: string[];
  workloads?: Array<{
    name: string;
    namespace: string;
    nodeGroup: string;
    targetGroups?: string[];
    missingNodeGroups?: string[];
    nodeGroupExists?: boolean;
    replicas: number;
    readyReplicas: number;
    status: "running" | "succeeded" | "failed" | string;
    image: string;
    createdAt?: string;
    uid?: string;
  }>;
  definitions?: Array<Record<string, any>>;
  yaml?: string;
  rawRef?: {
    kind: string;
    namespace?: string;
    name: string;
  };
}

export interface BatchTaskEvent {
  time: string;
  type: "Normal" | "Warning";
  reason: string;
  message: string;
}

export interface BatchTaskAuditRecord {
  time: string;
  actor: string;
  action: string;
  result: "success" | "failed";
  message: string;
}

export interface BatchTaskWarning {
  source: string;
  message: string;
}

export interface BatchTaskListResponse {
  items: BatchTaskApiItem[];
  warnings?: BatchTaskWarning[];
}

export interface BatchTaskDetailResponse {
  item: BatchTaskApiItem;
  warnings?: BatchTaskWarning[];
}

export const batchTaskTypeText: Record<BatchTaskApiType, "节点升级" | "镜像预热" | "批量工作负载"> = {
  nodeUpgrade: "节点升级",
  imagePreheat: "镜像预热",
  batchWorkload: "批量工作负载",
};

export const batchTaskStatusText: Record<BatchTaskApiStatus, string> = {
  initializing: "初始化",
  pending: "待执行",
  running: "执行中",
  partialSuccess: "部分成功",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
};

export function formatBatchTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function toBatchTaskRow(item: BatchTaskApiItem) {
  return {
    id: item.id,
    name: item.name,
    type: batchTaskTypeText[item.type] || "节点升级",
    status: batchTaskStatusText[item.status] || "待执行",
    image: item.image || "",
    version: item.targetVersion || "",
    targetNodes: item.totalTargets || item.targetRefs?.length || item.targets?.length || 0,
    createTime: formatBatchTime(item.createdAt),
    description: item.description || "",
    executionMode: item.executionMode || "planOnly",
    raw: item,
  };
}

export function toBatchWorkloadRow(item: BatchTaskApiItem) {
  const legacyTarget = Array.isArray(item.targets) ? item.targets[0] : null;
  const namespace = item.namespace || item.plan?.namespace || legacyTarget?.namespace || "default";
  const image = item.image || item.plan?.podTemplate.containers[0]?.image || legacyTarget?.image || "";
  const targetGroups = item.targetGroups || (Array.isArray(item.targetRefs) ? item.targetRefs : []);
  return {
    id: item.id,
    name: item.name,
    namespace,
    image,
    targetGroups,
    status: item.status === "succeeded"
      ? "成功"
      : item.status === "running"
        ? "执行中"
      : item.status === "failed"
        ? "失败"
        : item.status === "partialSuccess"
          ? "部分成功"
        : item.status === "cancelled"
          ? "已取消"
          : "待执行",
    createTime: formatBatchTime(item.createdAt),
    description: item.description || "",
    rolloutPolicy: item.executionMode === "edgeapplication" ? "KubeEdge EdgeApplication 下发" : "Kubernetes Deployment 滚动更新",
    rollbackPolicy: item.executionMode === "edgeapplication" ? "由 EdgeApplication 控制器管理" : "由 Deployment revision 管理",
    raw: item,
  };
}
