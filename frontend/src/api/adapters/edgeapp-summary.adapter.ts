export interface EdgeAppSummaryResponse {
  item: EdgeAppSummaryItem;
  warnings?: Array<{ source: string; message: string }>;
}

export interface EdgeAppSummaryItem {
  name: string;
  namespace: string;
  status: "running" | "failed" | "paused" | "unknown" | string;
  targetNodeGroups: string[];
  nodeGroups: Array<{ name: string; missing?: boolean; matchLabels?: Record<string, string>; explicitNodes?: string[] }>;
  workloads: Array<Record<string, any>>;
  pods: Array<{ name: string; namespace: string; status: string; nodeName: string; podIP: string; restartCount: number; images: string[]; createdAt: string }>;
  events: unknown[];
  metrics: unknown | null;
  createdAt: string;
  yaml: any;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export function edgeAppSummaryStatusText(status: string) {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "paused") return "已暂停";
  return "未知";
}
