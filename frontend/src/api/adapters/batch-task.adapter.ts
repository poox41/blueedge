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
  targetType: "node" | "nodeGroup" | "edgeUnit" | "deployment";
  targetRefs: string[];
  targetVersion?: string;
  image?: string;
  concurrency?: number;
  failurePolicy?: "continue" | "stop";
  timeoutSeconds?: number;
  retryCount?: number;
  progress?: number;
  totalTargets?: number;
  successCount?: number;
  failedCount?: number;
  executionMode?: "planOnly" | string;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  description?: string;
  steps?: Array<{ name: string; status: string; message?: string }>;
  targetResults?: Array<{ target: string; status: string; message?: string }>;
  errors?: Array<{ target?: string; message: string } | string>;
  targets?: Array<{ namespace?: string; image?: string; [key: string]: unknown }>;
  plan?: BatchWorkloadPlan | null;
  rawRef?: {
    kind: string;
    namespace?: string;
    name: string;
  };
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
  initializing: "计划初始化",
  pending: "计划待生成",
  running: "计划已生成",
  partialSuccess: "计划部分生成",
  succeeded: "计划已完成",
  failed: "计划生成失败",
  cancelled: "计划已取消",
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
  const namespace = item.plan?.namespace || legacyTarget?.namespace || "default";
  const image = item.image || item.plan?.podTemplate.containers[0]?.image || legacyTarget?.image || "";
  const targetGroups = Array.isArray(item.targetRefs) ? item.targetRefs : [];
  return {
    id: item.id,
    name: item.name,
    namespace,
    image,
    targetGroups,
    status: item.status === "running" || item.status === "succeeded"
      ? "部署计划已生成"
      : item.status === "failed"
        ? "部署计划生成失败"
        : item.status === "cancelled"
          ? "部署计划已取消"
          : "部署计划待生成",
    createTime: formatBatchTime(item.createdAt),
    description: item.description || "",
    rolloutPolicy: "planOnly，尚未执行真实工作负载下发",
    rollbackPolicy: "第一阶段未接入自动回滚",
    raw: item,
  };
}
