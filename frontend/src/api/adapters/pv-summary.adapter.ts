import type { StorageClassSummary } from "@/api/adapters/storage-class.adapter";

export interface PersistentVolumeSummary {
  name: string;
  status: "available" | "bound" | "released" | "failed" | "unknown" | string;
  phase: string;
  capacity: string;
  accessModes: string[];
  reclaimPolicy: string;
  storageClass: string;
  storageClassInfo: StorageClassSummary | null;
  volumeMode: string;
  claim: { namespace: string; name: string } | null;
  claimInfo: { namespace: string; name: string; phase: string } | null;
  source: { type: string; driver: string; path: string; fsType?: string };
  nodeAffinity: Record<string, unknown>;
  usedBy: Array<{ kind: string; namespace: string; name: string; path: string }>;
  usedByCount: number;
  createdAt: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  raw: any;
}

export interface PersistentVolumeSummaryListResponse {
  items: PersistentVolumeSummary[];
  warnings?: Array<{ source: string; message: string }>;
}

export interface PersistentVolumeSummaryResponse {
  item: PersistentVolumeSummary;
  warnings?: Array<{ source: string; message: string }>;
}

export function pvStatusText(status: string, phase?: string) {
  if (status === "bound") return "已绑定";
  if (status === "available") return "可用";
  if (status === "released") return "已释放";
  if (status === "failed") return "失败";
  return phase || "未知";
}

export function pvStatusColor(status: string) {
  if (status === "bound") return "success";
  if (status === "available") return "warning";
  if (status === "failed") return "error";
  return "default";
}
