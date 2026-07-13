import type { StorageClassSummary } from "@/api/adapters/storage-class.adapter";

export interface PersistentVolumeClaimSummary {
  namespace: string;
  name: string;
  status: "bound" | "pending" | "lost" | "unknown" | string;
  phase: string;
  requestedCapacity: string;
  actualCapacity: string;
  accessModes: string[];
  storageClass: string;
  storageClassInfo: StorageClassSummary | null;
  volume: string;
  volumeInfo: { name: string; phase: string; reclaimPolicy: string } | null;
  volumeMode: string;
  selector: Record<string, unknown> | null;
  conditions: Array<Record<string, unknown>>;
  usedBy: Array<{ kind: string; namespace: string; name: string; path: string }>;
  usedByCount: number;
  createdAt: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  raw: any;
}

export interface PersistentVolumeClaimSummaryListResponse {
  items: PersistentVolumeClaimSummary[];
  warnings?: Array<{ source: string; message: string }>;
}

export interface PersistentVolumeClaimSummaryResponse {
  item: PersistentVolumeClaimSummary;
  warnings?: Array<{ source: string; message: string }>;
}

export function pvcStatusText(status: string, phase?: string) {
  if (status === "bound") return "已绑定";
  if (status === "pending") return "待处理";
  if (status === "lost") return "丢失";
  return phase || "未知";
}

export function pvcStatusColor(status: string) {
  if (status === "bound") return "success";
  if (status === "pending") return "warning";
  if (status === "failed" || status === "lost") return "error";
  return "default";
}
